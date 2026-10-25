// The audit event catalog, mirrored for typing only (P5 plan §8.1; ADR-16 §3.5). The database table
// audit.event_catalog is the authority — its trigger validates every stored event — and test/audit/catalog.test.ts
// compares this list with the table on every run, so the two cannot drift apart. Each writer accepts only its own
// class (§8.1 "one writer per class"); the types below let the compiler refuse a downgrade before any test runs.

export type Outcome = 'success' | 'failure' | 'denied';
export type EventClass = 'atomic' | 'best_effort' | 'sensitive_read';

/** A summary field's rule, as stored in summary_allowlist. */
export type FieldRule =
  | { readonly type: 'string'; readonly max: number; readonly nullable?: true }
  | { readonly type: 'integer'; readonly nullable?: true }
  | { readonly type: 'boolean'; readonly nullable?: true }
  /** A JSON array of at most maxItems strings, each at most max characters (P5.6). */
  | {
      readonly type: 'string_list';
      readonly maxItems: number;
      readonly max: number;
      readonly nullable?: true;
    };

export type CatalogEntry = {
  readonly identifier: string;
  readonly outcome: Outcome;
  readonly class: EventClass;
  /** A (database-owned) or B (mutateAudited) for atomic pairs; null otherwise. */
  readonly pattern: 'A' | 'B' | null;
  readonly summary: Readonly<Record<string, FieldRule>>;
};

const reason = { type: 'string', max: 64 } as const;
const kind = { type: 'string', max: 16 } as const;
const name = { type: 'string', max: 120 } as const;
const status16 = { type: 'string', max: 16 } as const;
const uuid = { type: 'string', max: 36 } as const;
const nullableUuid = { type: 'string', max: 36, nullable: true } as const;
const flag = { type: 'boolean' } as const;
/** A timestamp as the database writes it (to_char … 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'). */
const instant = { type: 'string', max: 40 } as const;
const denial = { reason, kind } as const;
const member = { kind, status: status16, roleId: nullableUuid, branchId: nullableUuid } as const;
/** A role's or a platform staff member's permission set (P5.6, the list rule): at most 32 catalog identifiers. */
const permissionList = { type: 'string_list', maxItems: 32, max: 100 } as const;
/** A debit to a capital or an income account (P6, owner Q4). */
const ledgerDebit = {
  entryId: uuid,
  entryType: { type: 'string', max: 100 },
  accountId: uuid,
  accountCode: { type: 'string', max: 6 },
  amountMinor: { type: 'string', max: 20 },
} as const;

const atomicB = <I extends string, O extends Outcome, S extends Record<string, FieldRule>>(
  identifier: I,
  outcome: O,
  summary: S,
) => ({ identifier, outcome, class: 'atomic', pattern: 'B', summary }) as const;
const atomicA = <I extends string, S extends Record<string, FieldRule>>(identifier: I, summary: S) =>
  ({ identifier, outcome: 'success', class: 'atomic', pattern: 'A', summary }) as const;
/** A sensitive read (§8.1 #33–#36): written only by its designated database function, never from TypeScript. */
const sensitiveRead = <I extends string, S extends Record<string, FieldRule>>(identifier: I, summary: S) =>
  ({ identifier, outcome: 'success', class: 'sensitive_read', pattern: null, summary }) as const;
const bestEffort = <I extends string, O extends Outcome, S extends Record<string, FieldRule>>(
  identifier: I,
  outcome: O,
  summary: S,
) => ({ identifier, outcome, class: 'best_effort', pattern: null, summary }) as const;

export const AUDIT_CATALOG = [
  // identity flows — atomic, pattern B (§8.4)
  atomicB('auth.signup', 'success', {}),
  atomicB('auth.email_verify', 'success', {}),
  atomicB('auth.login', 'success', { stage: { type: 'string', max: 64 }, choices: { type: 'integer' } }),
  atomicB('auth.login_select', 'success', {}),
  atomicB('auth.refresh', 'success', {}),
  atomicB('auth.refresh_token_reuse', 'denied', {
    severity: { type: 'string', max: 16 },
    sessionRevoked: flag,
  }),
  atomicB('auth.logout', 'success', {}),
  atomicB('auth.password_change', 'success', { sessionsRevoked: flag }),
  atomicB('auth.password_reset', 'success', { sessionsRevoked: flag }),
  atomicB('auth.account_setup', 'success', { sessionsRevoked: flag }),
  atomicB('auth.mfa_enrollment_started', 'success', {}),
  atomicB('auth.mfa_enrollment_confirmed', 'success', {}),
  atomicB('auth.mfa_verify', 'success', { method: { type: 'string', max: 32 } }),
  // atomic, pattern A — database-owned (the tenancy and platform ones are transitional until P5.5)
  atomicA('auth.invitation_accepted', {
    path: { type: 'string', max: 32 },
    kind,
  }),
  atomicA('platform.super_admin_bootstrapped', { additional: flag }),
  atomicA('platform.authorization_containment_set', {
    merchantGrantsSuspended: flag,
    platformGrantsSuspended: flag,
    reason: { type: 'string', max: 500 },
  }),
  atomicA('merchant.profile_updated', { name }),
  atomicA('merchant.branch_created', { name }),
  atomicA('merchant.branch_updated', { name, status: status16 }),
  atomicA('merchant.role_created', { name }),
  atomicA('merchant.role_updated', { name, status: status16 }),
  atomicA('merchant.role_permissions_set', { before: permissionList, after: permissionList }),
  atomicA('merchant.member_assigned', member),
  atomicA('merchant.member_deactivated', member),
  atomicA('merchant.member_reactivated', member),
  atomicA('merchant.invitation_issued', {
    kind,
    roleId: nullableUuid,
    branchId: nullableUuid,
    delivery: status16,
  }),
  atomicA('merchant.invitation_revoked', { kind }),
  atomicA('platform.merchant_deactivated', {
    status: { type: 'string', max: 32 },
    reason: { type: 'string', max: 500 },
  }),
  atomicA('platform.merchant_reactivated', { status: { type: 'string', max: 32 } }),
  // the platform team (P5.7): #30, #31, #32, #37
  atomicA('platform.staff_created', { role: { type: 'string', max: 16 } }),
  atomicA('platform.staff_deactivated', {
    grantsRemoved: permissionList,
    sessionsRevoked: { type: 'integer' },
  }),
  atomicA('platform.staff_reactivated', {}),
  atomicA('platform.grants_set', { before: permissionList, after: permissionList }),
  // retention and report handover (P5.8, Part 2)
  atomicA('platform.audit_purged', {
    asOf: { type: 'string', max: 40 },
    runId: uuid,
    pageNo: { type: 'integer' },
    rowsDeleted: { type: 'integer' },
    pageDigest: { type: 'string', max: 64 },
  }),
  atomicA('platform.request_metadata_cleared', {
    asOf: { type: 'string', max: 40 },
    tokensCleared: { type: 'integer' },
    sessionsCleared: { type: 'integer' },
  }),
  atomicA('platform.purge_report_delivered', { reportId: uuid, attemptId: uuid }),
  atomicA('platform.purge_report_requested', { requestId: uuid }),
  atomicA('platform.purge_report_lost', { reportId: uuid, mode: status16 }),
  atomicA('platform.purge_report_copy_destroyed', { reportId: uuid, mode: status16 }),
  atomicA('platform.purge_export_discarded', { runId: uuid, mode: status16 }),
  atomicA('platform.purge_report_confirmed', {
    reportId: uuid,
    runId: uuid,
    rowCount: { type: 'integer' },
    fileSha256: { type: 'string', max: 64 },
  }),
  atomicA('platform.purge_report_handed_over', { reportId: uuid, attemptId: uuid, diskseqChecked: flag }),
  atomicA('platform.purge_report_request_cancelled', {
    requestId: uuid,
    withdrawnReportId: nullableUuid,
  }),
  atomicA('platform.purge_report_handover_abandoned', {
    reportId: uuid,
    attemptId: uuid,
    outcome: status16,
  }),
  atomicA('platform.purge_report_handover_failed', { reportId: uuid, attemptId: uuid }),
  atomicA('platform.ownership_transferred', {
    formerOwnerIdentityId: uuid,
    formerOwnerMembershipId: uuid,
    newOwnerIdentityId: uuid,
    newOwnerMembershipId: uuid,
    formerOwnerRoleId: uuid,
    formerOwnerDeactivated: flag,
  }),
  // the ledger (P6): the books' commands, and every debit to capital or income (owner Q4), written by ledger.post_entry
  atomicA('ledger.account_created', { code: { type: 'string', max: 6 }, name, type: status16 }),
  atomicA('ledger.account_updated', { name, status: status16 }),
  atomicA('ledger.manual_entry_posted', {
    entryId: uuid,
    lineCount: { type: 'integer' },
    totalMinor: { type: 'string', max: 20 },
    effectiveDate: { type: 'string', max: 10 },
  }),
  atomicA('ledger.entry_reversed', { entryId: uuid, reversalId: uuid }),
  atomicA('ledger.capital_debited', ledgerDebit),
  atomicA('ledger.income_debited', ledgerDebit),
  // customers (P7): identifiers, statuses and field names only — never a customer's personal details (TA-14)
  atomicA('customer.created', { branchId: uuid, agentMembershipId: nullableUuid, via: status16 }),
  atomicA('customer.updated', {
    fields: { type: 'string_list', maxItems: 6, max: 16 },
    branchId: uuid,
  }),
  atomicA('customer.deactivated', {}),
  atomicA('customer.reactivated', {}),
  atomicA('customer.agent_assigned', {
    agentMembershipId: nullableUuid,
    previousAgentMembershipId: nullableUuid,
  }),
  atomicA('customer.app_invited', { delivery: status16 }),
  atomicA('customer.app_access_accepted', { path: status16 }),
  atomicA('customer.anonymised', {}),
  // sensitive reads (P5.7): the platform team's view of the businesses, one event per page
  sensitiveRead('platform.merchant_list_read', { limit: { type: 'integer' }, continued: flag }),
  sensitiveRead('platform.merchant_members_read', { limit: { type: 'integer' }, continued: flag }),
  // sensitive reads (P5.8): the activity record itself, one event per page — the window, the page and the filters
  sensitiveRead('merchant.audit_read', {
    from: instant,
    to: instant,
    limit: { type: 'integer' },
    continued: flag,
    membershipId: nullableUuid,
  }),
  sensitiveRead('platform.audit_read', {
    from: instant,
    to: instant,
    limit: { type: 'integer' },
    continued: flag,
    merchantId: nullableUuid,
    membershipId: nullableUuid,
    event: { type: 'string', max: 100, nullable: true },
  }),
  // best effort — identity failures, and the link-issuing successes of O6
  bestEffort('auth.signup', 'failure', { reason }),
  bestEffort('auth.email_verify', 'failure', { reason }),
  bestEffort('auth.verification_resend', 'success', {}),
  bestEffort('auth.verification_resend', 'failure', { reason }),
  bestEffort('auth.login', 'failure', { reason }),
  bestEffort('auth.login_select', 'failure', { reason }),
  bestEffort('auth.refresh', 'failure', { reason }),
  bestEffort('auth.password_forgot', 'success', { link: { type: 'string', max: 32 } }),
  bestEffort('auth.password_forgot', 'failure', { reason }),
  bestEffort('auth.password_change', 'failure', { reason }),
  bestEffort('auth.password_reset', 'failure', { reason }),
  bestEffort('auth.account_setup', 'failure', { reason }),
  bestEffort('auth.mfa_enrollment_confirmed', 'failure', { reason }),
  bestEffort('auth.mfa_verify', 'failure', { method: { type: 'string', max: 32 }, reason }),
  bestEffort('auth.invitation_accepted', 'failure', { reason }),
  // best effort — tenancy and platform refusals and failures
  bestEffort('merchant.profile_updated', 'denied', denial),
  bestEffort('merchant.branch_created', 'denied', denial),
  bestEffort('merchant.branch_updated', 'denied', denial),
  bestEffort('merchant.role_created', 'denied', denial),
  bestEffort('merchant.role_updated', 'denied', denial),
  bestEffort('merchant.role_permissions_set', 'denied', denial),
  bestEffort('merchant.role_permissions_set', 'failure', { reason }),
  bestEffort('merchant.member_assigned', 'denied', denial),
  bestEffort('merchant.member_assigned', 'failure', { reason }),
  bestEffort('merchant.member_deactivated', 'denied', denial),
  bestEffort('merchant.member_deactivated', 'failure', { reason }),
  bestEffort('merchant.member_reactivated', 'denied', denial),
  bestEffort('merchant.member_reactivated', 'failure', { reason }),
  bestEffort('merchant.invitation_issued', 'denied', denial),
  bestEffort('merchant.invitation_issued', 'failure', { reason }),
  bestEffort('merchant.invitation_revoked', 'denied', denial),
  bestEffort('merchant.invitation_revoked', 'failure', { reason }),
  bestEffort('platform.merchant_deactivated', 'denied', { reason }),
  bestEffort('platform.merchant_deactivated', 'failure', { reason }),
  bestEffort('platform.merchant_reactivated', 'denied', { reason }),
  bestEffort('platform.merchant_reactivated', 'failure', { reason }),
  bestEffort('platform.ownership_transferred', 'denied', { reason }),
  bestEffort('platform.ownership_transferred', 'failure', { reason }),
  bestEffort('platform.staff_created', 'denied', { reason }),
  bestEffort('platform.staff_created', 'failure', { reason }),
  bestEffort('platform.staff_deactivated', 'denied', { reason }),
  bestEffort('platform.staff_deactivated', 'failure', { reason }),
  bestEffort('platform.staff_reactivated', 'denied', { reason }),
  bestEffort('platform.staff_reactivated', 'failure', { reason }),
  bestEffort('platform.grants_set', 'denied', { reason }),
  bestEffort('platform.grants_set', 'failure', { reason }),
  bestEffort('platform.merchant_list_read', 'denied', { reason }),
  bestEffort('platform.merchant_members_read', 'denied', { reason }),
  bestEffort('merchant.audit_read', 'denied', { reason }),
  bestEffort('platform.audit_read', 'denied', { reason }),
  bestEffort('ledger.account_created', 'denied', denial),
  bestEffort('ledger.account_updated', 'denied', denial),
  bestEffort('ledger.manual_entry_posted', 'denied', denial),
  bestEffort('ledger.entry_reversed', 'denied', denial),
  ...(
    [
      'customer.created',
      'customer.updated',
      'customer.deactivated',
      'customer.reactivated',
      'customer.agent_assigned',
      'customer.app_invited',
      'customer.anonymised',
    ] as const
  ).map((identifier) => bestEffort(identifier, 'denied', denial)),
  bestEffort('customer.app_access_accepted', 'failure', { reason }),
  // best effort — the policy middleware's refusal (P5.4): the refused operation and the permission it requires
  bestEffort('authz.denied', 'denied', {
    operation: { type: 'string', max: 64 },
    permission: { type: 'string', max: 100 },
  }),
] as const satisfies readonly CatalogEntry[];

type Entries = (typeof AUDIT_CATALOG)[number];
type PairOf<E> = E extends { identifier: infer I; outcome: infer O } ? { action: I; outcome: O } : never;

/** Atomic pairs written by mutateAudited, inside the change's transaction (pattern B, §8.4). */
export type PatternBPair = PairOf<Extract<Entries, { class: 'atomic'; pattern: 'B' }>>;
/** Pairs written by recordBestEffort, in their own transaction. */
export type BestEffortPair = PairOf<Extract<Entries, { class: 'best_effort' }>>;

const BY_PAIR: ReadonlyMap<string, CatalogEntry> = new Map(
  AUDIT_CATALOG.map((e) => [`${e.identifier}/${e.outcome}`, e]),
);
const IDENTIFIERS_WITH_BEST_EFFORT: ReadonlySet<string> = new Set(
  AUDIT_CATALOG.filter((e) => e.class === 'best_effort').map((e) => e.identifier),
);

/** The catalog entry of one (identifier, outcome) pair, if any. */
export const catalogEntry = (action: string, outcome: string): CatalogEntry | undefined =>
  BY_PAIR.get(`${action}/${outcome}`);

/** Whether an identifier has any best-effort pair (so an unlisted outcome of it is a data error, not a typo). */
export const hasBestEffortPair = (action: string): boolean => IDENTIFIERS_WITH_BEST_EFFORT.has(action);
