# P11 lane: Loans and investments

**Opened:** 29 November 2026. **Branch:** `feat/p11-loans-investments`, from `main`. **Pull request:** a draft, based on `main`, so it shows only this phase's work. **Status:** not started; the plan comes first and goes to the independent reviewer before any code.

**The scope, from the restructuring map:** Loan lifecycle (application, approval, disbursement record, repayment schedule, outstanding principal and interest, repayment posting and reversal), investment applications and transactions, their business rules, tenant isolation, permissions and the double-entry tests.

## What it depends on

The ledger (P6, closed) and savings (P8, closed), both in `main`; the payment primitives of P9 only for the money-moving steps.

## What can start now

Requirements and business-rule review from `BUSINESS_RULES.md`; the domain and accounting design; the plan for the independent reviewer; the ledger and permission tests that need no provider.

## What stays gated

**Any real disbursement is a payout, and payouts are off** (P9-22, refused in production) until P10 posts the fee and stamp duty. Designing and testing a disbursement is not authorizing one. Live money is gated by P9's release conditions.

## How this lane works

1. **Its own branch and its own pull request.** Everything for this phase is pushed to that pull request, always, so the reviewer finds it all in one place: the plan, the decisions, the evidence and the code.
2. **The plan first.** Requirements and business rules retrieved, what exists and what is outstanding, what the Paystack change affects, then a detailed plan for the independent reviewer. No code before it is approved.
3. **Every test runs in GitHub Actions on the pull request**, not on anyone's machine: format, lint, typecheck, build, the OpenAPI check, all tests, the concurrency suites, the secret scan and the API contract check.
4. **The smallest commits that are real**: one change each, never padded.
5. **Shared interfaces, database changes, ledger rules and security boundaries are reviewed before they are integrated** with another lane.
6. **A phase can be technically complete while its release stays blocked** by an external approval: the record says which.
