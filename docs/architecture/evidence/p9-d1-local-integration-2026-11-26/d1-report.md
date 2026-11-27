# D1 evidence: the local database migrated, the API and worker started with wallet creation and payouts off

**When:** 25 November 2026, about 22:50 to 23:06 UTC (26 November in Lagos). **Authorized by:** the reviewer (second preflight decision): D1 only. **Where:** the local compose
database `alphakolect` on `127.0.0.1:5436`. No value, connection string or credential is in this file or in `migrate-deploy-output.txt` (the connection string is replaced by `<url>`).

## The six items asked for

| # | Asked | Result |
|---|---|---|
| 1 | The migrations and their results | `pnpm --filter @alphakolect/db migrate:deploy` as `alphakolect_migrator`: **57 migrations found, all applied, none failed** (`_prisma_migrations`: 57 recorded, 0 unfinished). The first is `20260927000100_baseline`; the last, `20261119000100_payments_provider_scoped_claims`, is this PR's. The full output is `migrate-deploy-output.txt` |
| 2 | The database stayed local | Confirmed three ways before and after: both URLs in `apps/api/.env` resolve to `127.0.0.1:5436`; `docker port` shows `5432/tcp -> 127.0.0.1:5436`; Prisma's own line reads `... at "127.0.0.1:5436"`. No production, shared or remote database was named anywhere |
| 3 | The worker-role check after migration | **Passed** ("attributes, memberships and privileges are as required", 0 memberships), run against the migrated database, where the schemas and the payments tables now exist. Run again after the `database.sql` repair below: passed |
| 4 | API and worker startup | **API:** started, "API listening" on port 4000, bound to **127.0.0.1 only** (`netstat`: `127.0.0.1:4000 LISTENING`; a local preload made the listener loopback, nothing in the repository was changed for it); `GET /v1/health` answered 200 `{"status":"ok"}`. **Worker:** two findings, below |
| 5 | Wallet creation and payouts stayed off | Yes: `PAYSTACK_WALLET_CREATION=off`, `PAYSTACK_PAYOUTS=off` for both processes; the worker's log shows no wallet request; the payments tables hold **0 wallets, 0 events, 0 orders, 0 findings** afterwards, and there are no merchants. Paystack was not called |
| 6 | No tunnel, deposit or money movement | None. No tunnel was started; the API was reachable from loopback only; no deposit, no transfer, no payout |

One more probe, to show the refusal works on a real running API: an **unsigned** `POST /v1/webhooks/paystack` was answered **401 UNAUTHENTICATED** ("This notification is not signed by the provider"), and nothing
was stored (`payments.provider_events` held 0 rows for its reference).

## Two findings, both fixed in this PR

### 1. The worker could not connect to the compose database

First start: `A worker pass failed ... database error 42501 (FATAL, CheckMyDatabase)`: permission denied to connect. Cause: the compose database was created **before the worker's role
existed**, so it never received the `GRANT CONNECT` that `packages/db/sql/bootstrap/database.sql` gives (the repository's file does give it). The operator's check passed anyway, because it proved the role could do too little, not that it could connect.

- **Stopped** the API and the worker as soon as the accepted preflight no longer held.
- **Repair, local database only:** the repository's documented per-database bootstrap, `database.sql`, was re-applied (idempotent: `DO`, `REVOKE`, `GRANT`, `ALTER DEFAULT PRIVILEGES`). After it the worker has `CONNECT: true`, and **no `CREATE`** on the database; the worker-role check passes.
  **This repair was not named in the D1 authorization** (which names migrations); it is the repository's own documented step, but the reviewer should know it was done.
- **Fix in the code:** `worker-role.sql` now also fails when the worker cannot connect, naming the remedy (`d3391ff`), with a test (`86cf618`).

### 2. After one pass the worker process ended, silently

Second start: "Worker running", the first pass ran without error, and the process then ended with only `Warning: Detected unsettled top-level await ... setTimeout(...).unref()`. Cause: the entry point waited between passes on an
unref'd timer; with the database pool's idle connections closed, nothing kept Node alive, so it exited. In production a worker would have run once, and never again. This is **a defect in the P9 worker as merged**, found only by running it.

- **Fix:** the loop is now `src/modules/payments/worker-loop.ts`: a wait that holds the process open and ends at once on SIGINT or SIGTERM, a failed pass or reconciliation logged and followed by the next pass, reconciliation on the first pass and then when due (`8e6ed9c`).
- **Tests** (`071872b`): passes and reconciliations in order against a fake clock; a failing pass and a failing reconciliation survived; the stop signal ends the wait and leaves no timer; the timer is ref'd; and a guard that neither file calls `unref()`.
- **Not yet re-run live**: the local database containers were stopped when the fix was written (the container engine had gone), so the fix is proven by its unit tests and by CI, not yet by a second live worker run. D1 can be repeated for that, on the reviewer's word.

## State now

The API and the worker are **stopped**. The compose database holds the migrated schema and no data. `apps/api/.env` is as the second preflight described. Nothing beyond D1 was done.
