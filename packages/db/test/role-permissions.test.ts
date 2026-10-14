import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState } from './support/db.js';

// tenancy.set_role_permissions (P5.6; P5 plan §10 P5.6, §7.2 footprint row, §8.1 #21, D5′, D6; the owner's answers O13,
// O14). The only app-reachable writer of a grant table: the owner replaces a role's permission set; the database decides
// authority (merchant.roles.manage, reserved — the owner's alone), the tenant and every identifier, and records #21 in
// the same transaction. Called as the API calls it (alphakolect_app); effects read as the table owner.

let app: pg.Client;
let owner: pg.Client;
let blocker: pg.Client;
beforeAll(async () => {
  [app, owner, blocker] = await Promise.all([connectAs('app'), connectAs('migrator'), connectAs('migrator')]);
});
afterAll(async () => {
  await Promise.all([app.end(), owner.end(), blocker.end()]);
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
const ctx = () => ({
  ip: '203.0.113.30',
  userAgent: 'role-permissions-test',
  requestId: `rp-${randomBytes(6).toString('hex')}`,
});
const one = async (sql: string, params: unknown[]) => (await owner.query(sql, params)).rows[0];

async function session(identityId: string, membershipId: string) {
  const {
    rows: [s],
  } = await app.query(
    `SELECT * FROM identity.create_session($1, 'merchant', $2, 'full', $3, 86400, 1209600, NULL, NULL)`,
    [identityId, membershipId, hash()],
  );
  return s.session_id as string;
}

async function business() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Roles Ltd')`, [
    email('owner'),
    ARGON,
  ]);
  const verification = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    verification,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [verification]);
  const ownerMembershipId = (
    await one(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [s.identity_id])
  ).id as string;
  const roleId = (
    await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
      s.merchant_id,
      `Role ${hash().slice(0, 6)}`,
    ])
  ).id as string;
  return {
    merchantId: s.merchant_id as string,
    roleId,
    ownerIdentityId: s.identity_id as string,
    ownerMembershipId,
    ownerSession: await session(s.identity_id, ownerMembershipId),
  };
}
type Business = Awaited<ReturnType<typeof business>>;

/** A staff member of `b` holding `roleId`. */
async function staff(b: Business, roleId = b.roleId) {
  const identityId = (
    await one(
      `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
      [email('staff'), ARGON],
    )
  ).id as string;
  const membershipId = (
    await one(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, 'staff', $3) RETURNING id`,
      [b.merchantId, identityId, roleId],
    )
  ).id as string;
  return { identityId, membershipId, session: await session(identityId, membershipId) };
}

const set = (sessionId: string, roleId: string, permissions: (string | null)[] | null, c = ctx()) =>
  app
    .query(`SELECT * FROM tenancy.set_role_permissions($1, $2, $3, $4, $5, $6)`, [
      sessionId,
      roleId,
      permissions,
      c.ip,
      c.userAgent,
      c.requestId,
    ])
    .then((r) => r.rows[0] as { outcome: string; permissions: string[] | null });
const stored = async (roleId: string) =>
  (
    await owner.query(`SELECT permission FROM tenancy.role_permissions WHERE role_id = $1 ORDER BY 1`, [
      roleId,
    ])
  ).rows.map((r) => r.permission as string);
const eventsOf = async (requestId: string) =>
  (
    await owner.query(
      `SELECT merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id,
              outcome, ip, user_agent, request_id, summary
         FROM audit.audit_events WHERE request_id = $1`,
      [requestId],
    )
  ).rows;
const resolved = async (sessionId: string) =>
  (await one(`SELECT permissions FROM identity.session_authority($1)`, [sessionId])).permissions as string[];

describe('the owner sets a role’s permissions', () => {
  it('replaces the set, writes one #21 with the set before and after, the actor and the request context', async () => {
    const b = await business();
    let c = ctx();
    expect(
      await set(b.ownerSession, b.roleId, ['merchant.branches.read', 'merchant.branches.manage'], c),
    ).toEqual({
      outcome: 'ok',
      permissions: ['merchant.branches.manage', 'merchant.branches.read'],
    });
    expect(await stored(b.roleId)).toEqual(['merchant.branches.manage', 'merchant.branches.read']);
    expect(await eventsOf(c.requestId)).toEqual([
      {
        merchant_id: b.merchantId,
        actor_identity_id: b.ownerIdentityId,
        actor_audience: 'merchant',
        actor_membership_id: b.ownerMembershipId,
        action: 'merchant.role_permissions_set',
        target_type: 'role',
        target_id: b.roleId,
        outcome: 'success',
        ip: '203.0.113.30',
        user_agent: 'role-permissions-test',
        request_id: c.requestId,
        summary: { before: [], after: ['merchant.branches.manage', 'merchant.branches.read'] },
      },
    ]);

    c = ctx();
    expect(
      (await set(b.ownerSession, b.roleId, ['merchant.profile.read', 'merchant.branches.read'], c)).outcome,
    ).toBe('ok');
    expect(await stored(b.roleId)).toEqual(['merchant.branches.read', 'merchant.profile.read']);
    expect((await eventsOf(c.requestId))[0].summary).toEqual({
      before: ['merchant.branches.manage', 'merchant.branches.read'],
      after: ['merchant.branches.read', 'merchant.profile.read'],
    });

    // An empty set clears the role.
    c = ctx();
    expect(await set(b.ownerSession, b.roleId, [], c)).toEqual({ outcome: 'ok', permissions: [] });
    expect(await stored(b.roleId)).toEqual([]);
    expect((await eventsOf(c.requestId))[0].summary.after).toEqual([]);
  });

  it('takes effect for the role’s staff on their next request, and the role reader shows it', async () => {
    const b = await business();
    const member = await staff(b);
    expect(await resolved(member.session)).toEqual([]);
    await set(b.ownerSession, b.roleId, ['merchant.roles.read', 'merchant.members.read']);
    expect(await resolved(member.session)).toEqual(['merchant.members.read', 'merchant.roles.read']);
    // With merchant.roles.read the staff member sees the roles and each role's permissions (O13's wording).
    const roles = (await app.query(`SELECT id, permissions FROM tenancy.list_roles($1)`, [member.session]))
      .rows;
    expect(roles.find((r) => r.id === b.roleId)?.permissions).toEqual([
      'merchant.members.read',
      'merchant.roles.read',
    ]);
  });

  it('an archived role keeps its set but grants nothing; restored, it grants the set again at once (D6, O14)', async () => {
    const b = await business();
    const member = await staff(b);
    await set(b.ownerSession, b.roleId, ['merchant.branches.read']);
    await app.query(`SELECT * FROM tenancy.update_role($1, $2, NULL, 'archived')`, [
      b.ownerSession,
      b.roleId,
    ]);
    expect(await resolved(member.session)).toEqual([]);
    // The owner may change an archived role's set: stored, still inert.
    expect(
      (await set(b.ownerSession, b.roleId, ['merchant.branches.read', 'merchant.profile.read'])).outcome,
    ).toBe('ok');
    expect(await resolved(member.session)).toEqual([]);
    await app.query(`SELECT * FROM tenancy.update_role($1, $2, NULL, 'active')`, [b.ownerSession, b.roleId]);
    expect(await resolved(member.session)).toEqual(['merchant.branches.read', 'merchant.profile.read']);
  });
});

describe('refused, with nothing changed and no #21', () => {
  it('a staff member — even one holding every grantable permission — cannot set any role’s permissions (D5′)', async () => {
    const b = await business();
    const { rows: grantable } = await owner.query(
      `SELECT identifier FROM identity.permission_catalog WHERE scope = 'merchant' AND grantable AND status = 'active'`,
    );
    const everything = grantable.map((g) => g.identifier as string);
    await set(b.ownerSession, b.roleId, everything);
    const member = await staff(b);
    const other = (
      await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Other') RETURNING id`, [
        b.merchantId,
      ])
    ).id as string;
    for (const roleId of [b.roleId, other]) {
      const c = ctx();
      expect(await set(member.session, roleId, ['merchant.profile.read'], c)).toEqual({
        outcome: 'forbidden',
        permissions: null,
      });
      expect(await eventsOf(c.requestId)).toEqual([]);
    }
    expect(await stored(b.roleId)).toEqual([...everything].sort());
    expect(await stored(other)).toEqual([]);
  });

  it.each([
    ['an unknown permission', ['merchant.unknown.read']],
    ['a platform permission', ['platform.audit.read']],
    ['merchant.members.manage (reserved)', ['merchant.members.manage']],
    ['merchant.invitations.manage (reserved)', ['merchant.invitations.manage']],
    ['merchant.audit.read (reserved)', ['merchant.audit.read']],
    ['merchant.roles.manage (reserved)', ['merchant.roles.manage']],
    ['a permission listed twice', ['merchant.branches.read', 'merchant.branches.read']],
    ['a null', ['merchant.branches.read', null]],
    ['no list at all', null],
  ] as const)('%s', async (_label, permissions) => {
    const b = await business();
    await set(b.ownerSession, b.roleId, ['merchant.profile.read']);
    const c = ctx();
    expect(await set(b.ownerSession, b.roleId, permissions as (string | null)[] | null, c)).toEqual({
      outcome: 'invalid_permissions',
      permissions: null,
    });
    expect(await stored(b.roleId)).toEqual(['merchant.profile.read']);
    expect(await eventsOf(c.requestId)).toEqual([]);
  });

  it('another business’s role is not found and untouched; a caller without authority learns only “forbidden”', async () => {
    const a = await business();
    const b = await business();
    await set(b.ownerSession, b.roleId, ['merchant.profile.read']);
    expect((await set(a.ownerSession, b.roleId, ['merchant.branches.read'])).outcome).toBe('not_found');
    const member = await staff(a);
    expect((await set(member.session, b.roleId, ['merchant.branches.read'])).outcome).toBe('forbidden');
    expect((await set(a.ownerSession, '01900000-0000-7000-8000-0000000000ab', [])).outcome).toBe('not_found');
    expect(await stored(b.roleId)).toEqual(['merchant.profile.read']);
  });

  it('an agent, an unknown or a revoked session is refused', async () => {
    const b = await business();
    const agentIdentity = (
      await one(
        `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
        [email('agent'), ARGON],
      )
    ).id as string;
    const agentMembership = (
      await one(
        `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent') RETURNING id`,
        [b.merchantId, agentIdentity],
      )
    ).id as string;
    const {
      rows: [agentSession],
    } = await app.query(
      `SELECT * FROM identity.create_session($1, 'agent', $2, 'full', $3, 86400, 1209600, NULL, NULL)`,
      [agentIdentity, agentMembership, hash()],
    );
    const revoked = await session(b.ownerIdentityId, b.ownerMembershipId);
    await app.query(`SELECT identity.revoke_session($1, 'test')`, [revoked]);
    for (const s of [agentSession.session_id as string, '01900000-0000-7000-8000-0000000000ac', revoked])
      expect((await set(s, b.roleId, ['merchant.profile.read'])).outcome).toBe('forbidden');
    expect(await stored(b.roleId)).toEqual([]);
  });
});

describe('the footprint: the acting member and the role are held (§7.2)', () => {
  async function waitsFor(table: string, id: string, run: () => Promise<unknown>) {
    await blocker.query('BEGIN');
    await blocker.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    await app.query('BEGIN');
    try {
      await app.query(`SET LOCAL lock_timeout = '300ms'`);
      // A lock timeout, not a NOWAIT failure (same SQLSTATE): the function waited for the row in its footprint.
      const err = await expectSqlState(run(), '55P03');
      expect(err.message).toMatch(/lock timeout/);
    } finally {
      await app.query('ROLLBACK');
      await blocker.query('ROLLBACK');
    }
  }

  it('waits for the owner’s own membership, and for the role', async () => {
    const b = await business();
    await waitsFor('tenancy.merchant_memberships', b.ownerMembershipId, () =>
      set(b.ownerSession, b.roleId, []),
    );
    await waitsFor('tenancy.roles', b.roleId, () => set(b.ownerSession, b.roleId, []));
  });
});

describe('no actor can be supplied', () => {
  it('tenancy.set_role_permissions(p_session_id p_role_id p_permissions p_ip p_user_agent p_request_id)', async () => {
    const f = await one(
      `SELECT array_to_string(p.proargnames[1:p.pronargs], ' ') AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'tenancy' AND p.proname = 'set_role_permissions'`,
      [],
    );
    expect(f.args).toBe('p_session_id p_role_id p_permissions p_ip p_user_agent p_request_id');
  });
});
