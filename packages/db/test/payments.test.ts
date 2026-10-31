import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// Payments (P9; docs/architecture/P9_IMPLEMENTATION_PLAN.md; the owner's answers of 2026-10-26,
// docs/business/P9_OWNER_PAYMENTS.md): Live wallets only after a business confirms its email (BR-2.3), provider events
// confirmed with the provider (a forged or replayed one credits nothing, TA-8), money received to be classified (Q1),
// unmatched money and contradictions for the platform team (Q4), payment orders that survive a timeout (TA-8), the
// reconciler's findings (Q5) and the Platform Live wallet (Q6). Called as the API (alphakolect_app) and the worker
// (alphakolect_worker) call them; effects are read as the table owner. The races are in payments-races.test.ts.

let app: pg.Client;
let worker: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [app, worker, owner] = await Promise.all([connectAs('app'), connectAs('worker'), connectAs('migrator')]);
});
afterAll(async () => {
  await Promise.all([app.end(), worker.end(), owner.end()]);
});

const PROVIDER = 'fake';
const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
const unique = (tag: string) => `${tag} ${randomBytes(3).toString('hex')}`;
const digits = (n: number) =>
  Array.from(randomBytes(n))
    .map((b) => String(b % 10))
    .join('');
const txId = () => `tx-${randomBytes(8).toString('hex')}`;
const one = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0];
const call = async (sql: string, params: unknown[]) => (await app.query(sql, params)).rows[0];
const work = async (sql: string, params: unknown[] = []) => (await worker.query(sql, params)).rows[0];
/** A claim's token, for a test that records without staging the claim (claims are tested on their own, below). */
const lease = async (table: 'live_wallets' | 'provider_events' | 'payment_orders', id: string) =>
  (
    await one(
      `UPDATE payments.${table} SET lease_token = gen_random_uuid() WHERE id = $1 RETURNING lease_token`,
      [id],
    )
  ).lease_token as string;

async function session(identityId: string, audience: string, membershipId: string) {
  const { rows } = await app.query(
    `SELECT * FROM identity.create_session($1, $2, $3, 'full', $4, $5, $6, NULL, NULL)`,
    audience === 'platform'
      ? [identityId, audience, membershipId, hash(), 3600, 43200]
      : [identityId, audience, membershipId, hash(), 86400, 1209600],
  );
  return rows[0].session_id as string;
}

/** A business that has signed up; verified (its email confirmed) unless told otherwise. */
async function business({ verified = true } = {}) {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, $3)`, [
    email('owner'),
    ARGON,
    unique('Wallets'),
  ]);
  if (verified) {
    const verification = hash();
    await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
      s.identity_id,
      verification,
    ]);
    await app.query(`SELECT identity.verify_email($1)`, [verification]);
  }
  const membershipId = (
    await one(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [s.identity_id])
  ).id as string;
  return {
    merchantId: s.merchant_id as string,
    identityId: s.identity_id as string,
    membershipId,
    session: verified ? await session(s.identity_id, 'merchant', membershipId) : '',
  };
}
type Business = Awaited<ReturnType<typeof business>>;

async function staff(b: Business, permissions: string[]) {
  const roleId = (
    await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
      b.merchantId,
      unique('Role'),
    ])
  ).id as string;
  if (permissions.length)
    await call(`SELECT outcome FROM tenancy.set_role_permissions($1, $2, $3)`, [
      b.session,
      roleId,
      permissions,
    ]);
  const identityId = (
    await one(
      `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
      [email('staff'), ARGON],
    )
  ).id as string;
  const membershipId = (
    await one(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id)
       VALUES ($1, $2, 'staff', $3) RETURNING id`,
      [b.merchantId, identityId, roleId],
    )
  ).id as string;
  return { session: await session(identityId, 'merchant', membershipId) };
}

async function platformMember(role: 'super_admin' | 'support', grants: string[] = []) {
  const identityId = (
    await one(`INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`, [
      email(role),
    ])
  ).id as string;
  const membershipId = (
    await one(`INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, $2) RETURNING id`, [
      identityId,
      role,
    ])
  ).id as string;
  await owner.query(
    `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at)
     VALUES ($1, '\\x00', 'k1', now())`,
    [identityId],
  );
  for (const g of grants)
    await owner.query(
      `INSERT INTO identity.platform_membership_grants (platform_membership_id, permission) VALUES ($1, $2)`,
      [membershipId, g],
    );
  return { identityId, membershipId, session: await session(identityId, 'platform', membershipId) };
}

const walletOf = (merchantId: string) =>
  one(`SELECT * FROM payments.live_wallets WHERE owner_kind = 'merchant' AND merchant_id = $1`, [merchantId]);

/** A verified business with an active wallet. */
async function withWallet() {
  const b = await business();
  await work(`SELECT payments.request_wallets($1)`, [PROVIDER]);
  const w = await walletOf(b.merchantId);
  const accountNumber = digits(10);
  const r = await work(
    `SELECT payments.record_wallet_created($1, $2, $3, $4, 'Wallets', 'Test Bank') AS outcome`,
    [w.id, await lease('live_wallets', w.id), `ref-${randomBytes(6).toString('hex')}`, accountNumber],
  );
  expect(r.outcome).toBe('ok');
  return { b, walletId: w.id as string, accountNumber };
}

const storeEvent = async (reference: string | null = txId(), body = '{"amount":"999999999"}') =>
  (
    await call(`SELECT payments.store_event($1, $2, $3, $4) AS id`, [
      PROVIDER,
      JSON.stringify({ 'content-type': 'application/json' }),
      body,
      reference,
    ])
  ).id as string;
/** What the worker records once the provider has answered about the event's transaction. */
const confirm = async (
  eventId: string,
  tx: { id: string; account: string | null; amount: number; status?: string },
  maxAttempts = 5,
) =>
  (
    await work(`SELECT payments.record_event($1, $2, true, $3, $4, $5, 'NGN', $6, now(), $7) AS outcome`, [
      eventId,
      await lease('provider_events', eventId),
      tx.id,
      tx.account,
      tx.amount,
      tx.status ?? 'successful',
      maxAttempts,
    ])
  ).outcome as string;
const notFound = async (eventId: string, maxAttempts = 5) =>
  (
    await work(
      `SELECT payments.record_event($1, $2, false, NULL, NULL, NULL, NULL, NULL, NULL, $3) AS outcome`,
      [eventId, await lease('provider_events', eventId), maxAttempts],
    )
  ).outcome as string;
const balance = async (merchantId: string, code: string) =>
  Number(
    (
      await one(
        `SELECT p.balance_minor::text AS b FROM ledger.accounts a JOIN ledger.balance_projection p ON p.account_id = a.id
          WHERE a.merchant_id = $1 AND a.code = $2 AND a.subject_id IS NULL`,
        [merchantId, code],
      )
    ).b,
  );
const accountId = async (merchantId: string, code: string) =>
  (
    await one(`SELECT id FROM ledger.accounts WHERE merchant_id = $1 AND code = $2 AND subject_id IS NULL`, [
      merchantId,
      code,
    ])
  ).id as string;
const entriesOf = async (merchantId: string) =>
  (await one(`SELECT count(*)::int AS n FROM ledger.journal_entries WHERE merchant_id = $1`, [merchantId]))
    .n as number;
const newCustomer = async (b: Business) => {
  const branchId = (
    await one(`INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
      b.merchantId,
      unique('Main'),
    ])
  ).id;
  return (
    await call(`SELECT * FROM customers.create_customer($1, $2, 'Ada', $3)`, [
      b.session,
      branchId,
      `080${digits(8)}`,
    ])
  ).id as string;
};

// The pairs the worker writes without a request, and the once-per-platform one: their two tests each (the API's coverage
// guard counts these tags). First in the file: the Platform Live wallet does not exist yet.
describe('coverage: these events commit with their change, and fail it when they fail', () => {
  async function failing(action: string, run: () => Promise<unknown>) {
    const name = `test_fail_${randomBytes(6).toString('hex')}`;
    await owner.query(
      `CREATE FUNCTION audit.${name}() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN
         IF NEW.action = '${action}' THEN RAISE EXCEPTION 'injected audit storage failure' USING ERRCODE = 'XX000'; END IF;
         RETURN NEW;
       END $fn$`,
    );
    await owner.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.${name}()`,
    );
    try {
      await expectSqlState(run() as Promise<never>, 'XX000');
    } finally {
      await owner.query(`DROP TRIGGER ${name} ON audit.audit_events`);
      await owner.query(`DROP FUNCTION audit.${name}()`);
    }
  }
  const events = async (action: string, target: string) =>
    (
      await one(`SELECT count(*)::int AS n FROM audit.audit_events WHERE action = $1 AND target_id = $2`, [
        action,
        target,
      ])
    ).n as number;

  it('[coverage payments.wallet_provisioned/success] one row commits with the wallet', async () => {
    const { walletId } = await withWallet();
    expect(await events('payments.wallet_provisioned', walletId)).toBe(1);
  });
  it('[coverage payments.wallet_provisioned/success] its insert failing, the wallet stays as it was', async () => {
    const b = await business();
    await work(`SELECT payments.request_wallets($1)`, [PROVIDER]);
    const w = await walletOf(b.merchantId);
    const token = await lease('live_wallets', w.id);
    await failing('payments.wallet_provisioned', () =>
      worker.query(`SELECT payments.record_wallet_created($1, $2, 'r', $3, 'n', 'b')`, [
        w.id,
        token,
        digits(10),
      ]),
    );
    expect((await walletOf(b.merchantId)).status).toBe('provisioning');
  });
  it('[coverage payments.money_received/success] one row commits with the credit', async () => {
    const { walletId, accountNumber } = await withWallet();
    await confirm(await storeEvent(), { id: txId(), account: accountNumber, amount: 100 });
    expect(await events('payments.money_received', walletId)).toBe(1);
  });
  it('[coverage payments.money_received/success] its insert failing, nothing is credited', async () => {
    const { b, accountNumber } = await withWallet();
    const event = await storeEvent();
    await failing('payments.money_received', () =>
      confirm(event, { id: txId(), account: accountNumber, amount: 100 }),
    );
    expect(await balance(b.merchantId, '1100')).toBe(0);
    expect((await one(`SELECT status FROM payments.provider_events WHERE id = $1`, [event])).status).toBe(
      'received',
    );
  });
  it('[coverage payments.finding_recorded/success] one row commits with the finding', async () => {
    const { walletId } = await withWallet();
    await work(`SELECT payments.record_finding('wallet', $1, 9, 0)`, [walletId]);
    const f = await one(`SELECT id FROM payments.reconciliation_findings WHERE wallet_id = $1`, [walletId]);
    expect(await events('payments.finding_recorded', f.id)).toBe(1);
  });
  it('[coverage payments.finding_recorded/success] its insert failing, there is no finding', async () => {
    const { walletId } = await withWallet();
    await failing('payments.finding_recorded', () =>
      worker.query(`SELECT payments.record_finding('wallet', $1, 9, 0)`, [walletId]),
    );
    expect(
      (
        await one(`SELECT count(*)::int AS n FROM payments.reconciliation_findings WHERE wallet_id = $1`, [
          walletId,
        ])
      ).n,
    ).toBe(0);
  });
  it('[coverage payments.platform_wallet_requested/success] one row commits with the request', async () => {
    const admin = await platformMember('super_admin');
    const r = await call(`SELECT * FROM payments.request_platform_wallet($1, $2)`, [admin.session, PROVIDER]);
    expect(await events('payments.platform_wallet_requested', r.id)).toBe(1);
    await owner.query(`DELETE FROM payments.live_wallets WHERE id = $1`, [r.id]);
  });
  it('[coverage payments.platform_wallet_requested/success] its insert failing, nothing is requested', async () => {
    const admin = await platformMember('super_admin');
    await failing('payments.platform_wallet_requested', () =>
      app.query(`SELECT * FROM payments.request_platform_wallet($1, $2)`, [admin.session, PROVIDER]),
    );
    expect(
      (await one(`SELECT count(*)::int AS n FROM payments.live_wallets WHERE owner_kind = 'platform'`)).n,
    ).toBe(0);
  });
});

describe('Live wallets (BR-2.3, 4.1–4.3)', () => {
  it('BR-2.3: a business gets a wallet only once its email is confirmed, and only one', async () => {
    const pending = await business({ verified: false });
    await work(`SELECT payments.request_wallets($1)`, [PROVIDER]);
    expect(await walletOf(pending.merchantId)).toBeUndefined();
    const verified = await business();
    await work(`SELECT payments.request_wallets($1)`, [PROVIDER]);
    await work(`SELECT payments.request_wallets($1)`, [PROVIDER]);
    const { rows } = await owner.query(
      `SELECT status, alias FROM payments.live_wallets WHERE merchant_id = $1`,
      [verified.merchantId],
    );
    expect(rows).toEqual([{ status: 'provisioning', alias: `AKM-${verified.merchantId.replace(/-/g, '')}` }]);
  });

  it('before a wallet is requested, the business reads none', async () => {
    const b = await business();
    expect((await app.query(`SELECT * FROM payments.merchant_wallet($1)`, [b.session])).rowCount).toBe(0);
  });

  it('a deactivated business is given none', async () => {
    const b = await business();
    await owner.query(
      `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`,
      [b.merchantId],
    );
    await work(`SELECT payments.request_wallets($1)`, [PROVIDER]);
    expect(await walletOf(b.merchantId)).toBeUndefined();
  });

  it('a claim leases the wallet: claimed again only once the lease has passed; a failure retries, then gives up', async () => {
    const b = await business();
    await work(`SELECT payments.request_wallets($1)`, [PROVIDER]);
    const w = await walletOf(b.merchantId);
    const claim = async () =>
      (await worker.query(`SELECT * FROM payments.claim_wallets(1000, 300)`)).rows.filter(
        (r) => r.id === w.id,
      );
    const [first] = await claim();
    expect(first).toMatchObject({ alias: w.alias, owner_kind: 'merchant', attempts: 1 });
    expect(await claim()).toEqual([]);
    expect(
      (
        await work(`SELECT payments.record_wallet_failed($1, $2, 'timeout', 2) AS o`, [
          w.id,
          first.lease_token,
        ])
      ).o,
    ).toBe('retry');
    const after = await walletOf(b.merchantId);
    expect(after).toMatchObject({ status: 'provisioning', last_error: 'timeout', lease_until: null });
    expect(after.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    await owner.query(`UPDATE payments.live_wallets SET next_attempt_at = now() WHERE id = $1`, [w.id]);
    const [second] = await claim();
    expect(second).toMatchObject({ attempts: 2 });
    expect(
      (
        await work(`SELECT payments.record_wallet_failed($1, $2, 'refused', 2) AS o`, [
          w.id,
          second.lease_token,
        ])
      ).o,
    ).toBe('failed');
    expect((await walletOf(b.merchantId)).status).toBe('failed');
  });

  it('Q7, P9-R1: customer wallets are requested by no running process; only a migration could grant it', async () => {
    const b = await business();
    const c = await newCustomer(b);
    const count = async () =>
      (await one(`SELECT count(*)::int AS n FROM payments.live_wallets WHERE customer_id = $1`, [c])).n;
    await work(`SELECT payments.request_wallets($1)`, [PROVIDER]);
    expect(await count()).toBe(0);
    for (const role of [app, worker])
      await expectSqlState(
        role.query(`SELECT payments.request_customer_wallets($1)`, [PROVIDER]),
        SQLSTATE.insufficientPrivilege,
      );
    expect(await count()).toBe(0);
    await one(`SELECT payments.request_customer_wallets($1)`, [PROVIDER]);
    expect(await count()).toBe(1);
  });
});

describe('provider events (TA-8; the forged and the replayed)', () => {
  it('a forged event — the provider does not know it — credits nothing, and is rejected in the end', async () => {
    const { b } = await withWallet();
    const before = await entriesOf(b.merchantId);
    const e = await storeEvent();
    expect(await notFound(e)).toBe('pending');
    expect(await notFound(e, 0)).toBe('rejected');
    expect(await one(`SELECT status, outcome FROM payments.provider_events WHERE id = $1`, [e])).toEqual({
      status: 'rejected',
      outcome: 'not_confirmed',
    });
    expect(await entriesOf(b.merchantId)).toBe(before);
    expect(await balance(b.merchantId, '1100')).toBe(0);
    expect(await notFound(e)).toBe('duplicate');
  });

  it('what is credited is what the provider confirmed, never what the event says', async () => {
    const { b, accountNumber } = await withWallet();
    const e = await storeEvent(
      txId(),
      JSON.stringify({ amount: '999999999', accountNumber: 'someone else' }),
    );
    expect(await confirm(e, { id: txId(), account: accountNumber, amount: 150_000 })).toBe('credited');
    expect(await balance(b.merchantId, '1100')).toBe(150_000);
    expect(await balance(b.merchantId, '2290')).toBe(150_000);
    const receipt = await one(`SELECT * FROM payments.receipts WHERE merchant_id = $1`, [b.merchantId]);
    expect(receipt.amount_minor).toBe('150000');
    expect(receipt.classified_at).toBeNull();
  });

  it('a replayed event finds its transaction done: credited once', async () => {
    const { b, accountNumber } = await withWallet();
    const tx = { id: txId(), account: accountNumber, amount: 50_000 };
    expect(await confirm(await storeEvent(tx.id), tx)).toBe('credited');
    expect(await confirm(await storeEvent(tx.id), tx)).toBe('duplicate');
    const same = await storeEvent(tx.id);
    expect(await confirm(same, tx)).toBe('duplicate');
    expect(await confirm(same, tx)).toBe('duplicate'); // the event itself, again
    expect(await balance(b.merchantId, '1100')).toBe(50_000);
    expect(
      (await one(`SELECT count(*)::int AS n FROM payments.receipts WHERE merchant_id = $1`, [b.merchantId]))
        .n,
    ).toBe(1);
  });

  it('a transaction not final yet is looked at again; a failed one posts nothing', async () => {
    const { b, accountNumber } = await withWallet();
    const id = txId();
    const e = await storeEvent(id);
    expect(await confirm(e, { id, account: accountNumber, amount: 10_000, status: 'pending' })).toBe(
      'pending',
    );
    expect((await one(`SELECT status FROM payments.provider_events WHERE id = $1`, [e])).status).toBe(
      'pending',
    );
    expect(await confirm(e, { id, account: accountNumber, amount: 10_000 })).toBe('credited');
    const failed = await storeEvent();
    expect(
      await confirm(failed, { id: txId(), account: accountNumber, amount: 7_000, status: 'failed' }),
    ).toBe('ignored');
    expect(await balance(b.merchantId, '1100')).toBe(10_000);
  });

  it('a contradiction goes to a person: nothing is debited or credited automatically (E1)', async () => {
    const { b, accountNumber } = await withWallet();
    const credited = { id: txId(), account: accountNumber, amount: 40_000 };
    await confirm(await storeEvent(), credited);
    expect(await confirm(await storeEvent(), { ...credited, status: 'reversed' })).toBe('review');
    expect(await balance(b.merchantId, '1100')).toBe(40_000);
    const row = await one(
      `SELECT matched, provider_status, entry_id FROM payments.provider_transactions WHERE provider_tx_id = $1`,
      [credited.id],
    );
    expect(row).toMatchObject({ matched: 'review', provider_status: 'reversed' });
    expect(row.entry_id).not.toBeNull();
    // A different amount for the same transaction, and a failed one later reported successful, too.
    const other = { id: txId(), account: accountNumber, amount: 1_000 };
    await confirm(await storeEvent(), other);
    expect(await confirm(await storeEvent(), { ...other, amount: 2_000 })).toBe('review');
    const late = { id: txId(), account: accountNumber, amount: 3_000 };
    expect(await confirm(await storeEvent(), { ...late, status: 'failed' })).toBe('ignored');
    expect(await confirm(await storeEvent(), late)).toBe('review');
    expect(await balance(b.merchantId, '1100')).toBe(41_000);
  });

  it('P9-R5: the same transaction and amount for another account is a contradiction, not a duplicate', async () => {
    const { b, walletId, accountNumber } = await withWallet();
    const other = await withWallet();
    const tx = { id: txId(), account: accountNumber, amount: 25_000 };
    expect(await confirm(await storeEvent(), tx)).toBe('credited');
    expect(await confirm(await storeEvent(), { ...tx, account: other.accountNumber })).toBe('review');
    // Nothing moved: the first wallet keeps the credit, and the row shows it beside the account now named.
    expect(await balance(b.merchantId, '1100')).toBe(25_000);
    expect(await balance(other.b.merchantId, '1100')).toBe(0);
    expect(
      await one(
        `SELECT matched, wallet_id, account_number FROM payments.provider_transactions WHERE provider_tx_id = $1`,
        [tx.id],
      ),
    ).toEqual({ matched: 'review', wallet_id: walletId, account_number: other.accountNumber });
    // An account named later, where none was at first, is one too.
    const nameless = { id: txId(), account: null, amount: 1_000 };
    expect(await confirm(await storeEvent(), nameless)).toBe('unmatched');
    expect(await confirm(await storeEvent(), { ...nameless, account: accountNumber })).toBe('review');
    expect(await balance(b.merchantId, '1100')).toBe(25_000);
  });

  it('a claim hands out what is due once; an unusable confirmation is refused', async () => {
    const id = await storeEvent();
    const claimed = async () =>
      (await worker.query(`SELECT * FROM payments.claim_events(1000, 300)`)).rows.filter((r) => r.id === id);
    const [first] = await claimed();
    expect(first).toBeDefined();
    expect(await claimed()).toEqual([]);
    await expectSqlState(
      worker.query(
        `SELECT payments.record_event($1, $2, true, 'not a valid id', NULL, 10, 'NGN', 'successful', now(), 5)`,
        [id, first.lease_token],
      ),
      '22023',
    );
  });

  it('stores an event only within its size; the app cannot read the table', async () => {
    await expectSqlState(storeEvent(txId(), 'x'.repeat(65_537)), SQLSTATE.checkViolation);
    await expectSqlState(app.query(`SELECT 1 FROM payments.provider_events`), SQLSTATE.insufficientPrivilege);
  });
});

describe('money received, to be classified (Q1)', () => {
  async function received() {
    const w = await withWallet();
    await confirm(await storeEvent(), { id: txId(), account: w.accountNumber, amount: 80_000 });
    const receipt = await one(`SELECT id FROM payments.receipts WHERE merchant_id = $1`, [w.b.merchantId]);
    return { ...w, receiptId: receipt.id as string };
  }
  const classify = (s: string, receiptId: string, account: string, note: string | null = 'Owner’s deposit') =>
    call(`SELECT * FROM payments.classify_receipt($1, $2, $3, $4, '203.0.113.9', 'test', 'rq-1')`, [
      s,
      receiptId,
      account,
      note,
    ]);

  it('the business records what it was for: Dr 2290 / Cr the account it chooses, once', async () => {
    const { b, receiptId } = await received();
    const capital = await accountId(b.merchantId, '3000');
    expect(await classify(b.session, receiptId, capital)).toMatchObject({
      outcome: 'ok',
      classified_account_id: capital,
      classified_note: 'Owner’s deposit',
    });
    expect(await balance(b.merchantId, '2290')).toBe(0);
    expect(await balance(b.merchantId, '3000')).toBe(80_000);
    expect(await balance(b.merchantId, '1100')).toBe(80_000);
    expect((await classify(b.session, receiptId, capital)).outcome).toBe('invalid_status');
    expect(await balance(b.merchantId, '3000')).toBe(80_000);
  });

  it('only one of the business’s own accounts: not the wallet, a control account, a sub-account or another’s', async () => {
    const { b, receiptId } = await received();
    const c = await newCustomer(b);
    const subAccount = (
      await one(`SELECT id FROM ledger.accounts WHERE subject_id = $1 AND code = '2100'`, [c])
    ).id;
    const other = await business();
    for (const account of [
      await accountId(b.merchantId, '1100'),
      await accountId(b.merchantId, '2290'),
      await accountId(b.merchantId, '2100'),
      subAccount,
      await accountId(other.merchantId, '3000'),
    ])
      expect((await classify(b.session, receiptId, account)).outcome).toBe('invalid_account');
  });

  it('needs merchant.wallet.classify; another business’s receipt is not found', async () => {
    const { b, receiptId } = await received();
    const capital = await accountId(b.merchantId, '3000');
    const reader = await staff(b, ['merchant.wallet.read']);
    expect((await classify(reader.session, receiptId, capital)).outcome).toBe('forbidden');
    const other = await business();
    expect(
      (await classify(other.session, receiptId, await accountId(other.merchantId, '3000'))).outcome,
    ).toBe('not_found');
    const classifier = await staff(b, ['merchant.wallet.classify']);
    expect((await classify(classifier.session, receiptId, capital)).outcome).toBe('ok');
  });

  it('the business reads its wallet and its receipts, with merchant.wallet.read only', async () => {
    const { b, accountNumber } = await received();
    expect(await call(`SELECT * FROM payments.merchant_wallet($1)`, [b.session])).toMatchObject({
      status: 'active',
      account_number: accountNumber,
      balance_minor: '80000',
      to_classify_minor: '80000',
    });
    const page = await app.query(`SELECT * FROM payments.list_receipts($1, false, 10)`, [b.session]);
    expect(page.rows.map((r) => r.amount_minor)).toEqual(['80000']);
    expect(
      (await app.query(`SELECT * FROM payments.list_receipts($1, true, 10)`, [b.session])).rowCount,
    ).toBe(0);
    const none = await staff(b, []);
    expect((await app.query(`SELECT * FROM payments.merchant_wallet($1)`, [none.session])).rowCount).toBe(0);
    expect(
      (await app.query(`SELECT * FROM payments.list_receipts($1, NULL, 10)`, [none.session])).rowCount,
    ).toBe(0);
    const other = await business();
    expect(
      (await app.query(`SELECT * FROM payments.list_receipts($1, NULL, 10)`, [other.session])).rowCount,
    ).toBe(0);
  });
});

describe('unmatched money (Q4): never credited automatically', () => {
  const resolve = (
    s: string,
    id: string,
    resolution: string,
    wallet: string | null,
    note: string | null = 'Traced',
  ) =>
    call(`SELECT * FROM payments.resolve_unmatched($1, $2, $3, $4, $5)`, [s, id, resolution, wallet, note]);
  async function unmatched(amount = 25_000) {
    const id = txId();
    expect(await confirm(await storeEvent(), { id, account: digits(10), amount })).toBe('unmatched');
    return (await one(`SELECT id FROM payments.provider_transactions WHERE provider_tx_id = $1`, [id]))
      .id as string;
  }

  it('is listed for the platform team, and credited to a business only when a person says so', async () => {
    const admin = await platformMember('super_admin');
    const tx = await unmatched();
    const { rows } = await app.query(`SELECT * FROM payments.platform_list_unmatched($1, 100)`, [
      admin.session,
    ]);
    expect(rows.map((r) => r.id)).toContain(tx);
    const { b, walletId } = await withWallet();
    expect(await resolve(admin.session, tx, 'credited', walletId)).toMatchObject({
      outcome: 'ok',
      matched: 'resolved',
      resolution: 'credited',
      merchant_id: b.merchantId,
    });
    expect(await balance(b.merchantId, '1100')).toBe(25_000);
    expect(
      (await one(`SELECT count(*)::int AS n FROM payments.receipts WHERE merchant_id = $1`, [b.merchantId]))
        .n,
    ).toBe(1);
    expect((await resolve(admin.session, tx, 'credited', walletId)).outcome).toBe('invalid_status');
    expect(await balance(b.merchantId, '1100')).toBe(25_000);
  });

  it('returned or dismissed with a note; a credit needs an active business wallet; one already posted cannot be credited again', async () => {
    const admin = await platformMember('super_admin');
    const tx = await unmatched();
    expect((await resolve(admin.session, tx, 'returned', null, null)).outcome).toBe('invalid');
    expect((await resolve(admin.session, tx, 'credited', null)).outcome).toBe('invalid_wallet');
    expect((await resolve(admin.session, tx, 'returned', null)).resolution).toBe('returned');
    const { b, walletId, accountNumber } = await withWallet();
    const credited = { id: txId(), account: accountNumber, amount: 5_000 };
    await confirm(await storeEvent(), credited);
    await confirm(await storeEvent(), { ...credited, status: 'reversed' });
    const review = (
      await one(`SELECT id FROM payments.provider_transactions WHERE provider_tx_id = $1`, [credited.id])
    ).id;
    expect((await resolve(admin.session, review, 'credited', walletId)).outcome).toBe('invalid_status');
    expect((await resolve(admin.session, review, 'dismissed', null, 'The bank says it stands')).outcome).toBe(
      'ok',
    );
    expect(await balance(b.merchantId, '1100')).toBe(5_000);
  });

  it('a platform read is recorded before its rows; it needs its grant, and resolving needs its own', async () => {
    const none = await platformMember('support');
    expect(
      (await call(`SELECT * FROM payments.platform_list_unmatched($1, 10)`, [none.session])).outcome,
    ).toBe('forbidden');
    const reader = await platformMember('support', ['platform.payments.read']);
    const rid = `rq-${randomBytes(6).toString('hex')}`;
    await app.query(
      `SELECT * FROM payments.platform_list_wallets($1, 10, NULL, NULL, '203.0.113.9', 't', $2)`,
      [reader.session, rid],
    );
    expect(
      (await owner.query(`SELECT action, merchant_id FROM audit.audit_events WHERE request_id = $1`, [rid]))
        .rows,
    ).toEqual([{ action: 'platform.wallets_read', merchant_id: null }]);
    const tx = await unmatched();
    expect((await resolve(reader.session, tx, 'dismissed', null)).outcome).toBe('forbidden');
    const merchant = await business();
    expect(
      (await call(`SELECT * FROM payments.platform_list_wallets($1, 10)`, [merchant.session])).outcome,
    ).toBe('forbidden');
  });
});

describe('customer wallets (Q7, OPEN-12): money is held, off the books', () => {
  it('nothing is posted for money arriving in a customer’s wallet', async () => {
    const b = await business();
    const c = await newCustomer(b);
    await one(`SELECT payments.request_customer_wallets($1)`, [PROVIDER]);
    const w = await one(`SELECT id FROM payments.live_wallets WHERE customer_id = $1`, [c]);
    const account = digits(10);
    await work(`SELECT payments.record_wallet_created($1, $2, 'ref', $3, 'Ada', 'Test Bank')`, [
      w.id,
      await lease('live_wallets', w.id),
      account,
    ]);
    const before = await entriesOf(b.merchantId);
    expect(await confirm(await storeEvent(), { id: txId(), account, amount: 9_000 })).toBe('held');
    expect(await entriesOf(b.merchantId)).toBe(before);
  });
});

describe('payment orders (TA-8): a timeout is not a failure', () => {
  async function order(amount = 30_000) {
    const w = await withWallet();
    await confirm(await storeEvent(), { id: txId(), account: w.accountNumber, amount: 100_000 });
    const ledgerId = (await one(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [w.b.merchantId])).id;
    const reference = `AKO-${randomBytes(8).toString('hex')}`;
    const id = (
      await one(
        `SELECT payments.create_order($1, NULL, '{"accountNumber":"0123456789","bankCode":"058"}', $2, $3, 'test', $4, 'subscription.paid', '{}') AS id`,
        [w.walletId, amount, reference, ledgerId],
      )
    ).id as string;
    return { ...w, id, reference };
  }
  const claim = async (id: string) =>
    (await worker.query(`SELECT * FROM payments.claim_orders(1000, 300)`)).rows.filter((r) => r.id === id);
  const due = (id: string) =>
    owner.query(
      `UPDATE payments.payment_orders SET lease_until = NULL, next_check_at = now() WHERE id = $1`,
      [id],
    );
  const stateOf = async (id: string) =>
    (await one(`SELECT state FROM payments.payment_orders WHERE id = $1`, [id])).state as string;
  const record = async (id: string, state: string, tx: string | null = null) =>
    (
      await work(`SELECT payments.record_order($1, $2, $3, 'prov-ref', $4, NULL) AS o`, [
        id,
        await lease('payment_orders', id),
        state,
        tx,
      ])
    ).o as string;

  it('is claimed to send exactly once: a worker that dies after sending leaves it to be looked up, never sent again', async () => {
    const { id } = await order();
    const [first] = await claim(id);
    expect(first.prior_state).toBe('created');
    // The worker died here, sent or not. Claimed again, the order is 'unknown': a lookup, not a send.
    expect(await stateOf(id)).toBe('unknown');
    await due(id);
    expect((await claim(id))[0].prior_state).toBe('unknown');
    await due(id);
    expect((await claim(id))[0].prior_state).toBe('unknown');
  });

  it('a timeout stays unknown; the lookup settles it; success posts once, failure posts nothing', async () => {
    const { id, b } = await order();
    await claim(id);
    expect(await record(id, 'unknown')).toBe('ok');
    expect(await stateOf(id)).toBe('unknown');
    expect(await balance(b.merchantId, '1100')).toBe(100_000);
    expect(await record(id, 'succeeded', 'tx-1')).toBe('ok');
    expect(await stateOf(id)).toBe('succeeded');
    expect(await balance(b.merchantId, '1100')).toBe(70_000);
    expect(await balance(b.merchantId, '5100')).toBe(30_000);
    expect(await record(id, 'succeeded', 'tx-1')).toBe('invalid_transition');
    expect(await balance(b.merchantId, '1100')).toBe(70_000);
    const failing = await order();
    await claim(failing.id);
    expect(await record(failing.id, 'nonsense')).toBe('invalid_transition');
    expect(await record(failing.id, 'failed')).toBe('ok');
    expect(await balance(failing.b.merchantId, '1100')).toBe(100_000);
    expect(await record(failing.id, 'succeeded')).toBe('invalid_transition');
  });

  it('an order not yet claimed cannot be recorded; the app cannot create one (Q2)', async () => {
    const { id } = await order();
    expect(await record(id, 'succeeded')).toBe('invalid_transition');
    await expectSqlState(
      app.query(`SELECT payments.create_order(NULL, NULL, NULL, 1, 'AKO-00000000', 'test', NULL, 'x', '{}')`),
      SQLSTATE.insufficientPrivilege,
    );
  });
});

describe('the reconciler’s findings (Q5; the exit’s drift)', () => {
  const find = async (wallet: string, provider: number, books: number) =>
    (await work(`SELECT payments.record_finding('wallet', $1, $2, $3) AS o`, [wallet, provider, books]))
      .o as string;

  it('the books’ balance is what the reconciler compares; a difference is found, kept and changes no money', async () => {
    const { b, walletId, accountNumber } = await withWallet();
    await confirm(await storeEvent(), { id: txId(), account: accountNumber, amount: 60_000 });
    const row = (await worker.query(`SELECT * FROM payments.reconcile_wallets()`)).rows.find(
      (r) => r.wallet_id === walletId,
    );
    expect(row).toMatchObject({
      account_number: accountNumber,
      books_minor: '60000',
      owner_kind: 'merchant',
    });
    expect(await find(walletId, 60_000, 60_000)).toBe('match');
    const entries = await entriesOf(b.merchantId);
    expect(await find(walletId, 75_000, 60_000)).toBe('recorded');
    expect(await find(walletId, 80_000, 60_000)).toBe('seen_again');
    expect(await entriesOf(b.merchantId)).toBe(entries);
    expect(await balance(b.merchantId, '1100')).toBe(60_000);
    const open = await owner.query(
      `SELECT provider_balance_minor::text AS p FROM payments.reconciliation_findings WHERE wallet_id = $1`,
      [walletId],
    );
    expect(open.rows).toEqual([{ p: '80000' }]);
  });

  it('Q5: the platform team sees it, the business is not told; a person resolves it, with a note', async () => {
    const { b, walletId } = await withWallet();
    await find(walletId, 1, 0);
    const admin = await platformMember('super_admin');
    const listed = (
      await app.query(`SELECT * FROM payments.platform_list_findings($1, 100)`, [admin.session])
    ).rows.find((r) => r.wallet_id === walletId);
    expect(listed).toMatchObject({
      merchant_id: b.merchantId,
      provider_minor: '1',
      books_minor: '0',
      status: 'open',
    });
    expect(
      (
        await owner.query(
          `SELECT 1 FROM audit.audit_events WHERE merchant_id = $1 AND action LIKE 'payments.finding%'`,
          [b.merchantId],
        )
      ).rowCount,
    ).toBe(0);
    const resolve = (note: string | null) =>
      call(`SELECT * FROM payments.resolve_finding($1, $2, $3)`, [admin.session, listed.id, note]);
    expect((await resolve('  ')).outcome).toBe('invalid');
    expect(await resolve('A deposit was still on its way')).toMatchObject({
      outcome: 'ok',
      status: 'resolved',
    });
    expect((await resolve('Again')).outcome).toBe('invalid_status');
    // Seen again after it was resolved, it is a new finding.
    expect(await find(walletId, 1, 0)).toBe('recorded');
  });
});

describe('the Platform Live wallet (Q6, BR-4.3)', () => {
  it('only the super admin requests it, once; money arriving is posted to the platform’s books', async () => {
    const granted = await platformMember('support', ['platform.payments.read', 'platform.payments.resolve']);
    expect(
      (await call(`SELECT * FROM payments.request_platform_wallet($1, $2)`, [granted.session, PROVIDER]))
        .outcome,
    ).toBe('forbidden');
    const admin = await platformMember('super_admin');
    const first = await call(`SELECT * FROM payments.request_platform_wallet($1, $2)`, [
      admin.session,
      PROVIDER,
    ]);
    expect(first.outcome).toBe('ok');
    expect(
      await call(`SELECT * FROM payments.request_platform_wallet($1, $2)`, [admin.session, PROVIDER]),
    ).toMatchObject({ outcome: 'exists', id: first.id });
    const account = digits(10);
    const books = async () =>
      Number(
        (
          await one(
            `SELECT p.balance_minor::text AS b FROM ledger.ledgers l
               JOIN ledger.accounts a ON a.ledger_id = l.id AND a.code = '1100'
               JOIN ledger.balance_projection p ON p.account_id = a.id
              WHERE l.owner_kind = 'platform'`,
          )
        ).b,
      );
    const before = await books();
    await work(
      `SELECT payments.record_wallet_created($1, $2, 'platform-ref', $3, 'AlphaKolect', 'Test Bank')`,
      [first.id, await lease('live_wallets', first.id), account],
    );
    expect(await confirm(await storeEvent(), { id: txId(), account, amount: 12_000 })).toBe('credited');
    const row = (await worker.query(`SELECT * FROM payments.reconcile_wallets()`)).rows.find(
      (r) => r.wallet_id === first.id,
    );
    expect(row).toMatchObject({ owner_kind: 'platform' });
    expect(await books()).toBe(before + 12_000);
  });
});

describe('the books and the activity record', () => {
  it('every projection equals its lines; events carry identifiers and amounts only (TA-14)', async () => {
    const { b, accountNumber } = await withWallet();
    await confirm(await storeEvent(), { id: txId(), account: accountNumber, amount: 11_000 });
    expect((await owner.query(`SELECT * FROM ledger.verify_projections()`)).rows).toEqual([]);
    const { rows } = await owner.query(
      `SELECT action, summary::text AS summary FROM audit.audit_events
        WHERE merchant_id = $1 AND action LIKE 'payments.%' ORDER BY occurred_at, id`,
      [b.merchantId],
    );
    expect(rows.map((r) => r.action)).toEqual(['payments.wallet_provisioned', 'payments.money_received']);
    for (const r of rows) expect(r.summary).not.toContain(accountNumber);
  });
});

describe('P9-R1: the API cannot act as the worker, nor the worker as the API', () => {
  const U = '00000000-0000-7000-8000-000000000000';
  const WORKER_CALLS: [string, unknown[]][] = [
    [`SELECT payments.request_wallets($1)`, [PROVIDER]],
    [`SELECT payments.request_customer_wallets($1)`, [PROVIDER]],
    [`SELECT * FROM payments.claim_wallets(1, 1)`, []],
    [`SELECT payments.record_wallet_created($1, $1, 'r', '1', 'n', 'b')`, [U]],
    [`SELECT payments.record_wallet_failed($1, $1, 'e', 1)`, [U]],
    [`SELECT * FROM payments.claim_events(1, 1)`, []],
    [`SELECT payments.record_event($1, $1, true, 'tx', '1', 100, 'NGN', 'successful', now(), 5)`, [U]],
    [`SELECT * FROM payments.claim_orders(1, 1)`, []],
    [`SELECT payments.record_order($1, $1, 'succeeded', 'r', 't', NULL)`, [U]],
    [`SELECT * FROM payments.reconcile_wallets()`, []],
    [`SELECT payments.record_finding('wallet', $1, 1, 0)`, [U]],
  ];

  it('the web role is refused every function that says what a provider confirmed: it cannot fabricate a credit', async () => {
    const { b, accountNumber } = await withWallet();
    for (const [sql, params] of WORKER_CALLS)
      await expectSqlState(app.query(sql, params), SQLSTATE.insufficientPrivilege);
    const event = await storeEvent(); // what it may do: store what it received
    await expectSqlState(
      app.query(`SELECT payments.record_event($1, $1, true, 'tx', $2, 100, 'NGN', 'successful', now(), 5)`, [
        event,
        accountNumber,
      ]),
      SQLSTATE.insufficientPrivilege,
    );
    expect(await balance(b.merchantId, '1100')).toBe(0);
  });

  it('the worker has its functions and nothing else: no session functions, no tables, no other role', async () => {
    await expectSqlState(
      worker.query(`SELECT * FROM payments.merchant_wallet($1)`, [U]),
      SQLSTATE.insufficientPrivilege,
    );
    await expectSqlState(
      worker.query(`SELECT payments.store_event('fake', '{}', '{}', NULL)`),
      SQLSTATE.insufficientPrivilege,
    );
    await expectSqlState(
      worker.query(
        `SELECT * FROM identity.create_session($1, 'merchant', $1, 'full', 'x', 1, 1, NULL, NULL)`,
        [U],
      ),
      SQLSTATE.insufficientPrivilege,
    );
    for (const table of ['payments.live_wallets', 'payments.provider_transactions', 'ledger.journal_entries'])
      await expectSqlState(worker.query(`SELECT 1 FROM ${table}`), SQLSTATE.insufficientPrivilege);
    await expectSqlState(worker.query(`SET ROLE alphakolect_app`), SQLSTATE.insufficientPrivilege);
    expect(
      await one(
        `SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
                (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid OR m.roleid = r.oid) AS memberships
           FROM pg_roles r WHERE r.rolname = 'alphakolect_worker'`,
      ),
    ).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
      memberships: 0,
    });
    const { rows } = await owner.query(
      `SELECT c.oid::regclass::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND c.relkind IN ('r', 'p', 'v')
          AND has_table_privilege('alphakolect_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE')`,
    );
    expect(rows).toEqual([]);
  });
});

describe('P9-R3: an answer from an expired lease changes nothing', () => {
  const claimedOf = async (table: string, fn: string, id: string) => {
    await owner.query(`UPDATE payments.${table} SET lease_until = NULL WHERE id = $1`, [id]);
    return (await worker.query(`SELECT * FROM payments.${fn}(1000, 300)`)).rows.find((r) => r.id === id)!;
  };

  it('a wallet: the later claim’s worker decides; the earlier one’s answer, or no token, is stale', async () => {
    const b = await business();
    await work(`SELECT payments.request_wallets($1)`, [PROVIDER]);
    const w = await walletOf(b.merchantId);
    const old = await claimedOf('live_wallets', 'claim_wallets', w.id);
    const fresh = await claimedOf('live_wallets', 'claim_wallets', w.id);
    expect(fresh.lease_token).not.toBe(old.lease_token);
    const created = (token: string | null) =>
      work(`SELECT payments.record_wallet_created($1, $2, 'r', $3, 'n', 'b') AS o`, [
        w.id,
        token,
        digits(10),
      ]);
    expect((await created(old.lease_token)).o).toBe('stale');
    expect((await created(null)).o).toBe('stale');
    expect(
      (await work(`SELECT payments.record_wallet_failed($1, $2, 'e', 5) AS o`, [w.id, old.lease_token])).o,
    ).toBe('stale');
    expect((await walletOf(b.merchantId)).status).toBe('provisioning');
    expect((await created(fresh.lease_token)).o).toBe('ok');
  });

  it('an event: a stale confirmation credits nothing', async () => {
    const { b, accountNumber } = await withWallet();
    const id = await storeEvent();
    const old = await claimedOf('provider_events', 'claim_events', id);
    const fresh = await claimedOf('provider_events', 'claim_events', id);
    const record = (token: string, tx: string) =>
      work(`SELECT payments.record_event($1, $2, true, $3, $4, 100, 'NGN', 'successful', now(), 5) AS o`, [
        id,
        token,
        tx,
        accountNumber,
      ]);
    expect((await record(old.lease_token, txId())).o).toBe('stale');
    expect(await balance(b.merchantId, '1100')).toBe(0);
    expect((await record(fresh.lease_token, txId())).o).toBe('credited');
    expect(await balance(b.merchantId, '1100')).toBe(100);
  });

  it('an order: a stale success posts nothing', async () => {
    const w = await withWallet();
    await confirm(await storeEvent(), { id: txId(), account: w.accountNumber, amount: 100_000 });
    const ledgerId = (await one(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [w.b.merchantId])).id;
    const id = (
      await one(
        `SELECT payments.create_order($1, NULL, '{"accountNumber":"0123456789","bankCode":"058"}', 30000, $2, 'test', $3, 'subscription.paid', '{}') AS id`,
        [w.walletId, `AKO-${randomBytes(8).toString('hex')}`, ledgerId],
      )
    ).id as string;
    await owner.query(`UPDATE payments.payment_orders SET next_check_at = now() WHERE id = $1`, [id]);
    const old = await claimedOf('payment_orders', 'claim_orders', id);
    await owner.query(`UPDATE payments.payment_orders SET next_check_at = now() WHERE id = $1`, [id]);
    const fresh = await claimedOf('payment_orders', 'claim_orders', id);
    const record = (token: string) =>
      work(`SELECT payments.record_order($1, $2, 'succeeded', 'r', 't', NULL) AS o`, [id, token]);
    expect((await record(old.lease_token)).o).toBe('stale');
    expect(await balance(w.b.merchantId, '1100')).toBe(100_000);
    expect((await record(fresh.lease_token)).o).toBe('ok');
    expect(await balance(w.b.merchantId, '1100')).toBe(70_000);
  });
});

describe('an event with no usable answer (P9-R4): one open finding for the platform team', () => {
  it('is recorded once however often it is seen, and names no wallet', async () => {
    const find = async () =>
      (await work(`SELECT payments.record_finding('event', NULL, 1, 0) AS o`)).o as string;
    const first = await find();
    expect(['recorded', 'seen_again']).toContain(first);
    expect(await find()).toBe('seen_again');
    expect(
      (
        await one(
          `SELECT count(*)::int AS n FROM payments.reconciliation_findings WHERE scope = 'event' AND status = 'open'`,
        )
      ).n,
    ).toBe(1);
    await expectSqlState(
      work(`SELECT payments.record_finding('event', gen_random_uuid(), 1, 0)`),
      SQLSTATE.checkViolation,
    );
  });
});
