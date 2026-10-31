# P9 implementation plan — payments

**Status: revision 3 (2026-10-31) — the gate review's findings resolved (§11); awaiting the re-check.** Planned and built
in one pass, as P6 to P8 were. Decisions that would go to the project lead take the recommended option (his standing
instruction) and are recorded in §7. The owner answered `docs/business/P9_OWNER_PAYMENTS.md` (Q1–Q8) on 26 October 2026 and
`docs/business/P9_OWNER_PLATFORM_WALLET_PERMISSION.md` on 31 October 2026, each with the suggested option.
`docs/business/P9_TRANSACTPAY_QUESTIONS.md` is answered from TransactPay's published documentation, with several points still
to confirm with TransactPay: §10 lists what must be confirmed before real money flows. The gate review is the independent
reviewer's.

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

The exit criteria are met against the FakeProvider. P9 has **not** been run against TransactPay: no sandbox keys were
available, so `TransactPayProvider` has been tested only against a stub built from the old client and the documentation.
Nothing here touches production, and in P9 nothing leaves a wallet (Q2). Before a live wallet is switched on:

| # | Condition | Why |
|---|---|---|
| 1 | Run the sandbox suite, and a real deposit through the webhook and the worker, including what TransactPay answers for an alias and a session it does not know | field names, the amount's unit (taken as naira from the old client) and the status table are unproven against the real API. A not-found answer is undocumented: only a JSON 404 is taken as one (P9-R2), so with any other answer no wallet is created and no forged event ends rejected. Both fail safe, and show as failed wallets and an `event` finding |
| 2 | TransactPay confirms that a session's details name the destination account (C5) | without it, every deposit lands as unmatched: safe, but every one needs a person |
| 3 | TransactPay confirms what the balance enquiry covers (B4) | if the payout balance does not hold virtual-account money, every comparison is a false difference |
| 4 | TransactPay answers webhook authenticity (C2), and a transaction listing (C4) | events are confirmed by the API regardless; but with no listing a missed notification shows only as a difference, with no transaction a person can credit in the system: a listing, or a way to enter a session id, is needed |
| 5 | For billing (P10): VA-to-VA transfers (D1), payout idempotency (D2), the payout's required fields (the documentation lists `accountName`, which orders do not carry yet) | the adapter refuses VA-to-VA today, and orders are never resent |
| 6 | Closing the old virtual accounts (Q3) | an operator task, once TransactPay answers B3 |
| 7 | TransactPay confirms that an alias lookup sees an account as soon as it exists, or that creation is idempotent (B1) | the lease keeps two workers from racing (§11, R3), but a creation whose answer was lost is followed by a lookup: a lookup that lags could still lead to a second account |
| 8 | Each environment re-runs the role bootstrap before these migrations, with `worker_password` | the migration grants to `alphakolect_worker` and stops if the role is missing; the worker needs `WORKER_DATABASE_URL` |

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
