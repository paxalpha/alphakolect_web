# P12 lane: Platform services

**Opened:** 29 November 2026. **Branch:** `feat/p12-platform-services`, from `main`. **Pull request:** a draft, based on `main`, so it shows only this phase's work. **Status:** not started; the plan comes first and goes to the independent reviewer before any code.

**The scope, from the restructuring map:** Notifications, the transactional outbox, the email provider behind a port, private documents (signed, expiring access, file validation), KYC tiers and limits, and support.

## What it depends on

The audit and authorization foundation (P5, closed). KYC limits are enforced in payments, so they meet P9 when built.

## What can start now

The outbox, the email port and its retry and delivery tracking; private document storage; the support ticket lifecycle; the general KYC tier and limit framework, without collecting any identity data.

## What stays gated

**No BVN or other identity collection** until Paystack answers in writing what a dedicated account requires (P9 condition 3) and the owner approves a privacy form. The framework may be designed; sensitive collection is not invented ahead of the answer.

## How this lane works

1. **Its own branch and its own pull request.** Everything for this phase is pushed to that pull request, always, so the reviewer finds it all in one place: the plan, the decisions, the evidence and the code.
2. **The plan first.** Requirements and business rules retrieved, what exists and what is outstanding, what the Paystack change affects, then a detailed plan for the independent reviewer. No code before it is approved.
3. **Every test runs in GitHub Actions on the pull request**, not on anyone's machine: format, lint, typecheck, build, the OpenAPI check, all tests, the concurrency suites, the secret scan and the API contract check.
4. **The smallest commits that are real**: one change each, never padded.
5. **Shared interfaces, database changes, ledger rules and security boundaries are reviewed before they are integrated** with another lane.
6. **A phase can be technically complete while its release stays blocked** by an external approval: the record says which.
