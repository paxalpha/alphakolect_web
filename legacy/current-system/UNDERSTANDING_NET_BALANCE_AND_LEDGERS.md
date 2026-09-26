# 📊 Understanding Net Balance & Ledger Transactions

## Issue 1: Why is Net Balance ₦0.00?

### Your Current Data:

- **Total Debits**: ₦1,000.00
- **Total Credits**: ₦1,000.00
- **Net Balance**: ₦0.00

### This is CORRECT! ✅

**Explanation**:

```
Net Balance = Total Credits - Total Debits
Net Balance = ₦1,000.00 - ₦1,000.00
Net Balance = ₦0.00
```

### Why This is Good:

In **double-entry accounting**, every transaction must be balanced:

- For every debit, there must be an equal credit
- Total debits must equal total credits
- **A net balance of ₦0.00 means your books are balanced** ✅

### Example:

```
Journal Entry: Sale of goods for cash
- Debit: Cash ₦1,000 (Asset increases)
- Credit: Revenue ₦1,000 (Revenue increases)
Total: ₦1,000 = ₦1,000 ✅ Balanced
```

### When Would Net Balance NOT be Zero?

The net balance would only be non-zero if you have **unbalanced entries**, which would indicate an error:

```
❌ UNBALANCED ENTRY (ERROR):
- Total Debits: ₦1,500
- Total Credits: ₦1,000
- Net Balance: -₦500 (Debit surplus - ERROR!)

This should never happen in proper accounting!
```

---

## Issue 2: Why Are Ledgers Showing No Transactions?

### Root Cause: Only POSTED Entries Show in Ledgers

The ledger API filters for `status: 'posted'` (line 515 in accountingController.js):

```javascript
const journalWhere = { merchantId, status: "posted" };
```

### Journal Entry Statuses:

| Status       | Shows in Ledger? | Affects Balances? | Can Edit? | Can Delete? |
| ------------ | ---------------- | ----------------- | --------- | ----------- |
| **Draft**    | ❌ No            | ❌ No             | ✅ Yes    | ✅ Yes      |
| **Posted**   | ✅ Yes           | ✅ Yes            | ❌ No     | ❌ No       |
| **Reversed** | ✅ Yes           | ✅ Yes (reversed) | ❌ No     | ❌ No       |

### How to See Transactions in Ledger:

#### Step 1: Check Journal Entry Status

1. Go to `/dashboard/accounting/journals`
2. Look at the **Status** column
3. Find entries with status **"draft"** (yellow badge)

#### Step 2: POST Your Journal Entries

1. Find the draft entry you want to post
2. Click the **green checkmark icon** (✓) in the Actions column
3. Confirm the posting action
4. Status changes from "draft" to "posted"

#### Step 3: View in Ledger

1. Go to `/dashboard/accounting/ledgers`
2. Select the account
3. You should now see the posted transactions!

### Visual Guide:

```
┌─────────────────────────────────────────────────────────┐
│ Journals Page                                            │
├─────────────────────────────────────────────────────────┤
│ Reference │ Date │ Description │ Status │ Actions       │
├───────────┼──────┼─────────────┼────────┼───────────────┤
│ JE-001    │ ...  │ Sale        │ DRAFT  │ [✓] [✏️] [🗑️] │  ← Click ✓ to POST
│ JE-002    │ ...  │ Purchase    │ POSTED │ [↩️] [👁️]     │  ← Already posted
└─────────────────────────────────────────────────────────┘

After clicking ✓:
┌─────────────────────────────────────────────────────────┐
│ JE-001    │ ...  │ Sale        │ POSTED │ [↩️] [👁️]     │  ← Now posted!
└─────────────────────────────────────────────────────────┘

Now go to Ledgers page:
┌─────────────────────────────────────────────────────────┐
│ Ledgers Page - Cash Account                             │
├─────────────────────────────────────────────────────────┤
│ Date │ Reference │ Description │ Debit │ Credit │ Balance│
├──────┼───────────┼─────────────┼───────┼────────┼────────┤
│ ...  │ JE-001    │ Sale        │ 1,000 │ -      │ 1,000  │  ← Now visible!
│ ...  │ JE-002    │ Purchase    │ -     │ 500    │ 500    │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Troubleshooting Checklist

### Ledgers Showing No Transactions?

- [ ] **Check 1**: Do you have journal entries?
  - Go to Journals page
  - If empty, create journal entries first

- [ ] **Check 2**: Are your journal entries POSTED?
  - Look at Status column
  - If "draft", click the green ✓ to post them

- [ ] **Check 3**: Are you looking at the right account?
  - Make sure the account you selected has transactions
  - Try selecting different accounts

- [ ] **Check 4**: Are you using the right date range?
  - Check the "From Date" and "To Date" filters
  - Try expanding the date range

- [ ] **Check 5**: Did the backend restart?
  - Check if backend is running
  - Check backend console for errors

---

## Summary

### Net Balance = ₦0.00

✅ **This is CORRECT!**

- Your books are balanced
- Debits equal credits
- This is proper double-entry accounting

### Ledgers Showing No Transactions

⚠️ **You need to POST your journal entries!**

1. Go to Journals page
2. Find draft entries (yellow badge)
3. Click green checkmark (✓) to post
4. Go back to Ledgers - transactions will now appear

---

## Why This Design?

### Draft vs Posted Separation

**Draft Entries**:

- Work in progress
- Can be edited or deleted
- Don't affect account balances
- Don't appear in reports
- Safe to experiment with

**Posted Entries**:

- Official, permanent records
- Cannot be edited (must reverse)
- Affect account balances
- Appear in all reports and ledgers
- Audit trail maintained

This separation ensures:

- ✅ Data integrity
- ✅ Audit compliance
- ✅ Accurate financial reporting
- ✅ Ability to work on entries without affecting books

---

**Last Updated**: 2026-02-09  
**Status**: ✅ Both issues explained
