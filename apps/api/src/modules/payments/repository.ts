import { POSITION_AT, type Position, type Positioned } from '../../platform/pagination.js';
import type { RequestContext } from '../../platform/request-context.js';
import { scopeOf, type TenantTx } from '../../platform/tenant.js';

// The payments module's scoped repository (P9; ADR-15 T13–T15, B1): the business's reads and command. The app holds no
// privilege on the payments tables: each is a payments.* function called with the caller's session, which takes the
// business from the session, decides the permission and records its event (pattern A). Refusals are outcomes (§8.2a).

export type WalletRow = {
  id: string;
  status: 'provisioning' | 'active' | 'failed' | 'closed';
  account_number: string | null;
  account_name: string | null;
  bank_name: string | null;
  balance_minor: string;
  to_classify_minor: string;
  activated_at: Date | null;
};

export type ReceiptFields = {
  id: string;
  amount_minor: string;
  received_at: Date | null;
  classified_account_id: string | null;
  classified_note: string | null;
  classified_at: Date | null;
  created_at: Date;
};
export type ReceiptRow = ReceiptFields & Positioned;

export type ClassifyWrite = {
  outcome: 'ok' | 'forbidden' | 'not_found' | 'invalid' | 'invalid_status' | 'invalid_account';
  id: string | null;
  amount_minor: string | null;
  classified_account_id: string | null;
  classified_note: string | null;
  classified_at: Date | null;
  received_at: Date | null;
  created_at: Date | null;
};

/** A page of a list: its size, and the position a cursor gave (null for the first page). */
export type Page = { limit: number; after: Position | null };

export const paymentsRepository = {
  /** payments.merchant_wallet: null before a wallet is requested, or without merchant.wallet.read. */
  async wallet(tx: TenantTx): Promise<WalletRow | null> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<WalletRow>(
      `SELECT id, status, account_number, account_name, bank_name, balance_minor, to_classify_minor, activated_at
         FROM payments.merchant_wallet($1)`,
      [sessionId],
    );
    return row ?? null;
  },

  /** payments.list_receipts: a page of the money received. */
  async receipts(tx: TenantTx, classified: boolean | null, page: Page): Promise<ReceiptRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<ReceiptRow>(
      `SELECT id, amount_minor, received_at, classified_account_id, classified_note, classified_at, created_at,
              ${POSITION_AT}
         FROM payments.list_receipts($1, $2, $3, $4::timestamptz, $5)`,
      [sessionId, classified, page.limit, page.after?.at ?? null, page.after?.id ?? null],
    );
  },

  /** payments.classify_receipt (Q1): what the money was for. */
  async classify(
    tx: TenantTx,
    receiptId: string,
    accountId: string,
    note: string | null,
    ctx: RequestContext,
  ): Promise<ClassifyWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<ClassifyWrite>(
      `SELECT outcome, id, amount_minor, classified_account_id, classified_note, classified_at, received_at, created_at
         FROM payments.classify_receipt($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, receiptId, accountId, note, ctx.ip, ctx.userAgent, ctx.requestId],
    );
    return row!;
  },
} satisfies Record<string, (tx: TenantTx, ...args: never[]) => Promise<unknown>>;
