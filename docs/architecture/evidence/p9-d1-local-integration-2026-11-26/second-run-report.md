# D1, second live run, and the two checks it could not make locally

**Run:** 27 November 2026, 06:31 to 06:36 UTC, on the local compose database `127.0.0.1:5436`, code at `3f7606c` (CI green on it: run 45950096166). **Authorized by:** the reviewer, for exactly this
(local database, API on loopback, the worker; no tunnel, no wallet creation, no payouts, no deposit). **Raw log:** `second-run-log.txt` (no credential, connection string or value in it).

## What the live run showed

| Required | Result | Kind of evidence |
|---|---|---|
| Local database target | `DATABASE_URL` and `WORKER_DATABASE_URL` both `127.0.0.1:5436`, database `alphakolect`; the container publishes `5432/tcp -> 127.0.0.1:5436` | Direct |
| `worker-role.sql` immediately before startup | Passed; worker has `CONNECT` and **0** memberships; 57 migrations recorded, 0 unfinished | Direct |
| API, loopback only | "API listening" on 4000; `netstat`: `127.0.0.1:4000 LISTENING` only; `GET /v1/health` 200 | Direct |
| The worker stays alive | Alive at all five samples between 06:33:10Z and 06:35:40Z, about 2.5 minutes: past the roughly 10 s point at which the first version ended, and through more than three 30 s pass intervals. No error line | Direct, for liveness |
| Successive passes | Database-wide counters rose faster with the worker than without (about +14 to 15 commits and +9 to 10 sessions per 35 s, against +10 and +7 with the API alone), and the worker's role held a connection at one of five samples | **Indirect only.** Other activity can move those counters. The worker logged no per-pass line at that code, so the run could not show passes directly |
| Wallet creation and payouts off; no Paystack call; no money | Both `off`; `payments` tables 0 wallets, 0 events, 0 orders, 0 findings afterwards; no tunnel, no deposit | Direct |
| Graceful shutdown on SIGTERM | **Not shown.** On Windows Node cannot deliver SIGTERM to a process; stopping it ends it by force, which proves nothing about a clean stop | Not shown here |

Two things the run did not give, said plainly: the one-second sampling of the worker's connections (`\watch`) returned nothing, because my filter did not match psql's output, and was not repeated; and the processes were ended
by force, as the last row says. Neither is claimed as evidence.

## How the two gaps were closed, in the cloud

The reviewer asked for direct evidence of successive passes and a clean SIGTERM. Neither can be taken on this Windows machine, so both are now **tests that run on Linux in GitHub Actions** (and skip on Windows).

| Gap | What was added | Where it ran |
|---|---|---|
| Successive passes, directly | The loop logs one line per completed pass (`Worker pass completed`: a pass number that only goes up, and its duration) and a separate line per reconciliation. Nothing a pass handled can reach those lines (tested) | `worker-loop.test.ts` (unit); `worker-process.test.ts` (the real process) |
| SIGTERM | `worker-process.test.ts` starts the real `src/worker.ts` against its own freshly migrated database (so it cannot touch another test's rows), with passes one second apart: it waits for **passes 1, 2, 3** and one reconciliation, sends **SIGTERM**, and requires exit code **0** within 10 s, with `Worker stopping` logged before `Worker stopped: its database connections are closed` | CI run 46060635762, Linux: **passed** (2.96 s) |
| Alive between passes, past the pool's idle time; SIGTERM during the wait | A second run with a pass every 20 s, longer than the 10 s the pool keeps an idle connection, so only the timer is open between passes; it waits for passes 1 and 2, confirms the process is still running, sends SIGTERM mid-wait, and requires exit 0 in under 8 s, not after the 20 s interval | CI run 46060635762, Linux: **passed** (20.5 s) |

In that same CI run, one *unit* test of mine failed on the first push (a wrong expectation about which pass reconciles: the fourth, not the third; the loop was right). It was corrected in `1000365`, and **CI on that head is green**: run 46061287793, all three checks (format, lint, typecheck, every test including the two Linux worker-process tests, concurrency, build; the API contract check; the secret scan).

## What is still not shown

- A live run on the local database of the version with the pass lines (`dd7c23d` and after). The Linux process test covers it in CI against a database made for it; a local repeat would add only the local database.
- Anything beyond D1: no webhook signing secret, tunnel, wallet creation, deposit or payout was configured or done.
