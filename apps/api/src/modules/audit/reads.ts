import type {
  AuditActor,
  MerchantAuditEventList,
  MerchantAuditEventsQuery,
  PlatformAuditEventList,
  PlatformAuditEventsQuery,
} from '@alphakolect/contracts';
import { refusalMessage } from '../../platform/authorization.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { AuthContext } from '../../platform/http/authenticate.js';
import { decodeCursor, pageOf, type Position, type Positioned } from '../../platform/pagination.js';
import type { RequestContext } from '../../platform/request-context.js';
import type { AuditLog } from './audit-log.js';

// The activity-record reads (P5.8; ADR-16 §3.5, "Addendum — the activity-record reads", confirmed 2026-10-19): the
// business's record for its owner (#33) and the platform's record (#34). Both are sensitive reads (§8.2a rule 7): each
// page is one call of its designated database function, which checks the permission under the reader's own membership
// lock, records the read and returns the rows in one transaction — this service writes no read event itself and never
// could (the writer guard). It checks the window and the cursor first (O4: at most 31 days; a cursor bound to its window
// and filters, and lying inside the window), so the database's own checks of the same rules never fire for a valid
// request. A refusal by the database is recorded best effort, as the other lists' are.

type EventRow = Positioned & {
  outcome: string;
  occurred_at: Date;
  action: string;
  event_outcome: 'success' | 'failure' | 'denied';
  has_actor: boolean;
  actor_audience: AuditActor['audience'];
  actor_membership_id: string | null;
  actor_email: string | null;
  target_type: string | null;
  target_id: string | null;
  summary: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
};
type MerchantEventRow = EventRow & { actor_label: 'AlphaKolect team' | null };
type PlatformEventRow = EventRow & { merchant_id: string | null };

/** The longest window one request may cover (O4): 31 days, in microseconds. */
const MAX_WINDOW_US = 744n * 3600n * 1_000_000n;

/**
 * An instant in microseconds since the epoch, exactly as the database reads it: a JavaScript Date keeps milliseconds,
 * so the fraction's fourth to sixth digits are added here. The value has passed the contract's ISO 8601 check.
 */
function microsOf(iso: string): bigint {
  const fraction = /\.(\d+)/.exec(iso)?.[1] ?? '';
  return BigInt(Date.parse(iso)) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3, 6));
}

const invalidWindow = () =>
  new AppError(400, 'VALIDATION_ERROR', 'The window must start before it ends and cover at most 31 days');
const invalidCursor = () => new AppError(400, 'INVALID_CURSOR', 'This cursor does not belong to this list');

/** The window's checks (O4), and the cursor's: bound to this window and these filters, and lying inside the window. */
function pageStart(
  query: { from: string; to: string; cursor?: string | undefined },
  scope: string,
): Position | null {
  const from = microsOf(query.from);
  const to = microsOf(query.to);
  if (from >= to || to - from > MAX_WINDOW_US) throw invalidWindow();
  const after = decodeCursor(query.cursor, scope);
  if (after) {
    const at = microsOf(after.at);
    if (at < from || at >= to) throw invalidCursor();
  }
  return after;
}

/** The list's identity: its window and filters, normalised — a cursor is valid only for the same ones. */
const scopeOf = (list: string, fields: Record<string, string | undefined>) =>
  [list, ...Object.entries(fields).map(([k, v]) => `${k}=${v ?? ''}`)].join('|');
const instant = (iso: string) => microsOf(iso).toString();

const actorOf = (r: EventRow): AuditActor | null =>
  r.has_actor
    ? { audience: r.actor_audience, membershipId: r.actor_membership_id, email: r.actor_email }
    : null;
const itemOf = (r: EventRow) => ({
  eventId: r.id,
  occurredAt: r.position_at,
  event: r.action,
  outcome: r.event_outcome,
  actor: actorOf(r),
  target: r.target_type !== null && r.target_id !== null ? { type: r.target_type, id: r.target_id } : null,
  summary: r.summary,
  ip: r.ip,
  userAgent: r.user_agent,
});

export class AuditReadService {
  constructor(private readonly deps: { db: Db; audit: Pick<AuditLog, 'recordBestEffort'> }) {}

  /** #33: the business's record, for its owner. */
  async merchant(
    auth: AuthContext,
    query: MerchantAuditEventsQuery,
    ctx: RequestContext,
  ): Promise<MerchantAuditEventList> {
    const scope = scopeOf('listMerchantAuditEvents', {
      from: instant(query.from),
      to: instant(query.to),
      membershipId: query.membershipId,
    });
    const after = pageStart(query, scope);
    // One transaction, one call: the function records #33 in the business's record and returns the page.
    const rows = await this.deps.db.transaction((tx) =>
      tx.query<MerchantEventRow>(
        `SELECT outcome, id, occurred_at, position_at, action, event_outcome, has_actor, actor_audience,
                actor_membership_id, actor_email, actor_label, target_type, target_id, summary, ip, user_agent
           FROM audit.read_merchant_events($1, $2::timestamptz, $3::timestamptz, $4, $5::timestamptz, $6, $7, $8, $9, $10)`,
        [
          auth.sessionId,
          query.from,
          query.to,
          query.limit,
          after?.at ?? null,
          after?.id ?? null,
          query.membershipId ?? null,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      ),
    );
    switch (rows[0]?.outcome) {
      case 'forbidden':
        await this.refused(auth, 'merchant.audit_read', ctx);
        throw new AppError(403, 'FORBIDDEN', refusalMessage('merchant.audit.read'));
      case 'not_found':
        // Nothing was read: no event, as the other lists answer an unknown filter.
        throw new AppError(404, 'NOT_FOUND', 'Membership not found');
    }
    return pageOf(rows, query.limit, scope, (r) => ({ ...itemOf(r), actorLabel: r.actor_label }));
  }

  /** #34: the platform's record. */
  async platform(
    auth: AuthContext,
    query: PlatformAuditEventsQuery,
    ctx: RequestContext,
  ): Promise<PlatformAuditEventList> {
    const scope = scopeOf('listPlatformAuditEvents', {
      from: instant(query.from),
      to: instant(query.to),
      merchantId: query.merchantId,
      membershipId: query.membershipId,
      event: query.event,
    });
    const after = pageStart(query, scope);
    // One transaction, one call: the function records #34 (against the filtered business, if any) and returns the page.
    const rows = await this.deps.db.transaction((tx) =>
      tx.query<PlatformEventRow>(
        `SELECT outcome, id, occurred_at, position_at, merchant_id, action, event_outcome, has_actor, actor_audience,
                actor_membership_id, actor_email, target_type, target_id, summary, ip, user_agent
           FROM audit.read_platform_events($1, $2::timestamptz, $3::timestamptz, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12)`,
        [
          auth.sessionId,
          query.from,
          query.to,
          query.limit,
          after?.at ?? null,
          after?.id ?? null,
          query.merchantId ?? null,
          query.membershipId ?? null,
          query.event ?? null,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      ),
    );
    switch (rows[0]?.outcome) {
      case 'forbidden':
        await this.refused(auth, 'platform.audit_read', ctx);
        throw new AppError(403, 'FORBIDDEN', refusalMessage('platform.audit.read'));
      case 'not_found':
        throw new AppError(404, 'NOT_FOUND', 'Merchant or membership not found');
      case 'invalid_event':
        throw new AppError(400, 'VALIDATION_ERROR', 'Unknown event identifier');
    }
    return pageOf(rows, query.limit, scope, (r) => ({ ...itemOf(r), merchantId: r.merchant_id }));
  }

  /** A refusal by the database: recorded best effort, with the actor from the validated session (§8.2a rule 5). */
  private async refused(
    auth: AuthContext,
    action: 'merchant.audit_read' | 'platform.audit_read',
    ctx: RequestContext,
  ) {
    await this.deps.audit.recordBestEffort({
      action,
      outcome: 'denied',
      actorIdentityId: auth.identityId,
      actorAudience: auth.audience,
      actorMembershipId: auth.membershipId,
      merchantId: action === 'merchant.audit_read' ? auth.merchantId : null,
      targetType: null,
      targetId: null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      summary: { reason: 'forbidden' },
    });
  }
}
