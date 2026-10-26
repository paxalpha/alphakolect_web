import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// The activity-record reads (P5.8; ADR-16 §3.5 "Addendum — the activity-record reads", confirmed 2026-10-19; P5 plan
// §8.5): audit.read_merchant_events (#33) and audit.read_platform_events (#34), called as the API calls them
// (alphakolect_app), effects read as the table owner. Every test reads its own window far in the future, so the rows
// it seeds are the only ones there — except the concurrent purge's, which needs rows past their two years.

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
const email = (tag: string) => `${tag}-${randomBytes(4).toString('hex')}@example.test`;
const rid = () => `ar-${randomBytes(6).toString('hex')}`;
const one = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0];
const session = async (identityId: string, audience: string, membershipId: string) =>
  (
    await app.query(
      `SELECT * FROM identity.create_session($1, $2, $3, 'full', $4, 3600, 43200, NULL, NULL)`,
      [identityId, audience, membershipId, hash()],
    )
  ).rows[0].session_id as string;

/** A verified owner's business, with its owner's session and a staff member (no grants) with theirs. */
async function business() {
  const s = (
    await app.query(
      `SELECT * FROM identity.signup_merchant_owner($1, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x', 'Reads Ltd')`,
      [email('owner')],
    )
  ).rows[0];
  const verification = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    verification,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [verification]);
  const m = await one(`SELECT id, merchant_id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  const staffIdentity = (
    await one(`INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`, [
      email('staff'),
    ])
  ).id as string;
  const role = (
    await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
      m.merchant_id,
      `Role ${randomBytes(3).toString('hex')}`,
    ])
  ).id as string;
  const staff = (
    await one(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, 'staff', $3) RETURNING id`,
      [m.merchant_id, staffIdentity, role],
    )
  ).id as string;
  return {
    merchantId: m.merchant_id as string,
    ownerIdentity: s.identity_id as string,
    ownerMembership: m.id as string,
    ownerSession: await session(s.identity_id, 'merchant', m.id),
    staffIdentity,
    staff,
    staffSession: await session(staffIdentity, 'merchant', staff),
  };
}

/** A platform member with a confirmed second factor and a full session. */
async function platformMember(role: 'super_admin' | 'support', grants: string[] = []) {
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
  return { identityId, membershipId, session: await session(identityId, 'platform', membershipId) };
}

/** A window of its own, years ahead: [from, from + 10 days). A year is drawn at most once per run, so two windows
 * never share events (two draws of one year made the platform read flaky). */
const usedYears = new Set<number>();
const windowAt = () => {
  let year: number;
  do year = 2090 + Math.floor(Math.random() * 400);
  while (usedYears.has(year));
  usedYears.add(year);
  const from = new Date(Date.UTC(year, 0, 1));
  return {
    from: from.toISOString(),
    to: new Date(from.getTime() + 10 * 86_400_000).toISOString(),
    base: from,
  };
};
const at = (base: Date, hours: number) => new Date(base.getTime() + hours * 3_600_000).toISOString();

type Event = {
  occurredAt: string;
  merchantId?: string | null;
  actorIdentity?: string | null;
  audience?: string | null;
  membership?: string | null;
  action?: string;
  outcome?: string;
};
async function event(e: Event): Promise<string> {
  return (
    await one(
      `INSERT INTO audit.audit_events (occurred_at, merchant_id, actor_identity_id, actor_audience, actor_membership_id,
                                       action, outcome, ip, user_agent, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '198.51.100.20', 'reads-agent', '{}') RETURNING id`,
      [
        e.occurredAt,
        e.merchantId ?? null,
        e.actorIdentity ?? null,
        e.audience ?? null,
        e.membership ?? null,
        e.action ?? 'auth.logout',
        e.outcome ?? 'success',
      ],
    )
  ).id;
}

type Row = Record<string, unknown> & { outcome: string; id: string | null; position_at: string | null };
const readMerchant = (
  sessionId: string,
  w: { from: string; to: string },
  limit = 100,
  after: Row | null = null,
  membershipId: string | null = null,
  requestId = rid(),
) =>
  app
    .query<Row>(
      `SELECT * FROM audit.read_merchant_events($1, $2, $3, $4, $5, $6, $7, '203.0.113.5', 'reader-agent', $8)`,
      [
        sessionId,
        w.from,
        w.to,
        limit,
        after?.position_at ?? null,
        after?.id ?? null,
        membershipId,
        requestId,
      ],
    )
    .then((r) => r.rows);
const readPlatform = (
  sessionId: string,
  w: { from: string; to: string },
  filters: { merchantId?: string; membershipId?: string; event?: string } = {},
  limit = 100,
  after: Row | null = null,
  requestId = rid(),
) =>
  app
    .query<Row>(
      `SELECT * FROM audit.read_platform_events($1, $2, $3, $4, $5, $6, $7, $8, $9, '203.0.113.6', 'reader-agent', $10)`,
      [
        sessionId,
        w.from,
        w.to,
        limit,
        after?.position_at ?? null,
        after?.id ?? null,
        filters.merchantId ?? null,
        filters.membershipId ?? null,
        filters.event ?? null,
        requestId,
      ],
    )
    .then((r) => r.rows);
const eventsOf = (requestId: string) =>
  owner
    .query(
      `SELECT merchant_id, actor_identity_id, actor_audience, action, outcome, target_type, target_id, summary
         FROM audit.audit_events WHERE request_id = $1`,
      [requestId],
    )
    .then((r) => r.rows);

describe('the merchant read (#33)', () => {
  it('the owner sees the business’s events only, newest first; the platform team unnamed; one read event first', async () => {
    const b = await business();
    const other = await business();
    const staffTeam = await platformMember('support');
    const w = windowAt();
    const mine = await event({
      occurredAt: at(w.base, 3),
      merchantId: b.merchantId,
      actorIdentity: b.staffIdentity,
      audience: 'merchant',
      membership: b.staff,
      action: 'authz.denied',
      outcome: 'denied',
    });
    const team = await event({
      occurredAt: at(w.base, 2),
      merchantId: b.merchantId,
      actorIdentity: staffTeam.identityId,
      audience: 'platform',
      membership: staffTeam.membershipId,
    });
    const teamNoAudience = await event({
      occurredAt: at(w.base, 2),
      merchantId: b.merchantId,
      actorIdentity: staffTeam.identityId,
    });
    const acceptance = await event({
      occurredAt: at(w.base, 1),
      merchantId: b.merchantId,
      actorIdentity: b.staffIdentity,
      membership: b.staff,
    });
    const noActor = await event({ occurredAt: at(w.base, 1), merchantId: b.merchantId });
    await event({
      occurredAt: at(w.base, 4),
      merchantId: other.merchantId,
      actorIdentity: other.ownerIdentity,
    });
    await event({ occurredAt: at(w.base, 4), merchantId: null, actorIdentity: staffTeam.identityId });
    await event({ occurredAt: at(w.base, 300), merchantId: b.merchantId }); // after the window

    const requestId = rid();
    const rows = await readMerchant(b.ownerSession, w, 100, null, null, requestId);
    expect(rows.every((r) => r.outcome === 'ok')).toBe(true);
    const [sameTimeFirst, sameTimeSecond] = [team, teamNoAudience].sort().reverse();
    const [lastA, lastB] = [acceptance, noActor].sort().reverse();
    expect(rows.map((r) => r.id)).toEqual([mine, sameTimeFirst, sameTimeSecond, lastA, lastB]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(mine)).toMatchObject({
      event_outcome: 'denied',
      has_actor: true,
      actor_audience: 'merchant',
      actor_membership_id: b.staff,
      actor_label: null,
      ip: '198.51.100.20',
      user_agent: 'reads-agent',
    });
    expect(byId.get(mine)!.actor_email).toMatch(/^staff-/);
    for (const id of [team, teamNoAudience])
      expect(byId.get(id)).toMatchObject({
        has_actor: true,
        actor_audience: id === team ? 'platform' : null, // as recorded: the label never replaces it
        actor_membership_id: null,
        actor_email: null,
        actor_label: 'AlphaKolect team',
        ip: null,
        user_agent: null,
      });
    expect(byId.get(acceptance)).toMatchObject({
      has_actor: true,
      actor_audience: null,
      actor_membership_id: b.staff,
    });
    expect(byId.get(noActor)).toMatchObject({ has_actor: false, actor_label: null });
    // The read is in the business's own record, with the window and the page.
    const recorded = await eventsOf(requestId);
    expect(recorded).toEqual([
      {
        merchant_id: b.merchantId,
        actor_identity_id: b.ownerIdentity,
        actor_audience: 'merchant',
        action: 'merchant.audit_read',
        outcome: 'success',
        target_type: null,
        target_id: null,
        summary: {
          from: w.from.replace('.000Z', '.000000Z'),
          to: w.to.replace('.000Z', '.000000Z'),
          limit: 100,
          continued: false,
          membershipId: null,
        },
      },
    ]);
  });

  it('pages newest first, exactly once across pages; a cursor outside the window and a window over 31 days refused', async () => {
    const b = await business();
    const w = windowAt();
    const ids: string[] = [];
    for (let k = 0; k < 5; k++)
      ids.push(await event({ occurredAt: at(w.base, 5), merchantId: b.merchantId })); // one timestamp
    for (let k = 0; k < 3; k++)
      ids.push(await event({ occurredAt: at(w.base, k), merchantId: b.merchantId }));
    const seen: string[] = [];
    let after: Row | null = null;
    for (;;) {
      const rows = await readMerchant(b.ownerSession, w, 3, after);
      seen.push(...rows.slice(0, 3).map((r) => r.id!));
      if (rows.length <= 3) break;
      after = rows[2]!;
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
    expect(seen.slice(0, 5)).toEqual(ids.slice(0, 5).sort().reverse());
    const outside = { ...after!, position_at: at(w.base, 300).replace('.000Z', '.000000Z') };
    await expectSqlState(readMerchant(b.ownerSession, w, 3, outside), '22023');
    await expectSqlState(
      readMerchant(b.ownerSession, { from: w.from, to: at(w.base, 744 + 0.001) }),
      '22023',
    );
    expect((await readMerchant(b.ownerSession, { from: w.from, to: at(w.base, 744) })).length).toBe(8);
    await expectSqlState(readMerchant(b.ownerSession, w, 101), '22023');
  });

  it('by person: a member of the business, any status; another business’s member is not found and nothing is read', async () => {
    const b = await business();
    const other = await business();
    const w = windowAt();
    const staffEvent = await event({
      occurredAt: at(w.base, 1),
      merchantId: b.merchantId,
      actorIdentity: b.staffIdentity,
    });
    await event({ occurredAt: at(w.base, 2), merchantId: b.merchantId, actorIdentity: b.ownerIdentity });
    await owner.query(
      `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [b.staff],
    );
    expect((await readMerchant(b.ownerSession, w, 100, null, b.staff)).map((r) => r.id)).toEqual([
      staffEvent,
    ]);
    const requestId = rid();
    const rows = await readMerchant(b.ownerSession, w, 100, null, other.staff, requestId);
    expect(rows).toEqual([expect.objectContaining({ outcome: 'not_found', id: null })]);
    expect(await eventsOf(requestId)).toEqual([]);
  });

  it('refuses staff without the permission, and a platform session, writing nothing', async () => {
    const b = await business();
    const admin = await platformMember('super_admin');
    const w = windowAt();
    for (const s of [b.staffSession, admin.session]) {
      const requestId = rid();
      expect(await readMerchant(s, w, 10, null, null, requestId)).toEqual([
        expect.objectContaining({ outcome: 'forbidden', id: null }),
      ]);
      expect(await eventsOf(requestId)).toEqual([]);
    }
  });

  it('returns no row when its read event cannot be written', async () => {
    const b = await business();
    const w = windowAt();
    await event({ occurredAt: at(w.base, 1), merchantId: b.merchantId });
    const requestId = rid();
    const fn = `test_fail_read_${randomBytes(4).toString('hex')}`;
    await owner.query(
      `CREATE FUNCTION audit.${fn}() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN
         IF NEW.request_id = '${requestId}' THEN RAISE EXCEPTION 'injected' USING ERRCODE = 'XX000'; END IF;
         RETURN NEW;
       END $fn$`,
    );
    await owner.query(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.${fn}()`,
    );
    try {
      await expectSqlState(readMerchant(b.ownerSession, w, 10, null, null, requestId), 'XX000');
    } finally {
      await owner.query(`DROP TRIGGER ${fn} ON audit.audit_events`);
      await owner.query(`DROP FUNCTION audit.${fn}()`);
    }
  });
});

describe('the platform read (#34)', () => {
  it('every business; the address and device to the super admin only; refused without the permission', async () => {
    const a = await business();
    const b = await business();
    const admin = await platformMember('super_admin');
    const reader = await platformMember('support', ['platform.audit.read']);
    const without = await platformMember('support');
    const w = windowAt();
    const e1 = await event({
      occurredAt: at(w.base, 1),
      merchantId: a.merchantId,
      actorIdentity: a.ownerIdentity,
      audience: 'merchant',
      membership: a.ownerMembership,
    });
    const e2 = await event({
      occurredAt: at(w.base, 2),
      merchantId: b.merchantId,
      actorIdentity: b.staffIdentity,
    });
    const e3 = await event({
      occurredAt: at(w.base, 3),
      merchantId: null,
      actorIdentity: reader.identityId,
      audience: 'platform',
      membership: reader.membershipId,
    });
    const asAdmin = await readPlatform(admin.session, w);
    expect(asAdmin.map((r) => r.id)).toEqual([e3, e2, e1]);
    expect(asAdmin.find((r) => r.id === e1)).toMatchObject({
      merchant_id: a.merchantId,
      actor_audience: 'merchant',
      actor_membership_id: a.ownerMembership,
      ip: '198.51.100.20',
      user_agent: 'reads-agent',
    });
    expect(asAdmin.find((r) => r.id === e3)!.actor_email).toMatch(/^support-/);
    const asReader = await readPlatform(reader.session, w);
    expect(asReader.map((r) => r.id)).toEqual([e3, e2, e1]);
    expect(asReader.every((r) => r.ip === null && r.user_agent === null)).toBe(true);
    const requestId = rid();
    expect(await readPlatform(without.session, w, {}, 10, null, requestId)).toEqual([
      expect.objectContaining({ outcome: 'forbidden', id: null }),
    ]);
    expect(await eventsOf(requestId)).toEqual([]);
    expect(await readPlatform(a.ownerSession, w)).toEqual([
      expect.objectContaining({ outcome: 'forbidden' }),
    ]);
  });

  it('filters by business, by person through any membership, by event; the read recorded against the business', async () => {
    const a = await business();
    const b = await business();
    const admin = await platformMember('super_admin');
    const team = await platformMember('support');
    const w = windowAt();
    const inA = await event({
      occurredAt: at(w.base, 1),
      merchantId: a.merchantId,
      actorIdentity: team.identityId,
      action: 'platform.merchant_members_read',
    });
    const inB = await event({
      occurredAt: at(w.base, 2),
      merchantId: b.merchantId,
      actorIdentity: team.identityId,
    });
    const ownerInA = await event({
      occurredAt: at(w.base, 3),
      merchantId: a.merchantId,
      actorIdentity: a.ownerIdentity,
    });
    const requestId = rid();
    expect(
      (await readPlatform(admin.session, w, { merchantId: a.merchantId }, 100, null, requestId)).map(
        (r) => r.id,
      ),
    ).toEqual([ownerInA, inA]);
    expect(await eventsOf(requestId)).toEqual([
      expect.objectContaining({
        merchant_id: a.merchantId,
        action: 'platform.audit_read',
        target_type: 'merchant',
        target_id: a.merchantId,
      }),
    ]);
    expect(
      (await readPlatform(admin.session, w, { membershipId: team.membershipId })).map((r) => r.id),
    ).toEqual([inB, inA]);
    expect(
      (await readPlatform(admin.session, w, { membershipId: a.ownerMembership })).map((r) => r.id),
    ).toEqual([ownerInA]);
    expect(
      (
        await readPlatform(admin.session, w, { merchantId: a.merchantId, membershipId: team.membershipId })
      ).map((r) => r.id),
    ).toEqual([inA]);
    expect(
      (await readPlatform(admin.session, w, { event: 'platform.merchant_members_read' })).map((r) => r.id),
    ).toEqual([inA]);
    const unread = rid();
    expect(await readPlatform(admin.session, w, { event: 'no.such_event' }, 10, null, unread)).toEqual([
      expect.objectContaining({ outcome: 'invalid_event' }),
    ]);
    expect(
      await readPlatform(
        admin.session,
        w,
        { merchantId: '01900000-0000-7000-8000-00000000dead' },
        10,
        null,
        unread,
      ),
    ).toEqual([expect.objectContaining({ outcome: 'not_found' })]);
    expect(
      await readPlatform(
        admin.session,
        w,
        { membershipId: '01900000-0000-7000-8000-00000000dead' },
        10,
        null,
        unread,
      ),
    ).toEqual([expect.objectContaining({ outcome: 'not_found' })]);
    expect(await eventsOf(unread)).toEqual([]);
  });
});

describe('every read through the functions', () => {
  it('the app cannot read the activity table; the reporting role reads it without the address and device', async () => {
    await expectSqlState(
      app.query(`SELECT id FROM audit.audit_events LIMIT 1`),
      SQLSTATE.insufficientPrivilege,
    );
    const readonly = await connectAs('readonly');
    try {
      await readonly.query(`SELECT id, action, summary FROM audit.audit_events LIMIT 1`);
      await expectSqlState(
        readonly.query(`SELECT ip FROM audit.audit_events LIMIT 1`),
        SQLSTATE.insufficientPrivilege,
      );
      await expectSqlState(
        readonly.query(`SELECT user_agent FROM audit.audit_events LIMIT 1`),
        SQLSTATE.insufficientPrivilege,
      );
    } finally {
      await readonly.end();
    }
  });

  it('a recorded audience is merchant, agent, platform or none: any other is refused, whoever writes it', async () => {
    await expectSqlState(
      owner.query(
        `INSERT INTO audit.audit_events (action, outcome, actor_audience, summary) VALUES ('auth.logout', 'success', 'operator', '{}')`,
      ),
      SQLSTATE.checkViolation,
    );
  });
});

// The read-consistency guarantees (§7.2, R25; the concurrent purge, R35): authority is frozen by the reader's lock, the
// record is not. A page is one statement: it never waits for a writer of the record or for the purge, and each row
// committed before the first page and still present when its page is read appears exactly once.
describe('read consistency, with a second connection (exit criterion 7)', () => {
  const ids = (rows: Row[]) => rows.filter((r) => r.outcome === 'ok').map((r) => r.id!);
  const pages = async (sessionId: string, w: { from: string; to: string }, first: Row) => {
    const seen: string[] = [];
    let after: Row | null = first;
    for (;;) {
      const rows = await readMerchant(sessionId, w, 2, after);
      seen.push(...ids(rows.slice(0, 2)));
      if (rows.length <= 2) return seen;
      after = rows[1]!;
    }
  };
  const pagePlatform = async (sessionId: string, w: { from: string; to: string }, first: Row) => {
    const seen: string[] = [];
    let after: Row | null = first;
    for (;;) {
      const rows = await readPlatform(sessionId, w, {}, 2, after);
      seen.push(...ids(rows.slice(0, 2)));
      if (rows.length <= 2) return seen;
      after = rows[1]!;
    }
  };

  it('(a) an uncommitted event: the read does not wait and does not show it', async () => {
    const b = await business();
    const w = windowAt();
    const committed = await event({ occurredAt: at(w.base, 1), merchantId: b.merchantId });
    await other.query('BEGIN');
    try {
      const pending = (
        await other.query(
          `INSERT INTO audit.audit_events (occurred_at, merchant_id, action, outcome, summary)
           VALUES ($1, $2, 'auth.logout', 'success', '{}') RETURNING id`,
          [at(w.base, 2), b.merchantId],
        )
      ).rows[0].id as string;
      await app.query(`SET statement_timeout = '3s'`); // a wait would trip it
      const rows = await readMerchant(b.ownerSession, w);
      expect(ids(rows)).toEqual([committed]);
      expect(ids(rows)).not.toContain(pending);
    } finally {
      await app.query(`SET statement_timeout = 0`);
      await other.query('ROLLBACK');
    }
  });

  it('(a, #34) an uncommitted event: the platform read does not wait or show it', async () => {
    const admin = await platformMember('super_admin');
    const w = windowAt();
    const committed = await event({ occurredAt: at(w.base, 1), merchantId: null });
    await other.query('BEGIN');
    try {
      const pending = (
        await other.query(
          `INSERT INTO audit.audit_events (occurred_at, action, outcome, summary)
           VALUES ($1, 'auth.logout', 'success', '{}') RETURNING id`,
          [at(w.base, 2)],
        )
      ).rows[0].id as string;
      await app.query(`SET statement_timeout = '3s'`);
      const rows = await readPlatform(admin.session, w);
      expect(ids(rows)).toEqual([committed]);
      expect(ids(rows)).not.toContain(pending);
    } finally {
      await app.query(`SET statement_timeout = 0`);
      await other.query('ROLLBACK');
    }
  });

  it('(b) committed between two pages: an older event on a later page, a newer one on none, nothing twice', async () => {
    const b = await business();
    const w = windowAt();
    const seeded = [];
    for (const h of [8, 6, 4, 2])
      seeded.push(await event({ occurredAt: at(w.base, h), merchantId: b.merchantId }));
    const first = await readMerchant(b.ownerSession, w, 2);
    expect(ids(first.slice(0, 2))).toEqual([seeded[0], seeded[1]]);
    const older = await event({ occurredAt: at(w.base, 5), merchantId: b.merchantId });
    const newer = await event({ occurredAt: at(w.base, 9), merchantId: b.merchantId });
    const rest = await pages(b.ownerSession, w, first[1]!);
    expect(rest).toEqual([older, seeded[2], seeded[3]]);
    expect(rest).not.toContain(newer);
  });

  it('(b, #34) the platform read has the same page consistency', async () => {
    const admin = await platformMember('super_admin');
    const w = windowAt();
    const seeded: string[] = [];
    for (const h of [8, 6, 4, 2]) seeded.push(await event({ occurredAt: at(w.base, h), merchantId: null }));
    const first = await readPlatform(admin.session, w, {}, 2);
    expect(ids(first.slice(0, 2))).toEqual(seeded.slice(0, 2));
    const older = await event({ occurredAt: at(w.base, 5), merchantId: null });
    const newer = await event({ occurredAt: at(w.base, 9), merchantId: null });
    const rest = await pagePlatform(admin.session, w, first[1]!);
    expect(rest).toEqual([older, seeded[2], seeded[3]]);
    expect(rest).not.toContain(newer);
  });

  describe('(c) the purge, concurrently (R35)', () => {
    /** A window years back — its events past their two years, so the purge may delete them — and of its own: one of
     * 100 disjoint 11-day slots from 2015 (before other files' old events), each drawn at most once per run, so two
     * windows never share events (overlapping draws in 2022 made the platform read flaky — P8 gate, 2026-10-26). */
    const usedSlots = new Set<number>();
    const pastWindow = () => {
      let slot: number;
      do slot = Math.floor(Math.random() * 100);
      while (usedSlots.has(slot));
      usedSlots.add(slot);
      const from = new Date(Date.UTC(2015, 0, 1) + slot * 11 * 86_400_000);
      return {
        from: from.toISOString(),
        to: new Date(from.getTime() + 10 * 86_400_000).toISOString(),
        base: from,
      };
    };
    type Run = { run_id: string; as_of: string };
    const reserve = (c: pg.Client) =>
      c.query<Run>(`SELECT * FROM audit.reserve_purge_run(now())`).then((r) => r.rows[0]!);

    it('an uncommitted purge page: the read does not wait, and still shows the rows', async () => {
      const b = await business();
      const w = pastWindow();
      const old = [
        await event({ occurredAt: at(w.base, 1), merchantId: b.merchantId }),
        await event({ occurredAt: at(w.base, 2), merchantId: b.merchantId }),
      ];
      await other.query('BEGIN');
      try {
        const run = await reserve(other);
        for (let n = 1; ;) {
          const p = (
            await other.query(`SELECT * FROM audit.purge_candidates($1, $2, $3, 1000)`, [
              run.run_id,
              run.as_of,
              n,
            ])
          ).rows[0];
          if (p.row_count > 0) {
            await other.query(`SELECT audit.purge_expired_events($1, $2, $3)`, [run.run_id, run.as_of, n]);
            n++;
          }
          if (p.exhausted) break;
        }
        expect(
          (await other.query(`SELECT count(*)::int AS n FROM audit.audit_events WHERE id = ANY($1)`, [old]))
            .rows[0].n,
        ).toBe(0);
        await app.query(`SET statement_timeout = '3s'`);
        expect(ids(await readMerchant(b.ownerSession, w)).sort()).toEqual([...old].sort());
      } finally {
        await app.query(`SET statement_timeout = 0`);
        await other.query('ROLLBACK');
      }
    });

    it('( #34 ) an uncommitted purge page does not block the platform read or hide its rows', async () => {
      const admin = await platformMember('super_admin');
      // Filtered by a business of its own: other test files leave old events in the past (2-3 years back).
      const b = await business();
      const w = pastWindow();
      const old = [
        await event({ occurredAt: at(w.base, 1), merchantId: b.merchantId }),
        await event({ occurredAt: at(w.base, 2), merchantId: b.merchantId }),
      ];
      await other.query('BEGIN');
      try {
        const run = await reserve(other);
        for (let n = 1; ;) {
          const p = (
            await other.query(`SELECT * FROM audit.purge_candidates($1, $2, $3, 1000)`, [
              run.run_id,
              run.as_of,
              n,
            ])
          ).rows[0];
          if (p.row_count > 0) {
            await other.query(`SELECT audit.purge_expired_events($1, $2, $3)`, [run.run_id, run.as_of, n]);
            n++;
          }
          if (p.exhausted) break;
        }
        await app.query(`SET statement_timeout = '3s'`);
        expect(ids(await readPlatform(admin.session, w, { merchantId: b.merchantId })).sort()).toEqual(
          [...old].sort(),
        );
      } finally {
        await app.query(`SET statement_timeout = 0`);
        await other.query('ROLLBACK');
      }
    });

    it('a purge page committed between two pages: what it deleted is gone, every remaining row appears once', async () => {
      const b = await business();
      const w = pastWindow();
      const seeded: string[] = []; // newest first
      for (const h of [6, 5, 4, 3, 2, 1])
        seeded.push(await event({ occurredAt: at(w.base, h), merchantId: b.merchantId }));
      const first = await readMerchant(b.ownerSession, w, 2);
      expect(ids(first.slice(0, 2))).toEqual(seeded.slice(0, 2));
      // A plain run whose first pages delete the two oldest of these rows (and any other row past its two years that
      // sorts before them); the rest of the run is released unfinished.
      const run = await reserve(owner);
      const deleted: string[] = [];
      for (let n = 1; !deleted.includes(seeded[4]!) || !deleted.includes(seeded[5]!);) {
        const p = (
          await owner.query(`SELECT * FROM audit.purge_candidates($1, $2, $3, 1)`, [run.run_id, run.as_of, n])
        ).rows[0];
        expect(p.exhausted && p.row_count === 0, 'the purge reached its end before these rows').toBe(false);
        if (p.row_count > 0) {
          await owner.query(`SELECT audit.purge_expired_events($1, $2, $3)`, [run.run_id, run.as_of, n]);
          deleted.push(...(p.event_ids as string[]));
          n++;
        }
      }
      await owner.query(`SELECT audit.release_purge_run($1, false)`, [run.run_id]);
      expect(deleted).not.toContain(seeded[2]);
      expect(await pages(b.ownerSession, w, first[1]!)).toEqual([seeded[2], seeded[3]]);
    });

    it('( #34 ) a committed purge between platform pages leaves every surviving event once', async () => {
      const admin = await platformMember('super_admin');
      const w = pastWindow();
      const seeded: string[] = [];
      for (const h of [6, 5, 4, 3, 2, 1])
        seeded.push(await event({ occurredAt: at(w.base, h), merchantId: null }));
      const first = await readPlatform(admin.session, w, {}, 2);
      expect(ids(first.slice(0, 2))).toEqual(seeded.slice(0, 2));
      const run = await reserve(owner);
      const deleted: string[] = [];
      for (let n = 1; !deleted.includes(seeded[4]!) || !deleted.includes(seeded[5]!);) {
        const p = (
          await owner.query(`SELECT * FROM audit.purge_candidates($1, $2, $3, 1)`, [run.run_id, run.as_of, n])
        ).rows[0];
        expect(p.exhausted && p.row_count === 0, 'the purge reached its end before these rows').toBe(false);
        if (p.row_count > 0) {
          await owner.query(`SELECT audit.purge_expired_events($1, $2, $3)`, [run.run_id, run.as_of, n]);
          deleted.push(...(p.event_ids as string[]));
          n++;
        }
      }
      await owner.query(`SELECT audit.release_purge_run($1, false)`, [run.run_id]);
      expect(deleted).not.toContain(seeded[2]);
      expect(await pagePlatform(admin.session, w, first[1]!)).toEqual([seeded[2], seeded[3]]);
    });
  });
});
