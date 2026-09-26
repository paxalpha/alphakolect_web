# AlphaKolect / Alphaweb — Current System Inventory

**Date:** 2026-09-25
**Branch:** `recovery/alphaweb-takeover` @ `a5c23e6`
**Scope:** An evidence-based picture of what exists **now**. There is **no target architecture** in this document; it is deliberately left out.
**Mode:** Read-only.
- **Code:** static reading plus throwaway analysis scripts kept in the session scratchpad, not in the repo.
- **Data:** read-only SQL (`BEGIN READ ONLY … ROLLBACK`) against the local recovery database (`alphakolect-recovery-db` container, a restore of the production backup). Only aggregates and IDs were read. No personal data, passwords or hashes were printed.
- **Not touched:** no file in the repo was modified, nothing was installed or migrated, and production was not accessed.

**Companion documents:**
- `AUDIT_REPORT.md`: security and bug audit.
- `ARCHITECTURE_RECONNAISSANCE.md`: runtime, dependency, duplication and migration analysis.

This document adds what those two didn't have: **production data evidence** (row counts, schema drift, financial reconciliation), a **per-domain frontend → API → endpoint map**, and **table → migration coverage**.

| Label | Meaning |
|---|---|
| **CONFIRMED** | Established from code, config, or the restored production data |
| **LIKELY** | Strongly indicated, but not proven |
| **UNKNOWN** | Needs production or human input |

> **Correction to earlier notes.** In the previous session I reported that the `AdminStaff` model expects a `roleId` column that the table lacks. **That was wrong.** The model maps the `roleId` attribute to the column `role_id`, which exists. My ad-hoc query had used the attribute name instead of the column name. There is **no** drift on `admin_staff`.

---

## 0. What production actually contains (snapshot of 2026-09-25)

This section changes the risk picture more than anything else in the document.

### 0.1 Row counts, all 39 tables (CONFIRMED)

| Populated | Empty (0 rows) |
|---|---|
| `merchants` 219 · `accounts` 139 · `activities` 57 · `journal_lines` 50 · `collections` 25 · `remittances` 25 · `journal_entries` 25 · `packages` 21 · `wallet_transactions` 18 · `customers` 10 · `customer_wallets` 10 · `roles` 9 · `agents` 8 · `branches` 8 · `staff` 6 · `plans` 5 · `charges` 4 · `super_admins` 1 | `loans` · `loan_applications` · `repayments` · `investments` · `investment_applications` · `investment_transactions` · `subscriptions` · `charge_assignments` · `wallet_tiers` · `wallet_upgrade_requests` · `fiscal_periods` · `transactions` · `collaborators` · `users` · `admin_staff` · `admin_roles` · `admin_logs` · `support_tickets` · `ticket_messages` · `announcements` · `faqs` |

### 0.2 Merchant population (CONFIRMED)

| Metric | Value |
|---|---|
| Merchants | 219. All `subscription_status = Active`. |
| Email-verified | **4** (ids 3, 4, 60, 61) |
| With a TransactPay virtual account | **201**. Virtual accounts are provisioned at signup, *before* email verification (`authController.registerMerchant`), so **197 unverified signups created real bank virtual accounts**. |
| Signups by month (total / verified / with a virtual account) | 2026-07: 35 / 2 / 35 · 2026-08: 24 / 2 / 24 · **2026-09: 160 / 0 / 142** |
| Merchants with any real activity | ids 3, 4, 60 and 61 only (agents, branches, a few customers) |
| Merchants with **financial** activity | **id 4 only**: 25 collections, 25 remittances, 18 wallet transactions, 25 journal entries, 5 customers |
| `wallet_balance` non-zero | 0 merchants |
| `total_debt` non-zero | 0 merchants |
| Trials ended | 0 so far. The first trial ends on **2026-10-22** (merchants **3 and 4**). The last one ends on 2026-12-24. |

**Implications (LIKELY):**
- The September signup wave (160 unverified accounts, with virtual accounts created for 142 of them) looks like automated or abusive signups against the open `/merchant/signup` endpoint.
- The system has **one real operating customer (merchant 4)** and three lightly set-up ones.
- **The billing defect (wallet_balance is never credited, so every merchant gets suspended) will first hit merchants 3 and 4 on 2026-10-22.** Merchant 4 is the only real customer. That is roughly four weeks from this snapshot.

### 0.3 Financial reconciliation, merchant 4 (CONFIRMED from data)

| Item | Value |
|---|---|
| Collections | 16 regular (₦19,000) + 9 first-saving (₦11,000). All `Collected`, all of type `Package Payment`. |
| Remittances | 25, all `Approved` (₦30,000), approved between 2026-09-02 and 2026-09-14 |
| Expected customer-wallet credits under the current code | ₦19,000 (regular savings only; first savings are income) |
| Actual `remittance_approval` wallet credits | **18 credits, ₦21,500** |
| Sum of stored `customer_wallets.collection_balance` | **₦21,500**. It matches the ledger, but **not** the business rules. |
| Over-credit | **₦2,500**, made up of (a) **₦1,000**: one first-saving remittance credited to a customer wallet, which the current code treats as income, and (b) **₦1,500**: a credit that references **remittance #8, which no longer exists**. It was deleted after approval, and the credit was never reversed. |
| Double credit (credited at collection creation *and* again at approval) | **Not present in the data**: the stored balance equals the approval credits only. The code path still exists and is reachable from the UI (see §D). |

---

## 1. Per-domain inventory

Abbreviations:
- **VA** = `verifyToken` + `requireAuthenticated`; **+S** = `checkActiveSubscription`; **SA** = `verifyToken` + `requireSuperAdmin`.
- `api.` = `services/api.tsx`; `adminAPI.` = `src/app/admin/utilis/adminApi.ts`.
- Row counts are from the production snapshot.

### 1.1 Super Admin

| Aspect | Current state |
|---|---|
| Tables / models | `super_admins` / `SuperAdmin` (1 row). `admin_staff` / `AdminStaff` (0), `admin_roles` / `AdminRole` (0), `admin_logs` / `AdminLog` (0), `activities` / `Activity` (57), `plans` / `Plan` (5), `announcements`, `faqs`, `support_tickets`, `ticket_messages` (all 0) |
| Migrations | `20260103120000-add-super-admin-tables.js` (super_admins, activities, plans), `20260106-create-plans-table.js`, `043_fix_plans_table_columns.js`, `20260107000000-add-admin-staff-roles-tables.js`, `20260107190000-create-support-tables.js` |
| Controllers | `superAdminController.js` (1,013 lines: login, stats, activities, merchants list, transactions, plans, admin roles and staff, logs, tickets, announcements, FAQs), `merchantManagementController.js`, `walletTierController.js`, `verificationController.js`; `services/adminLogService.js` (1 caller) |
| Routes | `/superadmin/*` (≈35, all SA except `POST /superadmin/login`), `/admin/billing/{run,preview}` (**unreachable**: registered after the 404 handler) |
| Frontend | `/admin` (login), `/admin/dashboard` and its pages `auditlogs`, `billings`, `merchants`, `merchants/[id]`, `settings`, `staffs`, `support`, `transactions`, `verifications`, `wallet-parameters`; components in `components/tables/*` and `components/admin/*` |
| Frontend API | `adminAPI.*` (React Query) plus raw `fetch` in `Customplan`, `Standardplan`, `Faqs`, `Announcements`, `WalletTiersTable`, `Addd&editaccountmodal` |
| Business operations | Manage merchants (edit, status, reset password, delete), plans, admin roles and staff, wallet tiers, KYC upgrade approvals, support, audit logs, platform stats |
| Inconsistencies | No super-admin password recovery; the "Forgot password" link goes to the merchant flow. Admin staff can be created but **cannot log in**. `AdminRole` permissions are never enforced. The `SuperAdmin.role` value `admin` is rejected by `requireSuperAdmin`. **The settings account modal calls `/api/merchants`, which doesn't exist.** `plans` has a `merchant_id` FK, and 5 DB columns are unmapped in the model. |
| Depends on | Merchants, Billing, Wallet (tiers and verification), Accounting (verification posts journals) |

### 1.2 Merchant (tenant owner)

| Aspect | Current state |
|---|---|
| Tables | `merchants` (219). **Duplicate column pairs:** `account_number`/`accountNumber`, `account_level`/`accountLevel`. Unmapped in the model: `status`, `account_number`, `account_level`, `is_custom_fee`, `custom_fee`. |
| Migrations | Touched by **34** migration files (e.g. `007`, `021`, `022`, `044_ensure_merchants_camelcase_columns.sql`, `001-add-otp-fields.js`, …) |
| Controllers | `authController.js` (signup, login, OTP, password, profile), `merchantManagementController.js` (`getMySubscription`, `reactivateSubscription`) |
| Routes | `/merchant/{signup,login,forgot-password,resend-otp,verify-otp,change-password}` (open), `GET /merchant/profile` (verifyToken), `/merchant/{subscription,reactivate}` (VA) |
| Frontend | `(auth)/{login,signup,verify-otp,forgot-password,change-password}`, `dashboard/(pages)/subscription`, `dashboard/(pages)/settings` |
| Frontend API | `api.registerUser`, `loginUserWithEmail`, `forgotPassword`, `resendOtp`, `verifyOtp`, `updatePassword`; raw `fetch` for `/merchant/{subscription,reactivate}` |
| Business operations | Register (and provision a TransactPay virtual account), verify email, log in, reset password, view and reactivate subscription |
| Inconsistencies | Virtual account created before verification (see §0.2); OTP returned in the response; `change-password` is unauthenticated; 90-day trial hardcoded; `plan_id` trusted from the client |
| Depends on | TransactPay, Email, Billing |

### 1.3 Collaborators / Staff

| Aspect | Current state |
|---|---|
| Tables | **`staff`** (6: the real "collaborators", with `merchantId`, `branchId`, `roleId`), `roles` (9: merchant-defined roles with JSON `permissions`), **`collaborators`** (0 rows: legacy, tenantless) |
| Migrations | `023_create_roles_and_staff_tables.js`, `035_add_staff_branchId.sql`, `024_fix_missing_tables_and_columns.js`; `collaborators` only via `001-add-otp-fields.js` |
| Controllers | `staffController.js`, `roleController.js`, `collaboratorController.js` (login checks Staff first, then Collaborator; signup writes to Collaborator) |
| Routes | `/staff`, `/roles` (VA, no +S), `/collaborator/{signup,login,forgot-password,resend-otp,verify-otp,change-password}` (open) |
| Frontend | `dashboard/(pages)/staffManagement`, `(auth)/collaborator/{login,forgot-password,verify-otp,change-password}` (**no signup page**) |
| Frontend API | `api.createStaff`, `updateStaff`, `fetchStaff`, `createRole`, …; the collaborator login uses raw `fetch` |
| Business operations | The merchant creates staff with a role and branch; staff log in through the collaborator portal; the sidebar is filtered by `staffPermissions` |
| Inconsistencies | Staff and Collaborator tokens both use `type:'collaborator'`; permissions are UI-only; default password `Staff123!`; `POST /staff` takes `merchantId` from the body **ahead of** the token; the frontend sends the **staff ID as `merchantId`** when a collaborator creates agents or branches |
| Depends on | Merchants, Branches |

### 1.4 Agents

| Aspect | Current state |
|---|---|
| Tables | `agents` (8). DB columns `status` and `customers_count` are unmapped in the model. There are **2 identical FK constraints** to `merchants`. |
| Migrations | 15 files (`009_create_agents_table.sql`, `015`, `016`, `024`, …) |
| Controllers | `agentController.js`, `userController.loginUser` (agent login) |
| Routes | `/agents`, `/agents/:id`, `/agents/:id/status` (VA, +S on create and update), `POST /api/auth/login` |
| Frontend | `dashboard/(pages)/agents`, `view-agent`, `view-agent/[id]`; `/agents` at the site root is a **marketing** page |
| Frontend API | `api.addAgent` (sends `merchantId` from `localStorage.user.id`), `updateAgent`, `updateAgentStatus`, `fetchAgents`, `fetchAgentById` |
| Business operations | Merchant manages field agents; agents log in (the mobile app is gone: "Mobile controllers removed") |
| Inconsistencies | Update, get and status routes have no tenant check; `GET /agents/:id` returns the password hash; global email uniqueness; `updateAgent` ignores the `branch` and `status` it receives. No mobile client exists in the repo, so how agents actually use the system is **UNKNOWN**. |
| Depends on | Merchants, Branches |

### 1.5 Customers

| Aspect | Current state |
|---|---|
| Tables | `customers` (10). DB columns `phone` and `status` are unmapped in the model. Touched by **22** migration files, including camelCase and snake_case normalisation (`010_rename…`, `025`, `026`, `027` which drops camelCase columns). |
| Controllers | `customerController.js` (creates a CustomerWallet and calls TransactPay) |
| Routes | `/customers` (VA, +S on create and update), `/customers/:id` |
| Frontend | `dashboard/(pages)/customer`, `dashboard/customer/[id]` (customer 360 page: calls **22** endpoints across every domain) |
| Frontend API | `api.createCustomer` (body `merchantId`), `updateCustomer`, `fetchCustomers`, `fetchCustomerById` |
| Business operations | Onboard a customer with agent, branch and package; view the customer across collections, loans, investments, charges and wallet |
| Inconsistencies | `GET /customers/:id` has no tenant check; `merchantId`, `agentId` and `branchId` come from the body without an ownership check. **`GET /customer-wallets/:id/transactions` (called by the customer page) doesn't exist.** |
| Depends on | Agents, Branches, Packages, Wallets, TransactPay |

### 1.6 Branches

| Aspect | Current state |
|---|---|
| Tables | `branches` (8). DB columns `address`, `phone`, `email` are unmapped in the model. |
| Migrations | `036_create_branches_table.js`, `037_add_missing_branches_columns.js`, `025`, `026`, `035` |
| Controllers / routes | `branchController.js`; `/branches` (VA, +S on create and update); `DELETE /branches/:id` always returns 400 (disabled) |
| Frontend | `dashboard/(pages)/branchManagement` (its **delete button can never succeed**) |
| Inconsistencies | Branch names are unique **across all tenants**; `merchantId` comes from the body; update has no tenant check. The Agent ↔ Branch association is commented out (agents store `branch` as text). |

### 1.7 Collections (and Packages)

| Aspect | Current state |
|---|---|
| Tables | `collections` (25), `packages` (21: **55 DB columns versus 33 in the model**, with 22 unmapped, and **both `merchantId` and `merchant_id` columns with FKs**), `charges` (4) |
| Migrations | collections: `019_add_cycle_fields…`, `028_drop_camelcase_and_create_collections.sql`, … ; packages: 12 files (`011`, `012`, `013`, `014_create_packages_table_complete`, `015_create_packages_table_simple`, `038`, …) |
| Controllers | `collectionController.js` (cycle logic via `isFirstSaving`, wallet credit, auto-created Remittance), `packageController.js` (the only `resolveMerchantId` helper) |
| Routes | `/collections`, `/collections/bulk`, `/collections/:id/collect`, `/collections/status/:status`, `/collections/overdue` (**shadowed by `/:id`**), `/packages`, `/packages/active` |
| Frontend | `dashboard/(pages)/collection`, `collection/(pages)/collections`, `package/*` (collection, investment and loan package editors), plus the root `components/{Single,Bulk}CollectionForm.tsx` |
| Frontend API | `api.createCollection`, `fetchCollections`, `createPackage`, `updatePackage`, … |
| Business operations | Record a daily contribution against a package cycle (31 days by default); the first saving of each cycle is company income |
| Inconsistencies | Not atomic (4 writes, errors swallowed); read-modify-write on `collectionBalance`; **`postToCollection: true` from the customer page credits the wallet at creation *and* again at remittance approval**; `updateCollection`/`deleteCollection` exist in the API client but are never imported |
| Depends on | Customers, Packages, Wallets, Remittances |

### 1.8 Remittances

| Aspect | Current state |
|---|---|
| Tables | `remittances` (25). **No foreign keys** (collection, customer, agent and merchant are all unconstrained). |
| Migrations | `020_create_remittances_table.js` only |
| Controllers / routes | `remittanceController.js` (approval runs in a DB transaction with row locks, credits `collectionBalance`, posts a journal and writes a WalletTransaction); `/remittances`, `/remittances/:id/approve`, `DELETE /remittances/:id` (VA, **no +S**) |
| Frontend | `collection/(pages)/remittance` |
| Business operations | Agent cash is handed to the merchant; approval is the **only moment a collection enters the books** ("remitted only" policy) |
| Inconsistencies | **Hard delete after approval with no reversal** (seen in data: remittance #8, §0.3); the first-saving classification was not applied at least once (the ₦1,000 in §0.3) |
| Depends on | Collections, Wallets, Accounting |

### 1.9 Wallets (merchant and customer)

| Aspect | Current state |
|---|---|
| Tables | `wallet_transactions` (18: all merchant 4, all `remittance_approval`; FK duplicated; `processed_by` references the unused `users` table), `customer_wallets` (10: `balance`, `collection_balance`, `loan_balance`, `investment_balance`), `merchants.wallet_balance` (always 0), `wallet_tiers` (0), `wallet_upgrade_requests` (0) |
| Migrations | wallet_transactions: `005`, `017`, `034`; customer_wallets: `008`, `009`; `007_add_wallet_fields_to_merchants.sql`; `040`, `041` |
| Controllers | `walletController.js` (1,009 lines), `customerWalletController.js`, `verificationController.js`, `walletTierController.js` |
| Routes | `/wallet/{balance,transactions,transactions/:id/status,stats,transfer,upgrade,upgrade-status}`, `/customer-wallets*`, `/wallet-tiers` (VA, **none use +S**) |
| Frontend | `dashboard/(pages)/wallet`, `dashboard/customer/[id]` (withdraw and transfer), `accounting/page.tsx` (lists and creates wallet transactions) |
| Business operations | Merchant wallet backed by a TransactPay virtual account, deposits via webhook, transfer to customer, customer withdrawal, KYC tier upgrade |
| Inconsistencies | Client-created `Completed` transactions; customer `balance` directly settable; **customer "Cash withdrawal" debits the merchant ledger and never reduces the customer's `collectionBalance`** (`customer/[id]/page.tsx:345-356`); the platform-wide TransactPay balance is shown to every merchant and used in tier checks; the virtual account is auto-provisioned as a side effect of `GET /wallet/balance`; no DB transactions around transfers |
| Depends on | TransactPay, Customers, Accounting, Billing |

### 1.10 Loans

| Aspect | Current state |
|---|---|
| Tables | `loans` (0: FKs duplicated for agent, customer and merchant; `createdAt`/`updatedAt` unmapped), `loan_applications` (0), `repayments` (0: FKs duplicated) |
| Migrations | loans: 11 files (`003`, `029`, `030_fix_loans_status_enum`, `031_drop_loans_camelcase`, `045`); loan_applications: `002`, `045`; repayments: `004`, `032` |
| Controllers | `loanApplicationController.js`, `loanController.js` (1,037 lines), `repaymentController.js` |
| Routes | `/loan-applications*`, `/loans*` (multer `loanForm`), `/repayments*` |
| Frontend | `loan/(pages)/applications`, `loans`, `repayments`, `loan/page.tsx`; customer page |
| Frontend API | The "applications" page calls **`/loans`, not `/loan-applications`**; `api.createLoanApplication` and `deleteLoanApplication` are **never imported** |
| Business operations | Flat-rate loans with package charges deducted from the collection wallet; repayments |
| Inconsistencies | **The `LoanApplication` model does not match its table**: the model uses camelCase columns (`customerId`, `requestedAmount`, …) while the table is entirely snake_case. Every query through the model would fail (LIKELY; not executed). The customer page calls `GET /loan-applications` and `PUT /loan-applications/:id/status`. **Loans are unused in production.** |
| Depends on | Customers, Packages, Wallets, Accounting, Uploads |

### 1.11 Investments

| Aspect | Current state |
|---|---|
| Tables | `investments` (0: 5 DB columns unmapped), `investment_applications` (0), `investment_transactions` (0) |
| Migrations | `006`, `033`, `001_create_investment_applications.sql`, `018_create_investment_transactions_table.js` |
| Controllers / routes | `investmentController.js`, `investmentApplicationController.js`, `investmentTransactionController.js` (7 journal postings); `/investments`, `/investment-applications*`, `/investment-transactions*` |
| Frontend | `investment/page.tsx`, `investment/(pages)/{applications,investments,investments/create,transactions}`, `src/components/Investment{Application,Transaction}Form.tsx` |
| Inconsistencies | The `investments/page.tsx` list page calls **investment-applications** endpoints; `merchantId = req.user.id \|\| body.merchantId \|\| 1`. **Unused in production.** |
| Depends on | Customers, Packages, Agents, Staff, Accounting |

### 1.12 Accounting (journal and chart of accounts)

| Aspect | Current state |
|---|---|
| Tables | `accounts` (139: default chart seeded lazily per merchant; FK column `merchantId` camelCase), `journal_entries` (25), `journal_lines` (50), `fiscal_periods` (0) |
| Migrations | `20240209-create-accounting-tables.js` (+ root `live_migration_accounting.js`, not a migration) |
| Code | `accountingController.js`, `utils/doubleEntry.js` (`bookDoubleEntry`, `seedDefaultAccounts`), `utils/transactionMapping.js` (`TRANSACTION_MAPPING`, `postJournalForTransaction`: errors swallowed) |
| Routes | `/accounting/{accounts,journal-entries,…/post,…/reverse,ledger,fiscal-periods,reports/*,transaction-mappings}` (VA; agents included) |
| Frontend | `accounting/{page,analytics,analytics/[id],journals,ledgers,reports,setup}` |
| Inconsistencies | `PUT /accounting/accounts` sets `balance` directly; `200500 Customer Loans` is classified as a Liability; **`accounting/page.tsx` calls `/api/summary` and `/api/user/stats`, which don't exist**; journals are posted only on remittance approval, loans, repayments, investments, verification, wallet and webhook, with nothing for charges or billing |
| Depends on | Called by Collections/Remittances, Loans, Investments, Wallet, Webhook |

### 1.13 Subscriptions / Billing

| Aspect | Current state |
|---|---|
| Tables | `subscriptions` (0, with **no migration**, so it was created outside the migration set), `plans` (5), merchant columns `plan_id`, `subscription_status`, `next_billing_date`, `trial_end_date`, `total_debt`, `wallet_balance`, `is_custom_fee`, `custom_fee`, `sms_balance` |
| Code | `services/billingService.js` (hardcoded `PLAN_TIERS`), `server.js:440-466` timer, `merchantManagementController.{getMySubscription,reactivateSubscription}`, `middleware/auth.checkActiveSubscription` |
| Frontend | `dashboard/(pages)/subscription` (raw fetch), admin `billings` pages (plan CRUD) |
| Inconsistencies | Billing reads `wallet_balance`, which nothing credits (first impact **2026-10-22**); admin-edited `plans` are ignored by billing; `is_custom_fee`/`custom_fee` exist in the DB but aren't in the model or billing; manual trigger unreachable; alternative billing designs in `local_edit/billingService*.js` |
| Depends on | Merchants, Agents (count), Wallet |

### 1.14 TransactPay / payments

| Aspect | Current state |
|---|---|
| Code | `utils/transactPay.js`: `createVirtualAccount`, `getVirtualAccountDetails`, `getWalletBalance` (platform-level), `getTransactionDetails`, and a `getWalletTransactions` stub. RSA payload encryption via node-forge. Base URL hardcoded. `webhookController.handleTransactPayWebhook` (unauthenticated). |
| Callers | `authController` (signup virtual account), `customerController`, `walletController` (4 places), `verificationController` |
| Evidence of use | 201 merchant virtual accounts created (§0.2); **0 webhook-originated `Deposit` rows** among the 18 wallet transactions, so no inbound deposit has ever been recorded |
| Inconsistencies | No payout API (transfers are internal only); the webhook path relies on nginx stripping `/api/` (**UNKNOWN** whether live) |

### 1.15 Authentication / Authorization

| Aspect | Current state |
|---|---|
| Code | `middleware/auth.js` (`verifyToken` with DB enrichment, `requireAuthenticated`, `requireSuperAdmin`, `checkActiveSubscription`; `requireMerchant` and `requireCollaborator` are unused), 5 login handlers in 4 controllers, `utils/permissions.js` (a list only) |
| Enforcement points | **Route level only**, by actor *class*. There are **no** permission checks, **no** actor-type restrictions inside the tenant (agents pass everything merchants pass), and tenant checks are **ad hoc per query**. |
| Frontend | 13 `localStorage` keys; no `middleware.ts`; sidebar filtering from `staffPermissions` |
| Details | See `AUDIT_REPORT.md` S2, S3, S6, S8 and `ARCHITECTURE_RECONNAISSANCE.md` §8–§9 |

### 1.16 Notifications / Email / OTP

| Aspect | Current state |
|---|---|
| Code | Two nodemailer transporters (`authController.js`, `collaboratorController.js`), two `sendOTPEmail` implementations and templates, `Math.random` OTPs stored in plaintext on the actor rows (`merchants.otp`, `collaborators.otp`) |
| Infrastructure | Mail is hosted on the **same VPS** (no MX record, so delivery goes to the A record; Webuzo with Exim and Dovecot, plus Roundcube). SPF `~all`, no DMARC. |
| Absent | No queue, no templates module, no SMS (although a `sms_balance` column exists), no in-app notifications. `announcements` exists but is empty. |

### 1.17 File uploads / documents

| Aspect | Current state |
|---|---|
| Code | multer disk storage in `server.js:14-28` (no limits); `express.static('/uploads')` (public) |
| Use | `POST /loans` (`loanForm`), `POST /wallet/upgrade` (government ID, selfie, proof of address, business certificate) |
| Data | `wallet_upgrade_requests` = 0 and `loans` = 0 in production, so the production upload directory may hold only historical or test files (**UNKNOWN**; it wasn't in the app backup scope). `backend/uploads/` in git holds 16 sample ID and loan files. |

### 1.18 Audit / logging

| Aspect | Current state |
|---|---|
| Tables | `activities` (57: written by accounting, merchant management, remittances and the super-admin controller), `admin_logs` (0: `adminLogService`, 1 caller), `transactions` (0: super-admin "all transactions" reads from it, but **nothing writes to it**) |
| Logging | `console.log` everywhere, including OTPs, request bodies and webhook payloads; PM2 log files; no request IDs, no structured logs, no error tracking |

---

## A. Current system domain map

```
                               ┌──────────────── PLATFORM (super_admins) ────────────────┐
                               │ merchants mgmt · plans · wallet tiers · KYC verifications │
                               │ support/faq/announcements · admin roles/staff (no login)  │
                               └──────────────┬───────────────────────────────────────────┘
                                              │ manages
┌──────────────────────────────── TENANT = merchants.id ─────────────────────────────────────┐
│  People:  staff(+roles) ─ agents ─ branches ─ customers        [collaborators: tenantless] │
│  Products: packages (collection | loan | investment; 55-col table)                          │
│  Savings:  collections ──auto──► remittances ──approve──► customer_wallets.collection_balance│
│  Credit:   loan_applications (model broken) · loans · repayments          [unused in prod]  │
│  Invest:   investment_applications · investments · investment_transactions [unused in prod] │
│  Fees:     charges · charge_assignments                                                    │
│  Money:    wallet_transactions (merchant ledger) · customer_wallets · merchants.wallet_balance│
│  Books:    accounts · journal_entries · journal_lines · fiscal_periods                      │
│  Billing:  subscriptions · plan_id · trial/next_billing · total_debt                        │
└──────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                               │
             External: TransactPay (virtual accounts, platform balance, webhook) · SMTP (local Exim)
```

Everything runs in one Express process, and every domain shares the single `models` object. **No domain has its own module boundary.**

## B. Current request / actor flow

```
Browser (Next.js, token in localStorage)
   │  Authorization: Bearer <JWT>   (also accepted: ?token=, body.token, x-access-token)
   ▼
nginx ── /api/* (prefix stripped) or regex path list ──► Express :5000
   ▼
[multer?] → verifyToken ── HS256 verify (fallback secret) ──► req.user = claims
   │            └─ if agent/collaborator/staff lacks merchantId → DB lookup (Agent / Staff by id)
   ▼
requireAuthenticated (merchant|collaborator|staff|agent)   or   requireSuperAdmin (role claim)
   ▼
[checkActiveSubscription]  (≈30 routes; fails open)
   ▼
controller:  merchantId = req.user.merchantId || req.user.id   (94×)  | body.merchantId (6 creates)
   ▼
Sequelize models (+ occasional raw SQL) → PostgreSQL
```

| Actor | Token `type` / claims | Tenant source | Can reach |
|---|---|---|---|
| Super Admin | no `type`; `role` | — | `/superadmin/*` |
| Merchant | `merchant` | `id` | all tenant routes |
| Staff | `collaborator`, `merchantId`, `roleId` | claim | **all tenant routes** (permissions not enforced) |
| Legacy Collaborator | `collaborator` (no `merchantId`) | Staff row with the same ID, else own ID | all tenant routes |
| Agent | `agent`, `merchantId` | claim | **all tenant routes**, including accounting and staff admin |
| Customer | — | — | none |

## C. Current data / relationship map

The associations defined in `models/index.js` are shown below. **Bold** marks cases where the live database differs.

```
merchants 1─* agents, branches, customers, staff, charges, loans, investments, packages,
              collections, wallet_transactions, wallet_upgrade_requests, loan_applications,
              repayments, investment_transactions, remittances, transactions, subscriptions
merchants *─1 plans (plan_id)               plans **has merchant_id FK in DB (not in model)**
branches  1─* customers, staff              agents ─ branches: **association commented out (text field)**
agents    1─* customers, loan_applications, loans, repayments, remittances
roles     1─* staff                         staff 1─* loan_applications, loans (approvedBy)
customers 1─* charge_assignments, loans, investments, collections, loan_applications,
              repayments, investment_transactions, remittances
packages  1─* customers                     collections.package_id: **no FK**
charges   1─* charge_assignments            loans 1─* repayments
admin_roles 1─* admin_staff 1─* admin_logs  wallet_upgrade_requests *─1 admin_staff (reviewedBy)
accounts / journal_entries / journal_lines / fiscal_periods / customer_wallets / remittances / collections:
              associations defined in each model's own associate() (models/*.js), invoked from index.js:329
              — i.e. associations live in TWO places (index.js body + per-model associate())
remittances: model associates Merchant/Customer/Agent, but **the DB has no FKs at all** (collection_id,
              customer_id, agent_id, merchant_id unconstrained); **no association to Collection**
wallet_transactions.processed_by → users: **FK to an unused table**
Duplicate FK constraints in DB: agents.merchant_id, loans.{agent,customer,merchant}_id,
              repayments.{agent,customer,loan,merchant}_id, wallet_transactions.merchant_id
Dual tenant columns: packages.merchantId + packages.merchant_id (both FK'd)
```

### Schema drift, model versus live DB (CONFIRMED)

| Table | Drift |
|---|---|
| `loan_applications` | **Every model column is camelCase; every DB column is snake_case**, so the model is unusable |
| `packages` | 22 DB columns not in the model (loan fields, `seed_*`, `collection_days`, `merchantId`, `created_at`/`updated_at`, …) |
| `merchants` | Duplicate column pairs; 5 unmapped (`status`, `account_number`, `account_level`, `is_custom_fee`, `custom_fee`) |
| `plans` | 5 unmapped (`start_date`, `end_date`, `no_of_branches`, `no_of_customers`, `no_of_agents`) |
| `investments` | 5 unmapped, including **both** `createdAt/updatedAt` columns alongside the model's own timestamps |
| `agents`, `branches`, `customers` | 2–3 unmapped columns each |
| `loans`, `repayments`, `wallet_transactions` | Extra camelCase `createdAt`/`updatedAt` columns next to the mapped ones |
| All other 26 models | Match |

### Tables versus migrations

- `subscriptions` has **no migration** at all.
- `merchants` is touched by 34 migration files, `customers` by 22, `agents` by 15, `packages` by 12 and `loans` by 11.
- `remittances`, `roles`, `wallet_tiers`, `super_admins` and the support tables are each created by exactly one migration.

## D. Current financial flow map

| # | Business event | Entry point | Writes | DB transaction | Journal | Seen in prod |
|---|---|---|---|---|---|---|
| F1 | Collection recorded | `POST /collections[/bulk]` | `collections`; if direct-post and not first saving, `customer_wallets.collection_balance +=` (read-modify-write); `remittances` (Pending) | **No** | No (by policy) | 25 |
| F2 | Remittance approved | `PUT /remittances/:id/approve` | `remittances.status`; `customer_wallets.collection_balance +=` (locked, skipped for first saving); `wallet_transactions` (`remittance_approval`) | **Yes** (locks) | `COLLECTION_RECEIVED` or `CHARGE_DEDUCTION` (errors swallowed) | 25 |
| F3 | Remittance deleted | `DELETE /remittances/:id` | row deleted | — | **No reversal** | ≥1 (id 8) |
| F4 | Customer "Post collection" | customer page → `POST /collections` with `postToCollection:true` | F1 with wallet credit at creation, **then again in F2** | No, then Yes | on F2 | not evident |
| F5 | Customer cash withdrawal | customer page → `POST /wallet/transactions {type:'debit'}` | **merchant** `wallet_transactions` debit only; customer balance unchanged | No | `WALLET_WITHDRAWAL` (async, not awaited) | 0 |
| F6 | Customer withdraw to loan wallet | `POST /wallet/transfer {transactionType:'loan_funding'}` | merchant ledger + `customer_wallets.balance` | **No** | 2× `bookDoubleEntry` | 0 |
| F7 | Merchant manual credit or debit | `POST /wallet/transactions` | `wallet_transactions` `Completed` (any amount) | No | yes (async) | 0 |
| F8 | Deposit via TransactPay | `POST /webhooks/transactpay` (unauthenticated) | merchant: `wallet_transactions` (dedupe on reference); customer: `customer_wallets.balance +=` (no dedupe) | **No** | `WALLET_DEPOSIT` (merchant only) | **0** |
| F9 | Charge assigned | `POST /charges/assign` | `charge_assignments`; `collection_balance -=` (can go negative); `wallet_transactions` | **Yes** (locks) | none | 0 |
| F10 | Loan created | `POST /loans` | `loans`; package charges `collection_balance -=` (locked); `wallet_transactions` | Partial | yes (2 sites) | 0 |
| F11 | Repayment | `POST /repayments`, `DELETE /repayments/:id` | `loans.amountPaid/remainingAmount` (read-modify-write) | **No** | yes on create; **no reversal on delete** | 0 |
| F12 | Investment transaction | `/investment-transactions*` | `investment_transactions`, investment balances | No | yes (7 sites) | 0 |
| F13 | KYC approval | `PUT /superadmin/verifications/status` | tier; journal | — | yes | 0 |
| F14 | Subscription billing | timer / (unreachable) admin route | `merchants.wallet_balance -=`, `total_debt +=`, `subscriptions`, `wallet_transactions` | **Yes** (lock) | none | 0 (first run due 2026-10-22) |
| F15 | Reactivation | `POST /merchant/reactivate` | `merchants.wallet_balance -=`, `subscriptions`, `wallet_transactions` | No | none | 0 |
| F16 | Manual GL edits | `PUT /accounting/accounts` (`balance`), `/journal-entries` CRUD, post, reverse, delete | `accounts`, `journal_*` | partial (3 txns) | is the journal | unknown |

**Where balances are stored or calculated:**
- Merchant wallet: the `wallet_transactions` sum, computed in JavaScript, with different rules in the wallet and dashboard controllers.
- `merchants.wallet_balance`: used only by billing.
- The TransactPay platform float: exposed to every merchant.
- Customer wallets: `customer_wallets.{balance, collection_balance, loan_balance, investment_balance}`.
- Loans: `loans.{amountPaid, remainingAmount}`.
- The GL: `accounts.balance` (atomic increments in `bookDoubleEntry`, but also directly settable).

**No reconciliation exists between any two of these.**

## E. Current frontend / backend boundaries

| Boundary | Current state |
|---|---|
| Transport | Browser calls Express directly (`NEXT_PUBLIC_API_URL`); Next.js has no API routes and no server components fetching data; everything is client-side |
| API clients | 3 styles: `services/api.tsx` (120 exports; **14 never used**), `adminApi.ts` (admin), raw `fetch` in 10 files |
| **Calls with no backend route (CONFIRMED)** | `GET /api/summary`, `GET /api/user/stats` (`accounting/page.tsx`); `/api/merchants`, `/api/merchants/:id` (`components/tables/settings/modals/Addd&editaccountmodal.tsx`); `GET /customer-wallets/:id/transactions` (`dashboard/customer/[id]/page.tsx`) |
| **Calls to routes that can never succeed** | `DELETE /branches/:id` (always 400); `GET` and `PUT /loan-applications*` (model and schema mismatch: LIKELY 500) |
| Routes with no frontend caller | `/collections/overdue`, `/collections/status/:status`, `/collections/:id/collect`, `/customer-wallets/stats/summary`, `/loans/:id` single fetch from a loans page, `/admin/billing/*`, `/collaborator/signup`, `/webhooks/transactpay` (external), `POST /api/auth/login` (agent: no client in the repo) |
| Business logic placement | Mostly backend controllers, but **the frontend decides tenant IDs** (`localStorage.user.id` → `merchantId`) and **permissions** (sidebar), and it composes the withdrawal semantics (F5) |
| Shared types | `interface/type.tsx` (frontend only); nothing is shared with the backend; no API schema is used at runtime (Swagger is documentation only) |
| Auth state | 13 `localStorage` keys; 403 is treated as logout; no route guards |

## F. Duplication / dead code / legacy areas

`ARCHITECTURE_RECONNAISSANCE.md` §13 and §18 have the file-level inventory. This pass adds data-level evidence:

| Area | Evidence of disuse | Status |
|---|---|---|
| `collaborators` table and model, `/collaborator/signup` | 0 rows; no signup page | Legacy (still reachable) |
| `users` table and `User` model | 0 rows; never queried; still the FK target of `wallet_transactions.processed_by` | Dead but structurally referenced |
| `transactions` table and model | 0 rows; read by super-admin "all transactions", never written | Dead write side |
| `admin_staff` / `admin_roles` / `admin_logs` | 0 rows; no admin-staff login | Built, never used |
| Loans (3 tables, 3 controllers, 4 pages) | 0 rows; `LoanApplication` model broken | Built, unused, partly broken |
| Investments (3 tables, 3 controllers, 5 pages, 2 forms) | 0 rows | Built, unused |
| Charges assignment | 4 charges, 0 assignments | Barely used |
| Support, FAQ, announcements, wallet tiers, KYC upgrades, fiscal periods, subscriptions | 0 rows each | Built, unused |
| Duplicate schema artefacts | Dual columns (`merchants`, `packages`), duplicate FKs (5 tables), extra timestamp columns (4 tables), 22 unmapped `packages` columns | Legacy of the camelCase/snake_case oscillation |
| API client exports never imported | 14 (listed in §E) | Dead client code |
| Frontend calls to missing endpoints | 5 (§E) | Broken UI paths |

## G. Architectural risks found during this pass

| # | Risk | Evidence | Status |
|---|---|---|---|
| G1 | **Billing will suspend the only real customer on 2026-10-22** | merchant 4 `trial_end_date = next_billing_date = 2026-10-22`; `wallet_balance = 0` for all merchants; billing reads that column | CONFIRMED (data + code); impact date is a projection |
| G2 | **Uncontrolled merchant signups are creating real bank virtual accounts** | 160 signups in September, 0 verified, 142 virtual accounts; provisioning happens before verification | CONFIRMED (data); "abuse" is LIKELY |
| G3 | Customer balances already diverge from business rules | merchant 4: ₦2,500 over-credit (deleted remittance with no reversal; first saving credited) | CONFIRMED (data) |
| G4 | Customer withdrawals don't reduce customer balances | F5 code path | CONFIRMED (code); 0 occurrences in data |
| G5 | Double credit reachable from the main customer page | F4 code path (`postToCollection:true`) | CONFIRMED (code); not evident in data |
| G6 | Financial rows can be hard-deleted without reversal | remittance #8 orphan credit; delete routes for collections, remittances, repayments and journals | CONFIRMED |
| G7 | The schema can't be trusted from models or migrations | `loan_applications` mismatch; 22 unmapped `packages` columns; `subscriptions` has no migration; dual tenant columns | CONFIRMED |
| G8 | The UI has paths that 404 or 500 | 5 missing endpoints, 1 always-400 delete, broken loan-application reads | CONFIRMED (routes); 500s LIKELY |
| G9 | Most of the code surface is unused in production | Loans, investments, admin staff, support, tiers, KYC, subscriptions: 0 rows | CONFIRMED |
| G10 | The only inbound money channel has never worked end to end | 0 webhook `Deposit` rows despite 201 virtual accounts | CONFIRMED (data); cause UNKNOWN (routing, provider config, or no deposits made) |

**Positive side-effect of G9 and G3 (for later design, not a proposal):** the volume of real financial data is tiny: 1 merchant, 25 collections, 25 remittances, 18 wallet transactions and 25 journal entries. Any future change to the financial model would involve **migrating or re-deriving a very small, auditable dataset**.

---

## Open questions raised by this pass

1. **Are merchants 3, 4, 60 and 61 real businesses, and is merchant 4 live with real money?** This decides how urgent G1 is.
2. **Are the September signups real or abusive?** Is TransactPay charging for, or rate-limiting, virtual-account creation?
3. **Has anyone ever deposited money into a merchant virtual account?** (G10)
4. **Why was remittance #8 deleted, and should the ₦1,500 credit stand?** The same question applies to the ₦1,000 first-saving credit.
5. **Do agents use the system at all** (there's no mobile client in the repo), and how?
6. **Are loans and investments intended product features** that simply haven't been adopted, or were they abandoned?
7. **Who created `subscriptions`** (no migration), **and the 22 extra `packages` columns?**
