# One diagnostic call: why the sandbox suite's customer creation was refused (2026-11-24)

Approved by the independent reviewer for exactly one customer-creation request in Paystack's test mode, with the same synthetic
payload as the failed test, and no retry. The sandbox suite itself ran on `9f8de5f` (`sandbox-run.txt`).

| | |
|---|---|
| When | 2026-11-24T20:11:50Z |
| Credential | the `sk_test_` key of `apps/api/.env.test`; not printed or recorded |
| Request | `POST https://api.paystack.co/customer`, once. Payload as the suite sends it: an email made of a random alias, lowercased, on the suite's default domain `wallets.example.test`; first name `Sandbox Stores`; last name `Business`; no phone |
| HTTP status | **400** |
| `status` | `false` |
| `message` | `"email" must be a valid email` |
| Customer created | No |

## What it shows

Paystack refused the **email address**, not the missing phone number or the business category: the `.test` top-level domain is
reserved and does not validate. That answers the first failure only. Paystack validates one rule at a time, so a phone requirement
or a category rule could still be the next refusal once the email is valid. Nothing about dedicated-account creation is proven.

## What it means for the code (not changed here)

- `PAYSTACK_WALLET_EMAIL_DOMAIN` must be a domain with a real top-level domain (for example one under `alphakolect.com`). The
  configuration accepts any domain today, including reserved ones, and the suite's default domain is one Paystack refuses.
- Reading: the 400 was read as a stated refusal (`INVALID_REQUEST`), which is correct. It would have left a wallet `provisioning`,
  retried, and in the end `failed` and visible to the platform team.

No other call was made. No input was changed and the suite was not re-run.
