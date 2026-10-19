// @alphakolect/contracts — API shapes only: zod schemas, the endpoint registry and API primitives.
// No application behaviour, database access, Express handlers, authentication or business rules.

import { agentLogin, agentRefresh, agentSelectMembership, getAgentMembership } from './endpoints/agent.js';
import { listMerchantAuditEvents, listPlatformAuditEvents } from './endpoints/audit.js';
import {
  acceptInvitation,
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
  selectLoginMembership,
  signup,
  verifyEmail,
  verifyMfa,
} from './endpoints/auth.js';
import { getHealth } from './endpoints/health.js';
import {
  assignMember,
  createBranch,
  createInvitation,
  createRole,
  deactivateMember,
  getBranch,
  getCurrentMembership,
  getMember,
  getMerchantProfile,
  getRole,
  listBranches,
  listInvitations,
  listMembers,
  listPermissionCatalog,
  listRoles,
  reactivateMember,
  revokeInvitation,
  setRolePermissions,
  updateBranch,
  updateMerchantProfile,
  updateRole,
} from './endpoints/merchant.js';
import { deactivateMerchant, reactivateMerchant, transferOwnership } from './endpoints/platform.js';
import {
  createPlatformStaff,
  deactivatePlatformStaff,
  listPlatformMerchantMembers,
  listPlatformMerchants,
  listPlatformStaff,
  reactivatePlatformStaff,
  setPlatformStaffPermissions,
} from './endpoints/platform-team.js';

export * from './auth.js';
export * from './permissions.js';
export * from './primitives.js';
export * from './registry.js';
export * from './endpoints/auth.js';
export * from './endpoints/merchant.js';
export * from './endpoints/agent.js';
export * from './endpoints/platform.js';
export * from './endpoints/platform-team.js';
export * from './endpoints/audit.js';
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
  selectLoginMembership,
  deactivateMerchant,
  reactivateMerchant,
  getCurrentMembership,
  getMerchantProfile,
  updateMerchantProfile,
  listBranches,
  createBranch,
  getBranch,
  updateBranch,
  listRoles,
  createRole,
  getRole,
  updateRole,
  listPermissionCatalog,
  setRolePermissions,
  listMembers,
  getMember,
  assignMember,
  deactivateMember,
  reactivateMember,
  transferOwnership,
  listPlatformMerchants,
  listPlatformMerchantMembers,
  listPlatformStaff,
  createPlatformStaff,
  deactivatePlatformStaff,
  reactivatePlatformStaff,
  setPlatformStaffPermissions,
  listMerchantAuditEvents,
  listPlatformAuditEvents,
  listInvitations,
  createInvitation,
  revokeInvitation,
  acceptInvitation,
  agentLogin,
  agentSelectMembership,
  agentRefresh,
  getAgentMembership,
} as const;

export type EndpointId = keyof typeof endpoints;
