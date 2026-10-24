// Permission identifiers (P5.1; TARGET_ARCHITECTURE ADR-16 §3.5, P5 plan §4 invariant 1 and §6).
//
// The database catalog (identity.permission_catalog) is the only authority for permissions — their identifiers, scope
// and whether they can be granted. This list exists for typing only: an API test compares it with the catalog's active
// permissions on every run and fails on any difference, so the two can never drift apart. It grants nothing.

export const PERMISSIONS = [
  'merchant.profile.read',
  'merchant.profile.update',
  'merchant.branches.read',
  'merchant.branches.manage',
  'merchant.roles.read',
  'merchant.roles.manage',
  'merchant.members.read',
  'merchant.members.manage',
  'merchant.invitations.read',
  'merchant.invitations.manage',
  'merchant.audit.read',
  'merchant.ledger.read',
  'merchant.ledger.manage',
  'merchant.ledger.post',
  'platform.merchants.read',
  'platform.audit.read',
  'platform.merchants.lifecycle',
  'platform.merchants.transfer_ownership',
  'platform.staff.manage',
] as const;

/** A catalog permission identifier. */
export type Permission = (typeof PERMISSIONS)[number];
