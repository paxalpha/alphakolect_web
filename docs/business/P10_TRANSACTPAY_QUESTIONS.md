# To TransactPay: moving money between virtual accounts

**To:** TransactPay Support
**From:** AlphaKolect Integration Team
**Prepared:** 11 November 2026
**Why:** AlphaKolect's billing (P10 plan §9, conditions 1–4) takes each business's monthly subscription from its
virtual account into AlphaKolect's own. These answers decide whether billing can be switched on. Send them together with
`P9_TRANSACTPAY_FOLLOWUP.md` (deposits and balances), which asks the related balance questions.

---

Hello TransactPay Support Team,

AlphaKolect gives each business that uses it a TransactPay virtual account, and has one virtual account of its own. Each
month we need to move a business's subscription from the business's virtual account into AlphaKolect's. We need four
things clarified before we do this with real money.

## 1. Moving money from one virtual account to another

1. Is there an endpoint that moves money from one of our virtual accounts to another of our virtual accounts? If so,
   please send its documentation.
2. If not, is a payout (`POST /payout/initiate`) to the other virtual account's account number and bank code the
   supported way? Does it debit the specific source virtual account, or our merchant balance as a whole?
3. If all our virtual accounts' money is held in one pooled merchant balance, is a transfer between two of them needed at
   all, or does the money stay in the same pooled balance whichever account it is recorded against?

## 2. Doing a transfer only once

1. If we send the same `clientReference` twice, is the second request refused, ignored, or processed as a second
   transfer?
2. If our request times out, can we always find out what happened with
   `GET /payout/requery?clientReference=…`? From how soon after the request?
3. Which statuses are final, and how long can a transfer stay unfinished?

## 3. Not enough money

1. What do you answer when the source account doesn't hold the amount? Please send a sample response.
2. Can a transfer leave a virtual account with a negative balance?

## 4. Fees

1. Does a transfer between two of our virtual accounts carry a fee? Is it taken from the amount sent, or charged
   separately, and from which balance?
2. Please send an example showing the amount debited, the amount credited and the fee.

Thank you for your help.

Kind regards,
AlphaKolect Integration Team

---

## Their answers

*To be recorded here, with the date, once TransactPay replies.*
