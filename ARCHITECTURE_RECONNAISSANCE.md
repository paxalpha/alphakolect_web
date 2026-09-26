# AlphaKolect / Alphaweb — Architecture Reconnaissance

**Date:** 2026-09-25
**Branch inspected:** `recovery/alphaweb-takeover` @ `a5c23e6` (identical to `main`)
**Mode:** Read-only. No files were modified, moved, deleted or committed. Nothing was installed or deployed, and production was not accessed. The only file written is this report.
**Companion documents:** `AUDIT_REPORT.md` (security and bug audit) and `RECOVERY_BASELINE.md` (takeover state).

### Evidence labels

| Label | Meaning |
|---|---|
| **CONFIRMED** | Established directly from code or configuration in this repository |
| **LIKELY** | Strongly indicated, but depends on runtime or production state not visible here |
| **UNKNOWN** | Not enough evidence in the repository; needs production or human input |

### Method

- A static `require()` reachability graph from `backend/server.js`, computed with a throwaway script in the session scratchpad (not in the repo).
- Import tracing for the frontend (the tsconfig path aliases, plus relative imports).
- Byte and function-level diffs of every duplicate file against its live counterpart.
- `git log` dating of the duplicates.
- Manual reading of the auth, tenant, money and migration code paths.

---

## 1. Executive summary

1. **The running system is small and identifiable.**
   - The backend is `backend/server.js` plus 75 reachable files (27 controllers, 39 models, 1 middleware, 2 services, 4 utils, swagger). **CONFIRMED**
   - The frontend is `src/app/**` plus root `components/`, `services/api.tsx`, `interface/type.tsx`, `libs/react-query-provider.tsx` and a few `src/components` files. **CONFIRMED**
   - Everything else is scripts, copies, logs, documents or vendored dependencies: about 5,000 of the 5,944 tracked files.
2. **The duplicate trees are stale copies, not alternate runtimes.** `local_edit/`, `backend_files/`, the root `live_*.js`, `server_*.js`, `services_api.tsx` and `src_dashboard_charges_page.tsx` are imported by nothing, are older than the canonical files, and define no function the canonical code lacks. There are two exceptions to keep for human review (§13). **CONFIRMED** (imports, function sets) and **LIKELY** (that "older" means superseded).
3. **The production server is a git working copy of this repository.** That makes the repository layout part of the production runtime:
   - PM2 points at `./backend/server.js` (`ecosystem.config.js`).
   - The backend's dependencies are **tracked in git** (`backend/node_modules`, 4,504 files).
   - Any commit that removes or moves tracked files will **delete or move them on the server at the next `git pull`**.

   This is the single most important constraint on restructuring. **CONFIRMED** (ecosystem file, deploy scripts). How production actually starts is **LIKELY** the same; the PM2 dump captured in the backup is the authority.
4. **There is no tenant layer.**
   - `merchantId` is derived **five different ways**. The dominant one, `req.user.merchantId || req.user.id` (94 occurrences), silently turns any non-merchant's own ID into a merchant ID.
   - Four create endpoints take `merchantId` **from the request body**.
   - The frontend supplies that body value from `localStorage.user.id`, which for a staff user is the *staff* ID.

   **CONFIRMED**
5. **There is no money layer.**
   - Balances live in five places: `merchants.wallet_balance`, the `wallet_transactions` sum, `customer_wallets.balance` / `collectionBalance`, `loans.amountPaid` / `remainingAmount`, and `accounts.balance`.
   - They are changed from 11 controllers, sometimes in DB transactions and sometimes not.
   - A direct-post collection is credited to the customer's collection balance **twice**: once at creation and again when its auto-created remittance is approved.

   **CONFIRMED** code path. How often it has happened in production data is **UNKNOWN**.
6. **Schema management has no canonical source.** Sequelize models, 60 numbered migrations (JS and SQL, with duplicate prefixes), a replay-everything runner with no applied-migrations table, about 20 ad-hoc backend scripts and about 11 Python scripts all change the schema. `sequelize.sync()` is **not** used at runtime. **CONFIRMED**
7. **The three business actors (Super Admin → Merchant → Collaborator) exist, but the "Collaborator" actor is really the `Staff` table.** The separate `Collaborator` table is a tenantless leftover with open signup. **CONFIRMED**

**The recommended direction is an incremental modular monolith inside `backend/`, kept at its current path, with `server.js` preserved as the entry shim.** The one prerequisite is that deployment must first stop being a `git pull` into a working copy that has dependencies committed. See §16–§17.

---

## 2. Current repository structure

| Path | Tracked files | Role | Runtime? |
|---|---|---|---|
| `backend/` (excluding `node_modules`) | ~315 | Express API, models, migrations, ad-hoc scripts, `old_project` | Partly (§5) |
| `backend/node_modules/` | 4,504 | Vendored dependencies | **Yes, on the server** (LIKELY: the server runs from the git checkout) |
| `src/` | 104 | Next.js App Router application | Yes |
| `components/` (root) | 57 | Shared React components (admin tables, dashboard shell, forms) | Yes |
| `services/api.tsx` | 1 | Merchant/collaborator API client (2,375 lines, 120 exports) | Yes |
| `interface/type.tsx` | 1 | Shared TS types | Yes |
| `libs/react-query-provider.tsx` | 1 | React Query provider (admin only) | Yes |
| `context/index.tsx` | 1 (0 bytes) | Empty; still referenced by `Dockerfile.frontend` (`COPY context`) | No (build-referenced only) |
| `public/` | 117 | Static assets | Yes |
| `local_edit/` | 81 | Snapshot copies of backend/frontend files + build/PM2 logs | No |
| `backend_files/` | 15 | Snapshot copies of controllers/models | No |
| `backend/old_project/` | 60 | Separate TypeScript/Prisma project (its own `package.json`, `schema.prisma`, CI workflow) | No |
| `controllers/roleController.js` (root) | 1 (0 bytes) | Empty file | No |
| `nginx/` | 2 | nginx config variants | No (reference only) |
| Root `*.py` | 555 | Deploy, probe, fix, verify scripts (paramiko → root SSH) | No (operator tooling) |
| Root `*.js` (not config) | ~20 | `live_*Controller.js`, `server_new.js`, `server_*`, `check_*`, `test_*`, `sync_collaborator.js`, `backfill_remittances.js` | No |
| Root `*.json` (not config) | ~12 | Diagnostic dumps (`server_diag.json`, `nginx_check.json`, …) | No |
| Root `*.txt` / `*.log` | 81 / 6 | Diagnostic output | No |
| Root `*.md` | 36 (+2 recovery docs) | Status notes from previous work | No |
| Root `*.conf` | 6 | nginx variants | No (reference only) |
| Root archives | 2 | `alphaweb.tar.gz`, `alphaweb_update.tar.gz` (contain `.env` files) | No |
| Config (root) | — | `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.js`, `postcss.config.{js,mjs}`, `components.json`, `ecosystem.config.js`, `docker-compose.yml`, `Dockerfile.{backend,frontend}`, `deploy.sh`, `setup-env.sh`, `prepare-production.sh`, `env.production.example` | Mixed |
| Tests | 0 | No automated test suite anywhere (`backend/package.json` `test` script is a stub) | — |

---

## 3. Actual runtime architecture

```
                   ┌──────────────────────────── VPS (Webuzo) ─────────────────────────────┐
Browser ──HTTPS──► │ nginx ──► :3000  PM2 "alphaweb-frontend"  (npm start → next start)    │
                   │       └─► :5000  PM2 "alphaweb-backend"   (node ./backend/server.js)  │
                   │                     │                                                 │
                   │                     ├─► PostgreSQL (local, 127.0.0.1, alphacollect_db)│
                   │                     ├─► /backend/uploads (local disk, served publicly)│
                   │                     ├─► local SMTP relay (nodemailer, 2 transporters) │
                   │                     └─► in-process billing timer (setTimeout+setInterval)
                   │  /home/mayowae/public_html/alphaweb  = git working copy of this repo  │
                   └──────────────────────────────────┬────────────────────────────────────┘
                                                      └──► TransactPay API (HTTPS, RSA-encrypted payloads)
                                                      ◄─── TransactPay webhook → /webhooks/transactpay
```

| Fact | Evidence | Status |
|---|---|---|
| PM2 app names `alphaweb-backend` / `alphaweb-frontend`, ports 5000 / 3000 | `ecosystem.config.js` | CONFIRMED (file); matches observed PM2 per `RECOVERY_BASELINE.md` |
| Backend entry is `backend/server.js`; `env_file: ./backend/.env` | `ecosystem.config.js` | CONFIRMED |
| Production DB is local to the VPS | `backend/backup_and_push.py` (`pg_dump -h 127.0.0.1 -U alpha_admin -d alphacollect_db`) | CONFIRMED (script) + baseline |
| Production checkout path | `backend/push_to_github.py`, `backend/probe_git.py` (`BASE = /home/mayowae/public_html/alphaweb`) | CONFIRMED (script) |
| Deploy = edit/upload on the server, then `git add -A && commit && push` **from** the server | `backend/push_to_github.py` | CONFIRMED (script) |
| nginx proxies a regex list of backend paths plus `/api/` (prefix stripped) to :5000, everything else to :3000 | `nginx.conf`, `vps_nginx*.conf`, `alphaweb_new.conf`, … (six variants) | CONFIRMED (repo variants). **UNKNOWN** which one is live; the production nginx config in the backup is the authority |
| The webhook reaches the backend | No repo nginx variant lists `/webhooks/`. It only works if TransactPay calls `/api/webhooks/transactpay` (the `/api/` prefix is stripped). Older copies (`server_new.js`, `local_edit/server.js`) registered `/api/webhooks/transactpay` directly | **UNKNOWN**. Check the URL registered with TransactPay against the live nginx config |
| Docker / compose deployment | `Dockerfile.*`, `docker-compose.yml` exist; `Dockerfile.frontend` copies a `context/` directory that holds only an empty file | LIKELY **not used** in production |

---

## 4. Frontend architecture

### 4.1 Framework and entry points (CONFIRMED)

- **Stack:** Next.js `^15.4.4` (App Router), React 19, TypeScript `strict`, Tailwind 3, `@tanstack/react-query` 5, react-hook-form, zod, Recharts, sweetalert2.
- **Root layout** `src/app/layout.tsx` renders `components/Headerwrapper` (the marketing header). It has no providers and no auth.
- **The admin layout** `src/app/admin/layout.tsx` renders its **own `<html><body>`** nested inside the root layout, which is invalid nesting. It wraps the admin area in `libs/react-query-provider.tsx`.
- `next.config.ts` has only webpack cache tuning. There is **no `middleware.ts`**, so there are no server-side route guards.

### 4.2 Route map (CONFIRMED)

| Area | Routes | Notes |
|---|---|---|
| Marketing (public) | `/`, `/pricing`, `/financial`, `/agents`, `/customers`, `/contact`, `/help`, `/help/[id]` | Static pages linked from `components/Header.tsx`. `/agents` and `/customers` are **marketing pages**, not the dashboard. |
| Merchant auth | `(auth)/login`, `signup`, `verify-otp`, `forgot-password`, `change-password` | Call `services/api.tsx` |
| Collaborator auth | `(auth)/collaborator/login`, `verify-otp`, `forgot-password`, `change-password` | Login uses raw `fetch`. There is **no collaborator signup page**, although the API exposes one. |
| Merchant/collaborator dashboard | `/dashboard`, `/dashboard/customer/[id]`, `/dashboard/(pages)/{accounting/*, agents, branchManagement, charges, collection/{collections,remittance}, customer, investment/{applications,investments,investments/create,transactions}, loan/{applications,loans,repayments}, package/{collection,investment,loan}, settings, staffManagement, subscription, view-agent, view-agent/[id], wallet}` | `src/app/dashboard/layout.tsx` is a UI shell only (header, sidebar, footer) with **no auth check** |
| Super admin | `/admin` (login), `/admin/dashboard`, `/admin/dashboard/(pages)/{auditlogs, billings, merchants, merchants/[id], settings, staffs, support, transactions, verifications, wallet-parameters}` | Uses `src/app/admin/utilis/adminApi.ts` and React Query. **The admin login's "Forgot password?" links to the *merchant* `/forgot-password`**, so the super admin has no recovery flow. |

### 4.3 API clients (CONFIRMED)

| Client | Used by | Base URL | Token source |
|---|---|---|---|
| `services/api.tsx` (120 exports) | Merchant and collaborator pages | `NEXT_PUBLIC_API_URL \|\| http://localhost:5000` | `collaboratorToken \|\| merchantToken \|\| accessToken \|\| user.token` from `localStorage` |
| `src/app/admin/utilis/adminApi.ts` | Admin pages | same env var | `adminToken` |
| Raw `fetch` in 8 components/pages | `components/tables/{billings,settings,supports,wallet}/*`, `dashboard/(pages)/{subscription,wallet}`, collaborator login | same | assorted |

Behaviours of the client worth knowing:

- `handleResponse` treats **403 as logged out** (`services/api.tsx:39`). The backend returns 403 for "subscription expired" (`checkActiveSubscription`), so expired merchants are bounced to `/login` instead of being shown the reactivate flow. **CONFIRMED** code path.
- `redirectToLogin` clears `user`, `token`, `merchantToken` and `accessToken`, but **not `collaboratorToken`**, and `getAuthHeaders` prefers `collaboratorToken`. A stale collaborator token therefore survives "logout". **CONFIRMED**
- `addAgent` and `createBranch` (lines 245 and 355, and similar) send `merchantId = JSON.parse(localStorage.user).id`. For a collaborator, `user` is the staff object (`collaborator/login/page.tsx:51`), so **the staff ID is sent as the merchant ID**. **CONFIRMED** (see §9).

### 4.4 Authentication state (CONFIRMED)

The frontend keeps 13 different `localStorage` keys, including `user`, `merchantToken`, `collaboratorToken`, `accessToken`, `token`, `adminToken`, `userType`, `staffPermissions` and `auth_flow`. Permissions (`staffPermissions`) only filter the sidebar (`components/dashboard/Sidebar.tsx`); the server never enforces them.

### 4.5 Component duplication (CONFIRMED)

The `tsconfig.json` alias `"@/components/*": ["./components/*", "./src/components/*"]` resolves **root `components/` first**.

| Component | Root `components/` | `src/components/` | Winner |
|---|---|---|---|
| `SingleCollectionForm.tsx` | ✔ | ✔ (identical) | root. The `src` copy is shadowed and dead. |
| `BulkCollectionForm.tsx` | ✔ | ✔ (34-line diff) | root, via both the alias and the relative `../../../../../components/…` in `collection/page.tsx`. The `src` copy is shadowed and dead. |
| `InvestmentApplicationForm.tsx`, `InvestmentTransactionForm.tsx` | — | ✔ | `src` (fallback path) |
| `ui/select.tsx` | — | ✔ | `src` |

Other frontend points:

- **Feature boundaries:** there are none in the code. Pages hold their own tables and modals inline (for example `charges/page.tsx` is 1,178 lines and `view-agent/page.tsx` is 771). `services/api.tsx` covers every domain.
- **Types:** there are more than 300 explicit `: any`.

---

## 5. Backend architecture

### 5.1 Bootstrap (CONFIRMED)

`backend/server.js` (501 lines) does everything:

1. Loads `dotenv` from `backend/.env`.
2. Configures multer disk storage to `backend/uploads`, with no file-size or type limits.
3. Requires `./models` (the Sequelize instance plus 39 models registered by hand in `models/index.js`).
4. Requires 26 controllers and `services/billingService`.
5. Sets global middleware: `cors({origin:"*"})`, `bodyParser.json`, `urlencoded`, Swagger UI at `/api-docs`, and **`express.static('/uploads')`**.
6. Calls `db.sequelize.authenticate()` without awaiting it. It does **not** call `sync()`.
7. Registers about 110 routes inline with `app.<verb>(path, [upload.*], verifyToken, requireX, [checkActiveSubscription], controller.fn)`.
8. Registers the error handler, then **the `'*'` 404 handler**, then two admin billing routes. Those two routes are therefore unreachable.
9. `app.listen`, then `scheduleBillingCron()`.

### 5.2 Middleware chain (CONFIRMED)

`backend/middleware/auth.js` is the only middleware file.

| Middleware | Behaviour |
|---|---|
| `verifyToken` | Takes the token from the `Authorization` header, `x-access-token`, `?token=` or `body.token`. Verifies with `JWT_SECRET \|\| 'your-secret-key'`. **Enriches** the token: for `type==='agent'` without `merchantId` it looks up `Agent.findByPk(id)`; for `collaborator`/`staff` without `merchantId` it looks up `Staff.findByPk(id \|\| staffId)`. |
| `requireAuthenticated` | Allows `merchant \| collaborator \| staff \| agent`, with no distinction between them |
| `requireSuperAdmin` | Allows `role ∈ {super_admin, superadmin}`. The `SuperAdmin.role` enum is `superadmin \| admin`, so `admin` rows are locked out of everything. |
| `requireMerchant`, `requireCollaborator` | Defined but **never used** |
| `checkActiveSubscription` | Applied to about 30 mutating routes, not all of them. Fails **open**: it calls `next()` on error and when there is no `merchantId`. |

`utils/permissions.js` is a list of admin permission strings, used only to populate the admin role UI. **It is never enforced.**

### 5.3 Layers present (CONFIRMED)

| Layer | Files |
|---|---|
| Routes | inline in `server.js` |
| Controllers | 27 reachable in `backend/controllers/`. **Unreachable:** `summaryController.js` (hardcoded demo data) and `transactionController.js`. |
| Services | `services/billingService.js`, `services/adminLogService.js` (used by one controller) |
| Utils | `utils/doubleEntry.js` (`bookDoubleEntry`, `seedDefaultAccounts`), `utils/transactionMapping.js` (`TRANSACTION_MAPPING`, `postJournalForTransaction`), `utils/transactPay.js`, `utils/permissions.js` |
| Models | 39 in `backend/models/`, registered by hand, with associations in `models/index.js` |
| Repositories | none |
| Validation | none on the server |
| Jobs | the in-process billing timer in `server.js:440-466` |

---

## 6. Backend dependency map

Format: **route → middleware → controller → business logic → models**. `VA` = `verifyToken + requireAuthenticated`; `+S` = `checkActiveSubscription`. Every chain below is **CONFIRMED** from `server.js` and the controller sources.

| Domain | Routes | Middleware | Controller (primary) | Business logic lives in | Models | Cross-domain dependencies | Duplicates |
|---|---|---|---|---|---|---|---|
| **Merchant auth** | `/merchant/{signup,login,forgot-password,resend-otp,verify-otp,change-password}`, `GET /merchant/profile` | none (profile: `verifyToken`) | `authController.js` | controller (OTP, bcrypt, JWT, nodemailer, TransactPay VA provisioning at signup) | Merchant | TransactPay, mail | `local_edit/authController_{full,new}.js`, `local_edit/auth_controller.js` |
| **Collaborator auth** | `/collaborator/{signup,login,forgot-password,resend-otp,verify-otp,change-password}` | none | `collaboratorController.js` | controller. Login checks **Staff first**, then Collaborator; separate nodemailer | Staff, Role, Collaborator | mail | `local_edit/collab_controller.js`, root `sync_collaborator.js` |
| **Agent auth** | `POST /api/auth/login` | none | `userController.loginUser` | controller | Agent (the `User` model is registered but unused) | — | — |
| **Super admin** | `/superadmin/*` (≈35 routes), `/admin/billing/*` (unreachable) | `verifyToken + requireSuperAdmin` | `superAdminController.js` (1,013 lines), `merchantManagementController.js`, `walletTierController.js`, `verificationController.js` | controllers | SuperAdmin, AdminStaff, AdminRole, AdminLog, Plan, Merchant, Transaction, Activity, SupportTicket, TicketMessage, Announcement, Faq, WalletTier, WalletUpgradeRequest | billingService, transactionMapping | `local_edit/superAdmin_controller.js`, `local_edit/merchantManagement_controller.js` |
| **Merchant self-service subscription** | `GET /merchant/subscription`, `POST /merchant/reactivate` | VA | `merchantManagementController.{getMySubscription,reactivateSubscription}` | controller (reads and decrements `wallet_balance`) | Merchant, Subscription, WalletTransaction, Agent | billingService (`resolvePlanByAgentCount`) | — |
| **Branches** | `/branches` CRUD | VA (+S on create/update) | `branchController.js` | controller | Branch, Merchant | — | — |
| **Agents** | `/agents`, `/agents/:id`, `/agents/:id/status` | VA (+S on create/update) | `agentController.js` | controller | Agent, Merchant | — | `local_edit/agent_controller.js` |
| **Staff (= collaborators)** | `/staff` | VA | `staffController.js` | controller | Staff, Role, Merchant | — | — |
| **Roles (merchant)** | `/roles` | VA | `roleController.js` | controller | Role | — | root `controllers/roleController.js` (empty) |
| **Customers** | `/customers` | VA (+S) | `customerController.js` | controller; creates a CustomerWallet and calls TransactPay | Customer, CustomerWallet, Agent, Branch, Merchant, Package | wallet, TransactPay | `backend_files/`, root `server_customer_controller.js` |
| **Packages** | `/packages`, `/packages/active` | VA | `packageController.js` (has the only `resolveMerchantId(req)` helper) | controller | Package | — | `local_edit/package_controller.js` |
| **Collections** | `/collections`, `/collections/bulk`, `/collections/:id/collect`, `/collections/status/:status`, `/collections/overdue` (**shadowed**) | VA (+S on create) | `collectionController.js` | controller: cycle logic, `isFirstSaving`, CustomerWallet credit, auto-created Remittance | Collection, Customer, Package, CustomerWallet, Remittance | remittances, wallet | `backend_files/`, `live_collectionController.js` |
| **Remittances** | `/remittances`, `/remittances/:id/approve` | VA | `remittanceController.js` | controller: DB transaction and row locks, CustomerWallet credit, journal, WalletTransaction | Remittance, Collection, Customer, CustomerWallet, WalletTransaction, Activity | accounting, wallet | `backend_files/`, `live_remittanceController.js` |
| **Charges** | `/charges`, `/charges/assign`, `/charges/history`, `/charges/assignments/status` | VA (+S) | `chargeController.js` | controller: DB transaction and lock; debits CustomerWallet (can go negative) | Charge, ChargeAssignment, CustomerWallet, WalletTransaction | wallet | `backend_files/` |
| **Loan applications** | `/loan-applications`, `/:id/status` | VA (+S) | `loanApplicationController.js` | controller | LoanApplication, Customer, Agent, Package | loans | — |
| **Loans** | `/loans` (multer `loanForm` upload), `/:id/status`, `/stats/summary` | VA (+S) | `loanController.js` (1,037 lines) | controller: flat-rate interest; charge deduction from CustomerWallet in a DB transaction; journal | Loan, Customer, Package, CustomerWallet, WalletTransaction | wallet, accounting, uploads | `backend_files/`, `live_loanController.js`, `backend_files/loanTransactionController.js` (no live counterpart) |
| **Repayments** | `/repayments`, `/:id/status`, `/stats/summary` | VA (+S on create) | `repaymentController.js` | controller: read-modify-write of `loan.amountPaid`, journal | Repayment, Loan | accounting | `backend_files/`, `live_repaymentController.js` |
| **Investments** | `/investments`, `/investment-applications`, `/investment-transactions` | VA (+S) | `investmentController.js`, `investmentApplicationController.js`, `investmentTransactionController.js` | controllers: daily-amount schedule, 7 journal postings | Investment, InvestmentApplication, InvestmentTransaction, Customer, Agent, Staff, Package | accounting | `backend_files/` (models identical), `live_investmentTransactionController.js` |
| **Merchant wallet** | `/wallet/{balance,transactions,transactions/:id/status,stats,transfer,upgrade,upgrade-status}` | VA (**no +S on any**) | `walletController.js` (1,009 lines), `verificationController.submitUpgradeRequest` | controller: balance summed in JS; tier limits; transfer; TransactPay VA auto-provisioning on `GET /wallet/balance` | WalletTransaction, Merchant, CustomerWallet, Customer, WalletTier, WalletUpgradeRequest | TransactPay, accounting | `live_walletController.js`, `local_edit/wallet_controller.js` |
| **Customer wallets** | `/customer-wallets` | VA | `customerWalletController.js` | controller (PUT sets `balance` directly) | CustomerWallet, Customer | — | `backend_files/` |
| **Accounting** | `/accounting/{accounts,journal-entries,…/post,…/reverse,ledger,fiscal-periods,reports/*,transaction-mappings}` | VA | `accountingController.js` | controller (3 DB transactions) + `utils/doubleEntry.js` + `utils/transactionMapping.js` | Account, JournalEntry, JournalLine, FiscalPeriod, Activity | — (the other domains call into it) | `live_accountingController.js`, root `live_migration_accounting.js` |
| **Dashboard** | `/dashboard/{stats,transaction-stats,agent-customer-stats,agent-summary}` | VA | `dashboardController.js` | controller: aggregates in JS | many | reads every domain | — |
| **Billing** | timer; `/admin/billing/{run,preview}` (unreachable) | superadmin | `services/billingService.js` | service: DB transaction and merchant row lock | Merchant, Agent, Subscription, WalletTransaction | — | `local_edit/billingService{,_v2,_underscored}.js`, `local_edit/run-billing.js` |
| **TransactPay** | `POST /webhooks/transactpay` (no auth) | none | `webhookController.js` | controller | Merchant, CustomerWallet, WalletTransaction | accounting | — |
| **Uploads** | `POST /loans` (`loanForm`), `POST /wallet/upgrade` (4 KYC fields); `GET /uploads/*` static | multer, then VA | `loanController`, `verificationController` | multer disk storage in `server.js` | Loan, WalletUpgradeRequest | — | — |

**Coupling to note:** every money domain writes directly to `CustomerWallet` and/or `WalletTransaction` and calls `postJournalForTransaction`. Wallet, accounting, collections, remittances, loans, charges and investments are one tangled domain in practice.

---

## 7. Database architecture

| Mechanism | Location | Behaviour | Status |
|---|---|---|---|
| Sequelize instance | `backend/models/index.js` | `DATABASE_URL` (TLS forced for Render / `sslmode=require`, `rejectUnauthorized:false`) or `DB_*` vars. Pool max 20 with custom socket validation. | CONFIRMED |
| Model registration | `models/index.js:129+` | Manual `require('./x')(sequelize, DataTypes)` for 39 models; associations defined in the same file | CONFIRMED |
| Naming convention | models | **Mixed.** 13 models use `underscored: true`, and 21 map individual `field:` names. The migrations oscillate: `027_fix_snake_case_columns.sql` / `028_drop_camelcase…` drop camelCase columns, while `044_ensure_merchants_camelcase_columns.sql` adds camelCase columns. | CONFIRMED |
| `sequelize.sync()` | Commented out in `server.js`. Used only in root `sync_collaborator.js` (`Collaborator.sync`), `local_edit/server.js` and `server_new.js`. | CONFIRMED: not at runtime |
| Numbered migrations | `backend/migrations/` (60 files: 001–045 with duplicated prefixes `001/002/003/009/010/011/012/013/015`, plus 5 timestamped Sequelize-CLI style) | Mixed `.sql` and `.js` | CONFIRMED |
| Runner A | `migrations/run-all-migrations.js` | Replays core JS, then **all** `.sql` sorted, then the remaining JS, **on every run**. There is **no applied-migrations table**; it relies on catching "already exists" errors. Six SQL files contain `DROP COLUMN` (mostly `IF EXISTS`-guarded). | CONFIRMED |
| Runner B | `migrations/migrate.js` | Runs all `.js` migrations in the folder | CONFIRMED |
| Sequelize CLI | `backend/.sequelizerc` → `config/config.js` (all envs `use_env_variable: DATABASE_URL`) | Timestamped migrations suggest occasional CLI use. There is no `seeders/` directory. | LIKELY occasional |
| Ad-hoc JS | `backend/{add-*,fix-*,run-*-migration,check-*,show_tables,verify-tables-created,seed-*,create-super-admin,setup-admin-staff}.js` (~25), `backend/scripts/run_migration_0{09..20}.js`, `run_sql_migration.js`, **`truncate-db.js`**, root `run-basic-migrations.js`, `live_migration_accounting.js`, `backfill_remittances.js` | One-off schema and data changes | CONFIRMED |
| Ad-hoc Python | ~11 scripts containing `ALTER/CREATE/DROP` (e.g. root `apply_schema_migrations.py`, `add_missing_columns*.py`, `update_db_enums.py`) | Run against production over SSH | CONFIRMED (the content). Execution history **UNKNOWN**. |
| Other ORM | `backend/old_project/schema.prisma` + Prisma migrations | Separate, abandoned project | LIKELY dead |
| Seeds | `seed-plans.js`, `seed-wallet-tiers.js`, `seed-verifications.js`, `utils/doubleEntry.seedDefaultAccounts` (runtime, per merchant, lazy) | CONFIRMED |

**Canonical source of schema:** **none.** The production database schema itself is the only truth. **Recommendation:** dump the schema only (`pg_dump -s`) from the production backup and diff it against the models before any database work. Whether re-running `run-all-migrations.js` against production would lose data is **UNKNOWN**; treat it as unsafe.

Money column types: about 20 models use `FLOAT`/`DOUBLE` for money. Commit `2333d9a` widened `interest_rate` to `DECIMAL(15,2)`. **CONFIRMED**

---

## 8. Authentication and identity architecture

### 8.1 Identity tables (CONFIRMED)

| Business actor | Table / model | Login route | JWT claims | Tenant link | Permissions |
|---|---|---|---|---|---|
| **Super Admin** | `super_admins` / `SuperAdmin` (role enum `superadmin\|admin`) | `POST /superadmin/login` | `{id, email, role}`, **no `type`** | n/a (platform) | `role` check only |
| Admin staff | `admin_staff` / `AdminStaff` + `admin_roles` / `AdminRole` | **none**: created by the super admin, but no login path exists | — | n/a | `AdminRole` data exists; **never enforced** |
| **Merchant** | `merchants` / `Merchant` | `POST /merchant/login` | `{id, email, type:'merchant'}` | `id` **is** the tenant | full access |
| **Collaborator (business meaning)** | **`staff` / `Staff`** (has `merchantId`, `roleId`, `branch`) | `POST /collaborator/login` (Staff checked first) | `{id, staffId, email, type:'collaborator', merchantId, roleId, role}` | `merchantId` claim | `Role.permissions` returned to the UI; **not enforced** |
| Collaborator (legacy table) | `collaborators` / `Collaborator` (**no `merchantId` column**) | same route, fallback | `{id, email, type:'collaborator'}` | **none**. `verifyToken` looks the ID up in `Staff`. | none |
| Agent | `agents` / `Agent` | `POST /api/auth/login` | `{id, email, type:'agent', merchantId}` | `merchantId` claim | same access as a merchant |
| Customer | `customers` / `Customer` | none | — | `merchantId`, `agentId`, `branchId` | — |
| (unused) | `users` / `User` | none | — | — | — |

### 8.2 Where IDs are mixed (CONFIRMED)

1. **Staff and legacy Collaborator tokens share `type:'collaborator'`**, and their ID spaces overlap. `auth.js:38` resolves `Staff.findByPk(req.user.id)` for both.
2. **`req.user.merchantId || req.user.id`** (94×) treats agent, staff and collaborator IDs as merchant IDs whenever the claim is missing.
3. **`investmentApplicationController.js:409`**: `merchantId = req.user?.id || req.body.merchantId || 1`. This ignores the `merchantId` claim entirely, so for agents and staff it uses **their own ID**, and it defaults to tenant `1`.
4. **`remittanceController.approveRemittance`** looks up the Staff row by **email** (`Staff.findOne({ where: { email: req.user.email } })`) in a branch that is unreachable, because the earlier branch already handles `type==='collaborator'`.
5. **Frontend** `services/api.tsx` sends `localStorage.user.id` as `merchantId`, which is the staff ID for collaborators (§4.3).
6. `customerController`, `loanController`, `investmentTransactionController` and `loanApplicationController` accept `agentId` / `branchId` / `customerId` from the body **without checking that they belong to the tenant**. **LIKELY** for all of them. Spot-checked in `collectionController.createCollection`, which *does* scope the customer lookup by `merchantId`.

### 8.3 Mechanics (CONFIRMED)

- bcryptjs with cost 10.
- 24-hour HS256 JWTs signed with one shared secret for all actor types, and no revocation.
- OTPs come from `Math.random`, are stored in plaintext on the user row, and are **returned in API responses**.
- Two separate nodemailer transporters.
- `change-password` is unauthenticated for both the merchant and collaborator surfaces.
- There is **no super-admin password recovery at all**: no route, no controller, no UI.

---

## 9. Multi-tenancy architecture

### 9.1 How `merchantId` reaches a query (CONFIRMED)

```
JWT claim merchantId? ──yes──► use it
        │no
        ▼
verifyToken enrichment (agent → Agent.merchantId ; collaborator/staff → Staff.findByPk(id).merchantId)
        │still none
        ▼
controller fallback: req.user.id            ← wrong for every non-merchant actor
        │ (some controllers)
        ▼
req.body.merchantId                         ← client-controlled
```

### 9.2 Derivation variants in use (CONFIRMED counts)

| Pattern | Count | Risk |
|---|---|---|
| `req.user.merchantId \|\| req.user.id` | 94 | falls back to the actor's own ID |
| `resolveMerchantId(req)` (`packageController.js:278`) | 7 | the only helper; used only in packages |
| `req.user?.merchantId \|\| (type==='merchant' ? id : null)` | 5 | correct shape |
| `type==='merchant' ? id : merchantId` (`checkActiveSubscription`) | 1 | correct shape |
| `req.user?.id \|\| req.body.merchantId \|\| 1` | 1 | wrong |

### 9.3 Client-supplied tenant IDs (CONFIRMED)

| Endpoint | Code | Effect |
|---|---|---|
| `POST /agents` | `agentController.js:214` (`merchantId` from body → `Merchant.findByPk` → `Agent.create({merchantId})`) | creates an agent in **any** tenant |
| `POST /branches` | `branchController.js:113` | creates a branch in any tenant |
| `POST /customers` | `customerController.js:311` | creates a customer in any tenant |
| `POST /staff` | `staffController.js:125-129` (**the body overrides the token**) | creates a staff login, with a password, in any tenant. That account then logs in with `merchantId` = the victim. |
| `POST /investment-applications` | `investmentApplicationController.js:446` | body first |
| `POST /investment-transactions` | `investmentTransactionController.js:167` | body as fallback |

### 9.4 Missing tenant filter on ID lookups (CONFIRMED)

`agentController.{updateAgent:259, getAgentById:341, updateAgentStatus:363}`, `staffController.updateStaff:191`, `branchController.updateBranch:151`, `customerController.getCustomerById:487`, and `roleController.updateRole:81` (partial).

Global uniqueness checks that should be per tenant: branch names (`branchController.js:116,162`), agent email, staff email.

### 9.5 What is scoped correctly (CONFIRMED)

Collections, remittances, wallet transactions, customer wallets and packages consistently add `merchantId` to `where`, using the derived value. They are only as safe as that derived value.

---

## 10. Financial architecture

### 10.1 Where balances live

| Balance | Stored in | Written by | Read by | DB transaction and lock? |
|---|---|---|---|---|
| Merchant wallet (A) | `wallet_transactions` rows, summed in JS | `walletController.createWalletTransaction:487` (**client-created, `Completed`**), `transferToCustomer:843`, `webhookController` (deposits), `remittanceController` (`remittance_approval` rows), `billingService` (`subscription` debit), `chargeController`, `loanController` | `walletController.getWalletBalance:384`, `transferToCustomer`, `dashboardController` (their inclusion and exclusion rules differ, via `NON_WALLET_TYPES`) | transfer: **no**; webhook: **no**; billing: yes |
| Merchant wallet (B) | `merchants.wallet_balance` | `billingService.billMerchant:127` (decrement), `merchantManagementController.reactivateSubscription:781` (decrement) | billing and reactivation only | billing: yes; reactivate: no |
| Platform float (C) | TransactPay payout wallet (one for the whole platform) | TransactPay | `transactPay.getWalletBalance(currency)`, returned to **every** merchant as `platformMasterBalance` (`walletController.js:445-472`) and **used as the merchant's own balance** in the tier-limit check (`walletController.js:803`) and in `verificationController.js:91`, which pass `merchant.accountNumber` as the *currency* argument | — |
| Customer wallet `balance` | `customer_wallets.balance` | `webhookController:73-79` (read-modify-write), `walletController.transferToCustomer:947`, `customerWalletController.updateCustomerWallet:368` (**set directly from the body**) | wallet UI | **no** |
| Customer `collectionBalance` | `customer_wallets.collectionBalance` | `collectionController.createCollection:396-406` (**no transaction**), `remittanceController.approveRemittance:~300-330` (transaction and lock), `chargeController:526` (transaction and lock), `loanController:544` (transaction and lock) | UI, loans | mixed |
| Loan repayment state | `loans.amountPaid` / `remainingAmount` | `repaymentController.createRepayment:463`, `deleteRepayment:710` (read-modify-write) | loans UI | **no** |
| GL account balances | `accounts.balance` | `utils/doubleEntry.bookDoubleEntry` (**atomic `increment`**, good), `accountingController.updateAccount:117` (**sets `balance` directly from the body**) | reports | bookDoubleEntry: uses the caller's transaction when given |
| Subscription debt | `merchants.total_debt` | `billingService:120` | — (never collected) | yes |

### 10.2 Flows (CONFIRMED)

- **Collection → remittance double credit.** `createCollection` credits `collectionBalance` when `isDirectPost` (`type ∈ {Cash, Manual}` or `postToCollection`) and it isn't the first saving. It *also* auto-creates a `Pending` Remittance for the same amount. `approveRemittance` credits `collectionBalance` again, unless the linked collection `isFirstCollection`. The net effect is that a direct-post collection is credited twice once its remittance is approved. How many production rows are affected is **UNKNOWN**. The backup can answer it: join `remittances.collectionId → collections` where the collection is direct-posted and the remittance is `Approved`.
- **The journal is best-effort.** `postJournalForTransaction` swallows errors (`utils/transactionMapping.js:147-175`). It has 17 call sites across investments (7), loans (2), remittances (2), repayments (2), verification (1), wallet (1 + 2 direct `bookDoubleEntry`) and webhook (1). There are **no journal postings** for collections at creation (by design: "remitted only"), for charges, for customer-wallet transfers other than the two direct `bookDoubleEntry` calls, or for billing.
- **Chart-of-accounts classification to review with an accountant:** `utils/doubleEntry.js` seeds `200500 Customer Loans` as a **Liability**, but loans to customers are normally an **asset** (receivable). **LIKELY** a domain error.
- **TransactPay** (`utils/transactPay.js`) provides:
  - `createVirtualAccount` (RSA-encrypted payload via node-forge), `getVirtualAccountDetails`, `getWalletBalance` (platform-level), and `getTransactionDetails`.
  - `getWalletTransactions`, which is a stub returning `[]`.

  There is **no payout or transfer call**, so a "transfer to customer" is purely an internal ledger move. **CONFIRMED**
- **Reconciliation:** none exists between TransactPay and the local ledger, or between the operational tables and the GL. **CONFIRMED**

---

## 11. Integrations

| Integration | Code | Config | Notes |
|---|---|---|---|
| TransactPay | `backend/utils/transactPay.js`; callers `authController` (signup VA), `customerController`, `walletController` (4 calls), `verificationController`; webhook in `webhookController.js` | `TRANSACTPAY_{PUBLIC_KEY,SECRET_KEY,ENCRYPTION_KEY_BASE64,API_URL}` (the base URL is **hardcoded** at `transactPay.js:9`; the env var is unused) | No webhook signature verification. VA provisioning also happens as a side effect of `GET /wallet/balance`. |
| Email | `authController.js` and `collaboratorController.js`, each with its own nodemailer transporter and template | `SMTP_*`, `EMAIL_*`, `EMAIL_DISABLED` | Local Exim relay by default; `tls.rejectUnauthorized:false` |
| Swagger | `backend/swagger.js` + JSDoc in controllers | — | Public at `/api-docs` |
| File storage | multer in `server.js` → `backend/uploads/` | `UPLOAD_DIR`, `MAX_FILE_SIZE` (both **unused**) | Public static serving |

---

## 12. Background jobs and billing

- **The only scheduled job** is `scheduleBillingCron()` (`server.js:440-466`). It runs a `setTimeout` to the next local midnight, then a `setInterval` every 24 hours. It exists only inside the single PM2 instance (`instances: 1`) and is lost on restart until the next midnight. **CONFIRMED**
- **`runBillingCycle`** (`billingService.js`) selects merchants with `next_billing_date <= now`, status not `Blocked`, and no trial or an expired trial. For each one, **`billMerchant`**:
  1. Locks the merchant row.
  2. Counts **all** agents.
  3. Maps the count to the hardcoded `PLAN_TIERS` (planIds 1–5, independent of the `plans` table).
  4. Deducts from `wallet_balance` (column B), which is **never credited**, so the merchant is suspended.
  5. Writes a `Subscription` row and a `WalletTransaction` (`subscription`, `Completed` or `Failed`).
  6. Sets `next_billing_date = now + 30 days`.

  **CONFIRMED**
- **The manual trigger and preview** (`/admin/billing/run`, `/admin/billing/preview/:merchantId`) are registered after the 404 handler, so they are unreachable. **CONFIRMED**
- **Alternative designs, not live:** `local_edit/billingService.js` / `billingService_v2.js` (`attemptAutoPayment`, `calculateStandardPlanFee`, `getPlanIdForAgentCount`, `updateMerchantPlan`) and `local_edit/run-billing.js`. **LIKELY** abandoned. See §19.

---

## 13. Legacy and duplicate code inventory

### 13.1 Backend and frontend duplicates

All of these were verified as **not imported by any runtime file**. "Only-in-copy" means function names defined in the copy but absent from the canonical file.

| Copy | Canonical | Diff | Last commit (copy → canonical) | Only-in-copy | Assessment |
|---|---|---|---|---|---|
| `backend_files/*Controller.js` (10) | `backend/controllers/*` | 10–942 lines each | 2026-08-04 → 2026-09-18 | none | Stale snapshots. **LIKELY dead.** |
| `backend_files/loanTransactionController.js` | **none** | — | 2026-08-04 | whole file | No live counterpart; not routed. **Needs review** (§19). |
| `backend_files/{investment,investmentApplication}.js` | `backend/models/*` | **identical** | — | — | Dead duplicates |
| `backend_files/{customerWallet,package}.js` | `backend/models/*` | 27 / 16 lines | — | — | Stale |
| Root `live_{accounting,collection,investmentTransaction,loan,remittance,repayment,wallet}Controller.js` | `backend/controllers/*` | 113–892 lines | 2026-08-04 → 2026-09-18 | none | Snapshots of the server at a point in time. **LIKELY dead.** |
| Root `server_new.js`, `server_models_index.js`, `server_customer_controller.js`, `server_customer_model.js` (identical) | backend equivalents | — | 2026-04-20 | routes `/api/merchant/subscription`, `/api/webhooks/transactpay` | Older server version. **LIKELY dead.** |
| Root `services_api.js`, `services_api.tsx` | `services/api.tsx` | 127 lines | 2026-08-04 | none | Excluded in `tsconfig`. **Dead.** |
| Root `src_dashboard_charges_page.tsx` | `src/app/dashboard/(pages)/charges/page.tsx` | 358 lines | — | — | Excluded in `tsconfig`. **Dead.** |
| `local_edit/` (81): server, controllers, models, api, pages, layouts, nginx, next.config, **plus 20+ build/PM2 logs** | various | — | 2026-04-20 (most) | `authController_full.getSubscriptionInfo`; `billingService*.attemptAutoPayment` and others | Working area of the previous developer. **LIKELY dead**, with two items to review. |
| `src/components/{Single,Bulk}CollectionForm.tsx` | `components/*` | identical / 34 lines | — | — | Shadowed by the alias order. **Dead.** |
| Root `controllers/roleController.js` | `backend/controllers/roleController.js` | 0 bytes | 2026-02-09 | — | **Dead** (empty) |
| `context/index.tsx` | — | 0 bytes | — | — | Empty, but **referenced by `Dockerfile.frontend`** |
| `backend/controllers/{summaryController,transactionController}.js` | — | — | — | — | Unreachable from `server.js`. `summaryController` returns hardcoded demo data. **Dead.** |
| `backend/models/user.js` (`User`) | — | — | — | — | Registered but never queried. **LIKELY dead** (the `users` table may hold data: UNKNOWN). |
| `backend/old_project/` (60) | — | — | — | — | Separate TS/Prisma codebase, not referenced. **LIKELY dead.** Possibly useful as a record of the original schema. |

### 13.2 Backend-root scripts (42 `.js` files in `backend/`, only 2 runtime)

Only `server.js` and `swagger.js` are runtime. The other 40 are `add-*`, `check-*`, `fix-*`, `run-*`, `seed-*`, `test-*`, `test_*`, `show_tables`, `verify-tables-created`, `create-super-admin`, `setup-admin-staff`, and `backend/scripts/*` (including `truncate-db.js`). Operator tooling; **CONFIRMED** not runtime.

---

## 14. Deployment and infrastructure inventory

| Group | Files | What it is | Status |
|---|---|---|---|
| **Actual deploy path** | root/`backend/` `deploy_*.py` (34), `upload_*.py` (8), `update_*.py` (8), `push_*.py` (16), `restart_*`, `aggressive_*`, `trigger_*`, `safe_*` | paramiko → `root@<VPS>` with a **hardcoded password**; uploads files, edits on the server, restarts PM2, commits and pushes from the server | CONFIRMED (content). Which ones were last used: UNKNOWN. |
| Diagnostics | `check_*` (115), `find_*` (55), `read_*` (49), `get_*` (19), `diag*`/`diagnose_*` (20), `verify_*` (12), `probe_*` (20), `trace_*`, `list_*`, `grep_*`, `psql_*`, `debug_*` | read or diagnose over SSH | CONFIRMED |
| Fixes | `fix_*` (36), `patch_*` (7), `add_*`, `create_*`, `apply_schema_migrations.py`, `update_db_enums.py` | mutate the server, code or DB | CONFIRMED |
| **Other clients' sites** | `backend/probe_{kosheglobal,modonite*,paxalphaltd,suppakash,thepeopleimpact,vinemorris*,bhislass*}*.py`, `backend/push_{…}.py`, `check_paxalpha_ssl.py`, `fix_ssl_webroot.py`, `read_acme_domain_conf.py` | WordPress and SSL work for **unrelated businesses** on the same VPS | CONFIRMED. Must leave this repository. |
| Mail server | `backend/{verify_all_mails,verify_alphakolect_mail,probe_vps_db_mail,check_mail_tar_size}.py` | Mailbox operations | CONFIRMED |
| PM2 | `ecosystem.config.js` | 2 apps, 1 instance each | CONFIRMED |
| nginx | `nginx.conf`, `nginx/nginx.conf`, `nginx/sites-available/default`, `vps_nginx.conf`, `vps_nginx_new_ports.conf`, `alphaweb_new.conf`, `new_alphaweb.conf`, `alphaweb.conf.new`, `local_edit/alphaweb_nginx.conf` | **Nine variants.** The live one is UNKNOWN (use the backup). | CONFIRMED (variants) |
| Docker | `Dockerfile.backend`, `Dockerfile.frontend`, `docker-compose.yml`, `.dockerignore` | Not the production path. Compose exposes Postgres on 5432. | LIKELY unused |
| Shell | `deploy.sh` (Ubuntu setup, refuses to run as root), `setup-env.sh`, `prepare-production.sh` | Older bootstrap scripts | LIKELY unused |
| Env | `.env`, `backend/.env`, `backend/.env.test`, `env.production.example` | three are **real and tracked** | CONFIRMED |
| Archives | `alphaweb.tar.gz`, `alphaweb_update.tar.gz` | contain `.env` and `backend/.env` | CONFIRMED |
| Logs and dumps | 81 `.txt`, 6 `.log`, ~12 `.json` at the root, plus `local_edit/*.txt` | diagnostic output | CONFIRMED |
| Uploads | `backend/uploads/` (16 files: IDs, selfie, utility bill, CAC certificate, loan forms) | user files in git | CONFIRMED. Whether they're real people's data: UNKNOWN. |

---

## 15. Architectural risks

These are the risks that shape *how* to restructure. The security findings themselves are in `AUDIT_REPORT.md`.

| # | Risk | Why it matters for restructuring | Status |
|---|---|---|---|
| R1 | **Production is a git checkout with vendored `node_modules`** | Removing `backend/node_modules` from git, or moving `backend/`, will delete or move files on the server at the next pull and take the API down. The deploy mechanism must change **before** hygiene work that touches tracked files. | CONFIRMED (repo) / LIKELY (server) |
| R2 | PM2 and nginx reference repo paths (`./backend/server.js`, `cwd: '.'`, `npm start` at the root) | Moving the frontend into `frontend/` or the entry out of `backend/server.js` breaks the process manager unless it is changed at the same time | CONFIRMED (ecosystem) |
| R3 | No tests and no local runnable baseline | No move can be verified. Every step needs, at minimum, a boot check plus a smoke test against a restored copy of the production database. | CONFIRMED |
| R4 | Schema truth exists only in the production DB | Model changes can silently diverge. `run-all-migrations.js` is unsafe to run. | CONFIRMED |
| R5 | Tenant derivation is spread over about 100 call sites | Fixing it controller by controller will miss some. It needs one resolver in middleware, then call sites migrated to it with tests. | CONFIRMED |
| R6 | Money mutations spread over 11 controllers with mixed transactionality | Any refactor of one money flow must preserve the others' side effects (wallet, remittance, journal). A ledger service has to come in *under* the controllers, not around them. | CONFIRMED |
| R7 | Security fixes change behaviour (route order, open endpoints, OTP responses) | The frontend depends on some unsafe behaviours: OTPs in responses, `merchantId` in bodies, 403 treated as logout. Backend fixes need matching frontend changes. | CONFIRMED |
| R8 | Server-side edits never committed | Production may contain code that isn't in git. The backup's `git-status.txt` / `git-diff.patch` must be reviewed and reconciled first. | LIKELY |

---

## 16. Proposed target architecture

This is **incremental, not a rewrite**. `backend/` keeps its location (so PM2 keeps working) and `backend/server.js` remains the entry point as a thin shim. The frontend stays at the repository root until the deploy pipeline is replaced.

```
Alphaweb/
├── backend/
│   ├── server.js                 # shim: require('./src/main') — keeps PM2 path stable
│   ├── src/
│   │   ├── main.js               # listen + start jobs
│   │   ├── app.js                # express app: global middleware, mount routers, 404/error LAST
│   │   ├── config/               # env loading + validation (fail fast on missing JWT_SECRET etc.)
│   │   ├── core/
│   │   │   ├── errors.js         # AppError, central handler
│   │   │   ├── logger.js         # pino + redaction
│   │   │   └── validation.js     # zod helpers
│   │   ├── middleware/
│   │   │   ├── authenticate.js   # verify JWT → req.actor {type, id}
│   │   │   ├── tenantContext.js  # req.tenant {merchantId} resolved from DB, never from body
│   │   │   ├── authorize.js      # requireActor('merchant'|'staff'|'agent'|'platform'), requirePermission()
│   │   │   └── subscription.js   # checkActiveSubscription (fail closed)
│   │   ├── modules/              # one folder per existing domain; each = routes.js, controller.js, service.js, schemas.js
│   │   │   ├── auth/             # merchant, collaborator(staff), agent, platform login + reset flows (shared core, separate surfaces)
│   │   │   ├── platform-admin/   # superAdmin + merchantManagement + walletTier + verification + support/faq/announcements
│   │   │   ├── tenants/          # branches, staff, roles, agents
│   │   │   ├── customers/
│   │   │   ├── packages/
│   │   │   ├── collections/
│   │   │   ├── remittances/
│   │   │   ├── charges/
│   │   │   ├── loans/            # loanApplications, loans, repayments
│   │   │   ├── investments/      # investments, applications, transactions
│   │   │   ├── wallet/           # merchant wallet + customer wallets + ledger service (single writer of balances)
│   │   │   ├── accounting/       # COA, journals, reports; doubleEntry + transactionMapping move here
│   │   │   ├── billing/          # billingService + subscription endpoints
│   │   │   └── dashboard/
│   │   ├── integrations/
│   │   │   ├── transactpay/      # client (from utils/transactPay.js) + webhook handler + signature verify
│   │   │   ├── mail/             # single transporter + templates
│   │   │   └── storage/          # uploads (private), later object storage
│   │   ├── jobs/                 # billing (later: pg-boss), reconciliation
│   │   └── db/
│   │       ├── index.js          # current models/index.js (moved later, re-exported first)
│   │       ├── models/
│   │       └── migrations/       # single tool, baseline from production schema
│   ├── tests/                    # characterization + tenant-isolation + money-flow tests
│   └── package.json
├── src/ , components/ , services/ , interface/ , libs/ , public/   # frontend stays at root for now
├── ops/
│   ├── legacy/                   # archived python/js operator scripts (secrets scrubbed) — NOT deleted until reviewed
│   └── deploy/                   # new key-based, reproducible deploy
├── docs/
│   ├── architecture/             # this report, ADRs
│   ├── recovery/                 # RECOVERY_BASELINE, phase records
│   └── operations/
└── .github/workflows/
```

**Mapping from what exists to the target:**

- Each controller moves **unchanged** into `modules/<domain>/controller.js`.
- Each route block in `server.js` becomes `modules/<domain>/routes.js`, with the same paths, order and middleware.
- `utils/doubleEntry.js` and `utils/transactionMapping.js` move to `modules/accounting/`.
- `utils/transactPay.js` and `webhookController.js` move to `integrations/transactpay/`.
- `services/billingService.js` moves to `modules/billing/`.
- `middleware/auth.js` is split into `authenticate`, `tenantContext`, `authorize` and `subscription`.

**Actor boundaries preserved:** the Platform (super admin), Merchant and Collaborator login surfaces stay separate routes and separate token `type`s (`platform`, `merchant`, `staff`, and `agent`). They share only the crypto and session core. The legacy `Collaborator` table is retired only after its production row count is known.

**Frontend (later):** a single `components/` tree (delete the shadowed `src/components` duplicates), `services/api.tsx` split per domain, `middleware.ts` route guards, one token key per actor, and a proper subscription-expired state instead of treating 403 as logout. The move to `frontend/` happens only after deployment no longer depends on the root layout.

---

## 17. Incremental migration plan

Each phase is one or more small PRs into `recovery/alphaweb-takeover`. **Nothing merges to `main` or reaches the server until the deploy mechanism is replaced (Phase 1).**

### Phase A: local runnable baseline (prerequisite for everything)

- **Moves:** nothing.
- **Does:** restore the production DB backup into a local Postgres. Boot `backend/server.js` and `next dev` against it from the recovery branch. Write a smoke checklist covering each login surface, dashboard load, create collection, approve remittance, create loan and view wallet.
- **Tests before the next phase:** characterization tests (Supertest) that pin *current* responses for the main routes, plus a **tenant-isolation suite**. That suite is expected to fail today; it documents the holes.
- **Verify:** the app boots, and the smoke checklist passes on the restored data.
- **Could break:** nothing, because it is local only.

### Phase B: reconcile production against git

- Review `git-status.txt` / `git-diff.patch` from the production backup. Commit any code that exists only on the server into the recovery branch.
- **Verify:** the recovery branch equals the production code.

### Phase C: replace deployment (unblocks hygiene)

- New key-based deploy that builds from a clean checkout and runs `npm ci` into an untracked `node_modules`, with PM2 pointed at the same paths. Rehearse it on a staging copy.
- **Could break:** the production start-up, so rehearse on staging first.
- **Verify:** PM2 status, the health endpoint and the smoke checklist on staging.
- **Deleted eventually:** nothing yet.

### Phase D: repository hygiene (no runtime code changes)

- **Moves:** operator scripts to `ops/legacy/`, with secrets scrubbed and a README index; status `.md` files to `docs/`.
- **Removes:** tracked `node_modules`, `.env*`, archives, logs and dumps, `uploads/`. Add a proper `.gitignore`.
- **Stays:** every runtime file.
- **Needs tests:** none, as runtime is unchanged. Re-run the Phase A smoke checklist.
- **Could break:** anything that silently reads a moved file. Run the require-graph and `next build` checks.

### Phase E: backend bootstrap split (behaviour-preserving)

- `server.js` becomes a shim. `src/app.js` builds the app, and routes move into per-domain routers with **identical order**. Controllers stay in place and are re-exported.
- **Verify:** the characterization tests pass byte for byte. The route table dumped before and after is identical.
- **Intentional behaviour fixes** are separate, tested commits: moving the 404 handler last (B2) and placing `/collections/overdue` before `/:id` (B3).

### Phase F: tenant context and authorization (behaviour change, security)

- Add `tenantContext` (resolved from the DB by actor type) and `requireActor` / `requirePermission`.
- Migrate the ~100 derivation sites to `req.tenant.merchantId`, one module at a time.
- Remove body `merchantId`, and remove the frontend code that sends it.
- Split `type:'collaborator'` into `staff` versus legacy.
- **Needs tests:** the tenant-isolation suite goes green module by module.
- **Could break:** collaborator and agent flows that rely on the wrong IDs today. Test those actors explicitly.

### Phase G: auth module and super-admin recovery

- Move the login and OTP code into `modules/auth`, with one mailer.
- Add a token-based reset for all three surfaces, starting with super admin (Phase 2 of the recovery plan), and make `change-password` require the reset token.
- **Frontend:** the admin "Forgot password" link gets its own flow.
- **Tests:** reset-token lifecycle, enumeration resistance, rate limits.

### Phase H: money

- Introduce a `wallet/ledger` service as the **single writer** of balances, with DB transactions, row locks and idempotency keys. Route the existing controllers through it one flow at a time: webhook, then transfer, collection, remittance, charges, loans and repayments, investments, then billing.
- Fix the double credit, the `wallet_balance` column, the platform-balance leak and the tier-limit input.
- **Needs tests:** money-flow tests with expected balances, plus a data audit query against the production copy for past double credits **before** changing behaviour.

### Phase I: schema

- Baseline migration from the production schema dump, and a single migration tool with an applied-migrations table.
- Retire `run-all-migrations.js`, `migrate.js` and the ad-hoc schema scripts (to `ops/legacy`).
- Move money columns to `DECIMAL`.

### Phase J: frontend consolidation

- Remove the shadowed `src/components` duplicates, split `api.tsx`, add a `middleware.ts` guard, fix the admin nested `<html>`, and unify token storage.
- Move to `frontend/` only after Phase C, updating PM2, Docker and nginx at the same time.

### Phase K: delete legacy

- After a quarter with no references, delete `ops/legacy` items that have been documented, plus `backend_files/`, `local_edit/`, `backend/old_project/` and the root `live_*` / `server_*` copies.

---

## 18. Files and directories recommended for eventual removal

Remove these only in Phase D or K, after the deploy change, never while the server pulls from git.

- `backend/node_modules/` (untrack, don't delete from the server), `alphaweb.tar.gz`, `alphaweb_update.tar.gz`
- `.env`, `backend/.env`, `backend/.env.test` (untrack; keep `env.production.example`)
- `backend/uploads/*` (untrack; move to private storage)
- Root `*.txt`, `*.log`, diagnostic `*.json` (`server_diag.json`, `nginx_check.json`, `dns_check.json`, `explore*.json`, `search_results.json`, `pkg_search.json`, `restart_results.json`, `server_detail_*.json`, `new_server_diag.json`, `nginx_conf.json`), `.mypy_cache/`
- `backend_files/` (except `loanTransactionController.js`, pending review)
- Root copies: `live_*Controller.js`, `live_migration_accounting.js`, `server_new.js`, `server_models_index.js`, `server_customer_controller.js`, `server_customer_model.js`, `services_api.js`, `services_api.tsx`, `src_dashboard_charges_page.tsx`, `controllers/roleController.js`
- `src/components/SingleCollectionForm.tsx`, `src/components/BulkCollectionForm.tsx`
- `backend/controllers/summaryController.js`, `backend/controllers/transactionController.js`
- `local_edit/` (after extracting the two review items)
- `backend/old_project/` (after a decision on whether to keep it as history)
- Eight of the nine nginx variants (keep the live one, from the backup, under `ops/`)
- `context/index.tsx`, together with its `COPY` line in `Dockerfile.frontend`

The 555 Python scripts and 40 backend-root scripts go to `ops/legacy/` first, **not** removal (see §19).

---

## 19. Files and directories requiring human review

| Item | Why it is uncertain |
|---|---|
| `local_edit/authController_full.js` → `getSubscriptionInfo` | Defined only in the copy. It may be a feature that was lost or one that was replaced by `merchantManagementController.getMySubscription`. The code alone can't tell. |
| `local_edit/billingService.js`, `billingService_v2.js`, `billingService_underscored.js`, `run-billing.js` | They contain `attemptAutoPayment` / `calculateStandardPlanFee` / `updateMerchantPlan`, a different billing design. It's unknown which reflects the business's intended pricing rules. |
| `backend_files/loanTransactionController.js` | There is no live counterpart and no route. It may be an unfinished feature or an abandoned one. |
| `backend/models/user.js` / `users` table | Never queried by code; the production table may still hold rows. |
| `collaborators` table / `Collaborator` model | Still reachable (signup and login fallback). Real users may depend on it; check the production row count and last-login data. |
| `admin_staff` / `AdminStaff` | Created through the UI, but there is no login. It's unknown whether admin staff are expected to log in through `super_admins`. |
| The deploy and fix Python scripts | Some may be the only record of production changes (nginx, SSL, DB enum updates). Review the last-modified ones, those after 2026-08, before archiving. |
| `backend/old_project/` | Possibly the original schema design (Prisma), useful when building the baseline migration. |
| `backend/uploads/*` | Whether they are real customer documents (a data-protection issue) or test fixtures. |
| Which nginx config is live, and the webhook URL registered with TransactPay | Determines whether the webhook currently reaches the backend at all (§3). |
| `deploy.sh`, `setup-env.sh`, `prepare-production.sh`, Docker files | Whether anyone still uses them. |
| The chart of accounts (`200500 Customer Loans` as a Liability) | An accounting decision, not a code one. |

---

## 20. Open questions

1. Does the PM2 dump in the production backup match `ecosystem.config.js` (script path, cwd, env file)?
2. Does production have uncommitted server-side changes (`git-status.txt` / `git-diff.patch` in the backup)?
3. Which nginx config is live, and which path does TransactPay post webhooks to?
4. Does `backend/node_modules` on the server match the tracked copy, or was `npm install` run on the server, leaving the tree dirty?
5. Production row counts for `collaborators`, `users`, `admin_staff`, and for `super_admins` with `role='admin'`.
6. How many approved remittances are linked to direct-post collections (the scale of the double credit)?
7. Are `merchants.wallet_balance` values all 0, or were some set manually? How many merchants are `Suspended` with `total_debt > 0`?
8. Does the production schema match the models (naming: camelCase versus snake_case per table)?
9. Is the TransactPay payout wallet shared by all merchants (one platform float)? The code implies so.
10. Who owns the pricing rules: the hardcoded `PLAN_TIERS` or the `plans` table the admin UI edits?
11. Are the other clients' sites on the same VPS in scope for this recovery, or to be separated?

---

## SAFE NEXT ACTION

**Stand up the local runnable baseline (Phase A step 1). Restore the production database backup into a local PostgreSQL, point a local, git-ignored `backend/.env` at it, and confirm that `backend/server.js` and `next dev` both boot from `recovery/alphaweb-takeover` with no code changes.** It needs no production access and changes no tracked file. Every later cleanup step, including deleting the provably dead files in §18, needs it as the check that nothing broke.
