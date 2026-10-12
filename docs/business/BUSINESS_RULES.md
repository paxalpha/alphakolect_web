# AlphaKolect: Business Rules for the New System

**For:** the owner of AlphaKolect, to confirm
**Prepared:** 26 September 2026
**Based on:** your answers in the Business Decisions Questionnaire (Q) and the Follow-up (F).

These are the rules the rebuilt AlphaKolect will follow. Please read each one and mark anything that's wrong. **Once you confirm, these rules become the specification**: the system will be built and tested against them.

Rules marked **(please confirm)** are our reading of your answers, not your exact words.

---

## 1. Where we are today

1.1 **Nothing is live.** All businesses and records in the current system are test data. *(F-A1)*
1.2 Test data may be cleaned up or reset. Nothing needs to be carried into the new system unless you ask. *(F-A1)*
1.3 **Automatic billing is paused** for everyone until the new billing system is ready. No business is charged or suspended in the meantime. *(F-A2)*
1.4 You own every account (server, GitHub, TransactPay, email, domain). Your son works with **his own separate login**, which you can remove at any time. *(F-A4)*

## 2. Businesses (merchants)

2.1 Anyone may sign up on their own. *(Q2c)*
2.2 A business is **real only after it confirms its email address**. *(Q2a)*
2.3 A business gets a **Live wallet (bank virtual account) only after confirming its email**. Unconfirmed sign-ups get nothing. *(Q2a, Q3c)*
2.4 The ~197 virtual accounts created for fake sign-ups should be closed with TransactPay. *(Q3a, Q3d)*
2.5 Every business gets a **90-day free trial** from sign-up. *(Q9b)*

## 3. Who can do what

| Who | Can | Cannot |
|---|---|---|
| **You (Super Admin)** | Everything on the platform | — |
| **Platform staff** (support, verification, finance) | Only what you grant each one; may see a business's customer or money records **only if you give that permission** *(Q7e, F-B4)* | Anything not granted |
| **Business owner** | Run their own business; decide their staff's permission levels *(Q7c)* | See or change any other business |
| **Staff** | Only what the business owner allows (for example record-only, or record and approve) *(Q7c)* | Anything not allowed |
| **Agents** (mobile app) | **Record collections for their own customers only** *(Q7a, Q7b)* | Approve remittances, see accounts, add staff, use the dashboard |
| **Customers** (mobile app) | See their own balances and records; pay contributions and loan repayments from their Live wallet *(Q7d)* | See anything else |

3.1 Nobody can ever see or change another business's data.

## 4. Wallets: what holds money and what is a record

4.1 **Only Live wallets hold real money.** Each Live wallet is a TransactPay bank virtual account. *(F-B1)*
4.2 **Every customer gets a Live wallet.** *(F-B1a)*
4.3 Every business has a Live wallet. AlphaKolect (the platform) has its own **Platform Live wallet**. *(Q1a)*
4.4 These customer wallets are **records only**. They hold no money: *(F-B1b)*
- **Collection wallet**: running record of the customer's daily contributions, after fees.
- **Target Savings wallet**: record of saving towards a goal amount or date.
- **Loan wallet**: the loan balance **still owed** by the customer. *(Corrected in F-B1.)*

4.5 Money never moves from a Live wallet *into* a Collection or Target Savings wallet. Those wallets only record contributions. *(F-B1b)*

## 5. Collections (daily contributions)

5.1 A customer is on **one package at a time**. *(Q5c)*
5.2 A savings cycle is **31 days**. *(Q5a)*
5.3 **Cash collection:** an agent records the contribution. The cash is then handed to the business (a remittance), and the business approves it. *(Q5a, Q7a)*
5.4 **Live wallet collection:** the amount moves **from the customer's Live wallet to the business's Live wallet**, and the same amount is recorded in the customer's Collection wallet. *(F-B1b)*
5.5 **(please confirm)** Remittance and approval apply **only to cash collections**. Live wallet collections are already with the business, so they need no remittance.
5.6 **(please confirm)** A cash collection counts in the customer's Collection wallet **once its remittance is approved**. A Live wallet collection counts **immediately**. - Approved

## 6. Fees on packages

6.1 Each package has **one** fee type, never both: *(Q5a, F-B2b)*
- **First-contribution fee**: the whole first contribution of every 31-day cycle belongs to the business and is **not** added to the customer's Collection wallet. *(Q6a)*
- **Percentage fee**: a set percentage of **each contribution** goes to the business. *(F-B2a)*

6.2 Every percentage deduction creates its own entry with a **transaction ID** and a description, for example *"2% deducted for merchant on 12 Oct 2026 09:14"*. *(F-B2a)*

## 7. Withdrawals

7.1 Customers can withdraw from the **Collection wallet** or the **Target Savings wallet**. *(Q5b)*
7.2 A withdrawal can go **to cash** (paid out by the business) or **to loan repayment** (reducing the Loan wallet). *(Q5b)*
7.3 Every withdrawal **reduces the balance** of the wallet it comes from, straight away. *(Q5b)*
7.4 **(please confirm)** A customer can't withdraw more than the balance of the wallet. --> Yes, approved

## 8. Loans

8.1 Loans, applications, approvals and repayments are **in scope**. *(Q8)*
8.2 A repayment from the customer's Live wallet: **(1)** reduces the customer's Live wallet, **(2)** increases the business's Live wallet, and **(3)** reduces the Loan wallet (balance owed). *(F-B1b)*
8.3 A repayment can also come from a withdrawal out of the Collection or Target Savings wallet (rule 7.2).

## 9. Other features (all in scope)

9.1 Investments, charges and fees, wallet tiers and identity (KYC) checks, support tickets, FAQs, announcements, and built-in accounting are **all kept**. They're unused only because the system is still in testing. *(Q8)*

## 10. Subscriptions and billing

10.1 Price depends on the business's **number of agents**: *(Q9a)*

| Agents | Monthly price |
|---|---|
| 1–3 | ₦5,000 |
| 4–6 | ₦10,000 |
| 7–10 | ₦15,000 |
| 11–20 | ₦40,000 |
| 21 or more | Custom price set by you |

10.2 Prices are **viewed and edited in the platform admin**, and billing always uses the current prices. *(Q9a)*
10.3 After the trial, the subscription is taken monthly **from the business's Live wallet** and moved to the **Platform Live wallet**. *(Q1a, Q9c)*
10.4 If the business's Live wallet doesn't hold enough, the business is **suspended**: *(Q9d, F-B3)*
- Business owner and staff: logging in goes straight to the **Subscription page**, with a message to load their wallet and the **exact amount owed**.
- Agents: blocked.
- Customers: the app becomes **view-only**. Any action shows *"Please contact the company."*

10.5 When the outstanding amount is paid, access comes back **automatically and immediately**. *(F-B3b)*
10.6 **(please confirm)** Only **active** agents are counted when working out the price. --> Yes, Approved, Any agent deactivated for 15 days or more should be counted as inactive by the billing system. Only Active agents can log in on the mobile app.

> **Clarification recorded 26 Sep 2026 (from the owner, via his son):** these are two separate rules.
> - **10.6a Billing:** an agent with **no activity for 15 days or more** counts as **inactive** and is not billed. This is about inactivity, not the deactivation switch.
> - **10.6b Login:** a **deactivated** agent **cannot log in** to the mobile app, from the moment of deactivation.
> - *Still to define:* what counts as "activity" (proposed: a login or a recorded collection). See `TARGET_ARCHITECTURE.md` §30.

## 11. Records

11.1 **Money records are never deleted.** A mistake is corrected with a **visible reversing entry**, the way a bank does it. *(Q6d)*
11.2 Records are kept **indefinitely**. Nothing is deleted automatically. *(Q10b)*
*Note added on 12 October 2026, with the owner's approval:* The **activity record** (the log of sign-ins and of who did what) is the one exception to rule 11.2. Each entry is kept for **two years** and then deleted in full, including entries that already exist. The internet address and device details kept with sign-ins and links follow the same rule. Before entries are deleted, the owner may ask for a copy as a report; the system keeps no copy. Every other record, including all money records (rule 11.1), is still kept indefinitely. *(Owner decision D9, October 2026.)*
11.3 **(please confirm)** If a customer asks for their data to be deleted, their **personal details** are removed, but the money records stay (with the name removed), so the business's books still add up. This balances rule 11.1 with rule 11.2. --> Yes, Approved.
11.4 Every action that changes money or permissions records **who** did it and **when**.

## 12. Commitments to businesses

12.1 Businesses' data is kept safe and secure. *(Q10c)*
12.2 Businesses are told in advance about new features and price changes that affect them. *(Q10c)*
12.3 Any promise made to a business is written down and honoured. *(Q10c)*

---

## Things we need to confirm with TransactPay (not you)

These rules depend on what TransactPay's service can actually do. We'll check before building:

- **T1.** Can money move **between two virtual accounts** (customer → business, business → platform)? Rules 5.4, 8.2 and 10.3 depend on it. --> Yes, Money between wirtual and normal bank acccounts
- **T2.** How does TransactPay tell us when money arrives, and how do we verify that the message is genuine? --> Via their API, the API connects to the transactions on alphakolect profile
- **T3.** What does each virtual account cost, and can unused ones be closed? (Rule 2.4)

## Your sign-off

- ☐ **All rules are correct.**
- ☐ **Correct except** (write the rule numbers and what should change):

> Answer: ALl RULES ARE CORRECT, THEY ARE SUBJECT TO THE STATED ADJUSTMENTS AND CLARIFICATIONS. PLEASE TAKE NOTE OF ALL APPROVED (PLEASE CONFIRM MESSAGES)
