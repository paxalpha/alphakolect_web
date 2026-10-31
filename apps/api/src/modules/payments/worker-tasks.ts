import type { Logger } from 'pino';
import {
  ProviderError,
  type BankAccount,
  type PaymentProvider,
  type ProviderTransaction,
  type ProviderTxRef,
  type VaOwner,
  type VaRef,
} from '../../integrations/payments/provider.js';
import type { Db } from '../../platform/db.js';
import { ngn } from '../../platform/money.js';

// The payments worker's tasks (P9 §3; TA-8, TA-11). Each claims due rows in one short transaction, calls the provider
// with no transaction open (P9-4), and records what the provider said in another. The database functions decide what it
// means; the worker never makes up an amount or an account (P9-2). It connects as alphakolect_app; the functions take
// the business from the row, so a job cannot touch another business's books.

const LEASE_SECONDS = 300;
const BATCH = 50;
/** About two days of attempts at the longest delay: then the platform team sees the wallet as failed. */
const WALLET_MAX_ATTEMPTS = 50;
/** An event the provider does not know after this many looks is rejected: forged, or never real. */
const EVENT_MAX_ATTEMPTS = 8;

const errorText = (err: unknown) =>
  err instanceof ProviderError ? `${err.code}: ${err.message}` : 'Unexpected error';

export type PaymentsWorkerDeps = {
  db: Db;
  provider: PaymentProvider;
  logger: Pick<Logger, 'error' | 'warn' | 'info'>;
  customerLiveWallets: boolean;
};

export class PaymentsWorker {
  constructor(private readonly deps: PaymentsWorkerDeps) {}

  /** Request a wallet for each business whose email is confirmed (BR-2.3), then create those due. */
  async provisionWallets(): Promise<void> {
    const { db, provider, customerLiveWallets } = this.deps;
    await db.transaction(async (tx) => {
      await tx.query(`SELECT payments.request_wallets($1, $2)`, [provider.name, customerLiveWallets]);
    });
    const due = await db.transaction((tx) =>
      tx.query<{
        id: string;
        owner_kind: VaOwner['kind'];
        merchant_id: string | null;
        customer_id: string | null;
        alias: string;
        display_name: string;
      }>(
        `SELECT id, owner_kind, merchant_id, customer_id, alias, display_name FROM payments.claim_wallets($1, $2)`,
        [BATCH, LEASE_SECONDS],
      ),
    );
    for (const w of due) {
      try {
        // Asked first: a request that timed out may have created it (B1: creation is not documented as idempotent).
        const account =
          (await provider.findVirtualAccountByAlias(w.alias)) ??
          (await provider.createVirtualAccount(
            {
              kind: w.owner_kind,
              ownerId: w.customer_id ?? w.merchant_id ?? 'platform',
              name: w.display_name,
            },
            w.alias,
          ));
        await db.transaction(async (tx) => {
          await tx.query(`SELECT payments.record_wallet_created($1, $2, $3, $4, $5)`, [
            w.id,
            account.providerRef,
            account.accountNumber,
            account.accountName,
            account.bankName,
          ]);
        });
      } catch (err) {
        this.deps.logger.warn(
          { walletId: w.id, code: (err as ProviderError).code },
          'A wallet was not created',
        );
        await db.transaction(async (tx) => {
          await tx.query(`SELECT payments.record_wallet_failed($1, $2, $3)`, [
            w.id,
            errorText(err),
            WALLET_MAX_ATTEMPTS,
          ]);
        });
      }
    }
  }

  /** Confirm each stored event by asking the provider; only what it answers is recorded (TA-8, P9-2). */
  async confirmEvents(): Promise<void> {
    const { db, provider } = this.deps;
    const due = await db.transaction((tx) =>
      tx.query<{ id: string; reference: string | null }>(
        `SELECT id, reference FROM payments.claim_events($1, $2)`,
        [BATCH, LEASE_SECONDS],
      ),
    );
    for (const e of due) {
      let tx: ProviderTransaction | null = null;
      let unavailable = false;
      if (e.reference) {
        try {
          tx = await provider.getTransaction(e.reference);
        } catch (err) {
          // NOT_FOUND: the provider does not know it. Anything else tells nothing: look again later.
          unavailable = !(err instanceof ProviderError && err.code === 'NOT_FOUND');
          if (unavailable)
            this.deps.logger.warn({ eventId: e.id }, 'The provider could not confirm an event');
        }
      }
      // Could not ask: found, still pending. Unknown to the provider, or not money arriving (an order is settled by its
      // own lookup): not found. Otherwise what the provider said.
      const money = !unavailable && tx?.to.kind === 'va' ? tx : null;
      await db.transaction(async (t) => {
        await t.query(`SELECT payments.record_event($1, $2, $3, $4, $5::bigint, $6, $7, $8, $9)`, [
          e.id,
          unavailable || money !== null,
          money?.providerTxId ?? null,
          money?.toAccountNumber ?? null,
          money?.amount.amountMinor.toString() ?? null,
          money?.amount.currency ?? null,
          unavailable ? 'pending' : (money?.status ?? null),
          money?.createdAt ?? null,
          EVENT_MAX_ATTEMPTS,
        ]);
      });
    }
  }

  /**
   * Send what was claimed as 'created'; look up everything else by our reference, never sending it again (TA-8). The
   * claim already marked it 'unknown', so a worker that dies here leaves an order to be looked up.
   */
  async settleOrders(): Promise<void> {
    const { db, provider } = this.deps;
    const due = await db.transaction((tx) =>
      tx.query<{
        id: string;
        prior_state: string;
        reference: string;
        amount_minor: string;
        from_provider_ref: string;
        to_provider_ref: string | null;
        to_bank: { accountNumber: string; bankCode: string } | null;
      }>(
        `SELECT id, prior_state, reference, amount_minor, from_provider_ref, to_provider_ref, to_bank
           FROM payments.claim_orders($1, $2)`,
        [BATCH, LEASE_SECONDS],
      ),
    );
    for (const o of due) {
      let state: string;
      let ref: ProviderTxRef | null = null;
      let error: string | null = null;
      try {
        if (o.prior_state === 'created') {
          const to: VaRef | BankAccount = o.to_bank
            ? { kind: 'bank', bankCode: o.to_bank.bankCode, accountNumber: o.to_bank.accountNumber }
            : { kind: 'va', providerRef: o.to_provider_ref! };
          ref = await provider.transfer(
            { kind: 'va', providerRef: o.from_provider_ref },
            to,
            ngn(BigInt(o.amount_minor)),
            o.reference,
            o.reference,
          );
        } else {
          ref = await provider.findTransferByReference(o.reference);
        }
        state = !ref
          ? 'unknown'
          : ref.status === 'successful'
            ? 'succeeded'
            : ref.status === 'pending'
              ? 'submitted'
              : 'failed';
      } catch (err) {
        error = errorText(err);
        // Only a refusal the provider stated is a failure; everything else may have taken effect.
        state =
          err instanceof ProviderError &&
          ['INSUFFICIENT_FUNDS', 'ACCOUNT_CLOSED', 'INVALID_REQUEST', 'UNSUPPORTED', 'NOT_FOUND'].includes(
            err.code,
          ) &&
          o.prior_state === 'created'
            ? 'failed'
            : 'unknown';
      }
      await db.transaction(async (tx) => {
        await tx.query(`SELECT payments.record_order($1, $2, $3, $4, $5)`, [
          o.id,
          state,
          ref?.providerTxId ?? null,
          ref?.providerTxId ?? null,
          error,
        ]);
      });
    }
  }

  /** Compare the books with the provider: per wallet where it can say, otherwise in total (P9-3, Q5). */
  async reconcile(): Promise<void> {
    const { db, provider, logger } = this.deps;
    const wallets = await db.transaction((tx) =>
      tx.query<{ wallet_id: string; provider: string; provider_ref: string; books_minor: string }>(
        `SELECT wallet_id, provider, provider_ref, books_minor FROM payments.reconcile_wallets()`,
      ),
    );
    const mine = wallets.filter((w) => w.provider === provider.name);
    const record = (scope: string, walletId: string | null, providerMinor: bigint, booksMinor: bigint) =>
      db.transaction(async (tx) => {
        const [row] = await tx.query<{ outcome: string }>(
          `SELECT payments.record_finding($1, $2, $3::bigint, $4::bigint) AS outcome`,
          [scope, walletId, providerMinor.toString(), booksMinor.toString()],
        );
        if (row!.outcome === 'recorded')
          logger.error({ scope, walletId }, 'Reconciliation found a difference');
      });
    // No answer is not a difference: the next run compares again.
    const balanceOf = async (account?: VaRef) => {
      try {
        return (await provider.getBalance(account)).amountMinor;
      } catch (err) {
        logger.warn({ code: (err as ProviderError).code }, 'The provider’s balance was not available');
        return null;
      }
    };
    if (provider.capabilities.perAccountBalance) {
      for (const w of mine) {
        const balance = await balanceOf({ kind: 'va', providerRef: w.provider_ref });
        if (balance !== null) await record('wallet', w.wallet_id, balance, BigInt(w.books_minor));
      }
    } else if (mine.length > 0) {
      const balance = await balanceOf();
      const total = mine.reduce((sum, w) => sum + BigInt(w.books_minor), 0n);
      if (balance !== null) await record('pooled', null, balance, total);
    }
  }

  /** One pass of the tasks that run often. */
  async runOnce(): Promise<void> {
    await this.provisionWallets();
    await this.confirmEvents();
    await this.settleOrders();
  }
}
