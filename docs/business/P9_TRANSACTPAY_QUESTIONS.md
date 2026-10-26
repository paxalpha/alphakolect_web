# AlphaKolect: Questions for TransactPay

**For:** whoever speaks to TransactPay for AlphaKolect (the owner or the project lead), to put to TransactPay's
integration or support team
**Prepared:** 26 October 2026
**Why:** The new AlphaKolect connects to TransactPay through one adapter. The old system's code shows how to create a
virtual account, read its details, read the balance and look up one transaction. It does not show how to send money,
how a notification can be proven genuine, or what happens when a request times out. The answers below decide how the
adapter is built and how safe it is. Please paste TransactPay's answers, or a link to their documentation, under each
question.

**Never paste keys, passwords or other secrets into this file.** If TransactPay sends test credentials, keep them out of
the repository and tell the project lead they exist.

**Answered by:** ______ **Date:** ______ **TransactPay contact:** ______

---

## A. Test environment

**A1.** Is there a sandbox (test environment)? Its address, and how we get test keys for it.

> Answer:

**A2.** Can the sandbox simulate money arriving in a virtual account (a test bank transfer), and a failed or reversed
transfer?

> Answer:

## B. Virtual accounts

**B1.** Is creating a virtual account idempotent? If we send the same request twice (for example after a timeout), do we
get the same account, or two? Is the alias the key?

> Answer:

**B2.** What does each virtual account cost (creation, monthly, per transaction)? (Rule 2.4, T3)

> Answer:

**B3.** Can a virtual account be closed through the API? What happens to money in it, and to money sent to it after it
is closed?

> Answer:

**B4.** Does each virtual account have its own balance we can read, or is all money pooled in our one TransactPay
balance? If pooled, how do we know how much belongs to each virtual account?

> Answer:

**B5.** For a virtual account in a customer's name: does TransactPay need their BVN or NIN (identity checks)? (OPEN-13)

> Answer:

## C. Money arriving (notifications)

**C1.** How are we told that money arrived in a virtual account — a webhook (a message to our server)? Please send the
exact format of the message and the list of event types.

> Answer:

**C2.** Are webhook messages signed, so we can prove they came from TransactPay? How (header name, algorithm, which
key)? Do they come from fixed IP addresses?

> Answer:

**C3.** If our server does not answer, does TransactPay retry? How often, for how long? Can the same event arrive twice?

> Answer:

**C4.** Is there an endpoint that lists the transactions of a virtual account (or of our whole account) for a period, so
we can find anything a missed webhook did not tell us? The old system's code says there is none — please confirm.

> Answer:

**C5.** The old system looks a transaction up with `GET /payment/transaction-details/{sessionId}`. Is that the
authoritative way to confirm a transaction, and does it show the amount, the virtual account and the final status?

> Answer:

## D. Money leaving (transfers)

**D1.** Which endpoints send money from a virtual account to another virtual account, and to a normal bank account? (T1:
you have said both are possible.) Please send their documentation.

> Answer:

**D2.** Are transfers idempotent on our own reference? If we send the same reference twice, is it refused or done once?

> Answer:

**D3.** How do we look a transfer up by our own reference, if we never received its answer?

> Answer:

**D4.** If a transfer request times out on our side, what has happened on yours: done, not done, or unknown until it
settles? How long until it is final?

> Answer:

**D5.** What does a transfer cost, and who pays the fee (taken from the amount, or charged separately)?

> Answer:

## E. Reversals and refunds

**E1.** Can a completed transfer or deposit be reversed or refunded by TransactPay or the sending bank? How are we told,
and is it a new transaction with its own reference?

> Answer:

## F. Limits

**F1.** Are there limits per transaction, per day or per virtual account (amounts, counts)? Do they depend on the
business's verification level?

> Answer:

---

*Thank you. Once answered, the project lead records the date and the plan is updated (P9).*
