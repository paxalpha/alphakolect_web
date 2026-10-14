import { z } from 'zod';
import { ErrorResponse, Id } from '../primitives.js';
import { defineEndpoint } from '../registry.js';
import { Email } from './auth.js';
import { MerchantStatus } from './platform.js';

// /v1/merchant — the merchant web audience (cookie sessions). P4.4 (TARGET_ARCHITECTURE §4, ADR-15 T3, T7–T9, T15).
//
// The tenant is always the caller's session membership: no request here has a merchantId, and none ever will
// (§4). A branch or role of another merchant is indistinguishable from one that does not exist (404). Until P5,
// management (profile, branches, roles) is for the owner only — staff get 403 FORBIDDEN (T9); agents use their own
// audience and cannot call these at all.

const Timestamp = z.iso.datetime().meta({ id: 'Timestamp', description: 'ISO 8601, UTC' });

export const MembershipKind = z.enum(['owner', 'staff', 'agent']).meta({ id: 'MembershipKind' });

export const MerchantProfile = z
  .object({ merchantId: Id, name: z.string(), status: MerchantStatus })
  .meta({ id: 'MerchantProfile', description: 'The business the session belongs to' });

export type MerchantProfile = z.infer<typeof MerchantProfile>;

export const CurrentMembership = z
  .object({
    membershipId: Id,
    kind: MembershipKind,
    /** Staff only: their role, whose grants are their permissions. */
    roleId: Id.nullable(),
    /** Staff only: the one branch they are restricted to; null = all branches. */
    branchId: Id.nullable(),
    merchant: MerchantProfile,
    /**
     * The caller's effective merchant permissions, resolved on this request (ADR-16), sorted. They only drive what
     * the interface shows; the server decides every request again.
     */
    permissions: z.array(z.string()),
  })
  .meta({
    id: 'CurrentMembership',
    description: 'The caller’s own membership and effective permissions, as of this request',
  });

export type CurrentMembership = z.infer<typeof CurrentMembership>;

/** Names of businesses, branches and roles: trimmed, 1–120 characters. */
const Name = z.string().trim().min(1).max(120);

export const UpdateMerchantProfileRequest = z
  .object({ name: Name })
  .meta({ id: 'UpdateMerchantProfileRequest' });

export type UpdateMerchantProfileRequest = z.infer<typeof UpdateMerchantProfileRequest>;

export const CatalogStatus = z
  .enum(['active', 'archived'])
  .meta({ id: 'CatalogStatus', description: 'Archived items keep their history; their name may be reused' });

export const Branch = z
  .object({
    branchId: Id,
    name: z.string(),
    status: CatalogStatus,
    createdAt: Timestamp,
    archivedAt: Timestamp.nullable(),
  })
  .meta({ id: 'Branch' });

export type Branch = z.infer<typeof Branch>;

export const Role = z
  .object({
    roleId: Id,
    name: z.string(),
    status: CatalogStatus,
    createdAt: Timestamp,
    archivedAt: Timestamp.nullable(),
    /**
     * The permissions the role grants its staff, sorted (P5.6, ADR-16). An archived role keeps its set but grants
     * nothing; restored, it grants the set again at once.
     */
    permissions: z.array(z.string()),
  })
  .meta({ id: 'Role', description: 'A merchant-defined staff role and the permissions it grants' });

export type Role = z.infer<typeof Role>;

/**
 * Every item, oldest first. `nextCursor` is always null for now (a business has few branches and roles); the
 * field is here so pagination can be added without a breaking change.
 */
export const BranchList = z
  .object({ items: z.array(Branch), nextCursor: z.string().nullable() })
  .meta({ id: 'BranchList' });
export type BranchList = z.infer<typeof BranchList>;
export const RoleList = z
  .object({ items: z.array(Role), nextCursor: z.string().nullable() })
  .meta({ id: 'RoleList' });
export type RoleList = z.infer<typeof RoleList>;

/** One merchant permission, as the owner chooses a role's permissions (P5.6, ADR-16 PermissionCatalog). */
export const PermissionCatalogItem = z
  .object({
    permission: z.string(),
    /** What it allows, in the owner-approved wording. */
    description: z.string(),
    /** false for the owner-only permissions, which no role can grant. */
    grantable: z.boolean(),
  })
  .meta({ id: 'PermissionCatalogItem' });
export const PermissionCatalog = z
  .object({ items: z.array(PermissionCatalogItem) })
  .meta({ id: 'PermissionCatalog', description: 'The active merchant permissions, by identifier' });
export type PermissionCatalog = z.infer<typeof PermissionCatalog>;

/** A role's whole new permission set: unique identifiers, at most 32; may be empty. The server checks each one. */
export const SetRolePermissionsRequest = z
  .object({
    permissions: z
      .array(z.string().min(1).max(100))
      .max(32)
      .refine((p) => new Set(p).size === p.length, 'each permission at most once'),
  })
  .meta({ id: 'SetRolePermissionsRequest' });
export type SetRolePermissionsRequest = z.infer<typeof SetRolePermissionsRequest>;

export const CreateCatalogItemRequest = z.object({ name: Name }).meta({ id: 'CreateCatalogItemRequest' });

export type CreateCatalogItemRequest = z.infer<typeof CreateCatalogItemRequest>;

export const UpdateCatalogItemRequest = z
  .object({ name: Name.optional(), status: CatalogStatus.optional() })
  .refine((v) => v.name !== undefined || v.status !== undefined, 'name or status is required')
  .meta({ id: 'UpdateCatalogItemRequest' });

export type UpdateCatalogItemRequest = z.infer<typeof UpdateCatalogItemRequest>;

const error = (description: string) => ({ description, schema: ErrorResponse });
const ownerOnly = { 403: error('FORBIDDEN — only the business owner (until P5 permissions)') };
const notFound = { 404: error('NOT_FOUND — also for another business’s items') };
const nameTaken = { 409: error('NAME_TAKEN — an active item already has this name (case-insensitive)') };
const invalid = { 400: error('VALIDATION_ERROR') };

/** Cookie sessions of the merchant audience; state changes also need the CSRF header (ADR-14 D7). */
const merchantSession = { audience: 'merchant', security: ['cookieSession'] } as const;

export const getCurrentMembership = defineEndpoint({
  id: 'getCurrentMembership',
  method: 'get',
  path: '/v1/merchant/membership',
  authorization: { class: 'self' },
  ...merchantSession,
  summary: 'The caller’s membership and business (owners and staff)',
  responses: { 200: { description: 'The current membership', schema: CurrentMembership } },
});

export const getMerchantProfile = defineEndpoint({
  id: 'getMerchantProfile',
  method: 'get',
  path: '/v1/merchant/profile',
  authorization: { class: 'permission', permission: 'merchant.profile.read', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'The business profile (owner)',
  responses: { 200: { description: 'The profile', schema: MerchantProfile }, ...ownerOnly },
});

export const updateMerchantProfile = defineEndpoint({
  id: 'updateMerchantProfile',
  method: 'patch',
  path: '/v1/merchant/profile',
  authorization: { class: 'permission', permission: 'merchant.profile.update', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'Rename the business (owner)',
  request: { body: UpdateMerchantProfileRequest },
  responses: {
    200: { description: 'The updated profile', schema: MerchantProfile },
    ...invalid,
    ...ownerOnly,
  },
});

const BranchParams = z.object({ branchId: Id });
const RoleParams = z.object({ roleId: Id });

export const listBranches = defineEndpoint({
  id: 'listBranches',
  method: 'get',
  path: '/v1/merchant/branches',
  authorization: { class: 'permission', permission: 'merchant.branches.read', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'The business’s branches, active and archived (owner)',
  responses: { 200: { description: 'All branches', schema: BranchList }, ...ownerOnly },
});

export const createBranch = defineEndpoint({
  id: 'createBranch',
  method: 'post',
  path: '/v1/merchant/branches',
  authorization: {
    class: 'permission',
    permission: 'merchant.branches.manage',
    branchScope: 'merchant_wide',
  },
  ...merchantSession,
  summary: 'Add a branch (owner)',
  request: { body: CreateCatalogItemRequest },
  responses: {
    201: { description: 'Created', schema: Branch },
    ...invalid,
    ...ownerOnly,
    ...nameTaken,
  },
});

export const getBranch = defineEndpoint({
  id: 'getBranch',
  method: 'get',
  path: '/v1/merchant/branches/{branchId}',
  authorization: { class: 'permission', permission: 'merchant.branches.read', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'One branch (owner)',
  request: { params: BranchParams },
  responses: { 200: { description: 'The branch', schema: Branch }, ...invalid, ...ownerOnly, ...notFound },
});

export const updateBranch = defineEndpoint({
  id: 'updateBranch',
  method: 'patch',
  path: '/v1/merchant/branches/{branchId}',
  authorization: {
    class: 'permission',
    permission: 'merchant.branches.manage',
    branchScope: 'merchant_wide',
  },
  ...merchantSession,
  summary: 'Rename, archive or restore a branch (owner)',
  request: { params: BranchParams, body: UpdateCatalogItemRequest },
  responses: {
    200: { description: 'The updated branch', schema: Branch },
    ...invalid,
    ...ownerOnly,
    ...notFound,
    ...nameTaken,
  },
});

export const listRoles = defineEndpoint({
  id: 'listRoles',
  method: 'get',
  path: '/v1/merchant/roles',
  authorization: { class: 'permission', permission: 'merchant.roles.read', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'The business’s staff roles, active and archived (owner)',
  responses: { 200: { description: 'All roles', schema: RoleList }, ...ownerOnly },
});

export const createRole = defineEndpoint({
  id: 'createRole',
  method: 'post',
  path: '/v1/merchant/roles',
  authorization: { class: 'permission', permission: 'merchant.roles.manage', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'Add a staff role (owner)',
  request: { body: CreateCatalogItemRequest },
  responses: {
    201: { description: 'Created', schema: Role },
    ...invalid,
    ...ownerOnly,
    ...nameTaken,
  },
});

export const getRole = defineEndpoint({
  id: 'getRole',
  method: 'get',
  path: '/v1/merchant/roles/{roleId}',
  authorization: { class: 'permission', permission: 'merchant.roles.read', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'One staff role (owner)',
  request: { params: RoleParams },
  responses: { 200: { description: 'The role', schema: Role }, ...invalid, ...ownerOnly, ...notFound },
});

export const updateRole = defineEndpoint({
  id: 'updateRole',
  method: 'patch',
  path: '/v1/merchant/roles/{roleId}',
  authorization: { class: 'permission', permission: 'merchant.roles.manage', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'Rename, archive or restore a staff role (owner)',
  request: { params: RoleParams, body: UpdateCatalogItemRequest },
  responses: {
    200: { description: 'The updated role', schema: Role },
    ...invalid,
    ...ownerOnly,
    ...notFound,
    ...nameTaken,
  },
});

export const listPermissionCatalog = defineEndpoint({
  id: 'listPermissionCatalog',
  method: 'get',
  path: '/v1/merchant/permissions',
  authorization: { class: 'permission', permission: 'merchant.roles.read', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'The merchant permissions a role can be given, with their descriptions',
  responses: {
    200: { description: 'The active merchant permissions', schema: PermissionCatalog },
    ...ownerOnly,
  },
});

export const setRolePermissions = defineEndpoint({
  id: 'setRolePermissions',
  method: 'put',
  path: '/v1/merchant/roles/{roleId}/permissions',
  authorization: { class: 'permission', permission: 'merchant.roles.manage', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'Replace a role’s permission set (owner)',
  request: { params: RoleParams, body: SetRolePermissionsRequest },
  responses: {
    200: { description: 'The role with its new permission set', schema: Role },
    400: error('VALIDATION_ERROR — also an unknown, owner-only, platform or repeated permission'),
    ...ownerOnly,
    ...notFound,
  },
});

// ── members (P4.5; ADR-15 T5, T7–T9, T15) ──────────────────────────────────────────────────────────

export const MembershipStatus = z.enum(['active', 'deactivated']).meta({ id: 'MembershipStatus' });

export const Member = z
  .object({
    membershipId: Id,
    kind: MembershipKind,
    status: MembershipStatus,
    email: z.string(),
    /** Staff only. */
    roleId: Id.nullable(),
    /** Staff only; null = all branches. */
    branchId: Id.nullable(),
    createdAt: Timestamp,
    deactivatedAt: Timestamp.nullable(),
  })
  .meta({ id: 'Member', description: 'A member of the business (owner, staff or agent)' });

export type Member = z.infer<typeof Member>;

export const MemberList = z
  .object({ items: z.array(Member), nextCursor: z.string().nullable() })
  .meta({ id: 'MemberList', description: 'Every member, oldest first; nextCursor is always null for now' });

export type MemberList = z.infer<typeof MemberList>;

export const AssignMemberRequest = z
  .object({
    /** An active role of this business. */
    roleId: Id,
    /** An active branch of this business, or null for all branches. */
    branchId: Id.nullable(),
  })
  .meta({ id: 'AssignMemberRequest' });

export type AssignMemberRequest = z.infer<typeof AssignMemberRequest>;

const MemberParams = z.object({ membershipId: Id });
const memberErrors = {
  ...invalid,
  403: error('FORBIDDEN — only the business owner; and never the owner’s own membership (use a transfer)'),
  ...notFound,
};

export const listMembers = defineEndpoint({
  id: 'listMembers',
  method: 'get',
  path: '/v1/merchant/members',
  authorization: { class: 'permission', permission: 'merchant.members.read', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'The business’s members, active and deactivated (owner)',
  responses: { 200: { description: 'All members', schema: MemberList }, ...ownerOnly },
});

export const getMember = defineEndpoint({
  id: 'getMember',
  method: 'get',
  path: '/v1/merchant/members/{membershipId}',
  authorization: { class: 'permission', permission: 'merchant.members.read', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'One member (owner)',
  request: { params: MemberParams },
  responses: { 200: { description: 'The member', schema: Member }, ...invalid, ...ownerOnly, ...notFound },
});

export const assignMember = defineEndpoint({
  id: 'assignMember',
  method: 'post',
  path: '/v1/merchant/members/{membershipId}/assignment',
  authorization: { class: 'permission', permission: 'merchant.members.manage', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'Set a staff member’s role and branch (owner); applies from their next request',
  request: { params: MemberParams, body: AssignMemberRequest },
  responses: {
    200: { description: 'The member', schema: Member },
    ...memberErrors,
    409: error(
      'INVALID_ASSIGNMENT — not a staff member, or the role/branch is not an active one of this business',
    ),
  },
});

export const deactivateMember = defineEndpoint({
  id: 'deactivateMember',
  method: 'post',
  path: '/v1/merchant/members/{membershipId}/deactivate',
  authorization: { class: 'permission', permission: 'merchant.members.manage', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'Deactivate a staff member or agent (owner): signed out at once',
  request: { params: MemberParams },
  responses: {
    200: { description: 'The member', schema: Member },
    ...memberErrors,
    409: error('INVALID_LIFECYCLE_TRANSITION — already deactivated'),
  },
});

export const reactivateMember = defineEndpoint({
  id: 'reactivateMember',
  method: 'post',
  path: '/v1/merchant/members/{membershipId}/reactivate',
  authorization: { class: 'permission', permission: 'merchant.members.manage', branchScope: 'merchant_wide' },
  ...merchantSession,
  summary: 'Reactivate a staff member or agent (owner); they sign in again',
  request: { params: MemberParams },
  responses: {
    200: { description: 'The member', schema: Member },
    ...memberErrors,
    409: error('INVALID_LIFECYCLE_TRANSITION — not deactivated'),
  },
});

// ── invitations (P4.6; ADR-15 T10, T11; D12) ───────────────────────────────────────────────────────

export const InvitationStatus = z
  .enum(['pending', 'accepted', 'revoked', 'expired'])
  .meta({ id: 'InvitationStatus' });

export const Invitation = z
  .object({
    invitationId: Id,
    email: z.string(),
    kind: z.enum(['staff', 'agent']),
    roleId: Id.nullable(),
    branchId: Id.nullable(),
    status: InvitationStatus,
    expiresAt: Timestamp,
    createdAt: Timestamp,
  })
  .meta({ id: 'Invitation' });

export type Invitation = z.infer<typeof Invitation>;

export const InvitationList = z
  .object({ items: z.array(Invitation), nextCursor: z.string().nullable() })
  .meta({
    id: 'InvitationList',
    description: 'Every invitation, newest first; nextCursor is always null for now',
  });

export type InvitationList = z.infer<typeof InvitationList>;

export const CreateInvitationRequest = z
  .object({
    email: Email,
    kind: z.enum(['staff', 'agent']),
    /** Staff: required, an active role of this business. Agents: omitted or null. */
    roleId: Id.nullable().optional(),
    /** Staff: an active branch of this business, or null/omitted for all branches. Agents: omitted or null. */
    branchId: Id.nullable().optional(),
  })
  .meta({
    id: 'CreateInvitationRequest',
    description: 'The answer is the same whether or not the email already has an AlphaKolect account',
  });

export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

const InvitationParams = z.object({ invitationId: Id });

export const listInvitations = defineEndpoint({
  id: 'listInvitations',
  method: 'get',
  path: '/v1/merchant/invitations',
  authorization: {
    class: 'permission',
    permission: 'merchant.invitations.read',
    branchScope: 'merchant_wide',
  },
  ...merchantSession,
  summary: 'The business’s invitations (owner)',
  responses: { 200: { description: 'All invitations', schema: InvitationList }, ...ownerOnly },
});

export const createInvitation = defineEndpoint({
  id: 'createInvitation',
  method: 'post',
  path: '/v1/merchant/invitations',
  authorization: {
    class: 'permission',
    permission: 'merchant.invitations.manage',
    branchScope: 'merchant_wide',
  },
  ...merchantSession,
  summary: 'Invite a staff member or agent by email (owner); replaces an open invitation to the same email',
  request: { body: CreateInvitationRequest },
  responses: {
    201: { description: 'Invited; the email is on its way', schema: Invitation },
    ...invalid,
    ...ownerOnly,
    409: error(
      'INVALID_ASSIGNMENT — the role/branch is not an active one of this business (or set for an agent); ALREADY_MEMBER',
    ),
    429: error('RATE_LIMITED'),
  },
});

export const revokeInvitation = defineEndpoint({
  id: 'revokeInvitation',
  method: 'post',
  path: '/v1/merchant/invitations/{invitationId}/revoke',
  authorization: {
    class: 'permission',
    permission: 'merchant.invitations.manage',
    branchScope: 'merchant_wide',
  },
  ...merchantSession,
  summary: 'Withdraw a pending invitation (owner)',
  request: { params: InvitationParams },
  responses: {
    200: { description: 'Revoked', schema: Invitation },
    ...invalid,
    ...ownerOnly,
    ...notFound,
    409: error('INVALID_LIFECYCLE_TRANSITION — already accepted or revoked'),
  },
});
