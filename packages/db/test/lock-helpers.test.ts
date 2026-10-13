import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState } from './support/db.js';

// The lock helpers (P5.5 step 1; P5 plan §7.2 L1, L5): one call per multi-row acquisition of a category. Each helper
// locks exactly the rows it is given, each in its mode (FOR SHARE or FOR NO KEY UPDATE — never FOR UPDATE), one row
// per statement in ascending id order whatever the order it was given, and counts the rows that exist. Locks are
// observed from another connection with NOWAIT, so no check ever waits.

const LOCK_NOT_AVAILABLE = '55P03';

let a: pg.Client; // calls the helper
let b: pg.Client; // probes, or blocks
let c: pg.Client; // probes while a waits
beforeAll(async () => {
  [a, b, c] = await Promise.all([connectAs('migrator'), connectAs('migrator'), connectAs('migrator')]);
});
afterAll(async () => {
  await Promise.all([a.end(), b.end(), c.end()]);
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const email = (tag: string) => `${tag}-${randomBytes(5).toString('hex')}@example.test`;
const one = async <T = string>(client: pg.Client, sql: string, params: unknown[] = []) =>
  (await client.query(sql, params)).rows[0] as Record<string, T>;

async function identity() {
  return (await one(a, `INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [email('lock')]))
    .id!;
}
async function merchant() {
  const s = await one(a, `SELECT * FROM identity.signup_merchant_owner($1, $2, $3)`, [
    email('owner'),
    '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x',
    `Lock Helper ${randomBytes(3).toString('hex')}`,
  ]);
  const m = await one(a, `SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  return { merchantId: s.merchant_id!, ownerMembershipId: m.id! };
}

type Table = { helper: string; table: string; rows: () => Promise<string[]> };

/** Three committed rows of each helper's table, sorted as PostgreSQL orders uuids. */
const TABLES: Table[] = [
  {
    helper: 'identity.lock_platform_memberships',
    table: 'identity.platform_memberships',
    rows: async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push(
          (
            await one(
              a,
              `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'support') RETURNING id`,
              [await identity()],
            )
          ).id!,
        );
      }
      return ids;
    },
  },
  {
    helper: 'tenancy.lock_merchants',
    table: 'tenancy.merchants',
    rows: async () => [
      (await merchant()).merchantId,
      (await merchant()).merchantId,
      (await merchant()).merchantId,
    ],
  },
  {
    helper: 'tenancy.lock_memberships',
    table: 'tenancy.merchant_memberships',
    rows: async () => {
      const m = await merchant();
      const agent = async () =>
        (
          await one(
            a,
            `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent') RETURNING id`,
            [m.merchantId, await identity()],
          )
        ).id!;
      return [m.ownerMembershipId, await agent(), await agent()];
    },
  },
  {
    helper: 'tenancy.lock_invitations',
    table: 'tenancy.invitations',
    rows: async () => {
      const m = await merchant();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const invitee = await identity();
        ids.push(
          (
            await one(
              a,
              `INSERT INTO tenancy.invitations
                 (merchant_id, email, kind, identity_id, invited_by_membership_id, token_hash, expires_at)
               SELECT $1, i.email, 'agent', i.id, $2, $3, now() + interval '1 hour' FROM identity.identities i WHERE i.id = $4
               RETURNING id`,
              [m.merchantId, m.ownerMembershipId, hash(), invitee],
            )
          ).id!,
        );
      }
      return ids;
    },
  },
  {
    helper: 'identity.lock_one_time_tokens',
    table: 'identity.one_time_tokens',
    rows: async () => {
      const person = await identity();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push(
          (
            await one(
              a,
              `INSERT INTO identity.one_time_tokens (identity_id, purpose, token_hash, expires_at)
               VALUES ($1, 'account_setup', $2, now() + interval '1 hour') RETURNING id`,
              [person, hash()],
            )
          ).id!,
        );
      }
      return ids;
    },
  },
  ...(['roles', 'branches'] as const).map((t): Table => ({
    helper: `tenancy.lock_${t}`,
    table: `tenancy.${t}`,
    rows: async () => {
      const m = await merchant();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push(
          (
            await one(a, `INSERT INTO tenancy.${t} (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
              m.merchantId,
              `Lock ${t} ${i} ${randomBytes(3).toString('hex')}`,
            ])
          ).id!,
        );
      }
      return ids;
    },
  })),
];

const MISSING = '01900000-0000-7000-8000-00000000dead';

describe.each(TABLES)('$helper', ({ helper, table, rows }) => {
  let ids: string[];
  beforeAll(async () => {
    ids = (await rows()).sort();
  });

  const call = (client: pg.Client, share: (string | null)[] | null, nku: (string | null)[] | null) =>
    client.query(`SELECT ${helper}($1::uuid[], $2::uuid[]) AS locked`, [share, nku]);
  /** From connection b, in its own transaction: may this row be locked in this mode right now, without waiting? */
  async function probe(
    id: string,
    mode: 'KEY SHARE' | 'SHARE' | 'NO KEY UPDATE' | 'UPDATE',
  ): Promise<boolean> {
    await b.query('BEGIN');
    try {
      await b.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR ${mode} NOWAIT`, [id]);
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === LOCK_NOT_AVAILABLE) return false;
      throw err;
    } finally {
      await b.query('ROLLBACK');
    }
  }

  it('locks exactly the given rows, each in its mode (never FOR UPDATE), and counts the ones that exist', async () => {
    const [r0, r1, r2] = ids as [string, string, string];
    await a.query('BEGIN');
    try {
      expect((await call(a, [r0], [r1, MISSING])).rows[0].locked).toBe(2);
      // r0 held FOR SHARE: shared with another reader, refused to a writer.
      expect(await probe(r0, 'SHARE')).toBe(true);
      expect(await probe(r0, 'NO KEY UPDATE')).toBe(false);
      // r1 held FOR NO KEY UPDATE: refused to a reader that locks; still open to a foreign-key check (KEY SHARE), which
      // FOR UPDATE would block (L1, L2).
      expect(await probe(r1, 'SHARE')).toBe(false);
      expect(await probe(r1, 'KEY SHARE')).toBe(true);
      // r2 was not given: not locked at all.
      expect(await probe(r2, 'UPDATE')).toBe(true);
    } finally {
      await a.query('ROLLBACK');
    }
  });

  it('collapses duplicates and NULLs, and takes a row given in both arrays FOR NO KEY UPDATE', async () => {
    const [r0] = ids as [string];
    await a.query('BEGIN');
    try {
      expect((await call(a, [r0, r0, null], [r0])).rows[0].locked).toBe(1);
      expect(await probe(r0, 'SHARE')).toBe(false);
      expect(await probe(r0, 'KEY SHARE')).toBe(true);
    } finally {
      await a.query('ROLLBACK');
    }
  });

  it('locks nothing for NULL or empty arrays', async () => {
    await a.query('BEGIN');
    try {
      expect((await call(a, null, [])).rows[0].locked).toBe(0);
      expect(await probe(ids[0]!, 'UPDATE')).toBe(true);
    } finally {
      await a.query('ROLLBACK');
    }
  });

  it('acquires rows in ascending id order, whatever the order it is given (one statement per row)', async () => {
    const [r0, r1, r2] = ids as [string, string, string];
    const aPid = (await one<number>(a, `SELECT pg_backend_pid() AS pid`)).pid!;
    // b blocks the middle row; a, given the rows in descending order, must have taken r0 and be waiting for r1.
    await b.query('BEGIN');
    await b.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE`, [r1]);
    await a.query('BEGIN');
    const pending = call(a, [], [r2, r1, r0]);
    try {
      let waiting = false;
      for (let i = 0; i < 200 && !waiting; i++) {
        waiting =
          (await c.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [aPid])).rowCount! > 0;
        if (!waiting) await new Promise((r) => setTimeout(r, 25));
      }
      expect(waiting, 'the helper never waited for the blocked row').toBe(true);
      const heldByA = async (id: string) => {
        await c.query('BEGIN');
        try {
          await c.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR SHARE NOWAIT`, [id]);
          return false;
        } catch (err) {
          if ((err as { code?: string }).code === LOCK_NOT_AVAILABLE) return true;
          throw err;
        } finally {
          await c.query('ROLLBACK');
        }
      };
      expect(await heldByA(r0)).toBe(true); // the lowest id first
      expect(await heldByA(r2)).toBe(false); // the highest not yet
    } finally {
      await b.query('ROLLBACK');
      expect((await pending).rows[0].locked).toBe(3);
      await a.query('ROLLBACK');
    }
  });
});

describe('the app cannot call them', () => {
  it.each(TABLES)('$helper is refused to alphakolect_app', async ({ helper }) => {
    const app = await connectAs('app');
    try {
      await expectSqlState(app.query(`SELECT ${helper}(NULL::uuid[], NULL::uuid[])`), '42501');
    } finally {
      await app.end();
    }
  });
});
