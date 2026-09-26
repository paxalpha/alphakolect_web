# AlphaKolect — Restructuring Map

**Status:** Draft v1 for approval · **Date:** 2026-09-26 · **Branch:** `recovery/alphaweb-takeover`
**Bridges:** `CURRENT_SYSTEM_INVENTORY.md` (what exists) → `TARGET_ARCHITECTURE.md` v1.1 (what we build), under `BUSINESS_RULES.md` (signed off).
**This is a plan. Nothing has been moved, deleted, or rewritten.** Physical restructuring starts only after this map is approved (TARGET_ARCHITECTURE gate G5).

### Decision 2026-09-26 — new clean repository (ADR-12)

The new system is built in a **new repository** with clean history. Consequences for this map:
- **P0-Q (in-repo quarantine) is no longer on the critical path.** This repo is frozen as-is and becomes the legacy archive; "PORT" items (§2) are **copied** from here into the new repo.
- §4 (Quarantine) and §5 (Purge) now apply to **this legacy repo** and can happen whenever the security track resumes; the history purge (SEC-11) protects the archive, not the new code.
- **The new repo must never import this repo's history** (no `git subtree`/merge from it) — copy files instead.
- P0 starts without waiting for SEC-3/SEC-4.

### Standing assumption — mobile apps (OPEN-16)

> Agent and customer mobile apps are **external consumers** of the AlphaKolect API. Who builds them is undecided. The API is therefore designed as a **versioned, publishable contract from day one** (`packages/contracts` → OpenAPI + typed client), and **no mobile app code lives in this repository**. Either outcome (same team or another team) consumes the same contract.

### Classification legend

| Code | Meaning |
|---|---|
| **PORT** | Keep the screen/asset/knowledge; move it into the new tree and re-wire to the new API |
| **REF** | Behavioural reference only — read it to understand intent, then rebuild |
| **REBUILD** | Replace with a new implementation per the target architecture |
| **QUAR** | Move to `legacy/` untouched (excluded from build); delete after cutover + stabilisation |
| **PURGE** | Delete (and remove from history where sensitive) once the conditions in §6 are met |
| **SEC** | Security incident item — handled by rotation/verification/history purge, independent of code |

---

## 1. Target tree (from TARGET_ARCHITECTURE §21) and where things land

```
apps/api/src/modules/<identity|tenancy|customers|savings|loans|investments|payments|
                      ledger|billing|kyc|support|notifications|documents|audit>/
apps/api/src/{platform,integrations,jobs}/
apps/web/src/app/{(marketing),(auth),(platform),(merchant)}/  + components/ lib/
packages/{contracts,db,config}/   # shared infrastructure ONLY (see note below)
infrastructure/   docs/{business,architecture,security,operations}/   legacy/{app,ops,docs}/
```

> **Package boundaries (MUST):** `packages/db` owns **database infrastructure only** — Prisma schema, migrations, RLS/trigger/grant SQL, fixtures, and the generated client. **No business logic, services, or queries-with-rules live there**; those belong to the owning module in `apps/api/src/modules/<module>/` (its repository/service). `packages/contracts` holds **API shapes only** (zod schemas, OpenAPI, generated client) — no behaviour. `packages/config` holds tooling presets. Anything else goes in a module. This prevents recreating today's "logic scattered across shared files" problem in a new form.

---

## 2. KEEP / PORT (frontend and assets)

The existing UI is the most valuable carried-over asset. Screens are ported **as UI**; every data call is re-wired to generated contract hooks; tenant IDs and permission logic are removed from the client.

### 2.1 Marketing & shared

| Current | Target | Class | Notes |
|---|---|---|---|
| `src/app/page.tsx`, `pricing`, `financial`, `agents`, `customers`, `contact`, `help`, `help/[id]` (+ `help/search.tsx`, `components/data/helpdata.tsx`, `components/FaqAccordion.tsx`) | `apps/web/src/app/(marketing)/…` | PORT | `/agents` and `/customers` here are marketing pages; pricing copy must read tiers from the API (BR-10.2) |
| `components/{Header,Headerwrapper,Footer,menus/menu}.tsx` | `apps/web/src/components/marketing/` | PORT | |
| `public/**` (117 files: logos, icons, images, favicon) | `apps/web/public/` | PORT | Check for any uploaded user files mistakenly in `public/` |
| `src/app/globals.css`, `global.css`, `tailwind.config.js`, `postcss.config.{js,mjs}`, `components.json`, `src/components/ui/select.tsx`, `src/lib/utils.ts`, `components/LoadingButton.tsx` | `apps/web/` design system | PORT | Consolidate to one global CSS + one Tailwind config; drop duplicate `postcss.config.*` |
| Metadata/branding in `src/app/layout.tsx` | `apps/web/src/app/layout.tsx` | PORT | Add providers (React Query, session) here — once |

### 2.2 Auth screens → identity module

| Current | Target | Class | Change |
|---|---|---|---|
| `(auth)/login`, `signup`, `verify-otp`, `forgot-password`, `change-password` | `(auth)/merchant/*` | PORT (UI) | New flow: signup → email verification link/code (not returned in API) → login; reset via single-use token page |
| `(auth)/collaborator/{login,verify-otp,forgot-password,change-password}` | `(auth)/staff/*` (merchant staff) | PORT (UI) | "Collaborator" = merchant staff membership |
| `src/app/admin/page.tsx` (admin login) | `(auth)/platform/login` | PORT (UI) | + MFA step; **own** forgot-password page (today's link points to merchant flow); drop complexity regex on login input |

### 2.3 Merchant dashboard → `(merchant)`

| Current route / file | Target module(s) | Class | Change notes |
|---|---|---|---|
| `dashboard/layout.tsx`, `components/dashboard/{Header,Sidebar,Footer,cards,charts,sidebarmenuitems}.tsx` | shell | PORT | Sidebar from server-provided permissions; suspension redirect via `middleware.ts` (BR-10.4) |
| `dashboard/page.tsx` | ledger/savings reporting | PORT (UI) | Stats from API aggregates (no JS summing of full histories) |
| `(pages)/branchManagement` | tenancy | PORT | Remove delete button (or implement archive); names unique **per merchant** |
| `(pages)/staffManagement`, `components/EditStaffModal.tsx` | tenancy (roles, staff memberships) | PORT | Role editor becomes the owner's permission designer (BR-3) |
| `(pages)/agents`, `view-agent`, `view-agent/[id]` | tenancy (agent memberships), savings | PORT | Activate/deactivate (BR-10.6b); show last activity (BR-10.6a) |
| `(pages)/customer`, `dashboard/customer/[id]` | customers, savings, loans, payments | PORT (UI), heavy rewire | Customer 360: wallets become ledger balances (Collection/Target/Loan) + Live wallet; withdrawal UI rebuilt per BR-7 (source wallet + destination); remove direct wallet-transaction posting |
| `(pages)/package/**` (collection/loan/investment editors) | savings (packages, fee rule) | PORT (UI) | Exactly one fee rule: first-contribution **or** percentage (BR-6.1) |
| `(pages)/collection`, `collection/(pages)/collections`, `components/{Single,Bulk}CollectionForm.tsx` | savings | PORT (UI) | Merchant-side recording kept for staff with permission; channel = cash; idempotency key per submission |
| `collection/(pages)/remittance` | savings (remittances) | PORT (UI) | Remittance = batch of recorded collections; approve / reject / partial (OPEN-4); no delete |
| `(pages)/charges` | savings (fees) / billing? | REF → REBUILD UI | Current "charges" overlap with package fee rules; re-scope before porting |
| `(pages)/loan/**` (applications, loans, repayments) | loans | PORT (UI) | Applications page must use the applications API (today it creates loans directly) |
| `(pages)/investment/**`, `src/components/Investment{Application,Transaction}Form.tsx` | investments | PORT (UI) | Fix page/API naming confusion (investments page calls applications API) |
| `(pages)/accounting/**` (setup, journals, ledgers, reports, analytics) | ledger | PORT (UI) | System accounts locked; manual journals post/reverse only (no delete, no balance edits); `accounting/page.tsx` loses the two non-existent endpoints |
| `(pages)/wallet` | payments (merchant Live wallet), kyc | PORT (UI) | Balance from ledger/provider; no platform-wide balance shown; tier upgrade → kyc |
| `(pages)/subscription` | billing | PORT (UI) | Becomes the suspension landing page with amount owed (BR-10.4) |
| `(pages)/settings` | tenancy / identity | PORT (UI) | |

### 2.4 Platform console → `(platform)`

| Current | Target module | Class | Notes |
|---|---|---|---|
| `admin/layout.tsx`, `admin/dashboard/layout.tsx`, `components/admin/*`, `admin/utilis/sidebarmenuitems.tsx`, `admin/global2.css` | shell | PORT | Remove nested `<html>`; one provider tree |
| `admin/dashboard/page.tsx` | platform reporting | PORT (UI) | |
| `(pages)/merchants`, `merchants/[id]`, `components/tables/merchants/**` | tenancy (platform view) | PORT (UI) | Status actions map to new merchant lifecycle; **no platform "reset merchant password"** — use reset-link flow |
| `(pages)/billings`, `components/tables/billings/**` | billing | PORT (UI) | Tier editor with effective dates (BR-10.2) |
| `(pages)/staffs`, `components/tables/Staff/**` | identity (platform memberships) | PORT (UI) | Roles: support / verification / finance + grants (BR-3) |
| `(pages)/verifications`, `components/tables/verifications/**` | kyc | PORT (UI) | |
| `(pages)/wallet-parameters`, `components/tables/wallet/**` | kyc (tiers/limits) | PORT (UI) | |
| `(pages)/support`, `components/tables/supports/**` | support | PORT (UI) | |
| `(pages)/transactions`, `components/tables/transactions/**` | payments/ledger (platform view) | PORT (UI) | Reads payment orders + platform ledger (today reads an empty `transactions` table) |
| `(pages)/auditlogs`, `components/tables/auditslogs/**` | audit | PORT (UI) | |
| `(pages)/settings`, `components/tables/settings/**` | identity (own profile, MFA) | PORT (UI) | Account modal's `/api/merchants` calls dropped |

### 2.5 Knowledge worth keeping (REF → docs)

| Source | Keep as | Target |
|---|---|---|
| `backend/utils/doubleEntry.js` default accounts, `utils/transactionMapping.js` | Starting point for COA + posting rules (OPEN-8) | `docs/architecture/ledger-posting-rules.md` |
| `backend/services/billingService.js` `PLAN_TIERS`, `local_edit/billingService*.js` | Pricing history & alternative designs | `docs/business/billing-notes.md` |
| `collectionController.isFirstSaving`, cycle/counter logic | Fee/cycle semantics to test against BR-5/6 | tests in `savings` |
| `backend/utils/transactPay.js` (payload encryption, endpoints) | TransactPay API knowledge | `apps/api/src/integrations/transactpay` (rewritten) + `docs/architecture/transactpay.md` |
| `backend/swagger.js` + controller JSDoc | Endpoint catalogue for parity checking | parity checklist (§7, Phase 12) |
| `interface/type.tsx` | Field names/labels used by UI | superseded by `packages/contracts` |
| `nginx*.conf` variants, `ecosystem.config.js` | Record of old runtime | `docs/operations/legacy-runtime.md` |

---

## 3. REBUILD (backend and platform foundations)

| Target | Replaces (current) | Governing rules |
|---|---|---|
| `platform/` config, errors, logging, HTTP, sessions middleware, tenant context | `server.js` bootstrap, `middleware/auth.js`, `config/config.js`, `swagger.js` | ADR-3/6/7, §22 |
| `packages/db` (Prisma schema, RLS/trigger SQL, grants, fixtures) | `models/**` (39), `migrations/**` (60), all ad-hoc schema scripts | ADR-4, §19 |
| `packages/contracts` | `services/api.tsx`, `admin/utilis/adminApi.ts`, raw `fetch` calls, `interface/type.tsx` | §17, OPEN-16 |
| identity | `authController`, `collaboratorController`, `userController`, super-admin login, OTP code | BR-2.2, 3; §3 |
| tenancy | `branchController`, `staffController`, `roleController`, `agentController`, merchant parts of `merchantManagementController` | BR-3, 10.6; §4 |
| customers | `customerController` | BR-4.2, 5.1, 11.3 |
| savings | `packageController`, `collectionController`, `remittanceController`, `chargeController` (fee parts) | BR-5, 6, 7 |
| loans | `loanApplicationController`, `loanController`, `repaymentController` | BR-8 |
| investments | `investment*Controller` (3) | BR-9.1 |
| payments | `utils/transactPay.js`, `webhookController`, `walletController` (Live wallet parts) | BR-2.3, 4, T1–T3; §12 |
| ledger | `accountingController`, `utils/doubleEntry.js`, `utils/transactionMapping.js`, `customerWalletController` balances | BR-4.4, 11.1; §7 |
| billing | `services/billingService.js`, `server.js` cron, subscription/reactivation handlers, `checkActiveSubscription` | BR-1.3, 10; §11 |
| kyc | `verificationController`, `walletTierController` | §13 |
| support | ticket/FAQ/announcement parts of `superAdminController` | BR-9.1 |
| notifications | two nodemailer transporters + OTP templates | §14 |
| documents | multer + `express.static('/uploads')` | §15 |
| audit | `activities`, `admin_logs`, `adminLogService` | BR-11.4; §16 |
| jobs | `setTimeout/setInterval` billing | ADR-9; §20 |
| infrastructure | `Dockerfile.*`, `docker-compose.yml`, `deploy.sh`, `setup-env.sh`, `prepare-production.sh`, PM2 config | ADR-10; §23 |

---

## 4. QUARANTINE → `legacy/` (one commit, Phase 0-Q, after approval)

| Current path | Destination | Notes |
|---|---|---|
| `backend/` (excluding `node_modules`, `uploads`, `.env*`) | `legacy/app/backend/` | includes `old_project/`, `migrations/`, `scripts/`, 40 backend-root scripts |
| `src/`, `components/`, `services/`, `interface/`, `libs/`, `context/` | `legacy/app/frontend/` | Ported screens are **copied** out of here into `apps/web` during Phases 11–12 |
| `local_edit/`, `backend_files/`, root `live_*.js`, `server_*.js`, `services_api.*`, `src_dashboard_charges_page.tsx`, `controllers/roleController.js`, root helper `*.js` (`check_*`, `test_*`, `sync_collaborator.js`, `backfill_remittances.js`, `merchant_debug.js`, `mmc_new.js`, `run-basic-migrations.js`) | `legacy/app/copies/` | stale snapshots (inventory §F) |
| Root `*.py` (555) and `backend/*.py` | `legacy/ops/` | **only after secret scrubbing (§6)**; add `legacy/ops/INDEX.md` grouping deploy / diag / fix / other-client scripts |
| Root config & infra variants: `nginx*.conf`, `vps_nginx*.conf`, `alphaweb*.conf*`, `new_alphaweb.conf`, `nginx/`, `ecosystem.config.js`, `Dockerfile.*`, `docker-compose.yml`, `.dockerignore`, `deploy.sh`, `setup-env.sh`, `prepare-production.sh`, `env.production.example` | `legacy/ops/runtime/` | live nginx config from the backup replaces these as the record |
| Root status docs (36 `*.md` from before 2026-09-25), `accounting_mappings.pdf` | `legacy/docs/` | |
| Root `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts` | `legacy/app/frontend/` | replaced by workspace configs |

`legacy/` is excluded from lint, typecheck, build and CI (`.gitignore` is **not** used for this — it stays tracked for reference).

---

## 5. PURGE LATER

| Item | Condition before deleting | History rewrite? |
|---|---|---|
| `backend/node_modules/` (4,504 files) | Old server frozen (no more `git pull`), §6 done | Optional (size) |
| `alphaweb.tar.gz`, `alphaweb_update.tar.gz` | Secrets inside rotated (§6) | **Yes** (contain `.env`) |
| Root `*.txt` (81), `*.log` (6), diagnostic `*.json` (~12), `local_edit/*.txt|*.log`, `.mypy_cache/` | None (non-authoritative) — verify no secrets in them first | If secrets found |
| `.env`, `backend/.env`, `backend/.env.test` | Rotation verified (§6) | **Yes** |
| `backend/uploads/*` (16 ID/selfie/loan files) | Owner confirms whether real people (NDPA) | **Yes** |
| `legacy/` entirely | New system in production + agreed stabilisation period + parity checklist signed | No |

---

## 6. SECURITY INCIDENT / SECRET ROTATION (independent track, starts now)

The owner states all account passwords have been changed and the previous developer's access removed (Follow-up A3). This track **verifies** that and covers application-level secrets the owner's list did not include.

| # | Secret / exposure | Where exposed | Action | Status |
|---|---|---|---|---|
| SEC-1 | VPS root SSH passwords (several historical) | ~337 root/`backend` `.py` scripts | Owner rotated; **verify**: password auth disabled, root login disabled, `authorized_keys` audited, named keys for owner + son | Owner: done · **Root SSH hardened & verified 2026-09-26:** old RSA key removed (backup kept), only key = `olamide-laptop-2026-09` (ED25519 `SHA256:Ye5jIYGt…pqq8w`), `PermitRootLogin without-password` (effective, no Match overrides), `sshd_config` backed up, `sshd -t` validated, graceful reload, key-only root login re-verified from laptop. **Still open:** second owner-held key or confirmed provider-console access (single point of failure); other accounts' keys/password use review; `PasswordAuthentication` for non-root users left on deliberately |
| SEC-2 | Webuzo panel credentials | scripts (if any) | Owner rotated; verify | Owner: done |
| SEC-3 | Production DB password (`alpha_admin`) | `backup_and_push.py` etc. | **Rotate via the controlled access-handover procedure** (not in owner's list), then update the frozen server env and verify the frozen app still connects | Pending |
| SEC-4 | `JWT_SECRET` | `backend/.env` (tracked) | **Rotate via the handover procedure** on the frozen server; verify existing sessions are invalidated and login still works | Pending |
| SEC-5 | TransactPay public/secret/encryption keys | `backend/.env`, archives | Owner rotated; **verify** frozen server env still works or is intentionally broken | Owner: done |
| SEC-6 | SMTP / mailbox passwords | `backend/.env`, scripts | Owner rotated; verify | Owner: done |
| SEC-7 | Super Admin app password in `test_approve_direct.py` (historical) | repo | Not current (checked); owner forgot current → out-of-band reset by son's own login | Pending |
| SEC-8 | `OTP_MASTER` | `backend/.env` | Remove from frozen server env | Pending |
| SEC-9 | Other clients' WordPress/mail credentials (`probe_*_wp_config.py` outputs, `push_*.py`) | repo scripts/outputs | Inform owner; those sites' owners should rotate DB/admin credentials | Pending (OPEN-18) |
| SEC-10 | KYC-like uploads in git | `backend/uploads/` | Determine real vs test; purge from history | Pending |
| SEC-11 | Git history | all of the above | After SEC-1..10: `git filter-repo` purge + coordinated force-push (owner holds GitHub); all clones re-cloned | Pending |
| SEC-12 | GitHub access | repo settings | Owner removed previous developer; verify collaborators & deploy keys; son added with own account | Owner: done · Verify: pending |
| SEC-13 | ~197 fake-signup TransactPay VAs | TransactPay | Ask TransactPay to close (BR-2.4); ask T3 costs | Pending |
| SEC-14 | Credentials for **3 old Render Postgres databases** (instances `d3ai44…` Oregon, `d2phh3…` Oregon, `d5chbk…` Virginia) — may hold copies of merchant/customer data | legacy docs & one-off scripts; also briefly in this repo's first push (SEC-15) | Owner identifies the Render account (likely previous developer's); databases **deleted** by the account holder, or passwords reset. Do not connect with the leaked credentials | Pending |
| SEC-15 | This repo's first push (`47acb15`, 2026-09-26) contained SEC-14 credentials, a Mailtrap sandbox password and the master OTP value | `paxalpha/alphakolect_web` | 8 credential-bearing scripts removed, 7 docs redacted (2026-09-26); **amend + force-push** replaces the commit; reset Mailtrap credentials; confirm repo is private; optionally ask GitHub Support to purge the orphaned commit | Cleanup done locally · amend/push pending |

**Rule:** no file containing a secret is moved into `legacy/ops/` until it is scrubbed (secret → `<REDACTED>`), because `legacy/` remains tracked.

**Rule — production is never touched casually.** Server-side items follow one fixed sequence: **read-only verification → access handover (named logins for owner + son, confirmed working) → secret rotation → verification against the frozen production app → only then quarantine/rebuild steps that depend on it.** Starting the rebuild is not by itself a reason to change anything on the server; each server change is a separate, announced, backed-up step with a rollback note.

---

## 7. BUILD ORDER

### 7.1 Dependency graph

```
 Recovery docs ✔ → Security verification (SEC-1/3/4, via handover) → RESTRUCTURING_MAP approved
  │
 P0 + P0-Q  ONE pull request, merged only when CI proves the new skeleton boots:
     commit 1  git mv old tree → legacy/  (history preserved; secrets scrubbed first)
     commit 2  workspace skeleton (root manifest, apps/, packages/, CI)
     → main never contains a half-moved repo; old app is frozen and not built from main
  │
 P0  Foundation (monorepo, CI, config validation, logging, local compose, FakeProvider)
  │
 P1  packages/db baseline  ──────────────►  P2  packages/contracts skeleton + codegen
  │                                              │
 P3  identity (sessions, verify, reset, MFA)     │  (every later phase adds its contracts)
  │                                              │
 P4  tenancy (merchants, branches, memberships, roles) + TenantContext + RLS
  │
 P5  authorization (permission catalog, policies, audit hooks) ── audit module
  │
 P6  ledger (accounts, entries, reversals, projections, invariants)
  │
 P7  customers ──► P8  savings: packages/fees, cash collections, remittances, withdrawals
                        │
 P9  payments (PaymentProvider, VA provisioning jobs, payment orders, events, reconciler)
  │        │
  │        └──► P8b Live-wallet collections  ⛔ customer Live wallets feature-gated (OPEN-12)
  │
 P10 billing (plans/tiers, activity roll-up, invoices, charge, suspend/restore)   ◄ needs P4, P6, P9
  │
 P11 loans, investments (parallelisable after P8 + P9)
 P12 notifications, documents, kyc, support (parallelisable after P5)
  │
 P13 frontend migration — per module, starts as soon as that module's contracts exist
      (auth screens after P3 · merchant shell after P4/P5 · savings screens after P8 · …)
  │
 P14 integration, parity checklist, security review, UAT with owner (BR traceability report)
  │
 P15 production infrastructure + cutover + decommission old app
```

Security track §6 runs **in parallel from now**. **P0 and P0-Q ship together as one pull request** after this map is approved and SEC-1/3/4 are verified: they can't be split cleanly, because the old frontend's `package.json`/`tsconfig.json`/`next.config.ts` occupy the repo root where the new workspace manifest must live. The PR merges only when CI proves the new skeleton installs, builds and boots; until then `main` is untouched. **Invariant: at no commit on `main` is the repository half-moved.**

### 7.2 Phases with exit criteria

| Phase | Delivers | Exit criteria (all MUST pass in CI) |
|---|---|---|
| **P0 + P0-Q** (one PR) | Quarantine (§4) via `git mv` **and** the new workspace skeleton: pnpm workspace, TS configs, lint, gitleaks, CI, `docker compose` (Postgres), env validation, pino, error envelope, health endpoint, FakeProvider | Old server confirmed frozen; secrets scrubbed in moved scripts; `legacy/` excluded from build/lint/CI; `pnpm install && pnpm build && pnpm test` green in CI; `/v1/health` boots locally; app refuses to boot without required secrets; PR merged as a unit |
| **P1** | Prisma baseline, module schemas, roles (`app`/`migrator`/`readonly`), ledger triggers, RLS scaffolding, UUIDv7, fixtures | Migrations apply from zero; `app` role cannot UPDATE/DELETE ledger lines (test) |
| **P2** | `packages/contracts` + OpenAPI generation + typed client + contract diff check | Generated client compiles in `apps/web`; OpenAPI artifact published per build |
| **P3** | Identity: signup, email verification, login per audience, refresh rotation, logout, reset tokens, MFA (platform), rate limits | Tests: no token/OTP in responses; reset single-use + expiry; session revocation on reset; MFA required for platform |
| **P4** | Tenancy: merchant lifecycle, branches, staff/agent memberships, roles, TenantContext, RLS on tenant tables, composite FKs | **Tenant isolation matrix green** (every tenant endpoint × foreign tenant ⇒ 404) |
| **P5** | Authorization catalog + policies, audit module | **Authorization matrix green** (agents: only record collections for assigned customers — BR-3) |
| **P6** | Ledger: post/reverse, projections, statements, trial balance/BS/P&L | Property tests: balanced entries, projection = Σ lines, reversal nets to zero; BR-11.1 test |
| **P7** | Customers: onboarding, agent assignment, one enrolment, anonymisation | BR-5.1, BR-11.3 tests |
| **P8** | Savings: packages + single fee rule, cycles, cash collection, remittance approve/reject, fee postings with narrative, withdrawals (cash / to loan) | BR-5.2, 5.3, 5.5, 5.6, 6.1, 6.2, 7.1–7.4 tests; no double credit possible (test) |
| **P9** | Payments: provider port, TransactPay adapter (sandbox), VA provisioning after verification, payment orders, verified event ingestion, reconciler | BR-2.3 test; replayed/forged event cannot credit (test); reconciler detects drift (test) |
| **P8b** | Live-wallet collections & repayments | BR-5.4, 8.2 tests on sandbox; **production flag off until OPEN-12** |
| **P10** | Billing: editable versioned tiers, 90-day trial, billable-agent roll-up (15-day inactivity), invoices, charge VA→platform, suspension per audience, auto-restore | BR-1.3 (global pause flag), 10.1–10.6 tests incl. suspension behaviour per audience |
| **P11** | Loans; investments | BR-8.1–8.3 tests; OPEN-9 decisions applied |
| **P12** | Notifications (outbox, provider email), documents (private storage), KYC (tiers/limits enforced in payments), support | Upload tests (type/size, signed URL expiry); limit enforcement test |
| **P13** | Frontend ported per §2, `middleware.ts` guards, generated hooks | Playwright: login per audience, collection→remittance→approval, withdrawal, suspension redirect |
| **P14** | Parity checklist vs legacy endpoints (§2.5), security review, UAT | **BR traceability report: every BR-x.y covered**; owner signs UAT |
| **P15** | Dedicated infra, backups + restore test, monitoring, DNS cutover, old app decommissioned | Runbooks in `docs/operations/`; rollback rehearsed |

### 7.3 Suggested first milestone ("walking skeleton")

P0 + P1 + P2 + a thin P3/P4 slice: a merchant can sign up, verify email, log in, create a branch, and see it — end-to-end through contracts, TenantContext, RLS, audit, CI, and a Playwright test. Everything after builds on a proven spine.

---

## 8. Parallel, non-code items

| Item | Owner | Blocks |
|---|---|---|
| OPEN-12 custody/regulatory advice | Owner (+ lawyer) | P8b in production |
| TransactPay: sandbox access, transfer API details (T1), event/verification method (T2), VA cost/closure (T3), pooled vs per-account | Owner/son with TransactPay | P9 details, SEC-13 |
| Mobile apps ownership & timeline (OPEN-16) | Owner | Contract publishing cadence only |
| Accountant review of COA (OPEN-8) | Owner | P6 naming (not structure) |
| Hosting/email/storage provider choices | Son (+ owner approval) | P12, P15 |
| Other client sites on the VPS (OPEN-18) | Owner | SEC-9, decommission scope |

---

## 9. Approval

- ☐ Classification (§2–§5) approved
- ☐ Security track (§6) accepted and started
- ☐ Build order & exit criteria (§7) approved
- ☐ P0 + P0-Q (single PR: quarantine + skeleton) may proceed once SEC-1, SEC-3, SEC-4 are verified through the access handover

*These boxes stay unchecked until the project owner and the implementer formally approve.*
