import { defineEndpoint, endpoints, type EndpointContract } from '@alphakolect/contracts';
import { describe, expect, it } from 'vitest';
import {
  assertAuthorizationDeclared,
  authorizationProblems,
  buildV1Router,
  type Handlers,
} from '../src/platform/http/routes.js';

// P5.3 (P5 plan §5, §7.6; ADR-16 §3.5 route map): every endpoint declares exactly one authorization class, and the
// router refuses to start on a missing or invalid declaration — so no endpoint is public by omission.

const PUBLIC = { class: 'public' };
const SELF = { class: 'self' };
const cap = (capability: string) => ({ class: 'capability', capability });
const perm = (permission: string) => ({ class: 'permission', permission, branchScope: 'merchant_wide' });

/** The route map frozen in P5.0 (plan §5). A change here is a change to the approved design. */
const FROZEN: Record<string, unknown> = {
  getHealth: PUBLIC,
  signup: PUBLIC,
  resendVerification: PUBLIC,
  forgotPassword: PUBLIC,
  login: cap('credentials'),
  agentLogin: cap('credentials'),
  refreshSession: cap('refresh_token'),
  agentRefresh: cap('refresh_token'),
  verifyMfa: cap('mfa_challenge'),
  listLoginMemberships: cap('selection_challenge'),
  selectLoginMembership: cap('selection_challenge'),
  agentSelectMembership: cap('selection_challenge'),
  verifyEmail: cap('email_verification_token'),
  resetPassword: cap('password_reset_token'),
  completeAccountSetup: cap('account_setup_token'),
  acceptInvitation: cap('invitation_token'),
  logout: SELF,
  getSession: SELF,
  changePassword: SELF,
  beginTotpEnrollment: SELF,
  confirmTotpEnrollment: SELF,
  getCurrentMembership: SELF,
  getAgentMembership: SELF,
  getMerchantProfile: perm('merchant.profile.read'),
  updateMerchantProfile: perm('merchant.profile.update'),
  listBranches: perm('merchant.branches.read'),
  getBranch: perm('merchant.branches.read'),
  createBranch: perm('merchant.branches.manage'),
  updateBranch: perm('merchant.branches.manage'),
  listRoles: perm('merchant.roles.read'),
  getRole: perm('merchant.roles.read'),
  createRole: perm('merchant.roles.manage'),
  updateRole: perm('merchant.roles.manage'),
  // P5.6 (ADR-16's frozen contracts): the permission catalog and a role's permission set
  listPermissionCatalog: perm('merchant.roles.read'),
  setRolePermissions: perm('merchant.roles.manage'),
  listMembers: perm('merchant.members.read'),
  getMember: perm('merchant.members.read'),
  assignMember: perm('merchant.members.manage'),
  deactivateMember: perm('merchant.members.manage'),
  reactivateMember: perm('merchant.members.manage'),
  listInvitations: perm('merchant.invitations.read'),
  createInvitation: perm('merchant.invitations.manage'),
  revokeInvitation: perm('merchant.invitations.manage'),
  deactivateMerchant: perm('platform.merchants.lifecycle'),
  reactivateMerchant: perm('platform.merchants.lifecycle'),
  transferOwnership: perm('platform.merchants.transfer_ownership'),
  // P5.7 (ADR-16's frozen contracts): the platform team, super admin only
  listPlatformStaff: perm('platform.staff.manage'),
  createPlatformStaff: perm('platform.staff.manage'),
  deactivatePlatformStaff: perm('platform.staff.manage'),
  reactivatePlatformStaff: perm('platform.staff.manage'),
  setPlatformStaffPermissions: perm('platform.staff.manage'),
  // P5.7: the businesses and their members, for the platform team (sensitive reads)
  listPlatformMerchants: perm('platform.merchants.read'),
  listPlatformMerchantMembers: perm('platform.merchants.read'),
  // P5.8: the activity record (sensitive reads; ADR-16 addendum, confirmed 2026-10-19)
  listMerchantAuditEvents: perm('merchant.audit.read'),
  listPlatformAuditEvents: perm('platform.audit.read'),
};

describe('the registry’s declarations', () => {
  it('declare exactly the frozen route map: 55 operations, one class each', () => {
    const declared = Object.fromEntries(
      (Object.values(endpoints) as EndpointContract[]).map((e) => [e.id, e.authorization]),
    );
    expect(Object.keys(declared)).toHaveLength(55);
    expect(declared).toEqual(FROZEN);
  });

  it('are all valid', () => {
    for (const e of Object.values(endpoints) as EndpointContract[]) {
      expect(authorizationProblems(e), e.id).toEqual([]);
    }
    expect(() => assertAuthorizationDeclared(endpoints)).not.toThrow();
  });
});

describe('an invalid declaration is refused (fail closed at startup)', () => {
  const merchantEndpoint = defineEndpoint({
    id: 'probe',
    method: 'get',
    path: '/v1/merchant/probe',
    audience: 'merchant',
    security: ['cookieSession'],
    authorization: perm('merchant.profile.read') as EndpointContract['authorization'],
    summary: 'probe',
    responses: { 200: { description: 'ok' } },
  });
  const publicEndpoint = defineEndpoint({
    id: 'publicProbe',
    method: 'get',
    path: '/v1/public/probe',
    audience: 'public',
    authorization: { class: 'public' },
    summary: 'probe',
    responses: { 200: { description: 'ok' } },
  });
  const variant = (base: EndpointContract, change: Record<string, unknown>) =>
    ({ ...base, ...change }) as unknown as EndpointContract;

  it.each([
    [
      'no declaration at all',
      variant(merchantEndpoint, { authorization: undefined }),
      /no authorization declared/,
    ],
    [
      'an unknown class',
      variant(merchantEndpoint, { authorization: { class: 'owner' } }),
      /unknown authorization class/,
    ],
    [
      'a public endpoint that declares a session',
      variant(publicEndpoint, { security: ['cookieSession'] }),
      /take no session/,
    ],
    [
      'a public class on a session audience',
      variant(publicEndpoint, { audience: 'merchant' }),
      /must have the public audience/,
    ],
    [
      'an unknown capability',
      variant(publicEndpoint, { authorization: { class: 'capability', capability: 'magic_link' } }),
      /unknown capability/,
    ],
    [
      'a self endpoint without a session',
      variant(merchantEndpoint, { authorization: SELF, security: undefined }),
      /require a session/,
    ],
    [
      'an unknown permission',
      variant(merchantEndpoint, { authorization: perm('merchant.everything') }),
      /unknown permission/,
    ],
    [
      'a permission of another audience',
      variant(merchantEndpoint, { authorization: perm('platform.audit.read') }),
      /does not belong to the merchant audience/,
    ],
    [
      'a missing branch scope',
      variant(merchantEndpoint, {
        authorization: { class: 'permission', permission: 'merchant.profile.read' },
      }),
      /unknown branch scope/,
    ],
    [
      'a branch scope without a resolver (§7.6)',
      variant(merchantEndpoint, {
        authorization: { class: 'permission', permission: 'merchant.profile.read', branchScope: 'branch' },
      }),
      /need a resolver/,
    ],
    [
      'a permission endpoint that admits an MFA-enrolment session',
      variant(merchantEndpoint, { sessionScope: 'mfa_enrollment' }),
      /never admit an MFA-enrolment session/,
    ],
    [
      'a field that does not belong to the class',
      variant(publicEndpoint, { authorization: { class: 'public', permission: 'merchant.profile.read' } }),
      /unexpected field "permission"/,
    ],
  ])('%s', (_label, endpoint, problem) => {
    expect(authorizationProblems(endpoint).join('\n')).toMatch(problem);
    expect(() => assertAuthorizationDeclared({ [endpoint.id]: endpoint })).toThrow(/Refusing to start/);
  });

  it('the router itself refuses to start on an invalid declaration in the real registry', () => {
    const health = endpoints.getHealth as unknown as { authorization: unknown };
    const original = health.authorization;
    health.authorization = undefined;
    try {
      const noHandlers = {} as Handlers;
      const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
      expect(() => buildV1Router(noHandlers, pass, pass)).toThrow(/getHealth: no authorization declared/);
    } finally {
      health.authorization = original;
    }
    expect(authorizationProblems(endpoints.getHealth)).toEqual([]);
  });
});
