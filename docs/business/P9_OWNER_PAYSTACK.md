# AlphaKolect: Moving payments from TransactPay to Paystack

**For:** the owner of AlphaKolect
**Prepared:** 19 November 2026
**Why:** The project lead has decided that AlphaKolect's payments provider is Paystack, and that TransactPay is removed.
The code is changed (payments plan revision 8, section 16). Paystack works differently from TransactPay in four ways that
touch money or rules you have approved, so each needs your answer before real money flows. Nothing here moves real money:
the system runs against Paystack's test mode only until you and the project lead say otherwise.

**Answered by:** ______________________ **Date:** ______________________

*Please tick one answer for each question. If you are not sure, tick "Not sure" and we will explain it in person.*

---

## Q1. Where all the money sits

With Paystack, the money of every business sits together in **one balance on AlphaKolect's own Paystack account**. Paystack
gives each business its own bank account number to receive transfers, but it does not keep a separate balance per number
and cannot move money between them. How much belongs to each business is recorded in AlphaKolect's books, and the system regularly
checks that Paystack's one balance equals the total of the books. (TransactPay's balance worked the same way in
what we could see, but it was never confirmed.)

This is the same question as the open custody point on customer wallets (OPEN-12): who legally holds the money. It must be
answered in writing before real money, whatever the provider.

- ☐ **Understood. Build and test with Paystack's test mode only; no real money until custody is confirmed in writing
  with Paystack and a lawyer.** *(Our suggestion.)*
- ☐ Stop: I want to speak to a lawyer or to Paystack before any more is built.
- ☐ Not sure

> Answer:

---

## Q2. Who pays Paystack's fee on money received

Paystack keeps a fee from each transfer a business receives. The system records the fee Paystack states, and today it credits
the business's wallet with **what actually arrived (the amount less the fee)**, so the books always match Paystack's balance.

- ☐ **The business bears the fee: its wallet is credited the amount less the fee.**
  *(Our suggestion; built.)*
- ☐ AlphaKolect bears the fee: the wallet is credited the full amount, and the fee is AlphaKolect's cost. *(Needs more to be
  built, and a new account in the books.)*
- ☐ Not sure

> Answer:

---

## Q3. The name a payer sees

When someone transfers to a business's account number, their bank shows the account name. Paystack builds it as
"AlphaKolect / <first name> <last name>". A business is not a person, so the system gives the business's name as the first
name and a word as the last name:

| What the payer sees | Example |
|---|---|
| AlphaKolect / Ade Stores **Business** | the word is "Business" |

- ☐ **Use the word "Business".** *(Our suggestion; built.)*
- ☐ Use the word "Wallet" instead.
- ☐ Something else: ______
- ☐ Not sure

> Answer:

---

## Q4. Identity checks Paystack may ask for

Paystack requires a **phone number** for the customer each account number is made for, and, for businesses in some categories
(financial services is one), the **BVN and a bank account** of that person, which it uses to name the account. AlphaKolect
collects none of these today, so **no business is given an account number yet: wallet creation is switched off** until this is settled. We do not know
which category Paystack will give AlphaKolect: that is decided when the Paystack account goes live. If Paystack requires
them, no business gets an account number until we collect them (the request fails safely and is shown to the AlphaKolect team).

- ☐ **Not now. We ask Paystack in writing which category applies and exactly what it requires. Then we come back to you with a
  form about collecting the phone and, if required, the BVN (a privacy decision).** *(Our suggestion.)*
- ☐ Collect the owner's phone number, and BVN and bank account if Paystack requires them, at registration from now on.
- ☐ Not sure

> Answer:

---

## Q5. Subscription payments between wallets (P10)

Because Paystack keeps one balance and cannot move money between accounts, when a business pays its AlphaKolect subscription
the payment will be **a movement in AlphaKolect's books only**: the business's wallet goes down and AlphaKolect's wallet goes
up, and nothing moves at Paystack. The money stays in the same Paystack balance until you pay it out to a bank account.

- ☐ **Understood and agreed.** *(Our suggestion.)*
- ☐ I want subscriptions paid another way: ______
- ☐ Not sure

> Answer:

---

## Q6. The rules that name TransactPay

Three approved rules name TransactPay: 1.4 (you own every account, including TransactPay), 2.4 (close the ~197 accounts made
for fake sign-ups with TransactPay) and 4.1 (each Live wallet is a TransactPay bank account). We do not change an approved
rule without you. We propose a dated note under each, word for word:

> **1.4, 2.4 and 4.1, note of 19 November 2026.** The payments provider is now Paystack. Where these rules say TransactPay,
> they now say Paystack, and the Paystack account is AlphaKolect's own. The accounts made at TransactPay for fake sign-ups
> are still to be closed there, as rule 2.4 says.

- ☐ **Add the note as written.** *(Our suggestion.)*
- ☐ Add it with these changes: ______
- ☐ Do not add it.
- ☐ Not sure

> Answer:

---

## Q7. The old TransactPay accounts

Rule 2.4 says the ~197 accounts made at TransactPay for fake sign-ups, and the four verified test accounts (OPEN-14), should be
closed. Closing them needs TransactPay's help, and the relationship is ending.

- ☐ **Ask TransactPay to close all of them before the relationship ends.** *(Our suggestion.)*
- ☐ Leave them; we are not using TransactPay again.
- ☐ Not sure

> Answer:

---

## Q9. Who pays to send money out

When AlphaKolect sends money out of Paystack to a bank account (the first time is in billing, P10), Paystack takes a **transfer
fee** and, from ₦10,000, a **₦50 stamp duty** out of AlphaKolect's one balance, **on top of** the amount sent. Nothing sends money
out yet: payouts are switched off, and cannot be switched on in production, until the books carry both charges.

- ☐ **The business bears both: its wallet is debited the amount, the fee and the stamp duty.** *(Our suggestion.)*
- ☐ AlphaKolect bears both: they are AlphaKolect's cost.
- ☐ Not sure

> Answer:

---

## Q8. Is the Paystack account ready?

Paystack lets a business make dedicated accounts only once its business account has gone live (registration documents
accepted). Test mode needs nothing.

- ☐ The Paystack business account has completed go-live.
- ☐ **Not yet; the work continues in test mode.** *(What we assume.)*
- ☐ Not sure
- ☐ There is no Paystack account yet. I will create it myself and give no one else its password.

> Answer:

---

*Until you answer, the build follows our suggestions in test mode only. Thank you; we will record your answers with the date.*
