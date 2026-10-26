# P9 implementation plan — payments

**Status: revision 1 (2026-10-26) — mapped; the owner's answers and TransactPay's asked.** Planned in one pass, to be
built in one pass once answered, as P6 to P8 were ("map everything out and implement in one go"). Decisions that would
go to the project lead take the recommended option (his standing instruction) and are recorded in §7. The owner's
decisions are asked in `docs/business/P9_OWNER_PAYMENTS.md` (Q1–Q8); TransactPay's facts in
`docs/business/P9_TRANSACTPAY_QUESTIONS.md` (A–F). The gate review is the independent reviewer's.

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
| TA-11 jobs have a scope and an owner | The worker (pg-boss in the `jobs` schema) connects as `alphakolect_app`; a job for one business carries `merchant_id` and runs in that business's transaction; the reconciler lists businesses through a narrow function and handles each in its own transaction; the isolation matrix gains a job case (§3.7) |

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
- A business's wallet is requested in the same transaction that confirms its email (BR-2.3), as a job keyed by the
  business; the job calls the provider with an idempotency key and records the account. A business never confirmed
  gets nothing (test). A failed creation is retried with backoff and then left `failed` for the platform team.
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
  event is not confirmed by the provider and credits nothing (tests).
- Late, duplicate, out-of-order and contradictory events: the provider's current state wins; a transaction confirmed
  successful and later reported reversed is a new transaction with its own posting (E1), never an edit.

### 3.4 Payment orders (TA-8)

- `payments.payment_orders`: from wallet, to (wallet or bank account), amount, our reference (unique), purpose, state:
  `created` → `submitted` → `succeeded` | `failed`, with `unknown` after a timeout or an unclear answer.
- `unknown` is resolved only by looking the transfer up by our reference (D3). It is resubmitted only if TransactPay
  confirms idempotency on our reference (D2); otherwise it stays `unknown` and is shown to the platform team.
- The ledger posts when the provider confirms success, once, keyed by the provider transaction; a failure posts nothing.
- No network call is made while a database transaction is open (TA-9): an order is written, committed, sent, and its
  answer written in a new transaction.
- In P9 orders are created by tests and the platform console only (Q2); billing (P10) is their first user.

### 3.5 The journal traces (TA-2)

| Trace | Ledger | Entry | Provider reference | Reconciliation |
|---|---|---|---|---|
| Money arrives in a business's wallet | the business's | Dr 1100 Business wallet / Cr 2290 Money received — to classify (Q1; a new chart account and template `wallet.received`) | the provider transaction | 1100 equals the provider's balance of the business's account |
| The business classifies it | the business's | Dr 2290 / Cr the account chosen (capital, income, a customer's…) — a manual entry through P6's posting | — | none (books only) |
| A business pays AlphaKolect (P10) | the business's, and the platform's | business: Dr 5100 / Cr 1100 (`subscription.paid`); platform: Dr 1100 Platform wallet / Cr 4100 Subscription income | the transfer | both 1100s equal the provider's balances |
| A provider transaction we have no record of | the platform's | none until resolved (Q4): the transaction is stored as unmatched; resolving it posts the entry its owner's trace gives | the provider transaction | listed until resolved |

### 3.6 The reconciler (the exit's drift test; Q5)

- Per Live wallet, regularly: the provider's balance of that account against the ledger account it mirrors. If the
  provider only has a pooled balance (B4), the pooled balance against the sum of all Live-wallet accounts.
- If TransactPay can list transactions (C4), the reconciler also fetches each account's recent transactions and confirms
  any it has not seen (the missed-webhook path); otherwise the balance comparison is what finds a missed one.
- A difference is recorded (`payments.reconciliation_findings`) and shown to the platform team at once; nothing is
  changed automatically (Q5). A test makes the provider and the books disagree and sees it found.

### 3.7 The worker (TA-11)

- `apps/api/src/worker.ts`, a second entry point of the same app: pg-boss in the `jobs` schema; connects as
  `alphakolect_app`; every job idempotent on a natural key (§20): provision a wallet (merchant_id), confirm an event
  (provider_tx_id), resolve payment orders (payment_order_id), reconcile (account, window).
- A job for one business runs in that business's transaction with its tenant context; the reconciler lists businesses
  through a narrow definer function and handles each in its own transaction.

## 4. Interfaces

| Endpoint | Who | |
|---|---|---|
| `GET /v1/merchant/wallet` | `merchant.wallet.read` | the account number, name, bank and balance; "being set up" while provisioning |
| `GET /v1/merchant/wallet/receipts` · `POST …/{receiptId}/classification` | `merchant.wallet.read` / `merchant.wallet.classify` | money received, and recording what it was for (Q1) |
| `POST /v1/webhooks/transactpay` | none (stored, then confirmed with the provider) | TransactPay's notifications |
| `GET /v1/platform/payments/wallets` · `…/unmatched` · `…/findings` | `platform.payments.read` | every Live wallet, unmatched transactions, reconciliation differences |
| `POST /v1/platform/payments/unmatched/{id}/resolution` · `…/findings/{id}/resolution` | `platform.payments.resolve` | Q4, Q5 |
| `POST /v1/platform/wallet` | super admin | the Platform Live wallet, once (Q6) |

Activity events (atomic, identifiers and amounts only): `payments.wallet_provisioned`, `payments.money_received`,
`payments.receipt_classified`, `payments.unmatched_resolved`, `payments.finding_resolved`,
`payments.platform_wallet_created`; a refusal by the database alone best effort, as in P6–P8.

## 5. Tests

- BR-2.3: a business that has not confirmed its email gets no wallet and no job; confirming it requests one, once.
- A forged event (the provider does not confirm it) credits nothing; a replayed event (the same provider transaction
  twice, also concurrently) credits once; an event whose amount differs from the provider's posts the provider's.
- A payment order that times out is `unknown`, not failed; it is resolved by the lookup; it is never sent twice without
  the provider's idempotency; it posts once.
- The reconciler finds a difference between a wallet's account and the provider's balance, and changes nothing.
- The worker's jobs run in their business's tenant context (the isolation matrix's job case).
- The FakeProvider and TransactPayProvider pass the same contract suite (TransactPay's against the sandbox, run on
  demand with sandbox keys, never in CI without them).
- Guards: lock order, grants, R19, TA-14, the matrices, the coverage and writer guards.

## 6. Obligations passed on

P10: the subscription payment on these orders, and restoring a suspended business only on a confirmed charge (TA-12).
P8b: customer Live wallets and Live-wallet collections once OPEN-12 is settled. OPEN-7: payouts to bank accounts. Operator
task: closing the old virtual accounts (Q3) once TransactPay answers B3.

## 7. Decisions (recommended options, the project lead's standing instruction)

| # | Decision | Taken |
|---|---|---|
| P9-1 | The job runner | pg-boss in the `jobs` schema, a `worker.ts` entry point of the API app (§20, TA-11) |
| P9-2 | Trusting an event | never: every event is confirmed by fetching the transaction from the provider, signed or not; the amount and account come from the provider |
| P9-3 | A provider without a transaction listing | the reconciler compares balances; a listing, if TransactPay has one, is added as the missed-webhook path |
| P9-4 | Network calls and transactions | never inside an open database transaction (TA-9): write, commit, call, write the answer |
| P9-5 | Customer Live wallets | built behind a switch that is off, and refused by production configuration until OPEN-12 |
| P9-6 | Sandbox tests | the TransactPay contract suite runs on demand with sandbox keys; CI runs the FakeProvider's |
| P9-7 | Gate | one review of P9 by the independent reviewer at the end |

## 8. Revision log

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-10-26 | First plan; the owner's questions and TransactPay's asked |
