# P9 money-flow scenario matrix

**For the independent reviewer's P9 coverage check (requested 2026-10-31). P9 stays open until that check is done.**

This matrix maps each money-in scenario to the test that proves it, using the existing suites first. Tests were added only
where the audit found a gap (§2). Every scenario here runs against the FakeProvider and a real test database. None has run
against TransactPay (§5).

Test locations:

| Key | File |
|---|---|
| W | `apps/api/test/payments/worker.test.ts`: the real worker, webhook and database |
| D | `packages/db/test/payments.test.ts`: the database functions, as each role calls them |
| R | `packages/db/test/payments-races.test.ts`: staged races, 50 runs each |
| T | `apps/api/test/payments/transactpay-provider.test.ts`: the adapter against a stubbed server |
| A | `apps/api/test/payments/payments-api.test.ts`: the HTTP API |

## 1. Differences from the expected results, for the reviewer's ruling

Four results differ from the review's table. The first two follow decisions already recorded, so I have tested what was built
and not changed the behaviour.

| Scenario | The review expects | What P9 does | Why |
|---|---|---|---|
| B8 Provider destination differs from the wallet | Held for review | No wallet of ours at that account: `unmatched`, in the platform team's list, no posting. A known transaction later naming another account: `review` | Owner's Q4. In this system `held` means money in a customer's wallet, kept off the books (Q7) |
| B10 Reversal after a credit | A finding is created | The transaction goes to `review` in the platform team's list, with no automatic correction. No reconciliation finding is created for the reversal itself; the balance comparison reports a difference if the money has really left | Plan E1 and P9-13. The outcome the review asks for (a person sees it, nothing destructive) holds, through the review list |
| D Order states | created, unknown, then a final state | Also `submitted`: the provider says pending | Provider status 1, 2, 3, 7 |
| F2 Worker cannot access unrelated business data | Stated as a restriction | The worker has no table or session access. Its functions do span every business by design, and `reconcile_wallets` returns every wallet's balance. Each function takes the business from the row it acts on, so a job cannot aim at another business's books | P9-9 |

## 2. What the audit found

The existing suites already covered most scenarios at database level. These were gaps, and all are now tested in W:

- the three end-to-end journeys (§4)
- two real workers running at once, on a wallet (A3), an order (D6) and a deposit (Journey 2)
- journal lines read line by line, with the receipt-to-entry trace and the platform ledger's absence (C1 to C7)
- books above the provider's balance (E3)
- an order's unclear lookup (D3), and pending, then successful or failed, through the worker (D4, D5)
- pending and failed deposits (B5, B6) and money for no wallet of ours (B8) through the worker, where only the database level
  had them

No production code changed for this audit, and no scenario found a defect. **Limits:** a "dead" worker is simulated by a claim
that is never finished, not by killing a process. A timeout through the worker is an injected `UNKNOWN_OUTCOME`; the adapter's
mapping of a real timeout to it is tested separately in T.

## 3. The scenarios

"—" means no change, or none expected. Amounts are in kobo. Unless stated, the initial state is an active business with an
active wallet and zero balance.

### A. Wallet provisioning

| ID | Initial state | Input or provider response | Wallet | Provider transaction | Postings | Balance | Findings or errors | Test |
|---|---|---|---|---|---|---|---|---|
| A1 | Active business, no wallet | Worker's sweep | `active`, one | — | — | 0 | `wallet_provisioned` event | W "a business gets a wallet"; D "BR-2.3"; Journey 1 |
| A2 | Email unconfirmed | Worker's sweep | none | — | — | — | — | W, D same tests; Journey 1 |
| A3 | Wallet due | Two workers at once | `active`, one account at the provider | — | — | 0 | — | W "A3" |
| A4 | Wallet due | Lookup: JSON 404 | Creation attempted, `active` | — | — | 0 | — | T "P9-R2"; W "TransactPay's answers" |
| A5 | Wallet due | Lookup: 400, 401, 403, 429, 5xx, non-JSON 404, timeout | `provisioning`, no creation, retried later | — | — | 0 | `last_error`; `failed` after 50 attempts | T "P9-R2"; W "an unclear lookup", "TransactPay's answers" |
| A6 | Wallet due | Creation succeeds, answer lost | `provisioning`, then `active` by lookup | — | — | 0 | `last_error` until recovered | W "a lost answer"; Journey 3 |
| A7 | No platform wallet | Requested twice | One platform wallet | — | — | 0 | — | D "only the super admin requests it, once" |
| A8 | Lookup outlasts the lease | Second worker claims | `active`, one account; the first abandons | — | — | 0 | Warning logged | W "P9-R3: a lookup that outlasts" |

### B. Deposit processing

| ID | Initial state | Input or provider response | Wallet | Provider transaction | Postings | Balance | Findings or errors | Test |
|---|---|---|---|---|---|---|---|---|
| B1 | — | Valid successful deposit | — | `credited` | Dr 1100, Cr 2290 | +amount | `money_received` event; receipt | W "money arriving"; Journey 1 |
| B2 | — | Same webhook twice | — | `credited`, one row | One entry | +amount once | Second event `duplicate` | W "a replayed notification"; D "a replayed event" |
| B3 | — | Same transaction, concurrently | — | One row | One entry | +amount once | Others `duplicate` | R "credited once"; Journey 2 |
| B4 | — | Reference the provider does not know | — | none | — | 0 | Event `rejected` after 8 looks | W "a forged notification"; D "a forged event"; Journey 2 |
| B5 | — | Provider: failed | — | `ignored` | — | 0 | — | W "B5, B6"; D "a transaction not final yet" |
| B6 | — | Provider: pending | — | none yet | — | 0 | Event `pending`, looked at again | W "B5, B6"; D same |
| B7 | — | Webhook amount differs from the provider's | — | Provider's amount | Provider's amount | +provider's amount | — | W "money arriving"; D "what is credited" |
| B8 | — | Destination is no wallet of ours (see §1) | — | `unmatched`, listed for the platform team | — | 0 | Credited only by a person | W "B8"; D "unmatched money"; R |
| B8a | Transaction credited | Same id and amount, another account | Credit stays | `review`, shows the account now named | No new entry | Unchanged | — | D "P9-R5" |
| B9 | — | Provider: 401, 429, 500, or no answer | — | none yet | — | 0 | Event `pending`, never rejected; an `event` finding after 8 looks | T "only a JSON 404"; W "a provider that cannot answer"; Journey 3 |
| B10 | Transaction credited | Provider later says reversed (see §1) | — | `review` | Entry stays, none added | Unchanged | In the platform list | W "a reversal"; D "a contradiction" |
| B11 | — | Amount below a kobo | — | none | — | 0 | Event `pending`; an `event` finding after 8 looks | T "P9-R4"; W "P9-R4" |
| B12 | Transaction ignored (failed) | Later reported successful | — | `review` | — | 0 | A person decides (P9-13) | D "a contradiction" |

### C. Ledger correctness

| ID | Initial state | Input | Wallet | Provider transaction | Postings | Balance | Findings or errors | Test |
|---|---|---|---|---|---|---|---|---|
| C1 | — | ₦10,000 deposit | — | `credited` | Dr 1100 1,000,000; Cr 2290 1,000,000 | 1100 and 2290: +1,000,000 | — | W "C1–C7"; Journey 1 |
| C2 | Two businesses | Deposit to one | — | — | That business's accounts only | Other: unchanged | — | W "C1–C7"; "TA-11" |
| C3 | — | Deposit | — | — | None in the platform ledger | — | — | W "C1–C7" |
| C4 | Credited | Replayed | — | — | No new entry | Unchanged | — | W "C1–C7"; Journey 2 |
| C5 | — | Failed or forged | — | — | None | 0 | — | W "B5, B6", "a forged notification" |
| C6 | Credited | — | — | Names its entry | Receipt, transaction and entry trace to the provider's reference | — | — | W "C1–C7" |
| C7 | Two businesses | Notification names the other business | — | Wallet from the provider's answer | The provider's business only | Other: unchanged | — | W "C1–C7"; D "what is credited" |
| C8 | Credited | Classified by the business | — | — | Dr 2290, Cr the chosen account, once | 2290 down | Own accounts only | D "the business records"; R "classified twice"; A |
| C9 | Any | Whole suite | — | — | Each projection equals its lines | — | — | D "every projection equals its lines" |

### D. Payment orders

P9 has no path that creates an order from the app (Q2). These test the machinery P10 will use.

| ID | Initial state | Input or provider response | Order | Postings | Balance | Findings or errors | Test |
|---|---|---|---|---|---|---|---|
| D1 | `created`, funded | Provider accepts | `succeeded`, sent once | Once | Down | — | W "sent once" |
| D2 | `created`, funded | Timeout after the money moved | `unknown`, then `succeeded` by lookup, not resent | Once, after lookup | Down after lookup | `last_error` | W "an answer lost"; D "a timeout stays unknown" |
| D3 | `unknown` | Lookup: 429 | Stays `unknown`, nothing sent | — | Unchanged | — | W "D3" |
| D4 | `unknown` | Pending, then successful, then the same again | `submitted`, then `succeeded` | Once, only on success | Down once | — | W "D4" |
| D5 | `unknown` | Confirmed failed | `failed` | — | Unchanged | — | W "D5"; D "a timeout stays unknown" |
| D6 | `created`, funded | Two workers at once | Sent once | Once | Down once | — | W "D6" |
| D7 | `created` | Worker dies after the claim | `unknown` forever until a lookup finds it; never sent by a later pass | — | Unchanged | — | W "a worker that died"; D "is claimed to send exactly once" |
| D8 | `created`, unfunded | Stated refusal | `failed` | — | Unchanged | — | W "a stated refusal"; T "a payout" |
| D9 | Claimed by a later worker | An expired worker says succeeded | Unchanged: `stale` | — | Unchanged | — | D "an order: a stale success" |

### E. Reconciliation

| ID | Initial state | Provider balance | Postings | Balance | Findings | Test |
|---|---|---|---|---|---|---|
| E1 | Credited | Equals the books | — | — | None | W "finds a difference"; Journey 1 |
| E2 | Credited | Above the books | — | Unchanged | One open | W "finds a difference", "a missed notification" |
| E3 | Credited | Below the books | — | Unchanged | One open | W "E3" |
| E4 | — | Not available | — | — | None | W "no answer from the provider" |
| E5 | Open finding | Same difference again | — | — | Still one | W "finds a difference"; R "found twice" |
| E6 | Open finding | A person resolves it, with a note | — | Unchanged | Resolved | D "Q5"; A "each list is recorded" |
| E7 | Pooled balance | Compared in total | — | — | One open, `pooled` | W "a provider with one pooled balance" |

### F. Security and concurrency

| ID | Scenario | Expected | Test |
|---|---|---|---|
| F1 | The API fabricates a provider-confirmed deposit | Refused (42501), balance unchanged | D "the web role is refused"; W "P9-R1" |
| F2 | The worker reaches unrelated data (see §1) | No tables, session functions or other roles | D "the worker has its functions" |
| F3 | Two workers post one transaction | One entry | R "credited once"; Journey 2 |
| F4 | An expired worker overwrites a newer result | `stale`, nothing changes, for wallets, events and orders | D "P9-R3" |
| F5 | Concurrent contradictory events | The loser is compared, and goes to `review` | R "the contradiction is not lost" |
| F6 | One transaction through different webhook event ids | One credit | W "a replayed notification"; Journey 2 |
| F7 | Customer wallets switched on by a caller | No running process may call the function | D "Q7, P9-R1" |

### G. Worker failure and recovery

| ID | Scenario | Expected | Test |
|---|---|---|---|
| G1 | A worker dies holding a wallet | Claimable once the lease passes; the alias lookup avoids a second account | D "a claim leases the wallet"; W "a lost answer" |
| G2 | A worker dies holding an event | Claimable once the lease passes; confirmation is idempotent | D "an event: a stale confirmation"; W "a replayed notification" |
| G3 | A worker dies holding an order | Never sent again (D7) | W "a worker that died" |
| G4 | A lease shorter than the provider's timeouts allow | Refused at start | W "P9-R3: a lease" |

## 4. The three journeys

All three are in W, under "the journeys, end to end".

| Journey | Steps exercised | Asserts at the end |
|---|---|---|
| **1. Successful deposit** | Signup over HTTP; no wallet yet; the emailed link confirms it; wallet provisioned; business reads it over HTTP; deposit; webhook stored and not believed; worker asks the provider; credit | Dr 1100, Cr 2290 once; the wallet API shows balance and to-classify; one open receipt; the reconciler agrees |
| **2. Forged and replayed** | A forged event; a valid one delivered three times at once; two workers at once; the forged one aged out | One credit, one receipt, one entry; one event `credited` and two `duplicate`; the forged one `rejected`; balance is the confirmed amount |
| **3. Uncertain outcome** | Lookup rate limited; creation times out after taking effect; recovery by lookup; a deposit whose confirmation fails three times, past the point a forged one is rejected; recovery | One creation; wallet `active`; the event never rejected; one posting of two lines; correct balance |

## 5. Not tested: TransactPay's sandbox

No sandbox keys are available, so the sandbox block in T is skipped. Everything below is an assumption, and each is a release
blocker under `P9_IMPLEMENTATION_PLAN.md` §10.

| Assumption | If it is wrong | §10 |
|---|---|---|
| Field names, status table, and amounts in naira | Wrong amounts or statuses: must be proven first | 1 |
| An unknown alias or session answers a JSON 404 | No wallet is created and no forged event is rejected (safe, visible, and not working) | 1 |
| A session's details name the destination account | Every deposit lands as unmatched | 2 |
| The balance enquiry covers virtual-account money | Every comparison is a false difference | 3 |
| Webhook authenticity, and a transaction listing | A missed notification shows only as a difference, with no transaction a person can credit | 4 |
| A lookup sees a new account at once, or creation is idempotent | A second account is possible after a lost answer | 7 |

To run it, set the `TRANSACTPAY_SANDBOX_*` variables. The block covers only creation, lookup and balance today. A real deposit
through the webhook and worker, and the unknown-alias and unknown-session answers, must be added once keys exist (§10
condition 1).

## 6. Against the review's closure criteria

| Criterion | State |
|---|---|
| R1 to R6 addressed or carried to P10 | Done (plan §11, §12) |
| Successful deposit journey | Passes against the FakeProvider |
| Forged, replayed and concurrent deposits | Pass |
| Ledger invariants | Pass |
| Payment-order transitions | Pass |
| Reconciliation scenarios | Pass |
| Worker failure and recovery | Pass, simulated (§2) |
| Sandbox tests documented, assumptions kept as blockers | Documented here (§5). **Not run** |
| Existing gates green | Recorded in the plan after this document is committed |
