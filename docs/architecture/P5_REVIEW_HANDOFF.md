# P5 review handoff — authorization catalog, policies and audit module

Self-contained summary of `docs/architecture/P5_AUDIT_REPORT.md` (section numbers below refer to it). Discovery only:
no P5 code, migration or test has been written.

## Baseline (observed 2026-10-11)

- Repository `paxalpha/alphakolect_web`, branch `feat/p5-authorization-audit`, HEAD `5d8904b` (merge of PR #6, P4),
  identical to `main` and `origin/main`; clean tree; no upstream.
- Tests not re-run for this audit. The last full local run (contracts 61, db 304, api 393) was on `a219a1e`, whose
  tree is byte-identical to `5d8904b`. CI for PR #6 (3 checks passed) is owner-reported, not observed here.
- Scope: `apps/api`, `packages/{db,contracts,config}`, `infrastructure`, CI, `docs`. `legacy/` not inspected.

## What exists (facts)

- **Per-request validation** of session, identity, membership, merchant status, kind, role and branch:
  `identity.validate_session` called from `apps/api/src/platform/http/authenticate.ts:125`.
- **TenantContext** only from the validated session (`apps/api/src/platform/tenant.ts:34-54`); scoped repository
  transactions (`tenant.ts:59-72`); RLS + composite keys + catalog guard on every tenant table.
- **Interim authorization (ADR-15 T9):** `requireOwner` (`tenant.ts:78`), 13 call sites in
  `modules/tenancy/{merchant-settings,memberships,invitations}.ts`; plus SQL `v.kind = 'owner'` in
  `tenancy.list_members`/`update_membership` (`20261011000200_membership_management/migration.sql:31,62`) and
  `issue_invitation`/`revoke_invitation` (`20261012000100_invitations/migration.sql:195,262`); platform actions
  `pm.role = 'super_admin'` in SQL (`20261009000100_merchant_lifecycle:104`, `20261011000300_ownership_transfer:40`).
- **44 API operations** (38 paths): 21 public/self auth, 19 merchant, 3 platform, 1 agent (§7 lists each with
  handler, guard and proposed permission).
- **Audit storage:** `audit.audit_events`, append-only by grant (`20260927000200_privileges:36`) and trigger for every
  role (`20260927000300_ledger_invariants:142-147`), RLS (`20260927000400_row_level_security:69-78`).
  **Audit code:** one class, `apps/api/src/modules/audit/audit-log.ts` (`record` own transaction; `recordWithin`
  same transaction).
- **Not present:** permission catalog, role → permission data, registry permission metadata, platform-staff sign-in,
  audit read API, any customer/assignment/collection table or endpoint.

## Top confirmed risks and gaps

1. **G2 — two authorities, both owner-hard-coded** (API for branches/roles/profile; SQL for members/invitations;
   SQL for platform). P5 must re-point both to one permission resolver, or grants will be refused by the DB.
   Medium.
2. **G3 — platform staff cannot sign in** (`20261009000200_login_membership_selection/migration.sql:57` admits only
   `super_admin`), though BR-3/B4 and ADR-15 T2 put them in P5. Medium.
3. **A1 — identity audit events are not atomic** with their change (`audit.record` after the change in
   `sessions.ts`, `password-flows.ts`, `mfa.ts`). Medium.
4. **A2 — denials at the authentication layer and on reads are not audited.** Medium.
5. **G1 — no declarative authorization per endpoint**; the isolation matrix infers owner-only from a response
   description regex (`apps/api/test/tenancy/isolation-matrix.test.ts:198`). Low.
6. **T-1 (design stage, High)** — without explicit rules, a staff member allowed to manage roles could escalate.
7. A3 forged audit inserts possible with the app credential (accepted trust boundary; optional hardening); A5
   IP/user agent kept indefinitely vs BR-11.3; `util.uuid_v7` unpinned search path (invoker, informational).

No Critical/High implementation vulnerability found.

## Most important architectural decisions (proposals)

- Permissions resolved **in the database, per request**, in the same path as `validate_session`; placed on
  `AuthContext`/`TenantContext`; **no cache**, no token claims.
- One resolver used by both the API policy module and the `SECURITY DEFINER` functions (replacing every hard-coded
  `owner`/`super_admin` check with the same signatures).
- The endpoint registry declares each secured endpoint's permission (or `self`); the router mounts authorization from
  it and **refuses to start** on an undeclared endpoint (deny by default).
- Owner and super admin hold **fixed** full sets (code, not rows); staff hold exactly their active role's
  permissions; agents hold none beyond self until P7/P8; platform staff hold only explicit grants.
- Role-permission writes only through a definer function enforcing escalation rules.
- Catalog seeded with permissions for **existing** operations only; no role gets permissions at deploy ⇒ **no change
  in access at deploy**; the P4 matrix is the equivalence oracle while `requireOwner` is replaced.
- Audit: closed event catalog; failure semantics per event class (permission/money changes atomic; denials and login
  attempts best effort; sensitive reads fail closed); two additive columns (`permission`, `reason`); read APIs.

## Unresolved decisions (owner)

| # | Decision | Safe default |
|---|---|---|
| D1 | P5 exit criterion ("agents record only for assigned customers") needs P7/P8 resources | move it to P7/P8; P5 proves agents reach only self |
| D2 | Pre-seed future permissions? | per phase |
| D3 | Granularity of staff permissions | fine-grained (read/manage per area) |
| D4 | Platform staff grants per person or per role; may staff lifecycle merchants? | per person; transfer + staff management super-admin only; no defaults |
| D5 | Escalation rules for staff managing roles/members/invitations | cannot grant what they lack; cannot edit own role |
| D6 | Archived role | grants nothing (fail closed) |
| D7 | Restriction to an archived branch | reaches no branch data (fail closed) |
| D8 | Merchant audit-log access | grantable `audit.read` |
| D9 | IP/user-agent retention vs BR-11.3 | keep; design with customer anonymisation (P7) |
| D10 | Identity security events atomic? | atomic for password/MFA/revocation; best effort for login attempts |
| D11 | Audit actor derived by the DB from the session | yes for permission changes |
| D12 | App-side checks inside the tenant transaction for writes | yes |

## Proposed package order

P5.0 decisions/ADR-16 → P5.1 catalog + role-permission schema ∥ P5.3 registry metadata → P5.2 per-request
resolution → P5.4 policy module + router, replace `requireOwner` → P5.5 re-point definer functions → P5.6
role-permission API + escalation → (P5.7 platform staff ∥ P5.8 audit module) → P5.9 registry-driven authorization
matrix + sweep + mutation → P5.10 closure. Details: §17; rollout without fail-open: §18.

## Files an independent reviewer needs

`docs/architecture/TARGET_ARCHITECTURE.md` (ADR-6, ADR-14, ADR-15, §3.1, §4, §5, §16, §30),
`docs/architecture/RESTRUCTURING_MAP.md` (phase table, P4 record), `docs/business/BUSINESS_RULES.md` (§3, §11),
questionnaire Q7, follow-up B4; `apps/api/src/platform/{tenant.ts,http/authenticate.ts,http/routes.ts}`,
`apps/api/src/modules/audit/audit-log.ts`, `apps/api/src/modules/tenancy/*`, `packages/contracts/src/registry.ts`,
`packages/contracts/openapi/v1.json`, the migrations listed in §21, and
`apps/api/test/tenancy/isolation-matrix.test.ts`.

## Questions the repository cannot answer

D1–D12 above; whether platform-staff permission sets should mirror the legacy admin's; the exact audit-read
retention/visibility for platform staff; whether merchant owners must see denials of their staff.

## Update after the independent review (2026-10-11)

Review outcome and the new finding A7 (a failing denial-audit write turns a 401/403 into a 500) are in
`P5_AUDIT_REPORT.md` §22. Owner decisions: **D1** move the assigned-customer criterion to P7/P8; **D4** per-person
platform grants, no defaults, lifecycle/transfer/staff management super-admin only; **D5** owner-only roles, staff
assign/invite only within permissions they hold; **D9** left open until a retention and privacy policy exists. The
other decisions proceed on the agreed positions unless the owner objects.
