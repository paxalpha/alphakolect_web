import type {
  ClassifyReceiptRequest,
  FindingListQuery,
  LiveWallet,
  Money,
  PageQuery,
  Permission,
  PlatformWalletList,
  PlatformWalletRequested,
  ReconciliationFindingList,
  ResolvedFinding,
  ResolvedTransaction,
  ResolveUnmatchedRequest,
  UnmatchedTransactionList,
  WalletReceipt,
  WalletReceiptList,
  WalletReceiptQuery,
} from '@alphakolect/contracts';
import { refusalMessage } from '../../platform/authorization.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { AuthContext } from '../../platform/http/authenticate.js';
import { decodeCursor, pageOf, POSITION_AT, type Positioned } from '../../platform/pagination.js';
import type { RequestContext } from '../../platform/request-context.js';
import { withTenant, type TenantContext } from '../../platform/tenant.js';
import type { AuditLog } from '../audit/index.js';
import type { RateLimiter } from '../identity/index.js';
import type { PaymentProvider } from '../../integrations/payments/provider.js';
import { paymentsRepository as repo, type ReceiptFields } from './repository.js';

// Payments (P9; docs/architecture/P9_IMPLEMENTATION_PLAN.md; the owner's answers of 2026-10-26). The business's reads and
// command through its session; the platform team's lists are sensitive reads — one call of a designated function, which
// checks the permission under the reader's lock, records the read and returns the page in one transaction; a webhook's
// notification is stored and acknowledged, and nothing in it is believed (the worker asks the provider, P9-2).

const money = (amountMinor: string): Money => ({ amountMinor, currency: 'NGN' });
const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

const toReceipt = (r: ReceiptFields): WalletReceipt => ({
  receiptId: r.id,
  amount: money(r.amount_minor),
  receivedAt: isoOrNull(r.received_at),
  classifiedAccountId: r.classified_account_id,
  classifiedNote: r.classified_note,
  classifiedAt: isoOrNull(r.classified_at),
  createdAt: iso(r.created_at),
});

type WalletRow = Positioned & {
  outcome: string;
  owner_kind: 'merchant' | 'platform' | 'customer';
  merchant_id: string | null;
  merchant_name: string | null;
  status: 'provisioning' | 'active' | 'failed' | 'closed';
  account_number: string | null;
  bank_name: string | null;
  attempts: number;
  last_error: string | null;
  books_minor: string | null;
  created_at: Date;
};
type UnmatchedRow = Positioned & {
  outcome: string;
  provider: string;
  provider_tx_id: string;
  account_number: string | null;
  amount_minor: string;
  provider_status: 'successful' | 'failed' | 'reversed';
  matched: 'unmatched' | 'review';
  merchant_id: string | null;
  occurred_at: Date | null;
  created_at: Date;
};
type FindingRow = Positioned & {
  outcome: string;
  scope: 'wallet' | 'pooled';
  wallet_id: string | null;
  merchant_id: string | null;
  provider_minor: string;
  books_minor: string;
  status: 'open' | 'resolved';
  found_at: Date;
  last_seen_at: Date;
  resolution_note: string | null;
  resolved_at: Date | null;
};
/** The findings' list orders by when they were found: its position is that time. */
const FINDING_POSITION = `to_char(found_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS position_at`;

type DeniedAction =
  | 'payments.receipt_classified'
  | 'payments.unmatched_resolved'
  | 'payments.finding_resolved'
  | 'payments.platform_wallet_requested'
  | 'platform.wallets_read'
  | 'platform.unmatched_read'
  | 'platform.findings_read';

const transition = (message: string) => new AppError(409, 'INVALID_LIFECYCLE_TRANSITION', message);
const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found');

/** A notification's headers worth keeping: never a cookie or an authorization, whatever arrives. */
const KEPT_HEADER = /^(content-type|user-agent|.*signature.*|.*hash.*)$/i;
const BODY_LIMIT = 65_536;

export type PaymentsDeps = {
  db: Db;
  audit: Pick<AuditLog, 'recordBestEffort'>;
  limiter: Pick<RateLimiter, 'enforce'>;
  provider: PaymentProvider;
};

export class PaymentsService {
  constructor(private readonly deps: PaymentsDeps) {}

  // ── the business (Q1) ──

  async wallet(tenant: TenantContext): Promise<LiveWallet> {
    const row = await withTenant(this.deps.db, tenant, (tx) => repo.wallet(tx));
    if (!row) {
      return {
        status: 'none',
        accountNumber: null,
        accountName: null,
        bankName: null,
        balance: money('0'),
        toClassify: money('0'),
        activatedAt: null,
      };
    }
    return {
      status: row.status,
      accountNumber: row.account_number,
      accountName: row.account_name,
      bankName: row.bank_name,
      balance: money(row.balance_minor),
      toClassify: money(row.to_classify_minor),
      activatedAt: isoOrNull(row.activated_at),
    };
  }

  async receipts(tenant: TenantContext, query: WalletReceiptQuery): Promise<WalletReceiptList> {
    const scope = `listWalletReceipts|classified=${query.classified ?? ''}`;
    const after = decodeCursor(query.cursor, scope);
    const classified = query.classified === undefined ? null : query.classified === 'true';
    const rows = await withTenant(this.deps.db, tenant, (tx) =>
      repo.receipts(tx, classified, { limit: query.limit, after }),
    );
    return pageOf(rows, query.limit, scope, toReceipt);
  }

  async classify(
    tenant: TenantContext,
    receiptId: string,
    input: ClassifyReceiptRequest,
    ctx: RequestContext,
  ): Promise<WalletReceipt> {
    const r = await withTenant(this.deps.db, tenant, (tx) =>
      repo.classify(tx, receiptId, input.accountId, input.note ?? null, ctx),
    );
    switch (r.outcome) {
      case 'ok':
        return {
          receiptId: r.id!,
          amount: money(r.amount_minor!),
          receivedAt: isoOrNull(r.received_at),
          classifiedAccountId: r.classified_account_id,
          classifiedNote: r.classified_note,
          classifiedAt: isoOrNull(r.classified_at),
          createdAt: iso(r.created_at!),
        };
      case 'forbidden':
        await this.deps.audit.recordBestEffort({
          action: 'payments.receipt_classified',
          outcome: 'denied',
          merchantId: tenant.merchantId,
          actorIdentityId: tenant.identityId,
          actorAudience: tenant.audience,
          actorMembershipId: tenant.membershipId,
          targetType: 'payments_receipt',
          targetId: receiptId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          summary: { reason: 'forbidden' },
        });
        throw new AppError(403, 'FORBIDDEN', refusalMessage('merchant.wallet.classify'));
      case 'not_found':
        throw new AppError(404, 'NOT_FOUND', 'Receipt not found');
      case 'invalid_status':
        throw new AppError(409, 'ALREADY_CLASSIFIED', 'This money has been classified already');
      case 'invalid_account':
        throw new AppError(422, 'INVALID_ACCOUNT', 'Choose one of the business’s own active accounts');
      case 'invalid':
        throw new AppError(400, 'VALIDATION_ERROR', 'The note is not valid');
    }
  }

  // ── the platform team: sensitive reads ──

  async platformWallets(
    auth: AuthContext,
    query: PageQuery,
    ctx: RequestContext,
  ): Promise<PlatformWalletList> {
    const scope = 'listPlatformWallets';
    const after = decodeCursor(query.cursor, scope);
    const rows = await this.deps.db.transaction((tx) =>
      tx.query<WalletRow>(
        `SELECT outcome, id, owner_kind, merchant_id, merchant_name, status, account_number, bank_name, attempts,
                last_error, books_minor, created_at, ${POSITION_AT}
           FROM payments.platform_list_wallets($1, $2, $3::timestamptz, $4, $5, $6, $7)`,
        [
          auth.sessionId,
          query.limit,
          after?.at ?? null,
          after?.id ?? null,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      ),
    );
    if (rows[0]?.outcome === 'forbidden')
      throw await this.refused(auth, 'platform.wallets_read', 'platform.payments.read', null, ctx);
    return pageOf(rows, query.limit, scope, (r) => ({
      walletId: r.id,
      ownerKind: r.owner_kind,
      merchantId: r.merchant_id,
      merchantName: r.merchant_name,
      status: r.status,
      accountNumber: r.account_number,
      bankName: r.bank_name,
      attempts: r.attempts,
      lastError: r.last_error,
      books: r.books_minor === null ? null : money(r.books_minor),
      createdAt: iso(r.created_at),
    }));
  }

  async platformUnmatched(
    auth: AuthContext,
    query: PageQuery,
    ctx: RequestContext,
  ): Promise<UnmatchedTransactionList> {
    const scope = 'listPlatformUnmatched';
    const after = decodeCursor(query.cursor, scope);
    const rows = await this.deps.db.transaction((tx) =>
      tx.query<UnmatchedRow>(
        `SELECT outcome, id, provider, provider_tx_id, account_number, amount_minor, provider_status, matched,
                merchant_id, occurred_at, created_at, ${POSITION_AT}
           FROM payments.platform_list_unmatched($1, $2, $3::timestamptz, $4, $5, $6, $7)`,
        [
          auth.sessionId,
          query.limit,
          after?.at ?? null,
          after?.id ?? null,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      ),
    );
    if (rows[0]?.outcome === 'forbidden')
      throw await this.refused(auth, 'platform.unmatched_read', 'platform.payments.read', null, ctx);
    return pageOf(rows, query.limit, scope, (r) => ({
      transactionId: r.id,
      provider: r.provider,
      providerTxId: r.provider_tx_id,
      accountNumber: r.account_number,
      amount: money(r.amount_minor),
      providerStatus: r.provider_status,
      matched: r.matched,
      merchantId: r.merchant_id,
      occurredAt: isoOrNull(r.occurred_at),
      confirmedAt: iso(r.created_at),
    }));
  }

  async platformFindings(
    auth: AuthContext,
    query: FindingListQuery,
    ctx: RequestContext,
  ): Promise<ReconciliationFindingList> {
    const scope = `listPlatformFindings|status=${query.status}`;
    const after = decodeCursor(query.cursor, scope);
    const rows = await this.deps.db.transaction((tx) =>
      tx.query<FindingRow>(
        `SELECT outcome, id, scope, wallet_id, merchant_id, provider_minor, books_minor, status, found_at, last_seen_at,
                resolution_note, resolved_at, ${FINDING_POSITION}
           FROM payments.platform_list_findings($1, $2, $3, $4::timestamptz, $5, $6, $7, $8)`,
        [
          auth.sessionId,
          query.limit,
          query.status === 'open',
          after?.at ?? null,
          after?.id ?? null,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      ),
    );
    if (rows[0]?.outcome === 'forbidden')
      throw await this.refused(auth, 'platform.findings_read', 'platform.payments.read', null, ctx);
    return pageOf(rows, query.limit, scope, (r) => ({
      findingId: r.id,
      scope: r.scope,
      walletId: r.wallet_id,
      merchantId: r.merchant_id,
      provider: money(r.provider_minor),
      books: money(r.books_minor),
      status: r.status,
      foundAt: iso(r.found_at),
      lastSeenAt: iso(r.last_seen_at),
      resolutionNote: r.resolution_note,
      resolvedAt: isoOrNull(r.resolved_at),
    }));
  }

  // ── the platform team: resolutions (Q4, Q5) and the Platform Live wallet (Q6) ──

  async resolveUnmatched(
    auth: AuthContext,
    transactionId: string,
    input: ResolveUnmatchedRequest,
    ctx: RequestContext,
  ): Promise<ResolvedTransaction> {
    const r = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.query<{
        outcome: string;
        id: string;
        resolution: ResolvedTransaction['resolution'];
        merchant_id: string | null;
        resolved_at: Date;
      }>(
        `SELECT outcome, id, resolution, merchant_id, resolved_at
           FROM payments.resolve_unmatched($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          auth.sessionId,
          transactionId,
          input.resolution,
          input.walletId ?? null,
          input.note,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      );
      return row!;
    });
    switch (r.outcome) {
      case 'ok':
        return {
          transactionId: r.id,
          resolution: r.resolution,
          merchantId: r.merchant_id,
          resolvedAt: iso(r.resolved_at),
        };
      case 'forbidden':
        throw await this.refused(
          auth,
          'payments.unmatched_resolved',
          'platform.payments.resolve',
          transactionId,
          ctx,
        );
      case 'not_found':
        throw notFound();
      case 'invalid_status':
        throw transition('This transaction is resolved already, or it cannot be credited');
      case 'invalid_wallet':
        throw new AppError(422, 'INVALID_WALLET', 'Choose an active business wallet');
      default:
        throw new AppError(400, 'VALIDATION_ERROR', 'The resolution is not valid');
    }
  }

  async resolveFinding(
    auth: AuthContext,
    findingId: string,
    note: string,
    ctx: RequestContext,
  ): Promise<ResolvedFinding> {
    const r = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.query<{
        outcome: string;
        id: string;
        resolution_note: string;
        resolved_at: Date;
      }>(
        `SELECT outcome, id, resolution_note, resolved_at FROM payments.resolve_finding($1, $2, $3, $4, $5, $6)`,
        [auth.sessionId, findingId, note, ctx.ip, ctx.userAgent, ctx.requestId],
      );
      return row!;
    });
    switch (r.outcome) {
      case 'ok':
        return { findingId: r.id, resolutionNote: r.resolution_note, resolvedAt: iso(r.resolved_at) };
      case 'forbidden':
        throw await this.refused(
          auth,
          'payments.finding_resolved',
          'platform.payments.resolve',
          findingId,
          ctx,
        );
      case 'not_found':
        throw notFound();
      case 'invalid_status':
        throw transition('This difference is resolved already');
      default:
        throw new AppError(400, 'VALIDATION_ERROR', 'The note is not valid');
    }
  }

  async requestPlatformWallet(auth: AuthContext, ctx: RequestContext): Promise<PlatformWalletRequested> {
    const r = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.query<{
        outcome: string;
        id: string;
        status: PlatformWalletRequested['status'];
        created_at: Date;
      }>(`SELECT outcome, id, status, created_at FROM payments.request_platform_wallet($1, $2, $3, $4, $5)`, [
        auth.sessionId,
        this.deps.provider.name,
        ctx.ip,
        ctx.userAgent,
        ctx.requestId,
      ]);
      return row!;
    });
    if (r.outcome === 'forbidden')
      throw await this.refused(
        auth,
        'payments.platform_wallet_requested',
        'platform.wallet.create',
        null,
        ctx,
      );
    if (r.outcome === 'exists')
      throw new AppError(409, 'ALREADY_EXISTS', 'The Platform Live wallet exists already');
    return { walletId: r.id, status: r.status, createdAt: iso(r.created_at) };
  }

  // ── the webhook (TA-8): stored, then acknowledged; believed never ──

  async receiveEvent(
    raw: unknown,
    body: string,
    headers: Readonly<Record<string, string | string[] | undefined>>,
    ctx: RequestContext,
  ): Promise<void> {
    const { db, limiter, provider } = this.deps;
    await limiter.enforce('provider_webhook', ctx.ip, provider.name);
    if (body.length > BODY_LIMIT)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'This notification is too large');
    let reference: string | null = null;
    try {
      reference = provider.parseEvent(raw, {}).providerTxId ?? null;
    } catch {
      // Not recognised: stored anyway, and rejected by the worker since there is nothing to confirm it with.
    }
    const kept = Object.fromEntries(
      Object.entries(headers).filter(([name, value]) => KEPT_HEADER.test(name) && typeof value === 'string'),
    );
    await db.transaction(async (tx) => {
      await tx.query(`SELECT payments.store_event($1, $2, $3, $4)`, [
        provider.name,
        JSON.stringify(kept),
        body,
        reference,
      ]);
    });
  }

  /** A refusal by the database alone (a permission withdrawn between the two checks), recorded best effort. */
  private async refused(
    auth: AuthContext,
    action: Exclude<DeniedAction, 'payments.receipt_classified'>,
    permission: Permission,
    targetId: string | null,
    ctx: RequestContext,
  ): Promise<AppError> {
    await this.deps.audit.recordBestEffort({
      action,
      outcome: 'denied',
      actorIdentityId: auth.identityId,
      actorAudience: 'platform',
      actorMembershipId: auth.membershipId,
      targetType: targetId ? 'payments' : null,
      targetId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      summary: { reason: 'forbidden' },
    });
    return new AppError(403, 'FORBIDDEN', refusalMessage(permission));
  }
}
