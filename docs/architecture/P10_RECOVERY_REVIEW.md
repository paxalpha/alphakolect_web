# P10 (billing) recovery review: what stands, what is redone, now that the provider is Paystack

**Prepared:** 28 November 2026, on branch `feat/p10-billing-paystack` (from the P9 Paystack line, with the earlier `feat/p10-billing` merged in). **Status:** a review that decides what the next revision of the plan must change. **It builds nothing and approves nothing:** the revised plan (revision 9) is the next
document, and it goes to the independent reviewer before any code.

**Why a review first.** The plan on `feat/p10-billing` (revision 8, 1,283 lines, six plan reviews and the owner's answers) was written around **TransactPay**. It assumed a provider call to charge a subscription, with its own finality rules, status table and reversal window. The owner has since decided
(Paystack form Q5, 19 November 2026) that **a subscription payment is a book entry between two wallets, with no provider call**. That does not delete a section of the plan; it changes what the charge *is*, and everything built on the charge's lifecycle with it.

## 1. The baseline, as it stands

| | |
|---|---|
| The plan | `P10_IMPLEMENTATION_PLAN.md`, revision 8, from `feat/p10-billing`; unchanged here (merged as it was) |
| Built | **Nothing.** No migration, no code. P10 has only ever been a plan and the owner's forms |
| The owner's decisions | Answered: `P10_OWNER_BILLING.md` (Q1 to Q14), the follow-up (F1 to F5), the confirmation (C1, F6), the second follow-up (G1, G2) and the rule notes (N1, N2, now under rules 2.5 and 10.6 of `BUSINESS_RULES.md`). **These stand**, except where they assumed how the money moves |
| The provider | Paystack, not TransactPay (P9 revision 8). One pooled balance; no transfer between accounts; payouts off |
| The reviewer's last word on it | The sixth plan review: "strong draft, not approved", gated on the owner's answers (now in) and TransactPay's (now void) |
| Nothing deployed | No live money anywhere; P9 itself is open |

## 2. What changed under the plan

1. **The charge is not a provider call.** With one Paystack balance and no transfer between accounts, the business's payment to AlphaKolect moves nothing at Paystack: the business's wallet share goes down and AlphaKolect's goes up, **in the books, in one database transaction**.
   The money stays in the same Paystack balance until it is paid out.
2. **So the hard parts of the old charge disappear.** An unknown outcome after a timeout, a lookup that finds nothing, a "not found is final" rule, a reversal window, a provider status table, a repeated reference: all of them existed because a charge could be in flight at a provider. A posting inside one transaction is committed or it is not.
3. **New hard parts take their place.** The sufficiency of the business's share, who may charge and when (the lock order), what the books mean when Paystack has not yet settled the money behind a share, and what a suspended business may do with a share it already holds.
4. **Payouts stay off** (P9-22), and the stamp duty and transfer fee are P10's to post when they come (owner Q9).
5. **Settlement is a separate state** (P9-35): a wallet share credited is not money available to pay out, and a charge between two shares does not change what Paystack holds.
