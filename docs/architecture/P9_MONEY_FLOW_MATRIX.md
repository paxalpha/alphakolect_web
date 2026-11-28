# P9 money-flow scenario matrix

**For the independent reviewer's P9 coverage check (requested 2026-10-31). P9 stays open until that check is done.**

This matrix maps each money-in scenario to the test that proves it, using the existing suites first. Tests were added only
where the audit found a gap (§2). Every scenario here runs against the FakeProvider and a real test database. **Revision 8 (19 November
2026): the provider is Paystack.** The scenarios were written for the port, not for a provider, and still hold; the adapter's own
behaviour, and what differs for Paystack, is in §8. Rows that name TransactPay (A4, A5, B9, §5) describe the adapter that was
removed; §8 gives their Paystack equivalents. Nothing has run against Paystack's test mode yet (§5).

Test locations:

| Key | File |
|---|---|
| W | `apps/api/test/payments/worker.test.ts`: the real worker, webhook and database |
| D | `packages/db/test/payments.test.ts`: the database functions, as each role calls them |
| R | `packages/db/test/payments-races.test.ts`: staged races, 50 runs each |
| T | `apps/api/test/payments/paystack-provider.test.ts`: the adapter against a stubbed server (was `transactpay-provider.test.ts`) |
| P | `apps/api/test/payments/paystack-flow.test.ts`: the worker, webhook and ledger against a stand-in for Paystack |
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

No production code changed for this audit, and no scenario found a defect. **Limits:** a timeout through the worker is an injected
`UNKNOWN_OUTCOME`; the adapter's mapping of a real timeout to it is tested separately in T. Worker death is tested two ways: a
claim that is never finished, and a real process killed with SIGKILL with its provider call in flight (G1 to G3). A worker
killed just after the provider acted is not staged with a real process, because the FakeProvider's state lives in one process;
the lost answer is covered by A6 and D2.

## 3. The scenarios

"—" means no change, or none expected. Amounts are in kobo. Unless stated, the initial state is an active business with an
active wallet and zero balance.

### A. Wallet provisioning

| ID | Initial state | Input or provider response | Wallet | Provider transaction | Postings | Balance | Findings or errors | Test |
|---|---|---|---|---|---|---|---|---|
| A1 | Active business, no wallet | Worker's sweep | `active`, one | — | — | 0 | `wallet_provisioned` event | W "a business gets a wallet"; D "BR-2.3"; Journey 1 |
| A2 | Email unconfirmed | Worker's sweep | none | — | — | — | — | W, D same tests; Journey 1 |
| A3 | Wallet due | Two workers at once | `active`, one account at the provider | — | — | 0 | — | W "A3" |
| A4 | Wallet due | Lookup: TransactPay's own not-found (200, status false, code 04, "Account not found") | Creation attempted, `active` | — | — | 0 | — | T "P9-R2"; W "TransactPay's answers"; sandbox |
| A5 | Wallet due | Lookup: any other answer: 4xx, 5xx, HTML, or status false without that code and message; timeout | `provisioning`, no creation, retried later | — | — | 0 | `last_error`; `failed` after 50 attempts | T "P9-R2"; W "an unclear lookup", "TransactPay's answers" |
| A6 | Wallet due | Creation succeeds, answer lost | `provisioning`, then `active` by lookup | — | — | 0 | `last_error` until recovered | W "a lost answer"; Journey 3 |
| A6a | Another account exists for the alias | Creation returns a second account; the lookup names the first | `active`, holding the lookup's account | — | — | 0 | — | W "B1"; sandbox |
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
| G1 | A worker process is killed holding a wallet | Stays leased, then the next worker creates it once | W "G1"; D "a claim leases the wallet"; W "a lost answer" |
| G2 | A worker process is killed holding an event | The next worker confirms it: one credit | W "G2"; D "an event: a stale confirmation" |
| G3 | A worker process is killed sending an order | `unknown`; no later worker sends it (D7) | W "G3"; W "a worker that died" |
| G4 | A lease shorter than the provider's timeouts allow | Refused at start | W "P9-R3: a lease" |

## 4. The three journeys

All three are in W, under "the journeys, end to end".

| Journey | Steps exercised | Asserts at the end |
|---|---|---|
| **1. Successful deposit** | Signup over HTTP; no wallet yet; the emailed link confirms it; wallet provisioned; business reads it over HTTP; deposit; webhook stored and not believed; worker asks the provider; credit | Dr 1100, Cr 2290 once; the wallet API shows balance and to-classify; one open receipt; the reconciler agrees |
| **2. Forged and replayed** | A forged event; a valid one delivered three times at once; two workers at once; the forged one aged out | One credit, one receipt, one entry; one event `credited` and two `duplicate`; the forged one `rejected`; balance is the confirmed amount |
| **3. Uncertain outcome** | Lookup rate limited; creation times out after taking effect; recovery by lookup; a deposit whose confirmation fails three times, past the point a forged one is rejected; recovery | One creation; wallet `active`; the event never rejected; one posting of two lines; correct balance |

## 5. TransactPay's sandbox (history; superseded by §8)

Run on 31 October 2026 with test keys only (plan §14). The adapter it ran against was removed in revision 8. The Paystack equivalent is `PAYSTACK_SANDBOX=run` on the test file T, not yet run.

**Proven against the sandbox:** creating an account, the response fields, finding it by alias at once, the not-found answers for
an alias, a session and a payout, reading the balance's shape, and that repeating a creation makes a second account.

**Not proven.** Each stays a release blocker under `P9_IMPLEMENTATION_PLAN.md` §10.

| Assumption | If it is wrong | §10 |
|---|---|---|
| A real deposit: session fields, status table, and amounts in naira | Wrong amounts or statuses. No deposit has been made: TransactPay documents no way to simulate one into a virtual account (A2) | 1 |
| A session's details name the destination account | Every deposit lands as unmatched | 2 |
| Which balance field holds virtual-account money | The answer also has a `collection` field, and the reconciler reads `availableBalance`. Both were 0, so this is open; if deposits land in `collection`, every comparison is a false difference | 3 |
| Webhook authenticity, and a transaction listing | A missed notification shows only as a difference, with no transaction a person can credit | 4 |
| A lookup always sees a new account at once | Seen at once each time tried, a few times only. If it ever lags after a lost answer, a second, real account is made. Money sent to it arrives unmatched and is not lost | 7 |

## 6. Against the review's closure criteria

| Criterion | State |
|---|---|
| R1 to R6 addressed or carried to P10 | Done (plan §11, §12) |
| Successful deposit journey | Passes against the FakeProvider |
| Forged, replayed and concurrent deposits | Pass |
| Ledger invariants | Pass |
| Payment-order transitions | Pass |
| Reconciliation scenarios | Pass |
| Worker failure and recovery | Pass, including a real process killed mid-call (G1 to G3) |
| Sandbox tests documented, assumptions kept as blockers | Run in part (§5). **No real deposit yet**, so the journeys are unproven against TransactPay |
| Existing gates green | Recorded once the gate has run on this revision |

## 7. The independent reviewer's rulings (10 November 2026)

Given on draft PR #11 at `d16bba3`.

| # | Question | Ruling | Condition |
|---|---|---|---|
| 1 | `unmatched` for money at no wallet of ours | **Accepted** | `unmatched` must never become a fallback that guesses the business from an alias, reference or webhook payload; a person decides before anything posts |
| 2 | `review` for a reversal, in place of a reconciliation finding | **Accepted** | The platform team must monitor the review list: a reversal must not disappear because the aggregate balance happens to reconcile |
| 3 | The `submitted` order state | **Accepted** | An order is never sent again because no answer came back |
| 4 | The worker as a system-wide trust boundary | **Accepted, with a deployment condition** | The worker's credentials must reach the worker's runtime alone. In production the API now refuses to start if it is given `WORKER_DATABASE_URL`. P15 must prove the rest: a separate process and service identity, no worker credentials in the API's container, the worker's database access limited to its endpoint, and its secrets rotated independently (plan §10, condition 10) |

## 8. Revision 8: Paystack (19 November 2026)

What the change of provider alters in the scenarios above, and the tests that prove it. The scenarios themselves, and every
test marked W, D, R and A, run as before against the FakeProvider.

| ID | Scenario | Expected with Paystack | Test |
|---|---|---|---|
| A4 | A wallet is due; the customer is not found | The documented not-found only (HTTP 404, `status: false`, "not found"): the customer and its account are made, `active` | T "P9-R2"; P "a business's wallet"; W "Paystack's answers" |
| A5 | A wallet is due; any other answer | 400, 401, 403, 429, 5xx, a 404 with another message or no JSON, a customer that is not the one asked for, a timeout: `provisioning`, nothing made, retried | T "P9-R2"; W "Paystack's answers" |
| A6 | Creation made the account, the answer was lost | The customer's account is found by the alias on the next pass, and no second is made | P "a creation whose answer was lost" |
| B9 | The provider cannot answer | 401, 429, 5xx, a 400 that is not "not found", no body: the event stays `pending`, never rejected | T "only the documented not-found" |
| B13 | A payment that is not into a dedicated account (a card) | Not money arriving in a wallet: not found, rejected after the looks, nothing credited | P "a payment that is no dedicated-account deposit" |
| B14 | A fee | The wallet is credited the amount less the fee; the one balance gains the same | T "reads the reference, the amount and fee"; P "a signed notification…", P "what Paystack's one balance gains" |
| B15 | A notification with no signature, a wrong one, or an old one | Refused (401), nothing stored. A signed one is stored as it arrived, and is a lead only | T "notifications are signed"; P "a signed notification…" |
| B16 | A signed notification for a reference Paystack does not know | Stored, then rejected after the looks; nothing credited | P "a reference Paystack does not know" |
| D1 | A payout | Named by the name enquiry, made a recipient, sent once under our reference (a digest when it does not fit Paystack's form), posted once | T "payouts"; P "is named, sent under a reference Paystack accepts" |
| D10 | A step before the transfer fails (the name, the recipient) | `NOT_SENT`: `failed`, nothing posted, nothing sent | T "a step before the transfer"; P "a step before the transfer that fails" |
| D11 | The transfer was made and the answer lost | `unknown`, then `succeeded` by the lookup on the same reference; never sent twice | P "an answer lost after the money moved" |
| D12 | A repeated reference, or a transfer waiting for an OTP | `unknown`: looked up, never read as a failure | T "only a 400 or 422 is a refusal" |
| A9 | An account that is not stated to be assigned, active and in naira, or a creation naming another customer | Not a wallet: `UNKNOWN_OUTCOME`, the wallet stays `provisioning` and is retried; a closed account is reported closed | T "an account that is not stated to be a wallet" |
| A10 | Wallet creation switched off | No wallet is requested or claimed, nothing is called at Paystack, nothing counts attempts | P "switched off"; T "what is switched off" |
| D13 | A payout with payouts switched off (the default; never on in production) | `UNSUPPORTED`: the order fails unsent, nothing is posted, nothing is called | P "with payouts off"; T "what is switched off"; `config.test.ts` |
| D14 | Every documented transfer status | success, reversed, failed, abandoned, blocked, rejected conclusive (the last three fail the order); pending, received, otp not; an unknown status is not final | T "reads every status Paystack documents" |
| E7 | Paystack has one balance | Compared against the sum of every wallet's books (`perAccountBalance` false) | W "pooled balance"; P "what Paystack's one balance gains" |
| H1 | A worker of another provider's rows (a deployment whose provider was changed) | Not claimed: wallets, events and orders are claimed by their own provider only | D "P9 revision 8" |
| H2 | A live key outside production, or a test key in it | Refused at startup | `config.test.ts` "P9 rev 8" |
| H3 | A wallet email domain with a reserved ending (`.test` and ten others) or not shaped like a domain | Refused at startup, one message, the value never echoed. Paystack refused `.test` | `config.test.ts` "the wallet email domain is a real domain" |
| H4 | A tunnel to the API | The tunnel points at the webhook-only door: only `POST /v1/webhooks/paystack` passes, with only the headers the signature needs; 15 other methods and paths are 404 and never reach the API; a body over 64 KiB is refused | `webhook-proxy.test.ts` |
| H5 | The worker's role gains a membership (a built-in role, or a login role made a member) | Revoked by the bootstrap on re-run; the operator's check names it, a table privilege and a schema CREATE right | `worker-role.test.ts` (db) |

**Unproven against Paystack.** Every row that depends on Paystack's own answers rests on its documentation: plan §16.4 lists the twelve conditions,
and the first two (a test deposit through Paystack's demo bank app, and the sandbox suite) are the first to run.
