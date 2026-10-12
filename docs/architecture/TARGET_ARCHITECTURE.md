# AlphaKolect — Target Architecture

**Status:** Living document — first drafted 2026-09-26 (v1, branch `recovery/alphaweb-takeover`), last reviewed
2026-10-12 (`TARGET_ARCHITECTURE_REVIEW.md`). The ADRs in §0 are in force (ADR-16 awaits the independent reviewer's
approval); where a section below differs from a later ADR, the ADR governs.
**Authority:** `BUSINESS_RULES.md` (signed off by the owner, incl. the 10.6 clarification). Rules are cited as **BR-x.y**.
**Evidence base:** `AUDIT_REPORT.md`, `ARCHITECTURE_RECONNAISSANCE.md`, `CURRENT_SYSTEM_INVENTORY.md`.
**Scope:** This document describes the **target system**. It changes no code. The restructuring map and build order are in `RESTRUCTURING_MAP.md`; P0–P4 are built and P5 is in progress.

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
| ADR-15 | **Tenancy, memberships and tenant context for P4** (owner-approved 2026-10-09; details in §3.4): P4 is tenancy and isolation, P5 permissions and policies, P10 billing suspension; merchant staff and agents come online (platform staff in P5); one validated membership per session, chosen by an explicit selection step when several are eligible — never by the server guessing; membership, merchant status, role and branch re-read on every request; merchant lifecycle with platform-admin activation/deactivation; one optional branch per staff membership; merchant-defined roles as data only until P5; invitations only in their own table until accepted; atomic ownership transfer with exactly one owner enforced at commit; audience-checked refresh rotation; scoped repositories, RLS and composite keys on every tenant table. | Resolves the P4 design before implementation (E1–E7 and five follow-up decisions), so tenancy is built once against fixed rules and the tenant-isolation matrix has a precise target. |
| ADR-16 | **Authorization, policies and audit for P5 — Part 1** (from the plan approved 2026-10-12; ADR text pending approval; details in §3.5): the database permission catalog is the only authority; effective permissions resolved per request, never cached; owner and super admin hold fixed sets, staff exactly their role, platform staff exactly their per-person grants, agents self only; role, member, invitation and audit-record management owner-only; every endpoint declares its authorization class and the router fails closed; every privileged write re-checked in its own database transaction under one global lock order; a closed audit catalog with atomic, best-effort and sensitive-read classes; every permission-gated read also checked in the database (owner decision B1). Part 2 (retention) is a later addendum. | Replaces the P4 interim owner checks (ADR-15 T9) with one authority shared by API and database; makes every security claim testable. |

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
  ├── platform_membership?      → role: super_admin | platform_staff (per-person grants, ADR-16)
  ├── merchant_membership*      → merchant_id, kind: owner | staff | agent,
  │                                role_id (staff), branch_id?, status, deactivated_at
  └── customer_profile*         → merchant_id, customer_id (app login for savers)
```

- A person logs in **into an audience**: `platform`, `merchant` (owner/staff, web), `agent` (mobile), `customer` (mobile). A session is bound to exactly one audience and, for tenant audiences, **one membership** (BR-3).
- Super Admin: exactly the platform role with all permissions; **MFA mandatory** for all platform identities.
- Platform staff: each person holds exactly the permissions the super admin grants them, person by person, starting with none; a label such as support, verification or finance gives no access by itself (BR-3, F-B4a; ADR-16; owner A3, confirmed in the follow-up of 2026-10-12). Access to merchant customer/money data only via explicit permission (BR-3).
- Merchant owner: one per merchant at creation (more owners = OPEN-1).
- Staff: permissions from a merchant-defined role (BR-3, Q7c).
- Agent: fixed capability set — record collections for **assigned customers only** (BR-3); **deactivated ⇒ cannot authenticate immediately** (BR-10.6b).
- Customer: fixed capability set — read own records, pay contributions/repayments from own Live wallet (BR-3, BR-8.2).

### 3.2 Sessions & credentials

| Aspect | Design |
|---|---|
| Access token | Short-lived (15 min) signed token carrying `session_id`, `identity_id`, `audience`, `membership_id`. **Claims are hints; the server re-validates the session, membership and status in the database on every request and resolves permissions there too — never cached (ADR-14 D6, ADR-16).** |
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

### 3.4 Tenancy & membership decisions (ADR-15, owner-approved 2026-10-09)

Concrete rules for §3.1 and §4, decided before P4 implementation (P4 readiness decisions E1–E7 and five follow-up
decisions, all 2026-10-09). The P4 scope, exit criteria and work packages are in RESTRUCTURING_MAP §7.2.

| # | Decision |
|---|---|
| T1 Phase boundary | **P4** = tenancy and isolation; **P5** = permission catalog, policies, central authorization, authorization matrix; **P10** = billing-triggered suspension. P4 carries role data and only the minimum checks needed to resolve memberships and enforce tenant boundaries (T9). |
| T2 Audiences | P4 brings **merchant staff** (web, cookies) and **agents** (mobile, bearer) online. Platform staff remain P5. Super-admin behaviour is unchanged. |
| T3 One membership per session | A session is bound to exactly one validated membership, chosen at session creation; it never changes tenant — switching business creates a new session. A client-supplied `merchantId` is never accepted (§4). A selection identifier is never authorization: it is re-validated against the authenticated identity and the current state. |
| T4 Login never guesses | Authentication and membership selection are separate steps. One eligible membership ⇒ it is used; several ⇒ the selection step below; **no merchant session exists before the selection is validated**. `identity.login_candidate` (which picked the oldest membership with `ORDER BY 1 LIMIT 1`) is replaced and dropped. |
| T5 Freshness | Membership status and kind, **merchant status**, role and branch restriction are re-read from the database on every request (extending P3's `validate_session`). No authorization cache: a change applies to the next request. |
| T6 Merchant lifecycle | `pending_verification` → `active` (email verification) ⇄ `deactivated` (platform admin only, with a reason, audited). Only `active` merchants have usable sessions or usable invitations. `merchants.status` gets a CHECK. Billing suspension (P10) adds its state then. |
| T7 Branches | Tenant-owned `tenancy.branches`. A staff membership may be restricted to **one** branch (`branch_id`); **null = all branches, the default** (OPEN-2). A multi-branch join table can be added later if needed. |
| T8 Roles | Merchant-defined `tenancy.roles`; a staff membership references one role. In P4 a role is data only; P5 attaches permissions. Owners and agents have no role (fixed capability sets, BR-3). |
| T9 P4 interim checks | Until P5: merchant-management endpoints require membership kind `owner`; staff and agents use only session/self endpoints; platform lifecycle actions require the super admin. Explicit kind checks in one place, replaced wholesale by P5 policies — not a permission system. |
| T10 Invitations | The owner invites by email + kind (+ role, + branch for staff). Invitations live **only** in `tenancy.invitations` (tenant-owned; single use; expiring; token stored hashed; bound to merchant, email and kind; revocable) — no membership row exists before acceptance. **New identity:** issuing creates a passwordless identity and P3's account-setup token for it, linked to the invitation; completing setup sets the password, verifies the email and, in the same transaction, creates the membership — **after re-checking the invitation at that point** (locked; not used, revoked or expired; merchant and identity active). If it is no longer valid, setup completes and no membership is created. The owner's response is identical whether or not the email already has an account (D12). |
| T11 Existing-identity acceptance | The invitation link **plus the account's password**: the server validates the invitation (unused, unexpired, unrevoked, merchant active), that its email is the identity's, that the identity is active and verified, and the password; rate-limited; one generic error for every failure; membership creation and invitation consumption in one transaction. Never bypasses email verification, password setup or MFA. |
| T12 Agents | Bearer sign-in and refresh on **dedicated agent endpoints**; the web login and refresh contracts are unchanged. Lifetimes per D5. A deactivated agent cannot authenticate from the next request (BR-10.6b). No agent MFA in P4 (D8 is platform-only). |
| T13 Database enforcement | Every new tenant table: `merchant_id NOT NULL`, `UNIQUE (merchant_id, id)`, composite FKs for tenant references, RLS on `app.merchant_id`, default-deny grants. Identity data stays behind `SECURITY DEFINER` functions (D4). Forward-only migrations; P1–P3 migrations untouched. |
| T14 Scoped repositories | Tenant data is reached only through repositories whose functions take a `TenantContext` and run in a transaction that sets `app.merchant_id` locally. No unscoped repository for tenant data; platform cross-tenant reads (P5) are separate, permission-gated services. |
| T15 Errors | Cross-tenant access ⇒ **404**, indistinguishable from "does not exist"; a known resource in the caller's own tenant that they may not touch ⇒ 403. |
| T16 Capabilities never bypass current state | Invitation tokens, setup tokens, MFA challenges and membership-selection challenges prove only what they were issued for. Each use re-checks, at that moment, the identity's status and verification, the membership's status and kind and the merchant's status. |
| T17 Ownership transfer | Platform admin only (OPEN-1); the new owner must already be an active member. One `SECURITY DEFINER` function: the old owner's kind becomes `staff` — also when the admin chooses to deactivate them, because the one-owner index ignores status — then the new owner is promoted; both or neither. The existing index `UNIQUE (merchant_id) WHERE kind = 'owner'` keeps **at most one** owner; a deferred constraint trigger adds **exactly one** at commit. Audited with both identities. |

**P4.3 follow-up (2026-10-10, owner review; appended, T1–T17 unchanged):** T8 is enforced in the database — `CHECK (kind <> 'staff' OR role_id IS NOT NULL)` with the composite `(merchant_id, role_id)` foreign key: a staff membership always references a role of its own merchant; owners and agents never have one; a referenced role cannot be deleted. **Consequence for T17:** the demoted owner becomes staff, so the ownership transfer must assign that person a role of the merchant in the same transaction (otherwise the database refuses the demotion).

**P4 closure notes (2026-10-11; appended — T1–T17 and the tables below are unchanged as decided).** How the
implementation reads the decisions where they left room, so that P5 builds on what exists:

- **Authority from the session, in the database (T9, T13, T15).** The membership, invitation and transfer functions
  take the caller's **session id**, not a merchant id: each re-runs `identity.validate_session`, takes the merchant
  from that session (never an argument), and decides the owner / super-admin authority itself — after locking the
  merchant row, so a concurrent ownership transfer is either seen or not yet begun. Implemented signatures:
  `tenancy.list_members(session, membership?)`, `tenancy.update_membership(session, membership, action, role, branch)`,
  `tenancy.issue_invitation(session, email, kind, role, branch, token hash, setup hash, ttl)`,
  `tenancy.revoke_invitation(session, invitation)`, `tenancy.accept_invitation(token hash, identity)`,
  `tenancy.transfer_ownership(session, merchant, new owner, former owner role, deactivate former)`. The API keeps its
  T9 `requireOwner` check as an early answer; the database is the boundary.
- **T17, the new owner.** "An active member" is read as an **active staff member with an active, verified
  identity**: agents have a fixed capability set (BR-3) and another audience, so making one the web owner is a new
  person's onboarding, not a transfer. The former owner becomes staff with a role the admin chooses (the T8
  consequence noted above) and no branch restriction.
- **T10, setup ↔ invitation.** The link is the **identity**, not one particular setup token: P3's forgot-password
  flow issues a fresh setup link to a passwordless identity (expiring the older one), and that link must still lead
  to the invitation. Completing setup therefore admits each of the identity's pending invitations that is still
  valid at that moment (each re-checked under lock); invalid ones are simply not admitted and setup completes.
  Invitations live at most 24 hours, P3's account-setup cap.
- **Deactivating a member** also revokes that membership's sessions; reactivation needs a new sign-in.
- **T12, rotation.** The audience check comes **before** reuse detection: a token presented at the wrong endpoint
  changes nothing (it is neither rotated nor reuse-revoked).
- **T4 for agents.** The choices are returned in the body of `POST /v1/auth/agent/login` (after the password check)
  with their own schema, `AgentMembershipChoice`; the contract guard pins it to that operation as `MembershipChoice`
  is pinned to `GET /v1/auth/login/memberships`.

**Membership selection (T4) — contract.** `POST /v1/auth/login` keeps its 200 response (`LoginResponse` unchanged).
When the verified identity has more than one eligible membership it answers **`409 MEMBERSHIP_SELECTION_REQUIRED`**
— only after the password check, like `403 EMAIL_VERIFICATION_REQUIRED` — and sets a **selection challenge**
(opaque, 5 min, single use, stored hashed, bound to the identity and audience) in an HttpOnly, path-scoped cookie.
No session is created. `GET /v1/auth/login/memberships` returns the typed choices
`[{ selectionId, merchantName, kind }]` only to the holder of a valid challenge; it **does not consume** the
challenge, is rate-limited, sent `Cache-Control: no-store` and never with CORS headers. `POST /v1/auth/login/select`
**validates and consumes the challenge atomically**, re-checks that the chosen membership is still eligible (membership,
merchant and identity state) and only then creates the session. Agents get the same flow inside the bodies of
`POST /v1/auth/agent/login` and `POST /v1/auth/agent/login/select` (D7). The guarantee that choices are never shown
before a successful password check rests on the challenge — created only after that check — and is tested directly:
without a valid, password-verified challenge, no request can obtain the choices. `/v1/auth/mfa/verify` gets its own
response schema, decoupling it from `LoginResponse` (non-breaking; contract hardening).

Evidence for this shape: CI's pinned oasdiff 1.32.1 (`breaking --fail-on ERR`) classifies a new `LoginResponse`
variant as **breaking** (`response-body-one-of-added`, on `/login` and, through the shared schema, `/mfa/verify`),
while a new `409` on `/login`, new endpoints, a widened request enum and a separate `/mfa/verify` schema are all
non-breaking (2026-10-09, with a control that removes an endpoint and is correctly reported as breaking). The check
stays enabled.

**Agent refresh (T12).** `POST /v1/auth/agent/refresh` with `{ refreshToken }` in the body (never a query string;
the field is redacted from logs) returns new tokens in the body; rotation and reuse detection as in P3; the agent
membership is re-validated. **Rotation is audience-checked in the database:** `identity.rotate_refresh_token` gains a
`p_audiences` argument and returns `invalid` **without rotating** when the session's audience is not one of them
(cookie endpoint: platform, merchant; agent endpoint: agent). Without this, a web refresh token posted to the agent
endpoint would be rotated and returned in a JSON body. The previous three-argument function is dropped in the same
migration (a new argument creates a new Postgres function), and a test asserts it is gone.

**Function and transaction contracts.** `SECURITY DEFINER` functions run as the table owner and bypass RLS, so every
function touching tenant rows takes the `merchant_id` from the caller's `TenantContext`, filters on it explicitly and
has a cross-tenant test. Pinned `search_path`, `REVOKE ALL FROM PUBLIC`, EXECUTE for `alphakolect_app` only.

| Function | Contract |
|---|---|
| `identity.login_identity(email)` | credentials only, for the password check; replaces `login_candidate` |
| `identity.eligible_memberships(identity, audience)` | active memberships of a kind valid for the audience in an active merchant; minimal data; ordered by merchant name |
| `identity.create_selection_challenge(identity, audience, hash)` · `take_selection(hash, membership)` | issue the challenge after the password check; take = lock, consume, re-check eligibility, return the membership or nothing |
| `identity.rotate_refresh_token(old, new, idle, audiences)` | audience-checked rotation (above) |
| `tenancy.issue_invitation(merchant, inviter, email, kind, role, branch, hash, ttl)` | one transaction; inviter must be the merchant's active owner; for a new email also the passwordless identity and its linked setup token; same result shape for new and existing emails |
| `tenancy.revoke_invitation(merchant, invitation, by)` | scoped to `merchant` |
| `tenancy.accept_invitation(hash, identity)` | after the password check; invitation `FOR UPDATE`; T11 checks; membership + consumption together |
| `identity.complete_account_setup(token, password)` (replaced) | as P3, plus a linked invitation re-checked `FOR UPDATE` and turned into the membership (T10) |
| `tenancy.update_membership(merchant, membership, …)` | role/branch change, deactivate/reactivate; never the owner's own row; never sets kind `owner` |
| `tenancy.set_merchant_status(merchant, status, reason)` · `tenancy.transfer_ownership(merchant, new_owner, deactivate_old)` | platform only (T6, T17) |
| `identity.active_membership` · `validate_session` (replaced) | + merchant `active`; return kind, role and branch (T5) |

Each command runs in **one database transaction** in the service: `set_config('app.merchant_id', …, true)`, the
function call(s) and the **audit insert** — an audit row exists if and only if the change committed.

### 3.5 Authorization, policies and audit — P5 Part 1 (ADR-16, draft for approval)

**Status and scope.** This is the current specification of **P5 Part 1**, written in P5.0 from the plan whose Part 1
the independent reviewer approved on 2026-10-12 (revision 25, `e6b367d`) and the owner authorized (G1, 2026-10-12).
**This ADR text is a draft until the reviewer and the owner approve it** (P5.0's completion rule); once approved it is
the authoritative specification for Part 1. It states the rules as they are — the reasoning, alternatives and superseded positions are in the P5 implementation plan
(`docs/architecture/P5_IMPLEMENTATION_PLAN.md`, §16 revision log) and in the decision log at the end of this section.
**Part 2** — the retention design (deletion of activity entries after two years, its reservation, reports, manifest and
recovery) — is **not** part of this ADR and is **not** built until the reviewer approves it; it will be added as an
addendum (ADR-16 Part 2). Where the plan's detailed tables (lock footprints, §7.2; event inventory, §8.1) are cited
below, they are the implementation contract for Part 1 and must agree with this section; entries marked "(Part 2)"
there are excluded.

#### Decisions in force

| # | Decision |
|---|---|
| A1 Authority source | The **database permission catalog** is the only source of permission identifiers, scope (`merchant`, `platform`) and grantability. The contracts package mirrors the identifiers as a TypeScript union for typing only; a test fails on any difference. |
| A2 No cached authority | Effective permissions are resolved from the database on **every request** (with session validation, one round trip) and never cached or carried in tokens. A change applies from the next request. |
| A3 Fixed sets | The **owner** holds every merchant permission and the **super admin** every platform permission, in code, not rows — a new permission reaches them automatically and no one else. |
| A4 Grants | **Staff** hold exactly their role's permissions while membership, merchant and role are active (an archived role grants nothing). **Platform staff** hold exactly the grants on their platform membership (per person, no defaults). **Agents** hold no merchant permission (self only until P7/P8). |
| A5 Reserved, owner-only | Never grantable: `merchant.roles.manage`, `merchant.members.manage`, `merchant.invitations.manage`, `merchant.audit.read` (owner only); `platform.merchants.lifecycle`, `platform.merchants.transfer_ownership`, `platform.staff.manage` (super admin only). Inviting, cancelling invitations, changing a member's role or branch and deactivating or reactivating members are **owner-only**; staff delegate nothing. |
| A6 Write-time re-check | Every privileged write re-checks the actor's current authority **inside the database transaction that performs it**, under the locks of the lock model, before its first write. The API's early check never replaces it. |
| A7 Declared, fail-closed | Every endpoint declares exactly one class — `public`, `capability`, `self` or `permission` — in its contract; the router refuses to start on a missing or invalid declaration. An error while resolving authority is a **500 `INTERNAL_ERROR`**, logged as the `authorization_resolution_failure` signal, never a 401/403 and never a recorded denial. |
| A8 Response semantics | 401 invalid or absent session; 403 `WRONG_AUDIENCE`; **404** for another business's resource and for a forged id; 403 `FORBIDDEN` for a known resource of the caller's own business without permission. |
| A9 Branch scope | Every `permission` endpoint declares a branch scope; every P5 endpoint is `merchant_wide` (business administration). A branch restriction does not narrow them, and P5 claims **no** end-to-end branch isolation — that needs branch-owned resources (P7/P8). The owner may restrict a staff member to one branch or give all branches. |
| A10 Platform staff | Created by the super admin from an email with **no existing account** (a passwordless identity, a membership without grants, the generic account-setup email), then password and mandatory MFA. Deactivation revokes sessions and removes grants; reactivation restores the membership **with no grants**. A platform account can never join a business: invitation admission refuses an identity holding a platform membership, and the operator bootstrap refuses an identity holding a merchant membership. |
| A11 Containment | An operator-only switch makes the resolver and every re-check ignore all merchant-staff or all platform-staff grants (owner and super-admin authority unaffected), for over-authorization incidents; set and cleared with an audited event. |

#### Permission catalog

| Identifier | Scope | Grantable | Holders |
|---|---|---|---|
| `merchant.profile.read` · `merchant.profile.update` | merchant | yes | owner; staff via role |
| `merchant.branches.read` · `merchant.branches.manage` | merchant | yes | owner; staff via role |
| `merchant.roles.read` | merchant | yes | owner; staff via role (includes the catalog and role permission sets) |
| `merchant.roles.manage` | merchant | **no** | owner |
| `merchant.members.read` | merchant | yes | owner; staff via role (exposes member emails) |
| `merchant.members.manage` | merchant | **no** | owner |
| `merchant.invitations.read` | merchant | yes | owner; staff via role (exposes invitee emails) |
| `merchant.invitations.manage` | merchant | **no** | owner |
| `merchant.audit.read` | merchant | **no** | owner |
| `platform.merchants.read` · `platform.audit.read` | platform | yes | super admin; platform staff via grant |
| `platform.merchants.lifecycle` · `platform.merchants.transfer_ownership` · `platform.staff.manage` | platform | **no** | super admin |

A retired permission is never resolved or granted; its grant rows remain but are inert. A new identifier is granted to
no grantee. The app role has no direct access to the catalog: it is read through `tenancy.list_permission_catalog` and the
resolver (B1).

#### Endpoint classes and the route map (frozen)

Classes: **`public`** — no credential; **`capability`** — one named, narrow credential other than a session
(`credentials`, `refresh_token`, `mfa_challenge`, `selection_challenge`, `email_verification_token`,
`password_reset_token`, `account_setup_token`, `invitation_token`); **`self`** — a session acting only on its own
identity or membership; **`permission`** — one catalog permission (reserved permissions and owner protection are
enforced in the database, not by combining permissions). All **44** existing operations (verified against the contract
registry) are classified:

| Operation | Class | Declaration |
|---|---|---|
| getHealth, signup, resendVerification, forgotPassword | public | — |
| login, agentLogin | capability | `credentials` |
| refreshSession, agentRefresh | capability | `refresh_token` |
| verifyMfa | capability | `mfa_challenge` |
| listLoginMemberships, selectLoginMembership, agentSelectMembership | capability | `selection_challenge` |
| verifyEmail | capability | `email_verification_token` |
| resetPassword | capability | `password_reset_token` |
| completeAccountSetup | capability | `account_setup_token` |
| acceptInvitation | capability | `invitation_token` |
| logout, getSession, changePassword, beginTotpEnrollment, confirmTotpEnrollment, getCurrentMembership, getAgentMembership | self | — |
| getMerchantProfile / updateMerchantProfile | permission | `merchant.profile.read` / `merchant.profile.update` |
| listBranches, getBranch / createBranch, updateBranch | permission | `merchant.branches.read` / `merchant.branches.manage` |
| listRoles, getRole / createRole, updateRole | permission | `merchant.roles.read` / `merchant.roles.manage` (reserved: owner) |
| listMembers, getMember / assignMember, deactivateMember, reactivateMember | permission | `merchant.members.read` / `merchant.members.manage` (reserved: owner, D5′) |
| listInvitations / createInvitation, revokeInvitation | permission | `merchant.invitations.read` / `merchant.invitations.manage` (reserved: owner, D5′) |
| deactivateMerchant, reactivateMerchant | permission | `platform.merchants.lifecycle` (reserved: super admin) |
| transferOwnership | permission | `platform.merchants.transfer_ownership` (reserved: super admin) |

The new operations and their classes are in the frozen contracts below.

#### Enforcement model

- **Resolution.** `identity.session_authority(session)` returns audience, kind, merchant, role and branch state and the
  effective permission set; the router's policy middleware checks the declared permission (an early 403); the database
  decides writes (A6).
- **Lock model.** Row locks are `FOR SHARE` or `FOR NO KEY UPDATE`, never `FOR UPDATE`; keys are never updated and rows a
  foreign key references are never deleted; contested inserts come last; triggers lock nothing; each function takes its
  whole footprint first, by category then ascending id, through helpers; nested `…_locked` functions only re-assert
  their caller's locks with `NOWAIT`. Global category order: (1) platform memberships, (2) merchants, (3) merchant
  memberships, (4) invitations, (5) single-purpose identity rows, (6) identities and credentials, (7) roles,
  (8) branches, (9) grant rows, (10) sessions. Authority is acquired **by category, not by row**. The per-operation
  footprints are the plan's §7.2 table.
- **Lock-order checker.** A static checker over every function, trigger and repository transaction is the proof
  obligation for the order; it fails closed on anything outside the constructs it can analyse, and is itself
  mutation-tested. **It is built first in P5.5. If it cannot reliably enforce the documented rules, work stops and the
  limitation is reported to the reviewer and owner with an alternative — the checker and its guarantees are never
  silently weakened.**
- **Direct writes move behind functions.** Branch, role and profile writes become definer functions, and **one**
  migration creates them and revokes the app's direct write grants together; an older application version can only be
  denied, never bypass.

#### Read authorization — both layers for every permission-gated read (owner decision B1)

Every write, every sensitive read **and every other permission-gated read** is checked in **both** layers: the API
policy check, then the database. The owner decided this on 2026-10-12 (ADR-16 approval form, B1: "Add the database
check now"), so no screen relies on the API's check alone. **Tenant separation** (row-level security and explicit
`merchant_id` predicates) remains underneath, but it is not what proves permission — the database functions below do.

| Read | Checked in the database by | Permission |
|---|---|---|
| Business profile (`GET /v1/merchant/profile`) | `tenancy.read_profile(session)` | `merchant.profile.read` |
| Branches (`GET /v1/merchant/branches`, `…/{branchId}`) | `tenancy.list_branches(session, branch?)` | `merchant.branches.read` |
| Roles and their permission sets (`GET /v1/merchant/roles`, `…/{roleId}`) | `tenancy.list_roles(session, role?)` | `merchant.roles.read` |
| The permission catalog (`GET /v1/merchant/permissions`) | `tenancy.list_permission_catalog(session)` | `merchant.roles.read` |
| **Invitation list** (`GET /v1/merchant/invitations`) — exposes invitees' email addresses | `tenancy.list_invitations(session, status, cursor, limit)` | `merchant.invitations.read` |
| Members (`GET /v1/merchant/members`, `…/{membershipId}`) — exposes member emails | `tenancy.list_members(session, …)` (owner kind today; the permission from P5.5) | `merchant.members.read` |
| Merchant and platform audit reads; platform merchant and member lists | the designated sensitive-read functions (they also record the read) | as in the catalog |

Each read function follows the rule for merchant-scoped definer functions: it re-validates the session, takes the
merchant **only** from the session, checks the permission from the same resolver as every other check, filters every
query explicitly on that merchant, takes no row locks and writes nothing. **The app loses direct `SELECT`** on
`tenancy.merchants`, `tenancy.branches`, `tenancy.roles`, `tenancy.invitations` and the permission catalog, in the
same migration that creates these functions (P5.5) — so no code path can read them without the check; the reporting
role is unchanged. [Fact] The only direct app reads of these tables today are in
`apps/api/src/modules/tenancy/repository.ts` (profile `:103`, branches and roles `:131-139`, invitations `:223`).
**Tests:** each function refuses a session without the permission and returns another business's rows to no one;
`alphakolect_app` gets `insufficient_privilege` on a direct `SELECT` of each table; the previous application
version's direct reads fail the same way (the mixed-version test, extended to reads); the authorization matrix runs
every read as every actor. **Residual risk:** none specific to reads beyond those of any database function — a defect
in a read function, caught by its tests and the matrix. The earlier boundary (these reads checked by the API alone) is
superseded; see the decision log.

#### Audit (Part 1)

- **Catalog in the database.** `audit.event_catalog` holds every (identifier, outcome) pair with its class, writer
  pattern and summary allowlist; a validation trigger refuses an unknown pair, field or over-long value on every insert.
- **Classes.** **Atomic** — written in the transaction of the change, by a definer function (pattern A) or by
  `mutateAudited` around an identity flow (pattern B); a failed audit insert rolls the change back. **Best effort** —
  failures and denials, written by `recordBestEffort` in their own transaction; a failed insert never changes the
  response. **Sensitive read** — written by the designated read function in the same transaction as the rows it returns;
  a failed insert returns no data. One writer per pair, checked by the writer and coverage guards. Account setup is the
  only flow combining patterns, through an explicit nested-writer table.
- **Who sees the activity record.** The business activity record is **owner-only**, including refused attempts and
  filtering by person. The IP address and user agent are visible to each business owner for their own business's
  people (never the platform team's) and to the super admin — **never to platform staff**. The app role loses direct
  `SELECT` on the activity table (every read goes through the audited functions); the reporting role loses the `ip` and
  `user_agent` columns.
- **Logs.** Application logs use an **allowlist**: request id (always server-generated), method and path without query
  string; status code; database errors as structural fields only. No IP address, user agent or caller-controlled value
  reaches a log line unchecked. The same rule binds the deployment (P15): the reverse proxy
  records no client IP address or user agent in its access logs, and error tracking sends neither (RESTRUCTURING_MAP,
  obligations P5 passes to P15).
- **Signals.** Until metrics exist (P15), failures are structured log signals: `authorization_resolution_failure`,
  `audit_write_failure`, `audit_validation_failure`, `audit_denial_write_failure`.

#### Availability consequence (accepted)

Security-sensitive changes — including successful sign-ins, refresh, password and MFA changes — **commit together with
their activity record or not at all** (owner decision E6/D10). So if the activity record cannot be written, those
operations fail with a 500: the system fails closed rather than act without a record. **P15 must alert** on the
`audit_write_failure` signal and on sign-in failures caused by audit unavailability (500s on the sign-in, refresh and
MFA endpoints together with that signal).

**The owner's condition (follow-up C1 and C2, 2026-10-12):** the rule stays, provided that when the system goes live the
database has a standby copy that takes over automatically, continuous backups and the alerts above, with recovery
targets of **at most 5 minutes of activity lost** and **service back within 1 hour** if the main database fails. These
are P15 obligations (`RESTRUCTURING_MAP.md`, obligations P5 passes to P15).

#### Frozen contracts of the new operations (Part 1)

All additions are non-breaking (new operations, new optional query parameters, new response fields). Every list uses
`{ items, nextCursor }`; a cursor is opaque, carries only a position and a digest of the request's filters, and a cursor
reused with other filters is refused with **`400 INVALID_CURSOR`**. `limit` is optional, 1–100, default 50. Every new
cookie-session `PUT`/`POST` inherits the existing CSRF check. Codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401),
`FORBIDDEN` / `WRONG_AUDIENCE` (403), `NOT_FOUND` (404), `INVALID_LIFECYCLE_TRANSITION` (409, existing) and the two new
codes `INVALID_CURSOR` (400) and `EMAIL_IN_USE` (409).

| Operation | Method and path | Authorization | Request | Response | Errors | Built in |
|---|---|---|---|---|---|---|
| `listPermissionCatalog` | `GET /v1/merchant/permissions` | `merchant.roles.read` | — | `PermissionCatalog { items: [{ permission, description, grantable }] }` (merchant scope, active) | 401, 403 | P5.6 |
| `setRolePermissions` | `PUT /v1/merchant/roles/{roleId}/permissions` | `merchant.roles.manage` (owner) | `{ permissions: string[] }` — unique, grantable merchant identifiers; may be empty | 200 `Role` | 400 (unknown, reserved, platform or duplicate identifier), 401, 403, 404 | P5.6 |
| (field) `Role.permissions` | every role response | — | — | `permissions: string[]`, sorted; an archived role keeps its set, inert | — | P5.6 |
| (field) `CurrentMembership.permissions` | `GET /v1/merchant/membership` | `self` | — | effective merchant permissions, sorted | — | P5.4 |
| (field) `Session.permissions` | `GET /v1/auth/session` | `self` | — | effective permissions of the session's audience (merchant or platform); `[]` for agents and for `mfa_enrollment` sessions | — | P5.7 |
| `listPlatformMerchants` | `GET /v1/platform/merchants` | `platform.merchants.read` (sensitive read) | query `cursor?`, `limit?` | `PlatformMerchantList`, items `{ merchantId, name, status, createdAt }`, newest first | 400, 401, 403 | P5.7 |
| `listPlatformMerchantMembers` | `GET /v1/platform/merchants/{merchantId}/members` | `platform.merchants.read` (sensitive read) | query `cursor?`, `limit?` | `PlatformMemberList`, items as `Member`, newest first | 400, 401, 403, 404 | P5.7 |
| `listPlatformStaff` | `GET /v1/platform/staff` | `platform.staff.manage` | query `cursor?`, `limit?` | `PlatformStaffList`, items `PlatformStaffMember { platformMembershipId, email, role, status, permissions, createdAt, deactivatedAt }`, newest first | 400, 401, 403 | P5.7 |
| `createPlatformStaff` | `POST /v1/platform/staff` | `platform.staff.manage` | `{ email, role: 'support' \| 'verification' \| 'finance' }` | 201 `PlatformStaffMember` (no grants) | 400, 401, 403, **409 `EMAIL_IN_USE`** | P5.7 |
| `deactivatePlatformStaff` · `reactivatePlatformStaff` | `POST /v1/platform/staff/{platformMembershipId}/deactivate` · `…/reactivate` | `platform.staff.manage` | — | 200 `PlatformStaffMember` | 401, 403, 404 (not platform staff, the super admin included), 409 `INVALID_LIFECYCLE_TRANSITION` | P5.7 |
| `setPlatformStaffPermissions` | `PUT /v1/platform/staff/{platformMembershipId}/permissions` | `platform.staff.manage` | `{ permissions: string[] }` — unique, grantable platform identifiers; may be empty | 200 `PlatformStaffMember` | 400, 401, 403, 404, 409 `INVALID_LIFECYCLE_TRANSITION` (deactivated) | P5.7 |
| (params) `listMembers` | `GET /v1/merchant/members` | unchanged | query `cursor?`, `limit?` | `MemberList`, oldest first (unchanged order) | + 400 `INVALID_CURSOR` | P5.8 |
| (params) `listInvitations` | `GET /v1/merchant/invitations` | unchanged | query `status?` (`open` default \| `all`), `cursor?`, `limit?` | `InvitationList`, newest first (unchanged order); `open` = pending and unexpired | + 400 `INVALID_CURSOR` | P5.8 |
| `listMerchantAuditEvents` · `listPlatformAuditEvents` | `GET /v1/merchant/audit-events` · `GET /v1/platform/audit-events` | `merchant.audit.read` (owner) · `platform.audit.read` | required window `from`, `to`; filters (actor; platform also merchant, event identifier); `cursor?`, `limit?` | **frozen at P5.8 step 3**, after the measured O4 decision — page size and window bounds are not set here | — | P5.8 |

#### Rollout

Additive steps first (catalog and resolver change no access), then the API switch (unchanged results for existing
actors, proven by the P4 matrix), then the single database enforcement migration; new capabilities start empty. Rollback
is forward-only; an over-grant is handled by the incident procedure — **contain** (remove the grant through the normal writers,
or set the containment switch, A11; end affected sessions by deactivating the membership), **assess** (the activity
record shows what the excess access did), **reconcile** (the owner or super admin confirms the intended grants),
**correct forward** (a regression test that fails before the fix), **verify and lift** (the matrix and full gate pass;
the switch is cleared; the incident is recorded in `docs/security/`); an application version older
than the enforcement migration is never run.

#### Decision log (moved from the P5 plan §14 in P5.0)

Every decision behind this section, with who made it, when, the source and the commit that applied it. The owner is
Mayowa Edward Fadahunsi; his answers were written on the forms in `docs/business/` and relayed by Olamide Fadahunsi
(project lead); the owner confirmed and signed them on the confirmation form (CF1, 2026-10-12). Entries about the
retention **design** take effect with the Part 2 addendum; the decisions themselves are recorded here.

| Item | Decision | Decision-maker, date | Source | Applied in |
|---|---|---|---|---|
| D1 | Assigned-customer authorization for agents moves to P7/P8 | owner, 2026-10-11 | `P5_AUDIT_REPORT.md` §22.4 | `890e59a` |
| D4 | Platform grants per person, no defaults; merchant lifecycle, ownership transfer and platform staff management super-admin only | owner, 2026-10-11 | `P5_AUDIT_REPORT.md` §22.4 | `890e59a` |
| D5′ | Role editing owner-only (D5); inviting, cancelling invitations, changing a member's role or branch and (de)activating members owner-only — supersedes D5's staff-delegation clause; the owner may give one branch or all | owner, 2026-10-11/12 | questions A1; follow-up F1a–b | `8f15ceb`, `00724ec`; plan `8b17657` |
| D8′ | The business activity record is owner-only, always — supersedes D8 (grantable) | owner, 2026-10-12 | questions A2a; follow-up F2 | `8f15ceb`, `00724ec`; plan `8b17657` |
| D2, D3, D6, D7, D10, D11, D12 | Permissions per phase; read/manage per area; archived roles grant nothing; fail closed for branch restriction; security changes atomic with their record, sign-in failures best effort; actor from the validated session; write-time re-check | owner, confirmed 2026-10-11 | questions E1–E4, E6–E8 | `8f15ceb`; plan `8b17657` |
| O3 | The activity record shows every event of the owner's business, including refused attempts, filterable by person | owner, 2026-10-12 | questions A2b–c; follow-up F2 | plan `8b17657` |
| O6 | Successes of forgot-password and resend-verification are best effort | owner, 2026-10-11 | relayed in review of plan rev 7 | plan `331a9d4` |
| O7 | Branch ceiling for delegation — resolved by D5′ (no staff delegation) | — | follow-up F1 | plan `8b17657` |
| O8 | (a) Platform staff only from an email without an account; (b) reactivation restores the membership with no grants | owner, 2026-10-11 | questions B1, B2 | `8f15ceb`; plan `8b17657` |
| O9 | Members and invitations lists paginated in P5 | owner, 2026-10-11 | questions C1 | `8f15ceb`; plan `8b17657` |
| CF3 | Platform and business accounts kept apart both ways | owner, 2026-10-12 | confirmation CF3 | `fa5a22f`; plan `8b17657` |
| CF5 | Business owners never see the platform team's IP address or device | owner, 2026-10-12 | confirmation CF5 | `fa5a22f`; plan `8b17657` |
| D9 — purpose and visibility | IP address and user agent kept to investigate break-ins and settle disputes; visible to each business owner for their own business's people and to the super admin; never to platform staff | owner, 2026-10-11/12 | questions D1–D2; follow-up F3 | `8f15ceb`, `00724ec`; plan `8b17657` |
| D9 — retention | Every activity entry kept two years, then deleted in full, existing entries included; a copy of entries due for deletion on request, no copy kept; the same two-year rule for IP and device details kept with sign-ins and links (CF4) — **implemented by Part 2** | owner, 2026-10-11/12 | questions D3–D5; follow-up F4; confirmation CF2, CF4 | `fa5a22f`; plan `8b17657` |
| CF1 | All earlier answers confirmed and signed | owner, 2026-10-12 | confirmation CF1 | `fa5a22f` |
| O4 | Audit-read bounds — owner's preference "one month at a time is fine"; decided at P5.8 step 2 on measured evidence | owner (preference), 2026-10-11 | questions B3 | plan `8b17657` — **open by design** |
| O10–O12 | Backup retention, the report copy's handling, a privacy notice | — | `P5_OWNER_PRIVACY_QUESTIONS.md` | `4b4ece9` — **open**, needed at P5.8 step (e) |
| Approach | Lock-order checker built first, stop and report if unreliable; ordinary reads stay API-only and are documented with their residual risk (**superseded by B1**); atomic audit kept, P15 alerts required; ADR-16 written clean | Olamide Fadahunsi (project lead), 2026-10-12 | P5.0 instruction after the author's critique of Part 1 | this section, `dd60c84` |
| Reviewer — Part 1 | "Part 1 of revision 25 (`e6b367d`) is approved." (a first approval on revision 22 was withdrawn and corrected) | independent reviewer, 2026-10-12 | review | plan `5d824e9` (corrections `c533e58`) |
| Owner go-ahead G1 | "yes, start now with Part 1." | owner, 2026-10-12 | `P5_OWNER_GO_AHEAD.md` | `951b909`; plan `c533e58` |
| Reviewer — Part 2 | — | — | — | **pending** |
| B1 | Every permission-gated read is also checked in the database — the profile, branches, roles, the catalog and the invitation list get read functions with permission checks; the app loses direct `SELECT` on those tables (P5.5) | owner, 2026-10-12 | ADR-16 approval form B1: "Add the database check now … an extra layer of protection" | `d4ac17e`; this section |
| ADR-16 text — owner | "Yes i approve ADR-16 for Part 1, with the answers above." Part A all correct; B1 as above; C1 asked for a recommendation (answered in the follow-up, next row) | owner, 2026-10-12 | `P5_OWNER_ADR16_APPROVAL.md` | `d4ac17e` |
| ADR-16 follow-up — owner | C1: the rule is kept, with a standby database, continuous backups and alerts required at go-live; C2: at most 5 minutes of activity lost and service back within 1 hour; A3 confirmed: only the owner manages the platform team, person by person | owner, 2026-10-12 | `P5_OWNER_ADR16_FOLLOWUP.md` | `130fbda`; availability consequence above |
| ADR-16 text — reviewer | Approval of this section as written for Part 1, including the B1 change to Part 1 | — | — | **pending** |

---

## 4. Multi-tenancy model

**Tenant = merchant.** Invariant: **every tenant-owned row has `merchant_id NOT NULL`, and every request's tenant comes from its session membership (ADR-6).**

```
request → authenticate (session) → resolve Actor {identity, audience, membership}
        → TenantContext {merchantId, branchScope?, actorKind}
        → subscription gate (§11) → authorize(permission, resource) → domain service
        → repository (always scoped) → Postgres (SET LOCAL app.merchant_id; RLS)
```

- **Subscription gate:** its form, and how it fits ADR-16's fail-closed policy pipeline, is decided in P10's design
  (`TARGET_ARCHITECTURE_REVIEW.md` TA-12); billing suspension is not part of P5.
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
| **identity** | identities, credentials, sessions, reset/verify tokens, mfa, platform memberships and their per-person grants (ADR-16) | signup, login, refresh, logout, verify email, reset password, MFA | audit, notifications |
| **tenancy** | merchants, branches, merchant_memberships, roles and role permissions (the permission catalog itself: ADR-16 §3.5) | create merchant, manage branches/staff/agents/roles, activate/deactivate | identity, billing (status), audit |
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

Rules: a module exposes a **service interface** and **domain events**; other modules never import its repositories or query its schema. **Transaction contract:** a use case that changes several modules opens **one** database transaction and passes it to each module service it calls; each module writes only its own tables, through its own service or database functions; audit and outbox writes join that transaction; no network call is made while it is open. Which module may call which follows the *Depends on* column; making those rules enforceable, and removing the cycles in that column, is a separate step before P6 (`TARGET_ARCHITECTURE_REVIEW.md` TA-10). *(This replaces the earlier rule that only the ledger service could share a transaction across modules — audit already joins tenancy's transactions through `recordWithin`.)*

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

- **Every money command** (collect, remit-approve, withdraw, repay, disburse, charge subscription, fee) = one DB transaction that: validates rules → locks the relevant balance projections (`SELECT … FOR NO KEY UPDATE` — never `FOR UPDATE`, per ADR-16's lock model — in a fixed lock order to avoid deadlocks; the order for ledger rows is set in P6) → creates domain record(s) → posts **one or more balanced journal entries** (e.g. a remittance approval covering 20 collections posts one entry per collection plus the cash transfer) → updates projections → writes audit + outbox events. Commit or nothing.
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

`audit.audit_events` — append-only: `occurred_at, actor(identity, audience, membership), tenant, action, target(type,id), outcome, ip, user_agent, request_id, summary(json, no secrets)`. Written for: auth events (login/fail/reset/MFA), permission & role changes, membership changes, every money command, billing state changes, platform-staff data access (BR-3), exports. The design in force is **ADR-16 §3.5 (Audit)**: a closed event catalog with per-event field allowlists, atomic, best-effort and sensitive-read classes, and restricted reads.

- **Retention (owner decision D9, 2026-10-11/12):** every activity entry — existing ones included — is kept for two years and then deleted in full; the same two-year rule applies to the IP address and device details kept with sign-ins and links (CF4). The deletion is the P5 **Part 2** retention design, which awaits its own approval; until it is approved and built, nothing is deleted. **Money records are not covered by D9:** the ledger keeps its own retention (BR-11.1, BR-11.2). The text of BR-11.2 in `BUSINESS_RULES.md` has not been updated for activity records; a dated note will be added only after the owner approves that change to the signed rules.
- **Append-only stays:** no activity entry is ever edited — not to correct it and not to anonymise it; the only removal is the two-year deletion above. Customer anonymisation (BR-11.3) removes personal details from `customers`; how it treats activity entries is designed with customers in P7, within this rule (`TARGET_ARCHITECTURE_REVIEW.md` TA-14). The ledger keeps amounts and IDs.

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
- **Data layer:** generated typed client + React Query hooks per module (replaces the 2,375-line `services/api.tsx` and raw `fetch` calls). No tenant IDs, no permissions logic from `localStorage`; permissions come from the server — `GET /v1/merchant/membership` for the merchant dashboard and `GET /v1/auth/session` for the platform console (their `permissions` fields, ADR-16) — and only drive UI visibility.
- **One component tree** (`apps/web/src/components`), one design system; forms with react-hook-form + shared zod schemas.
- Money displayed from minor units with one formatter; dates in West Africa Time (ADR-11; OPEN-15 decided).

## 19. Database architecture

- PostgreSQL 16; **one Postgres schema per module** (`identity`, `tenancy`, `customers`, `savings`, `loans`, `investments`, `payments`, `ledger`, `billing`, `kyc`, `support`, `notifications`, `documents`, `audit`, `jobs`).
- snake_case everywhere; UUIDv7 PKs; `timestamptz`; `bigint` minor units + `char(3)` currency; `CHECK`s for enums/amount > 0; composite tenant FKs; RLS on tenant tables.
- **Prisma** schema = canonical definition; migrations generated, reviewed, and applied only by the release pipeline. Raw SQL migrations for RLS policies, ledger triggers, grants.
- Separate DB roles, created by `packages/db/sql/bootstrap/roles.sql`: `alphakolect_app` (per-table grants only, `NOBYPASSRLS`, never a table owner; no UPDATE or DELETE on journal entries, journal lines or activity entries; identity tables only through database functions), `alphakolect_migrator` (owns the schema objects and applies migrations), `alphakolect_readonly` (reporting; from P5 it cannot read the activity record's `ip` and `user_agent` columns, ADR-16).
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

> **Update 2026-10-12:** done — `RESTRUCTURING_MAP.md` exists and sets the build order (P0–P15); P0–P4 are built
> from it. The text below is the original description of that artifact.

**`RESTRUCTURING_MAP.md`** — for every file/area in the current repository: *port* (screen/logic to reference), *rewrite* (backend module), *quarantine* (`legacy/`), *delete after verification*, or *secret/incident* — plus the ordered build plan (walking skeleton → identity/tenancy → ledger/payments → savings → billing → loans/investments → platform features → cutover), each step with its BR tests and exit criteria.
