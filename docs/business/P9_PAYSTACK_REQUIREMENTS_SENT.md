# To Paystack: the clarification request that was sent (28 November 2026)

**To:** `support@paystack.com` (Paystack's published support address). **Sent from:** the owner's side, through the connected Gmail account, on 28 November 2026, **reported to the engineering side; the sent copy is in that mailbox**. **Subject:** "Formal Clarification Request: Dedicated Virtual
Accounts for AlphaKolect's Multi-Business Savings Platform". **Prepared in:** the research note recorded in `docs/architecture/P9_PAYSTACK_DVA_RESEARCH.md`. **Replaces, for the questions it covers:** the earlier draft `P9_PAYSTACK_REQUIREMENTS_REQUEST.md`, which was never sent.

**Why this was sent before anything is built:** the message says so itself: *we are intentionally seeking clarification before collecting personal identity information, implementing customer-validation forms, assigning accounts or enabling live payment operations.*

**Answer awaited. Condition 3 stays open until Paystack replies in writing**, and D2b waits for the reply to items 1 and 2 (plan §16.14).

The eight questions, as the text sent covers them:

1. **Business classification and eligibility.** Which Industry and Category AlphaKolect should select on its Paystack Compliance profile: Financial Technologies, Savings, Financial Cooperatives, Mobile Wallets, Payment Solution Service Providers or another; and whether the proposed multi-business DVA use is permitted under the right classification.

2. **Business customer identity validation.** Our intended customers may be registered companies, cooperative societies or other savings-group entities, not individual consumers. Can a registered business or cooperative be created and validated as the DVA customer? If personal BVN validation is required, whose BVN: a director's, a beneficial owner's, an authorised signatory's or another individual's? Can the registered business name be used in the customer record? Must the first and last names match the name on the BVN? Is there an approved business-entity validation alternative? The required API fields and the supported validation procedure.

3. **B2B2C account naming.** Whether the B2B2C naming feature can be enabled for AlphaKolect; the supported naming format, maximum account-name length, permitted characters, truncation behaviour, and whether it is available with both Wema and Paystack-Titan.

4. **Customer notifications.** When a transfer arrives in a DVA, whether Paystack sends an SMS or email directly to the customer or only notifies the merchant (email, Dashboard, webhooks); and whether customers are notified of failed, rejected or reversed transfers.
