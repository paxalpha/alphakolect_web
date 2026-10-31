import { randomBytes } from 'node:crypto';
import pino from 'pino';
import request from 'supertest';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { FakeProvider } from '../../src/integrations/payments/fake-provider.js';
import { ProviderError } from '../../src/integrations/payments/provider.js';
import { TransactPayProvider } from '../../src/integrations/payments/transactpay-provider.js';
import { PaymentsWorker } from '../../src/modules/payments/worker-tasks.js';
import { createDb } from '../../src/platform/db.js';
import { ngn } from '../../src/platform/money.js';
import { createTestApp, TEST_WEB_APP_URL } from '../support/app.js';
import { uniquePhone } from '../support/customers.js';
import { tenancyFixtures } from '../support/tenancy.js';

// The payments worker against the real database, through the webhook the app exposes (P9 §3, §5; TA-8, TA-11): wallets
// only after a business confirms its email (BR-2.3), a forged or replayed event credits nothing more (the exit), an
// order in doubt is never sent twice, and the reconciler finds a difference (the exit). It connects as its own role,
// alphakolect_worker, and the app's connection is refused its functions (P9-R1). Other test files share this
// database, so each test moves its own rows to the front of the queue and targets its failures by alias or reference.

const { app, db: webDb, auth, email } = await createTestApp();
const db = createDb(inject('workerDatabaseUrl'));
afterAll(() => db.close());
const { owner, business, token, call } = tenancyFixtures(app, auth);
const fake = new FakeProvider();
const worker = new PaymentsWorker({
  db,
  provider: fake,
  logger: pino({ level: 'silent' }),
});

const one = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0];
const walletOf = (merchantId: string) =>
  one(`SELECT * FROM payments.live_wallets WHERE owner_kind = 'merchant' AND merchant_id = $1`, [merchantId]);
/** Requests this business's wallet and puts it first in the queue. */
const queued = async (merchantId: string) => {
  await owner.query(`SELECT payments.request_wallets('fake')`);
  await owner.query(
    `UPDATE payments.live_wallets SET next_attempt_at = '2000-01-01', lease_until = NULL
      WHERE owner_kind = 'merchant' AND merchant_id = $1`,
    [merchantId],
  );
};
async function activeWallet() {
  const b = await business();
  await queued(b.merchantId);
  await worker.provisionWallets();
  const w = await walletOf(b.merchantId);
  expect(w.status).toBe('active');
  return { b, wallet: w, va: { kind: 'va', providerRef: w.provider_ref as string } as const };
}
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
const notify = (body: object) => request(app).post('/v1/webhooks/transactpay').send(body);
const eventOf = (reference: string) =>
  one(
    `SELECT id, status, outcome FROM payments.provider_events WHERE reference = $1 ORDER BY id DESC LIMIT 1`,
    [reference],
  );
const receiptsOf = async (merchantId: string) =>
  (await one(`SELECT count(*)::int AS n FROM payments.receipts WHERE merchant_id = $1`, [merchantId]))
    .n as number;

/** A second worker against the same provider: what two processes in production are. */
const otherWorker = new PaymentsWorker({ db, provider: fake, logger: pino({ level: 'silent' }) });
const internalTxOf = async (providerTxId: string) =>
  (await one(`SELECT id FROM payments.provider_transactions WHERE provider_tx_id = $1`, [providerTxId]))
    ?.id as string | undefined;
/** The journal lines posted for a provider transaction, through the source its entry names. */
const postingsOf = async (internalId: string) =>
  (
    await owner.query(
      `SELECT e.id AS entry_id, e.merchant_id, a.code, a.merchant_id AS account_merchant, l.side,
              l.amount_minor::text AS amount
         FROM ledger.journal_entries e
         JOIN ledger.journal_lines l ON l.entry_id = e.id
         JOIN ledger.accounts a ON a.id = l.account_id
        WHERE e.source_type = 'provider_transaction' AND e.source_id = $1
        ORDER BY l.side DESC`,
      [internalId],
    )
  ).rows;
const entriesOf = async (merchantId: string) =>
  (await one(`SELECT count(*)::int AS n FROM ledger.journal_entries WHERE merchant_id = $1`, [merchantId]))
    .n as number;

describe('wallets (BR-2.3)', () => {
  it('a business gets a wallet at the provider once its email is confirmed, and an unconfirmed one gets nothing', async () => {
    const { rows: before } = await owner.query(`SELECT count(*)::int AS n FROM tenancy.merchants`);
    expect(before[0].n).toBeGreaterThanOrEqual(0);
    const unconfirmed = (
      await owner.query(
        `INSERT INTO tenancy.merchants (name, status) VALUES ('Unconfirmed', 'pending_verification') RETURNING id`,
      )
    ).rows[0].id as string;
    const { b, wallet } = await activeWallet();
    expect(wallet).toMatchObject({ bank_name: 'Fake Bank', alias: `AKM-${b.merchantId.replace(/-/g, '')}` });
    expect(await walletOf(unconfirmed)).toBeUndefined();
  });

  it('a lost answer never creates a second account: the retry finds it by its alias (TA-8)', async () => {
    const b = await business();
    await queued(b.merchantId);
    const { alias } = await walletOf(b.merchantId);
    fake.failNext('create', 'UNKNOWN_OUTCOME', { afterEffect: true, match: alias });
    await worker.provisionWallets();
    const afterTimeout = await walletOf(b.merchantId);
    expect(afterTimeout.status).toBe('provisioning');
    expect(afterTimeout.last_error).toContain('UNKNOWN_OUTCOME');
    const created = await fake.findVirtualAccountByAlias(alias);
    expect(created).not.toBeNull();
    const accounts = fake.accountCount;
    await queued(b.merchantId);
    await worker.provisionWallets();
    expect(await walletOf(b.merchantId)).toMatchObject({
      status: 'active',
      account_number: created!.accountNumber,
    });
    // Other businesses' wallets may be created in this pass; this one was not created again.
    expect(await fake.findVirtualAccountByAlias(alias)).toEqual(created);
    expect(fake.accountCount).toBeGreaterThanOrEqual(accounts);
  });

  it('P9-R2: an unclear lookup never creates an account, and the wallet is tried again later', async () => {
    const b = await business();
    await queued(b.merchantId);
    const { alias } = await walletOf(b.merchantId);
    fake.failNext('find', 'UNKNOWN_OUTCOME', { match: alias });
    const create = vi.spyOn(fake, 'createVirtualAccount');
    await worker.provisionWallets();
    expect(create.mock.calls.filter(([, key]) => key === alias)).toEqual([]);
    create.mockRestore();
    expect(await walletOf(b.merchantId)).toMatchObject({ status: 'provisioning', account_number: null });
    expect((await walletOf(b.merchantId)).last_error).toContain('UNKNOWN_OUTCOME');
    expect(await fake.findVirtualAccountByAlias(alias)).toBeNull();
  });

  it('P9-R2: TransactPay’s answers, through the worker: only a stated no creates', async () => {
    const answer = async (response: () => Response) => {
      const b = await business();
      await queued(b.merchantId);
      const { alias } = await walletOf(b.merchantId);
      const lookups = new TransactPayProvider({
        baseUrl: 'https://tp.test',
        publicKey: 'p',
        secretKey: 's',
        encryptionKey: 'e',
        fetch: (async () => response()) as typeof fetch,
      });
      const other = new FakeProvider();
      const created: string[] = [];
      const provider = Object.assign(other, {
        // Only this business's wallet is answered by the stub; the others in the queue are refused without a lookup.
        findVirtualAccountByAlias: (a: string) =>
          a === alias
            ? lookups.findVirtualAccountByAlias(a)
            : Promise.reject(new ProviderError('UNKNOWN_OUTCOME', 'Not in this test')),
        createVirtualAccount: async (...args: Parameters<FakeProvider['createVirtualAccount']>) => {
          created.push(args[1]);
          return FakeProvider.prototype.createVirtualAccount.apply(other, args);
        },
      });
      await new PaymentsWorker({ db, provider, logger: pino({ level: 'silent' }) }).provisionWallets();
      return created.includes(alias);
    };
    const json = (body: unknown, status: number) => () => new Response(JSON.stringify(body), { status });
    for (const status of [400, 401, 403, 429, 500])
      expect(await answer(json({ status: false }, status))).toBe(false);
    expect(await answer(() => new Response('<html>', { status: 404 }))).toBe(false);
    expect(await answer(() => new Response('<html>', { status: 200 }))).toBe(false);
    expect(await answer(json({ status: false, message: 'Not found' }, 404))).toBe(true);
  });

  it('P9-R3: a lookup that outlasts the lease cannot create a second account; the later worker’s stands', async () => {
    const b = await business();
    await queued(b.merchantId);
    const { alias } = await walletOf(b.merchantId);
    const create = vi.spyOn(fake, 'createVirtualAccount');
    fake.delayNextLookup(alias, 1_600);
    const slow = new PaymentsWorker({
      db,
      provider: fake,
      logger: pino({ level: 'silent' }),
      leaseSeconds: 1,
    });
    const pass = slow.provisionWallets();
    // The lookup has seen no account, and takes longer than the lease. The lease passes; another worker claims the wallet.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await queued(b.merchantId);
    await worker.provisionWallets();
    const after = await walletOf(b.merchantId);
    expect(after.status).toBe('active');
    await pass;
    expect(create.mock.calls.filter(([, key]) => key === alias)).toHaveLength(1);
    create.mockRestore();
    expect(await walletOf(b.merchantId)).toMatchObject({
      status: 'active',
      account_number: after.account_number,
    });
  });

  it('P9-R3: a lease that a provider’s timeouts could outlast is refused at the start', () => {
    const provider = Object.assign(new FakeProvider(), { requestTimeoutMs: 20_000 });
    const logger = pino({ level: 'silent' });
    expect(() => new PaymentsWorker({ db, provider, logger, leaseSeconds: 30 })).toThrow(/lease/);
    expect(() => new PaymentsWorker({ db, provider, logger })).not.toThrow();
  });

  it('customer wallets are not requested (Q7)', async () => {
    const b = await business();
    const branch = (
      await one(`INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, 'Main') RETURNING id`, [
        b.merchantId,
      ])
    ).id;
    const customer = (
      await one(
        `INSERT INTO customers.customers (merchant_id, branch_id, full_name, phone) VALUES ($1, $2, 'Ada', $3) RETURNING id`,
        [b.merchantId, branch, uniquePhone()],
      )
    ).id;
    await worker.provisionWallets();
    expect(
      await one(`SELECT 1 AS found FROM payments.live_wallets WHERE customer_id = $1`, [customer]),
    ).toBeUndefined();
  });
});

describe('events (TA-8; the exit’s forged and replayed)', () => {
  it('money arriving is credited from the provider’s answer, whatever the notification says', async () => {
    const { b, va, wallet } = await activeWallet();
    const inbound = fake.simulateInboundTransfer(va, ngn(150_000n), 'deposit');
    const res = await notify({ ...inbound, amount: '999999999', accountNumber: 'someone else' });
    expect(res.status).toBe(200);
    expect((await eventOf(inbound.providerTxId)).status).toBe('received');
    await worker.confirmEvents();
    expect(await eventOf(inbound.providerTxId)).toMatchObject({ status: 'done', outcome: 'credited' });
    expect(await balance(b.merchantId, '1100')).toBe(150_000);
    expect(await balance(b.merchantId, '2290')).toBe(150_000);
    expect(
      await one(`SELECT account_number FROM payments.provider_transactions WHERE provider_tx_id = $1`, [
        inbound.providerTxId,
      ]),
    ).toEqual({ account_number: wallet.account_number });
  });

  it('a forged notification, even for a real wallet, credits nothing and ends rejected', async () => {
    const { b, wallet } = await activeWallet();
    const forged = `forged-${randomBytes(6).toString('hex')}`;
    await notify({
      type: 'transfer.inbound',
      providerTxId: forged,
      accountNumber: wallet.account_number,
      amount: 5_000_000,
    });
    await worker.confirmEvents();
    const looked = await eventOf(forged);
    expect(looked.status).toBe('pending');
    await owner.query(
      `UPDATE payments.provider_events SET attempts = 8, next_check_at = now(), lease_until = NULL WHERE id = $1`,
      [looked.id],
    );
    await worker.confirmEvents();
    expect(await eventOf(forged)).toMatchObject({ status: 'rejected', outcome: 'not_confirmed' });
    expect(await balance(b.merchantId, '1100')).toBe(0);
    expect(await receiptsOf(b.merchantId)).toBe(0);
  });

  it('a replayed notification credits once', async () => {
    const { b, va } = await activeWallet();
    const inbound = fake.simulateInboundTransfer(va, ngn(70_000n), 'deposit');
    for (let i = 0; i < 3; i++) await notify(inbound);
    await worker.confirmEvents();
    await notify(inbound);
    await worker.confirmEvents();
    expect(await balance(b.merchantId, '1100')).toBe(70_000);
    expect(await receiptsOf(b.merchantId)).toBe(1);
    expect(await eventOf(inbound.providerTxId)).toMatchObject({ status: 'done', outcome: 'duplicate' });
  });

  it('a provider that cannot answer leaves the event to be looked at again, however often', async () => {
    const { b, va } = await activeWallet();
    const inbound = fake.simulateInboundTransfer(va, ngn(1_000n), 'deposit');
    await notify(inbound);
    const { id } = await eventOf(inbound.providerTxId);
    await owner.query(`UPDATE payments.provider_events SET attempts = 50 WHERE id = $1`, [id]);
    fake.failNext('get', 'UNKNOWN_OUTCOME', { match: inbound.providerTxId });
    await worker.confirmEvents();
    expect((await eventOf(inbound.providerTxId)).status).toBe('pending');
    await owner.query(
      `UPDATE payments.provider_events SET next_check_at = now(), lease_until = NULL WHERE id = $1`,
      [id],
    );
    await worker.confirmEvents();
    expect(await balance(b.merchantId, '1100')).toBe(1_000);
  });

  it('P9-R4: an answer we cannot record credits nothing, is looked at again, and reaches the platform team', async () => {
    const { b, va } = await activeWallet();
    const inbound = fake.simulateInboundTransfer(va, ngn(1_000n), 'deposit');
    await notify(inbound);
    const { id } = await eventOf(inbound.providerTxId);
    await owner.query(`UPDATE payments.provider_events SET attempts = 7 WHERE id = $1`, [id]);
    await owner.query(
      `UPDATE payments.reconciliation_findings SET status = 'resolved', resolved_at = now(), resolution_note = 'Test'
        WHERE scope = 'event' AND status = 'open'`,
    );
    fake.failNext('get', 'INVALID_EVENT', { match: inbound.providerTxId });
    await worker.confirmEvents();
    expect((await eventOf(inbound.providerTxId)).status).toBe('pending');
    expect(await balance(b.merchantId, '1100')).toBe(0);
    expect(
      await one(
        `SELECT scope FROM payments.reconciliation_findings WHERE scope = 'event' AND status = 'open'`,
      ),
    ).toEqual({ scope: 'event' });
    await owner.query(
      `UPDATE payments.provider_events SET next_check_at = now(), lease_until = NULL WHERE id = $1`,
      [id],
    );
    await worker.confirmEvents();
    expect(await balance(b.merchantId, '1100')).toBe(1_000);
  });

  it('P9-R1: through the API’s own connection, a provider’s confirmation cannot be fabricated', async () => {
    const { b, wallet } = await activeWallet();
    await notify({ type: 'transfer.inbound', providerTxId: `web-${randomBytes(6).toString('hex')}` });
    await expect(
      webDb.transaction((tx) =>
        tx.query(
          `SELECT payments.record_event(gen_random_uuid(), gen_random_uuid(), true, 'tx', $1, 100, 'NGN', 'successful', now(), 5)`,
          [wallet.account_number],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      webDb.transaction((tx) => tx.query(`SELECT payments.request_wallets('fake')`)),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await balance(b.merchantId, '1100')).toBe(0);
  });

  it('a reversal the provider reports later goes to a person; nothing is debited', async () => {
    const { b, va } = await activeWallet();
    const inbound = fake.simulateInboundTransfer(va, ngn(4_000n), 'deposit');
    await notify(inbound);
    await worker.confirmEvents();
    fake.setTransactionStatus(inbound.providerTxId, 'reversed');
    await notify(inbound);
    await worker.confirmEvents();
    expect(await eventOf(inbound.providerTxId)).toMatchObject({ status: 'done', outcome: 'review' });
    expect(await balance(b.merchantId, '1100')).toBe(4_000);
  });

  it('TA-11: a credit touches only the business whose wallet it is', async () => {
    const [a, other] = [await activeWallet(), await activeWallet()];
    const inbound = fake.simulateInboundTransfer(a.va, ngn(2_500n), 'deposit');
    await notify(inbound);
    await worker.confirmEvents();
    expect(await balance(a.b.merchantId, '1100')).toBe(2_500);
    expect(await balance(other.b.merchantId, '1100')).toBe(0);
    expect(await receiptsOf(other.b.merchantId)).toBe(0);
  });
});

describe('payment orders (TA-8): never sent twice', () => {
  const BANK = '{"accountNumber":"0123456789","bankCode":"058"}';
  async function funded(amount = 100_000n) {
    const w = await activeWallet();
    const inbound = fake.simulateInboundTransfer(w.va, ngn(amount), 'deposit');
    await notify(inbound);
    await worker.confirmEvents();
    return w;
  }
  async function order(w: Awaited<ReturnType<typeof funded>>, amount = 30_000) {
    const ledger = (await one(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [w.b.merchantId])).id;
    const reference = `AKO-${randomBytes(8).toString('hex')}`;
    const id = (
      await one(
        `SELECT payments.create_order($1, NULL, $2, $3, $4, 'test', $5, 'subscription.paid', '{}') AS id`,
        [w.wallet.id, BANK, amount, reference, ledger],
      )
    ).id as string;
    return { id, reference };
  }
  const stateOf = async (id: string) =>
    (await one(`SELECT state FROM payments.payment_orders WHERE id = $1`, [id])).state as string;
  const due = (id: string) =>
    owner.query(
      `UPDATE payments.payment_orders SET next_check_at = now(), lease_until = NULL WHERE id = $1`,
      [id],
    );

  it('sent once, and posted once on success', async () => {
    const w = await funded();
    const { id } = await order(w);
    const sent = fake.transferCount;
    await worker.settleOrders();
    expect(await stateOf(id)).toBe('succeeded');
    expect(fake.transferCount).toBe(sent + 1);
    expect(await balance(w.b.merchantId, '1100')).toBe(70_000);
    await worker.settleOrders();
    expect(fake.transferCount).toBe(sent + 1);
    expect(await balance(w.b.merchantId, '1100')).toBe(70_000);
  });

  it('an answer lost after the money moved: unknown, settled by the lookup, not sent again', async () => {
    const w = await funded();
    const { id, reference } = await order(w);
    fake.failNext('transfer', 'UNKNOWN_OUTCOME', { afterEffect: true, match: reference });
    const sent = fake.transferCount;
    await worker.settleOrders();
    expect(await stateOf(id)).toBe('unknown');
    expect(fake.transferCount).toBe(sent + 1);
    expect(await balance(w.b.merchantId, '1100')).toBe(100_000);
    await due(id);
    await worker.settleOrders();
    expect(await stateOf(id)).toBe('succeeded');
    expect(fake.transferCount).toBe(sent + 1);
    expect(await balance(w.b.merchantId, '1100')).toBe(70_000);
  });

  it('a worker that died mid-send, or a request that never arrived, stays unknown: never sent by a later pass', async () => {
    const w = await funded();
    const { id } = await order(w);
    // Claimed by a worker that then died: nothing reached the provider.
    await owner.query(`SELECT * FROM payments.claim_orders(100, 300)`);
    const sent = fake.transferCount;
    for (let i = 0; i < 3; i++) {
      await due(id);
      await worker.settleOrders();
    }
    expect(await stateOf(id)).toBe('unknown');
    expect(fake.transferCount).toBe(sent);
    expect(await balance(w.b.merchantId, '1100')).toBe(100_000);
  });

  it('a stated refusal fails it, and nothing is posted', async () => {
    const w = await funded(1_000n);
    const { id } = await order(w, 5_000);
    await worker.settleOrders();
    expect(await stateOf(id)).toBe('failed');
    expect(await balance(w.b.merchantId, '1100')).toBe(1_000);
  });
});

describe('the reconciler (Q5; the exit’s drift)', () => {
  const openFinding = (walletId: string) =>
    one(
      `SELECT provider_balance_minor::text AS provider, books_balance_minor::text AS books
         FROM payments.reconciliation_findings WHERE wallet_id = $1 AND status = 'open'`,
      [walletId],
    );

  it('finds a difference between a wallet’s books and the provider, and changes nothing', async () => {
    const w = await activeWallet();
    const inbound = fake.simulateInboundTransfer(w.va, ngn(60_000n), 'deposit');
    await notify(inbound);
    await worker.confirmEvents();
    await worker.reconcile();
    expect(await openFinding(w.wallet.id)).toBeUndefined();
    fake.adjustBalance(w.va, 5_000n);
    await worker.reconcile();
    expect(await openFinding(w.wallet.id)).toEqual({ provider: '65000', books: '60000' });
    expect(await balance(w.b.merchantId, '1100')).toBe(60_000);
    await worker.reconcile();
    expect(
      (
        await one(`SELECT count(*)::int AS n FROM payments.reconciliation_findings WHERE wallet_id = $1`, [
          w.wallet.id,
        ])
      ).n,
    ).toBe(1);
  });

  it('a missed notification shows up as a difference', async () => {
    const w = await activeWallet();
    fake.simulateInboundTransfer(w.va, ngn(8_000n), 'deposit');
    await worker.reconcile();
    expect(await openFinding(w.wallet.id)).toEqual({ provider: '8000', books: '0' });
  });

  it('a provider with one pooled balance is compared in total (B4)', async () => {
    const pooled = new FakeProvider(undefined, { perAccountBalance: false });
    const pooledWorker = new PaymentsWorker({
      db,
      provider: pooled,
      logger: pino({ level: 'silent' }),
    });
    await pooledWorker.reconcile();
    const found = await one(
      `SELECT provider_balance_minor::text AS provider, books_balance_minor::text AS books
         FROM payments.reconciliation_findings WHERE scope = 'pooled' AND status = 'open'`,
    );
    // Every wallet in this shared database is in the books' total; this provider holds nothing.
    expect(found.provider).toBe('0');
    expect(BigInt(found.books)).toBeGreaterThan(0n);
    await owner.query(
      `UPDATE payments.reconciliation_findings SET status = 'resolved', resolved_at = now(), resolution_note = 'Test'
        WHERE scope = 'pooled' AND status = 'open'`,
    );
  });

  it('no answer from the provider is not a difference', async () => {
    const w = await activeWallet();
    const quiet = new PaymentsWorker({
      db,
      provider: Object.assign(new FakeProvider(), {
        getBalance: () => Promise.reject(new Error('down')),
      }),
      logger: pino({ level: 'silent' }),
    });
    await quiet.reconcile();
    expect(await openFinding(w.wallet.id)).toBeUndefined();
  });
});

describe('two workers at once (P9 money-flow matrix)', () => {
  it('A3: one wallet, two workers: one account at the provider', async () => {
    const b = await business();
    await queued(b.merchantId);
    const { alias } = await walletOf(b.merchantId);
    const create = vi.spyOn(fake, 'createVirtualAccount');
    fake.delayNextLookup(alias, 100);
    await Promise.all([worker.provisionWallets(), otherWorker.provisionWallets()]);
    expect(create.mock.calls.filter(([, key]) => key === alias)).toHaveLength(1);
    create.mockRestore();
    expect((await walletOf(b.merchantId)).status).toBe('active');
  });

  it('D6: one order, two workers: sent once, posted once', async () => {
    const w = await activeWallet();
    await notify(fake.simulateInboundTransfer(w.va, ngn(100_000n), 'deposit'));
    await worker.confirmEvents();
    const ledger = (await one(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [w.b.merchantId])).id;
    const reference = `AKO-${randomBytes(8).toString('hex')}`;
    await one(
      `SELECT payments.create_order($1, NULL, '{"accountNumber":"0123456789","bankCode":"058"}', 30000, $2, 'test', $3, 'subscription.paid', '{}')`,
      [w.wallet.id, reference, ledger],
    );
    const sent = fake.transferCount;
    await Promise.all([worker.settleOrders(), otherWorker.settleOrders()]);
    expect(fake.transferCount).toBe(sent + 1);
    expect(await balance(w.b.merchantId, '1100')).toBe(70_000);
  });
});

describe('payment orders, each state the provider can leave them in (P9 money-flow matrix)', () => {
  const BANK = '{"accountNumber":"0123456789","bankCode":"058"}';
  /** A funded wallet with an order whose answer was lost after the money moved: 'unknown'. */
  async function inDoubt() {
    const w = await activeWallet();
    await notify(fake.simulateInboundTransfer(w.va, ngn(100_000n), 'deposit'));
    await worker.confirmEvents();
    const ledger = (await one(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [w.b.merchantId])).id;
    const reference = `AKO-${randomBytes(8).toString('hex')}`;
    const id = (
      await one(
        `SELECT payments.create_order($1, NULL, $2, 30000, $3, 'test', $4, 'subscription.paid', '{}') AS id`,
        [w.wallet.id, BANK, reference, ledger],
      )
    ).id as string;
    fake.failNext('transfer', 'UNKNOWN_OUTCOME', { afterEffect: true, match: reference });
    await worker.settleOrders();
    const stateOf = async () =>
      (await one(`SELECT state FROM payments.payment_orders WHERE id = $1`, [id])).state as string;
    const again = () =>
      owner.query(
        `UPDATE payments.payment_orders SET next_check_at = now(), lease_until = NULL WHERE id = $1`,
        [id],
      );
    expect(await stateOf()).toBe('unknown');
    const tx = (await fake.findTransferByReference(reference))!.providerTxId;
    return { ...w, id, reference, tx, stateOf, again };
  }

  it('D3: an unclear lookup proves nothing: it stays unknown, nothing posts, nothing is sent', async () => {
    const o = await inDoubt();
    const down = new PaymentsWorker({
      db,
      provider: Object.assign(new FakeProvider(), {
        findTransferByReference: () => Promise.reject(new ProviderError('UNKNOWN_OUTCOME', 'HTTP 429')),
      }),
      logger: pino({ level: 'silent' }),
    });
    const sent = fake.transferCount;
    await o.again();
    await down.settleOrders();
    expect(await o.stateOf()).toBe('unknown');
    expect(fake.transferCount).toBe(sent);
    expect(await balance(o.b.merchantId, '1100')).toBe(100_000);
  });

  it('D4: still pending at the provider, then successful: posted only then, and once', async () => {
    const o = await inDoubt();
    fake.setTransactionStatus(o.tx, 'pending');
    await o.again();
    await worker.settleOrders();
    expect(await o.stateOf()).toBe('submitted');
    expect(await balance(o.b.merchantId, '1100')).toBe(100_000);
    fake.setTransactionStatus(o.tx, 'successful');
    await o.again();
    await worker.settleOrders();
    expect(await o.stateOf()).toBe('succeeded');
    expect(await balance(o.b.merchantId, '1100')).toBe(70_000);
    // The same answer again finds a finished order: nothing is claimed, nothing more posts.
    await o.again();
    await worker.settleOrders();
    expect(await balance(o.b.merchantId, '1100')).toBe(70_000);
  });

  it('D5: a confirmed failure fails it, and nothing posts', async () => {
    const o = await inDoubt();
    fake.setTransactionStatus(o.tx, 'failed');
    await o.again();
    await worker.settleOrders();
    expect(await o.stateOf()).toBe('failed');
    expect(await balance(o.b.merchantId, '1100')).toBe(100_000);
  });
});

describe('deposits the provider has not finished, or that are not ours (P9 money-flow matrix)', () => {
  it('B5, B6: pending credits nothing and is looked at again; failed credits nothing', async () => {
    const { b, va } = await activeWallet();
    const inbound = fake.simulateInboundTransfer(va, ngn(5_000n), 'deposit');
    fake.setTransactionStatus(inbound.providerTxId, 'pending');
    await notify(inbound);
    await worker.confirmEvents();
    const { id } = await eventOf(inbound.providerTxId);
    expect((await eventOf(inbound.providerTxId)).status).toBe('pending');
    expect(await entriesOf(b.merchantId)).toBe(0);
    fake.setTransactionStatus(inbound.providerTxId, 'failed');
    await owner.query(
      `UPDATE payments.provider_events SET next_check_at = now(), lease_until = NULL WHERE id = $1`,
      [id],
    );
    await worker.confirmEvents();
    expect(await eventOf(inbound.providerTxId)).toMatchObject({ status: 'done', outcome: 'ignored' });
    expect(await entriesOf(b.merchantId)).toBe(0);
    expect(await receiptsOf(b.merchantId)).toBe(0);
  });

  it('B8: money for an account that is no wallet of ours is unmatched: for a person, on nobody’s books', async () => {
    const { b } = await activeWallet();
    const orphan = await fake.createVirtualAccount(
      { kind: 'merchant', ownerId: 'nobody', name: 'Nobody' },
      `orphan-${randomBytes(6).toString('hex')}`,
    );
    const inbound = fake.simulateInboundTransfer(
      { kind: 'va', providerRef: orphan.providerRef },
      ngn(9_000n),
      'deposit',
    );
    await notify(inbound);
    await worker.confirmEvents();
    expect(await eventOf(inbound.providerTxId)).toMatchObject({ status: 'done', outcome: 'unmatched' });
    const internal = (await internalTxOf(inbound.providerTxId))!;
    expect(await postingsOf(internal)).toEqual([]);
    expect(await balance(b.merchantId, '1100')).toBe(0);
  });
});

describe('the ledger, line by line (P9 money-flow matrix)', () => {
  it('C1–C7: ₦10,000 is Dr 1100, Cr 2290 in that business’s ledger, once, traceable, whatever the notification names', async () => {
    const a = await activeWallet();
    const other = await activeWallet();
    const inbound = fake.simulateInboundTransfer(a.va, ngn(1_000_000n), 'deposit');
    const before = { a: await entriesOf(a.b.merchantId), other: await entriesOf(other.b.merchantId) };
    // The notification names the other business: only the provider's answer counts.
    await notify({ ...inbound, accountNumber: other.wallet.account_number, merchantId: other.b.merchantId });
    await worker.confirmEvents();
    const internal = (await internalTxOf(inbound.providerTxId))!;
    const lines = await postingsOf(internal);
    expect(lines).toMatchObject([
      { code: '1100', side: 'debit', amount: '1000000', merchant_id: a.b.merchantId },
      { code: '2290', side: 'credit', amount: '1000000', merchant_id: a.b.merchantId },
    ]);
    expect(lines.every((l) => l.account_merchant === a.b.merchantId)).toBe(true);
    expect(await entriesOf(a.b.merchantId)).toBe(before.a + 1);
    expect(await entriesOf(other.b.merchantId)).toBe(before.other);
    // Not the platform's books.
    expect(
      (
        await one(
          `SELECT count(*)::int AS n FROM ledger.journal_entries e JOIN ledger.ledgers l ON l.id = e.ledger_id
            WHERE l.owner_kind = 'platform' AND e.source_id = $1`,
          [internal],
        )
      ).n,
    ).toBe(0);
    // Traceable: the provider's reference, the transaction, the receipt and the entry name each other.
    expect(
      await one(
        `SELECT t.provider_tx_id, t.entry_id, r.received_entry_id, r.amount_minor::text AS amount
           FROM payments.provider_transactions t JOIN payments.receipts r ON r.transaction_id = t.id WHERE t.id = $1`,
        [internal],
      ),
    ).toEqual({
      provider_tx_id: inbound.providerTxId,
      entry_id: lines[0].entry_id,
      received_entry_id: lines[0].entry_id,
      amount: '1000000',
    });
    // Replayed: no other entry.
    await notify(inbound);
    await worker.confirmEvents();
    expect(await entriesOf(a.b.merchantId)).toBe(before.a + 1);
  });
});

describe('the reconciler, the other way (P9 money-flow matrix)', () => {
  it('E3: books above the provider are a difference too, and change nothing', async () => {
    const w = await activeWallet();
    await notify(fake.simulateInboundTransfer(w.va, ngn(60_000n), 'deposit'));
    await worker.confirmEvents();
    fake.adjustBalance(w.va, -10_000n);
    const entries = await entriesOf(w.b.merchantId);
    await worker.reconcile();
    expect(
      await one(
        `SELECT provider_balance_minor::text AS provider, books_balance_minor::text AS books
           FROM payments.reconciliation_findings WHERE wallet_id = $1 AND status = 'open'`,
        [w.wallet.id],
      ),
    ).toEqual({ provider: '50000', books: '60000' });
    expect(await balance(w.b.merchantId, '1100')).toBe(60_000);
    expect(await entriesOf(w.b.merchantId)).toBe(entries);
  });
});

describe('the journeys, end to end (P9 money-flow matrix)', () => {
  it('Journey 1: signup, confirmed email, wallet, deposit, webhook, confirmation, one credit, a receipt to classify', async () => {
    // 1. A business signs up: no wallet while its email is unconfirmed.
    const address = `journey-${randomBytes(5).toString('hex')}@example.test`;
    const signup = await request(app)
      .post('/v1/auth/signup')
      .send({ email: address, password: 'a long enough passphrase', businessName: 'Journey Savings' });
    expect(signup.status).toBe(202);
    const who = await one(
      `SELECT i.id AS identity_id, mm.id AS membership_id, mm.merchant_id
         FROM identity.identities i JOIN tenancy.merchant_memberships mm ON mm.identity_id = i.id
        WHERE i.email = $1`,
      [address],
    );
    await worker.provisionWallets();
    expect(await walletOf(who.merchant_id)).toBeUndefined();
    // It confirms its email, through the link it was sent.
    await vi.waitFor(() => expect(email.to(address).length).toBe(1));
    const link = new RegExp(`^${TEST_WEB_APP_URL}/verify-email#token=([A-Za-z0-9_-]{43})$`, 'm').exec(
      email.to(address)[0]!.text,
    );
    expect((await request(app).post('/v1/auth/email/verify').send({ token: link![1] })).status).toBe(204);
    // 2. The worker provisions its wallet; the business sees it.
    await queued(who.merchant_id);
    await worker.provisionWallets();
    const wallet = await walletOf(who.merchant_id);
    expect(wallet.status).toBe('active');
    const { token: session } = await token(who.identity_id, 'merchant', who.membership_id);
    expect((await call(session, 'get', '/v1/merchant/wallet')).body).toMatchObject({
      status: 'active',
      accountNumber: wallet.account_number,
      balance: { amountMinor: '0' },
      toClassify: { amountMinor: '0' },
    });
    // 3. A customer deposits; 4. the webhook is received and stored, and believed by nobody yet.
    const va = { kind: 'va', providerRef: wallet.provider_ref as string } as const;
    const inbound = fake.simulateInboundTransfer(va, ngn(1_000_000n), 'deposit');
    expect((await notify(inbound)).status).toBe(200);
    expect((await eventOf(inbound.providerTxId)).status).toBe('received');
    expect(await balance(who.merchant_id, '1100')).toBe(0);
    // 5. The worker confirms it with the provider; 6. the ledger is credited exactly once.
    const confirm = vi.spyOn(fake, 'getTransaction');
    await worker.confirmEvents();
    expect(confirm.mock.calls.some(([id]) => id === inbound.providerTxId)).toBe(true);
    confirm.mockRestore();
    expect(await eventOf(inbound.providerTxId)).toMatchObject({ status: 'done', outcome: 'credited' });
    const internal = (await internalTxOf(inbound.providerTxId))!;
    expect(await postingsOf(internal)).toMatchObject([
      { code: '1100', side: 'debit', amount: '1000000' },
      { code: '2290', side: 'credit', amount: '1000000' },
    ]);
    // 7. The receipt waits to be classified, and the business sees all of it.
    expect((await call(session, 'get', '/v1/merchant/wallet')).body).toMatchObject({
      balance: { amountMinor: '1000000' },
      toClassify: { amountMinor: '1000000' },
    });
    const receipts = await call(session, 'get', '/v1/merchant/wallet/receipts?classified=false');
    expect(receipts.body.items).toHaveLength(1);
    expect(receipts.body.items[0]).toMatchObject({ amount: { amountMinor: '1000000' } });
    // The reconciler agrees.
    await worker.reconcile();
    expect(
      await one(`SELECT 1 AS found FROM payments.reconciliation_findings WHERE wallet_id = $1`, [wallet.id]),
    ).toBeUndefined();
  });

  it('Journey 2: a forged event, a valid one sent twice, and both at once before two workers: one credit', async () => {
    const { b, va, wallet } = await activeWallet();
    const entries = await entriesOf(b.merchantId);
    // 1. Forged.
    const forged = `forged-${randomBytes(6).toString('hex')}`;
    await notify({
      type: 'transfer.inbound',
      providerTxId: forged,
      accountNumber: wallet.account_number,
      amount: 5_000_000,
    });
    // 2, 3. Valid, delivered twice before anything runs, then two workers at once.
    const inbound = fake.simulateInboundTransfer(va, ngn(70_000n), 'deposit');
    await Promise.all([notify(inbound), notify(inbound), notify(inbound)]);
    await Promise.all([worker.confirmEvents(), otherWorker.confirmEvents()]);
    // A lost race is looked at again at once.
    await worker.confirmEvents();
    // 4. Only what the provider confirmed posted, once.
    expect(await balance(b.merchantId, '1100')).toBe(70_000);
    expect(await receiptsOf(b.merchantId)).toBe(1);
    expect(await entriesOf(b.merchantId)).toBe(entries + 1);
    const { rows } = await owner.query(
      `SELECT status, outcome FROM payments.provider_events WHERE reference = $1`,
      [inbound.providerTxId],
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.outcome === 'credited')).toHaveLength(1);
    expect(rows.filter((r) => r.outcome === 'duplicate')).toHaveLength(2);
    expect((await eventOf(forged)).status).toBe('pending');
    const { id } = await eventOf(forged);
    await owner.query(
      `UPDATE payments.provider_events SET attempts = 8, next_check_at = now(), lease_until = NULL WHERE id = $1`,
      [id],
    );
    await worker.confirmEvents();
    expect(await eventOf(forged)).toMatchObject({ status: 'rejected', outcome: 'not_confirmed' });
    expect(await balance(b.merchantId, '1100')).toBe(70_000);
  });

  it('Journey 3: timeouts, rate limits and server errors stay uncertain; recovery leaves one account and one posting', async () => {
    const b = await business();
    await queued(b.merchantId);
    const { alias } = await walletOf(b.merchantId);
    const create = vi.spyOn(fake, 'createVirtualAccount');
    const creations = () => create.mock.calls.filter(([, key]) => key === alias).length;
    const retry = () => queued(b.merchantId);
    // 1, 2. The lookup is rate limited: nothing is created, and the wallet is not failed.
    fake.failNext('find', 'UNKNOWN_OUTCOME', { match: alias });
    await worker.provisionWallets();
    expect(creations()).toBe(0);
    expect((await walletOf(b.merchantId)).status).toBe('provisioning');
    // The creation times out after taking effect: still uncertain.
    await retry();
    fake.failNext('create', 'UNKNOWN_OUTCOME', { afterEffect: true, match: alias });
    await worker.provisionWallets();
    expect(creations()).toBe(1);
    expect((await walletOf(b.merchantId)).status).toBe('provisioning');
    // 4. The provider answers again: the account is found, not created.
    await retry();
    await worker.provisionWallets();
    const wallet = await walletOf(b.merchantId);
    expect(wallet.status).toBe('active');
    expect(creations()).toBe(1);
    create.mockRestore();
    // 2, 3. A deposit whose confirmation fails over and over, past the point a forged one would be rejected.
    const va = { kind: 'va', providerRef: wallet.provider_ref as string } as const;
    const inbound = fake.simulateInboundTransfer(va, ngn(25_000n), 'deposit');
    await notify(inbound);
    const { id } = await eventOf(inbound.providerTxId);
    const again = () =>
      owner.query(
        `UPDATE payments.provider_events SET next_check_at = now(), lease_until = NULL WHERE id = $1`,
        [id],
      );
    await owner.query(`UPDATE payments.provider_events SET attempts = 20 WHERE id = $1`, [id]);
    for (let i = 0; i < 3; i++) {
      fake.failNext('get', 'UNKNOWN_OUTCOME', { match: inbound.providerTxId });
      await worker.confirmEvents();
      expect((await eventOf(inbound.providerTxId)).status).toBe('pending');
      expect(await balance(b.merchantId, '1100')).toBe(0);
      await again();
    }
    // 4, 5. It recovers: one posting.
    await worker.confirmEvents();
    expect(await eventOf(inbound.providerTxId)).toMatchObject({ status: 'done', outcome: 'credited' });
    expect(await postingsOf((await internalTxOf(inbound.providerTxId))!)).toHaveLength(2);
    expect(await balance(b.merchantId, '1100')).toBe(25_000);
  });
});
