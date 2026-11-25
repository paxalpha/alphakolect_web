# Second local preflight: the finished `apps/api/.env`, 25 November 2026 (sanitized: names, set or not, prefixes and hosts; no value)

Asked for by the reviewer once CI was green on `da22183` (run 45714046125: all three checks passed). The file was made **without starting** the API, the worker, a tunnel or any
wallet flow, and the compose database is stopped. `apps/api/.env` is gitignored (`git check-ignore` confirms) and was never printed.

| Required | Result |
|---|---|
| `PAYMENT_PROVIDER=paystack` | `paystack` |
| `PAYSTACK_SECRET_KEY` has the `sk_test_` prefix | set; prefix `sk_test_`; length 48 |
| Both database URLs resolve to 127.0.0.1 | `DATABASE_URL`: `127.0.0.1:5436`, role `alphakolect_app`, database `alphakolect`; `WORKER_DATABASE_URL`: `127.0.0.1:5436`, role `alphakolect_worker`, database `alphakolect` |
| Wallet creation off during inspection | `PAYSTACK_WALLET_CREATION=off` (explicit) |
| Payouts off | `PAYSTACK_PAYOUTS=off` (explicit) |
| No live Paystack credentials | none: no name holds an `sk_live_` value, a TransactPay value, or a name with `transactpay` in it |
| The configuration loads | `loadConfig` and `assertApiConfig`: ok; provider `paystack`; wallets enabled `false`; payouts enabled `false`; signing secret not set |

Other names present: `PAYSTACK_PREFERRED_BANK` (`test-bank`), `PAYSTACK_WALLET_EMAIL_DOMAIN` (set; ending `com`), `AUTH_SIGNING_JWK`, `MFA_ENCRYPTION_KEY` (both set, generated locally by `secrets:local`).
`NODE_ENV` is not set (development). `PAYSTACK_WEBHOOK_SIGNING_SECRET` is **not set**: the dashboard has not given one, so only the older `x-paystack-signature` (the secret key) is accepted.

## How the file was made

`pnpm --filter @alphakolect/api secrets:local` (adds the signing and encryption keys and `DATABASE_URL` from `infrastructure/.env`; prints names only), then the worker's URL, the provider and the
test key (copied from `PAYSTACK_TEST_SECRET_KEY` in `.env.test`) added by a script that printed only the names it added. The wallet email domain is `paxalphaltd.com`, the sender domain the reviewer
noted: **a decision for the project lead** (P9-26), used here only for the synthetic customers of the local test.

## The reviewer's seven conditions, as they stand

1. A verified local database, not a production or shared one: the compose database on `127.0.0.1:5436`, checked on the first preflight. **Met for the design; the file points there.**
2. The `.env` inspected by name, host and prefix before a process starts: **this file.**
3. `worker-role.sql` must pass again after the database is bootstrapped and **migrated**: **not yet.** The database has no migrations (the first preflight), and migrating it is part of starting the integration.
4. The tunnel points only at the webhook door on port 4001: **not started.**
5. The test webhook uses the test-mode signing configuration: **not set up**: no signing secret yet.
6. Wallet creation on only for the authorized test, then off: **off now.**
7. Payouts remain disabled: **off now.**

Nothing else has been done. Migrating the database, starting the API and the worker, switching wallet creation on, starting the door and the tunnel, registering the webhook, and the test deposit are all **not authorized**.
