# P15 lane: Infrastructure and cutover

**Opened:** 29 November 2026. **Branch:** `feat/p15-infrastructure`, from `feat/p9-paystack`. **Pull request:** a draft, based on `feat/p9-paystack`, so it shows only this phase's work. **Status:** not started; the plan comes first and goes to the independent reviewer before any code.

**The scope, from the restructuring map:** Dedicated infrastructure, the worker runtime separated from the API, backups and restore testing, monitoring, deployment and rollback, DNS cutover, and decommissioning the legacy system.

## What it depends on

The P9 worker and its configuration (this lane starts from the P9 Paystack branch). P9 conditions 9 and 10 (the worker role in each real environment, and its credentials kept apart) are proved here.

## What can start now

The worker runtime and credential-separation design, the container and secret-injection design, the backup and restore plan, monitoring and alerting, the deployment and rollback runbooks, and the retention rule for stored payment events.

## What stays gated

**No production deployment, no production credential and no DNS cutover** without separate approval. Preparation is not deployment.
