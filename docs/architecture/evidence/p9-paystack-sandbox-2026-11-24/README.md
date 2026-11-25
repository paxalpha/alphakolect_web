# Paystack sandbox evidence, 24 and 25 November 2026

What was run against Paystack's **test mode** (test key only, a throwaway local database, synthetic customers, no real money, no wallet switch, no tunnel,
no deposit). The code tested in both runs is `9f8de5f`; every commit after it that touches these runs is documentation only.

| File | Commit | What it is |
|---|---|---|
| `sandbox-run.txt` | `d92729e7bf8a0f06d837ff47ecc875bc2f689c54` | The first run: 43 passed, 1 failed. The customer-creation test failed with HTTP 400 |
| `diagnostic-customer-creation.md` | `902e31061a8b96da03215bbe19ae0ea94a92c363` | One diagnostic call, approved by the reviewer: Paystack answered `400 "email" must be a valid email` for an email on `.test` |
| `sandbox-run-2.txt` | `3f6bcb748ea554ce74a485274a8b7675c984194c` | The rerun with a real-TLD domain on the command line: 44 of 44 passed, including the three tests against Paystack |

## What the runs show (condition numbers are plan §16.4)

- **Condition 2 (not-found answers):** an unknown wallet alias, transaction reference and payout reference read as "does not exist", as documented; the naira balance reads. Shown by the three tests that call Paystack.
- **Condition 5 (a repeat creates no second account):** the account was made under its alias, found by it, and a repeat made no second one. **Not shown:** a lookup that lags after a creation.
- **Condition 3 (what a customer needs):** test mode accepted a customer with no phone number. **Not shown:** what the live account's business category requires.
- **Condition 6 (the account name):** a business name as first name and "Business" as last name were accepted. **Not shown:** the account name Paystack built.
- **Not covered at all:** a deposit, a webhook, the worker, the ledger, the balance and fee (conditions 1, 4, 7).

## What is, and is not, in these files

- No key, signing secret, authorization header or customer address: searched for `sk_`, `whsec_`, `Bearer`, `Authorization`, `PGW-`. The runs print test names and results only.
- The first line of `sandbox-run-2.txt` says commit `902e310`, the head when it ran; the code is `9f8de5f`'s (nothing outside `docs/` differs).
- A first attempt on 25 November at 13:01Z ran no test (the local test database was stopped) and sent nothing to Paystack; it is noted in `sandbox-run-2.txt`.

## How to run it again, in the cloud

`docs/architecture/P9_SANDBOX_IN_CI.md`: the on-demand workflow `paystack-sandbox.yml` (label `paystack-sandbox`), which keeps its output as an artifact.
