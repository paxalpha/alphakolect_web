import { z } from 'zod';
import { ErrorResponse, Id } from '../primitives.js';
import { defineEndpoint } from '../registry.js';
import { Email } from './auth.js';
import { Member, MembershipStatus, Timestamp } from './merchant.js';
import { MerchantStatus } from './platform.js';

// /v1/platform/staff — the AlphaKolect platform team (P5.7; TARGET_ARCHITECTURE ADR-16 §3.5, frozen contracts; P5 plan
// §7.4). Only the super admin manages the team (platform.staff.manage, reserved, D4); the database decides it from the
// caller's session. A staff member's role is a label that grants nothing: what they may do comes only from the
// permissions the super admin gives them, person by person. The super admin is not platform staff: the staff
// operations neither list nor manage that membership (404).
//
// /v1/platform/merchants (GET) — the businesses and one business's members, for the platform team (P5.7; closes P4
// limitation 1). platform.merchants.read is a permission the super admin can give. Every page is a sensitive read: the
// database records it before returning the rows, and returns nothing if it cannot (§8.2a rule 7).

const error = (description: string) => ({ description, schema: ErrorResponse });

/** Cursor pagination (ADR-16): `limit` 1–100, default 50; the cursor is opaque, from the previous page's `nextCursor`. */
export const PageQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const PlatformStaffRole = z
  .enum(['support', 'verification', 'finance'])
  .meta({ id: 'PlatformStaffRole', description: 'A label only: it grants nothing (D4)' });

export const PlatformStaffMember = z
  .object({
    platformMembershipId: Id,
    email: z.string(),
    role: PlatformStaffRole,
    status: MembershipStatus,
    /** The grantable platform permissions given to this person, sorted; none when created or reactivated. */
    permissions: z.array(z.string()),
    createdAt: Timestamp,
    deactivatedAt: Timestamp.nullable(),
  })
  .meta({ id: 'PlatformStaffMember', description: 'A member of the AlphaKolect platform team' });
export type PlatformStaffMember = z.infer<typeof PlatformStaffMember>;

export const PlatformStaffList = z
  .object({ items: z.array(PlatformStaffMember), nextCursor: z.string().nullable() })
  .meta({ id: 'PlatformStaffList', description: 'Newest first' });
export type PlatformStaffList = z.infer<typeof PlatformStaffList>;

export const CreatePlatformStaffRequest = z
  .object({ email: Email, role: PlatformStaffRole })
  .meta({ id: 'CreatePlatformStaffRequest' });
export type CreatePlatformStaffRequest = z.infer<typeof CreatePlatformStaffRequest>;

/** The whole new set: unique identifiers, at most 32; may be empty. The server checks each one. */
export const SetPlatformStaffPermissionsRequest = z
  .object({
    permissions: z
      .array(z.string().min(1).max(100))
      .max(32)
      .refine((p) => new Set(p).size === p.length, 'each permission at most once'),
  })
  .meta({ id: 'SetPlatformStaffPermissionsRequest' });
export type SetPlatformStaffPermissionsRequest = z.infer<typeof SetPlatformStaffPermissionsRequest>;

const StaffParams = z.object({ platformMembershipId: Id });
const staffManage = {
  class: 'permission',
  permission: 'platform.staff.manage',
  branchScope: 'merchant_wide',
} as const;
const forbidden = { 403: error('FORBIDDEN — only a platform super admin') };
const notStaff = { 404: error('NOT_FOUND — not a platform staff member (the super admin included)') };

export const listPlatformStaff = defineEndpoint({
  id: 'listPlatformStaff',
  method: 'get',
  path: '/v1/platform/staff',
  authorization: staffManage,
  audience: 'platform',
  summary: 'The platform team, newest first, each with their permissions',
  security: ['cookieSession'],
  request: { query: PageQuery },
  responses: {
    200: { description: 'One page of the team', schema: PlatformStaffList },
    400: error('VALIDATION_ERROR; INVALID_CURSOR — not a cursor of this list'),
    ...forbidden,
  },
});

export const createPlatformStaff = defineEndpoint({
  id: 'createPlatformStaff',
  method: 'post',
  path: '/v1/platform/staff',
  authorization: staffManage,
  audience: 'platform',
  summary: 'Add a platform staff member, with no permissions; they are sent an account-setup link',
  security: ['cookieSession'],
  request: { body: CreatePlatformStaffRequest },
  responses: {
    201: { description: 'Created, with no permissions', schema: PlatformStaffMember },
    400: error('VALIDATION_ERROR'),
    ...forbidden,
    409: error('EMAIL_IN_USE — this email already has an account; use another (O8(a))'),
  },
});

const lifecycleResponses = {
  200: { description: 'The staff member after the change', schema: PlatformStaffMember },
  ...forbidden,
  ...notStaff,
  409: error('INVALID_LIFECYCLE_TRANSITION — already in that state'),
};

export const deactivatePlatformStaff = defineEndpoint({
  id: 'deactivatePlatformStaff',
  method: 'post',
  path: '/v1/platform/staff/{platformMembershipId}/deactivate',
  authorization: staffManage,
  audience: 'platform',
  summary: 'Deactivate a staff member: their permissions are removed and their sessions end',
  security: ['cookieSession'],
  request: { params: StaffParams },
  responses: lifecycleResponses,
});

export const reactivatePlatformStaff = defineEndpoint({
  id: 'reactivatePlatformStaff',
  method: 'post',
  path: '/v1/platform/staff/{platformMembershipId}/reactivate',
  authorization: staffManage,
  audience: 'platform',
  summary: 'Reactivate a staff member, with no permissions (O8(b))',
  security: ['cookieSession'],
  request: { params: StaffParams },
  responses: lifecycleResponses,
});

export const setPlatformStaffPermissions = defineEndpoint({
  id: 'setPlatformStaffPermissions',
  method: 'put',
  path: '/v1/platform/staff/{platformMembershipId}/permissions',
  authorization: staffManage,
  audience: 'platform',
  summary: "Replace a staff member's permissions (grantable platform permissions only)",
  security: ['cookieSession'],
  request: { params: StaffParams, body: SetPlatformStaffPermissionsRequest },
  responses: {
    200: { description: 'The staff member with their new permissions', schema: PlatformStaffMember },
    400: error('VALIDATION_ERROR — an unknown, reserved, merchant or repeated identifier'),
    ...forbidden,
    ...notStaff,
    409: error('INVALID_LIFECYCLE_TRANSITION — the staff member is deactivated'),
  },
});

// ── the businesses and their members (sensitive reads, #35 and #36) ──

export const PlatformMerchant = z
  .object({ merchantId: Id, name: z.string(), status: MerchantStatus, createdAt: Timestamp })
  .meta({ id: 'PlatformMerchant', description: 'A business, as the platform team sees it' });
export type PlatformMerchant = z.infer<typeof PlatformMerchant>;

export const PlatformMerchantList = z
  .object({ items: z.array(PlatformMerchant), nextCursor: z.string().nullable() })
  .meta({ id: 'PlatformMerchantList', description: 'Newest first' });
export type PlatformMerchantList = z.infer<typeof PlatformMerchantList>;

export const PlatformMemberList = z
  .object({ items: z.array(Member), nextCursor: z.string().nullable() })
  .meta({
    id: 'PlatformMemberList',
    description: 'One business’s members (owner, staff and agents), newest first',
  });
export type PlatformMemberList = z.infer<typeof PlatformMemberList>;

const merchantsRead = {
  class: 'permission',
  permission: 'platform.merchants.read',
  branchScope: 'merchant_wide',
} as const;
const readRefused = {
  403: error('FORBIDDEN — the caller does not hold platform.merchants.read; a super admin can give it'),
};

export const listPlatformMerchants = defineEndpoint({
  id: 'listPlatformMerchants',
  method: 'get',
  path: '/v1/platform/merchants',
  authorization: merchantsRead,
  audience: 'platform',
  summary: 'Every business, newest first (each page is recorded in the activity record)',
  security: ['cookieSession'],
  request: { query: PageQuery },
  responses: {
    200: { description: 'One page of businesses', schema: PlatformMerchantList },
    400: error('VALIDATION_ERROR; INVALID_CURSOR — not a cursor of this list'),
    ...readRefused,
  },
});

export const listPlatformMerchantMembers = defineEndpoint({
  id: 'listPlatformMerchantMembers',
  method: 'get',
  path: '/v1/platform/merchants/{merchantId}/members',
  authorization: merchantsRead,
  audience: 'platform',
  summary: 'One business’s members, newest first (each page is recorded, in that business’s record too)',
  security: ['cookieSession'],
  request: { params: z.object({ merchantId: Id }), query: PageQuery },
  responses: {
    200: { description: 'One page of the business’s members', schema: PlatformMemberList },
    400: error('VALIDATION_ERROR; INVALID_CURSOR — not a cursor of this list, or of another business'),
    ...readRefused,
    404: error('NOT_FOUND — no such business'),
  },
});
