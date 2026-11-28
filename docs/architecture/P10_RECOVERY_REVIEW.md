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

## 3. The plan, section by section

| Plan section | Verdict | Why |
|---|---|---|
| §1 Scope, §2 findings due | **Redo the wording** | They name VA-to-VA transfers, TransactPay's questions and P9 condition 5; the findings (TA-12 restoring only on a confirmed charge, TA-25 suspension) still apply, in a new form |
| §3.1 Billing state and invoices (P10-2) | **Keep, review** | An invoice, its states and the periods do not depend on a provider; the states that wait for a provider answer (submitted, unknown) go |
| §3.2 Prices (BR-10.1, 10.2, 12.2) | **Keep** | Versioned pricing is independent of how money moves |
| §3.3 Billable agents (BR-10.6a) | **Keep** | The count, the owner's rule N2 and its tests are independent |
| §3.4 Billing dates, the run and the upcoming charge | **Keep, review** | The 90-day trial from email confirmation (N1), the dates and the run stand; what the run does at the end (an order) changes |
| §3.5 The charge (about 300 lines) | **Redo entirely** | It is the provider charge: orders, claims, unknown, not-found finality, reversal, retries. Replaced by an atomic posting (§4 here) |
| §3.6 Suspension enforcement (BR-10.4, TA-25) | **Keep, review** | Suspension after failed charges still stands; "failed" now means one thing: not enough share, not a provider doubt |
| §3.7 Restore (BR-10.5, TA-12) | **Redo the trigger** | Restoring "only on a confirmed charge" becomes restoring when the posting commits |
| §3.8 The switch, exemptions and the release guard | **Keep, review** | Billing stays off until released (BR-1.3), the release guard, the exemptions; the guard's reference to provider capabilities goes |
| §4 Interfaces, §5 Tests | **Revise** | Fewer states, fewer endpoints for finding unknown orders, new sufficiency and concurrency tests |
| §6 to §9 Obligations, decisions, questions, "before billing can charge" | **Redo** | The TransactPay questions are void; §9 and §9.1 (what to do when TransactPay answers) go; the release conditions become Paystack's and the owner's |
| §10 to §17 The build and the six reviews | **Keep as history** | They record what was found, and much of it (locks, periods, ledger postings) is still true |

**A count, so the size of the redo is known:** the plan mentions TransactPay 56 times, in §1 to §3.5, §3.8, §5, §6 to §9.1 and §10 onward; §3.5 alone is about a quarter of the document.

## 4. The charge, redesigned in outline (to be settled in revision 9)

This is the shape the revised plan must work out and the reviewer must test, not a design:

1. **One transaction, two ledgers.** For each business and period: debit the business's wallet account (1100) and credit its subscription expense (5100), and in the platform's ledger debit the platform wallet (1100) and credit subscription income (4100): the traces P9 already wrote down (plan §3.5 of P9). Both postings commit together or neither does.
2. **Idempotent by period.** The posting's key is the business and the billing period, so a retry, a crash or a second worker posts once. This is what the unknown-order machinery was for; here the ledger's own idempotency record is enough.
3. **Sufficiency inside the transaction.** The share is checked against the invoice **under the locks the posting takes**, not before: a check outside the transaction can be stale by the time it posts. Not enough: nothing is posted, the failure is counted, and the retry and suspension rules of §3.5 and §3.6 (as the owner decided them) apply.
4. **Lock order.** The two ledgers' projections are taken in the order the lock guard pins, with the billing rows in their category; the posting core already refuses to wait (L6). The revised plan must name the footprint and pin it in the guard.
5. **No worker claim for a charge**, unless the run itself needs leasing for scale. The run can be one function that finds due invoices and posts each in its own transaction.
6. **What a share is not.** A credited share is not Paystack money available (P9-35). A charge between two shares moves no money at Paystack, but the platform's share is then AlphaKolect's revenue sitting in the pooled balance; paying it out is a payout (off), after settlement.
7. **Failure and reversal.** A reversed deposit (a provider reversal after credit) goes to a person (P9, plan E1); whether a charge already posted against that deposit stands is a question for the revised plan and the owner.

## 5. Decisions the revised plan needs, and who makes them

| # | Decision | Whose | Recommended |
|---|---|---|---|
| 1 | What a business whose share is too small for its invoice experiences: the retry cadence, the suspension point, held months (the owner answered the retry, suspension and held-month rules for the provider charge, in the F and G forms) | Owner, if the answers do not carry over | Carry the owner's answers over unchanged where the facts are the same, and ask again only where "failed" meant a provider doubt |
| 2 | Whether billing may charge a share that is credited but not yet settled | Project lead | **Yes**: it moves nothing at Paystack. Payout is the gated step |
| 3 | A deposit reversed after a charge was posted against it | Owner and lead | A person decides (as P9 E1), nothing automatic |
| 4 | The stamp duty and transfer fee on a later payout | Owner (answered, Q9: the business bears them) | P10 builds the posting; payouts stay off until then |
| 5 | Whether the run needs leasing or a worker | Reviewer | A single idempotent function first; leasing only if scale needs it |
| 6 | The release guard's conditions with no provider facts to wait for | Lead | Billing stays off until the lead releases it (BR-1.3), with the ledger and suspension tests green in CI |

**Questions for Paystack:** none for billing itself, which calls Paystack for nothing. The open Paystack questions (identity, settlement, custody) are P9's and gate going live, not the design of the charge.
