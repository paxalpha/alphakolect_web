# To TransactPay: incoming deposits and balances

**To:** TransactPay Support
**From:** AlphaKolect Integration Team
**Prepared:** 10 November 2026
**Why:** these answers decide whether AlphaKolect can switch on real deposits (P9 plan §10, conditions 1 and 3). Drafted
by the independent reviewer, 10 November 2026.

---

Hello TransactPay Support Team,

We are completing the integration of TransactPay virtual accounts into AlphaKolect. We need two things clarified before we
enable real-money transactions.

## 1. Simulating an incoming virtual-account deposit

Can you provide a way to simulate a successful bank transfer into a virtual account in your sandbox?

We have generated virtual accounts and retrieved their details, but we have not been able to set up an incoming deposit.
Please tell us:

1. Is there a sandbox tool, dashboard action, test bank account or API endpoint for simulating an incoming transfer into a
   generated virtual account?
2. What exact steps should we follow to make the test deposit?
3. What webhook event should we expect? Could you send a complete sample payload?
4. Which endpoint should we call to confirm the deposit independently?
5. Which fields identify the destination virtual account, and the transaction's final status?
6. Are incoming amounts returned in naira or in kobo?

If automated simulation is not available, could your team arrange a controlled test deposit into one of our sandbox virtual
accounts?

## 2. Virtual-account balances and reconciliation

Our balance-enquiry response contains both `availableBalance` and `collection`. Please tell us:

1. Which field represents money received through generated virtual accounts?
2. Does `availableBalance` include virtual-account collections?
3. What exactly does `collection` represent?
4. Are virtual-account balances pooled into one merchant balance, or can each virtual account's balance be queried on its
   own?
5. If balances are pooled, what is the recommended way to reconcile deposits belonging to each virtual account?

If possible, please send a sample balance response from before and after a successful virtual-account deposit.

We need these details so that AlphaKolect credits only deposits TransactPay has confirmed, and reconciles its ledger against
the right TransactPay balance.

Thank you for your help.

Kind regards,
AlphaKolect Integration Team

---

## Their answers

*To be recorded here, with the date, once TransactPay replies.*
