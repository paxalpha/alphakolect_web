# P5 audit report — authorization catalog, policies and audit module

**Status:** discovery and planning only. No P5 code, migration, test or dependency change was made.
**Baseline:** commit `5d8904b` (merge of PR #6, P4 tenancy) on branch `feat/p5-authorization-audit`.
**Prepared:** 2026-10-11, by inspecting the repository directly (source, SQL migrations, tests, contracts, CI and the
six in-scope documents). `legacy/` was not inspected.

Conventions used throughout:

- **Fact** — observed in the code or SQL at the cited location.
- **Requirement** — stated by a project document (cited).
- **Proposal** — a recommendation of this report; not yet decided.
- **Decision needed** — the project owner must answer (collected in §19).
- Proposed permission identifiers are **proposals**, never existing names.

---

## 1. Executive summary

P4 left a sound base for P5: every request re-validates its session, membership, merchant status, role and branch in
the database (`identity.validate_session`); tenant data is reachable only through a scoped repository; RLS, composite
keys and catalog-driven guards hold every tenant table; and the route registry already drives authentication,
validation and a tenant-isolation matrix. P5 can be built **into** that pipeline rather than beside it.

What P5 must change, confirmed in the code:

1. **Authorization today is a hard-coded owner check in two different places.** Branch, role and profile writes are
   decided only in the API (`requireOwner`, `apps/api/src/platform/tenant.ts:78`) over direct table grants; member and
   invitation commands are decided **inside** `SECURITY DEFINER` functions that hard-code `v.kind = 'owner'`
   (`20261011000200_membership_management/migration.sql:31,62`; `20261012000100_invitations/migration.sql:195,262`).
   Platform actions hard-code `pm.role = 'super_admin'` in SQL. A permission system must replace **both** layers
   consistently, or granted permissions will be silently refused by the database (fail-closed, but broken).
2. **Platform staff cannot sign in at all.** Login eligibility admits only `super_admin`
   (`20261009000200_login_membership_selection/migration.sql:57`), although `support`, `verification`, `finance` exist
   as data (`20261003000100_identity_schema/migration.sql:230`). ADR-15 T2 assigns platform staff to P5.
3. **No permission data exists.** `tenancy.roles` holds names only (T8); there is no permission catalog, no role →
   permission link, and the endpoint registry has no permission metadata (`packages/contracts/src/registry.ts:33-58`).
4. **The audit "module" is one 63-line class** (`apps/api/src/modules/audit/audit-log.ts`). Storage is good
   (append-only by grant and trigger), but there is no event catalog, no read API, no consistent failure semantics
   (P3 identity events are written outside the change's transaction), and authentication-layer denials are not
   audited.
5. **The P5 exit criterion cannot be met as written.** RESTRUCTURING_MAP's P5 row requires "agents: only record
   collections for assigned customers — BR-3", but the repository has **no customer, assignment or collection
   tables or endpoints** (only empty `customers`/`savings` schemas are declared, `packages/db/prisma/schema.prisma:25`).
   Those arrive in P7/P8. This is the most important owner decision before planning is final (D1).

No Critical or High implementation vulnerability was found. The highest-rated items are design gaps (§15).

## 2. Audit scope and verification method

- **Inspected in full:** `docs/business/BUSINESS_RULES.md`; the authorization-relevant parts of the questionnaire
  (Q7a–e, Q10) and follow-up (B4a–b); `TARGET_ARCHITECTURE.md` §0 (ADR-6, ADR-7, ADR-14, ADR-15), §1, §3.1–3.4, §4,
  §5, §11, §16, §30; `RESTRUCTURING_MAP.md` phase graph, phase table and the full P4 record.
- **Traced in code:** authentication middleware, TenantContext, scoped repository, all tenancy services and routes,
  identity routes, the router, the registry, the audit log, all 21 migrations (function inventory, grants, RLS,
  triggers), and the guard/matrix tests.
- **Method for SQL:** static reading of migration files plus a scripted inventory of every `CREATE FUNCTION`
  (definer/invoker, pinned `search_path`). No database was queried.
- **Tests:** not re-run for this audit. The last full local run (2026-10-11) was on commit `a219a1e`, whose tree is
  **byte-identical** to `5d8904b` (`git rev-parse a219a1e^{tree}` = `5d8904b^{tree}` = `1daf97a…`): contracts 61,
  db 304, api 393. CI on PR #6: reported by the owner as 3 checks passed (not observed here).
- **Not inspected:** `legacy/`; `.env` files (never opened); runtime behaviour outside the test suite.

## 3. Repository state and baseline confirmation (observed)

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `5d8904b7e19f00091bad6c1ee147734cd7e151f4` |
| `git status --short` | empty (clean) |
| `git branch --show-current` | `feat/p5-authorization-audit` |
| vs `main` / `origin/main` | 0 ahead, 0 behind (identical) |
| Upstream | none configured (deliberate) |
| Merge parents | `4988130` (previous main) and `a219a1e` (P4 tip) |

## 4. Architecture and requirements traceability

| # | Requirement | Source | Current implementation | Gap | P5 action | Acceptance test |
|---|---|---|---|---|---|---|
| R1 | No request chooses its tenant, actor **or permissions** | TA §1 principle 2 | Tenant and actor from session (`authenticate.ts:105-158`, `tenant.ts:34-54`); contract guard forbids `merchantId` (`packages/contracts/test/tenant-boundary.test.ts:40`) | No permissions exist yet | Permissions resolved server-side per request from DB; contracts never carry permission fields | Contract guard extended: no request field named `permission*`/`role*` grants authority; matrix proves client input cannot widen access |
| R2 | Deny-by-default authorization | TA §1 principle 8 | De facto: every non-self tenant endpoint is owner-only | No central rule that an endpoint *must* declare its authorization | Registry requires an authorization declaration on every secured endpoint; router refuses to start otherwise | Registry test + router startup test |
| R3 | Application authorization decides; RLS only prevents cross-tenant access | ADR-6 | Split: app decides branches/roles/profile; SQL decides members/invitations/platform | Two authorities, both owner-hard-coded | One permission source used by both layers (proposal §9) | Same matrix run proves app and DB agree |
| R4 | Staff permissions from a merchant-defined role; owner decides | BR-3, Q7c, TA §3.1 | Roles are names only (T8) | No role → permission data | Catalog + role permissions (§9, §14) | Role-permission tests incl. escalation |
| R5 | Owner: runs own business | BR-3 | Owner-only checks | — | Owner = fixed full merchant permission set | Matrix: owner allowed on every merchant permission |
| R6 | Agent: record collections for own/assigned customers only; no dashboard, no approvals, no accounts, no staff | BR-3, Q7a | Agent reaches only `GET /v1/agent/membership` (matrix pin `isolation-matrix.test.ts:203`) | Customers/collections do not exist | Fixed agent set; customer-assignment rule designed now, enforced when P7/P8 create the resources (D1) | P5: matrix proves agents reach nothing else; P7/P8: assignment tests |
| R7 | Platform staff (support, verification, finance) get **only what is granted to each**; customer/money data only with explicit permission | BR-3, Q7e, B4a–b, TA §3.1 | Staff roles exist as data; cannot sign in (`login_membership_selection:57`) | Whole platform-staff path missing | Enable sign-in (MFA mandatory), per-staff grants (D4), permission-gated cross-tenant reads | Platform matrix; MFA test for staff |
| R8 | Super admin: everything, MFA mandatory | BR-3, TA §3.1, D8 | Hard-coded `super_admin` in SQL | — | Super admin = fixed full platform set | Matrix |
| R9 | Every change to money **or permissions** records who and when | BR-11.4, TA §16 | Tenancy commands audited atomically (`recordWithin`) | No permission changes exist yet; identity events non-atomic | Permission/role changes audited in the same transaction | Atomicity test (failing audit rolls back the change) |
| R10 | Records kept indefinitely; personal data removable on request, money records stay | BR-11.2, BR-11.3 | Audit append-only even for the owner role (`ledger_invariants:142-147`) | Anonymisation path for audit summaries not designed (noted at `ledger_invariants:117`) | Keep PII out of audit summaries now; record the anonymisation design need (D9) | Redaction test on every event |
| R11 | Platform staff data access is audited | TA §16 | No platform reads exist | — | Every permission-gated cross-tenant read writes an audit event | Test: read ⇒ audit row |
| R12 | Membership, merchant status, role and branch re-read every request; changes apply next request | ADR-15 T5 | `validate_session` per request (`authenticate.ts:125`) | Permissions not resolved | Resolve permissions in the same per-request DB call; no cache | Test: revoke a permission ⇒ next request 403 |
| R13 | Cross-tenant ⇒ 404; known own-tenant resource not permitted ⇒ 403 | ADR-15 T15 | Matrix enforces (`isolation-matrix.test.ts:149-170, 196-225`) | — | Preserve; authorization runs **after** tenant scoping for resource ids | Matrix unchanged + permission matrix |
| R14 | P5 items deferred by P4 closure: archived-role/branch policy; branch isolation; platform membership lookup | RESTRUCTURING_MAP P4 closure review (C), (B); limitation (1) | Recorded as open | Decisions pending | D6, D7; platform read endpoint (WP P5.7) | Tests per decision |
| R15 | P5 exit: "Authorization matrix green (agents: only record collections for assigned customers)" | RESTRUCTURING_MAP phase table, P5 row | Resources absent | **Conflict** with phase order (customers P7, savings P8) | D1 | — |

**Document conflict (R15):** the P5 exit criterion names a behaviour whose resources the same document schedules for
P7 ("Customers: onboarding, agent assignment") and P8 ("cash collection"). Decision owner: project owner. Safe
default: P5 delivers the policy *mechanism* and proves agents reach nothing beyond self; the assignment criterion is
moved, verbatim, into the P7/P8 exit criteria.

## 5. Current identity and session security (facts)

- **Per-request validation.** `authenticate()` (`apps/api/src/platform/http/authenticate.ts:105-158`): credential by
  transport (cookie for platform/merchant, bearer for agent, lines 46-47); signature and claims; audience check
  (`WRONG_AUDIENCE`, line 121); `identity.validate_session(sid)` (line 125) must match `sub`, `aud`, `mid`; MFA
  enrolment scope (line 136); CSRF for cookie state changes (line 140); frozen `req.auth` (line 143).
- **`identity.validate_session`** (`20261010000200_session_context/migration.sql:12-30`): session live, identity
  active, membership active via `identity.active_membership` (merchant active), returns kind, role and branch.
  `SECURITY DEFINER`, pinned search path, EXECUTE for the app only.
- **Identity data boundary.** The app role has `USAGE` on schema `identity` but no table grants
  (`20261003000100_identity_schema` grants functions only); all 31 live identity functions are `SECURITY DEFINER` with
  `SET search_path = pg_catalog, pg_temp` (scripted inventory, §21). `identity.session_limits` is an invoker helper.
- **Tokens.** Access tokens 15 minutes (`access-tokens.ts:7`); refresh rotation with reuse detection and an
  audience check before reuse detection (`20261013000100_audience_checked_refresh`).
- **Platform sign-in** is limited to `super_admin` (`login_membership_selection:57`); MFA is enforced for platform
  sessions (D8).

**How P5 obtains the actor without duplicating identity logic (proposal):** extend the existing per-request call —
either `validate_session` returns the effective permission set, or a sibling definer function
`identity.session_permissions(session)` is called by `authenticate()` in the same request. Permissions then sit on
`AuthContext`/`TenantContext`. No new token claims (claims are hints, ADR-14), no cache (T5). Identity code itself
needs **no** redesign; only platform-staff eligibility changes (WP P5.7).

## 6. Current tenancy and database security (facts)

P4 invariants, verified at source:

| Invariant | Evidence |
|---|---|
| One membership per session | `identity.sessions` binds one membership; `validate_session` returns one row |
| No client merchant id | `tenant-boundary.test.ts:40` (all 20 tenant endpoints) |
| TenantContext from validated session | `tenantContextOf` (`tenant.ts:34-54`) refuses non-tenant audiences |
| Re-check per request | `validate_session` per request (`authenticate.ts:125`) |
| Scoped, transactional repositories | `withTenant` sets `app.merchant_id` locally (`tenant.ts:59-66`); `scopeOf` refuses foreign handles (`tenant.ts:69-72`); source guard `tenant-scope-guard.test.ts:72-95` |
| RLS + `(merchant_id, id)` + paired FKs on every tenant table | catalog guard `packages/db/test/tenant-schema-guard.test.ts:50-86` |
| 404 cross-tenant / 403 own-tenant | `isolation-matrix.test.ts:149-225` |
| Exactly one owner | deferred trigger `20261011000100_one_owner` |
| Identity behind definer boundary | no identity table grants to the app |

**Authority map today (fact):**

| Operation group | Authority decided by | Where |
|---|---|---|
| Branches, roles: create/update | API only (`requireOwner`), DB enforces tenant via RLS and column grants | `merchant-settings.ts:91-155`; grants `branches_and_roles:86-87` |
| Merchant profile rename | API only; app has `UPDATE(name, updated_at)` on merchants under RLS | `merchant-settings.ts:74-89`; `privileges:17`, `merchant_lifecycle:27` |
| Members list/assign/deactivate/reactivate | **SQL** (`kind = 'owner'`) and API (`requireOwner`, early 403) | `membership_management:31,62`; `memberships.ts:66-130` |
| Invitations issue/revoke | **SQL** (`kind = 'owner'`) and API | `invitations:195,262`; `invitations.ts:61-160` |
| Invitation accept | SQL (`admit_invitation` re-checks) after API password check | `invitations:94-165,289-302` |
| Merchant lifecycle, ownership transfer | **SQL only** (`super_admin`) | `merchant_lifecycle:104`; `ownership_transfer:40` |

**Interaction with P5 (proposal).** Authorization policy runs in the application *and* the definer functions consult
the same database-resident permission data; RLS stays the tenant backstop. The scoped repository is unchanged.

## 7. Complete API operation inventory

Verified from `packages/contracts/src/index.ts` (registry) and `packages/contracts/openapi/v1.json`: **44 operations,
38 paths**. Handlers: `apps/api/src/modules/*/routes.ts`. Route/contract parity: `apps/api/test/route-parity.test.ts:59`.
"Proposed permission" names are proposals (§9).

### 7.1 Public and self-service (`/v1/health`, `/v1/auth`) — no permission model; identity-boundary operations

| Method path | Contract id | Handler | Auth | Current guard | Proposed permission | Audit |
|---|---|---|---|---|---|---|
| GET /v1/health | getHealth | health/routes.ts | none | — | public | no |
| POST /v1/auth/login | login | identity/routes.ts:84 | none | rate limit, password, DB eligibility | public | yes (exists) |
| POST /v1/auth/refresh | refreshSession | :102 | refresh cookie + CSRF | DB rotation (web audiences) | public | yes |
| POST /v1/auth/logout | logout | :120 | cookie or bearer | session | self | yes |
| GET /v1/auth/session | getSession | :127 | cookie or bearer | session (enrolment scope allowed) | self | no |
| POST /v1/auth/signup | signup | :139 | none | rate limit | public | yes |
| POST /v1/auth/email/verify | verifyEmail | :144 | none | token | public | yes |
| POST /v1/auth/email/resend | resendVerification | :149 | none | rate limit | public | yes |
| POST /v1/auth/password/forgot | forgotPassword | :170 | none | rate limit | public | yes |
| POST /v1/auth/password/reset | resetPassword | :175 | none | token | public | yes |
| POST /v1/auth/password/setup | completeAccountSetup | :181 | none | token; admits invitations | public | yes |
| POST /v1/auth/password/change | changePassword | :186 | cookie | session | self | yes |
| POST /v1/auth/mfa/totp/enrollment | beginTotpEnrollment | :198 | cookie (enrolment scope) | platform session | self | yes |
| POST /v1/auth/mfa/totp/confirm | confirmTotpEnrollment | :203 | cookie (enrolment scope) | platform session | self | yes |
| POST /v1/auth/mfa/verify | verifyMfa | :216 | MFA cookie | challenge | public | yes |
| GET /v1/auth/login/memberships | listLoginMemberships | :256 | selection cookie | challenge | public | no |
| POST /v1/auth/login/select | selectLoginMembership | :276 | selection cookie | challenge (consumed) | public | yes |
| POST /v1/auth/invitations/accept | acceptInvitation | tenancy/routes.ts:241 | none | password + DB admission | public | yes |
| POST /v1/auth/agent/login | agentLogin | identity/agent-routes.ts:49 | none | password, DB eligibility | public | yes |
| POST /v1/auth/agent/login/select | agentSelectMembership | :72 | none (body token) | challenge | public | yes |
| POST /v1/auth/agent/refresh | agentRefresh | :81 | none (body token) | DB rotation (agent) | public | yes |

### 7.2 Merchant (`/v1/merchant`, cookie session, audience `merchant`)

| Method path | Contract id | Handler | Current guard | Proposed permission | Audit |
|---|---|---|---|---|---|
| GET /membership | getCurrentMembership | tenancy/routes.ts:95 | any merchant member | self | no |
| GET /profile | getMerchantProfile | :100 | `requireOwner` (`merchant-settings.ts:68`) | `merchant.profile.read` | no |
| PATCH /profile | updateMerchantProfile | :105 | `ownerOrDenied` (`:75`) | `merchant.profile.update` | yes |
| GET /branches | listBranches | :111 | `requireOwner` (`:92`) | `branches.read` | no |
| POST /branches | createBranch | :119 | `ownerOrDenied` (`:110`) | `branches.manage` | yes |
| GET /branches/{branchId} | getBranch | :125 | `requireOwner` (`:97`) | `branches.read` | no |
| PATCH /branches/{branchId} | updateBranch | :130 | `ownerOrDenied` (`:134`) | `branches.manage` | yes |
| GET /roles | listRoles | :137 | `requireOwner` | `roles.read` | no |
| POST /roles | createRole | :145 | `ownerOrDenied` | `roles.manage` | yes |
| GET /roles/{roleId} | getRole | :151 | `requireOwner` | `roles.read` | no |
| PATCH /roles/{roleId} | updateRole | :156 | `ownerOrDenied` | `roles.manage` | yes |
| GET /members | listMembers | :164 | `requireOwner` (`memberships.ts:67`) + SQL owner | `members.read` | no |
| GET /members/{membershipId} | getMember | :169 | same | `members.read` | no |
| POST /members/{id}/assignment | assignMember | :174 | `requireOwner` (`:98`) + SQL owner | `members.manage` | yes |
| POST /members/{id}/deactivate | deactivateMember | :181 | same | `members.manage` | yes |
| POST /members/{id}/reactivate | reactivateMember | :187 | same | `members.manage` | yes |
| GET /invitations | listInvitations | :193 | `requireOwner` (`invitations.ts:62`) | `invitations.read` | no |
| POST /invitations | createInvitation | :202 | `ownerOrDenied` (`:73`) + SQL owner | `invitations.manage` | yes |
| POST /invitations/{id}/revoke | revokeInvitation | :208 | `ownerOrDenied` (`:136`) + SQL owner | `invitations.manage` | yes |

### 7.3 Platform (`/v1/platform`, cookie, audience `platform`) and agent (`/v1/agent`, bearer)

| Method path | Contract id | Handler | Current guard | Proposed permission | Audit |
|---|---|---|---|---|---|
| POST /platform/merchants/{id}/deactivate | deactivateMerchant | tenancy/routes.ts:42 | SQL `super_admin` | `platform.merchants.lifecycle` | yes |
| POST /platform/merchants/{id}/reactivate | reactivateMerchant | :54 | SQL `super_admin` | `platform.merchants.lifecycle` | yes |
| POST /platform/merchants/{id}/transfer-ownership | transferOwnership | :65 | SQL `super_admin` | `platform.merchants.transfer_ownership` | yes |
| GET /agent/membership | getAgentMembership | identity/agent-routes.ts:92 | agent session | self | no |

Observations: `requireOwner` has **13 call sites** across `merchant-settings.ts`, `memberships.ts` and
`invitations.ts` (listed by `grep`, §21); no route lacks an authorization boundary; the broadest guard is
"any authenticated merchant session" on `getCurrentMembership`, which is intended (self).

## 8. Current authorization behaviour and confirmed gaps

- **Owner authority (T9) is correct and narrow** — matrix-proven: staff get 403 on all 18 owner endpoints and success
  only on `getCurrentMembership` (`isolation-matrix.test.ts:203-225`).
- **Gap G1 — no declaration of authorization per endpoint.** The registry (`registry.ts:33-58`) has `audience`,
  `security`, `sessionScope`, but no permission; the matrix infers "owner-only" from a response *description* regex
  (`isolation-matrix.test.ts:198`). Brittle and not enforceable at startup.
- **Gap G2 — two authorities.** See §6 authority map.
- **Gap G3 — platform staff absent** (sign-in, management, cross-tenant reads).
- **Gap G4 — no permission data or management API.**
- **Gap G5 — denials not uniformly audited** (§13).

## 9. Proposed permission catalog (proposal)

Principles: only permissions for operations that **exist** (plus the ones P5 itself adds); identifiers are stable,
dot-separated `area.object.action`; a closed TypeScript union mirrors a seeded database table, with a test that the
two are identical. Future modules (customers, collections, remittances, withdrawals, loans) add their permissions in
their own phase — pre-seeding them now would grant meaning to permissions nothing enforces (D2).

### 9.1 Merchant permissions

| Identifier (proposed) | Meaning | Owner | Staff (via role) | Agent | Sensitive / audit |
|---|---|---|---|---|---|
| `merchant.profile.read` | Read business profile | fixed | grantable | no | no |
| `merchant.profile.update` | Rename business | fixed | grantable | no | audited |
| `branches.read` | List/read branches | fixed | grantable | no | no |
| `branches.manage` | Create, rename, archive, restore branches | fixed | grantable | no | audited |
| `roles.read` | List/read roles and their permissions | fixed | grantable | no | no |
| `roles.manage` | Create/rename/archive roles **and set their permissions** | fixed | grantable (escalation rules, §10; D5) | no | **sensitive**, audited |
| `members.read` | List/read members (includes emails) | fixed | grantable | no | personal data |
| `members.manage` | Assign role/branch, deactivate, reactivate | fixed | grantable (escalation rules, D5) | no | **sensitive**, audited |
| `invitations.read` | List invitations | fixed | grantable | no | personal data |
| `invitations.manage` | Issue, revoke invitations | fixed | grantable (escalation rules, D5) | no | **sensitive**, audited |
| `audit.read` | Read this business's audit log (new, WP P5.8) | fixed | grantable (D8) | no | audited (read) |

Self operations (`getCurrentMembership`, `getAgentMembership`, session, logout, password change, MFA) need **no**
permission; they are declared `self` in the registry.

### 9.2 Platform permissions

| Identifier (proposed) | Meaning | Super admin | Platform staff | Sensitive / audit |
|---|---|---|---|---|
| `platform.merchants.read` | Read merchants and their memberships (new; closes P4 limitation 1) | fixed | grantable | cross-tenant read, audited |
| `platform.merchants.lifecycle` | Deactivate/reactivate a merchant | fixed | grantable (D4) | audited |
| `platform.merchants.transfer_ownership` | Transfer ownership | fixed | **reserved to super admin** (proposal; D4) | audited |
| `platform.staff.manage` | Create/deactivate platform staff and grant platform permissions | fixed | **reserved** | sensitive, audited |
| `platform.audit.read` | Read the platform-wide audit log | fixed | grantable | audited (read) |
| `platform.merchant_data.read` | Read a business's customer or money records | fixed | grantable only explicitly (BR-3, B4b) | **sensitive**, every read audited; no endpoints until P6/P7 |

Platform staff kinds `support`, `verification`, `finance` (B4a): **no default permissions** pending D4 (least
privilege). BR-3 says "only what you grant **each one**", which reads as per-person grants, not per-role.

### 9.3 Fixed sets

- **Owner:** every merchant permission (fixed in code and SQL, not rows — cannot be revoked by data).
- **Agent:** none of the merchant permissions; self only. P7/P8 add `collections.record` with an *assigned-customer*
  scope (§11).
- **Super admin:** every platform permission.
- **Staff:** exactly the permissions of their role, only while the role is active (D6).

## 10. Proposed actor/resource/action authorization matrix (proposal)

`A` Allow · `D` Deny · `C` Conditional (granted permission) · `—` not applicable.

| Resource / action | Anonymous | Super admin | Platform staff | Owner | Staff | Agent |
|---|---|---|---|---|---|---|
| Own session, password, MFA, logout | D | A | A | A | A | A (no MFA) |
| Own membership (self) | D | — | — | A | A | A |
| Merchant profile read / update | D | — | — | A / A | C / C | D / D |
| Branches read / manage | D | — | — | A / A | C / C | D / D |
| Roles read / manage (incl. permissions) | D | — | — | A / A | C / C (no self-escalation) | D / D |
| Members read / manage | D | — | — | A / A | C / C (cannot touch owner; no escalation) | D / D |
| Invitations read / manage | D | — | — | A / A | C / C (cannot invite above own permissions) | D / D |
| Merchant audit log read | D | via platform | via `platform.audit.read` | A | C | D |
| Merchant lifecycle | D | A | C | D | D | D |
| Ownership transfer | D | A | D (reserved) | D | D | D |
| Platform staff management | D | A | D | D | D | D |
| Cross-tenant merchant/membership read | D | A | C | D | D | D |
| Customer/money records (future) | D | A | C (explicit, audited) | A | C | C (assigned customers, record only) |
| Approve remittances / see accounts / add staff (future) | D | — | — | A | C | **D** (BR-3, Q7a) |

Negative cases required for every row: anonymous, wrong audience, wrong tenant (404), own tenant without permission
(403), deactivated membership/merchant (401), archived role (per D6), revoked permission (next request).

## 11. Agent / customer-assignment analysis

- **Fact:** no `customers`, `customer_assignments`, `collections` or `remittances` tables or endpoints exist;
  `schema.prisma:25` only declares the `customers` and `savings` schemas. `ledger.accounts` has a generic
  `subject_type/subject_id` pair (`schema.prisma:87`) that is not an assignment model.
- **Fact:** agents can reach only `GET /v1/agent/membership` (pinned, `isolation-matrix.test.ts:203`).
- **Requirement:** agents record collections only for their **assigned** customers (BR-3, Q7a); TA §5 places
  assignments in the `customers` module (agent↔customer).
- **Minimal P5 requirement (proposal):** define the policy hook `authorize(ctx, 'collections.record', {customerId})`
  whose resource check is *"an active assignment row `(merchant_id, customer_id, agent_membership_id)` exists"*,
  evaluated inside the same tenant transaction as the write, with the customer id resolved server-side (never
  trusted from the client beyond being an id to look up, 404 if not in the tenant). **Schema prerequisite (P7):**
  `customers.assignments` with composite FKs `(merchant_id, customer_id)` and `(merchant_id, agent_membership_id)`.
- **Tests (P7/P8, specified now):** agent A records for own customer ⇒ 201; for agent B's customer of the same
  merchant ⇒ 403; for another merchant's customer ⇒ 404; after reassignment ⇒ 403 on the next request; deactivated
  agent ⇒ 401; customer id forged in body for a foreign tenant ⇒ 404 and no row written.

## 12. Branch and tenant scope analysis

- **Fact:** the only resources with branch relationships are `merchant_memberships.branch_id` and
  `invitations.branch_id` (composite FKs). No branch-scoped business resource exists.
- **Fact:** NULL branch = all branches (T7); the restriction is returned per request but read by no endpoint.
- **Proposal:** policy decisions take an optional resource branch; a staff member with `branch_id` set is allowed
  only for resources of that branch; lists filter in the scoped repository query (not after fetching) so counts and
  ids of other branches never leave the database; detail endpoints answer **404** for another branch's resource
  (consistent with T15, avoids existence leaks).
- **Archived branch (D7):** proposal — fail closed: a restriction to an archived branch reaches no branch-scoped data.
- **Testable now:** the policy unit tests with synthetic resources; the matrix pin that nothing branch-scoped is open.
  **Must wait:** end-to-end branch isolation (first branch-scoped resource, P7/P8).

## 13. Audit module assessment and design

### 13.1 Current state (facts)

- **Storage:** `audit.audit_events` (`20260927000100_baseline:131-148`): id, occurred_at, merchant_id, actor
  identity/audience/membership, action, target type/id, outcome (`success|failure|denied`), ip, user_agent,
  request_id, summary (JSON object). Indexes: `(merchant_id, occurred_at)`, `(action, occurred_at)`.
- **Append-only:** app has `SELECT, INSERT` only (`privileges:36`); triggers reject UPDATE/DELETE/TRUNCATE for every
  role including the owner (`ledger_invariants:142-147`).
- **RLS:** app reads only its tenant's events; inserts tenant events for the current tenant or tenant-less events
  (`row_level_security:69-78`); readonly reads all.
- **API:** `AuditLog.record` (own transaction, `audit-log.ts:29-35`) and `recordWithin(tx)` (`:41-62`); `summary` is
  typed to scalar values (`:22`); user agent truncated to 512 (`:57`).
- **Usage:** identity modules use `record` only (accounts 6, mfa 4, password-flows 6, sessions 9 calls) — **after**
  the change commits; tenancy uses `recordWithin` for successes (same transaction) and `record` for refusals.
- **Not present:** event catalog/type, read API, decision/permission fields, audit of authentication-layer denials.

### 13.2 Findings

| # | Severity | Status | Finding | Evidence | Action | Test |
|---|---|---|---|---|---|---|
| A1 | Medium | Confirmed | Identity events are written in a separate transaction after the change: if the audit insert fails, the change (password reset, MFA confirmation, login) stays committed without its event | `password-flows.ts`, `mfa.ts`, `sessions.ts` call `audit.record` after repository calls | Classify events (13.3); for security-relevant identity changes either write the event inside the definer function or accept "best effort" explicitly (D10) | Inject audit failure ⇒ assert agreed behaviour per class |
| A2 | Medium | Confirmed | Authentication-layer denials (401, `WRONG_AUDIENCE`, `CSRF_FAILED`, `MFA_ENROLLMENT_REQUIRED`) and read denials are not audited; only tenancy write denials are | `authenticate.ts:105-158`; `merchant-settings.ts:156-170` | Audit denials from the central authorization step (rate-limited, no bodies) | Denied request ⇒ one `denied` row with reason code |
| A3 | Low | Confirmed (by design) | The app credential can insert audit rows with any actor fields, and tenant-less rows | `row_level_security:75-76` | Accepted application trust boundary; optional hardening: definer `audit.record_for_session(session, …)` deriving actor from the session (D11) | Forged-actor insert rejected (if adopted) |
| A4 | Low | Confirmed | No audit read API; tenant-less events invisible to the app | RLS policies | Merchant and platform read endpoints (WP P5.8) | Matrix + tenant isolation of audit reads |
| A5 | Low | Confirmed | IP and user agent stored indefinitely (BR-11.2) — personal data subject to BR-11.3 | baseline table | Decide retention/anonymisation for these columns (D9) | Anonymisation test when designed |
| A6 | Info | Confirmed | No index on `actor_identity_id` or `request_id` | baseline indexes | Add with the read API | Query plan check |

### 13.3 Proposed event contract and failure semantics

Contract (proposal; existing columns reused, two additive nullable columns): `id`, `occurred_at` (DB clock),
`action` (closed catalog union, tested against a list), `outcome`, `actor_identity_id`, `actor_audience`,
`actor_membership_id`, `merchant_id`, `target_type`, `target_id`, `request_id`, `summary` (scalars only, key
deny-list: password, token, secret, code, otp, hash, email for non-membership events), **new**
`permission` (the permission evaluated, for decisions) and **new** `reason` (stable decision/refusal code).
No request/response bodies, no before/after blobs except named scalar fields (e.g. `roleId`).

| Event class | Examples | Written | If the audit write fails |
|---|---|---|---|
| Permission & role changes | role permissions set, member assigned/deactivated, invitation issued/revoked, ownership transfer, lifecycle | same transaction (`recordWithin` / in definer function) | change rolls back (BR-11.4) |
| Money commands (P6+) | posting, reversal, approval | same transaction | rolls back |
| Identity security changes | password reset/change, MFA confirm, session revocation | proposal: same transaction (D10) | rolls back (proposal) |
| Authentication attempts | login success/failure, refresh, selection | own transaction | request still answered; error logged (availability over completeness; D10) |
| Authorization denials | 403 at the policy step, cross-tenant 404 probes | own transaction, rate-limited per actor | request still denied; logged |
| Sensitive reads | cross-tenant platform reads, audit-log reads, merchant data reads by platform staff | own transaction **before** returning data | read refused (fail closed) |

## 14. Database and migration plan (proposal; no SQL written)

Repository conventions observed: forward-only Prisma migrations with raw SQL; one coherent change per migration;
`SECURITY DEFINER` + pinned `search_path` + `REVOKE ALL FROM PUBLIC` + EXECUTE to `alphakolect_app`; tenant tables
pass the catalog guard; schema.prisma kept in sync (drift test).

Order:

1. **`permissions` catalog** (global, not tenant): `identifier` PK, `scope` (`merchant|platform`), `grantable`
   (false for reserved), description. Seeded in the migration; app `SELECT` only. Test: seed equals the TypeScript
   union.
2. **`tenancy.role_permissions`**: `(merchant_id, role_id, permission)` PK including `merchant_id` (satisfies the
   guard), composite FK to `roles (merchant_id, id)`, FK to the catalog restricted to `scope = 'merchant' AND
   grantable`; RLS; writes only through a definer function (escalation rules enforced there, §10). No backfill: every
   existing role starts with **no** permissions (fail closed; staff currently have none anyway).
3. **Platform grants** (shape depends on D4): `identity.platform_membership_permissions` (per staff member) or per
   platform role; super admin implicit.
4. **Permission resolution**: definer `identity.session_permissions(session)` (or `validate_session` extension) —
   owner/super-admin fixed sets, staff from active role (D6), platform staff from grants; one query per request.
5. **Re-point P4 definer functions** from `kind = 'owner'` / `role = 'super_admin'` to the permission resolver
   (`list_members`, `update_membership`, `issue_invitation`, `revoke_invitation`, `set_merchant_status`,
   `transfer_ownership`) — same signatures (`CREATE OR REPLACE`, grants preserved). Owners/super admins keep exactly
   their authority because their sets are fixed.
6. **Platform staff eligibility**: replace `identity.eligible_memberships` platform branch to admit active staff (MFA
   still enforced in the login flow).
7. **Audit**: additive nullable columns `permission`, `reason`; indexes for reads; (optional, D11) definer recorder.

Compromised-app analysis: with direct `INSERT` on `role_permissions` the app credential could grant itself
permissions; routing writes through a definer function that checks the *session's* authority means a stolen app
credential still needs a live owner/`roles.manage` session to change permissions. Recommended.

Rollback: forward-only; each step ships with a forward fix path. Because owners and super admins hold fixed sets and
staff start with none, **no step widens access**; the worst failure mode of a broken step is over-denial.

## 15. Threat model and prioritized findings

| # | Threat | Asset | Path | Existing control | Residual gap | Mitigation | Regression test | Severity |
|---|---|---|---|---|---|---|---|---|
| T-1 | Staff grants self more permissions | role permissions | staff with `roles.manage` edits own role or adds a permission they lack | none (feature absent) | design | DB function: cannot grant a permission one lacks; cannot edit own role (D5) | escalation tests | High (design-stage) |
| T-2 | Staff manages the owner or a higher-privileged member | memberships | `members.manage` on owner / on a member whose role exceeds own | owner row protected in SQL (`update_membership` owner_protected) | no "higher privilege" rule | same subset rule as T-1 | tests | Medium (design) |
| T-3 | Agent accesses another agent's customer | customer data | forged customer id | no resources yet; matrix pin | P7/P8 | §11 | §11 tests | Medium (design, P7/P8) |
| T-4 | Cross-tenant / cross-branch access via forged ids | tenant data | ids in path/body | RLS, scoped repo, composite FKs, matrix | branch: no resources yet | §12 | matrix + branch tests | Low |
| T-5 | Client-supplied permission/role/merchant | authority | request fields | contract guard (merchantId) | permission fields not guarded | extend contract guard | contract test | Low |
| T-6 | Stale permissions | authorization | cached decision after revocation | per-request `validate_session` | permissions must join the same per-request path | no cache | revoke ⇒ next request 403 | Medium |
| T-7 | TOCTOU between check and write | writes | permission revoked between API check and DB write | DB functions re-check under lock (members/invitations) | app-only writes (branches/roles/profile) check before the transaction | evaluate inside the tenant transaction or accept ms window (D12) | concurrency test as in membership-management | Low |
| T-8 | Compromised app credential self-grants | permissions | direct INSERT | none yet | — | definer-only writes (§14) | privilege test: app cannot INSERT `role_permissions` | Medium |
| T-9 | Definer function escalation | DB | search_path / dynamic SQL | all definers pinned; no dynamic SQL in definers (catalog table names are fixed in TS, `repository.ts`) | `util.uuid_v7` unpinned (invoker) | pin it (low priority) | inventory test | Info |
| T-10 | Audit tampering | audit | UPDATE/DELETE | grants + triggers | forged inserts (A3) | D11 | existing privilege tests | Low |
| T-11 | Secrets/PII in audit | audit | summary fields | scalar typing + leak sweep | no key deny-list | deny-list test | sweep | Low |
| T-12 | Audit failure swallowed / outage | audit | DB error | atomic for tenancy | identity non-atomic (A1) | §13.3 | failure injection | Medium |
| T-13 | Platform staff over-reach | merchant data | broad grants | staff cannot sign in today | — | no defaults; explicit, audited reads | platform matrix | Medium (design) |
| T-14 | Permission inheritance between merchants | role permissions | role of merchant A referenced by B | composite FKs + RLS | — | composite FK on `role_permissions` | guard + test | Low |

**Prioritized (confirmed in code):** G2 two authorities (Medium); G3 platform staff cannot sign in (Medium, blocks R7);
A1 non-atomic identity audit (Medium); A2 unaudited denials (Medium); G1 no declarative per-endpoint authorization
(Low); A3–A6 (Low/Info); T-9 unpinned invoker function (Info). **Design-stage high item:** T-1 escalation rules.

## 16. Test coverage assessment

| Area | Existing (located) | Extend for P5 |
|---|---|---|
| Route/contract parity | `route-parity.test.ts:59-89` (auth + validation chain per endpoint) | assert an authorization middleware is mounted for every non-public, non-self endpoint |
| Tenant isolation | `isolation-matrix.test.ts` (71 cases, registry-driven, fails on unresolved params) | add a permission axis: for each endpoint, staff **with** vs **without** its permission; replace the description regex (`:198`) with registry metadata |
| Staff/agent reach | pin `isolation-matrix.test.ts:203` | becomes "reach = exactly the permissions granted" |
| Source guard | `tenant-scope-guard.test.ts:72-95` | add: no module checks `kind === 'owner'` outside the policy module |
| DB guards | `tenant-schema-guard.test.ts:50-86`; privileges, RLS tests | `role_permissions` covered automatically; add catalog seed = TS union; app cannot write permissions directly |
| Contracts | `tenant-boundary.test.ts:40` | extend to permission-like fields |
| Leak sweep | `no-secrets-sweep.test.ts` | add role-permission and platform-staff journeys |
| Mutation testing | per package (P4: 208 caught) | every new guard proven by breaking it |
| Coverage absent | permission, platform staff, audit read, denial audit | new tests per WP |

## 17. Proposed P5 implementation work packages (proposal)

| WP | Objective | Depends on | Likely files | DB | API | Done when |
|---|---|---|---|---|---|---|
| P5.0 | ADR-16: decisions D1–D12, catalog spec, matrix | — | `TARGET_ARCHITECTURE.md`, `RESTRUCTURING_MAP.md` | — | — | owner approves |
| P5.1 | Catalog + role permissions schema | P5.0 | new migrations; `schema.prisma`; db tests | §14 steps 1–2 | — | guards + seed test green |
| P5.2 | Permission resolution per request | P5.1 | migration; `identity/repository.ts`; `authenticate.ts`; `tenant.ts` | §14 step 4 | — | revoke ⇒ next request 403 |
| P5.3 | Registry declares authorization | P5.0 | `contracts/src/registry.ts`, endpoints, OpenAPI (`x-permission`), contract tests | — | additive metadata | router refuses undeclared endpoint |
| P5.4 | Central policy module + router middleware; replace `requireOwner` route by route | P5.2, P5.3 | new `platform/authorization.ts`; `routes.ts`; tenancy services | — | none (behaviour equal for owners) | all 13 call sites gone; source guard |
| P5.5 | Re-point definer functions to permissions | P5.2 | migration | §14 step 5 | — | app and DB agree in matrix |
| P5.6 | Role-permission management API + escalation rules | P5.4, P5.5 | contracts merchant.ts; tenancy repo/service | definer writer | new endpoints | escalation tests |
| P5.7 | Platform staff: sign-in, management, cross-tenant reads | P5.2, D4 | migrations; identity + new platform module | §14 steps 3, 6 | new endpoints | platform matrix, MFA tests |
| P5.8 | Audit module: event catalog, failure classes, denial audit, read APIs, indexes | P5.4 | `modules/audit/*`; migration | §14 step 7 | new read endpoints | atomicity + redaction + isolation tests |
| P5.9 | Authorization matrix (registry-driven) + sweep + mutation | P5.4–P5.8 | tests | — | — | matrix green; mutations caught |
| P5.10 | Closure | all | docs | — | — | evidence recorded |

Parallelism: P5.1 ∥ P5.3; P5.7 and P5.8 can run in parallel after P5.4. Everything else sequential as listed.

## 18. Migration, deployment and rollback strategy (proposal)

- **Seed:** the catalog only. No role receives permissions automatically; owners and super admins act through fixed
  sets. **Effect at deploy: zero change in who can do what** (staff have nothing today).
- **Transition:** P5.4 replaces `requireOwner` with `authorize(permission)` per route; since owners hold every
  merchant permission and staff none, the matrix before and after must be identical — the existing P4 matrix is the
  regression oracle. Definer functions switch in P5.5 with the same equivalence.
- **No fail-open period:** the router refuses endpoints without a declaration; the policy defaults to deny; DB
  functions keep refusing until a permission exists.
- **Rollback:** forward-only; a faulty step is fixed forward. Because no step widens access, rollback urgency is only
  about over-denial (availability), not exposure.

## 19. Unresolved decisions for the project owner

| # | Decision | Options | Safe default (proposal) |
|---|---|---|---|
| D1 | P5 exit criterion depends on P7/P8 resources | (a) move the assignment criterion to P7/P8; (b) pull customers/assignments into P5 | (a), and P5 proves agents reach nothing beyond self |
| D2 | Pre-seed future permissions (collections, approvals)? | now / per phase | per phase |
| D3 | Granularity of staff permissions (e.g. `branches.read` vs one `settings.manage`) | fine / coarse | fine as in §9.1 |
| D4 | Platform staff grants: per person (BR-3 wording) or per role kind; can staff lifecycle merchants? | per person / per role | per person; transfer and staff management reserved to super admin; no defaults |
| D5 | Escalation rules for staff holding `roles.manage`/`members.manage`/`invitations.manage` | subset rule; or reserve these to owner | subset rule + cannot edit own role; or reserve to owner if simpler |
| D6 | Archived role: grants nothing, or archiving an in-use role refused | fail closed / refuse | fail closed (P4 closure review C) |
| D7 | Restriction to an archived branch | fail closed / refuse archive | fail closed |
| D8 | Merchant audit-log access: owner only, or grantable | owner / grantable | grantable `audit.read` |
| D9 | IP/user-agent retention vs BR-11.3 | keep / anonymise on request / drop after N days | keep, include in the BR-11.3 design (P7) |
| D10 | Identity security events atomic with the change? | atomic / best effort | atomic for password/MFA/revocation; best effort for login attempts |
| D11 | Audit actor derived by the database from the session | yes / no | yes for permission changes; optional elsewhere |
| D12 | Evaluate app-side permission checks inside the tenant transaction | yes / accept window | inside the transaction for writes |

## 20. P5 acceptance criteria and exit checklist (proposal)

1. Every secured endpoint declares its authorization (permission or `self`); the router refuses to start otherwise.
2. A registry-driven authorization matrix: every endpoint × {owner, staff with, staff without, agent, platform staff
   with/without, super admin, anonymous, wrong audience, wrong tenant} — green; fails on any undeclared endpoint.
3. App and database agree: definer functions use the same permission resolver; no `kind = 'owner'` /
   `role = 'super_admin'` checks remain outside the resolver (source + SQL guard).
4. Permission changes apply on the next request; no cache.
5. Escalation tests per D5; owner row and fixed sets cannot be altered by data.
6. Platform staff sign in with MFA, see only granted capabilities; every cross-tenant read audited.
7. Audit: event catalog closed; failure classes per §13.3 tested; denials audited; redaction deny-list tested;
   merchant/platform audit reads isolated and themselves audited.
8. All P4 guards, the isolation matrix and the leak sweep stay green; every new guard proven by mutation.
9. D1 resolved and reflected in the roadmap.

## 21. Appendix — evidence index

- **Docs:** `docs/business/BUSINESS_RULES.md` §3, §10.6, §11; questionnaire Q7a–e (lines ~185–203), Q10;
  follow-up B4a–b (lines ~122–130); `TARGET_ARCHITECTURE.md` ADR-6 (l.31), principles (l.44–55), §3.1 (l.86–103),
  §4 (l.258–277), §5 (l.279–300), §11 (l.390–407), §16 (l.444–446), §30 (l.605–630); `RESTRUCTURING_MAP.md` phase
  graph (l.228–257), P5 row (l.272), P4 closure review.
- **API:** `apps/api/src/platform/http/authenticate.ts:46-47,105-158`; `platform/tenant.ts:34-82`;
  `platform/http/routes.ts:21-37`; `modules/audit/audit-log.ts:22,29-62`; `modules/tenancy/merchant-settings.ts:51-170`;
  `memberships.ts:66-130`; `invitations.ts:61-230`; `merchant-lifecycle.ts:76-194`; `modules/tenancy/routes.ts`
  handlers (lines in §7); `modules/identity/routes.ts`, `agent-routes.ts` (lines in §7); `access-tokens.ts:7`.
- **Contracts:** `packages/contracts/src/registry.ts:11,33-58`; `src/index.ts`; `openapi/v1.json` (44 operations);
  `test/tenant-boundary.test.ts:35-48`; `test/selection-exposure.test.ts`.
- **SQL:** `20260927000100_baseline:131-148,181-184`; `20260927000200_privileges:8-39`;
  `20260927000300_ledger_invariants:37-40,110-150`; `20260927000400_row_level_security:69-78`;
  `20261003000100_identity_schema:230`; `20261009000100_merchant_lifecycle:26-27,86-140`;
  `20261009000200_login_membership_selection:49-63`; `20261009000300_branches_and_roles:86-88`;
  `20261010000200_session_context:12-33`; `20261011000200_membership_management:20-130`;
  `20261011000300_ownership_transfer:18-107`; `20261012000100_invitations:94-338`;
  `20261013000100_audience_checked_refresh`.
- **Tests:** `apps/api/test/tenancy/isolation-matrix.test.ts:40-60,123-245`; `tenant-scope-guard.test.ts:58-103`;
  `route-parity.test.ts:40-89`; `packages/db/test/tenant-schema-guard.test.ts:35-100`; `no-secrets-sweep.test.ts`.
- **Function inventory:** 48 distinct functions (56 definitions including replacements) across migrations; every `SECURITY DEFINER` function pins
  `search_path = pg_catalog, pg_temp`; only `util.uuid_v7` (invoker) is unpinned. (`identity.login_candidate`
  appears in the inventory but was dropped in `20261009000200`.)

### Quality gates

| Gate | Result |
|---|---|
| Every registry route accounted for | Passed (44/44, §7) |
| Permission proposals trace to a requirement or are marked unresolved | Passed (§9, §19) |
| Confirmed findings have evidence and a test | Passed (§13.2, §15) |
| P4 invariants preserved by the plan | Passed (§6, §18) |
| P5 deferrals from ADR-15/roadmap addressed | Passed (R14, D6, D7, WP P5.7) |
| Agent/customer assignment verified against schema and routes | Passed (resources absent, §11) |
| Audit failure semantics per event class | Passed (§13.3) |
| Migration/seeding compatible with conventions | Passed (§14) |
| Negative cases in the matrix | Passed (§10) |
| No fail-open fallback proposed | Passed (§18) |
| Owner decisions separated | Passed (§19) |
| No unsupported claims, no secrets | Passed to the best of this review; line numbers for documents are approximate where marked `~` |
| Tests re-run for this audit | **Not done** — relies on the identical-tree run of 2026-10-11 |
| CI result for PR #6 | **Unverified here** (owner-reported) |

---

## 22. Independent review outcome (2026-10-11; appended — sections 1–21 unchanged)

An independent reviewer examined this report with the evidence pack and the source bundle. Each point was checked
against the code before being accepted here.

### 22.1 Corrections accepted

| # | Review point | Verified against code | Effect on the plan |
|---|---|---|---|
| RV1 | Per-request resolution is not enough for writes: authority can change between authentication and the write | Confirmed for app-only writes (branches, roles, profile); member/invitation functions already re-check under the merchant lock (`20261011000200_membership_management:58-63`) | D12 becomes a **requirement**: every privileged write re-checks current authority inside its own transaction, in the database function or under the same lock |
| RV2 | Not every non-permission endpoint is `self` | Agreed (login, refresh, invitation acceptance, selection have distinct semantics) | Registry declaration is one of `public`, `capability:<name>` (e.g. refresh token, selection challenge, invitation token), `self`, or `permission:<id>`; a secured endpoint without one fails startup and a registry test |
| RV3 | D5 as written misses indirect escalation: assigning a member to an existing, stronger role | Confirmed as a design gap (no code yet) | Delegation ceiling covers role editing **and** role assignment **and** invitations; initial position: `roles.manage` reserved to the owner (see D5) |
| RV4 | `recordWithin` after a committed function would not be atomic | **Does not apply to P4 commands**: the function call and `recordWithin` share one `withTenant` transaction (`modules/tenancy/memberships.ts:108-113`). It applies to the identity flows (A1), where definer functions commit on their own before `audit.record` | A1 stands; P5 moves security-state identity events into the same transaction (inside the definer function or one repository transaction) |
| RV5 | A failing best-effort audit write must not turn a denial into a 500 | **Confirmed, new finding A7** (below) | Denial and attempt events are recorded without letting their failure replace the original 401/403 |
| RV6 | One permission source of truth | Agreed | The seeded database catalog is authoritative; TypeScript types are checked against it by a test; owners and super admins keep implicit full sets |
| RV7 | Enforce merchant-only assignment and no self-granting in the database | Agreed (already proposed in §14) | Composite FK + scope CHECK on `role_permissions`; writes only via a definer function; the app role has no direct write |
| RV8 | Platform grants bound to the platform membership, not the identity | Agreed (§14 step 3 already per membership) | Confirmed as the design |
| RV9 | Merchant and platform audit reads are different cases | Agreed | Merchant reads stay on RLS; platform-wide reads get a separate, permission-gated, audited path |
| RV10 | Allowlists, not only a deny-list, for audit summaries | Agreed | Each event type declares its permitted summary fields; a test rejects anything else |
| RV11 | D9 must not default to indefinite retention of IP/user agent | Agreed | D9 stays **open** pending a retention and privacy policy; no default is applied |
| RV12 | Do not claim branch resource isolation without branch resources | Agreed (already §12) | Unchanged |

### 22.2 New confirmed finding

| # | Severity | Status | Finding | Evidence | Action | Test |
|---|---|---|---|---|---|---|
| A7 | Medium | Confirmed | Denial and failure paths `await audit.record(...)` **before** rethrowing; if that insert fails, its error replaces the intended 401/403 with a 500 | `modules/tenancy/memberships.ts:97-105`; `modules/tenancy/merchant-settings.ts:163-171`; same pattern in `invitations.ts` (`ownerOrDenied`), `merchant-lifecycle.ts` refusals, and login failures (`modules/identity/sessions.ts:90-113`) | Best-effort events are written so that their failure is logged (and alerted) but the original response is preserved | Inject an audit insert failure on a denied request ⇒ the response is still 403/401 and an error is logged |

### 22.3 Decision positions after review (still the owner's to approve)

D1 move to P7/P8 · D2 per phase · D3 fine-grained · D4 per-membership grants, no defaults, lifecycle/transfer/staff
management super-admin only · **D5 `roles.manage` owner-only initially; membership and invitation operations bounded
by a delegation ceiling** · D6 archived roles grant nothing (and existing holders are tested) · D7 fail closed, no
branch-isolation claim · D8 grantable `audit.read`, tenant-scoped · **D9 open** · D10 security-state changes atomic,
login attempts best effort · D11 actor derived from the validated session for privileged operations · **D12 required**
(write-time re-check in the same transaction).

### 22.4 Owner decisions (2026-10-11)

| # | Decision |
|---|---|
| D1 | **Move to P7/P8.** P5 builds the authorization mechanism and proves agents reach nothing beyond their own membership; "agents record collections only for assigned customers" becomes a P7/P8 exit criterion (roadmap amendment in P5.0). |
| D4 | **Per person, no defaults.** The super admin grants each platform staff member explicit permissions on their platform membership; merchant lifecycle, ownership transfer and platform staff management stay super-admin only. |
| D5 | **Owner-only roles.** Only the owner edits roles and their permissions. Staff holding member or invitation permissions may assign or invite only into roles whose permissions they themselves hold, and never touch the owner. |
| D9 | **Open, policy first.** IP and user agent continue to be stored; a retention and privacy policy is written before P5 closes, and P5 does not claim the question settled. |

D2, D3, D6, D7, D8, D10, D11 and D12 proceed on the positions in §22.3 (agreed by this report and the independent
review) unless the owner objects.
