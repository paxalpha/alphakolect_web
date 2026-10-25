# P7 implementation plan — customers

**Status: revision 3 (2026-10-26) — built; awaiting the gate review.** Planned in one pass and built in one pass, as P6 was, at the
project lead's request ("execute P7 in one go after mapping everything out"). Decisions that would go to the project lead
take the recommended option (his standing instruction) and are recorded in §7. **The owner answered** every question of
`docs/business/P7_OWNER_CUSTOMERS.md` on 2026-10-25 with the suggested option; the plan follows those answers. He approved
the four new permissions' wording the same day (`docs/business/P7_OWNER_CUSTOMER_PERMISSIONS.md`). §9 is the build map: every table, function, endpoint and guard P7 adds or changes. The gate review is the
independent reviewer's.

| | |
|---|---|
| Branch | `feat/p7-customers`, from the P6 tip (P6 closed 2026-10-25, not yet merged); rebased onto `main` after P5 and P6 merge |
| Inputs | `TARGET_ARCHITECTURE.md` §3.1 (customer audience), §5 (customers module), §8 (wallets), §16; ADR-15/16; `TARGET_ARCHITECTURE_REVIEW.md` TA-14 (due before P7); `RESTRUCTURING_MAP.md` P7 row; `BUSINESS_RULES.md` BR-3, BR-4.2, BR-5.1, BR-11.2, BR-11.3; owner decision D1 (2026-10-11: agent-to-customer authorization in P7/P8) |
| Exit (RESTRUCTURING_MAP) | BR-11.3 tests; agent-to-customer assignment recorded so P8 can enforce the rule moved from P5 (D1); BR-5.1 moves to P8 with packages (P7-1) |

## 1. Scope

**In P7:** the `customers` module — a business's customers (onboarding, details, branch, deactivation and
reactivation), agent assignment with its history, the customer's ledger sub-accounts, the customer audience (sign-in to
the mobile app), anonymisation (BR-11.3), and the first **branch-owned** resource: staff restricted to a branch see only
that branch's customers (P5 §7.6's branch-scope resolver, built now).

**Not in P7:** packages and enrolment (P8, with the fee rules — P7-1); collections (P8); customer Live wallets (P9,
feature-gated by OPEN-12); customer KYC (OPEN-13, P12); SMS sign-in (P12, with notifications).

## 2. The finding due before P7

| Finding | Settled by |
|---|---|
| TA-14 audit summaries | **Rule:** an activity-record summary carries identifiers, never a customer's personal details (name, phone number, email, address, nickname). Enforced by a guard over the event catalog: no allowlisted summary field of any event may be one of those, and every customer event's fields are identifiers, counts, statuses or dates. So BR-11.3 anonymisation never touches the activity record, which stays append-only (P1) and follows D9. The BR-11.2 note recording D9 is already in the owner's signed rules (12 October 2026). |

## 3. Design

### 3.1 Customers

- `customers.customers`: business, branch, full name, phone number, optional email, address and nickname, status
  (active, deactivated, anonymised), timestamps. A phone number is unique among a business's customers who are not
  anonymised (owner Q2). Each business has its own record of a person (Q3).
- Added by the owner, staff with `merchant.customers.manage`, or an agent (Q4) — an agent's customer is assigned to the
  agent. Changed and deactivated or reactivated by the owner or staff with `merchant.customers.manage` (Q8).
- Branch (Q6): every customer belongs to one active branch of the business. A staff member restricted to a branch reads
  and changes only that branch's customers: `branchScope: 'branch'`, with the resolver P5 §7.6 asked for (the customer's
  branch, decided in the database).
- On onboarding the customer's ledger sub-accounts are opened (savings 2100, target savings 2110, investments 2120,
  loans 1300), and `ledger.open_subaccount` now checks that a customer subject is a customer of the business (P6-11).

### 3.2 Agent assignment (D1, owner Q5)

- `customers.assignments`: one row per period an agent holds a customer — agent membership, from, to, by whom. At most
  one open row per customer (a partial unique index); a customer may have none.
- Assigning, moving and unassigning: owner or staff with `merchant.customers.assign`; recorded. The agent must be an
  active agent of the business, in the customer's branch when the agent is branch-restricted.
- `customers.current_agent(customer)` is what P8 checks before an agent records a collection.

### 3.3 The customer audience (owner Q7)

- A customer membership (`kind = 'customer'`) links a person's identity to one customer record. The business invites
  the customer by email; the link sets the password (the account-setup flow of P4); the customer signs in to the
  customer audience with bearer tokens, like agents (ADR-14 D7), choosing a business when they save with several.
- A deactivated or anonymised customer cannot sign in, from that moment (sessions revoked).
- P7's customer endpoints: sign-in, refresh, selection and `GET /v1/customer/me` (their own details). Balances and
  records come with P8.

### 3.4 Anonymisation (BR-11.3, owner Q9)

`customers.anonymise_customer`: the business owner only (a reserved permission), at the customer's request, refused while
any of the customer's sub-accounts has a balance. It replaces the name with a placeholder, clears phone, email, address
and nickname, ends the customer's membership and sessions, closes the open assignment, and records
`customer.anonymised` (identifiers only). Irreversible. Ledger rows keep their ids and amounts (BR-11.1); the activity
record is untouched (TA-14).

### 3.5 Reads

Lists are paginated (ADR-16) and searchable by name or phone within the business; a branch-restricted staff member sees
their branch's customers; an agent sees only their assigned customers. Customer details are personal data: reading them
needs `merchant.customers.read`.

## 4. Interfaces

| Endpoint | Who | |
|---|---|---|
| `GET /v1/merchant/customers` | `merchant.customers.read` (branch) | list, search, page |
| `POST /v1/merchant/customers` | `merchant.customers.manage` (branch) | onboard |
| `GET /v1/merchant/customers/{customerId}` | `merchant.customers.read` (branch) | with the current agent |
| `PATCH /v1/merchant/customers/{customerId}` | `merchant.customers.manage` (branch) | details, branch |
| `POST …/{customerId}/deactivate`, `…/reactivate` | `merchant.customers.manage` (branch) | |
| `PUT …/{customerId}/agent` | `merchant.customers.assign` (branch) | assign, move or unassign |
| `GET …/{customerId}/assignments` | `merchant.customers.read` (branch) | the history |
| `POST …/{customerId}/app-invitation` | `merchant.customers.manage` (branch) | the customer's sign-in link |
| `POST …/{customerId}/anonymisation` | `merchant.customers.anonymise` (owner only) | BR-11.3 |
| `GET /v1/agent/customers`, `POST /v1/agent/customers` | agent (assigned customers) | the agent's own; onboard |
| `POST /v1/auth/customer/login`, `…/login/select`, `…/refresh`, `…/invitation/accept` · `GET /v1/customer/me` | customer | sign-in beside the agent's (`/v1/auth/agent/…`); the app link's acceptance |

Activity events (atomic, pattern A, identifiers only): `customer.created`, `customer.updated`, `customer.deactivated`,
`customer.reactivated`, `customer.agent_assigned`, `customer.app_invited`, `customer.anonymised`; refusals best effort.

## 5. Tests

- **BR-11.3:** anonymisation removes every personal detail and keeps every money record; refused with a balance; owner
  only; the customer can no longer sign in; nothing of the details remains in any table the business can read.
- **TA-14:** the catalog guard; a mutation adding a personal field to an allowlist fails it.
- **D1:** every assignment is recorded with its period; one current agent at most, under concurrency; `current_agent`
  answers what P8 needs.
- **Branch scope:** the first end-to-end branch isolation — a restricted staff member gets 404 for another branch's
  customer; the authorization and isolation matrices cover every endpoint and actor, the customer audience by the API tests (a customer token refused on the business's and the agent's endpoints; `/me` the customer's own record only).
- Phone uniqueness under concurrency; deactivation ends sessions; the customer audience's sign-in and refresh; the
  lock-order guard classifies every new function.

## 6. Obligations passed on

P8: enforce the agent rule with `current_agent`, enrolment and BR-5.1 (P7-1). P9: provision customer virtual accounts at
onboarding for verified businesses, feature-gated (OPEN-12). P12: SMS invitations and sign-in for customers without
email; customer KYC (OPEN-13).

## 7. Decisions (recommended options, the project lead's standing instruction)

| # | Decision | Taken |
|---|---|---|
| P7-1 | Enrolment ("one enrolment", BR-5.1) | moves to P8 with packages, which it references; P7 gives P8 the customer and the agent |
| P7-2 | Branch scope | customers are the first branch-owned resource; the resolver is built now and the matrices cover it |
| P7-3 | Customer sub-accounts | opened at onboarding, so every customer's balances exist from day one |
| P7-4 | Customer sign-in | email and password via the business's invitation (until the owner answers Q7 otherwise) |
| P7-5 | Gate | one review of P7 by the independent reviewer at the end |

| P7-6 | Agents' customer endpoints | class `self` (ADR-16 A4: agents hold no merchant permission, "self only until P7/P8"): an agent reaches only the customers assigned to them, decided in the database |
| P7-7 | Customer sessions | a session of the customer audience names the customer record (`identity.sessions.customer_id`), not a team membership: customers stay out of the team's lists, roles, billing counts and ownership rules |
| P7-8 | Ending a customer's access | a deactivated or anonymised customer's sessions fail validation at once (the session check requires an active customer); they are not revoked row by row, which keeps the lock order simple |
| P7-9 | The app invitation | a table of its own (`customers.app_invitations`), accepted at its own capability endpoint: a new person sets a password with the link; an existing account confirms with its password (T11). The staff invitation flow is untouched |
| P7-10 | Phone numbers | stored normalised: spaces, dashes and brackets removed; a Nigerian number written 0XXXXXXXXXX stored as +234XXXXXXXXXX; unique per business among customers not anonymised |
| P7-11 | Lock order | the customer tables are category 16, after the ledger: anonymisation holds the customer's sub-account balances (14) before the customer (16), so no posting can change them meanwhile; P8's postings for a customer take the same order |

## 8. Revision log

| Rev | Date | Change |
|---|---|---|
| 3 | 2026-10-26 | Built as §9 maps; what the build changed is in §10 (decisions P7-12 to P7-17) |
| 2 | 2026-10-25 | The owner's answers recorded (all suggested) and the permissions' wording approved; decisions P7-6 to P7-11; §9, the build map |
| 1 | 2026-10-25 | First plan; the owner's questions asked |

## 9. The build map

### 9.1 Database

**Migration 1 — `customers_core`:**

- `customers.customers` (tenant table: RLS, an app policy, no app privilege — B1): `id`, `merchant_id`, `branch_id`
  (composite FK to `tenancy.branches`), `full_name`, `phone`, `email`, `address`, `nickname`, `status` (active /
  deactivated / anonymised), `identity_id` (the app sign-in; one customer record per person per business),
  `created_by_membership_id`, `created_at`, `updated_at`, `deactivated_at`, `anonymised_at`. CHECKs: the name trimmed,
  1–120; phone normalised (P7-10); email lower-case; an anonymised row has no phone, email, address, nickname or
  identity and the placeholder name. Unique `(merchant_id, phone)` among rows not anonymised; unique
  `(merchant_id, identity_id)`.
- `customers.assignments`: `id`, `merchant_id`, `customer_id`, `agent_membership_id` (composite FKs), `assigned_at`,
  `ended_at`, `assigned_by_membership_id`, `ended_by_membership_id`; one open row per customer (partial unique).
- `customers.app_invitations`: `id`, `merchant_id`, `customer_id`, `identity_id`, `token_hash` (unique), `expires_at`,
  `accepted_at`, `revoked_at`, `created_at`; one open invitation per customer.
- The customer audience (P7-7): `identity.sessions.customer_id` (FK); the audience CHECKs of sessions, selection
  challenges and the activity record admit `customer`; `identity.active_membership`, `eligible_memberships`,
  `login_candidate`, `session_limits` (as agents: 30 days idle, 90 absolute), `create_session`, `validate_session`
  (the customer's business and branch; kind `customer`) and `rotate_refresh_token` learn the customer audience.
  `identity.permissions_of` gives a customer session no permission.
- `ledger.open_subaccount`: a customer subject must be an active customer of the business (closes P6-11).
- Lock categories (P7-11): `customers.customers`, `customers.assignments`, `customers.app_invitations` → 16.

**Migration 2 — `customers_functions`:** the definer functions below, the four permissions with their descriptions,
and the activity events.

| Function | Who (decided inside) | What |
|---|---|---|
| `customers.create_customer(session, branch, name, phone, email, address, nickname, agent, …)` | `merchant.customers.manage` within the actor's branch; or an agent (assigned to themselves) | inserts the customer (phone contested), the assignment if any, opens the four sub-accounts; `customer.created` |
| `customers.update_customer(session, customer, fields…)` | `merchant.customers.manage`, branch-scoped | details and branch; `customer.updated` (the fields changed, by name only) |
| `customers.set_customer_status(session, customer, status)` | `merchant.customers.manage`, branch-scoped | deactivate / reactivate; `customer.deactivated` / `customer.reactivated` |
| `customers.assign_agent(session, customer, agent or null)` | `merchant.customers.assign`, branch-scoped | ends the open assignment, opens the new one; the agent active, of the business, in the customer's branch when restricted; `customer.agent_assigned` |
| `customers.issue_app_invitation(session, customer, token hash, ttl)` | `merchant.customers.manage`, branch-scoped | the customer active with an email and no sign-in yet; finds or creates the identity (passwordless); replaces an open invitation; `customer.app_invited` (delivery: setup / accept) |
| `customers.app_invitation_identity(token hash)` · `customers.accept_app_invitation(token hash, identity, new password hash, …)` | the link (and, for an existing account, its password, checked by the API) | links the identity to the customer; sets the password and verifies the email for a new person; `customer.app_access_accepted` |
| `customers.anonymise_customer(session, customer, …)` | `merchant.customers.anonymise` (owner only) | refused while any sub-account has a balance; clears the personal details, the sign-in and the open assignment and invitation; `customer.anonymised` |
| reads: `customers.list_customers` (search, page, branch-scoped), `read_customer`, `list_assignments`, `agent_customers` (the agent's own), `read_self` (the customer's own), `current_agent` (for P8) | `merchant.customers.read` / the agent / the customer | B1 and R19: the business from the session |

### 9.2 Contracts and API

- Contracts: `endpoints/customers.ts` (merchant), agent customer endpoints, `endpoints/customer.ts` (the customer
  audience: login, selection, refresh, `me`, invitation acceptance); permissions; `branchScope: 'branch'` on the
  merchant customer endpoints.
- API: the `customers` module (repository, service, routes; module boundaries: audit, identity, tenancy); the customer
  audience in sessions, access tokens and authentication (bearer, D7); the branch-scope resolver (§7.6): the customer's
  branch from the database before the policy decision, the database deciding again; the invitation emails; rate
  limits on sign-in and acceptance; the catalog mirror and refusal wording.
- Guards: lock order (category 16, every function classified and footprinted), grants inventory, R19, RLS and
  tenant-schema lists, the TA-14 catalog guard, the transaction classes, the writer and coverage guards, the
  authorization matrix (the customer actor, branch-restricted staff now narrowed), the isolation matrix (the customer
  audience), the frozen route map.

## 10. What the build changed, and what was built

### 10.1 Decisions taken during the build (recommended options)

| # | Decision | Taken |
|---|---|---|
| P7-12 | Agents and branches | agents serve every branch: P4 allows a branch restriction on staff memberships only (`merchant_memberships_branch_only_for_staff`), so no agent check depends on a branch |
| P7-13 | Nothing new for a customer who is not active (owner Q8, Q9) | `ledger.post_entry` refuses a posting to the sub-account of a customer who is deactivated or whose details were removed, checked under the projection locks that removing the details also takes; a staged race (50 runs) shows the posting refused and the balance zero |
| P7-14 | A command's answer | every customer command returns the customer it wrote (`customers.customer_result`), so a staff member allowed to change customers but not to see them still gets the customer they changed (as P6's account answers) |
| P7-15 | The branch scope in the API | a branch resolver per branch-scoped endpoint (the customer's branch from `customers.branch_of`, the requested branch for a creation, the actor's own for a list), read after the permission check; the router refuses at startup a branch endpoint without one (`BRANCH_RESOLVED_ENDPOINTS`), and the middleware fails closed (500) if one is ever missing |
| P7-16 | Rate limits of the app link | their own (`customer_app_invite`, `customer_app_accept`), so sending customers links never uses up a business's staff invitations |
| P7-17 | One event per statement | the deactivation and reactivation events are written by separate inserts, so the writer guard names each pair's writer (as P6's debit events) |

### 10.2 What was built

| Part | Where |
|---|---|
| Migration 1: the three tables, the phone normalisation, RLS without app privilege, the customer audience (sessions, selection challenges, the activity record's audience; the identity functions), the ledger's customer check (P6-11 closed) | `packages/db/prisma/migrations/20261025000200_customers_core` |
| Migration 2: the four permissions and the customer events; onboarding (business and agent), details, status, assignment, the app link and its acceptance, anonymisation; the reads; `current_agent` for P8; the posting refusal (P7-13) | `…/20261025000300_customers_functions` |
| Database tests: onboarding, details, status, assignment, the branch scope, the app link and the customer audience, anonymisation, TA-14 (with a mutation); the P6 tests now use real customers | `packages/db/test/customers.test.ts` |
| Races, 50 staged runs each: one phone number, one agent, anonymisation against a posting | `packages/db/test/customers-races.test.ts` (in `test:concurrency`) |
| Guards: lock category 16 and every function's footprint; the grants inventory; R19; contested keys; the data rules; RLS lists | `packages/db/test/support/lock-*.ts` and the guard tests |
| Contracts: 17 endpoints (10 for the business, 2 for agents, 5 for the customer audience) | `packages/contracts/src/endpoints/customers.ts` |
| API: the customers module; the customer sign-in routes; the customer audience in tokens, sessions and authentication; the branch resolvers; the app-link emails | `apps/api/src/modules/customers/`, `apps/api/src/modules/identity/customer-routes.ts` |
| API tests: the endpoints end to end, the customer's sign-in and own record; the authorization matrix (branch-restricted and archived-branch staff now narrowed), the policy and isolation matrices, the coverage and writer guards for every customer event | `apps/api/test/customers/customers-api.test.ts` and the matrices |
