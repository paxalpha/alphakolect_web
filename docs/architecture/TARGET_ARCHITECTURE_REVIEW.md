# Target architecture — critic review

**Date:** 2026-10-12 · **Reviewed:** `docs/architecture/TARGET_ARCHITECTURE.md` at `d716d34`, §0–§30. ADR-16 (§3.5) is
excluded because it has its own approval.
**Checked against:**
- the migrations in `packages/db/prisma/migrations/` and the API in `apps/api/src/`;
- the lint and CI configuration;
- `docs/business/BUSINESS_RULES.md`;
- an external design review received on 2026-10-12. That review states it did not inspect the repository.

**For:** the project lead and the independent reviewer.
**Changes:** no code and no other document. Every recommendation here needs the project lead's decision, and the owner's
where marked, before it enters the target architecture.

## Verdict

**Keep the architecture.**
- P0–P4 were built on it, and what they built is sound. In several places it is tighter than the document.

**The document is out of date.**
- Its status line still reads "Draft v1 · 2026-09-26".
- §3.1–§20 were written before ADR-14, ADR-15, ADR-16 and the owner's D9 decision.
- In nine places the text now contradicts what is built or decided. A later phase that follows the text would undo a
  decision.

**The money design (§5–§12) has gaps.**
- Eight findings must be settled before the phase that builds them.
- Three of them are in the P1 schema, which the external review could not see:
  - the ledger table has no room for a platform ledger;
  - an entry can be reversed twice;
  - a customer can get two Collection wallets.

**Effect on P5:**
- None of the findings reopens P5 Part 1.
- One note affects the name of P5.1's first migration (TA-26).

Each finding gives:
- what the document **says**;
- what the repository **shows**;
- why it **matters**;
- the **recommendation**;
- **settle by** — the last point the decision can wait until.

## A. Money design

### TA-1. The ledger table cannot hold the platform ledger

- **Says:** §7 describes one ledger per merchant, plus one platform ledger and one custody ledger. §11 posts subscription
  income to the platform ledger.
- **Shows:**
  - `ledger.ledgers.merchant_id` is `NOT NULL`, references `tenancy.merchants`, and is unique
    (`20260927000100_baseline/migration.sql:61-68, 151`).
  - Every other ledger table also has `merchant_id NOT NULL` and the merchant foreign key.
  - Row-level security filters all of them on `app.merchant_id`.
  - So a ledger without a merchant cannot exist.
- **Matters:**
  - P10 (billing) has nowhere to post the platform's side of a subscription charge.
  - The obvious workaround is a fake "AlphaKolect" merchant row. That row would then appear in merchant lists, in the
    tenant-isolation matrix and in billing.
- **Recommend:**
  - P6 gives each ledger an owner kind: `merchant` or `platform`. `merchant_id` is required exactly when the owner kind
    is `merchant`.
  - Platform finance reaches the platform ledger through database functions, not through any exception to row-level
    security.
  - The custody ledger is decided under TA-2.
- **Settle by:** P6 design.

### TA-2. The custody ledger and merchant account 1100 would count the same naira twice

- **Says:** §7 describes a custody ledger "mirroring Live-wallet money held at the provider". Merchant account 1100 is
  "real money at provider". OPEN-12 decides whether the custody ledger is informational or authoritative.
- **Matters:**
  - The same provider balance would appear in two sets of books.
  - Reports that add the books together would double-count it.
  - Reconciliation would have two targets that can disagree.
- **Recommend:**
  - P6 builds the merchant and platform ledgers only.
  - Reconciliation compares each Live wallet's account (1100 for a merchant virtual account, and the platform
    equivalent) directly with the provider's balance.
  - The custody ledger is decided together with OPEN-12, before P8b.
  - P9's design writes out the journal traces the external review asks for (its §4.3). Each trace gives the accounts
    debited and credited, the ledger, the provider reference and the reconciliation rule. The traces:
    - customer virtual account → merchant virtual account;
    - merchant virtual account → platform virtual account (subscription);
    - a loan paid out to a customer's virtual account;
    - a provider transaction we have no record of.
- **Settle by:**
  - P9 design for the merchant and platform traces.
  - OPEN-12 for customer wallets. The release blocker in §8 stays as it is.

### TA-3. The application can write any balance directly

- **Says:**
  - §1.3: "balances are computed, never written by business code".
  - §6: projections are "updated in the same transaction".
  - §7: a nightly job checks that each projection equals the sum of its lines.
- **Shows:**
  - P1 grants `alphakolect_app` `INSERT` on `journal_entries` and `journal_lines`, and
    `UPDATE (balance_minor, version)` on `balance_projection` (`20260927000200_privileges/migration.sql:27-33`).
  - The deferred trigger proves that each entry balances (`20260927000300_ledger_invariants/migration.sql:47-112`).
  - Nothing ties a projection update to a posted line.
- **Matters:**
  - Withdrawal limits (BR-7.4) and overdraft checks read the projection.
  - One wrong `UPDATE` changes what a customer can withdraw. It could come from a bug or from any code that holds the
    app role.
  - The nightly check finds the problem up to a day later.
  - P3–P5 closed this same kind of gap for identity and tenancy by moving writes into database functions.
- **Recommend:**
  - Posting goes through one database function. That function:
    - inserts the entries and their lines;
    - updates the projections in lock order;
    - applies each account's non-negative rule;
    - returns the existing entries when a request is replayed.
  - The app loses direct `INSERT` on the journal tables and `UPDATE` on the projection.
  - A trigger on `journal_lines` that maintains the projection would be simpler. But it would take row locks inside a
    trigger, and ADR-16's lock model says triggers lock nothing.
- **Settle by:** P6 design.

### TA-4. An entry can be reversed twice

- **Shows:**
  - `journal_entries.reverses_entry_id` has a composite foreign key (`baseline/migration.sql:205`) but no uniqueness.
  - Nothing checks that a reversal mirrors the entry it reverses.
- **Matters:**
  - Two concurrent reversals of the same collection would both commit, refunding the customer twice in the books.
  - P6's exit criterion "reversal nets to zero" does not catch this.
- **Recommend:**
  - Add a partial unique index on `(merchant_id, reverses_entry_id)`.
  - The posting function checks the mirror: same ledger, same accounts and amounts, sides swapped.
  - The posting function refuses to reverse a reversal. A correction is a reversal plus a new entry (§7).
  - Add "an entry is reversed at most once, under concurrency" to P6's exit criteria.
- **Settle by:** P6.

### TA-5. A customer can end up with two Collection wallets

- **Shows:** the index on `ledger.accounts (ledger_id, code)` is not unique (`baseline/migration.sql:157`). No uniqueness
  covers an account's code together with its subject.
- **Matters:**
  - A customer's sub-account (§7, §8) is created the first time it is used.
  - If two first collections arrive at once, they create two 2100 accounts for the same customer.
  - The balance splits between them, and a withdrawal sees only half.
- **Recommend:**
  - Add a unique constraint on `(ledger_id, code, subject_type, subject_id) NULLS NOT DISTINCT`. This needs
    PostgreSQL 15 or later; we run 16.
  - Create a missing account inside the posting function, or return the existing one.
- **Settle by:** P6.

### TA-6. Command idempotency is underspecified

- **Says:**
  - §6: every money command carries an `idempotency_key` "with a unique constraint; replays return the original
    result".
  - §17: an `Idempotency-Key` header is required on money POSTs.
- **Shows:**
  - The only durable key is the unique `(merchant_id, idempotency_key)` on `journal_entries`.
  - One command posts several entries; §6's own remittance example does. So a client's key cannot be an entry's key.
  - Nothing stores "the original result".
- **Recommend:** one idempotency record per command. It belongs to a shared platform component, not to a domain module.
  - **Scope:** merchant, actor, operation and key.
  - **Request fingerprint:** the same key with a different body is answered `409`.
  - **Claiming the key:** the first request claims it in its own transaction. A concurrent duplicate then waits or gets
    `409`; it is never run a second time.
  - **Stored result:** the response is stored, with a retention period.
  - **Entry keys:** derived from the command's key.
  - Provider idempotency is a separate matter (TA-8).
- **Settle by:** P6 for the contract; first used in P8.

### TA-7. §6 prescribes the lock mode that ADR-16 forbids

- **Says:** §6 locks the balance projections with "`SELECT … FOR UPDATE`, in a fixed lock order".
- **Shows:**
  - ADR-16's lock model (`TARGET_ARCHITECTURE.md:342`) forbids `FOR UPDATE` everywhere.
  - The P5.5 lock-order checker fails on it.
  - ADR-16's global category order has no category for ledger, savings or payment rows.
- **Recommend:**
  - Change §6 to `FOR NO KEY UPDATE`, taken in ascending account id order.
  - P6 adds the new row kinds to the global category order and extends the checker to match.
- **Settle by:** the text now; the categories in P6.

### TA-8. A provider timeout is treated as a failure

- **Says:** §6: "Failures/timeouts are retried or marked failed".
- **Matters:**
  - A timeout means the outcome is unknown.
  - Retrying can send the money twice.
  - Marking the transfer failed can strand money the provider did move.
- **Recommend:** a payment-order state machine with an explicit `unknown` state.
  - **Resolving `unknown`:** query the provider by our reference (`getTransaction`). Resubmit only if TransactPay
    guarantees idempotency on our reference.
  - **Posting:** the ledger posts once, keyed by `(provider, provider_tx_id)`; §12 already has this key. If the
    provider confirms and our posting fails, the posting is retried from the stored event.
  - **Unusual events:** define what happens with late, duplicate, out-of-order and contradictory events.
  - **Reversals:** a reversal or refund at the provider is a new provider transaction with its own posting. A ledger
    reversal never moves real money.
  - **Webhooks:**
    - acknowledge only after the raw event is durably stored;
    - limit request size and rate;
    - verify signatures if TransactPay offers them. This is in addition to confirming through the API, not instead of
      it.
- **Questions for TransactPay before P9:**
  - Are transfers and virtual-account creation idempotent?
  - How do we query a transaction by our own reference?
  - What does a timeout mean on their side?
  - Are webhooks signed?
  - How do reversals and refunds behave?
- **Settle by:** P9 design.

## B. Structure

### TA-9. The cross-module transaction rule is already broken, rightly

- **Says:** §5: "Cross-module writes inside one money operation go through the ledger service within the same DB
  transaction (the only sanctioned cross-module transaction)."
- **Shows:**
  - Tenancy services write their audit rows inside their own transaction through `AuditLog.recordWithin(tx, …)`:
    `apps/api/src/modules/tenancy/memberships.ts:112`, `invitations.ts:94` and `merchant-settings.ts:79`.
  - ADR-16 adds `mutateAudited` for identity flows (its pattern B).
  - Both are correct, and §5 forbids both.
- **Recommend:** replace the sentence with a transaction contract.
  - A use case opens one transaction and passes the handle to each module service it calls.
  - Each module writes only its own tables, and only through its own service or database functions.
  - Audit and outbox writes join the transaction.
  - No network call is made while the transaction is open.
  - The dependency rules (TA-10) say which module may call which.
- This matches the external review's §2.
- **Settle by:** the text now; P6 is the first money use.

### TA-10. Modules already depend on each other in a cycle, and nothing enforces the boundaries

- **Says:**
  - The §5 table, and its rule that other modules "never import its repositories".
  - OPEN-19: module boundaries are "enforced by folder convention + lint (import rules)".
- **Shows:**
  - The only import rule, in `packages/config/eslint.config.js:25-26`, forbids importing the legacy app. Nothing
    restricts imports between modules.
  - **identity → tenancy:** `apps/api/src/modules/identity/agent-routes.ts:12` uses tenancy's
    `MerchantSettingsService`.
  - **tenancy → identity:** `tenancy/invitations.ts:7-12` imports identity's repository type and its password, token,
    email and rate-limit helpers.
  - §5 lists tenancy as depending on identity, not the reverse. So the code has a cycle, and a repository import.
  - The §5 table itself has two more cycles (external review §3): customers ↔ savings and tenancy ↔ billing.
- **Recommend:**
  - Each module exposes one public entry file.
  - Lint forbids importing another module's internals and enforces the direction of dependencies. Run it first in
    report mode, listing today's violations, then switch it to enforcing. This is the same method as the lock-order
    checker.
  - Break the cycles:
    - savings depends on customers, not the reverse (enrolment belongs to savings);
    - billing exposes a narrow entitlement check that the request pipeline uses, not tenancy;
    - identity offers its credential helpers (password check, tokens, emails) through its public entry file;
    - route wiring that needs both identity and tenancy moves to the composition root.
- **Settle by:** before P6 starts, as its own small step. It is outside the approved P5 scope.

### TA-11. Background jobs have no tenant scope and no owner

- **Shows:**
  - P1 creates a `jobs` schema (`baseline/migration.sql:22`) that §5 assigns to no module.
  - pg-boss uses its own schema unless it is configured otherwise.
- **Recommend:**
  - `jobs` belongs to the infrastructure, and pg-boss is configured to use it.
  - The worker connects as `alphakolect_app`, so row-level security applies. It never connects as the migrator.
  - A job for one merchant carries `merchant_id` and runs in a transaction with `app.merchant_id` set.
  - Jobs that cover every merchant, such as the billing run and the reconciler, list the merchants through a narrow
    database function. They then process each merchant in its own transaction.
  - The tenant-isolation matrix gains a job case.
- **Settle by:** the first worker (P9).

### TA-12. Billing restore and suspension need failure rules

- **Says:**
  - §11: "an inbound deposit to a suspended merchant's VA triggers a charge attempt; on success state → active".
  - §4 places a separate subscription gate before authorization.
- **Recommend:**
  - Restore access only on a confirmed charge, which is a durable, verified billing state. Never restore on a deposit
    notice alone.
  - A charge in the `unknown` state (TA-8) keeps the merchant suspended until it is resolved.
  - Requests that have already passed the gate complete. The next request sees the new state. Say so in the text.
  - Each endpoint declares in the route registry what it does while the merchant is suspended. An endpoint with no
    declaration is blocked. This is the fail-closed rule ADR-16 applies to authorization, not a separate middleware
    with its own exception list.
  - "Email verified, virtual account pending" is a valid state (BR-2.3), and the screens show it as such.
  - **Owner question at P10:** if there are several unpaid invoices, which must be paid before access returns?
- **Settle by:** P10 design.

### TA-13. Remittances can race

- **Matters:** two remittances could include the same recorded collection. This is the external review's §9 point.
- **Recommend:**
  - Each collection may appear in only one remittance; a unique constraint enforces this.
  - Approval locks the collections with `FOR NO KEY UPDATE`, in ascending id order.
  - Approval checks the `recorded` status inside the same transaction.
  - A concurrency test proves it.
  - P8's exit criterion "no double credit possible" states the outcome. The design should state the mechanism.
- **Settle by:** P8.

### TA-14. Audit retention and anonymisation (§16) contradict D9 and P1

- **Says:** §16: "Retained indefinitely (BR-11.2). Customer anonymisation (BR-11.3) replaces PII in `customers` and
  audit summaries with a tombstone."
- **Shows:**
  1. **Owner decision D9** (2026-10-11 and 12, recorded in ADR-16's decision log) deletes every activity entry after
     two years. This is P5 Part 2.
  2. **P1 trigger:** `audit_events_immutable` rejects `UPDATE` (`ledger_invariants/migration.sql:142-147`). A tombstone
     rewrite is impossible by design.
  3. **Signed business rules:** `BUSINESS_RULES.md:117` (BR-11.2) still says "Nothing is deleted automatically". The
     signed rules do not record D9.
- **Recommend:**
  - §16 points to ADR-16 §3.5 (Audit) and to Part 2.
  - Add a rule: audit summaries carry identifiers, never a customer's personal details (names, phone numbers,
    addresses).
    - Then BR-11.3 anonymisation needs no change to the audit record.
    - ADR-16's per-event allowlists can enforce the rule.
    - The customer events that P7 adds follow it.
  - Add a dated note to BR-11.2 recording D9: money records are kept indefinitely; the activity record is kept two
    years. The note edits the owner's signed rules, so **the owner sees it**.
- **Settle by:** the text now; the summary rule before P7.

### TA-15. Recovery has no targets

- **Says:** §19 promises point-in-time recovery and a monthly restore test. It sets no recovery targets.
- **Recommend:**
  - The owner sets the targets. Question C2 now asks him in `docs/business/P5_OWNER_ADR16_FOLLOWUP.md`.
  - Backups are encrypted, and access to them is restricted.
  - A restore test includes the ledger projection check.
  - After any restore, provider reconciliation runs. Restoring the database rolls back our books, but not the
    provider's. The reconciler must therefore look back further than the data-loss window and re-ingest what the
    restore lost.
- **Settle by:** P15. The backup obligation is already passed from P5.

## C. Text that contradicts decisions

These fix the text only; nothing built changes.

| # | Where | Says | Should say |
|---|---|---|---|
| TA-16 | Header (line 3); "Next artifact" | "Draft v1 · 2026-09-26 · branch `recovery/alphaweb-takeover`"; the restructuring map is "the next artifact" | A living document with ADR-1 to ADR-16 in force. §4–§20 are target designs for phases not yet built, and an ADR overrides them where the two conflict. `RESTRUCTURING_MAP.md` exists. |
| TA-17 | §3.1 (line 100) | The platform staff roles support, verification and finance give access | Grants per person; a label gives no access (ADR-16; the owner's A3 note is being confirmed in the follow-up form) |
| TA-18 | §3.2 (line 110) | Membership is re-resolved "from DB/cache" | Resolved from the database on every request, never cached (ADR-16) |
| TA-19 | §5, the tenancy row | Tenancy owns "permissions" | Tenancy owns the catalog and merchant role permissions. Platform staff grants hang on platform memberships, which identity owns (ADR-16). |
| TA-20 | §5, the rule (line 533) | The ledger service is "the only sanctioned cross-module transaction" | The transaction contract in TA-9 |
| TA-21 | §6 (line 554) | `FOR UPDATE` | `FOR NO KEY UPDATE` (TA-7) |
| TA-22 | §16 | Kept indefinitely; summaries rewritten | TA-14 |
| TA-23 | §18 (lines 696, 698) | Permissions from `/v1/merchant/me`; dates "in the merchant's timezone (OPEN-15)" | `GET /v1/merchant/membership` (`packages/contracts/src/endpoints/merchant.ts:111`), which gains `permissions` in ADR-16; dates in WAT (ADR-11; OPEN-15 is decided) |
| TA-24 | §19 (line 705) | Roles `app`, `migrator`, `readonly` ("reporting/support") | `alphakolect_app` (`NOBYPASSRLS`, never a table owner), `alphakolect_migrator`, and `alphakolect_readonly`, which loses the audit `ip` and `user_agent` columns (ADR-16) |
| TA-25 | §4 (line 500) | A separate subscription gate before `authorize` | Suspension behaviour declared per endpoint in the registry (TA-12, P10) |

## D. One note for P5 now

**TA-26. Migration names.**
- `20261013000100_audience_checked_refresh` was committed on 2026-10-10 with a name dated three days ahead (see
  `git log`).
- Migrations are applied in name order. A P5.1 migration named with today's date (`20261012…`) would therefore run
  **before** it on a fresh database but **after** it on the existing local one. That gives two different histories.
- P5.1's first migration must sort after `20261013000100`.

## E. Smaller notes for the phase designs

- **P6:**
  - State the sign of the projection: the balance is kept in the account's normal direction, so "cannot exceed the
    balance" is one comparison for every customer liability account.
  - `effective_date` is the calendar date in WAT (ADR-11), not the database server's date.
- **P12:** outbox retries, poison messages, retention and alerts.
- **P15:** inventory the legacy deployment and the provider's state before cutover, including the virtual accounts in
  OPEN-14.
- **Contracts:** a deprecation policy for the mobile apps, written with the first published mobile contract (OPEN-16).

## F. The external review, point by point

| External review point | Status | Evidence or finding |
|---|---|---|
| §2 transaction boundaries; a use-case orchestrator | Agreed | TA-9. The pattern is already in the code (`recordWithin`). |
| §3 cycles customers ↔ savings and tenancy ↔ billing | Agreed, plus a third already in the code | TA-10 (identity ↔ tenancy) |
| §3 who owns roles and permissions across scopes | Decided | ADR-16: merchant roles in tenancy, platform grants per person; §5's text is stale (TA-19) |
| §4.1 entries balance per ledger and currency; at least two lines; positive amounts; one side per line; no update or delete; a deferred trigger | **In place since P1** | `ledger_invariants/migration.sql:30-32` (side, amount > 0, NGN); `:47-112` (deferred trigger: two or more lines, balanced, one ledger and one currency); `:128-147` (no `UPDATE`, `DELETE` or `TRUNCATE`); the app role has no `UPDATE` or `DELETE` (`privileges/migration.sql:27-28`). There are no draft entries; keep it that way. |
| §4.1 only a controlled posting operation can post | Agreed; **not** in place | TA-3 |
| §4.2 projections locked and updated in the same transaction, with a lock order | Agreed | TA-3, TA-7; plus the gaps it did not see, TA-4 and TA-5 |
| §4.3 custody ledger vs 1100; the four journal traces | Agreed | TA-1, TA-2 |
| §4.4 idempotency scope, fingerprint, concurrency, retention | Agreed | TA-6 |
| §5 payment state machine, timeouts, webhooks | Agreed | TA-8 |
| §6 append-only audit vs anonymisation; a retention policy | Agreed; partly overtaken | D9 decided retention (Part 2); TA-14 covers the rest. Audit is kept apart from application logs by ADR-16 (log allowlist; audit reads restricted and themselves audited). |
| §7 the API is the security boundary | **In place** | Every request is authenticated in the API (P3). The database re-checks every write and, after the owner's decision B1, every permission-gated read (ADR-16). |
| §7 tenant context scoped to the transaction, safe with pooling | **In place** | `set_config('app.merchant_id', …, true)` inside each transaction (`apps/api/src/modules/audit/audit-log.ts:32`; `withTenant` in the tenancy repository); the tenant-isolation matrix (P4) |
| §7 RLS effective for the app role; `FORCE` | **In place** | The app role is `NOBYPASSRLS` and never owns a table (`packages/db/sql/bootstrap/roles.sql:12, 37`). `FORCE` is unnecessary because the owner, the migrator, is not a runtime role (`row_level_security/migration.sql:12`). |
| §7 jobs need an explicit tenant scope | Agreed | TA-11 |
| §7 separate web and mobile sign-in flows | Decided | ADR-14 D7: cookies with double-submit CSRF for the platform and merchant web; bearer tokens for agent and customer |
| §8 failure-safe billing; verified vs account ready; requests in flight | Agreed | TA-12 |
| §9 remittance race | Agreed | TA-13 |
| §9 outbox retries, poison messages, alerts | Agreed | P12 (section E) |
| §9 Prisma vs raw SQL | **In place** | Invariants, grants, row-level security and functions are raw SQL migrations, tested against PostgreSQL 16 as each role (`packages/db` tests) |
| §9 UUIDv7 generation | **In place** | `util.uuid_v7()` is the default on every table (`baseline/migration.sql`) |
| §9 contract compatibility | **Mostly in place** | `openapi:check` and the oasdiff breaking-change job (`.github/workflows/ci.yml:62, 85`); the deprecation policy is in section E |
| §9 owner of the jobs schema | Agreed | TA-11 |
| §9 recovery targets; encrypted backups | Agreed | TA-15; question C2 asked |
| §9 legacy and provider inventory before cutover | Agreed | Section E (P15, OPEN-14) |
| §11–§12 gates "before the restructuring map" | **Overtaken** | The map exists and P0–P4 are built. Section G turns its gates into phase gates. |

## G. When each finding must be settled

| When | Findings |
|---|---|
| **Now** (text only, no code) | TA-7 text, TA-9 text, TA-14 text, TA-16 to TA-25; TA-26 for P5.1 |
| Before P6 (ledger) | TA-1, TA-3, TA-4, TA-5, TA-6, TA-7 categories, TA-10 (boundary lint) |
| Before P7 (customers) | TA-14: no customer personal details in audit summaries |
| Before P8 (savings) | TA-13 |
| Before P9 (payments) | TA-2 merchant and platform traces, TA-8 with the TransactPay questions, TA-11 |
| Before P10 (billing) | TA-12, with the owner's question on several unpaid invoices |
| Before P8b and production | TA-2 custody (OPEN-12; the release blocker is unchanged), TA-15 |

## H. What this review does not change

- **P5 Part 1:** nothing here reopens it. TA-26 is a naming instruction for P5.1, not a design change.
- **ADR-16 §3.5:** not reviewed here. Its approval by the reviewer is separate, and that approval must cover the owner's
  B1 change.
- **Financial phases:** no design is changed by this document. The findings become designs only through the decisions
  listed in section G.
