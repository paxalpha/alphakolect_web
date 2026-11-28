# P14 lane: System validation

**Opened:** 29 November 2026. **Branch:** `feat/p14-validation`, from `main`. **Pull request:** a draft, based on `main`, so it shows only this phase's work. **Status:** not started; the plan comes first and goes to the independent reviewer before any code.

**The scope, from the restructuring map:** Legacy parity, security review, business-rule traceability, integration testing and user acceptance testing.

## What it depends on

Features to validate: the later part of this phase needs the other phases complete.

## What can start now

The legacy parity inventory and the business-rule traceability matrix (each rule to its test), which need only the documents and the existing tests.

## What stays gated

Full integration, acceptance and the final security acceptance wait for complete features. A passing sandbox is not production validation.

## How this lane works

1. **Its own branch and its own pull request.** Everything for this phase is pushed to that pull request, always, so the reviewer finds it all in one place: the plan, the decisions, the evidence and the code.
2. **The plan first.** Requirements and business rules retrieved, what exists and what is outstanding, what the Paystack change affects, then a detailed plan for the independent reviewer. No code before it is approved.
3. **Every test runs in GitHub Actions on the pull request**, not on anyone's machine: format, lint, typecheck, build, the OpenAPI check, all tests, the concurrency suites, the secret scan and the API contract check.
4. **The smallest commits that are real**: one change each, never padded.
5. **Shared interfaces, database changes, ledger rules and security boundaries are reviewed before they are integrated** with another lane.
6. **A phase can be technically complete while its release stays blocked** by an external approval: the record says which.
