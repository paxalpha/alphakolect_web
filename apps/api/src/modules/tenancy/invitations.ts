import type { AcceptInvitationRequest, CreateInvitationRequest, Invitation } from '@alphakolect/contracts';
import type { Db } from '../../platform/db.js';
import type { Mailer } from '../../platform/email.js';
import { AppError } from '../../platform/errors.js';
import { withTenant, type TenantContext } from '../../platform/tenant.js';
import type { AuditLog } from '../audit/audit-log.js';
import { INVITATION_TTL_SECONDS, invitationAcceptEmail, invitationSetupEmail } from '../identity/emails.js';
import { burnPasswordCheck, verifyPassword } from '../identity/passwords.js';
import type { RateLimiter } from '../identity/rate-limits.js';
import type { IdentityRepository } from '../identity/repository.js';
import type { RequestContext } from '../identity/sessions.js';
import { hashReceivedToken, newOpaqueToken } from '../identity/tokens.js';
import { tenancyRepository as repo, type InvitationRow } from './repository.js';

// Staff and agent invitations (P4.6; TARGET_ARCHITECTURE ADR-15 T10, T11, T16; D12).
//
// Issuing and revoking: whoever holds merchant.invitations.manage (checked first by the router's policy middleware,
// P5.4), through the scoped repository; the database decides authority again from the session and every rule, and
// tells this service which email to send — an account-setup link to a new person, the invitation link to an existing
// account, nothing to a disabled one. The issuer's answer never reveals which (D12).
// Acceptance by an existing account: the invitation link plus that account's password (T11), rate-limited, one
// generic error for every failure; the database re-checks the invitation, the business and the person at that
// moment and creates the membership and consumes the invitation together. A new person joins by finishing account
// setup (identity.complete_account_setup admits their invitations, T10).

export const toInvitation = (row: InvitationRow, now = new Date()): Invitation => ({
  invitationId: row.id,
  email: row.email,
  kind: row.kind,
  roleId: row.role_id,
  branchId: row.branch_id,
  status: row.accepted_at
    ? 'accepted'
    : row.revoked_at
      ? 'revoked'
      : row.expires_at <= now
        ? 'expired'
        : 'pending',
  expiresAt: row.expires_at.toISOString(),
  createdAt: row.created_at.toISOString(),
});

const invalidInvitation = () =>
  new AppError(
    400,
    'INVALID_INVITATION',
    'This invitation cannot be used. Check the link, your email and your password, or ask for a new invitation.',
  );

export type InvitationDeps = {
  db: Db;
  identity: IdentityRepository;
  audit: Pick<AuditLog, 'recordBestEffort' | 'recordWithin'>;
  limiter: RateLimiter;
  mailer: Pick<Mailer, 'dispatch'>;
  webAppUrl: string;
};

export class InvitationService {
  constructor(private readonly deps: InvitationDeps) {}

  async list(tenant: TenantContext): Promise<InvitationRow[]> {
    return withTenant(this.deps.db, tenant, (tx) => repo.invitations(tx));
  }

  async create(
    tenant: TenantContext,
    input: CreateInvitationRequest,
    ctx: RequestContext,
  ): Promise<InvitationRow> {
    const { db, audit, limiter, mailer, webAppUrl } = this.deps;
    const event = this.event(tenant, 'merchant.invitation_issued', null, ctx);
    await limiter.enforce('invitation_issue', ctx.ip, tenant.merchantId);

    const token = newOpaqueToken();
    const setup = newOpaqueToken();
    const result = await withTenant(db, tenant, async (tx) => {
      const issued = await repo.issueInvitation(
        tx,
        {
          email: input.email,
          kind: input.kind,
          roleId: input.roleId ?? null,
          branchId: input.branchId ?? null,
        },
        token.hash,
        setup.hash,
        INVITATION_TTL_SECONDS,
      );
      if (issued.outcome !== 'ok') return { issued, row: null, business: null };
      const [row] = await repo.invitations(tx, issued.invitation_id);
      const business = await repo.merchant(tx);
      await audit.recordWithin(tx, {
        ...event,
        targetId: row!.id,
        outcome: 'success',
        // Internal record only: which delivery says whether the email had an account (never told to the owner).
        summary: {
          kind: row!.kind,
          roleId: row!.role_id,
          branchId: row!.branch_id,
          delivery: issued.delivery,
        },
      });
      return { issued, row: row!, business: business! };
    });

    const { issued, row, business } = result;
    if (issued.outcome !== 'ok') {
      await audit.recordBestEffort({
        ...event,
        outcome: issued.outcome === 'forbidden' ? 'denied' : 'failure',
        summary: { reason: issued.outcome },
      });
      if (issued.outcome === 'forbidden') {
        throw new AppError(403, 'FORBIDDEN', 'Only the business owner can do this');
      }
      throw issued.outcome === 'already_member'
        ? new AppError(409, 'ALREADY_MEMBER', 'This person is already a member of the business')
        : new AppError(409, 'INVALID_ASSIGNMENT', 'The role or branch is not an active one of this business');
    }

    // Sent only after the commit: an email never announces an invitation that does not exist.
    if (issued.delivery === 'setup') {
      mailer.dispatch(invitationSetupEmail(row!.email, webAppUrl, setup.raw, business!.name));
    } else if (issued.delivery === 'accept') {
      mailer.dispatch(invitationAcceptEmail(row!.email, webAppUrl, token.raw, business!.name));
    }
    return row!;
  }

  async revoke(tenant: TenantContext, invitationId: string, ctx: RequestContext): Promise<InvitationRow> {
    const { db, audit } = this.deps;
    const event = this.event(tenant, 'merchant.invitation_revoked', invitationId, ctx);

    const result = await withTenant(db, tenant, async (tx) => {
      const outcome = await repo.revokeInvitation(tx, invitationId);
      if (outcome !== 'ok') return { outcome, row: null };
      const [row] = await repo.invitations(tx, invitationId);
      await audit.recordWithin(tx, { ...event, outcome: 'success', summary: { kind: row!.kind } });
      return { outcome, row: row! };
    });
    if (result.outcome !== 'ok') {
      await audit.recordBestEffort({
        ...event,
        outcome: result.outcome === 'forbidden' ? 'denied' : 'failure',
        summary: { reason: result.outcome },
      });
      switch (result.outcome) {
        case 'forbidden':
          throw new AppError(403, 'FORBIDDEN', 'Only the business owner can do this');
        case 'not_found':
          throw new AppError(404, 'NOT_FOUND', 'Invitation not found');
        case 'invalid_transition':
          throw new AppError(409, 'INVALID_LIFECYCLE_TRANSITION', 'The invitation is no longer pending');
      }
    }
    return result.row!;
  }

  /** T11: an existing account joins with the invitation link and its password. */
  async accept(input: AcceptInvitationRequest, ctx: RequestContext): Promise<void> {
    const { db, identity, audit, limiter } = this.deps;
    await limiter.enforce('invitation_accept', ctx.ip, input.email);

    const candidate = await identity.loginIdentity(input.email);
    // D12: an unknown account costs the same password check as a known one and fails identically.
    const passwordOk = candidate?.password_hash
      ? await verifyPassword(input.password, candidate.password_hash)
      : await burnPasswordCheck(input.password);
    const tokenHash = hashReceivedToken(input.token);

    const event = {
      action: 'auth.invitation_accepted' as const,
      actorIdentityId: candidate?.identity_id ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };
    const fail = async (reason: string) => {
      await audit.recordBestEffort({ ...event, outcome: 'failure', summary: { reason } });
      return invalidInvitation();
    };

    if (!candidate || !passwordOk) throw await fail(candidate ? 'wrong_password' : 'unknown_account');
    if (!tokenHash) throw await fail('malformed_token');

    // The admission and its event commit together (P5.3a: #14 on the link path was written in a separate
    // transaction after the admission — now atomic, on the transitional list until P5.5's pattern-A function).
    const outcome = await db.transaction(async (tx) => {
      const [result] = await tx.query<{
        outcome: string;
        membership_id: string | null;
        merchant_id: string | null;
        invitation_id: string | null;
      }>(`SELECT outcome, membership_id, merchant_id, invitation_id FROM tenancy.accept_invitation($1, $2)`, [
        tokenHash,
        candidate.identity_id,
      ]);
      if (result!.outcome !== 'ok') return result!.outcome;
      // A tenant event: written in the business just joined (the activity record is tenant-scoped by RLS).
      await tx.query(`SELECT set_config('app.merchant_id', $1, true)`, [result!.merchant_id]);
      await audit.recordWithin(tx, {
        ...event,
        merchantId: result!.merchant_id,
        actorMembershipId: result!.membership_id,
        targetType: 'invitation',
        targetId: result!.invitation_id,
        outcome: 'success',
        summary: {},
      });
      return 'ok';
    });
    if (outcome !== 'ok') throw await fail(outcome);
  }

  private event<A extends 'merchant.invitation_issued' | 'merchant.invitation_revoked'>(
    tenant: TenantContext,
    action: A,
    targetId: string | null,
    ctx: RequestContext,
  ) {
    return {
      action,
      merchantId: tenant.merchantId,
      actorIdentityId: tenant.identityId,
      actorAudience: tenant.audience,
      actorMembershipId: tenant.membershipId,
      targetType: 'invitation',
      targetId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };
  }
}
