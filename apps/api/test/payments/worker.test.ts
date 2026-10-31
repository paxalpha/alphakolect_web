import { randomBytes } from 'node:crypto';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../../src/integrations/payments/fake-provider.js';
import { PaymentsWorker } from '../../src/modules/payments/worker-tasks.js';
import { ngn } from '../../src/platform/money.js';
import { createTestApp } from '../support/app.js';
import { uniquePhone } from '../support/customers.js';
import { tenancyFixtures } from '../support/tenancy.js';

// The payments worker against the real database, through the webhook the app exposes (P9 §3, §5; TA-8, TA-11): wallets
// only after a business confirms its email (BR-2.3), a forged or replayed event credits nothing more (the exit), an
// order in doubt is never sent twice, and the reconciler finds a difference (the exit). Other test files share this
// database, so each test moves its own rows to the front of the queue and targets its failures by alias or reference.

const { app, db, auth } = await createTestApp();
const { owner, business } = tenancyFixtures(app, auth);
const fake = new FakeProvider();
const worker = new PaymentsWorker({
  db,
  provider: fake,
  logger: pino({ level: 'silent' }),
  customerLiveWallets: false,
});

const one = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0];
const walletOf = (merchantId: string) =>
  one(`SELECT * FROM payments.live_wallets WHERE owner_kind = 'merchant' AND merchant_id = $1`, [merchantId]);
/** Requests this business's wallet and puts it first in the queue. */
const queued = async (merchantId: string) => {
  await owner.query(`SELECT payments.request_wallets('fake', false)`);
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

  it('customer wallets are not requested with the switch off (Q7)', async () => {
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
      customerLiveWallets: false,
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
      customerLiveWallets: false,
    });
    await quiet.reconcile();
    expect(await openFinding(w.wallet.id)).toBeUndefined();
  });
});
