# Closing TransactPay: the accounts, the keys, and what must be removed

**For:** the owner and whoever looks after the servers. **Prepared:** 25 November 2026. **Nothing here has been done.** It is plan §16.4 condition 12
and the owner's answer to Q7 (19 November 2026): ask TransactPay to close all the old accounts before the relationship ends.

**Write no key, secret or password into this file, a ticket, a chat or an email.** Record only that a step was done, when, and by whom.

## A. Why the keys come first

TransactPay's **live keys** were kept in a local file, `apps/api/.env.prod` (gitignored), and its contents were printed into a working session on
19 November 2026 (the project's own tool output, not a public place). Nothing loads that file, and no code uses TransactPay any more, but a live key
that has been seen outside its safe place must be treated as exposed. **Revoke it; do not wait for the closure.**

## B. Steps

| # | Step | Who | Done (date, who) |
|---|---|---|---|
| 1 | In TransactPay's dashboard, revoke or regenerate the **live API keys** (public, secret and the encryption key) so the old values stop working | Owner | |
| 2 | Do the same for the **test keys** held in `apps/api/.env.test` (low risk; keeps the file clean) | Owner | |
| 3 | Remove any **webhook URL** registered for AlphaKolect in TransactPay's dashboard (it pointed at the old server's `/webhooks/transactpay`) | Owner | |
| 4 | Ask TransactPay in writing to **close** the ~197 accounts made for fake sign-ups and the four test accounts (BR 2.4, OPEN-14), and to confirm closure in writing | Owner | |
| 5 | Ask TransactPay to confirm in writing that **no balance** remains on any account, and where any remainder goes | Owner | |
| 6 | Ask for the account to be **closed** or the relationship ended, in writing, with the date | Owner | |
| 7 | Delete `TRANSACTPAY_*` lines from `apps/api/.env.prod` and `apps/api/.env.test` (or the whole file, if it holds nothing else needed) | Whoever holds the files | |
| 8 | Search each place secrets are kept for the word "transactpay": the old server's environment, any password manager entry, any hosting dashboard, any CI secret store. Remove or disable each hit | Whoever looks after the servers | |
| 9 | Confirm the old server, if it still runs, cannot call TransactPay: it has no valid key (step 1) and no webhook (step 3) | Whoever looks after the servers | |
| 10 | Keep TransactPay's written confirmations (steps 4 to 6) with the project, and tell the project lead so the plan can record it | Owner | |

## C. In the repository

Already done in P9 revision 8 (PR #13): no TransactPay code, configuration, test or contract path remains in `apps/` or `packages/` (the migrations' comments and the
legacy client under `legacy/` are history); the old webhook path was removed from the API contract with a documented, exact exception
(`packages/contracts/openapi/oasdiff-ignore.txt`); the two P9 TransactPay forms are marked superseded. Nothing in the repository needs a key from TransactPay.

## D. When the plan can record it closed

When steps 1 to 10 are done and confirmed, the project lead can record plan §16.4 condition 12 as closed. The reviewer will ask for the dated confirmations (not their
content if it holds anything sensitive) and for the result of step 8, stated without any secret.
