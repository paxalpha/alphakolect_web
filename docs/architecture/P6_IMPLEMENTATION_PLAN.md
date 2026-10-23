# P6 implementation plan — the ledger

**Status: revision 1 (2026-10-23) — building.** Planned and built in one pass at the project lead's request ("map
everything out and implement it in one go"; "efficiency and speed of delivery is very important"). Decisions that would go
to the project lead take the recommended option (his standing instruction) and are recorded in §8. The owner's answers on
the accounts and mappings are asked in `docs/business/P6_OWNER_ACCOUNTS_AND_MAPPINGS.md`; until they arrive, the system
accounts follow that form's suggested answers, held as data (§3.2), so an answer is a small forward migration, not a
redesign. The gate review is the independent reviewer's.

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
| TA-7 lock mode | `FOR NO KEY UPDATE`, ascending account id. New categories after the activity record: 12 ledger accounts, 13 balance projections, 14 journal entries, 15 idempotency records |

## 3. Design

### 3.1 Ledgers and accounts

- A business's ledger and its system accounts are opened when the business is created (a trigger on
  `tenancy.merchants`), and for every existing business by the migration. The platform ledger is opened by the migration.
- An account has a kind (asset, liability, equity, revenue, expense), a code, a name, a status (active / archived), a
  **non-negative** flag, and optionally a subject (a customer or an agent) for sub-accounts. A sub-account's parent is
  its system account (e.g. customer savings 2100 → one per customer).
- A balance is kept in the account's normal direction: debit-normal for assets and expenses (debits − credits),
  credit-normal for liabilities, equity and revenue (credits − debits). A non-negative account (customer savings,
  loans, cash) can never go below zero: a posting that would make it so is refused (`insufficient_balance`) — BR-7.4
  rests on this.
- Merchant-defined accounts (BR-9.1): any kind, any unused code; never a sub-account; archived, never deleted.

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
   Q4, the suggested answer applied until answered).

**Reversal** (`ledger.reverse_entry`): a new entry with every line's side swapped, referencing the original, posted
through 3.3; refused for a reversal, for an entry already reversed (the unique index decides under concurrency), and for a
closed account. A correction is a reversal plus a new entry (BR-11.1).

### 3.4 Projections and their check

The projection is updated only by 3.3. `ledger.verify_projections()` (operator) compares every projection with the sum of
its lines and returns the differences; P12 runs it nightly and alerts (§7).

### 3.5 Reports

Definer reads, the business from the session (R19), permission-checked in the database (B1):

- **Chart of accounts** with balances.
- **Account statement**: an account's lines in a period, oldest first, with the opening balance, each line's running
  balance and the closing balance; paginated.
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
| `withdrawal.cash` | 2100 or 2110 (customer) | 1200 Cash at office | P8 | §9, PDF "Wallet Withdrawal" |
| `withdrawal.to_loan` | 2100 or 2110 (customer) | 1300 Customer loans (customer) | P8 | §9, Map "Move fund … to Loan" (corrected) |
| `savings.to_target` | 2100 (customer) | 2110 (customer) | P8 | |
| `loan.disbursed_cash` | 1300 (customer) | 1200 Cash at office | P11 | §10, Map "Loan disbursed" |
| `loan.disbursed_wallet` | 1300 (customer) | 1100 Business wallet | P11 | §10, PDF "Loan Disbursement" |
| `loan.interest_charged` | 1300 (customer) | 2300 Unearned loan interest | P11 | sheet note "110 = 100 + 10" (Q3) |
| `loan.interest_earned` | 2300 | 4200 Loan interest income | P11 | Q3 |
| `loan.repaid_cash` | 1200 | 1300 (customer) | P11 | Map "Loan repayment" (corrected) |
| `loan.repaid_wallet` | 1100 | 1300 (customer) | P9 | §10 |
| `investment.created` | 2100 (customer) | 2120 Customer investments (customer) | P11 | PDF "Investment Creation" |
| `investment.interest` | 5300 Interest on investments | 2120 or 2100 (customer) | P11 | PDF "Investment Returns" |
| `investment.withdrawn` | 2120 (customer) | 2100 (customer) | P11 | PDF "Investment Withdrawal" |
| `target_savings.interest` | 5200 Interest on target savings | 2110 (customer) | P8 | Map "Interest on Investment" (corrected to credit the customer) |
| `transfer.sent` / `transfer.paid` | 2100 / 2200 | 2200 / 1000 Cash at bank | later (Q5) | PDF "Remittance" |
| `subscription.paid` | 5100 Platform subscription | 1100 Business wallet | P10 | §11 |
| `directors.funding` | 1000 Cash at bank | 2400 Directors' current account | any | sheet "load wallet" (Q6) |
| `wallet.loaded` | 1100 Business wallet | 1000 Cash at bank | P9 | Map "Load Wallet" |

Templates live in `ledger.posting_templates` (code, version, lines as account codes with side and amount role, active);
`ledger.post_template(ledger, template, amounts, subjects, …)` resolves accounts and calls 3.3. P6 tests every template
balances and moves the accounts named.

## 5. Interfaces

| Endpoint | Permission | |
|---|---|---|
| `GET /v1/merchant/ledger/accounts` | `merchant.ledger.read` | the chart with balances |
| `POST /v1/merchant/ledger/accounts` | `merchant.ledger.manage` | a merchant-defined account (BR-9.1) |
| `GET /v1/merchant/ledger/accounts/{accountId}/statement` | `merchant.ledger.read` | period, cursor |
| `GET /v1/merchant/ledger/entries/{entryId}` | `merchant.ledger.read` | an entry and its lines |
| `POST /v1/merchant/ledger/entries` | `merchant.ledger.post` | a manual journal entry; `Idempotency-Key` |
| `POST /v1/merchant/ledger/entries/{entryId}/reversal` | `merchant.ledger.post` | `Idempotency-Key` |
| `GET /v1/merchant/reports/trial-balance` | `merchant.ledger.read` | `asOf` |
| `GET /v1/merchant/reports/balance-sheet` | `merchant.ledger.read` | `asOf` |
| `GET /v1/merchant/reports/profit-and-loss` | `merchant.ledger.read` | `from`, `to` |

Activity events (atomic, pattern A): `ledger.account_created`, `ledger.manual_entry_posted`, `ledger.entry_reversed`,
`ledger.capital_debited`, `ledger.income_debited`; refusals best effort (`denied`).

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

## 9. Revision log

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-10-23 | First plan, written and built in one pass |
