# P9 implementation plan — payments

**Status: revision 8 (2026-11-19): the payments provider is Paystack and TransactPay is removed (§16). §16 supersedes every
statement about TransactPay in §1 to §15, which are kept as the record of how P9 got here. The independent reviewer's
conditional code-scope approval at revision 7 was for the TransactPay adapter: the Paystack adapter, the webhook's signature
check and the provider-scoped claims are new and are for the reviewer's verdict (§16.8). The project lead's closure is still to
be recorded. Not approved for live money or production migrations.** Planned and built in one pass, as P6 to P8 were.
Decisions that would go to the project lead take the recommended option (his standing instruction) and are recorded in §7
and §16.5. The owner answered `docs/business/P9_OWNER_PAYMENTS.md` (Q1–Q8) on 26 October 2026 and
`docs/business/P9_OWNER_PLATFORM_WALLET_PERMISSION.md` on 31 October 2026, each with the suggested option. The change of
provider raises questions for the owner, in `docs/business/P9_OWNER_PAYSTACK.md`: answered on 19 November 2026, each with the
suggested option (§16.11). The TransactPay forms
(`P9_TRANSACTPAY_QUESTIONS.md`, `P9_TRANSACTPAY_FOLLOWUP.md`) are superseded; the follow-up was never sent. The gate review is
the independent reviewer's.

| | |
|---|---|
| Branch | `feat/p9-payments`, from the P8 tip (P8 closed 2026-10-26) |
| Inputs | `TARGET_ARCHITECTURE.md` §8 (wallets), §12 (TransactPay boundary), §20 (jobs); `TARGET_ARCHITECTURE_REVIEW.md` TA-2, TA-8, TA-11 (due before P9); `RESTRUCTURING_MAP.md` P9 row and §8 (TransactPay's facts); `BUSINESS_RULES.md` 2.3, 2.4, 4.1–4.5; the P0 provider port and FakeProvider (`apps/api/src/integrations/payments`); the legacy TransactPay client (`legacy/current-system/backend/utils/transactPay.js`, read for its endpoints only) |
| Exit (RESTRUCTURING_MAP) | BR-2.3 test; a replayed or forged event cannot credit (test); the reconciler detects drift (test) |

## 1. Scope

**In P9:** the provider port completed and a TransactPay adapter (sandbox first); a business's Live wallet, created by a
job after its email is confirmed (BR-2.3), never before; AlphaKolect's Platform Live wallet (BR-4.3, Q6); provider events
received, stored raw and acted on only after being confirmed with TransactPay; money arriving in a Live wallet recorded
in the books (Q1); payment orders with a state machine that survives timeouts (TA-8), exercised by tests and ready for
billing; the reconciler; the first background worker (TA-11); customer Live wallets built behind a switch that is off
(OPEN-12, Q7).

**Not in P9:** money leaving a business's wallet for real (Q2: the first payment out is the subscription, P10; bank
payouts with OPEN-7); Live-wallet collections and repayments (P8b, after OPEN-12); KYC limits (P12, enforced in payments
when built); closing the old virtual accounts (Q3) — an operator task once TransactPay answers B3.

## 2. The findings due before P9

| Finding | Settled by |
|---|---|
| TA-2 the custody ledger and the journal traces | No custody ledger (P6 decided; customer wallets wait for OPEN-12). Reconciliation compares each Live wallet's account (merchant 1100, platform 1100) with the provider's balance (§3.6). The traces are written out in §3.5 for: money into a business's wallet; a business → platform transfer (the subscription, built in P10 on these orders); a provider transaction we have no record of. The customer and loan traces wait for OPEN-12 and P8b/P11 |
| TA-8 a provider timeout is not a failure | Payment orders have an `unknown` state, resolved only by asking the provider (§3.4); resubmission only if TransactPay confirms idempotency on our reference (D2); the ledger posts once per `(provider, provider_tx_id)`; webhooks acknowledged only after the raw event is stored, with size and rate limits, and confirmed through the API whether or not they are signed (C2). The questions are put to TransactPay (form A–F) |
| TA-11 jobs have a scope and an owner | The worker connects as its own role, `alphakolect_worker` (P9-R1), never as the migrator. Its functions are narrow and take the business from the row they act on, never from the caller, and the reconciler reads through one narrow function (§3.7, P9-1, P9-9). A test shows a credit touches only the business whose wallet it is |

## 3. Design

### 3.1 The provider port and its adapters

- The port (`PaymentProvider`, P0) stays the domain's only view of a provider. `FakeProvider` remains the deterministic
  test adapter; its contract suite runs against every adapter.
- `TransactPayProvider`: base URL and keys from the environment (sandbox and production), never in code; the endpoints
  the legacy client proves (create a virtual account with an RSA-encrypted alias, account details, balance, transaction
  details) and those TransactPay documents for transfers and listing (D1, C4). A capability it lacks (no listing) is
  declared, and the reconciler works without it (§3.6).
- Every call has a timeout; a timeout is reported as unknown, never as a failure (TA-8).

### 3.2 Live wallets (BR-2.3, 4.1–4.3; Q6, Q7)

- `payments.live_wallets`: owner (merchant, platform, or customer), the provider's reference, account number, name and
  bank, status (`provisioning`, `active`, `closed`, `failed`), the ledger account it mirrors (merchant or platform 1100).
- A business's wallet is requested by the worker's sweep of the active businesses (a business is active only once its
  email is confirmed, BR-2.3; P9-8). Each has a fixed alias; the worker asks the provider for the alias first and creates
  the account only if there is none, so a timeout never makes a second one (TransactPay B1: creation is not documented
  as idempotent). A business never confirmed gets nothing (test). A failed creation is retried with a growing delay and
  then left `failed` for the platform team.
- The Platform Live wallet is created once by the super admin (Q6).
- Customer wallets: the same path, behind `payments.customer_live_wallets`, off by default and refused in production
  configuration until OPEN-12 (Q7).

### 3.3 Provider events (TA-8; the exit's forged and replayed events)

- `POST /v1/webhooks/transactpay`: body size limited, rate limited, no session; the raw body and headers are stored
  (`payments.provider_events`) and only then answered 200. A signature, if TransactPay offers one (C2), is checked and
  recorded, but never trusted alone.
- A job confirms each stored event by fetching the transaction from the provider (`getTransaction`), and acts only on
  what the provider returns: the amount, the account and the status come from the provider, never from the event.
- Each provider transaction is acted on once: `payments.provider_transactions` is unique on `(provider,
  provider_tx_id)`, and its ledger posting uses that as its idempotency key. A replayed event finds it done; a forged
  event is not confirmed by the provider and credits nothing (tests). A transaction has no business column: it is the
  provider's, may belong to nobody yet (Q4), and finds its business through its wallet.
- Late, duplicate and out-of-order events: the same answer again is a duplicate; an answer not final yet is looked at
  again. A contradictory one (another status or amount than recorded, such as a reversal) goes to the platform team for
  review: nothing is credited or debited automatically (E1).

### 3.4 Payment orders (TA-8)

- `payments.payment_orders`: from wallet, to (wallet or bank account), amount, our reference (unique), purpose, state:
  `created` → `submitted` → `succeeded` | `failed`, with `unknown` after a timeout or an unclear answer.
- A `created` order becomes `unknown` when it is claimed, before anything is sent: a worker that dies after sending
  leaves it to be looked up, not sent twice. `unknown` is resolved only by looking the transfer up by our reference
  (D3), and is never resubmitted (D2 is unconfirmed). An order has no business column: it can cross from a business to
  the platform (P10).
- The ledger posts when the provider confirms success, once, keyed by the provider transaction; a failure posts nothing.
- No network call is made while a database transaction is open (TA-9): an order is written, committed, sent, and its
  answer written in a new transaction.
- In P9 orders are created by tests and the platform console only (Q2); billing (P10) is their first user.

### 3.5 The journal traces (TA-2)

| Trace | Ledger | Entry | Provider reference | Reconciliation |
|---|---|---|---|---|
| Money arrives in a business's wallet | the business's | Dr 1100 Business wallet / Cr 2290 Money received — to classify (Q1; a new chart account and template `wallet.received`) | the provider transaction | 1100 equals the provider's balance of the business's account |
| The business classifies it | the business's | Dr 2290 / Cr the account chosen: one of the business's own, not a customer's or an agent's (P9-11) | — | none (books only) |
| A business pays AlphaKolect (P10) | the business's, and the platform's | business: Dr 5100 / Cr 1100 (`subscription.paid`); platform: Dr 1100 Platform wallet / Cr 4100 Subscription income | the transfer | both 1100s equal the provider's balances |
| A provider transaction we have no record of | the platform's | none until resolved (Q4): the transaction is stored as unmatched; resolving it posts the entry its owner's trace gives | the provider transaction | listed until resolved |

### 3.6 The reconciler (the exit's drift test; Q5)

- Per Live wallet, regularly: the provider's balance of that account against the ledger account it mirrors. If the
  provider only has a pooled balance (B4), the pooled balance against the sum of all Live-wallet accounts.
- TransactPay documents no way to list transactions (C4), so the balance comparison is what finds a missed notification.
  It finds the difference, not the transaction: §10 records this limit.
- A difference is recorded (`payments.reconciliation_findings`) and shown to the platform team at once; nothing is
  changed automatically (Q5). A test makes the provider and the books disagree and sees it found.

### 3.7 The worker (TA-11)

- `apps/api/src/worker.ts`, a second entry point of the same app, connecting as `alphakolect_worker`. The work is kept in the
  domain's own rows (wallets, events, orders), claimed with a lease using `FOR NO KEY UPDATE SKIP LOCKED` (P9-1): several
  workers can run, a dead one loses nothing, and no claim waits.
- Each task claims in one short transaction, calls the provider with none open, and records the answer in another (P9-4).

## 4. Interfaces

| Endpoint | Who | |
|---|---|---|
| `GET /v1/merchant/wallet` | `merchant.wallet.read` | the account number, name, bank and balance; "being set up" while provisioning |
| `GET /v1/merchant/wallet/receipts` · `POST …/{receiptId}/classification` | `merchant.wallet.read` / `merchant.wallet.classify` | money received, and recording what it was for (Q1) |
| `POST /v1/webhooks/transactpay` | none (stored, then confirmed with the provider) | TransactPay's notifications |
| `GET /v1/platform/payments/wallets` · `…/unmatched` · `…/findings` | `platform.payments.read` | every Live wallet, unmatched transactions, reconciliation differences |
| `POST /v1/platform/payments/unmatched/{id}/resolution` · `…/findings/{id}/resolution` | `platform.payments.resolve` | Q4, Q5 |
| `POST /v1/platform/wallet` | `platform.wallet.create` (super admin only; not grantable) | requests the Platform Live wallet, once (Q6); the worker creates it |

Activity events (atomic, identifiers and amounts only): `payments.wallet_provisioned`, `payments.money_received`,
`payments.receipt_classified`, `payments.finding_recorded` (the platform's record: Q5, the business is not told),
`payments.unmatched_resolved`, `payments.finding_resolved`, `payments.platform_wallet_requested`. Sensitive reads, one per
page: `platform.wallets_read`, `platform.unmatched_read`, `platform.findings_read`. A refusal by the database alone is
recorded best effort, as in P6–P8.

## 5. Tests

- BR-2.3: a business that has not confirmed its email gets no wallet and no job; confirming it requests one, once.
- A forged event (the provider does not confirm it) credits nothing; a replayed event (the same provider transaction
  twice, also concurrently) credits once; an event whose amount differs from the provider's posts the provider's.
- A payment order that times out is `unknown`, not failed; it is resolved by the lookup; it is never sent twice without
  the provider's idempotency; it posts once.
- The reconciler finds a difference between a wallet's account and the provider's balance, and changes nothing.
- A credit touches only the business whose wallet it is (TA-11).
- The FakeProvider passes the contract suite. TransactPayProvider is tested against a stubbed server (requests, RSA
  encryption, the status table, and no clear answer being UNKNOWN_OUTCOME); a small sandbox suite runs on demand with
  sandbox keys, never in CI, and has not been run yet (§10).
- Guards: lock order, grants, R19, TA-14, the matrices, the coverage and writer guards.

## 6. Obligations passed on

P10: the subscription payment on these orders, and restoring a suspended business only on a confirmed charge (TA-12); it
needs VA-to-VA transfers, which TransactPay's documentation does not show (D1). P15: running the worker in production, and a retention rule for stored provider events.
P8b: customer Live wallets and Live-wallet collections once OPEN-12 is settled. OPEN-7: payouts to bank accounts. Operator
task: closing the old virtual accounts (Q3) once TransactPay answers B3.

## 7. Decisions (recommended options, the project lead's standing instruction)

| # | Decision | Taken |
|---|---|---|
| P9-1 | The job runner | revised at the build: the domain's own rows with leases, polled by a `worker.ts` entry point, not pg-boss. pg-boss creates its own tables and so needs rights the app role must not have (TA-11), and the rows already carry each job's natural key and state. Departs from TARGET_ARCHITECTURE §20 for these jobs; billing (P10) can reuse it or revisit |
| P9-2 | Trusting an event | never: every event is confirmed by fetching the transaction from the provider, signed or not; the amount and account come from the provider |
| P9-3 | A provider without a transaction listing | the reconciler compares balances, per wallet where the provider can say and otherwise in total; a listing, if TransactPay confirms one, is added as the missed-notification path |
| P9-4 | Network calls and transactions | never inside an open database transaction (TA-9): write, commit, call, write the answer |
| P9-5 | Customer Live wallets | built, and requested by a function no running process may execute (P9-R1): turning them on takes a migration, written once custody is settled (OPEN-12) |
| P9-6 | Sandbox tests | the TransactPay contract suite runs on demand with sandbox keys; CI runs the FakeProvider's |
| P9-7 | Gate | one review of P9 by the independent reviewer at the end |
| P9-8 | When a wallet is requested | by the worker's sweep of active businesses, not inside email verification: the P5-pinned verification function stays as it is, a missed request is picked up by the next pass, and the rule is the same (BR-2.3) |
| P9-9 | Tenant context for jobs | the worker's functions are definer functions that take the business from the wallet or order they act on, so no caller-supplied tenant exists to get wrong |
| P9-10 | The worker's role | revised at the gate review (P9-R1): the worker connects as its own role, `alphakolect_worker`, the only one that may execute its functions. The API keeps `store_event` alone of them |
| P9-11 | What money received can be classified to | the business's own accounts only. A customer's savings move through collections (BR-4.5), and Live-wallet collections come with P8b |
| P9-12 | The Platform Live wallet's permission | a non-grantable `platform.wallet.create`, as P5's super-admin-only actions are; its wording is asked in its own form |
| P9-13 | A transaction under review | closed with a note. One with an entry keeps it (a correction is a person's manual entry); one that later proved successful and has no entry can be credited |

## 8. Revision log

| Rev | Date | Change |
|---|---|---|
| 8 | 2026-11-19 | The provider is Paystack (§16): adapter, signed notifications, fees, provider-scoped claims, conditions rewritten, owner form |
| 7 | 2026-11-10 | The reviewer's second re-check (§15): the four rulings, R2 hardened, the API refuses the worker's connection in production; condition 10 |
| 6 | 2026-10-31 | The sandbox's first results (§14): real not-found answers, creation not idempotent, the wallet holds the lookup's account |
| 5 | 2026-10-31 | The money-flow matrix and three journeys (§13); P9 stays open |
| 4 | 2026-10-31 | The re-check: code scope approved at `5fa190b`, live money not (§12); condition 9 added |
| 3 | 2026-10-31 | The gate review's findings resolved (§11); the permission's wording answered; P9-5 and P9-10 revised |
| 2 | 2026-10-30 | The answers recorded; built as §9 maps; decisions P9-8 to P9-13, P9-1 and P9-3 revised; §10 the conditions before real money |
| 1 | 2026-10-26 | First plan; the owner's questions and TransactPay's asked |

## 9. The build

| Part | What |
|---|---|
| Migration `20261028000100_payments_core` | account 2290 in both charts (existing ledgers included), the templates `wallet.received` and `platform.wallet_received`; `payments.live_wallets`, `provider_events`, `provider_transactions`, `receipts`, `payment_orders`, `reconciliation_findings`; RLS on the tenant tables, no app privilege on any (B1) |
| Migration `20261028000200_payments_functions` | five permissions, the events; the worker's `request_wallets`, `claim_wallets`, `record_wallet_created`, `record_wallet_failed`, `store_event`, `claim_events`, `record_event`, `claim_orders`, `record_order`, `reconcile_wallets`, `record_finding`; the business's `merchant_wallet`, `list_receipts`, `classify_receipt`; the platform's `platform_list_wallets`, `platform_list_unmatched`, `platform_list_findings`, `resolve_unmatched`, `resolve_finding`, `request_platform_wallet`; internal `create_order`, `template_accounts` |
| Lock order | payments tables are category 18. Footprints, all pinned in the guard: `record_event` 14:NKU 18:NKU 18:W +15 +18; `record_order` 14:NKU 18:NKU +15; `classify_receipt` 2:S A3:NKU 7:S 14:NKU 18:NKU +15; `resolve_unmatched` A1:S 14:NKU 18:NKU +15 +18; the claims and `store_event` wait for nothing |
| Provider | the port gains `capabilities`, `findVirtualAccountByAlias`, `findTransferByReference`, `UNKNOWN_OUTCOME` and `UNSUPPORTED`; `FakeProvider` gains targeted failure injection; `TransactPayProvider` |
| Config | `PAYMENT_PROVIDER`, the TransactPay keys, `CUSTOMER_LIVE_WALLETS`; production refuses the fake provider and customer wallets |
| API and worker | `modules/payments` (repository, service, routes, worker tasks), `worker.ts`; 10 endpoints, the route map is 109 operations |
| Tests (db) | `payments.test.ts`, `payments-races.test.ts` (5 races x 50): one transaction with two events, an unmatched one, double classification, double credit, one difference found twice; the two-test coverage of the worker's events |
| Tests (API) | `payments/worker.test.ts` (the worker against the real database through the webhook), `payments/transactpay-provider.test.ts`, `payments/payments-api.test.ts`; the matrices, writer and coverage guards, transaction classes |
| A test helper | the matrices' snapshots leave out what a worker in a parallel test file keeps up to date |

Gate at commit `3017ad4`, on a clean tree, 31 October 2026, every step exit 0: `format:check`, `lint`, `typecheck`,
`build`, `openapi:check`; `test` (contracts 105, db 902, API 2073 passed, 2 skipped: the TransactPay sandbox suite, §10);
`test:concurrency` 37. Run with `npm_config_workspace_concurrency=1`: packages one at a time, because this machine has too
little free memory to run them together, and an earlier parallel run timed out for that reason alone.

## 10. Before real money flows

**Superseded by §16.4 (revision 8): written for TransactPay.** Kept as the record.

The exit criteria are met against the FakeProvider. P9 has **not** been run against TransactPay: no sandbox keys were
available, so `TransactPayProvider` has been tested only against a stub built from the old client and the documentation.
Nothing here touches production, and in P9 nothing leaves a wallet (Q2). Before a live wallet is switched on:

| # | Condition | Why |
|---|---|---|
| 1 | A real deposit through the webhook and the worker | field names, the amount's unit (taken as naira from the old client) and the status table are unproven against a real session. The rest of the sandbox suite has run (§14); TransactPay documents no way to simulate a deposit into a virtual account (A2), so this needs their answer or a real test deposit |
| 2 | TransactPay confirms that a session's details name the destination account (C5) | without it, every deposit lands as unmatched: safe, but every one needs a person |
| 3 | TransactPay confirms what the balance enquiry covers (B4) | the answer has `availableBalance`, which the reconciler reads, and `collection`. If virtual-account money lands in `collection`, every comparison is a false difference |
| 4 | TransactPay answers webhook authenticity (C2), and a transaction listing (C4) | events are confirmed by the API regardless; but with no listing a missed notification shows only as a difference, with no transaction a person can credit in the system: a listing, or a way to enter a session id, is needed |
| 5 | For billing (P10): VA-to-VA transfers (D1), payout idempotency (D2), the payout's required fields (the documentation lists `accountName`, which orders do not carry yet) | the adapter refuses VA-to-VA today, and orders are never resent |
| 6 | Closing the old virtual accounts (Q3) | an operator task, once TransactPay answers B3 |
| 7 | TransactPay confirms that a lookup always sees a new account at once | the sandbox shows creation is **not** idempotent (§14). Only the lookup prevents a second account, and if it lags after a lost answer a second real account is made. Money sent there arrives unmatched: for a person, not lost |
| 8 | Each environment re-runs the role bootstrap before these migrations, with `worker_password` | the migration grants to `alphakolect_worker` and stops if the role is missing; the worker needs `WORKER_DATABASE_URL` |
| 9 | Each environment's bootstrap confirms that `alphakolect_worker` has no role memberships | `roles.sql` re-applies attributes and the password, and does not remove a membership that already exists. The tests prove zero only on a fresh role (the re-check's observation) |
| 10 | The worker's credentials reach its runtime alone (ruling 4) | the worker's role can fabricate a confirmed credit to any wallet. In production the API refuses to start with `WORKER_DATABASE_URL` set. P15 must prove a separate process and service identity, no worker credentials in the API's container, database access limited to its endpoint, and independent rotation |

## 11. The gate review (2026-10-31)

The independent reviewer's report on `3017ad4`: changes requested. Migrations are unmerged and undeployed, so the fixes are
in them directly.

| Finding | Resolution | Regression tests |
|---|---|---|
| **P9-R1** The web role could call the worker's functions, and so fabricate a confirmed credit; the caller chose whether customer wallets were requested | A new role, `alphakolect_worker`, holds the worker's functions, and no table privileges, session functions or role memberships. The API keeps `store_event` alone. `request_wallets` lost its Boolean; `request_customer_wallets` is executable by no running process. The worker refuses to start without `WORKER_DATABASE_URL`; `CUSTOMER_LIVE_WALLETS` is gone | `payments.test.ts` "P9-R1"; `function-grants.test.ts` (inventory and effective privileges, per role); `worker.test.ts` through the API's own connection |
| **P9-R2** A failed alias lookup read as "no account", and led to creating one | Only a JSON 404 is "no such account"; every other answer is `UNKNOWN_OUTCOME`, which stops creation | `transactpay-provider.test.ts` (400, 401, 403, 429, 5xx, malformed, a non-JSON 404); `worker.test.ts` through the worker: only a stated no creates |
| **P9-R3** Up to 50 rows were claimed at once on a 300-second lease, so a late one could be claimed by a second worker | Rows are claimed one at a time. A call with an effect starts only if it ends, at its timeout, inside the lease; the worker refuses to start if a provider's timeouts could outlast the lease. Each claim has a token, and an answer with an older one is `stale` and changes nothing | `worker.test.ts`: a lookup outlasting its lease, one account created; `payments.test.ts` "P9-R3": wallets, events, orders |
| **P9-R4** Amounts were cut at two decimals | A transaction's amount below a kobo is refused and nothing posts; only a balance rounds, down, as documented in the adapter | `transactpay-provider.test.ts`; `worker.test.ts` |
| **P9-R5** Another destination account for a known transaction read as a duplicate | The account is compared; a difference goes to review. The wallet and the entry stay, and the row shows the account now named | `payments.test.ts` "P9-R5" |
| **P9-R6** The payout lacks `accountName` and a name enquiry | Not a P9 closure blocker, since nothing leaves a wallet in P9. **A prerequisite of P10**, with VA-to-VA transfers and payout idempotency (§10 condition 5) | — |
| The branch was behind `main`; the owner's approval was outstanding | `origin/main` merged (merge commits only, no content); the owner approved the wording on 31 October 2026 | — |

Found in the same pass, in the same classes, and fixed:

- `getTransaction` read any unsuccessful answer as `NOT_FOUND`. An expired key or a rate limit could have ended a real deposit's event as rejected. Only a JSON 404 is `NOT_FOUND` now.
- `transfer` and `createVirtualAccount` read a 401, 403, 408 or 429 as a stated refusal, which would have failed an order that may have gone through. Only a 400 or 422 is a refusal now.
- An event whose concurrent duplicate lost the insert was closed as a duplicate without being compared, so a contradiction arriving at that moment was lost. It is looked at again at once, and compared (`payments-races.test.ts`).
- An event with no usable answer was retried in silence. After 8 looks it opens one `event` finding for the platform team and is still looked at. The finding's amounts are a marker (1 and 0), not money; the log names the event. Listing such events individually is left for the console's later work.

What remains true: a worker cannot fully rule out a duplicate account at the provider without the provider's help (§10 condition 7); the lease closes the case where two workers overlap, not a lookup that lags at TransactPay.

Gate at commit `5fa190b`, on a clean tree, 31 October 2026, every step exit 0: `format:check`, `lint`, `typecheck`, `build`,
`openapi:check`; `test` (contracts 105, db 909, API 2083 passed, 2 skipped: the TransactPay sandbox suite); `test:concurrency`
38. Run with `npm_config_workspace_concurrency=1`. The run before it, at `ba9487a`, did not pass: every API test passed but
Vitest reported its worker RPC timeout, and a payments race timed out at 30 seconds, which took the next race down with it on
their shared connections. That suite takes 29 seconds alone. The machine has too little free memory, so the suite's limit was
raised (`5fa190b`), with no change to code under test.

## 12. The re-check (2026-10-31)

The independent reviewer re-checked the pushed branch, with `5fa190b` as the gated commit and `ecab2ce` as the tip (one commit
later, adding only the gate record).

- **Approved for P9 code scope.** R1 to R5 are resolved in the code inspected, and the fixes of §11 were checked. R6 is
  correctly carried to P10.
- **Not approved for live-money activation, nor for applying these migrations to production.** The go-live decision is
  separate. §10 stays as the release gates; the reviewer names the sandbox's answers (condition 1), duplicate accounts
  (condition 7) and the environment's setup (conditions 8 and 9).
- **What the review rests on.** The reviewer inspected the code and the recorded gate, and did not run the suites. GitHub has
  no status checks for `5fa190b`, so no CI run has been certified.
- No pull request existed at the re-check.

## 13. The money-flow coverage check (2026-10-31)

The reviewer narrowed §12: it approved the fixes to the findings, and did not establish that every money-flow journey had been
exercised. P9 stays open until the scenario coverage is reviewed. `P9_MONEY_FLOW_MATRIX.md` maps each scenario to its test,
gives the gaps the audit found, and lists four differences from the review's expected results for its ruling. The new tests,
including three end-to-end journeys, are in `apps/api/test/payments/worker.test.ts`. No production code changed. TransactPay's
sandbox has not been run: its assumptions stay release blockers (§10).

## 14. The sandbox's first results (2026-10-31)

**TransactPay's results, kept as the record; superseded by §16.** The lesson stands: a provider's not-found answer is what its sandbox says, not what the documentation suggests.

Run with test keys only, which TransactPay documents as not interchangeable with live ones. The host is the same for both, so
the sandbox suite refuses any key not marked as a test key, and reads only `TRANSACTPAY_TEST_*`. Live keys were not used.

| Question | What the sandbox answered | What changed |
|---|---|---|
| An unknown alias | HTTP 200, `status: false`, `code: "04"`, "Account not found" | **The review's JSON 404 was an assumption, and wrong:** no wallet would ever have been created. Only this answer is "no such account" now; a 404 is an unclear answer |
| An unknown session | HTTP 200, `status: false`, `code` empty, "SessionId not found" | The same: no forged event would ever have been rejected |
| An unknown payout | HTTP 200, `status: false`, `code: "04"`, "Payout not found" | The same; any other answer without a reference is now `UNKNOWN_OUTCOME` |
| The same alias created twice (B1) | Two different account numbers; the lookup names the first | **Creation is not idempotent.** After creating, the worker reads the alias again and records the lookup's account. The lease bound allows for the third call |
| A lookup straight after creation | Found | Observed a few times only (§10 condition 7) |
| The balance | `availableBalance` and `collection`, both 0 | Nothing yet: §10 condition 3 |
| Response fields of creation and lookup | As the adapter reads them | Nothing |
| The account number's form | Letters and digits in test mode (`TRP` and digits) | Nothing assumes digits: the column and the contract are free text. A live account's form is unseen |

R2's rule stands, that only a definite answer creates an account, but which answer is definite has changed, so the reviewer
should look at it again. A few test virtual accounts now exist in the sandbox from these runs.

## 15. The second re-check (2026-11-10)

The independent reviewer re-checked draft PR #11 at `d16bba3`, with Linux CI green.

- **Code scope: approved conditionally.** The four rulings are accepted (`P9_MONEY_FLOW_MATRIX.md` §7). R2's revised rule is
  accepted, subject to one hardening: a session's not-found was accepted with any code, though the sandbox sent none.
- **Not approved for live money or production migrations.** A real deposit and the balance field are still unproven, and
  TransactPay has to confirm the duplicate-account risk (§10, conditions 1, 3 and 7). The questions for TransactPay are in
  `docs/business/P9_TRANSACTPAY_FOLLOWUP.md`.

| Asked | Done | Tests |
|---|---|---|
| R2: a session's not-found only with no code | The code must be absent, null or empty; the same message with a code is `UNKNOWN_OUTCOME` | `transactpay-provider.test.ts`: absent, null and empty are `NOT_FOUND`; `91`, `04` and `0` are not |
| Ruling 4: the worker's URL must not reach the API | In production the API refuses to start if `WORKER_DATABASE_URL` is set; locally, where one file serves both, it is tolerated. The rest is condition 10, for P15 | `config.test.ts` "ruling 4" |
| A full local gate at the final HEAD | Recorded below | — |

## 16. Revision 8: the provider is Paystack (2026-11-19)

### 16.1 The decision

The project lead changed the provider to Paystack and removed TransactPay, going back into P9 (which was merged on 11 November
and is still open). Nothing had gone live with TransactPay: no real deposit, no live wallet, and its questions were unanswered,
so nothing is migrated. The port (`PaymentProvider`), the worker, the database and the exit criteria are as they were; the
adapter, the webhook and a few rules around them change. What was read of Paystack's documentation on 19 November 2026 is in
16.2. Nothing was run against Paystack: no key was available (16.4).

### 16.2 What Paystack is, against what TransactPay was

| | TransactPay (§3, §14) | Paystack (the documentation) |
|---|---|---|
| A wallet | A virtual account made by an RSA-encrypted alias; found by alias | A **dedicated virtual account (DVA)** for a Paystack **customer**. The customer is the alias as an email address on our own domain, found with `GET /customer/{email}`; its `dedicated_account` is the wallet. Made in two steps, `POST /customer` then `POST /dedicated_account`, which answer at once |
| Not found | HTTP 200, `status: false`, code 04 (seen in the sandbox) | HTTP 404 with `status: false` for a customer, 400 or 404 for a transaction, 404 for a transfer (documented, **not seen**) |
| Money arriving | A session id; no signature; no listing | A `charge.success` notification (`channel: dedicated_nuban`), confirmed by `GET /transaction/verify/{reference}`; **signed**: `Paystack-Signature` (HMAC SHA512 of `t.` and the body with a signing secret, five minutes) and the older `x-paystack-signature` (the body with the secret key) |
| Amounts | Naira, as a string or number | Kobo, as integers; the transaction names its `fees` |
| Balance | `availableBalance`, one for the account | **One balance per integration** (`GET /balance`, kobo, per currency); none per account |
| Between accounts | Not documented | **None.** Money moves only from the balance to a bank account |
| A payout | One call with our reference | A name enquiry (`/bank/resolve`), a recipient (`/transferrecipient`), then `/transfer`; our reference of 16 to 50 of `a-z 0-9 - _`; the documentation does not say a repeat is done once. A code (OTP) may be required unless turned off |
| A listing | None | `GET /transaction` and `GET /dedicated_account/requery` exist; not used (P9-20) |
| Test mode | Sandbox keys; no way to deposit | `sk_test_` keys, `test-bank` accounts, and a demo bank app that makes a transfer into a test account by hand |

### 16.3 What changed

- **The adapter** (`paystack-provider.ts`) replaces `transactpay-provider.ts`. It keeps every rule of P9-R2 to R4: only the
  documented not-found is "no such thing" and acts (creates an account, rejects an event); a timeout, an authentication failure,
  a rate limit, a body that cannot be read, or a not-found with the wrong status or message is `UNKNOWN_OUTCOME`. An amount that is
  not whole kobo is refused. A payment that is not into a dedicated account (a card, a checkout) is not money arriving in a
  wallet: the worker reads it as not found.
- **The webhook** is `POST /v1/webhooks/paystack`. The signature is checked on the exact bytes received: a notification that fails
  is refused (401) and **not stored**; one that passes is stored as it arrived and is still only a lead, confirmed by the API
  (P9-2, P9-15). Only `charge.success` carries a reference to confirm.
- **Two switches, both off by default** (P9-22, P9-23): wallet creation and payouts. They gate what AlphaKolect cannot yet do correctly (a customer's phone and identity; payout fees in the books).
- **Fees.** The books are credited what arrived: the amount less the fee Paystack names (P9-14). Both figures are Paystack's.
- **One balance.** `perAccountBalance` is false, so the reconciler compares the one balance against the sum of every wallet's
  1100 (P9-3, built before). A test shows that what the balance gains is what the books gain, fees included.
- **No transfer between accounts** (`vaTransfer` false). A business's payment to AlphaKolect (P10) cannot be a call to the
  provider: it is a book entry between two wallets (16.6).
- **A payout** is named, made a recipient, then sent. Our reference is sent as it is when Paystack accepts it and as a fixed
  digest when not (P9-18). A step before the transfer that fails means nothing was sent: the new error `NOT_SENT` fails the
  order, where an unclear answer to the transfer leaves it unknown and looked up (TA-8). A transfer that waits for an OTP is
  unknown, and never sent again.
- **Claims are scoped to the provider** (migration `20261119000100`, P9-16).
- **Configuration**: `PAYMENT_PROVIDER=paystack` with `PAYSTACK_SECRET_KEY`, `PAYSTACK_PREFERRED_BANK`,
  `PAYSTACK_WALLET_EMAIL_DOMAIN`, optionally `PAYSTACK_WEBHOOK_SIGNING_SECRET`, and the switches `PAYSTACK_WALLET_CREATION` and `PAYSTACK_PAYOUTS` (default off). A test key outside production and a live key
  in it (P9-19).
- **TransactPay is gone** from the code, the configuration, the tests and the contract. The legacy client under `legacy/` is
  untouched, as legacy. The earlier sections, the migrations' comments and the TransactPay forms are history.

### 16.4 Before real money flows (replaces §10)

None of Paystack's answers has been seen, so every shape the adapter relies on is a documented one. The sandbox suite
(`PAYSTACK_SANDBOX=run`, with `PAYSTACK_TEST_SECRET_KEY` in `apps/api/.env.test`) is written for the not-found answers and account
creation; a deposit needs the demo bank app by hand.

| # | Condition | Why |
|---|---|---|
| 1 | A real test deposit through the demo bank app, the webhook and the worker | The fields (`reference`, `amount`, `fees`, `channel`, `authorization.receiver_bank_account_number`), the amount in kobo and the status are as documented, not seen |
| 2 | The sandbox suite run once, and its not-found answers read (customer 404, transaction 400 or 404, transfer 404) | **Run twice on 24 and 25 November 2026 (evidence `docs/architecture/evidence/p9-paystack-sandbox-2026-11-24/`): 44 of 44 passed on the second run, with the real not-found answers for a customer, a transaction and a payout and the balance read as documented. Provisionally complete, for the reviewer's inspection.** The first run's refusal was the email's reserved ending, not a phone or a category. It can be run again in the cloud (`P9_SANDBOX_IN_CI.md`) |
| 3 | Paystack's business category for AlphaKolect, and what it requires of the customer of a dedicated account: a phone number always, and in some categories a validated BVN and bank account (owner Q4) | AlphaKolect holds neither. **Wallet creation is off** (`PAYSTACK_WALLET_CREATION=off`, P9-23) until this is settled and the data, the consent and the validation are built; a business waits without a wallet, and nothing is lost **The written clarification request was sent to Paystack on 28 November 2026 (`P9_PAYSTACK_REQUIREMENTS_SENT.md`); the reply is awaited, and this stays open until it comes (§16.14).** |
| 4 | The balance: whether `GET /balance` includes a DVA credit at once or at settlement, and whether the fee is taken at deposit | A settlement delay shows as a difference until it settles. The fee is assumed taken at deposit (P9-14) |
| 5 | Whether a customer just made is always found, and whether Paystack refuses a second account for one customer | The same risk as §10 condition 7: a lookup that lags after a lost answer, then a second account |
| 6 | That Paystack accepts a business name as the first name and "Business" as the last, and the account name it builds (owner Q3) | Unseen |
| 7 | The webhook URL and the signing secret set on Paystack's dashboard; the proxy allows Paystack's three documented addresses (52.31.139.75, 52.49.173.169, 52.214.14.220) | Without the secret only the older signature works; the allowlist is a second wall, for P15. **For the sandbox test the tunnel points at the webhook-only door (`pnpm webhook:proxy`, P9-28), never at the API** (`P9_LOCAL_READINESS_REPORT.md` §4) |
| 8 | For payouts (P10): the OTP requirement turned off for the account, the transfer fee and stamp duty accounted for in the books (owner Q9), a payout run in test mode, and `PAYSTACK_PAYOUTS=on` | **Payouts are off** and refused in production (P9-22). A payout that waits for an OTP is unknown and never sent; one that is abandoned, blocked or rejected is a conclusive failure (16.5 P9-25) |
| 9 | Each environment re-runs the role bootstrap before these migrations, with `worker_password`, and confirms that `alphakolect_worker` has no role memberships | **The bootstrap now strips any membership itself (P9-27)**, so a re-run restores a fresh role; the check `packages/db/sql/checks/worker-role.sql` verifies it per environment. Still open: running both in each real environment |
| 10 | The worker's credentials reach its runtime alone | As §10 condition 10; P15 |
| 11 | The owner's answers to `P9_OWNER_PAYSTACK.md` (**given 19 November 2026, §16.11**), custody (OPEN-12) confirmed in writing with Paystack and a lawyer (**outstanding**), the Paystack account live (**not yet**, owner Q8), the live key set in production only | The business's decision; the answers are in, the custody confirmation and the go-live are not |
| 12 | TransactPay's keys revoked wherever they are kept, including `apps/api/.env.prod`; the old accounts closed (owner Q7) | Removal is not complete while a live key exists |
| 13 | A reversal that follows a payout reported successful: a payout reversed afterwards returns the amount to the balance | An order is final once it succeeds, so the books would not follow. P10 decides how a late reversal is posted |

### 16.5 Decisions (the recommended options, the lead's standing instruction)

| # | Decision | Taken |
|---|---|---|
| P9-14 | Fees on money received | The wallet is credited what arrived: the amount less the fee, both Paystack's (the business bears it: owner Q2, asked). The books then equal the balance. If Q2 changes, the fee becomes a platform expense and the wallet is credited whole |
| P9-15 | Signature on notifications | Verified at the door and the notification refused when it fails: the newer signature if a signing secret is set, and the older one, with the secret key. A genuine one is a lead only (P9-2 stands) |
| P9-16 | Claims across providers | A worker claims only rows of its own provider (wallets, events, and orders by their source wallet). A forward migration, `20261119000100`, changes the three claims |
| P9-17 | The wallet's identity at Paystack | The alias, as an email address on our domain (`PAYSTACK_WALLET_EMAIL_DOMAIN`); no person's mailbox is used. The account is found by it, and a repeat makes none (TA-8) |
| P9-18 | A payout's reference | Our reference when it fits Paystack's form, otherwise a fixed digest of it; the transfer and its lookup use the same function. A step before the transfer that fails is `NOT_SENT`: failed, nothing posted |
| P9-19 | Keys | A test key outside production and a live key in it, refused at startup otherwise |
| P9-20 | A listing | Not built: `GET /transaction` and the requery exist, but nothing in P9 uses them. A missed notification is found by the balance, as before (§3.6); a listing with its own path to credit a missed transaction is later work |
| P9-21 | Customer names | First name the owner's name, last name "Business", "Platform" or "Customer"; **no phone is sent, because none is held**, which is why wallet creation is off (P9-23). Paystack decides what it accepts (condition 6) |
| P9-22 | Payouts | **Off** unless `PAYSTACK_PAYOUTS=on`, and `on` is refused in production. Paystack takes the transfer fee, and a ₦50 stamp duty from ₦10,000, from the one balance on top of the amount ("we deduct the transfer amount and the transfer fee"), and the books post the amount alone: every payout would leave a difference nobody explains. Off, `transfer` is `UNSUPPORTED`, so a created order fails unsent and posts nothing. P10, the first to send a payout, defines who bears both charges (owner Q9) and posts them. No payout is created in P9 (Q2) |
| P9-23 | Wallet creation | **Off** unless `PAYSTACK_WALLET_CREATION=on`. Off, the worker requests and claims no wallet (a business waits, nothing counts attempts), and switching on picks every business up. Production may switch it on only after condition 3 |
| P9-24 | An account is a wallet only when stated so | Assigned, active and in naira, all stated, for a lookup and for a creation; a creation's answer must also name the customer asked for. Missing, ambiguous or contradicting fields are `UNKNOWN_OUTCOME`: not activated, and for the platform team to see. A closed account is reported closed |
| P9-25 | Transfer statuses | All nine of Paystack's "how transfers work": conclusive success, reversed, failed, abandoned, blocked, rejected (the last three fail the order); not conclusive pending, received and otp. A status not in the table is not final. Paystack documents that a retry should use the same reference; the worker still never sends again, only looks up |
| P9-26 | The wallet email domain | `PAYSTACK_WALLET_EMAIL_DOMAIN` must end in a real top-level domain: the reserved endings (`.test`, `.invalid`, `.example`, `.localhost`, `.local`, `.internal`, `.lan`, `.home`, `.corp`, `.onion`, `.arpa`) and anything not shaped like a lower-case domain are refused at start, with a message that never echoes the value. Paystack refused `.test` (sandbox diagnostic, 24 November). The suite names its domain and refuses a reserved one. The owner's sender domain `paxalphaltd.com` is not assumed to be the wallets' domain: which domain is a decision for the project lead |
| P9-27 | The worker's role memberships | The role bootstrap revokes every membership of `alphakolect_worker`, or in it, by its grantor, on each run; `worker-role.sql` is the read-only operator check; both are tested (`worker-role.test.ts`) |
| P9-28 | A tunnel for the sandbox test | Points at a loopback door, `pnpm webhook:proxy`, that forwards only `POST /v1/webhooks/paystack` with only the headers the signature needs (no cookie, no authorization), a 64 KiB limit and a capped reply, and answers 404 to everything else. It checks no signature: the API does, on the bytes it is given |
| P9-29 | Where tests run | In GitHub Actions: the main job on every push, and the Paystack sandbox suite on demand (`paystack-sandbox.yml`: the label `paystack-sandbox` or a manual start; a test key only, or it stops). A laptop runs only a small check while writing |

### 16.6 Obligations passed on

- **P10 (billing)** must be revised before it is built: its plan (revision 8, on `feat/p10-billing`) is written around TransactPay:
  VA-to-VA transfers, a "not found is final" rule, a status table, `notFoundFinal` windows, and its questions to TransactPay. With
  Paystack the subscription payment is a **book entry between two wallets with no provider call** (owner Q5); the provider facts
  the plan rests on (its §9.1) are Paystack's. A payout to a bank account is the only call that leaves the balance.
- **P15** runs the worker and proves the condition-10 separation, adds Paystack's addresses to the proxy, and decides a retention
  rule for stored events (unchanged).
- **A listing and the requery** for missed notifications, if the balance's difference proves too blunt (P9-20).
- **Closing the old TransactPay accounts** and revoking its keys (condition 12; owner Q7).

### 16.7 What was built

| Part | What |
|---|---|
| Migration `20261119000100_payments_provider_scoped_claims` | `claim_wallets`, `claim_events` and `claim_orders` take the provider; grants as before. Forward only |
| Provider | `PaymentProvider` gains `verifyNotification`, `feeMinor` on a transaction and the `NOT_SENT` error; `PaystackProvider` (`paystack-provider.ts`); `FakeProvider` accepts every notification; `TransactPayProvider` removed |
| Worker and service | credits the amount less the fee; the lease allows four calls for a wallet and three for a payout; `NOT_SENT` fails an order; the webhook refuses an unsigned notification (401) |
| Contract | `POST /v1/webhooks/paystack` (`receivePaystackEvent`), with a 401; `openapi/v1.json` regenerated |
| Config | `PAYMENT_PROVIDER=fake\|paystack` and the four `PAYSTACK_*` settings; `.env.example` |
| Tests | `paystack-provider.test.ts` (the adapter, signatures, payouts, balance; the sandbox block on demand); `paystack-flow.test.ts` (the worker, webhook and ledger against a stand-in for Paystack: a signed notification, the fee, a card payment, a forged reference, the balance, a payout, `NOT_SENT`, a lost answer); `payments.test.ts` "P9 revision 8" (the scoped claims); `config.test.ts`; the existing worker and API suites on the renamed route |

### 16.8 For the reviewer

The code scope approved at revision 7 was for the TransactPay adapter; this revision replaces it, so it is for a new verdict.
What to look at first: the adapter's not-found rules against the documentation (16.2); the signature check, and that a failed
one stores nothing; the net credit and the balance test; the scoped claims' migration; conditions 1 to 12 as the release gates.
The money-flow matrix (`P9_MONEY_FLOW_MATRIX.md`, §8) maps the scenarios to the tests that now prove them.

### 16.9 The gate

Run on 19 November 2026 on the branch `feat/p9-paystack` (from main, 031e4db), every step exit 0 at its final commit: `format:check`,
`lint`, `typecheck`, `build`, `openapi:check`; `test` (contracts 105, db 910, API 2126 passed and 3 skipped, the Paystack sandbox
block: §16.4); `test:concurrency` 38. Run with `npm_config_workspace_concurrency=1`. Two things the first run found, both fixed:
the pinned inventory of transaction classes (the wallet provisioning was split in two, so its transactions have new names), and a
test of mine that swept every business in the shared test database into Paystack (the flow test now creates only the wallets it
asks for). A test fixture that stored and recorded an event in two steps could lose it to a worker of a file beside it, and
failed once in a parallel run: it is one transaction now. Linux CI is the next witness. Not run: anything against Paystack.

### 16.10 The reviewer's first review of PR #13 (19 November 2026)

Request changes, at `68ee3eb`. Each finding, and what was done:

| Finding | Resolution |
|---|---|
| P1 A dedicated account's customer is incomplete: no phone, and no identity validation where the category requires it | Right: AlphaKolect holds neither, and its category is not known. **Wallet creation is off by default** and cannot make an account until condition 3 is settled and the data, consent and validation exist (P9-23); owner Q4 now names the phone too. Building the collection of a phone and a BVN is a decision for the owner and the privacy policy, so it is not built here |
| P1 An incomplete account response can activate a wallet | An account is a wallet only when stated assigned, active and in naira, and a creation's answer must name the customer asked for (P9-24). Tests: each missing, false or contradicting field, for the lookup and the creation, and a closed account reported closed |
| P1 Payout fees and stamp duty are missing from the accounting | **Payouts are off by default and refused in production** (P9-22): none is created in P9, and with the switch off a created order fails unsent. Who bears the fee and the stamp duty is the owner's (Q9). Posting both is P10's, the first to send a payout; condition 8 and 13 gate it |
| P2 The transfer status mapping is incomplete | All nine documented statuses (P9-25), for the transfer and the lookup, in one table-driven test |
| Gitleaks | The test signing secrets are marked and the two reviewed findings of the history recorded in `.gitleaksignore` (`af88472`); the scan passes on that head |
| The API contract check | The removal of `POST /v1/webhooks/transactpay` is a reviewed, accepted exception, approved by the project lead on 19 November with five conditions: `packages/contracts/openapi/oasdiff-ignore.txt` lists that one finding with its reason and this PR; the CI job passes it to `oasdiff` and then proves the exception is exact, by failing a comparison in which another path is removed |

What this review confirms and this revision keeps: provider-scoped claims, the forward-only migration, the raw-body signature check,
unsigned notifications refused and not stored, confirmation through the API, unclear outcomes unknown, TransactPay out of the new code.
The release gates of 16.4 stay open, and P9 is not closed.

After the reviewer's first review (16.10): format, lint and typecheck clean, and the API suite 2133 passed and 3 skipped (contracts, db and
concurrency are untouched by it: 105, 910, 38). The contract check and the secret scan are Linux CI's.

#### The evidence for the API contract exception (recorded at the reviewer's request, 19 November 2026)

| | |
|---|---|
| The one exception granted | `POST /v1/webhooks/transactpay`, removed: `oasdiff` reports it as `api path removed without deprecation`. Listed in `packages/contracts/openapi/oasdiff-ignore.txt`, with its reason, the lead's approval and this pull request |
| The failing run, before the exception | Head `68ee3eb`, run 44602903430: the step "Fail on breaking changes against the base" failed with `in API POST /v1/webhooks/transactpay api path removed without deprecation` |
| The passing run, with it | Head `b994f72`, run 44607642892: the same step, comparing the base with the real new spec, passes with the ignore file. The ignore file is the only thing that changed between the two |
| The negative-test fixture | The step "The accepted exception hides nothing else" compares the base with the new spec after removing one other path the two share. In run 44607642892 that path was `/v1/health` ("Removed /v1/health from the new spec"), and the comparison failed as it must ("Removing another path still fails the check, as it must"). `/v1/health` is a fixture: it is not an exception, and the line is not evidence about the webhook |
| What this proves | The exception is accepted for that exact path, and removing another shared path still fails with the exception in force |
| Nothing else is granted | No other path-removal, and no other kind of breaking change, is excepted. The file holds that one line; the check's threshold is unchanged (`--fail-on ERR`) |

### 16.11 The owner's answers to `P9_OWNER_PAYSTACK.md` (19 November 2026)

Mayowa Edward Fadahunsi answered all nine questions on 19 November 2026: "I go with the suggestion", each time. Nothing was inferred; the
suggested option of each question is what is recorded.

| Q | Answer | What follows |
|---|---|---|
| Q1 One balance, custody | Build and test in Paystack's test mode only; no real money until custody is confirmed in writing with Paystack and a lawyer | Condition 11 keeps custody open. Nothing here goes live |
| Q2 Who bears Paystack's fee on money received | The business: its wallet is credited the amount less the fee | P9-14 stands as built |
| Q3 The name a payer sees | The word "Business" | P9-21 stands as built |
| Q4 Identity checks | Not now: ask Paystack in writing which category applies and exactly what it requires, then come back to the owner with a form on collecting the phone and, if required, the BVN | **Wallet creation stays off** (P9-23). The written question to Paystack, and then that form, are the next steps. Condition 3 stays open |
| Q5 Subscriptions between wallets | A book entry between two wallets, no provider call | For P10 (§16.6) |
| Q6 The rules that name TransactPay | Add the dated note as written | Added, word for word, under rules 1.4, 2.4 and 4.1 of `BUSINESS_RULES.md` |
| Q7 The old TransactPay accounts | Ask TransactPay to close all of them before the relationship ends | An operator task; condition 12 stays open until it is done and the keys are revoked |
| Q8 Is the Paystack account ready | Not yet; the work continues in test mode | Condition 11 stays open |
| Q9 Who pays to send money out | The business bears the transfer fee and the stamp duty: its wallet is debited the amount, the fee and the stamp duty | P10 posts all three. **Payouts stay off** (P9-22) until it does; condition 8 stays open |

The answers close no condition of 16.4: they decide who bears what, and say that nothing goes live yet.

### 16.12 The roadmap to close P9 (25 November 2026)

Ten workstreams and eight gates. A gate authorizes nothing by itself: each action that needs a separate authorization still gets one from the reviewer or the owner.
Nothing here switches on wallet creation or payouts anywhere, opens a tunnel, makes a deposit, or touches production.

| Workstream | What | Status | Evidence in the repository |
|---|---|---|---|
| A | Publish the sandbox evidence on the PR | **Done**: `d92729e`, `902e310`, `3f6bcb7` are on PR #13 | `docs/architecture/evidence/p9-paystack-sandbox-2026-11-24/` |
| B | The wallet email domain must have a real ending | **Done, for CI to confirm**: P9-26, tested | `config.ts`, `config.test.ts`; the suite names its domain |
| C | Local readiness: database, credentials, worker, webhook, switches | **Report written, for the reviewer's acceptance** | `P9_LOCAL_READINESS_REPORT.md`; `webhook-proxy.ts` and its test |
| D | The sandbox wallet and a test deposit, end to end | **D1 done (26 November 2026, authorized by the reviewer):** the local database migrated (57 migrations), the API up on loopback, the worker's role checked after migration, wallet creation and payouts off, no tunnel or deposit; it found and fixed two defects (the worker could not connect to an older database; the worker ended after one pass). **Not authorized:** wallet creation on, a tunnel, a deposit; the signing secret and the proxy are to be verified first | `docs/architecture/evidence/p9-d1-local-integration-2026-11-26/` |
| E | Paystack's written requirements (category, phone, BVN, account name) | **Sent 28 November 2026; the reply is awaited** | `P9_PAYSTACK_REQUIREMENTS_REQUEST.md` |
| F | The worker's role and credentials | **The bootstrap strips memberships and a check exists (P9-27), tested**; running both in each real environment, and the runtime separation (P15), remain | `roles.sql`, `worker-role.sql`, `worker-role.test.ts` |
| G | Close TransactPay, revoke its keys | **Checklist written, nothing done** | `P9_TRANSACTPAY_CLOSURE_CHECKLIST.md` |
| H | Custody confirmed in writing, by Paystack and a lawyer | **Questions written, not sent** | `P9_CUSTODY_CONFIRMATION_REQUEST.md` |
| I | Payouts and P10 | **Recorded; payouts stay off, refused in production**; the work is P10's | `P9_PAYOUT_DEPENDENCY_RECORD.md` |
| J | The reviewer's full re-review and the project lead's closure | **Pending** | this plan, §16.8 |

| Gate | Evidence | Status |
|---|---|---|
| G1 Evidence published | Three commits on PR #13 | **Met** (head `3f6bcb7` when pushed) |
| G2 Configuration validated | The domain rule and its tests, green in CI | For CI |
| G3 Environment safe | The readiness report accepted | For the reviewer |
| G4 Sandbox lifecycle proven | Customer, account, deposit, webhook, worker, ledger, the balance and the fee | Not started: waits for G3 and the owner |
| G5 Business requirements confirmed | Paystack's written answer, and a privacy decision if it asks for a phone or a BVN | Not started: the owner sends E |
| G6 Operational security verified | The worker's role checked in each environment, TransactPay revoked | Partly: the tooling exists; the doing is the operator's and the owner's |
| G7 Custody approved | Paystack's and the lawyer's written replies, the owner's signature | Not started: the owner sends H |
| G8 Final review | All of the above and green CI on the final head | Pending; the lead records P9 closed |

What can move now, with no one else: G2 (CI), G3 (the reviewer reads the report). What waits for a person at Paystack or a lawyer: G4, G5, G7. What waits for the owner's
accounts: G6's revocation. The sandbox suite can be re-run in the cloud once the repository holds the test secret (`P9_SANDBOX_IN_CI.md`).

### 16.13 The closure roadmap as the reviewer corrected it (27 November 2026)

**Status, in the reviewer's words: test-mode engineering substantially complete; end-to-end deposit verification outstanding.** "P9 closed for test mode" will not mean the Paystack
integration is validated or production-ready: the deposit-to-ledger path is unproven until D2 is done. **D1 is accepted** (both runs; no local repeat is needed, since the Linux process tests, green in CI on `ca8ae07`, give the
direct evidence of successive passes and a clean SIGTERM). The full §16.8 review and the decision on the readiness report are the reviewer's, and are open.

**Four corrections to the earlier proposal, all taken:**

| | Correction | What it means |
|---|---|---|
| A | **No wallet creation before condition 3 is resolved** | Send the Paystack requirements request (`P9_PAYSTACK_REQUIREMENTS_REQUEST.md`) and have its answer first. If Paystack wants a phone, a BVN or a validation the project does not hold, the test waits for an approved solution. No invented identity details, ever |
| B | **Condition 5 gets its own verification step** | Whether a new customer is reliably found, and whether Paystack refuses a second account for that customer, are checked in D2 explicitly, not assumed from the sandbox suite |
| C | **The source-address question is closed in the door, not left to P15** | The webhook-only door now keeps Paystack's three addresses (`webhook-proxy.ts`, tested): the path restriction is no longer mistaken for an allowlist. The residual (it trusts the tunnel's header) is stated in the readiness report |
| D | **D2 is not one blanket authorization** | Three separate gates inside one controlled plan (below), each with its own stop condition |

**D2, in three gates.** Nothing in D2 is authorized. Each gate needs the reviewer's explicit word, and the one before it must be complete and cleaned up.

| Gate | What | Needs first | Stop if |
|---|---|---|---|
| D2a: the door | The signing secret from Paystack's dashboard set locally; the tunnel pointed at the door on **port 4001, never the API on 4000**; the test webhook URL registered; a signed `ping` or test event reaches the API through the door; an unsigned one and a wrong route do not | The readiness report accepted; `.env` re-inspected by name and prefix; **wallet creation `off` and payouts `off`, read from the `.env` by name**; the door's own startup line showing the source list ON with the three addresses and no WARNING | The tunnel is on 4000; the allowlist is off without a recorded decision; any route but the webhook answers; wallet creation or payouts are on at any point |
| D2b: one wallet | `PAYSTACK_WALLET_CREATION=on` for **one named test**, for one synthetic business, for a stated time; the account made and its name recorded; the customer found again; a second creation made no second account (condition 5); then **off** | **Condition 3 resolved** (correction A) | Paystack asks for anything the project does not hold; more than one account appears |
| D2c: one deposit | One demo-bank deposit of at most a stated sum in kobo; the signed webhook stored; the worker confirms it; **one** ledger credit net of the fee; the books against Paystack's one balance, with the settlement delay noted | D2a and D2b done | The credit is not exactly one, or not the expected net; a difference opens that cannot be explained |

**D2a creates no wallet** (the reviewer, 28 November): it tests the webhook door and the tunnel's header, with wallet creation and payouts off throughout. Wallet creation is D2b's, after condition 3.

**What a D2 authorization must name before it is given:** the exact local database; the synthetic business and its test account; the maximum deposit in kobo, and the one deposit permitted, with the expected ledger entry; the tunnel's destination (the door, port 4001); how long wallet creation stays on;
that payouts stay off; the stop conditions; and the cleanup: stop the tunnel, the door, the worker and the API; remove the test webhook URL; wallet creation off; no credential in the evidence.

**The stages:** 1, review and the owner's actions (the full §16.8 review; the readiness report; **the owner sends the Paystack and custody letters and revokes the TransactPay keys, which nobody does for them**); 2, D2a to D2c as gated above; 3, the reviewer accepts the
implementation and the D2 evidence, and the project lead records **"P9 closed for test mode"**, with the live-money gates still open and separate.

**The live-money checklist, by §16.4 condition** (none of it is permission to merge, run production migrations, use live keys or move money):

| Condition | Still required |
|---|---|
| 3 | Paystack's business category and what a dedicated account requires, written; a privacy form if it asks for a phone number or BVN |
| 8 | P10 posts the transfer fee and stamp duty before payouts, which stay off and refused in production |
| 9 | The role bootstrap and `worker-role.sql` run in each real environment |
| 10 | P15 proves the worker's credentials and runtime are separate |
| 11 | Paystack and a lawyer confirm custody in writing; the account is approved for live use |
| 12 | The TransactPay accounts are closed and the exposed keys revoked everywhere |
| 13 | A payout reversed after success has an accounting treatment (P10) |

### 16.14 What the DVA research changed (28 November 2026)

The reviewer's research (`P9_PAYSTACK_DVA_RESEARCH.md`) found that Paystack's public documentation does **not** establish that AlphaKolect can give a dedicated account to each independent business, validate it without an individual's BVN, or keep per-business balances in
anything but software. A clarification request was **sent to Paystack on 28 November 2026** (`P9_PAYSTACK_REQUIREMENTS_SENT.md`), before any identity form was designed, any account assigned or anything enabled live. The decisions, each a recommended option until Paystack answers:

| # | Decision | Taken |
|---|---|---|
| P9-30 | The customer's identity | **Open.** Written classification and business-customer identity requirements are awaited (condition 3). **No production identity form is designed**: whose BVN, and whether a business can be the customer, are Paystack's to answer. The code's choice of a business name as `first_name` and "Business" as `last_name` (P9-21) is **unproven for a live validating account**: validation overwrites the customer's name with the BVN's. |
| P9-31 | D2b, the one-wallet test | **Held** until Paystack answers items 1 (the classification) and 2 (the business-customer identity) of the sent email, and then asked for separately. A test-mode account accepted without a phone or validation is not evidence of live eligibility. |
