# P7 implementation plan — customers

**Status: revision 1 (2026-10-25) — planned; the owner's answers asked.** Planned in one pass, to be built in one pass, as
P6 was. Decisions that would go to the project lead take the recommended option (his standing instruction) and are
recorded in §8. The owner's decisions are asked in `docs/business/P7_OWNER_CUSTOMERS.md`; until they arrive, the plan
follows that form's suggested answers. The gate review is the independent reviewer's.

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
| `POST /v1/customer/auth/login`, `…/refresh`, `…/select` · `GET /v1/customer/me` | customer | |

Activity events (atomic, pattern A, identifiers only): `customer.created`, `customer.updated`, `customer.deactivated`,
`customer.reactivated`, `customer.agent_assigned`, `customer.app_invited`, `customer.anonymised`; refusals best effort.

## 5. Tests

- **BR-11.3:** anonymisation removes every personal detail and keeps every money record; refused with a balance; owner
  only; the customer can no longer sign in; nothing of the details remains in any table the business can read.
- **TA-14:** the catalog guard; a mutation adding a personal field to an allowlist fails it.
- **D1:** every assignment is recorded with its period; one current agent at most, under concurrency; `current_agent`
  answers what P8 needs.
- **Branch scope:** the first end-to-end branch isolation — a restricted staff member gets 404 for another branch's
  customer; the authorization and isolation matrices cover every endpoint and actor, the customer audience included.
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

## 8. Revision log

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-10-25 | First plan; the owner's questions asked |
