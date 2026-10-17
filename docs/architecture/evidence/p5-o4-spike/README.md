# O4 validation spike — the activity-record reads (P5.8, step (c)(1))

**Purpose.** O4 (P5 plan §8.5, §14) sets the bounds of both activity-record reads: the merchant read (#33,
`GET /v1/merchant/audit-events`) and the platform read (#34, `GET /v1/platform/audit-events`) — the page size, the
longest time window one request may cover, and the filters. Before the owner decides, the plan requires measured query
plans on representative data (§8.5 "Indexes — chosen by measured plans, not assumed"). Nothing from the spike becomes a
migration: the evidence is `spike.mts` (the seeding and measuring script), the dataset parameters below and `plans.txt`
(every plan, in full).

**Run on 2026-10-17**, local Docker PostgreSQL 16, a throwaway database built by the project's own migrations
(`20261017000100` the latest), dropped afterwards. Command (from the repository root):
`pnpm --filter @alphakolect/db exec tsx ../../docs/architecture/evidence/p5-o4-spike/spike.mts`.

## Dataset

| Parameter | Value |
|---|---|
| Events | 2,000,000 over 730 days (the two-year D9 retention) |
| Businesses | 3,000, skewed: business = ⌊3000 · u³⌋ — the busiest holds 131,957 events (5,798 in a 31-day window); a small one 198 |
| People (actors) | 15,000; about five per business; platform events spread over all |
| Platform events (no business) | 100,465 (5%) |
| Shared timestamps | 600,000 timestamps shared by 2–4 events (one transaction, one `occurred_at`) |
| All events in a 31-day window | 84,670 |

The validation trigger was switched off while seeding (the rows use catalog pairs) and on again before measuring.

## What was measured

Every query shape of both reads, newest first by `(occurred_at, id)`, at most 101 rows (a page of 100 and one more to
know whether another follows), within a 31-day window, as **generic prepared plans** (what a database function reuses),
first pages and continuations as separate statements — under three index sets: **S0** the existing indexes
(`(merchant_id, occurred_at)`, `(action, occurred_at)`); **S1** adding `(occurred_at, id)`,
`(merchant_id, occurred_at, id)` and `(actor_identity_id, occurred_at, id)`; **S2** S1 plus `(action, occurred_at, id)`.

| Shape | S0 | S1 | S2 |
|---|---|---|---|
| #33 first page, busiest business | 0.36 ms, 46 buffers | 0.38 ms, 45 | 0.28 ms, 45 |
| #33 continuation, busiest | 0.31 ms, 45 | 0.27 ms, 47 | 0.24 ms, 47 |
| #33 filtered by person, busiest | 0.42 ms, 171 (294 rows filtered) | 0.24 ms, 48 | 0.27 ms, 48 |
| #33 first page, small business | 0.11 ms, 8 | 0.13 ms, 8 | 0.16 ms, 8 |
| #33 empty window | 0.08 ms, 3 | 0.11 ms, 3 | 0.08 ms, 3 |
| #34 first page | **161 ms, 48,502** (sorts the window) | 0.26 ms, 49 | 0.18 ms, 49 |
| #34 continuation | **120 ms, 48,444** | 0.22 ms, 44 | 0.21 ms, 44 |
| #34 filtered by business | 0.62 ms, 46 | 0.22 ms, 45 | 0.20 ms, 45 |
| #34 filtered by person | **135 ms, 48,412** | 0.24 ms, 48 | 0.22 ms, 48 |
| #34 filtered by event | 0.28 ms, 105 | 0.36 ms, 105 | 0.26 ms, 106 |
| #34 empty window | **134 ms, 48,502** | 0.07 ms, 3 | 0.05 ms, 3 |

## What it shows

1. **With S1, every page of both reads reads about one page of rows** (≈ 45–50 buffers for 101 rows) in well under a
   millisecond, first page or three quarters down the window. Without it the platform read sorts every event of the
   window — 120–160 ms here, growing with the platform's volume.
2. **The window's length does not change a page's cost** once those indexes exist: a page is an index scan that stops
   after 101 rows, whatever the window. So the window bound is a choice about what people may look at in one request,
   not a performance limit. (A window of 31 days already holds 84,670 events here.)
3. **A page of 100 is cheap** (≈ 45 buffers). Larger pages cost proportionally more per request, and more data per
   sensitive read, each of which is itself recorded.
4. **Filtering by event type needs no index of its own**: the existing `(action, occurred_at)` serves it (0.28–0.36 ms);
   `(action, occurred_at, id)` saves a fraction of a millisecond.
5. **Filters combine cheaply** for the shapes measured (a business and a person together use the person index and
   filter the business: 48 buffers).

**Not covered, to measure when the indexes are chosen (after O4):** a business filtering its record by a platform staff
member who acts across many businesses (the seed spreads platform events with no business); if such a person's events
elsewhere dominate, `(merchant_id, actor_identity_id, occurred_at, id)` is the candidate. The final index set is chosen
with the endpoints, on the contracts the owner's O4 decision fixes.
