# Custody: who holds the money, in writing, before any real money

**For:** the owner, to send to Paystack and to the lawyer
**Prepared:** 25 November 2026. **Not sent.** The owner decided (Paystack form, Q1, 19 November 2026) that nothing real is processed
until custody is confirmed in writing with **both** Paystack and a lawyer. This is plan §16.4 condition 11 and the open point OPEN-12.

## The model, as the system is built

- AlphaKolect has **one Paystack business account** and so **one Paystack balance**, in AlphaKolect's own name.
- Each business that joins receives **its own bank account number** (a Paystack dedicated virtual account). A transfer to it arrives in the
  one balance. Paystack keeps no balance per account number and cannot move money between them.
- AlphaKolect's books record **what belongs to each business**. Each business's share is a record, and the books are checked against Paystack's
  one balance regularly.
- A business's subscription to AlphaKolect is a **book entry** (the business's share goes down, AlphaKolect's goes up); nothing moves at Paystack.
- Money leaves only by a payout from the one balance to a bank account. **Payouts are switched off** and cannot be switched on in production
  until their fees are in the books (P10).
- Paystack takes its fee from each transfer received; the business bears it, so its share is credited the amount less the fee (owner Q2).

## Questions for Paystack, in writing

1. In whose name is the balance held, and whose money is it in law while it sits there: AlphaKolect's, the business's, or the payer's until settled?
2. Is it permitted for AlphaKolect to hold, in one balance, money that belongs to many businesses, recording each share in its own books?
   What approvals or licences does Paystack require for that?
3. What happens to the money if AlphaKolect's Paystack account is suspended, closed or put on hold? Can a business get its share, and how?
4. What happens to a transfer that is reversed, disputed or returned after we have credited a business's share?
5. May AlphaKolect pay a business's share out to the business's own bank account from the one balance? Any limits, holds or settlement windows?
6. Who is liable for a transfer sent to a dedicated account number after the business has left AlphaKolect or the account has been closed?
7. Does Paystack's agreement with AlphaKolect restrict this model (for example "collect on behalf of third parties" or "aggregator" terms)?

## Questions for the lawyer, in writing

1. Does holding businesses' money in one Paystack balance, recorded in AlphaKolect's books, make AlphaKolect a custodian of funds, a payment
   service provider, or a deposit-taker under Nigerian law and the Central Bank's rules? What licence or registration, if any, is needed?
2. Whose money is it if AlphaKolect is insolvent: is it protected from AlphaKolect's creditors? What would make it so (a trust, a separate account, a licence)?
3. What must the agreements with each business say (terms of use, the fee they bear, what happens to their share on leaving)?
4. What are AlphaKolect's duties for anti-money-laundering, know-your-customer records and record keeping, given that businesses receive money in
   accounts created in their name?
5. Which rules apply to the customers' savings recorded in the books (customer wallets are records only today; **OPEN-12** is about them)?
6. What must be settled, and signed, before AlphaKolect handles the first real naira?

## What the answers must give the project

A written reply from each, a one-page statement of the model the owner approves (who holds the money, whose it is, what happens in each failure above),
and the owner's signature on it. The independent reviewer will check that what is built matches that page. Until then: test mode only.
