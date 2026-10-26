# P8 implementation plan — savings

**Status: revision 3 (2026-10-26) — the gate review's two findings resolved (§10); awaiting its re-check.** Planned in one pass, to be built in one pass, as
P6 and P7 were ("map everything out and execute in one go"). Decisions that would go to the project lead take the
recommended option (his standing instruction) and are recorded in §7. The owner answered
`docs/business/P8_OWNER_SAVINGS.md` (Q1–Q11) on 25 October 2026, signed; every answer is the suggested option, so the
design below stands as mapped. The gate review is the independent reviewer's.

| | |
|---|---|
| Branch | `feat/p8-savings`, from the P7 tip (P7 closed 2026-10-26) |
| Inputs | `TARGET_ARCHITECTURE.md` §9 (collections, fees, remittances, withdrawals), §8 (wallets); `TARGET_ARCHITECTURE_REVIEW.md` TA-13 (due before P8); `RESTRUCTURING_MAP.md` P8 row; `BUSINESS_RULES.md` BR-3, 5.1–5.6, 6.1–6.2, 7.1–7.4, 11.1; P6's posting templates (§4 of its plan); P7's customers, assignments and `customers.current_agent` (D1, P7-1) |
| Exit (RESTRUCTURING_MAP) | BR-5.1 (from P7, P7-1), 5.2, 5.3, 5.5, 5.6, 6.1, 6.2, 7.1–7.4 tests; no double credit possible (test); agents record collections only for their assigned customers (BR-3, D1) |

## 1. Scope

**In P8:** packages with one fee rule; enrolment, one at a time (BR-5.1); 31-day cycles (BR-5.2); cash collections
recorded by agents (BR-5.3), for their own customers only (BR-3, D1); remittances: the business approves the
collections the agent's cash covers (BR-5.3, 5.5), and only then does the customer's savings grow (BR-5.6); fees, each
its own entry with a narrative (BR-6.1, 6.2); cancelling a mistaken collection; cash withdrawals from collection or
target savings, never above the balance (BR-7.1–7.4); moving collection savings into target savings, with an optional
goal.

**Not in P8:** live-wallet collections (P8b, after P9; feature-gated by OPEN-12); withdrawals to repay a loan (with loans,
P11 — owner Q8); interest and charges on target savings (later); automatic daily contributions (OPEN-5, after P8b);
withdrawals paid to a bank account (OPEN-7).

## 2. The finding due before P8

| Finding | Settled by |
|---|---|
| TA-13 remittances can race | A collection names at most one remittance (`collections.remittance_id`, one column: it cannot belong to two). Approval locks the collections `FOR NO KEY UPDATE` in ascending id (one sorted helper call), checks each is still `recorded` and belongs to the agent and the business inside the same transaction, and only then posts. A staged two-connection test approves the same collection in two remittances at once: one approves it, the other refuses it, and the customer is credited once ("no double credit") |

## 3. Design

### 3.1 Packages and enrolment (owner Q1, Q2, Q10; BR-5.1, 6.1)

- `savings.packages`: name (one active per name), kind (`fixed`: each collection is the amount or a multiple of it;
  `flexible`: any amount from a minimum), amount (the fixed amount, or the flexible minimum), fee rule — exactly one of
  `first_contribution` or `percentage` with its rate in basis points (a CHECK, BR-6.1), status (active / archived).
- `savings.enrolments`: a customer in a package; one per customer (a unique key on the customer, BR-5.1). A change of
  package takes effect when the current cycle ends (Q10): it is recorded as the enrolment's next package, and becomes the
  package when the next cycle opens. With no cycle running, a change takes effect at once.

### 3.2 Cycles (owner Q3, Q4; BR-5.2)

- `savings.cycles`: 31 days from the customer's first contribution; the next starts with the first contribution after
  the 31 days end (Q3). A cycle is opened when its first collection is approved (BR-5.6: nothing counts until then).
- The first-contribution fee: on a fixed package, one day's amount of the cycle's first approved collection; on a
  flexible package, that whole collection (Q4, BR-6.1). The percentage fee: each approved collection, rounded down to the
  kobo (Q2).

### 3.3 Cash collections (BR-3, 5.3, 5.6; D1)

- `savings.collections`: customer, enrolment, agent, amount (and days, for a fixed package), the day collected, status
  (`recorded` → `approved` or `cancelled`), its remittance, its ledger entries; an agent's idempotency key (unique per
  agent: a retried request records once).
- Recording (the agent's app): the customer active and enrolled, **the agent the customer's current agent**
  (`customers.current_agent`, D1, read under the customer's lock, which reassignment takes), the amount valid for the
  package. Ledger: `collection.cash_recorded` (Dr 1210 the agent / Cr 2190) — the customer's savings do not move
  (BR-5.6). The agent's 1210 sub-account is opened when the agent is first given a customer (P8-4).
- Cancelling (owner Q6): staff with the remittance permission, before approval, with a reason; the recording's entry is
  reversed (BR-11.1).

### 3.4 Remittances (owner Q5; BR-5.3, 5.5, 5.6; TA-13)

- `savings.remittances`: an agent's hand-over, made and approved in one step by staff with the permission, naming the
  collections the cash covers; the cash counted equals their total (P8-8); the rest stay `recorded` (Q5), listed against
  the agent; the total, the fees and who approved it are recorded.
- Approval, per collection, in ascending id: `collection.cash_confirmed` (Dr 1200 / Cr 1210 agent; Dr 2190 / Cr 2100
  customer), then the fee as its own entry — `fee.first_contribution` or `fee.percentage`, with the narrative BR-6.2
  asks for, e.g. "2% deducted for merchant on 2026-10-26 09:14".
- Lock order: **every projection the approval will post to, in one sorted acquisition** (14), then the customers'
  enrolments and the collections (17, one sorted helper call each), before the first entry is inserted; each posting goes
  through the `…_locked` core, which re-asserts its projections NOWAIT, so nothing is waited for after a contested
  insert (L3; P8-10 as revised).

### 3.5 Withdrawals and target savings (owner Q7, Q8, Q9; BR-7.1–7.4)

- `savings.withdrawals`: from collection savings (2100) or target savings (2110), to cash (Q8: loans later); one person
  with the permission (Q7); refused above the balance — the ledger's non-negative rule on the locked projection (BR-7.4);
  the balance goes down at once (BR-7.3). Idempotent by the request's key, held on the movement itself (P8-9).
- `savings.target_goals`: an optional goal (amount and/or date); money moves in from collection savings
  (`savings.to_target`) by staff with the permission; withdrawable at any time (Q9).

### 3.6 Statements for the customer (BR-5.6)

The customer's app and the business see a recorded collection as "recorded by agent — awaiting confirmation" until
approved; the savings balance moves only on approval. The reads list collections by status for a customer, an agent
and a remittance.

## 4. Interfaces

| Endpoint | Who | |
|---|---|---|
| `GET/POST /v1/merchant/packages`, `PATCH …/{packageId}` | `merchant.savings.read` / `merchant.packages.manage` (business-wide) | packages |
| `PUT /v1/merchant/customers/{customerId}/enrolment` | `merchant.packages.manage` (branch) | enrol, or the next cycle's package |
| `GET /v1/merchant/customers/{customerId}/savings` · `…/savings/movements` | `merchant.savings.read` (branch) | balances, cycle, awaiting confirmation, goal; withdrawals and moves |
| `GET /v1/merchant/collections` | `merchant.savings.read` (branch) | by customer, agent, status, remittance |
| `POST /v1/merchant/collections/{collectionId}/cancellation` | `merchant.remittances.approve` (branch) | Q6 |
| `GET /v1/merchant/remittances` · `POST` | `merchant.savings.read` (branch) / `merchant.remittances.approve` | approve the collections an agent's cash covers |
| `POST /v1/merchant/customers/{customerId}/withdrawals` | `merchant.withdrawals.create` (branch) | Idempotency-Key |
| `POST /v1/merchant/customers/{customerId}/target-transfers` · `PUT …/target-goal` | `merchant.withdrawals.create` (branch) | Idempotency-Key |
| `POST /v1/agent/collections` · `GET /v1/agent/collections` | agent (their own customers) | record (idempotent); today's |
| `GET /v1/customer/savings` · `GET /v1/customer/savings/collections` | customer | their balances and collections, pending included |

Activity events (atomic, pattern A, identifiers and amounts only — TA-14): `savings.package_created`,
`savings.package_updated`, `savings.customer_enrolled`, `savings.collection_recorded`, `savings.collection_cancelled`,
`savings.remittance_approved`, `savings.money_moved` (a withdrawal or a move into target savings, by its kind),
`savings.target_goal_set`; a refusal by the database alone is recorded best effort (`…/denied`), as in P6 and P7.

## 5. Tests

- BR-5.1 one enrolment; BR-5.2 31-day cycles (Q3) at their edges; BR-5.3, 5.5 the remittance path; BR-5.6 savings move
  only on approval; BR-6.1 one fee rule (schema), both fees at their edges (Q2, Q4); BR-6.2 each fee its own entry with
  its narrative; BR-7.1–7.4 withdrawals from either wallet, cash, the balance down at once, never above it.
- TA-13 / "no double credit": two remittances approving one collection at once (staged, 50 runs); an approval and a
  cancellation at once; a retried recording records once.
- D1 / BR-3: an agent records only for their own customers now (a moved customer is refused at once); never approves.
- The ledger stays balanced and every projection equals its lines after every test (P6's verify function).
- Guards: lock order (every function classified and footprinted), grants, R19, TA-14, the matrices, the coverage and
  writer guards.

## 6. Obligations passed on

P8b: live-wallet collections through the same fee and cycle logic. P11: withdrawals to repay a loan (Q8). Later: target
savings interest and charges; maker-checker for withdrawals if a business asks (Q7).

## 7. Decisions (recommended options, the project lead's standing instruction)

| # | Decision | Taken |
|---|---|---|
| P8-1 | Enrolment | built here, with packages (P7-1) |
| P8-2 | The cycle and the first-contribution fee | decided at approval (BR-5.6): the cycle is opened by its first approved collection |
| P8-3 | Approval's locks | the collections, then every projection the approval posts to, in one sorted acquisition before the first entry (L3) |
| P8-4 | The agent's 1210 sub-account | revised at the build: opened when the agent is first given a customer — `customers.assign_agent` and onboarding (`customers.insert_customer_locked`) open it as their last contested inserts — and for every agent who had customers when the migration ran. A recording never inserts an account (L3), and an agent records only for their own customers, so the account exists |
| P8-5 | A customer deactivated after a recording | the recording stays; its approval is refused by the ledger (P7-13), and the business cancels it |
| P8-6 | Gate | one review of P8 by the independent reviewer at the end |
| P8-7 | A package's terms | never change once written: a package is renamed or archived only; other terms are a new package (the cycles and fees already taken stay explainable) |
| P8-8 | The remittance's cash | the cash counted equals the total of the collections approved (`cash_mismatch` otherwise); a shortfall is the agent's collections left recorded |
| P8-9 | Idempotency | a recording and a money movement carry the actor's key on their own row (unique per agent or staff member), checked under the posting's locks; the same request returns the first answer, another with the key is refused. An approval and a cancellation are idempotent by the collection's status: a retry is answered 409 and credits nothing. P6's claim records stay for the ledger's own commands |
| P8-10 | The lock-order guard and the posting core | revised after the gate review (R2): no exception in the guard. The posting core is split — `ledger.post_entry` takes the lines' projections and calls `ledger.post_entry_locked`, which re-asserts them NOWAIT and waits for nothing (L6); a savings command, which takes every projection it posts to in its own footprint, posts through the `…_locked` forms |
| P8-11 | The lists' branch scope | the collection and remittance lists are branch-scoped as the customer list is (P7): a restricted staff member sees their branch's customers' collections, and the remittances made of them only; packages are business-wide |
| P8-12 | Which cycle a collection belongs to | revised after the gate review (R1): the cycle whose 31 days hold the day it was collected; a new one when it falls after the last cycle; otherwise (a day in no cycle, before a later one was opened) the last one. A collection is approved only under the package it was recorded under (`package_changed` otherwise: cancel and record again); a recording is checked against the next cycle's package when a change waits and the current cycle has ended |

## 8. Revision log

| Rev | Date | Change |
|---|---|---|
| 3 | 2026-10-26 | The gate review's findings resolved (§10): migration `20261027000300_savings_review`; P8-10 and P8-12 revised |
| 2 | 2026-10-26 | The owner's answers recorded (Q1–Q11, all the suggested option); built as §9 maps; decisions P8-7 to P8-12, P8-4 revised |
| 1 | 2026-10-26 | First plan; the owner's questions asked |

## 9. The build

| Part | What |
|---|---|
| Migration `20261027000100_savings_core` | the seven tables (§3), RLS with an app policy and no app privilege (B1); `savings.lock_enrolments` and `savings.lock_collections` (L5, TA-13); `customers.insert_customer_locked` and `customers.assign_agent` open the agent's cash account (P8-4), and every agent with customers has one |
| Migration `20261027000200_savings_functions` | the four permissions (Q11 wording), the eight events and their refusals; the commands `create_package`, `update_package`, `enrol_customer`, `record_collection`, `cancel_collection`, `approve_remittance`, `move_savings`, `set_target_goal`; the reads `list_packages`, `customer_savings`, `self_savings`, `list_collections`, `list_remittances`, `list_movements`, `agent_collections`, `self_collections`, `collection_branch`; internal `package_result`, `collection_result`, `summary_of` |
| Lock order | savings tables are category 17, after the customers (16): each command takes the business, the actor, role and branch, then every projection it posts to (14), the customer (16), then its own rows (17), its contested inserts last. Footprints: `record_collection` 2:S A3:NKU 14:NKU 16:S 17:S +15 +17; `approve_remittance` 2:S A3:NKU 7:S 8:S 14:NKU 17:NKU 17:NKU +17 +15 +17 +15; `cancel_collection` …14:NKU 17:NKU +15; `move_savings` …14:NKU +15 +17; `enrol_customer` …16:NKU 17:S 17:NKU +17; `set_target_goal` …16:NKU 17:NKU +17; `create_package` …7:S +17; `update_package` …7:S 17:NKU |
| Guards (db) | the lock-order guard's categories, helpers, footprints and P8-10's rule with its self-tests; grants, RLS, the migrations' table list, the permission lists and wording, the merchant-scope lists (R19), the data rules, the contested keys; Prisma models for the seven tables |
| Tests (db) | `savings.test.ts` (26): packages and BR-6.1 in the schema; BR-5.1 and Q10; recording, D1, Q1's amounts, the key; remittances, BR-5.6, Q2/Q4 fees and BR-6.2 narratives, BR-5.2/Q3 cycles at their edges, refusals and no double approval; Q6; BR-7.1–7.4 and Q9; the reads and the branch scope; the books balanced and TA-14. `savings-races.test.ts` (5 races × 50): two remittances on one collection (TA-13, no double credit), approval against cancellation, a retried recording, D1 against reassignment, two withdrawals of one balance |
| Contracts | `endpoints/savings.ts`: 17 endpoints (§4); the route map is 99 operations |
| API | `modules/savings` (repository, service, routes): commands answer with what they wrote; a refusal by the database alone is recorded best effort; branch resolvers for a customer's and a collection's branch; the audit catalog mirror; the module may import `customers` (its branch lookup) |
| Tests (API) | `savings/savings-api.test.ts` (7); the authorization matrix, policy and isolation matrices with savings resources and bodies; the writer guard's inventory and the coverage guard's two tests for each of the eight pairs; the transaction classes |

The gate (2026-10-26): `format:check`, `lint`, `typecheck`, `build`, the contracts' `openapi:check`, `test` (contracts
102, db 855, api 1887) and `test:concurrency` (31: P5's, P6's and P7's races and the five savings races, 50 runs each)
— green. The frozen route map is 99 operations.

## 10. The gate review (2026-10-26) and its resolution

The independent reviewer found P8 not ready to close, on two findings; both are resolved in revision 3, in the forward
migration `20261027000300_savings_review`. The project lead asked for every blocker to be found and fixed without waiting
for the reviewer; the self-review that followed is recorded with them.

| # | Finding | Resolution |
|---|---|---|
| R1 (high) | A waiting package change: a collection recorded under the old package, after the cycle had ended, opened the next cycle on the new package at approval without its amount checked against it | A recording is checked against the package that will govern it — the next cycle's when a change waits and the current cycle has ended — and records that package. An approval puts a collection in the cycle whose days hold its collection day (a new one after the last) and refuses one recorded under another package than that cycle's (`package_changed`, 422 `PACKAGE_CHANGED`; nothing is written, the business cancels it and the agent records it again). Tests: the next package governs once the cycle ends (₦1,000 refused, ₦2,000 recorded and opening cycle 2 on the new package); an immediate change leaves a recorded collection refused with nothing written, then cancelled and recorded again; a collection approved late joins the cycle holding its day without a second fee; the API answer |
| R2 (medium) | The lock-order guard skipped the posting core's projection lock whenever any projection was held FOR NO KEY UPDATE — a table-level exception that did not prove the same rows were held | The exception is removed. `ledger.post_entry` is split: it takes the lines' projections (one sorted call) and calls `ledger.post_entry_locked`, which re-asserts each NOWAIT and waits for nothing (L6, not executable by the app); `ledger.post_template_locked` and `ledger.post_reversal_locked` post through it, and the savings commands use them after taking every projection in their own footprint. A projection a caller does not hold is taken at once or the command fails (`lock_not_available`) — never waited for, so no row set needs proving. Self-tests: the waiting core after the customer fails the order even with the projections held; the `…_locked` core passes held or not. A test shows a projection held elsewhere fails the locked core at once; a new race (50 runs) shows a remittance waits at its own up-front acquisition behind a posting to the same customer, then approves |
| S1 (self-review) | P8-12's cycle rule assigned a collection approved late to the latest cycle even when an earlier cycle held its day | resolved with R1: the cycle that holds the day |

| S2 (self-review) | The gate's first run after the fixes hit a deadlock — two test files dropping their injected audit triggers at once (Postgres's report names both statements; no product code was involved), likelier with P8's sixteen new injected-failure tests | the test helper changes its triggers in one transaction under an advisory lock, then the table's lock, so the files take turns (`test/support/audit.ts`; the purge CLI test uses it too) |

The gate (2026-10-26, revision 3): `format:check`, `lint`, `typecheck`, `build`, `openapi:check` green; `test`: contracts
102, db 859, api 1888 — every test passed; the run reported one Vitest worker RPC timeout ("onTaskUpdate", no test
affected) on a machine with 0.4 GB of 7.7 GB free; `test:concurrency` 32 (six savings races, 50 runs each) green.
