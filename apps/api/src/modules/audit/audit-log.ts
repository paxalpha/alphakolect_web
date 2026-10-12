import type { Logger } from 'pino';
import type { Db, Queryable } from '../../platform/db.js';
import {
  catalogEntry,
  hasBestEffortPair,
  TRANSITIONAL_PAIRS,
  type BestEffortPair,
  type PatternBPair,
  type TransitionalPair,
} from './catalog.js';

// Append-only audit events (TARGET_ARCHITECTURE §16, BR-11.4; ADR-16 §3.5 "Audit (Part 1)"): who did what, when, with
// what outcome. `summary` never contains secrets — identifiers and outcomes only; the database refuses any field its
// catalog does not allow (audit.event_catalog and its trigger, P5.3a).
//
// One writer per class (P5 plan §8.1), each accepting only its own class, so a caller can never choose a weaker one:
//   mutateAudited(tx, event)   atomic pattern B — inside the change's transaction: the change and its event commit
//                              together or not at all (identity flows, §8.4)
//   recordBestEffort(event)    best effort — its own transaction: a failure never changes the response, it is logged
//                              as a §9.4 signal
//   recordWithin(tx, event)    transitional only — P4's tenancy and platform pattern-A pairs until their definer
//                              functions write them (P5.5); the closed list is TRANSITIONAL_PAIRS
// Sensitive reads have no TypeScript writer at all (database-owned, §8.2a rule 7).
//
// audit.audit_events is protected by row-level security (P1): the app may insert tenant-less events, or events of the
// tenant set in the transaction, so a tenant event is written in a transaction that sets app.merchant_id to that
// tenant.

export type AuditContext = {
  merchantId?: string | null;
  actorIdentityId?: string | null;
  actorAudience?: string | null;
  actorMembershipId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  summary?: Readonly<Record<string, string | number | boolean | null>>;
};

/** Any event, before its class is checked (internal: the entry points narrow it). */
export type AuditEvent = AuditContext & { action: string; outcome: 'success' | 'failure' | 'denied' };

/** §9.4: the closed list of audit signals. Each is one error-level log line — never summary values or personal data. */
export type AuditSignal = 'audit_write_failure' | 'audit_validation_failure' | 'audit_denial_write_failure';

/** A programming error in an audit call (unknown event, wrong class, wrong entry point): it always fails the request. */
export class AuditUsageError extends Error {
  override name = 'AuditUsageError';
}

const TRANSITIONAL: ReadonlySet<string> = new Set(TRANSITIONAL_PAIRS);

/** The catalog trigger's refusal (P5.3a migration): check_violation named audit_event_catalog. */
const isCatalogRefusal = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  (err as { constraint?: unknown }).constraint === 'audit_event_catalog';
const sqlState = (err: unknown) =>
  typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string'
    ? (err as { code: string }).code
    : 'unknown';

function requireClass(
  event: AuditEvent,
  entryPoint: string,
  accepts: (cls: string, pattern: string | null) => boolean,
) {
  const entry = catalogEntry(event.action, event.outcome);
  if (!entry || !accepts(entry.class, entry.pattern)) {
    throw new AuditUsageError(
      `${entryPoint} does not write ${event.action}/${event.outcome}` +
        (entry
          ? ` (class ${entry.class}${entry.pattern ? `, pattern ${entry.pattern}` : ''})`
          : ' (not in the catalog)'),
    );
  }
}

export class AuditLog {
  constructor(
    private readonly db: Db,
    private readonly logger: Pick<Logger, 'error'>,
  ) {}

  /**
   * Atomic, pattern B (§8.1, §8.4): insert the event inside the change's own transaction `tx`, before it commits. Any
   * failure — a wrong event, a refusal by the catalog, a storage error — throws, so the change rolls back with it.
   */
  async mutateAudited(tx: Queryable, event: AuditContext & PatternBPair): Promise<void> {
    requireClass(event, 'mutateAudited', (cls, pattern) => cls === 'atomic' && pattern === 'B');
    await scopeTo(tx, event.merchantId ?? null);
    await insert(tx, event);
  }

  /**
   * Transitional (§10 P5.3a, until P5.5): one of P4's pattern-A pairs, written by P4's code in the change's own
   * transaction. Atomic like mutateAudited; accepted only for the pairs of TRANSITIONAL_PAIRS.
   */
  async recordWithin(tx: Queryable, event: AuditContext & TransitionalPair): Promise<void> {
    requireClass(event, 'recordWithin', (cls, pattern) => cls === 'atomic' && pattern === 'A');
    if (!TRANSITIONAL.has(`${event.action}/${event.outcome}`)) {
      throw new AuditUsageError(
        `recordWithin does not write ${event.action}/${event.outcome} (not transitional)`,
      );
    }
    await insert(tx, event);
  }

  /**
   * Best effort (§8.1, §8.2a rule 5): in its own transaction; the response in hand never depends on it.
   *   - an unknown identifier, or an event the catalog lists as atomic or sensitive read, is a programming error:
   *     it throws, so the request fails (500) — a typo can never turn a mandatory audit into a silent one;
   *   - for a known best-effort identifier, a disallowed outcome or summary value is not stored and logged as
   *     audit_validation_failure; a storage failure as audit_write_failure (audit_denial_write_failure for a denial).
   */
  async recordBestEffort(event: AuditContext & BestEffortPair): Promise<void> {
    const entry = catalogEntry(event.action, event.outcome);
    if (!entry) {
      if (!hasBestEffortPair(event.action)) {
        throw new AuditUsageError(`recordBestEffort: ${event.action} is not a best-effort event`);
      }
      this.signal('audit_validation_failure', event, 'outcome_not_in_catalog');
      return;
    }
    if (entry.class !== 'best_effort') {
      throw new AuditUsageError(
        `recordBestEffort does not write ${event.action}/${event.outcome} (class ${entry.class}): never downgraded`,
      );
    }
    try {
      await this.db.transaction(async (tx) => {
        if (event.merchantId)
          await tx.query(`SELECT set_config('app.merchant_id', $1, true)`, [event.merchantId]);
        await insert(tx, event);
      });
    } catch (err) {
      if (isCatalogRefusal(err)) this.signal('audit_validation_failure', event, sqlState(err));
      else
        this.signal(
          event.outcome === 'denied' ? 'audit_denial_write_failure' : 'audit_write_failure',
          event,
          sqlState(err),
        );
    }
  }

  /** §9.4: the event identifier, the request id and a reason code — never summary values, tokens or personal data. */
  private signal(signal: AuditSignal, event: AuditEvent, reason: string): void {
    this.logger.error(
      { signal, event: `${event.action}/${event.outcome}`, requestId: event.requestId ?? null, reason },
      signal,
    );
  }
}

/**
 * A tenant event of a pattern-B flow (identity flows run without a tenant context): set its tenant for the rest of the
 * transaction (RLS on the activity record). A transaction already scoped to another tenant is a programming error.
 */
async function scopeTo(tx: Queryable, merchantId: string | null): Promise<void> {
  if (!merchantId) return;
  const [row] = await tx.query<{ current: string | null }>(
    `SELECT nullif(current_setting('app.merchant_id', true), '') AS current`,
  );
  if (row?.current === merchantId) return;
  if (row?.current) throw new AuditUsageError('mutateAudited: the transaction is scoped to another tenant');
  await tx.query(`SELECT set_config('app.merchant_id', $1, true)`, [merchantId]);
}

async function insert(tx: Queryable, event: AuditEvent): Promise<void> {
  await tx.query(
    `INSERT INTO audit.audit_events
       (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id,
        outcome, ip, user_agent, request_id, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      event.merchantId ?? null,
      event.actorIdentityId ?? null,
      event.actorAudience ?? null,
      event.actorMembershipId ?? null,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      event.outcome,
      event.ip ?? null,
      event.userAgent?.slice(0, 512) ?? null,
      event.requestId ?? null,
      JSON.stringify(event.summary ?? {}),
    ],
  );
}
