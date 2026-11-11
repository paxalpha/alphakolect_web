# P10 implementation plan — billing

**Status: revision 3 (2026-11-11), a draft for the independent reviewer's plan review. Nothing is built.**

- **Revision 3** answers the reviewer's plan review of revision 2: all 14 findings are resolved in the design, and §12
  maps each one to where.
- **The owner's answers:**
  - `docs/business/P10_OWNER_BILLING.md`, answered 11 November 2026: every question (Q1–Q14) with the suggested option,
    and the permissions' wording approved as written;
  - `docs/business/P10_OWNER_BILLING_FOLLOWUP.md` (F1–F5): five money rules the review showed were missing. **Not yet
    answered.** Where the design depends on one, it names it.
- **The build starts once:**
  - the reviewer approves this plan;
  - the owner has answered F1–F5;
  - the project lead agrees.

Decisions that would go to the project lead take the recommended option (his standing instruction) and are recorded in
§7. P9 is merged to `main` but **not closed**. P10 builds on its payment orders and worker, and does not close before P9
does (P10-14).

**Billing stays paused (BR-1.3), and no real money moves in P10.** Billing can be switched on only once §9's conditions
hold, including TransactPay's confirmations, the accountant's VAT treatment, and the owner's own decision.

| | |
|---|---|
| Branch | `feat/p10-billing`, from `main` at `031e4db` (P9 merged as PR #11, still open) |
| Inputs | `BUSINESS_RULES.md` 1.3, 2.2, 2.5, 10.1–10.6, 12.2; `TARGET_ARCHITECTURE.md` §11 (billing), §6 (money commands), §20 (jobs), §30 OPEN-10 and OPEN-11, ADR-11 (NGN, WAT); `TARGET_ARCHITECTURE_REVIEW.md` TA-12 and TA-25 (due at P10); `RESTRUCTURING_MAP.md` P10 row; the P9 plan §3.4 (payment orders), §3.7 (the worker), §6 (obligations to P10) and §10 condition 5; ADR-16 (fail-closed authorization) |
| Exit (RESTRUCTURING_MAP, amended by P10-16) | BR-1.3 (the global pause flag) and BR-10.1–10.6 tests, including how suspension behaves for each audience that can sign in: business owner and staff, agents, platform. The customer audience's test moves to the phase that builds customer sign-in (§6) |

## 1. Scope

**In P10:**

- **Prices:** versioned, editable, with a future start date (BR-10.1, 10.2, 12.2), and a custom price for 21 or more
  agents.
- **Each business's billing state,** with every transition defined (§3.1), kept apart from the merchant lifecycle.
- **The 90-day trial** (BR-2.5, Q1).
- **Billing dates and periods** in WAT (§3.4).
- **The billable-agent count** (BR-10.6a, Q2).
- **Invoices,** one per business per billing date.
- **The upcoming charge,** shown from 7 days before the billing date (Q7).
- **The charge:**
  - a payment order from the business's Live wallet to the Platform Live wallet, with numbered attempts;
  - a reservation against concurrent spending;
  - postings in both ledgers on confirmation, the fee included (BR-10.3, F5).
- **Suspension:** for insufficient funds, enforced for each audience in both layers (BR-10.4, TA-25).
- **Restore:** automatic, on a confirmed charge only (BR-10.5, TA-12).
- **The billing switch and exemptions,** with in-flight charges handled (BR-1.3, Q11, F1, F2, F4).
- **The charge guard,** enforced where a charge is sent, not only in configuration (§3.8).
- **A preview** of what billing would charge, while it is off.

**Not in P10:**

- **Moving real money.** The TransactPay adapter can't yet move money between virtual accounts (P9 §10 condition 5).
  `P10_TRANSACTPAY_QUESTIONS.md` asks how, and the transfer is built and tested against the FakeProvider only.
- **Emails and reminders** (P12, notifications). In P10 the warning is on the Subscription page (Q7).
- **The customer audience's suspension behaviour.** Customers can't sign in yet: sessions are platform, merchant or
  agent. It leaves P10's exit criteria by an explicit amendment (P10-16) and passes to the phase that builds customer
  sign-in (§6).
- **Invoice PDFs** (documents, P12).
- **The web Subscription page and its redirect** (P13). P10 delivers the API and the error codes it needs.

## 2. The findings due before P10

| Finding | Settled by |
|---|---|
| TA-12: billing restore and suspension need failure rules | Restore only on a charge TransactPay has confirmed. A deposit alone never restores (§3.7). A charge in `unknown` changes no state until it is resolved. Requests that have passed the check complete, and the next request sees the new state (§3.6). "Email confirmed, wallet being set up" is a valid state: such a business is in trial, so there is nothing to charge. Several unpaid months: everything owed must be paid (Q5) |
| TA-25: a separate subscription gate | No separate gate. Every endpoint declares its behaviour while suspended in the route registry, and an endpoint with no declaration is blocked. The database enforces the same rule through the permission it already checks (§3.6, P10-3) |
| TA-1: platform ledger | Settled in P6: the ledger has `owner_kind`. The platform chart has 1100 Platform wallet, 4100 Subscription income and 5100 Provider charges, and the templates `subscription.paid` (business: Dr 5100 / Cr 1100) and `platform.subscription_received` (platform: Dr 1100 / Cr 4100) exist |
| The P9 plan §6: the subscription on P9's payment orders | An order posts to one ledger today. A subscription posts to two, the business's and the platform's, in one transaction (§3.5, P10-8) |
| The P9 plan §10 condition 5: VA-to-VA transfers, payout idempotency, `accountName` | Asked of TransactPay (`P10_TRANSACTPAY_QUESTIONS.md` §1–§5, `accountName` included). Billing can't charge until their answers are implemented and proven in the sandbox (§9 conditions 1–3) |

## 3. Design

All dates are in WAT (Africa/Lagos, UTC+1, no daylight saving; ADR-11). A "day" is a WAT calendar day.

### 3.1 Billing state and invoices (P10-2)

- **`billing.merchant_billing`,** one row per business, created when its email is confirmed. It holds:
  - the state (`trial`, `current`, `suspended`, `exempt`);
  - `trial_ends_on`;
  - `anchor_day` and `next_billing_on` (§3.4);
  - the exemption's reason and author.
- **Kept apart from the merchant lifecycle** (`tenancy.merchants.status`: `pending_verification`, `active`,
  `deactivated`). A suspended business is still `active`. Billing leaves deactivated and unconfirmed businesses alone.
- **`billing.invoices`:** one per business and billing date, in state `open`, `paid` or `waived` (F1). The amount owed is
  the sum of the open invoices.
- **Every state change** is made by a billing function, in the same transaction as its cause, and recorded in the
  activity record:

| From | Event | To | Invoices |
|---|---|---|---|
| — | the business's email is confirmed | `trial` | none; `trial_ends_on` = the confirmation day + 90 days (Q1) |
| `trial` | its first billing date is reached, with the charge gate open (§3.8) | `current` | the first invoice is issued, `open`. The trial ends here, whatever the charge then does |
| `current` | a charge attempt is refused for lack of money: by the books' check (§3.5) or by the provider | `suspended` | the invoice stays `open` |
| `current` or `suspended` | a charge attempt fails for any other reason | unchanged | stays `open`; a new attempt on the next pass (§3.5). After 3 such failures in a row the invoice is listed for the platform team |
| `current` or `suspended` | a charge attempt's outcome is `unknown` | unchanged | stays `open`; no new attempt until P9's lookup resolves it |
| `current` | a charge succeeds | `current` | `paid` |
| `suspended` | a charge succeeds and no other invoice is open (Q5) | `current` | `paid` |
| `suspended` | a charge succeeds while other invoices are still open | `suspended` | that one `paid`; the next is attempted |
| `current` | a billing date passes with an invoice still open from a non-money failure | `current` | a new invoice is issued too; both are owed |
| any | exempted by the Super Admin (Q11) | `exempt` | the open invoices are waived, with the reason (F1, suggested) |
| `exempt` | the exemption is lifted | `trial` if `trial_ends_on` hasn't passed, otherwise `current` | none issued for the exempt time; billing restarts at the next billing date from today (F2, suggested). Lifting never suspends |
| `suspended` | billing is switched off | `current` | stay `open` and visible; nothing is taken while off (F4, suggested) |

- **Nothing else changes a state.** The two rows marked "suggested" follow F1, F2 and F4 if the owner answers as
  suggested; any other answer changes those rows before the build.

### 3.2 Prices (BR-10.1, 10.2, 12.2; Q8, Q9, F3)

- **`billing.price_lists`** (a version, a start date and its author) and **`billing.price_tiers`** (each band of agents
  and its price in kobo). Seeded from BR-10.1:
  - 1–3 agents: ₦5,000;
  - 4–6: ₦10,000;
  - 7–10: ₦15,000;
  - 11–20: ₦40,000;
  - 21 or more: custom.
- **A price change is a new version.** It is never an edit to one in force. Its start date must be at least 30 days
  away (Q8), and a version that hasn't started can be withdrawn. The bands must cover 1 to 20 without gaps or overlaps
  (a database check).
- **A business is charged the version in force on its billing date** (Q8). The version in force 30 days ahead is always
  known, so the 7-day warning (§3.4) can always state it.
- **The custom price** for 21 or more agents is `billing.custom_prices`, per business, versioned. On a billing date with
  21 or more agents and no price:
  - no invoice is issued, and nothing is owed for that date;
  - the date is recorded in `billing.unbilled_dates` (business, date, reason `awaiting_price`), so it is visible and
    auditable;
  - the business is listed for the platform team (Q9);
  - billing starts at the first billing date after the price is set (F3, suggested).
- **An invoice records the version, band, price and agents it used,** so a later price change never alters it.

### 3.3 Billable agents (BR-10.6a; Q2, Q4; P10-7)

- **"Active" means one of two things, both from rows that exist already:**
  - an agent-audience session was created for that membership (a sign-in to the mobile app);
  - a collection was recorded by it (`savings.collections.agent_membership_id`, at `created_at`, whatever its later
    status).
- **The window:** for billing date D, activity strictly after D 00:00 minus 15 days, and before D 00:00. BR-10.6a counts
  an agent with no activity for 15 days or more as inactive, so activity exactly 15 days before D doesn't count, and
  activity on D belongs to the next billing date.
- **Why these rows represent the owner's events:**
  - only `/v1/auth/agent/login` (and its membership selection) creates an agent-audience session, and agents sign in
    from the mobile app alone (BR-3);
  - a refresh is not a sign-in and creates no session (Q2's wording);
  - memberships are never deleted (deactivation is a status), and neither are sessions or collections. Retention blanks
    a session's address and device and keeps the row.
- **A guard test pins these facts.** No function or migration deletes from `identity.sessions`,
  `tenancy.merchant_memberships` or `savings.collections`, and only the agent sign-in creates an agent-audience session.
  Any later change that breaks them must replace this evidence first.
- **No new activity table is kept,** and nothing is added to the sign-in or collection paths. This departs from
  TARGET_ARCHITECTURE §11's `tenancy.agent_activity`.
- **A deactivated agent** can't sign in (BR-10.6b, enforced since P4). It is still billed by the activity rule alone:
  its membership row stays, so an agent deactivated today but active last week counts.
- **With no active agents,** the business pays the lowest band, 1–3 agents (Q4).
- **The invoice stores the count and the agents counted,** so the business and the platform team can see why it was
  charged what it was.

### 3.4 Billing dates, the run and the upcoming charge (Q3, Q7, Q12)

- **The first billing date** is the later of `trial_ends_on` and the day billing was switched on (Q12).
- **Later billing dates.** The first date's day of the month becomes `anchor_day`. Each later date is the anchor day of
  the following month, or that month's last day if it is shorter (Q3).
  - Every date is computed from `anchor_day`, never from the previous date, so the day never drifts. Anchor 31 gives 31
    Jan, 28 or 29 Feb, 31 Mar.
  - An exemption that is lifted keeps the anchor.
- **The period key is the billing date.** `(merchant_id, billing_on)` is unique on invoices and on unbilled dates.
- **The run.** A worker task sweeps the businesses whose `next_billing_on` is today or earlier, while the charge gate
  (§3.8) is open. It claims each with a lease, one at a time, as P9's claims do. Per business and date, in one
  transaction:
  1. count the agents for that date's window, never for "now", so a late run gives the same answer;
  2. choose the band and the price version in force on that date;
  3. write the invoice, or the unbilled date (§3.2);
  4. move `next_billing_on` on.

  A run repeated, or two at once, make one invoice (test). A business several dates behind gets one invoice per date.
- **With the gate closed** (billing off, or charges not allowed, §3.8), the run writes nothing. The platform team's
  preview computes the same figures without writing them.
- **The upcoming charge (Q7).** From 7 days before `next_billing_on`, `GET /v1/merchant/subscription` returns
  `upcoming`, computed by the same function as the run, with:
  - `billingOn`;
  - `agentsSoFar`: the count for the window ending now, marked as an estimate (the final count is taken on the date);
  - the band and the version in force on that date;
  - the amount, or `awaitingPrice: true` for 21 or more with no price;
  - `walletShort`: whether the wallet's balance, less the reservations (§3.5), is below what is owed plus the upcoming
    amount.

### 3.5 The charge (BR-10.3; P10-8, P10-10, P10-11, P10-17)

- **Attempts.** `billing.charge_attempts` records each attempt: invoice, attempt number, payment order, outcome.
  - The order's reference is `sub-<invoice id>-<attempt number>`. A new attempt has a new reference, and an old
    reference is never reused.
  - A partial unique index allows one unfinished attempt per invoice.
  - A new attempt is made only once the previous one is final and failed or cancelled. Never after `unknown`, and never
    while one is unfinished.
  - Open invoices are attempted oldest first.
- **The reservation (P10-17).** P9's `create_order`, the only way an order is made, is changed for every purpose:
  1. it locks the source wallet's 1100 projection (`FOR NO KEY UPDATE`, category 14);
  2. it refuses with `insufficient` unless the balance, less the amounts of that wallet's unfinished outbound orders, is
     at least the new amount.

  Two orders against the same money are serialized by the lock, and only one is made (test). Nothing else spends from
  a Live wallet in P10 (P9 Q2), and any later payout path goes through the same function.
- **No order is made that the books say can't be paid.** A refusal by the reservation is the "lack of money" outcome:
  the attempt is recorded as `insufficient`, and §3.1 applies. Nothing is half taken (Q6).
- **The order then follows P9's machinery:**
  - it is claimed, then sent with no database transaction open;
  - a timeout leaves it `unknown`, resolved only by looking it up by its reference, never resent (TA-8, P9 D2).

  P10 adds one state to P9's orders: `cancelled`, reachable only from `created`, before any claim (§3.8).
- **Success: two ledgers and the fee.** On success, `record_order` posts in one transaction:
  - `subscription.paid` to the business's ledger: Dr 5100 / Cr 1100, for the price;
  - the platform's side, by the fee model TransactPay confirms, with the fee taken from the provider's answer and never
    computed by us. With the owner's suggested F5, AlphaKolect bears the fee:

| Fee model (TransactPay §5) | Platform posting |
|---|---|
| no fee | Dr 1100 / Cr 4100, the price |
| fee taken from the amount in transit | Dr 1100, the price less the fee; Dr 5100 Provider charges, the fee / Cr 4100, the price |
| fee charged separately to the platform's balance | Dr 1100 / Cr 4100, the price; and Dr 5100 / Cr 1100, the fee |
| fee charged to the business's wallet on top | not supported: it contradicts F5. Billing stays blocked (§9 condition 4) |

  The invoice becomes `paid` in the same transaction. Each posting is keyed by the provider transaction, so each is made
  once.
- **Failure.**
  - A provider refusal for lack of money: the attempt is `insufficient`, and §3.1 applies.
  - Any other final failure: the attempt is `failed`, and the next pass makes a new attempt.
  - Either way, nothing is posted.
- **An attempt reported failed that later proves successful** (TransactPay §2.4) is a contradiction. P9's review path
  handles it: it is listed for the platform team and nothing is posted automatically. §9 condition 2 requires
  TransactPay's status table before billing is switched on, so that "failed" is known to be final.
- **The lock order.** `billing` is lock category 19, after payments (18). The success path takes the projections (14),
  the order (18), then the attempt, the invoice and the billing state (19). Each footprint is pinned in the lock-order
  guard.

### 3.6 Suspension enforcement (BR-10.4; TA-25; P10-3)

**In the API.** Every endpoint in the contract registry gains a required `whileSuspended` declaration, published as the
OpenAPI extension `x-while-suspended`: `allowed` or `blocked`.

- The registry won't build without it, and a guard test checks every operation has one. Missing means blocked: ADR-16's
  fail-closed rule, not a separate middleware with an exception list.
- Allowed (Q13):
  - signing in and out, refreshing, the session and its membership;
  - the subscription reads, the invoices, the request to pay;
  - the Live wallet's details, to load it.
- Everything else is blocked.

**In the database.** The permission catalog gains `allowed_while_suspended` (default false). `tenancy.assert_authority`
returns `suspended` when the session's business is suspended and the permission isn't allowed.

- A guard test checks each endpoint's declaration agrees with its permission's flag.
- The state is read without a row lock, so the check adds nothing to any lock footprint. A request that has passed it
  completes, and the next sees the new state (TA-12).
- This changes a P5 function. Its tests (enforcement, session authority, containment) are extended, not loosened.

**What each audience gets:**

| Audience | While suspended |
|---|---|
| Business owner and staff | `402 SUBSCRIPTION_SUSPENDED` with the amount owed and the Live wallet's account details, on every blocked call. Signing in still works, so the web app (P13) can go straight to the Subscription page |
| Agent | `403 MERCHANT_SUSPENDED` on everything but signing in and out and the session |
| Platform | Unaffected |
| Customer | Not in P10 (P10-16, §6). Customers have no sessions yet. The phase that builds customer sign-in implements BR-10.4's view-only rule, with `423 MERCHANT_SUSPENDED` and "Please contact the company." |

### 3.7 Restore (BR-10.5; TA-12; P10-5)

- **Access returns only when the charge is confirmed.** In the same transaction that marks the last open invoice paid,
  the state goes from `suspended` to `current` (Q5). A deposit alone never restores.
- **A charge is retried in two ways:**
  - the worker's sweep picks up a suspended business whose wallet now covers the amount owed, after P9 posted a
    confirmed deposit;
  - the owner, or staff with `merchant.subscription.pay`, asks for an attempt now.
- **The request to pay** carries an `Idempotency-Key`, and a repeat returns the first answer. It makes a new attempt
  only under §3.5's rules. While an attempt is unfinished, it returns that attempt and makes nothing.
- **Sessions aren't revoked or reissued.** The state is read on each call, so the next request after the restore
  succeeds.

### 3.8 The switch, exemptions and the charge gate (BR-1.3; Q11, Q12, F1, F2, F4; P10-9, P10-18)

- **`billing.settings`:** one row, `enabled` false by default.
  - Only `platform.billing.switch` changes it. That permission is the Super Admin's and can't be granted, like P5's
    reserved actions.
  - The application role has no privilege on the table. Only the switch function writes it.
- **The charge gate** is open only when all four of these hold, and it is checked in two places:
  - **the conditions:**
    1. `billing.settings.enabled` is true;
    2. the business isn't `exempt`;
    3. the worker's environment allows charges (`BILLING_CHARGES=on`, off by default);
    4. the provider declares that it can transfer between virtual accounts (`capabilities.walletTransfer`). TransactPay's
       adapter declares false until conditions 1–3 of §9 are met.
  - **in the database:** the run and the charge claim check 1 and 2 in the same transaction as the claim;
  - **in the worker:** the run, the charge and the restore sweep check 3 and 4 before each claim and again before each
    send.
- **Production configuration** refuses `BILLING_CHARGES=on` while the configured provider lacks the capability. So a
  stale setting, a direct database update, or a switch turned on early still sends nothing (tests: `enabled` set
  directly in the database, with the environment off or the capability false, sends no order).
- **The worker records whether charges are allowed** in each pass's status, and the platform view shows it. "Billing
  switched on, charges held" is visible, not silent.
- **Switching off (F4, suggested):**
  - in one transaction, orders still `created` are `cancelled`, every `suspended` business becomes `current`, and open
    invoices stay open;
  - orders already claimed, sent or `unknown` can't be called back. They finish through P9's machinery, and a success is
    posted and pays its invoice, because the money moved.
- **Exempting a business:**
  - its `created` orders are cancelled in the same transaction;
  - orders already sent finish as above;
  - its open invoices are waived (F1, suggested);
  - while exempt, nothing is invoiced.
- **Lifting an exemption** follows §3.1 (F2, suggested).
- **Switching on bills nothing backdated** (Q12).

### 3.9 The worker

- **The same entry point and role as P9** (`worker.ts`, `alphakolect_worker`), with three new tasks:
  - the billing run;
  - the charge;
  - the restore sweep.
- **The worker's functions are definer functions** that take the business from the row they act on (P9-9). The worker
  keeps no tables, sessions or memberships (P9 rulings).
- **`alphakolect_app` gains no billing function** except those behind the endpoints in §4.

## 4. Interfaces

| Endpoint | Who | While suspended | |
|---|---|---|---|
| `GET /v1/merchant/subscription` | `merchant.subscription.read` | allowed | the state, trial end, band, price, next billing date, the coming price (Q8), the amount owed, `upcoming` (§3.4), and the Live wallet's details for loading it |
| `GET /v1/merchant/subscription/invoices` | `merchant.subscription.read` | allowed | the invoices, with the agents counted and their attempts |
| `POST /v1/merchant/subscription/payment` | `merchant.subscription.pay` | allowed | asks for a charge of what is owed now (`Idempotency-Key`; §3.7) |
| `GET /v1/platform/billing/businesses` · `…/{merchantId}/invoices` · `/v1/platform/billing/preview` · `/v1/platform/billing/status` | `platform.billing.read` | — | every business's billing state and amount owed; a business's invoices and unbilled dates; what a run would charge; whether charges are allowed (§3.8) |
| `GET` · `POST /v1/platform/billing/prices` · `POST …/prices/{id}/withdrawal` | `platform.billing.read` / `platform.billing.prices` | — | the versions; a new version with its start date; withdrawing one not yet started |
| `PUT /v1/platform/billing/businesses/{merchantId}/custom-price` | `platform.billing.custom_price` | — | the price for 21 or more agents (Q9, F3) |
| `PUT /v1/platform/billing/settings` · `POST` · `DELETE …/businesses/{merchantId}/exemption` | `platform.billing.switch` (Super Admin; not grantable) | — | switching billing on or off; an exemption and lifting it |

- **Activity events** (atomic; identifiers and amounts only):
  - `billing.invoice_issued`, `billing.date_unbilled`, `billing.charge_requested`, `billing.charge_cancelled`;
  - `billing.invoice_paid`, `billing.invoice_waived`;
  - `billing.suspended`, `billing.restored`;
  - `billing.prices_set`, `billing.prices_withdrawn`, `billing.custom_price_set`;
  - `billing.switched`, `billing.exempted`, `billing.exemption_lifted`.
- **Sensitive reads** are recorded once per page, as in P9.
- **The P9 Live-wallet read** (`GET /v1/merchant/wallet`) is declared allowed while suspended.

## 5. Tests

**BR-1.3 and the gate**
- With billing off, a run past every billing date writes no invoice, order or state change. The preview shows the
  figures.
- With `enabled` set directly in the database but `BILLING_CHARGES` off, or the capability false, nothing is invoiced or
  sent.
- Production configuration refuses `BILLING_CHARGES=on` without the capability.

**BR-10.1 and prices**
- The price at each band's edge: 0, 1, 3, 4, 6, 7, 10, 11, 20 and 21 agents.
- 21 or more without a price issues no invoice and records the unbilled date. A price set before the date is invoiced on
  it; one set after leaves that date unbilled and is invoiced on the next (F3).

**BR-10.2, 12.2**
- A new version applies from its start date and not before, and the 30-day notice is enforced.
- A past invoice keeps its version. The 7-day warning shows the version in force on the billing date.

**Dates and the window**
- The trial ends 90 days after the confirmation day (Q1).
- Anchors on the 28th, 29th, 30th and 31st, through a leap February and back, never drift.
- A late run uses the billing date's window.
- Activity exactly 15 days before D isn't counted; a moment later is; activity on D counts for the next date.
- Switching on later bills nothing backdated (Q12).

**BR-10.3 and the charge**
- One order per attempt, from the business's wallet to the platform's.
- On confirmation both ledgers post once, in one transaction, for each fee model. The invoice is paid. A replayed
  confirmation posts nothing more.

**Attempts and retries**, each terminal outcome followed by the next pass and by a request to pay:
- `insufficient` then a deposit makes attempt 2 with a new reference;
- `failed` makes attempt 2;
- `cancelled` makes attempt 2 once the gate reopens;
- `unknown` makes nothing until resolved. Resolved failed makes attempt 2; resolved successful makes nothing and pays
  the invoice;
- a repeated `Idempotency-Key` returns the first answer.

**The reservation**
- Two orders at once against a wallet that can pay for one: exactly one is made.
- An unfinished order's amount is reserved until it is final.

**BR-10.4**
- Not enough money suspends, from `trial`'s first invoice as from `current`.
- Owner and staff get 402 with the amount, and can still sign in. An agent gets 403.
- Every registry operation has a declaration, and it matches its permission's database flag.
- A blocked call is refused by the database even if the API's check is bypassed.

**BR-10.5**
- A confirmed charge restores, and the next request succeeds. A deposit alone does not restore.
- An `unknown` charge changes no state.
- With several invoices open, access returns only when all are paid (Q5).

**BR-10.6a, 10.6b**
- A deactivated agent can't sign in, and is counted by activity alone.
- The guard test of §3.3 (no deletions; only the agent sign-in creates agent sessions).

**The switch and exemptions** (F1, F2, F4)
- Switching off cancels the `created` orders and restores the suspended businesses, and a claimed order still finishes
  and posts.
- Exempting waives the open invoices and cancels the `created` orders.
- Lifting resumes at the next date without suspending.

**Races**
- Two runs at once: one invoice per business and date.
- Two requests to pay at once: one attempt.
- A switch-off while an order is being claimed: the order is either cancelled or claimed, never both.
- A restore and a new invoice at once leave a consistent state.

**Isolation and guards**
- A business sees only its own subscription. A run and a charge touch only the business they claim (TA-11).
- Lock order (category 19, and `create_order`'s new 14:NKU).
- Grants: the worker's functions are executable by `alphakolect_worker` alone.
- Transaction classes, the matrices, the coverage and writer guards, and `x-while-suspended` on every operation.

## 6. Obligations passed on

- **The phase that builds customer sign-in:** BR-10.4 for customers (view-only; `423 MERCHANT_SUSPENDED`, "Please
  contact the company."), its declaration on each customer endpoint, and its test (P10-16).
- **Any phase that deletes sessions, memberships or collections:** it must first keep billing's evidence of activity
  (§3.3).
- **P12:** billing emails (the warning before the billing date, the suspension, the restore); invoice PDFs.
- **P13:** the Subscription page and the redirect while suspended (`middleware.ts`).
- **P15:** the worker's billing tasks in production, its `BILLING_CHARGES` setting, and §9's conditions.

## 7. Decisions (recommended options, the project lead's standing instruction)

| # | Decision | Taken |
|---|---|---|
| P10-1 | The job runner | P9's worker and leases on the domain's own rows, not pg-boss (P9-1) |
| P10-2 | Where suspension lives | its own billing state, with every transition defined (§3.1), not a merchant lifecycle status: suspension and deactivation have different causes, people and ways back |
| P10-3 | The subscription gate (TA-25) | a required per-endpoint declaration in the registry plus a per-permission flag checked in `assert_authority`; no separate middleware |
| P10-4 | Reading the state | without a row lock, so the check adds nothing to any lock footprint; TA-12 accepts that a request already admitted completes |
| P10-5 | What triggers a restore | a confirmed charge only; retried by the worker's sweep once the wallet covers the amount, or at the business's request |
| P10-6 | Price changes | versions with a start date at least 30 days away (Q8), never edits; invoices keep their version |
| P10-7 | Agent activity | from existing sessions and collections, in a defined window, with a guard test that keeps that evidence; no `tenancy.agent_activity` table and nothing added to the hot paths |
| P10-8 | Posting a subscription | P9's order gains the platform's posting, by the confirmed fee model; both ledgers post in the order's success transaction |
| P10-9 | Billing off | nothing written; a read-only preview for the platform team |
| P10-10 | How money moves | a provider transfer from the business's virtual account to the platform's, through the port. Recording it in the books alone, if TransactPay's balances turn out to be pooled, is **not** chosen: it would change what the ledgers' 1100s mirror, and goes to the reviewer and the owner once TransactPay answers |
| P10-11 | Not enough money | decided by the reservation in `create_order` before any order exists, and by the provider's answer after |
| P10-12 | Billing's lock category | 19, after payments |
| P10-13 | Businesses billing leaves alone | deactivated and unconfirmed ones, and `exempt` ones |
| P10-14 | P9's open state | P10 is planned and built on P9's merged code, and changes two P9 functions (`create_order`'s reservation, the `cancelled` state); P10 does not close before P9 does |
| P10-15 | Gate | this plan's review now; one review of the build at the end |
| P10-16 | The customer audience | out of P10's exit criteria by an explicit amendment, as P2's was; RESTRUCTURING_MAP's P10 row is amended when this plan is approved. Building customer sign-in here would be a phase of its own |
| P10-17 | Concurrent spending | every outbound order reserves its amount against the source wallet's locked 1100 projection |
| P10-18 | The charge guard | four conditions, checked by the database at claim and by the worker before each send; configuration alone is not trusted |

## 8. Questions out

| To | Document | State |
|---|---|---|
| The owner | `docs/business/P10_OWNER_BILLING.md` | answered 11 November 2026, every question with the suggested option; the wording approved |
| The owner | `docs/business/P10_OWNER_BILLING_FOLLOWUP.md` | F1 unpaid months when exempted; F2 lifting an exemption; F3 the dates before a custom price; F4 switching off; F5 who bears the transfer fee. **Not answered** |
| TransactPay | `docs/business/P10_TRANSACTPAY_QUESTIONS.md` (with the P9 follow-up) | §1 moving money between virtual accounts, and `accountName`; §2 duplicate references, the lookup and the status table; §3 insufficient funds; §4 sandbox testing; §5 fees. **Not sent yet** |

## 9. Before billing is switched on

Every condition is a gate: the adapter declares `walletTransfer` only when 1–3 are met, and production refuses
`BILLING_CHARGES=on` without it (§3.8).

| # | Condition | Proven by |
|---|---|---|
| 1 | TransactPay documents a transfer between two of our virtual accounts, debiting the source account, with the destination's required fields (`accountName` included) | their answer (§1); the adapter implements it; a sandbox test moves money between two sandbox virtual accounts and sees both balances change |
| 2 | TransactPay states what a repeated reference does (refused, or answered with the first transfer's result), that the lookup by reference answers from when, and for how long, every status, which are final, and whether a failure can later succeed | their answer (§2); sandbox tests of a duplicate reference, a lookup after a timeout, and pending to final where the sandbox allows (§4) |
| 3 | TransactPay states its insufficient-funds answer | their answer (§3); the adapter maps it to `insufficient`; a sandbox test |
| 4 | The fee model is confirmed, and is one §3.5 supports under the owner's F5 | their answer (§5); its posting tested; the reconciler finds no difference after a sandbox transfer |
| 5 | Pooled or per-account balances (P9 follow-up §2) | their answer. If pooled, P10-10 and the reconciler are revisited with the reviewer and the owner before switching on |
| 6 | P9's conditions for live money (P9 plan §10) | P9's own gate |
| 7 | The accountant confirms in writing how subscription income is accounted for VAT (Q10) | a written sign-off. If VAT is inside the price, the platform posting gains a VAT-payable line (a new platform chart account) before switching on |
| 8 | The owner answers F1–F5 | the follow-up form |
| 9 | The owner switches billing on, as Super Admin, from the platform admin | BR-1.3 |

## 10. The build, once approved

- **Migrations:**
  1. `billing_core`: schema, tables, RLS, the price seed, the permission flag, the order's platform posting and
     `cancelled` state, `create_order`'s reservation;
  2. `billing_functions`: the run, the charge and its attempts, restore, the switch and exemptions, the reads,
     `assert_authority`'s suspended outcome.
- **Contracts:** `whileSuspended` on the registry and every existing operation; the new endpoints.
- **Provider:** `capabilities.walletTransfer` and the transfer on the port; the FakeProvider with every fee model and
  outcome; the TransactPay adapter declares false.
- **API and worker:** `modules/billing`, the worker's three tasks and the charge gate, `BILLING_CHARGES`, the 402 and 403
  envelopes.
- **Tests:** as in §5, in the db and API suites.
- **The gate:**
  - every step exit 0 on a clean tree at a named commit: `format:check`, `lint`, `typecheck`, `build`, `openapi:check`,
    `test`, `test:concurrency`, and the gitleaks history scan;
  - run with `npm_config_workspace_concurrency=1`;
  - Linux CI on the pull request.

## 11. Revision log

| Rev | Date | Change |
|---|---|---|
| 3 | 2026-11-11 | The plan review's 14 findings resolved (§12): every state transition, dates and windows, the upcoming charge, attempts, the reservation, the charge gate, the fee postings, exemptions and switch-off, the customer amendment, the VAT condition; the owner's follow-up (F1–F5) and TransactPay's questions extended |
| 2 | 2026-11-11 | The owner's answers recorded (Q1–Q14, the wording): the design's open choices take them |
| 1 | 2026-11-11 | First plan, for the reviewer's plan review; the owner's form and TransactPay's questions written |

## 12. The plan review (2026-11-11)

The independent reviewer did not approve revision 2 and listed 14 design gaps. Each is resolved below.

| # | Finding | Resolved in |
|---|---|---|
| 1 | The provider gate didn't require the evidence the design needs (`accountName`, duplicate semantics, the lookup, timing) | TransactPay's questions §1.4, §2 and §4 added; §9 conditions 1–3 need their answers implemented and proven in the sandbox; the adapter's `walletTransfer` gates them (§3.8) |
| 2 | The state machine left out first-bill outcomes and when the trial ends | §3.1: every transition. `trial` → `current` when the first invoice is issued, whatever the charge does; then the same failure rules apply |
| 3 | The 7-day warning had no data path | §3.4 `upcoming`, computed by the run's own function, with the estimate, version, custom-price case and `walletShort` |
| 4 | Billing periods, timezone and the 15-day boundary were undefined | §3.4: WAT, period key = billing date, dates from `anchor_day` (no drift); §3.3: the window, with exactly 15 days not counted; §5 tests the boundaries |
| 5 | The activity proxy wasn't shown to be the owner's events | §3.3: only the agent sign-in creates agent sessions, refresh isn't a sign-in, and nothing deletes sessions, memberships or collections; a guard test pins it; §6 passes the duty on |
| 6 | Retries and attempt identity were undefined | §3.5 attempts: numbered references, one unfinished per invoice, a new attempt only after a final failure or a cancellation; §3.7 the request to pay; §5 tests each terminal outcome |
| 7 | The balance check didn't stop concurrent spending | §3.5 and P10-17: `create_order` reserves against the locked 1100 projection for every outbound order; a race test |
| 8 | Exemption semantics were undefined | §3.1 and §3.8 with F1 and F2; the owner decides (follow-up form) |
| 9 | "No price yet" could lose a period silently | §3.2: unbilled dates recorded and listed; F3 decides whether they are ever charged |
| 10 | Switch-off and exemption ignored in-flight charges | §3.8: `created` orders cancelled in the same transaction; claimed ones finish and post; the claim checks the gate; F4 |
| 11 | The production guard was configuration only | §3.8 and P10-18: four conditions, checked in the database at claim and in the worker before each send; tests bypass the API |
| 12 | The exit criteria contradicted the deferred customer test | P10-16: an explicit amendment of the exit criteria; §6 |
| 13 | Fees were asked about, not accounted for | §3.5's posting per fee model, with the fee taken from the provider; F5; §9 condition 4 needs it tested and reconciled |
| 14 | VAT accounting wasn't a release gate | §9 condition 7: the accountant's written treatment, and a VAT-payable line if VAT is inside the price |
