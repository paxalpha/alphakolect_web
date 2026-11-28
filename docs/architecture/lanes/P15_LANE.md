# P15 lane: Infrastructure and cutover

**Opened:** 29 November 2026. **Branch:** `feat/p15-infrastructure`, from `feat/p9-paystack`. **Pull request:** a draft, based on `feat/p9-paystack`, so it shows only this phase's work. **Status:** not started; the plan comes first and goes to the independent reviewer before any code.

**The scope, from the restructuring map:** Dedicated infrastructure, the worker runtime separated from the API, backups and restore testing, monitoring, deployment and rollback, DNS cutover, and decommissioning the legacy system.

## What it depends on

The P9 worker and its configuration (this lane starts from the P9 Paystack branch). P9 conditions 9 and 10 (the worker role in each real environment, and its credentials kept apart) are proved here.

## What can start now

The worker runtime and credential-separation design, the container and secret-injection design, the backup and restore plan, monitoring and alerting, the deployment and rollback runbooks, and the retention rule for stored payment events.

## What stays gated

**No production deployment, no production credential and no DNS cutover** without separate approval. Preparation is not deployment.

## How this lane works

1. **Its own branch and its own pull request.** Everything for this phase is pushed to that pull request, always, so the reviewer finds it all in one place: the plan, the decisions, the evidence and the code.
2. **The plan first.** Requirements and business rules retrieved, what exists and what is outstanding, what the Paystack change affects, then a detailed plan for the independent reviewer. No code before it is approved.
3. **Every test runs in GitHub Actions on the pull request**, not on anyone's machine: format, lint, typecheck, build, the OpenAPI check, all tests, the concurrency suites, the secret scan and the API contract check.
4. **The smallest commits that are real**: one change each, never padded.
5. **Shared interfaces, database changes, ledger rules and security boundaries are reviewed before they are integrated** with another lane.
6. **A phase can be technically complete while its release stays blocked** by an external approval: the record says which.
