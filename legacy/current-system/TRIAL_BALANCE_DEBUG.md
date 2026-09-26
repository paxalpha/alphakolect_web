# 🔧 Trial Balance Showing 700 Instead of 800 - Debugging Guide

## Your Scenario

You created a journal entry with:

- Line 1: Cash (Debit) = 400
- Line 2: Cash (Credit) = 400

Expected total: 800 (400 debit + 400 credit)
Actual total shown: 700

## Root Cause Analysis

The **Trial Balance** report shows **account balances**, not journal entry totals. Account balances are only updated when journal entries are **POSTED**, not when they're created as drafts.

### How Account Balances Work

1. **Draft Entry Created**:

   ```
   Journal Entry (DRAFT):
   - Cash Debit: 400
   - Cash Credit: 400

   Account Balances: NOT UPDATED ❌
   ```

2. **Entry Posted**:

   ```
   Journal Entry (POSTED):
   - Cash Debit: 400
   - Cash Credit: 400

   Account Balances: UPDATED ✅
   Cash balance = previous balance + 400 - 400 = previous balance
   ```

### Balance Calculation Logic

From `accountingController.js` line 344-350:

```javascript
// Update balance based on account type
let balanceChange = 0;
if (["Asset", "Expense"].includes(account.type)) {
  balanceChange = debit - credit; // For Assets/Expenses
} else {
  balanceChange = credit - debit; // For Liabilities/Equity/Revenue
}

await account.update(
  {
    balance: parseFloat(account.balance) + balanceChange,
  },
  { transaction },
);
```

## Possible Reasons for 700 Instead of 800

### Scenario 1: One Entry Not Posted

```
Entry 1 (POSTED):
- Cash Debit: 400
- Revenue Credit: 400

Entry 2 (DRAFT):  ← NOT POSTED!
- Expense Debit: 400
- Cash Credit: 400

Trial Balance will show:
- Cash: 400 (debit)
- Revenue: 400 (credit)
- Expense: 0 (not posted yet)
Total Debit: 400
Total Credit: 400
MISSING: 400 from the draft entry
```

### Scenario 2: Duplicate Cash Account

```
You might have TWO cash accounts:
- Cash Account 1: 400 debit
- Cash Account 2: 400 credit (but showing as 300?)

This could happen if:
- Different account codes (1000 vs 1001)
- One account has a previous balance
```

### Scenario 3: Previous Balance Exists

```
Cash account had previous balance: -100

New entry posted:
- Cash Debit: 400
- Cash Credit: 400

New balance: -100 + 400 - 400 = -100

But if there's rounding or calculation error:
- Might show as different amount
```

## How to Debug

### Step 1: Check Journal Entries Status

1. Go to `/dashboard/accounting/journals`
2. Look at ALL your journal entries
3. Check the **Status** column for each entry
4. **Are they all POSTED (green)?** Or some still DRAFT (yellow)?

### Step 2: Check Account Balances

1. Go to `/dashboard/accounting/setup` (Chart of Accounts)
2. Look at the **Balance** column for each account
3. Note down:
   - Cash account balance
   - All other account balances

### Step 3: Check Trial Balance Details

1. Go to `/dashboard/accounting/reports`
2. Select "Trial Balance"
3. Look at EACH LINE in the report
4. Note down:
   - Which accounts show debits?
   - Which accounts show credits?
   - What are the exact amounts?

### Step 4: Manual Calculation

Add up all the debits and credits manually:

```
Debits:
Account 1: ___
Account 2: ___
Account 3: ___
Total Debits: ___

Credits:
Account 1: ___
Account 2: ___
Account 3: ___
Total Credits: ___
```

## Quick Fix Steps

### If Entries Are Draft:

1. Go to Journals page
2. Find draft entries (yellow badge)
3. Click green checkmark (✓) to POST each one
4. Go back to Reports page
5. Click "Generate Report"
6. Check if totals are now correct

### If Entries Are Posted But Still Wrong:

1. Open browser console (F12)
2. Go to Reports page
3. Generate Trial Balance
4. Check console for any errors
5. Take a screenshot of:
   - The Trial Balance report
   - The browser console
   - The Journals page showing all entries

## Backend Logging

To help debug, I can add logging to the posting function. The logs will show:

```javascript
console.log("Posting journal entry:", journalEntry.id);
console.log("Lines:", journalEntry.lines);
for (const line of journalEntry.lines) {
  console.log(`Account ${line.accountId}:`);
  console.log(`  Previous balance: ${account.balance}`);
  console.log(`  Debit: ${line.debit}, Credit: ${line.credit}`);
  console.log(`  Balance change: ${balanceChange}`);
  console.log(`  New balance: ${parseFloat(account.balance) + balanceChange}`);
}
```

## Expected Behavior

### Single Entry with Cash Debit & Credit:

```
Journal Entry:
- Line 1: Cash (Debit) 400
- Line 2: Cash (Credit) 400

After posting:
Cash balance change = 400 - 400 = 0
Cash balance = previous + 0 = previous

Trial Balance:
- If previous balance was 0: Cash shows 0
- If previous balance was 100: Cash shows 100 (debit)
```

### Two Separate Entries:

```
Entry 1:
- Cash (Debit) 400
- Revenue (Credit) 400

Entry 2:
- Expense (Debit) 400
- Cash (Credit) 400

After posting both:
Cash balance = 0 + 400 - 400 = 0
Revenue balance = 0 + 400 = 400 (credit)
Expense balance = 0 + 400 = 400 (debit)

Trial Balance:
Total Debits: 400 (Expense)
Total Credits: 400 (Revenue)
Cash: 0 (balanced out)
```

## Action Items

Please provide the following information:

1. **How many journal entries do you have?**
2. **What is the status of each entry?** (Draft/Posted)
3. **What accounts are involved in each entry?**
4. **What are the debit/credit amounts for each line?**
5. **What does the Trial Balance show for each account?**
6. **What is the current balance of the Cash account in Chart of Accounts?**

With this information, I can pinpoint exactly where the 100 is missing!

---

**Last Updated**: 2026-02-09  
**Status**: ⚠️ Needs user input to debug
