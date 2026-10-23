import type {
  CreatePlatformStaffRequest,
  PlatformStaffList,
  PlatformStaffMember,
} from '@alphakolect/contracts';
import { refusalMessage } from '../../platform/authorization.js';
import type { Db, Queryable } from '../../platform/db.js';
import type { Mailer } from '../../platform/email.js';
import { AppError } from '../../platform/errors.js';
import type { AuthContext } from '../../platform/http/authenticate.js';
import { decodeCursor, pageOf, POSITION_AT } from '../../platform/pagination.js';
import type { AuditLog } from '../audit/index.js';
import { ACCOUNT_SETUP_TTL_SECONDS, accountSetupEmail } from '../identity/index.js';
import type { RequestContext } from '../../platform/request-context.js';
import { newOpaqueToken } from '../identity/index.js';

// The platform team (P5.7; P5 plan §7.4, §7.5; owner decisions D4, O8(a), O8(b)). Only the super admin manages it
// (platform.staff.manage, reserved): the router's policy middleware refuses anyone else first, and each database
// function decides again under its locks, from the caller's session, and writes the change's audit row itself
// (pattern A). A refusal by the database is recorded best effort and answered as P4 answers its refusals. A new staff
// member is created without a password and without permissions, and is sent the account-setup link (best effort,
// after the commit, as for invitations); signing in then requires MFA enrolment, as for every platform identity.

type StaffRow = {
  id: string;
  email: string;
  role: PlatformStaffMember['role'];
  status: PlatformStaffMember['status'];
  permissions: string[];
  created_at: Date;
  deactivated_at: Date | null;
  position_at: string;
};
type StatusAction = 'deactivate' | 'reactivate';

const LIST_SCOPE = 'listPlatformStaff';
const STATUS_ACTION = {
  deactivate: 'platform.staff_deactivated',
  reactivate: 'platform.staff_reactivated',
} as const satisfies Record<StatusAction, string>;

const toStaffMember = (row: StaffRow): PlatformStaffMember => ({
  platformMembershipId: row.id,
  email: row.email,
  role: row.role,
  status: row.status,
  permissions: row.permissions,
  createdAt: row.created_at.toISOString(),
  deactivatedAt: row.deactivated_at?.toISOString() ?? null,
});

/** The team through identity.list_platform_staff (B1): a page, or one member when an id is given. */
async function staffRows(
  q: Queryable,
  sessionId: string,
  options: { membershipId?: string; limit: number; after?: { at: string; id: string } | null },
): Promise<StaffRow[]> {
  return q.query<StaffRow>(
    `SELECT id, email, role, status, permissions, created_at, deactivated_at, ${POSITION_AT}
       FROM identity.list_platform_staff($1, $2, $3, $4::timestamptz, $5)`,
    [
      sessionId,
      options.membershipId ?? null,
      options.limit,
      options.after?.at ?? null,
      options.after?.id ?? null,
    ],
  );
}

/** The member a write just changed, read back in its transaction (the answer the contract promises). */
async function readBack(q: Queryable, sessionId: string, membershipId: string): Promise<PlatformStaffMember> {
  const [row] = await staffRows(q, sessionId, { membershipId, limit: 1 });
  if (!row) throw new Error('a platform staff member was not found right after a change');
  return toStaffMember(row);
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Staff member not found');
const forbidden = () => new AppError(403, 'FORBIDDEN', refusalMessage('platform.staff.manage'));

export class PlatformStaffService {
  constructor(
    private readonly deps: {
      db: Db;
      audit: Pick<AuditLog, 'recordBestEffort'>;
      mailer: Pick<Mailer, 'dispatch'>;
      webAppUrl: string;
    },
  ) {}

  async list(auth: AuthContext, query: { cursor?: string; limit: number }): Promise<PlatformStaffList> {
    const after = decodeCursor(query.cursor, LIST_SCOPE);
    const rows = await this.deps.db.transaction((tx) =>
      staffRows(tx, auth.sessionId, { limit: query.limit, after }),
    );
    return pageOf(rows, query.limit, LIST_SCOPE, toStaffMember);
  }

  async create(
    auth: AuthContext,
    input: CreatePlatformStaffRequest,
    ctx: RequestContext,
  ): Promise<PlatformStaffMember> {
    const { db, audit, mailer, webAppUrl } = this.deps;
    const setup = newOpaqueToken();
    // On success the function wrote #30 itself, in this transaction (pattern A); the member is read back in it.
    const result = await db.transaction(async (tx) => {
      const [row] = await tx.query<{ outcome: string; membership_id: string | null }>(
        `SELECT outcome, membership_id FROM identity.create_platform_staff($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          auth.sessionId,
          input.email,
          input.role,
          setup.hash,
          ACCOUNT_SETUP_TTL_SECONDS,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      );
      const created = row!;
      if (created.outcome !== 'ok') return { outcome: created.outcome, member: null };
      return { outcome: created.outcome, member: await readBack(tx, auth.sessionId, created.membership_id!) };
    });

    if (result.outcome !== 'ok') {
      await audit.recordBestEffort({
        ...this.event(auth, null, ctx),
        action: 'platform.staff_created',
        outcome: 'denied',
        summary: { reason: result.outcome },
      });
      if (result.outcome === 'email_in_use') {
        throw new AppError(409, 'EMAIL_IN_USE', 'This email already has an account; use another address');
      }
      throw forbidden();
    }
    // Sent only after the commit: an email never announces a staff member who does not exist.
    mailer.dispatch(accountSetupEmail(result.member!.email, webAppUrl, setup.raw));
    return result.member!;
  }

  async setStatus(
    auth: AuthContext,
    membershipId: string,
    action: StatusAction,
    ctx: RequestContext,
  ): Promise<PlatformStaffMember> {
    // On success the function wrote #31 or #37 itself, in this transaction (pattern A).
    const result = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.query<{ outcome: string }>(
        `SELECT outcome FROM identity.set_platform_staff_status($1, $2, $3, $4, $5, $6)`,
        [auth.sessionId, membershipId, action, ctx.ip, ctx.userAgent, ctx.requestId],
      );
      const outcome = row!.outcome;
      if (outcome !== 'ok') return { outcome, member: null };
      return { outcome, member: await readBack(tx, auth.sessionId, membershipId) };
    });
    if (result.outcome === 'ok') return result.member!;

    await this.deps.audit.recordBestEffort({
      ...this.event(auth, membershipId, ctx),
      action: STATUS_ACTION[action],
      outcome: result.outcome === 'forbidden' ? 'denied' : 'failure',
      summary: { reason: result.outcome },
    });
    switch (result.outcome) {
      case 'forbidden':
        throw forbidden();
      case 'not_found':
        throw notFound();
      default:
        throw new AppError(
          409,
          'INVALID_LIFECYCLE_TRANSITION',
          action === 'deactivate'
            ? 'The staff member is already deactivated'
            : 'The staff member is not deactivated',
        );
    }
  }

  async setPermissions(
    auth: AuthContext,
    membershipId: string,
    permissions: readonly string[],
    ctx: RequestContext,
  ): Promise<PlatformStaffMember> {
    // On success the function wrote #32 itself, in this transaction (pattern A).
    const result = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.query<{ outcome: string }>(
        `SELECT outcome FROM identity.set_platform_grants($1, $2, $3, $4, $5, $6)`,
        [auth.sessionId, membershipId, permissions, ctx.ip, ctx.userAgent, ctx.requestId],
      );
      const outcome = row!.outcome;
      if (outcome !== 'ok') return { outcome, member: null };
      return { outcome, member: await readBack(tx, auth.sessionId, membershipId) };
    });
    if (result.outcome === 'ok') return result.member!;

    await this.deps.audit.recordBestEffort({
      ...this.event(auth, membershipId, ctx),
      action: 'platform.grants_set',
      outcome: result.outcome === 'forbidden' ? 'denied' : 'failure',
      summary: { reason: result.outcome },
    });
    switch (result.outcome) {
      case 'forbidden':
        throw forbidden();
      case 'not_found':
        throw notFound();
      case 'invalid_transition':
        throw new AppError(409, 'INVALID_LIFECYCLE_TRANSITION', 'The staff member is deactivated');
      default:
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Each permission must be a platform permission a staff member can be given, listed once',
        );
    }
  }

  /** A refusal's context: the actor from the validated session; the target staff member, if any. */
  private event(auth: AuthContext, membershipId: string | null, ctx: RequestContext) {
    return {
      actorIdentityId: auth.identityId,
      actorAudience: auth.audience,
      actorMembershipId: auth.membershipId,
      targetType: 'platform_membership',
      targetId: membershipId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };
  }
}
