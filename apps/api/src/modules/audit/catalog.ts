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
  | { readonly type: 'boolean'; readonly nullable?: true };

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
const denial = { reason, kind } as const;
const member = { kind, status: status16, roleId: nullableUuid, branchId: nullableUuid } as const;

const atomicB = <I extends string, O extends Outcome, S extends Record<string, FieldRule>>(
  identifier: I,
  outcome: O,
  summary: S,
) => ({ identifier, outcome, class: 'atomic', pattern: 'B', summary }) as const;
const atomicA = <I extends string, S extends Record<string, FieldRule>>(identifier: I, summary: S) =>
  ({ identifier, outcome: 'success', class: 'atomic', pattern: 'A', summary }) as const;
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
  atomicA('auth.invitation_accepted', {}),
  atomicA('platform.super_admin_bootstrapped', { additional: flag }),
  atomicA('merchant.profile_updated', { name }),
  atomicA('merchant.branch_created', { name }),
  atomicA('merchant.branch_updated', { name, status: status16 }),
  atomicA('merchant.role_created', { name }),
  atomicA('merchant.role_updated', { name, status: status16 }),
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
  atomicA('platform.ownership_transferred', {
    formerOwnerIdentityId: uuid,
    formerOwnerMembershipId: uuid,
    newOwnerIdentityId: uuid,
    newOwnerMembershipId: uuid,
    formerOwnerRoleId: uuid,
    formerOwnerDeactivated: flag,
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

/**
 * P5.3a's closed transitional list (§10 P5.3a): P4's tenancy and platform pattern-A pairs, still written by P4's code
 * with recordWithin(tx) in the change's own transaction until their definer functions write them (P5.5). P5.5 empties
 * this list and deletes it; nothing else may use recordWithin.
 */
export const TRANSITIONAL_PAIRS = [
  'auth.invitation_accepted/success',
  'merchant.profile_updated/success',
  'merchant.branch_created/success',
  'merchant.branch_updated/success',
  'merchant.role_created/success',
  'merchant.role_updated/success',
  // P5.5 step 3: the member, invitation, lifecycle and transfer successes are written by their functions (pattern A).
] as const;
type IdentifierOf<K> = K extends `${infer I}/success` ? I : never;
export type TransitionalPair = Extract<
  PairOf<Extract<Entries, { class: 'atomic'; pattern: 'A' }>>,
  { action: IdentifierOf<(typeof TRANSITIONAL_PAIRS)[number]> }
>;

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
