import { createHmac, randomBytes } from 'node:crypto';
import pino from 'pino';
import request from 'supertest';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { PaystackProvider } from '../../src/integrations/payments/paystack-provider.js';
import { PaymentsWorker } from '../../src/modules/payments/worker-tasks.js';
import { createDb } from '../../src/platform/db.js';
import { createTestApp } from '../support/app.js';
import { expectError, tenancyFixtures } from '../support/tenancy.js';

// P9 revision 8: the worker, the webhook and the ledger with the Paystack adapter, against a stand-in for Paystack that
// answers as its documentation says (plan §16). It proves what the adapter's own tests cannot: a signed notification
// is stored and an unsigned one is not; a payment is credited from Paystack's answer less its fee; a payment that is no
// dedicated-account deposit credits nothing; Paystack's one balance equals the books' total; a payout is named, sent
// once, and posted once, and one that fails before it is sent is failed, not unknown. Every provider-scoped claim keeps
// this file's rows apart from the other files', which use the fake provider.

const SECRET = 'sk_test_0123456789abcdef'; // gitleaks:allow
const SIGNING = 'whsec_0123456789abcdef'; // gitleaks:allow
const DOMAIN = 'wallets.example.test';

type Tx = {
  reference: string;
  amount: number;
  fees: number;
  channel: string;
  account: string;
};

/** What Paystack does, as far as the documentation says: customers, dedicated accounts, payments, one balance, payouts. */
class StandInPaystack {
  customers = new Map<string, { email: string; customer_code: string; dedicated_account: unknown }>();
  transactions = new Map<string, Tx>();
  transfers = new Map<string, { code: string; amount: number }>();
  balance = 0;
  accounts = 0;
  failRecipient = false;
  /** The next transfer is made, and the answer lost on its way back. */
  dropNextTransferAnswer = false;
  transferCalls = 0;

  private reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  deposit(account: string, amount: number, fees: number, channel = 'dedicated_nuban'): string {
    const reference = `dep${randomBytes(8).toString('hex')}`;
    this.transactions.set(reference, { reference, amount, fees, channel, account });
    this.balance += amount - fees;
    return reference;
  }

  fetch = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname;
    const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    if (init.method === 'GET' && path.startsWith('/customer/')) {
      const c = this.customers.get(decodeURIComponent(path.slice('/customer/'.length)));
      return c
        ? this.reply({ status: true, data: c })
        : this.reply({ status: false, message: 'Customer not found' }, 404);
    }
    if (path === '/customer') {
      const email = String(body.email);
      const c = { email, customer_code: `CUS_${randomBytes(6).toString('hex')}`, dedicated_account: null };
      this.customers.set(email, c);
      return this.reply({ status: true, data: c });
    }
    if (path === '/dedicated_account') {
      const c = [...this.customers.values()].find((x) => x.customer_code === body.customer)!;
      const account = {
        account_number: `99${String(++this.accounts).padStart(4, '0')}${Math.floor(Math.random() * 1e4)}`,
        account_name: 'ALPHAKOLECT / TEST',
        bank: { name: 'Paystack-Titan', slug: 'titan-paystack' },
        active: true,
        assigned: true,
      };
      c.dedicated_account = account;
      return this.reply({ status: true, data: account });
    }
    if (path.startsWith('/transaction/verify/')) {
      const t = this.transactions.get(decodeURIComponent(path.slice('/transaction/verify/'.length)));
      if (!t) return this.reply({ status: false, message: 'Transaction reference not found' }, 404);
      return this.reply({
        status: true,
        data: {
          reference: t.reference,
          status: 'success',
          amount: t.amount,
          fees: t.fees,
          currency: 'NGN',
          channel: t.channel,
          paid_at: new Date().toISOString(),
          authorization: { receiver_bank_account_number: t.account },
        },
      });
    }
    if (path === '/balance')
      return this.reply({ status: true, data: [{ currency: 'NGN', balance: this.balance }] });
    if (path === '/bank/resolve') return this.reply({ status: true, data: { account_name: 'Tolu Robert' } });
    if (path === '/transferrecipient')
      return this.failRecipient
        ? this.reply({ status: false, message: 'Recipient refused' }, 400)
        : this.reply({ status: true, data: { recipient_code: 'RCP_test' } });
    if (path === '/transfer') {
      this.transferCalls++;
      const reference = String(body.reference);
      this.transfers.set(reference, {
        code: `TRF_${randomBytes(5).toString('hex')}`,
        amount: Number(body.amount),
      });
      this.balance -= Number(body.amount);
      if (this.dropNextTransferAnswer) {
        this.dropNextTransferAnswer = false;
        return this.reply({}, 502);
      }
      return this.reply({
        status: true,
        data: { status: 'success', transfer_code: this.transfers.get(reference)!.code, reference },
      });
    }
    if (path.startsWith('/transfer/verify/')) {
      const reference = decodeURIComponent(path.slice('/transfer/verify/'.length));
      const t = this.transfers.get(reference);
      return t
        ? this.reply({ status: true, data: { reference, status: 'success', transfer_code: t.code } })
        : this.reply({ status: false, message: 'Transfer not found' }, 404);
    }
    return this.reply({ status: false, message: `Unexpected ${init.method} ${path}` }, 500);
  }) as typeof fetch;
}

const paystackApi = new StandInPaystack();
const provider = new PaystackProvider({
  secretKey: SECRET,
  webhookSigningSecret: SIGNING,
  preferredBank: 'test-bank',
  walletEmailDomain: DOMAIN,
  fetch: paystackApi.fetch,
});
const { app, auth } = await createTestApp({ paymentProvider: provider });
const db = createDb(inject('workerDatabaseUrl'));
afterAll(() => db.close());
const { owner, business } = tenancyFixtures(app, auth);
const worker = new PaymentsWorker({ db, provider, logger: pino({ level: 'silent' }) });

const one = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0];
const mac = (secret: string, text: string) => createHmac('sha512', secret).update(text).digest('hex');
const event = (reference: string) =>
  `{"event":"charge.success","data":{"reference":"${reference}",  "channel":"dedicated_nuban"}}`;
const post = (body: string, headers: Record<string, string>) => {
  let r = request(app).post('/v1/webhooks/paystack').set('Content-Type', 'application/json');
  for (const [name, value] of Object.entries(headers)) r = r.set(name, value);
  return r.send(body);
};
const signed = (body: string) => post(body, { 'x-paystack-signature': mac(SECRET, body) });
const stored = async (reference: string) =>
  (
    await owner.query(`SELECT status, outcome, body FROM payments.provider_events WHERE reference = $1`, [
      reference,
    ])
  ).rows;
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

/**
 * A business with a wallet at Paystack. The wallet is requested for this business alone: the sweep (`request_wallets`) is
 * for every business, and files beside this one use the fake provider on theirs. A sweep of theirs may have given this
 * business a wallet of theirs in the instant since it was made: that one, not yet touched, is taken over. Only the
 * creation runs (`createWallets`), never the sweep that `provisionWallets` starts with: that would give every business
 * in this shared database to Paystack, those of the files beside this one included.
 */
async function activeWallet() {
  const b = await business();
  await owner.query(
    `INSERT INTO payments.live_wallets (owner_kind, merchant_id, provider, alias)
     VALUES ('merchant', $1, 'paystack', $2) ON CONFLICT DO NOTHING`,
    [b.merchantId, `AKM-${b.merchantId.replace(/-/g, '')}`],
  );
  await owner.query(
    `UPDATE payments.live_wallets SET provider = 'paystack', next_attempt_at = '2000-01-01', lease_until = NULL
      WHERE owner_kind = 'merchant' AND merchant_id = $1 AND status = 'provisioning'`,
    [b.merchantId],
  );
  await worker.createWallets();
  const wallet = await one(
    `SELECT * FROM payments.live_wallets WHERE owner_kind = 'merchant' AND merchant_id = $1`,
    [b.merchantId],
  );
  expect(wallet).toMatchObject({ status: 'active', provider: 'paystack' });
  return { b, wallet };
}

describe('wallets', () => {
  it('a business’s wallet is a customer on our domain and the dedicated account made for it, made once', async () => {
    const { wallet } = await activeWallet();
    expect(wallet).toMatchObject({ provider: 'paystack', provider_ref: wallet.alias });
    const email = `${String(wallet.alias).toLowerCase()}@${DOMAIN}`;
    expect(paystackApi.customers.get(email)?.dedicated_account).toMatchObject({
      account_number: wallet.account_number,
    });
  });

  it('a creation whose answer was lost: the next pass finds the account by its alias and makes no second one', async () => {
    const b = await business();
    const alias = `AKM-${b.merchantId.replace(/-/g, '')}`;
    await owner.query(
      `INSERT INTO payments.live_wallets (owner_kind, merchant_id, provider, alias)
       VALUES ('merchant', $1, 'paystack', $2) ON CONFLICT DO NOTHING`,
      [b.merchantId, alias],
    );
    await owner.query(
      `UPDATE payments.live_wallets SET provider = 'paystack', next_attempt_at = '2000-01-01', lease_until = NULL
        WHERE owner_kind = 'merchant' AND merchant_id = $1 AND status = 'provisioning'`,
      [b.merchantId],
    );
    // Paystack made it; we never heard.
    const made = await provider.createVirtualAccount(
      { kind: 'merchant', ownerId: b.merchantId, name: 'Lost' },
      alias,
    );
    const accounts = paystackApi.accounts;
    await worker.createWallets();
    expect(paystackApi.accounts).toBe(accounts);
    expect(
      await one(`SELECT status, account_number FROM payments.live_wallets WHERE merchant_id = $1`, [
        b.merchantId,
      ]),
    ).toEqual({ status: 'active', account_number: made.accountNumber });
  });
});

describe('money arriving', () => {
  it('a signed notification is stored and confirmed; the books are credited what arrived, less Paystack’s fee, once', async () => {
    const { b, wallet } = await activeWallet();
    const reference = paystackApi.deposit(wallet.account_number, 1_000_000, 15_000);
    const body = event(reference);

    // Unsigned, mis-signed or stale: refused, and nothing is stored.
    expectError(await post(body, {}), 401, 'UNAUTHENTICATED');
    expectError(
      await post(body, { 'x-paystack-signature': mac(SECRET, `${body} `) }),
      401,
      'UNAUTHENTICATED',
    );
    expect(await stored(reference)).toHaveLength(0);

    // Signed, as sent: stored as it arrived. The same notification again, and the signature with a time, are duplicates.
    expect((await signed(body)).status).toBe(200);
    const t = Math.floor(Date.now() / 1000);
    expect(
      (await post(body, { 'paystack-signature': `t=${t},v1=whk_1:${mac(SIGNING, `${t}.${body}`)}` })).status,
    ).toBe(200);
    expect(await stored(reference)).toHaveLength(2);
    expect((await stored(reference))[0].body).toBe(body);
    expect(await balance(b.merchantId, '1100')).toBe(0);

    await worker.confirmEvents();
    await worker.confirmEvents();
    expect(await balance(b.merchantId, '1100')).toBe(985_000);
    expect(await balance(b.merchantId, '2290')).toBe(985_000);
    expect(
      (
        await owner.query(`SELECT count(*)::int AS n FROM payments.receipts WHERE merchant_id = $1`, [
          b.merchantId,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect((await stored(reference)).map((r) => r.outcome).sort()).toEqual(['credited', 'duplicate']);
  });

  it('a payment that is no dedicated-account deposit credits nothing', async () => {
    const { b, wallet } = await activeWallet();
    const reference = paystackApi.deposit(wallet.account_number, 500_000, 7_500, 'card');
    expect((await signed(event(reference))).status).toBe(200);
    await worker.confirmEvents();
    const looked = await one(`SELECT id, status FROM payments.provider_events WHERE reference = $1`, [
      reference,
    ]);
    expect(looked.status).toBe('pending');
    await owner.query(
      `UPDATE payments.provider_events SET attempts = 8, next_check_at = now(), lease_until = NULL WHERE id = $1`,
      [looked.id],
    );
    await worker.confirmEvents();
    expect((await stored(reference))[0]).toMatchObject({ status: 'rejected', outcome: 'not_confirmed' });
    expect(await balance(b.merchantId, '1100')).toBe(0);
  });

  it('a reference Paystack does not know credits nothing, however the notification is signed', async () => {
    const { b } = await activeWallet();
    const reference = `forged${randomBytes(6).toString('hex')}`;
    expect((await signed(event(reference))).status).toBe(200);
    await worker.confirmEvents();
    const looked = await one(`SELECT id, status FROM payments.provider_events WHERE reference = $1`, [
      reference,
    ]);
    expect(looked.status).toBe('pending');
    await owner.query(
      `UPDATE payments.provider_events SET attempts = 8, next_check_at = now(), lease_until = NULL WHERE id = $1`,
      [looked.id],
    );
    await worker.confirmEvents();
    expect((await stored(reference))[0]).toMatchObject({ status: 'rejected', outcome: 'not_confirmed' });
    expect(await balance(b.merchantId, '1100')).toBe(0);
  });

  it('what Paystack’s one balance gains is what the books of every wallet gain: the fee is in both', async () => {
    const booksTotal = async () =>
      (
        await owner.query<{ provider: string; books_minor: string }>(
          `SELECT provider, books_minor::text FROM payments.reconcile_wallets()`,
        )
      ).rows
        .filter((w) => w.provider === 'paystack')
        .reduce((sum, w) => sum + BigInt(w.books_minor), 0n);
    const [a, c] = [await activeWallet(), await activeWallet()];
    const [providerBefore, booksBefore] = [(await provider.getBalance()).amountMinor, await booksTotal()];
    for (const [w, gross, fee] of [
      [a.wallet, 200_000, 3_000],
      [c.wallet, 90_000, 1_350],
    ] as const) {
      await signed(event(paystackApi.deposit(w.account_number, gross, fee)));
    }
    await worker.confirmEvents();
    await worker.confirmEvents();
    const [providerGain, booksGain] = [
      (await provider.getBalance()).amountMinor - providerBefore,
      (await booksTotal()) - booksBefore,
    ];
    expect(booksGain).toBe(285_650n);
    expect(providerGain).toBe(booksGain);
  });
});

describe('payouts', () => {
  const BANK = '{"accountNumber":"0123456789","bankCode":"058"}';
  async function funded() {
    const w = await activeWallet();
    await signed(event(paystackApi.deposit(w.wallet.account_number, 100_000, 0)));
    await worker.confirmEvents();
    const ledger = (await one(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [w.b.merchantId])).id;
    const reference = `AKO-${randomBytes(8).toString('hex')}`;
    const id = (
      await one(
        `SELECT payments.create_order($1, NULL, $2, 30000, $3, 'test', $4, 'subscription.paid', '{}') AS id`,
        [w.wallet.id, BANK, reference, ledger],
      )
    ).id as string;
    return { ...w, id, reference };
  }
  const stateOf = async (id: string) =>
    (await one(`SELECT state FROM payments.payment_orders WHERE id = $1`, [id])).state as string;
  const due = (id: string) =>
    owner.query(
      `UPDATE payments.payment_orders SET next_check_at = now(), lease_until = NULL WHERE id = $1`,
      [id],
    );

  it('is named, sent under a reference Paystack accepts, and posted once', async () => {
    const o = await funded();
    const sent = paystackApi.transferCalls;
    await worker.settleOrders();
    expect(await stateOf(o.id)).toBe('succeeded');
    expect(paystackApi.transferCalls).toBe(sent + 1);
    // Our reference has capitals: what Paystack holds is the digest the adapter makes of it, and the lookup agrees.
    expect([...paystackApi.transfers.keys()].some((k) => /^ak-[0-9a-f]{40}$/.test(k))).toBe(true);
    expect(await balance(o.b.merchantId, '1100')).toBe(70_000);
    await due(o.id);
    await worker.settleOrders();
    expect(paystackApi.transferCalls).toBe(sent + 1);
    expect(await balance(o.b.merchantId, '1100')).toBe(70_000);
  });

  it('a step before the transfer that fails means nothing was sent: failed, nothing posted', async () => {
    const o = await funded();
    const sent = paystackApi.transferCalls;
    paystackApi.failRecipient = true;
    try {
      await worker.settleOrders();
    } finally {
      paystackApi.failRecipient = false;
    }
    expect(await stateOf(o.id)).toBe('failed');
    expect(paystackApi.transferCalls).toBe(sent);
    expect(await balance(o.b.merchantId, '1100')).toBe(100_000);
  });

  it('an answer lost after the money moved: unknown, settled by the lookup, never sent again', async () => {
    const o = await funded();
    const sent = paystackApi.transferCalls;
    paystackApi.dropNextTransferAnswer = true;
    await worker.settleOrders();
    expect(await stateOf(o.id)).toBe('unknown');
    expect(await balance(o.b.merchantId, '1100')).toBe(100_000);
    await due(o.id);
    await worker.settleOrders();
    expect(await stateOf(o.id)).toBe('succeeded');
    expect(paystackApi.transferCalls).toBe(sent + 1);
    expect(await balance(o.b.merchantId, '1100')).toBe(70_000);
  });
});
