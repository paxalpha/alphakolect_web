# AlphaKolect: A Few Follow-up Questions

**For:** the owner of AlphaKolect
**Prepared:** 26 September 2026
**Why:** Thank you for answering the questionnaire. A few answers point in different directions, and a few new features need one more detail before we can build them correctly. These are short. As before, **"Not sure" is a fine answer.**

---

## Part A: Please clarify (most important)

### A1. Is anything live today?

In one place you said business #4 handles **real money from real savers**. Elsewhere you said **the system is all test and not live yet**.

Which is true today?
- ☐ **Nothing is live.** Business #4 and all its records are test data.
- ☐ **Business #4 is live** with real savers and real cash.
- ☐ **Business #4 is a real business, but it's only testing** the system (its records aren't real money).
Nothing is Live. Business #4 and all its records are test data.
> Answer:

*Why it matters: if nothing is live, we can clean up or reset the test data freely and rebuild without carrying old records forward. If business #4 is live, every one of its records has to be preserved and corrected carefully.*

### A2. Billing on 22 October

You said business #4 should pay ₦5,000 from its wallet on 22 October. You also said we should **pause** automatic billing until it's rebuilt. If billing is paused, the ₦5,000 won't be taken on 22 October.

What should happen on 22 October?
- ☐ **Pause billing.** No charge and no suspension for anyone until the new billing system is ready. Charging starts once it's rebuilt.
- ☐ **Charge business #4 manually.** We pause the automatic system, and the ₦5,000 is collected by hand.
- ☐ Other:

> Answer:Pause billing.

### A3. The previous developer's access

You said all of his access has been removed. Telling him the work has ended is important, but his **passwords and keys still work until they're changed**. Some of them were saved inside the code he left behind.

Please tick what **has actually been done**. Leave it blank if you're not sure, and we'll check it for you.

- ☐ The **server's main (root) password** has been changed
- ☐ The **Webuzo control panel password** has been changed
- ☐ He has been **removed from the GitHub repository**
- ☐ The **TransactPay** account password and API keys have been changed
- ☐ The **email (mailbox) passwords** have been changed
- ☐ The **domain registrar (Namecheap)** password has been changed, and he isn't on the account
- ☐ Any other account he could log into (please list):

> Answer: All is done

### A4. Who operates the system

You said only **you** should have access to the server and GitHub. Your son is doing the recovery and rebuilding work, and needs access to do it.

Which of these do you want?
- ☐ **I own the accounts**, and my son has his own separate login to do the work. I can remove it at any time.
- ☐ Only I have access, and I'll carry out any change myself when asked.
- ☐ Other:

> Answer: **I own the accounts**, and my son has his own separate login to do the work. I can remove it at any time

*Each person should have their own login rather than sharing one password, so we can always see who did what.*

---

## Part B: Details for the new features

### B1. Customer wallets

You mentioned a **Collection wallet**, a **Target Savings wallet**, a **Loan wallet** and a **Live wallet**. Please confirm what each is for:

| Wallet | What we think it is | Correct? |
|---|---|---|
| Collection wallet | Daily contributions recorded by agents | ☐ Yes ☐ No | - Yes
| Target Savings wallet | Saving towards a set goal amount or date | ☐ Yes ☐ No | Yes
| Loan wallet | Money set aside to repay a loan | ☐ Yes ☐ No | No, Loan balance left to be repaid
| Live wallet | The customer's own bank virtual account (TransactPay), for paying in money digitally | ☐ Yes ☐ No | Yes

**B1a.** Should **every customer** get a Live wallet (bank virtual account), or only some?
- ☐ Every customer
- ☐ Only when the customer asks
- ☐ Only once the customer uses the mobile app
- ☐ Other:

> Answer: Every Customer

**B1b.** Can money move **from the Live wallet into the Collection or Target Savings wallet** (for example, an automatic daily contribution)?

> Answer: No, money does not move from the Live wallet into the Collection or Target Savings wallet. The Live wallet is only for receiving money from the customer, and the Collection and Target Savings wallets are for tracking contributions and savings goals. When customer live wallet is charged for collection for example, there is wallet -to wallet transfer from customer live wallet to business owner live wallet. The same digit is added to Collection wallet. Collection wallet is a record of the contributions made by the customer, and it does not hold any actual money. The Target Savings wallet is also a record of the customer's savings towards a specific goal, and it does not hold any actual money either. When collection is made, the digit is added to the collection wallet and balance will be decided by the rule set for the collection. The Target Savings wallet is updated based on the contributions made by the customer towards their savings goal. Loan repayment made from live wallet reduces the amount in customer live wallet, reduces the loan balance in loan wallet and increases the Business owner live wallet. The Loan wallet is a record of the customer's outstanding loan balance, and it does not hold any actual money either. When a customer makes a loan repayment, the amount is deducted from their Live wallet and added to the Business owner's Live wallet, and the Loan wallet is updated to reflect the new outstanding balance.

### B2. Fees on packages

You said the fee can be the **first contribution of each cycle**, or a **percentage**, depending on the package.

**B2a.** For percentage fees, a percentage of **what**?
- ☐ Each contribution
- ☐ The total saved in the cycle
- ☐ The amount withdrawn
- ☐ Other:

> Answer: Each contribution, with transaction Id generated and narrative for each percentage deduction for the business owner. Narrative for example, % deducted for merchant on datetime.

**B2b.** Can a package have **both** a first-contribution fee and a percentage fee, or only one?

> Answer: No

### B3. Suspension when a business doesn't pay

You said **full suspension on all channels**.

**B3a.** While a business is suspended, should **its customers** also be blocked from saving or repaying through the mobile app?
- ☐ Yes, everything stops for that business's customers too
- ☐ No, customers can still pay in, but the business can't use the dashboard until it pays
- ☐ Not sure

> Answer: Customer App will be on view only. When any operation is attempted, a message to contact the company is displayed.

**B3b.** When the business pays the outstanding amount, should access come back **automatically and immediately**?

> Answer: Yes

### B4. Platform staff (people helping you run AlphaKolect)

**B4a.** What kinds of platform staff do you expect? For example: support (answers tickets), verification (approves identity checks), finance (views billing), or others?

> Answer: Support, verification, finance.

**B4b.** Should any platform staff be able to **see a business's customer or money records**, or only you?

> Answer: They could customer or money records if given the access to

### B5. The admin login

Separate from the **admin@alphakolect.com mailbox password** (which you're resetting), there's also a password for **logging into the AlphaKolect admin dashboard**.

**B5a.** Do you know your **admin dashboard password**?
- ☐ Yes, I can log in
- ☐ No, I've forgotten it
- ☐ Not sure; I haven't tried recently

> Answer: No i have forgotten it

---

*Thank you. After this, we'll write one short page listing the rules the new system will follow, for you to confirm before any building starts.*
