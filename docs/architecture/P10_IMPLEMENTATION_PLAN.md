# P10 implementation plan — billing

**Status: revision 1 (2026-11-11), a draft for the independent reviewer's plan review. Nothing is built.** It is to be
built in one pass, as P6 to P9 were, once three things have happened:

- the reviewer has approved this plan;
- the owner has answered `docs/business/P10_OWNER_BILLING.md` (Q1–Q14 and the permissions' wording);
- the project lead has agreed to start.

Decisions that would go to the project lead take the recommended option (his standing instruction) and are recorded in
§7. The owner's questions are not answered here; where the design depends on one, it names the question. P9 is merged to
`main` but **not closed**. P10 builds on its payment orders and worker, and does not close before P9 does (P10-14).
**Billing stays paused (BR-1.3)**, and no real money moves in P10: §9 lists what must be true before billing is switched
on.

| | |
|---|---|
| Branch | `feat/p10-billing`, from `main` at `031e4db` (P9 merged as PR #11, still open) |
| Inputs | `BUSINESS_RULES.md` 1.3, 2.2, 2.5, 10.1–10.6, 12.2; `TARGET_ARCHITECTURE.md` §11 (billing), §6 (money commands), §20 (jobs), §30 OPEN-10 and OPEN-11; `TARGET_ARCHITECTURE_REVIEW.md` TA-12 and TA-25 (due at P10); `RESTRUCTURING_MAP.md` P10 row; the P9 plan §3.4 (payment orders), §3.7 (the worker), §6 (obligations to P10) and §10 condition 5; ADR-16 (fail-closed authorization) |
| Exit (RESTRUCTURING_MAP) | BR-1.3 (the global pause flag) and BR-10.1–10.6 tests, including how suspension behaves for each audience |

## 1. Scope

**In P10:**

- **Prices:** versioned, editable, with a future start date (BR-10.1, 10.2, 12.2), and a custom price for 21 or more
  agents.
- **Each business's billing state:** trial, billed, suspended or not billed, kept apart from the merchant lifecycle.
- **The 90-day trial** (BR-2.5, Q1).
- **The billable-agent count** (BR-10.6a, Q2).
- **Invoices,** one per business per billing period.
- **The charge:** a payment order from the business's Live wallet to the Platform Live wallet, posted to both ledgers on
  confirmation (BR-10.3).
- **Suspension:** for insufficient funds, enforced for each audience in both layers (BR-10.4, TA-25).
- **Restore:** automatic, on a confirmed charge only (BR-10.5, TA-12).
- **The billing switch,** off by default, with a business-by-business exemption (BR-1.3, Q11).
- **A preview** of what billing would charge, while it is off.

**Not in P10:**

- **Moving real money.** The TransactPay adapter can't yet move money between virtual accounts (P9 §10 condition 5), and
  `P10_TRANSACTPAY_QUESTIONS.md` asks how. The charge is built and tested against the FakeProvider, and billing can't be
  switched on in production while the adapter can't do the transfer (§9).
- **Emails and reminders** (P12, notifications). In P10 the warning is on the Subscription page (Q7).
- **The customer audience's suspension behaviour, end to end.** Customers can't sign in yet: sessions are platform,
  merchant or agent. P10 declares the behaviour and passes the test on (§6).
- **Invoice PDFs** (documents, P12).
- **The web Subscription page and its redirect** (P13). P10 delivers the API and the error codes it needs.

## 2. The findings due before P10

| Finding | Settled by |
|---|---|
| TA-12: billing restore and suspension need failure rules | Restore only on a charge TransactPay has confirmed. A deposit alone never restores (§3.7). A charge in `unknown` keeps the business suspended until it is resolved. Requests that have passed the check complete, and the next request sees the new state (§3.6). "Email confirmed, wallet being set up" is a valid state: such a business is in trial, so there is nothing to charge. The several-unpaid-invoices question is the owner's Q5 |
| TA-25: a separate subscription gate | No separate gate. Every endpoint declares its behaviour while suspended in the route registry, and an endpoint with no declaration is blocked. The database enforces the same rule through the permission it already checks (§3.6, P10-3) |
| TA-1: platform ledger | Settled in P6: the ledger has `owner_kind`. The platform chart already has 1100 Platform wallet and 4100 Subscription income, and the templates `subscription.paid` (business: Dr 5100 / Cr 1100) and `platform.subscription_received` (platform: Dr 1100 / Cr 4100) exist |
| The P9 plan §6: the subscription on P9's payment orders | An order posts to one ledger today (`ledger_id`, `posting_template`). A subscription posts to two, the business's and the platform's, in one transaction (§3.5, P10-8) |
| The P9 plan §10 condition 5: VA-to-VA transfers, payout idempotency, `accountName` | Asked of TransactPay (`P10_TRANSACTPAY_QUESTIONS.md`). Until they answer, the adapter declares the transfer unsupported, and production refuses to switch billing on (§9) |

## 3. Design

### 3.1 Billing state (P10-2)

- `billing.merchant_billing`, one row per business, created when its email is confirmed. Columns: state (`trial`,
  `billed`, `suspended`, `exempt`), `trial_ends_on`, the next billing date, the amount owed, and the exemption's reason
  and author.
- **Kept apart from the merchant lifecycle** (`tenancy.merchants.status`: `pending_verification`, `active`,
  `deactivated`). A suspended business is still `active`. Billing leaves deactivated and unconfirmed businesses alone.
- **The trial:** 90 days from email confirmation, or from sign-up if the owner answers Q1 that way. The first billing
  date is the later of the trial's end and the day billing was switched on (Q12).
- **State changes** are made only by the billing functions, each recorded in the activity record:
  - `trial` → `billed`;
  - `billed` → `suspended` (a charge failed for lack of money);
  - `suspended` → `billed` (all that is owed is paid, Q5);
  - any state → `exempt` and back (Super Admin, with a reason; Q11).

### 3.2 Prices (BR-10.1, 10.2, 12.2; Q8, Q9)

- `billing.price_lists`: a version, a start date and its author. `billing.price_tiers`: each band of agents and its price
  in kobo. Seeded from BR-10.1:
  - 1–3 agents: ₦5,000;
  - 4–6: ₦10,000;
  - 7–10: ₦15,000;
  - 11–20: ₦40,000;
  - 21 or more: custom.
- **A price change is a new version.** It is never an edit to one in force. Its start date must be at least the notice
  period away (Q8), and a version that hasn't started can be withdrawn. The bands must cover 1 to 20 without gaps or
  overlaps (a database check).
- **The custom price** for 21 or more agents is `billing.custom_prices`, per business, also versioned. Without one, a
  business that needs it is not charged and is listed for the platform team (Q9).
- **An invoice records the version and band it used,** so a later price change never alters it.

### 3.3 Billable agents (BR-10.6a; Q2, Q4; P10-7)

- **Counted from rows that exist already, on the billing date:** an agent membership of the business with an agent
  session created in the 15 days before that date, or a collection it recorded in that time (Q2 may narrow this to one).
  No new activity table is kept, and nothing is added to the sign-in or collection paths. This departs from
  TARGET_ARCHITECTURE §11's `tenancy.agent_activity`.
- **The invoice stores the count and the agents counted,** so the business and the platform team can see why it was
  charged what it was.
- A deactivated agent can't sign in (BR-10.6b, enforced since P4), but it is billed by the activity rule alone: an agent
  deactivated today but active last week counts.
- With no active agents, the business pays the lowest band, or nothing (Q4).

### 3.4 The billing run and invoices

- **A worker task, like P9's** (P10-1). It sweeps the businesses whose billing date has come, claiming each with a lease,
  one at a time, as P9's claims do.
- **Per business and period, in one transaction:**
  1. count the agents;
  2. choose the band and the price;
  3. write `billing.invoices` (business, period, version, band, count, amount, state `open`);
  4. move the next billing date on.
- **`(merchant_id, period)` is unique.** A run repeated, or two workers at once, make one invoice (test).
- **With billing switched off (BR-1.3),** the run writes nothing: no invoice, no charge, no state change. The platform
  team's preview computes the same figures without writing them.
- **The amount owed** is the sum of the open invoices. With the owner's suggested Q5, all of them must be paid for
  access to return.

### 3.5 The charge (BR-10.3; P10-8, P10-10, P10-11)

- **For each open invoice, oldest first,** the billing function creates a P9 payment order: from the business's Live
  wallet, to the Platform Live wallet, purpose `subscription`, reference derived from the invoice (unique).
- **No order is created when there is no money for it.** If the business's account 1100 holds less than the invoice
  (1100 is `non_negative`), the business is suspended instead. Nothing is half taken (Q6).
- **The order then follows P9's machinery unchanged:**
  - it is claimed, then sent with no database transaction open;
  - a timeout leaves it `unknown`, resolved only by looking it up, never sent twice (TA-8, P9 D2).
- **Two ledgers on success.** A migration lets an order carry a second posting: a counterpart ledger and template. On
  success, `record_order` posts both in the same transaction:
  - `subscription.paid` to the business's ledger;
  - `platform.subscription_received` to the platform's ledger.
  The invoice becomes `paid` at the same time. Each posting is keyed by the provider transaction, so each is made once.
- **Failure.**
  - A provider refusal for lack of money fails the order and suspends the business.
  - Any other failure fails the order and leaves the invoice open for the next pass.
  - Either way, nothing is posted.
- **The lock order.** `billing` is lock category 19, after payments (18). The success path takes the projections (14),
  the order (18), then the invoice and the billing state (19). Its footprint is pinned in the lock-order guard.

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
| Customer | Declared now (`423 MERCHANT_SUSPENDED`, "Please contact the company.", reads allowed), and tested once customer sign-in exists (§6) |
| Platform | Unaffected |

### 3.7 Restore (BR-10.5; TA-12; P10-5)

- **Access returns only when the charge is confirmed.** In the same transaction that marks the last owed invoice paid,
  the state goes from `suspended` to `billed`. A deposit alone never restores.
- **A charge is retried in two ways:**
  - the worker's sweep picks up a suspended business whose 1100 now holds the amount owed, after P9 posted a confirmed
    deposit;
  - the owner, or staff with `merchant.subscription.pay`, can ask for an attempt now. The request is idempotent, and
    one order per invoice is open at a time.
- **An `unknown` charge** keeps the business suspended until P9's lookup resolves it.
- **Sessions aren't revoked or reissued.** The state is read on each call, so the next request after the restore
  succeeds.

### 3.8 The switch and exemptions (BR-1.3; Q11, Q12)

- **`billing.settings`:** one row, `enabled` false by default. Only `platform.billing.switch` changes it, and that
  permission is the Super Admin's and can't be granted, like P5's reserved actions.
- **Exemption:** the same permission marks one business `exempt` with a reason, and lifts it.
- **Production configuration refuses `enabled`** while the provider declares it can't transfer between virtual accounts
  (§9).
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
| `GET /v1/merchant/subscription` | `merchant.subscription.read` | allowed | the state, trial end, band, price, next billing date, the coming price (Q8), the amount owed, and the Live wallet's details for loading it |
| `GET /v1/merchant/subscription/invoices` | `merchant.subscription.read` | allowed | the invoices, with the agents counted |
| `POST /v1/merchant/subscription/payment` | `merchant.subscription.pay` | allowed | asks for a charge of what is owed now (idempotent) |
| `GET /v1/platform/billing/businesses` · `…/{merchantId}/invoices` · `/v1/platform/billing/preview` | `platform.billing.read` | — | every business's billing state and amount owed; a business's invoices; what a run would charge |
| `GET` · `POST /v1/platform/billing/prices` · `POST …/prices/{id}/withdrawal` | `platform.billing.read` / `platform.billing.prices` | — | the versions; a new version with its start date; withdrawing one not yet started |
| `PUT /v1/platform/billing/businesses/{merchantId}/custom-price` | `platform.billing.custom_price` | — | the price for 21 or more agents (Q9) |
| `PUT /v1/platform/billing/settings` · `POST …/businesses/{merchantId}/exemption` | `platform.billing.switch` (Super Admin; not grantable) | — | switching billing on or off; an exemption and its removal |

- **Activity events** (atomic; identifiers and amounts only):
  - `billing.invoice_issued`, `billing.charge_requested`, `billing.invoice_paid`;
  - `billing.suspended`, `billing.restored`;
  - `billing.prices_set`, `billing.prices_withdrawn`, `billing.custom_price_set`;
  - `billing.switched`, `billing.exempted`.
- **Sensitive reads** are recorded once per page, as in P9.
- **The P9 Live-wallet read** (`GET /v1/merchant/wallet`) is declared allowed while suspended.

## 5. Tests

- **BR-1.3:** with billing off, a run past every billing date writes no invoice, order or state change. The preview
  shows the figures.
- **BR-10.1:** the price at each band's edge (0, 1, 3, 4, 6, 7, 10, 11, 20, 21 agents). 21 or more without a custom
  price is not charged (Q9).
- **BR-10.2, 12.2:** a new version applies from its start date and not before. Its notice period is enforced. A past
  invoice keeps its version.
- **BR-10.3:** a charge creates one order, from the business's wallet to the platform's. On confirmation both ledgers
  post, once, in one transaction, and the invoice is paid. A replayed confirmation posts nothing more.
- **BR-10.4:**
  - not enough money suspends;
  - owner and staff get 402 with the amount, and can still sign in;
  - an agent gets 403;
  - every registry operation has a declaration, and it matches its permission's database flag;
  - a blocked call is refused by the database even if the API's check is bypassed.
- **BR-10.5:**
  - a confirmed charge restores, and the next request succeeds;
  - a deposit alone does not restore;
  - an `unknown` charge keeps the business suspended;
  - with several invoices open, access returns only when the owner's Q5 rule is met.
- **BR-10.6a, 10.6b:**
  - an agent last active 16 days before the billing date isn't counted, and one active 14 days before is;
  - a deactivated agent can't sign in, and is counted by activity alone.
- **The trial and the first date:** 90 days from the Q1 date. Switching on later bills nothing backdated (Q12).
- **Races:**
  - two runs at once give one invoice per business and period;
  - two charge requests at once give one order;
  - a restore and a new invoice at once leave a consistent state.
- **Isolation:** a business sees only its own subscription. A run and a charge touch only the business they claim (TA-11).
- **Guards:** lock order (category 19), grants (the worker's functions executable by `alphakolect_worker` alone),
  transaction classes, the matrices, coverage and writer guards, OpenAPI `x-while-suspended` present on every operation.

## 6. Obligations passed on

- **The phase that builds customer sign-in:** the customer audience's suspension behaviour (read-only; `423
  MERCHANT_SUSPENDED`, "Please contact the company."), as declared in §3.6, and its test.
- **P12:** billing emails (the warning before the billing date, the suspension, the restore); invoice PDFs.
- **P13:** the Subscription page and the redirect while suspended (`middleware.ts`).
- **P15:** the worker's billing tasks in production; the release conditions of §9.

## 7. Decisions (recommended options, the project lead's standing instruction)

| # | Decision | Taken |
|---|---|---|
| P10-1 | The job runner | P9's worker and leases on the domain's own rows, not pg-boss (P9-1) |
| P10-2 | Where suspension lives | its own billing state, not a merchant lifecycle status: suspension and deactivation have different causes, people and ways back |
| P10-3 | The subscription gate (TA-25) | a required per-endpoint declaration in the registry plus a per-permission flag checked in `assert_authority`; no separate middleware |
| P10-4 | Reading the state | without a row lock, so the check adds nothing to any lock footprint; TA-12 accepts that a request already admitted completes |
| P10-5 | What triggers a restore | a confirmed charge only; retried by the worker's sweep once the books hold the amount, or at the business's request |
| P10-6 | Price changes | versions with a start date, never edits; invoices keep their version |
| P10-7 | Agent activity | counted from existing sessions and collections at billing time; no `tenancy.agent_activity` table and nothing added to the hot paths |
| P10-8 | Posting a subscription | P9's order gains a counterpart posting; both ledgers post in the order's success transaction |
| P10-9 | Billing off | nothing written; a read-only preview for the platform team |
| P10-10 | How money moves | a provider transfer from the business's virtual account to the platform's, through the port. Recording it in the books alone, if TransactPay's balances turn out to be pooled, is **not** chosen here: it would change what the ledgers' 1100s mirror, and goes to the reviewer and the owner once TransactPay answers |
| P10-11 | Not enough money | checked against the business's 1100 before an order is made, and again by the provider's answer; no order is sent that the books say can't be paid |
| P10-12 | Billing's lock category | 19, after payments |
| P10-13 | Businesses billing leaves alone | deactivated and unconfirmed ones, and `exempt` ones |
| P10-14 | P9's open state | P10 is planned and built on P9's merged code; P10 does not close before P9 does |
| P10-15 | Gate | this plan's review now; one review of the build at the end |

## 8. Questions out

| To | Document | What it decides |
|---|---|---|
| The owner | `docs/business/P10_OWNER_BILLING.md` | Q1 trial start (OPEN-10, and rule 2.5's wording); Q2 activity (OPEN-11); Q3 billing date; Q4 no active agents; Q5 several unpaid months (TA-12); Q6 part payment; Q7 warning; Q8 price notice; Q9 21+ without a price; Q10 VAT; Q11 the switch and exemptions; Q12 the first charge; Q13 what a suspended business keeps; Q14 who in a business; the permissions' wording |
| TransactPay | `docs/business/P10_TRANSACTPAY_QUESTIONS.md` (with the P9 follow-up) | how money moves between virtual accounts; duplicate references; insufficient funds; fees |

## 9. Before billing is switched on

| # | Condition | Why |
|---|---|---|
| 1 | TransactPay documents a transfer from one of our virtual accounts to another, and the adapter implements it against the sandbox | the adapter refuses it today (P9 §10 condition 5); production configuration refuses `enabled` until then |
| 2 | TransactPay says whether a repeated reference is refused (P9 D2) | orders are never resent without it, so an `unknown` charge waits for the lookup |
| 3 | TransactPay answers whether balances are pooled (P9 follow-up §2) | if they are, the reconciler and P10-10 are revisited with the reviewer and the owner |
| 4 | TransactPay states the fee on such a transfer, and who pays it | the platform chart has 5100 Provider charges. A fee taken from the amount would make the books and the provider differ |
| 5 | P9's conditions for live money (P9 plan §10) | the charge rests on P9's wallets, worker and reconciler |
| 6 | The owner switches billing on, as Super Admin, from the platform admin | BR-1.3 |

## 10. The build, once approved

- **Migrations:**
  1. `billing_core`: schema, tables, RLS, the price seed, the permission flag, the order's counterpart posting;
  2. `billing_functions`: the run, the charge, restore, the switch, the reads, `assert_authority`'s suspended outcome.
- **Contracts:** `whileSuspended` on the registry and every existing operation; the new endpoints.
- **API and worker:** `modules/billing`, the worker's three tasks, the 402 and 403 envelopes.
- **Tests:** as in §5, in the db and API suites.
- **The gate:**
  - every step exit 0 on a clean tree at a named commit: `format:check`, `lint`, `typecheck`, `build`, `openapi:check`,
    `test`, `test:concurrency`;
  - run with `npm_config_workspace_concurrency=1`;
  - Linux CI on the pull request.

## 11. Revision log

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-11-11 | First plan, for the reviewer's plan review; the owner's form and TransactPay's questions written |
