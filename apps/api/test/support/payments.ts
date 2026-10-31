import { randomBytes } from 'node:crypto';
import type pg from 'pg';

// Payments for tests that call every endpoint of the registry (the authorization matrix, the policy test, the isolation
// matrix; P9): an active Live wallet of a business, made with the worker's functions, with a receipt to classify, a
// transaction under review and an open finding — and sample bodies for the commands. The wallet row is the business's
// alone: other businesses' are left for whoever needs them.

export type PaymentResources = {
  walletId: string;
  accountNumber: string;
  /** A receipt the commands may classify (more than once across a matrix: only the first succeeds). */
  receiptId: string;
  /** Another, left for a test that needs one still open. */
  openReceiptId: string;
  /** A transaction of this business under review, for the platform's resolution. */
  transactionId: string;
  findingId: string;
  capitalId: string;
};

const digits = (n: number) =>
  Array.from(randomBytes(n))
    .map((b) => String(b % 10))
    .join('');

export async function paymentResources(owner: pg.Client, merchantId: string): Promise<PaymentResources> {
  const one = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0];
  // The worker's sweep (a test file running beside this one) may have requested this business's wallet already.
  await owner.query(
    `INSERT INTO payments.live_wallets (owner_kind, merchant_id, provider, alias) VALUES ('merchant', $1, 'fake', $2)
     ON CONFLICT DO NOTHING`,
    [merchantId, `AKM-${merchantId.replace(/-/g, '')}`],
  );
  const walletId = (
    await one(`SELECT id FROM payments.live_wallets WHERE owner_kind = 'merchant' AND merchant_id = $1`, [
      merchantId,
    ])
  ).id as string;
  // A claim's token, staged: the claims are tested with the worker.
  const leased = async (table: string, id: string) =>
    (
      await one(
        `UPDATE payments.${table} SET lease_token = gen_random_uuid() WHERE id = $1 RETURNING lease_token`,
        [id],
      )
    ).lease_token as string;
  await one(`SELECT payments.record_wallet_created($1, $2, $3, $4, 'Matrix', 'Test Bank')`, [
    walletId,
    await leased('live_wallets', walletId),
    `ref-${randomBytes(6).toString('hex')}`,
    digits(10),
  ]);
  const accountNumber = (
    await one(`SELECT account_number FROM payments.live_wallets WHERE id = $1`, [walletId])
  ).account_number as string;
  const event = async (tx: string, amount: number, status = 'successful') => {
    const id = (await one(`SELECT payments.store_event('fake', '{}', '{}', NULL) AS id`)).id;
    await one(`SELECT payments.record_event($1, $2, true, $3, $4, $5, 'NGN', $6, now(), 5)`, [
      id,
      await leased('provider_events', id as string),
      tx,
      accountNumber,
      amount,
      status,
    ]);
  };
  const tx = () => `matrix-${randomBytes(8).toString('hex')}`;
  const [first, second, reviewed] = [tx(), tx(), tx()];
  await event(first, 10_000);
  await event(second, 10_000);
  await event(reviewed, 10_000);
  await event(reviewed, 10_000, 'reversed');
  const receipt = async (t: string) =>
    (
      await one(
        `SELECT r.id FROM payments.receipts r JOIN payments.provider_transactions t ON t.id = r.transaction_id
          WHERE t.provider_tx_id = $1`,
        [t],
      )
    ).id as string;
  await one(`SELECT payments.record_finding('wallet', $1, 1, 0)`, [walletId]);
  return {
    walletId,
    accountNumber,
    receiptId: await receipt(first),
    openReceiptId: await receipt(second),
    transactionId: (
      await one(`SELECT id FROM payments.provider_transactions WHERE provider_tx_id = $1`, [reviewed])
    ).id as string,
    findingId: (await one(`SELECT id FROM payments.reconciliation_findings WHERE wallet_id = $1`, [walletId]))
      .id as string,
    capitalId: (
      await one(`SELECT id FROM ledger.accounts WHERE merchant_id = $1 AND code = '3000'`, [merchantId])
    ).id as string,
  };
}

/** Valid request bodies of the payments commands. */
export const paymentBodies = {
  classifyWalletReceipt: (w: { payments: PaymentResources }) => ({ accountId: w.payments.capitalId }),
  resolveUnmatchedTransaction: () => ({ resolution: 'dismissed', note: 'Matrix' }),
  resolveReconciliationFinding: () => ({ note: 'Matrix' }),
  receiveTransactPayEvent: () => ({}),
};

/**
 * The business's payments rows, for the snapshots that prove a refused call changed nothing: what a command could change,
 * not what the worker running beside the test keeps up to date (a finding's last sighting, a wallet's lease).
 */
export const PAYMENTS_SNAPSHOT_SQL = `
  'wallets', (SELECT json_agg(json_build_array(w.id, w.status) ORDER BY w.id) FROM payments.live_wallets w
               WHERE w.merchant_id = $1),
  'receipts', (SELECT json_agg(r ORDER BY r.id) FROM payments.receipts r WHERE r.merchant_id = $1),
  'transactions', (SELECT json_agg(t ORDER BY t.id) FROM payments.provider_transactions t
                     JOIN payments.live_wallets w ON w.id = t.wallet_id WHERE w.merchant_id = $1),
  'findings', (SELECT json_agg(json_build_array(f.id, f.status) ORDER BY f.id) FROM payments.reconciliation_findings f
                 JOIN payments.live_wallets w ON w.id = f.wallet_id WHERE w.merchant_id = $1)`;
