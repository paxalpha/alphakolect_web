# P5 implementation plan — authorization catalog, policy enforcement and audit

**Status: DRAFT, revision 9 (owner review A–E; independent reviews R1–R22 and fixes A–D applied; O6 decided, §16).
Implementation is not authorized.** This plan becomes
executable only after the owner and the independent reviewer approve it (§12).

| | |
|---|---|
| Repository | `paxalpha/alphakolect_web` |
| Branch | `feat/p5-authorization-audit` (no upstream) |
| Baseline | `5d8904b` (P4 merged); working tree clean apart from the untracked P5 review documents |
| Inputs | `P5_AUDIT_REPORT.md` (incl. §22 review outcome and owner decisions), `P5_REVIEW_HANDOFF.md`, `P5_EVIDENCE_PACK.md`, the plan draft supplied by the reviewer, and direct source inspection |
| Prepared | 2026-10-11 |

Labels: **[Fact]** verified in the source at `5d8904b` during planning · **[Plan]** a planned change ·
**[Assumption]** to be confirmed at the start of the package named · **[Open]** needs a decision (§11).

---

## 1. Scope and hard constraints

**In scope:** a database permission catalog; merchant role permissions; per-platform-membership staff grants;
authorization declared for every endpoint; one authorization source shared by the API and the `SECURITY DEFINER`
functions; write-time re-checks; delegation limits; platform staff sign-in; an audit event catalog with explicit
failure semantics (including A7); audit read APIs; tests proving P4 is preserved.

**Out of scope (by decision):** assigned-customer authorization for agents and anything else that needs customers,
assignments, collections or remittances (D1 → P7/P8); permissions for features that do not exist yet (D2); billing
suspension (P10); an IP/user-agent retention period (D9 stays open — §8.6).

**Constraints for every package:**

1. No change weakens authentication, MFA, CSRF, refresh rotation, session revocation, RLS, composite keys, the
   one-owner rule or the identity definer boundary.
2. Forward-only migrations following the repository convention (§9.1); no edits to existing migration files.
3. No fail-open state at any commit or deployment step (§10).
4. Each package ends with the full local gate (§9.3) green and its new guards proven by mutation (break → test fails →
   restore).
5. Commits small and separate, on this branch only; nothing pushed or merged without the owner.

## 2. Verified baseline (facts the plan builds on)

| Area | Fact | Evidence |
|---|---|---|
| Per-request validation | Session, identity, membership, merchant status, kind, role and branch are re-read on every request | `apps/api/src/platform/http/authenticate.ts:125`; `20261010000200_session_context` |
| Tenant context | Derived only from the validated session; scoped repository transactions set `app.merchant_id` | `apps/api/src/platform/tenant.ts:34-72` |
| Interim authority (API) | `requireOwner` (`tenant.ts:78`) with 13 call sites in `merchant-settings.ts`, `memberships.ts`, `invitations.ts` | audit report §7 |
| Interim authority (SQL) | `v.kind = 'owner'` in `list_members`/`update_membership` (`20261011000200:31,62`) and `issue_invitation`/`revoke_invitation` (`20261012000100:195,262`); `pm.role = 'super_admin'` in `set_merchant_status` (`20261009000100:104`) and `transfer_ownership` (`20261011000300:40`) | evidence pack §C |
| Platform sign-in | Only `super_admin` is eligible (`20261009000200:57`); roles `support`, `verification`, `finance` exist (`20261003000100:230`) | evidence pack §C, §D |
| Direct writes | The app writes branches and roles (`INSERT`, `UPDATE(name,status,archived_at,updated_at)`, `20261009000300:86-87`) and merchant `name` (`20260927000200:17`) under RLS, with no database authority check | evidence pack §D |
| Registry | 44 operations; authentication and validation are mounted from contract metadata; no authorization metadata | `packages/contracts/src/registry.ts:33-58`; `apps/api/src/platform/http/routes.ts:21-37` |
| Query parameters | Request validation refuses contracts that declare `query` (startup error) — needed for pagination | `apps/api/src/platform/http/validate.ts` (`needsValidation`) |
| Audit storage | Append-only (grant + trigger for every role); RLS: app reads own tenant, inserts own-tenant or tenant-less events | `20260927000300:142-147`; `20260927000400:69-78` |
| Audit atomicity (P4) | Tenancy commands call the definer function and `recordWithin(tx)` in the same `withTenant` transaction — **already atomic** | `modules/tenancy/memberships.ts:108-113` |
| Audit atomicity (P3) | Identity mutations run as single autocommitted calls, then `audit.record` in a separate transaction — **not atomic** | `password-flows.ts:136-137`, `sessions.ts:328-329`, `accounts.ts:46-62,79-91`, `mfa.ts` |
| A7 | Refusal paths `await audit.record(...)` before rethrowing; an audit failure turns 401/403 into 500 | §8.3 inventory |
| Precedent | A definer function writing its own audit row | `20261003000500_rate_limit_and_bootstrap:64` |
| No future resources | No customer, assignment, collection or remittance tables or endpoints | `packages/db/prisma/schema.prisma` (21 models) |

## 3. Governing decisions

**Numbering.** In this plan, **D1–D12** are the P5 decisions below. The identity decisions of ADR-14 also use D-numbers
(D1–D15); whenever one of those is meant, it is written **ADR-14 Dn** (e.g. ADR-14 D12, anti-enumeration).

Owner decisions (recorded in `P5_AUDIT_REPORT.md` §22.4): **D1** assigned-customer authorization → P7/P8; **D4**
per-platform-membership grants, no defaults, merchant lifecycle / ownership transfer / platform staff management
super-admin only; **D5** only owners edit roles and their permissions, staff assign or invite only within their own
permission ceiling and never touch the owner; **D9** open, policy before P5 closes.

Agreed positions (report §22.3), proceeding unless the owner objects: **D2** permissions per phase; **D3**
read/manage per area; **D6** archived roles grant nothing; **D7** fail closed for branch restriction, no
branch-resource isolation claimed; **D8** grantable `merchant.audit.read`, tenant-scoped; **D10** security-state
identity changes atomic with their audit event, login attempts best effort; **D11** actor derived from the validated
session for privileged operations; **D12** privileged writes re-check current authority in their own transaction.

## 4. Authorization model and invariants

1. **One source of truth.** The permission catalog table is authoritative for identifiers, scope and grantability.
   The contracts package exports the same identifiers as a literal union **for typing only**; an API test compares it
   with the catalog table on every run and fails on any difference (no second authority).
2. **No permissions in tokens.** Effective permissions are resolved from the database per request (alongside
   `validate_session`), never cached, never read from claims.
3. **Fixed sets are code, not rows.** The owner holds every **merchant** permission; the super admin every
   **platform** permission. Resolved implicitly, so a new catalog permission reaches owners and super admins
   automatically and **no one else** (staff need an explicit role grant; platform staff an explicit membership grant).
4. **Reserved permissions** (`grantable = false`) are never storable in a grant table: `merchant.roles.manage`
   (owner only, D5); `platform.merchants.lifecycle`, `platform.merchants.transfer_ownership`,
   `platform.staff.manage` (super admin only, D4).
5. **Staff** hold exactly the permissions of their role, only while the membership is active, the merchant is
   active and the role is active (archived ⇒ nothing, D6). **Agents** hold no merchant permission (self only, until
   P7/P8). **Platform staff** hold exactly their membership's grants.
6. **Write-time authority.** Every privileged write re-checks the actor's current authority inside the transaction
   that performs it, under locks that serialize it with conflicting grant changes (§7).
7. **Declared authorization.** Every endpoint declares exactly one class (§5); the router refuses to start on a
   missing or invalid declaration; nothing defaults to public. **The authorization middleware fails closed:** any error
   while resolving or evaluating authority ends the request with an error, never with `next()` (the legacy
   subscription middleware failed open on error — CURRENT_SYSTEM_INVENTORY / ARCHITECTURE_RECONNAISSANCE §5.2).
   **Failure versus denial:** an error while resolving or evaluating authority (database or network failure, an
   unexpected resolver result) is an **operational error**: the request ends with **500 `INTERNAL_ERROR`** through the
   existing error handler ([Fact] unknown errors are logged server-side and answered `500 INTERNAL_ERROR` with nothing
   revealed — `apps/api/src/platform/http/error-handler.ts`), is logged with the request id and counted
   (`authorization_resolution_failure`), and is **never** reported as 401/403 and **never** recorded as a denial
   (`authz.denied` is written only for a resolved refusal, §8.2a rules 5–6). Genuine outcomes keep their codes: an
   invalid or absent session 401, a resolved missing permission 403, another tenant's resource 404. Tests inject a
   resolver failure and assert: no handler runs, the status is 500 with `INTERNAL_ERROR`, the metric and error log are
   emitted, and no denial event is written.
8. **Unchanged response semantics:** 401 invalid/absent session; 403 `WRONG_AUDIENCE`; 404 for another tenant's
   resource (and for a forged id); 403 `FORBIDDEN` for a known own-tenant resource without permission (T15).
9. **Tenant RLS stays in force** after every permission check; the scoped repository is unchanged.
10. **Audit summaries are per-event allowlists**; failure behaviour is defined per event class (§8).

## 5. Endpoint authorization classes and the complete route map

Classes (exactly one per endpoint, declared in the contract):

- **`public`** — no credential (health, signup, resend, forgot).
- **`capability`** — a named, narrow credential other than a session: `credentials` (email+password),
  `refresh_token` (cookie or body), `mfa_challenge`, `selection_challenge`, `email_verification_token`,
  `password_reset_token`, `account_setup_token`, `invitation_token` (with password).
- **`self`** — an authenticated session acting only on its own identity or membership.
- **`permission`** — a catalog permission (one identifier; delegation limits are enforced by the database, not by
  combining permissions).

[Fact] 44 operations at `5d8904b`; [Plan] the classification below is frozen in P5.0.

| Operation | Class | Declaration |
|---|---|---|
| getHealth, signup, resendVerification, forgotPassword | public | — |
| login, agentLogin | capability | `credentials` |
| refreshSession, agentRefresh | capability | `refresh_token` |
| verifyMfa | capability | `mfa_challenge` |
| listLoginMemberships, selectLoginMembership, agentSelectMembership | capability | `selection_challenge` |
| verifyEmail | capability | `email_verification_token` |
| resetPassword | capability | `password_reset_token` |
| completeAccountSetup | capability | `account_setup_token` |
| acceptInvitation | capability | `invitation_token` |
| logout, getSession, changePassword, beginTotpEnrollment, confirmTotpEnrollment, getCurrentMembership, getAgentMembership | self | — |
| getMerchantProfile / updateMerchantProfile | permission | `merchant.profile.read` / `merchant.profile.update` |
| listBranches, getBranch / createBranch, updateBranch | permission | `merchant.branches.read` / `merchant.branches.manage` |
| listRoles, getRole / createRole, updateRole | permission | `merchant.roles.read` / `merchant.roles.manage` (reserved: owner) |
| listMembers, getMember / assignMember, deactivateMember, reactivateMember | permission | `merchant.members.read` / `merchant.members.manage` (+ delegation ceiling, §7.3) |
| listInvitations / createInvitation, revokeInvitation | permission | `merchant.invitations.read` / `merchant.invitations.manage` (+ ceiling) |
| deactivateMerchant, reactivateMerchant | permission | `platform.merchants.lifecycle` (reserved: super admin) |
| transferOwnership | permission | `platform.merchants.transfer_ownership` (reserved: super admin) |

**New operations proposed for P5** (contracts finalized in P5.0; additive, non-breaking):

| Proposed operation | Class / permission | Package |
|---|---|---|
| `GET /v1/merchant/permissions` — the merchant catalog (for role editing UIs) | `merchant.roles.read` | P5.6 |
| `PUT /v1/merchant/roles/{roleId}/permissions` — replace a role's permission set | `merchant.roles.manage` (owner) | P5.6 |
| Effective permissions added to `GET /v1/merchant/membership` (new response field) | self | P5.4 |
| Effective permissions added to `GET /v1/auth/session` (new response field; platform sessions — the platform console's navigation is built from server-provided permissions, RESTRUCTURING_MAP §2.4; empty for agents and enrolment-only sessions) | self | P5.7 |
| `GET /v1/merchant/audit-events` (cursor-paginated) | `merchant.audit.read` | P5.8 |
| `GET /v1/platform/merchants` (list merchants; cursor-paginated) | `platform.merchants.read` | P5.7 |
| `GET /v1/platform/merchants/{merchantId}/members` (one merchant's memberships; cursor-paginated) | `platform.merchants.read` | P5.7 |
| Platform staff: create/deactivate, set grants (`/v1/platform/staff…`) | `platform.staff.manage` (super admin) | P5.7 |
| `GET /v1/platform/audit-events` (cursor-paginated) | `platform.audit.read` | P5.8 |

## 6. Permission catalog (frozen in P5.0)

| Identifier | Scope | Grantable | Holders | Notes |
|---|---|---|---|---|
| `merchant.profile.read` | merchant | yes | owner; staff via role | |
| `merchant.profile.update` | merchant | yes | owner; staff via role | audited |
| `merchant.branches.read` | merchant | yes | owner; staff via role | |
| `merchant.branches.manage` | merchant | yes | owner; staff via role | create/rename/archive/restore; audited |
| `merchant.roles.read` | merchant | yes | owner; staff via role | includes the catalog and role permission sets |
| `merchant.roles.manage` | merchant | **no** | owner only (D5) | role create/rename/archive/restore and permission sets; audited |
| `merchant.members.read` | merchant | yes | owner; staff via role | exposes member emails |
| `merchant.members.manage` | merchant | yes | owner; staff via role | non-owner members only, within the ceiling; audited |
| `merchant.invitations.read` | merchant | yes | owner; staff via role | exposes invitee emails |
| `merchant.invitations.manage` | merchant | yes | owner; staff via role | within the ceiling; audited |
| `merchant.audit.read` | merchant | yes | owner; staff via role (D8) | the read itself is audited |
| `platform.merchants.read` | platform | yes | super admin; staff via grant | each read audited (fail closed) |
| `platform.audit.read` | platform | yes | super admin; staff via grant | each read audited (fail closed) |
| `platform.merchants.lifecycle` | platform | **no** | super admin (D4) | |
| `platform.merchants.transfer_ownership` | platform | **no** | super admin (D4) | |
| `platform.staff.manage` | platform | **no** | super admin (D4) | |

Catalog rules: identifiers are unique, lower-case, dot-separated; `scope ∈ {merchant, platform}`; `status ∈ {active,
retired}` — a retired permission is never resolved and cannot be granted, and its existing grant rows remain (history)
but are inert; seeding a new identifier grants it to no grantee; the catalog is read-only to the app role.

## 7. Enforcement design

### 7.1 Resolution (per request)

[Plan] A definer function (working name `identity.session_authority(session)`) returns the actor's audience, kind,
merchant, role/branch status and **effective permission set**, applying §4 rules 3–5. `authenticate()` calls it in
place of (or together with) `validate_session`, in the same single round trip; the result is frozen on `AuthContext`
and copied into `TenantContext`. The route's declared permission is checked by a router-mounted middleware
(early 403, **not** the final decision for writes).

### 7.2 Write-time re-check (D12) and lock order

[Plan] Every privileged write executes in one database transaction that re-checks authority with
`tenancy.assert_authority(session, permission)` (or the same logic inside the definer function) **before** its first
write, after acquiring its locks.

**Lock model.** The order below applies to **every lock a transaction can wait for**, whatever acquires it. The
rules that make that set finite and checkable:

- **L1 — lock modes.** Row locks are taken with `FOR SHARE` or `FOR NO KEY UPDATE` (an `UPDATE` of non-key
  columns takes the same mode implicitly). **`FOR UPDATE` is not used**, keys are never updated, and rows that a
  foreign key references are never deleted. [Fact] At `5d8904b` the only `DELETE`s are on `identity.recovery_codes`
  and `util.rate_limit_counters`, which no foreign key references; `FOR UPDATE` appears in eight live functions — `consume_one_time_token`, `rotate_refresh_token`,
  `take_selection` (P3) and `set_merchant_status`, `update_membership`, `transfer_ownership`, `admit_invitation`,
  `revoke_invitation` (P4) — which P5 converts to `FOR NO KEY UPDATE`.
- **L2 — foreign-key checks are outside the order.** A foreign-key check takes `FOR KEY SHARE` on the referenced row,
  which conflicts only with `FOR UPDATE`, key updates and deletes — none of which L1 permits. Foreign-key checks
  (including every `audit.audit_events` insert that references a merchant or identity) therefore never wait and never
  make anyone wait; a guard enforces L1 so this stays true.
- **L3 — contested unique keys.** An insert can wait for another transaction inserting the same unique key. Every
  function inserts under a contested key (`identities.email`, `merchant_memberships (merchant_id, identity_id)`, the
  open-invitation key, grant primary keys) **only after acquiring its whole footprint, and acquires nothing afterwards**.
  The first of two competing inserters then needs nothing the second holds, so the wait cannot close a cycle. Keys made
  of fresh random values (token and session hashes, UUIDv7 ids) are not contested.
- **L4 — triggers and policies.** [Fact] The triggers on tables written by these flows lock nothing:
  `merchant_keeps_one_owner` (deferred, reads only), the append-only triggers on `audit.audit_events` (fire on
  `UPDATE`/`DELETE`, which never happen), and the ledger triggers (not touched by these flows); RLS policies call
  `util.current_merchant_id()`, which reads a setting. The guard re-checks every trigger function.
- **L5 — whole footprint first, one row at a time.** A function acquires its complete footprint before its first write,
  category by category in the order below, ascending id within a category, one row per statement, through the
  helpers below; a function whose footprint has several rows of a category (e.g. account setup with several pending
  invitations) locks **all** of them at that category's turn, never one invitation's rows at a time.
- **L6 — nested functions do not wait.** A function called inside another privileged function is a `…_locked` inner
  function with a written precondition (the locks its caller must already hold). It acquires no new lock by waiting: it
  **re-asserts** its precondition rows with `FOR … NOWAIT` — immediate if the caller holds them, an error (never a
  wait) if a caller forgot — so it cannot take part in a deadlock and a violated precondition fails loudly. Inner
  functions are not executable by the app (`REVOKE`); only their wrappers call them.

**Categories (global order) — by category, then by primary key:**

| # | Category | Mode |
|---|---|---|
| 1 | `identity.platform_memberships` (actor and target, one helper call, sorted) | `FOR SHARE` for the actor; `FOR NO KEY UPDATE` for a target whose row or grants change |
| 2 | `tenancy.merchants` | `FOR SHARE`; `FOR NO KEY UPDATE` when the merchant row changes (lifecycle, transfer, profile) |
| 3 | `tenancy.merchant_memberships` — actor and targets together | `FOR NO KEY UPDATE` in writes; `FOR SHARE` in sensitive reads |
| 4 | `tenancy.invitations` | `FOR NO KEY UPDATE` |
| 5 | single-purpose identity rows: `one_time_tokens`, `membership_selection_challenges`, `mfa_challenges`, `refresh_tokens` | `FOR NO KEY UPDATE` |
| 6 | `identity.identities` and credential rows (`totp_credentials`, `recovery_codes`) | `FOR SHARE`; `FOR NO KEY UPDATE` in identity flows |
| 7 | `tenancy.roles` — actor's role, targets' current roles, assigned/invited roles, edited role | `FOR SHARE`; `FOR NO KEY UPDATE` for a role being edited |
| 8 | `tenancy.branches` | `FOR SHARE`; `FOR NO KEY UPDATE` for a branch being edited |
| 9 | grant rows (`role_permissions`, platform grants) | written only after their parent (7 or 1) is held `FOR NO KEY UPDATE` |
| 10 | `identity.sessions` (revocation) | `UPDATE` |

Flows that start from a token or challenge identify their rows with an **unlocked lookup**, then lock in this order
and **re-check** what the lookup found (still unconsumed, unexpired, same identity) before acting. Locks are taken by
helpers (working names `identity.lock_platform_memberships`, `tenancy.lock_memberships`, `tenancy.lock_roles`,
`tenancy.lock_branches`, each taking a sorted, de-duplicated id array and a per-row mode) that issue one statement per
row, so the order never depends on a query plan. Transactions run at `READ COMMITTED`; after locking, a function
re-reads what it checks.

**Planned lock footprints (the contract P5.5–P5.8 implement; [Plan]).** The **global category order always
governs**; nothing precedes it. Within it, the **authority lock** is the lock on the row that carries the actor's
authority — the actor's platform membership (category 1) for platform operations, the actor's merchant membership
(category 3) for merchant operations. The rule is:

- **Authority is acquired by category, not by row.** The actor's row is locked **at its authority-bearing
  category's turn**, in the same sorted acquisition as every other row of that category (targets included). Within a
  category, rows are always acquired in ascending primary key — whether the actor's row or a target's row comes first
  is decided by their ids, never by who is the actor. "Actor first" in the sense of the actor's row preceding a
  target's row of the same category is **not** a rule: it would break the single global order that prevents
  reciprocal deadlocks.
- **Platform operations:** the authority-bearing category is 1. Category 1 is the **first category acquired
  overall**, and the actor's platform membership is in that sorted acquisition (with any target platform membership),
  before any merchant-side row and before any write.
- **Merchant operations:** the merchant row (category 2, `FOR SHARE`) comes first by the global order; the
  authority-bearing category is 3. The actor's merchant membership is in the **first** category-3 acquisition (one
  sorted call with every target membership), before any category-4 or later row and before any write.
- **Capability flows** (invitation acceptance, account setup, identity flows) have no actor membership; their
  authority is the locked capability row (invitation or token) and identity, in category order.
- In every case, authority and every rule are re-checked **after the whole footprint is held and before the first
  write** (§8.2a rule 1).

The guard enforces exactly this (check (1) in the guard below): it verifies (a) the **category-level** rule — the
authority-bearing category is acquired at its turn, contains the actor's row, and precedes every later category and
every write — and (b) the **row-level** rule — every multi-row acquisition within a category is one helper call over a
sorted, de-duplicated id array, whatever the actor's position in it.

| Operation | Footprint, in order (category: rows / mode) | Then |
|---|---|---|
| `update_membership` (assign, deactivate, reactivate) | 2: merchant / S → 3: {actor, target} / NKU → 7: {actor's role, target's current role, assigned role} / S → 8: assigned branch / S | write; 10: target's sessions (deactivate) |
| `list_members`, member and catalog reads | none (authority from the per-request resolver; not a write, not a sensitive read) | read |
| `issue_invitation` | 2: merchant / S → 3: actor / NKU → 4: open invitations for (merchant, email) / NKU (superseded) → 5: the email's setup tokens / NKU (identity found by unlocked lookup) → 6: identity / S → 7: {actor's role, invited role} / S → 8: invited branch / S | contested inserts last (L3): identity (if new), invitation, setup token |
| `revoke_invitation` | 2: merchant / S → 3: actor / NKU → 4: invitation / NKU → 7: {actor's role, invitation's role} / S | write |
| `accept_invitation` (invitee, password checked by the API) | 2: merchant / S → 4: invitation / NKU → 6: identity / S → 7: role / S → 8: branch / S | `admit_invitation_locked`: membership insert (L3), invitation consumed, `auth.invitation_accepted` row |
| `complete_account_setup` | unlocked lookup of token and pending invitations → 2: their merchants / S → 4: the invitations / NKU → 5: token / NKU (consume after re-check) → 6: identity / NKU (password, verification) → 7: all their roles / S → 8: all their branches / S | `admit_invitation_locked` for each invitation in id order (L5, L6) |
| branch / role / profile writers | 2: merchant / S (profile: NKU) → 3: actor / NKU → 7: {actor's role} / S, plus the edited role / NKU (one sorted call) → 8: edited branch / NKU | write |
| `set_role_permissions` | 2: merchant / S → 3: owner / NKU → 7: role / NKU | 9: rewrite the role's grant rows |
| `set_merchant_status` | 1: actor / S → 2: merchant / NKU → 6: owner identity / S | write |
| `transfer_ownership` | 1: actor / S → 2: merchant / NKU → 3: {former owner, new owner} / NKU → 6: new owner's identity / S → 7: former owner's new role / S | write; 10: sessions |
| `set_platform_grants`, staff create/deactivate | 1: {actor / S, target / NKU} (one sorted call) | 9: grant rows; 10: sessions (deactivate) |
| `audit.read_platform_events` (#34) | 1: actor / S | read event insert, then the rows (one `SELECT`, no row locks) |
| `tenancy.platform_list_merchants` (#35) | 1: actor / S | read event insert, then the rows (one `SELECT`, no row locks) |
| `tenancy.platform_list_merchant_members` (#36) | 1: actor / S | read event insert, then the rows (one `SELECT` over memberships and identities, no row locks) |
| `audit.read_merchant_events` (#33) | 3: actor / S → 7: actor's role / S (none for the owner) | read event insert, then the rows (one `SELECT`, no row locks) |
| identity flows: `reset_password`, `verify_email` | 5 → 6 (→ 10 reset) | — |
| `change_password` | 6 → 10 | — |
| `rotate_refresh_token` | 5 → 10 | — |
| selection, MFA verify / enrolment | 5 → 6 (credential rows) | session insert (fresh key) |

**Why these read footprints and no more (R20).** A sensitive read locks only the rows that carry the actor's
authority, so that a concurrent revocation is either seen or waits (§7.5): the actor's platform membership for the
three platform reads (platform authority comes entirely from it and its grants), and the actor's merchant membership and
role for the merchant audit read (merchant authority comes from those; the merchant's active status is re-checked by
the in-function session validation, and a concurrent merchant deactivation takes effect from the next request, as T5
specifies). No merchant, membership or audit row is locked: nothing about them needs to be serialized with a read, and
adding locks would only make readers block writers. **Read semantics:** transactions run at `READ COMMITTED`; the
authority locks are held until commit, so authority cannot change during the read; the returned rows come from **one
`SELECT` statement** and are therefore consistent as of that statement's start. No stronger guarantee is promised —
in particular, successive pages are separate requests and do not form one snapshot (§8.5 cursor rules). Each of the four
operations has its own planned-footprint entry above; the guard fails if a lock or nested call is added to one of them
without updating its entry.

The resolver (§7.1) and the early policy check take no locks. Category 3 takes `FOR NO KEY UPDATE` on the **actor's**
row in writes so any change to the actor (deactivation, role change) serializes with the actor's write, and the
reciprocal case cannot cycle — two staff acting on each other both lock `{A, B}` in id order.

**Baseline inventory at `5d8904b`** ([Fact], every locking clause and implicit `UPDATE` lock in every function body):
`update_membership` 2 → 3 (target only, `FOR UPDATE`) → 7 → 8; `transfer_ownership` 2 (`FOR UPDATE`) → 3 (`ORDER BY id
FOR UPDATE`) → 6 → 7; `set_merchant_status` **6 → 2**; `issue_invitation` 2 → 7 → 8 → **6 → 5 → 4**;
`revoke_invitation` 2 → 4; `admit_invitation` 2 → 4 → 6 → 7 → 8; `complete_account_setup` **5 → 6 → 2 …** (via
`admit_invitation`); identity flows as in the table above. Non-conforming today: `set_merchant_status`,
`issue_invitation`, `complete_account_setup`; no function yet takes the actor's authority lock (1 or 3), because P4
authority was hard-coded — the planned footprints above add it.

**Latent deadlock found by this inventory** ([Probable] by analysis; test (h) confirms or refutes it before the fix):
`issue_invitation` holds the invitee's identity `FOR SHARE` (`20261012000100_invitations:215`) and then, through
`issue_one_time_token`, updates that identity's unconsumed setup tokens; `complete_account_setup` holds the setup token
it consumes and then updates the same identity. Re-issuing an invitation while the person completes setup can therefore
cycle — PostgreSQL aborts one transaction (no corruption, an avoidable failure). The planned footprints remove it.

**Lock-order guard ([Plan], P5.5) — what it covers, and how it is itself tested.** A database test reads every
function and trigger body from the migrated catalog (`pg_get_functiondef`) and every repository transaction in
`apps/api/src`, and for each privileged operation computes its **waiting footprint**: explicit `FOR …` clauses (not
`NOWAIT`), `UPDATE`s and `DELETE`s (implicit row locks), contested inserts, and — recursively — the footprint of every
function it calls. It fails if (1) any operation's footprint differs from the planned footprint in the table above, from
the category order, or from the authority rule (category-level and row-level, as stated above); (2) `FOR UPDATE`, a key update or a `DELETE` of a referenced table appears anywhere (L1/L2);
(3) a contested insert is followed by any further lock (L3); (4) a trigger function locks anything (L4); (5) a
`…_locked` function waits for any lock, or is executable by the app (L6). **Guard self-tests:** it runs against the
P4 definitions (kept as test fixtures) and must report exactly the three baseline violations; and a mutation test
installs, in a scratch schema of the test database, a copy of a planned function with (a) one inverted pair of
categories, (b) an inversion reached only through a nested call, (c) a `FOR UPDATE`, (d) a lock after a contested
insert, and (e) a waiting lock inside a `…_locked` function — each must fail the guard.

**What the guard can analyse, and failing closed outside it (R11).** The guard's claim is bounded to a closed set of
constructs, and anything outside that set **fails the guard** rather than being skipped:

- **Scope:** every function reachable from a privileged entry point (the planned-footprint table, the helpers, the
  `…_locked` functions, identity functions, and every function they call), every trigger on every table any of them
  writes (enumerated from `pg_trigger`, so a newly added trigger is picked up), and every repository transaction in
  `apps/api/src` (every `db.transaction` / `withTenant` body), each of which must belong to exactly one of the
  **transaction classes** below (R17).
- **Analysable constructs:** `LANGUAGE sql` and `plpgsql` bodies containing static SQL; explicit row-locking clauses;
  `INSERT`/`UPDATE`/`DELETE`; `SELECT`/`PERFORM` and `RETURN QUERY` calls to **schema-qualified** functions;
  control flow. In TypeScript transactions: `tx.query` with a **static template literal** calling a definer function,
  and `mutateAudited`.
- **Repository transaction classes (R17).** Every repository transaction is classified by its contents, and the
  guard checks the rules of its class:

  | Class | May contain | Footprint check |
  |---|---|---|
  | **T1 privileged write** | calls to definer functions of the planned-footprint table (one operation per transaction) | compared with that operation's planned footprint |
  | **T2 pattern-B audited write** | the identity definer call(s) of one flow + exactly one `mutateAudited` call for an approved pattern-B pair | the definer calls' footprint (§7.2 table); the audit insert is the **only** direct table write allowed in it, and only through `mutateAudited` |
  | **T3 read-only** | scoped-repository `SELECT`s and calls to functions classified as lock-free readers; no writes, no locking clauses, no calls to writers | exempt from footprint comparison; the guard verifies it really is read-only |
  | **T4 sensitive read** | one call of a designated sensitive-read function | that function's planned footprint |
  | **T5 best-effort audit** | exactly one `recordBestEffort` insert, nothing else | none (a single insert into `audit.audit_events`, which L2 makes non-waiting) |

  **Classification uses the complete call graph (R22).** A transaction's class is decided on its **complete,
  statically resolved call graph and database effects** — every function reachable from its statements (recursively,
  through the definer functions it calls, their nested calls and the triggers their writes fire) and every write,
  lock and insert those perform — never on the visible TypeScript body alone. A **T1** transaction is accepted only if
  every reachable write is covered by its operation's approved planned footprint; a **T2** transaction only if every
  definer call belongs to the approved identity flow, every write reachable from those calls is in that flow's
  footprint, and its only direct table write is the matching approved `mutateAudited` insert; **T3** only if nothing
  reachable writes or locks; **T4** only if the reachable effects are exactly the designated read function's footprint
  and its one read event. A reachable function whose behaviour the guard cannot resolve (outside the analysable set
  above) fails the guard; it is never assumed safe.

  **Direct-access exceptions, exhaustively:** a TypeScript transaction may write a table directly only to insert into
  `audit.audit_events`, and only through `mutateAudited` (T2, approved pattern-B pair) or `recordBestEffort` (T5,
  approved best-effort pair). Any other direct write — to a tenancy, identity or ledger table, or to the audit table by
  any other code — fails the guard; so does a transaction matching no class or more than one.
- **Fails the guard:** dynamic SQL (`EXECUTE`) anywhere in scope; unqualified function calls; other languages;
  `LOCK TABLE`, advisory locks, `CALL`, `COPY`; an unrecognised statement form; a reachable function that is not
  classified (planned footprint, helper, `…_locked`, or a declared lock-free reader); non-literal SQL in a repository
  transaction; a transaction outside the classes above. [Fact] At `5d8904b` no function uses `EXECUTE`, so this
  costs nothing today.
- **Indirect effects are enumerated, not assumed:** foreign-key checks are excluded only because L1/L2 hold (the guard
  verifies the L1 facts it relies on: no `FOR UPDATE`, no key update, no delete of a referenced table); triggers are
  analysed as part of the statement that fires them; `INSERT … ON CONFLICT DO UPDATE` is treated as an `UPDATE` of the
  conflicting row (category of its table) — [Fact] used today only by `begin_totp_enrollment`, on a category-6 row.
- **Schema-level expressions on every table written in scope** are read from the catalog and must be lock-free: column
  defaults (`pg_attrdef`), generated columns, `CHECK` and exclusion constraints (`pg_constraint`), foreign-key
  actions, index expressions and predicates (`pg_index`), RLS policies (`pg_policy`), rewrite rules (`pg_rewrite`),
  domain constraints, and triggers (`pg_trigger`). Every function they reference must be on an explicit **lock-free
  allowlist**; anything else fails the guard. [Fact] At `5d8904b`: defaults call only `util.uuid_v7()` and
  `CURRENT_TIMESTAMP`; `CHECK`, index and policy expressions call only `btrim`, `length`, `char_length`, `lower`,
  `jsonb_typeof` and `util.current_merchant_id`; there are no cascading or `SET NULL` foreign-key actions, no rules,
  no generated columns, no exclusion constraints and no domains. So the initial allowlist is exactly those functions,
  foreign-key actions must be `RESTRICT`/`NO ACTION`, and a rule, generated column, exclusion constraint, domain or
  non-allowlisted function on a table in scope fails the guard until it is classified and tested.

Within that closed set the guard is the proof obligation for the order; it is **not** complete because its five
mutations are caught — the mutations show it detects those kinds of violation, and the fail-closed rules ensure nothing
it cannot analyse reaches a privileged path. The two-connection runs remain the adversarial evidence that the
implementation behaves as analysed. Additional guard self-tests: a scratch function using `EXECUTE`, an unqualified
call, and an unclassified reachable function must each fail it; so must a scratch table in scope with a default that
calls a non-allowlisted function, a `CHECK` that does, a cascading foreign key, and a rewrite rule. **Transaction-
class self-tests (R17):** a valid pattern-B transaction (identity call + `mutateAudited` with an approved pair)
**passes**; a transaction with a direct `UPDATE` of `tenancy.branches` fails; `mutateAudited` with a pattern-A pair
fails; a T3 transaction with a hidden `UPDATE` or `FOR …` clause fails; a T5 transaction with a second statement fails;
a TypeScript insert of a sensitive-read pair fails; **a T1 and a T2 transaction whose TypeScript body is valid but
whose called definer function contains a nested call to a scratch function performing an unapproved write** (e.g. an
`UPDATE` of `tenancy.roles` outside the footprint) **fail** (R22). This differs from mutation (b) above, which injects a
lock-order *inversion* through a nested call; this one injects an unapproved *write*.

A permission revoked concurrently is either committed before the write's re-check (write refused) or waits until the
write commits (the write was authorized when it happened).

**Tests (two connections):** (a) revoke-vs-write in both orders (as P4's `membership-management.test.ts` does for
transfer); (b) **reciprocal membership operations** — staff A and B, both with `merchant.members.manage`, deactivate
each other concurrently, repeated 50 times: never SQLSTATE `40P01` (deadlock), exactly one succeeds, the other is
refused by its re-check; (c) role-permission edit vs assignment into that role; (d) ownership transfer vs member
operation; (e) platform grant revocation vs platform read (§7.5); (f) merchant deactivation vs ownership transfer and
vs invitation issue; (g) account setup with admission vs merchant deactivation; (h) re-issuing an invitation while the
invitee completes account setup — run first against the P4 functions to record the latent deadlock, then against the
reordered ones; (i) account setup admitting **two** invitations of two merchants vs concurrent member operations and
role edits in both merchants; (j) acceptance of an invitation vs its revocation vs its re-issue; (k) a staff write vs
the owner editing that staff member's role permissions. A deadlock in any run (after the fix) fails the test — PostgreSQL's deadlock detector aborting a
transaction is treated as a defect, not a success. These runs are evidence, not proof; the static guard is the proof
obligation.

**Direct-grant writes become function writes (O1).** Branch, role and merchant-profile writes move into definer
functions that apply the same re-check. Rationale: archiving a role changes effective permissions (D6) and archiving
a branch changes access (D7), so these are privileged writes under D12.

**Enforcement boundary = one migration.** The migration that creates those writer functions **also revokes**, in the
same transaction, the app's direct `INSERT`/`UPDATE` on `tenancy.branches`, `tenancy.roles` and
`UPDATE(name)` on `tenancy.merchants`. There is no state in which the functions exist and the direct path is still
writable, so no deployment ordering is needed for safety:

- an application instance of the previous version that still writes directly gets `permission denied` (a 500) —
  over-denial, never a bypass;
- the new application version ships in the same release and is started only after the release step has applied the
  migration (TARGET_ARCHITECTURE §23: migrations run as the release step, then a health-checked switch);
- if the release fails between the migration and the switch, writes to branches, roles and the profile are
  unavailable until the new version is up; reads and every other endpoint are unaffected; recovery is forward (start
  the new version). This is tested: with the migration applied, the **previous** commit's repository code is run
  against the database and every direct write must fail with `insufficient_privilege`.

[Fact] No environment runs the new system yet (Dockerfiles and deployment are P15; CI only builds and tests), so the
first deployment will contain P5 complete; the boundary above is what keeps every later rolling deployment safe.

**No permission can exist while writes are app-checked only.** Until P5.5, branch, role and profile writes keep P4's
behaviour (API check, owner only). That is safe because no staff permission can exist before P5.5: the role- and
platform-grant writers are only introduced in P5.6 and P5.7, after the enforcement boundary (§10).

### 7.3 Delegation ceiling (D5)

For a non-owner actor, `members.manage` and `invitations.manage` operations succeed only if:

- the target is not the owner (unchanged P4 rule) **and**
- the **target member's current role** permissions ⊆ the actor's effective permissions (cannot act on someone
  stronger) **and**
- the **assigned or invited role**'s permissions ⊆ the actor's effective permissions (cannot hand out more than they
  hold) **and**
- that role is active (D6).

Implementable from existing data: role permissions live in the new grant table; the actor's set comes from the same
resolver; the subset test is a single `NOT EXISTS (… EXCEPT …)` inside the definer functions under the §7.2 locks.
The owner is exempt (holds every merchant permission). Role editing itself is owner-only (`merchant.roles.manage` is
reserved), so a staff member can never change the ceiling they are measured against.

### 7.4 Platform staff (D4)

Grants attach to `identity.platform_memberships.id`, not to the identity. Sign-in eligibility admits active platform
memberships of every role; MFA remains mandatory for all platform identities (the existing login and enrolment flow
applies unchanged). A platform staff member without grants can sign in and use `self` endpoints only.

### 7.5 Platform lock order and grant-revocation races

Platform operations take locks in this fixed order:

1. the **actor's** `identity.platform_memberships` row — `FOR SHARE` by every permission-protected platform
   operation (reads included), after which the actor's grants are re-read; when the operation changes another platform
   membership (grants, deactivation), actor and target are locked in one sorted helper call (target
   `FOR NO KEY UPDATE`);
2. then any merchant-side rows in the §7.2 order (merchant first).

Grant changes (`platform.staff.manage`, super admin) and staff deactivation therefore hold the **target** platform
membership row `FOR NO KEY UPDATE` before changing its grants or status (§7.2 table). Merchant-side operations never lock platform memberships, so
the two orders cannot form a cycle.

Outcome of a race between "revoke grant X from staff S" and "S performs an operation needing X": the two serialize on
S's membership row. If the revocation commits first, the operation's re-check sees no X and is refused (403, nothing
written, nothing returned). If the operation holds the row first, the revocation waits until it commits; the
operation was authorized when it ran. Sensitive reads follow the same rule — data is returned only by a transaction
that re-checked X under the lock. Tested with two connections in both orders (P5.7), not only "revoked ⇒ next
request".

## 8. Audit design

### 8.1 Event catalog

A closed catalog (TypeScript union, tested) of event identifiers. The **class** (atomic, best effort or sensitive
read, §8.2) is declared per **(identifier, outcome)** pair — e.g. `auth.login`/`success` is atomic (a session is
created) while `auth.login`/`failure` is best effort — together with a **summary allowlist** (field → type, bounded
length) and, for atomic pairs, the **writer pattern** below. Existing identifiers are kept (e.g. `auth.login`, `merchant.member_assigned`,
`platform.ownership_transfer`); new ones are added per package. Never stored: tokens, token hashes, passwords, OTPs,
recovery codes, request bodies, exception dumps.

**Validation is strict and never silently repairs an event.** An unknown identifier, a disallowed outcome, or a
summary field outside the allowlist (or over its length bound) makes the event **invalid** — fields are rejected,
not omitted.

**One writer per class.** The class of an event is fixed by the catalog; each writer accepts only its own class, so
a caller can never choose a weaker class:

- **atomic** — pattern A: the definer function's own SQL insert; pattern B: `mutateAudited(tx, event, change)`, inside
  the change's transaction;
- **sensitive read** — **database-owned only** (R16): the designated read function checks authority under its locks,
  inserts exactly one read event, and returns the rows, all in the request's one transaction. There is **no**
  TypeScript writer for sensitive reads — the repository calls the read function and never writes a read event itself
  (an earlier draft's `readAudited` wrapper is removed);
- **best effort** — `recordBestEffort(event)`, in its own transaction.

Behaviour is decided by **the entry point first**, then by the event — so an unknown identifier, whose class cannot
be resolved, still has one deterministic outcome:

| Situation | Atomic (`mutateAudited` / pattern-A SQL) | Sensitive read (the read function's SQL) | `recordBestEffort` |
|---|---|---|---|
| Unknown identifier | error ⇒ transaction rolls back ⇒ 500 | error ⇒ no data ⇒ 500 | **error thrown (500)** — an unknown identifier is never treated as best effort |
| Known event of another class | error ⇒ rollback ⇒ 500 | error ⇒ no data ⇒ 500 | **error thrown (500)** — an atomic or sensitive-read event can never be downgraded |
| Disallowed outcome or summary field | error ⇒ rollback ⇒ 500 | error ⇒ no data ⇒ 500 | not stored; response unchanged; error log + metric |
| Storage failure (insert fails) | rollback ⇒ 500 | no data ⇒ 500 | not stored; response unchanged; error log + `audit_write_failure` metric |

**`recordBestEffort` accepts only identifiers that the catalog lists as best effort.** Anything else — an unknown
identifier (for example a misspelled atomic event) or a known atomic/sensitive-read event — is a programming error and
fails the request loudly (500), in every entry point. Best-effort tolerance applies only to failures that depend on
runtime data or infrastructure **for a known best-effort event**: a summary value out of bounds, a disallowed outcome,
or a storage failure. A typo can therefore never turn a mandatory audit into a silent one.

**Atomic auditing does not depend on the caller choosing the right function.** Exactly two writer patterns exist,
and the catalog assigns each atomic pair to exactly one:

- **Pattern A — database-owned:** a definer function performs the change and inserts the audit row itself, with the
  actor derived **inside the function** from trusted, locked state — never from a caller-supplied actor (D11):
  - **session-based** operations (tenancy and platform changes): actor identity, audience and membership from
    `identity.validate_session` re-run inside the function;
  - **capability-based** operations — `auth.invitation_accepted` (#14), written by `admit_invitation_locked` on both
    paths: actor identity = the **locked invitation's `identity_id`** (P4 binds an invitation to its identity at issue,
    and admission already refuses any other identity); on the setup path this must also equal the **consumed setup
    token's identity**, which the function checks; actor audience = `NULL` (no session exists); actor membership = the
    **membership just created**; merchant = the invitation's merchant; target = the invitation; summary `{ path:
    'invitation_link' | 'account_setup', kind }`. The `p_identity_id` argument of `accept_invitation` is only
    compared with the invitation, never written as the actor. The password check of the invitation-link path remains
    in the API (T11), as in P4;
  - **operator** operations (`bootstrap_super_admin`, #15): actor `NULL`, as today.

  In every pattern-A function, `request_id`, `ip` and `user_agent` are passed in as **request context**: they are
  recorded as given and never used for any decision (the API is their only source). Used for every tenancy and
  platform change and for invitation acceptance.
- **Pattern B — repository-owned:** one `db.transaction` performs the change through its definer call and inserts the
  event through `mutateAudited(tx, event, change)` before commit. Used for identity flows, whose functions are
  single-purpose P3 functions (§8.4).

Guards against double or missing recording operate on the full tuple **(identifier, outcome, class, writer
pattern)** — never on the identifier alone, because one identifier legitimately has different writers for different
outcomes (e.g. `auth.signup`: success atomic via pattern B, failure best effort; `auth.invitation_accepted`: success
atomic via pattern A, failure best effort; `merchant.member_assigned`: success atomic via pattern A, denied/failure
best effort). Each writer site is resolved to the exact pair it writes — SQL inserts by their `action` **and**
`outcome` literals, TypeScript call sites by their typed event argument — and is accepted only if that pair's class
and pattern match the writer: `mutateAudited` only pattern-B atomic pairs; SQL inserts only pattern-A atomic pairs
in their planned function, or sensitive-read pairs in their **designated read function**; `recordBestEffort` only
best-effort pairs. A sensitive-read pair written from TypeScript, or from any SQL function other than its designated
read function (§8.1, #33–#36), is rejected. The coverage
guard below requires exactly one writer per atomic pair.

**Writer-guard mutation tests (P5.3a):** (1) a best-effort `recordBestEffort` call for `auth.signup`/failure and for
`merchant.member_assigned`/denied — identifiers whose success is atomic — is **accepted**; (2) an atomic success
routed through the wrong writer (`auth.signup`/success via `recordBestEffort`; `merchant.member_assigned`/success
written from TypeScript; `auth.password_change`/success written in SQL) is **rejected**; (3) an attempt to record an
atomic or sensitive-read pair through `recordBestEffort` (a downgrade) is **rejected**, at build time by the types and
at run time by the guard.

**Event inventory — every (identifier, outcome) pair, by class.** [Fact] for the pairs the code writes at `5d8904b`
(extracted from `apps/api/src/modules` and the SQL), [Plan] for pairs marked *new*. Agent sign-in, selection and
refresh write the **same** identifiers as the web flows, distinguished by `actor_audience`; their coverage tests run
once per audience.

**Atomic pairs** (each with exactly one writer):

| # | Identifier | Outcome | Pattern | Writer | Coverage test (file) |
|---|---|---|---|---|---|
| 1 | `auth.signup` | success | B | `AccountService.signup` around `signup_merchant_owner` (`app.merchant_id` set to the new merchant first) | accounts-api |
| 2 | `auth.email_verify` | success | B | `AccountService.verifyEmail` around `verify_email` | accounts-api |
| 3 | `auth.login` | success | B | `SessionService.login` around `create_session` (audiences: platform, merchant, agent) | sessions-api, agent-auth-api |
| 4 | `auth.login_select` | success | B | `SessionService.selectMembership` around `take_selection` + `create_session` (merchant, agent) | login-selection-api, agent-auth-api |
| 5 | `auth.refresh` | success | B | `SessionService.refresh` around `rotate_refresh_token` (web, agent) | sessions-api, agent-auth-api |
| 6 | `auth.refresh_token_reuse` | denied | B | `SessionService.refresh` — the revocation inside `rotate_refresh_token` and this event commit together | sessions-api, agent-auth-api |
| 7 | `auth.logout` | success | B | `SessionService.logout` around `revoke_session` | sessions-api |
| 8 | `auth.password_change` | success | B | `PasswordService.change` around `change_password` | passwords-api |
| 9 | `auth.password_reset` | success | B | `PasswordService.reset` around `reset_password` | passwords-api |
| 10 | `auth.account_setup` | success | B | `PasswordService.completeSetup` around `complete_account_setup` | passwords-api, invitations-api |
| 11 | `auth.mfa_enrollment_started` | success | B | `MfaService.beginEnrollment` around `begin_totp_enrollment` | mfa-api |
| 12 | `auth.mfa_enrollment_confirmed` | success | B | `MfaService.confirmEnrollment` around `confirm_totp_enrollment` | mfa-api |
| 13 | `auth.mfa_verify` | success | B | `MfaService.verifyChallenge` around `consume_mfa_challenge` (+ `consume_recovery_code` when used) + `create_session` | mfa-api |
| 14 | `auth.invitation_accepted` | success | A | `admit_invitation_locked`, called by `accept_invitation` **and** `complete_account_setup` (the setup path writes none today — gap closed) | invitations-api, invitations (db) |
| 15 | `platform.super_admin_bootstrapped` | success | A | `identity.bootstrap_super_admin` (existing, operator-only) | rate-limit-and-bootstrap (db) |
| 16 | `merchant.profile_updated` | success | A | profile writer (P5.5) | merchant-settings-api |
| 17 | `merchant.branch_created` | success | A | branch writer (P5.5) | merchant-settings-api |
| 18 | `merchant.branch_updated` | success | A | branch writer (P5.5) | merchant-settings-api |
| 19 | `merchant.role_created` | success | A | role writer (P5.5) | merchant-settings-api |
| 20 | `merchant.role_updated` | success | A | role writer (P5.5) | merchant-settings-api |
| 21 | `merchant.role_permissions_set` *new* | success | A | `set_role_permissions` | P5.6 tests |
| 22 | `merchant.member_assigned` | success | A | `update_membership` | memberships-api, membership-management (db) |
| 23 | `merchant.member_deactivated` | success | A | `update_membership` | memberships-api, membership-management (db) |
| 24 | `merchant.member_reactivated` | success | A | `update_membership` | memberships-api, membership-management (db) |
| 25 | `merchant.invitation_issued` | success | A | `issue_invitation` | invitations-api, invitations (db) |
| 26 | `merchant.invitation_revoked` | success | A | `revoke_invitation` | invitations-api, invitations (db) |
| 27 | `platform.merchant_deactivated` | success | A | `set_merchant_status` | merchant-lifecycle-api |
| 28 | `platform.merchant_reactivated` | success | A | `set_merchant_status` | merchant-lifecycle-api |
| 29 | `platform.ownership_transferred` | success | A | `transfer_ownership` | memberships-api, ownership-transfer (db) |
| 30 | `platform.staff_created` *new* | success | A | P5.7 staff function | P5.7 tests |
| 31 | `platform.staff_deactivated` *new* | success | A | P5.7 staff function | P5.7 tests |
| 32 | `platform.grants_set` *new* | success | A | `set_platform_grants` | P5.7 tests |

**Sensitive-read pairs** (written before rows are returned, §8.2a rule 7):

| # | Operation (endpoint) | Identifier | Outcome | Designated function — the only writer |
|---|---|---|---|---|
| 33 | merchant audit read (`GET /v1/merchant/audit-events`) | `merchant.audit_read` *new* | success | `audit.read_merchant_events` |
| 34 | platform audit read (`GET /v1/platform/audit-events`) | `platform.audit_read` *new* | success | `audit.read_platform_events` |
| 35 | platform merchant list (`GET /v1/platform/merchants`) | `platform.merchant_list_read` *new* | success | `tenancy.platform_list_merchants` |
| 36 | platform merchant memberships (`GET /v1/platform/merchants/{merchantId}/members`) | `platform.merchant_members_read` *new* | success | `tenancy.platform_list_merchant_members` |

**One operation, one function, one identifier (R18).** Each sensitive-read operation has exactly one designated
function (working names above, fixed in P5.0) and its own event identifier, so the single-writer rule applies to
sensitive reads exactly as to atomic pairs: the writer guard maps each sensitive-read pair to that one function and
rejects the pair written anywhere else. Each designated function writes exactly one event per successful call, in the
same transaction as the rows it returns (§8.2a rule 7).

**Best-effort pairs** (written by `recordBestEffort` only):

| Identifier | Outcomes |
|---|---|
| `auth.signup`, `auth.email_verify`, `auth.login`, `auth.login_select`, `auth.refresh`, `auth.password_change`, `auth.password_reset`, `auth.account_setup`, `auth.mfa_enrollment_confirmed`, `auth.mfa_verify`, `auth.invitation_accepted` | failure (each listed separately in the catalog) |
| `auth.password_forgot`, `auth.verification_resend` | success **and** failure — requests that issue a link; they change no credential or authority, and the link's use is itself atomic (#2, #9, #10). Best effort by the **owner's decision O6** (§14, 2026-10-11), with its conditions |
| `merchant.profile_updated`, `merchant.branch_created`, `merchant.branch_updated`, `merchant.role_created`, `merchant.role_updated`, `merchant.role_permissions_set` *new* | denied, failure |
| `merchant.member_assigned`, `merchant.member_deactivated`, `merchant.member_reactivated`, `merchant.invitation_issued`, `merchant.invitation_revoked` | denied, failure |
| `platform.merchant_deactivated`, `platform.merchant_reactivated`, `platform.ownership_transferred`, `platform.staff_created` *new*, `platform.staff_deactivated` *new*, `platform.grants_set` *new* | denied, failure |
| `merchant.audit_read`, `platform.audit_read`, `platform.merchant_list_read`, `platform.merchant_members_read` *new* | denied |
| `authz.denied` *new* — refusals by the router's policy middleware (§8.2a rule 6) | denied |

The catalog holds exactly these pairs; each best-effort row above expands to one catalog entry per (identifier,
outcome).

**Coverage guard ([Plan], built in P5.3a; each later package adds its pairs).** The guard compares the catalog with the inventory above **in both directions**:
a catalog pair missing from the inventory, or an inventory pair missing from the catalog, fails it; so does a pair
whose class differs between the two. Every writer found in the code (each SQL `INSERT INTO audit.audit_events` literal
and each `mutateAudited` / `recordBestEffort` call site) must map to an inventory pair of its class.
Then, for every atomic pair, it fails unless (i) the inventory names exactly one writer for it and that writer exists
(SQL literal or `mutateAudited` call site); and (ii) a test
tagged with that pair asserts, for one real request, that exactly **one** row of that pair was written, with the
expected actor identity/audience/membership, merchant, target type and target id, and the request's request id; and
that, with a failure injected on that pair's insert, the change itself is absent afterwards. Failure is injected by a
test-only `BEFORE INSERT` trigger on `audit.audit_events`, created by the table owner in the throwaway test database,
that raises for one named `(action, outcome)` — it works identically for both patterns. A new atomic catalog entry
therefore cannot be added without its writer and its co-commit and rollback test.

Error logs carry the event identifier, request id and reason only — never summary values.

### 8.2 Failure classes

This table defines what each class **means**. It is not an event list: **§8.1's inventory is the exhaustive authority**
for which (identifier, outcome) pair belongs to which class (atomic #1–#32, sensitive read #33–#36, and every
best-effort pair), and the coverage guard compares the catalog with that inventory alone. The examples below are
illustrative.

| Class | Typical events (illustrative — see §8.1) | Written | Audit failure ⇒ |
|---|---|---|---|
| **Atomic** | changes to roles, permissions, grants, memberships, invitations, merchant lifecycle and ownership, branches and the profile; identity security changes (sign-up, verification, sign-in success, refresh and reuse revocation, logout, password change/reset/setup, MFA enrolment and verification) | same transaction as the change | change rolls back; request fails 500 |
| **Best effort** | every failure and denial outcome of the above; the link-issuing successes of forgot-password and resend-verification (O6); refusals by the policy middleware (`authz.denied`) | own transaction | original response preserved; error logged with event id and request id; counter for alerting |
| **Sensitive read** | the four designated reads (§8.1 #33–#36) | before data is returned, same transaction as the read | read refused (500); no data returned |

### 8.2a Execution contract for privileged operations (definer functions)

[Fact] P4's definer functions already refuse by **returning** a structured outcome (`'forbidden'`, `'not_found'`,
`'invalid_transition'`, … — e.g. `20261011000200_membership_management:65,73`, `20261012000100_invitations:198,265`)
and raise exceptions only for malformed input (`…membership_management:52`). P5 keeps and formalizes that contract:

1. **Order inside every privileged function:** acquire locks (§7.2) → re-check authority and every rule → **only
   then** write. No write happens before the last check, so a refusal never leaves a partial change.
2. **Authorization and rule refusals are returned, never raised.** The function returns its outcome row and has
   written nothing; the transaction is still healthy. It does **not** write the denial event itself.
3. **Success (pattern A):** the function performs the change **and inserts its atomic audit row** (actor taken from
   the validated session, D11) before returning `'ok'`; the caller commits. If that insert fails, the exception aborts
   the transaction and everything rolls back ⇒ 500 (atomic class). Pattern B (identity flows) is rule 3 at
   repository level: the change and `mutateAudited` share one transaction (§8.1).
4. **Malformed input and unexpected errors raise** ⇒ the transaction rolls back ⇒ 500 (or 400 where the API validates
   first, as today).
5. **The API on a refusal** — only on a **recognized refusal outcome** returned by the function (its closed outcome
   set), never on an exception: unexpected database or infrastructure errors stay operational errors (500, logged),
   are not recorded as denials, and are not reported as 401/403. On a recognized refusal the API commits (or rolls back)
   the now-empty transaction, then calls
   `recordBestEffort(denial event)` in a **separate** transaction with the actor from the request's validated
   `AuthContext`, then answers 401/403/404/409 as today. A failure of that best-effort insert is logged and counted;
   the response is unchanged (§8.1 table). The denial event is never written in the aborted or the mutation's
   transaction, so no mutation can be committed by recording a denial.
6. **Early denials** (the router's policy middleware, before any database call) follow rule 5.
7. **Sensitive reads** are database-owned (R16): one designated definer function per read, which in one transaction
   locks (§7.2/§7.5), re-checks authority, inserts **exactly one** read event, then returns the rows. If the insert
   fails, the function raises before returning ⇒ no data ⇒ 500. The repository only calls the function; it writes no
   event of its own, so a read can be neither double-recorded nor recorded apart from the data it returned.

For pattern-B operations (identity flows, §8.4) the same rules apply at repository level: one `db.transaction`
contains the definer call and `mutateAudited`; a returned refusal ends that transaction without a write, and the
denial is recorded afterwards by rule 5.

**Tests (entry-point behaviour in P5.3a; each function's tests in the package that introduces it — P5.5, P5.6, P5.7,
P5.8):** for each privileged function — success commits change + audit row; refusal returns its outcome
with no row changed and no audit row in that transaction; injected failure of the success audit insert rolls back the
change; injected failure of the denial's best-effort insert leaves the HTTP status unchanged; sensitive read with
failing audit insert returns no data; **an injected unexpected database error (a connection failure, or an exception
raised inside the function) yields 500 and writes no denial event**; a misspelled atomic identifier passed to any entry
point fails the request and leaves no change committed.

### 8.3 A7 — complete refusal-path inventory ([Fact], all become best effort)

| File | Lines | Path |
|---|---|---|
| `modules/tenancy/merchant-settings.ts` | 163-171 | `ownerOrDenied` (profile, branch, role writes) |
| `modules/tenancy/memberships.ts` | 97-105, 127 | owner check; refused member change |
| `modules/tenancy/invitations.ts` | 111, 146, 183-199, 216 | refused issue; refused revoke; failed acceptance (`fail`); `ownerOrDenied` |
| `modules/tenancy/merchant-lifecycle.ts` | 116, 181 | refused lifecycle change; refused transfer |
| `modules/identity/sessions.ts` | 77-113, 271-296 | login `fail()` ×4; refresh `failed()` ×3 |
| `modules/identity/password-flows.ts` | 58, 131, 154 | forgot (unknown/disabled); wrong current password; failed link |
| `modules/identity/accounts.ts` | 51, 81, 110 | failed signup, verification, resend |
| `modules/identity/mfa.ts` | 102, 125; 170 (shared helper) | failed MFA verification; the shared enrolment helper at 170 is split: failures go through `recordBestEffort`, successes through `mutateAudited` inside the enrolment transaction (§8.1 map) |

[Plan] `AuditLog.recordBestEffort(event)` catches, logs and counts; every path above uses it. A test injects an
insert failure per class and asserts the response status is unchanged.

### 8.4 Atomic identity events (D10)

[Plan] Every identity event in the §8.1 map is pattern B: the service opens one `db.transaction`, calls the definer
function(s) with that transaction, and records the event with `mutateAudited` before commit. No identity function
signature changes for this (each is a single statement that does not commit by itself). Per flow:

- **signup, email verification, password change/reset, logout:** one function call + event.
- **login, selection, agent login/select (success):** `create_session` + event; failures stay best effort.
- **refresh:** `rotate_refresh_token` + `auth.refresh` (success) or `auth.refresh_token_reuse` (the revocation and its
  event commit together).
- **MFA enrolment:** the shared helper is split (§8.3); start and confirmation each commit with their event.
- **MFA verification:** challenge consumption, recovery-code consumption (if used), `create_session` and the success
  event in one transaction.
- **account setup:** `complete_account_setup` is re-specified for the §7.2 footprint (unlocked lookup → merchants →
  invitations → token → identity → roles → branches → `admit_invitation_locked` per invitation), all in one
  transaction; admission accepts the identity whose first password is set in that same transaction, and writes
  `auth.invitation_accepted` per membership (pattern A, inside the function); `auth.account_setup` is the pattern-B
  event around the call. Which invitations are admitted, and when, is unchanged (the P4.6 tests stay).

### 8.5 Actor attribution (D11) and reads

- Privileged operations (pattern A): on success the audit row is written **inside** the definer function (precedent:
  `bootstrap_super_admin`), with actor identity, audience and membership taken from the validated session — the app
  cannot supply them; capability-based pattern-A events (invitation acceptance) take the actor from the locked
  invitation and setup token, as specified in §8.1. Identity flows (pattern B) take the actor from the identity the flow
  has just verified (password, token or session). Denials follow §8.2a rule 5. The §8.1 inventory is the authoritative
  list of which events use which pattern.
- Merchant audit reads: through the designated definer function `audit.read_merchant_events` (#33), requiring
  `merchant.audit.read`, with tenant isolation enforced **inside the function** as specified below — not by RLS.
  **[Open, O3 — proposal]** which denial categories and fields are visible to the owner and to staff holding the
  permission; nothing beyond the event's allowlisted summary is ever exposed.
- **Merchant-scoped definer reads never rely on RLS (R19).** [Fact] No table uses `FORCE ROW LEVEL SECURITY` and the
  table owner (`alphakolect_migrator`) is exempt from RLS (RESTRUCTURING_MAP, P1 judgement calls); `SECURITY DEFINER`
  functions run as that owner, so **inside them RLS filters nothing**. Every merchant-scoped definer read therefore:
  1. derives the merchant **only** from the session, by re-running `identity.validate_session` inside the function —
     it has no merchant parameter at all, and no caller-supplied id (event id, cursor, actor filter) can name a
     merchant;
  2. re-checks the actor's current permission under the §7.2 footprint locks;
  3. applies an explicit `merchant_id = <session merchant>` predicate to **every** query on a tenant table, including
     cursor-continuation queries;
  4. leaves RLS enabled and the existing tenant-boundary protections untouched (RLS still guards every non-definer
     path — it is the backstop, not the mechanism here);
  5. writes its one read event and returns only the authorized rows in the same transaction (§8.2a rule 7).
  The same rule already governs P4's definer functions (ADR-15 "Function and transaction contracts"); P5 extends it to
  every new definer read, and the lock-order guard's parser adds a check: a query on a tenant table inside a definer
  function without a `merchant_id` predicate bound to the session-derived merchant fails the guard (platform reads,
  which are cross-tenant by design, are exempt by classification and are permission-gated and audited instead).
- Platform audit reads: the designated definer function `audit.read_platform_events` (#34), checking
  `platform.audit.read` under the §7.5 lock, applying the bounds and cursor rules below, and writing its own read
  event in the same transaction. Tenant RLS is not relaxed. **[Open, O4 — proposal]** at most 100 events per page and
  a required time window of at most 31 days, to be validated against the index and query design (below) before it is
  frozen.
- **Pagination contract for both audit reads (R21).**
  - **Order:** newest first, `ORDER BY occurred_at DESC, id DESC` — a total order: [Fact] `occurred_at` defaults to
    `CURRENT_TIMESTAMP` (`20260927000100_baseline:133`), PostgreSQL's **transaction start time**, so every event
    written in one transaction shares a timestamp; ties are routine, not an edge case, and the UUIDv7 `id` breaks them.
  - **Window and filters come from the request, every time.** The time window (`from`, `to`; at most 31 days; `from` <
    `to`) and filters (actor; for the platform read optionally merchant and event identifier, if O4 includes them) are
    validated on **every** request and always appear in the query's `WHERE` clause. The cursor never substitutes for
    them.
  - **The cursor carries only a position** — `(occurred_at, id)` of the last row returned — plus a digest of the
    normalized window and filters it was issued for. A cursor presented with a different window or filters (digest
    mismatch), or positioned outside the requested window, is rejected (`400 INVALID_CURSOR`). Continuation uses the
    strict tuple predicate `(occurred_at, id) < (cursor.occurred_at, cursor.id)` together with the window and filter
    predicates, so a forged or tampered cursor can only move within the window the request itself authorizes.
  - **Merchant reads** additionally carry the session-merchant predicate in every query (R19); a cursor never names a
    merchant.
- **Indexes — chosen by measured plans, not assumed.** [Fact] Existing: `(merchant_id, occurred_at)` and
  `(action, occurred_at)` (`20260927000100_baseline:181,184`); neither ends in `id`, and nothing supports a global
  or actor-filtered scan in `(occurred_at, id)` order. **Candidates to evaluate** (not a commitment to create all of
  them): `(occurred_at, id)` for unfiltered platform pages; `(actor_identity_id, occurred_at, id)` for actor filters;
  `(merchant_id, occurred_at, id)` for merchant reads and merchant-filtered platform reads (which may supersede the
  existing `(merchant_id, occurred_at)`); `(request_id)` only if a request-id filter is part of an approved contract.
  **Validation (P5.8, before O4 is frozen):** a throwaway database seeded with a representative, skewed volume (order of
  millions of events across thousands of merchants and actors, with many same-timestamp groups); `EXPLAIN (ANALYZE,
  BUFFERS)` for each query shape — first page, continuation page, actor-filtered, merchant-filtered, empty window —
  must show an index scan reading roughly one page of rows, not a sort over the window. The chosen indexes, the plans
  and the dataset parameters are recorded with P5.8's evidence; an empty test database is never used to judge a plan.
- Query-parameter validation is a prerequisite for every paginated read (currently refused by `validate.ts`). It is
  built in **P5.3**, with the rest of the contract machinery, because P5.7 (platform lists) and P5.8 (audit reads) both
  need it and run in parallel.

### 8.6 D9 — IP and user agent

Collection continues unchanged. **P5 cannot close without an owner-approved written policy** covering: the purpose
of collecting IP addresses and user-agent strings; who may read these fields and under which permission; retention
and deletion; anonymisation or minimisation; and how the policy applies to existing and future audit events. This plan
does not choose a retention period, and it offers no exception route; any exception would be a separate, explicit
owner decision.

## 9. Conventions, commands and gates

### 9.1 Migrations

[Fact] Directory names `YYYYMMDDNNNNNN_snake_case` (date of authoring + `000100`, `000200`, … within the day), one
`migration.sql` each, raw SQL, `SECURITY DEFINER` + `SET search_path = pg_catalog, pg_temp` + `REVOKE ALL … FROM
PUBLIC` + `GRANT EXECUTE … TO alphakolect_app`; `CREATE OR REPLACE` when a signature is unchanged (grants kept),
`DROP` + `CREATE` + re-grant when it changes; `schema.prisma` updated in the same commit (drift test). Names below are
working titles; timestamps are assigned when each migration is written.

### 9.2 Guards that must keep passing

`tenant-schema-guard.test.ts` (catalog: RLS, `(merchant_id, id)`, paired FKs), `row-level-security.test.ts`,
`privileges.test.ts`, `migrations.test.ts` (from zero + no drift), `tenant-scope-guard.test.ts`,
`isolation-matrix.test.ts`, `route-parity.test.ts`, `tenant-boundary.test.ts`, `selection-exposure.test.ts`,
`no-secrets-sweep.test.ts`.

### 9.3 Gate per package (local)

`pnpm format:check` · `pnpm lint` · `pnpm typecheck` · `pnpm build` · `pnpm --filter @alphakolect/contracts
openapi:check` · `pnpm test` · CI-mode oasdiff 1.32.1 against `origin/main` (0 errors) · gitleaks staged scan per
commit and full history at closure. Results are recorded with the commit they ran on; local runs are never reported
as CI.

## 10. Work packages

Dependencies: P5.0 → P5.1 → (P5.2 ∥ P5.3 ∥ P5.3a) → P5.4 → P5.5 → P5.6 → (P5.7 ∥ P5.8) → P5.9 → P5.10. P5.7 and
P5.8 run in parallel only after the resolver, registry and audit interfaces are frozen.

**Why the audit foundation (P5.3a) comes before P5.4 (placement, rev 10).** Everything that writes or checks audit
events after it depends on it: the policy middleware (P5.4) records its refusals with `recordBestEffort` (§8.2a rule
6) and replaces the `ownerOrDenied` helpers whose `await audit.record` is the A7 defect; the privileged functions of
P5.5–P5.7 write pattern-A pairs that must already be in the catalog; and the lock-order guard of P5.5 admits only
`mutateAudited` and `recordBestEffort` as TypeScript audit writers (§7.2 transaction classes), so the P3 identity
flows must already be pattern B when it is switched on. P5.3a has no dependency on P5.1–P5.3 (the event catalog is
independent of the permission catalog); it is listed with them so it is complete before P5.4. P5.8 keeps only the audit
**reads**.

### P5.0 — Decisions freeze and ADR-16

- **Work:** write ADR-16 into `TARGET_ARCHITECTURE.md` (append; ADR-15 unchanged): the catalog (§6), classes and
  route map (§5), resolution and write-time re-check (§7), delegation ceiling, platform grants, audit classes (§8),
  D9 status. Amend `RESTRUCTURING_MAP.md`: P5 exit criteria (§13); move "agents only record collections for assigned
  customers" into the P7/P8 rows verbatim (D1). Freeze the contracts of the new operations (§5).
- **Checks:** every one of the 44 operations is classified; no P7/P8 resource assumed; every **[Open]** item has an
  owner; **O3 decided** before the merchant audit-read contract is frozen. The **platform audit-read contract is not
  frozen in P5.0**: O4 depends on a query-plan validation (§8.5) that needs representative data, so its freeze follows
  the sequence in P5.8. If O3 is still open at P5.0, the merchant audit-read contract is left out of the freeze too
  and is frozen, as an ADR-16 addendum, once the owner decides; P5.8 cannot implement an audit-read endpoint whose
  contract is not frozen.
- **Done when:** owner and reviewer approve ADR-16 and this plan.

### P5.1 — Catalog and protected grant storage

- **Migrations:** `…_permission_catalog` (catalog table, seed §6, app `SELECT` only); `…_role_permissions`
  (`(merchant_id, role_id, permission)` PK, composite FK to `tenancy.roles (merchant_id, id)`, FK to the catalog plus
  CHECK/trigger allowing only `scope = 'merchant' AND grantable AND status = 'active'`, RLS, **no app write grant**);
  `…_platform_membership_grants` (FK to `identity.platform_memberships(id)`, only grantable platform permissions, no
  app grant). **Storage only: no function that writes grants exists after P5.1.** The writers arrive with their
  authorization foundation — `tenancy.set_role_permissions` in P5.6, `identity.set_platform_grants` in P5.7.
- **Seed:** catalog rows only. **No grant rows.**
- **Tests:** seed = contracts union; platform permission refused for a role; cross-merchant role refused; reserved
  permission refused (constraints exercised as the table owner, since nothing else can write); the app role cannot
  INSERT/UPDATE/DELETE either grant table; **no function granted to the app can write either table** (catalog check over
  every function with EXECUTE for `alphakolect_app`); catalog guard covers `role_permissions` automatically;
  from-zero migration and no drift.
- **Done when:** the database alone defines and protects permissions; no existing access changes.

### P5.2 — Resolver and write-time contract

- **Migrations:** `…_session_authority` (resolver, §7.1); `…_assert_authority` (re-check with §7.2 locks).
- **Code:** `identity/repository.ts`, `platform/http/authenticate.ts` (permissions on `AuthContext`),
  `platform/tenant.ts` (`TenantContext.permissions`; `requireOwner` kept until P5.4).
- **Tests:** owner = all merchant permissions; super admin = all platform; staff = role set; archived role ⇒ none;
  deactivated membership/merchant ⇒ 401; platform staff = grants only; one grant does not leak to another membership
  of the same identity; revoke ⇒ next request; two-connection race between `assert_authority` followed by a write and the revocations that
  exist at this point (membership deactivation; role archive), in both orders, behaves per §7.2; forged session
  ids refused.
- **Done when:** resolution is current, complete and isolated.

### P5.3 — Registry authorization metadata

- **Code:** `packages/contracts/src/registry.ts` (`authorization` field: class + permission/capability), all endpoint
  files, OpenAPI extension `x-authorization` (additive), `apps/api/src/platform/http/routes.ts` (refuse startup on
  missing/invalid declaration); **query-parameter validation** in `apps/api/src/platform/http/validate.ts` (contracts
  may now declare `query`; values are validated from the contract like bodies and path parameters, unknown parameters
  refused), the prerequisite for the paginated reads of P5.7 and P5.8.
- **Tests:** every operation declares exactly one valid class; unknown permission refused; route-parity asserts the
  authorization middleware is mounted for every `permission` endpoint and only there; no route public by omission;
  query parameters: valid values reach the handler typed, invalid or unknown ones are refused with 400 before any
  handler or database call, and a contract without `query` still receives none; oasdiff non-breaking.
- **Done when:** declarations are complete and machine-checked.

### P5.3a — Audit foundation (moved ahead of P5.4 in rev 10)

- **Work:** the event catalog with per-pair class, writer pattern and summary allowlist, and its strict validation
  (§8.1); `recordBestEffort` and the conversion of every A7 refusal path (§8.3); `mutateAudited` and the pattern-B
  conversion of every identity flow (§8.4) — except `complete_account_setup`'s re-specification, which needs the
  §7.2 footprint and `admit_invitation_locked` and is done in P5.5; the coverage and writer guards (§8.1).
- **Transitional writers, enumerated.** At this point the tenancy and platform pairs that §8.1 assigns to pattern A
  (#14 on the invitation-link path, #16–#20, #22–#29) are still written by P4's code — `recordWithin(tx)` in the same
  transaction as the definer call or direct write ([Fact] already atomic, §2; e.g. `merchant-settings.ts:79,114,140`,
  `memberships.ts:112`, `invitations.ts:94,142`, `merchant-lifecycle.ts:104,163`) — because their pattern-A functions arrive in P5.5. The coverage guard
  accepts exactly these pairs from exactly those call sites through a **closed transitional list** in the guard; P5.5
  empties the list and deletes it, and from then on the guard fails if it exists. No other pair may use it. New pairs
  (#21, #30–#36, `authz.denied`) are added to the catalog by the package that introduces their writer, together with
  that writer and its tests.
- **Tests:** every row of the §8.1 entry-point table for each entry point (unknown identifier, known event of another
  class — atomic and sensitive-read events through `recordBestEffort` — invalid outcome, disallowed and over-length
  summary field, storage failure), asserting the stored rows, the metric and the HTTP status of the request in hand;
  per atomic identity pair the co-commit and injected-rollback test of the coverage guard; the A7 paths keep their
  status when the best-effort insert fails; the writer-guard mutation tests (§8.1); the coverage guard in both
  directions over the pairs that exist at this point; secrets never stored (leak sweep); P4 member/invitation atomicity
  still holds.
- **Done when:** every audit writer in the code is one of the three entry points (or on the transitional list), and
  every identity security change commits with its event.

### P5.4 — Policy middleware; replace `requireOwner`

- **Code:** new `apps/api/src/platform/authorization.ts` (decision type, `authorize`); router mounts it from the
  registry; the 13 `requireOwner` call sites and both `ownerOrDenied` helpers are removed in favour of the declared
  permission; `GET /v1/merchant/membership` returns effective permissions. Refusals by the middleware are recorded
  as `authz.denied` through `recordBestEffort` (P5.3a; §8.2a rule 6); the catalog gains that pair here.
- **Equivalence oracle:** with owners holding all merchant permissions and no staff grants, the P4 isolation matrix
  must produce identical results before and after.
- **Tests:** P4 matrix unchanged; source guard: no `kind === 'owner'` / `requireOwner` outside the authorization
  module; denial responses unchanged.
- **Done when:** the API enforces declarations with zero behaviour change for existing actors.

### P5.5 — Database functions aligned (and direct writes moved)

- **Migrations:** `CREATE OR REPLACE` of `list_members`, `update_membership`, `issue_invitation`,
  `revoke_invitation` (permission + delegation ceiling §7.3 + §7.2 locks), `set_merchant_status`, `transfer_ownership`
  (reserved platform permissions); **one enforcement migration** that creates the definer writers for branches, roles
  and merchant profile **and revokes the app's direct write grants on them in the same transaction** (§7.2); the app
  switches to the writers in the same commit. Privileged functions write their audit rows themselves (§8.5).
- **Tests:** direct calls with/without authority; staff above ceiling (assign, invite, act on a stronger member)
  refused; owner untouchable; archived role refused; forged actor fields impossible (no parameter exists); rollback
  when the in-function audit insert fails; concurrency per §7.2; grants and pinned `search_path` guard (inventory test
  over every definer); **mixed-version test** — the previous commit's direct-write repository code fails with
  `insufficient_privilege` against the migrated database, for every former direct write; **lock-order guard** (§7.2)
  green for every planned footprint, with its baseline control, its five mutation self-tests and its three
  fail-closed self-tests (`EXECUTE`, unqualified call, unclassified reachable function); two-connection tests (a),
  (b), (d) and (f)–(j) of §7.2, 50 runs each, no `40P01` ((c) and (k) need the role-permission writer and run in
  P5.6; (e) needs platform grants and reads and runs in P5.7); the §8.2a contract tests; **invitation-acceptance attribution** on both paths —
  the `auth.invitation_accepted` row names the invitation's identity, `NULL` audience, the new membership, the
  invitation's merchant and the invitation, and a call to `accept_invitation` with a different `p_identity_id` is
  refused and writes nothing. The sensitive-read tests (R16, R18, R19) run where the read functions are built — P5.7
  (#35, #36) and P5.8 (#33, #34).
- **Test fixtures for staff authority.** No function can grant a staff or platform-staff permission before P5.6/P5.7
  (§11), so the P5.5 tests that need a staff member holding a permission (delegation ceiling, reciprocal operations,
  revoke-vs-write) seed `role_permissions` rows **as the table owner in the throwaway test database**, exactly as the
  P5.1 constraint tests do. Fixtures never use an app-reachable path, and P5.6 repeats the ceiling tests with grants set
  through `set_role_permissions`.
- **Guard scope grows with the packages.** The lock-order guard checks every planned-footprint entry whose function
  exists; each entry names the package that introduces it (P5.6: `set_role_permissions`; P5.7: platform staff, grants
  and the two platform reads; P5.8: the two audit reads). An entry whose package is complete and whose function is
  missing fails the guard, so no entry can be silently dropped.
- **SQL authority guard — what it forbids and what it allows, enumerated.** It forbids **actor authority** decided by
  a literal: a test of the calling session's membership kind or platform role (today `v.kind = 'owner'` in
  `list_members`, `update_membership`, `issue_invitation`, `revoke_invitation` and `pm.role = 'super_admin'` joined
  to the session in `set_merchant_status`, `transfer_ownership` — [Fact] `20261011000200:31,62`,
  `20261012000100:195,262`, `20261009000100:104`, `20261011000300:40`); outside the resolver, authority comes only
  from the resolver's permission set. It allows, by an explicit list in the guard, the **data rules** that name a kind
  or role of a *target* or of stored rows, which are not authority: owner protection (`v_target.kind = 'owner'`,
  `20261011000200:76`); the one-owner invariant (`20261011000100`); transfer's demotion and promotion
  (`20261011000300:54,58,98`); sign-up creating the owner (`20261003000200:36`); audience eligibility by kind
  (`mm.kind IN ('owner','staff')` / `'agent'`); and `identity.bootstrap_super_admin` (creates the super admin,
  `20261003000500:51,62`). **Until P5.7** it also allows the platform sign-in eligibility literal
  `pm.role = 'super_admin'` in `identity.eligible_memberships` (`20261009000200:57`), which P5.7 replaces; from P5.7
  that entry is removed and the guard fails if the literal remains. Any literal not on the list fails the guard.
- **Done when:** no hard-coded `owner`/`super_admin` authority remains outside the resolver (SQL guard), and API and
  database agree in the matrix.

### P5.6 — Role permission management

- **Migration:** `tenancy.set_role_permissions(session, role, permissions[])` — footprint per §7.2 (merchant S →
  owner NKU → role NKU → grant rows), owner authority re-checked under the locks, catalog scope/grantability validated,
  `merchant.role_permissions_set` written in the function (pattern A).
- **Contracts/code:** `GET /v1/merchant/permissions`, `PUT /v1/merchant/roles/{roleId}/permissions` (owner), role
  responses include their permission set; archived roles keep their set (inert, D6).
- **Tests:** owner sets permissions; staff with any permission set cannot (reserved); unknown/platform/reserved
  permission refused by the database; assigning or inviting into a role above the ceiling refused; concurrent edit vs
  assignment per §7.2 — two-connection tests **(c)** and **(k)**, 50 runs each, no `40P01`; the P5.5 delegation-ceiling
  tests repeated with grants set through `set_role_permissions` instead of fixtures; cross-tenant role ids ⇒ 404; every change audited atomically with old/new permission lists
  (allowlisted).
- **Done when:** role management cannot escalate.

### P5.7 — Platform staff

- **Migrations:** `…_platform_staff_eligibility` (`eligible_memberships` admits active platform memberships of every
  role); `identity.set_platform_grants(session, membership, permissions[])` and platform staff create/deactivate
  functions (super admin; actor and target platform memberships locked in one sorted call, target
  `FOR NO KEY UPDATE`, §7.5).
- **Contracts/code:** platform staff management endpoints; `GET /v1/platform/merchants` through
  `tenancy.platform_list_merchants` and `GET /v1/platform/merchants/{id}/members` through
  `tenancy.platform_list_merchant_members` (closes P4 limitation 1); each designated function writes its one read event
  (#35, #36) in the transaction that returns the rows. **Both lists are paginated from the start** (a cross-tenant list
  of every merchant cannot be unbounded): at most 100 rows per page, ordered `created_at DESC, id DESC`, with the cursor
  rules of the §8.5 pagination contract (position only, bound by digest to the request's filters, `400 INVALID_CURSOR`
  on mismatch, strict tuple continuation); every page is its own sensitive read with its own event. Supporting indexes
  are chosen from recorded query plans on seeded data, as in §8.5.
- **Tests:** staff without grants: sign-in + MFA works, nothing else; one grant ⇒ exactly that; revoked grant ⇒ next
  request; lifecycle, transfer, staff management refused for staff even if a grant is attempted (reserved); super
  admin unchanged; MFA enrolment/verification unchanged for staff; reads audited, refused if the audit insert fails;
  **two-connection races in both orders** (revoke grant vs protected operation; deactivate staff vs protected
  operation) with the outcomes stated in §7.5, including two-connection test **(e)** of §7.2 (50 runs, no `40P01`); a
  grant to one platform membership never authorizes another membership of the same identity; **sensitive reads #35 and
  #36 (R16, R18)** — each designated function writes exactly one event per successful call, in the same transaction as
  the rows it returns, the repository writes none, and an injected failure of that insert returns no rows; a scratch
  second function that writes `platform.merchant_list_read` fails the writer guard; **pagination** — first and
  continuation pages, a page boundary inside a group of equal `created_at` values (no row lost or repeated), and a
  cursor reused with different filters refused.
- **Done when:** platform staff have exactly their grants.

### P5.8 — Audit module

- **Work:** the audit **reads** — merchant and platform audit reads (§8.5) with their designated functions (#33,
  #34); indexes; D9 documentation (§8.6). The audit foundation is P5.3a.
- **Order inside P5.8 (O4):** (1) **validation spike** — on a throwaway database seeded per §8.5, run
  `EXPLAIN (ANALYZE, BUFFERS)` for every candidate query shape and index; nothing from the spike is committed except the
  recorded plans, dataset parameters and the seeding script used; (2) the **owner decides O4** on that evidence (page
  size, window, filters); (3) the platform audit-read contract is **frozen as an ADR-16 addendum**, and the reviewer
  confirms it; (4) only then the migration (indexes, designated function) and the endpoint are written. The merchant
  audit read follows steps (3)–(4) once O3 is decided; its plans are recorded in the same spike.
- **Tests:** the coverage guard of §8.1 now complete in both directions (every catalog pair, including #33/#34, has
  its writer and tests); secrets never stored (leak sweep extended to the audit-read journeys); append-only unchanged;
  audit reads tenant-isolated, bounded, themselves audited — **sensitive reads #33 and #34 (R16, R18)** with the same
  single-writer, same-transaction and injected-failure tests as #35/#36; **merchant isolation of definer reads (R19)** —
  calling `audit.read_merchant_events` **directly** with a valid session of merchant A returns none of merchant B's
  events, including with a forged cursor positioned on one of B's events and an actor filter naming one of B's
  members; the same attempts through `GET /v1/merchant/audit-events` with forged ids and cursors; both run with the
  real function owner and as `alphakolect_app`, so they exercise the RLS exemption that makes the explicit predicate
  necessary; **pagination (R21)** — first page,
  continuation pages, a group of same-timestamp events split across a page boundary (no row lost or repeated), actor
  filtering, merchant filtering (platform), an empty window, a window over 31 days refused, and a cursor reused with a
  different window or filter refused with `400 INVALID_CURSOR`; the §8.5 query-plan validation recorded on
  representative data.
- **Done when:** every event class behaves as §8.2 states, proven by failure injection.

### P5.9 — Authorization matrix and regression gate

- **Work:** extend `isolation-matrix.test.ts`: expected results come from registry declarations (the
  `^FORBIDDEN` description regex is removed); actors = anonymous, invalid session, owner, staff with / without the
  permission, staff above ceiling, archived-role staff, agent, super admin, platform staff with none / one / revoked
  grant; plus foreign tenant and own-tenant-forbidden resources. Direct database-function tests run in
  `packages/db/test` alongside. Negative cases assert **no row changed**.
- **Integrity:** no existing test weakened or skipped; every run recorded with command, commit and result.
- **Done when:** the full matrix and all P1–P4 suites are green on a from-zero database.

### P5.10 — Closure

- **Work:** ADR-16 updated to as-built; `RESTRUCTURING_MAP.md` P5 record (packages, migrations, endpoints, mutation
  counts, limitations, deviations); the owner-approved D9 written policy (§8.6) in place; the **as-built P5
  threat model** written in `docs/security/` — **outstanding until this step**: `P5_AUDIT_REPORT.md` §15 is a
  design-stage threat model that serves as its **input**, not the deliverable, and no document may describe the
  deliverable as complete before P5.10 (TARGET_ARCHITECTURE §27 lists it as owed); full gate twice;
  gitleaks over full history; the three review documents either committed as planning records or deleted — **owner's
  choice**.
- **Done when:** §13 checklist complete; owner approves; CI runs only when the owner pushes.

## 11. Rollout and rollback (no fail-open)

1. **P5.1–P5.2 (expand):** additive tables and functions; the running app ignores them. Owners/super admins keep
   fixed sets; no grant rows exist ⇒ **no access change**.
2. **P5.3a (audit foundation):** identity security changes and their events now commit together. The one visible
   change is in the fail-closed direction: if an identity event cannot be stored, the change is rolled back and the
   request fails (500) instead of succeeding without its record; refusals keep their status codes whatever happens to
   their best-effort event (A7 fixed). No access changes.
3. **P5.3–P5.4 (switch, API):** declarations + middleware; equivalence proven by the unchanged P4 matrix. An
   undeclared route stops the app from starting — the failure mode is unavailability, never openness.
4. **P5.5 (switch, DB — the enforcement boundary):** functions replaced with identical signatures; owner and
   super-admin authority is preserved by their fixed sets. One migration creates the branch/role/profile writers and
   revokes the direct write grants together (§7.2). An instance of the previous version can only be denied, never
   bypass; the mixed-version test proves it. No staff or platform-staff permission exists before this point (grant
   writers arrive in P5.6/P5.7).
5. **P5.6–P5.8:** new capabilities (role grants, platform staff, audit reads) start empty — they grant nothing until
   an owner or super admin acts.
6. **Rollback:** forward-only. Because no step widens access, a defective step is fixed forward; the worst outcome is
   over-denial. Each migration is tested from zero and on top of the previous state.

## 12. Approval sequence

Draft (this document) → owner review → independent reviewer challenge → disagreements resolved and recorded here →
**owner's explicit implementation approval** → P5.0 begins. Until then nothing is implemented, committed, pushed or
merged.

## 13. P5 exit criteria (proposed for RESTRUCTURING_MAP)

1. Every endpoint declares one authorization class; the router refuses undeclared endpoints.
2. The registry-driven authorization matrix is green for every endpoint and actor in P5.9.
3. API and database agree; no hard-coded owner/super-admin authority remains outside the resolver (source + SQL guards).
4. Privileged writes re-check authority in their own transaction; the revoke-vs-write race is tested.
5. Delegation ceiling and owner-only role management are enforced in the database; escalation tests green.
6. Platform staff hold exactly their membership grants; reserved powers are super-admin only.
7. Audit: closed catalog with allowlists; atomic / best-effort / sensitive-read classes proven by failure injection;
   A7 resolved; audit reads isolated and audited.
8. All P1–P4 guards, the tenant-isolation matrix and the leak sweep stay green; every new guard proven by mutation.
9. An owner-approved written D9 policy (§8.6) exists.
10. Assigned-customer authorization recorded as a P7/P8 exit criterion (D1).

## 14. Open items for the reviewer and owner

| # | Item | Proposed position |
|---|---|---|
| O1 | Move branch/role/profile writes into definer functions and revoke direct grants (§7.2) | adopt (owner supports), with the single-migration enforcement boundary of §7.2 |
| O2 | Exact contracts of the new endpoints (§5) | frozen in P5.0 |
| O3 | Which denial categories and fields owners (and `merchant.audit.read` staff) may see | proposal (reviewer recommends approving, with precision): only this merchant's events; summaries limited to each event's allowlisted fields; denials visible only where they concern this merchant's operations; never cross-tenant activity, credentials, tokens or request bodies; the owner's and staff's visible denial categories defined separately if they differ — **owner decision required before P5.0 freezes the merchant audit-read contract**; no default is implemented |
| O4 | Platform audit-read bounds | proposal (reviewer recommends approving, subject to validation): ≤ 100 events per page; required time window ≤ 31 days; **filter by actor** (the legacy per-staff log view, §15); stable ordering and cursor on `(occurred_at, id)` for equal timestamps; the cursor bound to the request's window and filters and unable to widen or leave the window (§8.5 pagination contract). **Prerequisite:** the index and query-plan validation of §8.5 on representative data (R21), run as the first step of P5.8. Then **owner decision required before the platform audit-read contract is frozen** (ADR-16 addendum, P5.8 step 3 — not at P5.0); no default is implemented |
| O5 | D9 retention policy | owner decision; a written policy is a P5 exit criterion (no exception route) |
| O6 | Class of `auth.password_forgot` and `auth.verification_resend` successes (§8.1) | **DECIDED by the owner (2026-10-11): best effort.** Conditions: the success outcome means only that the request was processed for link issuance, subject to eligibility — never that a link was delivered, opened or used; an audit failure never changes the response; the public response never reveals whether an account exists (unchanged P3 behaviour, ADR-14 D12 — anti-enumeration); the eventual reset, verification or setup keeps its atomic event (#2, #9, #10). |

## 15. Legacy context (background only — not a requirement)

Read 2026-10-11 at the owner's request, from `legacy/current-system/*.md` (36 documents; secrets and server details
not reproduced). Facts about the **old** system, recorded so the plan's deliberate differences are visible:

- Authentication: one JWT kept in browser `localStorage`; route checks were coarse (`requireSuperAdmin`,
  `requireMerchant`, `requireAuthenticated`) with no per-operation permissions (`ARCHITECTURE_OVERVIEW.md`). P5's
  per-endpoint declarations and database-side checks replace that model.
- Platform staff were **role-based**: admin roles with permissions and "view / edit / restricted" capabilities, staff
  assigned a role (`ADMIN_INTEGRATION_GUIDE.md`, `ADMIN_PAGES_INTEGRATION_SUMMARY.md`). P5 deliberately grants
  **per person** instead (D4, BR-3: "only what you grant each one").
- Auditing was an `activities` table shown as "audit logs", including **per-staff log views**
  (`/superAdmin/logs/:staffId`). P5's platform audit read should therefore support filtering by actor — the planned
  `(actor_identity_id, occurred_at)` index serves it (input to O4).
- Merchant-side `staff`, `roles`, `branches` and `collaborators` existed as tables (`MIGRATION_STATUS.md`).
  `docs/architecture/CURRENT_SYSTEM_INVENTORY.md` §1.1, §1.3 and §1.15 and `ARCHITECTURE_RECONNAISSANCE.md` §5.2, §8–§9
  add: merchant roles stored JSON `permissions` that were **enforced only in the UI** (sidebar filtering from
  `staffPermissions`); admin roles were never enforced and admin staff could not log in; agents passed every check a
  merchant passed; tenant ids were taken from request bodies at several endpoints; the subscription middleware failed
  open. Each of these is a failure mode P5's design rules out — server-side enforcement in API and database, permissions
  served to the UI rather than decided by it (§5), agents limited to self (P4 matrix pin), no client tenant (P4 contract
  guard), fail-closed middleware (§4 invariant 7). They add no requirement beyond BR-3 and Q7c.

## 16. Revision log

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-10-11 | First draft from the reviewer's outline, verified against the source. |
| 9 | 2026-10-11 | Independent review of rev 8 (approve with required revisions): **(R18)** each sensitive read #33–#36 has its own event identifier and exactly one designated function (`audit.read_merchant_events`, `audit.read_platform_events`, `tenancy.platform_list_merchants`, `tenancy.platform_list_merchant_members`); the writer guard rejects a second writer; **(R19)** merchant-scoped definer reads never rely on RLS — merchant taken only from the session, permission re-checked under locks, an explicit `merchant_id` predicate on every query including continuations, RLS kept as a backstop; tested as the real owner and the app role with forged cursors and filters; **(R20)** per-operation lock footprints for the four reads, and their read-consistency semantics stated; **(R21)** audit pagination contract — total order `(occurred_at, id)` (same-transaction ties are routine), window and filters validated on every request, cursor bound to them by digest (`400 INVALID_CURSOR`), indexes chosen by `EXPLAIN (ANALYZE, BUFFERS)` on representative data, which O4 now requires first; **(R22)** transaction classes decided on the complete, statically resolved call graph, unresolvable functions fail, and a nested unapproved write is a new self-test. Fixes: **(A)** P5 D-numbers distinguished from ADR-14 Dn; O6 shown as decided everywhere; **(B)** §8.1 is the only event inventory, §8.2 defines classes; **(C)** an authorization-resolution failure is 500 `INTERNAL_ERROR`, logged and counted, never 401/403 and never a denial event; **(D)** the audit report's threat model is design-stage input; the as-built threat model is outstanding until P5.10. |
| 8 | 2026-10-11 | Independent review of rev 7 (approve with required revisions): **(R16)** sensitive reads are database-owned only — the designated read function checks authority, inserts exactly one event and returns the rows in one transaction; the `readAudited` wrapper is removed; writer guard and tests updated; the atomic TypeScript entry point is named `mutateAudited` throughout (an earlier table said `recordWithin`); **(R17)** five repository transaction classes (privileged write, pattern-B audited write, read-only, sensitive read, best-effort audit) with an exhaustive list of direct-access exceptions (audit inserts only, only through `mutateAudited`/`recordBestEffort`) and six class self-tests; **O6 decided by the owner** (best effort, with its conditions); O3/O4 carry the reviewer's recommendations, still owner decisions; from a full read of `docs/`: effective permissions exposed for platform sessions too, the authorization middleware fails closed (tested), the threat model moves to `docs/security/` at closure, and §15 records the legacy failure modes P5 rules out. |
| 7 | 2026-10-11 | Independent review of rev 6 (approve with required revisions): **(R13)** authority acquired by category, not by row — the actor's row is locked at its authority-bearing category's turn inside the same ascending-id acquisition as the targets; "actor row before target row" is explicitly not a rule; the guard checks the category-level and the row-level rule; **(R14)** writer guards compare the full (identifier, outcome, class, pattern) tuple, so valid best-effort failures of identifiers with atomic successes are accepted; three writer-guard mutation tests; **(R15)** schema-level expressions on every table in scope (defaults, generated columns, CHECK/exclusion constraints, FK actions, index expressions, RLS policies, rules, domains, triggers) read from the catalog and restricted to a lock-free function allowlist, fail-closed, with four more self-tests; `ON CONFLICT DO UPDATE` treated as an update; **O6** reviewer supports the proposal, owner decision pending; **§15** legacy context added (background only) at the owner's request; the revision log moves to §16. |
| 6 | 2026-10-11 | Independent review of rev 5 (approve with required revisions): **(R9)** "authority lock first" defined precisely — the global category order always governs; the authority lock is the first lock overall for platform operations (category 1) and the first category-3 acquisition for merchant operations (after the merchant row), before any later category and any write; capability flows anchor on the capability row; the guard enforces exactly this; **(R10)** exhaustive event inventory: 32 atomic and 3 sensitive-read pairs individually numbered with exact identifier, outcome, pattern, writer and test; every best-effort pair listed (O6 opened for the two link-issuing successes); agent flows share identifiers, tested per audience; the coverage guard compares catalog and inventory in both directions; **(R11)** the lock-order guard's claim is bounded to a closed set of analysable constructs and fails closed on dynamic SQL, unqualified calls, other languages, explicit table/advisory locks, unrecognised statements, unclassified reachable functions and non-literal transaction SQL; triggers enumerated from `pg_trigger`; three fail-closed self-tests added; coverage is no longer claimed from the mutation tests; **(R12)** trusted actor for capability-based pattern A: invitation acceptance attributed to the locked invitation's identity (checked against the consumed setup token on the setup path), `NULL` audience, the new membership; caller-supplied identity only compared, never recorded; request context recorded but never used for decisions; tests on both paths. |
| 5 | 2026-10-11 | Independent review of rev 4 (approve with required revisions): **(R4)** authoritative atomic-event map — every atomic (identifier, outcome) pair with its writer and coverage test, including all identity events and the split MFA helper; classes are per (identifier, outcome); a coverage guard requires one writer and a co-commit + rollback test (actor, merchant, target, request id) per pair, using an injected insert failure; closes a gap where account setup wrote no per-membership acceptance event; **(R5)** lock model L1–L6: no `FOR UPDATE`, no key updates or deletes of referenced rows (so foreign-key `KEY SHARE` locks never wait), contested inserts last, triggers verified lock-free, whole footprint first, nested `…_locked` functions re-assert preconditions with `NOWAIT`; **(R6)** planned per-operation lock footprints including the actor-authority lock (platform membership first for platform operations; actor membership before invitations); **(R7)** two writer patterns (A database-owned, B repository-owned) with guards against double or missing recording; **(R8)** multi-invitation account setup locks its whole footprint before admitting; the lock-order guard computes recursive waiting footprints and is itself mutation-tested (five injected violation kinds plus the P4 baseline control); new two-connection cases (i)–(k); O3/O4 must be decided before their contracts are frozen. |
| 4 | 2026-10-11 | Follow-up review of rev 3: **(R1 note)** only recognized refusal outcomes enter the denial path; unexpected errors stay 500 and are never recorded as denials (tested); **(R2)** `recordBestEffort` accepts only catalog best-effort identifiers — unknown or misspelled identifiers fail loudly in every entry point; atomic auditing is enforced at the change site (SQL literals checked against the catalog, `mutateAudited`, a per-event coverage test with rollback injection); **(R3)** lock categories extended to every locked table (invitations, single-purpose identity rows, identities and credential rows, sessions, implicit `UPDATE` locks); token-started flows use unlocked lookup → ordered locks → re-check; acquisition one row at a time in sorted order by helpers, independent of query plans, at `READ COMMITTED`; complete lock inventory at `5d8904b` with three non-conforming functions (`set_merchant_status`, `issue_invitation`, `complete_account_setup`) and a latent P4 deadlock (re-invite during account setup) recorded with a test; a static lock-order guard over every function and repository transaction as the proof obligation, with the two-connection runs as evidence. |
| 3 | 2026-10-11 | Independent review (verdict: approve with required revisions): **(R1)** execution contract for privileged operations (§8.2a) — refusals returned, never raised; nothing written before the last check; success audit inside the function; denials recorded best-effort in a separate transaction with the response preserved; sensitive reads audit-then-return; tests per case; **(R2)** audit validation decided by entry point first, so an unknown identifier has a deterministic outcome; one entry point per class; class mismatch through `recordBestEffort` fails loudly; full test matrix (§8.1); **(R3)** one global lock order by category then id, actor and target memberships locked together in one ordered statement; reciprocal-operation and cross-row deadlock tests repeated 50 times, with any `40P01` treated as a defect (§7.2). |
| 2 | 2026-10-11 | Owner review: **(A)** P5.1 is storage only; grant writers move to P5.6/P5.7, after their authorization foundation, and a test proves no app-executable function can write grants; **(B)** the enforcement boundary is one migration that creates the writer functions and revokes direct writes together, with a mixed-version test and the release-failure behaviour stated; **(C)** an owner-approved written D9 policy is mandatory for closure, no exception route; **(D)** platform lock order and grant-revocation races specified and tested in both orders (§7.5); **(E)** strict audit validation with per-class outcomes, and best effort bound to catalog entries (§8.1). O3/O4 labelled as proposals throughout. |
