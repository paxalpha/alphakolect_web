# P8 implementation plan — savings

**Status: revision 1 (2026-10-26) — mapped; the owner's answers asked.** Planned in one pass, to be built in one pass, as
P6 and P7 were ("map everything out and execute in one go"). Decisions that would go to the project lead take the
recommended option (his standing instruction) and are recorded in §8. The owner's decisions are asked in
`docs/business/P8_OWNER_SAVINGS.md` (Q1–Q11); the plan follows that form's suggested answers until he answers. The gate
review is the independent reviewer's.

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
- `savings.enrolments`: a customer in a package; one active per customer (a partial unique index, BR-5.1). A change of
  package takes effect when the current cycle ends (Q10): it is recorded as the enrolment's next package.

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
  (`customers.current_agent`, D1), the amount valid for the package. Ledger: `collection.cash_recorded` (Dr 1210 the
  agent / Cr 2190) — the customer's savings do not move (BR-5.6). The agent's 1210 sub-account is opened by its own
  idempotent call before the first recording (P6-2).
- Cancelling (owner Q6): staff with the remittance permission, before approval, with a reason; the recording's entry is
  reversed (BR-11.1).

### 3.4 Remittances (owner Q5; BR-5.3, 5.5, 5.6; TA-13)

- `savings.remittances`: an agent's hand-over, made and approved in one step by staff with the permission, naming the
  collections the cash covers; the rest stay `recorded` (Q5); the total and who approved it are recorded.
- Approval, per collection, in ascending id: `collection.cash_confirmed` (Dr 1200 / Cr 1210 agent; Dr 2190 / Cr 2100
  customer), then the fee as its own entry — `fee.first_contribution` or `fee.percentage`, with the narrative BR-6.2
  asks for, e.g. "2% deducted for merchant on 2026-10-26 09:14".
- Lock order: the collections (one sorted helper call), then **every projection the approval will post to, in one sorted
  acquisition**, before the first entry is inserted; each posting then re-takes projections it already holds, so nothing
  is waited for after a contested insert (L3).

### 3.5 Withdrawals and target savings (owner Q7, Q8, Q9; BR-7.1–7.4)

- `savings.withdrawals`: from collection savings (2100) or target savings (2110), to cash (Q8: loans later); one person
  with the permission (Q7); refused above the balance — the ledger's non-negative rule on the locked projection (BR-7.4);
  the balance goes down at once (BR-7.3). Idempotent by the request's key (P6's records, TA-6).
- `savings.target_goals`: an optional goal (amount and/or date); money moves in from collection savings
  (`savings.to_target`) by staff with the permission; withdrawable at any time (Q9).

### 3.6 Statements for the customer (BR-5.6)

The customer's app and the business see a recorded collection as "recorded by agent — awaiting confirmation" until
approved; the savings balance moves only on approval. The reads list collections by status for a customer, an agent
and a remittance.

## 4. Interfaces

| Endpoint | Who | |
|---|---|---|
| `GET/POST /v1/merchant/packages`, `PATCH …/{packageId}` | `merchant.savings.read` / `merchant.packages.manage` | packages |
| `PUT /v1/merchant/customers/{customerId}/enrolment` | `merchant.packages.manage` (branch) | enrol, or the next cycle's package |
| `GET /v1/merchant/customers/{customerId}/savings` | `merchant.savings.read` (branch) | balances, cycles, collections |
| `GET /v1/merchant/collections` | `merchant.savings.read` (branch) | by agent, status, day |
| `POST /v1/merchant/collections/{collectionId}/cancellation` | `merchant.remittances.approve` (branch) | Q6 |
| `GET/POST /v1/merchant/remittances` | `merchant.savings.read` / `merchant.remittances.approve` | approve the collections an agent's cash covers |
| `POST /v1/merchant/customers/{customerId}/withdrawals` | `merchant.withdrawals.create` (branch) | Idempotency-Key |
| `POST /v1/merchant/customers/{customerId}/target-transfers` · `PUT …/target-goal` | `merchant.withdrawals.create` (branch) | Idempotency-Key |
| `POST /v1/agent/collections` · `GET /v1/agent/collections` | agent (their own customers) | record (idempotent); today's |
| `GET /v1/customer/savings` | customer | their balances and collections, pending included |

Activity events (atomic, pattern A, identifiers and amounts only — TA-14): `savings.package_created`,
`savings.package_updated`, `savings.customer_enrolled`, `savings.collection_recorded`, `savings.collection_cancelled`,
`savings.remittance_approved`, `savings.withdrawal_made`, `savings.target_transfer_made`, `savings.target_goal_set`;
refusals best effort.

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
| P8-4 | The agent's 1210 sub-account | opened by its own idempotent call before the first recording (P6-2) |
| P8-5 | A customer deactivated after a recording | the recording stays; its approval is refused by the ledger (P7-13), and the business cancels it |
| P8-6 | Gate | one review of P8 by the independent reviewer at the end |

## 8. Revision log

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-10-26 | First plan; the owner's questions asked |
