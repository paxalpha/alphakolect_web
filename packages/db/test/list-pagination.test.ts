import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState } from './support/db.js';

// O9 (decided by the owner, 2026-10-11; P5 plan §10 P5.8): cursor pagination of the members and invitations lists.
// tenancy.list_members (oldest first) and tenancy.list_invitations (newest first; open — pending and unexpired — or
// all) take an optional page and return one row more than it when another follows; with no page they return every row
// as before, so an older application version keeps working. Both stay merchant-scoped lock-free readers: the business
// comes from the session alone (R19), whatever position a cursor carries. Called as the API calls them
// (alphakolect_app); rows seeded and changed as the table owner.

let app: pg.Client;
let owner: pg.Client;
let other: pg.Client; // a second connection: concurrent, uncommitted changes
beforeAll(async () => {
  [app, owner, other] = await Promise.all([connectAs('app'), connectAs('migrator'), connectAs('migrator')]);
});
afterAll(async () => {
  await Promise.all([app.end(), owner.end(), other.end()]);
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
const one = async (sql: string, params: unknown[]) => (await owner.query(sql, params)).rows[0];

/** A signed-up, verified business: its id, its owner's membership and the owner's merchant session. */
async function business() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Pages Ltd')`, [
    email('owner'),
    ARGON,
  ]);
  const verification = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    verification,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [verification]);
  const ownerMembership = (
    await one(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [s.identity_id])
  ).id as string;
  const {
    rows: [m],
  } = await app.query(
    `SELECT * FROM identity.create_session($1, 'merchant', $2, 'full', $3, 86400, 1209600, NULL, NULL)`,
    [s.identity_id, ownerMembership, hash()],
  );
  return { merchantId: s.merchant_id as string, ownerMembership, session: m.session_id as string };
}
type Business = Awaited<ReturnType<typeof business>>;

/** Agents of a business, created at the given times. */
async function agents(b: Business, times: string[]) {
  const ids: string[] = [];
  for (const at of times) {
    const identity = (
      await one(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [email('agent')])
    ).id;
    ids.push(
      (
        await one(
          `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, created_at) VALUES ($1, $2, 'agent', $3) RETURNING id`,
          [b.merchantId, identity, at],
        )
      ).id as string,
    );
  }
  return ids;
}

/** Invitations of a business, created at the given times, each with its state. */
async function invitations(b: Business, specs: { at: string; state: 'open' | 'revoked' | 'expired' }[]) {
  const ids: string[] = [];
  for (const { at, state } of specs) {
    const to = email('invitee');
    const identity = (await one(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [to])).id;
    ids.push(
      (
        await one(
          `INSERT INTO tenancy.invitations
             (merchant_id, email, kind, identity_id, invited_by_membership_id, token_hash, created_at, expires_at, revoked_at)
           VALUES ($1, $2, 'agent', $3, $4, $5, $6::timestamptz,
                   CASE WHEN $7 = 'expired' THEN $6::timestamptz + interval '1 hour' ELSE now() + interval '1 day' END,
                   CASE WHEN $7 = 'revoked' THEN $6::timestamptz + interval '1 minute' END)
           RETURNING id`,
          [b.merchantId, to, identity, b.ownerMembership, hash(), at, state],
        )
      ).id as string,
    );
  }
  return ids;
}

/** A row with its position in microseconds, as the API reads it: a JavaScript Date keeps only milliseconds. */
type Row = { id?: string; membership_id?: string; created_at: Date; position_at?: string } & Record<
  string,
  unknown
>;
const POSITION = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS position_at`;
const positionOf = (r: Row | null) => r?.position_at ?? r?.created_at ?? null;
const members = (s: string, limit: number | null, after: Row | null = null, c = app) =>
  c
    .query(`SELECT *, ${POSITION} FROM tenancy.list_members($1, NULL, $2, $3, $4)`, [
      s,
      limit,
      positionOf(after),
      after?.membership_id ?? null,
    ])
    .then((r) => r.rows as Row[]);
const invites = (s: string, status: string, limit: number | null, after: Row | null = null, c = app) =>
  c
    .query(`SELECT *, ${POSITION} FROM tenancy.list_invitations($1, NULL, $2, $3, $4, $5)`, [
      s,
      status,
      limit,
      positionOf(after),
      after?.id ?? null,
    ])
    .then((r) => r.rows as Row[]);

/** Every page of a list, in order, joined. */
async function walk(page: (after: Row | null) => Promise<Row[]>, limit: number) {
  const seen: Row[] = [];
  let after: Row | null = null;
  for (let n = 0; n < 1000; n++) {
    const rows = await page(after);
    seen.push(...rows.slice(0, limit));
    if (rows.length <= limit) return seen;
    after = rows[limit - 1]!;
  }
  throw new Error('the walk did not end');
}

describe('the members, oldest first', () => {
  it('pages join into the whole list, a group sharing a timestamp split across pages losing and repeating nothing', async () => {
    const b = await business();
    const at = '2030-01-01T00:00:00Z';
    const group = await agents(b, [at, at, at, at, '2030-02-01T00:00:00Z']);
    const whole = (await members(b.session, null)).map((r) => r.membership_id);
    expect(whole).toEqual([b.ownerMembership, ...[...group.slice(0, 4)].sort(), group[4]]);
    for (const limit of [1, 2, 3]) {
      const joined = (await walk((after) => members(b.session, limit, after), limit)).map(
        (r) => r.membership_id,
      );
      expect(joined, `limit ${limit}`).toEqual(whole);
    }
    // One row more than the page when another follows; exactly the rest at the end.
    expect(await members(b.session, 2)).toHaveLength(3);
    expect(await members(b.session, 6)).toHaveLength(6);
  });

  it('an older application’s call, with no page, still returns every member; one member by id too', async () => {
    const b = await business();
    const [agent] = await agents(b, ['2030-03-01T00:00:00Z']);
    const { rows: all } = await app.query(`SELECT * FROM tenancy.list_members($1, NULL)`, [b.session]);
    expect(all.map((r) => r.membership_id)).toEqual([b.ownerMembership, agent]);
    const { rows: oneMember } = await app.query(`SELECT * FROM tenancy.list_members($1, $2)`, [
      b.session,
      agent,
    ]);
    expect(oneMember.map((r) => r.membership_id)).toEqual([agent]);
  });

  it('a position from another business moves within this business only (R19); bad pages raise', async () => {
    const a = await business();
    const b = await business();
    const [theirs] = await agents(b, ['2030-04-01T00:00:00Z']);
    const position = { membership_id: theirs!, created_at: new Date('2030-04-01T00:00:00Z') } as Row;
    // Before B's member's position: A's owner (created now, later) is not before it; nothing of B's appears.
    const rows = await members(a.session, 10, { ...position, created_at: new Date('1999-01-01T00:00:00Z') });
    expect(rows.map((r) => r.membership_id)).toEqual([a.ownerMembership]);
    expect(await members(a.session, 10, position)).toEqual([]);
    for (const limit of [0, 101]) await expectSqlState(members(a.session, limit), '22023');
    await expectSqlState(
      app.query(`SELECT * FROM tenancy.list_members($1, NULL, 10, now(), NULL)`, [a.session]),
      '22023',
    );
  });
});

describe('the invitations, newest first: open or all', () => {
  it('open is pending and unexpired; all is every one; each paginated, losing and repeating nothing', async () => {
    const b = await business();
    const ids = await invitations(b, [
      { at: '2020-05-05T00:00:00Z', state: 'open' },
      { at: '2020-05-04T00:00:00Z', state: 'revoked' },
      { at: '2020-05-03T00:00:00Z', state: 'open' },
      { at: '2020-05-03T00:00:00Z', state: 'open' },
      { at: '2020-05-02T00:00:00Z', state: 'expired' },
      { at: '2020-05-01T00:00:00Z', state: 'open' },
    ]);
    const tie = [ids[2]!, ids[3]!].sort().reverse();
    const open = [ids[0], ...tie, ids[5]];
    const all = [ids[0], ids[1], ...tie, ids[4], ids[5]];
    expect((await invites(b.session, 'open', null)).map((r) => r.id)).toEqual(open);
    expect((await invites(b.session, 'all', null)).map((r) => r.id)).toEqual(all);
    for (const limit of [1, 2, 3]) {
      expect(
        (await walk((after) => invites(b.session, 'open', limit, after), limit)).map((r) => r.id),
      ).toEqual(open);
      expect(
        (await walk((after) => invites(b.session, 'all', limit, after), limit)).map((r) => r.id),
      ).toEqual(all);
    }
  });

  it('an older application’s call returns every invitation (status all by default); an unknown status raises', async () => {
    const b = await business();
    const ids = await invitations(b, [
      { at: '2020-06-02T00:00:00Z', state: 'revoked' },
      { at: '2020-06-01T00:00:00Z', state: 'open' },
    ]);
    const { rows } = await app.query(`SELECT * FROM tenancy.list_invitations($1, NULL)`, [b.session]);
    expect(rows.map((r) => r.id)).toEqual(ids);
    await expectSqlState(invites(b.session, 'pending', 10), '22023');
    for (const limit of [0, 101]) await expectSqlState(invites(b.session, 'all', limit), '22023');
  });
});

// The read-consistency guarantees (§7.2, R25) for the two lists. Both are lock-free readers: authority and rows come
// from one statement's snapshot, so a concurrent change is either wholly seen or not at all, and nothing waits.
describe('read consistency, with a second connection (§7.2 tests (a)–(c))', () => {
  it('(a) uncommitted inserts and updates: neither list waits; each omits the insert and shows the committed row', async () => {
    const b = await business();
    const [agent] = await agents(b, ['2030-07-01T00:00:00Z']);
    const [invitation] = await invitations(b, [{ at: '2020-07-01T00:00:00Z', state: 'open' }]);
    await other.query('BEGIN');
    try {
      const identity = (
        await other.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [email('p')])
      ).rows[0].id;
      const pending = (
        await other.query(
          `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent') RETURNING id`,
          [b.merchantId, identity],
        )
      ).rows[0].id;
      await other.query(
        `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
        [agent],
      );
      await other.query(`UPDATE tenancy.invitations SET revoked_at = now() WHERE id = $1`, [invitation]);
      await app.query(`SET statement_timeout = '3s'`);
      const listed = await members(b.session, 10);
      expect(listed.map((r) => r.membership_id)).not.toContain(pending);
      expect(listed.find((r) => r.membership_id === agent)?.status).toBe('active');
      expect((await invites(b.session, 'open', 10)).map((r) => r.id)).toEqual([invitation]);
    } finally {
      await app.query(`SET statement_timeout = 0`);
      await other.query('ROLLBACK');
    }
  });

  it('(b) committed between two pages: an older key appears on the later page, a newer one on none; nothing repeats', async () => {
    const b = await business();
    const ids = await invitations(b, [
      { at: '2020-08-04T00:00:00Z', state: 'open' },
      { at: '2020-08-03T00:00:00Z', state: 'open' },
      { at: '2020-08-01T00:00:00Z', state: 'open' },
    ]);
    const first = await invites(b.session, 'open', 2);
    expect(first.slice(0, 2).map((r) => r.id)).toEqual([ids[0], ids[1]]);
    const [older] = await invitations(b, [{ at: '2020-08-02T00:00:00Z', state: 'open' }]);
    const [newer] = await invitations(b, [{ at: '2020-09-01T00:00:00Z', state: 'open' }]);
    const rest = await walk((after) => invites(b.session, 'open', 2, after ?? first[1]!), 2);
    expect(rest.map((r) => r.id)).toEqual([older, ids[2]]);
    expect(rest.map((r) => r.id)).not.toContain(newer);
  });

  it('(c) a member’s status changed between two pages: each row once, as it was when its page was read', async () => {
    const b = await business();
    const [x, y, z] = await agents(b, [
      '2030-10-01T00:00:00Z',
      '2030-10-02T00:00:00Z',
      '2030-10-03T00:00:00Z',
    ]);
    const first = await members(b.session, 2);
    expect(first.slice(0, 2).map((r) => [r.membership_id, r.status])).toEqual([
      [b.ownerMembership, 'active'],
      [x, 'active'],
    ]);
    for (const id of [x, z])
      await owner.query(
        `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
        [id],
      );
    const second = await members(b.session, 2, first[1]!);
    expect(second.map((r) => [r.membership_id, r.status])).toEqual([
      [y, 'active'],
      [z, 'deactivated'],
    ]);
  });
});
