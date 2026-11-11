# P10 implementation plan — billing

**Status: revision 6 (2026-11-11), a draft for the independent reviewer's plan review. Nothing is built.**

- **The reviews:**
  - revision 3 resolved the first plan review's 14 findings (§12);
  - revision 4 resolved the second review's 8 findings (§13);
  - revision 5 resolved the third review's 6 blockers and its point on the owner's record (§14);
  - revision 6 resolves the fourth review's two release gaps, its status-table concern and the owner's record (§15).
- **The owner's answers:**
  - `docs/business/P10_OWNER_BILLING.md`, answered 11 November 2026: every question (Q1–Q14) with the suggested option,
    and the permissions' wording approved as written;
  - `docs/business/P10_OWNER_BILLING_FOLLOWUP.md`, answered 11 November 2026: every question (F1–F5) with the suggested
    option. F2's and F3's answers were first saved with typing slips and later corrected in the form, not by the
    integration team. The form records both;
  - `docs/business/P10_OWNER_BILLING_CONFIRMATION.md`, answered 11 November 2026 (`3869154`): C1, yes, F2 and F3 as
    they now read are his answers; F6, a business whose billing date is the day billing is switched on again is
    charged that day, as in Q12 (the suggested option).
- **The build starts once** the reviewer approves this plan and the project lead agrees.

Decisions that would go to the project lead take the recommended option (his standing instruction) and are recorded in
§7. P9 is merged to `main` but **not closed**. P10 builds on its payment orders and worker, and does not close before P9
does (P10-14).

**Billing stays paused (BR-1.3), and no real money moves in P10.** Billing can charge only once every condition in §9
holds. §9 says how each is enforced: by the system refusing to charge without it, or, where it is a person's judgment, by
the system refusing to switch billing on until that judgment is recorded. The system can't check what a recorded
judgment says, and §9 doesn't claim it does.

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
- **Billing dates:** in WAT, each decided at a defined moment from recorded history (§3.4).
- **The billable-agent count** (BR-10.6a, Q2).
- **Billing periods:** one row per business per billing date, either an invoice or an unbilled date with its reason
  (§3.1).
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
- **The release guard and the release approvals,** which together enforce §9 (§3.8).
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
- **`billing.periods`:** one row per business and billing date, with the primary key `(merchant_id, billing_on)` (P10-23).
  Its `outcome` is `invoiced` or `unbilled`:
  - an invoiced row is the invoice. It holds the version, band, price and agents counted, and its state: `open`, `paid`,
    `waived`, or `waiver_pending` (an exemption waiting on a charge already past the point of no return, §3.8). It also
    holds its retry fields (§3.5), which are not states;
  - an unbilled row holds its reason (§3.4) and nothing else;
  - a check constraint ties each outcome to its columns, and the key allows one row per date, so a date can't be both
    invoiced and unbilled. A trigger refuses any change to a row's outcome, reason, amounts or decision moment once
    written. Only an invoice's state and retry fields change.
- **"Invoice" means an invoiced period.** `billing.invoices` is a view over them. The amount owed is the sum of the
  `open` invoices.
- **Every state change** is made by a billing function, in the same transaction as its cause, and recorded in the
  activity record. The full set of transitions:

| From | Event | To | Invoices |
|---|---|---|---|
| — | the business's email is confirmed | `trial` | none; `trial_ends_on` = the confirmation day + 90 days (Q1) |
| `trial` | its first billing date is decided invoiced (§3.4) | `current` | the first invoice is issued, `open`. The trial ends here, whatever the charge then does |
| `trial` | its first billing date is decided unbilled (§3.4) | `trial` | none; the date is recorded as unbilled, and the next date follows |
| `current` | a billing date is decided invoiced | `current` | a new invoice, `open`. Any earlier `open` one stays owed |
| `suspended` | a billing date is decided invoiced | `suspended` | a new invoice, `open`, added to what is owed. The owner chose "everything owed must be paid" (Q5) over "a suspended business isn't billed for further months" |
| `current` | a charge attempt is refused for lack of money, by the reservation (§3.5) or by the provider | `suspended` | the invoice stays `open` |
| `current` or `suspended` | a charge attempt fails finally for any other reason | unchanged | stays `open`; retried on the bounded schedule of §3.5. A failure that isn't for lack of money never suspends |
| `current` or `suspended` | a charge attempt's outcome is `unknown` | unchanged | stays `open`; no new attempt until P9's lookup resolves it |
| `current` | a charge succeeds | `current` | `paid` |
| `suspended` | a charge succeeds and no other invoice is `open` (Q5) | `current` | `paid` |
| `suspended` | a charge succeeds while other invoices are still `open` | `suspended` | that one `paid`; the next is attempted |
| any but `exempt` | exempted by the Super Admin (Q11) | `exempt` | `open` invoices with no attempt past the point of no return become `waived`, with the reason. Those with one become `waiver_pending` (F1, §3.8). An order of theirs still `created` is cancelled by its claim (§3.5) |
| `exempt` | a date whose decision moment came before the exemption is processed after it (§3.4) | `exempt` | the invoice is issued `waived`, with the exemption's reason: the outcome it would have had if processed on time and then waived (F1) |
| `exempt` | a `waiver_pending` invoice's charge succeeds | `exempt` | `paid`: the money moved, as F4 records for any payment already sent |
| `exempt` | a `waiver_pending` invoice's charge fails or is resolved failed | `exempt` | `waived` |
| `current` or `suspended` | a `paid` invoice's charge is reversed by the provider within its reversal window (§3.5) | unchanged | back to `open`, both postings reversed; retried by the schedule. A reversal isn't a refusal for lack of money, so it never suspends by itself |
| `exempt` | a `paid` invoice's charge is reversed within its window | `exempt` | `waived`, both postings reversed |
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
- **The period key is the billing date.** `billing.periods` holds one row per business and date, by its primary key
  (§3.1).

**When a date is decided (P10-19, P10-26)**

Each date D has one **decision moment**, m(D): the first moment of day D at which billing is on.
- It is D 00:00 if billing was on when the day began.
- If billing is switched on during D, m(D) is that moment. This is how a first billing date on the switch-on day is
  charged (Q12). Every later switch-on is treated the same way (F6, the owner's answer).
- If billing was off for the whole of D, D has no decision moment.

D is invoiced only if, at m(D):
1. the business isn't exempt, by `billing.exemption_history`;
2. the release guard is open, by `billing.guard_history` (§3.8);
3. a price exists. With 21 or more agents, that means a custom price set before m(D) (§3.2, F3).

Otherwise D is unbilled, with the first reason that applies: `billing_off` (no decision moment), `exempt`,
`charges_held`, or `awaiting_price`.

**Every input is recorded history.** `billing.switch_history`, `billing.exemption_history`, `billing.guard_history` and
the custom-price versions each record every change with its time. Each row is written in the same transaction as the
change itself; the guard's rows are written by the worker (§3.8). So D's outcome depends only on what was true at m(D),
never on when the worker happens to process D. The same history processed at different times gives the same rows (a
test).

**The run decides D only once m(D) has come,** or once D has ended with billing off. A date on a day still in progress
with billing off waits, since it may still be switched on that day.

This settles the cases the reviews raised:
- **a delayed worker:** D is decided from the history at m(D). If the business wasn't exempt and the guard was open
  then, D is invoiced late, for its own window and version. That is debt the owner's switch allowed;
- **an intentional pause:** with billing off all day, or the business exempt at m(D), D is never invoiced. That holds
  even if billing is on again, or the exemption lifted, before the worker gets to D (Q12, F2, F4);
- **charges held:** with the guard closed at m(D), D is never invoiced. That holds even if the guard reopened before
  the worker processed D, including when the worker was stopped in between;
- **a change after m(D):** a switch-off leaves D's invoice owed (F4). An exemption waives it (F1), and if D is processed
  after the exemption, the invoice is issued already `waived` (§3.1). Either way, the result is the one that processing
  on time would have given.

**The run**
- A worker task sweeps the businesses with a date ready to decide. It claims each with a lease, one at a time, as P9's
  claims do. Per business and date, in one transaction that holds the business's `merchant_billing` row for update:
  1. decide the date (above);
  2. if it is invoiced, count the agents for D's window, never for "now", and choose the band and the version in force
     on D;
  3. insert the period row, invoiced or unbilled;
  4. move `next_billing_on` to the next date.
- The row lock serializes runs for a business, and the primary key refuses a second row for a date. A run repeated, or
  two at once, produce one row per business and date (test). A business several dates behind gets one row per date. More
  than one late invoice at once is listed for the platform team.
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

**Who makes orders (P10-18).** Only the worker's charge task makes a subscription order, and only while the worker's
runtime guard is open (§3.8 conditions 3 and 4). The request to pay (§3.7) makes no order. It marks the business's open
invoices as requested, and the task picks them up on its next pass.

**The gate at creation.** `create_order` enforces the database's part of the gate atomically with the insert.
- For a subscription order, it takes `FOR SHARE` on `billing.settings` and on the business's `merchant_billing` row.
- It refuses unless billing is on, the business isn't exempt, and the invoice is `open` with an attempt due (below).
- Switching off and exempting take those rows for update. So an order is created either before a switch-off or exemption
  commits, or not at all (a race test).

**A `created` order is never stranded (P10-22).** The charge task sweeps every `created` subscription order and claims
it. The claim takes the same share locks, and also receives whether the worker's runtime guard is open.
- If billing is on, the business isn't exempt, and the runtime guard is open, the claim moves the order to `unknown`, and
  the worker sends it.
- Otherwise the claim moves it to `cancelled`, in the same transaction, which releases its reservation. The attempt is
  recorded as cancelled.
- So an order created just before a switch-off, an exemption, or a change of the worker's configuration is cancelled by
  its claim, never sent. Switching off and exempting don't cancel orders themselves. In revision 4 they did, and an order
  inserted after their scan could be left `created`, holding its reservation (the third review).
- While the worker is stopped, a `created` order keeps its reservation. Nothing else spends from a Live wallet in P10
  (P9 Q2). The platform status lists any `created` order older than one pass.

**Attempts.** `billing.charge_attempts` records each attempt: invoice, attempt number, payment order, outcome.
- The order's reference is `sub-<invoice id>-<attempt number>`. A new attempt has a new reference, and an old reference
  is never reused.
- A partial unique index allows one unfinished attempt per invoice.
- Open invoices are attempted oldest first.

**When a new attempt is made (P10-20).**
- Only after the previous attempt is final: failed (including `not_submitted`, below), `insufficient` or cancelled. Never
  after `unknown`, and never while one is unfinished.
- Only when the provider guarantees that a final failure never later succeeds (`capabilities.finalFailureIsFinal`, from
  TransactPay's answer to §2.4). It is part of the release guard (§9 condition 2): without it, billing can't charge at
  all, and the plan returns to the reviewer and the owner.
- If a final failure later succeeds despite the guarantee, P9's contradiction path lists it. Nothing is posted
  automatically. A second debit that results is owed back to the business, and is listed as a refund for the platform
  team (§6).

**The retry schedule and holds (P10-21).** A hold is not an invoice state. An invoice stays `open` while held, and its
retry fields record the schedule:
- `failures`: the count of consecutive non-money failures;
- `next_attempt_at`: when the next automatic attempt is due;
- `held`: true once `failures` reaches 4;
- `held_attempt_due`: whether a held invoice has its one allowed attempt waiting.

After an `insufficient` attempt, the next one is made when the wallet covers the amount (§3.7). After a non-money
failure, the schedule is:

| Attempt | Made |
|---|---|
| 1 | when the date is invoiced |
| 2 | 1 hour after failure 1 |
| 3 | 6 hours after failure 2 |
| 4 | 24 hours after failure 3 |
| — | after failure 4 (the first attempt and its three retries), the invoice is held |

- **A held invoice is attempted only when `held_attempt_due` is set.** The run sets it at each later billing date of the
  business, and a request to pay sets it, at most once an hour. Each such attempt clears it.
- **Each outcome:**
  - success: the invoice is `paid`, and any hold ends;
  - `insufficient`: `failures` returns to 0 and any hold ends; §3.1's lack-of-money row applies;
  - another non-money failure: `failures` goes up by 1, and the schedule above applies (a held invoice stays held);
  - cancelled: `failures` and the schedule don't change. The attempt is made again once the gate reopens.
- **The platform team** sees each held invoice with every failure's provider answer. Their part is to fix the cause
  (configuration, the provider). No release command is needed.
- **A held invoice never suspends the business:** the failure isn't the business's.

**The reservation (P10-17).** P9's `create_order`, the only way an order is made, is changed for every purpose:
1. it locks the source wallet's 1100 projection (`FOR NO KEY UPDATE`, category 14);
2. it refuses with `insufficient` unless the balance, less the amounts of that wallet's unfinished outbound orders, is
   at least the new amount.

Two orders against the same money are serialized by the lock, and only one is made (test). Nothing else spends from a
Live wallet in P10 (P9 Q2), and any later payout path goes through the same function. A refusal by the reservation is
the "lack of money" outcome: the attempt is recorded as `insufficient`, and §3.1 applies. Nothing is half taken (Q6).

**The point of no return (P10-22).** An order is "sent" from the moment its claim commits it to `unknown`.
- The claim moves it from `created` to `unknown` (P9's design: a claimed order may already have been sent). It does so
  only under the share locks above, with billing on and the business not exempt.
- Switching off and exempting take those rows for update, so a claim and a switch-off are serialized:
  - if the switch-off commits first, every later claim cancels;
  - if the claim commits first, the order is past the point of no return, and is finished and recorded, as F4 records.
- After its claim, the worker does nothing but check its lease and runtime guard, and send. A lapsed lease leaves the
  order `unknown`, for the lookup (below).
- `cancelled` is a state P10 adds to P9's orders, reachable only from `created`, and only by a claim.

**An order the provider never received (P10-24).** The claim commits before the send. A worker that stops between the
two leaves an order `unknown` that TransactPay never saw. P9's resolution reads "not found" as `unknown` and leaves it so
for ever, which would keep the invoice from a new attempt and keep its reservation. P10 changes P9's resolution:
- **The clock starts when the claim's lease ends.** P9's worker starts a call with an effect only if the call's timeout
  ends inside the lease (P9-R3). So no request for that order can leave our side after the lease ends. That moment, not
  the claim, is the earliest from which "not found" can mean "never sent".
- **The guarantee must cover a late request.** "Not found" may be final only if no request with that reference can be
  paid out after we mark the order failed and release its reservation. TransactPay's public documentation gives no such
  guarantee, so §2.5 asks for one of two forms. The adapter declares `capabilities.notFoundFinal` only with one of them,
  and records which:
  - **`blocksReference`:** once the requery has answered "not found", any later request with that reference is refused.
    Then the first "not found" after the lease ends is final;
  - **`visibleWithin(L)`:** every request that reaches their API is refused, or visible to the requery within L of
    arriving. Then a "not found" at least L after the lease ends is final.
- **A final "not found"** resolves the order `failed`, with the reason `not_submitted`. That releases the reservation,
  and the schedule above allows a new attempt with a new reference. It counts as a non-money failure, so a worker that
  keeps crashing reaches a hold.
- **"Not found" before then, or without the capability,** stays `unknown`, as in P9. The invoice gets no new attempt,
  and the order is listed for the platform team.
- **If the old reference later succeeds despite the guarantee,** it is handled as a final failure that later succeeds
  (above): P9's contradiction path lists it, nothing is posted automatically, and a resulting second debit is listed as
  owed back to the business (§6).
- **The capability is part of the release guard** (§9 condition 2). Without it, billing can't charge.
- **The rule applies to every outbound order,** since the guarantee is the provider's. In P10 there are no others (P9
  Q2).

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

**A success later reversed (P10-27).** TransactPay's published status table has 9, "Reversed": "Payout was reversed
after processing". So a charge reported successful may be undone, and P10 defines what follows.
- **Finality.** The adapter declares `capabilities.reversalWindow`: how long after success TransactPay says a payout can
  be reversed, zero if never, and how a reversal is reported (§2.6.4). Without the declaration, billing can't charge
  (§9 condition 2).
- **Watching.** A succeeded subscription order is not finished for billing until its reversal window ends. Within the
  window, the worker looks it up again: 1 hour after success, 24 hours after, and when the window ends. A reversal
  reported by webhook is confirmed through the same lookup, as P9 confirms every event.
- **A confirmed reversal**, in one transaction:
  - the order moves from `succeeded` to `reversed`, a state P10 adds to P9's orders;
  - each posting is reversed by its own template, keyed by the provider transaction: the business's Dr 1100 / Cr 5100,
    and the platform's mirror of its success posting by the declared fee model. Whether the fee comes back is posted as
    the provider reports it, never computed;
  - the invoice returns from `paid` to `open` (or, if the business is exempt, becomes `waived`); the attempt is recorded
    `reversed`, and counts as a non-money failure for the schedule;
  - the business's billing state doesn't change. A reversal isn't a refusal for lack of money, so it doesn't suspend;
    the next attempt does, if the wallet can't cover it (BR-10.4). A business that this charge had restored stays
    `current` until then.
- **After the window ends,** a reversal is not expected. If one is seen, by the lookup or the reconciler, it goes to P9's
  contradiction path and is listed for the platform team; nothing is posted automatically.
- **A reversal while billing is off:** the invoice is open and owed, and nothing is taken until billing is on (F4).

**The status table (P10-28).** The adapter maps the payout statuses TransactPay publishes now ("Possible Status IDs and
their statuses", updated 14 October 2026), not the table P9's adapter was written from:

| ID | TransactPay's name | Mapped to |
|---|---|---|
| 5 | Successful | `successful` |
| 4 | Failed ("failed permanently") | `failed`; final only with `finalFailureIsFinal` |
| 8 | Rejected | `failed`; final only with `finalFailureIsFinal` |
| 9 | Reversed | `reversed` (above) |
| 1, 2, 3, 6, 7, 10 | Initiated, Pending, Processing, Awaiting Approval, Awaiting Verification, Awaiting Second Level Approval Verification | `pending` |
| 11, 12 | Failed (pending confirmation), Failed (retriggered) | `pending`: neither is final |
| anything else | — | an unclear answer (`UNKNOWN_OUTCOME`): the order stays `unknown` |

- The requery's sample answer gives a status name, not an ID. The adapter maps by name too, and §2.6.1 asks TransactPay
  to confirm the names are the table's. A name it doesn't know is an unclear answer.
- Each ID and each name has its own adapter test. If TransactPay's answers to §2.6 differ from this table, the table
  changes with them, before the capabilities can be declared.
- **P9's adapter predates this table.** It maps 1–7 only, and reads 6 as "Reversed", where TransactPay now publishes 6 as
  Awaiting Approval and 9 as Reversed. P9 makes no payouts (P9 Q2), but its deposit lookups use the same mapping. That is
  passed to P9, which is still open (§6).

**The lock order.** `billing` is lock category 19, after payments (18). Every footprint ascends:
- `create_order`, for a subscription: the source wallet's projection (14, no key update), the new order (18), then the
  settings and the billing state (19, share);
- the claim: the order (18, skip locked), then the settings and the billing state (19, share);
- the success path: the projections (14), the order (18), then the attempt, the period and the billing state (19);
- switching off and exempting: the settings or the billing state (19, for update), then the periods (19). They read the
  orders without locking them, after their own lock, so they see every claim that committed before them;
- the run: the billing state (19, for update), then the period (19).

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
  - it makes no order itself (§3.5): it marks the open invoices as requested, and answers with their attempts. A held
    invoice gets its one allowed attempt, at most once an hour (§3.5);
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
- **Turning it on** is refused unless the VAT treatment and both release approvals (below) are recorded. Those are
  database checks in the switch function: `enabled` implies a treatment, and the function refuses without the approvals.

**The release guard** is open only when all four of these hold. Conditions 1 and 2 are database state; conditions 3 and
4 are the worker's runtime:
1. `billing.settings.enabled` is true;
2. the business isn't `exempt`;
3. the worker's environment allows charges (`BILLING_CHARGES=on`, off by default);
4. the provider declares `capabilities.walletTransfer`, `capabilities.finalFailureIsFinal`,
   `capabilities.notFoundFinal` and `capabilities.reversalWindow`. TransactPay's adapter declares them only in the
   release that implements and proves §9 conditions 1–5.

**Where each condition is checked:**

| Check | Conditions | How |
|---|---|---|
| The run, deciding a date | all four | at m(D), from recorded history (§3.4) |
| The charge task, before making an order | 3, 4 | live |
| `create_order` | 1, 2 | in the database, under share lock (§3.5) |
| The claim | 1, 2; 3 and 4 as the worker passes them | in the database, under share lock. Closed means the order is cancelled (§3.5) |
| The worker, before each send | 3, 4 | live |

**The guard's history.** `billing.guard_history` records the worker's runtime guard (conditions 3 and 4), with the
reason when it is closed.
- The worker writes a row when it starts, before it processes anything, and whenever its state changes. Only the
  worker's role can write the table.
- The guard's state at any moment is the latest row at or before it. With no row, it is closed.
- Conditions 3 and 4 change only when a worker starts: the environment is read at start, and the capabilities are code.
  So the row written at start is the moment a new configuration took effect, and a stopped worker's last state stands
  until then.
- P15 runs one billing worker process at a time (§6), so two processes' rows never interleave. If two ever overlap, a
  closed row from the newer process stands, since the older one writes again only if its own state changes.

**Production configuration** refuses `BILLING_CHARGES=on` while the configured provider lacks any of the four
capabilities. So a stale setting, a direct database update, or a switch turned on early still sends nothing. Tests set
`enabled` directly in the database, with the environment off or a capability false, and see no invoice, order or send.

**Release approvals (P10-25).** Two of §9's conditions are judgments the system can't check: P9's conditions for live
money (§9 condition 6) and the accountant's VAT sign-off (condition 7).
- `billing.release_approvals` records each: the condition, who recorded it, when, and a reference to the written
  evidence. For condition 6 that is the reviewer's closure of P9's live-money gate; for condition 7, the accountant's
  letter.
- Only the Super Admin's switch function writes it, under `platform.billing.switch`.
- Turning billing on is refused unless both are recorded.
- The system enforces that an approval is recorded before billing can be switched on. It can't check what the approval
  says, and §9 marks these conditions as approvals, not as system checks.

**Visibility.** The platform view shows the guard's state and history, the approvals, and whether billing is on.
"Billing switched on, charges held" is visible, not silent.

**Switching off (F4).** In one transaction, holding `billing.settings` for update:
- every `suspended` business becomes `current`;
- open invoices stay open.

A `created` order is cancelled by its next claim (§3.5), which can no longer find billing on. Orders already past the
point of no return finish through P9's machinery. A success is posted and pays its invoice, because the money moved.

**Exempting a business (F1).** In one transaction, holding its `merchant_billing` row for update:
- its open invoices are waived, or `waiver_pending` if a charge is past the point of no return (§3.1). An invoice whose
  order is still `created` is waived, since that order's claim will cancel it;
- while it is exempt, its dates are unbilled (§3.4).

**Lifting an exemption (F2)** follows §3.1.

## 4. Interfaces

| Endpoint | Who | While suspended | |
|---|---|---|---|
| `GET /v1/merchant/subscription` | `merchant.subscription.read` | allowed | the state, trial end, band, price, next billing date, the coming price (Q8), the amount owed, `upcoming` (§3.4), and the Live wallet's details for loading it |
| `GET /v1/merchant/subscription/invoices` | `merchant.subscription.read` | allowed | the invoices, with the agents counted and their attempts |
| `POST /v1/merchant/subscription/payment` | `merchant.subscription.pay` | allowed | asks for a charge of what is owed (`Idempotency-Key`; §3.7) |
| `GET /v1/platform/billing/businesses` · `…/{merchantId}/invoices` · `/v1/platform/billing/preview` · `/v1/platform/billing/status` | `platform.billing.read` | — | every business's billing state and amount owed; a business's periods (invoices, unbilled dates and held invoices); what a run would charge; the guard's state and history, the release approvals, and any `created` order older than one pass (§3.8) |
| `GET` · `POST /v1/platform/billing/prices` · `POST …/prices/{id}/withdrawal` | `platform.billing.read` / `platform.billing.prices` | — | the versions; a new version with its start date; withdrawing one not yet started |
| `PUT /v1/platform/billing/businesses/{merchantId}/custom-price` | `platform.billing.custom_price` | — | the price for 21 or more agents (Q9, F3) |
| `PUT /v1/platform/billing/settings` · `POST /v1/platform/billing/release-approvals` · `POST` · `DELETE …/businesses/{merchantId}/exemption` | `platform.billing.switch` (Super Admin; not grantable) | — | switching billing on or off, and recording the VAT treatment; recording a release approval with its evidence (§3.8); an exemption and lifting it |

- **Activity events** (atomic; identifiers and amounts only):
  - `billing.invoice_issued`, `billing.date_unbilled`, `billing.release_approved`;
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
- Turning billing on without a recorded VAT treatment, or without either release approval, is refused.
- The request to pay, with charges held, creates no order and no reservation.

**State transitions**
- Every row of §3.1's table, each by its own test, including a suspended business accruing a second invoice.

**One row per date**
- A second row for the same business and date is refused by the key, whatever its outcome.
- The check constraint refuses an invoiced row without its amounts, and an unbilled row with them.
- The trigger refuses a change to a written row's outcome, reason, amounts or decision moment.

**Decided dates**
- Billing switched on at 14:00 on a business's first billing date: invoiced (Q12). The same on a later switch-on (F6).
- Billing off for the whole of D: `billing_off`, even if it is switched on the next day. D with billing off and the day
  in progress: not decided yet.
- A date missed by a stopped worker, with everything open at m(D): invoiced late, for its own window.
- Exempt at m(D), lifted before the worker processes D: `exempt`. Exempted after m(D), before processing: issued
  `waived`.
- The guard closed at m(D), reopened before processing, with the worker stopped in between: `charges_held`.
- The guard open at m(D) and closed at processing: invoiced, with no attempt until it reopens.
- No guard row before m(D): `charges_held`.
- One history, processed at several different times, gives the same rows.
- A lifted exemption bills from the next date (F2).

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
- Non-money failures: attempts 2, 3 and 4 at 1 h, 6 h and 24 h after each failure. Failure 4 holds the invoice, which
  stays `open`.
- A held invoice: no automatic attempt; one at its next billing date, and one per request to pay, at most one an hour.
  Success ends the hold; another failure keeps it.
- `insufficient` resets the count and ends a hold.
- `cancelled` leaves the count and schedule as they were, and the attempt is made again once the gate reopens.
- `unknown`: nothing until resolved. Resolved failed gives a new attempt by the schedule; resolved successful gives
  nothing, and the invoice is paid.
- With `finalFailureIsFinal` false, no second attempt is ever made.
- A repeated `Idempotency-Key` returns the first answer.

**An order the provider never received**
- The claim commits, and the worker stops before sending. The FakeProvider never received the reference.
- With `visibleWithin(L)`: "not found" before the lease ends plus L stays `unknown`; after it, `failed`,
  `not_submitted`, the reservation released, and attempt 2 by the schedule.
- With `blocksReference`: the first "not found" after the lease ends is final; one before it is not.
- A send that started inside the lease and reaches the FakeProvider late: with either form, it is refused or seen, and
  never paid out after the order is marked failed. If the FakeProvider is made to break the guarantee, the late success
  goes to the contradiction path and is listed as owed back.
- Without the capability: `unknown` for good, listed, and no new attempt.

**A success later reversed**
- Reversed within the window: the order `reversed`, both postings reversed once each, the invoice `open`, the business's
  state unchanged, and a new attempt by the schedule. An exempt business's invoice becomes `waived`.
- A reversal replayed, by lookup and webhook both: posted once.
- Reversed after the window: nothing posted, the contradiction listed.
- The lookups at 1 hour, 24 hours and the window's end; with a window of zero, none.

**The status table**
- Each ID 1–12 and each name maps as §3.5's table says; 11 and 12 never resolve an order; an unknown ID or name is an
  unclear answer.

**Orders and the gate**, as races:
- `create_order` against a switch-off: either the order commits first and its claim cancels it, or creation is refused.
  No `created` order survives a claim after a switch-off.
- The same for exempting.
- The worker's runtime guard closing after an order is created: the claim cancels it and the reservation is released.
- The worker stopped: the `created` order keeps its reservation and is listed.

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
- Switching off restores the suspended businesses. A `created` order is cancelled by its next claim.
- Exempting waives the open invoices.
- Lifting resumes at the next date without suspending.

**Races**
- Two runs at once: one row per business and date.
- Two requests to pay at once: one attempt.
- A restore and a new invoice at once leave a consistent state.

**Isolation and guards**
- A business sees only its own subscription. A run and a charge touch only the business they claim (TA-11).
- Lock order (category 19, the claim's and `create_order`'s share locks, `create_order`'s new 14:NKU, switch-off and
  exemption taking no order lock).
- Grants: only the worker's role writes `billing.guard_history`; only the switch function writes
  `billing.release_approvals`.
- Grants: the worker's functions are executable by `alphakolect_worker` alone.
- Transaction classes, the matrices, the coverage and writer guards, and `x-while-suspended` on every operation.

## 6. Obligations passed on

- **P9 (still open), for the project lead:** P9's TransactPay adapter maps statuses 1–7 from an older table and reads 6
  as "Reversed". TransactPay's current table (14 October 2026) has 6 as Awaiting Approval and 9 as Reversed. It isn't yet
  known whether deposit lookups use the same table. Recorded here; not changed by P10's plan, since P9's code is P9's to
  close (P10-14).
- **The phase that builds customer sign-in:** BR-10.4 for customers (view-only; `423 MERCHANT_SUSPENDED`, "Please
  contact the company."), its declaration on each customer endpoint, and its test (P10-16).
- **Any phase that deletes sessions, memberships or collections:** it must first keep billing's evidence of activity
  (§3.3).
- **OPEN-7 (payouts):** refunding a charge listed as owed back (§3.5).
- **P12:** billing emails (the warning before the billing date, the suspension, the restore, a held invoice); invoice
  PDFs.
- **P13:** the Subscription page and the redirect while suspended (`middleware.ts`).
- **P15:** the worker's billing tasks in production, its `BILLING_CHARGES` setting, and §9's conditions. One billing
  worker process at a time: a deployment stops the old worker before the new one starts, so the guard's history (§3.8)
  never interleaves two processes.

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
| P10-14 | P9's open state | P10 is planned and built on P9's merged code, and changes four things in P9: `create_order` (the reservation, and the billing gate for a subscription order), the claim (the `cancelled` state), the resolution of an order not found (P10-24), and the `reversed` state with its postings (P10-27). P10 does not close before P9 does |
| P10-15 | Gate | this plan's review now; one review of the build at the end |
| P10-16 | The customer audience | out of P10's exit criteria by an explicit amendment, as P2's was; RESTRUCTURING_MAP's P10 row is amended when this plan is approved. Building customer sign-in here would be a phase of its own |
| P10-17 | Concurrent spending | every outbound order reserves its amount against the source wallet's locked 1100 projection |
| P10-18 | The release guard | four conditions, checked by the run (from history), before an order is made and before each send (in the worker), and in `create_order` and the claim (in the database, under share lock); configuration alone is not trusted |
| P10-19 | Deciding a date | from recorded history alone (the switch, exemptions, the guard, custom prices) at the date's decision moment, so the worker's timing never changes an outcome; every date is recorded, invoiced or unbilled with its reason |
| P10-20 | Retrying a failed charge | only with the provider's guarantee that a final failure is final; without it, billing can't charge |
| P10-21 | Bounded retries | after a non-money failure, retries 1 h, 6 h and 24 h later; failure 4 holds the invoice (a retry field, not a state): then one attempt per billing date or request to pay, never suspending |
| P10-22 | The point of no return, and cancelling | the claim's commit, made only with billing on and the business not exempt, under a share lock that switch-off and exemption must wait for. A claim that finds the gate closed cancels the order instead, so no `created` order is stranded |
| P10-23 | One row per billing date | a single `billing.periods` table, invoiced or unbilled, with one primary key, a check constraint and immutable outcomes; not two tables, whose uniqueness no constraint could span |
| P10-24 | An order the provider never received | "not found" is final, as `not_submitted`, only under a provider guarantee that covers a late request (`notFoundFinal`: the reference blocked, or every request visible within L), counted from the end of the claim's lease; without it billing can't charge |
| P10-27 | A success later reversed | the reversal window declared by the provider (`reversalWindow`); succeeded orders looked up again within it; a reversal reverses both postings, reopens the invoice and is retried, without suspending; outside the window, the contradiction path |
| P10-28 | The status table | the adapter maps TransactPay's current table (IDs 1–12, 14 October 2026), by ID and by name, 11 and 12 not final, with a test for each; P9's older mapping is passed to P9 |
| P10-25 | Conditions that are judgments | recorded as release approvals, with their evidence, before the switch can be turned on; called approvals, not system checks |
| P10-26 | The decision moment | the first moment of the date's day at which billing is on: midnight if it was on, the switch-on moment if it was switched on that day (Q12, F6) |

## 8. Questions out

| To | Document | State |
|---|---|---|
| The owner | `docs/business/P10_OWNER_BILLING.md` | answered 11 November 2026: every question with the suggested option; the wording approved |
| The owner | `docs/business/P10_OWNER_BILLING_FOLLOWUP.md` | answered 11 November 2026: F1–F5, each with the suggested option. F2 and F3 were first saved with typing slips ("Thne", "words that passed", `e5a7b83`) and later corrected in the form, not by the integration team (`f30d107`). The form records both |
| The owner | `docs/business/P10_OWNER_BILLING_CONFIRMATION.md` | answered 11 November 2026 (`3869154`): C1, F2 and F3 confirmed as they now read; F6, charged that day, as in Q12 (the suggested option) |
| TransactPay | `docs/business/P10_TRANSACTPAY_QUESTIONS.md` (with the P9 follow-up) | §1 moving money between virtual accounts, and `accountName`; §2 duplicate references, the lookup, the status table, whether a failure can later succeed, and when "not found" is final (§2.5); §3 insufficient funds; §4 sandbox testing; §5 fees. **Not sent yet** |

## 9. Before billing can charge

Each condition is one of two kinds:
- **System:** the code refuses to charge without it. Capabilities are declared in the adapter's code, so whether a
  declaration is true is reviewed in the release that adds it. Once declared, nothing charges without it.
- **Approval:** a person's judgment, which the system can't check. The system refuses to switch billing on until the
  approval is recorded with its evidence (§3.8). It enforces that the record exists, not what it says.

| # | Condition | Kind | Proven by | Enforced by |
|---|---|---|---|---|
| 1 | TransactPay documents a transfer between two of our virtual accounts, debiting the source account, with the destination's required fields (`accountName` included) | system | their answer (§1); a sandbox test moves money between two sandbox virtual accounts and sees both balances change | `walletTransfer` declared only by the adapter release that implements it; production refuses `BILLING_CHARGES=on` without it, and the guard (§3.8) is closed |
| 2 | TransactPay states what a repeated reference does, when and for how long the lookup answers, every status and which are final; **guarantees that a final failure never later succeeds**; **guarantees that "not found" is final, in one of §2.5's two forms**; and **states whether and within how long a success can be reversed, and how it is reported** | system | their answer (§2, including §2.5 and §2.6); sandbox tests of a duplicate reference, a lookup after a timeout, a reference never sent, and pending to final where the sandbox allows (§4) | `finalFailureIsFinal`, `notFoundFinal` and `reversalWindow`, each declared only with its statement; without all three, production refuses `BILLING_CHARGES=on` |
| 3 | TransactPay states its insufficient-funds answer, and the adapter maps their **current** status table | system | their answer (§3, §2.6); the adapter maps it to `insufficient`; a test per status ID (P10-28); a sandbox test | part of the adapter release behind `walletTransfer` |
| 4 | The fee model is confirmed, and is one §3.5 supports, AlphaKolect bearing the fee (F5) | system | their answer (§5); its posting tested; the reconciler finds no difference after a sandbox transfer | the adapter declares one fee model, and the capability only if it is supported. A confirmation with another model isn't posted |
| 5 | Pooled or per-account balances (P9 follow-up §2) | system | their answer | the capability is declared only for per-account balances. If pooled, P10-10 and the reconciler return to the reviewer and the owner |
| 6 | P9's conditions for live money (P9 plan §10, conditions 1–10: a real deposit, the balance enquiry, the worker's isolation in production, and the rest) | **approval** | the reviewer's closure of P9's live-money gate | a release approval for condition 6, citing that closure, must be recorded before billing can be switched on (§3.8). P10's migrations also come after P9's, but that orders the schema; it proves none of P9's conditions |
| 7 | The accountant confirms in writing how subscription income is accounted for VAT (Q10) | **approval**, and a system check | a written sign-off | a release approval for condition 7, citing the letter, and the recorded treatment: the switch can't be turned on without both. If VAT is inside the price, the platform posting splits it (§3.5) |
| 8 | The owner's answers | **approval** | Q1–Q14, F1–F5, C1 and F6, all answered 11 November 2026 | met. Checked by the plan review and the project lead, not by the system. Any answer TransactPay's replies make necessary goes to the owner in a new form |
| 9 | The owner switches billing on, as Super Admin, from the platform admin | system | BR-1.3 | `enabled` false by default; only the non-grantable `platform.billing.switch` changes it |

## 10. The build, once approved

- **Migrations:**
  1. `billing_core`: schema, tables (the periods, the switch, exemption and guard histories, the release approvals,
     attempts), RLS, the price seed, the permission flag, the platform's VAT-payable account, the order's platform
     posting, its `cancelled` and `reversed` states and the reversal templates, `create_order`'s reservation and billing
     gate;
  2. `billing_functions`: the run and its decision moment, the charge task, the claim's guard and cancellation, attempts
     and holds, the `not_submitted` resolution, the reversal watch, restore, the switch, approvals and exemptions, the reads,
     `assert_authority`'s suspended outcome.
- **Contracts:** `whileSuspended` on the registry and every existing operation; the new endpoints.
- **Provider:**
  - the port gains `capabilities.walletTransfer`, `capabilities.finalFailureIsFinal`,
    `capabilities.notFoundFinal`, `capabilities.reversalWindow`, a declared fee model, and the transfer;
  - the FakeProvider covers every fee model and outcome, including a reference it never received;
  - the TransactPay adapter declares none of the four capabilities, and maps the current status table (§3.5).
- **API and worker:** `modules/billing`, the worker's three tasks, the release guard and its history, `BILLING_CHARGES`,
  the 402 and 403 envelopes.
- **Tests:** as in §5, in the db and API suites.
- **The gate:**
  - every step exit 0 on a clean tree at a named commit: `format:check`, `lint`, `typecheck`, `build`, `openapi:check`,
    `test`, `test:concurrency`, and the gitleaks history scan of the project's refs;
  - run with `npm_config_workspace_concurrency=1`;
  - Linux CI on the pull request.

**The baseline before the build (2026-11-11).** P10 has only documents so far. The full gate ran at `817c28d`, whose code
is identical to `main` at `031e4db` (P9's merge), to record the health of what P10 will build on. It validates no P10
code, since none exists yet:

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
| 6 | 2026-11-11 | The fourth review resolved (§15): "not found" final only under a guarantee covering a late request, counted from the lease's end; a reversed success (`reversed`, both postings reversed, the invoice reopened); the current status table; the owner's confirmation (C1, F6) recorded |
| 5 | 2026-11-11 | The third review's 6 blockers and the owner's record resolved (§14): the decision moment and the guard's history; one periods table; the gate in `create_order` and cancellation by the claim; holds as retry fields, with the schedule stated attempt by attempt; "not found" final after the provider's stated time; release approvals for the conditions that are judgments; the owner's confirmation form |
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
| 1 | The plan called F1–F5 unanswered; two answers have typing slips | Status and §8: answered, each with the suggested option. The design no longer hedges. The slips were noted in the form for the owner to confirm. The form was later corrected, and the note no longer matched it: see §14, item 7 |
| 2 | No transition for a billing date while suspended | §3.1: a suspended business accrues an invoice per chargeable date (Q5's chosen option over the one that would stop billing); the transition test covers it |
| 3 | A closed gate could produce backdated invoices when it reopened | §3.4 and P10-19: a date is chargeable by the switch's and exemptions' recorded history at the date, and by the guard when processed. A delayed worker catches up; a pause, an exemption or held charges never backdate |
| 4 | Exempting could race a transfer already sent | §3.1 and §3.8: `waiver_pending`, then `paid` if it succeeds (F4: a payment already sent is finished and recorded) or `waived` if it fails; a race test |
| 5 | Switch-off between the gate check and the send | §3.5 and P10-22: the point of no return is the claim's commit, made only with billing on and the business not exempt, under a share lock that switch-off and exemption must wait for. Nothing but the lease check comes between the claim and the send |
| 6 | Retries are unsafe if a final failure can later succeed | P10-20: retries only with the provider's guarantee (`finalFailureIsFinal`, §9 condition 2), without which billing can't charge at all; a late success despite it is listed as owed back (§6) |
| 7 | The runtime guard didn't enforce every release condition, and the request to pay could make an order | §9's "Enforced by" column, one mechanism per condition (VAT by a database check on the switch). §3.5 and §3.7: only the worker's charge task makes orders, under the guard; the request to pay only marks invoices |
| 8 | "After three failures" didn't stop retries | P10-21: 1 h, 6 h and 24 h, then held. One attempt per billing date or request to pay, never suspending. The platform team fixes the cause; no release command |

## 14. The third plan review (2026-11-11)

The reviewer did not approve revision 4 and listed 6 blockers and one point on the owner's record. Each is resolved
below.

| # | Finding | Resolved in |
|---|---|---|
| 1 | The date rules conflicted: a first billing date on the switch-on day failed "on at 00:00", and the guard was read when processed, so a date held while the worker was down could be invoiced after the guard reopened | §3.4, P10-19 and P10-26: each date has one decision moment, the first moment of its day at which billing is on, so the switch-on day counts (Q12). Exemption, guard and price are all read at that moment from recorded history; `billing.guard_history` (§3.8) records the worker's guard from its start. The worker's timing never changes an outcome (a test processes one history at several times) |
| 2 | "One invoice or unbilled row per date" spanned two tables, which no unique constraint can do | §3.1 and P10-23: one `billing.periods` table, invoiced or unbilled, with one primary key, a check constraint tying each outcome to its columns, and a trigger that keeps outcomes immutable. The run holds the business's row for update |
| 3 | An order created after switch-off's cancellation scan, or before a configuration change, could stay `created` and keep its reservation | §3.5 and P10-22: `create_order` checks billing and the exemption under share lock, atomically with the insert; the claim, under the same locks and with the worker's runtime guard, cancels instead of sending when the gate is closed. Switch-off and exemption no longer scan orders. Race tests for each |
| 4 | `held` was used as a state but not listed, and the retry count was ambiguous | §3.5 and P10-21: holding is a retry field, and the invoice stays `open`. The schedule is stated attempt by attempt: retries 1 h, 6 h and 24 h after failures 1–3, held at failure 4, with each outcome's effect on the count |
| 5 | A worker that stops after the claim and before the send leaves an order `unknown` for ever | §3.5 and P10-24: with the provider's guaranteed duration (`notFoundFinalAfter`, TransactPay §2.5; made precise in revision 6, §15), "not found" after that long resolves `failed`, `not_submitted`, releasing the reservation. Without it, billing can't charge (§9 condition 2). A crash-before-send test |
| 6 | P9's live-money conditions were called system-enforced, but migration order proves none of them | §9: each condition is marked system or approval. P9's conditions and the accountant's sign-off are release approvals (P10-25), recorded with their evidence before the switch can be turned on; the plan no longer claims the system checks them |
| 7 | The follow-up's note said F2 and F3 kept their slips, but the form had been corrected | The correction, which the integration team did not make, is committed as found (`f30d107`). The note now records both versions (`5a8ca3b`). The owner confirms the answers as they read (`P10_OWNER_BILLING_CONFIRMATION.md`, C1), and §9 condition 8 is not met until he does |

The reviewer also advised not to push or present revision 4 as approved. Nothing has been pushed since revision 1, and
PR #12 stays open and unmerged, for review only, not as an approved plan.

## 15. The fourth plan review (2026-11-11)

The reviewer did not approve revision 5: the six changes of §14 are reflected, but two release gaps remained, with a
concern about the status table and the owner's record. The reviewer also read TransactPay's public developer
documentation; the status table was checked again against it for this revision.

| # | Finding | Resolved in |
|---|---|---|
| 1 | "Not found" was final after a duration from the claim, and the guarantee didn't cover a request arriving late | §3.5 and P10-24: the clock starts when the claim's lease ends, the last moment a send can leave (P9-R3). The capability `notFoundFinal` needs one of two guarantees that cover a late request: the requery blocks the reference, or every request is refused or visible within L. TransactPay §2.5 asks for them; their public documentation gives neither. Tests for each form and for a late send |
| 2 | Nothing said what happens if a paid charge is later reversed; TransactPay publishes status 9, "Reversed" | §3.5 and P10-27: `reversalWindow` declared only with TransactPay's statement (§2.6.4), required by §9 condition 2. Succeeded orders are looked up again within it; a reversal reverses both postings, reopens the invoice and is retried without suspending; after the window, the contradiction path. §3.1 gains the reversal rows |
| 3 | P9's status mapping reads 6 as "Reversed"; the current table has 6 as Awaiting Approval and 9 as Reversed | §3.5 and P10-28: the adapter maps the current table (IDs 1–12, updated 14 October 2026) by ID and by name, with 11 and 12 not final, and a test for each; §9 condition 3. TransactPay §2.6 asks them to confirm it. P9's older mapping is passed to P9, which is still open (§6) |
| 4 | The confirmation form held the owner's answers, but the plan still called them awaited | The owner answered on 11 November 2026: C1, yes; F6, charged that day, as in Q12 (`3869154`). Status, §3.4, P10-26, §8 and §9 condition 8 updated: met |

Nothing has been pushed since revision 1. PR #12 stays open and unmerged, for review only.
