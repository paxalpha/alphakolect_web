# AlphaKolect: The Books — Accounts and How Each Transaction Is Recorded

**For:** the owner of AlphaKolect
**Prepared:** 23 October 2026
**Why:** The next stage builds the books every business keeps in AlphaKolect: every collection, charge, loan and
payment is recorded twice (a debit and a credit), so the books always balance. We received three documents describing
the accounts — the "Alphakolect CRM" mapping PDF, and the "Map" and "ChartofAccounts" sheets of *Maps edited.xlsx*.
They use three different numbering schemes, and a few of the entries would record money the wrong way round. Before the
accounts are fixed, we need your decisions below.

As before, **"Not sure" is a fine answer** — we will then ask your accountant.

**Answered by:Mayowa Edward Fadahunsi** **Date: 23th of October, 2026**

---

## Q1. Which list of accounts does every business start with?

Every business gets a ready-made set of accounts the system uses (savings, loans, cash, charges…). The business can add
its own accounts on top (for example for rent or salaries).

- ☐ **A short list, made for AlphaKolect** *(Our suggestion.)* About 20 accounts covering exactly what the system
  records — cash, the business's wallet, cash with agents, customer savings, target savings, investments, loans, each
  kind of charge and interest, and the platform subscription. Codes with 4 digits (1000s assets, 2000s liabilities,
  3000s capital, 4000s income, 5000s expenses), listed below. - Yes, the system can add more accounts later if the business needs them. I choose this option because it is simpler, and the system can add more accounts later if the business needs them.
- ☐ The list in the "Map" sheet, with its 6-digit codes (100200 Wallet, 200100 Customer Collection – Savings, …),
  corrected as in Q2.
- ☐ The long list in the "ChartofAccounts" sheet (264 accounts, codes 100100 to 900989), for every business.
- ☐ Not sure

The short list we suggest (names can be changed; your accountant may rename them):

| Code | Account | Kind | What it records |
|---|---|---|---|
| 1000 | Cash at bank | Asset | the business's bank account |
| 1100 | Business wallet | Asset | the business's AlphaKolect wallet (real money at the payment provider) |
| 1200 | Cash at office | Asset | cash the business holds after agents hand it in |
| 1210 | Cash with agents | Asset | cash agents collected and have not yet handed in (one per agent) |
| 1300 | Customer loans | Asset | what each customer still owes on loans (one per customer) |
| 2100 | Customer savings | Liability | each customer's collection savings, owed to them (one per customer) |
| 2110 | Customer target savings | Liability | each customer's target savings (one per customer) |
| 2120 | Customer investments | Liability | each customer's fixed deposits and investments (one per customer) |
| 2190 | Collections awaiting confirmation | Liability | cash an agent recorded, until the business confirms it |
| 2200 | Transfers in progress | Liability | money being sent on a customer's behalf (Q5) |
| 2300 | Unearned loan interest | Liability | interest charged on loans and not yet earned (Q3) |
| 2400 | Directors' current account | Liability | money directors put into the business (Q6) |
| 3000 | Share capital | Capital | the owners' capital |
| 3100 | Retained earnings | Capital | profit kept in the business |
| 4100 | Collection fees — first contribution | Income | the first contribution of a savings cycle |
| 4110 | Collection commission | Income | the percentage taken from collections |
| 4200 | Loan interest income | Income | interest earned on loans |
| 4300 | Loan application charges | Income | charges for loan applications |
| 4400 | General charges | Income | SMS, card and other charges |
| 4500 | Target savings charges | Income | charges on target savings |
| 5100 | Platform subscription | Expense | the AlphaKolect subscription |
| 5200 | Interest on target savings | Expense | interest paid to customers on target savings |
| 5300 | Interest on investments | Expense | interest paid to customers on fixed deposits and investments |

I agree with the short list of accounts, and I understand that the system can add more accounts later if the business needs them.

## Q2. Corrections to the "Map" sheet

Some lines in the "Map" sheet would put money on the wrong side of the books. For each, we propose the correction on the
right. Please tick the ones you agree with.

| # | "Map" sheet says | Problem | Proposed |
|---|---|---|---|
| a | "Customer Loans" is a **liability** (200500) | Money lent out is owed **to** the business: an asset | Customer loans is an **asset** |
| b | Loan repayment: Dr Cash, Cr "Loan Repayment" (a liability) | The loan never goes down, and a liability appears that nobody is owed | Dr Cash, **Cr Customer loans** |
| c | Charges: Dr Cash, Cr Customer Collection – Savings | This **adds** to the customer's savings instead of taking the charge | **Dr Customer savings, Cr Charges income** |
| d | Collection commission: Dr Customer savings, Cr Cash | The commission is income for the business, not cash going out | **Dr Customer savings, Cr Commission income** |
| e | Move funds from collection to loan: Dr Customer savings, Cr Customer loans (as a liability) | Right idea, but the loan is an asset (a) | **Dr Customer savings, Cr Customer loans (asset)** — the loan goes down by what is paid |
| f | Loan disbursed: Dr Customer loans, Cr Cash | Correct once loans are an asset | Keep |

- ☐ **I agree with all the corrections** *(Our suggestion.)*
- ☐ I agree with these only: ______
- ☐ Not sure — please ask my accountant

> Answer: I agree with all the corrections.

## Q3. When is loan interest counted as income?

The sheet's note says: *"Loan 110 = 100 to asset, 10 to unearned loan interest"* — the interest is recorded when the loan
is given out, as income not yet earned, and becomes income as the customer repays. The PDF instead records interest
income only when the customer pays it.

- ☐ **As the sheet says: recorded at disbursement as unearned, and counted as income as it is repaid** *(Our
  suggestion: the books then show what customers still owe, interest included, and income only when earned.)*
- ☐ As the PDF says: only when the customer pays the interest
- ☐ Not sure — please ask my accountant

> Answer: As the sheet says: recorded at disbursement as unearned, and counted as income as it is repaid. The books then show what customers still owe, interest included, and income only when earned.

## Q4. Unusual entries recorded in the activity record

The PDF asks that any **debit to a capital account** (which reduces the owners' capital and is very rare) is recorded in
the activity record, with the amount, the account, the entry and who made it. The sheet adds **debits to income
accounts** (which reduce income).

- ☐ **Record both** *(Our suggestion.)*
- ☐ Capital only
- ☐ Not sure

> Answer: Record both.

## Q5. Money sent to someone else ("Remittance" in the PDF)

The PDF's "Remittance Created / Payout" means **a customer sending money to someone**, held in a clearing account until
paid out. In AlphaKolect so far, "remittance" has meant **an agent handing the day's cash to the business**. Is sending
money to another person something AlphaKolect should offer?

- ☐ **Not now** *(Our suggestion: it needs the payment provider and its regulator's rules; we keep a clearing account
  ready for it.)*
- ☐ Yes, in this stage
- ☐ Not sure

> Answer: Not now. It needs the payment provider and its regulator's rules; we keep a clearing account ready for it.

## Q6. "Load wallet" through the Directors' account

The sheet's notes show loading the business wallet as *Dr Cash, Cr Directors* and then *Dr Directors, Cr Wallet*. Is
this how money the directors put into the business should be recorded?

- ☐ **Yes: money put in by the directors is owed back to them (a Directors' current account, a liability)** *(Our
  suggestion.)*
- ☐ No: it is capital the directors invest (a capital account)
- ☐ Not sure — please ask my accountant

> Answer: Yes: money put in by the directors is owed back to them (a Directors' current account, a liability).

---

*Thank you. We'll record your answers with the date in the stage's decision log.*
