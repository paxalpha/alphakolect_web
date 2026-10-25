import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs } from './support/db.js';

// The customers' two-connection races (P7 plan §5), staged and repeated 50 times each, as lock-races.test.ts stages
// P5's: the first transaction holds its footprint, the second is shown to wait for it (pg_locks) before the first
// commits, and the second's outcome is then the one the plan requires. A deadlock (40P01) or any other error fails.

const RUNS = 50;

let a1: pg.Client;
let a2: pg.Client;
let t2: pg.Client;
let watcher: pg.Client;
let owner: pg.Client;
const pid = { a2: 0, t2: 0 };
const pidOf = async (c: pg.Client) => (await c.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
beforeAll(async () => {
  [a1, a2, t2, watcher, owner] = await Promise.all([
    connectAs('app'),
    connectAs('app'),
    connectAs('migrator'),
    connectAs('migrator'),
    connectAs('migrator'),
  ]);
  pid.a2 = await pidOf(a2);
  pid.t2 = await pidOf(t2);
});
afterAll(async () => {
  await Promise.all([a1, a2, t2, watcher, owner].map((c) => c.end()));
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const phone = () => `080${String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, '0')}`;

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

/** A business with its owner's session, a manager (staff with every grantable customer permission) and a branch. */
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
    ['merchant.customers.read', 'merchant.customers.manage', 'merchant.customers.assign'],
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
    return { identityId, membershipId };
  };
  const manager = await person('staff');
  return {
    merchantId: s.merchant_id as string,
    branchId,
    ownerSession,
    managerSession: await session(manager.identityId, 'merchant', manager.membershipId),
    agent: async () => (await person('agent')).membershipId,
  };
}

const create = async (
  c: pg.Client,
  s: string,
  branchId: string,
  number: string,
  agent: string | null = null,
) =>
  (
    await c.query(
      `SELECT * FROM customers.create_customer($1, $2, 'Race customer', $3, NULL, NULL, NULL, $4)`,
      [s, branchId, number, agent],
    )
  ).rows[0] as { outcome: string; id: string };

describe('the customers’ races, staged (P7 §5)', () => {
  it(`two concurrent onboardings with one phone number — one customer, the other refused (${RUNS} runs)`, async () => {
    const b = await business();
    for (let i = 0; i < RUNS; i++) {
      const number = phone();
      const second = await race(
        a1,
        a2,
        pid.a2,
        (c) => create(c, b.ownerSession, b.branchId, number),
        (c) => create(c, b.managerSession, b.branchId, number),
      );
      expect(second.outcome).toBe('phone_taken');
      const { rows } = await owner.query(
        `SELECT count(*)::int AS n FROM customers.customers WHERE merchant_id = $1 AND phone = customers.normalise_phone($2)`,
        [b.merchantId, number],
      );
      expect(rows[0].n).toBe(1);
    }
  });

  it(`two concurrent assignments of one customer — at most one agent, every move recorded (${RUNS} runs)`, async () => {
    const b = await business();
    const [x, y] = [await b.agent(), await b.agent()];
    for (let i = 0; i < RUNS; i++) {
      const customer = (await create(a1, b.ownerSession, b.branchId, phone())).id;
      const assign = (s: string, agent: string) => (c: pg.Client) =>
        c
          .query(`SELECT * FROM customers.assign_agent($1, $2, $3)`, [s, customer, agent])
          .then((r) => r.rows[0]);
      const second = await race(a1, a2, pid.a2, assign(b.ownerSession, x), assign(b.managerSession, y));
      expect(second.outcome).toBe('ok');
      const { rows } = await owner.query(
        `SELECT agent_membership_id, ended_at IS NULL AS open FROM customers.assignments WHERE customer_id = $1
          ORDER BY assigned_at, id`,
        [customer],
      );
      expect(rows).toEqual([
        { agent_membership_id: x, open: false },
        { agent_membership_id: y, open: true },
      ]);
    }
  });

  it(`a customer’s details removed while a posting to them waits — the posting is refused (${RUNS} runs)`, async () => {
    const b = await business();
    const { id: ledgerId } = (
      await owner.query(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [b.merchantId])
    ).rows[0];
    const office = (
      await owner.query(
        `SELECT id FROM ledger.accounts WHERE ledger_id = $1 AND code = '1200' AND subject_id IS NULL`,
        [ledgerId],
      )
    ).rows[0].id as string;
    for (let i = 0; i < RUNS; i++) {
      const customer = (await create(a1, b.ownerSession, b.branchId, phone())).id;
      const savings = (
        await owner.query(`SELECT id FROM ledger.accounts WHERE subject_id = $1 AND code = '2100'`, [
          customer,
        ])
      ).rows[0].id as string;
      const second = await race(
        a1,
        t2,
        pid.t2,
        (c) => c.query(`SELECT * FROM customers.anonymise_customer($1, $2)`, [b.ownerSession, customer]),
        (c) =>
          c
            .query(
              `SELECT * FROM ledger.post_entry($1, $2, 'test', CURRENT_DATE, 'Race', NULL, NULL, $3, NULL, NULL)`,
              [
                ledgerId,
                `race-${randomBytes(8).toString('hex')}`,
                JSON.stringify([
                  { accountId: office, side: 'debit', amountMinor: '10' },
                  { accountId: savings, side: 'credit', amountMinor: '10' },
                ]),
              ],
            )
            .then((r) => r.rows[0] as { outcome: string }),
      );
      expect(second.outcome).toBe('inactive_account');
      const { rows } = await owner.query(
        `SELECT c.status, p.balance_minor::text AS b FROM customers.customers c
           JOIN ledger.balance_projection p ON p.account_id = $2 WHERE c.id = $1`,
        [customer, savings],
      );
      expect(rows[0]).toEqual({ status: 'anonymised', b: '0' });
    }
  });
});
