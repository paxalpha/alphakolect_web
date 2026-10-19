# The audit reads' indexes — the shape the reviewer named (P5.8)

**Purpose.** The independent reviewer confirmed the ADR-16 activity-record addendum on 2026-10-19 with one condition:
"Before finalizing indexes, measure the platform-team-member-across-many-businesses query shape identified in the
addendum." The O4 spike (`../p5-o4-spike`) had not covered it. This measures it, beside every other shape of both reads
as a control, and chooses the indexes of `20261019000100_audit_reads`. The evidence is `measure.mts` (seeding and
measuring) and `plans.txt` (every plan, in full).

**Run on 2026-10-19**, local Docker PostgreSQL 16, a throwaway database built by the project's own migrations
(`20261018000200` the latest), dropped afterwards. Command (from the repository root):
`pnpm --filter @alphakolect/db exec tsx ../../docs/architecture/evidence/p5-audit-read-indexes/measure.mts`.

## Dataset

The O4 spike's (2,000,000 events over 730 days across 3,000 skewed businesses and 15,000 people, 5% platform events,
600,000 shared timestamps), plus **one platform team member busy across many businesses**: 60,000 events spread over
2,000 businesses, and 40 more in the busiest business inside the window. In the measured 31-day window: 88,327 events in
all, 5,816 of the busiest business, 2,506 of the busy team member across businesses — **40 of them in the busiest
business**.

## What was measured

Two index sets: **A**, the addendum's — `(occurred_at, id)` (already there from Part 2), `(merchant_id, occurred_at, id)`
replacing `(merchant_id, occurred_at)`, `(actor_identity_id, occurred_at, id)`; **B**, A plus
`(merchant_id, actor_identity_id, occurred_at, id)`. Each under two plan modes: **generic plans of the exact shapes** (the
O4 spike's method), and **the functions' own statements planned per call** — each optional filter written
`parameter IS NULL OR …`, with `plan_cache_mode = force_custom_plan`, exactly as `audit.read_merchant_events` and
`audit.read_platform_events` run them.

| Shape (101 rows at most) | A, generic | A, per call | B, generic | **B, per call** |
|---|---|---|---|---|
| #34 busiest business + busy team member | 6.0 ms, 2,542 buffers | 7.6 ms, 2,545 | 2.2 ms, 2,542 | **0.19 ms, 50** |
| #34 small business + busy team member | 6.7 ms, 2,542 | 0.16 ms, 5 | 2.6 ms, 2,542 | **0.18 ms, 4** |
| #34 by the busy team member | 0.50 ms, 106 | 0.68 ms, 109 | 0.26 ms, 106 | **0.42 ms, 109** |
| #33 first page, busiest | 0.45 ms, 54 | 1.25 ms, 357 | 0.20 ms, 54 | **0.51 ms, 357** |
| #33 continuation, busiest | 0.54 ms, 44 | 0.61 ms, 347 | 0.45 ms, 44 | **0.84 ms, 347** |
| #33 by person, busiest | 0.47 ms, 51 | 1.97 ms, 54 | 0.25 ms, 51 | **0.35 ms, 57** |
| #34 first page | 0.48 ms, 48 | 0.51 ms, 177 | 0.16 ms, 48 | **1.15 ms, 177** |
| #34 continuation | 0.70 ms, 45 | 1.03 ms, 156 | 0.22 ms, 45 | **0.92 ms, 156** |
| #34 by business | 0.54 ms, 54 | 0.47 ms, 72 | 0.20 ms, 54 | **0.20 ms, 72** |
| #34 by person | 0.34 ms, 51 | 0.26 ms, 54 | 0.20 ms, 51 | **0.17 ms, 54** |
| #34 by event | 0.51 ms, 105 | 1.46 ms, 408 | 0.47 ms, 105 | **0.61 ms, 408** |
| #34 empty window | 0.06 ms, 3 | 0.05 ms, 3 | 0.08 ms, 3 | **0.03 ms, 3** |

## What it shows

1. **The named shape is the one the addendum's set does not serve.** With A, a business's events filtered by a team
   member busy elsewhere walk that person's whole window and filter out all but the business's (2,466 rows filtered,
   about 2,500 buffers, 6–8 ms) — and the cost grows with how busy the person is, not with the page.
2. **B serves it, planned per call:** a backward scan of `(merchant_id, actor_identity_id, occurred_at, id)` reads
   about one page (50 buffers, 0.19 ms). A generic plan cannot know the person is busy and keeps the person index;
   planned per call, with the person's statistics, the planner chooses the composite. The functions are therefore
   planned per call (`force_custom_plan`), which also folds each absent filter away.
3. **Every other shape stays at about one page**, first page or deep continuation, under a millisecond and a half. The
   functions' statements read more buffers than the bare shapes (up to about 400) because they also join each row's
   person (the email) and, in #33, look up whether the actor is the platform team — a fixed cost per returned row,
   not per examined row.
4. **The event filter** keeps P1's `(action, occurred_at)` with an incremental sort of each timestamp group (0.6 ms);
   an `(action, occurred_at, id)` index would save a fraction of a millisecond and is not added.

**Chosen (migration `20261019000100_audit_reads`):** set B — `(merchant_id, occurred_at, id)` replacing
`(merchant_id, occurred_at)`, `(actor_identity_id, occurred_at, id)`, `(merchant_id, actor_identity_id, occurred_at, id)`;
`(occurred_at, id)` and `(action, occurred_at)` as they are.
