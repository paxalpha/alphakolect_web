import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs } from './support/db.js';

// The ledger's two-connection races (P6 plan §6: TA-4, TA-5, TA-6 and the non-negative rule under concurrency),
// staged and repeated 50 times each, as lock-races.test.ts stages P5's. The first transaction holds its footprint; the
// second is shown to wait for it (pg_locks) before the first commits; the second's outcome is then the one the plan
// requires. A deadlock (40P01) or any other error in any run fails.

const RUNS = 50;

let t1: pg.Client;
let t2: pg.Client;
let a1: pg.Client;
let a2: pg.Client;
let watcher: pg.Client;
let owner: pg.Client;
const pid = { t1: 0, t2: 0, a1: 0, a2: 0 };
const pidOf = async (c: pg.Client) => (await c.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
beforeAll(async () => {
  // The posting core is executable by no application role: its races run as the table owner. The claim is the app's.
  [t1, t2, a1, a2, watcher, owner] = await Promise.all([
    connectAs('migrator'),
    connectAs('migrator'),
    connectAs('app'),
    connectAs('app'),
    connectAs('migrator'),
    connectAs('migrator'),
  ]);
  pid.t1 = await pidOf(t1);
  pid.t2 = await pidOf(t2);
  pid.a1 = await pidOf(a1);
  pid.a2 = await pidOf(a2);
});
afterAll(async () => {
  await Promise.all([t1, t2, a1, a2, watcher, owner].map((c) => c.end()));
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const key = () => `race-${randomBytes(8).toString('hex')}`;

async function waitsForALock(backend: number) {
  for (let i = 0; i < 400; i++) {
    const { rowCount } = await watcher.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [
      backend,
    ]);
    if (rowCount) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`backend ${backend} never waited for a lock`);
}

/**
 * One staged race: `first` runs in an open transaction on c1 and holds its footprint; `second` starts on c2 and must
 * wait for it; c1 commits; c2's result is returned (and committed).
 */
async function race<T>(
  c1: pg.Client,
  c2: pg.Client,
  backend2: number,
  first: (c: pg.Client) => Promise<unknown>,
  second: (c: pg.Client) => Promise<T>,
): Promise<T> {
  await c1.query('BEGIN');
  await first(c1);
  await c2.query('BEGIN');
  const pending = second(c2).then(
    async (r) => {
      await c2.query('COMMIT');
      return r;
    },
    async (e) => {
      await c2.query('ROLLBACK');
      throw e;
    },
  );
  await waitsForALock(backend2);
  await c1.query('COMMIT');
  return pending;
}

async function business() {
  const {
    rows: [s],
  } = await a1.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Races')`, [
    `race-${randomBytes(6).toString('hex')}@example.test`,
    ARGON,
  ]);
  const verification = hash();
  await a1.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    verification,
  ]);
  await a1.query(`SELECT identity.verify_email($1)`, [verification]);
  const membership = (
    await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [s.identity_id])
  ).rows[0].id;
  const ledgerId = (
    await owner.query(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [s.merchant_id])
  ).rows[0].id as string;
  const session = (
    await a1.query(
      `SELECT * FROM identity.create_session($1, 'merchant', $2, 'full', $3, 86400, 1209600, NULL, NULL)`,
      [s.identity_id, membership, hash()],
    )
  ).rows[0].session_id as string;
  return { merchantId: s.merchant_id as string, ledgerId, session };
}
const account = async (ledgerId: string, code: string) =>
  (
    await owner.query(
      `SELECT id FROM ledger.accounts WHERE ledger_id = $1 AND code = $2 AND subject_id IS NULL`,
      [ledgerId, code],
    )
  ).rows[0].id as string;
/** A customer of the business (P7: a customer sub-account is opened only for one). */
async function newCustomer(merchantId: string) {
  const branch = (
    await owner.query(`INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
      merchantId,
      `Branch ${randomBytes(4).toString('hex')}`,
    ])
  ).rows[0].id as string;
  return (
    await owner.query(
      `INSERT INTO customers.customers (merchant_id, branch_id, full_name, phone) VALUES ($1, $2, 'Race', $3)
       RETURNING id`,
      [
        merchantId,
        branch,
        `+234${String(randomBytes(5).readUIntBE(0, 5) % 10_000_000_000).padStart(10, '0')}`,
      ],
    )
  ).rows[0].id as string;
}
const lines = (debit: string, credit: string, amount: string) =>
  JSON.stringify([
    { accountId: debit, side: 'debit', amountMinor: amount },
    { accountId: credit, side: 'credit', amountMinor: amount },
  ]);
const postOn = async (c: pg.Client, ledgerId: string, json: string) =>
  (
    await c.query(
      `SELECT * FROM ledger.post_entry($1, $2, 'test', CURRENT_DATE, 'Race', NULL, NULL, $3, NULL, NULL)`,
      [ledgerId, key(), json],
    )
  ).rows[0] as { outcome: string; entry_id: string };
const reverseOn = async (c: pg.Client, ledgerId: string, entryId: string) =>
  (
    await c.query(`SELECT * FROM ledger.post_reversal($1, $2, $3, CURRENT_DATE, NULL, NULL, NULL)`, [
      ledgerId,
      entryId,
      key(),
    ])
  ).rows[0] as { outcome: string };

describe('the ledger’s races, staged (P6 §6)', () => {
  it(`TA-4: two concurrent reversals of one entry — one reversal, the other refused (${RUNS} runs)`, async () => {
    const b = await business();
    const cash = await account(b.ledgerId, '1000');
    const capital = await account(b.ledgerId, '3000');
    for (let i = 0; i < RUNS; i++) {
      const original = await postOn(owner, b.ledgerId, lines(cash, capital, '100'));
      const second = await race(
        t1,
        t2,
        pid.t2,
        (c) => reverseOn(c, b.ledgerId, original.entry_id),
        (c) => reverseOn(c, b.ledgerId, original.entry_id),
      );
      expect(second.outcome).toBe('already_reversed');
      const { rows } = await owner.query(
        `SELECT count(*)::int AS n FROM ledger.journal_entries WHERE reverses_entry_id = $1`,
        [original.entry_id],
      );
      expect(rows[0].n).toBe(1);
    }
  });

  it(`TA-5: two concurrent openings of one customer’s sub-account — one account (${RUNS} runs)`, async () => {
    const b = await business();
    for (let i = 0; i < RUNS; i++) {
      const customer = await newCustomer(b.merchantId);
      const open = async (c: pg.Client) =>
        (
          await c.query(`SELECT * FROM ledger.open_subaccount($1, '2100', 'customer', $2)`, [
            b.ledgerId,
            customer,
          ])
        ).rows[0] as { outcome: string; account_id: string };
      let first: { account_id: string } | undefined;
      const second = await race(
        t1,
        t2,
        pid.t2,
        async (c) => (first = await open(c)),
        (c) => open(c),
      );
      expect(second).toEqual({ outcome: 'ok', account_id: first!.account_id });
      const { rows } = await owner.query(
        `SELECT count(*)::int AS n FROM ledger.accounts WHERE subject_id = $1`,
        [customer],
      );
      expect(rows[0].n).toBe(1);
    }
  });

  it(`the non-negative rule: two concurrent withdrawals of the whole balance — one is refused (${RUNS} runs)`, async () => {
    const b = await business();
    const office = await account(b.ledgerId, '1200');
    const capital = await account(b.ledgerId, '3000');
    for (let i = 0; i < RUNS; i++) {
      const savings = (
        await owner.query(`SELECT * FROM ledger.open_subaccount($1, '2100', 'customer', $2)`, [
          b.ledgerId,
          await newCustomer(b.merchantId),
        ])
      ).rows[0].account_id as string;
      await postOn(owner, b.ledgerId, lines(office, capital, '100'));
      await postOn(owner, b.ledgerId, lines(office, savings, '100'));
      const withdraw = (c: pg.Client) => postOn(c, b.ledgerId, lines(savings, office, '100'));
      const second = await race(t1, t2, pid.t2, withdraw, withdraw);
      expect(second.outcome).toBe('insufficient_balance');
      const { rows } = await owner.query(
        `SELECT balance_minor::text AS b FROM ledger.balance_projection WHERE account_id = $1`,
        [savings],
      );
      expect(rows[0].b).toBe('0');
    }
  });

  it(`an account archived while a posting waits — the posting is refused, the account stays empty (${RUNS} runs)`, async () => {
    const b = await business();
    const capital = await account(b.ledgerId, '3000');
    for (let i = 0; i < RUNS; i++) {
      const code = String(600000 + i);
      const created = (
        await a1.query(`SELECT outcome, id FROM ledger.create_account($1, $2, 'Race', 'expense')`, [
          b.session,
          code,
        ])
      ).rows[0] as { outcome: string; id: string };
      expect(created.outcome).toBe('ok');
      const second = await race(
        a1,
        t2,
        pid.t2,
        (c) =>
          c.query(`SELECT outcome FROM ledger.update_account($1, $2, NULL, 'archived')`, [
            b.session,
            created.id,
          ]),
        (c) => postOn(c, b.ledgerId, lines(created.id, capital, '10')),
      );
      expect(second.outcome).toBe('inactive_account');
      const { rows } = await owner.query(
        `SELECT a.status, p.balance_minor::text AS b FROM ledger.accounts a
           JOIN ledger.balance_projection p ON p.account_id = a.id WHERE a.id = $1`,
        [created.id],
      );
      expect(rows[0]).toEqual({ status: 'archived', b: '0' });
    }
  });

  it(`TA-6: two concurrent claims of one key — the second is told it is in progress (${RUNS} runs)`, async () => {
    const b = await business();
    for (let i = 0; i < RUNS; i++) {
      const k = key();
      const fp = hash();
      const claim = async (c: pg.Client) =>
        (
          await c.query(`SELECT * FROM util.claim_idempotency($1, 'ledger.manual_entry', $2, $3)`, [
            b.session,
            k,
            fp,
          ])
        ).rows[0] as { outcome: string };
      const second = await race(a1, a2, pid.a2, claim, claim);
      expect(second.outcome).toBe('in_progress');
    }
  });
});
