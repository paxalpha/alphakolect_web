import type { Authorization, EndpointContract, Permission } from '@alphakolect/contracts';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { AuditLog } from '../modules/audit/audit-log.js';
import { AppError } from './errors.js';
import type { AuthContext } from './http/authenticate.js';

// The policy decision and the router's authorization middleware (P5.4; TARGET_ARCHITECTURE ADR-16 §3.5; P5 plan §4
// invariants 3–8, §7.1, §7.6, §8.2a rule 6). This is the one place in the API that decides authority — no
// `kind === 'owner'` check or requireOwner exists anywhere else (a source guard enforces it).
//
// The decision reads the effective permissions resolved by the database on this very request (identity.
// session_authority, P5.2): owners and super admins hold their fixed sets, staff their role's grants, platform staff
// their own grants, agents nothing. It is the early check; every privileged write is decided again by the database
// under its locks (P5.5). Refusals keep P4's status and code; the message says whom to ask for a permission that can
// be given, and who alone may act for a reserved one (the owner's decision, P5.6); each is recorded as authz.denied,
// best effort.
//
// It fails closed: any error while evaluating authority ends the request with 500 INTERNAL_ERROR through the error
// handler and the authorization_resolution_failure signal (§9.4) — never next() without a decision, never a 401/403,
// never a recorded denial.

export type Actor = Pick<AuthContext, 'permissions' | 'branchId' | 'branchStatus'>;
export type PermissionRequirement = Extract<Authorization, { class: 'permission' }>;
export type Decision =
  | { allowed: true }
  | { allowed: false; status: 403; reason: 'missing_permission' }
  | { allowed: false; status: 404; reason: 'other_branch' | 'archived_branch' };

/**
 * The decision (§4, §7.6). `resource` is required for a `branch` endpoint (P7/P8): a staff member restricted to one
 * branch reaches only that branch's resources — another branch's resource is "not found" (T15), and a restriction to
 * an archived branch reaches none (fail closed, D7); no restriction (null) reaches all. `merchant_wide` endpoints are
 * not narrowed by a branch restriction (every P5 endpoint, §7.6).
 */
export function decide(
  actor: Actor,
  required: PermissionRequirement,
  resource?: { branchId: string | null },
): Decision {
  if (!actor.permissions.includes(required.permission)) {
    return { allowed: false, status: 403, reason: 'missing_permission' };
  }
  if (required.branchScope === 'merchant_wide') return { allowed: true };
  if (!resource) throw new Error('a branch-scoped decision needs the resource’s branch');
  if (actor.branchId === null) return { allowed: true };
  if (actor.branchStatus !== 'active') return { allowed: false, status: 404, reason: 'archived_branch' };
  return resource.branchId === actor.branchId
    ? { allowed: true }
    : { allowed: false, status: 404, reason: 'other_branch' };
}

const ASK_THE_OWNER = "You don't have permission to do this. Ask the business owner if you need it.";
const ASK_A_SUPER_ADMIN = "You don't have permission to do this. Ask a super admin if you need it.";
const OWNER_ONLY = 'Only the business owner can do this';
const SUPER_ADMIN_ONLY = 'Only a platform super admin can do this';

/**
 * What a refusal says, by the permission refused (the owner's answers R1–R4, 2026-10-14; P5 plan §14). A permission
 * that can be given — by the business owner through a role, or by a super admin to AlphaKolect staff — tells the
 * caller whom to ask; one reserved to the owner or to a super admin keeps P4's message, which says so. Which is which
 * is the catalog's grantable flag, and an API test compares this table with it. The two messages that ask are the
 * owner's signed answers, character for character (straight apostrophe included); a test compares them with the
 * form. Every refusal of a permission — the middleware's and the database's alike — takes its message from here.
 */
const REFUSAL_MESSAGE: Record<Permission, string> = {
  'merchant.profile.read': ASK_THE_OWNER,
  'merchant.profile.update': ASK_THE_OWNER,
  'merchant.branches.read': ASK_THE_OWNER,
  'merchant.branches.manage': ASK_THE_OWNER,
  'merchant.roles.read': ASK_THE_OWNER,
  'merchant.roles.manage': OWNER_ONLY,
  'merchant.members.read': ASK_THE_OWNER,
  'merchant.members.manage': OWNER_ONLY,
  'merchant.invitations.read': ASK_THE_OWNER,
  'merchant.invitations.manage': OWNER_ONLY,
  'merchant.audit.read': OWNER_ONLY,
  // P6: the books, grantable (the owner's answer, P6_OWNER_LEDGER_PERMISSIONS.md Q2)
  'merchant.ledger.read': ASK_THE_OWNER,
  'merchant.ledger.manage': ASK_THE_OWNER,
  'merchant.ledger.post': ASK_THE_OWNER,
  'platform.merchants.read': ASK_A_SUPER_ADMIN,
  'platform.audit.read': ASK_A_SUPER_ADMIN,
  'platform.merchants.lifecycle': 'Only a platform super admin may change a merchant’s status',
  'platform.merchants.transfer_ownership': 'Only a platform super admin may transfer ownership',
  'platform.staff.manage': SUPER_ADMIN_ONLY,
};
export const refusalMessage = (permission: Permission): string => REFUSAL_MESSAGE[permission];

/** §9.4: one error-level line — the signal and the request id, nothing else (never a message or a value). */
export function authorizationResolutionFailure(logger: Pick<Logger, 'error'>, requestId: unknown): void {
  logger.error(
    {
      signal: 'authorization_resolution_failure',
      requestId: requestId === undefined ? null : String(requestId),
    },
    'authorization_resolution_failure',
  );
}

export type AuthorizeDeps = {
  audit: Pick<AuditLog, 'recordBestEffort'>;
  logger: Pick<Logger, 'error'>;
};

/** Mounted by the router on every `permission` endpoint, and only there (route parity). */
export function authorize(endpoint: EndpointContract, deps: AuthorizeDeps): RequestHandler {
  const required = endpoint.authorization;
  if (required.class !== 'permission') {
    throw new Error(`${endpoint.id}: authorize is mounted only on permission endpoints`);
  }
  return async function authorizeRequest(req, _res, next) {
    let decision: Decision;
    let auth: AuthContext;
    try {
      if (!req.auth) throw new Error('a permission endpoint was reached without an authenticated session');
      auth = req.auth;
      // Every P5 endpoint is merchant-wide; the router refuses a branch endpoint until its resource resolver exists.
      decision = decide(auth, required);
    } catch (err) {
      authorizationResolutionFailure(deps.logger, req.id);
      next(err);
      return;
    }
    if (decision.allowed) {
      next();
      return;
    }
    try {
      await deps.audit.recordBestEffort({
        action: 'authz.denied',
        outcome: 'denied',
        merchantId: auth.merchantId,
        actorIdentityId: auth.identityId,
        actorAudience: auth.audience,
        actorMembershipId: auth.membershipId,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        requestId: String(req.id),
        summary: { operation: endpoint.id, permission: required.permission },
      });
    } catch (err) {
      next(err); // a programming error in the audit call: 500, never a silent pass
      return;
    }
    next(
      decision.status === 403
        ? new AppError(403, 'FORBIDDEN', refusalMessage(required.permission))
        : new AppError(404, 'NOT_FOUND', 'Not found'),
    );
  };
}
