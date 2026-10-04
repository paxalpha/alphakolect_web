# AlphaKolect — Target Architecture

**Status:** Draft v1 for review · **Date:** 2026-09-26 · **Branch:** `recovery/alphaweb-takeover`
**Authority:** `BUSINESS_RULES.md` (signed off by the owner, incl. the 10.6 clarification). Rules are cited as **BR-x.y**.
**Evidence base:** `AUDIT_REPORT.md`, `ARCHITECTURE_RECONNAISSANCE.md`, `CURRENT_SYSTEM_INVENTORY.md`.
**Scope:** This document describes the **target system**. It changes no code. The repo restructuring / migration map is the next artifact (§25–26).

## Architecture review gates (v1.1, 2026-09-26)

| Gate | Question | Status | Authority |
|---|---|---|---|
| G1 — Data status | Are the existing records (merchant 4: 25 collections, ₦30,000 remitted) non-live test data? | ✅ **Settled** — owner chose *"Nothing is live. Business #4 and all its records are test data."* (records, not just usage) | Follow-up **A1**; BR-1.1, 1.2 |
| G2 — Savings timing | When does a cash collection credit the customer's savings? | ✅ **Settled** — at remittance approval; Live-wallet collections immediately | **BR-5.6** (owner-approved); §9 |
| G3 — Custody | Customer Live wallets before legal/custody clarity? | ✅ **Adopted** — release blocker, feature-gated | §8, OPEN-12 |
| G4 — Ledger semantics | One entry per action? | ✅ **Adopted** — one atomic command → one or more balanced entries | ADR-5, §6 |
| G5 — Existing production | Restructure the repo now? | ✅ **Adopted** — old app frozen; no moves into `legacy/` until `RESTRUCTURING_MAP.md` is approved | §26 |

Conventions: **MUST** = invariant the implementation and tests enforce. **ADR-n** = architecture decision (§0). **OPEN-n** = needs confirmation (§30).

---

## 0. Key architecture decisions (summary)

| ADR | Decision | Why |
|---|---|---|
| ADR-1 | **Modular monolith**: one deployable API (+ a worker process from the same codebase), strict internal module boundaries. No microservices. | Small team, one database, strong consistency needed for money. |
| ADR-2 | **Rebuild the backend on new foundations; port the frontend screens.** The current backend is quarantined as reference, not refactored in place. | Nothing is live (BR-1.1, 1.2) so no data migration constrains us; the signed-off rules (Live wallets, record wallets, actor model, immutable money) differ from what the current code implements; the current code has no tenant, money, or authorization layer to refactor *towards*. The UI's screens and flows are worth keeping. *(This supersedes the "incremental refactor" recommendation in the earlier reports, which assumed live data.)* |
| ADR-3 | **TypeScript end-to-end**; runtime validation with **zod**; shared API contracts package used by web and both mobile apps. | Removes the `any`-heavy, untyped boundary that caused tenant/ID confusion. |
| ADR-4 | **PostgreSQL** (one database, **one Postgres schema per module**), **Prisma** for schema + migrations, raw SQL where locking/ledger performance needs it. **Prisma is the application schema/migration authority; PostgreSQL is the final enforcement authority** for security and accounting invariants (RLS, grants, ledger triggers, append-only rules, composite FKs, CHECKs), which live in reviewed raw-SQL migrations. | One canonical schema-as-code with a real migration history (replaces 60 migrations + ad-hoc scripts), without pretending an ORM can express every invariant. |
| ADR-5 | **Double-entry ledger is the single source of truth for every balance** — real money *and* record wallets. Balances are derived; a locked projection table serves reads and overdraft checks. No `UPDATE balance`, no `DELETE` of money rows, ever. **Every money command executes atomically and produces one or more balanced journal entries; the whole command commits or rolls back.** | BR-4.4, 11.1, 7.4; fixes every money defect found. |
| ADR-6 | **Server-derived tenant context + central authorization + Postgres Row-Level Security.** **Application authorization decides what an actor may do; RLS only prevents accidental cross-tenant data access** (defence in depth, never the permission system). **No request may choose its own tenant.** | Tenant isolation is the most-broken area today. |
| ADR-7 | **Explicit actor model**: one `identity` (login) with **memberships** (platform, merchant-owner/staff/agent, customer). Audience-scoped sessions, not one JWT shape for everyone. | BR-3; removes Staff/Collaborator/Agent ID confusion. |
| ADR-8 | **Payments behind a provider port** (`PaymentProvider`); TransactPay is one adapter. Domain code never calls TransactPay directly. | T1–T3 unresolved; testability; provider change possible. |
| ADR-9 | **Postgres-backed job queue (pg-boss)** + **transactional outbox** for all async work (VA provisioning, billing, notifications, reconciliation). | No extra infrastructure; exactly-once-ish via idempotency. |
| ADR-10 | **Immutable, containerised deploys from CI** to infrastructure dedicated to AlphaKolect; production is never a git working copy. | Current deploy model is the root cause of drift and credential sprawl. |
| ADR-11 | **Money in minor units** (`bigint` kobo) + ISO-4217 currency column on every amount. **Naira (NGN) only for now** (owner decision, revised 2026-09-26): the system accepts and validates `NGN` only, and there is no currency selection in the UI. The currency column exists so adding currencies later is a controlled change (currency table with minor-unit exponents, per-currency plan prices, platform ledger per currency) rather than a schema rewrite. Timezone: WAT. | FLOAT money today; the old code's XOF option is dropped. |
| ADR-12 | **The new system is built in a new, clean repository under the `paxalpha` GitHub organisation** (fresh `git init`, never this repo's history); this repo (`mayowae/Alphaweb`) is frozen as the legacy archive and behavioural reference (decided 2026-09-26). | No inherited secret-laden history, no root-file conflict, start not gated on SEC-3/SEC-4. Supersedes the in-repo quarantine (§26) for the new code. |
| ADR-13 | **This repository (`paxalpha/alphakolect_web`) is the reconstruction workspace.** The imported legacy application is quarantined, unchanged in layout, under **`legacy/current-system/`**; the new system is built beside it in `apps/` and `packages/` per §21. Governing documents live in `docs/`. Nothing deploys from this repository. (Owner decision, 2026-09-26; refines ADR-12 and supersedes the `legacy/app` / `legacy/ops` / `legacy/docs` split in §26.) | The repo already holds the clean-history import (ADR-12). Keeping the legacy layout intact keeps it runnable as a behavioural reference (its frontend imports root folders by relative path); a split would break it for no benefit. |
| ADR-14 | **Identity & session decisions for P3** (owner-approved 2026-10-03; details in §3.3): email via an `EmailSender` port (outbox/provider in P12); signup creates only identity + merchant + owner membership; P3 audiences are platform super admin and merchant owner; the app role reaches `identity.*` only through `SECURITY DEFINER` functions; EdDSA JWT access tokens with `kid`, re-validated against the session on every request; cookies + CSRF for platform/merchant, bearer for agent/customer; mandatory platform TOTP with encrypted secrets and recovery codes; operator CLI bootstrap of the first super admin. | Resolves the P3 readiness decisions D1–D16 before implementation, so P3 is built once against fixed rules. |

---

## 1. Architecture principles

1. **Business rules are the spec.** Every MUST in this document traces to a BR or a security requirement; every BR has a test.
2. **No request chooses its tenant, its actor, or its permissions.** All three are derived server-side from the session.
3. **Money is append-only.** Corrections are reversals (BR-11.1). Balances are computed, never written by business code.
4. **Real money ≠ record.** Only Live wallets (provider accounts) hold money (BR-4.1); Collection / Target Savings / Loan are ledger records (BR-4.4).
5. **Every money command is idempotent and atomic** (one DB transaction; retries with the same key return the same result).
6. **External systems are untrusted until verified** (webhooks re-verified against the provider; ADR-8).
7. **Modules talk through public service interfaces or events, never each other's tables.**
8. **Secure by default:** deny-by-default authorization, no secret defaults, private file storage, audit everything that changes money or permissions (BR-11.4).
9. **Boring, observable operations:** reproducible builds, one command to deploy/rollback, structured logs, alerts on money anomalies.

---

## 2. System boundaries (context)

```
 ┌────────────── Clients ─────────────────────────────────────────────┐
 │ Web (Next.js): Platform console · Merchant dashboard · Marketing   │
 │ Agent mobile app (external team?)   ·   Customer mobile app        │
 └───────────────┬──────────────────────────────────────┬────────────┘
                 │ HTTPS /v1 (cookie session: web; bearer+refresh: mobile)
 ┌───────────────▼──────────────────────────────────────▼────────────┐
 │                 AlphaKolect API (modular monolith)                 │
 │  identity · tenancy · customers · savings · loans · investments    │
 │  payments · ledger/accounting · billing · kyc · support            │
 │  notifications · documents · audit                                 │
 ├────────────────────────────────────────────────────────────────────┤
 │  Worker (same codebase): jobs, outbox relay, reconciliation         │
 └───────┬─────────────────┬──────────────────┬─────────────┬─────────┘
         │                 │                  │             │
    PostgreSQL        Object storage      TransactPay    Email provider
   (schemas/module,   (private, signed    (VAs, transfers, (transactional,
    RLS, PITR backup)  URLs)               events/API)      SPF/DKIM/DMARC)
```

Out of scope for AlphaKolect itself: holding cash (businesses do), bank-level custody (TransactPay does). **See OPEN-12 on custody/regulation.**

---

## 3. Actor / identity architecture

### 3.1 Model

```
identity (one per person/login)
  ├── credentials: email/phone, password hash (argon2id), MFA (TOTP), status
  ├── platform_membership?      → role: super_admin | platform_staff(role_id)
  ├── merchant_membership*      → merchant_id, kind: owner | staff | agent,
  │                                role_id (staff), branch_id?, status, deactivated_at
  └── customer_profile*         → merchant_id, customer_id (app login for savers)
```

- A person logs in **into an audience**: `platform`, `merchant` (owner/staff, web), `agent` (mobile), `customer` (mobile). A session is bound to exactly one audience and, for tenant audiences, **one membership** (BR-3).
- Super Admin: exactly the platform role with all permissions; **MFA mandatory** for all platform identities.
- Platform staff roles: **support, verification, finance** (BR-3, F-B4a); access to merchant customer/money data only via explicit permission (BR-3).
- Merchant owner: one per merchant at creation (more owners = OPEN-1).
- Staff: permissions from a merchant-defined role (BR-3, Q7c).
- Agent: fixed capability set — record collections for **assigned customers only** (BR-3); **deactivated ⇒ cannot authenticate immediately** (BR-10.6b).
- Customer: fixed capability set — read own records, pay contributions/repayments from own Live wallet (BR-3, BR-8.2).

### 3.2 Sessions & credentials

| Aspect | Design |
|---|---|
| Access token | Short-lived (15 min) signed token carrying `session_id`, `identity_id`, `audience`, `membership_id`. **Claims are hints; the server re-resolves membership + status from DB/cache per request.** |
| Refresh | Rotating refresh tokens stored **hashed** in `identity.sessions`; reuse detection revokes the family. |
| Web | httpOnly, Secure, SameSite=Lax cookies on `.alphakolect.com`; CSRF token for state-changing requests. |
| Mobile | Bearer access + refresh in platform secure storage (Keychain/Keystore). |
| Revocation | Logout, password change, deactivation, suspension-policy changes revoke sessions (`sessions.revoked_at`). |
| Passwords | argon2id; strength policy server-side; breached-password check optional. |
| Recovery | Single-use hashed reset tokens (30 min), generic responses, rate-limited, audit-logged, revokes all sessions. **Same mechanism for all audiences**, including Super Admin (replaces today's broken flows). |
| Email verification | Required before a merchant is "real" (BR-2.2) and before any VA is provisioned (BR-2.3). |
| Rate limiting | Per IP + per identifier on login, OTP/verify, reset, signup; CAPTCHA/Turnstile on public signup (September fake-signup wave). |

### 3.3 Identity & session decisions (ADR-14, owner-approved 2026-10-03)

Concrete values for §3.1–§3.2, decided before P3 implementation (P3 readiness decisions D1–D16).

| # | Decision |
|---|---|
| D1 Email | An `EmailSender` port: SMTP adapter (Mailpit locally) and an in-memory adapter for tests. Sent **after** the transaction commits; failures are logged without tokens. Outbox, worker and a transactional provider remain P12 (§14, ADR-9). |
| D2 Signup | One transaction creates the identity, a `tenancy.merchants` row (`pending_verification`) and the **owner** membership only. Email verification makes the merchant `active` (BR-2.2). Trial start (OPEN-10), branches, roles and the rest of the merchant lifecycle are P4. |
| D3 Audiences in P3 | **platform** (super admin only) and **merchant** (owner). Platform staff, merchant staff and agents arrive with P4/P5; customers with P7. The authentication code is audience-generic. |
| D4 Identity data access | `alphakolect_app` has **no table privileges** on `identity.*`; it reads and writes identity data only through narrow `SECURITY DEFINER` functions it may EXECUTE. RLS and default-deny are not weakened. |
| D5 Session lifetimes | Access token **15 min**. Refresh lifetime = idle timeout; a token family's maximum age = absolute timeout. **Platform:** idle 1 h, absolute 12 h. **Merchant (web):** idle 24 h, absolute 14 d. **Mobile (later):** idle 30 d, absolute 90 d. No concurrent-session cap in P3. Password reset and password change revoke every session of the identity; logout revokes the current one. |
| D6 Access token | JWT signed with **EdDSA (Ed25519)** carrying `kid`; claims `sub`, `sid`, `aud`, `mid`, `iss`, `iat`, `exp`. Keys come from configuration (current + previous, for rotation, §22). Only EdDSA is accepted. Claims are hints: the session, identity and membership are re-validated on every request. |
| D7 Transport | Fixed per audience: **platform and merchant → cookies only; agent and customer → bearer only.** Cookies: `__Secure-` prefix, HttpOnly, Secure, SameSite=Lax, Domain `.alphakolect.com` in production (host-only locally). CSRF: double-submit token (cookie + `X-CSRF-Token` header) and an `Origin` check on state-changing requests. Tokens are never accepted from query strings or request bodies (except the refresh token in the mobile refresh request). |
| D8 MFA | Mandatory for platform identities. TOTP per RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step) with replay of a used time step rejected; secret encrypted with AES-256-GCM under a configured key. **Enrolment is forced at first platform login** (that session can only enrol). 10 single-use recovery codes, stored hashed, shown once. Challenge valid 5 min, 5 attempts. |
| D9 First super admin | An operator CLI creates the platform identity and super-admin membership **without a password** and emails a set-password link (the reset flow); first login forces MFA enrolment. It refuses to run if a super admin exists unless explicitly asked to add another (audited). |
| D10 Passwords | argon2id; length 12–128; no composition rules (NIST SP 800-63B); a bundled common-password list is rejected. Breached-password lookup is not in P3. |
| D11 Identifier | Email only, normalised to lowercase, unique across identities. |
| D12 Email verification | Single-use link token valid **24 h**; at most 3 resends per hour. Anti-enumeration: a wrong password gets the same `INVALID_CREDENTIALS` response whether the email is unknown, unverified or verified; **only correct credentials on an unverified account** get the generic "email verification required" response leading to the resend flow; the resend endpoint answers identically for any email. |
| D13 Rate limits | Postgres-backed fixed-window counters behind a `RateLimiter` port, per IP and per identifier; exceeding returns 429. No Redis (ADR-9). |
| D14 CAPTCHA | Deferred to the pre-launch checklist (P15); signup keeps a hook for it. |
| D15 Hashing library | ~~`@node-rs/argon2`~~ **`hash-wasm` (amended 2026-10-03, owner-approved):** Windows Application Control on the development PC blocks `@node-rs/argon2`'s unsigned native binary; `hash-wasm` runs the same argon2id in WebAssembly, identically locally, in CI and in production. Unchanged: argon2id m = 19 MiB, t = 2, p = 1 (OWASP minimum; may be raised), with rehash on login when parameters change. |
| D16 Multiple memberships | Deferred to P4 (an owner has exactly one membership in P3). |

**P3.5 review decisions (2026-10-04, owner-approved; appended, D1–D16 unchanged):**

| Item | Decision |
|---|---|
| Refresh auditing | **Every refresh outcome is audited** (exit criterion 11): a successful refresh as a lightweight `auth.refresh` event (identity, session, audience, request metadata); failures as `auth.refresh` failures; reuse of a rotated token as the distinct, high-severity `auth.refresh_token_reuse` event. No token or other secret is ever recorded. |
| Login CSRF | Kept as implemented: login accepts only `application/json`, which a cross-site HTML form cannot send without a CORS preflight. No CSRF token on login; D7's CSRF rule stays for cookie-authenticated state changes. |
| Client IP | `X-Forwarded-For` is believed **only from a configured trusted reverse proxy, named by address** (`TRUST_PROXY`: `loopback` by default, or explicit IPs/CIDR subnets; hop counts are refused because they trust whoever connects). Production invariant: the API listener is reachable only through the proxy (nginx on the host, firewall). |
| Password reset and verification | **A password reset does not verify an email address.** Only the email-verification flow verifies an identity and moves its merchant from `pending_verification` to `active`. Implemented in P3.7 (the P3 `reset_password` function currently also sets `email_verified_at`; a new migration removes that). |
| D9 first super admin — set-password link (2026-10-04) | **Option A.** The bootstrap CLI creates the passwordless platform identity and super-admin membership and emails a **dedicated account-setup link**, not a reset link: its own token purpose (`account_setup`), single use, 24 h, stored hashed, issuable only for an identity that has never had a password, superseded by a newer one. Completing it sets the first password and verifies the email (possession of a link sent to the address); the next login gets the enrolment-only session (D8). The CLI never asserts verification itself. Forgot-password on an account without a password sends a fresh setup link. Invariant: **an email becomes verified only through possession of a verification or setup link sent to it.** |

---

## 4. Multi-tenancy model

**Tenant = merchant.** Invariant: **every tenant-owned row has `merchant_id NOT NULL`, and every request's tenant comes from its session membership (ADR-6).**

```
request → authenticate (session) → resolve Actor {identity, audience, membership}
        → TenantContext {merchantId, branchScope?, actorKind}
        → subscription gate (§11) → authorize(permission, resource) → domain service
        → repository (always scoped) → Postgres (SET LOCAL app.merchant_id; RLS)
```

- **Layer responsibilities:** *authorization policies* (application) decide what the actor may do to which resource; *scoped repositories* make it impossible to address another tenant's rows; *RLS* is the last line of defence against bugs in the first two. None substitutes for another.
- **Repositories require a `TenantContext` argument**; there is no unscoped repository for tenant data. Platform-audience code uses explicit, permission-gated cross-tenant read services.
- **Composite foreign keys** `(merchant_id, id)` on tenant tables so a row can only reference rows of the same tenant (e.g. a collection cannot point at another merchant's customer).
- **RLS policies** on all tenant tables using `current_setting('app.merchant_id')`; the API's DB role cannot bypass RLS; migrations/ops use a separate role.
- **IDs are UUIDv7** (non-enumerable, time-sortable) — removes IDOR-by-guessing.
- **Client-supplied `merchantId` is not accepted anywhere** in tenant audiences (contract schemas simply don't have the field).
- **Branch scoping** (staff limited to branches) = OPEN-2; the model supports it via `membership.branch_id` + policy.

---

## 5. Domain (module) boundaries

| Module | Owns (tables) | Key operations | Depends on |
|---|---|---|---|
| **identity** | identities, credentials, sessions, reset/verify tokens, mfa | signup, login, refresh, logout, verify email, reset password, MFA | audit, notifications |
| **tenancy** | merchants, branches, merchant_memberships, roles, permissions | create merchant, manage branches/staff/agents/roles, activate/deactivate | identity, billing (status), audit |
| **customers** | customers, customer_profiles, assignments (agent↔customer) | onboard, assign agent/package, update, anonymise (BR-11.3) | tenancy, payments (VA), savings |
| **savings** | packages, package_fee_rules, enrolments, cycles, collections, remittances, withdrawals, target_goals | record collection (cash/live), remit, approve/reject, withdraw, cycle rollover | ledger, payments, customers |
| **loans** | loan_products?, applications, loans, schedules, repayments | apply, approve, disburse, repay, write-off/reverse | ledger, payments, customers, documents |
| **investments** | investment_products, applications, investments, investment_txns | apply, approve, fund, mature, withdraw | ledger, payments |
| **payments** | live_wallets, virtual_accounts, payment_orders, provider_events | provision VA, transfer, payout, ingest events, reconcile | provider adapter, ledger |
| **ledger** (+ accounting UI) | ledgers, accounts, journal_entries, journal_lines, balance_projection, fiscal_periods | post (balanced), reverse, balances, statements, trial balance / BS / P&L | — (lowest level) |
| **billing** | plans, plan_tiers, subscriptions, invoices, billing_runs, merchant_billing_state, agent_activity | price, invoice, charge, suspend/restore | tenancy, payments, ledger |
| **kyc** | kyc_requests, tiers, tier_limits | submit, review, approve/reject, enforce limits | documents, tenancy |
| **support** | tickets, messages, faqs, announcements | CRUD, reply | notifications |
| **notifications** | outbox, notification_log, in_app_notifications, templates | send email/in-app (later SMS/push) | — |
| **documents** | documents (metadata), storage adapter | upload (signed), view (signed URL), scan | — |
| **audit** | audit_events | append, query | — |

Rules: a module exposes a **service interface** and **domain events**; other modules never import its repositories or query its schema. Cross-module writes inside one money operation go through the **ledger service within the same DB transaction** (the only sanctioned cross-module transaction).

---

## 6. Financial / money architecture

Three layers, one direction of truth:

```
 Provider reality (TransactPay)        ← external truth for REAL money
        │  events / API (verified, idempotent)
        ▼
 payments module: payment_orders & provider_events (state machines)
        │  on success/confirmed
        ▼
 ledger module: immutable double-entry journal  ← internal truth for ALL balances
        │  derived
        ▼
 balance_projection (locked read model)  →  wallet views, overdraft checks, reports
```

- **Every money command** (collect, remit-approve, withdraw, repay, disburse, charge subscription, fee) = one DB transaction that: validates rules → locks the relevant balance projections (`SELECT … FOR UPDATE`, in a fixed lock order to avoid deadlocks) → creates domain record(s) → posts **one or more balanced journal entries** (e.g. a remittance approval covering 20 collections posts one entry per collection plus the cash transfer) → updates projections → writes audit + outbox events. Commit or nothing.
- **Idempotency:** every money command carries an `idempotency_key` (header from clients; derived key for jobs/provider events) with a unique constraint; replays return the original result.
- **Provider-dependent operations** (transfers between Live wallets) are **two-phase**: `payment_order` created `pending` → provider call → confirmed (webhook or API poll) → ledger posting. Ledger never records real-money movement the provider has not confirmed. Failures/timeouts are retried or marked failed; reconciliation catches drift.

## 7. Ledger architecture

- **Ledgers:** one per merchant (the merchant's books, in the merchant's currency) + one **platform ledger** (AlphaKolect's own books) + one **custody ledger** mirroring Live-wallet money held at the provider (OPEN-12 decides whether this is informational or authoritative).
- **Accounts:** system accounts (locked codes, created with the ledger) + per-customer **sub-accounts** for record wallets + merchant-defined accounts (manual bookkeeping UI, BR-9.1).
- **Journal entry:** header (id, ledger, effective date, type, narrative, source ref, idempotency key, `reverses_entry_id?`, actor) + ≥2 lines; **DB constraint + trigger: Σdebits = Σcredits per entry; lines are INSERT-only** (UPDATE/DELETE revoked from the app role).
- **Reversal:** a new entry with swapped sides referencing the original; domain objects move to `reversed` status; both remain visible (BR-11.1). Correction = reversal + new entry.
- **Balance projection:** `(account_id) → balance, version` updated in the same transaction; nightly job asserts `projection = Σ lines`; mismatch = alert.
- **Chart of accounts (merchant ledger, system part — illustrative):**

| Code | Account | Type | Purpose |
|---|---|---|---|
| 1100 | Live wallet (merchant VA) | Asset | real money at provider |
| 1200 | Cash at business | Asset | cash after remittance |
| 1210 | Cash with agents (per agent sub-acct) | Asset | collected, not yet remitted |
| 1300 | Loans receivable (per customer = **Loan wallet**) | Asset | balance still owed (BR-4.4, F-B1) |
| 2100 | Customer Collection savings (per customer = **Collection wallet**) | Liability | owed to customer |
| 2110 | Customer Target savings (per customer = **Target Savings wallet**) | Liability | owed to customer |
| 2190 | Unremitted collections (suspense) | Liability | cash collections awaiting approval (BR-5.6) |
| 4100 | Collection fees — first contribution | Revenue | BR-6.1 |
| 4110 | Collection fees — percentage | Revenue | BR-6.1/6.2 |
| 4200 | Loan interest income | Revenue | |
| 5100 | Platform subscription | Expense | BR-10.3 |

*(The current code's `200500 Customer Loans` as a Liability is replaced by 1300 Asset.)* Final COA wording = OPEN-8 (accountant review).

## 8. Wallet model

| Wallet (business term) | Holds money? | Implementation |
|---|---|---|
| **Live wallet** (customer, merchant, platform) | **Yes** (BR-4.1) | `payments.live_wallets` ↔ provider virtual account; balance per provider + custody ledger |
| **Collection wallet** | No (BR-4.4) | merchant ledger acct 2100 sub-account per customer |
| **Target Savings wallet** | No | merchant ledger acct 2110 sub-account per customer (+ `savings.target_goals`) |
| **Loan wallet** | No — balance still owed | merchant ledger acct 1300 sub-account per customer/loan |

- **RELEASE BLOCKER — customer Live wallets are feature-gated (`payments.customer_live_wallets=false`) until OPEN-12 (custody & regulation) is resolved in writing.** The module is built and tested against the FakeProvider/sandbox, but no customer VA is provisioned in production and no customer real-money flow (Live-wallet collections, repayments, auto-contributions) is enabled until the gate is lifted by the owner. Merchant and platform Live wallets (subscription payments) are not gated by this.
- Customers get a Live wallet **at onboarding** (BR-4.2), but only for merchants whose email is verified (BR-2.3); provisioning is an async job (§20) with retry; the customer is usable before the VA exists.
- Merchants get a Live wallet **after email verification only** (BR-2.3). Platform Live wallet is configured once (BR-4.3).
- **Money never flows Live → record wallet** (BR-4.5): a Live-wallet collection is a transfer *customer VA → merchant VA*, and *separately* a ledger posting that credits the Collection record (§9).

## 9. Collections, fees, remittances, withdrawals

**Package & cycle.** A customer has **one active enrolment** at a time (BR-5.1, DB partial unique index). Cycle length **31 days** (BR-5.2; cycle start rule = OPEN-3). Package has exactly **one fee rule**: `first_contribution` or `percentage` (BR-6.1; enforced by schema).

**When a customer's savings obligation increases (settled by BR-5.6, owner-approved):** for **cash**, at **remittance approval** — not when the agent records it; for **Live wallet**, **immediately** on provider-confirmed transfer. Between recording and approval the contribution is **visible but pending**: the customer app and statements show it as *"Recorded by agent — awaiting confirmation"* (backed by account 2190 and the collection record), so the customer can see and dispute it, while the Collection wallet balance itself only moves on approval.

**Cash collection** (BR-5.3, 5.5, 5.6):
1. Agent records (mobile, idempotent) → `collection{channel:cash, status:recorded}`; ledger: Dr 1210 Cash with agent / Cr 2190 Unremitted.
2. Agent hands cash; business creates/approves a **remittance** covering selected recorded collections (remittance ↔ many collections) — requires `remittance.approve` permission (never agents, BR-3).
3. On approval, per collection: Dr 1200 Cash at business / Cr 1210; and Dr 2190 / Cr **fee split**: first-contribution-of-cycle → Cr 4100 (whole amount); percentage → Cr 4110 (fee) + Cr 2100 customer (net); otherwise Cr 2100 customer (full).
4. **Rejection / shortfall** path (cash short) = OPEN-4.

**Live-wallet collection** (BR-5.4, 5.6): customer app (or scheduled auto-contribution, OPEN-5) → `payment_order(transfer customer VA → merchant VA)` → on provider confirmation: `collection{channel:live, status:settled}`; merchant ledger Dr 1100 / Cr fee split as above; counts **immediately**. No remittance.

**Fee entries** (BR-6.2): every fee is its own journal line with its own transaction id and narrative, e.g. *"2% deducted for merchant on 2026-10-12 09:14"*.

**Withdrawals** (BR-7): from Collection (2100) or Target (2110) sub-account; destination **cash** (Dr 2100/2110 / Cr 1200) or **loan repayment** (Dr 2100/2110 / Cr 1300). **Cannot exceed balance** (BR-7.4) — checked against the locked projection. Permission-gated (`withdrawal.create`, `withdrawal.approve` split = OPEN-6). Payout to customer's bank/VA instead of cash = OPEN-7 (T1 says transfers to normal bank accounts are possible).

## 10. Loans

Application → review/approve (permission) → **disbursement** (method OPEN-9: cash, merchant VA → customer VA, or bank) → schedule → repayments.
- Disbursement: Dr 1300 customer loan / Cr 1200 or 1100.
- Interest (flat rate, as today): recognition policy (upfront vs over term) = OPEN-9.
- **Repayment from Live wallet** (BR-8.2): payment_order customer VA → merchant VA; on confirmation Dr 1100 / Cr 1300 (reduces Loan wallet).
- **Repayment via withdrawal** (BR-8.3): Dr 2100/2110 / Cr 1300 (§9).
- Package loan charges (current feature): posted as fee revenue at disbursement — confirm with OPEN-9.
- Loan documents via documents module (private).

## 11. Billing

- **Plans/tiers are data** (platform admin edits; billing reads the current version; price changes versioned with effective dates, BR-10.1–10.2, BR-12.2). Tiers: 1–3 ₦5,000 · 4–6 ₦10,000 · 7–10 ₦15,000 · 11–20 ₦40,000 · 21+ custom per-merchant price.
- **Trial:** 90 days from email verification (sign-up vs verification start = OPEN-10).
- **Billable agents** (BR-10.6a): agents with **activity within the 15 days before the billing date** (activity definition = OPEN-11; `tenancy.agent_activity` updated on login and on recorded collection). Deactivation blocks login immediately (BR-10.6b) but billing still uses the 15-day activity rule.
- **Billing run** (daily job, idempotent per `(merchant, period)`): compute tier → invoice → `payment_order(transfer merchant VA → platform VA)` (BR-10.3) → on confirmation: merchant ledger Dr 5100 / Cr 1100; platform ledger Dr platform wallet / Cr subscription revenue.
- **Insufficient funds ⇒ `suspended`** (BR-10.4). **Payment ⇒ automatic immediate restore** (BR-10.5): an inbound deposit to a suspended merchant's VA triggers a charge attempt; on success state → `active` and sessions are refreshed.
- **Suspension enforcement** (central middleware, by audience):

| Audience | Behaviour while suspended |
|---|---|
| Merchant owner/staff (web) | API returns `402 SUBSCRIPTION_SUSPENDED` + amount owed; web middleware routes every page to **Subscription** page with the message (BR-10.4). Only billing/wallet-top-up endpoints allowed. |
| Agent (mobile) | `403 MERCHANT_SUSPENDED` on everything except session/profile. |
| Customer (mobile) | **Read-only**; writes return `423 MERCHANT_SUSPENDED` with "Please contact the company." (BR-10.4) |
| Platform | Unaffected. |

- **Billing is paused until this module ships** (BR-1.3): implemented as a platform setting `billing.enabled=false` plus a per-merchant override.

## 12. TransactPay integration boundary

```ts
interface PaymentProvider {
  createVirtualAccount(owner: VaOwner, idemKey): Promise<VirtualAccountRef>
  getVirtualAccount(ref): Promise<VirtualAccountState>
  transfer(from: VaRef, to: VaRef | BankAccount, amount: Money, ref, idemKey): Promise<ProviderTxRef>
  getTransaction(ref): Promise<ProviderTransaction>          // verification source of truth
  listTransactions(account, since, cursor): Promise<Page<ProviderTransaction>>  // polling/reconcile
  getBalance(account?): Promise<Money>
  parseEvent(raw, headers): ProviderEvent                    // untrusted until verified
  closeVirtualAccount?(ref): Promise<void>
}
```

- **Inbound events** (T2: "via their API"): webhook endpoint (if offered) **stores the raw event**, returns 200, and a job **verifies by fetching the transaction from the provider API** (`getTransaction`) before acting; plus a **polling reconciler** (`listTransactions`) so missed/never-sent webhooks don't lose money. Signature verification added if TransactPay provides one.
- **Idempotency** on `(provider, provider_tx_id)`.
- **Adapters:** `TransactPayProvider` (prod/sandbox), `FakeProvider` (local/tests; deterministic).
- **Config:** base URL, keys from env (no hardcoded URL as today); keys rotatable without deploy.
- **Unknowns (drive OPEN-12..14):** pooled vs per-account balances; VA-to-VA transfer semantics/fees (T1 answered "yes, VA↔VA and to bank accounts"); webhook/signature availability; VA cost & closure (T3 unanswered); sandbox availability.

## 13. KYC

Merchant tiers with limits (daily/monthly inflow/outflow, max balance) as data; `kyc_requests` with documents (private storage) reviewed by **verification** platform staff; approval changes tier; **limits enforced in payments** before creating payment orders. Customer KYC (for customer VAs) = OPEN-13 (provider may require BVN/NIN).

## 14. Notifications

- **Outbox pattern:** domain events written in the same DB transaction → worker delivers.
- **Email:** transactional provider (e.g. Postmark/SES/Resend) on `mail.alphakolect.com` with SPF, **DKIM, DMARC** — not the shared VPS Exim.
- **In-app** notifications table (web + mobile); **push** (mobile) and **SMS** (existing `sms_balance` concept) later.
- Templates versioned; no secrets/OTPs in logs.

## 15. Documents / uploads

Private object storage (S3-compatible); upload via **pre-signed PUT** with size/MIME allow-list; `documents` row (owner, tenant, purpose, checksum); access via short-lived **signed GET** after authorization; optional malware scan job. Never served from the API's filesystem.

## 16. Audit architecture

`audit.audit_events` — append-only: `occurred_at, actor(identity, audience, membership), tenant, action, target(type,id), outcome, ip, user_agent, request_id, summary(json, no secrets)`. Written for: auth events (login/fail/reset/MFA), permission & role changes, membership changes, every money command, billing state changes, platform-staff data access (BR-3), exports. Retained indefinitely (BR-11.2). Customer anonymisation (BR-11.3) replaces PII in `customers` and audit summaries with a tombstone; ledger keeps amounts and IDs.

## 17. API architecture

- REST/JSON, versioned **`/v1`**, grouped **by audience**: `/v1/auth`, `/v1/platform/*`, `/v1/merchant/*`, `/v1/agent/*`, `/v1/customer/*`, `/v1/webhooks/*`, `/v1/health`.
- Contracts defined once as **zod schemas** in `packages/contracts` → OpenAPI spec generated → typed clients for web and **published to the mobile teams**.
- Standard error envelope `{ error: { code, message, details?, requestId } }`; stable machine `code`s (e.g. `SUBSCRIPTION_SUSPENDED`, `INSUFFICIENT_BALANCE`).
- Cursor pagination; filtering whitelists; `Idempotency-Key` header required on money POSTs.
- Webhooks/job endpoints never share auth with user APIs.
- Swagger UI **not** public in production.

## 18. Frontend architecture

- **Next.js App Router**, route groups: `(marketing)`, `(auth)`, `(platform)`, `(merchant)`. Keep and port existing screens/components; replace the data layer.
- **`middleware.ts`** guards every non-marketing route from the session cookie (audience + suspension redirect).
- **Data layer:** generated typed client + React Query hooks per module (replaces the 2,375-line `services/api.tsx` and raw `fetch` calls). No tenant IDs, no permissions logic from `localStorage`; permissions come from `/v1/merchant/me` and only drive UI visibility.
- **One component tree** (`apps/web/src/components`), one design system; forms with react-hook-form + shared zod schemas.
- Money displayed from minor units with one formatter; dates in the merchant's timezone (OPEN-15).

## 19. Database architecture

- PostgreSQL 16; **one Postgres schema per module** (`identity`, `tenancy`, `customers`, `savings`, `loans`, `investments`, `payments`, `ledger`, `billing`, `kyc`, `support`, `notifications`, `documents`, `audit`, `jobs`).
- snake_case everywhere; UUIDv7 PKs; `timestamptz`; `bigint` minor units + `char(3)` currency; `CHECK`s for enums/amount > 0; composite tenant FKs; RLS on tenant tables.
- **Prisma** schema = canonical definition; migrations generated, reviewed, and applied only by the release pipeline. Raw SQL migrations for RLS policies, ledger triggers, grants.
- Separate DB roles: `app` (DML only, RLS enforced, no UPDATE/DELETE on ledger), `migrator`, `readonly` (reporting/support).
- Backups: PITR (WAL archiving or managed Postgres), daily logical dump, **restore tested monthly**.

## 20. Background jobs

Worker process (pg-boss). Every job idempotent with a natural key.

| Job | Trigger | Key |
|---|---|---|
| Provision merchant VA | email verified | merchant_id |
| Provision customer VA | customer created (merchant verified) | customer_id |
| Process provider event | webhook stored | provider_tx_id |
| Poll/reconcile provider transactions | every N min | account, window |
| Confirm pending payment orders | schedule + events | payment_order_id |
| Billing run | daily | merchant_id, period |
| Restore on payment | deposit to suspended merchant | merchant_id, invoice |
| Cycle rollover / cycle fee marking | daily | enrolment_id, cycle_no |
| Agent activity roll-up | daily | merchant_id, date |
| Ledger projection check | nightly | ledger_id, date |
| Outbox relay (notifications) | continuous | event_id |
| Scheduled auto-contribution (OPEN-5) | schedule | enrolment_id, date |

## 21. Repository structure

pnpm workspace monorepo:

```
alphakolect/
├── apps/
│   ├── api/                 # Express 5 + TS (OPEN-19); entrypoints: server.ts, worker.ts
│   │   └── src/
│   │       ├── modules/<module>/{routes,service,repository,schemas,events,policies}.ts
│   │       ├── platform/    # http, auth middleware, tenant context, errors, logging, config
│   │       ├── integrations/{transactpay,email,storage}/
│   │       └── jobs/
│   └── web/                 # Next.js (ported screens)
├── packages/
│   ├── contracts/           # zod schemas + generated OpenAPI + typed client (web & mobile)
│   ├── db/                  # prisma schema, migrations, RLS/trigger SQL, seed/fixtures
│   └── config/              # tsconfig, eslint, prettier presets
├── infrastructure/          # Dockerfiles, compose (local), reverse proxy, deploy manifests
├── docs/
│   ├── business/            # BUSINESS_RULES, questionnaires
│   ├── architecture/        # this doc, ADRs, recon/inventory
│   ├── security/            # audit report, incident records, threat model
│   └── operations/          # runbooks: deploy, rollback, backup/restore, key rotation
├── legacy/                  # quarantined current code (read-only reference; §26)
└── .github/workflows/
```

**Don't recreate today's fragmentation inside the monorepo:** domain modules stay **inside `apps/api/src/modules/`** as folders, each owning its `routes / schemas / service / repository / policies / events` — not as separate packages. The only packages are the three genuinely shared ones above; split further only if a second deployable truly needs it. Mobile apps live in their own repos and consume `packages/contracts` (published) — OPEN-16.

## 22. Configuration & secrets

- All config via environment, **validated with zod at startup; missing secrets = refuse to boot** (no `'your-secret-key'` fallbacks).
- Secrets live only in the deployment secret store / server env files outside the repo; `.env.example` documents names only.
- Distinct secrets per environment (local, staging, prod); provider **sandbox** keys outside prod.
- Rotation runbook for: JWT/session signing keys (key IDs, overlapping validity), DB passwords, TransactPay keys, email provider keys, storage keys.
- Secret scanning (gitleaks) in CI and pre-commit.

## 23. Deployment architecture

- **Dedicated infrastructure** for AlphaKolect (not the shared Webuzo host that also serves other clients' sites and mail).
- CI builds **immutable Docker images** (api, worker, web) → registry. Deploy = pull tagged images + run migrations as a release step + health-checked switch. **Rollback = previous tag.**
- Environments: **local** (compose: postgres + fake provider), **staging** (sandbox provider, anonymised/fixture data), **production**.
- Reverse proxy with TLS (Caddy/nginx); API on `api.alphakolect.com`, web on `alphakolect.com` (OPEN-17 for domain layout).
- Access: named SSH keys per person, no root login, no passwords; owner holds admin, son has own account (BR-1.4).

## 24. Testing strategy

| Layer | What | Tools |
|---|---|---|
| Domain unit | fee rules, cycle logic, tier pricing, billable-agent rule, suspension state machine, withdrawal limits | Vitest |
| Ledger properties | every entry balanced; projection = Σlines; reversal nets to zero; no UPDATE/DELETE possible | Vitest + property tests |
| Integration | services against real Postgres (RLS on) | Testcontainers |
| **Tenant isolation matrix** | auto-generated from the route registry: every tenant endpoint called with another tenant's session/resource ⇒ 404 | Vitest + Supertest |
| **Authorization matrix** | every endpoint × audience × role ⇒ expected allow/deny (agents only record collections) | same |
| Provider | contract tests vs FakeProvider; sandbox smoke tests vs TransactPay | |
| API contract | OpenAPI diff check in CI (breaking-change guard for mobile) | |
| E2E web | login per audience, collection→remittance→approval, withdrawal, suspension redirect | Playwright |
| **BR traceability** | each BR-x.y has ≥1 named test; CI report lists uncovered rules | |

## 25. Migration strategy

Because nothing is live (BR-1.1, 1.2):
1. **No data migration.** New schema starts clean; fixtures reproduce the test merchants/scenarios; platform config (plans/tiers) re-entered.
2. **Build new system in parallel** (new tree, §21) while the old deployment is **frozen** (no further server edits; billing paused operationally if it must stay up, BR-1.3).
3. **Staging UAT with the owner** against the BR traceability report.
4. **Cutover:** new infrastructure goes live; DNS switch; old app decommissioned; old server's Alphakolect components removed (other clients' sites are a separate decision, OPEN-18).
5. **TransactPay:** existing VAs — close the ~197 fake-signup VAs (BR-2.4); decide whether the 4 verified test merchants' VAs are reused or closed (OPEN-14).

## 26. Legacy-code quarantine strategy

> **Update 2026-09-26 (ADR-13):** the quarantine happens in this repository, with the whole legacy application moved as-is to `legacy/current-system/` (not split into `legacy/app`, `legacy/ops`, `legacy/docs`). Step 1 is satisfied for this repository: nothing deploys from it; production runs from the old checkout, which stays frozen (security containment track). Steps 3–5 still apply.

> **Not started.** This is the planned sequence only. Nothing moves into `legacy/` until the architecture gates are accepted and `RESTRUCTURING_MAP.md` is approved; the old application stays frozen as-is meanwhile.

Order matters (production is still a git working copy that `git pull`s):
1. **Freeze the old server** — no more pulls/edits from this repo (the old deploy path is retired, not fixed).
2. In one commit: move the entire current application (`backend/`, `src/`, `components/`, `services/`, `interface/`, `libs/`, `context/`, `public/`, root configs) into `legacy/app/`; move operational scripts into `legacy/ops/` (after **secret scrubbing**); move status docs into `legacy/docs/`; delete tracked `node_modules`, archives, logs, dumps, `.env*` (secrets already rotated per owner, F-A3 — to be verified, §27).
3. `legacy/` is excluded from builds, lint and CI; kept as **behavioural reference** for porting screens and business logic.
4. **History purge** (git filter-repo) of secrets/PII after rotation is verified; force-push coordinated (owner holds GitHub).
5. Delete `legacy/` once the new system passes UAT and has run in production for an agreed period.

## 27. Security architecture (mapping to audit findings)

| Audit finding | Target control |
|---|---|
| S1 secrets in repo | secret store, startup validation, gitleaks, history purge, rotation runbook |
| S2/S3 password/OTP flaws | hashed single-use tokens, no OTP/token in responses/logs, rate limits, MFA for platform |
| S4 unverified webhook | store → verify via provider API → idempotent processing; polling reconciler |
| S5 client-minted money | no client-writable balances; ledger-only postings from domain commands |
| S6 tenant/IDOR/RBAC | TenantContext, scoped repositories, composite FKs, RLS, UUIDv7, authorization matrix tests |
| S7 public uploads | private object storage, signed URLs, type/size limits |
| S8/S9 JWT/CORS/headers | audience-bound short sessions, httpOnly cookies, CSRF, strict CORS allow-list, helmet, no public Swagger |
| B1–B7 money bugs | ledger (ADR-5), atomic commands, idempotency, reversals, projections |
| Deploy/credential sprawl | ADR-10, named keys, no root, dedicated infra |

**Verification still owed (not code):** owner states all accounts were rotated (F-A3). Application-level secrets (JWT secret, DB password, TransactPay keys in the old server's env) must be checked — if TransactPay keys were rotated but the old server env wasn't updated, its TransactPay calls now fail (harmless while frozen). Threat model document to be written in `docs/security/`.

## 28. Observability

Structured JSON logs (pino) with redaction (`password, token, otp, authorization, account numbers`), request IDs propagated to jobs; error tracking (Sentry) for api/worker/web; metrics & alerts: 5xx rate, job failures/lag, **pending payment orders older than N min**, **provider-vs-ledger reconciliation differences**, **projection mismatches**, failed logins spikes, signup spikes (fake-signup detection); uptime checks; audit log dashboard for platform staff access.

## 29. External dependencies

| Dependency | Needed for | Status |
|---|---|---|
| TransactPay | VAs, transfers, events, balances | T1 answered (transfers VA↔VA and to bank: yes); T2 partly (via API); **T3 open**; pooled vs segregated **open**; sandbox **unknown** |
| Email provider | verification, resets, notices | to choose |
| Object storage | KYC & loan documents | to choose |
| Hosting (API/web/DB) | production + staging | to choose (dedicated) |
| Agent & customer mobile apps | agent + customer audiences | "under development" — by whom, stack, timeline **open** |
| Domain/DNS (Namecheap) | domains, mail records | owner-held |

## 30. Decisions still requiring confirmation

| # | Question | Default we'll design with (until told otherwise) |
|---|---|---|
| OPEN-1 | More than one owner per merchant? | One owner; transfer of ownership by platform admin |
| OPEN-2 | Can staff be restricted to specific branches? | Supported, off by default |
| OPEN-3 | When does a 31-day cycle start — first contribution, enrolment date, or calendar? | First contribution of the cycle |
| OPEN-4 | Remittance shortfall/rejection: what happens to collections if the agent hands over less cash? | Remittance can be rejected or partially approved; unapproved collections stay "recorded"; shortfall flagged against the agent |
| OPEN-5 | Automatic daily contributions from the customer's Live wallet (mentioned in Q7d) — in first release? | Designed for, shipped after manual Live-wallet collections |
| OPEN-6 | Should withdrawals need a second person's approval (maker-checker)? | Configurable per merchant, off by default |
| OPEN-7 | Can withdrawals be paid to the customer's bank/Live wallet instead of cash? | Designed for (T1 = yes), off in first release |
| OPEN-8 | Chart-of-accounts naming/classification — accountant review | Table in §7 |
| OPEN-9 | Loan disbursement method; interest recognition (upfront vs over term); package loan charges | Disburse by cash or VA transfer; flat interest recognised over term |
| OPEN-10 | Trial starts at sign-up or at email verification? | At email verification (unverified businesses aren't "real", BR-2.2) |
| OPEN-11 | What counts as agent "activity" for billing (BR-10.6a)? | A successful login **or** a recorded collection |
| OPEN-12 ⛔ | **RELEASE BLOCKER for customer Live wallets (§8).** Establish in writing: who legally holds the funds; whether TransactPay holds them on customers' behalf; whether balances are pooled or per-account; whose name each VA is in; who may initiate transfers; what happens on insolvency or account closure; which Nigerian licensing/regulatory requirements apply (CBN; AlphaKolect as software provider vs. custodian). | Build against sandbox; **customer real-money features stay disabled in production until resolved** |
| OPEN-13 | Customer KYC required for customer VAs (BVN/NIN)? | Collected in onboarding if TransactPay requires it |
| OPEN-14 | Reuse or close the 4 verified test merchants' VAs? | Close; recreate in the new system |
| OPEN-15 | ~~Currency/timezone~~ **Decided 2026-09-26: NGN only, WAT** (ADR-11). | — |
| OPEN-16 | ~~Mobile apps~~ **Decided 2026-09-26:** the mobile frontends are built independently and are **waiting for this API — they use no old API**. API documentation (from the OpenAPI contract) is handed to the mobile developer. *Recommendation:* hand over each module's contract as it stabilises (auth → agent collections → customer views) rather than only at the end, so mobile work can proceed in parallel. | Contracts published from the new repo; no mobile code in it |
| OPEN-17 | Domain layout (`app.`/`api.` subdomains) | `alphakolect.com` web, `api.alphakolect.com` API |
| OPEN-18 | The other client websites/mail on the current VPS — separate project? | Out of scope; not migrated |
| OPEN-19 | ~~Framework~~ **Decided 2026-09-26: Express 5 + TypeScript**, module boundaries enforced by folder convention + lint (import rules). | — |

---

## Next artifact

**`RESTRUCTURING_MAP.md`** — for every file/area in the current repository: *port* (screen/logic to reference), *rewrite* (backend module), *quarantine* (`legacy/`), *delete after verification*, or *secret/incident* — plus the ordered build plan (walking skeleton → identity/tenancy → ledger/payments → savings → billing → loans/investments → platform features → cutover), each step with its BR tests and exit criteria.
