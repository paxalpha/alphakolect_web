import { randomBytes } from 'node:crypto';
import {
  AccountStatement,
  AUTH_COOKIES,
  BalanceSheet,
  CSRF_HEADER,
  JournalEntry,
  LedgerAccount,
  LedgerAccountList,
  ProfitAndLoss,
  TrialBalance,
} from '@alphakolect/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, TEST_WEB_ORIGIN } from '../support/app.js';
import { expectError, tenancyFixtures } from '../support/tenancy.js';

// P6 through the real app and database (docs/architecture/P6_IMPLEMENTATION_PLAN.md §5): the chart with balances, the
// business's own accounts, manual entries and their reversal under an Idempotency-Key (TA-6), statements, entries and
// the three reports. The business is the session's; another business's entry is 404 like a missing one; each endpoint
// needs its permission, which the owner can give to a role (P6_OWNER_LEDGER_PERMISSIONS.md).

const { app, auth } = await createTestApp();
const { owner, business, member, call, auditFor } = tenancyFixtures(app, auth);

const CSRF = 'csrf-token-for-the-test';
const today = () => new Date().toISOString().slice(0, 10);
const key = () => `key-${randomBytes(8).toString('hex')}`;

/** A POST as the web app makes it, with an Idempotency-Key. */
const postWithKey = (token: string, path: string, idempotencyKey: string | null, body: object) => {
  const req = request(app)
    .post(path)
    .set('Cookie', `${AUTH_COOKIES.access}=${token}; ${AUTH_COOKIES.csrf}=${CSRF}`)
    .set('Origin', TEST_WEB_ORIGIN)
    .set(CSRF_HEADER, CSRF);
  return (idempotencyKey ? req.set('Idempotency-Key', idempotencyKey) : req).send(body);
};

async function books() {
  const b = await business();
  const res = await call(b.owner.token, 'get', '/v1/merchant/ledger/accounts');
  const accounts = LedgerAccountList.parse(res.body).items;
  const id = (code: string) => accounts.find((a) => a.code === code)!.accountId;
  return { b, id };
}
type Books = Awaited<ReturnType<typeof books>>;

const entry = (lines: Array<[string, 'debit' | 'credit', string]>, effectiveDate = today()) => ({
  effectiveDate,
  narrative: 'Opening balance',
  lines: lines.map(([accountId, side, amountMinor]) => ({ accountId, side, amountMinor })),
});
const capitalIn = (bk: Books, amount: string) =>
  entry([
    [bk.id('1000'), 'debit', amount],
    [bk.id('3000'), 'credit', amount],
  ]);

describe('the chart of accounts', () => {
  it('every business starts with the owner’s chart, every balance zero', async () => {
    const { b } = await books();
    const res = await call(b.owner.token, 'get', '/v1/merchant/ledger/accounts');
    expect(res.status).toBe(200);
    const { items } = LedgerAccountList.parse(res.body);
    expect(items).toHaveLength(23);
    expect(items[0]).toMatchObject({
      code: '1000',
      name: 'Cash at bank',
      type: 'asset',
      nonNegative: true,
      isSystem: true,
      subject: null,
      balance: { amountMinor: '0', currency: 'NGN' },
    });
  });

  it('the business adds its own account (BR-9.1): recorded, its code unique', async () => {
    const { b } = await books();
    const res = await call(b.owner.token, 'post', '/v1/merchant/ledger/accounts', {
      code: '6100',
      name: 'Rent',
      type: 'expense',
    });
    expect(res.status).toBe(201);
    const account = LedgerAccount.parse(res.body);
    expect(account).toMatchObject({ code: '6100', name: 'Rent', isSystem: false, nonNegative: false });
    expect(await auditFor(res)).toEqual([
      expect.objectContaining({
        action: 'ledger.account_created',
        outcome: 'success',
        target_id: account.accountId,
        summary: { code: '6100', name: 'Rent', type: 'expense' },
      }),
    ]);
    const again = await call(b.owner.token, 'post', '/v1/merchant/ledger/accounts', {
      code: '1000',
      name: 'Another bank',
      type: 'asset',
    });
    expectError(again, 409, 'CODE_TAKEN');
    expectError(
      await call(b.owner.token, 'post', '/v1/merchant/ledger/accounts', {
        code: '61',
        name: 'X',
        type: 'asset',
      }),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('manual journal entries (TA-6)', () => {
  it('posted once under its key: a retry gets the first answer; another body with the key is refused', async () => {
    const bk = await books();
    const k = key();
    const first = await postWithKey(
      bk.b.owner.token,
      '/v1/merchant/ledger/entries',
      k,
      capitalIn(bk, '500000'),
    );
    expect(first.status).toBe(201);
    expect(await auditFor(first)).toEqual([
      expect.objectContaining({
        action: 'ledger.manual_entry_posted',
        outcome: 'success',
        summary: { entryId: first.body.entryId, lineCount: 2, totalMinor: '500000', effectiveDate: today() },
      }),
    ]);
    const retry = await postWithKey(
      bk.b.owner.token,
      '/v1/merchant/ledger/entries',
      k,
      capitalIn(bk, '500000'),
    );
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(await auditFor(retry)).toEqual([]);
    expectError(
      await postWithKey(bk.b.owner.token, '/v1/merchant/ledger/entries', k, capitalIn(bk, '1')),
      409,
      'IDEMPOTENCY_KEY_REUSED',
    );
    const accounts = LedgerAccountList.parse(
      (await call(bk.b.owner.token, 'get', '/v1/merchant/ledger/accounts')).body,
    ).items;
    expect(accounts.find((a) => a.code === '1000')!.balance.amountMinor).toBe('500000');

    const read = await call(bk.b.owner.token, 'get', `/v1/merchant/ledger/entries/${first.body.entryId}`);
    expect(JournalEntry.parse(read.body)).toMatchObject({
      entryType: 'manual',
      narrative: 'Opening balance',
      createdBy: bk.b.owner.identityId,
      reversesEntryId: null,
      reversedByEntryId: null,
    });
    expect(read.body.lines).toHaveLength(2);
  });

  it('requires an Idempotency-Key', async () => {
    const bk = await books();
    expectError(
      await postWithKey(bk.b.owner.token, '/v1/merchant/ledger/entries', null, capitalIn(bk, '1')),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('a refused entry writes nothing and frees its key', async () => {
    const bk = await books();
    const k = key();
    const unbalanced = entry([
      [bk.id('1000'), 'debit', '100'],
      [bk.id('3000'), 'credit', '99'],
    ]);
    expectError(
      await postWithKey(bk.b.owner.token, '/v1/merchant/ledger/entries', k, unbalanced),
      422,
      'UNBALANCED_ENTRY',
    );
    const ok = await postWithKey(bk.b.owner.token, '/v1/merchant/ledger/entries', k, capitalIn(bk, '100'));
    expect(ok.status).toBe(201);
  });

  it.each([
    ['a control account (post to its sub-accounts)', '2100', '422', 'ACCOUNT_NOT_POSTABLE'],
    ['cash that is not there', '1200', '422', 'INSUFFICIENT_BALANCE'],
  ])('refuses %s', async (_label, code, status, error) => {
    const bk = await books();
    const lines = entry([
      [bk.id('5100'), 'debit', '100'],
      [bk.id(code), 'credit', '100'],
    ]);
    expectError(
      await postWithKey(bk.b.owner.token, '/v1/merchant/ledger/entries', key(), lines),
      Number(status),
      error,
    );
  });

  it('refuses a future date and another business’s account', async () => {
    const bk = await books();
    const other = await books();
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expectError(
      await postWithKey(bk.b.owner.token, '/v1/merchant/ledger/entries', key(), {
        ...capitalIn(bk, '1'),
        effectiveDate: tomorrow,
      }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await postWithKey(
        bk.b.owner.token,
        '/v1/merchant/ledger/entries',
        key(),
        entry([
          [other.id('1000'), 'debit', '1'],
          [bk.id('3000'), 'credit', '1'],
        ]),
      ),
      422,
      'ACCOUNT_NOT_POSTABLE',
    );
  });
});

describe('reversal (TA-4, BR-11.1)', () => {
  it('reverses a manual entry once; a reversal is never reversed; another business’s entry is not found', async () => {
    const bk = await books();
    const posted = await postWithKey(
      bk.b.owner.token,
      '/v1/merchant/ledger/entries',
      key(),
      capitalIn(bk, '700'),
    );
    const path = `/v1/merchant/ledger/entries/${posted.body.entryId}/reversal`;
    const k = key();
    const reversed = await postWithKey(bk.b.owner.token, path, k, { narrative: 'Posted twice' });
    expect(reversed.status).toBe(201);
    expect(await auditFor(reversed)).toEqual([
      expect.objectContaining({
        action: 'ledger.entry_reversed',
        summary: { entryId: posted.body.entryId, reversalId: reversed.body.entryId },
      }),
    ]);
    expect((await postWithKey(bk.b.owner.token, path, k, { narrative: 'Posted twice' })).body).toEqual(
      reversed.body,
    );
    expectError(await postWithKey(bk.b.owner.token, path, key(), {}), 409, 'ALREADY_REVERSED');
    expectError(
      await postWithKey(
        bk.b.owner.token,
        `/v1/merchant/ledger/entries/${reversed.body.entryId}/reversal`,
        key(),
        {},
      ),
      422,
      'NOT_REVERSIBLE',
    );
    const original = JournalEntry.parse(
      (await call(bk.b.owner.token, 'get', `/v1/merchant/ledger/entries/${posted.body.entryId}`)).body,
    );
    expect(original.reversedByEntryId).toBe(reversed.body.entryId);

    const other = await books();
    expectError(await postWithKey(other.b.owner.token, path, key(), {}), 404, 'NOT_FOUND');
    expectError(
      await call(other.b.owner.token, 'get', `/v1/merchant/ledger/entries/${posted.body.entryId}`),
      404,
      'NOT_FOUND',
    );
  });
});

describe('statements and reports', () => {
  it('a statement pages oldest first with running balances; the reports balance', async () => {
    const bk = await books();
    for (const amount of ['1000', '250', '50'])
      await postWithKey(bk.b.owner.token, '/v1/merchant/ledger/entries', key(), capitalIn(bk, amount));
    await postWithKey(
      bk.b.owner.token,
      '/v1/merchant/ledger/entries',
      key(),
      entry([
        [bk.id('5100'), 'debit', '300'],
        [bk.id('1000'), 'credit', '300'],
      ]),
    );
    const base = `/v1/merchant/ledger/accounts/${bk.id('1000')}/statement?from=2000-01-01&to=${today()}`;
    const page1 = AccountStatement.parse((await call(bk.b.owner.token, 'get', `${base}&limit=2`)).body);
    expect(page1.items.map((i) => i.balance.amountMinor)).toEqual(['1000', '1250']);
    expect(page1.account.balance.amountMinor).toBe('1000');
    const page2 = AccountStatement.parse(
      (await call(bk.b.owner.token, 'get', `${base}&limit=2&cursor=${page1.nextCursor}`)).body,
    );
    expect(page2.items.map((i) => [i.side, i.balance.amountMinor])).toEqual([
      ['debit', '1300'],
      ['credit', '1000'],
    ]);
    expect(page2.nextCursor).toBeNull();
    expectError(
      await call(
        bk.b.owner.token,
        'get',
        `${base.replace('2000-01-01', '2001-01-01')}&cursor=${page1.nextCursor}`,
      ),
      400,
      'INVALID_CURSOR',
    );
    expectError(
      await call(
        bk.b.owner.token,
        'get',
        `/v1/merchant/ledger/accounts/${bk.id('1000')}/statement?from=2026-02-01&to=2026-01-01`,
      ),
      400,
      'VALIDATION_ERROR',
    );

    const trial = TrialBalance.parse(
      (await call(bk.b.owner.token, 'get', `/v1/merchant/reports/trial-balance?asOf=${today()}`)).body,
    );
    expect(trial.totalDebit).toEqual(trial.totalCredit);
    expect(trial.totalDebit.amountMinor).toBe('1300');

    const sheet = BalanceSheet.parse(
      (await call(bk.b.owner.token, 'get', `/v1/merchant/reports/balance-sheet?asOf=${today()}`)).body,
    );
    expect(sheet.assets.total.amountMinor).toBe('1000');
    expect(sheet.equity.total.amountMinor).toBe('1300');
    expect(sheet.currentEarnings.amountMinor).toBe('-300');
    expect(BigInt(sheet.assets.total.amountMinor)).toBe(
      BigInt(sheet.liabilities.total.amountMinor) +
        BigInt(sheet.equity.total.amountMinor) +
        BigInt(sheet.currentEarnings.amountMinor),
    );

    const pnl = ProfitAndLoss.parse(
      (
        await call(
          bk.b.owner.token,
          'get',
          `/v1/merchant/reports/profit-and-loss?from=${today()}&to=${today()}`,
        )
      ).body,
    );
    expect(pnl.expenses.total.amountMinor).toBe('300');
    expect(pnl.netProfit.amountMinor).toBe('-300');
    expect(
      ProfitAndLoss.parse(
        (
          await call(
            bk.b.owner.token,
            'get',
            `/v1/merchant/reports/profit-and-loss?from=2000-01-01&to=2000-12-31`,
          )
        ).body,
      ).netProfit.amountMinor,
    ).toBe('0');
  });
});

describe('permissions (P6-3; the owner’s answers)', () => {
  it('a staff member holds only what the role grants; the owner can give each ledger permission', async () => {
    const bk = await books();
    const staff = await member(bk.b, 'staff');
    expectError(await call(staff.token, 'get', '/v1/merchant/ledger/accounts'), 403, 'FORBIDDEN');
    expectError(
      await postWithKey(staff.token, '/v1/merchant/ledger/entries', key(), capitalIn(bk, '1')),
      403,
      'FORBIDDEN',
    );
    const grant = await owner.query(`SELECT outcome FROM tenancy.set_role_permissions($1, $2, $3)`, [
      bk.b.owner.sessionId,
      bk.b.roleId,
      ['merchant.ledger.read', 'merchant.ledger.post'],
    ]);
    expect(grant.rows[0].outcome).toBe('ok');
    expect((await call(staff.token, 'get', '/v1/merchant/ledger/accounts')).status).toBe(200);
    expect(
      (await postWithKey(staff.token, '/v1/merchant/ledger/entries', key(), capitalIn(bk, '1'))).status,
    ).toBe(201);
    expectError(
      await call(staff.token, 'post', '/v1/merchant/ledger/accounts', {
        code: '6200',
        name: 'Fuel',
        type: 'expense',
      }),
      403,
      'FORBIDDEN',
    );
  });

  it('an agent cannot reach the books at all', async () => {
    const bk = await books();
    const agent = await member(bk.b, 'agent');
    const res = await call(agent.token, 'get', '/v1/merchant/ledger/accounts');
    expect([401, 403]).toContain(res.status);
  });
});
