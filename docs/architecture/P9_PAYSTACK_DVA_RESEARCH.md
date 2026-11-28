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

## 2. What a DVA customer must give

Paystack's support documentation lists three basic customer requirements: **a phone number, a full name and an email address**; and it says businesses in **Financial Services, Betting and General Services must validate their customers**.
The developer documentation adds that, for Nigerian businesses in those categories, the customer's **identity must be validated before a DVA is generated**, and that the same information is used to name the bank account.

The single-step assignment for the categories that must validate takes these fields: `email`, `first_name`, `middle_name`, `last_name`, `phone`, `preferred_bank`, `country`, and **`account_number` (linked to the BVN), `bvn` and `bank_code`**. The request is
**asynchronous**: Paystack answers "in progress" and reports the validation and the assignment by webhook (`customeridentification.success` or `.failed`, `dedicatedaccount.assign.success` or `.failed`). So validation must succeed before the assignment succeeds,
but the single-step call does not finish the whole thing in one HTTP response.

### 2a. The BVN, and the name that follows from it

Paystack's validation needs a customer's **BVN and a bank account connected to that BVN**. Documented failures include an account that cannot be resolved, and a wrong account name, BVN or account number. **When validation succeeds, the customer's
`first_name` and `last_name` are updated to the name on the BVN, and cannot then be changed through Update Customer; changing them needs revalidation.**

So the name fields are not display labels where identity validation applies. The idea of sending `first_name` as a business name and `last_name` as "Business" is therefore not a documented workaround, and the code's current choice of those fields
(plan P9-21) is **unproven for a live validating account**. The sandbox accepted it only because test mode does not validate.

### 2b. What the public documentation leaves unanswered

| Question | Public documentation |
|---|---|
| Can a Nigerian registered company be the DVA customer without an individual's identity? | Not established |
| Whose BVN: a director's, a beneficial owner's, the savings group's operator's? | Not established |
| Can a company name be used as `first_name`? | Not established; validation overwrites the name with the BVN's |
| Can the BVN name differ from the proposed customer name? | Validation documentation indicates the name matters; no business-entity exception is documented |
| Can one business customer have a DVA without collecting an individual's personal identity? | Not established |

**Verdict recorded: condition 3 is genuinely unresolved.** A BVN collection form must not be designed around an assumed answer.

## 3. A business customer is not an individual customer

A DVA is assigned to a **customer record**: create a customer; validate it where required; create the DVA for it. The validation is built on **personal** identity (BVN and a bank account). No public documentation was found establishing a separate **legal-entity**
verification flow for assigning a DVA to a business customer. That is not proof that Paystack cannot support the use case: it is that the public documentation does not establish it.

**The B2B2C naming feature does not settle it.** Paystack offers a naming feature for businesses that provide virtual accounts as a service to other businesses (its example: a school-management platform whose accounts show the school's name instead of the platform's), by
contacting support for review. Two separate questions:

| | |
|---|---|
| Documented | Paystack can customise the account name for B2B2C businesses, subject to its review |
| **Unresolved** | Whether a company itself can be the validated DVA customer without an individual's BVN |

**Naming is not custody either.** Paystack describes DVAs as payment accounts linked to its merchant business, whose incoming transfers are recorded as transactions from the assigned customer. That does not establish that each business customer has a separately
safeguarded balance, that funds are held in trust for it, that it can withdraw independently, that the merchant's balance is segregated by customer, or that Paystack has approved a pooled-funds arrangement for AlphaKolect. **An internal ledger separates balances in
software and accounting; it is not evidence of legal segregation.** This is why the custody letter and the legal review stay independent live-money gates.
