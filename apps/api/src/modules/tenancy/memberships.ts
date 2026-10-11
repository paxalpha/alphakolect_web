import type { AssignMemberRequest, Member } from '@alphakolect/contracts';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { requireOwner, withTenant, type TenantContext } from '../../platform/tenant.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { RequestContext } from '../identity/sessions.js';
import {
  tenancyRepository as repo,
  type MemberRow,
  type MembershipAction,
  type MembershipChange,
} from './repository.js';

// The owner manages their business's members (P4.5; ADR-15 T5, T7–T9, T15).
//
// requireOwner (T9) answers early with 403; the database functions decide authority again from the session, at the
// moment of the change, under the merchant lock — they are the boundary, this check only the courtesy. Each change
// and its audit row commit together; a refused one is audited on its own. The effect on the member is immediate:
// their next request re-reads the membership (T5), and a deactivation also revokes their sessions.

const AUDIT_ACTION: Record<MembershipAction, string> = {
  assign: 'merchant.member_assigned',
  deactivate: 'merchant.member_deactivated',
  reactivate: 'merchant.member_reactivated',
};

export const toMember = (row: MemberRow): Member => ({
  membershipId: row.membership_id,
  kind: row.kind,
  status: row.status,
  email: row.email,
  roleId: row.role_id,
  branchId: row.branch_id,
  createdAt: row.created_at.toISOString(),
  deactivatedAt: row.deactivated_at?.toISOString() ?? null,
});

function refusal(outcome: Exclude<MembershipChange['outcome'], 'ok'>, action: MembershipAction): AppError {
  switch (outcome) {
    case 'forbidden':
      return new AppError(403, 'FORBIDDEN', 'Only the business owner can do this');
    case 'owner_protected':
      return new AppError(403, 'FORBIDDEN', 'The owner’s membership changes only by an ownership transfer');
    case 'not_found':
      return new AppError(404, 'NOT_FOUND', 'Member not found');
    case 'invalid_target':
      return new AppError(409, 'INVALID_ASSIGNMENT', 'Only staff members have a role and branch');
    case 'invalid_assignment':
      return new AppError(
        409,
        'INVALID_ASSIGNMENT',
        'The role or branch is not an active one of this business',
      );
    case 'invalid_transition':
      return new AppError(
        409,
        'INVALID_LIFECYCLE_TRANSITION',
        action === 'deactivate' ? 'The member is already deactivated' : 'The member is not deactivated',
      );
  }
}

export class MembershipService {
  constructor(private readonly deps: { db: Db; audit: Pick<AuditLog, 'record' | 'recordWithin'> }) {}

  async list(tenant: TenantContext): Promise<MemberRow[]> {
    requireOwner(tenant);
    return withTenant(this.deps.db, tenant, (tx) => repo.members(tx));
  }

  async get(tenant: TenantContext, membershipId: string): Promise<MemberRow> {
    requireOwner(tenant);
    const [row] = await withTenant(this.deps.db, tenant, (tx) => repo.members(tx, membershipId));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Member not found');
    return row;
  }

  async change(
    tenant: TenantContext,
    membershipId: string,
    action: MembershipAction,
    assignment: AssignMemberRequest | null,
    ctx: RequestContext,
  ): Promise<MemberRow> {
    const event = {
      action: AUDIT_ACTION[action],
      merchantId: tenant.merchantId,
      actorIdentityId: tenant.identityId,
      actorAudience: tenant.audience,
      actorMembershipId: tenant.membershipId,
      targetType: 'membership',
      targetId: membershipId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };
    try {
      requireOwner(tenant);
    } catch (err) {
      await this.deps.audit.record({
        ...event,
        outcome: 'denied',
        summary: { reason: 'not_owner', kind: tenant.kind },
      });
      throw err;
    }

    const result = await withTenant(this.deps.db, tenant, async (tx) => {
      const change = await repo.changeMembership(tx, membershipId, action, assignment);
      if (change.outcome !== 'ok') return { change, member: null };
      const [member] = await repo.members(tx, membershipId);
      await this.deps.audit.recordWithin(tx, {
        ...event,
        outcome: 'success',
        summary: {
          kind: member!.kind,
          status: member!.status,
          roleId: member!.role_id,
          branchId: member!.branch_id,
        },
      });
      return { change, member: member! };
    });

    if (result.change.outcome !== 'ok') {
      const outcome = result.change.outcome;
      await this.deps.audit.record({
        ...event,
        outcome: outcome === 'forbidden' || outcome === 'owner_protected' ? 'denied' : 'failure',
        summary: { reason: outcome },
      });
      throw refusal(outcome, action);
    }
    return result.member!;
  }
}
