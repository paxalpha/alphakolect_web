import { z } from 'zod';
import { ErrorResponse, Id } from '../primitives.js';
import { defineEndpoint } from '../registry.js';

// /v1/platform — platform-audience operations. P4.1: merchant lifecycle (TARGET_ARCHITECTURE ADR-15 T6, T9).
// Super admin only: enforced in the database from the caller's session, not by these shapes.

export const MerchantStatus = z
  .enum(['pending_verification', 'active', 'deactivated'])
  .meta({ id: 'MerchantStatus' });

export const MerchantLifecycle = z
  .object({ merchantId: Id, status: MerchantStatus })
  .meta({ id: 'MerchantLifecycle', description: 'The merchant’s status after the change' });

export type MerchantLifecycle = z.infer<typeof MerchantLifecycle>;

export const DeactivateMerchantRequest = z
  .object({
    /** Recorded on the merchant and in the audit log. */
    reason: z.string().trim().min(1).max(500),
  })
  .meta({ id: 'DeactivateMerchantRequest' });

export type DeactivateMerchantRequest = z.infer<typeof DeactivateMerchantRequest>;

const MerchantParams = z.object({ merchantId: Id });

const error = (description: string) => ({ description, schema: ErrorResponse });

const lifecycleErrors = {
  400: error('VALIDATION_ERROR'),
  403: error('FORBIDDEN — only a platform super admin may change a merchant’s status'),
  404: error('NOT_FOUND'),
  409: error('INVALID_LIFECYCLE_TRANSITION — e.g. deactivating a merchant that is already deactivated'),
};

export const deactivateMerchant = defineEndpoint({
  id: 'deactivateMerchant',
  method: 'post',
  path: '/v1/platform/merchants/{merchantId}/deactivate',
  authorization: {
    class: 'permission',
    permission: 'platform.merchants.lifecycle',
    branchScope: 'merchant_wide',
  },
  audience: 'platform',
  summary: 'Deactivate a merchant: its members can no longer sign in or use their sessions',
  security: ['cookieSession'],
  request: { params: MerchantParams, body: DeactivateMerchantRequest },
  responses: { 200: { description: 'Deactivated', schema: MerchantLifecycle }, ...lifecycleErrors },
});

export const reactivateMerchant = defineEndpoint({
  id: 'reactivateMerchant',
  method: 'post',
  path: '/v1/platform/merchants/{merchantId}/reactivate',
  authorization: {
    class: 'permission',
    permission: 'platform.merchants.lifecycle',
    branchScope: 'merchant_wide',
  },
  audience: 'platform',
  summary: 'Reactivate a merchant (active if its owner’s email is verified, otherwise pending verification)',
  security: ['cookieSession'],
  request: { params: MerchantParams },
  responses: { 200: { description: 'Reactivated', schema: MerchantLifecycle }, ...lifecycleErrors },
});

// ── ownership transfer (P4.5; ADR-15 T17, OPEN-1) ──────────────────────────────────────────────────

export const TransferOwnershipRequest = z
  .object({
    /** An active staff member of this business, with a verified email, who becomes the owner. */
    newOwnerMembershipId: Id,
    /** The role the former owner holds as staff from now on: an active role of this business. */
    formerOwnerRoleId: Id,
    /** Also deactivate the former owner (signing them out everywhere). */
    deactivateFormerOwner: z.boolean(),
  })
  .meta({ id: 'TransferOwnershipRequest' });

export type TransferOwnershipRequest = z.infer<typeof TransferOwnershipRequest>;

export const OwnershipTransferred = z
  .object({ merchantId: Id, ownerMembershipId: Id, formerOwnerMembershipId: Id })
  .meta({ id: 'OwnershipTransferred' });

export type OwnershipTransferred = z.infer<typeof OwnershipTransferred>;

export const transferOwnership = defineEndpoint({
  id: 'transferOwnership',
  method: 'post',
  path: '/v1/platform/merchants/{merchantId}/transfer-ownership',
  authorization: {
    class: 'permission',
    permission: 'platform.merchants.transfer_ownership',
    branchScope: 'merchant_wide',
  },
  audience: 'platform',
  summary: 'Make another staff member the owner; the former owner becomes staff (both or neither)',
  security: ['cookieSession'],
  request: { params: MerchantParams, body: TransferOwnershipRequest },
  responses: {
    200: { description: 'Transferred', schema: OwnershipTransferred },
    400: error('VALIDATION_ERROR'),
    403: error('FORBIDDEN — only a platform super admin'),
    404: error('NOT_FOUND'),
    409: error(
      'INVALID_NEW_OWNER — not an active, verified staff member of this business; INVALID_ASSIGNMENT — the role is not an active one of this business',
    ),
  },
});
