import { z } from 'zod';
import { ErrorResponse, Id } from '../primitives.js';
import { defineEndpoint } from '../registry.js';
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
    /** Staff only: their role (names only until P5). */
    roleId: Id.nullable(),
    /** Staff only: the one branch they are restricted to; null = all branches. */
    branchId: Id.nullable(),
    merchant: MerchantProfile,
  })
  .meta({ id: 'CurrentMembership', description: 'The caller’s own membership, as of this request' });

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
  })
  .meta({ id: 'Role', description: 'A merchant-defined staff role; permissions attach in P5' });

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
  ...merchantSession,
  summary: 'The caller’s membership and business (owners and staff)',
  responses: { 200: { description: 'The current membership', schema: CurrentMembership } },
});

export const getMerchantProfile = defineEndpoint({
  id: 'getMerchantProfile',
  method: 'get',
  path: '/v1/merchant/profile',
  ...merchantSession,
  summary: 'The business profile (owner)',
  responses: { 200: { description: 'The profile', schema: MerchantProfile }, ...ownerOnly },
});

export const updateMerchantProfile = defineEndpoint({
  id: 'updateMerchantProfile',
  method: 'patch',
  path: '/v1/merchant/profile',
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
  ...merchantSession,
  summary: 'The business’s branches, active and archived (owner)',
  responses: { 200: { description: 'All branches', schema: BranchList }, ...ownerOnly },
});

export const createBranch = defineEndpoint({
  id: 'createBranch',
  method: 'post',
  path: '/v1/merchant/branches',
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
  ...merchantSession,
  summary: 'One branch (owner)',
  request: { params: BranchParams },
  responses: { 200: { description: 'The branch', schema: Branch }, ...invalid, ...ownerOnly, ...notFound },
});

export const updateBranch = defineEndpoint({
  id: 'updateBranch',
  method: 'patch',
  path: '/v1/merchant/branches/{branchId}',
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
  ...merchantSession,
  summary: 'The business’s staff roles, active and archived (owner)',
  responses: { 200: { description: 'All roles', schema: RoleList }, ...ownerOnly },
});

export const createRole = defineEndpoint({
  id: 'createRole',
  method: 'post',
  path: '/v1/merchant/roles',
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
  ...merchantSession,
  summary: 'One staff role (owner)',
  request: { params: RoleParams },
  responses: { 200: { description: 'The role', schema: Role }, ...invalid, ...ownerOnly, ...notFound },
});

export const updateRole = defineEndpoint({
  id: 'updateRole',
  method: 'patch',
  path: '/v1/merchant/roles/{roleId}',
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
