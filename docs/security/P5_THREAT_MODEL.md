# P5 threat model — as built

**Scope.** Authorization, policy enforcement and the activity record, as built in P5 (P5.1–P5.8; branch
`feat/p5-authorization-audit`). This is the deliverable the P5 plan owes at P5.10 (§10 P5.10; TARGET_ARCHITECTURE §27).
Its input is the design-stage table in `docs/architecture/P5_AUDIT_REPORT.md` §15; every row of that table is answered
below with what was built, the test that holds it, and what risk remains.

**Not yet built, and therefore not covered here:** the two activity-record reads — `GET /v1/merchant/audit-events`
(#33) and `GET /v1/platform/audit-events` (#34) — whose contracts (ADR-16 "Addendum — the activity-record reads") await
the independent reviewer's confirmation. Until they are built, no endpoint returns activity entries, the app keeps the
`SELECT` on `audit.audit_events` that P1 granted (no app code uses it), and the reporting role keeps the `ip` and
`user_agent` columns; both are removed by the migration that creates the reads (P5 plan §8.6). This document is to be
extended when they land.

## How authority is decided (the boundary the threats are measured against)

- **One resolver.** `identity.session_authority(session)` gives every request its effective permissions: the owner's
  and the super admin's fixed sets, a staff member's role grants (active role only), a platform staff member's own
  grants, all subject to the containment switch. Nothing caches authority: each request re-reads it (§4 invariant 2).
- **Two layers for every gated operation.** Every endpoint declares one class (`public`, `capability`, `self`,
  `permission`); the router refuses to start on a missing or invalid declaration. The API's policy middleware refuses a
  missing permission with 403 and records `authz.denied`; then the database function that performs the operation
  re-checks the same permission under its locks (`tenancy.assert_authority`, write-time re-check, §7.2). **Reads are
  checked in the database too** (owner decision B1): the profile, branches, roles, the permission catalog, the members
  and invitations lists are served only by definer read functions that check the permission; the app has no direct
  `SELECT` on those tables.
- **Tenant separation is not permission.** Row-level security and explicit `merchant_id` predicates keep businesses
  apart; they do not prove that a person may do something. Inside a definer function RLS filters nothing, so every
  merchant-scoped definer read filters each tenant table by the business its own session gives — checked statically by
  the R19 guard (`merchantScopeFindings`, every reader of a tenant table inventoried whatever its parameters are called).
- **Exposure by design.** The members and invitations lists return people's email addresses: to the owner, and to staff
  granted `merchant.members.read` / `merchant.invitations.read`. That is the decision recorded in the catalog; the risk
  is a grant given too widely, contained by the owner's control of grants (D5′: member and invitation writes are
  owner-only).

## The design-stage threats, as built

| # | Threat | As built | Held by | Residual risk |
|---|---|---|---|---|
| T-1 | Staff grants themselves more permissions | Role editing and permission sets are owner-only (D5′, `merchant.roles.manage` reserved); `tenancy.set_role_permissions` accepts only grantable merchant permissions | `role-permissions-api.test.ts`; the P5.9 matrix (staff with every grantable permission are refused every reserved endpoint) | A defect in `set_role_permissions` — caught by its tests; contained by §11.1 |
| T-2 | Staff manages the owner or a higher member | Member and invitation writes are owner-only (D5′); the owner row is protected in SQL | `memberships-api.test.ts`; the matrix | None specific |
| T-3 | Agent reaches another agent's customer | No customer resources in P5; assigned-customer authorization moved to P7/P8 (D1) | the isolation matrix pins agents to their own membership | Open by design until P7/P8 |
| T-4 | Cross-tenant access by forged ids | Business from the session only; RLS plus explicit predicates in every definer read; composite keys; 404 for another business's ids | `isolation-matrix.test.ts`; the R19 guard | A new definer read without its predicate — refused by the R19 guard |
| T-5 | Client-supplied permission, role or business | No contract carries a business or authority field the server trusts; the business is the session's | `tenant-boundary.test.ts`; contract guards | None specific |
| T-6 | Stale permissions | Re-resolved on every request and at every write; a revoked grant refuses the next request and any write still waiting for its re-check | the revoke-vs-write races (`lock-races.test.ts`) | None specific |
| T-7 | Check-to-write race | Every privileged write re-checks authority inside its own transaction, under the global lock order, after locking the actor's row | the lock-order guard (enforcing mode); 16 two-connection races, 50 staged runs each | A function outside the guard's analysis — the guard fails closed on what it cannot read |
| T-8 | A compromised app credential self-grants | The app has no `INSERT`/`UPDATE`/`DELETE` on grant tables, roles, branches, merchants or memberships; writes only through definer functions with their own checks | `privileges.test.ts`, `function-grants.test.ts`, the mixed-version test | The definer functions themselves — tested per function and by the matrix |
| T-9 | Definer escalation through `search_path` or dynamic SQL | Every definer function pins `search_path`; none builds SQL dynamically | the definer `search_path` guard | None specific |
| T-10 | Activity-record tampering | `UPDATE` and `TRUNCATE` refused for every role, the owner included; a `DELETE` only inside a live, plain purge run, past retention, of a row no copy holds, while no copy is awaited (`audit.audit_events_guard`) | `retention.test.ts` | The migrator is trusted (P1 role model): it owns the table and could replace the guard |
| T-11 | Secrets or personal data in activity summaries | Every pair's summary fields are typed and allowlisted in `audit.event_catalog`, validated on every insert | `event-catalog` tests; the leak sweep | A field allowlisted too widely — reviewed per pair |
| T-12 | An activity write lost or swallowed | Atomic events commit with their change or the change fails (D10); refusals best effort, never changing the answer | failure injection per atomic pair (`coverage.test.ts` and the database's tagged tests) | Availability: if the record cannot be written, security changes fail closed — P15 must alert (ADR-16, availability consequence) |
| T-13 | Platform staff over-reach | Platform staff hold exactly the grants the super admin gives them, starting with none; reserved platform powers are super-admin only; platform reads of a business are permission-gated and recorded (#35, #36) | `platform-staff-api.test.ts`, `platform-lists-api.test.ts`; the matrix | A grant given too widely — contained by §11.1 |
| T-14 | Permissions crossing businesses | `role_permissions` keyed by `(merchant_id, role_id)` with composite foreign keys; RLS | the tenant-schema guard | None specific |

## Threats P5 itself introduced

| # | Threat | As built | Held by | Residual risk |
|---|---|---|---|---|
| T-15 | An over-grant spreads before anyone notices | The containment switch (§11.1): set by the operator, every grant of a kind ignored on the next request; owner and super admin unaffected; recorded (#39) | `containment.test.ts` (database and API) | Detection is human until P15 adds monitoring; the runbook `docs/operations/AUTHORIZATION_CONTAINMENT.md` |
| T-16 | IP addresses or devices leak through logs | Logs are an allowlist: request id and method, the matched route template, status; database errors by structural fields only; the server's own request id | the D9 leak sweep (six forwarding headers, query strings, unknown paths, route parameters, a forged request id, an injected failure printing an address) | Error tracking added later (P15) must keep the same rule |
| T-17 | The purge deletes what it should keep | Deletion by identity, page by page from a manifest the database records, with a read position the database keeps; nothing deleted while a requested copy is awaited, nor any row a copy holds; the table's own guard repeats the rules | `retention.test.ts`, `retention-rules.test.ts` (a held block larger than one step crossed, a request appearing mid-run, page order, takeover after the lease); `purge.test.ts` (the command never skips a page number); ten design reviews (§14 of the plan) | Part 2 was approved by Claude under the project lead's delegation, not by an independent review |
| T-18 | The owner's copy leaks | The report file is named by its run, owner-only, in a local unsynced folder, tracked from creation to destruction; handed over on a stick verified after a physical re-insertion; the operator's copy destroyed and recorded after the owner's written receipt | `purge.test.ts`, `retention.test.ts`; the runbook `docs/operations/AUDIT_PURGE.md` | The eject, the stick's fate, the folder's encryption and the absence of other sync or backup tools rest on the operator's attestations |
| T-19 | Two operator commands race | A kernel-held lock per operator account and a database reservation judged by the database's clock; every wait `NOWAIT` or `SKIP LOCKED` | `purge-lock.test.ts`; the lock-order guard | Commands on another machine, or another OS account, are separated only by the database reservation |
| T-20 | IP addresses and devices kept too long outside the record | Session and link details cleared two years after the sign-in ended (the earliest of revocation, absolute and idle expiry) or the link was sent, in batches on every purge invocation | `retention.test.ts` | Until P12 schedules it, the purge is run by hand, once a month on the first working day (the owner's choice, O23); a missed month keeps details up to a month longer |

## Residual risks accepted for P5

1. The migrator role is trusted: it owns every table and function (P1).
2. Part 2 (the retention design) was approved under delegation, not by an independent review.
3. The operator's attestations (the eject, sticks' fates, the folder's properties) are not machine-verifiable.
4. Monitoring and alerting (activity-write failures, containment, a copy awaited) are P15 obligations.
5. The activity-record reads (#33, #34) are not built: this model is extended when they are.
