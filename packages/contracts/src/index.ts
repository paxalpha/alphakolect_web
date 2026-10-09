// @alphakolect/contracts — API shapes only: zod schemas, the endpoint registry and API primitives.
// No application behaviour, database access, Express handlers, authentication or business rules.

import {
  beginTotpEnrollment,
  changePassword,
  completeAccountSetup,
  confirmTotpEnrollment,
  forgotPassword,
  getSession,
  listLoginMemberships,
  login,
  logout,
  refreshSession,
  resendVerification,
  resetPassword,
  signup,
  verifyEmail,
  verifyMfa,
} from './endpoints/auth.js';
import { getHealth } from './endpoints/health.js';
import { deactivateMerchant, reactivateMerchant } from './endpoints/platform.js';

export * from './auth.js';
export * from './primitives.js';
export * from './registry.js';
export * from './endpoints/auth.js';
export * from './endpoints/platform.js';
export { HealthResponse, getHealth } from './endpoints/health.js';

/** Every endpoint of the v1 API, keyed by operation id. Add new endpoints here. */
export const endpoints = {
  getHealth,
  login,
  refreshSession,
  logout,
  getSession,
  signup,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  completeAccountSetup,
  changePassword,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  verifyMfa,
  listLoginMemberships,
  deactivateMerchant,
  reactivateMerchant,
} as const;

export type EndpointId = keyof typeof endpoints;
