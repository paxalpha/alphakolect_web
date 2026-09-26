# AlphaKolect: Business Decisions Needed

**For:** the owner of AlphaKolect
**Prepared:** 26 September 2026
**Why this exists:** We've finished examining the AlphaKolect system and a copy of its data. Some questions can only be answered by you, because they're about how the business is *meant* to work, not how the code happens to behave. Your answers will be the rules we rebuild the system around.

**How to answer:**
- Write your answer under each question. A few words is enough.
- **If you don't know yet, write "Not sure".** That's a perfectly good answer. We'll mark it *DECISION REQUIRED* and build so it can be decided later.
- Nothing here commits you to spending money or changing anything today.
- The **first question is time-sensitive**. The rest can be answered in any order.

> Figures come from a copy of the live system taken on 25 September 2026.

---

## ⏰ 1. Automatic billing on 22 October (URGENT)

**What we found:** The system gives every new business a free 90-day trial, then automatically tries to charge a monthly subscription. The charging feature is faulty: it reads a balance that is always zero, so **it will suspend every business whose trial ends, even if they have paid money in.** The first two trials end on **22 October 2026**: business #3 and **business #4, the only business actively using AlphaKolect with real customers.** When suspended, a business can't record collections or add customers.

We can stop this safely before 22 October without changing anything else. It takes one small change on the server.

**1a.** Should business #4 be charged anything at the moment?
- ☐ No, it's free / a pilot / a friendly customer
- ☐ Yes (how much, and how often?)
- ☐ Not sure

> Answer:Billing customers ater the trial period is the plan. Pricing is according to the number of agents. For business #4, they should be charged ₦5,000 monthly as they have 3 agents. Outstanding is deducted from the Live wallet of the merchant. So, the merchant is expected to pay ₦5,000 into their wallet on or before 22 October 2026 where the deducton is made and transfered to the platform Live wallet.

**1b.** Until the billing system is rebuilt properly, is it OK for us to **pause automatic charging and suspension for everyone**?
- ☐ Yes, pause it
- ☐ No (please explain)

> Answer:yes, pause it. The billing system needs to be rebuilt properly to avoid any issues with charging and suspensions.

---

## 2. Who are your real customers?

**What we found:** 219 businesses have signed up, but only 4 have confirmed their email address, and only these 4 have set anything up:

| Business | Signed up | What they've done |
|---|---|---|
| #3 | July 2026 | 2 agents, 2 branches, 1 customer |
| **#4** | July 2026 | **3 agents, 3 branches, 5 customers, 25 collections, 25 remittances approved (₦30,000)** |
| #60 | August 2026 | 1 agent, 1 branch, 2 customers |
| #61 | August 2026 | 2 agents, 2 branches, 2 customers |

*(We'll add the business names here when we next open the data copy.)*

**2a.** Are these real businesses you have a relationship with? Which of them are live, trials or tests?

> Answer: only businesses that confirms their email address are real businesses. Business #4 is the only live business with real customers. The others are either trials or tests. Please do not allow businesses that are yet to confirm email addresses to be assigned live wallet by the system. Only businesses that have confirmed their email addresses should be allowed to use the live wallet or even assigned one.

**2b.** Is business #4 handling **real money from real savers**?
- ☐ Yes, real customers and real cash
- ☐ No, it's a demo or test
- ☐ Not sure

> Answer: Yes, business #4 is handling real money from real savers. They have 5 customers and have recorded 25 collections and approved 25 remittances totaling ₦30,000.

**2c.** Is anyone besides you and your team **allowed to sign up on their own** today, or should new businesses only be added by you?

> Answer: Anyone is allowed to sign up on their own today. However, only businesses that have confirmed their email addresses should be allowed to use the live wallet or even assigned one. New businesses should be added automatically only if they have confirmed their email addresses.

---

## 3. The September sign-ups and bank accounts

**What we found:** In September, **160 businesses signed up and none of them confirmed their email**. For each sign-up, the system immediately asks the payment provider (TransactPay) to open a **real bank virtual account**: **142** were created in September, and **201 in total**. This happens *before* the business has proved its email address is real. The pattern looks like automated or fake sign-ups.

**3a.** Do you recognise these September sign-ups (for example from a marketing campaign), or are they unexpected?

> Answer: They are fake sign-ups. This should not be allowed.

**3b.** Does TransactPay **charge you** for each virtual account, or limit how many you can have?

> Answer: Something like that is in their service although not sure how the charges is done. This is why fake sign-ups are dangerous to the system.

**3c.** When should a business get its bank virtual account?
- ☐ Only after confirming their email
- ☐ Only after you approve them
- ☐ Only after they pass identity checks (KYC)
- ☐ Immediately at sign-up (as now)
- ☐ Not sure

> Answer:After confirming their email address. Only businesses that have confirmed their email addresses should be allowed to use the live wallet or even assigned one.

**3d.** Should we ask TransactPay whether the unused accounts can be closed?

> Answer:Yes. We should ask TransactPay whether the unused accounts can be closed. This will help to avoid unnecessary charges and also prevent any potential misuse of the virtual accounts.

---

## 4. Money coming in (TransactPay deposits)

**What we found:** 201 virtual accounts exist, but **the system has never recorded a single deposit** into any of them. Either nobody has paid into one yet, or deposits aren't reaching AlphaKolect. We don't know which.

**4a.** Has anyone ever **sent money to one of these virtual accounts**, as far as you know?

> Answer: These 201 virtual accounts were created for businesses that have not confirmed their email addresses. As far as I know, no one has sent money to any of these virtual accounts. Only businesses that have confirmed their email addresses should be allowed to use the live wallet or even assigned one.

**4b.** How is money *supposed* to come into AlphaKolect? Tick all that apply.
- ☐ Customers pay agents in cash; agents hand it to the business
- ☐ Customers transfer to the business's virtual account
- ☐ Businesses top up their AlphaKolect wallet to pay their subscription
- ☐ Other:

> Answer: Through subscription. Also, these virtual accounts are also meant for alternate means of transactions between Business owners and their customers for daily contribution, loan repayments and many more

**4c.** Is **money ever paid out** through AlphaKolect (to customers or businesses), or does all cash stay with the business?

> Answer: Alphakolect is just providing platform for businesses to easily transact digitally with their customers while Alphakolect charges for usage via subscription payments.

---

## 5. How savings are supposed to work

**What we found:** The system works like this today:
1. An agent records a customer's daily contribution (a *collection*).
2. The agent hands the cash to the business (a *remittance*), and the business approves it.
3. On approval, the amount is added to the customer's savings balance, **except the first contribution of each 31-day cycle, which the business keeps as its fee.**

**5a.** Is that correct? In particular:
- Is the cycle **31 days**?
- Is the **first contribution of each cycle** the business's fee?
- Or is the fee something else (a fixed charge, a percentage, …)?

> Answer: Yes. 100%. fees can also be charged in percentage according to the packages and the customers they are assigned to

**5b.** When a customer **withdraws cash**, what should happen to their savings balance? *(Today the system does not reduce the customer's balance when they withdraw. We think that's wrong, but want to confirm.)*

> Answer: When withdrawals are processed, the customer's savings balance should be reduced accordingly. The system should accurately reflect the current balance after any withdrawal.Also, there are 2 internal wallets withdrawals can be done from. Withdrawal from Collection wallet and Target savings wallet. Wirhdrawals is done to cash, to loan wallet for loan repayment. 

**5c.** Can a customer have **more than one savings plan** (package) at a time?

> Answer: No

---

## 6. The ₦2,500 difference at business #4

**What we found:** Business #4's customer savings balances add up to **₦21,500**. Under the rules in question 5, we'd expect **₦19,000**. The ₦2,500 difference comes from two specific entries:

| Amount | What happened |
|---|---|
| **₦1,000** | A **first-of-cycle** contribution (normally the business's fee) was added to a customer's savings |
| **₦1,500** | A remittance was approved and credited, **then later deleted**, but the credit to the customer was never undone |

**We have not changed anything.** We need to know what's true before correcting any balance.

**6a.** Should the ₦1,000 stay in the customer's savings, or was it the business's fee?

> Answer: first-of-cycle savings is always for the business if the package the customer is on is first savings type. That must have been an error while testing. Please note, the system is all test and not live yet.

**6b.** Was the deleted ₦1,500 remittance a real payment that was deleted by mistake, or should it never have been credited?

> Answer: Let us focus on the logic and tighten its loose ends. The system is not open to real customers to use yet.

**6c.** Can business #4 check these against their paper or cash records?

> Answer:

**6d.** In future, should money records **ever be deletable**? Or should mistakes be corrected by a visible reversing entry, like a bank does?
- ☐ Never delete; always reverse visibly
- ☐ Deleting is fine
- ☐ Not sure

> Answer:Never delete; always reverse visibly. This is to ensure transparency and accountability in the system. Any corrections should be made through a visible reversing entry, similar to how banks handle transactions.

---

## 7. Who does what

**What we found:** The system has these kinds of users. We want to confirm what each one is *allowed* to do.

| User | What they are today |
|---|---|
| **You (Super Admin)** | Run the whole platform and manage all businesses |
| **Business owner** | Runs one business |
| **Staff / collaborators** | People a business adds to help run it; they sign in separately |
| **Agents** | Field collectors who take contributions from customers |
| **Customers** | Savers; they don't log in |

**7a.** Should **agents** be able to use the full business dashboard (approve remittances, see accounts, add staff)? Or only record collections for their own customers?

> Answer: Only record collection. Remittance is meant to check the Agents cash and ensure that the cash is handed over to the business. Agents should not have access to approve remittances, see accounts, or add staff. Their role is limited to recording collections for their assigned customers.

**7b.** Do agents use AlphaKolect **on a phone app**, on the website, or not at all? *(There's no phone app in the code we received.)*

> Answer: Phone App which is still under development and will be connected to via API

**7c.** Should **staff** have different permission levels (for example a cashier who can record but not approve)? Who decides: the business owner, or you?

> Answer: the owner of the business should decide on the permission levels for their staff. Different roles can be assigned based on the responsibilities of each staff member, such as a cashier who can record but not approve transactions. The Agents are already doing the work of the cashier who can record and not approve. Any other staff designated to do these too should be allowed

**7d.** Should **customers** ever be able to log in and see their own balance?

> Answer: Yes, via a mobile app under development. From the mobile app, the customers will be able to perform tasks like automating daily contribution via their wallets, perform loan repayments via the live wallet and many other functions but all via the mobile app API.

**7e.** Do you need **other platform staff** (besides yourself) to have admin access, with limited rights?

> Answer: Yes

---

## 8. Features that exist but aren't used

**What we found:** These features were built but **have never been used** in the live system. For each, tell us whether to keep it, delay it, or drop it.

| Feature | Keep (needed soon) | Later | Drop | Not sure |
|---|---|---|---|---|
| Loans to customers (applications, approvals, repayments) | ☐ | ☐ | ☐ | ☐ |
| Investments for customers | ☐ | ☐ | ☐ | ☐ |
| Charges / fees applied to customers | ☐ | ☐ | ☐ | ☐ |
| Wallet tiers and identity (KYC) upgrades for businesses | ☐ | ☐ | ☐ | ☐ |
| Support tickets, FAQs, announcements | ☐ | ☐ | ☐ | ☐ |
| Built-in accounting (chart of accounts, journals, reports) | ☐ | ☐ | ☐ | ☐ |

> Comments: Yes, they are fully needed. They are yet to be in use because the system is still under testing.

---

## 9. Pricing and plans

**What we found:** The code charges by number of agents: ₦5,000 (1–3 agents), ₦10,000 (4–6), ₦15,000 (7–10), ₦40,000 (11–20), and custom pricing above 20. The admin screen lets you edit plans, but **the billing code ignores those edits.**

**9a.** Is that the pricing you intend? If not, what is it?

> Answer: Yes, the pricing is intended. The pricing structure is based on the number of agents, with different tiers for different ranges of agents. Custom pricing can be applied for businesses with more than 20 agents. Also, there should be place in Platform admin where prices of these should be reviewable and editable. The billing code should be updated to reflect any changes made in the admin screen.

**9b.** Is **90 days** the right free-trial length?

> Answer:Yes

**9c.** How should businesses pay: from their AlphaKolect wallet, by bank transfer to you, or some other way?

> Answer: From their Alphakolect wallet. 

**9d.** What should happen when a business doesn't pay: a warning, a grace period, read-only access, or full suspension?

> Answer: Full suspension on all channels. From web platform, logins should be directed to Subscription pages with messages telling them they should load their wallet to pay stated outstanding amount

---

## 10. Records and rules we must never break

**10a.** Are there any **legal or regulatory requirements** we should know about (for example CBN guidance, cooperative-society rules, record-keeping periods)?

> Answer: Non considered at the moment. System is designed to accomodate all known rules. When new ones are known, we will adjust.

**10b.** How long must savings and payment records be kept?

> Answer: As long as the customer wants to keep them. The system should allow customers to access their savings and payment records for as long as they wish. There should be no automatic deletion of records unless requested by the customer or required by law.

**10c.** Are there any **promises made to business #4** (or others) about features, prices or how their data is handled?

> Answer: Yes, should let them know their data is safe and secure. Also, they should be informed about any new features or changes to the pricing structure that may affect them. Any promises made to business #4 or other businesses should be documented and honored.

**10d.** Anything else about how the business works that you'd want the new system to get right?

> Answer: Nothing at the moment

---

## 11. Access and ownership (short)

**11a.** Who should have access to the **AlphaKolect server** and the **code on GitHub** from now on?

> Answer: Me

**11b.** Who uses the **admin@alphakolect.com** mailbox, and who knows its password?

> Answer: I do but forgotten the password. I will reset it and change the password to a new one. I will also ensure that the new password is stored securely and only accessible to authorized personnel.

**11c.** Has the previous developer's work formally ended, and has he been told his access is being removed?

> Answer:Yes. all access has been removed and the previous developer has been informed that his work has formally ended. He no longer has access to the AlphaKolect server, code on GitHub, or any other related resources.

---

*Thank you. Once we have your answers, we'll turn them into the rules the new system is built on, and show you that summary to check before any building starts.*
