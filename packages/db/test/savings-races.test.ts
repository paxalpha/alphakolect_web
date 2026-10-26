import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs } from './support/db.js';

// The savings races (P8 plan §5; TA-13), staged and repeated 50 times each, as lock-races.test.ts stages P5's: the
// first transaction holds its footprint, the second is shown to wait for it (pg_locks) before the first commits, and
// the second's outcome is then the one the plan requires. A deadlock (40P01) or any other error fails.

const RUNS = 50;

let a1: pg.Client;
let a2: pg.Client;
let watcher: pg.Client;
let owner: pg.Client;
const pid = { a2: 0 };
const pidOf = async (c: pg.Client) => (await c.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
beforeAll(async () => {
  [a1, a2, watcher, owner] = await Promise.all([
    connectAs('app'),
    connectAs('app'),
    connectAs('migrator'),
    connectAs('migrator'),
  ]);
  pid.a2 = await pidOf(a2);
});
afterAll(async () => {
  await Promise.all([a1, a2, watcher, owner].map((c) => c.end()));
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const phone = () => `080${String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, '0')}`;
const key = () => `k-${randomBytes(8).toString('hex')}`;

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

/** One staged race: `first` holds its footprint on c1; `second` starts on c2 and waits; c1 commits; c2's result. */
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

const session = async (identityId: string, audience: string, membershipId: string) =>
  (
    await a1.query(
      `SELECT * FROM identity.create_session($1, $2, $3, 'full', $4, 86400, 1209600, NULL, NULL)`,
      [identityId, audience, membershipId, hash()],
    )
  ).rows[0].session_id as string;

/** A business: its owner's session, a manager with every savings and customer permission, a branch and a package. */
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
  const ownerMembership = (
    await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [s.identity_id])
  ).rows[0].id as string;
  const ownerSession = await session(s.identity_id, 'merchant', ownerMembership);
  const branchId = (
    await owner.query(`INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, 'Main') RETURNING id`, [
      s.merchant_id,
    ])
  ).rows[0].id as string;
  const roleId = (
    await owner.query(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Manager') RETURNING id`, [
      s.merchant_id,
    ])
  ).rows[0].id as string;
  await a1.query(`SELECT tenancy.set_role_permissions($1, $2, $3)`, [
    ownerSession,
    roleId,
    [
      'merchant.customers.assign',
      'merchant.remittances.approve',
      'merchant.savings.read',
      'merchant.withdrawals.create',
    ],
  ]);
  const person = async (kind: 'staff' | 'agent') => {
    const identityId = (
      await owner.query(
        `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
        [`race-${kind}-${randomBytes(6).toString('hex')}@example.test`, ARGON],
      )
    ).rows[0].id as string;
    const membershipId = (
      await owner.query(
        `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [s.merchant_id, identityId, kind, kind === 'staff' ? roleId : null],
      )
    ).rows[0].id as string;
    return {
      membershipId,
      session: await session(identityId, kind === 'agent' ? 'agent' : 'merchant', membershipId),
    };
  };
  const manager = await person('staff');
  const packageId = (
    await a1.query(`SELECT * FROM savings.create_package($1, 'Daily', 'flexible', 100, 'percentage', 100)`, [
      ownerSession,
    ])
  ).rows[0].id as string;
  return {
    ownerSession,
    managerSession: manager.session,
    agent: () => person('agent'),
    /** An enrolled customer of `agent`. */
    customer: async (agent: string) => {
      const id = (
        await a1.query(
          `SELECT * FROM customers.create_customer($1, $2, 'Race customer', $3, NULL, NULL, NULL, $4)`,
          [ownerSession, branchId, phone(), agent],
        )
      ).rows[0].id as string;
      await a1.query(`SELECT * FROM savings.enrol_customer($1, $2, $3)`, [ownerSession, id, packageId]);
      return id;
    },
  };
}

const record = (c: pg.Client, s: string, customer: string, amount: number, k = key()) =>
  c
    .query(`SELECT * FROM savings.record_collection($1, $2, $3, $4)`, [s, customer, amount, k])
    .then((r) => r.rows[0] as { outcome: string; id: string });
const approve = (s: string, agent: string, id: string, cash: number) => (c: pg.Client) =>
  c
    .query(`SELECT * FROM savings.approve_remittance($1, $2, $3, $4)`, [s, agent, [id], cash])
    .then((r) => r.rows[0] as { outcome: string });
const savingsOf = async (customer: string) =>
  Number(
    (
      await owner.query(
        `SELECT p.balance_minor::text AS b FROM ledger.accounts a JOIN ledger.balance_projection p ON p.account_id = a.id
          WHERE a.subject_id = $1 AND a.code = '2100'`,
        [customer],
      )
    ).rows[0].b,
  );

describe('the savings races, staged (P8 §5; TA-13)', () => {
  it(`TA-13: two remittances approving one collection at once — approved once, credited once (${RUNS} runs)`, async () => {
    const b = await business();
    const agent = await b.agent();
    for (let i = 0; i < RUNS; i++) {
      const customer = await b.customer(agent.membershipId);
      const c = await record(a1, agent.session, customer, 10_000);
      const second = await race(
        a1,
        a2,
        pid.a2,
        approve(b.ownerSession, agent.membershipId, c.id, 10_000),
        approve(b.managerSession, agent.membershipId, c.id, 10_000),
      );
      expect(second.outcome).toBe('invalid_status');
      expect(await savingsOf(customer)).toBe(9_900); // 1% taken once
      const { rows } = await owner.query(
        `SELECT count(*)::int AS n FROM ledger.journal_entries WHERE source_id = $1 AND entry_type = 'collection.cash_confirmed'`,
        [c.id],
      );
      expect(rows[0].n).toBe(1);
    }
  });

  it(`an approval and a cancellation of one collection at once — the second is refused (${RUNS} runs)`, async () => {
    const b = await business();
    const agent = await b.agent();
    const customer = await b.customer(agent.membershipId);
    for (let i = 0; i < RUNS; i++) {
      const c = await record(a1, agent.session, customer, 10_000);
      const second = await race(
        a1,
        a2,
        pid.a2,
        approve(b.ownerSession, agent.membershipId, c.id, 10_000),
        (x) =>
          x
            .query(`SELECT * FROM savings.cancel_collection($1, $2, 'Mistake')`, [b.managerSession, c.id])
            .then((r) => r.rows[0] as { outcome: string }),
      );
      expect(second.outcome).toBe('invalid_status');
      const { rows } = await owner.query(`SELECT status FROM savings.collections WHERE id = $1`, [c.id]);
      expect(rows[0].status).toBe('approved');
    }
    expect(await savingsOf(customer)).toBe(RUNS * 9_900);
  });

  it(`a recording retried while the first is in flight — recorded once (${RUNS} runs)`, async () => {
    const b = await business();
    const agent = await b.agent();
    const customer = await b.customer(agent.membershipId);
    for (let i = 0; i < RUNS; i++) {
      const k = key();
      let first = '';
      const second = await race(
        a1,
        a2,
        pid.a2,
        async (c) => (first = (await record(c, agent.session, customer, 10_000, k)).id),
        (c) => record(c, agent.session, customer, 10_000, k),
      );
      expect(second).toMatchObject({ outcome: 'replayed', id: first });
    }
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM savings.collections WHERE customer_id = $1`,
      [customer],
    );
    expect(rows[0].n).toBe(RUNS);
  });

  it(`D1: a customer moved to another agent while their old agent records — refused (${RUNS} runs)`, async () => {
    const b = await business();
    const [x, y] = [await b.agent(), await b.agent()];
    for (let i = 0; i < RUNS; i++) {
      const customer = await b.customer(x.membershipId);
      const second = await race(
        a1,
        a2,
        pid.a2,
        (c) =>
          c.query(`SELECT * FROM customers.assign_agent($1, $2, $3)`, [
            b.managerSession,
            customer,
            y.membershipId,
          ]),
        (c) => record(c, x.session, customer, 10_000),
      );
      expect(second.outcome).toBe('not_found');
    }
  });

  it(`R2: a posting holds a customer's balance while their remittance starts — it waits up front, then approves (${RUNS} runs)`, async () => {
    const b = await business();
    const agent = await b.agent();
    for (let i = 0; i < RUNS; i++) {
      const customer = await b.customer(agent.membershipId);
      const c = await record(a1, agent.session, customer, 10_000);
      const { rows } = await owner.query(
        `SELECT a.ledger_id, a.id AS savings,
                (SELECT o.id FROM ledger.accounts o WHERE o.ledger_id = a.ledger_id AND o.code = '1200' AND o.subject_id IS NULL) AS office
           FROM ledger.accounts a WHERE a.subject_id = $1 AND a.code = '2100'`,
        [customer],
      );
      const { ledger_id: ledgerId, savings, office } = rows[0];
      const second = await race(
        owner,
        a2,
        pid.a2,
        (x) =>
          x.query(
            `SELECT * FROM ledger.post_entry($1, $2, 'test', current_date, 'Race', NULL, NULL, $3, NULL, NULL)`,
            [
              ledgerId,
              key(),
              JSON.stringify([
                { accountId: office, side: 'debit', amountMinor: '500' },
                { accountId: savings, side: 'credit', amountMinor: '500' },
              ]),
            ],
          ),
        approve(b.managerSession, agent.membershipId, c.id, 10_000),
      );
      expect(second.outcome).toBe('ok');
      expect(await savingsOf(customer)).toBe(500 + 9_900);
    }
  });

  it(`two withdrawals of the whole balance at once — one paid, the other refused (BR-7.4; ${RUNS} runs)`, async () => {
    const b = await business();
    const agent = await b.agent();
    for (let i = 0; i < RUNS; i++) {
      const customer = await b.customer(agent.membershipId);
      const c = await record(a1, agent.session, customer, 10_000);
      await approve(b.ownerSession, agent.membershipId, c.id, 10_000)(a1);
      const withdraw = (s: string) => (x: pg.Client) =>
        x
          .query(`SELECT * FROM savings.move_savings($1, $2, 'savings_withdrawal', 9900, $3)`, [
            s,
            customer,
            key(),
          ])
          .then((r) => r.rows[0] as { outcome: string });
      const second = await race(a1, a2, pid.a2, withdraw(b.ownerSession), withdraw(b.managerSession));
      expect(second.outcome).toBe('insufficient_balance');
      expect(await savingsOf(customer)).toBe(0);
    }
  });
});
