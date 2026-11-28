# P10 (billing) recovery review: what stands, what is redone, now that the provider is Paystack

**Prepared:** 28 November 2026, on branch `feat/p10-billing-paystack` (from the P9 Paystack line, with the earlier `feat/p10-billing` merged in). **Status:** a review that decides what the next revision of the plan must change. **It builds nothing and approves nothing:** the revised plan (revision 9) is the next
document, and it goes to the independent reviewer before any code.

**Why a review first.** The plan on `feat/p10-billing` (revision 8, 1,283 lines, six plan reviews and the owner's answers) was written around **TransactPay**. It assumed a provider call to charge a subscription, with its own finality rules, status table and reversal window. The owner has since decided
(Paystack form Q5, 19 November 2026) that **a subscription payment is a book entry between two wallets, with no provider call**. That does not delete a section of the plan; it changes what the charge *is*, and everything built on the charge's lifecycle with it.
