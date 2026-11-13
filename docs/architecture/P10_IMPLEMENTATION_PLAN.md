# P10 implementation plan — billing

**Status: revision 8 (2026-11-13), a draft for the independent reviewer's plan review. Nothing is built.**

- **The reviews:**
  - revision 3 resolved the first plan review's 14 findings (§12);
  - revision 4 resolved the second review's 8 findings (§13);
  - revision 5 resolved the third review's 6 blockers and its point on the owner's record (§14);
  - revision 6 resolved the fourth review's two release gaps, its status-table concern and the owner's record (§15);
  - revision 7 resolved the fifth review's three items, and the gaps found in a full self-review of revision 6 (§16);
  - revision 8 records the owner's G1, G2, N1 and N2 answers, and hardens the plan after the sixth review and a
    further full self-review (§17).
- **The owner's answers:**
  - `docs/business/P10_OWNER_BILLING.md`, answered 11 November 2026: every question (Q1–Q14) with the suggested option,
    and the permissions' wording approved as written;
  - `docs/business/P10_OWNER_BILLING_FOLLOWUP.md`, answered 11 November 2026: every question (F1–F5) with the suggested
    option. F2's and F3's answers were first saved with typing slips and later corrected in the form, not by the
    integration team. The form records both;
  - `docs/business/P10_OWNER_BILLING_CONFIRMATION.md`, answered 11 November 2026 (`3869154`): C1, yes, F2 and F3 as
    they now read are his answers; F6, a business whose billing date is the day billing is switched on again is
    charged that day, as in Q12 (the suggested option);
  - `docs/business/P10_OWNER_BILLING_SECOND_FOLLOWUP.md`, answered 13 November 2026: G1, deactivated businesses keep
    their debt but aren't charged for deactivated dates; G2, access returns once all non-held invoices are paid, and a
    held invoice stays owed without suspending access by itself;
  - `docs/business/P10_OWNER_RULE_NOTES.md`, approved 13 November 2026 (N1 and N2, "add it as written"; the name and
    date as the project lead confirmed them, `2b6059d`). The dated notes are now in `BUSINESS_RULES.md` under rule 2.5
    (the trial starts at email confirmation, `85e5ac6`) and rule 10.6 (what "activity" means, `02d816f`), word for
    word, as rule 11.2's note was added (D9).
  - Every owner question is answered, and the signed rules agree with the answers: §9 condition 8 is met.
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
- **The 90-day trial,** from email confirmation (Q1, which supersedes BR-2.5's "from sign-up"; §2).
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
| TA-12: billing restore and suspension need failure rules | Restore only on a charge TransactPay has confirmed. A deposit alone never restores (§3.7). A charge in `unknown` changes no state until it is resolved. Requests that have passed the check complete, and the next request sees the new state (§3.6). "Email confirmed, wallet being set up" is a valid state: such a business is in trial, so there is nothing to charge. Several unpaid months: everything owed must be paid (Q5), except a month held for a failure that isn't the business's (G2) |
| TA-25: a separate subscription gate | No separate gate. Every endpoint declares its behaviour while suspended in the route registry, and an endpoint with no declaration is blocked. The database enforces the same rule through the permission it already checks (§3.6, P10-3) |
| TA-1: platform ledger | Settled in P6: the ledger has `owner_kind`. The platform chart has 1100 Platform wallet, 4100 Subscription income and 5100 Provider charges, and the templates `subscription.paid` (business: Dr 5100 / Cr 1100) and `platform.subscription_received` (platform: Dr 1100 / Cr 4100) exist |
| The P9 plan §6: the subscription on P9's payment orders | An order posts to one ledger today. A subscription posts to two, the business's and the platform's, in one transaction (§3.5, P10-8) |
| The P9 plan §10 condition 5: VA-to-VA transfers, payout idempotency, `accountName` | Asked of TransactPay (`P10_TRANSACTPAY_QUESTIONS.md` §1–§5, `accountName` included). Billing can't charge until their answers are implemented and proven in the sandbox (§9) |
| OPEN-10: does the trial start at sign-up or at email verification? | The owner's Q1: at email confirmation. BR-2.5 said "from sign-up". The owner approved a dated note under it, word for word (`P10_OWNER_RULE_NOTES.md`, N1, 13 November 2026), now in `BUSINESS_RULES.md` (`85e5ac6`), as rule 11.2's was (D9). BR-2.5's original wording stays, and the note says what replaces it. There is one source of truth again |
| OPEN-11: what counts as agent activity (BR-10.6a, "still to define")? | The owner's Q2: a sign-in to the mobile app or a recorded collection, in the 15 days before the billing date (§3.3). Now a dated note under BR-10.6 (N2, `02d816f`) |

## 3. Design

All dates are in WAT (Africa/Lagos, UTC+1, no daylight saving; ADR-11). A "day" is a WAT calendar day.

### 3.1 Billing state and invoices (P10-2)

- **`billing.merchant_billing`,** one row per business, created when the business first becomes `active` (below). It
  holds:
  - the state (`trial`, `current`, `suspended`, `exempt`);
  - `trial_ends_on`;
  - `anchor_day` and `next_billing_on` (§3.4);
  - the exemption's reason and author.
- **Kept apart from the merchant lifecycle** (`tenancy.merchants.status`: `pending_verification`, `active`,
  `deactivated`). A suspended business is still `active`. Unconfirmed businesses have no billing row.
- **When the billing row is created (P10-31).** In the same transaction in which the business first becomes `active`.
  That happens on two paths, and P10 changes both:
  - P3's `identity.verify_email`, when the owner confirms the email and the business leaves `pending_verification`;
  - P4's lifecycle function, when a business deactivated before its owner confirmed is reactivated after the owner has
    confirmed. It goes straight to `active`, without passing through `verify_email`.

  On either path:
  - the confirmation moment is the later of the business's `created_at` and its owner's `email_verified_at`, and
    `trial_ends_on` is that moment's WAT day plus 90 days (Q1; BR-2.5's note). On the second path that day can fall
    while the business was deactivated: the trial still runs from the confirmation, as Q1 says;
  - creating the row takes `billing.settings` for share (19). If billing has ever been switched on, the row gets its
    first billing date at once (§3.4). The first switch-on takes the settings row for update, so a row created at the
    same moment either is seen by the switch-on or sees it: none is left without a date (a race test, and the
    platform status lists any row without a date once billing has been switched on);
  - a business that changes owner keeps its row and its trial. An ownership transfer isn't a confirmation.
- **Businesses that exist when P10's migration runs.** The migration creates a row for every business that is `active`,
  or `deactivated` with a confirmed owner, by the same confirmation moment. Each is in `trial`, with no billing date
  until billing is first switched on. The migration lists every row it creates for the platform team. In every
  environment so far this is test data (BR-1.1). If any real business exists in production before the migration runs
  there, P15 shows the owner its trial dates before billing can be switched on (§6).
- **A deactivated business (G1, answered 13 November 2026; P10-13).** The platform team can
  deactivate a business and reactivate it later (P4's lifecycle function), and `tenancy.merchants` keeps only the latest
  deactivation. So:
  - P10 changes the lifecycle function to append each deactivation and reactivation to `billing.lifecycle_history`, in
    the same transaction, holding the business's `merchant_billing` row for update (a P4 change, like §3.6's P5 change);
  - a date whose decision moment falls while the business is deactivated is unbilled, `deactivated` (§3.4), so a
    reactivated business is never billed for that time;
  - what it owes stays owed. No new order is created or claimed while it is deactivated. If a claim committed before
    deactivation, that charge is already past the point of no return and may finish while the business is deactivated
    (§3.5). Its billing state doesn't change. Once reactivated, it is billed from its next date, and what it owes is
    taken as usual.
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
| `suspended` | a charge attempt is refused for lack of money | `suspended` | the invoice stays `open` |
| `current` or `suspended` | an attempt on a held invoice is refused for lack of money | unchanged | it stays `open` and held; this invoice does not cause or renew suspension (G2) |
| `current` or `suspended` | a charge attempt fails finally for any other reason | unchanged | stays `open`; retried on the bounded schedule of §3.5. A failure that isn't for lack of money never suspends |
| `current` or `suspended` | a charge attempt's outcome is `unknown` | unchanged | stays `open`; no new attempt until the lookup resolves it (§3.5) |
| `current` | a charge succeeds | `current` | `paid` |
| `suspended` | a charge succeeds and every other `open` invoice is held (§3.5), or there is none (Q5, G2) | `current` | `paid`. A held invoice stays owed, and never suspends the business again by itself |
| `suspended` | a charge succeeds while another `open` invoice isn't held | `suspended` | that one `paid`; the next is attempted |
| any but `exempt` | exempted by the Super Admin (Q11) | `exempt` | `open` invoices with no attempt past the point of no return become `waived`, with the reason. Those with one become `waiver_pending` (F1, §3.8). An order of theirs still `created` is cancelled by its claim (§3.5) |
| `exempt` | a date whose decision moment came before the exemption is processed after it (§3.4) | `exempt` | the invoice is issued `waived`, with the exemption's reason: the outcome it would have had if processed on time and then waived (F1) |
| any | a `waiver_pending` invoice's charge succeeds | unchanged | `paid`: the money moved, as F4 records for any payment already sent. This holds after the exemption is lifted too |
| any | a `waiver_pending` invoice's charge fails, or is resolved failed | unchanged | `waived`, as the exemption decided. This holds after the exemption is lifted too |
| `current` or `suspended` | a `paid` invoice's charge is found reversed, the reversal falling within the reversal window (§3.5) | unchanged | back to `open`, both postings reversed; retried by the schedule. A reversal isn't a refusal for lack of money, so it never suspends by itself |
| `exempt` | a `paid` invoice's charge is found reversed within its window | `exempt` | `waived`, both postings reversed |
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
- **A custom price applies only on a date with 21 or more agents.** On a date with 20 or fewer, the business pays its
  band, whatever custom price it has.
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
  first time sets each business's first billing date to the later of `trial_ends_on` and the switch-on day (Q12), in
  the switch-on's own transaction, holding the settings row for update (§3.1). That
  includes exempt and deactivated businesses, whose dates are then unbilled while that lasts.
- **A business confirmed after the first switch-on** gets `trial_ends_on` as its first billing date, when its billing
  row is created.
- **Later dates come from the anchor.** The first date's day of the month becomes `anchor_day`. Each later date is the
  anchor day of the following month, or that month's last day if it is shorter (Q3).
  - Every date is computed from `anchor_day`, never from the previous date, so the day never drifts. Anchor 31 gives 31
    Jan, 28 or 29 Feb, 31 Mar.
  - The anchor is kept through exemptions, deactivations and switch-offs.
- **The period key is the billing date.** `billing.periods` holds one row per business and date, by its primary key
  (§3.1).

**When a date is decided (P10-19, P10-26)**

Each date D has one **decision moment**, m(D): the first moment of day D at which billing is on.
- It is D 00:00 if billing was on when the day began.
- If billing is switched on during D, m(D) is that moment. This is how a first billing date on the switch-on day is
  charged (Q12). Every later switch-on is treated the same way (F6, the owner's answer).
- If billing was off for the whole of D, D has no decision moment.

D is invoiced only if, at m(D):
1. the business isn't deactivated, by `billing.lifecycle_history` (§3.1, G1);
2. the business isn't exempt, by `billing.exemption_history`;
3. the release guard is open, by `billing.guard_history` (§3.8);
4. a price exists. With 21 or more agents, that means a custom price set before m(D) (§3.2, F3).

Otherwise D is unbilled, with the first reason that applies: `billing_off` (no decision moment), `deactivated`,
`exempt`, `charges_held`, or `awaiting_price`.

**Every input is recorded history.** `billing.switch_history`, `billing.lifecycle_history`,
`billing.exemption_history`, `billing.guard_history` and the custom-price versions each record every change with its
time. Each row is written in the same transaction as the
change itself; the guard's rows are written by the worker (§3.8). So D's outcome depends only on what was true at m(D),
never on when the worker happens to process D. The same history processed at different times gives the same rows (a
test).

**The run decides D only once m(D) has come,** or once D has ended with billing off. A date on a day still in progress
with billing off waits, since it may still be switched on that day.

This settles the cases the reviews raised:
- **a delayed worker:** D is decided from the history at m(D). If the business wasn't exempt and the guard was open
  then, D is invoiced late, for its own window and version. That is debt the owner's switch allowed;
- **an intentional pause:** with billing off all day, or the business deactivated or exempt at m(D), D is never
  invoiced. That holds even if billing is on again, the business reactivated, or the exemption lifted, before the
  worker gets to D (Q12, F2, F4, G1);
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
- `walletShort`: whether the wallet's balance, less the reservations (§3.5), is below what is owed for months that
  aren't held plus the upcoming amount: the shortfall that would suspend the business (§3.5, G2). A held month is shown
  separately, as owed.

It isn't shown while billing is off or the business is exempt, since that date won't be charged unless that changes
first. Charges held by the guard don't hide it: the guard may reopen before the date.

### 3.5 The charge (BR-10.3; P10-8, P10-10, P10-11, P10-17, P10-20, P10-21)

**Who makes orders (P10-18).** Only the worker's charge task makes a subscription order, and only while the worker's
runtime guard is open (§3.8 conditions 3 and 4). The request to pay (§3.7) makes no order. It marks the business's open
invoices as requested, and the task picks them up on its next pass.

**The gate at creation.** `create_order` enforces the database's part of the gate atomically with the insert.
- For a subscription order, it takes `FOR SHARE` on `billing.settings` and on the business's `merchant_billing` row.
- It refuses unless billing is on, the business is neither exempt nor deactivated, and the invoice is `open` with an
  attempt due (below).
- Switching off, exempting and deactivating take those rows for update. So an order is created either before one of
  them commits, or not at all (a race test).

**A `created` order is never stranded (P10-22).** The charge task sweeps every `created` subscription order and claims
it. The claim takes the same share locks, and also receives whether the worker's runtime guard is open.
- If billing is on, the business is neither exempt nor deactivated, and the runtime guard is open, the claim moves the
  order to `unknown`, and the worker sends it.
- Otherwise the claim moves it to `cancelled`, in the same transaction, which releases its reservation. The attempt is
  recorded as cancelled.
- So an order created just before a switch-off, an exemption, a deactivation, or a change of the worker's configuration
  is cancelled by its claim, never sent. Switching off, exempting and deactivating don't cancel orders themselves. In
  revision 4 switching off and exempting did, and an order inserted after their scan could be left `created`, holding
  its reservation (the third review).
- While the worker is stopped, a `created` order keeps its reservation. Nothing else spends from a Live wallet in P10
  (P9 Q2). The platform status lists any `created` order older than one pass.

**Attempts.** `billing.charge_attempts` records each attempt: invoice, attempt number, payment order, outcome.
- The order's reference is `sub-<invoice id>-<attempt number>`. A new attempt has a new reference, and an old reference
  is never reused.
- A partial unique index allows one unfinished attempt per invoice.
- Open invoices are attempted oldest first.

**When a new attempt is made (P10-20).**
- Only after the previous attempt is final: failed (including `not_submitted`, below), `insufficient`, cancelled or
  `reversed`. Never after `unknown`, and never while one is unfinished.
- Only when the provider guarantees that a final failure never later succeeds (`capabilities.finalFailureIsFinal`, from
  TransactPay's answers to §2.4 and §2.6.2). It is part of the release guard (§9 condition 2): without it, billing can't
  charge at all, and the plan returns to the reviewer and the owner.
- If a final failure later succeeds despite the guarantee, it is an order finding (below). Nothing is posted
  automatically. A second debit that results is owed back to the business, and is listed as a refund for the platform
  team (§6).

**Taking nothing unless what is owed is covered (Q5, Q6, G2; P10-11, P10-32).** Q6 chose "take nothing" when the
wallet holds less than what is owed, Q5 "everything owed must be paid", and G2 that a month on hold never suspends a
business by itself. Read together, with several invoices open, let **available** be the Live wallet's balance less its
reservations, **N** the sum of the `open` invoices that aren't held, and **H** the sum of the held ones:
- **invoices that aren't held** are attempted, oldest first, only when available covers N. Otherwise each one due is
  recorded `insufficient` without an order, exactly as if the reservation had refused it (§3.1's lack-of-money rows).
  A held month never counts towards that shortfall, so it can't make a business short for its other months, and so
  can't suspend it indirectly (G2);
- **a held invoice** with its attempt due is attempted only when available covers N + H, after the others. Otherwise
  no order is made and nothing is recorded: it stays held, its attempt stays due, and the business isn't suspended for
  it. The worker's sweep attempts it once a confirmed deposit makes available cover N + H;
- `create_order`'s reservation stays the last check, per order. Nothing else spends from a Live wallet in P10, and P9
  never debits a deposit automatically (a contradicted deposit goes to the platform team, E1). So a wallet that covered
  everything a moment earlier still does between orders; if it somehow didn't, the reservation refuses, and nothing is
  half taken.

**When an attempt is due.** An invoice without an unfinished attempt is due:
- when it is issued (attempt 1);
- after a non-money failure, at `next_attempt_at` (the schedule below);
- after `insufficient`, when the worker's sweep finds available covers N (above), after P9 posted a confirmed deposit
  (§3.7);
- after `cancelled`, once the gate is open again;
- on a request to pay (§3.7): every `open` invoice without an unfinished attempt becomes due at once, a held one by
  `held_attempt_due`. At most one request is acted on per business an hour; a repeat within the hour is answered with
  the attempts already made.

**The retry schedule and holds (P10-21).** A hold is not an invoice state. An invoice stays `open` while held, and its
retry fields record the schedule:
- `failures`: the count of consecutive non-money failures;
- `next_attempt_at`: when the next automatic attempt is due;
- `held`: true once `failures` reaches 4;
- `held_attempt_due`: whether a held invoice has its one allowed attempt waiting.

After an `insufficient` attempt, the next one is made when available covers N (above, §3.7). After a non-money
failure, the schedule is:

| Attempt | Made |
|---|---|
| 1 | when the date is invoiced |
| 2 | 1 hour after failure 1 |
| 3 | 6 hours after failure 2 |
| 4 | 24 hours after failure 3 |
| — | after failure 4 (the first attempt and its three retries), the invoice is held |

- **A held invoice is attempted only when `held_attempt_due` is set.** It is set:
  - by the run, at each later billing date of the business;
  - by a request to pay (at most one request an hour, above);
  - **once the cause looks fixed** (G2: "taken as soon as the problem is fixed"). Once a day, if any subscription
    charge has succeeded since the invoice was held, the cause is evidently gone, and each held invoice gets its
    attempt. So a held month is taken within a day of the provider working again, with no command from the platform
    team, and the attempts stay bounded: at most one a day, and only after evidence of a success.

  The flag clears only when an order is actually made for it. While available doesn't cover N + H, it stays set, and
  the worker's sweep makes the order after a confirmed deposit that covers it.
- **A held invoice doesn't keep a business suspended** (G2, answered 13 November 2026): access returns once every other
  open invoice is paid (§3.1, §3.7). The held invoice stays owed.
- **A provider's `insufficient` answer on a held invoice** doesn't suspend the business either. The invoice stays held,
  and is next attempted by the rules above.
- **Each outcome:**
  - success: the invoice is `paid`, and any hold ends;
  - `insufficient` on a non-held invoice: `failures` returns to 0 and §3.1's lack-of-money row applies;
  - `insufficient` on a held invoice: it stays `open` and held, and does not cause or renew suspension (G2). It is
    next due on a later billing date or request to pay;
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
the "lack of money" outcome: the attempt is recorded as `insufficient`, with no order, and §3.1 applies. Nothing is half
taken (Q6).

**The point of no return (P10-22).** An order is "sent" from the moment its claim commits it to `unknown`.
- The claim moves it from `created` to `unknown` (P9's design: a claimed order may already have been sent). It does so
  only under the share locks above, with billing on and the business neither exempt nor deactivated.
- Switching off, exempting and deactivating take those rows for update, so each change and a claim are serialized:
  - if the change commits first, every later claim cancels;
  - if the claim commits first, the order is past the point of no return and is finished and recorded. It may settle
    after the switch-off, exemption or deactivation commits (F4, G1).
- After its claim, the worker does nothing but check its lease and runtime guard, and send. A later deactivation does
  not cancel that already-claimed order. A lapsed lease leaves the order `unknown`, for the lookup (below).
- `cancelled` is a state P10 adds to P9's orders, reachable only from `created`, and only by a claim.

**An order the provider never received (P10-24).** The claim commits before the send. A worker that stops between the
two leaves an order `unknown` that TransactPay never saw. P9's resolution reads "not found" as `unknown` and leaves it so
for ever, which would keep the invoice from a new attempt and keep its reservation. P10 changes P9's resolution:
- **The last moment a request can leave our side is the end of the claim's lease** (`lease_until`, set by the
  database). P9's worker starts a call with an effect only if the call's timeout ends inside the lease (P9-R3). It
  measures the lease on its own monotonic clock from just before it asks for the claim, and keeps 10% in hand, so every
  send has ended before `lease_until`. The finality times below count from `lease_until`.
- **Leaving our side isn't reaching TransactPay.** A request sent just before the lease ends can be delayed on its way,
  and reach them after we have looked it up and found nothing. So "not found" may be final only under a guarantee that
  holds for such a request, measured from when we send, not from when it arrives. TransactPay's public documentation
  gives none, so §2.5 asks for one of two forms. The adapter declares `capabilities.notFoundFinal` only with one of
  them, and records which:
  - **`blocksReference`:** once the requery has answered "not found" for a reference, no request with it is ever
    processed: neither one that arrives afterwards, including one we sent earlier that was delayed, nor one that had
    already arrived but wasn't yet visible. Then the first "not found" obtained after the lease ends is final;
  - **`refusedAfter(A)` with `visibleWithin(L)`:** every request we send carries, or is bound by, a limit A: TransactPay
    refuses any request reaching them more than A after we sent it (an expiry in the request, or a bound they state and
    enforce). And every request they accept is visible to the requery within L of reaching them. Then a "not found"
    obtained at or after **the lease's end + A + L + K** is final: any request we sent either reached them by the
    lease's end + A, and is visible by the lease's end + A + L, or is refused. K allows for our clock and
    TransactPay's differing, since A is applied on their clock and `lease_until` is ours;
  - A visibility time L alone, with no bound on arrival, is **not** enough, and the capability isn't declared on it.
- **The clock allowance K (P10-33)** is 5 minutes. The worker checks that it holds: each answer from TransactPay carries
  an HTTP `Date`, and if that differs from the database's clock by more than K/2, the worker **pauses its charges**: it
  makes, claims and sends no order, and resolves no "not found" as final, until they agree again. The pause is shown
  on the platform status. It isn't a closure of the release guard, so dates are still decided as usual: like a stopped
  worker, the charges catch up once the clocks agree, and a passing clock fault never leaves a month unbilled. P15
  keeps the servers' clocks synchronized (§6).
- **A final "not found"** resolves the order `failed`, with the reason `not_submitted`. That releases the reservation,
  and the schedule above allows a new attempt with a new reference. It counts as a non-money failure, so a worker that
  keeps crashing reaches a hold.
- **"Not found" before then, or without the capability,** stays `unknown`, as in P9. Its reservation stays held, the
  invoice gets no new attempt, and the order is listed for the platform team.
- **A confirming lookup.** Every order resolved `failed`, `not_submitted` included, is looked up once more 24 hours
  later. Any answer other than "not found" or a failure is an order finding (below).
- **If the old reference is paid out despite the guarantee,** it is an order finding: listed, nothing posted
  automatically, and a resulting second debit is listed as owed back to the business (§6). The debit is never
  unrecorded: the confirming lookup or the reconciler (below) records it.
- **The capability is part of the release guard** (§9 condition 2). Without it, billing can't charge.
- **The rule applies to every outbound order,** since the guarantee is the provider's. In P10 there are no others (P9
  Q2).

**Order findings (P10-29).** P9's contradiction path covers provider events (deposits): `record_order` refuses any order
already final, so an answer that contradicts a final order had nowhere to go. P10 adds `payments.order_findings`, a P9
change:
- each records the order, what was recorded, what the provider now answers (status, amount, transaction, times), and
  when it was seen. A finding seen again updates `last_seen_at`, as P9's reconciliation findings do;
- it is shown to the platform team with the reconciliation findings, and resolved by a person with a note, as P9's are.
  Nothing is posted or changed automatically;
- written only by the worker's functions, and read through the platform's findings view.

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
- A confirmation whose fee model isn't the one the adapter declared is not posted. The order stays `unknown`, with its
  reservation held so the money isn't spent twice, and an order finding is recorded. The invoice gets no new attempt.
- The invoice becomes `paid` in the same transaction. Each posting is keyed by the provider transaction, so each is made
  once.

**A success later reversed (P10-27).** TransactPay's published status table has 9, "Reversed": "Payout was reversed
after processing". So a charge reported successful may be undone, and P10 defines what follows.
- **What the provider must state.** The adapter declares `capabilities.reversalWindow` only with all of these from
  TransactPay (§2.6.4–§2.6.6):
  - the window W: how long after a payout's success it can be reversed, zero if never;
  - that the requery's answer gives the time the payout succeeded and, once reversed, the time of the reversal, both
    on TransactPay's clock;
  - that a final payout can still be looked up for at least W plus a day.

  Without the declaration, billing can't charge (§9 condition 2).
- **When a reversal happened, not when we learned of it.** The window runs from TransactPay's success time, and a
  reversal is classified by TransactPay's reversal time: both times come from the same clock. When we found out doesn't
  matter.
- **The watch (P10-27).** A succeeded subscription order carries a watch until it completes. The watch has three
  scheduled checks: 1 hour after success, 24 hours after, and W plus 1 hour after (the hour allows for the two clocks).
  - **A check is complete only on a conclusive answer:** "successful", or "reversed" with its time.
  - **Anything else is inconclusive:** an error, a timeout, an unclear answer, "not found", or any other status. The check
    is retried 5 minutes later, then at doubling intervals up to an hour, for as long as it takes. A failed lookup never
    completes a check, and later checks don't replace an earlier one that is still open.
  - **The watch completes** only when its last check gets "successful" at or after W plus 1 hour. Until then the order
    isn't settled. A watch whose last check is a day overdue is listed for the platform team, and keeps retrying.
  - **"Not found", or a status other than successful or reversed,** for an order recorded as succeeded, is also an order
    finding. The watch keeps retrying.
  - P10 doesn't rely on a payout webhook: P9's webhook handles deposits, and whether TransactPay sends one for payouts is
    asked in §2.6.4. If one is added later, it may only bring a check forward. The lookup stays the authority.
- **Classifying a reversal**, whenever it is found, by a check, a retry or the reconciler's lead:
  - **its reversal time is within W of the success time:** the normal reversal below, even if it is found after the
    window has ended;
  - **its reversal time is after that:** a provider contradiction. An order finding is recorded and escalated to the
    platform team, and nothing is posted automatically;
  - **no reversal time, despite the capability:** if found before the success time plus W, by our clock less the hour
    in hand, it can only have happened within the window, and is the normal reversal. Otherwise it can't be classified,
    and is an order finding, escalated, with nothing posted automatically.
- **Duplicate reports.** The reversal is posted once: its postings are keyed by the provider transaction and
  "reversal", and the order moves to `reversed` once. The same answer again changes nothing; a different one is an order
  finding.
- **An order whose first conclusive answer is "reversed"** (the success was never seen, for instance while the order
  was `unknown`): the money left and came back, so neither success nor reversal is posted. A fee the provider reports as
  kept is posted to the platform's 5100. The order becomes `reversed`, the attempt `reversed` (a non-money failure), and
  the invoice stays `open`.
- **A normal reversal**, in one transaction:
  - the order moves from `succeeded` to `reversed`, a state P10 adds to P9's orders;
  - each posting is reversed by its own template, keyed by the provider transaction: the business's Dr 1100 / Cr 5100,
    and the platform's mirror of its success posting by the declared fee model. Whether the fee comes back is posted as
    the provider reports it, never computed;
  - the invoice returns from `paid` to `open` (or, if the business is exempt, becomes `waived`); the attempt is recorded
    `reversed`, and counts as a non-money failure for the schedule;
  - the business's billing state doesn't change. A reversal isn't a refusal for lack of money, so it doesn't suspend;
    the next attempt does, if the wallet can't cover it (BR-10.4). A business that this charge had restored stays
    `current` until then.
- **A reversal while billing is off:** the invoice is open and owed, and nothing is taken until billing is on (F4).
  While the business is deactivated, the same (G1).

**The reconciler and charges in flight (P10-30).** P9's reconciler compares each Live wallet's provider balance with
its 1100 (§3.6 of the P9 plan). P9 had no outbound orders. With charges, a wallet's balance and its books differ
legitimately while an order is unfinished: the provider may have moved the money before we record it. P10 changes the
comparison:
- **Source wallet:** a provider balance below the books by no more than the sum of its `unknown` and `submitted`
  outbound orders is "in flight", not a finding;
- **Platform wallet:** a provider balance above the books by no more than the sum of its incoming unfinished orders,
  less the fees the declared fee model takes from them, is likewise in flight;
- an in-flight difference is checked again on the next pass. Once the orders are final, any difference that remains is
  a finding, as in P9;
- a reversal not yet found by the watch shows as a difference until it is. It is recorded as a finding, as P9 records
  any difference, and the watch's lookups find which order it was.

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
- deactivating and reactivating: P4's lifecycle footprint as it is (the merchant, 2), then the billing state (19, for
  update) and the lifecycle history (19);
- creating a billing row, in `verify_email` or a first activation by reactivation: P3's or P4's footprint as it is,
  then the settings (19, share) and the new row (19);
- switching billing on for the first time: the settings (19, for update), then every billing row without a date (19,
  one sorted acquisition, L5);
- the run: the billing state (19, for update), then the period (19);
- a normal reversal: the projections (14), the order (18), then the attempt, the period and the billing state (19);
- an order finding: the order (18) and the finding (18), nothing in billing.

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

- **Access returns only when the charge is confirmed.** In the same transaction that pays the last open invoice that
  isn't held, the state goes from `suspended` to `current` (Q5, G2). A deposit alone never restores.
- **A charge is retried in two ways:**
  - after P9 posts a confirmed deposit, the worker's sweep picks up a suspended business whose wallet, less its
    reservations, now covers what it owes for months that aren't held (N, §3.5), and a held invoice whose attempt is
    due once the wallet covers everything owed (N + H);
  - the owner, or staff with `merchant.subscription.pay`, asks for one.
- **The request to pay:**
  - it carries an `Idempotency-Key`, and a repeat returns the first answer;
  - it makes no order itself (§3.5): it makes the open invoices due, a held one by its one allowed attempt, and answers
    with their attempts. At most one request is acted on per business an hour (§3.5);
  - with billing off, or charges held by the guard's latest recorded state (§3.8), it records nothing and says so;
  - if the wallet doesn't cover what is owed for months that aren't held, their due attempts are recorded
    `insufficient`, a held invoice stays held with its attempt still due, and the answer gives the amount short (Q6).
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
2. the business is neither `exempt` nor deactivated (§3.1);
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
| `GET /v1/platform/billing/businesses` · `…/{merchantId}/invoices` · `/v1/platform/billing/preview` · `/v1/platform/billing/status` | `platform.billing.read` | — | every business's billing state and amount owed; a business's periods (invoices, unbilled dates and held invoices); what a run would charge; the guard's state and history, the release approvals, any `created` order older than one pass, order findings, and overdue reversal watches (§3.5, §3.8) |
| `GET` · `POST /v1/platform/billing/prices` · `POST …/prices/{id}/withdrawal` | `platform.billing.read` / `platform.billing.prices` | — | the versions; a new version with its start date; withdrawing one not yet started |
| `PUT /v1/platform/billing/businesses/{merchantId}/custom-price` | `platform.billing.custom_price` | — | the price for 21 or more agents (Q9, F3) |
| `PUT /v1/platform/billing/settings` · `POST /v1/platform/billing/release-approvals` · `POST` · `DELETE …/businesses/{merchantId}/exemption` | `platform.billing.switch` (Super Admin; not grantable) | — | switching billing on or off, and recording the VAT treatment; recording a release approval with its evidence (§3.8); an exemption and lifting it |

- **Activity events** (atomic; identifiers and amounts only):
  - `billing.invoice_issued`, `billing.date_unbilled`, `billing.release_approved`;
  - `billing.charge_requested`, `billing.charge_cancelled`, `billing.charge_held`;
  - `billing.invoice_paid`, `billing.invoice_waived`, `billing.charge_reversed`;
  - `billing.suspended`, `billing.restored`;
  - `payments.order_finding_recorded` (the platform's record, as P9's `payments.finding_recorded`);
  - `billing.prices_set`, `billing.prices_withdrawn`, `billing.custom_price_set`;
  - `billing.switched`, `billing.exempted`, `billing.exemption_lifted`.
- **Sensitive reads** are recorded once per page, as in P9.
- **The P9 Live-wallet read** (`GET /v1/merchant/wallet`) is declared allowed while suspended.

## 5. Tests

**BR-1.3 and the release guard**
- Before billing is first switched on, no date exists and nothing is written.
- `enabled` set directly in the database, with `BILLING_CHARGES` off or a capability false: no invoice, order or send.
- Production configuration refuses `BILLING_CHARGES=on` without any one of the four capabilities.
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
- Deactivated at m(D), reactivated before processing: `deactivated`. Reactivated: billed from the next date, and what
  was owed is taken as usual (G1).
- A claim committed before deactivation: the order may finish after deactivation; a claim after deactivation cancels.
- A business confirmed after the first switch-on: its first date is its trial end.
- **The billing row (P10-31):** created by `verify_email`, and by a reactivation that makes a business `active` for the
  first time (its owner confirmed while it was deactivated), with the trial from the confirmation moment either way.
  A business confirmed at the same moment as the first switch-on gets a date (a race test: no row without one).
  An ownership transfer leaves the row and the trial as they were.
- **The migration's rows:** an `active` business, and a `deactivated` one with a confirmed owner, each get a `trial`
  row from the later of `created_at` and the owner's `email_verified_at`; a business still `pending_verification`
  gets none; each created row is listed.
- One history, processed at several different times, gives the same rows.
- A lifted exemption bills from the next date (F2).

**BR-10.1 and prices**
- The price at each band's edge: 0, 1, 3, 4, 6, 7, 10, 11, 20 and 21 agents.
- 21 or more without a price: the date is unbilled. A price set before the next date is invoiced on it; one set after
  leaves that date unbilled too (F3).
- A business with a custom price and 20 or fewer agents on a date pays its band.

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
- A confirmation with an undeclared fee model isn't posted: the order stays `unknown`, its reservation held, and an
  order finding is recorded. A replayed confirmation posts nothing more.

**What is owed (Q5, Q6, G2)**
- Two invoices open, neither held, the wallet covering one: nothing is taken, both attempts are `insufficient`, and the
  request to pay answers with the amount short. Covering both: both taken, oldest first.
- A held month and a new month, the wallet covering only the new one: the new one is taken, the held one isn't
  attempted, and the business isn't suspended. The held month never makes a business short for its other months.
- The sweep attempts invoices that aren't held only once available covers N, and a held one only once it covers
  N + H.
- `walletShort` counts months that aren't held, and shows a held month separately.

**Attempts, retries and holds**
- `insufficient`, then a deposit: attempt 2, with a new reference.
- Non-money failures: attempts 2, 3 and 4 at 1 h, 6 h and 24 h after each failure. Failure 4 holds the invoice, which
  stays `open`.
- A held invoice: no attempt by the schedule; one at its next billing date, one per request to pay (at most one an
  hour), and one a day once any subscription charge has succeeded since it was held. Success ends the hold; another
  failure keeps it. With no success anywhere since, no daily attempt is made.
- `insufficient` on an invoice that isn't held resets the count.
- A held invoice that is the only one owed, with the wallet short: no order and no `insufficient` are recorded, access
  stays active, and `held_attempt_due` stays set. A confirmed deposit that covers N + H makes the sweep attempt it once
  and clear the flag.
- The provider answering `insufficient` on a held invoice: it stays `open` and held, and the business isn't suspended.
- `cancelled` leaves the count and schedule as they were, and the attempt is made again once the gate reopens.
- `unknown`: nothing until resolved. Resolved failed gives a new attempt by the schedule; resolved successful gives
  nothing, and the invoice is paid.
- With `finalFailureIsFinal` false, no second attempt is ever made.
- A repeated `Idempotency-Key` returns the first answer. A second request within the hour makes no new attempt.
- A `reversed` attempt allows a new one by the schedule.

**An order the provider never received** (the FakeProvider can delay a request's arrival, and hide an arrived request
from its lookup for a set time)
- The claim commits, and the worker stops before sending. The FakeProvider never received the reference.
- With `refusedAfter(A)` and `visibleWithin(L)`: "not found" before `lease_until` + A + L stays `unknown`; at or after
  it, `failed`, `not_submitted`, the reservation released, and attempt 2 by the schedule.
- With `blocksReference`: the first "not found" after `lease_until` is final; one before it is not.
- **The clock allowance:** with `refusedAfter(A)`, a "not found" between `lease_until` + A + L and that plus K stays
  `unknown`. TransactPay's `Date` differing from the database's clock by more than K/2: no order is made, claimed or
  sent, and no "not found" becomes final; dates are still decided, and the charges catch up once the clocks agree.
- **The late request** (the fifth review's case): a request leaves before `lease_until` and arrives after the first
  "not found".
  - With `blocksReference`, it is refused.
  - With `refusedAfter(A)`, if it arrives within A it is visible before any final "not found", and the order resolves
    by its real outcome; if it arrives later, it is refused.
  - In neither case is it paid out after the order is marked failed and its reservation released.
- **An arrived request not yet visible:** with `blocksReference`, a "not found" given while it is hidden blocks it, and
  it is never processed.
- **The FakeProvider made to break the guarantee:** the late request is paid out. The confirming lookup records an order
  finding, the reconciler records the difference, and nothing is posted automatically. The debit is recorded, never
  silent.
- A visibility time L alone, with no bound on arrival: the capability can't be declared (a configuration test).
- Without the capability: `unknown` for good, the reservation held, listed, and no new attempt.

**A success later reversed** (the FakeProvider gives success and reversal times on its own clock)
- Reversed within the window, found by a scheduled check: the order `reversed`, both postings reversed once each, the
  invoice `open`, the business's state unchanged, and a new attempt by the schedule. An exempt business's invoice
  becomes `waived`.
- **Failed lookups:** the 24-hour and the final checks fail or are inconclusive (error, timeout, "not found"). The checks
  stay open and are retried; the watch doesn't complete. A reversal within the window, found by a retry after the
  window has ended, is a normal reversal.
- **Late discovery:** a reversal whose time is after the window, found by any check: an order finding, escalated,
  nothing posted.
- **No reversal time:** found before the window ends, a normal reversal; found after, an order finding.
- **Duplicate reports:** the same reversal answered by two checks, or twice by one: posted once. A different answer
  afterwards: an order finding.
- **First answer "reversed":** an `unknown` order whose first conclusive answer is reversed posts nothing but a fee the
  provider kept, and the invoice stays `open`.
- The checks at 1 hour, 24 hours and W plus 1 hour; with W zero, none. A watch a day overdue is listed.

**Order findings and the reconciler**
- A final failure answered "successful" by the confirming lookup: an order finding, nothing posted.
- An order finding seen again updates it; it is resolved by a person with a note.
- An outbound order `unknown` while the provider has already moved the money: the difference is "in flight", not a
  finding. Once the order is final, a remaining difference is a finding.

**The status table**
- Each ID 1–12 and each name maps as §3.5's table says; 11 and 12 never resolve an order; an unknown ID or name is an
  unclear answer.

**Orders and the gate**, as races:
- `create_order` against a switch-off: either the order commits first and its claim cancels it, or creation is refused.
  No `created` order survives a claim after a switch-off.
- The same for exempting, and for deactivating.
- The worker's runtime guard closing after an order is created: the claim cancels it and the reservation is released.
- The worker stopped: the `created` order keeps its reservation and is listed.

**The reservation**
- Two orders at once against a wallet that can pay for one: exactly one is made.
- An unfinished order's amount is reserved until it is final.

**The point of no return**, as races:
- switch-off against a claim: either the claim commits first and the order is sent and recorded, or the switch-off
  commits first and no claim commits after it. Never a send after a committed switch-off;
- the same for exempting;
- deactivation against a claim: if deactivation commits first, the claim cancels; if the claim commits first, that
  order may finish and settle after deactivation.
- exempting while a charge is past the point of no return: `waiver_pending`, then `paid` on success, `waived` on
  failure, including when the exemption is lifted before the charge is resolved.

**BR-10.4**
- Not enough money suspends, from `trial`'s first invoice as from `current`.
- Owner and staff get 402 with the amount, and can still sign in. An agent gets 403.
- Every registry operation has a declaration, and it matches its permission's database flag.
- A blocked call is refused by the database even if the API's check is bypassed.

**BR-10.5**
- A confirmed charge restores, and the next request succeeds. A deposit alone does not restore.
- An `unknown` charge changes no state.
- With several invoices open, access returns only when all are paid (Q5), except one that is held (G2): a suspended
  business whose other invoices are paid is restored, and the held one stays owed.
- When only a held invoice remains and its due attempt finds the wallet short, the due flag persists without an order
  or suspension; a confirmed deposit that covers N + H makes the sweep attempt it, with access active.
- If an attempted held invoice receives a provider `insufficient` answer, it remains held and owed, and access stays
  active; this result does not suspend or re-suspend the business.

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
  exemption taking no order lock, the lifecycle function's new 19, `verify_email`'s new 19, the first switch-on, the
  reversal path, order findings).
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
- **OPEN-7 (payouts):** refunding a charge listed as owed back (§3.5), and settling order findings that leave money
  owed back.
- **P12:** billing emails (the warning before the billing date, the suspension, the restore, a held invoice); invoice
  PDFs.
- **P13:** the Subscription page and the redirect while suspended (`middleware.ts`).
- **P15:** the worker's billing tasks in production, its `BILLING_CHARGES` setting, and §9's conditions. One billing
  worker process at a time: a deployment stops the old worker before the new one starts, so the guard's history (§3.8)
  never interleaves two processes. The servers' clocks synchronized, so the clock allowance K holds (P10-33). If any
  real business exists in production before P10's migration runs there, its trial dates are shown to the owner before
  billing can be switched on (§3.1).

## 7. Decisions (recommended options, the project lead's standing instruction)

| # | Decision | Taken |
|---|---|---|
| P10-1 | The job runner | P9's worker and leases on the domain's own rows, not pg-boss (P9-1) |
| P10-2 | Where suspension lives | its own billing state, with every transition defined (§3.1), not a merchant lifecycle status: suspension and deactivation have different causes, people and ways back |
| P10-3 | The subscription gate (TA-25) | a required per-endpoint declaration in the registry plus a per-permission flag checked in `assert_authority`; no separate middleware |
| P10-4 | Reading the state for suspension | without a row lock, so the check adds nothing to any request's lock footprint; TA-12 accepts that a request already admitted completes |
| P10-5 | What triggers a restore | a confirmed charge only; retried by the worker's sweep once the wallet covers what is owed for months that aren't held (N), or at the business's request. A held invoice doesn't keep a business suspended (G2); if its due attempt waits for funds, the due flag persists and the sweep retries after a confirmed deposit covering N + H |
| P10-6 | Price changes | versions with a start date at least 30 days away (Q8), never edits; invoices keep their version |
| P10-7 | Agent activity | from existing sessions and collections, in a defined window, with a guard test that keeps that evidence; no `tenancy.agent_activity` table and nothing added to the hot paths |
| P10-8 | Posting a subscription | P9's order gains the platform's posting, by the declared fee model, AlphaKolect bearing the fee (F5); both ledgers post in the order's success transaction |
| P10-9 | Billing off | nothing invoiced or charged; dates that pass are recorded unbilled; a read-only preview for the platform team |
| P10-10 | How money moves | a provider transfer from the business's virtual account to the platform's, through the port. Recording it in the books alone, if TransactPay's balances turn out to be pooled, is **not** chosen: it would change what the ledgers' 1100s mirror, and goes to the reviewer and the owner once TransactPay answers |
| P10-11 | Not enough money | invoices that aren't held are attempted only when the wallet, less reservations, covers all of them (N; Q5 with Q6); a held one only when it covers everything (N + H; G2); the reservation in `create_order` as the last check per order; the provider's answer after |
| P10-12 | Billing's lock category | 19, after payments |
| P10-13 | Businesses billing leaves alone | unconfirmed ones (no billing row); `exempt` ones (F1); deactivated ones by their own recorded history: no dates charged and no new orders while deactivated; debts are kept; a claim committed before deactivation may finish (G1) |
| P10-14 | P9's open state | P10 is planned and built on P9's merged code, and changes six things in P9: `create_order` (the reservation, and the billing gate for a subscription order), the claim (the `cancelled` state), the resolution of an order not found (P10-24), the `reversed` state with its postings and the watch (P10-27), order findings (P10-29), and the reconciler's in-flight rule (P10-30). It also changes P3's `identity.verify_email` (the billing row, P10-31), P4's lifecycle function (its history, and the billing row on a first activation by reactivation; P10-13, P10-31) and P5's `assert_authority` (P10-3). P10 does not close before P9 does |
| P10-15 | Gate | this plan's review now; one review of the build at the end |
| P10-16 | The customer audience | out of P10's exit criteria by an explicit amendment, as P2's was; RESTRUCTURING_MAP's P10 row is amended when this plan is approved. Building customer sign-in here would be a phase of its own |
| P10-17 | Concurrent spending | every outbound order reserves its amount against the source wallet's locked 1100 projection |
| P10-18 | The release guard | four conditions, checked by the run (from history), before an order is made and before each send (in the worker), and in `create_order` and the claim (in the database, under share lock); configuration alone is not trusted |
| P10-19 | Deciding a date | from recorded history alone (the switch, exemptions, the guard, custom prices) at the date's decision moment, so the worker's timing never changes an outcome; every date is recorded, invoiced or unbilled with its reason |
| P10-20 | Retrying a failed charge | only with the provider's guarantee that a final failure is final; without it, billing can't charge |
| P10-21 | Bounded retries | after a non-money failure, retries 1 h, 6 h and 24 h later; failure 4 holds the invoice (a retry field, not a state): then one attempt per billing date, per request to pay, and once a day after evidence that the cause is gone (P10-32); never suspending |
| P10-22 | The point of no return, and cancelling | the claim's commit, made only with billing on and the business neither exempt nor deactivated, under a share lock that switch-off, exemption and deactivation must wait for. A claim that finds the gate closed cancels the order instead, so no `created` order is stranded |
| P10-23 | One row per billing date | a single `billing.periods` table, invoiced or unbilled, with one primary key, a check constraint and immutable outcomes; not two tables, whose uniqueness no constraint could span |
| P10-24 | An order the provider never received | "not found" is final, as `not_submitted`, only under a provider guarantee that covers a request delayed on its way: the reference blocked by the first "not found", or a refusal bound A on arrival with a visibility time L, final from `lease_until` + A + L. L alone isn't enough. A confirming lookup 24 hours later. Without the guarantee, the order stays `unknown`, its reservation held, and billing can't charge |
| P10-25 | Conditions that are judgments | recorded as release approvals, with their evidence, before the switch can be turned on; called approvals, not system checks |
| P10-26 | The decision moment | the first moment of the date's day at which billing is on: midnight if it was on, the switch-on moment if it was switched on that day (Q12, F6) |
| P10-27 | A success later reversed | the window W and the provider's success and reversal times required (`reversalWindow`); a watch of three checks, each complete only on a conclusive answer and retried until it gets one; a reversal classified by its own time, not when it is found: within W, both postings reversed, the invoice reopened and retried without suspending; after W or unclassifiable, an order finding, escalated, nothing posted |
| P10-28 | The status table | the adapter maps TransactPay's current table (IDs 1–12, 14 October 2026), by ID and by name, 11 and 12 not final, with a test for each; P9's older mapping is passed to P9 |
| P10-29 | Contradictions on orders | `payments.order_findings`, since P9's contradiction path covers deposits only and `record_order` refuses a final order; recorded, shown and resolved by a person; nothing posted automatically |
| P10-30 | The reconciler with charges in flight | a difference within the wallet's unfinished outbound (or, for the platform, incoming) orders is in flight and checked again; anything else, or anything left once they are final, is a finding |
| P10-31 | When the billing row is created | in the transaction in which the business first becomes `active`, on both paths (`verify_email`, and reactivation after the owner confirmed while deactivated), the trial from the later of `created_at` and the owner's `email_verified_at`; serialized with the first switch-on through the settings row; existing businesses given rows by the migration on the same rule, and listed |
| P10-32 | Held months and what is owed | a held month counts neither towards the shortfall that suspends (N) nor towards whether other months are taken; it is taken when the wallet covers everything (N + H), and attempted once a day after any subscription charge succeeds since it was held (G2: "as soon as the problem is fixed") |
| P10-33 | The clock allowance | K = 5 minutes, added to the `refusedAfter(A)` finality time; a `Date` from TransactPay more than K/2 from the database's clock pauses charges without closing the guard, so no month is lost to a clock fault |
| P10-34 | Declaring a capability | only in an adapter release that the independent reviewer reviews, citing TransactPay's written answer (who, when) and the sandbox run (commit, date, results) for each one. In P10's build the TransactPay adapter declares none, and a test pins that, so a declaration can't arrive without that test changing in review |

## 8. Questions out

| To | Document | State |
|---|---|---|
| The owner | `docs/business/P10_OWNER_BILLING.md` | answered 11 November 2026: every question with the suggested option; the wording approved |
| The owner | `docs/business/P10_OWNER_BILLING_FOLLOWUP.md` | answered 11 November 2026: F1–F5, each with the suggested option. F2 and F3 were first saved with typing slips ("Thne", "words that passed", `e5a7b83`) and later corrected in the form, not by the integration team (`f30d107`). The form records both |
| The owner | `docs/business/P10_OWNER_BILLING_CONFIRMATION.md` | answered 11 November 2026 (`3869154`): C1, F2 and F3 confirmed as they now read; F6, charged that day, as in Q12 (the suggested option) |
| The owner | `docs/business/P10_OWNER_BILLING_SECOND_FOLLOWUP.md` | answered 13 November 2026: G1, debts stay owed and no dates are charged while deactivated; G2, access returns once all non-held invoices are paid, and the held invoice doesn't suspend by itself |
| The owner | `docs/business/P10_OWNER_RULE_NOTES.md` | approved 13 November 2026: N1 and N2, "add it as written" (the form's name and date as the project lead confirmed them, `2b6059d`). The notes are in `BUSINESS_RULES.md` under rules 2.5 (`85e5ac6`) and 10.6 (`02d816f`), word for word |
| TransactPay | `docs/business/P10_TRANSACTPAY_QUESTIONS.md` (with the P9 follow-up) | §1 moving money between virtual accounts, and `accountName`; §2 duplicate references, the lookup, the status table, whether a failure can later succeed, the guarantee that makes "not found" final for a delayed request (§2.5), and the status table, reversals and their times (§2.6); §3 insufficient funds; §4 sandbox testing; §5 fees. **Not sent yet** |

## 9. Before billing can charge

Each condition is one of two kinds:
- **System:** the code refuses to charge without it. Capabilities are declared in the adapter's code, so whether a
  declaration is true is reviewed in the release that adds it: the independent reviewer reviews it against TransactPay's
  written answer and the sandbox run, cited for each capability (P10-34). Once declared, nothing charges without it.
- **Approval:** a person's judgment, which the system can't check. The system refuses to switch billing on until the
  approval is recorded with its evidence (§3.8). It enforces that the record exists, not what it says.

| # | Condition | Kind | Proven by | Enforced by |
|---|---|---|---|---|
| 1 | TransactPay documents a transfer between two of our virtual accounts, debiting the source account, with the destination's required fields (`accountName` included) | system | their answer (§1); a sandbox test moves money between two sandbox virtual accounts and sees both balances change | `walletTransfer` declared only by the adapter release that implements it; production refuses `BILLING_CHARGES=on` without it, and the guard (§3.8) is closed |
| 2 | TransactPay states what a repeated reference does, when and for how long the lookup answers, every status and which are final; **guarantees that a final failure never later succeeds**; **guarantees that "not found" is final even for a request delayed on its way, in one of §2.5's two forms**; and **states whether and within how long a success can be reversed, how it is reported, and the times of success and reversal in the requery's answer** | system | their answer (§2, including §2.5 and §2.6); sandbox tests of a duplicate reference, a lookup after a timeout, a reference never sent, a delayed request where the sandbox allows, and pending to final (§4) | `finalFailureIsFinal`, `notFoundFinal` and `reversalWindow`, each declared only with its statement; without all three, production refuses `BILLING_CHARGES=on` |
| 3 | TransactPay states its insufficient-funds answer, and the adapter maps their **current** status table | system | their answer (§3, §2.6); the adapter maps it to `insufficient`; a test per status ID (P10-28); a sandbox test | part of the adapter release behind `walletTransfer` |
| 4 | The fee model is confirmed, and is one §3.5 supports, AlphaKolect bearing the fee (F5) | system | their answer (§5); its posting tested; the reconciler finds no difference after a sandbox transfer | the adapter declares one fee model, and the capability only if it is supported. A confirmation with another model isn't posted: an order finding, the order kept `unknown` |
| 5 | Pooled or per-account balances (P9 follow-up §2) | system | their answer | the capability is declared only for per-account balances. If pooled, P10-10 and the reconciler return to the reviewer and the owner |
| 6 | P9's conditions for live money (P9 plan §10, conditions 1–10: a real deposit, the balance enquiry, the worker's isolation in production, and the rest) | **approval** | the reviewer's closure of P9's live-money gate | a release approval for condition 6, citing that closure, must be recorded before billing can be switched on (§3.8). P10's migrations also come after P9's, but that orders the schema; it proves none of P9's conditions |
| 7 | The accountant confirms in writing how subscription income is accounted for VAT (Q10) | **approval**, and a system check | a written sign-off | a release approval for condition 7, citing the letter, and the recorded treatment: the switch can't be turned on without both. If VAT is inside the price, the platform posting splits it (§3.5) |
| 8 | The owner's answers, and the signed rules agreeing with them | **approval** | Q1–Q14, F1–F5, C1 and F6, answered 11 November 2026; G1, G2, N1 and N2, answered 13 November 2026; the notes under BR-2.5 and BR-10.6 in `BUSINESS_RULES.md` (`85e5ac6`, `02d816f`) | **met.** Checked by the plan review and the project lead, not by the system. Any answer TransactPay's replies make necessary goes to the owner in a new form (§9.1) |
| 9 | The owner switches billing on, as Super Admin, from the platform admin | system | BR-1.3 | `enabled` false by default; only the non-grantable `platform.billing.switch` changes it |

**Where the conditions stand (2026-11-13).** Condition 8 is met. Conditions 1–5 wait on TransactPay's answers
(`P10_TRANSACTPAY_QUESTIONS.md`, not sent yet) and the sandbox; condition 6 on P9's closure; condition 7 on the
accountant; condition 9 on the owner, last. Billing stays paused until every one holds.

### 9.1 When TransactPay answers

Each answer decides a capability. So that no answer can be read hopefully, the outcome of each is fixed now:

| Their answer | What follows |
|---|---|
| §1: a transfer between two of our virtual accounts exists and debits the source account | `walletTransfer` may be declared once the sandbox shows both balances change (P10-34) |
| §1: no such transfer, or balances pooled | `walletTransfer` isn't declared, and billing can't charge. P10-10 returns to the reviewer and the owner; recording the subscription in the books alone isn't chosen in advance |
| §2.4, §2.6.2: a failure (4 or 8) can later succeed or be retriggered | `finalFailureIsFinal` isn't declared. Retries are unsafe, so billing can't charge, and the plan returns to the reviewer |
| §2.5: form a (the reference blocked) or form b (A and L) | `notFoundFinal` may be declared with that form and its times, and K added to form b |
| §2.5: L alone, or neither | `notFoundFinal` isn't declared, and billing can't charge. Without it a crashed send would hold a business's money indefinitely |
| §2.6.4–§2.6.6: a reversal window with both times in the requery's answer, and lookups lasting the window plus a day | `reversalWindow` may be declared |
| §2.6.4: successes can't be reversed | `reversalWindow` declared as zero: no watch, and any reversal seen is an order finding |
| §2.6: reversals possible, but no window or no times | `reversalWindow` isn't declared, and billing can't charge |
| §2.6.1: the requery's statuses or names differ from the published table | the mapping (P10-28) changes to theirs, with its tests, before any capability is declared |
| §3: their insufficient-funds answer | mapped to `insufficient`, with a sandbox test where the sandbox allows |
| §5: no fee, a fee from the amount, or a fee charged to the platform | the matching fee model is declared and its posting tested (§3.5) |
| §5: a fee charged to the business on top | not supported (F5): the capability isn't declared, and the choice goes to the owner in a new form |
| Any answer that changes what a business pays or when | a new owner form before the capability is declared |

## 10. The build, once approved

- **Migrations:**
  1. `billing_core`: schema, tables (the periods, the switch, exemption and guard histories, the release approvals,
     attempts), the rows for existing businesses (P10-31), RLS, the price seed, the permission flag, the platform's VAT-payable account, the order's platform
     posting, its `cancelled` and `reversed` states and the reversal templates, `create_order`'s reservation and billing
     gate, `billing.lifecycle_history`, `payments.order_findings`;
  2. `billing_functions`: the run and its decision moment, the charge task, the claim's guard and cancellation, attempts
     and holds, the `not_submitted` resolution and the confirming lookup, the reversal watch and its classification,
     order findings, the reconciler's in-flight rule, restore, the switch, approvals and exemptions, the billing row in
     `verify_email` and on reactivation, the lifecycle function's history, the reads, `assert_authority`'s suspended
     outcome.
- **Contracts:** `whileSuspended` on the registry and every existing operation; the new endpoints.
- **Provider:**
  - the port gains `capabilities.walletTransfer`, `capabilities.finalFailureIsFinal`,
    `capabilities.notFoundFinal`, `capabilities.reversalWindow`, a declared fee model, and the transfer;
  - the FakeProvider covers every fee model and outcome, including a reference it never received, a request delayed
    on its way, an arrived request hidden from its lookup for a while, reversals with their times, and a `Date` set
    off from the database's clock;
  - the TransactPay adapter declares none of the four capabilities, and maps the current status table (§3.5).
- **API and worker:** `modules/billing`; the worker's tasks (the run, the charge task, the resolution of unknown orders
  with the confirming lookup, the reversal watch); the release guard and its history; `BILLING_CHARGES`; the 402 and
  403 envelopes.
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
| 8 | 2026-11-13 | The owner's G1, G2, N1 and N2 recorded, and the notes under BR-2.5 and BR-10.6 added (§9 condition 8 met); the sixth review's verdict and a further full self-review (§17): the billing row on both activation paths and for existing businesses, the first switch-on race, held months kept out of the suspending shortfall and attempted once the cause is gone, the clock allowance, the outcome of every TransactPay answer fixed in advance (§9.1), capability declarations reviewed with their evidence |
| 7 | 2026-11-11 | The fifth review's three items and a full self-review resolved (§16): "not found" final only with a bound on a request's arrival, or the reference blocked; the reversal watch retried until conclusive, a reversal classified by its own time; BR-2.5 and BR-10.6 notes put to the owner; order findings; the reconciler with charges in flight; deactivation; everything owed before taking anything; restore with a held month; the owner's second follow-up (G1, G2) |
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
| 2 | Nothing said what happens if a paid charge is later reversed; TransactPay publishes status 9, "Reversed" | §3.5 and P10-27: `reversalWindow` declared only with TransactPay's statement (§2.6.4), required by §9 condition 2. Succeeded orders are looked up again within it; a reversal reverses both postings, reopens the invoice and is retried without suspending; after the window, the contradiction path (corrected in revision 7, §16: order findings). §3.1 gains the reversal rows |
| 3 | P9's status mapping reads 6 as "Reversed"; the current table has 6 as Awaiting Approval and 9 as Reversed | §3.5 and P10-28: the adapter maps the current table (IDs 1–12, updated 14 October 2026) by ID and by name, with 11 and 12 not final, and a test for each; §9 condition 3. TransactPay §2.6 asks them to confirm it. P9's older mapping is passed to P9, which is still open (§6) |
| 4 | The confirmation form held the owner's answers, but the plan still called them awaited | The owner answered on 11 November 2026: C1, yes; F6, charged that day, as in Q12 (`3869154`). Status, §3.4, P10-26, §8 and §9 condition 8 updated: met |

Nothing has been pushed since revision 1. PR #12 stays open and unmerged, for review only.

## 16. The fifth plan review, and a self-review (2026-11-11)

The reviewer did not approve revision 6: three items remained (the review of `11ea6b4`). Revision 7 resolves them. Before
sending it, the whole plan was read again against the code it changes, and the gaps found are resolved here too, so that
the review doesn't have to find them.

**The review's items**

| # | Finding | Resolved in |
|---|---|---|
| 1 | `visibleWithin(L)` counted from a request's arrival, so a request sent before `lease_until` and delayed on its way could arrive, and be paid out, after a final "not found" | §3.5 and P10-24: the guarantee must hold for a delayed request, measured from when we send. Either `blocksReference` (no request with the reference is ever processed after a "not found", whether it arrives later or had arrived unseen), or `refusedAfter(A)` with `visibleWithin(L)`, final from `lease_until` + A + L. L alone isn't enough. Without either, the order stays `unknown` and its reservation held, and billing can't charge. TransactPay §2.5 asks for these terms (`f91cc93`). §5: the late-request test, an arrived-but-hidden request, and the guarantee broken (an order finding and a reconciler finding: never silent) |
| 2 | The reversal watch had no rule for failed lookups, and classified a reversal by when it was found | §3.5 and P10-27: each check is complete only on a conclusive answer, and is retried until it gets one; the watch completes only on "successful" at or after W plus an hour; an overdue watch is listed. A reversal is classified by TransactPay's reversal time against its success time, so one within the window is normal even if found late; one after it, or one that can't be classified, is an order finding, escalated. The capability needs those times (TransactPay §2.6.5) and lookups lasting W plus a day (§2.6.6). §5: delayed discovery, failed lookups, late discovery, no time, duplicates |
| 3 | BR-2.5 says the trial starts at sign-up; the owner's Q1 says at email confirmation | §2: Q1 is a recorded, traceable exception to BR-2.5 for P10. Following rule 11.2's precedent (D9), the owner is asked to approve a dated note under BR-2.5, word for word, keeping the original wording (`P10_OWNER_RULE_NOTES.md`, N1, `16d751f`); BR-10.6's "still to define" gets the same (N2). §9 condition 8 is not met until he approves them and they are added |
| — | PR #12 not a draft, its description out of date | marked as a draft, and its description brought up to date with revision 7 |

**Found in the self-review**

| # | Gap in revision 6 | Resolved in |
|---|---|---|
| S1 | Several places sent an order's contradiction to "P9's contradiction path". For orders there is none: it covers deposit events, and `record_order` refuses any order already final | §3.5 and P10-29: `payments.order_findings`, recorded by the worker, shown and resolved by a person, nothing posted automatically. A confirming lookup 24 hours after every failed order. Every place that relied on the missing path now uses it |
| S2 | The reconciler would have reported a finding for every charge in flight, since the provider can move the money before we record it | §3.5 and P10-30: a difference within the wallet's unfinished outbound (or, for the platform, incoming) orders is in flight and checked again |
| S3 | A deactivated business, once reactivated, would have been invoiced for every date it missed, since the run decides from history that didn't include deactivation; and nothing stopped its charges | §3.1, §3.4 and P10-13: `billing.lifecycle_history`, written by P4's lifecycle function; `deactivated` as an unbilled reason; `create_order` and the claim refuse and cancel; the lock order. Whether its debts stay owed is the owner's (G1, `ac6220a`) |
| S4 | Q5 with Q6 didn't say whether "the whole amount" meant one invoice or everything owed | §3.5 and P10-11: an attempt only when the wallet, less reservations, covers everything owed, the two answers read together; otherwise `insufficient`, with the amount short in the request to pay's answer |
| S5 | A month held for a provider failure would have kept a business suspended after it paid everything else, though a hold "never suspends" | §3.1 and §3.7: restore once every other open invoice is paid, the held one staying owed, as the owner's suggested option (G2) |
| S6 | A `waiver_pending` invoice had no rule once the exemption was lifted | §3.1: its rule holds whatever the state: `paid` on success, `waived` on failure |
| S7 | `reversed` wasn't among the final outcomes after which a new attempt is made; an order whose first answer was "reversed" had no rule; the watch relied on a payout webhook that P9 doesn't handle | §3.5: `reversed` is final; the first-answer case posts only a fee kept; the lookup is the authority, a webhook only brings a check forward |
| S8 | The request to pay's effect on invoices between retries wasn't defined, nor its rate | §3.5 "When an attempt is due" and §3.7: every open invoice becomes due, at most one request an hour per business |
| S9 | A business confirmed after the first switch-on had no first billing date; a custom price's effect below 21 agents wasn't stated; a stated lease clock was wrong (the worker measures its lease on its own monotonic clock, with 10% in hand) | §3.4, §3.2, §3.5 |
| S10 | Smaller: a "both capabilities" test from revision 5; the decisions table out of order; a missing `suspended` lack-of-money row; the upcoming charge hidden while charges are held | §5, §7 (P10-24 to P10-30 in order), §3.1, §3.4 |

PR #12 stays open, unmerged and a draft, for review only. (Corrected in revision 8: this line first said nothing had
been pushed since revision 1, but the project lead had pushed revision 6, `11ea6b4`; revision 7's commits were local.)

## 17. The owner's answers, the sixth review, and a further self-review (2026-11-13)

**The owner.** He answered G1 and G2 with the suggested options (`588f7ad`), and approved both rule notes, N1 and N2,
"add it as written" (`b616407`). The form's name and date lines were blank; the project lead confirmed them, and they
were recorded with a line saying so (`2b6059d`). The notes are now in `BUSINESS_RULES.md` under rules 2.5 (`85e5ac6`)
and 10.6 (`02d816f`), word for word, with only the date filled in, as rule 11.2's was. §9 condition 8 is met.

**The sixth review** (of revision 7, `2ebe06a`): not approved, as "a strong draft" needing one more loop. The design
isn't rejected; the plan is held by the owner's notes, now done, and by TransactPay's answers. Billing stays paused
until every §9 condition holds, and PR #12 stays a draft. §9.1 now fixes, for each possible answer, what follows, so
the answers can't be read hopefully when they come.

**A draft found in the working copy.** Before this revision, an uncommitted draft of revision 8 was found in the
working copy; the integration team didn't write it. It recorded G1 and G2 and two edge cases, and it is kept where
sound. Its errors are corrected below (items 5 and 6).

**The self-review.** The whole plan was read again against the code it changes:

| # | Gap | Resolved in |
|---|---|---|
| 1 | A charge already claimed when a business is deactivated wasn't defined (the draft's case) | §3.5: deactivation and the claim serialize; a claim committed first may finish after the deactivation; one after it cancels. §5 tests both |
| 2 | The billing row was "created when the email is confirmed", but on two paths a business first becomes `active`: `verify_email`, and a reactivation after the owner confirmed while it was deactivated (P4's function, which doesn't go through `verify_email`) | §3.1 and P10-31: the row is created on both, the trial from the later of `created_at` and the owner's `email_verified_at`. §5 tests both |
| 3 | Businesses that exist when the migration runs had no rule | §3.1 and P10-31: rows by the same rule for `active` businesses and `deactivated` ones with a confirmed owner, listed; P15 shows the owner any real one (§6) |
| 4 | A business confirmed at the moment of the first switch-on could be left without a billing date for good, and the run writes nothing for such a row | §3.1 and §3.4: row creation and the first switch-on serialize on the settings row; a race test; the status lists any row without a date |
| 5 | "Everything owed" counted held months, so a held month could make a business short for its next month, and so suspend it indirectly, against G2. The draft kept that threshold | §3.5 and P10-32: months that aren't held are attempted when the wallet covers them (N); a held month only when it covers everything (N + H). `walletShort` and the sweep follow. §5 tests the case |
| 6 | The draft cited `ac6220a` (the blank form) for the owner's answers, and a test still said `insufficient` ends a hold, against the draft's own G2 rule | §17 cites `588f7ad`; §5 says `insufficient` resets the count only on an invoice that isn't held |
| 7 | G2 says a held month is "taken as soon as the problem is fixed", but it waited for the next billing date or a request to pay | §3.5 and P10-32: once a day, after any subscription charge has succeeded since it was held, each held invoice gets its attempt. Bounded, and no command needed |
| 8 | `refusedAfter(A)` compares our clock with TransactPay's, with no allowance for the two differing | §3.5 and P10-33: K = 5 minutes added; the worker pauses charges (without closing the guard, so no month is lost) while TransactPay's `Date` is more than K/2 off; P15 keeps the clocks synchronized |
| 9 | Two P10-24 bullets had ended up under order findings in revision 7 | moved back under P10-24 |
| 10 | Revision 7 left "switching off and exempting don't cancel orders" without deactivation; the anchor rule didn't name deactivation; the reconciler's platform range ignored fees | §3.5, §3.4, P10-30 |
| 11 | "System" conditions depend on a capability being declared truthfully, and nothing said how a declaration is reviewed | §9 and P10-34: declared only in a release the independent reviewer reviews against the written answer and the sandbox run; a test pins that P10's build declares none |

Nothing beyond revision 6 has been pushed. PR #12 stays open, unmerged and a draft, for independent review only.
