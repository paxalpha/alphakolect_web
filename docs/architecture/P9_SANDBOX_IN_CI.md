# Running Paystack's test mode in the cloud (GitHub Actions), not on a laptop

**Prepared:** 25 November 2026. **Why:** the machines that build this project are short of memory; the full suite, the concurrency suites and the Paystack sandbox
suite are run in GitHub Actions, and a laptop runs only the smallest check. The main workflow (`.github/workflows/ci.yml`) already runs every suite on every push to a pull
request. The Paystack suite is the one that needs a secret, so it has its own workflow.

## The on-demand sandbox workflow

`.github/workflows/paystack-sandbox.yml` runs `apps/api/test/payments/paystack-provider.test.ts` with `PAYSTACK_SANDBOX=run` against **Paystack's test mode**, with a
disposable PostgreSQL service, and keeps the complete output as an artifact (`paystack-sandbox-<sha>-<run id>`).

**It never runs on its own.** It starts when someone with write access adds the label **`paystack-sandbox`** to the pull request, or starts it by hand ("Run workflow").

### One-time setup (repository settings, by an admin)

1. **Secret** `PAYSTACK_TEST_SECRET_KEY`: Settings → Secrets and variables → Actions → New repository secret. Value: the **test** secret key from Paystack's dashboard
   (`sk_test_…`). The job stops at once, before anything runs, if the secret is missing or is not a test key, so a live key cannot be used here.
2. **Variable** `PAYSTACK_TEST_WALLET_EMAIL_DOMAIN`: the domain of the synthetic customer emails the suite makes (`akt-<random>@<domain>`), which must end in a real
   top-level domain (for example `paxalphaltd.com`); `.test` and the other reserved endings are refused by the suite. A manual start can give it as an input instead.

Never put a live key, a webhook signing secret or any real customer detail in either.

### Running it

- Add the label `paystack-sandbox` to PR #13 (and remove it after, so the next label adds it again), **or** Actions → "Paystack sandbox (on demand)" → Run workflow
  (a manual start must name a workflow on the default branch to appear in the list; the label works from the pull request's own branch).
- Open the run: the log header names the commit, the reference, the run and attempt, and the domain; the summary line is `Tests 44 passed (44)` when all is well; the artifact
  holds the same text. Keep it as evidence the way the first two runs were kept (`docs/architecture/evidence/p9-paystack-sandbox-2026-11-24/`), without a key in it.

### What it does not do

It does not make a deposit, call a webhook, or switch wallet creation on: those need Paystack's demo bank app and a person (workstream D of the closing plan). It makes
test customers and test dedicated accounts in Paystack's test mode, as the local run did, and nothing else.

## What runs where

| Check | Where | When |
|---|---|---|
| Format, lint, typecheck, every test (contracts, db, API), the concurrency suites, the build, the OpenAPI check | `ci.yml` job "Format, lint, typecheck, test, build" | every push to the pull request |
| Secret scan of the whole history | `ci.yml` job "Secret scan (gitleaks)" | every push |
| API contract: breaking changes against the base, and that the one accepted exception is exact | `ci.yml` job "API contract (breaking-change check)" | every push |
| Paystack's test mode | `paystack-sandbox.yml` | on demand (label or by hand) |
| A formatting, type or lint check of one file, or one small test | a laptop | while writing |
