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
  audience: 'platform',
  summary: 'Reactivate a merchant (active if its owner’s email is verified, otherwise pending verification)',
  security: ['cookieSession'],
  request: { params: MerchantParams },
  responses: { 200: { description: 'Reactivated', schema: MerchantLifecycle }, ...lifecycleErrors },
});
