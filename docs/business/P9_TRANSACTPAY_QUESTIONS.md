# AlphaKolect: Questions for TransactPay

**For:** whoever speaks to TransactPay for AlphaKolect (the owner or the project lead), to put to TransactPay's
integration or support team
**Prepared:** 26 October 2026
**Why:** The new AlphaKolect connects to TransactPay through one adapter. The old system's code shows how to create a
virtual account, read its details, read the balance and look up one transaction. It does not show how to send money,
how a notification can be proven genuine, or what happens when a request times out. The answers below summarize
TransactPay's published documentation; anything marked as needing confirmation should be verified directly with
TransactPay before it is treated as a provider guarantee.

**Never paste keys, passwords or other secrets into this file.** If TransactPay sends test credentials, keep them out of
the repository and tell the project lead they exist.

**Answered by:** Mayowa Edward Fadahunsi **Date:** 26th of October, 2026 **TransactPay contact:** ______

---

## A. Test environment

**A1.** Is there a sandbox (test environment)? Its address, and how we get test keys for it.

> **Documented.** Sandbox base URL: `https://payment-api-service.transactpay.ai`. Test keys are available in the TransactPay dashboard under Settings → API Keys & Webhooks; test and live keys are not interchangeable. The sandbox supports payment and payout testing, error handling and webhook delivery. Sources: [API introduction](https://transactpay.readme.io/reference/introduction), [Getting started](https://transactpay.readme.io/docs/api-keys).

**A2.** Can the sandbox simulate money arriving in a virtual account (a test bank transfer), and a failed or reversed
transfer?

> **Partially documented.** The sandbox supports successful and failed payment scenarios, simulated timeouts, test bank-account scenarios for successful and failed payouts, and webhook testing. The documentation does not clearly confirm simulation of incoming virtual-account deposits, failed deposits and bank-initiated reversals specifically. Source: [Test credentials](https://transactpay.readme.io/reference/test-credentials).

## B. Virtual accounts

**B1.** Is creating a virtual account idempotent? If we send the same request twice (for example after a timeout), do we
get the same account, or two? Is the alias the key?

> **Partially documented; idempotency needs confirmation.** Virtual-account generation accepts an `Alias` and optional `Reference`; the account is described as persistent, reusable and tied to the alias. The docs do not guarantee that retrying after a timeout returns the same account or prevents duplicate creation. Do not treat alias association as an idempotency guarantee. Source: [Virtual Account Generation](https://transactpay.readme.io/reference/virtual-account-generation).

**B2.** What does each virtual account cost (creation, monthly, per transaction)? (Rule 2.4, T3)

> **Not fully documented.** Transaction examples include `fee`, `feeRate`, `subsidiaryFee` and `customerFee`, but there is no definitive schedule for account creation, monthly maintenance or virtual-account transaction fees. Ask the account manager to confirm AlphaKolect's pricing.

**B3.** Can a virtual account be closed through the API? What happens to money in it, and to money sent to it after it
is closed?

> **Confirmation required.** The reviewed documentation covers account creation, persistence, reuse and account-detail lookup, but does not establish a virtual-account closure endpoint or what happens to remaining funds and later deposits after closure.

**B4.** Does each virtual account have its own balance we can read, or is all money pooled in our one TransactPay
balance? If pooled, how do we know how much belongs to each virtual account?

> **Partially documented.** TransactPay documents virtual-account details lookup by alias and funding details for individual transaction sessions. It also documents `GET /payout/balance-enquiry?currency={CURRENCY}`, which is a payout-balance enquiry and does not establish that each virtual account has an independently readable balance. Whether funds are pooled and how they are reconciled needs confirmation. Sources: [Get Virtual Account Details with Alias](https://transactpay.readme.io/reference/get-virtual-account-details-with-alias), [Funding Details](https://transactpay.readme.io/reference/funding-details).

**B5.** For a virtual account in a customer's name: does TransactPay need their BVN or NIN (identity checks)? (OPEN-13)

> **Confirmation required.** The virtual-account generation page asks for an alias, with optional narration and reference; it does not establish the identity-verification requirements for customer-named accounts. Confirm whether BVN, NIN, business KYC or other customer details are required for AlphaKolect's account model. Source: [Virtual Account Generation](https://transactpay.readme.io/reference/virtual-account-generation).

## C. Money arriving (notifications)

**C1.** How are we told that money arrived in a virtual account — a webhook (a message to our server)? Please send the
exact format of the message and the list of event types.

> **Documented, with an event-catalogue caveat.** TransactPay documents HTTP `POST` webhooks with JSON payload examples for card collections, bank-transfer collections, reserved-account funding and payout-status updates. Examples include references, amounts, currency, fees, status and timestamps; reserved-account funding includes fields such as `sessionId`, `paymentReference`, `sourceAccountName` and `accountReference`. The general guide says to configure the destination URL through the dashboard and respond with HTTP `200 OK`, but does not provide one definitive list of all event types. Sample payloads have differing field casing and structures. Source: [Webhooks](https://transactpay.readme.io/reference/webhooks-1).

**C2.** Are webhook messages signed, so we can prove they came from TransactPay? How (header name, algorithm, which
key)? Do they come from fixed IP addresses?

> **Not established; security confirmation required.** The published webhook documentation describes payloads and the expected response, but does not specify a signature header, signing algorithm, verification-key procedure or fixed source IP list. Do not trust a notification solely because its contents look plausible; ask TransactPay which authenticity mechanism is supported. Source: [Webhooks](https://transactpay.readme.io/reference/webhooks-1).

**C3.** If our server does not answer, does TransactPay retry? How often, for how long? Can the same event arrive twice?

> **Partially documented.** The receiving server should respond with `200 OK`; TransactPay recommends responding quickly and processing heavier work asynchronously. The docs do not specify a retry schedule, retry duration, event retention window or at-least-once delivery guarantee. Confirm these details, and design to tolerate duplicate and missed notifications. Source: [Webhooks](https://transactpay.readme.io/reference/webhooks-1).

**C4.** Is there an endpoint that lists the transactions of a virtual account (or of our whole account) for a period, so
we can find anything a missed webhook did not tell us? The old system's code says there is none — please confirm.

> **Partially documented.** The API documents transaction details for a particular virtual-account session, payout status lookup by merchant reference, payout-balance enquiry and refund listing. I could not verify a general endpoint for listing all incoming virtual-account transactions over an arbitrary period. The transaction-detail endpoint requires a `sessionId` and is not, by itself, a complete transaction-history feed. Sources: [Funding Details](https://transactpay.readme.io/reference/funding-details), [Payouts](https://transactpay.readme.io/reference/payouts-1).

**C5.** The old system looks a transaction up with `GET /payment/transaction-details/{sessionId}`. Is that the
authoritative way to confirm a transaction, and does it show the amount, the virtual account and the final status?

> **Endpoint documented; authoritative scope needs confirmation.** `GET /payment/transaction-details/{sessionId}` returns transaction-level details including `sessionId`, `paymentReference`, amount, currency, status/status ID, timestamps and payment information; account-related information is available where provided. The published status table defines: 1 Initiated, 2 Pending, 3 Awaiting-Confirmation, 4 Failed, 5 Successful, 6 Reversed, 7 Processing. Verify Order advises checking the actual transaction status, not merely whether the API request succeeded. However, Verify Order is documented for orders and Funding Details for virtual-account sessions. Confirm which endpoint/status is authoritative for reserved-account deposits and whether every response identifies the destination account. Sources: [Funding Details](https://transactpay.readme.io/reference/funding-details), [Verify Order](https://transactpay.readme.io/reference/verify-order-1).

## D. Money leaving (transfers)

**D1.** Which endpoints send money from a virtual account to another virtual account, and to a normal bank account? (T1:
you have said both are possible.) Please send their documentation.

> **Bank payouts documented; virtual-account-to-virtual-account transfer unconfirmed.** The payout API documents `POST /payout/initiate`, `POST /payout/name-enquiry` and `GET /payout/requery?clientReference=yourReference`. Payout requests include `clientReference`, `accountNumber`, `bankCode`, `amount`, `accountName`, `creditCurrency` and `debitCurrency`. I could not verify a dedicated direct virtual-account-to-virtual-account transfer endpoint. Source: [Payouts API](https://transactpay.readme.io/reference/payouts-1).

**D2.** Are transfers idempotent on our own reference? If we send the same reference twice, is it refused or done once?

> **Confirmation required.** The payout API accepts a merchant-supplied `clientReference`, but the documentation does not guarantee that repeating a request with the same reference prevents a duplicate payout. Ask whether duplicate references are rejected, deduplicated or processed separately. Source: [Payouts API](https://transactpay.readme.io/reference/payouts-1).

**D3.** How do we look a transfer up by our own reference, if we never received its answer?

> **Documented for payouts.** Query `GET https://payment-api-service.transactpay.ai/payout/requery?clientReference=yourReference`. The example response includes the merchant and provider references, amount, account details, response code/message and status. Verify the status before treating the payout as successful. Source: [Payouts API](https://transactpay.readme.io/reference/payouts-1).

**D4.** If a transfer request times out on our side, what has happened on yours: done, not done, or unknown until it
settles? How long until it is final?

> **Partially documented.** Payout status can be queried by `clientReference`; most payouts are described as instant, while some bank payouts may take up to 24 hours. The docs do not establish whether a timed-out request may already have executed, which statuses are terminal for each route or how long an ambiguous transaction can remain unresolved. Do not treat a timeout as failure or retry a potentially executed payout before reconciling its status. Source: [Payouts API](https://transactpay.readme.io/reference/payouts-1).

**D5.** What does a transfer cost, and who pays the fee (taken from the amount, or charged separately)?

> **Partially documented.** Payout webhook examples include a `Fee` field and collection/order examples expose fee-related fields, but no definitive payout tariff or rule for whether the fee is deducted from the requested amount or charged separately was found. Ask for AlphaKolect's payout pricing and an example showing total debit, recipient credit and fee. Sources: [Payouts API](https://transactpay.readme.io/reference/payouts-1), [Webhooks](https://transactpay.readme.io/reference/webhooks-1).

## E. Reversals and refunds

**E1.** Can a completed transfer or deposit be reversed or refunded by TransactPay or the sending bank? How are we told,
and is it a new transaction with its own reference?

> **Partially documented.** The API documents `POST /payment/order/refund`, `GET /refund` and `GET /refund/:id`; refunds are queued and may not be immediate, and examples include a `pending` refund status. Webhook status ID 6 is `Reversed`. A merchant-requested refund is not necessarily the same as a bank-initiated reversal; the rules for completed payouts and all incoming virtual-account deposits are not established. Sources: [Refunds](https://transactpay.readme.io/docs/refunds), [Verify Order](https://transactpay.readme.io/reference/verify-order-1), [Webhooks](https://transactpay.readme.io/reference/webhooks-1).

## F. Limits

**F1.** Are there limits per transaction, per day or per virtual account (amounts, counts)? Do they depend on the
business's verification level?

> **Partially documented.** The payout overview states that daily transaction caps apply and merchants can contact support to request increases. Numeric per-transaction limits, daily counts and virtual-account limits for AlphaKolect are not specified; confirm the account-specific limits and whether they depend on verification level. Source: [Payout overview](https://transactpay.readme.io/reference/overview-2).

---

*Thank you. Once answered, the project lead records the date and the plan is updated (P9).*
