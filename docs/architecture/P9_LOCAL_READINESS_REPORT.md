# P9 local readiness report: is the local environment safe enough for the sandbox wallet and webhook test?

**Prepared:** 25 November 2026, on branch `feat/p9-paystack`. **For:** the independent reviewer (workstream C of the closing plan; the gate before
anything is switched on locally or any tunnel is opened). **Nature:** an inspection of the code and the configuration as they are, with the
file that shows each fact. It switches nothing on, opens nothing, and changes no secret. **Status: for the reviewer's acceptance; not accepted.**

Where a fact rests on a file outside the repository (a local `.env` file), it is marked **local**: the reviewer cannot see it, and the operator
confirms it with the check in 6.

## 1. Database isolation (C1)

| Question | Finding | Where |
|---|---|---|
| What database does the local API use? | The one in `apps/api/.env` (`DATABASE_URL`), which `secrets:local` writes for the compose database: `127.0.0.1:5436`, bound to loopback only. The API's `dev`, `start` and `worker` commands read `.env` and **no other env file** | `apps/api/package.json` (`--env-file-if-exists=.env`); `infrastructure/compose.yaml` (`127.0.0.1:5436:5432`) |
| What does the test suite use? | A **throwaway database per run**, named `alphakolect_test_<random>`, built by the bootstrap and every migration from zero, and dropped at the end. In CI it is a disposable PostgreSQL service container with CI-only passwords | `apps/api/test/support/global-setup.ts`; `packages/db/test/support/setup-db.ts`; `.github/workflows/ci.yml` |
| Can a test reach a production database? | No path: the harness takes its host and port from `DB_TEST_HOST`/`DB_TEST_PORT` (default the local compose; CI the service) and the passwords from `infrastructure/.env` (gitignored) or CI-only values. No production URL is read | `packages/db/test/support/env.ts`; `apps/api/vitest.config.ts` |
| Does a local env file point at a production database? | **Local:** `apps/api/.env.test` holds a `DATABASE_URL` for `127.0.0.1:5436` and is read by nothing automatically. `apps/api/.env.prod` holds **no** database URL (checked by name, host and database only; values not read) | local files |
| Which database would the worker use? | `WORKER_DATABASE_URL`, from `.env`: the same local compose database, as `alphakolect_worker`. The worker refuses to start without it | `apps/api/src/worker.ts` |

Residual: a developer could put a production URL in `apps/api/.env`. Nothing in the code can tell a local database from another; the operator check
in 6 prints the host so a person sees it.

## 2. Credential isolation (C2)

| Question | Finding | Where |
|---|---|---|
| Which env files are loaded? | `.env` only, by the API, the worker and the admin scripts. `.env.prod` and `.env.test` are **never loaded automatically** | `apps/api/package.json` |
| What reads `.env.test`? | Only the sandbox suite, and only the lines named `PAYSTACK_TEST_*`; it refuses a key that is not `sk_test_` and a customer email domain without a real ending | `apps/api/test/payments/paystack-provider.test.ts` (`sandboxConfig`) |
| Can a live Paystack key run outside production? | No: `loadConfig` refuses `sk_live_` unless `NODE_ENV=production`, and `sk_test_` in production; the on-demand CI job stops at once on anything but `sk_test_` | `apps/api/src/platform/config.ts`; `apps/api/test/config.test.ts`; `.github/workflows/paystack-sandbox.yml` |
| Are secrets in logs or evidence? | A configuration error names the setting and the rule, never the value (tested); the adapter's errors carry no response body; the sandbox output and the diagnostic were searched for `sk_`, `whsec_`, `Bearer`, `Authorization` and `PGW-`: nothing recorded | `apps/api/test/config.test.ts`; `paystack-provider.ts`; `docs/architecture/evidence/p9-paystack-sandbox-2026-11-24/` |
| Are credentials committed? | `.env`, `.env.*` are ignored except `*.example`; the secret scan passes on every head of PR #13, including the history | `.gitignore`; CI "Secret scan (gitleaks)" |
| **Known exposure** | **Local:** `apps/api/.env.prod` holds TransactPay's live keys, and its contents were printed into a working session on 19 November. They are not used by anything loaded, but they must be **revoked** (plan §16.4 condition 12; `P9_TRANSACTPAY_CLOSURE_CHECKLIST.md`) | local file |

## 3. Worker isolation (C3)

| Question | Finding | Where |
|---|---|---|
| Is the worker's role limited? | It can log in and nothing else: not a superuser, cannot create roles or databases, does not bypass row security, no replication; **no table, view or sequence privilege anywhere**, so it acts only through its functions; it cannot `SET ROLE` to the API's role | `packages/db/sql/bootstrap/roles.sql`; `packages/db/test/payments.test.ts` ("P9-R1") |
| Can it hold memberships? | Not any more: the bootstrap now revokes every membership of the role, or in it, on each run (it only re-applied attributes before); an operator's read-only check verifies it per environment | `roles.sql`; `packages/db/sql/checks/worker-role.sql`; `packages/db/test/worker-role.test.ts` |
| Does the API hold the worker's credentials? | In production the API **refuses to start** if `WORKER_DATABASE_URL` is set. Locally one `.env` serves both, and the API tolerates it | `assertApiConfig` in `config.ts`; `config.test.ts` ("ruling 4") |
| Can the worker act on another business's books? | Its functions take the business from the row they act on; a credit touches only the business whose wallet it is (tested). Its claims are now limited to its own provider's rows | `payments.test.ts`; `worker.test.ts`; migration `20261119000100` |
| What remains | Production runtime separation (a separate process and service identity, no worker credentials in the API's container, independent rotation) is **P15's**, and plan §16.4 condition 10 stays open for it | plan §16.4 |

## 4. Webhook exposure (C4)

| Question | Finding | Where |
|---|---|---|
| Is the signature enforced? | Yes: `POST /v1/webhooks/paystack` checks the signature on the **exact bytes received** (`Paystack-Signature` with the signing secret, five minutes' tolerance; or `x-paystack-signature` with the secret key). A notification that fails is refused with 401 and **not stored** | `paystack-provider.ts` (`verifyNotification`); `service.ts` (`receiveEvent`); `payments-api.test.ts`; `paystack-flow.test.ts` |
| Does a proxy break the bytes? | The raw body is kept by the JSON parser's `verify` hook for webhook paths, and the webhook-only door (`webhook-proxy`) forwards it unchanged (tested byte for byte, with odd spacing) | `apps/api/src/platform/http/app.ts`; `apps/api/test/scripts/webhook-proxy.test.ts` |
| Is a replay possible? | The timed signature rejects an old one. The older signature has **no time**, so a captured notification could be sent again: harmless, because every credit is confirmed with Paystack and made once per transaction (replays are tested), but it is a reason to set the signing secret | plan §3.3; `worker.test.ts` |
| Is the body bounded? | JSON parser limit 100 KB; stored body limit 64 KiB; a rate limit per address and per provider; the door's own limit is 64 KiB | `app.ts`; `service.ts`; `rate-limits.ts`; `webhook-proxy.ts` |
| Does a tunnel expose more than the webhook? | **It would, if pointed at the API:** every route. The door (`pnpm webhook:proxy`) is the answer: it forwards only `POST /v1/webhooks/paystack` with only the headers the signature check needs (no cookie, no authorization), and answers 404 with no body to everything else (15 other methods and paths tested). **The tunnel must point at the door, never at the API** | `apps/api/scripts/webhook-proxy.ts` |
| Is there a source-address list? | **Yes, in the door** (added 27 November 2026 after the reviewer's note that the path restriction is not an address allowlist): only Paystack's three documented addresses (52.31.139.75, 52.49.173.169, 52.214.14.220) pass, read from the header the tunnel sets (`cf-connecting-ip` for cloudflared, the default; the **last** entry of `x-forwarded-for` for ngrok, because the earlier entries are the sender's to make up). No such header, or any other address, is a 404. `WEBHOOK_PROXY_ALLOWED_SOURCES=none` switches it off and the door says so. **Residual:** it trusts the tunnel's header, so it is a second wall, not the first: the signature remains what proves a notification is Paystack's | `apps/api/scripts/webhook-proxy.ts`; `webhook-proxy.test.ts` |
| Are logs safe? | HTTP logging keeps an allow-list: id, method, matched route and status, with no path as sent, header, query string or body | `app.ts` (`HTTP_LOG_SERIALIZERS`) |
| How is it stopped? | Stop the tunnel process (its address then answers nothing), stop the door, and remove the URL from Paystack's test dashboard; a free tunnel's address is new on every start, so an old one cannot be reused | procedure in 6 |

## 5. The switches (C5)

| Question | Finding | Where |
|---|---|---|
| Are wallet creation and payouts off by default? | Yes: `PAYSTACK_WALLET_CREATION` and `PAYSTACK_PAYOUTS` are `off` unless set to `on` | `config.ts`; `config.test.ts` |
| Is Paystack called when they are off? | No: with creation off the worker requests and claims no wallet (the sweep is skipped too); with payouts off the adapter refuses a transfer as `UNSUPPORTED` before any call, and the order fails unsent | `worker-tasks.ts`; `paystack-provider.ts`; `paystack-provider.test.ts`; `paystack-flow.test.ts` |
| Can payouts be on in production? | No: `PAYSTACK_PAYOUTS=on` is refused at start in production | `config.ts`; `config.test.ts` |
| Can the worker bypass it? | The switch is the adapter's capability, read by the worker, so the worker has no other path to Paystack | `worker-tasks.ts` |

## 6. What the operator does, and the reviewer accepts, before step D

1. **Check the environment** (each time the local database or role is rebuilt): `psql "<superuser or migrator url>" -v ON_ERROR_STOP=1 -f packages/db/sql/checks/worker-role.sql`. It must end with `alphakolect_worker: attributes, memberships and privileges are as required`.
2. **Check the local configuration by name**, never by value: `apps/api/.env` has `PAYMENT_PROVIDER=paystack`, an `sk_test_` key, `PAYSTACK_PAYOUTS` absent or `off`, and `DATABASE_URL`/`WORKER_DATABASE_URL` on `127.0.0.1`. `PAYSTACK_WALLET_CREATION` absent or `off`: **off for the whole of D2a**, which is a test of the webhook door and creates no wallet. It may be switched on only in D2b, one named test, after condition 3 is resolved and on the reviewer's authorization.
3. **Start in this order**: the API, the worker, the webhook-only door (`pnpm --filter @alphakolect/api webhook:proxy`), then the tunnel pointed at the door's port (4001).
4. **Register** the tunnel's address plus `/v1/webhooks/paystack` as the **test** webhook in Paystack's dashboard, and set `PAYSTACK_WEBHOOK_SIGNING_SECRET` if the dashboard gave one.
5. **Stop** when the test is done: the tunnel, the door, the worker; remove the webhook URL from the dashboard; set `PAYSTACK_WALLET_CREATION` back to off.

### 6a. What the operator records before D2a, and what is not yet shown (the reviewer's note of 28 November)

`WEBHOOK_PROXY_ALLOWED_SOURCES=none` switches the source list off, so **D2a must not proceed with it**. The command's own settings are tested (defaults, `none`, a list of the operator's own, the header, bad values that stop the start without
repeating the value; and the real command run as an operator runs it), so the operator's record before D2a is read straight off what the door prints. Record, without any credential:

| To record | Where it comes from |
|---|---|
| The tunnel provider actually used | the operator (cloudflared or ngrok) |
| The source-header setting | `WEBHOOK_PROXY_SOURCE_HEADER` (`cf-connecting-ip` for cloudflared, `x-forwarded-for` for ngrok) |
| The effective list: the three expected addresses, 52.31.139.75, 52.49.173.169 and 52.214.14.220 | the door's second startup line: `Source list ON: only <the list>, as read from the <header> header the tunnel sets.` |
| That the restriction is on | that same line, and **no** line beginning `WARNING: the source-address list is switched off` |
| Wallet creation and payouts during D2a | **Both `off`**, read from the `.env` by name before the door starts and unchanged until D2a ends (the reviewer, 28 November). Wallet creation belongs to D2b; payouts stay off throughout |

If the `.env` shows wallet creation or payouts on at any point in D2a, D2a stops and the setting is reported, not corrected silently.

**Not shown, and not shown by any test:** that a real tunnel delivers the header the door reads, with the value the door expects. The tests prove how the door handles the header; **what a tunnel really sends is established only by D2a**, which must show a request
through the real tunnel reaching the API (a signed one, from Paystack) and one that does not (unsigned, or from a source the list refuses). Until then the list is a design, not a demonstrated control, and the signature remains the only check relied on.

## 7. Not established by this report

- The content of the local env files beyond names, hosts and prefixes: the operator's check in 6 stands in for it.
- Anything about a production environment: none exists for this provider yet.
- Whether Paystack accepts a business customer with the fields the adapter sends in **live** mode: owner Q4 and `P9_PAYSTACK_REQUIREMENTS_REQUEST.md`.

**Acceptance asked of the reviewer:** that sections 1 to 5 are sufficient for the sandbox test of workstream D to begin, with the procedure in 6, and that
nothing else is authorized by this.
