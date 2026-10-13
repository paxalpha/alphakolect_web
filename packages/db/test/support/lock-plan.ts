import type { FnClass } from './lock-analysis.js';

// The lock-order guard's plan data (P5 plan §7.2): how every function of the identity, tenancy, audit and util schemas
// is checked, the planned footprints as token sequences, the baseline reconciliation (R34) and the report-mode
// tolerated list. Kept here and in the plan; a change to either is a change to both.
//
// Tokens, in acquisition order: `<category>:<mode>` for a waiting acquisition — S (FOR SHARE), NKU (FOR NO KEY UPDATE;
// a FOR UPDATE is reported under L1 and compared as NKU), W (the implicit lock of an UPDATE or DELETE of rows not
// already held), S+NKU (one helper call taking both); a leading A marks the acquisition that holds the actor's row
// (the authority lock, "Authority is acquired by category, not by row"); `+<category>` is an insert under a contested
// unique key (L3: last, and nothing waited for afterwards).

export const CLASSES: Readonly<Record<string, FnClass>> = {
  // ── privileged operations: the planned-footprint table ──
  'tenancy.update_membership': {
    class: 'operation',
    planned: ['2:S', 'A3:NKU', '7:S', '8:S', '10:W'],
    writes: ['tenancy.merchant_memberships', 'identity.sessions'],
  },
  'tenancy.issue_invitation': {
    class: 'operation',
    planned: ['2:S', 'A3:NKU', '4:NKU', '5:NKU', '6:S', '7:S', '8:S', '+6', '+4'],
    writes: ['identity.identities', 'identity.one_time_tokens', 'tenancy.invitations'],
  },
  'tenancy.revoke_invitation': {
    class: 'operation',
    planned: ['2:S', 'A3:NKU', '4:NKU'],
    writes: ['tenancy.invitations'],
  },
  'tenancy.accept_invitation': {
    class: 'operation',
    planned: ['2:S', '4:NKU', '6:S', '7:S', '8:S', '+3'],
    writes: ['tenancy.merchant_memberships', 'tenancy.invitations'],
  },
  'identity.complete_account_setup': {
    class: 'operation',
    planned: ['2:S', '4:NKU', '5:NKU', '6:NKU', '7:S', '8:S', '10:W', '+3'],
    writes: [
      'identity.one_time_tokens',
      'identity.identities',
      'identity.sessions',
      'tenancy.merchant_memberships',
      'tenancy.invitations',
    ],
  },
  'tenancy.set_merchant_status': {
    class: 'operation',
    planned: ['A1:S', '2:NKU', '6:S'],
    writes: ['tenancy.merchants'],
  },
  'tenancy.transfer_ownership': {
    class: 'operation',
    planned: ['A1:S', '2:NKU', '3:NKU', '6:S', '7:S', '10:W'],
    writes: ['tenancy.merchant_memberships', 'identity.sessions'],
  },
  // operator only (§7.4, rev 14)
  'identity.bootstrap_super_admin': {
    class: 'operation',
    planned: ['6:NKU', '+6', '+1'],
    writes: ['identity.identities', 'identity.platform_memberships', 'audit.audit_events'],
  },
  // admission, inside accept_invitation and complete_account_setup: waits for nothing (L6, P5.5 step 2)
  'tenancy.admit_invitation_locked': {
    class: 'locked',
    writes: ['tenancy.merchant_memberships', 'tenancy.invitations'],
  },

  // ── identity flows of the table: the categories each may wait for ──
  'identity.reset_password': {
    class: 'flow',
    categories: [5, 6, 10],
    writes: ['identity.one_time_tokens', 'identity.identities', 'identity.sessions'],
  },
  // the owned businesses first (finding at P5.5 step 1; §7.2 proposed row)
  'identity.verify_email': {
    class: 'flow',
    categories: [2, 5, 6],
    writes: ['identity.one_time_tokens', 'identity.identities', 'tenancy.merchants'],
  },
  'identity.change_password': {
    class: 'flow',
    categories: [6, 10],
    writes: ['identity.identities', 'identity.sessions'],
  },
  'identity.rotate_refresh_token': {
    class: 'flow',
    categories: [5, 10],
    writes: ['identity.refresh_tokens', 'identity.sessions'],
  },
  'identity.take_selection': {
    class: 'flow',
    categories: [5, 6],
    writes: ['identity.membership_selection_challenges'],
  },
  'identity.consume_mfa_challenge': {
    class: 'flow',
    categories: [5, 6],
    writes: ['identity.mfa_challenges'],
  },
  'identity.take_mfa_challenge_attempt': {
    class: 'flow',
    categories: [5, 6],
    writes: ['identity.mfa_challenges'],
  },
  'identity.consume_recovery_code': {
    class: 'flow',
    categories: [5, 6],
    writes: ['identity.recovery_codes'],
  },
  'identity.accept_totp_step': { class: 'flow', categories: [5, 6], writes: ['identity.totp_credentials'] },
  'identity.begin_totp_enrollment': {
    class: 'flow',
    categories: [5, 6],
    writes: ['identity.totp_credentials'],
  },
  'identity.confirm_totp_enrollment': {
    class: 'flow',
    categories: [5, 6],
    writes: ['identity.totp_credentials', 'identity.recovery_codes'],
  },

  // ── other identity functions: the category order and L1–L6 ──
  'identity.apply_new_password': { class: 'identity', writes: ['identity.identities', 'identity.sessions'] },
  'identity.consume_one_time_token': { class: 'identity', writes: ['identity.one_time_tokens'] },
  'identity.issue_one_time_token': { class: 'identity', writes: ['identity.one_time_tokens'] },
  'identity.create_session': { class: 'identity', writes: ['identity.sessions', 'identity.refresh_tokens'] },
  'identity.create_mfa_challenge': { class: 'identity', writes: ['identity.mfa_challenges'] },
  'identity.signup_merchant_owner': {
    class: 'identity',
    writes: ['identity.identities', 'tenancy.merchants', 'tenancy.merchant_memberships'],
  },
  'identity.resolve_login_membership': {
    class: 'identity',
    writes: ['identity.membership_selection_challenges'],
  },
  'identity.rehash_password': { class: 'identity', writes: ['identity.identities'] },
  'identity.revoke_session': { class: 'identity', writes: ['identity.sessions'] },
  'identity.revoke_all_sessions': { class: 'identity', writes: ['identity.sessions'] },

  // ── the nested write-time re-check (P5.2; L6: NOWAIT only) ──
  'tenancy.assert_authority': { class: 'nested-check' },

  // ── lock helpers (P5.5 step 1) ──
  'identity.lock_platform_memberships': { class: 'helper' },
  'tenancy.lock_merchants': { class: 'helper' },
  'tenancy.lock_memberships': { class: 'helper' },
  'tenancy.lock_invitations': { class: 'helper' },
  'identity.lock_one_time_tokens': { class: 'helper' },
  'tenancy.lock_roles': { class: 'helper' },
  'tenancy.lock_branches': { class: 'helper' },

  // ── lock-free readers ──
  'identity.account_for_email': { class: 'reader' },
  'identity.active_membership': { class: 'reader' },
  'identity.credentials_for': { class: 'reader' },
  'identity.eligible_memberships': { class: 'reader' },
  'identity.login_identity': { class: 'reader' },
  'identity.mfa_credential': { class: 'reader' },
  'identity.permissions_of': { class: 'reader' },
  'identity.selection_choices': { class: 'reader' },
  'identity.session_authority': { class: 'reader' },
  'identity.session_limits': { class: 'reader' },
  'identity.validate_session': { class: 'reader' },
  'tenancy.list_members': { class: 'reader' },
  'util.current_merchant_id': { class: 'reader' },
  'util.uuid_v7': { class: 'reader' },

  // ── trigger functions (L4) ──
  'audit.protect_event_catalog': { class: 'trigger' },
  'audit.validate_event': { class: 'trigger' },
  'identity.check_grantable_permission': { class: 'trigger' },
  'identity.protect_permission_catalog': { class: 'trigger' },
  'tenancy.merchant_keeps_one_owner': { class: 'trigger' },
  'util.reject_modification': { class: 'trigger' },

  // ── a request path called in its own statement, never inside a transaction ──
  'util.rate_limit_hit': { class: 'standalone', writes: ['util.rate_limit_counters'] },
};

/**
 * The baseline reconciliation (R34), as the guard reports it for the P4 definitions at 5d8904b
 * (test/fixtures/lock-baseline-5d8904b.json). L1 entries name the clause's line in the function body; the plan's table
 * names the migration line. Entries marked "P5.5 step 1" are the ones the guard found beyond the plan's table.
 */
export const BASELINE: readonly string[] = [
  // L1 lock mode — 8 functions, 10 clauses (every FOR UPDATE becomes FOR NO KEY UPDATE)
  'L1 identity.consume_one_time_token 11', // 20261003000200:85
  'L1 identity.rotate_refresh_token 16', // 20261013000100:38
  'L1 identity.rotate_refresh_token 21', // 20261013000100:43
  'L1 identity.take_selection 7', // 20261009000200:117
  'L1 tenancy.set_merchant_status 30', // 20261009000100:118
  'L1 tenancy.update_membership 26', // 20261011000200:71
  'L1 tenancy.transfer_ownership 21', // 20261011000300:47
  'L1 tenancy.transfer_ownership 30', // 20261011000300:56
  'L1 tenancy.admit_invitation 17', // 20261012000100:113
  'L1 tenancy.revoke_invitation 19', // 20261012000100:271
  // category order — the plan's three, and email verification (P5.5 step 1)
  'order tenancy.set_merchant_status',
  'order tenancy.issue_invitation',
  'order identity.complete_account_setup',
  'order identity.verify_email',
  // planned footprint and authority — the plan's eight, and email verification (P5.5 step 1)
  'footprint tenancy.update_membership',
  'footprint tenancy.issue_invitation',
  'footprint tenancy.revoke_invitation',
  'footprint tenancy.set_merchant_status',
  'footprint tenancy.transfer_ownership',
  'footprint tenancy.admit_invitation',
  'footprint identity.complete_account_setup',
  'footprint identity.bootstrap_super_admin',
  'footprint identity.verify_email',
  // L3 — a wait after a contested insert (P5.5 step 1)
  'L3 tenancy.issue_invitation',
  'L3 identity.complete_account_setup',
];

/**
 * Report mode (R34): these findings are reported and tolerated; any other finding fails at once, and an entry that
 * no longer occurs fails until it is deleted here in the same commit — the list only shrinks. P5.5 cannot close
 * until it is empty and the tolerance mechanism is deleted.
 */
export const TOLERATED: readonly string[] = [
  // the actor's authority lock: step 3
  'footprint tenancy.update_membership',
  'footprint tenancy.issue_invitation',
  'footprint tenancy.revoke_invitation',
  'footprint tenancy.set_merchant_status',
  'footprint tenancy.transfer_ownership',
  // the identity lock and the account separation: step 5
  'footprint identity.bootstrap_super_admin',
];

/**
 * The nested-writer table (R27): the one T2 flow allowed to reach pattern-A audit inserts inside its definer call.
 * Account setup's transaction (PasswordService.completeSetup) calls identity.complete_account_setup, which admits each
 * pending invitation through tenancy.admit_invitation_locked, writing one #14 per admission (0..n per transaction).
 * Read by the repository-transaction classifier (apps/api/test/locks), the writer guard and the coverage guard.
 */
export const NESTED_WRITERS: readonly { flow: string; fn: string; pair: string }[] = [
  {
    flow: 'PasswordService.completeSetup',
    fn: 'tenancy.admit_invitation_locked',
    pair: 'auth.invitation_accepted/success',
  },
];

/**
 * Report mode for repository transactions (R34, R17): these match no class until the P5.5 step that rewrites them —
 * the settings writes (direct writes, step 4) and the member, invitation, lifecycle and transfer flows (written with
 * recordWithin until their functions write their own audit rows, steps 3 and 7). The list only shrinks.
 */
export const TRANSACTIONS_TOLERATED: readonly string[] = [
  'MerchantSettingsService.rename',
  'MerchantSettingsService.create',
  'MerchantSettingsService.update',
  'MembershipService.change',
  'InvitationService.create',
  'InvitationService.revoke',
  'InvitationService.accept',
  'MerchantLifecycleService.change',
  'MerchantLifecycleService.transferOwnership',
];

/** Nested-writer entries whose function does not exist yet (step 5 creates tenancy.admit_invitation_locked). */
export const NESTED_WRITERS_TOLERATED: readonly string[] = [
  'PasswordService.completeSetup → tenancy.admit_invitation_locked',
];

/**
 * The classes the baseline reconciliation was made under (the P4 definitions at 5d8904b, the plan's rows as at
 * revision 41): tenancy.admit_invitation existed (replaced by its …_locked inner function), and verify_email's row was
 * "5 → 6". The baseline control uses these, so it keeps reporting exactly BASELINE as the live classes move on.
 */
export const BASELINE_CLASSES: Readonly<Record<string, FnClass>> = {
  ...CLASSES,
  'tenancy.admit_invitation': { class: 'retired', replacedBy: 'tenancy.admit_invitation_locked' },
  'identity.verify_email': {
    class: 'flow',
    categories: [5, 6],
    writes: ['identity.one_time_tokens', 'identity.identities', 'tenancy.merchants'],
  },
};

/** The resolver: the one place a membership kind or platform role decides authority (identity.permissions_of). */
export const RESOLVER: ReadonlySet<string> = new Set(['identity.permissions_of']);

/**
 * The SQL authority guard's explicit list (P5 plan §10 P5.5): every comparison of a kind or role with a literal that
 * is a **data rule** — it names the kind or role of a target or of stored rows, never the caller's authority. Each
 * entry occurs exactly as often as listed; any other literal fails the guard, and so does an entry that stops
 * occurring (the list stays exact).
 */
export const AUTHORITY_DATA_RULES: readonly string[] = [
  // audience eligibility by kind (sign-in, selection, every session check)
  "identity.active_membership: mm.kind = 'agent'",
  "identity.active_membership: mm.kind in ('owner', 'staff')",
  "identity.eligible_memberships: mm.kind = 'agent'",
  "identity.eligible_memberships: mm.kind in ('owner', 'staff')",
  // platform sign-in eligibility — until P5.7 replaces it; from then the guard fails if it remains
  "identity.eligible_memberships: pm.role = 'super_admin'",
  // the bootstrap creates the super admin (operator only; §7.4)
  "identity.bootstrap_super_admin: pm.role = 'super_admin'",
  // the businesses an identity owns, activated by its email verification (BR-2.2; added at P5.5 step 2)
  "identity.verify_email: mm.kind = 'owner'",
  "identity.verify_email: mm.kind = 'owner'",
  // the business's owner, whose verification decides where a reactivation lands (BR-2.2)
  "tenancy.set_merchant_status: mm.kind = 'owner'",
  // the one-owner invariant
  "tenancy.merchant_keeps_one_owner: kind = 'owner'",
  // the invited kind
  "tenancy.issue_invitation: p_kind = 'agent'",
  "tenancy.issue_invitation: p_kind = 'staff'",
  "tenancy.issue_invitation: p_kind = 'staff'",
  "tenancy.issue_invitation: p_kind not in ('staff', 'agent')",
  "tenancy.admit_invitation_locked: v_inv.kind = 'staff'",
  // owner protection, and assignment only to staff
  "tenancy.update_membership: v_target.kind = 'owner'",
  "tenancy.update_membership: v_target.kind <> 'staff'",
  // transfer's demotion and promotion: the former owner, the new owner (a staff member), and the two updates
  "tenancy.transfer_ownership: mm.kind = 'owner'",
  "tenancy.transfer_ownership: mm.kind = 'owner'",
  "tenancy.transfer_ownership: mm.kind = 'staff'",
  "tenancy.transfer_ownership: kind = 'staff'",
  "tenancy.transfer_ownership: kind = 'owner'",
];

/** Authority still decided by a literal — removed when step 3 takes authority from the resolver. The list only shrinks. */
export const AUTHORITY_TOLERATED: readonly string[] = [
  "tenancy.update_membership: v.kind = 'owner'",
  "tenancy.issue_invitation: v.kind = 'owner'",
  "tenancy.revoke_invitation: v.kind = 'owner'",
  "tenancy.list_members: v.kind = 'owner'",
  "tenancy.set_merchant_status: pm.role = 'super_admin'",
  "tenancy.transfer_ownership: pm.role = 'super_admin'",
];
