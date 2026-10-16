import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState } from './support/db.js';

// The platform team's view of the businesses (P5.7; P5 plan §10 P5.7; §7.2 rows #35, #36 and the read-consistency
// guarantees, R25; §8.1; §8.2a rule 7): tenancy.platform_list_merchants and tenancy.platform_list_merchant_members,
// the designated sensitive reads. Each checks platform.merchants.read under the caller's platform-membership lock,
// writes exactly one read event and then returns one page, in one transaction. Called as the API calls them
// (alphakolect_app); effects read as the table owner. The lists are cross-tenant: tests seed their own rows with
// timestamps far in the future, so that they sort first, and look only at their own ids.

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
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
const rid = () => `pl-${randomBytes(6).toString('hex')}`;
const one = async (sql: string, params: unknown[]) => (await owner.query(sql, params)).rows[0];

/** A platform member with a confirmed second factor, its grants, and a full session. */
async function member(role: 'super_admin' | 'support', grants: string[] = []) {
  const identityId = (
    await one(`INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`, [
      email(role),
    ])
  ).id as string;
  const membershipId = (
    await one(`INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, $2) RETURNING id`, [
      identityId,
      role,
    ])
  ).id as string;
  await owner.query(
    `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at)
     VALUES ($1, '\\x00', 'k1', now())`,
    [identityId],
  );
  for (const g of grants)
    await owner.query(
      `INSERT INTO identity.platform_membership_grants (platform_membership_id, permission) VALUES ($1, $2)`,
      [membershipId, g],
    );
  const {
    rows: [s],
  } = await app.query(
    `SELECT * FROM identity.create_session($1, 'platform', $2, 'full', $3, 3600, 43200, NULL, NULL)`,
    [identityId, membershipId, hash()],
  );
  return { identityId, membershipId, session: s.session_id as string };
}

/** A signed-up, verified business owner's merchant session: the wrong audience for a platform read. */
async function merchantOwnerSession() {
  const {
    rows: [s],
  } = await app.query(
    `SELECT * FROM identity.signup_merchant_owner($1, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x', 'Owner Ltd')`,
    [email('owner')],
  );
  const verification = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    verification,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [verification]);
  const membershipId = (
    await one(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [s.identity_id])
  ).id as string;
  const {
    rows: [m],
  } = await app.query(
    `SELECT * FROM identity.create_session($1, 'merchant', $2, 'full', $3, 86400, 1209600, NULL, NULL)`,
    [s.identity_id, membershipId, hash()],
  );
  return m.session_id as string;
}

/**
 * Businesses created at the given times (each with its owner, in one transaction: the one-owner rule). Equal times
 * make a group sharing a timestamp, as one transaction's rows do.
 */
async function seedMerchants(times: string[], c: pg.Client = owner): Promise<string[]> {
  const ids: string[] = [];
  await c.query('BEGIN');
  for (const [k, at] of times.entries()) {
    const merchant = (
      await c.query(
        `INSERT INTO tenancy.merchants (name, status, created_at) VALUES ($1, 'active', $2) RETURNING id`,
        [`List ${k} ${randomBytes(3).toString('hex')}`, at],
      )
    ).rows[0].id as string;
    const identity = (
      await c.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [email('seed-owner')])
    ).rows[0].id as string;
    await c.query(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, created_at) VALUES ($1, $2, 'owner', $3)`,
      [merchant, identity, at],
    );
    ids.push(merchant);
  }
  await c.query('COMMIT');
  return ids;
}

/** Agents of one business, created at the given times. */
async function seedMembers(merchantId: string, times: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const at of times) {
    const identity = (
      await one(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [email('agent')])
    ).id as string;
    ids.push(
      (
        await one(
          `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, created_at) VALUES ($1, $2, 'agent', $3) RETURNING id`,
          [merchantId, identity, at],
        )
      ).id as string,
    );
  }
  return ids;
}

type Row = Record<string, unknown> & { outcome: string; id: string | null; created_at: Date | null };
const merchants = (sessionId: string, limit: number, after: Row | null = null, requestId = rid(), c = app) =>
  c
    .query(
      `SELECT * FROM tenancy.platform_list_merchants($1, $2, $3, $4, '198.51.100.7', 'lists-test', $5)`,
      [sessionId, limit, after?.created_at ?? null, after?.id ?? null, requestId],
    )
    .then((r) => r.rows as Row[]);
const members = (
  sessionId: string,
  merchantId: string,
  limit: number,
  after: Row | null = null,
  requestId = rid(),
  c = app,
) =>
  c
    .query(
      `SELECT * FROM tenancy.platform_list_merchant_members($1, $2, $3, $4, $5, '198.51.100.7', 'lists-test', $6)`,
      [sessionId, merchantId, limit, after?.created_at ?? null, after?.id ?? null, requestId],
    )
    .then((r) => r.rows as Row[]);
const eventsOf = async (requestId: string) =>
  (
    await owner.query(
      `SELECT merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id,
              outcome, ip, user_agent, summary
         FROM audit.audit_events WHERE request_id = $1`,
      [requestId],
    )
  ).rows;

/**
 * Pages through a list from the start until a page holds a row older than `before` (rows of other tests sort after
 * the seeded future), keeping only `mine`. Returns the ids in the order they were returned, and the page count.
 */
async function walk(
  page: (after: Row | null) => Promise<Row[]>,
  limit: number,
  mine: Set<string>,
  before: string,
) {
  const seen: string[] = [];
  let after: Row | null = null;
  for (let pages = 1; pages < 1000; pages++) {
    const rows = await page(after);
    const shown = rows.slice(0, limit);
    seen.push(...shown.map((r) => r.id!).filter((id) => mine.has(id)));
    if (rows.length <= limit || shown.some((r) => r.created_at! < new Date(before))) return seen;
    after = shown.at(-1)!;
  }
  throw new Error('the walk did not end');
}

describe('platform.merchants.read is required, and decided in the database', () => {
  it('without it — staff without the grant, a merchant session, a dead session — one forbidden row, no data, no event', async () => {
    const bare = await member('support');
    const ended = await member('super_admin');
    await app.query(`SELECT identity.revoke_session($1, 'test')`, [ended.session]);
    const [merchantId] = await seedMerchants(['2090-01-01T00:00:00Z']);
    for (const s of [bare.session, ended.session, await merchantOwnerSession()]) {
      const r1 = rid();
      const r2 = rid();
      const listed = await merchants(s, 10, null, r1);
      expect(listed).toEqual([
        { outcome: 'forbidden', id: null, name: null, status: null, created_at: null },
      ]);
      const read = await members(s, merchantId!, 10, null, r2);
      expect(read).toHaveLength(1);
      expect(read[0]).toMatchObject({ outcome: 'forbidden', id: null, email: null });
      expect([...(await eventsOf(r1)), ...(await eventsOf(r2))]).toEqual([]);
    }
  });

  it('with it: the page, and exactly one read event, written in the transaction that returns the rows (#35)', async () => {
    const reader = await member('support', ['platform.merchants.read']);
    const ids = await seedMerchants(['2091-01-01T00:00:00Z', '2091-01-02T00:00:00Z']);
    const r1 = rid();
    const rows = await merchants(reader.session, 2, null, r1);
    expect(rows.slice(0, 2).map((r) => r.id)).toEqual([ids[1], ids[0]]);
    expect(rows.every((r) => r.outcome === 'ok')).toBe(true);
    expect(await eventsOf(r1)).toEqual([
      {
        merchant_id: null,
        actor_identity_id: reader.identityId,
        actor_audience: 'platform',
        actor_membership_id: reader.membershipId,
        action: 'platform.merchant_list_read',
        target_type: null,
        target_id: null,
        outcome: 'success',
        ip: '198.51.100.7',
        user_agent: 'lists-test',
        summary: { limit: 2, continued: false },
      },
    ]);
    // The same transaction: rolled back with the read, the event is gone too.
    const r2 = rid();
    await app.query('BEGIN');
    expect((await merchants(reader.session, 1, rows[1]!, r2)).length).toBeGreaterThan(0);
    expect(await eventsOf(r2)).toEqual([]); // not visible to another connection before the commit
    await app.query('ROLLBACK');
    expect(await eventsOf(r2)).toEqual([]);
    // A continuation is its own read, with its own event.
    const r3 = rid();
    await merchants(reader.session, 1, rows[1]!, r3);
    expect((await eventsOf(r3)).map((e) => e.summary)).toEqual([{ limit: 1, continued: true }]);
  });

  it('a business’s members: recorded against that business (#36); a business that does not exist is not found, unrecorded', async () => {
    const reader = await member('support', ['platform.merchants.read']);
    const [merchantId] = await seedMerchants(['2092-01-01T00:00:00Z']);
    const agents = await seedMembers(merchantId!, ['2092-02-01T00:00:00Z', '2092-03-01T00:00:00Z']);
    const ownerMembership = (
      await one(`SELECT id FROM tenancy.merchant_memberships WHERE merchant_id = $1 AND kind = 'owner'`, [
        merchantId,
      ])
    ).id as string;
    const r1 = rid();
    const rows = await members(reader.session, merchantId!, 10, null, r1);
    // Every kind, newest first, this business only.
    expect(rows.map((r) => [r.id, r.kind])).toEqual([
      [agents[1], 'agent'],
      [agents[0], 'agent'],
      [ownerMembership, 'owner'],
    ]);
    expect(await eventsOf(r1)).toEqual([
      expect.objectContaining({
        merchant_id: merchantId,
        actor_membership_id: reader.membershipId,
        action: 'platform.merchant_members_read',
        target_type: 'merchant',
        target_id: merchantId,
        outcome: 'success',
        summary: { limit: 10, continued: false },
      }),
    ]);
    const r2 = rid();
    const missing = await members(reader.session, '01900000-0000-7000-8000-0000000000b1', 10, null, r2);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ outcome: 'not_found', id: null });
    expect(await eventsOf(r2)).toEqual([]);
  });

  it('the super admin holds it; a page size out of range or half a cursor raises', async () => {
    const admin = await member('super_admin');
    expect((await merchants(admin.session, 1))[0]!.outcome).toBe('ok');
    for (const limit of [0, 101]) await expectSqlState(merchants(admin.session, limit), '22023');
    await expectSqlState(
      app.query(`SELECT * FROM tenancy.platform_list_merchants($1, 10, now(), NULL)`, [admin.session]),
      '22023',
    );
  });

  it('if the read event cannot be written, the call fails and returns no row (§8.2a rule 7)', async () => {
    const reader = await member('support', ['platform.merchants.read']);
    const [merchantId] = await seedMerchants(['2093-01-01T00:00:00Z']);
    for (const [action, run] of [
      ['platform.merchant_list_read', (r: string) => merchants(reader.session, 5, null, r)],
      ['platform.merchant_members_read', (r: string) => members(reader.session, merchantId!, 5, null, r)],
    ] as const) {
      const r = rid();
      const name = `test_fail_${randomBytes(6).toString('hex')}`;
      await owner.query(
        `CREATE FUNCTION audit.${name}() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW.action = '${action}' AND NEW.request_id = '${r}' THEN
             RAISE EXCEPTION 'injected audit storage failure' USING ERRCODE = 'XX000';
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await owner.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.${name}()`,
      );
      try {
        await expectSqlState(run(r), 'XX000');
      } finally {
        await owner.query(`DROP TRIGGER ${name} ON audit.audit_events`);
        await owner.query(`DROP FUNCTION audit.${name}()`);
      }
      expect(await eventsOf(r)).toEqual([]);
    }
  });
});

describe('pages: newest first by (created_at, id), each one statement (§7.2, §8.5)', () => {
  it('a page boundary inside a group sharing a timestamp loses and repeats nothing', async () => {
    const reader = await member('super_admin');
    const at = '2094-01-01T00:00:00Z';
    const group = await seedMerchants([at, at, at, at, at]);
    const expected = [...group].sort().reverse(); // equal timestamps: id descending
    for (const limit of [1, 2, 3]) {
      const seen = await walk((after) => merchants(reader.session, limit, after), limit, new Set(group), at);
      expect(seen, `limit ${limit}`).toEqual(expected);
    }
    // The same for one business's members.
    const [merchantId] = await seedMerchants(['2094-02-01T00:00:00Z']);
    const agentAt = '2094-03-01T00:00:00Z';
    const agents = await seedMembers(merchantId!, [agentAt, agentAt, agentAt, agentAt]);
    for (const limit of [1, 3]) {
      const seen = await walk(
        (after) => members(reader.session, merchantId!, limit, after),
        limit,
        new Set(agents),
        agentAt,
      );
      expect(seen, `members, limit ${limit}`).toEqual([...agents].sort().reverse());
    }
  });
});

// The read-consistency guarantees (§7.2, R25): authority is frozen by the lock, the contents of the list are not.
describe('read consistency, with a second connection (§7.2 tests (a)–(c))', () => {
  it('(a) an uncommitted insert and an uncommitted update: the read does not wait, omits the insert, shows the committed row', async () => {
    const reader = await member('support', ['platform.merchants.read']);
    const [listed] = await seedMerchants(['2095-01-01T00:00:00Z']);
    const before = (await one(`SELECT name FROM tenancy.merchants WHERE id = $1`, [listed])).name as string;
    const [business] = await seedMerchants(['2095-01-02T00:00:00Z']);
    const [agent] = await seedMembers(business!, ['2095-02-01T00:00:00Z']);
    await other.query('BEGIN');
    try {
      const pending = (
        await other.query(
          `INSERT INTO tenancy.merchants (name, status, created_at) VALUES ('Uncommitted', 'active', '2095-06-01T00:00:00Z') RETURNING id`,
        )
      ).rows[0].id as string;
      await other.query(`UPDATE tenancy.merchants SET name = 'Renamed, uncommitted' WHERE id = $1`, [listed]);
      const identity = (
        await other.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
          email('pending'),
        ])
      ).rows[0].id as string;
      const pendingMember = (
        await other.query(
          `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, created_at) VALUES ($1, $2, 'agent', '2095-06-01T00:00:00Z') RETURNING id`,
          [business, identity],
        )
      ).rows[0].id as string;
      await other.query(
        `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
        [agent],
      );

      // Neither read waits for the other connection's row locks: a wait would trip the statement timeout.
      await app.query(`SET statement_timeout = '3s'`);
      const page = await merchants(reader.session, 10);
      expect(page.map((r) => r.id)).not.toContain(pending);
      expect(page.find((r) => r.id === listed)?.name).toBe(before);
      const memberPage = await members(reader.session, business!, 10);
      expect(memberPage.map((r) => r.id)).not.toContain(pendingMember);
      expect(memberPage.find((r) => r.id === agent)?.status).toBe('active');
    } finally {
      await app.query(`SET statement_timeout = 0`);
      await other.query('ROLLBACK');
    }
  });

  it('(b) committed between two pages: an older key appears on a later page, a newer one on none, nothing repeats', async () => {
    const reader = await member('support', ['platform.merchants.read']);
    const seeded = await seedMerchants([
      '2096-01-04T00:00:00Z',
      '2096-01-03T00:00:00Z',
      '2096-01-02T00:00:00Z',
      '2096-01-01T00:00:00Z',
    ]);
    const mine = new Set(seeded);
    const first = await merchants(reader.session, 2);
    expect(first.slice(0, 2).map((r) => r.id)).toEqual([seeded[0], seeded[1]]);
    // Committed now: one older than the cursor (between the 2nd and 3rd), one newer than the first page's first row.
    const [older] = await seedMerchants(['2096-01-02T12:00:00Z']);
    const [newer] = await seedMerchants(['2096-02-01T00:00:00Z']);
    mine.add(older!).add(newer!);
    const rest = await walk(
      (after) => merchants(reader.session, 2, after ?? first[1]!),
      2,
      mine,
      '2096-01-01T00:00:00Z',
    );
    expect(rest).toEqual([older, seeded[2], seeded[3]]);
    expect(rest).not.toContain(newer);
    expect(new Set([...first.slice(0, 2).map((r) => r.id), ...rest]).size).toBe(5);
  });

  it('(c) a member’s status changed between two pages: each row once, as it was when its page was read', async () => {
    const reader = await member('support', ['platform.merchants.read']);
    const [business] = await seedMerchants(['2097-01-01T00:00:00Z']);
    const [a, b, c] = await seedMembers(business!, [
      '2097-03-03T00:00:00Z',
      '2097-03-02T00:00:00Z',
      '2097-03-01T00:00:00Z',
    ]);
    const first = await members(reader.session, business!, 2);
    expect(first.slice(0, 2).map((r) => [r.id, r.status])).toEqual([
      [a, 'active'],
      [b, 'active'],
    ]);
    // Between the pages: a row already returned and a row still to come both change.
    for (const id of [a, c])
      await owner.query(
        `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
        [id],
      );
    const second = await members(reader.session, business!, 2, first[1]!);
    const ownerRow = (
      await one(`SELECT id FROM tenancy.merchant_memberships WHERE merchant_id = $1 AND kind = 'owner'`, [
        business,
      ])
    ).id as string;
    expect(second.map((r) => [r.id, r.status])).toEqual([
      [c, 'deactivated'],
      [ownerRow, 'active'],
    ]);
  });
});
