import type { Db } from '../../platform/db.js';

// Append-only audit events (TARGET_ARCHITECTURE §16, BR-11.4): who did what, when, with what outcome.
// `summary` must never contain secrets — callers pass identifiers and outcomes only.
//
// audit.audit_events is protected by row-level security (P1): the app may insert tenant-less events, or
// events of the tenant set in the transaction. Tenant events are therefore written inside a transaction that
// sets app.merchant_id to that tenant.

export type AuditEvent = {
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  merchantId?: string | null;
  actorIdentityId?: string | null;
  actorAudience?: string | null;
  actorMembershipId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  summary?: Record<string, string | number | boolean | null>;
};

export class AuditLog {
  constructor(private readonly db: Db) {}

  async record(event: AuditEvent): Promise<void> {
    const merchantId = event.merchantId ?? null;
    await this.db.transaction(async (tx) => {
      if (merchantId) await tx.query(`SELECT set_config('app.merchant_id', $1, true)`, [merchantId]);
      await tx.query(
        `INSERT INTO audit.audit_events
           (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id,
            outcome, ip, user_agent, request_id, summary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          merchantId,
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
    });
  }
}
