import type {
  MerchantLifecycle,
  OwnershipTransferred,
  TransferOwnershipRequest,
} from '@alphakolect/contracts';
import { AppError } from '../../platform/errors.js';
import type { Db } from '../../platform/db.js';
import type { AuthContext } from '../../platform/http/authenticate.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { RequestContext } from '../identity/sessions.js';

// Merchant lifecycle and ownership transfer — platform super admin only (TARGET_ARCHITECTURE ADR-15 T6, T9, T17;
// P4.1, P4.5).
//
// Authority is decided in the database by tenancy.set_merchant_status from the caller's session (a live,
// full-scope super-admin platform session); this service adds no permission logic of its own. Each change and its
// audit row are one transaction (ADR-15): the tenant context set below exists only so the audit row may be written
// for that merchant under RLS — the lifecycle function never reads it.

type Action = 'deactivate' | 'reactivate';
type TransferOutcome = 'ok' | 'forbidden' | 'not_found' | 'invalid_new_owner' | 'invalid_role';
type TransferRow = {
  outcome: TransferOutcome;
  former_owner_membership_id: string | null;
  former_owner_identity_id: string | null;
  new_owner_identity_id: string | null;
};

function transferRefusal(outcome: Exclude<TransferOutcome, 'ok'>): AppError {
  switch (outcome) {
    case 'forbidden':
      return new AppError(403, 'FORBIDDEN', 'Only a platform super admin may transfer ownership');
    case 'not_found':
      return new AppError(404, 'NOT_FOUND', 'Merchant not found');
    case 'invalid_new_owner':
      return new AppError(
        409,
        'INVALID_NEW_OWNER',
        'The new owner must be an active staff member of this business with a verified email',
      );
    case 'invalid_role':
      return new AppError(409, 'INVALID_ASSIGNMENT', 'The role is not an active one of this business');
  }
}
type Outcome = 'ok' | 'forbidden' | 'not_found' | 'invalid_transition' | 'invalid_reason';
type Row = { outcome: Outcome; status: MerchantLifecycle['status'] | null };

const AUDIT_ACTION = {
  deactivate: 'platform.merchant_deactivated',
  reactivate: 'platform.merchant_reactivated',
} as const satisfies Record<Action, string>;

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
  constructor(private readonly deps: { db: Db; audit: Pick<AuditLog, 'recordBestEffort'> }) {}

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

    // The function writes the change's audit row itself, in its transaction: if that insert fails, the status change
    // rolls back with it (pattern A, §8.1).
    const row = await db.transaction(async (tx) => {
      const [result] = await tx.query<Row>(
        `SELECT outcome, status FROM tenancy.set_merchant_status($1, $2, $3, $4, $5, $6, $7)`,
        [auth.sessionId, merchantId, action, reason, ctx.ip, ctx.userAgent, ctx.requestId],
      );
      return result!;
    });

    if (row.outcome !== 'ok') {
      // Nothing changed; the refused attempt is recorded on its own, best effort (tenant-less: the target may not
      // exist).
      await audit.recordBestEffort({
        ...event,
        outcome: row.outcome === 'forbidden' ? 'denied' : 'failure',
        summary: { reason: row.outcome },
      });
      throw refusal(row.outcome, row.status);
    }
    return { merchantId, status: row.status! };
  }

  /**
   * ADR-15 T17: one database transaction — tenancy.transfer_ownership (authority from the session, demote then
   * promote) and the audit row naming both identities. A refusal changes nothing and is audited on its own.
   */
  async transferOwnership(
    auth: AuthContext,
    merchantId: string,
    input: TransferOwnershipRequest,
    ctx: RequestContext,
  ): Promise<OwnershipTransferred> {
    const { db, audit } = this.deps;
    const event = {
      action: 'platform.ownership_transferred' as const,
      actorIdentityId: auth.identityId,
      actorAudience: auth.audience,
      actorMembershipId: auth.membershipId,
      targetType: 'merchant',
      targetId: merchantId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };

    // The function writes the transfer's audit row itself, naming both identities, in its transaction (pattern A).
    const row = await db.transaction(async (tx) => {
      const [result] = await tx.query<TransferRow>(
        `SELECT outcome, former_owner_membership_id, former_owner_identity_id, new_owner_identity_id
           FROM tenancy.transfer_ownership($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          auth.sessionId,
          merchantId,
          input.newOwnerMembershipId,
          input.formerOwnerRoleId,
          input.deactivateFormerOwner,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      );
      return result!;
    });

    if (row.outcome !== 'ok') {
      await audit.recordBestEffort({
        ...event,
        outcome: row.outcome === 'forbidden' ? 'denied' : 'failure',
        summary: { reason: row.outcome },
      });
      throw transferRefusal(row.outcome);
    }
    return {
      merchantId,
      ownerMembershipId: input.newOwnerMembershipId,
      formerOwnerMembershipId: row.former_owner_membership_id!,
    };
  }
}
