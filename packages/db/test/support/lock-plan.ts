import type { FnClass } from './lock-analysis.js';

// The lock-order guard's plan data (P5 plan §7.2): how every function of the identity, tenancy, audit and util schemas
// is checked, the planned footprints as token sequences, the baseline reconciliation (R34), the nested-writer table
// (R27) and the SQL authority guard's data rules. Kept here and in the plan; a change to either is a change to both.
// Enforcing mode since P5.5 closed its steps: no finding is tolerated, and no tolerance list may be added back (the
// lock-order guard fails if one is exported).
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
    writes: ['tenancy.merchant_memberships', 'identity.sessions', 'audit.audit_events'],
  },
  'tenancy.issue_invitation': {
    class: 'operation',
    planned: ['2:S', 'A3:NKU', '4:NKU', '5:NKU', '6:S', '7:S', '8:S', '+6', '+4'],
    writes: ['identity.identities', 'identity.one_time_tokens', 'tenancy.invitations', 'audit.audit_events'],
  },
  'tenancy.revoke_invitation': {
    class: 'operation',
    planned: ['2:S', 'A3:NKU', '4:NKU'],
    writes: ['tenancy.invitations', 'audit.audit_events'],
  },
  'tenancy.accept_invitation': {
    class: 'operation',
    planned: ['2:S', '4:NKU', '6:S', '7:S', '8:S', '+3'],
    writes: ['tenancy.merchant_memberships', 'tenancy.invitations', 'audit.audit_events'],
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
      'audit.audit_events',
    ],
  },
  'tenancy.set_merchant_status': {
    class: 'operation',
    planned: ['A1:S', '2:NKU', '6:S'],
    writes: ['tenancy.merchants', 'audit.audit_events'],
  },
  'tenancy.transfer_ownership': {
    class: 'operation',
    planned: ['A1:S', '2:NKU', '3:NKU', '6:S', '7:S', '10:W'],
    writes: ['tenancy.merchant_memberships', 'identity.sessions', 'audit.audit_events'],
  },
  // branch, role and profile writers (P5.5 step 4, the enforcement boundary): the plan's "branch / role / profile
  // writers" row — the merchant (the profile: NKU, it is the row changed), the actor, the actor's role and the edited
  // role in one sorted call, the edited branch; the contested insert last (L3)
  'tenancy.update_profile': {
    class: 'operation',
    planned: ['2:NKU', 'A3:NKU', '7:S'],
    writes: ['tenancy.merchants', 'audit.audit_events'],
  },
  'tenancy.create_branch': {
    class: 'operation',
    planned: ['2:S', 'A3:NKU', '7:S', '+8'],
    writes: ['tenancy.branches', 'audit.audit_events'],
  },
  'tenancy.update_branch': {
    class: 'operation',
    planned: ['2:S', 'A3:NKU', '7:S', '8:NKU'],
    writes: ['tenancy.branches', 'audit.audit_events'],
  },
  'tenancy.create_role': {
    class: 'operation',
    planned: ['2:S', 'A3:NKU', '7:S', '+7'],
    writes: ['tenancy.roles', 'audit.audit_events'],
  },
  'tenancy.update_role': {
    class: 'operation',
    planned: ['2:S', 'A3:NKU', '7:S+NKU'],
    writes: ['tenancy.roles', 'audit.audit_events'],
  },
  // role permission management (P5.6): the plan's row — the merchant, the acting member, the edited role, then the
  // role's grant rows rewritten while it is held (removals, then the contested inserts last, L3)
  'tenancy.set_role_permissions': {
    class: 'operation',
    planned: ['2:S', 'A3:NKU', '7:NKU', '9:W', '+9'],
    writes: ['tenancy.role_permissions', 'audit.audit_events'],
  },
  // platform staff (P5.7, §7.4, §7.5): the actor's platform membership first (S), with the target (NKU) in the same
  // sorted call; creation's contested inserts last (L3); deactivation removes the grant rows and ends the sessions
  'identity.create_platform_staff': {
    class: 'operation',
    planned: ['A1:S', '+6', '+1'],
    writes: [
      'identity.identities',
      'identity.platform_memberships',
      'identity.one_time_tokens',
      'audit.audit_events',
    ],
  },
  'identity.set_platform_staff_status': {
    class: 'operation',
    planned: ['A1:S+NKU', '9:W', '10:W'],
    writes: [
      'identity.platform_memberships',
      'identity.platform_membership_grants',
      'identity.sessions',
      'audit.audit_events',
    ],
  },
  'identity.set_platform_grants': {
    class: 'operation',
    planned: ['A1:S+NKU', '9:W', '+9'],
    writes: ['identity.platform_membership_grants', 'audit.audit_events'],
  },
  // sensitive reads (P5.7, §7.2 rows #35 and #36): the actor's platform membership (S) — the authority lock — then the
  // read event, then the rows (one SELECT, no row locks)
  'tenancy.platform_list_merchants': {
    class: 'operation',
    planned: ['A1:S'],
    writes: ['audit.audit_events'],
  },
  'tenancy.platform_list_merchant_members': {
    class: 'operation',
    planned: ['A1:S'],
    writes: ['audit.audit_events'],
  },
  // the activity-record reads (P5.8, §7.2 rows #33 and #34): the reader's membership (S) — the owner's merchant
  // membership, or the reader's platform membership — then the read event, then the rows (one SELECT, no row locks)
  'audit.read_merchant_events': {
    class: 'operation',
    planned: ['A3:S'],
    writes: ['audit.audit_events'],
  },
  'audit.read_platform_events': {
    class: 'operation',
    planned: ['A1:S'],
    writes: ['audit.audit_events'],
  },
  // operator only: the containment switch (§11.1, P5.5 step 6) — its one row, then #39
  'util.set_authorization_containment': {
    class: 'operation',
    planned: ['0:NKU'],
    writes: ['util.authorization_containment', 'audit.audit_events'],
  },
  // ── the retention purge (P5.8 step (a), Part 2; plan §8.6, §7.2's purge rows): operator only ──
  // the helpers: constants and the canonical text, lock-free
  'audit.d9_retention': { class: 'reader' },
  'audit.purge_lease': { class: 'reader' },
  'audit.event_canonical_text': { class: 'reader' },
  // the table's own guard (L4): reads without locks, locks and writes nothing
  'audit.audit_events_guard': { class: 'trigger' },
  'audit.reserve_purge_run': {
    class: 'operation',
    planned: ['0:W', '0:W', '0:W', '+0'],
    writes: [
      'audit.purge_reservation',
      'audit.purge_runs',
      'audit.purge_run_events',
      'audit.purge_run_pages',
    ],
  },
  'audit.renew_purge_run': { class: 'operation', planned: [], writes: ['audit.purge_reservation'] },
  'audit.release_purge_run': {
    class: 'operation',
    planned: ['0:W', '0:W', '0:W'],
    writes: [
      'audit.purge_reservation',
      'audit.purge_runs',
      'audit.purge_run_events',
      'audit.purge_run_pages',
    ],
  },
  'audit.purge_candidates': {
    class: 'operation',
    planned: ['0:NKU', '+0'],
    writes: [
      'audit.purge_reservation',
      'audit.purge_runs',
      'audit.purge_run_pages',
      'audit.purge_run_events',
    ],
  },
  'audit.purge_expired_events': {
    class: 'operation',
    planned: ['0:W', '11:W'],
    writes: ['audit.purge_reservation', 'audit.purge_run_pages', 'audit.audit_events'],
  },
  'audit.clear_expired_request_metadata': {
    class: 'operation',
    planned: [],
    writes: ['identity.one_time_tokens', 'identity.sessions', 'audit.audit_events'],
  },
  'audit.request_purge_report': {
    class: 'operation',
    planned: [],
    writes: ['audit.purge_report_requests', 'audit.audit_events'],
  },
  'audit.cancel_purge_report_request': {
    class: 'operation',
    planned: ['0:W', '0:W', '0:W', '0:W'],
    writes: [
      'audit.purge_report_requests',
      'audit.purge_reports',
      'audit.purge_run_events',
      'audit.purge_run_pages',
      'audit.audit_events',
    ],
  },
  'audit.begin_purge_export': {
    class: 'operation',
    planned: ['+0'],
    writes: ['audit.purge_reservation', 'audit.purge_exports'],
  },
  'audit.record_export_artifact': {
    class: 'operation',
    planned: ['0:W'],
    writes: ['audit.purge_reservation', 'audit.purge_exports'],
  },
  'audit.discard_purge_export': {
    class: 'operation',
    planned: ['0:W', '0:W', '0:W'],
    writes: [
      'audit.purge_reservation',
      'audit.purge_exports',
      'audit.purge_run_events',
      'audit.purge_run_pages',
      'audit.audit_events',
    ],
  },
  'audit.confirm_purge_report': {
    class: 'operation',
    planned: ['0:W', '+0'],
    writes: ['audit.purge_reservation', 'audit.purge_exports', 'audit.purge_reports', 'audit.audit_events'],
  },
  'audit.begin_report_handover': {
    class: 'operation',
    planned: ['0:NKU', '+0'],
    writes: ['audit.purge_report_handovers'],
  },
  'audit.record_handover_written': {
    class: 'operation',
    planned: ['0:W'],
    writes: ['audit.purge_report_handovers'],
  },
  'audit.record_report_handover': {
    class: 'operation',
    planned: ['0:NKU'],
    writes: ['audit.purge_report_handovers', 'audit.audit_events'],
  },
  'audit.record_handover_failed': {
    class: 'operation',
    planned: ['0:NKU'],
    writes: ['audit.purge_report_handovers', 'audit.audit_events'],
  },
  'audit.record_handover_abandoned': {
    class: 'operation',
    planned: ['0:NKU'],
    writes: ['audit.purge_report_handovers', 'audit.audit_events'],
  },
  'audit.record_report_delivery': {
    class: 'operation',
    planned: ['0:NKU', '0:W', '0:W', '0:W'],
    writes: [
      'audit.purge_reports',
      'audit.purge_report_requests',
      'audit.purge_run_events',
      'audit.purge_run_pages',
      'audit.audit_events',
    ],
  },
  'audit.record_report_copy_destroyed': {
    class: 'operation',
    planned: ['0:NKU'],
    writes: ['audit.purge_reports', 'audit.audit_events'],
  },
  'audit.record_report_lost': {
    class: 'operation',
    planned: ['0:NKU', '0:W', '0:W'],
    writes: ['audit.purge_reports', 'audit.purge_run_events', 'audit.purge_run_pages', 'audit.audit_events'],
  },
  // operator only (§7.4, rev 14)
  'identity.bootstrap_super_admin': {
    class: 'operation',
    planned: ['6:NKU', '+6', '+1'],
    writes: ['identity.identities', 'identity.platform_memberships', 'audit.audit_events'],
  },
  // admission, inside accept_invitation and complete_account_setup: waits for nothing (L6, P5.5 step 2); records
  // each acceptance (#14, pattern A, P5.5 step 5)
  'tenancy.admit_invitation_locked': {
    class: 'locked',
    writes: ['tenancy.merchant_memberships', 'tenancy.invitations', 'audit.audit_events'],
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
  // the B1 read functions (P5.5 step 4)
  'tenancy.list_branches': { class: 'reader' },
  'tenancy.list_invitations': { class: 'reader' },
  'tenancy.list_permission_catalog': { class: 'reader' },
  'tenancy.list_roles': { class: 'reader' },
  'tenancy.read_own_membership': { class: 'reader' },
  'tenancy.read_profile': { class: 'reader' },
  // the platform team (P5.7): B1 reader of platform.staff.manage
  'identity.list_platform_staff': { class: 'reader' },
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
 * The merchant-scoped definer reads (R19; P5 plan §8.5; the reviewer's condition for P5.8): each takes a merchant
 * session, and the merchant-scope guard (merchantScopeFindings) requires every tenant table it reads to be filtered by
 * the business that session gives. Every reader or sensitive read that reads a tenant table — whatever its parameters
 * are called — is listed here, in MERCHANT_SCOPE_EXEMPT or in MERCHANT_SCOPE_INTERNAL: a new one cannot escape the
 * check by not being listed, nor by naming its session parameter otherwise (the P5.8 hold-point review).
 */
export const MERCHANT_SCOPED_READS: readonly string[] = [
  'audit.read_merchant_events',
  'identity.session_authority',
  'tenancy.list_branches',
  'tenancy.list_invitations',
  'tenancy.list_members',
  'tenancy.list_roles',
  'tenancy.read_own_membership',
  'tenancy.read_profile',
];

/** Readers with a session that read a tenant table without a session-derived business filter, each with its reason. */
export const MERCHANT_SCOPE_EXEMPT: Readonly<Record<string, string>> = {
  'identity.validate_session':
    'the session resolution itself: it derives the business from the session row, for every audience',
  'tenancy.platform_list_merchants':
    'a platform read, cross-tenant by design: platform.merchants.read under the reader’s lock, and recorded (P5.7)',
  'tenancy.platform_list_merchant_members':
    'a platform read, cross-tenant by design: platform.merchants.read under the reader’s lock, and recorded (P5.7)',
  'audit.read_platform_events':
    'a platform read, cross-tenant by design: platform.audit.read under the reader’s lock, and recorded (P5.8)',
};

/**
 * Readers of a tenant table that take no session and that no application role may execute (the guard checks it):
 * building blocks of the resolvers and the login flows, called only by definer functions with an identity or a
 * membership those have already resolved.
 */
export const MERCHANT_SCOPE_INTERNAL: Readonly<Record<string, string>> = {
  'audit.event_canonical_text':
    'canonicalizes a caller-supplied audit row for the operator export; it reads no table and takes no session',
  'identity.active_membership':
    'the session, MFA and refresh flows’ check of a membership the identity already holds',
  'identity.eligible_memberships': 'the login flow’s list of the memberships an identity may choose from',
  'identity.permissions_of':
    'the permissions of a membership session_authority or assert_authority has already resolved from the session',
};

/**
 * The designated sensitive-read functions (P5 plan §8.1 #33–#36, R16, R18): each read pair has exactly one writer, the
 * function that checks the reader's authority under its locks and returns the rows in the same transaction. Read by
 * the API's writer guard (a read pair written anywhere else is rejected) and its transaction classes (T4: one call of
 * one of these functions).
 */
export const SENSITIVE_READS: Readonly<Record<string, string>> = {
  'platform.merchant_list_read/success': 'tenancy.platform_list_merchants',
  'platform.merchant_members_read/success': 'tenancy.platform_list_merchant_members',
  'merchant.audit_read/success': 'audit.read_merchant_events',
  'platform.audit_read/success': 'audit.read_platform_events',
};

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
 * is a **data rule** — it names the kind or role of a target or of stored rows, never the caller's authority — or the
 * one **visibility rule** the owner tied to a role itself (D9, F3: the address and device in the platform's record are
 * the super admin's alone, whatever a staff member's grants; the read itself is still granted by the resolver). Each
 * entry occurs exactly as often as listed; any other literal fails the guard, and so does an entry that stops
 * occurring (the list stays exact).
 */
export const AUTHORITY_DATA_RULES: readonly string[] = [
  // audience eligibility by kind (sign-in, selection, every session check)
  "identity.active_membership: mm.kind = 'agent'",
  "identity.active_membership: mm.kind in ('owner', 'staff')",
  "identity.eligible_memberships: mm.kind = 'agent'",
  "identity.eligible_memberships: mm.kind in ('owner', 'staff')",
  // platform staff (P5.7): the label a new member is given, never super_admin; and the super admin is not staff —
  // neither managed by the staff functions nor listed with the team
  "identity.create_platform_staff: p_role not in ('support', 'verification', 'finance')",
  "identity.set_platform_staff_status: v_target.role = 'super_admin'",
  "identity.set_platform_grants: v_target.role = 'super_admin'",
  "identity.list_platform_staff: pm.role <> 'super_admin'",
  // the platform's record (#34, P5.8): the address and device shown to the super admin only (D9, F3) — after
  // tenancy.assert_authority has granted platform.audit.read
  "audit.read_platform_events: pm.role = 'super_admin'",
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
