# To TransactPay: moving money between virtual accounts

**To:** TransactPay Support
**From:** AlphaKolect Integration Team
**Prepared:** 11 November 2026
**Why:** AlphaKolect's billing (P10 plan §9, conditions 1–5) takes each business's monthly subscription from its
virtual account into AlphaKolect's own. These answers decide whether billing can be switched on. Send them together with
`P9_TRANSACTPAY_FOLLOWUP.md` (deposits and balances), which asks the related balance questions.

---

Hello TransactPay Support Team,

AlphaKolect gives each business that uses it a TransactPay virtual account, and has one virtual account of its own. Each
month we need to move a business's subscription from the business's virtual account into AlphaKolect's. We need five
things clarified before we do this with real money, and would like to test each in your sandbox.

## 1. Moving money from one virtual account to another

1. Is there an endpoint that moves money from one of our virtual accounts to another of our virtual accounts? If so,
   please send its documentation.
2. If not, is a payout (`POST /payout/initiate`) to the other virtual account's account number and bank code the
   supported way? Does it debit the specific source virtual account, or our merchant balance as a whole?
3. If all our virtual accounts' money is held in one pooled merchant balance, is a transfer between two of them needed at
   all, or does the money stay in the same pooled balance whichever account it is recorded against?
4. Your payout request lists `accountName`. When the destination is one of our own virtual accounts, what must it hold:
   the name your account-details endpoint returns for that account, or the result of `POST /payout/name-enquiry`? What
   happens if it doesn't match?

## 2. Doing a transfer only once

1. If we send the same `clientReference` twice, is the second request refused, ignored, or processed as a second
   transfer? If it is refused or ignored, does your answer give the first transfer's result and status, and is that so
   for as long as the first one is unfinished?
2. If our request times out, can we always find out what happened with
   `GET /payout/requery?clientReference=…`? From how soon after the request, and for how long afterwards? What does it
   answer for a reference you never received, and how does that differ from a transfer that failed?
3. Please list every status a transfer can have, which of them are final, and which mean the money has left the source
   account. How long can a transfer stay unfinished?
4. Can a transfer that you reported as failed later succeed, or one reported as successful later be reversed?

## 3. Not enough money

1. What do you answer when the source account doesn't hold the amount? Please send a sample response.
2. Can a transfer leave a virtual account with a negative balance?

## 4. Testing this in the sandbox

1. Can we make a transfer between two of our sandbox virtual accounts, and see both balances change?
2. Can we make your sandbox time out, refuse for lack of money, or leave a transfer pending, so that we can test how we
   handle each?

## 5. Fees

1. Does a transfer between two of our virtual accounts carry a fee? Is it taken from the amount sent, or charged
   separately, and from which balance?
2. Please send an example showing the amount debited, the amount credited and the fee.

Thank you for your help.

Kind regards,
AlphaKolect Integration Team

---

## Their answers

*To be recorded here, with the date, once TransactPay replies.*
