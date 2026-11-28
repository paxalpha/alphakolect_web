# Paystack dedicated virtual accounts: what the public documentation does and does not establish

**Recorded:** 28 November 2026. **Source:** an independent check of Paystack's official developer documentation, API references and support articles, brought to the project on 28 November 2026 (the reviewer's research
note). **Not re-verified by the engineering side:** it is recorded here so the project has it, with the sources, and so no later decision rests on a memory of it. **Status:** research, not a decision; the decisions it bears on are in
`P9_IMPLEMENTATION_PLAN.md` §16.14.

**One-paragraph conclusion.** Paystack's dedicated virtual account (DVA) is a **customer-linked payment collection facility for a merchant**. It is not documented as a way to open independent bank accounts for other businesses, or to hold
their money in legally separate custody. Paystack does document a B2B2C **account-naming** feature, but naming is not identity validation and not custody. **Whether AlphaKolect may assign a DVA to each independent business, validate that business
without an individual's BVN, and keep an internal ledger per business is not established by the public documentation: condition 3 is genuinely open**, and the question has been put to Paystack in writing.
