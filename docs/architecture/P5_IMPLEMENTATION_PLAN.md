# P5 implementation plan — authorization catalog, policy enforcement and audit

**Status: DRAFT, revision 16 (owner review A–E; independent reviews R1–R41 and fixes A–D applied; self-review cycles
recorded in §16; every owner question answered — O3, O5, O6, O8, O9 decided, O7 resolved, D5 and D8 superseded, D9
decided; owner confirmation CF1–CF5 signed 2026-10-12; O4 by design decided at P5.8 step 2; decision log in §14;
awaiting the reviewer's final verdict, then the owner's final go-ahead).
Implementation is not authorized.** This plan becomes
executable only after the owner and the independent reviewer approve it (§12).

| | |
|---|---|
| Repository | `paxalpha/alphakolect_web` |
| Branch | `feat/p5-authorization-audit` (no upstream) |
| Baseline | `5d8904b` (P4 merged). The three review documents and this plan are committed on this branch as planning records (permitted by §12) (`890e59a`, `9650ad4`, `8d8fdac`; the plan from `ce3321f`); no P5 code, migration or test exists |
| Inputs | `P5_AUDIT_REPORT.md` (incl. §22 review outcome and owner decisions), `P5_REVIEW_HANDOFF.md`, `P5_EVIDENCE_PACK.md`, the plan draft supplied by the reviewer, and direct source inspection |
| Prepared | 2026-10-11 |

Labels: **[Fact]** verified in the source at `5d8904b` during planning · **[Plan]** a planned change ·
**[Assumption]** to be confirmed at the start of the package named · **[Open]** needs a decision (§14).

---

## 1. Scope and hard constraints

**In scope:** a database permission catalog; merchant role permissions; per-platform-membership staff grants;
authorization declared for every endpoint, with its branch scope (§7.6); one authorization source shared by the API
and the `SECURITY DEFINER` functions; write-time re-checks; owner-only member and invitation management (D5′); platform staff sign-in and lifecycle
(§7.4); an audit event catalog with explicit failure semantics (including A7); audit read APIs; cross-tenant platform
reads; query-parameter validation; tests proving P4 is preserved. §1.1 traces every inherited obligation.

**Out of scope (by decision):** assigned-customer authorization for agents and anything else that needs customers,
assignments, collections or remittances (D1 → P7/P8); permissions for features that do not exist yet (D2); billing
suspension (P10); end-to-end branch isolation, which needs a branch-owned resource (D7, §7.6). The IP/user-agent rules
are the owner's decisions (D9, §8.6); the owner-approved written policy is a P5 closure requirement (§13 item 9).

### 1.1 Obligations P5 inherits — where each is placed

Every item that an earlier document assigns to P5, and where this plan discharges it. An item without a package here
is not in P5 and says where it goes instead.

| Source | Obligation | Where in this plan |
|---|---|---|
| RESTRUCTURING_MAP §7, P5 row | permission catalog | §6; P5.1 |
| RESTRUCTURING_MAP §7, P5 row; ADR-15 T1 | policies; central authorization | §4, §5, §7; P5.2 (resolver), P5.3 (declarations), P5.4 (API), P5.5 (database) |
| RESTRUCTURING_MAP §7, P5 row | audit hooks, audit module | §8; P5.3a (foundation), P5.8 (reads) |
| RESTRUCTURING_MAP §7, P5 exit; ADR-15 T1 | authorization matrix green | P5.9; §13 item 2 |
| RESTRUCTURING_MAP §7, P5 exit (BR-3) | agents record collections only for assigned customers | **not P5** — moved to P7/P8 by D1; roadmap amended in P5.0; §13 item 10 |
| ADR-15 T2 | platform staff come online | §7.4; P5.7 |
| ADR-15 T5 | no authorization cache; changes apply from the next request | §4 invariant 2; P5.2 tests |
| ADR-15 T8 | P5 attaches permissions to roles | §6, §7.3; P5.6 |
| ADR-15 T9 | interim kind checks replaced wholesale by policies | P5.4 (API, `requireOwner`/`ownerOrDenied`), P5.5 (SQL, with the SQL authority guard) |
| ADR-15 T14 | platform cross-tenant reads as separate, permission-gated services | #35, #36 (P5.7); #34 (P5.8) |
| ADR-15 T15, T16 | 404 across tenants, 403 within; capabilities never bypass current state | §4 invariant 8, §5 `capability` class; P5.9; P4 tests kept (§9.2) |
| P4 closure review (B) | branch scope decided for every endpoint opened to staff; "branch isolation is a P5 exit criterion" | §7.6; P5.3, P5.4, P5.9; §13 item 11. End-to-end branch isolation needs a branch-owned resource, so P5 proves the declarations and the policy and claims no isolation (D7); the first branch-scoped resource (P7/P8) proves it end to end |
| P4 closure review (C) | archived role grants nothing; restriction to an archived branch reaches nothing | D6: §4 invariant 5, P5.2 tests; D7: §7.6 |
| P4 closure review (D) | members and invitations paginated before production; query-parameter validation first | validation: P5.3. Pagination of the two lists: **O9** |
| P4 known limitation (1) | no platform endpoint lists a merchant's memberships | #36; P5.7 |
| P4 known limitations (2), (3) | branch restriction unenforced; archiving does not affect holders | §7.6; D6, D7 |
| P4 known limitation (6) | list endpoints return everything with `nextCursor: null` | O9 (members, invitations); P5's own lists are paginated (§8.5, P5.7) |
| P4 known limitations (4), (5), (7) | setup emails from several businesses; owner-written business name in emails; best-effort email delivery | **not P5** — not authorization; unchanged (P12 outbox for delivery) |
| P4 closure notes (TARGET_ARCHITECTURE §3.4) | authority from the session inside definer functions; deactivation revokes sessions | §8.5 (R19), §7.2 footprints (category 10); P5.5 |
| TARGET_ARCHITECTURE §27 | threat model in `docs/security/` | P5.10 (as-built; `P5_AUDIT_REPORT.md` §15 is design-stage input) |
| RESTRUCTURING_MAP §2.3, §2.4 | UI navigation from server-provided permissions; platform staff with grants (BR-3) | §5 (permission fields on `GET /v1/merchant/membership` — P5.4 — and `GET /v1/auth/session` — P5.7); D4 |
| `P5_AUDIT_REPORT.md` §22.2 | A7: an audit failure turns 401/403 into 500 | §8.3; P5.3a |
| `P5_AUDIT_REPORT.md` §22.4 | owner decisions D1, D4, D5, D9 | §3; D9: §8.6, P5.10, §13 item 9 |
| Found in planning (§7.2, §8.1) | latent P4 deadlock (re-invite during account setup); no acceptance event on the setup path | §7.2 footprints, P5.5 test (h); #14, P5.5 |
| Legacy system (§15) | per-staff audit view | O4 actor filter; P5.8 |

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

**Superseded by later owner decisions (2026-10-11/12, decision log in §14) — the wording above is kept as history:**
D5's clause letting staff assign or invite within a ceiling is replaced by **D5′: inviting staff or agents, cancelling
invitations, changing a member's role or branch, and deactivating or reactivating a member are owner-only** (F1a); the
owner may restrict a staff member to one branch or give all branches (F1b, T7 unchanged). D8 (grantable
`merchant.audit.read`) is replaced by **D8′: the business activity record is owner-only, always** (F2). D9 is decided
(§8.6).

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
   (owner only, D5), `merchant.members.manage` and `merchant.invitations.manage` (owner only, D5′),
   `merchant.audit.read` (owner only, D8′); `platform.merchants.lifecycle`, `platform.merchants.transfer_ownership`,
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
- **`permission`** — a catalog permission (one identifier; reserved permissions and the owner-protection rule are
  enforced by the database, not by combining permissions).

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
| listMembers, getMember / assignMember, deactivateMember, reactivateMember | permission | `merchant.members.read` / `merchant.members.manage` (reserved: owner, D5′) |
| listInvitations / createInvitation, revokeInvitation | permission | `merchant.invitations.read` / `merchant.invitations.manage` (reserved: owner, D5′) |
| deactivateMerchant, reactivateMerchant | permission | `platform.merchants.lifecycle` (reserved: super admin) |
| transferOwnership | permission | `platform.merchants.transfer_ownership` (reserved: super admin) |

**New operations proposed for P5** (contracts finalized in P5.0; additive, non-breaking):

| Proposed operation | Class / permission | Package |
|---|---|---|
| `GET /v1/merchant/permissions` — the merchant catalog (for role editing UIs) | `merchant.roles.read` | P5.6 |
| `PUT /v1/merchant/roles/{roleId}/permissions` — replace a role's permission set | `merchant.roles.manage` (owner) | P5.6 |
| Effective permissions added to `GET /v1/merchant/membership` (new response field) | self | P5.4 |
| Effective permissions added to `GET /v1/auth/session` (new response field; platform sessions — the dashboard sidebar is built from server-provided permissions (RESTRUCTURING_MAP §2.3), and the platform console, whose staff hold per-person grants (§2.4, BR-3), needs the same; empty for agents and enrolment-only sessions) | self | P5.7 |
| `GET /v1/merchant/audit-events` (cursor-paginated) | `merchant.audit.read` | P5.8 |
| `GET /v1/platform/merchants` (list merchants; cursor-paginated) | `platform.merchants.read` | P5.7 |
| `GET /v1/platform/merchants/{merchantId}/members` (one merchant's memberships; cursor-paginated) | `platform.merchants.read` | P5.7 |
| Platform staff: create, deactivate, reactivate (O8(b)), list, set grants (`/v1/platform/staff…`; §7.4) | `platform.staff.manage` (super admin) | P5.7 |
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
| `merchant.members.manage` | merchant | **no** | owner only (D5′) | role/branch changes, deactivate/reactivate of non-owner members; audited |
| `merchant.invitations.read` | merchant | yes | owner; staff via role | exposes invitee emails |
| `merchant.invitations.manage` | merchant | **no** | owner only (D5′) | invite staff or agents, cancel invitations; audited |
| `merchant.audit.read` | merchant | **no** | owner only (D8′) | includes refused attempts and filtering by person; the read itself is audited |
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
  `revoke_invitation` (P4) — which P5 converts to `FOR NO KEY UPDATE`. [Plan] P5 adds three kinds of `DELETE`, all of
  rows that no foreign key references: grant rows (role-permission rewrites, platform-staff deactivation) and, outside
  every request path, expired audit events (the retention purge, §8.6). The guard verifies "no foreign key references
  the table" for every `DELETE` it finds.
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
  `UPDATE`/`DELETE`; refuse them except the purge's age-checked `DELETE`, §8.6 — they read `current_user`, the row and its pair's
  retention — the catalog override or `audit.d9_retention()`, a `STABLE` function that only returns a constant and is on
  the guard's lock-free allowlist (R42) — nothing else, and lock nothing), [Plan] the event-validation trigger (reads the event catalog, §8.1), and the ledger triggers (not touched by these flows); RLS policies call
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
| 0 | `audit.purge_reservation` — the purge's run-wide reservation row, maintenance only, taken `NOWAIT` by the purge functions (§8.6, R40, R43); never by a request path | `FOR NO KEY UPDATE NOWAIT` |
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

**Planned lock footprints (the contract P5.5–P5.8 implement; [Plan]).** Rev 13: the member, invitation and
merchant-audit-read footprints no longer lock the actor's role — it served only the superseded delegation ceiling, and
these operations are owner-only (the owner has no role). The **global category order always
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
| `update_membership` (assign, deactivate, reactivate; owner only, D5′) | 2: merchant / S → 3: {actor, target} / NKU → 7: assigned role / S (assign) → 8: assigned branch / S (assign) | write; 10: target's sessions (deactivate) |
| `list_members`, member and catalog reads | none (authority from the per-request resolver; not a write, not a sensitive read) | read |
| `issue_invitation` | 2: merchant / S → 3: actor / NKU → 4: open invitations for (merchant, email) / NKU (superseded) → 5: the email's setup tokens / NKU (identity found by unlocked lookup) → 6: identity / S → 7: invited role / S → 8: invited branch / S | contested inserts last (L3): identity (if new), invitation, setup token |
| `revoke_invitation` | 2: merchant / S → 3: actor / NKU → 4: invitation / NKU | write |
| `accept_invitation` (invitee, password checked by the API) | 2: merchant / S → 4: invitation / NKU → 6: identity / S → 7: role / S → 8: branch / S | `admit_invitation_locked`: membership insert (L3), invitation consumed, `auth.invitation_accepted` row |
| `complete_account_setup` | unlocked lookup of token and pending invitations → 2: their merchants / S → 4: the invitations / NKU → 5: token / NKU (consume after re-check) → 6: identity / NKU (password, verification) → 7: all their roles / S → 8: all their branches / S | `admit_invitation_locked` for each invitation in id order (L5, L6) |
| branch / role / profile writers | 2: merchant / S (profile: NKU) → 3: actor / NKU → 7: {actor's role} / S, plus the edited role / NKU (one sorted call) → 8: edited branch / NKU | write |
| `set_role_permissions` | 2: merchant / S → 3: owner / NKU → 7: role / NKU | 9: rewrite the role's grant rows |
| `set_merchant_status` | 1: actor / S → 2: merchant / NKU → 6: owner identity / S | write |
| `audit.reserve_purge_run`, `audit.release_purge_run` (operator only; R43) | 0: reservation / NKU `NOWAIT` | write the reservation |
| `audit.purge_candidates` (operator only; R43) | 0: reservation / NKU `NOWAIT`, checked as this run's (renewed) | audit rows read without locks |
| `audit.purge_expired_events` (operator only; R40) | 0: reservation / NKU `NOWAIT`, checked as this run's → audit rows of the page, by id (`DELETE`; nothing else locks them) | #38 insert (fresh key) |
| `audit.clear_expired_request_metadata` (operator only; R40) | 0: reservation / NKU `NOWAIT`, checked as this run's → 5: eligible one-time tokens / NKU `SKIP LOCKED` → 10: eligible sessions / NKU `SKIP LOCKED` | #40 insert (fresh key) |
| `bootstrap_super_admin` (operator only; rev 14) | unlocked lookup of the email → 6: existing identity / NKU (if any) | contested inserts last (L3): identity (if new), platform membership (`identity_id`); `platform.super_admin_bootstrapped` (#15) |
| `transfer_ownership` | 1: actor / S → 2: merchant / NKU → 3: {former owner, new owner} / NKU → 6: new owner's identity / S → 7: former owner's new role / S | write; 10: sessions |
| `set_platform_grants` (P5.7) | 1: {actor / S, target / NKU} (one sorted call) | 9: rewrite the target's grant rows |
| `create_platform_staff` (P5.7) | unlocked lookup of the email (an existing identity ⇒ refused, O8(a)) → 1: actor / S | contested inserts last (L3): identity (`email`), platform membership (`identity_id`), setup token |
| staff deactivate / reactivate (P5.7) | 1: {actor / S, target / NKU} (one sorted call) | write; 9: grant rows removed (deactivate); 10: sessions (deactivate) |
| `audit.read_platform_events` (#34) | 1: actor / S | read event insert, then the rows (one `SELECT`, no row locks) |
| `tenancy.platform_list_merchants` (#35) | 1: actor / S | read event insert, then the rows (one `SELECT`, no row locks) |
| `tenancy.platform_list_merchant_members` (#36) | 1: actor / S | read event insert, then the rows (one `SELECT` over memberships and identities, no row locks) |
| `audit.read_merchant_events` (#33) | 3: actor (the owner, D8′) / S | read event insert, then the rows (one `SELECT`, no row locks) |
| identity flows: `reset_password`, `verify_email` | 5 → 6 (→ 10 reset) | — |
| `change_password` | 6 → 10 | — |
| `rotate_refresh_token` | 5 → 10 | — |
| selection, MFA verify / enrolment | 5 → 6 (credential rows) | session insert (fresh key) |

**Why these read footprints and no more (R20).** A sensitive read locks only the rows that carry the actor's
authority, so that a concurrent revocation is either seen or waits (§7.5): the actor's platform membership for the
three platform reads (platform authority comes entirely from it and its grants), and the actor's merchant membership and
for the merchant audit read (owner-only, D8′: authority comes from the owner's membership; the merchant's active status is re-checked by
the in-function session validation, and a concurrent merchant deactivation takes effect from the next request, as T5
specifies). No merchant, membership or audit row is locked: nothing about them needs to be serialized with a read, and
adding locks would only make readers block writers. **Read semantics:** transactions run at `READ COMMITTED`; the
authority locks are held until commit, so authority cannot change during the read; the returned rows come from **one
`SELECT` statement** and are therefore consistent as of that statement's start. No stronger guarantee is promised —
in particular, successive pages are separate requests and do not form one snapshot (§8.5 cursor rules). Each of the four
operations has its own planned-footprint entry above; the guard fails if a lock or nested call is added to one of them
without updating its entry.

**Read-consistency guarantees — the acceptance criterion for every paginated read (R25).** Locking the authority rows
freezes **authority**, not the **contents** of the list: at `READ COMMITTED` each statement takes its own snapshot,
and nothing locks the listed rows. Each of the four sensitive reads, the two platform lists and (with O9) the members
and invitations lists therefore promises exactly the following, and no more:

1. **Authority:** checked under the authority locks, which are held until commit — a revocation committed before the
   check refuses the read; one attempted during the read waits for it (§7.5).
2. **One page = one statement:** the rows of a page come from one `SELECT`, so they reflect the committed state at
   that statement's start — never a mix of before and after a concurrent change, never an uncommitted row. The read
   neither waits for, nor blocks, writers of the listed rows.
3. **Across pages, no snapshot:** each page is a separate request. Because every ordering key is immutable
   (`occurred_at`/`id` of append-only audit events; `created_at`/`id` of merchants, memberships and invitations), a
   row committed **before the first page** and still matching the filters is returned **exactly once** across the
   pages, **provided it is still present when its page is read** (R35). The one way a row can disappear is the
   retention purge (§8.6), which deletes only rows past their retention period — so only a window that reaches back
   past the retention boundary can be affected. Such a row is then **missing** from its later page; it is **never
   repeated**, no other row is lost or repeated, and the traversal continues normally, because the cursor is a position
   `(occurred_at, id)`, not a reference to a row, so the strict tuple predicate still works when the cursor's own row
   has been deleted. A row committed later appears only if its key sorts after the cursor; [Fact] an audit event's `occurred_at`
   is its transaction's **start** time (§8.5), so a long transaction committing after a page was read can land on a
   later page or only on a fresh first page. Mutable fields (a member's status, role, branch) are shown as of the page
   that returns the row.

Tests (P5.7 for the platform lists, P5.8 for the audit reads and O9 lists), each with a second connection: (a) an
**uncommitted** insert and an uncommitted update of a listed row — the read returns without waiting, omits the
insert and shows the committed version of the updated row; (b) an event committed between two page requests with a
key **older** than the cursor appears on the later page, one with a key **newer** than the first page's first row
appears on no later page, and no row is repeated; (c) a member's status changed between two pages — the row appears
once, with the state at its page's read; (d) the §7.5 revocation race for each read; (e) **traversal against a
concurrent purge** (P5.8, R35) — events backdated past their retention period and recent events in one window, the
purge committed between two pages: every row still present is returned exactly once, purged rows are absent, nothing
is repeated, and a continuation whose cursor row was purged still returns the correct next page. No test may assume that
authority locks freeze the list.

The resolver (§7.1) and the early policy check take no locks. Category 3 takes `FOR NO KEY UPDATE` on the **actor's**
row in writes so any change to the actor (deactivation, role change) serializes with the actor's write; any
operation touching several memberships locks them in one id-ordered call, so concurrent operations on overlapping
members cannot cycle (test (b)).

**Baseline inventory at `5d8904b`** ([Fact], every locking clause and implicit `UPDATE` lock in every function body):
`update_membership` 2 → 3 (target only, `FOR UPDATE`) → 7 → 8; `transfer_ownership` 2 (`FOR UPDATE`) → 3 (`ORDER BY id
FOR UPDATE`) → 6 → 7; `set_merchant_status` **6 → 2**; `issue_invitation` 2 → 7 → 8 → **6 → 5 → 4**;
`revoke_invitation` 2 → 4; `admit_invitation` 2 → 4 → 6 → 7 → 8; `complete_account_setup` **5 → 6 → 2 …** (via
`admit_invitation`); identity flows as in the table above. Non-conforming today: `set_merchant_status`,
`issue_invitation`, `complete_account_setup`; no function yet takes the actor's authority lock (1 or 3), because P4
authority was hard-coded — the planned footprints above add it.

**Baseline reconciliation (R34) — the single inventory the guard's baseline control and report mode use.** [Fact]
from the live definitions at `5d8904b` (for `rotate_refresh_token`, the latest of its three definitions). The guard
finds three **different kinds** of finding; "eight functions" and "three violations" count different kinds:

| Kind (guard check) | Functions at `5d8904b` | Required P5.5 change |
|---|---|---|
| **L1 lock mode** (check 2: `FOR UPDATE` anywhere) — **8 functions, 10 clauses** | P3: `consume_one_time_token` (`20261003000200:85`, category 5), `rotate_refresh_token` (`20261013000100:38,43`, categories 5 then 10 — order already conforms), `take_selection` (`20261009000200:117`, category 5); P4: `set_merchant_status` (`20261009000100:118`, category 2), `update_membership` (`20261011000200:71`, category 3), `transfer_ownership` (`20261011000300:47,56`, categories 2 and 3), `admit_invitation` (`20261012000100:113`, category 4), `revoke_invitation` (`20261012000100:271`, category 4) | every clause becomes `FOR NO KEY UPDATE`; for the three P3 functions this is the **only** change |
| **Category order** (check 1: order) — **3 functions** | `set_merchant_status` (6 at `:116` before 2 at `:118`); `issue_invitation` (2 → 7 → 8 → 6 at `20261012000100:215` → 5 via `issue_one_time_token` → 4); `complete_account_setup` (5 → 6 → 2 …, via `admit_invitation`) | reordered to the planned footprints; only `set_merchant_status` is in both rows |
| **Planned footprint and authority** (check 1: footprint) — **8 functions** | the five P4 privileged functions with no actor authority lock (`update_membership` — which also locks the target only —, `issue_invitation`, `revoke_invitation`, `set_merchant_status`, `transfer_ownership`); `admit_invitation` and `complete_account_setup` (not yet the `…_locked` / whole-footprint structure of L5–L6); `bootstrap_super_admin` (no identity lock, rev 14) | each rewritten to its planned-footprint row |

The baseline control runs the guard against the P4 definitions (kept as fixtures) and must report **exactly the
entries of this table — no more, no fewer**. The tests of P5.5 then prove that every function in it, and every new
function, satisfies L1–L6 and its planned footprint.

**Latent deadlock found by this inventory** ([Probable] by analysis; test (h) confirms or refutes it before the fix):
`issue_invitation` holds the invitee's identity `FOR SHARE` (`20261012000100_invitations:215`) and then, through
`issue_one_time_token`, updates that identity's unconsumed setup tokens; `complete_account_setup` holds the setup token
it consumes and then updates the same identity. Re-issuing an invitation while the person completes setup can therefore
cycle — PostgreSQL aborts one transaction (no corruption, an avoidable failure). The planned footprints remove it.

**Lock-order guard ([Plan], P5.5) — what it covers, and how it is itself tested.** A database test reads every
function and trigger body from the migrated catalog (`pg_get_functiondef`) and every repository transaction in
`apps/api/src`, and for each privileged operation computes its **waiting footprint**: explicit `FOR …` clauses (not
`NOWAIT` or `SKIP LOCKED`, which never wait), `UPDATE`s and `DELETE`s (implicit row locks), contested inserts, and — recursively — the footprint of every
function it calls. It fails if (1) any operation's footprint differs from the planned footprint in the table above, from
the category order, or from the authority rule (category-level and row-level, as stated above); (2) `FOR UPDATE`, a key update or a `DELETE` of a referenced table appears anywhere (L1/L2);
(3) a contested insert is followed by any further lock (L3); (4) a trigger function locks anything (L4); (5) a
`…_locked` function waits for any lock, or is executable by the app (L6). **Guard self-tests:** it runs against the
P4 definitions (kept as test fixtures) and must report exactly the entries of the baseline reconciliation table above
(R34); and a mutation test
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
  | **T2 pattern-B audited write** | the identity definer call(s) of one flow + exactly one `mutateAudited` call for an approved pattern-B pair | the definer calls' footprint (§7.2 table); the audit insert is the **only** direct table write allowed in it, and only through `mutateAudited`; audit inserts **inside** the definer calls only as listed in the nested-writer table below (R27) |
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

  **Nested pattern-A events inside a pattern-B flow (R27) — one table, used by every guard.** One flow combines the
  patterns: account setup. Its transaction is T2 — `complete_account_setup` plus one `mutateAudited` for
  `auth.account_setup` (#10) — and the definer function, through `admit_invitation_locked`, inserts one
  `auth.invitation_accepted` (#14, pattern A) per admitted invitation. This is permitted by an explicit **nested-writer
  table**, kept in the guard and in this plan, whose only entry today is:

  | T2 flow | Nested function (the pattern-A writer) | Pair | Rows per transaction |
  |---|---|---|---|
  | account setup (`PasswordService.completeSetup`) | `tenancy.admit_invitation_locked`, reached only through `identity.complete_account_setup` | #14 `auth.invitation_accepted` / success | 0..n — one per invitation admitted |

  The transaction-class classifier, the writer guard and the coverage guard all read this same table: a T2 transaction
  is accepted only if every audit insert reachable from its definer calls is an entry of the table for that flow, and
  the TypeScript body still contains exactly one `mutateAudited`; a pattern-A pair is still written only by its one
  designated function (the writer guard does not change), and the coverage guard still counts that one writer. Any
  other nested audit insert in a T2 flow fails all three guards. **Tests (P5.5):** setup with no invitation (only #10),
  with one and with two invitations of two merchants (one #10 and one #14 per admitted membership, each with the actor
  of §8.1); an injected failure of #14 for the **second** invitation rolls back everything — password, verification,
  both memberships, the first #14 and #10; an injected failure of #10 rolls back both #14 rows and the memberships;
  guard self-tests: a scratch T2 flow whose definer function writes a pattern-A pair **not** in the table fails, and a
  table entry whose function is not reachable from its flow fails.

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
transfer); (b) **concurrent member operations** — two sessions of the owner act concurrently on members A and B in
opposite id orders (deactivate A while reassigning B, and the reverse), and a staff member's branch write races the
owner deactivating that staff member, repeated 50 times: never SQLSTATE `40P01` (deadlock), every outcome per §7.2
(staff can no longer act on each other, D5′, so the earlier staff-vs-staff case cannot arise); (c) role-permission edit vs assignment into that role; (d) ownership transfer vs member
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

### 7.3 Delegation — owner-only (D5′; the ceiling below is superseded)

**Decided 2026-10-11/12 (F1):** only the owner invites, cancels invitations, changes a member's role or branch, and
deactivates or reactivates members. `merchant.members.manage` and `merchant.invitations.manage` are reserved
(§4 invariant 4), so **no staff member can delegate anything** and the delegation ceiling is not built. The database
functions refuse every member and invitation write by a non-owner, whatever grant rows exist. The owner-protection
rule stays (the owner's own membership is never a target). Staff may still be granted `merchant.members.read` and
`merchant.invitations.read`. The superseded design is kept below as history:

> *Superseded (rev 11 design):* for a non-owner actor, `members.manage` and `invitations.manage` operations
> succeeded only if the target was not the owner, the target's current role and the assigned or invited role were
> both within the actor's own permissions (a subset test inside the definer functions), and that role was active.

### 7.4 Platform staff (D4)

Grants attach to `identity.platform_memberships.id`, not to the identity. Sign-in eligibility admits active platform
memberships of every role; MFA remains mandatory for all platform identities (the existing login and enrolment flow
applies unchanged). A platform staff member without grants can sign in and use `self` endpoints only.

**Lifecycle of a platform staff member (all super admin only, `platform.staff.manage`, D4).** [Fact] An identity has at
most one platform membership (`UNIQUE (identity_id)`, `20261003000100_identity_schema:144`); `role` is one of
`super_admin`, `support`, `verification`, `finance` (CHECK, `:230`); today only the bootstrap creates a platform
membership (`20261003000500:62`).

- **Create** (`identity.create_platform_staff(session, email, role)`): the super admin gives an email and a role
  label (`support`, `verification` or `finance`; never `super_admin`). One definer function creates a
  **passwordless identity**, its platform membership **with no grants**, and a P3 **account-setup token** — the same
  onboarding mechanism as a new person's invitation (T10); the API sends the setup link (best effort until the P12
  outbox, as for invitations). The person sets a password through the existing setup flow, then signs in and must
  enrol MFA through the existing platform enrolment flow before any `full` session exists. The role label grants
  nothing (D4); access comes only from grants set afterwards. Event #30, actor from the session.
- **An email that already has an identity — decided (O8(a), owner, 2026-10-11):** refused (`409`, a recorded denial) in P5. A
  platform account stays a separate person-account from any merchant account, so no existing password, MFA state or
  merchant membership is carried into the platform audience, and the one-membership-per-identity rule is never hit by
  a second creation. The super admin uses another address. (Anti-enumeration does not apply: only the super admin can
  call it.)
- **Separation in the other direction — decided (CF3, owner, 2026-10-12: "Yes, keep them apart both ways").** The owner's reason for O8(a) was that
  platform and business accounts stay "distinct and do not interfere with each other". [Fact] Sign-up already ignores an
  email that has an account (`signup_merchant_owner` returns `created = false`, `20261003000200:19-22`), but a
  business owner can invite an **existing** account, which then joins with its password (T11). So that a platform
  account can never join a business: `admit_invitation_locked` refuses an identity that holds a platform membership
  (any role, any status), on both paths, with the same generic failure as every other refused acceptance (T11); issuing
  the invitation is unchanged, so the business owner's response still reveals nothing (T10).
- **The operator bootstrap keeps the separation too (rev 14).** [Fact] `identity.bootstrap_super_admin` "creates (or
  reuses)" an identity: it attaches the super-admin membership to an **existing** identity whose email matches, if that
  identity has no platform membership (`20261003000500:38-60`) — so today it could make a business account a super
  admin. P5.5 replaces it (same signature, operator-only): it locks an existing identity `FOR NO KEY UPDATE`
  (category 6) and refuses it if it holds any merchant membership (any kind, any status), raising as it does today for
  an identity that already has a platform membership. `create_platform_staff` only ever creates a new identity
  (O8(a)), so bootstrap is the one path that can add a platform membership to an existing identity. The migration
  refuses to run, with an explanation, if any identity already holds both a platform and a merchant membership (as
  `20261010000100_staff_role_required` refused role-less staff), so the rule never starts from inconsistent data.
- **Why the two checks cannot both pass.** Admission locks the invitee's identity (category 6: `FOR SHARE` on the link
  path, `FOR NO KEY UPDATE` at account setup) before it checks for a platform membership; bootstrap locks the same row
  `FOR NO KEY UPDATE` before it checks for merchant memberships. `FOR NO KEY UPDATE` conflicts with both modes, so the
  two serialize on that row and the second sees the first's committed membership.
- **Tests (P5.5):** an invitation to a platform staff member's (or the super admin's) email cannot be accepted by link
  and password, nor admitted at account setup, and the issue response is identical; bootstrap on an email with a
  merchant membership is refused and creates nothing; bootstrap on a passwordless identity without memberships still
  works; two connections — admission of an invitation vs bootstrap of the same email, in both orders — end with the
  identity in at most one audience, never `40P01`.
- **Deactivate:** membership `deactivated`, its sessions revoked (category 10), **its grants removed** in the same
  transaction (the event's allowlisted summary lists the identifiers removed); event #31.
- **Reactivate — decided (O8(b), owner, 2026-10-11):** because the membership is unique per identity, a deactivated staff member
  can never be re-created; without reactivation, re-employing someone needs a new email address. P5 adds
  `reactivate` (super admin): status back to `active` with **no grants** (they were removed at deactivation), so access
  is re-granted explicitly; a new atomic pair `platform.staff_reactivated` (success, #37; denied/failure best effort).

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

### 7.6 Branch restriction (D7; P4 closure review (B) and (C))

[Fact] A staff membership may be restricted to one branch (`branch_id`; `NULL` = all branches, T7); invitations carry
the same field. No branch-scoped **resource** exists (`schema.prisma`, 21 models: no customer, collection or other
branch-owned data). The P4 isolation matrix pins staff and agents to their own membership endpoints so that "any
endpoint opening to staff or agents fails the matrix until its branch scope is decided and tested (P5)"
(RESTRUCTURING_MAP, P4 closure review (B)). P5 opens profile, branch, role, member-list and invitation-list endpoints to
staff (the audit read and every member and invitation write stay owner-only, D5′/D8′), so it must make that decision
explicitly:

- **Every `permission` endpoint declares a branch scope** in the registry, next to its permission (P5.3):
  `merchant_wide` or `branch`. Every P5 endpoint is `merchant_wide`: the merchant's profile, its list of branches,
  its roles, its members, its invitations and its audit log are business-level administration, not data of one
  branch. A branch restriction does **not** narrow them, and P5 claims no branch isolation (D7). `branch` is reserved
  for the first branch-owned resources (P7/P8); the router refuses to start on a `branch` endpoint without a resolver
  for the resource's branch.
- **The policy decision takes an optional resource branch** (P5.4): for a `branch` endpoint, a restricted staff member
  is allowed only for resources of their branch; lists filter in the scoped repository query, never after fetching;
  another branch's resource answers **404** (T15). A restriction to an **archived** branch reaches **no** branch-scoped
  resource (fail closed, D7 / P4 closure (C)); `NULL` reaches all. Unit-tested now with synthetic resources, since no
  real one exists.
- **Delegation and branches — O7 resolved by D5′.** Only the owner assigns or invites, choosing one branch or all
  (F1b), so no branch ceiling exists and none is built (R29). History: rev 10 proposed a branch ceiling for staff who
  could delegate; D5′ removed staff delegation, and with it the question.
- **Tests:** registry: every P5 endpoint declared `merchant_wide`, a `branch` declaration without a resolver refuses
  startup; policy unit tests for restricted, unrestricted and archived-branch actors with synthetic resources (P5.4);
  the matrix (P5.9) adds a branch-restricted staff member and a staff member restricted to an archived branch, who must
  get exactly the results of an unrestricted staff member with the same permissions on every `merchant_wide`
  endpoint.

## 8. Audit design

### 8.1 Event catalog

A closed catalog of event identifiers, **held in the database** — table `audit.event_catalog` (identifier, outcome,
class, writer pattern, summary allowlist with a maximum length per field), app `SELECT` only — and mirrored as a
TypeScript union **for typing only**, compared with the table on every test run (as for permissions, §4 invariant 1).
[Plan, P5.3a] A `BEFORE INSERT` trigger on `audit.audit_events` validates every row against it — an unknown
(identifier, outcome) pair, a summary field outside the allowlist or over its length bound raises — so the behaviour
table below holds **at run time for every writer**, SQL functions included, not only for TypeScript callers. Its
function is `SECURITY DEFINER` with a pinned `search_path` and no app grant, so no writing role needs a grant on the
catalog. Each catalog entry has a **retention override** column (`retention_override interval`, nullable). For every
P5 pair it is `NULL`, meaning "the D9 retention": the purge and the append-only trigger compute an entry's retention
at run time as `COALESCE(retention_override, audit.d9_retention())` (§8.6, R41, R42), so `audit.d9_retention()` is
the one runtime source for P5, not a value copied into rows. A later phase whose events need a different period
(e.g. financial records in P6+) sets an override on its own entries by migration, instead of redesigning the purge;
a catalog test fails if any P5 pair carries an override. Writer
class and pattern stay enforced by the static writer guard and by `recordBestEffort`'s own class check. The **class** (atomic, best effort or sensitive
read, §8.2) is declared per **(identifier, outcome)** pair — e.g. `auth.login`/`success` is atomic (a session is
created) while `auth.login`/`failure` is best effort — together with a **summary allowlist** (field → type, bounded
length) and, for atomic pairs, the **writer pattern** below. Existing identifiers are kept (e.g. `auth.login`, `merchant.member_assigned`,
`platform.ownership_transferred`); new ones are added per package. Never stored: tokens, token hashes, passwords, OTPs,
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
  - **operator** operations (`bootstrap_super_admin` #15, the retention purge #38 and its field clearing #40, the
    containment switch #39): actor
    `NULL`, as for the bootstrap today.

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
| 37 | `platform.staff_reactivated` *new* (O8(b), rev 12; numbered after the sensitive reads so existing numbers stay stable) | success | A | P5.7 staff function | P5.7 tests |
| 38 | `platform.audit_purged` *new* (D9, rev 12) | success | A | `audit.purge_expired_events` (operator only, §8.6) | P5.8 tests |
| 39 | `platform.authorization_containment_set` *new* (R30, rev 13) | success | A | `util.set_authorization_containment` (operator only, §11.1) | P5.5 tests |
| 40 | `platform.request_metadata_cleared` *new* (R40, rev 16) | success | A | `audit.clear_expired_request_metadata` (operator only, §8.6) | P5.8 tests |

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
| `platform.merchant_deactivated`, `platform.merchant_reactivated`, `platform.ownership_transferred`, `platform.staff_created` *new*, `platform.staff_deactivated` *new*, `platform.staff_reactivated` *new*, `platform.grants_set` *new* | denied, failure |
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
for which (identifier, outcome) pair belongs to which class (atomic #1–#32 and #37–#40, sensitive read #33–#36, and every
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
   `AuthContext` — including the actor's session merchant, so a refusal inside a business appears in that business's
   activity record (§8.5) — then answers 401/403/404/409 as today. A failure of that best-effort insert is logged and counted;
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
  event around the call — the one combination of the two patterns, permitted only through the nested-writer table of
  §7.2 (R27) and tested there. Which invitations are admitted, and when, is unchanged (the P4.6 tests stay).

### 8.5 Actor attribution (D11) and reads

- Privileged operations (pattern A): on success the audit row is written **inside** the definer function (precedent:
  `bootstrap_super_admin`), with actor identity, audience and membership taken from the validated session — the app
  cannot supply them; capability-based pattern-A events (invitation acceptance) take the actor from the locked
  invitation and setup token, as specified in §8.1. Identity flows (pattern B) take the actor from the identity the flow
  has just verified (password, token or session). Denials follow §8.2a rule 5. The §8.1 inventory is the authoritative
  list of which events use which pattern.
- Merchant audit reads: through the designated definer function `audit.read_merchant_events` (#33), requiring
  `merchant.audit.read` (owner only, D8′), with tenant isolation enforced **inside the function** as specified below
  — not by RLS. **Decided (O3, F2):** the owner sees every event of their own business, **including refused
  attempts**, and can **filter by person**; fields are the event's allowlisted summary plus, per D9, the IP address and
  user agent (§8.6); never another business's events, credentials, tokens or request bodies. **Decided (CF5, owner,
  2026-10-12):** events in the business's record that were performed by the AlphaKolect platform team (for example a
  deactivation of the business) are shown **without** the platform actor's IP address and user agent: D9 lets a
  business owner see these fields for their own business's people, not for the platform team. Tested in P5.8.
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
  a required time window of at most 31 days — for **both** audit reads (R24) — to be validated against the index and query design (below) before it is
  frozen.
- **Pagination contract for both audit reads (R21).** It applies identically to `GET /v1/merchant/audit-events` (#33)
  and `GET /v1/platform/audit-events` (#34) (R24). **The bounds — maximum page size and maximum window — are one
  decision, O4, applied to both endpoints**; the 31-day window and 100-event page below are O4's proposal, not yet
  frozen. O3 decides only what the merchant read shows (events, fields, filters), never its bounds, so the two
  decisions cannot set conflicting limits.
  - **Order:** newest first, `ORDER BY occurred_at DESC, id DESC` — a total order: [Fact] `occurred_at` defaults to
    `CURRENT_TIMESTAMP` (`20260927000100_baseline:133`), PostgreSQL's **transaction start time**, so every event
    written in one transaction shares a timestamp; ties are routine, not an edge case, and the UUIDv7 `id` breaks them.
  - **Window and filters come from the request, every time.** The time window (`from`, `to`; at most the O4 maximum, proposed 31 days; `from` <
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

Collection continues unchanged. **Decided by the owner (2026-10-11/12; decision log, §14):**

- **Purpose:** investigating break-ins and suspicious activity, and settling disputes (D1).
- **Who may see the IP address and user agent:** each business owner, for their own business's events (§8.5), and
  the super admin; **platform staff never**, whatever their grants (F3). [Plan] The platform audit read returns these
  two fields only to the super admin; for a platform staff member holding `platform.audit.read` the designated
  function omits them. Tested both ways.
- **Retention:** every audit entry — IP address and user agent included — is kept for **two years** and then
  **deleted in full** (F4, confirmed by the owner as CF2a on 2026-10-12: "Yes, two years for everything"; the earlier one-year answer is
  replaced). No audit entry is ever edited in place.
- **Existing records:** the rule applies to records already stored (D5).
- **The same details outside the activity record — decided (CF4, owner, 2026-10-12: "Yes, two years").** [Fact] Two other tables
  hold them: `identity.sessions` (`created_ip`, `user_agent`, `20261003000100_identity_schema:48-49`) and
  `identity.one_time_tokens` (`requested_ip`, `:74`). No endpoint exposes them, and P5 adds none, so no one sees them
  through the system. Their rows are referenced by other rows (refresh tokens reference sessions), so they are not
  deleted (L1); instead the purge **clears these fields** on sessions that ended (revoked or past their absolute
  expiry) more than two years ago and on links sent more than two years ago that are already used or expired —
  the same two-year rule, with the exact conditions in the retention design below (R37).
- **Copy before deletion:** before a clean-up, the owner may ask for a copy of the entries about to be deleted; it is
  handed over as a report (a file) and **the system keeps no copy** (F4, confirmed by the owner as CF2b on 2026-10-12:
  "A copy of the entries about to be deleted may be sent as a report, but the system will not keep a copy"). The copy holds personal data: the written D9 policy states who may hold it, where it is kept and when it is
  destroyed, and the operator command writes it only to the path the operator names, never into the repository or
  onto the server.

**Retention design ([Plan], P5.8) — the one controlled exception to append-only.** [Fact] `audit.audit_events` is
append-only for every role (grant and trigger, `20260927000300:142-147`).

**"Two years" has one technical meaning (R41):** calendar years — PostgreSQL `timestamptz − interval '2 years'`, the
owner's words ("two years"), not 730 days. It is defined once, as the SQL function `audit.d9_retention()` returning
`interval '2 years'` (declared `STABLE`, not `IMMUTABLE`, so a redefinition is never inlined or cached as a
constant). It is read **at run time** everywhere: the audit deletion and the append-only trigger's age check use
`COALESCE(retention_override, audit.d9_retention())` for the event's catalog entry — every P5 entry has no override —
and the session and token clearing use it directly. Redefining the function (a migration, `CREATE OR REPLACE`)
therefore moves all four cutoffs together, with nothing stored to update (R42). Year
arithmetic on `timestamptz` depends on the session time zone, so every function that computes a cutoff (the two purge
functions, the clearing function and the trigger function) pins `SET TimeZone = 'UTC'` beside its `search_path`.
Comparisons are strict: a row is eligible when its time is **before** the cutoff, never at it. On a leap day the
calendar rule gives the natural answer — a cutoff computed on 29 February 2028 is 28 February 2026.

The exception is:

1. a dedicated `NOLOGIN` role, `alphakolect_audit_purger`, is the only role with `DELETE` on the table;
2. two functions, both owned by that role (`SECURITY DEFINER`, pinned `search_path` and `TimeZone`, R41),
   operator-only, define
   **eligibility as of a moment** `p_as_of` (refused if later than `now()`): an audit row is eligible when
   `occurred_at < p_as_of − COALESCE(retention_override, audit.d9_retention())` for its pair (R42). Because `p_as_of` can never be in the future, an operator
   can only make the eligible set smaller, never shorten the retention:
   - `audit.purge_candidates(p_run_id, p_as_of, p_after_id, p_limit)` — reads audit rows without locking them, paged
     by `id`; its only write is renewing this run's reservation (R43), which it checks first like every purge
     function, so a long export keeps the run alive page by page. It returns up to `p_limit`
     eligible rows with `id > p_after_id`, in `id` order, each with its `id` and its canonical text
     (`to_jsonb(row)::text`), and a SHA-256 digest the database computes over those texts joined by newlines in that
     order — the exact bytes the report file contains for that page, so the digest can be recomputed from the file;
   - `audit.purge_expired_events(p_as_of, p_ids, p_expected_digest)` — **deletes by identity, never by predicate
     (R38).** It takes the exact ids of one page as exported and verified, re-reads **those** rows, and raises —
     deleting nothing — unless every id exists, every row is still eligible as of `p_as_of`, and the digest of their
     canonical texts equals `p_expected_digest`; then it deletes `WHERE id = ANY(p_ids)` and raises unless the
     number deleted equals the number of ids. Audit rows are immutable (append-only), so rows identified by id cannot
     change between the check and the delete. An eligible row that commits **after** the page was read — possible,
     because `occurred_at` is its transaction's **start** time, so a long transaction can commit an already-old event
     late — is not in `p_ids` and is therefore never deleted by this run: it stays for the next run, which exports it
     first. Without a requested export the operator command passes the ids and digest it has just read from
     `purge_candidates`, so the same check guards every run. `purge_candidates` writes no event of its own: it is
     reachable only by the operator role, which as the table owner can already read the table, and each run's export
     is recorded in its #38 event;
3. the append-only trigger is changed to allow a `DELETE` **only** when `current_user` is that role **and** the row is
   older than its pair's retention, `COALESCE(retention_override, audit.d9_retention())` (R41, R42), so even
   a defect in the purge
   function cannot delete a younger row; `UPDATE` stays forbidden for everyone;
4. a third operator-only function owned by the purger, `audit.clear_expired_request_metadata(p_as_of)`, run once per
   purge run after the deletion pages, in its own transaction with its own event (#40), clears (CF4) — an `UPDATE` of
   non-key columns, outside every request path — exactly these, **tokens first, then sessions** (lock categories 5
   then 10), each row selected `FOR NO KEY UPDATE SKIP LOCKED` and then updated by id, so a row a request transaction
   holds is skipped and cleared by the next run (R40), with `cutoff = p_as_of − audit.d9_retention()` (R37, R41):
   - `identity.one_time_tokens`: `requested_ip` set to `NULL` where the link was sent before the cutoff
     (`created_at < cutoff`, the owner's "two years after a link was sent", CF4) **and** the token can no longer be used —
     consumed (`consumed_at IS NOT NULL`) or expired (`expires_at <= p_as_of`). A still-valid token never qualifies;
     [Fact] token lifetimes are capped at 24 hours by the live `issue_one_time_token`
     (`20261004000200_account_setup_tokens`: verification and account setup 24 h, reset 30 min), so this is a
     safeguard, not a common case;
   - `identity.sessions`: `created_ip` and `user_agent` set to `NULL` where the session has **ended** — revoked
     (`revoked_at IS NOT NULL`) or past its absolute expiry (`absolute_expires_at <= p_as_of`) — **and** it ended before
     the cutoff: `COALESCE(revoked_at, absolute_expires_at) < cutoff` (a revoked session ends at `revoked_at`, which
     the session-revocation CHECK pairs with `revoke_reason`; an unrevoked one at `absolute_expires_at`). An active
     session — unrevoked with `absolute_expires_at > p_as_of` — never qualifies, whatever its age;
   - no other column and no other table is touched;
5. `EXECUTE` is granted to the operator role only (`alphakolect_migrator`), **never** to `alphakolect_app` — no
   request path can delete audit rows;
6. each deletion page writes one atomic event, `platform.audit_purged` (#38, pattern A, actor `NULL` as for the
   operator bootstrap #15), with `p_as_of`, the page digest, whether an export was made and the number of rows
   deleted per pair, in the same transaction as the deletion; the field clearing writes its own atomic event,
   `platform.request_metadata_cleared` (#40, pattern A, actor `NULL`), with `p_as_of` and the numbers of session and
   token rows cleared — one writer per pair, as the coverage guard requires;
7. **the operator command and its failure semantics (R36).** One run, in this order:
   0. **reserve the run** (R43): `reserve_purge_run(p_as_of)` returns a new `run_id`, or fails at once if another run
      holds a live reservation — before anything is read, written or deleted;
   1. with that `run_id` and `p_as_of`, read **every** page of `purge_candidates` (ids, texts, page digests); each
      page renews the reservation, so an export of any size stays within the lease;
   2. **if the owner asked for a report:** write all pages to a new file at the path the operator names (never in the
      repository or on the server), flush it to disk (`fsync` of the file and its directory), read it back, and check
      that every page's rows reproduce that page's database digest; record the file's own SHA-256. Any failure here —
      unwritable path, full disk, interrupted process, mismatch — **ends the run before any deletion**; nothing is
      deleted and the run can simply be repeated;
   3. only then, page by page, call `purge_expired_events(run_id, p_as_of, page ids, page digest)`, each in its own
      transaction with its own #38 event. If a call raises or its commit fails, that page deletes nothing and the run
      stops; pages already committed were deleted exactly as exported. **Invariant: every row ever deleted is a row of
      a verified report** (when one was requested), and the report covers every row of the run, deleted or not; a
      repeat run exports the remaining rows again;
   4. after the last page, call `clear_expired_request_metadata(run_id, p_as_of)` (no export: these fields are not part of
      the report the owner asked for, and clearing destroys no row);
   5. **release the reservation** with `release_purge_run(run_id)`, also when a step above failed (the command
      always tries); if the process dies first, the reservation simply expires (below);
   6. the command prints the file path, its SHA-256 and the counts for the owner's delivery; it keeps nothing. The
      file holds personal data until delivered: the written D9 policy states who holds it, how it reaches the owner and
      when it is destroyed.

   **Run-wide reservation (R43).** A purge run is several transactions (reservation, one per page, the clearing,
   release), so a lock held by one transaction cannot reserve the whole run. The one row of `audit.purge_reservation`
   (`run_id`, `p_as_of`, `reserved_at`, `renewed_at`) is the reservation instead, written in transactions of its own
   — no advisory lock (they fail the lock-order guard):
   - `reserve_purge_run(p_as_of)` takes the row `FOR NO KEY UPDATE NOWAIT`; if it holds a **live** reservation —
     `renewed_at` within the lease, `audit.purge_lease()` = 15 minutes (`STABLE`, like `d9_retention`) — it
     raises `purge_run_active` at once; otherwise (free, or expired after a crash) it writes a new `run_id` and the run's
     `p_as_of`, and commits. A takeover of an expired reservation is recorded in the new run's first #38 or #40 event;
   - `purge_expired_events` and `clear_expired_request_metadata` take `p_run_id` and, as their first step, take the
     row `FOR NO KEY UPDATE NOWAIT` and raise — doing nothing — unless it holds **this** run's live reservation with
     the same `p_as_of`; they then renew `renewed_at`. Pages are bounded (`p_limit`), so a live run renews well within
     the lease;
   - `release_purge_run(p_run_id)` frees the row if it still holds this run.

   **What this guarantees.** A second run fails at once — with `purge_run_active` if the first run is between
   transactions, with `lock_not_available` if one of the first run's transactions holds the row — before it reads or
   changes anything. A takeover can only happen **between** the old run's transactions (each holds the row until it
   commits), and only after the lease has expired. If the old run was merely slow rather than dead, its next page
   finds the reservation no longer its own and stops without deleting; everything it had deleted was in its verified
   report. The page-level checks of R38 (every id present, eligible and matching the digest) remain a second line of
   defence for any interleaving.

   **Purge lock footprint (R40) — inside the global order, and never waiting.** Every purge transaction first takes
   the reservation row `FOR NO KEY UPDATE NOWAIT` — category **0**, maintenance only, never touched by a request
   path. Its other locks:
   - **audit rows (deletion by id):** a `DELETE` locks the rows it removes, but nothing else ever locks
     `audit.audit_events` rows — request paths only insert new rows, no foreign key references the table, `UPDATE`
     and every other `DELETE` are refused by the append-only trigger, and a second purge is excluded by the run-wide
     reservation (R43) — so these deletes cannot wait;
   - **category 5, then category 10 (field clearing):** `SKIP LOCKED`, so they cannot wait either. [Fact] Request
     paths never lock an eligible token (consumption and supersession touch only unconsumed, unexpired tokens:
     `20261003000200:80-89`, `20261004000200:43-45`), but they **can** lock an eligible session: revocations update
     `… WHERE revoked_at IS NULL`, which includes sessions past their absolute expiry
     (`20261003000200:124`, `20261003000300:159,171`, `20261011000200:111`, `20261011000300:94`) — those rows are
     skipped and cleared by a later run.

   A transaction that never waits cannot be part of a deadlock; request transactions may wait briefly for a purge
   that holds a row, which is a one-way wait. The lock-order guard checks every purge function against its planned-footprint row (§7.2;
   `purge_candidates` locks only the reservation, never an audit row) like any other operation — no exemption — and verifies the facts this relies on: no
   function other than the purge locks, updates or deletes `audit.audit_events` rows, and no foreign key references
   the table.

   A report can therefore never be lost to a deletion: deletion requires a verified report when one was requested, and
   it deletes only rows, identified by id, that the report contains. Until a job runner exists (P12) the command is run by hand; the D9
   written policy states how often.

Tests: rows younger than their retention period always survive, whatever `p_as_of`; **boundary (R41)** — for the
audit deletion, the trigger's age check, session clearing and token clearing alike: a time exactly at the cutoff is
not eligible and one microsecond earlier is; `p_as_of` on 29 February 2028 gives the cutoff 28 February 2026; the same
result under two different session time zones; redefining `audit.d9_retention()` in the throwaway test database
(`CREATE OR REPLACE`, as a migration would) moves all four cutoffs together on the next call, with no catalog row
changed; a scratch event entry with an override uses its override, not the function; the catalog test fails if a P5
pair has an override; a `p_as_of` in the future is
refused (by every purge function that takes it); the app role cannot execute any purge function (`reserve_purge_run`,
`purge_candidates`, `purge_expired_events`, `clear_expired_request_metadata`, `release_purge_run`) or delete directly;
an `UPDATE` of `audit.audit_events` refused for every role including the purger, and a `DELETE` by any role other
than the purger (the table owner included) refused; **eligibility (R37)** — old and recent sessions, active
(unrevoked, unexpired), revoked and absolutely expired sessions, revoked or expired less than two years ago, and
consumed, expired and still-valid tokens (a still-valid token backdated in the test fixture) — only the named fields of
eligible rows change, every other column and row is unchanged; the summary event commits with the deletion and a
failure of its insert rolls the deletion back; **export failure semantics (R36)** — an unwritable path, a disk-full
simulation, a process killed between the export and the deletion, and a read-back mismatch each leave every row in
place; **page verification (R38)** — a page whose ids include one already deleted, a row not eligible as of
`p_as_of`, or a digest that does not match makes `purge_expired_events` raise and delete nothing, while an eligible
row that arrived after the page was read is simply not in the page and is left for the next run; a failure injected on #38 rolls the deletion back and leaves the
verified file; a successful run deletes exactly the rows in the file (ids and digest); **late-commit race (R38)** — a
second connection holds a transaction that inserts an already-eligible (backdated) event and commits it **after**
`purge_candidates` has read the page and **while** `purge_expired_events` runs, between its verification and its
delete (the test pauses the purge between the two statements): the late row is not deleted, is absent from the
report, and is exported and deleted by the next run; a failure stopping a multi-page run after its first page leaves
the later pages' rows in place and fully covered by the verified report; **purge locking (R40, R43)** — a second
run started while the first is between pages fails at once with `purge_run_active`, and one started while a page
transaction of the first holds the row fails at once with `lock_not_available`; either way it reads, exports and
changes nothing; a run killed after its first page leaves a reservation that blocks new runs until the lease expires
(the test redefines `audit.purge_lease()` to a short interval), after which a new run takes over and records the
takeover; the old run, resumed, has its next page refused without deleting anything; a page called with a stale or
foreign `run_id`, or another `p_as_of`, is refused; release frees the reservation; an export whose pages together take longer than one lease (short test lease)
completes, because each `purge_candidates` page renews the reservation; a request revoking an
expired, unrevoked (eligible) session runs against `clear_expired_request_metadata` in both orders, 50 times: never
`40P01`, the purge never waits (it skips the held row, which a later run clears), and the revocation completes; a failure injected on #40 rolls the field clearing back; the lock-order and writer guards
classify all five purge functions (operator-only, outside every request path). **P5 still cannot close without the owner's
approved written policy** (§13 item 9), now written from these decisions.

## 9. Conventions, commands and gates

### 9.1 Migrations

[Fact] Directory names `YYYYMMDDNNNNNN_snake_case` (date of authoring + `000100`, `000200`, … within the day), one
`migration.sql` each, raw SQL, `SECURITY DEFINER` + `SET search_path = pg_catalog, pg_temp` + `REVOKE ALL … FROM
PUBLIC` + `GRANT EXECUTE … TO alphakolect_app`; `CREATE OR REPLACE` when a signature is unchanged (grants kept),
`DROP` + `CREATE` + re-grant when it changes; `schema.prisma` updated in the same commit (drift test). Names below are working titles; timestamps are assigned
when each migration is written.

**Execution grants — the convention and its exceptions (R31).** `GRANT EXECUTE … TO alphakolect_app` applies only to
functions a request path calls. **No app grant** for: operator and maintenance functions
(`identity.bootstrap_super_admin`, `audit.purge_candidates`, `audit.purge_expired_events`,
`audit.clear_expired_request_metadata`, `audit.reserve_purge_run`, `audit.release_purge_run`, `audit.d9_retention`,
`audit.purge_lease`, `util.set_authorization_containment`); the
`…_locked` inner functions (L6); trigger functions. **Execute-grant inventory test (P5.1, extended by every package):**
every function in the `identity`, `tenancy`, `audit` and `util` schemas is listed with its intended grantees; any
function missing from the list, or with a grant that differs from it, fails the test; and for each function without an
app grant, a call as `alphakolect_app` fails with `insufficient_privilege`. **The purger role**
(`alphakolect_audit_purger`, §8.6) is `NOLOGIN`, a member of no other role, and holds **exactly** (R39):

| Object | Privilege | Why |
|---|---|---|
| schema `audit` | `USAGE` | its own functions and tables |
| schema `identity` | `USAGE` | the field clearing of CF4 — [Fact] today only `alphakolect_app` has it (`20261003000200:7`) |
| `audit.audit_events` | `SELECT`, `DELETE`, `INSERT` | eligibility and export; deletion by id; its #38 and #40 events |
| `audit.event_catalog` | `SELECT` | retention periods |
| `audit.purge_reservation` (one row, §8.6) | `SELECT`, `UPDATE` | the run-wide reservation (R43; `FOR NO KEY UPDATE NOWAIT` needs `UPDATE`) |
| `identity.sessions` | `SELECT (id, revoked_at, absolute_expires_at)`, `UPDATE (created_ip, user_agent)` | CF4 clearing |
| `identity.one_time_tokens` | `SELECT (id, created_at, consumed_at, expires_at)`, `UPDATE (requested_ip)` | CF4 clearing |

[Fact] No `identity` table has row-level security (RLS is enabled only on tenancy, ledger and audit tables,
`20260927000400`, `20261003000100:276`, `20261009000300:71,78`, `20261012000100:84`), so the column grants
above are the whole boundary there. On `audit.audit_events` its RLS policies allow `SELECT` and `DELETE` of rows
older than their retention period and `INSERT` of the tenant-less `platform.audit_purged` and
`platform.request_metadata_cleared` events only. **Tests:** the
purge succeeds end to end when its functions run as their owner, the purger (export, deletion, field clearing, #38 and #40);
with any one of the grants above removed in a scratch copy of the role, the step that needs it fails with
`insufficient_privilege`; and a test enumerates its privileges across every table, column, sequence, function and
schema and fails on anything not in the table.

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
independent of the permission catalog); it is listed with them so it is complete before P5.4. P5.8 keeps the audit
**reads** and the members and invitations list pagination (O9).

### P5.0 — Decisions freeze and ADR-16

- **Work:** write ADR-16 into `TARGET_ARCHITECTURE.md` (append; ADR-15 unchanged): the catalog (§6), classes and
  route map (§5), resolution and write-time re-check (§7), owner-only delegation (D5′), platform grants and the staff
  lifecycle (§7.4), audit classes and the nested-writer table (§8, §7.2), the D9 decisions and the retention design
  (§8.6), the containment switch and incident procedure (§11.1), and the **decision log** (§14, R26). Amend `RESTRUCTURING_MAP.md`: P5 exit criteria (§13); move "agents only record collections for assigned
  customers" into the P7/P8 rows verbatim (D1). Freeze the contracts of the new operations (§5).
- **Checks:** every one of the 44 operations is classified; no P7/P8 resource assumed; every **[Open]** item has an
  owner; **O7 resolved** (by D5′, §7.6); **O8 decided**
  (platform staff onboarding, §7.4) before the platform staff contracts are frozen; **O9 decided** (members and
  invitations pagination) so that P5.8's scope is fixed; **O3 decided** (owner-only, D8′; R28). **Neither audit-read contract is
  frozen in P5.0** (R24): their shared bounds are O4, which depends on a query-plan validation (§8.5) that needs
  representative data, so both are frozen together in P5.8 step 3. P5.8 cannot implement an audit-read endpoint whose
  contract is not frozen, and step 3 cannot happen while O3 or O4 is open.
- **Done when:** the owner has signed and dated the forms and returned the confirmation form (R33) — **done
  2026-10-12** (CF1–CF5, Mayowa Edward Fadahunsi); the ADR-16
  decision log (§14, R26) has a complete entry for O3, O7, O8 and O9, for D9, for CF3–CF5 and for the confirmation of the
  agreed positions, each with its true decision-maker (O4 is recorded at P5.8 step 2, D9 before P5.10); every row of §14 that these
  affect cites its entry; and the owner and the reviewer approve the **final** ADR-16 and this plan, each approval
  itself recorded with name and date. Editing the documents does not complete P5.0.

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
  every function with EXECUTE for `alphakolect_app`); the **execute-grant inventory test** of §9.1 (R31), started here
  and extended by every later package; catalog guard covers `role_permissions` automatically;
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
  missing/invalid declaration) — each `permission` endpoint also declares its branch scope (§7.6); **query-parameter validation** in `apps/api/src/platform/http/validate.ts` (contracts
  may now declare `query`; values are validated from the contract like bodies and path parameters, unknown parameters
  refused), the prerequisite for the paginated reads of P5.7 and P5.8.
- **Tests:** every operation declares exactly one valid class; unknown permission refused; route-parity asserts the
  authorization middleware is mounted for every `permission` endpoint and only there; no route public by omission;
  query parameters: valid values reach the handler typed, invalid or unknown ones are refused with 400 before any
  handler or database call, and a contract without `query` still receives none; oasdiff non-breaking.
- **Done when:** declarations are complete and machine-checked.

### P5.3a — Audit foundation (moved ahead of P5.4 in rev 10)

- **Migration:** `…_event_catalog` — the table `audit.event_catalog` (app `SELECT` only), seeded with **every pair
  written at this point** and each one's summary fields as written today ([Fact] inventory of §8.1, template-built
  identifiers included), and the validation trigger on `audit.audit_events`.
- **Work:** the event catalog with per-pair class, writer pattern and summary allowlist, its TypeScript mirror and
  the validation trigger (§8.1); `recordBestEffort` and the conversion of every A7 refusal path (§8.3); `mutateAudited` and the pattern-B
  conversion of every identity flow (§8.4) — except `complete_account_setup`'s re-specification, which needs the
  §7.2 footprint and `admit_invitation_locked` and is done in P5.5; the coverage and writer guards (§8.1).
- **Transitional writers, enumerated.** At this point the tenancy and platform pairs that §8.1 assigns to pattern A
  (#14 on the invitation-link path, #16–#20, #22–#29) are still written by P4's code — `recordWithin(tx)` in the same
  transaction as the definer call or direct write ([Fact] already atomic, §2; e.g. `merchant-settings.ts:79,114,140`,
  `memberships.ts:112`, `invitations.ts:94,142`, `merchant-lifecycle.ts:104,163`) — because their pattern-A functions arrive in P5.5.
  [Fact] The branch and role identifiers are built from a template (`merchant.${item}_created` / `_updated`,
  `merchant-settings.ts:109,133`), so the list names those call sites with the four identifiers they can produce; a
  template-built identifier anywhere else fails the writer guard. The coverage guard
  accepts exactly these pairs from exactly those call sites through a **closed transitional list** in the guard; P5.5
  empties the list and deletes it, and from then on the guard fails if it exists. No other pair may use it. New pairs
  (#21, #30–#40, `authz.denied`) are added to the catalog by the package that introduces their writer, together with
  that writer and its tests.
- **Tests:** every row of the §8.1 entry-point table for each entry point (unknown identifier, known event of another
  class — atomic and sensitive-read events through `recordBestEffort` — invalid outcome, disallowed and over-length
  summary field, storage failure), asserting the stored rows, the metric and the HTTP status of the request in hand;
  per atomic identity pair the co-commit and injected-rollback test of the coverage guard; the A7 paths keep their
  status when the best-effort insert fails; the writer-guard mutation tests (§8.1); the coverage guard in both
  directions over the pairs that exist at this point; secrets never stored (leak sweep); P4 member/invitation atomicity
  still holds; **the validation trigger rejects nothing legitimate** — every P1–P4 journey (the existing API suites)
  runs with the trigger in place and no validation error, and a raw insert of an unknown pair, an unknown summary field
  and an over-long value are each refused, as the app role and as the table owner; the TypeScript mirror equals the
  table.
- **Done when:** every audit writer in the code is one of the three entry points (or on the transitional list), and
  every identity security change commits with its event.

### P5.4 — Policy middleware; replace `requireOwner`

- **Code:** new `apps/api/src/platform/authorization.ts` (decision type, `authorize`); router mounts it from the
  registry; the 13 `requireOwner` call sites and both `ownerOrDenied` helpers are removed in favour of the declared
  permission; the decision takes an optional resource branch (§7.6, unit-tested with synthetic resources);
  `GET /v1/merchant/membership` returns effective permissions. Refusals by the middleware are recorded
  as `authz.denied` through `recordBestEffort` (P5.3a; §8.2a rule 6); the catalog gains that pair here.
- **Equivalence oracle:** with owners holding all merchant permissions and no staff grants, the P4 isolation matrix
  must produce identical results before and after.
- **Tests:** P4 matrix unchanged; source guard: no `kind === 'owner'` / `requireOwner` outside the authorization
  module; denial responses unchanged.
- **Done when:** the API enforces declarations with zero behaviour change for existing actors.

### P5.5 — Database functions aligned (and direct writes moved)

- **Migrations:** `CREATE OR REPLACE` of `list_members`, `update_membership`, `issue_invitation`,
  `revoke_invitation` (owner-only per D5′, §7.3, under the §7.2 locks), `set_merchant_status`, `transfer_ownership`
  (reserved platform permissions); **one enforcement migration** that creates the definer writers for branches, roles
  and merchant profile **and revokes the app's direct write grants on them in the same transaction** (§7.2); the app
  switches to the writers in the same commit; `bootstrap_super_admin` replaced to keep the account separation (§7.4).
  Privileged functions write their audit rows themselves (§8.5). The
  **containment switch** of §11.1 (table, operator function, event #39) and its reads in the resolver and every
  re-check — before P5.6 makes the first grant possible.
- **Tests:** direct calls with/without authority; every member and invitation write by a staff member refused, even
  for a staff member holding every grantable permission (fixture), and seeding `members.manage` or `invitations.manage`
  into a role refused by the grant table's CHECK (reserved); owner untouchable; archived role refused; forged actor fields impossible (no parameter exists); rollback
  when the in-function audit insert fails; concurrency per §7.2; grants and pinned `search_path` guard (inventory test
  over every definer); **mixed-version test** — the previous commit's direct-write repository code fails with
  `insufficient_privilege` against the migrated database, for every former direct write; **lock-order guard** (§7.2)
  green for every planned footprint, with its baseline control, its five mutation self-tests and its three
  fail-closed self-tests (`EXECUTE`, unqualified call, unclassified reachable function); two-connection tests (a),
  (b), (d) and (f)–(j) of §7.2, 50 runs each, no `40P01` ((c) and (k) need the role-permission writer and run in
  P5.6; (e) needs platform grants and reads and runs in P5.7); the §8.2a contract tests; **invitation-acceptance attribution** on both paths —
  the `auth.invitation_accepted` row names the invitation's identity, `NULL` audience, the new membership, the
  invitation's merchant and the invitation, and a call to `accept_invitation` with a different `p_identity_id` is
  refused and writes nothing; the **containment tests of §11.1**; the **account-separation tests of §7.4** (CF3 and the bootstrap change); the **nested-writer tests of §7.2 (R27)** for account setup with zero, one and two
  invitations, including the rollback cases and the two guard self-tests. The sensitive-read tests (R16, R18, R19) run where the read functions are built — P5.7
  (#35, #36) and P5.8 (#33, #34).
- **Order inside P5.5 (implementability).** Each step is its own commit(s) with the local gate green:
  (1) the lock helpers and the lock-order guard, the guard first in **report mode** (R34): every check runs; a finding
  that is an entry of the baseline reconciliation table is reported and tolerated, **any other finding fails at once**
  (so no new violation can enter), and a tolerated entry that no longer occurs fails too until it is deleted from the
  tolerated list in the same commit (so the list only shrinks);
  (2) conversion of the existing functions to their footprints (`FOR NO KEY UPDATE`, the reordered
  `set_merchant_status`, `issue_invitation`, `complete_account_setup`), with test (h) recorded before and after;
  (3) authority from the resolver in the member, invitation, lifecycle and transfer functions (owner-only per D5′,
  reserved platform permissions) and the SQL authority guard; (4) the enforcement migration (writers created, direct
  grants revoked) with the app switch and the mixed-version test in the same commit; (5) the account-setup
  re-specification with the nested-writer table (R27), the account-separation check in admission and the replaced
  `bootstrap_super_admin` (CF3, §7.4); (6) the
  containment switch (§11.1); (7) the transitional-writer gate (R32). **Enforcing mode** is entered when, and only
  when, the tolerated list is empty and every planned-footprint entry owned by P5.5 exists and conforms; the tolerance
  mechanism is then deleted from the guard (as the transitional list is, R32), and a test fails if it reappears. P5.5
  cannot close in report mode.
- **Test fixtures for staff authority.** No function can grant a staff or platform-staff permission before P5.6/P5.7
  (§11), so the P5.5 tests that need a staff member holding a permission (a staff branch write racing the owner,
  revoke-vs-write) seed `role_permissions` rows **as the table owner in the throwaway test database**, exactly as the
  P5.1 constraint tests do. Fixtures never use an app-reachable path, and P5.6 repeats those tests with grants set
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
  database agree in the matrix; and **the transitional-writer gate (R32)** holds, each item shown by a test, not by a
  statement: (1) the guard's transitional list is empty and deleted; (2) no `recordWithin` call remains in
  `apps/api/src` and the method is removed from `AuditLog` (source guard); (3) a mutation that re-adds a
  `recordWithin` call for a former transitional pair fails the writer and coverage guards; (4) every pair that was on
  the list has exactly one designated pattern-A writer, with its co-commit and injected-rollback test green; (5) the full
  gate passes after the removal.

### P5.6 — Role permission management

- **Migration:** `tenancy.set_role_permissions(session, role, permissions[])` — footprint per §7.2 (merchant S →
  owner NKU → role NKU → grant rows), owner authority re-checked under the locks, catalog scope/grantability validated,
  `merchant.role_permissions_set` written in the function (pattern A).
- **Contracts/code:** `GET /v1/merchant/permissions`, `PUT /v1/merchant/roles/{roleId}/permissions` (owner), role
  responses include their permission set; archived roles keep their set (inert, D6).
- **Tests:** owner sets permissions; staff with any permission set cannot (reserved); unknown/platform/reserved
  permission refused by the database — including `members.manage`, `invitations.manage` and `audit.read` (reserved,
  D5′, D8′); concurrent edit vs assignment per §7.2 — two-connection tests **(c)** and **(k)**, 50 runs each, no
  `40P01`; the P5.5 staff-authority tests repeated with grants set through `set_role_permissions` instead of fixtures; cross-tenant role ids ⇒ 404; every change audited atomically with old/new permission lists
  (allowlisted).
- **Done when:** role management cannot escalate.

### P5.7 — Platform staff

- **Migrations:** `…_platform_staff_eligibility` (`eligible_memberships` admits active platform memberships of every
  role; the `super_admin` literal of the SQL authority guard's temporary allowance disappears here);
  `identity.set_platform_grants(session, membership, permissions[])`, `identity.create_platform_staff` and the
  deactivate and reactivate functions (super admin; footprints of §7.2; target `FOR NO KEY UPDATE`, §7.5).
- **Contracts/code:** platform staff management endpoints (create, deactivate, reactivate, list, set grants);
  effective permissions on `GET /v1/auth/session` (§5); `GET /v1/platform/merchants` through
  `tenancy.platform_list_merchants` and `GET /v1/platform/merchants/{id}/members` through
  `tenancy.platform_list_merchant_members` (closes P4 limitation 1); each designated function writes its one read event
  (#35, #36) in the transaction that returns the rows. **Both lists are paginated from the start** (a cross-tenant list
  of every merchant cannot be unbounded): at most 100 rows per page, ordered `created_at DESC, id DESC`, with the cursor
  rules of the §8.5 pagination contract (position only, bound by digest to the request's filters, `400 INVALID_CURSOR`
  on mismatch, strict tuple continuation); every page is its own sensitive read with its own event. Supporting indexes
  are chosen from recorded query plans on seeded data, as in §8.5.
- **Staff lifecycle** per §7.4: create (passwordless identity, membership without grants, setup token), deactivate
  (sessions revoked, grants removed), and reactivate (O8(b)); an existing email refused (O8(a)).
- **Tests:** creation → setup link → password → forced MFA enrolment → `full` session with no grants; the role label
  grants nothing; creating with `super_admin` refused; an email with an existing identity refused, with nothing
  created and a denial recorded (O8(a)); concurrent creation with the same email: exactly one succeeds, no `40P01`;
  deactivation revokes sessions and removes grants; reactivation starts with no grants and writes #37; staff without grants:
  sign-in + MFA works, nothing else; one grant ⇒ exactly that; revoked grant ⇒ next
  request; lifecycle, transfer, staff management refused for staff even if a grant is attempted (reserved); super
  admin unchanged; MFA enrolment/verification unchanged for staff; reads audited, refused if the audit insert fails;
  **two-connection races in both orders** (revoke grant vs protected operation; deactivate staff vs protected
  operation) with the outcomes stated in §7.5, including two-connection test **(e)** of §7.2 (50 runs, no `40P01`); a
  grant to one platform membership never authorizes another membership of the same identity; **sensitive reads #35 and
  #36 (R16, R18)** — each designated function writes exactly one event per successful call, in the same transaction as
  the rows it returns, the repository writes none, and an injected failure of that insert returns no rows; a scratch
  second function that writes `platform.merchant_list_read` fails the writer guard; **pagination** — first and
  continuation pages, a page boundary inside a group of equal `created_at` values (no row lost or repeated), and a
  cursor reused with different filters refused; the **read-consistency tests (a)–(d) of §7.2** for both lists (R25).
- **Done when:** platform staff have exactly their grants; the session endpoint reports them; the staff lifecycle and
  the platform lists behave as specified.

### P5.8 — Audit reads (and O9 list pagination)

- **Work:** the audit **reads** — merchant and platform audit reads (§8.5) with their designated functions (#33,
  #34), the IP/user-agent visibility of §8.6; the **retention purge** of §8.6 (#38, #40) — its five functions, the reservation and the operator
  command with its export and failure semantics; indexes; the D9 written policy
  drafted from the decisions (§8.6); cursor pagination (O9, decided) of the members and invitations lists
  (invitations defaulting to open ones) with first-page, continuation, equal-`created_at` boundary and mismatched-cursor
  tests. The audit foundation is P5.3a.
- **Order inside P5.8 (O4):** (1) **validation spike** — on a throwaway database seeded per §8.5, run
  `EXPLAIN (ANALYZE, BUFFERS)` for every candidate query shape and index; nothing from the spike is committed except the
  recorded plans, dataset parameters and the seeding script used; (2) the **owner decides O4** on that evidence (page
  size, window, filters); (3) **both audit-read contracts** (merchant and platform, with the O4 bounds and the O3
  visibility rules already decided) are **frozen as an ADR-16 addendum**, and the reviewer confirms it; (4) only then the migrations
  (indexes, designated functions) and the endpoints are written. The spike covers the query shapes of both reads.
- **Tests:** the coverage guard of §8.1 now complete in both directions (every catalog pair, including #33/#34, has
  its writer and tests); secrets never stored (leak sweep extended to the audit-read journeys); append-only unchanged **except** the purge
  path, with the §8.6 retention tests; IP address and user agent returned to the business owner for their own people's
  events, never for platform actors' events, to the super admin, and never to platform staff;
  audit reads tenant-isolated, bounded, themselves audited — **sensitive reads #33 and #34 (R16, R18)** with the same
  single-writer, same-transaction and injected-failure tests as #35/#36; **merchant isolation of definer reads (R19)** —
  calling `audit.read_merchant_events` **directly** with a valid session of merchant A returns none of merchant B's
  events, including with a forged cursor positioned on one of B's events and an actor filter naming one of B's
  members; the same attempts through `GET /v1/merchant/audit-events` with forged ids and cursors; both run with the
  real function owner and as `alphakolect_app`, so they exercise the RLS exemption that makes the explicit predicate
  necessary; **pagination (R21)** — first page,
  continuation pages, a group of same-timestamp events split across a page boundary (no row lost or repeated), actor
  filtering, merchant filtering (platform), an empty window, a window over the O4 maximum refused **on both endpoints**, and a cursor reused with a
  different window or filter refused with `400 INVALID_CURSOR`; the **read-consistency tests (a)–(e) of §7.2** (test (e): traversal against a concurrent
  purge, R35) for
  both audit reads and, with O9, the members and invitations lists (R25); the §8.5 query-plan validation recorded on
  representative data.
- **Done when:** every event class behaves as §8.2 states, proven by failure injection; both audit reads and (O9) the
  members and invitations lists are paginated as specified; the retention purge passes its §8.6 tests; the D9 written
  policy is drafted from the decisions and handed to the owner for approval (approved before P5.10).

### P5.9 — Authorization matrix and regression gate

- **Work:** extend `isolation-matrix.test.ts`: expected results come from registry declarations (the
  `^FORBIDDEN` description regex is removed); actors = anonymous, invalid session, owner, staff with / without the
  permission, staff attempting a member or invitation write (reserved), archived-role staff, branch-restricted staff, staff restricted to an archived branch
  (§7.6), agent, super admin, platform staff with none / one / revoked
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
  gitleaks over full history; the three review documents are already committed on this branch as planning records —
  whether they stay in the history that is merged or are removed before the merge is the **owner's choice**.
- **Done when:** §13 checklist complete; owner approves; CI runs only when the owner pushes.

## 11. Rollout and rollback (no fail-open)

1. **P5.1–P5.2 (expand):** additive tables and functions. From P5.2 the app resolves effective permissions on every
   request, but nothing enforces them until P5.4 — `requireOwner` and the P4 SQL checks still decide; owners and
   super admins hold fixed sets and no grant rows exist ⇒ **no access change**. A resolver failure is a 500 (§4
   invariant 7), never an allow.
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
5. **P5.6–P5.8:** new capabilities (role grants, platform staff, audit reads) start empty: **no step expands access
   automatically** — access grows only when an owner or super admin grants it. That is not a claim that nothing can
   over-grant: a defect in a grant writer, the resolver or a re-check could give access that was never intended. §11.1
   is the procedure for that case.
6. **Rollback:** forward-only. A defect that **denies** too much is fixed forward. A defect that **grants** too much is
   contained first (§11.1), then fixed forward. **Never** by running an application version older than the enforcement
   boundary (P5.5): the database refuses its direct writes (the mixed-version test), and the older database functions
   are not restored. Each migration is tested from zero and on top of the previous state.

### 11.1 Over-authorization incident procedure (R30)

**Containment switch ([Plan], built in P5.5, before any grant can exist).** A one-row table
`util.authorization_containment (merchant_grants_suspended boolean, platform_grants_suspended boolean)`, read by the
resolver (§7.1) and by every write-time re-check (`assert_authority` and the definer functions). While a flag is set,
the resolver and the re-checks **ignore every grant row** of that kind: staff hold no merchant permission, platform
staff no platform permission. The fixed sets of the owner and the super admin are unaffected, so each business and
the platform remain administrable. It is set and cleared only by `util.set_authorization_containment(merchant,
platform, reason)` — operator-only (no app grant, §9.1), atomic event #39 `platform.authorization_containment_set`
(pattern A, operator actor `NULL`, summary: both flags and the reason). It takes effect on the next request, because
nothing caches authority (§4 invariant 2), and on any write already waiting for its re-check.

**Procedure.**

1. **Contain.** If the defect is in one grant, the owner or super admin removes it through the normal writers
   (audited). If grants, the resolver or a writer cannot be trusted, the operator sets the matching containment flag.
   An affected person's sessions are ended by deactivating their membership through the normal writers (owner for
   staff, super admin for platform staff), which revokes their sessions (§7.2 footprints, category 10); they are
   reactivated after reconciliation (platform staff come back with no grants, O8(b)). No new session tool is needed.
2. **Assess.** The audit record shows what the excess access was used for: every privileged write and grant change has
   its atomic event (the coverage guard), every sensitive read its read event, and every refusal its best-effort event.
3. **Reconcile.** The owner (merchant grants) or super admin (platform grants) confirms the intended grants; every
   other grant is removed through the writers.
4. **Correct forward.** A regression test reproduces the defect and fails before the fix; the fix ships as new code and,
   where needed, a new forward migration.
5. **Verify and lift.** The regression test, the authorization matrix (P5.9) and the full gate pass; the operator
   clears the flag (event #39); the incident is recorded in `docs/security/` (TARGET_ARCHITECTURE §21: incident
   records).

**Tests (P5.5):** with each flag set, a staff member (or platform staff member) with grants resolves to no permission
on the next request and a write already waiting for its re-check is refused; the owner and the super admin are
unaffected; clearing the flag restores the grants; the app role cannot execute the switch or write the table; the
event commits with the change and an injected failure of its insert leaves the flags unchanged.

## 12. Approval sequence

Draft (this document) → owner review → independent reviewer challenge → disagreements resolved and recorded here →
**owner's explicit implementation approval** → P5.0 begins. [Fact] On the confirmation form (2026-10-12) the owner
wrote: "yes, build it, but wait for my final go-ahead after the reviewer approves the plan". That is **not** yet the
approval: it is recorded as his intention, and implementation waits for his final go-ahead given after the reviewer's
final approval. Until then **no P5 implementation begins**: no
application code, migration or test is written or committed for P5. **Planning and review records** — this plan, the
audit report, the review handoff, the evidence pack, owner questionnaires and the decision records of §14 — may be
committed to this branch as they are written (R23); they change no behaviour. Nothing is pushed or merged without the
owner, in either case.

## 13. P5 exit criteria (proposed for RESTRUCTURING_MAP)

1. Every endpoint declares one authorization class; the router refuses undeclared endpoints.
2. The registry-driven authorization matrix is green for every endpoint and actor in P5.9.
3. API and database agree; no hard-coded owner/super-admin authority remains outside the resolver (source + SQL guards).
4. Privileged writes re-check authority in their own transaction; the revoke-vs-write race is tested; the lock-order
   guard is green; the containment switch of §11.1 works and is operator-only.
5. Role, member, invitation and audit-read management are owner-only and enforced in the database (D5, D5′, D8′);
   escalation tests green.
6. Platform staff hold exactly their membership grants; reserved powers are super-admin only; the staff lifecycle
   (create, deactivate, reactivate) and the account separation of §7.4 are tested.
7. Audit: closed catalog with allowlists; atomic / best-effort / sensitive-read classes proven by failure injection;
   A7 resolved; audit reads isolated and audited; every paginated read meets the read-consistency guarantees of §7.2
   (one statement per page, immutable keys, exactly-once across pages for rows committed before the first page and
   still present when their page is read), proven by the concurrency tests including the concurrent purge (R25, R35).
8. All P1–P4 guards, the tenant-isolation matrix and the leak sweep stay green; every new guard proven by mutation.
9. An owner-approved written D9 policy (§8.6) exists, matching the decisions recorded there, and the retention purge
   is built and tested.
10. Assigned-customer authorization recorded as a P7/P8 exit criterion (D1).
11. Every `permission` endpoint declares its branch scope; branch-restricted and archived-branch staff are covered by
    the matrix; P5 claims no end-to-end branch isolation for resources that do not exist yet (D7, §7.6).

## 14. Open items for the reviewer and owner

**Decision records (R26).** A decision exists only when it is recorded, not when this document is edited. Each owner
decision gets an entry in the **ADR-16 decision log** with: the item (e.g. O7); the option selected, quoting the
owner's answer; the decision-maker; the date; the source (for the owner's answers,
`docs/business/P5_OWNER_QUESTIONS.md`, answered in the owner's words as in the earlier business questionnaires); the
plan sections and contracts it affects; and the commit that applies it to this plan. Only then does the item's row
below change to **DECIDED**, citing that entry. The positions agreed "unless the owner objects" (D2, D3, D6–D8,
D10–D12, §3) are recorded the same way — as the owner's explicit confirmation, or as "no objection" with its date.
Questionnaire mapping (confirmation form: CF1 → every entry, CF2 → D9 retention and copy, CF3 → §7.4, CF4 → §8.6,
CF5 → §8.5): A1 → O7; A2 → O3; B1 → O8(a); B2 → O8(b); B3 → the owner's preference for O4 (decided at P5.8
step 2 on the spike's evidence); C1 → O9; Part D → the D9 policy (§8.6); E1–E8 → D2, D3, D6, D7, D8, D10, D11, D12.

**Decision log (interim — moved verbatim into ADR-16 at P5.0).** Source for every entry: the owner's answers in
`docs/business/P5_OWNER_QUESTIONS.md`, relayed by Olamide Fadahunsi on 2026-10-11 (the form's "Answered by" and
"Date" lines are blank and are requested again in `docs/business/P5_OWNER_FOLLOWUP.md`), and the follow-up answers in
that file (F1–F4), relayed on 2026-10-12, with two clarifications of F4 given the same day by the owner's
representative, Olamide Fadahunsi. The commit applying each entry is recorded when the entry is committed.

**Provenance (R33).** The owner wrote the answers on the two forms; Olamide Fadahunsi relayed them, and himself gave
the two F4 clarifications. A relayed or representative answer is recorded as such and is **not** treated as the
owner's own until the owner confirms it in writing: the confirmation form `docs/business/P5_OWNER_CONFIRMATION.md`
asks him to sign and date the earlier forms, to confirm the two clarifications, and to confirm the three rev-13
interpretations (CF3–CF5). **Returned signed on 2026-10-12**: every relayed answer is now the owner's own. Each entry below records its decision-maker; in ADR-16 every entry carries the
decision-maker, the date, the source, the selected option, the affected contracts and the applying commit.

| Item | Owner's answer (quoted or exact) | Decision-maker and date | Status | Affects |
|---|---|---|---|---|
| O8(a) | B1: "Refuse. Ask them for a different email address, so their platform account is completely separate from any business account." | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | **Decided** | §7.4; P5.7 |
| O8(b) | B2: "Switch the same account back on, with no permissions. You then give them only what they need again." | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | **Decided** | §7.4, §7.2 footprints, §8.1 #37; P5.7 |
| O9 | C1: "Now, as part of this stage." | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | **Decided** | §1.1; P5.8 |
| O4 (preference only) | B3: "One month at a time is fine. If needed, we can implement a feature to allow searching longer periods in the future." | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | Preference recorded; O4 itself is decided at P5.8 step 2 on the spike's evidence | §8.5; P5.8 |
| O3 | A2a–c, F2: "Only the owner, always. The owner cannot give this to any staff member." A2b: refused attempts shown to the owner only. A2c: the owner can see one person's actions | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | **Decided** | §6, §8.5; P5.8 |
| O7, D5 → D5′ | A1 and F1a: inviting staff or agents and cancelling invitations, changing a staff member's role or branch, and switching a staff member or agent off or on are owner-only ("All 3"); F1b: "The owner may choose one branch or all branches." | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | **Decided** — supersedes D5's staff-delegation clause; O7 no longer arises | §3, §4, §5, §6, §7.3, §7.6; P5.5, P5.6, P5.9 |
| D9 purpose | D1: "Investigate break-ins and suspicious activity, and settling disputes." | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | **Decided** | §8.6 |
| D9 retention | D3: "1 year", replaced by F4: "Delete the whole entry after two years." Clarified 2026-10-12: every entry, IP address and user agent included, is kept two years and then deleted in full | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | **Decided** — confirmed as CF2a ("Yes, two years for everything") | §8.6, #38; P5.8 |
| D9 existing records | D5: the rule applies to records already stored | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | **Decided** | §8.6 |
| D9 access | D2 and F3: "Each business owner only, for their own business only and me. The AlphaKolect team cannot see this information." | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | **Decided** | §8.5, §8.6; P5.8 |
| D9 copy before deletion | F4: "The owner may ask for a record of the deleted entries, but the system will not keep them." Clarified 2026-10-12: a copy of the entries about to be deleted, handed over as a file on request; no copy kept | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | **Decided** — confirmed as CF2b ("may be sent as a report, but the system will not keep a copy") | §8.6; P5.8 |
| D2, D3, D6, D7, D10, D11, D12 | E1–E4, E6–E8: "Agreed." | Mayowa Edward Fadahunsi (owner), E1–E8; signed CF1 2026-10-12 | **Confirmed** | §3 |
| D8 → D8′ | E5 "Agreed", replaced by F2: "Only the owner, always." | Mayowa Edward Fadahunsi (owner), forms 2026-10-11/12; signed CF1 2026-10-12 | **Decided** — supersedes D8 | §3, §4, §6, §8.5 |
| All answers above | Written by the owner on the two forms, relayed by Olamide Fadahunsi; "Answered by"/"Date" blank | Mayowa Edward Fadahunsi (owner), confirmation form 2026-10-12 | **Confirmed** — CF1 signed: "Yes, I confirm both sets of answers as written." (The two forms' own "Answered by" lines stay blank; this signature covers them.) | all entries |
| CF3 | Separation of platform and business accounts in the invitation direction (§7.4) | Mayowa Edward Fadahunsi (owner), confirmation form 2026-10-12 | **Decided** — "Yes, keep them apart both ways." (§7.4, including the bootstrap change found in rev 14) | §7.4; P5.5 |
| CF4 | Two-year rule for IP/user agent in sessions and one-time tokens (§8.6) | Mayowa Edward Fadahunsi (owner), confirmation form 2026-10-12 | **Decided** — "Yes, two years." | §8.6, §9.1 purger grants; P5.8 |
| CF5 | Platform actors' IP/user agent hidden from business owners (§8.5) | Mayowa Edward Fadahunsi (owner), confirmation form 2026-10-12 | **Decided** — "Show your team's action, but not your team's internet address or device." | §8.5; P5.8 |
| Implementation approval (§12) | Conditional go-ahead line on the confirmation form | Mayowa Edward Fadahunsi (owner), confirmation form 2026-10-12 | **Not yet given** — the owner wrote: "yes, build it, but wait for my final go-ahead after the reviewer approves the plan" | §12 |

**Every owner decision is answered and confirmed** (`docs/business/P5_OWNER_CONFIRMATION.md`, signed by Mayowa Edward
Fadahunsi on 2026-10-12). What remains is not a decision but two approvals: the reviewer's final verdict on the
complete document, then the owner's final go-ahead (§12). O4 is decided at P5.8 step 2 on measured evidence, by
design. P5.0 then moves this log into ADR-16, adding the applying commit of each entry.

| # | Item | Proposed position |
|---|---|---|
| O1 | Move branch/role/profile writes into definer functions and revoke direct grants (§7.2) | adopt (owner supports), with the single-migration enforcement boundary of §7.2 |
| O2 | Exact contracts of the new endpoints (§5) | frozen in P5.0 |
| O3 | What the business activity record shows | **DECIDED (2026-10-12; decision log, §14; R28):** merchant audit access is **owner-only** (`merchant.audit.read` reserved, D8′) — there is no staff visibility to decide; the owner sees every event of their own business, including refused attempts, can filter by person, and sees each event's allowlisted summary plus the IP address and user agent of their own business's people (§8.5, §8.6); never another business's events, credentials, tokens or request bodies. **Nothing in O3 is outstanding.** The page size and window are O4's (R24), frozen with this contract at P5.8 step 3 |
| O4 | Audit-read bounds — **both** the merchant and the platform audit read (R24) | proposal (reviewer recommends approving, subject to validation; **owner's preference, B3: one month at a time is fine**): ≤ 100 events per page; required time window ≤ 31 days; **filter by actor** (the legacy per-staff log view, §15); stable ordering and cursor on `(occurred_at, id)` for equal timestamps; the cursor bound to the request's window and filters and unable to widen or leave the window (§8.5 pagination contract). **Prerequisite:** the index and query-plan validation of §8.5 on representative data (R21), run as the first step of P5.8. Then **owner decision required before the platform audit-read contract is frozen** (ADR-16 addendum, P5.8 step 3 — not at P5.0); no default is implemented |
| O5 | D9 IP/user-agent policy | **DECIDED (2026-10-11/12; decision log):** purpose, access (business owners for their own business, the super admin; never platform staff), two-year retention with whole-entry deletion, existing records included, copy on request (§8.6). The owner-approved written policy remains a P5 exit criterion |
| O6 | Class of `auth.password_forgot` and `auth.verification_resend` successes (§8.1) | **DECIDED by the owner (2026-10-11): best effort.** Conditions: the success outcome means only that the request was processed for link issuance, subject to eligibility — never that a link was delivered, opened or used; an audit failure never changes the response; the public response never reveals whether an account exists (unchanged P3 behaviour, ADR-14 D12 — anti-enumeration); the eventual reset, verification or setup keeps its atomic event (#2, #9, #10). |
| O7 | Branch ceiling for delegation | **RESOLVED by D5′ (2026-10-12; decision log):** only the owner assigns or invites, choosing one branch or all (F1b), so no branch ceiling is needed (§7.6) |
| O8 | Platform staff onboarding (§7.4) | **DECIDED by the owner (2026-10-11; decision log, §14): (a) an email that already has an identity is refused; (b) reactivation restores the membership with no grants (event #37).** |
| O9 | Members and invitations list pagination (P4 closure review (D); P4 limitation (6)) | **DECIDED by the owner (2026-10-11; decision log, §14): in P5.8** — cursor pagination on `(created_at, id)` for `GET /v1/merchant/members` and `GET /v1/merchant/invitations`, invitations defaulting to open ones, P5.3 query validation and the §8.5 cursor rules; additive |

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
  (`/superAdmin/logs/:staffId`). P5's platform audit read should therefore support filtering by actor — part of the §8.5
  pagination contract, with its index chosen from measured query plans (input to O4).
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
| 16 | 2026-10-12 | Review of rev 15 (approve with required revisions). Its findings 1–4 are recorded as **R38–R41**: **(R38)** the purge deletes by exact id — `purge_candidates` is paged by id and returns ids, `purge_expired_events` takes one verified page's ids and digest, re-reads those immutable rows and deletes `WHERE id = ANY(ids)`, so an eligible event that commits late (its `occurred_at` is its transaction's start) is never deleted unexported; late-commit race test; **(R39)** the purger's privileges as one exhaustive table, adding the missing `USAGE ON SCHEMA identity` (today granted only to the app, `20261003000200:7`), the run-lock table and column-level grants; **(R40)** the purge inside the global lock order with no exemption: a category-0 run lock taken `NOWAIT`, audit deletes that nothing else can lock, and field clearing in its own function, tokens (5) before sessions (10), `SKIP LOCKED` — request paths can hold expired, unrevoked sessions (revocations match `revoked_at IS NULL`) — so the purge never waits and cannot join a deadlock; the clearing writes its own event #40 so #38 keeps one writer; **(R41)** "two years" means calendar years, `interval '2 years'`, defined once as `audit.d9_retention()`, with `TimeZone = 'UTC'` pinned and leap-day, boundary and time-zone tests. Self-review: a rev-15 test that expected late rows to make the purge raise corrected; L4 and the D9 summary aligned. No owner question arose. |
| 15 | 2026-10-12 | Final review of rev 14 (approve with required revisions). Its R1–R4 are recorded as **R34–R37**: **(R34)** one baseline reconciliation table — L1 lock mode in 8 functions (10 clauses, the three P3 functions needing only the mode change), category order in 3 functions (only `set_merchant_status` in both), planned footprint and authority in 8 functions — used by the baseline control ("exactly these entries") and by report mode (baseline entries tolerated, any other finding fails, vanished entries must be removed); enforcing mode defined (empty tolerated list, every P5.5 footprint conforming, tolerance mechanism deleted); **(R35)** exactly-once across pages scoped to rows still present when their page is read; a purged row is missing, never repeated, and a cursor whose row was purged still continues; concurrency test (e); **(R36)** the purge split into `purge_candidates` and `purge_expired_events` with eligibility as of a fixed `p_as_of` (never in the future); a requested report is written, flushed, read back and verified against the database's digest before any deletion, and deletion happens only if the eligible set still has that exact count and digest — every failure before or during deletion leaves all rows in place; failure tests for each case; **(R37)** exact eligibility for clearing session and token fields (sessions ended — revoked or absolutely expired — before the cutoff; tokens sent before the cutoff and consumed or expired), with tests over active, ended, recent and old rows. Self-review: the live token-lifetime citation corrected; the report file format fixed to the database's canonical row text so the digest is reproducible; the purger's RLS also allows `SELECT`; why `purge_candidates` writes no event. No owner question arose. |
| 14 | 2026-10-12 | Owner confirmation recorded (`docs/business/P5_OWNER_CONFIRMATION.md`, signed by Mayowa Edward Fadahunsi): **CF1** both earlier forms confirmed as written (their blank "Answered by" lines covered by this signature); **CF2a/b** two years for everything, and a copy of the entries to be deleted sent as a report with no copy kept; **CF3** platform and business accounts apart both ways; **CF4** the two-year rule for IP/user agent in sessions and one-time tokens; **CF5** platform actors' IP/user agent hidden from businesses. All fallback text removed; the decision log gains a decision-maker-and-date column. The owner's go-ahead line ("yes, build it, but wait for my final go-ahead after the reviewer approves the plan") is recorded in §12 as his intention, **not** as implementation approval. **Self-review finding:** `bootstrap_super_admin` reuses an existing identity, so it could make a business account a super admin and break CF3; P5.5 replaces it to lock the identity and refuse one with a merchant membership, the migration refuses pre-existing mixed identities, admission and bootstrap serialize on the identity row (two-connection test), and bootstrap gets a planned footprint. A rev-13 rename had mislabelled the O9 answer as CF1; corrected to C1. |
| 13 | 2026-10-12 | Independent review of rev 12 (not approved as-is; direction approved). Its R1–R7 are recorded as **R27–R33** (the earlier R1–R7 are taken): **(R27)** account setup's nested pattern-A events inside its pattern-B transaction are permitted only through one nested-writer table read by the classifier, writer guard and coverage guard, with zero/one/two-invitation and rollback tests and two guard self-tests; **(R28)** O3 reconciled — owner-only, nothing outstanding (rev 12 had overwritten the decision-log row instead of the open-item row); **(R29)** §13 item 11 no longer asks for a delegation decision; §7.6 history condensed; **(R30)** rollout no longer claims nothing can over-grant: "no automatic expansion", a containment switch (operator-only, event #39) and a five-step over-authorization procedure (§11.1); **(R31)** execute-grant exceptions and an inventory test; purger role privileges enumerated and tested; **(R32)** the transitional-writer removal is a five-part tested gate for P5.5; **(R33)** provenance of relayed answers recorded; owner confirmation form `P5_OWNER_CONFIRMATION.md` (CF1–CF5) added. **Self-review findings fixed:** the event catalog moves into the database with a validation trigger, so the §8.1 behaviour table holds at run time for SQL writers too; footprints no longer lock the actor's role for owner-only operations; L1/L4 and the guard account for P5's deletes (grant rows, purge); the stale staff-vs-staff text and the "audit endpoint opened to staff" text corrected; `platform.ownership_transferred` named correctly; template-built branch/role identifiers named in the transitional list; inventory rows ordered, #39 added; the purge's effect on the exactly-once pagination guarantee stated; three interpretations put to the owner with fallbacks — separation both ways (CF3), sign-in IP retention (CF4), platform actors' IP hidden from businesses (CF5). **Self-review cycles 2–4:** P5.3a gains its migration and a seed of every current pair (no legitimate journey rejected); P5.5 tests list containment and separation, a self-contradictory seed test fixed, and an explicit seven-step internal order with the lock-order guard in report mode until it closes; P5.0's ADR-16 content and P5.1's execute-grant test completed; P5.7 lists the session-permissions field and every staff function; §11 step 1 corrected (P5.2 resolves but does not enforce); the incident procedure ends sessions through existing deactivation instead of an unspecified tool; the validation trigger runs as definer; denial events carry the actor's business; retention is a per-pair catalog value read by an argument-free purge; the exported copy's handling is part of the D9 policy; the confirmation items are named CF1–CF5 (C1 was already the O9 question). |
| 12 | 2026-10-12 | Owner's answers recorded (`docs/business/P5_OWNER_QUESTIONS.md`, `P5_OWNER_FOLLOWUP.md`; two F4 clarifications from the owner's representative): **D5′** — inviting, cancelling invitations, changing a member's role or branch and (de)activating members are owner-only; `merchant.members.manage` and `merchant.invitations.manage` become reserved, the delegation ceiling (§7.3) and the branch ceiling (O7) are not built and are kept as superseded history; the owner may give one branch or all (T7 unchanged); **D8′** — the business activity record is owner-only (`merchant.audit.read` reserved), with refused attempts and filtering by person (O3); **O8** — existing email refused, reactivation with no grants (new atomic event #37); **O9** — members and invitations pagination in P5.8; **D9** — purpose, visibility (business owners for their own business, the super admin, never platform staff; platform actors' IP/user agent hidden from businesses), two-year retention with whole-entry deletion including existing records, copy on request; the controlled purge exception to append-only (dedicated role, age enforced by the trigger, operator-only execution, summary event #38). Test (b) of §7.2 recast (staff no longer act on each other). Decision log in §14 complete; O4's owner preference recorded. Stale references fixed (labels point to §14; scope line). |
| 11 | 2026-10-11 | Independent review of rev 10 (conditional approval of direction; not implementation authorization): **(R23)** the approval gate distinguishes implementation (no P5 code, migration or test before approval) from planning and review records, which may be committed; **(R24)** one set of audit-read bounds (O4) for both the merchant and the platform audit read, O3 limited to visibility, and both contracts frozen together in P5.8 step 3; **(R25)** read consistency stated per paginated read as an acceptance criterion — authority locked to commit, one statement per page, exactly-once across pages for rows committed before the first page (immutable keys), no assumption that authority locks freeze the list — with concurrency tests (a)–(d) in P5.7/P5.8 and exit criterion 7; **(R26)** decisions exist only as dated ADR-16 decision-log entries (option, decision-maker, date, source, affected sections, applying commit), and P5.0 is done only when the log and the final approvals are recorded. Owner questionnaire `docs/business/P5_OWNER_QUESTIONS.md` added and mapped to O3, O4 (preference), O7, O8, O9, D9 and the agreed positions. Reviewer recommendations (approve O3, O7, O8, O9; O4 after the spike; D9 policy before closure) noted; they remain the owner's decisions. |
| 10 | 2026-10-11 | Completeness and placement pass at the owner's request (every P5 obligation accounted for and placed where its dependencies exist). **Placement:** the audit foundation (catalog, `recordBestEffort`, `mutateAudited`, A7, pattern-B identity flows, coverage and writer guards) moves from P5.8 to a new **P5.3a** before P5.4, because the policy middleware and P5.5's guards depend on it, with a closed transitional list for P4's `recordWithin` writers until P5.5; tests that P5.5 listed for later code move to P5.6 (races (c), (k)), P5.7 (race (e), reads #35/#36) and P5.8 (reads #33/#34, R19); P5.5 staff-authority tests use owner-seeded grant fixtures; the lock-order guard checks each footprint once its package is done; the SQL authority guard separates forbidden actor-authority literals from enumerated data rules; query-parameter validation moves to P5.3; the platform audit-read contract is frozen inside P5.8 after the validation spike and the owner's O4 decision, not at P5.0. **Gaps closed:** branch restriction defined for every endpoint opened to staff (§7.6, P4 closure (B)/(C)), with **O7** (branch ceiling for delegation); platform staff lifecycle (§7.4: creation through the account-setup link, deactivation, footprints), with **O8** (existing email; reactivation); the two cross-tenant platform lists paginated; **§1.1** traces every inherited obligation to its package, and members/invitations pagination becomes **O9**. O3 carries the reviewer's rev-9 recommendation. Stale statements corrected (review documents are committed; D9 wording in scope; §2.3/§2.4 citation; §15 index reference). |
| 9 | 2026-10-11 | Independent review of rev 8 (approve with required revisions): **(R18)** each sensitive read #33–#36 has its own event identifier and exactly one designated function (`audit.read_merchant_events`, `audit.read_platform_events`, `tenancy.platform_list_merchants`, `tenancy.platform_list_merchant_members`); the writer guard rejects a second writer; **(R19)** merchant-scoped definer reads never rely on RLS — merchant taken only from the session, permission re-checked under locks, an explicit `merchant_id` predicate on every query including continuations, RLS kept as a backstop; tested as the real owner and the app role with forged cursors and filters; **(R20)** per-operation lock footprints for the four reads, and their read-consistency semantics stated; **(R21)** audit pagination contract — total order `(occurred_at, id)` (same-transaction ties are routine), window and filters validated on every request, cursor bound to them by digest (`400 INVALID_CURSOR`), indexes chosen by `EXPLAIN (ANALYZE, BUFFERS)` on representative data, which O4 now requires first; **(R22)** transaction classes decided on the complete, statically resolved call graph, unresolvable functions fail, and a nested unapproved write is a new self-test. Fixes: **(A)** P5 D-numbers distinguished from ADR-14 Dn; O6 shown as decided everywhere; **(B)** §8.1 is the only event inventory, §8.2 defines classes; **(C)** an authorization-resolution failure is 500 `INTERNAL_ERROR`, logged and counted, never 401/403 and never a denial event; **(D)** the audit report's threat model is design-stage input; the as-built threat model is outstanding until P5.10. |
| 8 | 2026-10-11 | Independent review of rev 7 (approve with required revisions): **(R16)** sensitive reads are database-owned only — the designated read function checks authority, inserts exactly one event and returns the rows in one transaction; the `readAudited` wrapper is removed; writer guard and tests updated; the atomic TypeScript entry point is named `mutateAudited` throughout (an earlier table said `recordWithin`); **(R17)** five repository transaction classes (privileged write, pattern-B audited write, read-only, sensitive read, best-effort audit) with an exhaustive list of direct-access exceptions (audit inserts only, only through `mutateAudited`/`recordBestEffort`) and six class self-tests; **O6 decided by the owner** (best effort, with its conditions); O3/O4 carry the reviewer's recommendations, still owner decisions; from a full read of `docs/`: effective permissions exposed for platform sessions too, the authorization middleware fails closed (tested), the threat model moves to `docs/security/` at closure, and §15 records the legacy failure modes P5 rules out. |
| 7 | 2026-10-11 | Independent review of rev 6 (approve with required revisions): **(R13)** authority acquired by category, not by row — the actor's row is locked at its authority-bearing category's turn inside the same ascending-id acquisition as the targets; "actor row before target row" is explicitly not a rule; the guard checks the category-level and the row-level rule; **(R14)** writer guards compare the full (identifier, outcome, class, pattern) tuple, so valid best-effort failures of identifiers with atomic successes are accepted; three writer-guard mutation tests; **(R15)** schema-level expressions on every table in scope (defaults, generated columns, CHECK/exclusion constraints, FK actions, index expressions, RLS policies, rules, domains, triggers) read from the catalog and restricted to a lock-free function allowlist, fail-closed, with four more self-tests; `ON CONFLICT DO UPDATE` treated as an update; **O6** reviewer supports the proposal, owner decision pending; **§15** legacy context added (background only) at the owner's request; the revision log moves to §16. |
| 6 | 2026-10-11 | Independent review of rev 5 (approve with required revisions): **(R9)** "authority lock first" defined precisely — the global category order always governs; the authority lock is the first lock overall for platform operations (category 1) and the first category-3 acquisition for merchant operations (after the merchant row), before any later category and any write; capability flows anchor on the capability row; the guard enforces exactly this; **(R10)** exhaustive event inventory: 32 atomic and 3 sensitive-read pairs individually numbered with exact identifier, outcome, pattern, writer and test; every best-effort pair listed (O6 opened for the two link-issuing successes); agent flows share identifiers, tested per audience; the coverage guard compares catalog and inventory in both directions; **(R11)** the lock-order guard's claim is bounded to a closed set of analysable constructs and fails closed on dynamic SQL, unqualified calls, other languages, explicit table/advisory locks, unrecognised statements, unclassified reachable functions and non-literal transaction SQL; triggers enumerated from `pg_trigger`; three fail-closed self-tests added; coverage is no longer claimed from the mutation tests; **(R12)** trusted actor for capability-based pattern A: invitation acceptance attributed to the locked invitation's identity (checked against the consumed setup token on the setup path), `NULL` audience, the new membership; caller-supplied identity only compared, never recorded; request context recorded but never used for decisions; tests on both paths. |
| 5 | 2026-10-11 | Independent review of rev 4 (approve with required revisions): **(R4)** authoritative atomic-event map — every atomic (identifier, outcome) pair with its writer and coverage test, including all identity events and the split MFA helper; classes are per (identifier, outcome); a coverage guard requires one writer and a co-commit + rollback test (actor, merchant, target, request id) per pair, using an injected insert failure; closes a gap where account setup wrote no per-membership acceptance event; **(R5)** lock model L1–L6: no `FOR UPDATE`, no key updates or deletes of referenced rows (so foreign-key `KEY SHARE` locks never wait), contested inserts last, triggers verified lock-free, whole footprint first, nested `…_locked` functions re-assert preconditions with `NOWAIT`; **(R6)** planned per-operation lock footprints including the actor-authority lock (platform membership first for platform operations; actor membership before invitations); **(R7)** two writer patterns (A database-owned, B repository-owned) with guards against double or missing recording; **(R8)** multi-invitation account setup locks its whole footprint before admitting; the lock-order guard computes recursive waiting footprints and is itself mutation-tested (five injected violation kinds plus the P4 baseline control); new two-connection cases (i)–(k); O3/O4 must be decided before their contracts are frozen. |
| 4 | 2026-10-11 | Follow-up review of rev 3: **(R1 note)** only recognized refusal outcomes enter the denial path; unexpected errors stay 500 and are never recorded as denials (tested); **(R2)** `recordBestEffort` accepts only catalog best-effort identifiers — unknown or misspelled identifiers fail loudly in every entry point; atomic auditing is enforced at the change site (SQL literals checked against the catalog, `mutateAudited`, a per-event coverage test with rollback injection); **(R3)** lock categories extended to every locked table (invitations, single-purpose identity rows, identities and credential rows, sessions, implicit `UPDATE` locks); token-started flows use unlocked lookup → ordered locks → re-check; acquisition one row at a time in sorted order by helpers, independent of query plans, at `READ COMMITTED`; complete lock inventory at `5d8904b` with three non-conforming functions (`set_merchant_status`, `issue_invitation`, `complete_account_setup`) and a latent P4 deadlock (re-invite during account setup) recorded with a test; a static lock-order guard over every function and repository transaction as the proof obligation, with the two-connection runs as evidence. |
| 3 | 2026-10-11 | Independent review (verdict: approve with required revisions): **(R1)** execution contract for privileged operations (§8.2a) — refusals returned, never raised; nothing written before the last check; success audit inside the function; denials recorded best-effort in a separate transaction with the response preserved; sensitive reads audit-then-return; tests per case; **(R2)** audit validation decided by entry point first, so an unknown identifier has a deterministic outcome; one entry point per class; class mismatch through `recordBestEffort` fails loudly; full test matrix (§8.1); **(R3)** one global lock order by category then id, actor and target memberships locked together in one ordered statement; reciprocal-operation and cross-row deadlock tests repeated 50 times, with any `40P01` treated as a defect (§7.2). |
| 2 | 2026-10-11 | Owner review: **(A)** P5.1 is storage only; grant writers move to P5.6/P5.7, after their authorization foundation, and a test proves no app-executable function can write grants; **(B)** the enforcement boundary is one migration that creates the writer functions and revokes direct writes together, with a mixed-version test and the release-failure behaviour stated; **(C)** an owner-approved written D9 policy is mandatory for closure, no exception route; **(D)** platform lock order and grant-revocation races specified and tested in both orders (§7.5); **(E)** strict audit validation with per-class outcomes, and best effort bound to catalog entries (§8.1). O3/O4 labelled as proposals throughout. |
