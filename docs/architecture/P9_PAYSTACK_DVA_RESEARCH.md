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

## 4. Account naming, providers and inbound transfer approval

- **Default naming:** Paystack-Titan and Wema accounts show "Paystack Business Name / Customer Name" in the support article; the developer documentation says "Product Name / Customer Name". The small inconsistency means the **name the API returns, and Paystack's written confirmation, are authoritative**.
- **Length and characters:** no published DVA account-name length limit was found. To ask: maximum length, allowed characters, truncation, whether the B2B2C name has its own limit, and whether the customer name is always the validated BVN name.
- **Inbound Transfer Approval:** Paystack's support documentation says it is available **only on Paystack-Titan** virtual accounts, and lets a merchant accept or reject an incoming credit before it is processed (the webhook must answer within 5 seconds, or Paystack accepts it). It could enforce
  customer limits, restrict third-party deposits (Paystack describes comparing the sender's name), or block suspended accounts. **Not to be assumed enabled for AlphaKolect:** ask whether it is available on the integration, whether it works through the API, its webhook and response rules, what a rejection does, and what happens to a transfer the sender has already made.

## 5. Who is told when money arrives

| Notification | Public documentation |
|---|---|
| The merchant, by email | Documented |
| The merchant's Dashboard transaction | Documented |
| The merchant's webhook (`charge.success`) | Documented |
| An SMS to the DVA's customer | No documented guarantee found |
| An email to the DVA's customer | No documented guarantee found |

**Recommendation recorded:** AlphaKolect plans to send **its own** customer notification, and only **after** the payment has been authenticated, confirmed with Paystack and posted to the ledger. A webhook that merely reached the server is not a reason to tell a customer their money arrived.

## 6. Test mode against live mode

DVAs are available to registered businesses in Nigeria and Ghana that have **completed go-live**. For Nigerian testing Paystack documents `preferred_bank = test-bank` and a demo bank app for transfers into those accounts. The customer-validation documentation gives a special
test credential, and explains that real validation is done with live keys.

So: a `test-bank` account assignment is useful integration evidence; a `test-bank` transfer is useful webhook and reconciliation evidence; a **test customer accepted without live identity checks does not prove a real customer will pass live validation**, and a test-mode success does not
establish AlphaKolect's eligibility for live DVA use. Paystack's customer API says first name, last name and phone are **compulsory** when creating a DVA customer in the specified categories, so the earlier sandbox's acceptance of an incomplete customer is not permission to omit them live.

## 7. DVA fees, and who bears them

**The published rate** (Nigeria): 1% of the transaction, capped at ₦300 (support article and the pricing page): fee = min(1% × amount, ₦300). From the published rate only, not a guarantee of an invoice: ₦1,000 gives ₦10; ₦5,000 ₦50; ₦10,000 ₦100; ₦30,000 ₦300; ₦100,000 ₦300 (the cap).

**Not established, to be confirmed in writing:**
- whether the DVA fee is deducted from the merchant's settlement, and whether it can be passed to the payer or taken from what the customer is credited (the general "pass the fee on" documentation is about checkout, and is not to be assumed to cover inbound DVA transfers);
- whether any separate charge applies to a rejected or reversed transfer;
- **whether VAT is added**: the Nigerian DVA pricing row does not say its fee is VAT-exclusive (other rows say so for other fees), so a 7.5% VAT on top is neither shown nor excluded by that page.

**For P10:** model the DVA fee and any tax as **separate ledger entries** until Paystack confirms the treatment.

## 8. Settlement, and what "available" means

Three different events, which must not be collapsed:

1. **The bank transfer succeeds** at the payer's bank.
2. **Paystack reports it**: the `charge.success` webhook, which Paystack says is typically within a few minutes and can take longer.
3. **The money becomes available for payout.** Paystack's balance documentation says a successful payment is not at once transfer balance: the balance endpoint shows what is available to send, after settlement on the merchant's schedule.

Nigeria's standard automatic payout is **T+1** (next working day; weekends and public holidays do not count). A manual payout option exists, with its own eligibility and approval.

**What it means for AlphaKolect.** A `charge.success` webhook does not mean the funds can be sent; a ledger credit does not mean Paystack has settled it; and the balance endpoint will not at once show a recent DVA transfer. The platform must tell apart:

| State | Meaning |
|---|---|
| Payment received | Paystack has confirmed the incoming transaction |
| Ledger credited | AlphaKolect has recorded the customer's accounting balance |
| Settlement pending | The funds have not yet become available in the merchant's Paystack balance |
| Available balance | What Paystack reports as available for transfers |
| Paid out | The funds have actually been sent to the destination |

AlphaKolect must not let a customer withdraw merely because its ledger credited an amount: settlement and liquidity risk are managed separately.

## 9. The 1,000-account limit

Paystack's support documentation says a business has a **default limit of 1,000 virtual accounts** assigned to customers, and that an increase can be asked for (the developer documentation says it is subject to a review of the business and use case). If AlphaKolect is to give **one DVA to each
participating business or savings group**, whether 1,000 is enough, and whether the limit is per integration, per merchant or another grouping in AlphaKolect's own setup, has to be settled before scaling.

## 10. Claim by claim

| Claim | Verdict | Correction or qualification |
|---|---|---|
| AlphaKolect likely falls under Financial Services | Supported as a possibility | The exact category depends on the operating model and Paystack's classification |
| Savings, Financial Cooperatives and Mobile Wallets are Financial Services categories | Verified | All appear on Paystack's list |
| Financial Services DVA customers need name and phone | Verified | First name, last name and phone become compulsory |
| Financial Services customers need identity validation | Verified | For Nigerian businesses in this category |
| BVN and a bank account are required | Verified | The account must be connected to the BVN |
| The business-customer BVN model is undocumented | Verified | No clear entity-customer identity flow found |
| A business name can simply be used as first name | **Unsupported** | Successful validation updates names to the BVN-registered names |
| Paystack offers B2B2C account naming | Verified | Subject to Paystack's review and extension |
| The naming feature proves business-customer validation is supported | **False inference** | Naming and identity verification are separate |
| Paystack does not notify the customer | Not established | Public documentation describes merchant notifications only |
| The DVA fee is 1% capped at ₦300 | Verified | Allocation and VAT remain open |
| Funds are available immediately after the webhook | **Incorrect** | Payment notification and payout availability are separate |
| Nigerian standard settlement is T+1 | Verified | Next working day, under the standard automatic schedule |
| Inbound Transfer Approval is Titan-only | Verified | Paystack says so |
| DVA is for registered businesses that complete go-live | Verified | Nigeria and Ghana |
| The default account limit is 1,000 | Verified | Increases are subject to review |

## 11. Three ledgers, not one

The documentation makes it important not to collapse three things:

1. **The Paystack transaction record**: what Paystack reports as an incoming payment: reference, status, amount and fee.
2. **AlphaKolect's customer ledger**: what AlphaKolect owes or records for each savings group or business.
3. **Paystack's settlement and available balance**: what has actually settled and can be paid out.

Reconciliation must connect all three **without assuming they are equal at the same moment**. That protects against duplicate webhooks, settlement delays, rejected transactions, reversals and discrepancies.

## 12. Sources to keep

Paystack: Dedicated Virtual Accounts; Validate Customer; the Customer API; the Dedicated Virtual Account API; the dedicated virtual accounts support article; Supported businesses; How to activate your business; Inbound Transfer Approval; Transactions pricing; Getting your money; Check your balance.
