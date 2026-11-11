# P10 implementation plan — billing

**Status: revision 4 (2026-11-11), a draft for the independent reviewer's plan review. Nothing is built.**

- **The reviews:**
  - revision 3 resolved the first plan review's 14 findings (§12);
  - revision 4 resolves the second review's 8 findings (§13).
- **The owner's answers:**
  - `docs/business/P10_OWNER_BILLING.md`, answered 11 November 2026: every question (Q1–Q14) with the suggested option,
    and the permissions' wording approved as written;
  - `docs/business/P10_OWNER_BILLING_FOLLOWUP.md`, answered 11 November 2026: every question (F1–F5) with the suggested
    option. F2's and F3's answers repeat the suggested option's text with two typing slips. The form records how they
    are read, for the owner to confirm (§8).
- **The build starts once** the reviewer approves this plan and the project lead agrees.

Decisions that would go to the project lead take the recommended option (his standing instruction) and are recorded in
§7. P9 is merged to `main` but **not closed**. P10 builds on its payment orders and worker, and does not close before P9
does (P10-14).

**Billing stays paused (BR-1.3), and no real money moves in P10.** Billing can charge only once every condition in §9
holds. Each condition is enforced by the system (§9), not by a person's memory.

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
- **Billing dates:** in WAT, chargeable by a recorded history (§3.4).
- **The billable-agent count** (BR-10.6a, Q2).
- **Invoices,** one per business per chargeable billing date.
- **The upcoming charge,** shown from 7 days before the billing date (Q7).
- **The charge:**
  - a payment order from the business's Live wallet to the Platform Live wallet;
  - numbered attempts, with bounded retries;
  - a reservation against concurrent spending;
  - a defined point of no return;
  - postings in both ledgers on confirmation, the fee borne by AlphaKolect (BR-10.3, F5).
- **Suspension:** for insufficient funds, enforced for each audience in both layers (BR-10.4, TA-25).
- **Restore:** automatic, on a confirmed charge only (BR-10.5, TA-12).
- **The billing switch and exemptions,** with in-flight charges handled (BR-1.3, Q11, F1, F2, F4).
- **The release guard,** which enforces every condition of §9 (§3.8).
- **A preview** of what billing would charge, while it is off.

**Not in P10:**

- **Moving real money.** The TransactPay adapter can't yet move money between virtual accounts (P9 §10 condition 5).
  `P10_TRANSACTPAY_QUESTIONS.md` asks how, and the transfer is built and tested against the FakeProvider only.
- **Emails and reminders** (P12, notifications). In P10 the warning is on the Subscription page (Q7).
- **The customer audience's suspension behaviour.** Customers can't sign in yet: sessions are platform, merchant or
  agent. It leaves P10's exit criteria by an explicit amendment (P10-16) and passes to the phase that builds customer
  sign-in (§6).
- **Refunds.** A charge that should not have happened is listed for the platform team. Paying money back out is a
  payout (OPEN-7), outside P10 (§6).
- **Invoice PDFs** (documents, P12).
- **The web Subscription page and its redirect** (P13). P10 delivers the API and the error codes it needs.

## 2. The findings due before P10

| Finding | Settled by |
|---|---|
| TA-12: billing restore and suspension need failure rules | Restore only on a charge TransactPay has confirmed. A deposit alone never restores (§3.7). A charge in `unknown` changes no state until it is resolved. Requests that have passed the check complete, and the next request sees the new state (§3.6). "Email confirmed, wallet being set up" is a valid state: such a business is in trial, so there is nothing to charge. Several unpaid months: everything owed must be paid (Q5) |
| TA-25: a separate subscription gate | No separate gate. Every endpoint declares its behaviour while suspended in the route registry, and an endpoint with no declaration is blocked. The database enforces the same rule through the permission it already checks (§3.6, P10-3) |
| TA-1: platform ledger | Settled in P6: the ledger has `owner_kind`. The platform chart has 1100 Platform wallet, 4100 Subscription income and 5100 Provider charges, and the templates `subscription.paid` (business: Dr 5100 / Cr 1100) and `platform.subscription_received` (platform: Dr 1100 / Cr 4100) exist |
| The P9 plan §6: the subscription on P9's payment orders | An order posts to one ledger today. A subscription posts to two, the business's and the platform's, in one transaction (§3.5, P10-8) |
| The P9 plan §10 condition 5: VA-to-VA transfers, payout idempotency, `accountName` | Asked of TransactPay (`P10_TRANSACTPAY_QUESTIONS.md` §1–§5, `accountName` included). Billing can't charge until their answers are implemented and proven in the sandbox (§9) |

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
- **`billing.invoices`:** one per business and chargeable billing date. Each is `open`, `paid`, `waived`, or
  `waiver_pending` (an exemption waiting on a charge already past the point of no return, §3.8). The amount owed is the
  sum of the `open` invoices.
- **Every state change** is made by a billing function, in the same transaction as its cause, and recorded in the
  activity record. The full set of transitions:

| From | Event | To | Invoices |
|---|---|---|---|
| — | the business's email is confirmed | `trial` | none; `trial_ends_on` = the confirmation day + 90 days (Q1) |
| `trial` | its first chargeable billing date is processed (§3.4) | `current` | the first invoice is issued, `open`. The trial ends here, whatever the charge then does |
| `trial` | its first billing date is processed but isn't chargeable (§3.4) | `trial` | none; the date is recorded as unbilled, and the next date follows |
| `current` | a chargeable billing date is processed | `current` | a new invoice, `open`. Any earlier `open` one stays owed |
| `suspended` | a chargeable billing date is processed | `suspended` | a new invoice, `open`, added to what is owed. The owner chose "everything owed must be paid" (Q5) over "a suspended business isn't billed for further months" |
| `current` | a charge attempt is refused for lack of money, by the reservation (§3.5) or by the provider | `suspended` | the invoice stays `open` |
| `current` or `suspended` | a charge attempt fails finally for any other reason | unchanged | stays `open`; retried on the bounded schedule of §3.5. A failure that isn't for lack of money never suspends |
| `current` or `suspended` | a charge attempt's outcome is `unknown` | unchanged | stays `open`; no new attempt until P9's lookup resolves it |
| `current` | a charge succeeds | `current` | `paid` |
| `suspended` | a charge succeeds and no other invoice is `open` (Q5) | `current` | `paid` |
| `suspended` | a charge succeeds while other invoices are still `open` | `suspended` | that one `paid`; the next is attempted |
| any but `exempt` | exempted by the Super Admin (Q11) | `exempt` | `open` invoices with no attempt past the point of no return become `waived`, with the reason. Those with one become `waiver_pending` (F1, §3.8) |
| `exempt` | a `waiver_pending` invoice's charge succeeds | `exempt` | `paid`: the money moved, as F4 records for any payment already sent |
| `exempt` | a `waiver_pending` invoice's charge fails or is resolved failed | `exempt` | `waived` |
| `exempt` | the exemption is lifted | `trial` if `trial_ends_on` hasn't passed, otherwise `current` | none for the exempt time; billing restarts at the next billing date after today (F2). Lifting never suspends |
| `suspended` | billing is switched off | `current` | stay `open` and visible; nothing is taken while off (F4) |

- **Nothing else changes a state.** A transition test covers each row.

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
  - the date is recorded unbilled with the reason `awaiting_price`, and the business is listed for the platform team
    (Q9);
  - billing starts at the first billing date after the price is set (F3).
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

### 3.4 Billing dates, the run and the upcoming charge (Q3, Q7, Q12, F2, F4; P10-19)

**Dates**
- **No date exists before billing is first switched on.** `next_billing_on` is empty until then. Switching on for the
  first time sets each business's first billing date to the later of `trial_ends_on` and the switch-on day (Q12).
- **Later dates come from the anchor.** The first date's day of the month becomes `anchor_day`. Each later date is the
  anchor day of the following month, or that month's last day if it is shorter (Q3).
  - Every date is computed from `anchor_day`, never from the previous date, so the day never drifts. Anchor 31 gives 31
    Jan, 28 or 29 Feb, 31 Mar.
  - The anchor is kept through exemptions and switch-offs.
- **The period key is the billing date.** `(merchant_id, billing_on)` is unique across invoices and unbilled dates
  together.

**Whether a date is chargeable**

The run processes every date that has come, and never skips one silently. A date D becomes an invoice only if all three
of these hold:
1. billing was switched on at D 00:00, by `billing.switch_history`, which records every change of the switch with its
   time;
2. the business was not exempt at D 00:00, by `billing.exemption_history`;
3. the release guard (§3.8) is open when the date is processed.

Otherwise D is recorded in `billing.unbilled_dates` with the first reason that failed: `billing_off`, `exempt`,
`charges_held`, or `awaiting_price` (§3.2).

This separates the three cases the review asked about:
- **a delayed worker:** a date missed while the switch was on and the guard open is invoiced late, for D's window and
  version. That is debt the owner's switch allowed;
- **an intentional pause:** a date that passed while billing was off, or while the business was exempt, is never
  invoiced. Nothing is backdated (Q12, F2, F4);
- **charges held:** a date processed while the release guard is closed is never invoiced, even once it reopens.

**The run**
- A worker task sweeps the businesses whose `next_billing_on` is today or earlier. It claims each with a lease, one at a
  time, as P9's claims do. Per business and date, in one transaction:
  1. decide whether the date is chargeable (above);
  2. if so, count the agents for D's window, never for "now", and choose the band and the version in force on D;
  3. write the invoice, or the unbilled date;
  4. move `next_billing_on` to the next date.
- A run repeated, or two at once, produce one row per business and date (test). A business several dates behind gets one
  row per date. More than one late invoice at once is listed for the platform team.
- The run writes nothing for a business with no billing date yet (billing never switched on). The platform team's
  preview computes the figures without writing them.

**The upcoming charge (Q7).** From 7 days before `next_billing_on`, `GET /v1/merchant/subscription` returns `upcoming`,
computed by the run's own function, with:
- `billingOn`;
- `agentsSoFar`: the count for the window ending now, marked as an estimate (the final count is taken on the date);
- the band and the version in force on that date;
- the amount, or `awaitingPrice: true` for 21 or more with no price;
- `walletShort`: whether the wallet's balance, less the reservations (§3.5), is below what is owed plus the upcoming
  amount.

It isn't shown while billing is off or the business is exempt, since that date won't be charged.

### 3.5 The charge (BR-10.3; P10-8, P10-10, P10-11, P10-17, P10-20, P10-21)

**Who makes orders.** Only the worker's charge task makes a subscription order. It does so only while the release guard
(§3.8) is open, and the guard is checked again at the claim.
- The request to pay (§3.7) makes no order. It marks the business's open invoices as requested, and the task picks them
  up on its next pass.
- So no order and no reservation can exist while charges are held (test).

**Attempts.** `billing.charge_attempts` records each attempt: invoice, attempt number, payment order, outcome.
- The order's reference is `sub-<invoice id>-<attempt number>`. A new attempt has a new reference, and an old reference
  is never reused.
- A partial unique index allows one unfinished attempt per invoice.
- Open invoices are attempted oldest first.

**When a new attempt is made (P10-20).**
- Only after the previous attempt is final: failed, `insufficient` or cancelled. Never after `unknown`, and never while
  one is unfinished.
- Only when the provider guarantees that a final failure never later succeeds (`capabilities.finalFailureIsFinal`, from
  TransactPay's answer to §2.4). It is part of the release guard (§9 condition 2): without it, billing can't charge at
  all, and the plan returns to the reviewer and the owner.
- If a final failure later succeeds despite the guarantee, P9's contradiction path lists it. Nothing is posted
  automatically. A second debit that results is owed back to the business, and is listed as a refund for the platform
  team (§6).

**The retry schedule (P10-21).** After an `insufficient` attempt, the next one is made when the wallet covers the amount
(§3.7). After any other final failure:
- the next attempts come 1 hour, 6 hours and 24 hours after the last failure;
- after 3 such failures in a row, the invoice is `held`, and no attempt is made automatically. It is listed for the
  platform team with each failure's provider answer;
- a held invoice gets one attempt at the business's next billing date, and one on each request to pay (at most one an
  hour). If that attempt succeeds, the hold ends;
- the platform team's part is to fix the cause (configuration, the provider). No release command is needed;
- a held invoice never suspends the business: the failure isn't the business's.

**The reservation (P10-17).** P9's `create_order`, the only way an order is made, is changed for every purpose:
1. it locks the source wallet's 1100 projection (`FOR NO KEY UPDATE`, category 14);
2. it refuses with `insufficient` unless the balance, less the amounts of that wallet's unfinished outbound orders, is
   at least the new amount.

Two orders against the same money are serialized by the lock, and only one is made (test). Nothing else spends from a
Live wallet in P10 (P9 Q2), and any later payout path goes through the same function. A refusal by the reservation is
the "lack of money" outcome: the attempt is recorded as `insufficient`, and §3.1 applies. Nothing is half taken (Q6).

**The point of no return (P10-22).** An order is "sent" from the moment its claim commits.
- The claim moves it from `created` to `unknown` (P9's design: a claimed order may already have been sent). In the same
  transaction, the claim takes `FOR SHARE` on `billing.settings` and on the business's `merchant_billing` row, and claims
  only if billing is on and the business isn't exempt.
- Switching off and exempting take those rows for update, so a claim and a switch-off are serialized:
  - if the switch-off commits first, no claim commits afterwards;
  - if the claim commits first, the order is past the point of no return, and is finished and recorded, as F4 records.
- After its claim, the worker does nothing but check its lease and send. A lapsed lease leaves the order `unknown`, for
  P9's lookup.
- An order still `created` when billing is switched off or the business is exempted is `cancelled`, in that same
  transaction (a state P10 adds to P9's orders, reachable only from `created`).

**Success: two ledgers, and AlphaKolect's fee (F5).** On success, `record_order` posts in one transaction:
- `subscription.paid` to the business's ledger: Dr 5100 / Cr 1100, for the price. The business pays exactly the price
  (F5);
- the platform's side, by the fee model TransactPay confirms, with the fee taken from the provider's answer and never
  computed by us:

| Fee model (TransactPay §5) | Platform posting |
|---|---|
| no fee | Dr 1100 / Cr 4100, the price |
| fee taken from the amount in transit | Dr 1100, the price less the fee; Dr 5100 Provider charges, the fee / Cr 4100, the price |
| fee charged separately to the platform's balance | Dr 1100 / Cr 4100, the price; and Dr 5100 / Cr 1100, the fee |
| fee charged to the business's wallet on top | not supported: it contradicts F5. The adapter can't declare the capability (§9 condition 4) |

- If VAT is inside the price (§9 condition 7), the platform's posting splits 4100 and a VAT-payable account by the
  recorded rate.
- A confirmation whose fee model isn't the one the adapter declared is not posted. It goes to P9's contradiction path.
- The invoice becomes `paid` in the same transaction. Each posting is keyed by the provider transaction, so each is made
  once.

**The lock order.** `billing` is lock category 19, after payments (18).
- The success path takes the projections (14), the order (18), then the attempt, the invoice and the billing state (19).
- The claim takes the order (18, skip locked), then the settings and the billing state (19, share).
- Switching off and exempting take the `created` orders (18), then the settings or the billing state (19).

Each footprint is pinned in the lock-order guard.

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
  - the owner, or staff with `merchant.subscription.pay`, asks for one.
- **The request to pay:**
  - it carries an `Idempotency-Key`, and a repeat returns the first answer;
  - it makes no order itself (§3.5): it marks the open invoices as requested, and answers with their attempts;
  - with charges held or billing off, it records nothing and says so.
- **Sessions aren't revoked or reissued.** The state is read on each call, so the next request after the restore
  succeeds.

### 3.8 The switch, exemptions and the release guard (BR-1.3; Q11, Q12, F1, F2, F4; P10-9, P10-18)

**The switch**
- **`billing.settings`:** one row, `enabled` false by default, plus the recorded VAT treatment (§9 condition 7).
  - Only `platform.billing.switch` changes it. That permission is the Super Admin's and can't be granted, like P5's
    reserved actions.
  - The application role has no privilege on the table. Only the switch function writes it.
  - Every change is appended to `billing.switch_history`.
- **Turning it on** is refused unless the VAT treatment is recorded. That is a database check: `enabled` implies a
  treatment.

**The release guard** is open only when all four of these hold. It is checked by the run, by the charge task before it
makes an order, by the claim, and by the worker again before each send:
1. `billing.settings.enabled` is true (checked in the database at the claim, under share lock, §3.5);
2. the business isn't `exempt` (likewise);
3. the worker's environment allows charges (`BILLING_CHARGES=on`, off by default);
4. the provider declares `capabilities.walletTransfer` and `capabilities.finalFailureIsFinal`. TransactPay's adapter
   declares them only in the release that implements and proves §9 conditions 1–5.

**Production configuration** refuses `BILLING_CHARGES=on` while the configured provider lacks either capability. So a
stale setting, a direct database update, or a switch turned on early still sends nothing. Tests set `enabled` directly in
the database, with the environment off or a capability false, and see no invoice, order or send.

**Visibility.** The worker records whether the guard is open in each pass's status, and the platform view shows it.
"Billing switched on, charges held" is visible, not silent.

**Switching off (F4).** In one transaction:
- the `created` orders are `cancelled`;
- every `suspended` business becomes `current`;
- open invoices stay open.

Orders already past the point of no return (§3.5) finish through P9's machinery. A success is posted and pays its
invoice, because the money moved.

**Exempting a business (F1).** In one transaction:
- its `created` orders are cancelled;
- its open invoices are waived, or `waiver_pending` if a charge is past the point of no return (§3.1);
- while it is exempt, its dates are unbilled (§3.4).

**Lifting an exemption (F2)** follows §3.1.

## 4. Interfaces

| Endpoint | Who | While suspended | |
|---|---|---|---|
| `GET /v1/merchant/subscription` | `merchant.subscription.read` | allowed | the state, trial end, band, price, next billing date, the coming price (Q8), the amount owed, `upcoming` (§3.4), and the Live wallet's details for loading it |
| `GET /v1/merchant/subscription/invoices` | `merchant.subscription.read` | allowed | the invoices, with the agents counted and their attempts |
| `POST /v1/merchant/subscription/payment` | `merchant.subscription.pay` | allowed | asks for a charge of what is owed (`Idempotency-Key`; §3.7) |
| `GET /v1/platform/billing/businesses` · `…/{merchantId}/invoices` · `/v1/platform/billing/preview` · `/v1/platform/billing/status` | `platform.billing.read` | — | every business's billing state and amount owed; a business's invoices, unbilled dates and held invoices; what a run would charge; whether the release guard is open (§3.8) |
| `GET` · `POST /v1/platform/billing/prices` · `POST …/prices/{id}/withdrawal` | `platform.billing.read` / `platform.billing.prices` | — | the versions; a new version with its start date; withdrawing one not yet started |
| `PUT /v1/platform/billing/businesses/{merchantId}/custom-price` | `platform.billing.custom_price` | — | the price for 21 or more agents (Q9, F3) |
| `PUT /v1/platform/billing/settings` · `POST` · `DELETE …/businesses/{merchantId}/exemption` | `platform.billing.switch` (Super Admin; not grantable) | — | switching billing on or off, and recording the VAT treatment; an exemption and lifting it |

- **Activity events** (atomic; identifiers and amounts only):
  - `billing.invoice_issued`, `billing.date_unbilled`;
  - `billing.charge_requested`, `billing.charge_cancelled`, `billing.charge_held`;
  - `billing.invoice_paid`, `billing.invoice_waived`;
  - `billing.suspended`, `billing.restored`;
  - `billing.prices_set`, `billing.prices_withdrawn`, `billing.custom_price_set`;
  - `billing.switched`, `billing.exempted`, `billing.exemption_lifted`.
- **Sensitive reads** are recorded once per page, as in P9.
- **The P9 Live-wallet read** (`GET /v1/merchant/wallet`) is declared allowed while suspended.

## 5. Tests

**BR-1.3 and the release guard**
- Before billing is first switched on, no date exists and nothing is written.
- `enabled` set directly in the database, with `BILLING_CHARGES` off or a capability false: no invoice, order or send.
- Production configuration refuses `BILLING_CHARGES=on` without both capabilities.
- Turning billing on without a recorded VAT treatment is refused.
- The request to pay, with charges held, creates no order and no reservation.

**State transitions**
- Every row of §3.1's table, each by its own test, including a suspended business accruing a second invoice.

**Chargeable dates**
- A date missed by a stopped worker while billing was on is invoiced late, for its own window.
- A date that passed while billing was off, while exempt, or while charges were held stays unbilled after everything
  reopens.
- A lifted exemption bills from the next date.

**BR-10.1 and prices**
- The price at each band's edge: 0, 1, 3, 4, 6, 7, 10, 11, 20 and 21 agents.
- 21 or more without a price: the date is unbilled. A price set before the next date is invoiced on it; one set after
  leaves that date unbilled too (F3).

**BR-10.2, 12.2**
- A new version applies from its start date and not before, and the 30-day notice is enforced.
- A past invoice keeps its version. The 7-day warning shows the version in force on the billing date.

**Dates and the window**
- The trial ends 90 days after the confirmation day (Q1).
- Anchors on the 28th, 29th, 30th and 31st, through a leap February and back, never drift.
- Activity exactly 15 days before D isn't counted; a moment later is; activity on D counts for the next date.
- The first switch-on bills nothing backdated (Q12).

**BR-10.3 and the charge**
- One order per attempt, from the business's wallet to the platform's.
- On confirmation both ledgers post once, in one transaction, for each fee model. The business's posting is always
  exactly the price.
- A confirmation with an undeclared fee model isn't posted. A replayed confirmation posts nothing more.

**Attempts, retries and holds**
- `insufficient`, then a deposit: attempt 2, with a new reference.
- `failed`: attempts at 1 h, 6 h and 24 h. The third failure holds the invoice, and it gets no automatic attempt until
  the next billing date or a request to pay.
- `cancelled`: a new attempt once the guard reopens.
- `unknown`: nothing until resolved. Resolved failed gives attempt 2; resolved successful gives nothing, and the invoice
  is paid.
- With `finalFailureIsFinal` false, no attempt 2 is ever made.
- A repeated `Idempotency-Key` returns the first answer.

**The reservation**
- Two orders at once against a wallet that can pay for one: exactly one is made.
- An unfinished order's amount is reserved until it is final.

**The point of no return**, as races:
- switch-off against a claim: either the claim commits first and the order is sent and recorded, or the switch-off
  commits first and no claim commits after it. Never a send after a committed switch-off;
- the same for exempting;
- exempting while a charge is past the point of no return: `waiver_pending`, then `paid` on success, `waived` on
  failure.

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
- The guard test of §3.3: no deletions, and only the agent sign-in creates agent sessions.

**The switch and exemptions** (F1, F2, F4)
- Switching off cancels the `created` orders and restores the suspended businesses.
- Exempting waives the open invoices.
- Lifting resumes at the next date without suspending.

**Races**
- Two runs at once: one row per business and date.
- Two requests to pay at once: one attempt.
- A restore and a new invoice at once leave a consistent state.

**Isolation and guards**
- A business sees only its own subscription. A run and a charge touch only the business they claim (TA-11).
- Lock order (category 19, the claim's share locks, `create_order`'s new 14:NKU).
- Grants: the worker's functions are executable by `alphakolect_worker` alone.
- Transaction classes, the matrices, the coverage and writer guards, and `x-while-suspended` on every operation.

## 6. Obligations passed on

- **The phase that builds customer sign-in:** BR-10.4 for customers (view-only; `423 MERCHANT_SUSPENDED`, "Please
  contact the company."), its declaration on each customer endpoint, and its test (P10-16).
- **Any phase that deletes sessions, memberships or collections:** it must first keep billing's evidence of activity
  (§3.3).
- **OPEN-7 (payouts):** refunding a charge listed as owed back (§3.5).
- **P12:** billing emails (the warning before the billing date, the suspension, the restore, a held invoice); invoice
  PDFs.
- **P13:** the Subscription page and the redirect while suspended (`middleware.ts`).
- **P15:** the worker's billing tasks in production, its `BILLING_CHARGES` setting, and §9's conditions.

## 7. Decisions (recommended options, the project lead's standing instruction)

| # | Decision | Taken |
|---|---|---|
| P10-1 | The job runner | P9's worker and leases on the domain's own rows, not pg-boss (P9-1) |
| P10-2 | Where suspension lives | its own billing state, with every transition defined (§3.1), not a merchant lifecycle status: suspension and deactivation have different causes, people and ways back |
| P10-3 | The subscription gate (TA-25) | a required per-endpoint declaration in the registry plus a per-permission flag checked in `assert_authority`; no separate middleware |
| P10-4 | Reading the state for suspension | without a row lock, so the check adds nothing to any request's lock footprint; TA-12 accepts that a request already admitted completes |
| P10-5 | What triggers a restore | a confirmed charge only; retried by the worker's sweep once the wallet covers the amount, or at the business's request |
| P10-6 | Price changes | versions with a start date at least 30 days away (Q8), never edits; invoices keep their version |
| P10-7 | Agent activity | from existing sessions and collections, in a defined window, with a guard test that keeps that evidence; no `tenancy.agent_activity` table and nothing added to the hot paths |
| P10-8 | Posting a subscription | P9's order gains the platform's posting, by the declared fee model, AlphaKolect bearing the fee (F5); both ledgers post in the order's success transaction |
| P10-9 | Billing off | nothing invoiced or charged; dates that pass are recorded unbilled; a read-only preview for the platform team |
| P10-10 | How money moves | a provider transfer from the business's virtual account to the platform's, through the port. Recording it in the books alone, if TransactPay's balances turn out to be pooled, is **not** chosen: it would change what the ledgers' 1100s mirror, and goes to the reviewer and the owner once TransactPay answers |
| P10-11 | Not enough money | decided by the reservation in `create_order` before any order exists, and by the provider's answer after |
| P10-12 | Billing's lock category | 19, after payments |
| P10-13 | Businesses billing leaves alone | deactivated and unconfirmed ones, and `exempt` ones |
| P10-14 | P9's open state | P10 is planned and built on P9's merged code, and changes two P9 functions (`create_order`'s reservation, the `cancelled` state); P10 does not close before P9 does |
| P10-15 | Gate | this plan's review now; one review of the build at the end |
| P10-16 | The customer audience | out of P10's exit criteria by an explicit amendment, as P2's was; RESTRUCTURING_MAP's P10 row is amended when this plan is approved. Building customer sign-in here would be a phase of its own |
| P10-17 | Concurrent spending | every outbound order reserves its amount against the source wallet's locked 1100 projection |
| P10-18 | The release guard | four conditions, checked at the run, at order creation, at the claim (in the database) and before each send (in the worker); configuration alone is not trusted |
| P10-19 | Chargeable dates | decided by the switch's and exemptions' recorded history at the date, and by the guard when processed; every date is recorded, invoiced or unbilled with its reason |
| P10-20 | Retrying a failed charge | only with the provider's guarantee that a final failure is final; without it, billing can't charge |
| P10-21 | Bounded retries | 1 h, 6 h and 24 h after a non-money failure, then held: one attempt per billing date or request to pay, never suspending |
| P10-22 | The point of no return | the claim's commit, made only with billing on and the business not exempt under a share lock that switch-off and exemption must wait for |

## 8. Questions out

| To | Document | State |
|---|---|---|
| The owner | `docs/business/P10_OWNER_BILLING.md` | answered 11 November 2026: every question with the suggested option; the wording approved |
| The owner | `docs/business/P10_OWNER_BILLING_FOLLOWUP.md` | answered 11 November 2026: F1–F5, each with the suggested option. F2 ("Thne") and F3 ("words that passed") repeat the suggested option's text with typing slips, and are read as that option. The form notes this, for the owner to confirm or correct |
| TransactPay | `docs/business/P10_TRANSACTPAY_QUESTIONS.md` (with the P9 follow-up) | §1 moving money between virtual accounts, and `accountName`; §2 duplicate references, the lookup, the status table, and whether a failure can later succeed; §3 insufficient funds; §4 sandbox testing; §5 fees. **Not sent yet** |

## 9. Before billing can charge

Each condition is enforced by the system. None depends on someone remembering it.

| # | Condition | Proven by | Enforced by |
|---|---|---|---|
| 1 | TransactPay documents a transfer between two of our virtual accounts, debiting the source account, with the destination's required fields (`accountName` included) | their answer (§1); a sandbox test moves money between two sandbox virtual accounts and sees both balances change | `walletTransfer` declared only by the adapter release that implements it; production refuses `BILLING_CHARGES=on` without it |
| 2 | TransactPay states what a repeated reference does, when and for how long the lookup answers, every status and which are final, and **guarantees that a final failure never later succeeds** | their answer (§2); sandbox tests of a duplicate reference, a lookup after a timeout, and pending to final where the sandbox allows (§4) | `finalFailureIsFinal` declared only with that guarantee; without it, production refuses `BILLING_CHARGES=on` |
| 3 | TransactPay states its insufficient-funds answer | their answer (§3); the adapter maps it to `insufficient`; a sandbox test | part of the adapter release behind `walletTransfer` |
| 4 | The fee model is confirmed, and is one §3.5 supports, AlphaKolect bearing the fee (F5) | their answer (§5); its posting tested; the reconciler finds no difference after a sandbox transfer | the adapter declares one fee model, and the capability only if it is supported. A confirmation with another model isn't posted |
| 5 | Pooled or per-account balances (P9 follow-up §2) | their answer | the capability is declared only for per-account balances. If pooled, P10-10 and the reconciler return to the reviewer and the owner |
| 6 | P9's conditions for live money (P9 plan §10) | P9's own gate | P10's migrations come after P9's. Production can't have billing without P9's tables, functions and worker role, which wait for P9's conditions (P15) |
| 7 | The accountant confirms in writing how subscription income is accounted for VAT (Q10) | a written sign-off | the switch can't be turned on without a recorded treatment (a database check). If VAT is inside the price, the platform posting splits it (§3.5) |
| 8 | The owner's answers | Q1–Q14 and F1–F5, answered 11 November 2026 | met |
| 9 | The owner switches billing on, as Super Admin, from the platform admin | BR-1.3 | `enabled` false by default; only the non-grantable `platform.billing.switch` changes it |

## 10. The build, once approved

- **Migrations:**
  1. `billing_core`: schema, tables (with the switch and exemption histories, unbilled dates, attempts), RLS, the price
     seed, the permission flag, the platform's VAT-payable account, the order's platform posting and `cancelled` state,
     `create_order`'s reservation;
  2. `billing_functions`: the run, the charge task, the claim's guard, attempts and holds, restore, the switch and
     exemptions, the reads, `assert_authority`'s suspended outcome.
- **Contracts:** `whileSuspended` on the registry and every existing operation; the new endpoints.
- **Provider:**
  - the port gains `capabilities.walletTransfer`, `capabilities.finalFailureIsFinal`, a declared fee model, and the
    transfer;
  - the FakeProvider covers every fee model and outcome;
  - the TransactPay adapter declares neither capability.
- **API and worker:** `modules/billing`, the worker's three tasks and the release guard, `BILLING_CHARGES`, the 402 and
  403 envelopes.
- **Tests:** as in §5, in the db and API suites.
- **The gate:**
  - every step exit 0 on a clean tree at a named commit: `format:check`, `lint`, `typecheck`, `build`, `openapi:check`,
    `test`, `test:concurrency`, and the gitleaks history scan of the project's refs;
  - run with `npm_config_workspace_concurrency=1`;
  - Linux CI on the pull request.

**The baseline before the build (2026-11-11).** P10 has only documents so far. The full gate ran at `817c28d`, whose code
is identical to `main` at `031e4db` (P9's merge), to record the health of what P10 will build on:

| Step | Result |
|---|---|
| `format:check`, `lint`, `typecheck`, `build`, `openapi:check` | exit 0 |
| `test` | exit 0: contracts 105, db 909, API 2100 passed, 4 skipped |
| `test:concurrency` | exit 0: 38 |
| The OpenAPI breaking-change check | the spec is byte-identical to `main`'s; CI's oasdiff runs on the pull request |
| gitleaks, the project's refs (branches, tags, remotes: what CI scans) | exit 0: no leaks |
| gitleaks, every local ref | exit 1: 24 findings, all in four local IDE checkpoint commits (`refs/agents/…`), on no branch and never pushed. They are copies of reviewed false positives (a type named `signingKey`, test keys, a legacy README line) |
| The tree | clean before the run. During it, the owner's follow-up answers were typed into their form (`e5a7b83`), a document the gate doesn't test |

- **The 4 skipped tests** are the TransactPay sandbox suite. It runs only with `TRANSACTPAY_SANDBOX=run` and test keys,
  never in the gate or CI.
- **An earlier run at `cf31377` failed once.** P5's purge test returned `as_of_in_future`: the database's clock read
  earlier than a time it had just given, most likely the Docker VM's clock being resynced after the machine slept. The
  same test passed at `817c28d`, and no code differed between the two.

## 11. Revision log

| Rev | Date | Change |
|---|---|---|
| 4 | 2026-11-11 | The second review's 8 findings resolved (§13): the follow-up's answers recorded; suspended businesses accrue invoices; chargeable dates by recorded history; `waiver_pending`; the point of no return at the claim; retries only with the provider's guarantee; every release condition enforced, the request to pay making no order; bounded retries and holds |
| 3 | 2026-11-11 | The plan review's 14 findings resolved (§12): every state transition, dates and windows, the upcoming charge, attempts, the reservation, the charge gate, the fee postings, exemptions and switch-off, the customer amendment, the VAT condition; the owner's follow-up (F1–F5) and TransactPay's questions extended |
| 2 | 2026-11-11 | The owner's answers recorded (Q1–Q14, the wording): the design's open choices take them |
| 1 | 2026-11-11 | First plan, for the reviewer's plan review; the owner's form and TransactPay's questions written |

## 12. The plan review (2026-11-11)

The independent reviewer did not approve revision 2 and listed 14 design gaps. Each was resolved in revision 3, and
refined by revision 4 where marked.

| # | Finding | Resolved in |
|---|---|---|
| 1 | The provider gate didn't require the evidence the design needs (`accountName`, duplicate semantics, the lookup, timing) | TransactPay's questions §1.4, §2 and §4 added; §9 conditions 1–3 need their answers implemented and proven in the sandbox, each enforced (rev 4) |
| 2 | The state machine left out first-bill outcomes and when the trial ends | §3.1: every transition. `trial` → `current` when the first invoice is issued, whatever the charge does (rev 4 adds the suspended and exempt rows) |
| 3 | The 7-day warning had no data path | §3.4 `upcoming`, computed by the run's own function, with the estimate, version, custom-price case and `walletShort` |
| 4 | Billing periods, timezone and the 15-day boundary were undefined | §3.4: WAT, period key = billing date, dates from `anchor_day` (no drift); §3.3: the window, with exactly 15 days not counted; §5 tests the boundaries |
| 5 | The activity proxy wasn't shown to be the owner's events | §3.3: only the agent sign-in creates agent sessions, refresh isn't a sign-in, and nothing deletes sessions, memberships or collections; a guard test pins it; §6 passes the duty on |
| 6 | Retries and attempt identity were undefined | §3.5 attempts: numbered references, one unfinished per invoice, a new attempt only after a final failure (rev 4: only with the provider's guarantee, and bounded) |
| 7 | The balance check didn't stop concurrent spending | §3.5 and P10-17: `create_order` reserves against the locked 1100 projection for every outbound order; a race test |
| 8 | Exemption semantics were undefined | §3.1 and §3.8 with the owner's F1 and F2 |
| 9 | "No price yet" could lose a period silently | §3.2: unbilled dates recorded and listed; F3: not charged later |
| 10 | Switch-off and exemption ignored in-flight charges | §3.5 the point of no return; §3.8; F4 |
| 11 | The production guard was configuration only | §3.8 and P10-18: checked at the run, at creation, at the claim in the database, and before each send; tests bypass the API |
| 12 | The exit criteria contradicted the deferred customer test | P10-16: an explicit amendment of the exit criteria; §6 |
| 13 | Fees were asked about, not accounted for | §3.5's posting per fee model, AlphaKolect bearing it (F5); §9 condition 4 |
| 14 | VAT accounting wasn't a release gate | §9 condition 7: enforced by the switch (rev 4) |

## 13. The second plan review (2026-11-11)

The reviewer did not approve revision 3 and listed 8 findings. Each is resolved below.

| # | Finding | Resolved in |
|---|---|---|
| 1 | The plan called F1–F5 unanswered; two answers have typing slips | Status and §8: answered, each with the suggested option. The design no longer hedges. The slips are noted in the form for the owner to confirm, and his words are not edited |
| 2 | No transition for a billing date while suspended | §3.1: a suspended business accrues an invoice per chargeable date (Q5's chosen option over the one that would stop billing); the transition test covers it |
| 3 | A closed gate could produce backdated invoices when it reopened | §3.4 and P10-19: a date is chargeable by the switch's and exemptions' recorded history at the date, and by the guard when processed. A delayed worker catches up; a pause, an exemption or held charges never backdate |
| 4 | Exempting could race a transfer already sent | §3.1 and §3.8: `waiver_pending`, then `paid` if it succeeds (F4: a payment already sent is finished and recorded) or `waived` if it fails; a race test |
| 5 | Switch-off between the gate check and the send | §3.5 and P10-22: the point of no return is the claim's commit, made only with billing on and the business not exempt, under a share lock that switch-off and exemption must wait for. Nothing but the lease check comes between the claim and the send |
| 6 | Retries are unsafe if a final failure can later succeed | P10-20: retries only with the provider's guarantee (`finalFailureIsFinal`, §9 condition 2), without which billing can't charge at all; a late success despite it is listed as owed back (§6) |
| 7 | The runtime guard didn't enforce every release condition, and the request to pay could make an order | §9's "Enforced by" column, one mechanism per condition (VAT by a database check on the switch). §3.5 and §3.7: only the worker's charge task makes orders, under the guard; the request to pay only marks invoices |
| 8 | "After three failures" didn't stop retries | P10-21: 1 h, 6 h and 24 h, then held. One attempt per billing date or request to pay, never suspending. The platform team fixes the cause; no release command |
