# Paystack dedicated virtual accounts: what the public documentation does and does not establish

**Recorded:** 28 November 2026. **Source:** an independent check of Paystack's official developer documentation, API references and support articles, brought to the project on 28 November 2026 (the reviewer's research
note). **Not re-verified by the engineering side:** it is recorded here so the project has it, with the sources, and so no later decision rests on a memory of it. **Status:** research, not a decision; the decisions it bears on are in
`P9_IMPLEMENTATION_PLAN.md` §16.14.

**One-paragraph conclusion.** Paystack's dedicated virtual account (DVA) is a **customer-linked payment collection facility for a merchant**. It is not documented as a way to open independent bank accounts for other businesses, or to hold
their money in legally separate custody. Paystack does document a B2B2C **account-naming** feature, but naming is not identity validation and not custody. **Whether AlphaKolect may assign a DVA to each independent business, validate that business
without an individual's BVN, and keep an internal ledger per business is not established by the public documentation: condition 3 is genuinely open**, and the question has been put to Paystack in writing.

## 1. The business category

Paystack's "Supported businesses" page lists, under **Financial Services**: Financial Cooperatives, Financial Technologies, Payment Solution Service Providers, Savings, Mobile wallets, Lending, Insurance, Investments and Remittances.
Paystack explains that *industry* is the broad sector and *category* the more specific goods or services paid for, that the merchant picks them in its Compliance form, and that a merchant who is unsure should ask Paystack.

**What it means.** Financial Services is a serious classification to investigate, but it is **not** to be assumed: AlphaKolect's activities may fall under Financial Services (Financial Technologies, Savings, Financial Cooperatives or Mobile Wallets), and
Paystack must classify them from AlphaKolect's legal structure, services, fund flows and relationship with the savings groups. Two operating models differ in compliance weight:

- **Model A, technology provider:** AlphaKolect supplies software to microfinance institutions and savings groups, who stay responsible for their financial activities.
- **Model B, financial intermediary:** AlphaKolect runs the payment collection and ledger, receives funds associated with several groups, and manages balances or onward movement.

**Recommendation recorded:** ask Paystack to classify the exact operating model in writing. Do not choose a category to make the DVA API work.
