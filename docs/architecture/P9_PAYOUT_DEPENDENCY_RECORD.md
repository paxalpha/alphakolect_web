# P9 → P10: what payouts need before they can be switched on

**Prepared:** 25 November 2026. **Status:** a record of what P9 leaves to P10, with the owner's decision where there is one. It builds nothing.
**Rule until then:** payouts are **off** (`PAYSTACK_PAYOUTS`, default off), and `on` is **refused in production** (plan §16.5 P9-22). No order is created by any
P9 code path (owner Q2): payouts are P10's first use.

## 1. Decided

| Question | Decision | Source |
|---|---|---|
| Who bears the transfer fee and the stamp duty on a payout | **The business**: its wallet is debited the amount, the fee and the stamp duty | Owner, Paystack form Q9, 19 November 2026 |
| Who bears Paystack's fee on money received | The business: credited the amount less the fee | Owner Q2 |
| A payment between two wallets (a subscription) | A book entry, no provider call | Owner Q5 |

## 2. What Paystack does (documentation read 19 November 2026; not seen in test mode)

- The transfer amount **and the fee** are deducted from the balance when the transfer is created ("how transfers work"); from ₦10,000 a ₦50 stamp duty applies as well.
- Statuses: success, reversed, failed, abandoned, blocked and rejected are conclusive; pending, received and otp are not (mapped in the adapter, P9-25).
- A transfer waits for an OTP unless the requirement is turned off in the dashboard ("Transfer approvals"); abandoned after 30 minutes.
- The reference is documented as the retry key: a retry of a non-conclusive transfer uses the **same reference**. P9 still never sends twice: it looks up.
- A reversal returns the amount to the balance after success has been reported.

## 3. What P10 must build and decide, then, before payouts

| # | Work | Why |
|---|---|---|
| 1 | **Post the three amounts** of a payout: the amount, the fee and the stamp duty, each on its own line (the fee and duty from Paystack's own figures on the transfer, never computed here), against the business's wallet, with a new chart account for provider fees in every ledger, as account 2290 was added in P9 | Today `record_order` posts the amount alone, so a payout would leave a difference between the books and Paystack's one balance that nobody can explain |
| 2 | Decide **when** the fee is known: Paystack returns `fee_charged` on the transfer; a payout must not post until it is, or post an estimate and correct it | The reconciler compares to the cent |
| 3 | A **late reversal** (success, then reversed): how it is posted, who is told, and that the amount, the fee and the duty come back or not | An order is final once it succeeds; the books would not follow |
| 4 | **OTP off** for the account, with the account owner's explicit decision, and a test in Paystack's test mode | Otherwise a payout waits and is abandoned |
| 5 | The **daily limit and balance** checks: a payout must not be sent unless the wallet's share covers amount, fee and duty, and Paystack's balance covers them too | The wallet's share and Paystack's one balance can differ |
| 6 | **Idempotency** across the order, the reference and the lookup, as P9 built it (never sent twice), proven again against Paystack's test mode, including a dropped answer after the money moved | TA-8 |
| 7 | A **sandbox payout test** (test mode always returns success, so reversal, failure and a timeout are staged with the stand-in) and the evidence kept as P9 did | Plan §16.4 condition 8 |
| 8 | The owner's **explicit approval** before `PAYSTACK_PAYOUTS` is switched on anywhere, and a change of the production refusal in the same reviewed change | P9-22 |

## 4. What this closes for P9

Plan §16.4 conditions 8 and 13 stay **open and belong to P10**. P9 does not close them; it closes only by recording this dependency, the owner's decision, and the gate
(payouts off, refused in production). The independent reviewer's acceptance of that is what the P9 closure asks.
