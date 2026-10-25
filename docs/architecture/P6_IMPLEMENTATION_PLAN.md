# P6 implementation plan — the ledger

**Status: revision 3 (2026-10-25) — built; the gate review's two findings resolved; awaiting its re-check.** Planned and built in one pass at the project
lead's request ("map everything out and implement it in one go"; "efficiency and speed of delivery is very important").
Decisions that would go to the project lead take the recommended option (his standing instruction) and are recorded in
§8. The owner answered both P6 forms on 2026-10-23, each with the suggested options:
`docs/business/P6_OWNER_ACCOUNTS_AND_MAPPINGS.md` (the chart, the corrections, unearned loan interest, both debit
records, transfers not now, the Directors' current account) and `docs/business/P6_OWNER_LEDGER_PERMISSIONS.md` (the
permissions' wording, all three grantable to staff). The chart and the templates are data (§3.2, §4), so a later answer
is a small forward migration, not a redesign. The gate review is the independent reviewer's; §9 lists what each
revision changed, §10 what was built, and §11 the gate review's findings and their resolution.

| | |
|---|---|
| Branch | `feat/p6-ledger`, from the P5 branch tip (P5 closed 2026-10-23, PR #7 not yet merged); rebased onto `main` after the merge |
| Inputs | `TARGET_ARCHITECTURE.md` §6–§10 (money, ledger, wallets, collections, loans); `TARGET_ARCHITECTURE_REVIEW.md` TA-1, TA-3–TA-7, TA-10 (the findings due before P6); `RESTRUCTURING_MAP.md` P6 row; the owner's "Alphakolect CRM — Double-Entry Accounting Integration & Transaction Mappings" (PDF) and *Maps edited.xlsx* (sheets ChartofAccounts, Alphakolect1, Map) |
| Exit (RESTRUCTURING_MAP) | Property tests: balanced entries, projection = Σ lines, reversal nets to zero; BR-11.1 test — plus TA-4's "an entry is reversed at most once, under concurrency" |

## 1. Scope

**In P6:** the ledgers (one per business, and the platform's), the chart of accounts and its system accounts, per-customer
and per-agent sub-accounts, posting (one database function, the only writer), reversal, balance projections and their
nightly check, command idempotency (a shared component), the lock order of ledger rows, the posting templates every later
phase uses (§4), manual journal entries and merchant-defined accounts (BR-9.1), and the reports: account statement, trial
balance, balance sheet, profit and loss.

**Not in P6** (each phase posts through §3.3 with its template): collections, remittances and fees (P8), withdrawals (P8),
loans (P11), payments and Live wallets (P9), billing (P10), investments (P11). The custody ledger is decided with OPEN-12
before P8b (TA-2).

## 2. The findings due before P6, settled

| Finding | Settled by |
|---|---|
| TA-10 module boundaries | Done before P6, as its own step (`187f61c`): one public entry per module, the dependency direction enforced by lint, both cycles broken |
| TA-1 platform ledger | `ledger.ledgers.owner_kind` (`merchant` / `platform`); `merchant_id` required exactly for a business's ledger; one platform ledger. Its rows carry no business, are invisible to the app under row-level security, and are reached only through definer functions |
| TA-3 balances written directly | The app loses `INSERT` on entries, lines, accounts and projections and `UPDATE` on projections. One definer function posts: it inserts the entry and its lines, locks and updates the projections in ascending account order, applies each account's non-negative rule, and returns the existing entry on a replay |
| TA-4 double reversal | A partial unique index on `reverses_entry_id`; the posting function checks the mirror (same ledger, same accounts and amounts, sides swapped) and refuses to reverse a reversal |
| TA-5 duplicate sub-accounts | Unique `(ledger_id, code, subject_type, subject_id) NULLS NOT DISTINCT`; a sub-account is opened by its own idempotent function (it returns the existing one), committed before any posting uses it — so posting never inserts an account and never waits after a contested insert (L3) |
| TA-6 idempotency | `util.idempotency_records`: scope (business, actor, operation, key), the request's fingerprint, its state and stored response. A command claims its key in its own transaction; a replay gets the stored response, a different body `409 IDEMPOTENCY_KEY_REUSED`, a concurrent duplicate `409 IDEMPOTENCY_IN_PROGRESS`. Entry keys derive from the command's key |
| TA-7 lock mode | `FOR NO KEY UPDATE`, ascending account id. New categories after the activity record: 12 idempotency records, 13 ledgers and accounts, 14 balance projections, 15 journal entries and lines (rev 2: the claim moved first, so a posting command locks its claim, posts, and completes the claim it already holds — revision 1's order would have waited for the claim after the entry's contested insert, against L3) |

## 3. Design

### 3.1 Ledgers and accounts

- A business's ledger and its system accounts are opened when the business is created — by
  `identity.signup_merchant_owner`, through `ledger.open_ledger` (rev 2: not a trigger on `tenancy.merchants`, which
  would collide with the test fixtures' own ledgers) — and for every existing business by the migration. The platform
  ledger is opened by the migration.
- An account has a kind (asset, liability, equity, revenue, expense), a code, a name, a status (active / archived), a
  **non-negative** flag, and optionally a subject (a customer or an agent) for sub-accounts. A sub-account's parent is
  its system account (e.g. customer savings 2100 → one per customer).
- A balance is kept in the account's normal direction: debit-normal for assets and expenses (debits − credits),
  credit-normal for liabilities, equity and revenue (credits − debits). A non-negative account (customer savings,
  loans, cash) can never go below zero: a posting that would make it so is refused (`insufficient_balance`) — BR-7.4
  rests on this.
- Merchant-defined accounts (BR-9.1): any kind, any unused code; never a sub-account; renamed, archived (only at a zero
  balance) and restored, never deleted (`ledger.update_account`, rev 3). The chart's accounts and sub-accounts are the
  system's: never renamed or archived by a business. A posting checks its accounts' status again once it holds their
  projections, which archiving holds too, so a posting never lands on an account archived meanwhile.

### 3.2 The chart, as data

`ledger.chart_template` holds the system accounts of each kind of ledger: code, name, kind, non-negative, and whether it
is per customer or per agent. The business chart is the owner's form's suggested list (Q1); the platform chart: cash at
bank, platform wallet, subscription income, provider charges, capital, retained earnings. An owner's answer changes the
template and the existing ledgers in one forward migration.

### 3.3 Posting

`ledger.post_entry(ledger, idempotency key, entry type, effective date, narrative, source, lines, actor[, reverses])` —
definer, executable by no application role; domain functions call it inside their own transaction. It:

1. returns the existing entry if the key was used in this ledger (with the same lines; otherwise refuses);
2. checks every line: an active account of this ledger, a side, a positive amount; at least two lines; debits equal
   credits (the P1 commit-time check stays as the last line of defence);
3. locks the lines' projections `FOR NO KEY UPDATE` in ascending account id;
4. inserts the entry and its lines, updates each projection by its signed amount, and refuses a non-negative account
   going below zero;
5. records, in the same transaction, a debit to a capital account and a debit to an income account in the activity
   record (the PDF's "Capital/Equity Audit Requirement" and the sheet's "debit income account to audit trail"; owner
   Q4: record both).

It refuses a control account (a chart account whose balance lives in its customers' or agents' sub-accounts): postings go
to the sub-accounts. Nothing is written unless the outcome is `ok`.

**Reversal** (`ledger.post_reversal`; the session command is `ledger.reverse_entry`): a new entry with every line's side
swapped, referencing the original, posted through 3.3; refused for a reversal, for an entry already reversed (the unique
index decides under concurrency), and for an archived account. A correction is a reversal plus a new entry (BR-11.1). By
hand (the endpoint) only a manual entry is reversed: an entry a domain posted is reversed by that domain (P8–P11), so its
own records stay in step (rev 2).

### 3.4 Projections and their check

The projection is updated only by 3.3. `ledger.verify_projections()` (operator) compares every projection with the sum of
its lines and returns the differences; P12 runs it nightly and alerts (§7).

### 3.5 Reports

Definer reads, the business from the session (R19), permission-checked in the database (B1):

- **Chart of accounts** with balances.
- **Account statement**: an account's lines in a period, oldest first, with the opening balance, each line's running
  balance and the closing balance; paginated. A control account's statement covers its sub-accounts' lines, so it
  explains the balance the chart shows for it (rev 3; `ledger.read_statement`, `ledger.statement_balances`).
- **Trial balance** at a date: each account's debit or credit balance; the two columns equal.
- **Balance sheet** at a date: assets = liabilities + equity + the period's profit not yet closed.
- **Profit and loss** for a period: revenue − expenses.

Amounts are kobo strings (ADR-11). Reports are not sensitive reads (no personal data: sub-accounts carry a subject id,
names come with P7).

## 4. Posting templates — the transaction mappings

Each later phase posts by **template**: a named, versioned set of lines that names accounts by code (and subject). P6
defines and tests the templates from the owner's documents, as corrected in the form (Q2; suggested answers applied):

| Template | Debit | Credit | Phase | Source |
|---|---|---|---|---|
| `collection.cash_recorded` | 1210 Cash with agents (agent) | 2190 Collections awaiting confirmation | P8 | §9 step 1 |
| `collection.cash_confirmed` | 1200 Cash at office; 2190 | 1210 (agent); 2100 Customer savings (customer) | P8 | §9 step 3 |
| `collection.live` | 1100 Business wallet | 2100 (customer) | P9 | §9 |
| `fee.first_contribution` | 2100 (customer) | 4100 Collection fees — first contribution | P8 | BR-6.1, Map "Collection commission" (corrected) |
| `fee.percentage` | 2100 (customer) | 4110 Collection commission | P8 | BR-6.1/6.2 |
| `charge.general` | 2100 (customer) | 4400 General charges | P8 | Map "Charges" (corrected), PDF "Transaction Fees" |
| `charge.target_savings` | 2110 (customer) | 4500 Target savings charges | P8 | Map |
| `charge.loan_application` | 2100 (customer) | 4300 Loan application charges | P11 | Map |
| `withdrawal.savings_cash` / `withdrawal.target_cash` | 2100 / 2110 (customer) | 1200 Cash at office | P8 | §9, PDF "Wallet Withdrawal" |
| `withdrawal.savings_to_loan` / `withdrawal.target_to_loan` | 2100 / 2110 (customer) | 1300 Customer loans (customer) | P8 | §9, Map "Move fund … to Loan" (corrected) |
| `savings.to_target` | 2100 (customer) | 2110 (customer) | P8 | |
| `loan.disbursed_cash` | 1300 (customer) | 1200 Cash at office | P11 | §10, Map "Loan disbursed" |
| `loan.disbursed_wallet` | 1300 (customer) | 1100 Business wallet | P11 | §10, PDF "Loan Disbursement" |
| `loan.interest_charged` | 1300 (customer) | 2300 Unearned loan interest | P11 | sheet note "110 = 100 + 10" (Q3) |
| `loan.interest_earned` | 2300 | 4200 Loan interest income | P11 | Q3 |
| `loan.repaid_cash` | 1200 | 1300 (customer) | P11 | Map "Loan repayment" (corrected) |
| `loan.repaid_wallet` | 1100 | 1300 (customer) | P9 | §10 |
| `investment.created` | 2100 (customer) | 2120 Customer investments (customer) | P11 | PDF "Investment Creation" |
| `investment.interest` | 5300 Interest on investments | 2120 (customer) | P11 | PDF "Investment Returns" |
| `investment.withdrawn` | 2120 (customer) | 2100 (customer) | P11 | PDF "Investment Withdrawal" |
| `target_savings.interest` | 5200 Interest on target savings | 2110 (customer) | P8 | Map "Interest on Investment" (corrected to credit the customer) |
| `transfer.sent` / `transfer.paid` | 2100 / 2200 | 2200 / 1000 Cash at bank | later (Q5) | PDF "Remittance" |
| `subscription.paid` | 5100 Platform subscription | 1100 Business wallet | P10 | §11 |
| `directors.funding` | 1000 Cash at bank | 2400 Directors' current account | any | sheet "load wallet" (Q6) |
| `wallet.loaded` | 1100 Business wallet | 1000 Cash at bank | P9 | Map "Load Wallet" |

Templates live in `ledger.posting_templates` (code, **version**, ledger kind, description, lines as chart codes with side
and subject, status). A template is versioned (rev 3): a version never changes once written (a trigger refuses any
change but retirement, and any deletion); a new mapping is a new version and the old one is retired; at most one version
of a code is active. Every entry posted by a template records the version it was posted with
(`journal_entries.template_version`, a foreign key to the version), so an entry can always be read against the
mapping that produced it. A template has one choice per row (rev 2: `withdrawal.*` and `investment.interest` no longer leave the
account to the caller) and every line takes the posting's one amount. `ledger.post_template(ledger, template, amount,
subjects, …)` resolves the accounts — a subject's sub-account must already be open (`ledger.open_subaccount`) — and
calls 3.3. The platform's template, `platform.subscription_received`, posts to the platform ledger. P6 tests every
template balances and moves the accounts named.

## 5. Interfaces

| Endpoint | Permission | |
|---|---|---|
| `GET /v1/merchant/ledger/accounts` | `merchant.ledger.read` | the chart with balances |
| `POST /v1/merchant/ledger/accounts` | `merchant.ledger.manage` | a merchant-defined account (BR-9.1) |
| `PATCH /v1/merchant/ledger/accounts/{accountId}` | `merchant.ledger.manage` | rename, archive or restore one (rev 3) |
| `GET /v1/merchant/ledger/accounts/{accountId}/statement` | `merchant.ledger.read` | period, cursor |
| `GET /v1/merchant/ledger/entries/{entryId}` | `merchant.ledger.read` | an entry and its lines |
| `POST /v1/merchant/ledger/entries` | `merchant.ledger.post` | a manual journal entry; `Idempotency-Key` |
| `POST /v1/merchant/ledger/entries/{entryId}/reversal` | `merchant.ledger.post` | `Idempotency-Key` |
| `GET /v1/merchant/reports/trial-balance` | `merchant.ledger.read` | `asOf` |
| `GET /v1/merchant/reports/balance-sheet` | `merchant.ledger.read` | `asOf` |
| `GET /v1/merchant/reports/profit-and-loss` | `merchant.ledger.read` | `from`, `to` |

Activity events (atomic, pattern A): `ledger.account_created`, `ledger.account_updated` (rev 3), `ledger.manual_entry_posted`, `ledger.entry_reversed`,
`ledger.capital_debited`, `ledger.income_debited`; refusals best effort (`denied`).

The two posting endpoints answer `201 { entryId }` — the same answer to a retry — and the entry is read with
`GET …/entries/{entryId}` (rev 2: a session may hold `merchant.ledger.post` without `merchant.ledger.read`, so a posting's
answer never depends on reading the books). Errors: `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS`,
`ALREADY_REVERSED` (409); `UNBALANCED_ENTRY`, `INSUFFICIENT_BALANCE`, `ACCOUNT_NOT_POSTABLE`, `NOT_REVERSIBLE` (422);
`CODE_TAKEN` (409) for an account. Balances that may be negative are `SignedMoney` (a new primitive). The reports are
computed in the API from one read, `ledger.account_movements` (each account's debits and credits in a period,
sub-accounts rolled into their control account). Request headers are now validated from the contract (the
`Idempotency-Key`).

## 6. Tests

- **Properties** (randomized, many runs): every posted entry balances; every projection equals the sum of its lines after
  any sequence of postings and reversals; a reversal nets the original to zero; the trial balance's columns are equal and
  the balance sheet balances at every point.
- **TA-4:** an entry is reversed at most once, under concurrency (two connections, staged); a reversal is never reversed.
- **TA-3:** the app cannot insert entries, lines, accounts or projections, nor update a projection.
- **TA-5:** two concurrent openings of one customer's sub-account give one account.
- **TA-6:** replay, a different body, a concurrent duplicate.
- **BR-11.1:** a correction is a reversal plus a new entry; both stay visible; nothing is updated or deleted.
- Non-negative accounts refuse to go below zero; idempotent posting; the platform ledger invisible to the app; every
  template balances; the lock-order guard classifies every new function; the authorization matrix covers every endpoint.

## 7. Obligations passed on

P12: run `ledger.verify_projections()` nightly and alert on a difference. P8–P11: post only through templates. P10: the
platform ledger's subscription income. OPEN-12 (before P8b): the custody ledger.

## 8. Decisions (recommended options, the project lead's standing instruction)

| # | Decision | Taken |
|---|---|---|
| P6-1 | Branch base | from the P5 tip; rebase after PR #7 merges |
| P6-2 | Sub-account creation | its own idempotent function, before posting (avoids a lock after a contested insert, L3) |
| P6-3 | Permissions | `merchant.ledger.read`, `merchant.ledger.manage`, `merchant.ledger.post` — all grantable by the owner; every manual entry and reversal recorded |
| P6-4 | Account codes before the owner answers | the form's suggested list, as data |
| P6-5 | Gate | one review of P6 by the independent reviewer at the end |
| P6-6 | Lock categories (rev 2) | the idempotency claim first (12), then ledgers and accounts (13), projections (14), entries and lines (15) — §2 TA-7 |
| P6-7 | Ledger opening (rev 2) | in the signup function and the migration, not a trigger |
| P6-8 | Posting answers (rev 2) | `{ entryId }`, the same for a retry; read the entry with GET |
| P6-9 | Reversal by hand (rev 2) | manual entries only; a domain reverses its own entries |
| P6-10 | Stale claims (rev 2) | a claim in progress for two minutes is taken over by the same request (a command that died); another request is refused |
| P6-12 | Template versions (rev 3) | a version is fixed once written; a new mapping is a new version; one active per code; entries record theirs |
| P6-13 | Statement of a control account (rev 3) | covers its sub-accounts' lines; opening and closing balances with every page |
| P6-14 | Archiving (rev 3) | a business's own accounts only, at a zero balance; postings re-check status under their locks |
| P6-11 | Customer subjects (rev 2) | a customer sub-account's subject is not checked until customers exist (P7); an agent's is an agent membership of the business |

## 9. Revision log

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-10-23 | First plan, written and built in one pass |
| 3 | 2026-10-25 | The gate review's findings resolved (§11): versioned templates (§4, P6-12), the statement's opening and closing balances and a control account's sub-accounts (§3.5, P6-13); and, from the self-review that followed, archiving merchant accounts (§3.1, P6-14), the property tests strengthened to five runs checked after every operation (§6), the account answers taken from the database. Migration `20261025000100_ledger_review` |
| 2 | 2026-10-24 | The owner's answers to both P6 forms recorded; built as §10 says. Changed from revision 1: the lock categories (P6-6), ledger opening (P6-7), the split templates (§4), the posting answers and error codes (§5, P6-8), reversal by hand (P6-9), stale claims (P6-10), customer subjects (P6-11) |

## 10. What was built

| Part | Where |
|---|---|
| Migration 1: ownership (TA-1), accounts' status and non-negative rule, TA-4/TA-5 indexes, the chart and the templates as data, `ledger.open_ledger`, signup opens the ledger, the app's ledger privileges removed (TA-3) | `packages/db/prisma/migrations/20261023000100_ledger_core` |
| Migration 2: `util.idempotency_records` with claim and release (TA-6), `ledger.lock_projections`, `post_entry`, `post_reversal`, `open_subaccount`, `post_template`, `verify_projections`, the debit events | `…/20261023000200_ledger_posting` |
| Migration 3: the three permissions, `create_account`, `post_manual_entry`, `reverse_entry`, the five B1 reads, the command events | `…/20261023000300_ledger_commands_and_reads` |
| Database tests: the chart, sub-accounts, every posting rule, reversal, every template, 120 random postings and reversals against the §6 properties, idempotency, the commands, permissions and reads; the debit events' coverage pair | `packages/db/test/ledger.test.ts` |
| Races, 50 staged runs each: TA-4, TA-5, TA-6, the non-negative rule | `packages/db/test/ledger-races.test.ts` (in `test:concurrency`) |
| Guards: lock categories 12–15 and every new function classified with its footprint; the grants inventory; R19; the contested keys; RLS lists | `packages/db/test/support/lock-*.ts` and the guard tests |
| Contracts: nine endpoints, `SignedMoney`, the Idempotency-Key's characters, the three permissions | `packages/contracts/src/endpoints/ledger.ts` |
| API: the ledger module (repository, service, routes), the idempotency store, header validation, the catalog mirror, refusal wording | `apps/api/src/modules/ledger/`, `apps/api/src/platform/idempotency.ts` |
| API tests: the endpoints; the authorization, policy and isolation matrices and the activity-record guards cover them | `apps/api/test/ledger/ledger-api.test.ts` and the matrices |
| Migration 4 (rev 3): versioned templates and the entries' version, the statement over sub-accounts with its balances, archiving, the status re-check under the locks | `…/20261025000100_ledger_review` |

Passed on: P12 runs `ledger.verify_projections()` nightly and alerts (§7); idempotency records need a retention rule then
too (completed records are kept until it exists).

## 11. The gate review (2026-10-25) and its resolution

The independent reviewer found P6 not ready to close, on two findings; both are resolved in revision 3. The project
lead then asked for a self-review against this plan until it finds nothing more; what it found is resolved too.

| # | Finding | Resolution |
|---|---|---|
| R1 | The account statement had no opening or closing balance, and a control account's statement left out the sub-accounts behind its balance (§3.5) | `ledger.read_statement` covers the account and its sub-accounts (each line names its account); `ledger.statement_balances` gives the period's opening and closing balances, on every page (`openingBalance`, `closingBalance`) |
| R2 | Posting templates were not versioned (§4) | `posting_templates` keyed by (code, version), one active per code, a version fixed by trigger; entries record their version (foreign key); the entry read shows it (`templateVersion`) |
| S1 (self-review) | §3.1's merchant accounts "archived, never deleted" had no way to archive | `ledger.update_account` and `PATCH …/accounts/{accountId}`: rename, archive at a zero balance, restore; the chart's accounts refused; `ledger.account_updated` recorded |
| S2 (self-review) | With archiving, a posting checked account status before taking its locks | `ledger.post_entry` checks again under the projection locks, which archiving also takes; a staged race (50 runs) shows the posting refused and the account empty |
| S3 (self-review) | §6 asks for property tests over "many runs", the reports balancing "at every point"; there was one run, checked at its end | five seeded runs of 80 operations; the trial balance and the balance sheet checked after every operation, every reversal checked to net its original to zero |
| S4 (self-review) | For a session that may add accounts but not read the books, the new account's answer invented its creation time | `ledger.create_account` returns it; `ledger.update_account` returns the account |
| S5 (self-review) | The test that every pre-P6 business got its ledger depended on test order, and never exercised the backfill (the fixtures bring their own ledgers) | replaced by two tests: only `identity.signup_merchant_owner` creates a business, and it opens the ledger; the migration's backfill statement, run on a business without a ledger, opens its 23 accounts |
