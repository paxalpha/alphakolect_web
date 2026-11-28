# P11 lane: Loans and investments

**Opened:** 29 November 2026. **Branch:** `feat/p11-loans-investments`, from `main`. **Pull request:** a draft, based on `main`, so it shows only this phase's work. **Status:** not started; the plan comes first and goes to the independent reviewer before any code.

**The scope, from the restructuring map:** Loan lifecycle (application, approval, disbursement record, repayment schedule, outstanding principal and interest, repayment posting and reversal), investment applications and transactions, their business rules, tenant isolation, permissions and the double-entry tests.

## What it depends on

The ledger (P6, closed) and savings (P8, closed), both in `main`; the payment primitives of P9 only for the money-moving steps.

## What can start now

Requirements and business-rule review from `BUSINESS_RULES.md`; the domain and accounting design; the plan for the independent reviewer; the ledger and permission tests that need no provider.

## What stays gated

**Any real disbursement is a payout, and payouts are off** (P9-22, refused in production) until P10 posts the fee and stamp duty. Designing and testing a disbursement is not authorizing one. Live money is gated by P9's release conditions.
