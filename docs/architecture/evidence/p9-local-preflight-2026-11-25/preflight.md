# Local preflight, 25 November 2026 (sanitized: names, states and counts only; no value was read or printed)

Asked for by the independent reviewer at `0e97374` before it can accept the local readiness report (`docs/architecture/P9_LOCAL_READINESS_REPORT.md`).
Taken on the branch at `ea0402a` (code identical to `0e97374` apart from the sandbox workflow's secret scope, which no local run uses).
**Nothing was changed, switched on or started** to take it: no `.env` file was made or edited, no wallet switch, no tunnel, no worker, no API.

| Check the reviewer asked for | Result |
|---|---|
| `PAYMENT_PROVIDER` is `paystack` | **Not set: `apps/api/.env` does not exist.** The API's `dev`, `start` and `worker` commands read that file only, so with none they run on the default, the fake provider. Nothing local is configured for Paystack yet |
| Paystack key is a test key | **n/a**: no `PAYSTACK_SECRET_KEY` is configured for the API. (`apps/api/.env.test` holds a test key by the name `PAYSTACK_TEST_SECRET_KEY` with the `sk_test_` prefix, read only by the on-demand sandbox suite; its value was not printed) |
| `DATABASE_URL` is a local loopback database | **n/a**: not set. The only `DATABASE_URL` in any local env file is in `apps/api/.env.test`, for `127.0.0.1:5436`, which nothing loads by itself. `.env.prod` holds none |
| `WORKER_DATABASE_URL` is a local loopback database | **n/a**: not set |
| `PAYSTACK_WALLET_CREATION` is off | **Off** (the default): the setting is absent. The code refuses to create a wallet unless it reads `on` |
| `PAYSTACK_PAYOUTS` is off | **Off** (the default); `on` is refused in production |
| `worker-role.sql` completes against the actual local database | **Passed**: the local compose database `alphakolect`, published only on `127.0.0.1:5436` (`docker port`: `5432/tcp -> 127.0.0.1:5436`). Output below |

```
DO
NOTICE:  alphakolect_worker: attributes, memberships and privileges are as required
--- exit: 0
memberships of alphakolect_worker: 0
```

## What else the preflight found

- `infrastructure/.env` (the compose database's passwords) exists. Its values were not read.
- The compose database holds **no application data**: no migration table and none of the `payments`, `ledger`, `identity` or `tenancy` schemas. The test suites build a throwaway database on the same server for each run and drop it, so the sandbox suite and the worker tests never touch this one.
- `apps/api/.env.prod` still exists locally and holds TransactPay's live keys (plan §16.4 condition 12): not loaded by anything, to be revoked by the owner (`docs/business/P9_TRANSACTPAY_CLOSURE_CHECKLIST.md`).

## What follows for the reviewer's decision

The environment is **not yet configured for the sandbox wallet test**: that needs an `apps/api/.env` with `PAYMENT_PROVIDER=paystack`, a test key, the local `DATABASE_URL` and `WORKER_DATABASE_URL`, and the wallet switch on. Making it is the first step of workstream D, and
is **not authorized**. The reviewer can accept or refuse the readiness report on the safety of the configuration as it would be made (report §6), and the check above passes on the database it would use; a second preflight of the finished `.env`, by name and prefix only,
is the last check before anything is switched on.
