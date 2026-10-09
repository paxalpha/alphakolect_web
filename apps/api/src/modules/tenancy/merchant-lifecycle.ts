import type { MerchantLifecycle } from '@alphakolect/contracts';
import { AppError } from '../../platform/errors.js';
import type { Db } from '../../platform/db.js';
import type { AuthContext } from '../../platform/http/authenticate.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { RequestContext } from '../identity/sessions.js';

// Merchant lifecycle — platform super admin only (TARGET_ARCHITECTURE ADR-15 T6, T9; P4.1).
//
// Authority is decided in the database by tenancy.set_merchant_status from the caller's session (a live,
// full-scope super-admin platform session); this service adds no permission logic of its own. Each change and its
// audit row are one transaction (ADR-15): the tenant context set below exists only so the audit row may be written
// for that merchant under RLS — the lifecycle function never reads it.

type Action = 'deactivate' | 'reactivate';
type Outcome = 'ok' | 'forbidden' | 'not_found' | 'invalid_transition' | 'invalid_reason';
type Row = { outcome: Outcome; status: MerchantLifecycle['status'] | null };

const AUDIT_ACTION: Record<Action, string> = {
  deactivate: 'platform.merchant_deactivated',
  reactivate: 'platform.merchant_reactivated',
};

function refusal(outcome: Exclude<Outcome, 'ok'>, status: string | null): AppError {
  switch (outcome) {
    case 'forbidden':
      return new AppError(403, 'FORBIDDEN', 'Only a platform super admin may change a merchant’s status');
    case 'not_found':
      return new AppError(404, 'NOT_FOUND', 'Merchant not found');
    case 'invalid_transition':
      return new AppError(
        409,
        'INVALID_LIFECYCLE_TRANSITION',
        'The merchant is not in a state that allows this',
        {
          status,
        },
      );
    case 'invalid_reason':
      return new AppError(400, 'VALIDATION_ERROR', 'A reason of 1 to 500 characters is required');
  }
}

export class MerchantLifecycleService {
  constructor(private readonly deps: { db: Db; audit: Pick<AuditLog, 'record' | 'recordWithin'> }) {}

  async change(
    auth: AuthContext,
    merchantId: string,
    action: Action,
    reason: string | null,
    ctx: RequestContext,
  ): Promise<MerchantLifecycle> {
    const { db, audit } = this.deps;
    const event = {
      action: AUDIT_ACTION[action],
      actorIdentityId: auth.identityId,
      actorAudience: auth.audience,
      actorMembershipId: auth.membershipId,
      targetType: 'merchant',
      targetId: merchantId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };

    const row = await db.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.merchant_id', $1, true)`, [merchantId]);
      const [result] = await tx.query<Row>(
        `SELECT outcome, status FROM tenancy.set_merchant_status($1, $2, $3, $4)`,
        [auth.sessionId, merchantId, action, reason],
      );
      if (result!.outcome === 'ok') {
        // Same transaction: if this insert fails, the status change rolls back with it.
        await audit.recordWithin(tx, {
          ...event,
          merchantId,
          outcome: 'success',
          summary: { status: result!.status, ...(action === 'deactivate' ? { reason } : {}) },
        });
      }
      return result!;
    });

    if (row.outcome !== 'ok') {
      // Nothing changed; the refused attempt is recorded on its own (tenant-less: the target may not exist).
      await audit.record({
        ...event,
        outcome: row.outcome === 'forbidden' ? 'denied' : 'failure',
        summary: { reason: row.outcome },
      });
      throw refusal(row.outcome, row.status);
    }
    return { merchantId, status: row.status! };
  }
}
