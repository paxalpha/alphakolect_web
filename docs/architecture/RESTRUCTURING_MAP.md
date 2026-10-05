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

### Decision 2026-09-26 — this repository is the reconstruction workspace (ADR-13)

The owner confirmed: `paxalpha/alphakolect_web` is where the new system is built. Consequences:
- The imported legacy application moves **as-is** into `legacy/current-system/` (one rename-only commit), replacing the `legacy/app` / `legacy/ops` / `legacy/docs` split in §4. Its layout is preserved so it remains runnable as a behavioural reference.
- Governing documents move to `docs/business`, `docs/architecture`, `docs/operations`.
- Nothing deploys from this repository, so the quarantine cannot affect production. The old server stays frozen under the security containment track.
- "PORT" items (§2) are copied from `legacy/current-system/` into `apps/` when their phase starts.

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

> **Superseded by ADR-13 (2026-09-26):** everything below moves together into `legacy/current-system/` with its current relative layout. The table remains useful as the classification of what each legacy area is.

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
| SEC-15 | This repo's first push (`47acb15`, 2026-09-26) contained SEC-14 credentials, a Mailtrap sandbox password and the master OTP value | `paxalpha/alphakolect_web` | 8 credential-bearing scripts removed, 7 docs redacted (2026-09-26); **amend + force-push** replaces the commit; reset Mailtrap credentials; confirm repo is private; optionally ask GitHub Support to purge the orphaned commit | Cleanup done · **history rewritten and force-pushed**: `main` now starts at a single root commit `5bffec5` with no plaintext credentials (a further credential in `backend/migrations/migrate.js` was also removed in that rewrite; verified 2026-09-26). Still open: reset Mailtrap credentials; optional GitHub Support purge of orphaned commits |

**Rule:** no file containing a secret is moved into `legacy/ops/` until it is scrubbed (secret → `<REDACTED>`), because `legacy/` remains tracked.

**Decision 2026-09-26 — two security tracks.** Because nothing is live (G1, BR-1.1) and the legacy application is being replaced, security work is split:
- **SEC-A — containment (continue):** production access ownership, SSH hardening, backup verification, credential ownership and rotation, external cleanup (e.g. the Render databases, SEC-14), old deploy-key cleanup, keeping the old server frozen so nobody deploys from a legacy checkout, and preserving recovery access. These protect the environment without redesigning the application.
- **SEC-B — legacy application remediation (frozen):** JWT/session design, tenant authorization, wallet mutation, webhook verification, OTP flows, billing and accounting transactions. These are rebuilt correctly in the new architecture (P3–P10) rather than patched in `legacy/current-system/`.
- **Exception:** if any real customer money or real customers are found to be using the legacy system (i.e. G1 no longer holds), the dangerous financial paths must be contained in the legacy system immediately, in parallel with the rebuild.

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
| **P2** | `packages/contracts` + OpenAPI generation + typed client + contract diff check | ~~Generated client compiles in `apps/web`~~ **(amended 2026-10-03, see the P2 note below)** — generated client compiles in an independent typecheck consumer **and** round-trips against the real `/v1/health`; OpenAPI artifact published per build |
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

**P0 + P0-Q status (2026-09-26, branch `chore/p0-workspace-skeleton`, not yet merged):**
- Met locally: legacy quarantined as-is in `legacy/current-system/` (rename-only; still boots, recovery e2e 17/17, legacy tsc clean); secrets check before moving (only reviewed placeholders); `legacy/` outside the pnpm workspace and ignored by lint/format/CI; pnpm workspace + `packages/config`; `apps/api` (Express 5 + TS) with zod env validation that refuses to boot, pino with redaction, error envelope, `/v1/health`; `PaymentProvider` port + `FakeProvider` with a reusable contract suite; local Postgres compose (127.0.0.1:5436); gitleaks config + CI workflow. `pnpm install --frozen-lockfile && format:check && lint && typecheck && test && build` green locally (24 API tests).
- Pending: first green CI run on GitHub; merge as one PR; owner confirmation that the old server is frozen (SEC-A).
- Deliberately not in P0: Prisma/DB schema (P1), contracts/OpenAPI (P2), `apps/web` (P13), worker process and pg-boss (with the first job), Dockerfiles/deploy (P15), pre-commit hook.
- **Update 2026-10-03:** merged to `main` as PR #2 with CI green (as reported by the owner). Still open: owner confirmation that the old server is frozen (SEC-A).

**P1 status (2026-09-27, branch `feat/p1-db-foundation`, not yet merged — review the SQL before merging):**
- Met locally and in a replay of CI against a fresh PostgreSQL 16: migrations apply from zero as `alphakolect_migrator`; the `alphakolect_app` login cannot UPDATE/DELETE/TRUNCATE journal lines or entries (SQLSTATE 42501) and even the owner cannot (23001); tenant A cannot read or write tenant B through RLS, tested as the app login. 81 database tests; every protection was mutation-checked (removing it makes tests fail).
- Delivered: role bootstrap (`packages/db/sql/bootstrap`), `packages/db` (Prisma 7.10.0), migrations `baseline`, `privileges`, `ledger_invariants`, `row_level_security`; test-only fixtures; RLS catalog guard; schema drift test; CI PostgreSQL 16 service; local compose on PostgreSQL 16.
- Judgement calls to review: roles are named `alphakolect_migrator/app/readonly` (the §19 `migrator/app/readonly` with a prefix, since roles are cluster-wide); ledgers are merchant-only for now (`merchant_id NOT NULL`) — platform and custody ledgers (§7) come with their own RLS rule in P6/P10; `merchants.status` values are not constrained (P4 lifecycle); `readonly` reads across tenants; the migrator owns the tables and is exempt from RLS (no `FORCE ROW LEVEL SECURITY`); audit events are immutable even for the owner, so customer anonymisation (BR-11.3) will need a narrow audited path in P7; UUIDv7 comes from a SQL function because PostgreSQL 16 has none; Prisma is pinned exactly because npm `latest` currently points at an 8.0 release candidate.
- Not in P1 (by design): identity, sessions, memberships, authorization logic, ledger posting/reversal services, billing, payments, customer wallets, chart-of-accounts decisions, frontend.
- **Update 2026-10-03:** reviewed and merged to `main` as PR #3 (`04c6b19`) with CI green (as reported by the owner); the judgement calls above were accepted with the merge.

**P2 definition and amendment (2026-10-03, owner-approved before implementation):**
- **Exit criterion amended:** P2 exit criterion amended because `apps/web` is intentionally deferred to P13; contract correctness is instead demonstrated through an independent typecheck consumer and a real API round-trip. (The original criterion, "generated client compiles in `apps/web`", is kept struck through in the table above.)
- **Scope:** `packages/contracts` holds API shapes only — zod schemas, an endpoint registry and API primitives — with no application behaviour, database access, Express handlers, authentication or business rules. OpenAPI 3.1 (`openapi/v1.json`) is generated from it and committed; CI fails if it is stale, fails on breaking changes against `main` (pinned oasdiff), and publishes it as a build artifact. A typed client (openapi-typescript + openapi-fetch) is generated from the spec. A registry-parity test fails if an Express route has no contract or a contract has no route.
- **Decisions:** money in JSON is `{ "amountMinor": "<digits>", "currency": "NGN" }` — an exact decimal digit string of bigint kobo; tooling is zod-openapi, openapi-typescript, openapi-fetch and pinned oasdiff.
- **Not in P2:** authentication/session schemes (P3), business endpoints, `apps/web` (P13), Swagger UI, external publishing to the mobile developer (decided when authenticated contracts are ready, OPEN-16).

**P2 status (2026-10-03, branch `feat/p2-contracts`, not yet merged — review before merging):**
- Met locally and in a replay of CI from a clean checkout state against a fresh PostgreSQL 16: `openapi/v1.json` is generated from the contracts and committed, and CI fails if it is stale; CI fails on breaking changes against the base (oasdiff 1.32.1, pinned); the generated client compiles in an independent consumer of the **built** package and round-trips against the real `/v1/health`; Express routes equal the registry in both directions; error responses conform to the envelope; the spec is published as a CI artifact. Tests: contracts 30, db 81, api 32. Every guard was mutation-checked: stale spec; route on the app, extra route in `/v1`, second router, contract without handler; breaking vs. additive spec changes; consumer without `dist/`; untyped client; off-contract response behind a cast; contracts importing Node/Express or gaining a runtime dependency.
- Judgement calls to review: workspace packages export source under a custom `@alphakolect/source` condition (typecheck, tests, `dev`) and compiled `dist/` otherwise (production); the spec is committed but the generated client types are not (regenerated by every build/typecheck/test); `AmountMinor` is non-negative only — signed amounts (e.g. balances) get their own type when first needed; the bigint upper bound is enforced by zod but documented in OpenAPI only as "at most 19 digits"; the typecheck consumer lives in `packages/contracts/consumer/` rather than a new package (keeping the three-package rule); operations are tagged by audience plus an `x-audience` extension; the breaking-change job skips when the base has no spec (true only for this first P2 PR); oasdiff pinned to 1.32.1 rather than the two-day-old 1.33.0.
- Not in P2 (by design): authentication/session schemes (P3), business endpoints, `apps/web` (P13), Swagger UI, external publishing to the mobile developer.
- **Update 2026-10-03:** reviewed and merged to `main` as PR #4 (`4521e4b`, same tree as the reviewed branch head `a33e9a2`) with CI green (as reported by the owner).

**P3 definition (2026-10-03, after the P3 readiness audit; decisions in TARGET_ARCHITECTURE ADR-14 / §3.3):**
- **Scope:** identity schema (identities, credentials, sessions, verification/reset tokens, MFA, platform memberships) reached by the app role only through `SECURITY DEFINER` functions; argon2id; signup (identity + merchant + owner membership only); email verification; login for the **platform super admin** and **merchant owner**; refresh rotation with reuse detection; logout; forgot/reset/change password; mandatory platform TOTP with recovery codes; super-admin bootstrap CLI; Postgres-backed rate limits; cookie + CSRF and bearer transport; per-request session re-validation; auth audit events; the `/v1/auth` contracts (with additive registry extensions: 429, response headers, security requirements).
- **Exit criteria:** (1) migrations apply from zero and the app role cannot read identity tables directly (DB test as `alphakolect_app`); (2) passwords stored only as argon2id and refresh/reset/verification tokens only as hashes; (3) no token, OTP or secret in any API response body or captured log; (4) reset tokens single-use, 30-min expiry, superseded by newer requests, generic for unknown accounts, and a reset revokes every session; (5) refresh rotation, and reuse of a rotated token revokes the whole family; (6) after logout, password change or deactivation of the identity/platform membership the next request with an existing access token gets 401; (7) no usable platform session without a valid TOTP; (8) identical responses for known and unknown identifiers on login/forgot/resend/signup, and 429 per IP and per identifier; (9) a session of one audience is rejected on another audience's routes; (10) cookie sessions use `__Secure-`, HttpOnly, Secure, SameSite=Lax and reject state changes without the CSRF token, bearer-only audiences reject cookies, and tokens in query/body are rejected; (11) every auth event writes an `audit_events` row without secrets; (12) every endpoint is in the registry and committed spec, covered by parity/conformance/round-trip guards, and every guard above is proven by breaking it.
- **Not in P3:** TenantContext and permissions (P4/P5), staff/agent/platform-staff management and invitations (P4/P5), customers (P7), billing/suspension triggers (P10), outbox/worker/email provider (P12), CAPTCHA (P15), `apps/web` (P13), legacy remediation (SEC-B), identity migration (TARGET_ARCHITECTURE §25: no data migration).

**P3 status (2026-10-04, branch `feat/p3-identity`, not yet merged — review before merging):**
- **Built:** 7 migrations (identity schema; account, session and MFA functions; rate limits and bootstrap; refresh default idle; account-setup tokens) and 14 `/v1/auth` endpoints — login, refresh, logout, session; signup, email verify, resend; password forgot, reset, setup, change; TOTP enrolment start and confirm; MFA verify — plus the super-admin bootstrap CLI (`admin:bootstrap`), an `EmailSender` port (SMTP / in-memory) and Mailpit in the local compose. Decisions: ADR-14 D1–D16 and the 2026-10-04 clarifications (TARGET_ARCHITECTURE §3.3).
- **Exit criteria, with the evidence:** (1) every migration applies from zero and the app role is refused on identity tables (`packages/db` tests as `alphakolect_app`); (2) argon2id-only passwords and SHA-256-only tokens, enforced by CHECKs and checked on stored rows; (3) and (11) an end-to-end sweep (`apps/api/test/identity/no-secrets-sweep.test.ts`) runs every journey through the real app and logger and finds no secret in any response, log line or audit row, and an audit row for every state-changing request — the only exceptions are the two enrolment answers that must show a secret once (TOTP secret; recovery codes), sent `no-store`; (4) reset single use, 30 min, superseded, generic for unknown accounts, revokes every session; (5) rotation, and reuse revokes the session (audited as a high-severity event); (6) logout, password change/reset and membership or identity deactivation take effect on the next request; (7) platform sessions need confirmed TOTP (in the database) and the login second step; (8) identical answers for known and unknown emails on login, signup, resend and forgot, and 429 per IP and per identifier; (9) audiences are enforced per endpoint; (10) cookie flags, CSRF (Origin + double-submit), bearer/cookie transport per audience, and no tokens from query or body; (12) every endpoint is in the registry and the committed spec (parity, stale-spec and breaking-change guards), with conformance and round-trip tests.
- **Tests:** contracts 36, db 160, api 216. Every protection was mutation-checked: sabotaged, shown to fail a test, restored. The sweep also found a real leak (the CSRF header in request logs), fixed before this note.
- **Judgement calls to review:** platform-only TOTP (D8) means agents and merchants have no MFA yet; emails go out after the response (best effort until the P12 outbox, so a lost email is recovered with resend/forgot); signup/forgot for a new vs. existing email differ by a few database writes (milliseconds, next to ~100 ms of argon2) — equal responses, not perfectly equal timing; the per-IP limits trust `X-Forwarded-For` only from proxies named by address; the TOTP otpauth label is generic (`AlphaKolect:platform`) because the enrolment session does not read the email; refresh in P3 is cookie-only (the mobile body-token refresh comes with the agent audience); `.gitleaksignore` gained five reviewed false positives (TypeScript type annotations and the public RFC 6238 test vector).
- **The one-off test failure (2026-10-04 07:23–07:25 UTC) — dispositioned 2026-10-05:** root cause identified with high confidence, but not proven for the original run. The original failure output was not preserved. A controlled reproduction (5 failures in 10 full runs) found three independent causes: **(1)** a genuine clock-skew test defect — a database test compared a refresh token's expiry (database clock) with the test host's clock, and the Postgres container ran 3–64 ms ahead, failing in 3 of 10 runs; it existed during the original run and is the leading explanation for it; fixed by measuring the lifetime on the database clock alone (exact, no tolerance; mutation-checked); **(2)** resource exhaustion — on an 8 GB machine with other workloads, 11 parallel API test workers made the OS refuse allocations ("JavaScript heap out of memory" at ~25 MB of heap, scattered 500s, a crashed worker); API tests are now capped at 4 workers, and `API_TEST_LOG_LEVEL=error` makes any 500's cause visible; **(3)** a 30 s timeout on the Prisma CLI tests (44 s under load), now 2 minutes. Ruled out with evidence: the rate-limit window boundary (no boundary fell inside the original run) and database connection exhaustion (peak 15 of 100). Separately, a latent boundary flake in the rate-limit tests was removed without changing D13: limit-filling scenarios are checked against the database clock and rerun once only if a window boundary passed during a failure (mutation-checked). **Confirmation:** db suite 20/20; then 20/20 consecutive full-suite runs (2026-10-05 08:08–08:41 UTC, other heavy workloads paused, Postgres uninterrupted) with no OOM, worker crash, timeout or unexpected 500. An earlier confirmation series stopped at run 7 because the Docker engine was restarted mid-run (all containers exited 255 at 07:28:13 UTC; the test database vanished during setup); it was investigated, attributed to that restart, and the series was rerun from zero.
- **Known, not done:** the bootstrap CLI was exercised through its tested core and its argument/config errors, not against a long-lived database — run the full journey (migrate:deploy → admin:bootstrap → setup email → set password → enrol MFA → sign in) on a clean environment before creating the first real platform administrator.

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

- **2026-09-26 — owner:** P0 + P0-Q approved to proceed in this repository per ADR-13 (layout `legacy/current-system/`, pnpm workspace). This does not approve the rest of §2–§5 or §7; those boxes stay open.

*These boxes stay unchecked until the project owner and the implementer formally approve.*
