# Accounting Module - Quick Integration Reference

## ✅ COMPLETED

### Backend

- [x] Database models created (Account, JournalEntry, JournalLine, FiscalPeriod)
- [x] Migration file created and executed successfully
- [x] Controller with all CRUD operations
- [x] API routes added to server.js
- [x] Authentication middleware applied to all routes

### Frontend

- [x] API functions added to services/api.tsx
- [x] All accounting pages created with UI

## ⏳ TODO: Connect Frontend to Backend

### Quick Copy-Paste Imports for Each Page

#### 1. Setup Page

```typescript
import {
  createAccount,
  fetchAccounts,
  updateAccount,
  deleteAccount,
  createFiscalPeriod,
  fetchFiscalPeriods,
} from "@/services/api";
import { useEffect, useState } from "react";
```

#### 2. Journals Page

```typescript
import {
  createJournalEntry,
  fetchJournalEntries,
  postJournalEntry,
  reverseJournalEntry,
  deleteJournalEntry,
  fetchAccounts,
} from "@/services/api";
import { useEffect, useState } from "react";
```

#### 3. Ledgers Page

```typescript
import { fetchAccounts, fetchGeneralLedger } from "@/services/api";
import { useEffect, useState } from "react";
```

#### 4. Reports Page

```typescript
import {
  fetchTrialBalance,
  fetchBalanceSheet,
  fetchIncomeStatement,
} from "@/services/api";
import { useEffect, useState } from "react";
```

#### 5. Analytics Page

```typescript
import { fetchBalanceSheet, fetchIncomeStatement } from "@/services/api";
import { useEffect, useState } from "react";
```

## API Endpoints Reference

### Accounts

- POST `/accounting/accounts` - Create
- GET `/accounting/accounts` - List all
- GET `/accounting/accounts/:id` - Get one
- PUT `/accounting/accounts` - Update
- DELETE `/accounting/accounts/:id` - Delete

### Journal Entries

- POST `/accounting/journal-entries` - Create
- GET `/accounting/journal-entries` - List all
- GET `/accounting/journal-entries/:id` - Get one
- POST `/accounting/journal-entries/:id/post` - Post entry
- POST `/accounting/journal-entries/:id/reverse` - Reverse entry
- DELETE `/accounting/journal-entries/:id` - Delete draft

### Ledgers

- GET `/accounting/ledger?accountId=X&dateFrom=Y&dateTo=Z` - Get ledger

### Fiscal Periods

- POST `/accounting/fiscal-periods` - Create
- GET `/accounting/fiscal-periods` - List all
- PUT `/accounting/fiscal-periods/:id` - Update

### Reports

- GET `/accounting/reports/trial-balance?asOfDate=X` - Trial Balance
- GET `/accounting/reports/balance-sheet?asOfDate=X` - Balance Sheet
- GET `/accounting/reports/income-statement?dateFrom=X&dateTo=Y` - P&L

## Standard Pattern for All Pages

```typescript
"use client";
import { useState, useEffect } from 'react';
import Swal from 'sweetalert2';
import { /* import needed API functions */ } from '@/services/api';

export default function PageName() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const response = await fetchDataFunction();
      setData(response.data);
    } catch (error) {
      Swal.fire('Error', error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (formData) => {
    try {
      const response = await createFunction(formData);
      Swal.fire('Success', response.message, 'success');
      loadData(); // Refresh
    } catch (error) {
      Swal.fire('Error', error.message, 'error');
    }
  };

  const handleUpdate = async (id, formData) => {
    try {
      const response = await updateFunction({ id, ...formData });
      Swal.fire('Success', response.message, 'success');
      loadData();
    } catch (error) {
      Swal.fire('Error', error.message, 'error');
    }
  };

  const handleDelete = async (id) => {
    const result = await Swal.fire({
      title: 'Are you sure?',
      text: 'This action cannot be undone',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Yes, delete it!'
    });

    if (result.isConfirmed) {
      try {
        await deleteFunction(id);
        Swal.fire('Deleted!', 'Item deleted successfully', 'success');
        loadData();
      } catch (error) {
        Swal.fire('Error', error.message, 'error');
      }
    }
  };

  return (
    // Your JSX here
  );
}
```

## Testing Checklist

- [ ] Backend server running (`npm run start` in backend folder)
- [ ] Frontend running (`npm run dev` in root folder)
- [ ] Database migration completed
- [ ] Can create account
- [ ] Can view accounts list
- [ ] Can update account
- [ ] Can delete account
- [ ] Can create journal entry
- [ ] Can post journal entry
- [ ] Can reverse journal entry
- [ ] Can view ledger
- [ ] Can generate trial balance
- [ ] Can generate balance sheet
- [ ] Can generate P&L statement

## Important Notes

1. **Authentication Required**: All API calls need valid JWT token (automatically handled by `getAuthHeaders()`)

2. **Error Handling**: Always wrap API calls in try-catch blocks

3. **Loading States**: Use loading state to show spinners during API calls

4. **Success Messages**: Show success messages after successful operations

5. **Data Refresh**: Always reload data after create/update/delete operations

6. **Validation**: Validate data before sending to API (especially journal entries - debits must equal credits)

## Files Modified

### Backend

- ✅ `backend/models/account.js` - NEW
- ✅ `backend/models/journalEntry.js` - NEW
- ✅ `backend/models/journalLine.js` - NEW
- ✅ `backend/models/fiscalPeriod.js` - NEW
- ✅ `backend/models/index.js` - UPDATED (added accounting models)
- ✅ `backend/controllers/accountingController.js` - NEW
- ✅ `backend/server.js` - UPDATED (added routes)
- ✅ `backend/migrations/20240209-create-accounting-tables.js` - NEW
- ✅ `backend/run-accounting-migration.js` - NEW

### Frontend

- ✅ `services/api.tsx` - UPDATED (added accounting functions)
- ⏳ `src/app/dashboard/(pages)/accounting/setup/page.tsx` - NEEDS UPDATE
- ⏳ `src/app/dashboard/(pages)/accounting/journals/page.tsx` - NEEDS UPDATE
- ⏳ `src/app/dashboard/(pages)/accounting/ledgers/page.tsx` - NEEDS UPDATE
- ⏳ `src/app/dashboard/(pages)/accounting/reports/page.tsx` - NEEDS UPDATE
- ⏳ `src/app/dashboard/(pages)/accounting/analytics/page.tsx` - NEEDS UPDATE

## Next Action

Update each frontend page following the pattern in `ACCOUNTING_DATABASE_INTEGRATION.md`

Start with the Setup page, then Journals, then Ledgers, then Reports, then Analytics.
