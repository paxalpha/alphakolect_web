import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// The enforcement boundary (P5.5 step 4; TARGET_ARCHITECTURE ADR-16 "Direct writes move behind functions" and owner
// decision B1; P5 plan §7.2 "Enforcement boundary = one migration"). The app has no direct access to the business,
// its branches, roles or invitations: it reads them through read functions that take the business from the session
// and check the permission in the resolver, and writes branches, roles and the profile through definer functions that
// take their footprint (the actor's row included), ask assert_authority, write, and record the change's audit row
// (pattern A). Called as the API calls them (alphakolect_app); effects read as the table owner.

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
  ip: '203.0.113.8',
  userAgent: 'enforcement-test',
  requestId: `en-${randomBytes(6).toString('hex')}`,
});
const unique = (tag: string) => `${tag} ${randomBytes(3).toString('hex')}`;
const LOCK_TIMEOUT = '55P03';
const UNKNOWN_SESSION = '01900000-0000-7000-8000-0000000000e1';

async function session(identityId: string, audience: string, membershipId: string) {
  const [idle, absolute] = audience === 'platform' ? [3600, 43200] : [86400, 1209600];
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.create_session($1, $2, $3, 'full', $4, $5, $6, NULL, NULL)`, [
    identityId,
    audience,
    membershipId,
    hash(),
    idle,
    absolute,
  ]);
  return s.session_id as string;
}

const one = async (sql: string, params: unknown[]) => (await owner.query(sql, params)).rows[0].id as string;

/** An active business: its owner (session), a role, a branch and an invitation, made as the table owner. */
async function business(name = unique('Boundary')) {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, $3)`, [
    email('owner'),
    ARGON,
    name,
  ]);
  const verification = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    verification,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [verification]);
  const merchantId = s.merchant_id as string;
  const ownerMembershipId = await one(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  const roleId = await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
    merchantId,
    unique('Role'),
  ]);
  const branchId = await one(
    `INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, $2) RETURNING id`,
    [merchantId, unique('Branch')],
  );
  const ownerSession = await session(s.identity_id, 'merchant', ownerMembershipId);
  const {
    rows: [issued],
  } = await app.query(
    `SELECT invitation_id FROM tenancy.issue_invitation($1, $2, 'agent', NULL, NULL, $3, $4, 86400)`,
    [ownerSession, email('invited'), hash(), hash()],
  );
  return {
    name,
    merchantId,
    roleId,
    branchId,
    invitationId: issued.invitation_id as string,
    ownerIdentityId: s.identity_id as string,
    ownerMembershipId,
    ownerSession,
  };
}
type Business = Awaited<ReturnType<typeof business>>;

/** A member of `b`; a staff member gets a fresh role holding exactly `permissions` (granted as the table owner). */
async function member(b: Business, kind: 'staff' | 'agent', permissions: string[] = []) {
  const roleId =
    kind === 'staff'
      ? await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
          b.merchantId,
          unique('Staff role'),
        ])
      : null;
  if (roleId && permissions.length) {
    await owner.query(
      `INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission) SELECT $1, $2, unnest($3::text[])`,
      [b.merchantId, roleId, permissions],
    );
  }
  const identityId = await one(
    `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
    [email(kind), ARGON],
  );
  const membershipId = await one(
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [b.merchantId, identityId, kind, roleId],
  );
  return {
    identityId,
    membershipId,
    roleId,
    session: await session(identityId, kind === 'agent' ? 'agent' : 'merchant', membershipId),
  };
}

const auditOf = async (requestId: string) =>
  (
    await owner.query(
      `SELECT merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id,
              outcome, ip, user_agent, request_id, summary
         FROM audit.audit_events WHERE request_id = $1`,
      [requestId],
    )
  ).rows;

const rows = async (sql: string, params: unknown[]) => (await app.query(sql, params)).rows;

const read = {
  profile: (s: string) => rows(`SELECT * FROM tenancy.read_profile($1)`, [s]),
  branches: (s: string, id: string | null = null) =>
    rows(`SELECT * FROM tenancy.list_branches($1, $2)`, [s, id]),
  roles: (s: string, id: string | null = null) => rows(`SELECT * FROM tenancy.list_roles($1, $2)`, [s, id]),
  catalog: (s: string) => rows(`SELECT * FROM tenancy.list_permission_catalog($1)`, [s]),
  invitations: (s: string, id: string | null = null) =>
    rows(`SELECT * FROM tenancy.list_invitations($1, $2)`, [s, id]),
  own: (s: string) => rows(`SELECT * FROM tenancy.read_own_membership($1)`, [s]),
};

const write = {
  profile: (s: string, name: string, c = ctx()) =>
    app.query(`SELECT * FROM tenancy.update_profile($1, $2, $3, $4, $5)`, [
      s,
      name,
      c.ip,
      c.userAgent,
      c.requestId,
    ]),
  createBranch: (s: string, name: string, c = ctx()) =>
    app.query(`SELECT * FROM tenancy.create_branch($1, $2, $3, $4, $5)`, [
      s,
      name,
      c.ip,
      c.userAgent,
      c.requestId,
    ]),
  updateBranch: (s: string, id: string, name: string | null, status: string | null, c = ctx()) =>
    app.query(`SELECT * FROM tenancy.update_branch($1, $2, $3, $4, $5, $6, $7)`, [
      s,
      id,
      name,
      status,
      c.ip,
      c.userAgent,
      c.requestId,
    ]),
  createRole: (s: string, name: string, c = ctx()) =>
    app.query(`SELECT * FROM tenancy.create_role($1, $2, $3, $4, $5)`, [
      s,
      name,
      c.ip,
      c.userAgent,
      c.requestId,
    ]),
  updateRole: (s: string, id: string, name: string | null, status: string | null, c = ctx()) =>
    app.query(`SELECT * FROM tenancy.update_role($1, $2, $3, $4, $5, $6, $7)`, [
      s,
      id,
      name,
      status,
      c.ip,
      c.userAgent,
      c.requestId,
    ]),
};

const READ_ALL = [
  'merchant.profile.read',
  'merchant.branches.read',
  'merchant.roles.read',
  'merchant.invitations.read',
];

describe('the boundary: no direct access to the business, its branches, roles or invitations (B1, O1)', () => {
  const TABLES = ['tenancy.merchants', 'tenancy.branches', 'tenancy.roles', 'tenancy.invitations'];

  it.each(TABLES)('the app holds no privilege on %s — not on the table, not on any column', async (table) => {
    const {
      rows: [p],
    } = await owner.query(
      `SELECT (SELECT bool_or(has_table_privilege('alphakolect_app', $1, priv))
                FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) priv)
                AS table_priv,
              (SELECT bool_or(has_any_column_privilege('alphakolect_app', $1, priv))
                FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) priv) AS column_priv`,
      [table],
    );
    expect(p).toEqual({ table_priv: false, column_priv: false });
  });

  it('nor on the permission catalog (since P5.1)', async () => {
    const {
      rows: [p],
    } = await owner.query(
      `SELECT has_any_column_privilege('alphakolect_app', 'identity.permission_catalog', 'SELECT') AS p`,
    );
    expect(p.p).toBe(false);
  });

  it('a direct read or write as the app fails with insufficient_privilege, whatever tenant is set', async () => {
    const b = await business();
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.merchant_id', $1, true)`, [b.merchantId]);
      for (const sql of [
        `SELECT name FROM tenancy.merchants WHERE id = '${b.merchantId}'`,
        `SELECT id FROM tenancy.branches LIMIT 1`,
        `SELECT id FROM tenancy.roles LIMIT 1`,
        `SELECT id FROM tenancy.invitations LIMIT 1`,
      ]) {
        await app.query('SAVEPOINT s');
        await expectSqlState(app.query(sql), SQLSTATE.insufficientPrivilege);
        await app.query('ROLLBACK TO SAVEPOINT s');
      }
    } finally {
      await app.query('ROLLBACK');
    }
  });
});

describe('the read functions: the business from the session, the permission from the resolver', () => {
  let a: Business;
  let b: Business;
  let reader: Awaited<ReturnType<typeof member>>;
  let bare: Awaited<ReturnType<typeof member>>;
  let agent: Awaited<ReturnType<typeof member>>;
  beforeAll(async () => {
    a = await business();
    b = await business();
    reader = await member(a, 'staff', READ_ALL);
    bare = await member(a, 'staff');
    agent = await member(a, 'agent');
  });

  it('the owner reads their own business only', async () => {
    expect(await read.profile(a.ownerSession)).toEqual([
      { id: a.merchantId, name: a.name, status: 'active' },
    ]);
    const branches = (await read.branches(a.ownerSession)).map((r) => r.id);
    expect(branches).toContain(a.branchId);
    expect(branches).not.toContain(b.branchId);
    const roles = (await read.roles(a.ownerSession)).map((r) => r.id);
    expect(roles).toContain(a.roleId);
    expect(roles).not.toContain(b.roleId);
    const invitations = (await read.invitations(a.ownerSession)).map((r) => r.id);
    expect(invitations).toEqual([a.invitationId]);
    // An id of another business is not found, exactly like one that does not exist (T15).
    expect(await read.branches(a.ownerSession, b.branchId)).toEqual([]);
    expect(await read.roles(a.ownerSession, b.roleId)).toEqual([]);
    expect(await read.invitations(a.ownerSession, b.invitationId)).toEqual([]);
  });

  it('a staff member holding the read permissions reads them; one holding none reads nothing', async () => {
    expect(await read.profile(reader.session)).toHaveLength(1);
    expect((await read.branches(reader.session)).map((r) => r.id)).toContain(a.branchId);
    expect((await read.roles(reader.session)).map((r) => r.id)).toContain(a.roleId);
    expect((await read.invitations(reader.session)).map((r) => r.id)).toEqual([a.invitationId]);
    expect((await read.catalog(reader.session)).length).toBeGreaterThan(0);

    for (const fn of [read.profile, read.branches, read.roles, read.catalog, read.invitations])
      expect(await fn(bare.session)).toEqual([]);
  });

  it('each reader needs its own permission, not another', async () => {
    const onlyBranches = await member(a, 'staff', ['merchant.branches.read']);
    expect(await read.branches(onlyBranches.session)).not.toEqual([]);
    expect(await read.profile(onlyBranches.session)).toEqual([]);
    expect(await read.roles(onlyBranches.session)).toEqual([]);
    expect(await read.catalog(onlyBranches.session)).toEqual([]);
    expect(await read.invitations(onlyBranches.session)).toEqual([]);
  });

  it('the permission catalog: the active merchant permissions with their grantable flag, for role editing', async () => {
    const catalog = await read.catalog(a.ownerSession);
    const { rows: expected } = await owner.query(
      `SELECT identifier, grantable FROM identity.permission_catalog
        WHERE scope = 'merchant' AND status = 'active' ORDER BY identifier`,
    );
    expect(catalog).toEqual(expected);
    expect(catalog.find((c) => c.identifier === 'merchant.roles.manage')).toEqual({
      identifier: 'merchant.roles.manage',
      grantable: false,
    });
  });

  it('an agent or an unknown session reads nothing through the merchant readers', async () => {
    for (const s of [agent.session, UNKNOWN_SESSION])
      for (const fn of [read.profile, read.branches, read.roles, read.catalog, read.invitations])
        expect(await fn(s)).toEqual([]);
  });

  it('read_own_membership: any member’s own membership and business, no permission needed', async () => {
    expect(await read.own(bare.session)).toEqual([
      {
        membership_id: bare.membershipId,
        kind: 'staff',
        role_id: bare.roleId,
        branch_id: null,
        merchant_id: a.merchantId,
        merchant_name: a.name,
        merchant_status: 'active',
      },
    ]);
    expect((await read.own(agent.session))[0]).toMatchObject({ kind: 'agent', merchant_id: a.merchantId });
    expect(await read.own(UNKNOWN_SESSION)).toEqual([]);
  });

  it('a revoked session reads nothing at all', async () => {
    const gone = await member(a, 'staff', READ_ALL);
    await app.query(`SELECT identity.revoke_session($1, 'test')`, [gone.session]);
    for (const fn of [read.profile, read.branches, read.roles, read.catalog, read.invitations, read.own])
      expect(await fn(gone.session)).toEqual([]);
  });
});

describe('the writers: authority from the resolver, the audit row in the same transaction (pattern A)', () => {
  it('the owner creates and updates a branch and a role and renames the business, each with one audit row', async () => {
    const b = await business();
    const expectRow = async (
      requestId: string,
      action: string,
      targetType: string,
      targetId: string,
      summary: object,
    ) =>
      expect(await auditOf(requestId)).toEqual([
        {
          merchant_id: b.merchantId,
          actor_identity_id: b.ownerIdentityId,
          actor_audience: 'merchant',
          actor_membership_id: b.ownerMembershipId,
          action,
          target_type: targetType,
          target_id: targetId,
          outcome: 'success',
          ip: '203.0.113.8',
          user_agent: 'enforcement-test',
          request_id: requestId,
          summary,
        },
      ]);

    let c = ctx();
    const {
      rows: [branch],
    } = await write.createBranch(b.ownerSession, 'North', c);
    expect(branch).toMatchObject({ outcome: 'ok', name: 'North', status: 'active', archived_at: null });
    await expectRow(c.requestId, 'merchant.branch_created', 'branch', branch.id, { name: 'North' });

    c = ctx();
    const {
      rows: [archived],
    } = await write.updateBranch(b.ownerSession, branch.id, 'North 2', 'archived', c);
    expect(archived).toMatchObject({ outcome: 'ok', name: 'North 2', status: 'archived' });
    expect(archived.archived_at).toBeInstanceOf(Date);
    await expectRow(c.requestId, 'merchant.branch_updated', 'branch', branch.id, {
      name: 'North 2',
      status: 'archived',
    });

    c = ctx();
    const {
      rows: [role],
    } = await write.createRole(b.ownerSession, 'Cashier', c);
    expect(role).toMatchObject({ outcome: 'ok', name: 'Cashier', status: 'active' });
    await expectRow(c.requestId, 'merchant.role_created', 'role', role.id, { name: 'Cashier' });

    c = ctx();
    const {
      rows: [renamedRole],
    } = await write.updateRole(b.ownerSession, role.id, 'Teller', null, c);
    expect(renamedRole).toMatchObject({ outcome: 'ok', name: 'Teller', status: 'active', archived_at: null });
    await expectRow(c.requestId, 'merchant.role_updated', 'role', role.id, {
      name: 'Teller',
      status: 'active',
    });

    c = ctx();
    const {
      rows: [profile],
    } = await write.profile(b.ownerSession, 'Renamed Ltd', c);
    expect(profile).toEqual({ outcome: 'ok', id: b.merchantId, name: 'Renamed Ltd', status: 'active' });
    await expectRow(c.requestId, 'merchant.profile_updated', 'merchant', b.merchantId, {
      name: 'Renamed Ltd',
    });
  });

  it('a staff member without the permission is refused every write: nothing changes, no row is written', async () => {
    const b = await business();
    const staff = await member(b, 'staff', READ_ALL);
    const state = async () =>
      (
        await owner.query(
          `SELECT (SELECT name FROM tenancy.merchants WHERE id = $1) AS name,
                  (SELECT string_agg(name || status, ',' ORDER BY id) FROM tenancy.branches WHERE merchant_id = $1) AS b,
                  (SELECT string_agg(name || status, ',' ORDER BY id) FROM tenancy.roles WHERE merchant_id = $1) AS r`,
          [b.merchantId],
        )
      ).rows[0];
    const before = await state();
    const c = ctx();
    for (const run of [
      () => write.profile(staff.session, 'Hijacked', c),
      () => write.createBranch(staff.session, 'Hijacked', c),
      () => write.updateBranch(staff.session, b.branchId, 'Hijacked', 'archived', c),
      () => write.createRole(staff.session, 'Hijacked', c),
      () => write.updateRole(staff.session, b.roleId, 'Hijacked', 'archived', c),
    ]) {
      const {
        rows: [r],
      } = await run();
      expect(r.outcome).toBe('forbidden');
      expect(r.id).toBeNull();
    }
    expect(await state()).toEqual(before);
    expect(await auditOf(c.requestId)).toEqual([]);
  });

  it('a staff member granted merchant.branches.manage writes branches — as themselves — and nothing else', async () => {
    const b = await business();
    const staff = await member(b, 'staff', ['merchant.branches.manage']);
    const c = ctx();
    const {
      rows: [branch],
    } = await write.createBranch(staff.session, 'Staff branch', c);
    expect(branch.outcome).toBe('ok');
    expect(await auditOf(c.requestId)).toEqual([
      expect.objectContaining({
        actor_identity_id: staff.identityId,
        actor_membership_id: staff.membershipId,
        action: 'merchant.branch_created',
        target_id: branch.id,
      }),
    ]);
    expect((await write.updateBranch(staff.session, branch.id, null, 'archived')).rows[0].outcome).toBe('ok');
    expect((await write.createRole(staff.session, 'Nope')).rows[0].outcome).toBe('forbidden');
    expect((await write.profile(staff.session, 'Nope')).rows[0].outcome).toBe('forbidden');
  });

  it('roles stay the owner’s: merchant.roles.manage cannot be granted, so even every grantable permission is refused', async () => {
    const b = await business();
    const { rows: grantable } = await owner.query(
      `SELECT identifier FROM identity.permission_catalog WHERE scope = 'merchant' AND grantable AND status = 'active'`,
    );
    const staff = await member(
      b,
      'staff',
      grantable.map((g) => g.identifier as string),
    );
    expect((await write.createRole(staff.session, 'Nope')).rows[0].outcome).toBe('forbidden');
    expect((await write.updateRole(staff.session, b.roleId, 'Nope', null)).rows[0].outcome).toBe('forbidden');
  });

  it('an agent, an unknown or a revoked session is refused', async () => {
    const b = await business();
    const agent = await member(b, 'agent');
    const gone = await member(b, 'staff', ['merchant.branches.manage']);
    await app.query(`SELECT identity.revoke_session($1, 'test')`, [gone.session]);
    for (const s of [agent.session, UNKNOWN_SESSION, gone.session]) {
      expect((await write.createBranch(s, unique('x'))).rows[0].outcome).toBe('forbidden');
      expect((await write.profile(s, 'x')).rows[0].outcome).toBe('forbidden');
    }
  });

  it('another business’s branch or role is not found, and untouched; a refused caller learns only “forbidden”', async () => {
    const a = await business();
    const b = await business();
    const bare = await member(a, 'staff');
    const c = ctx();
    expect(
      (await write.updateBranch(a.ownerSession, b.branchId, 'Hijacked', 'archived', c)).rows[0].outcome,
    ).toBe('not_found');
    expect(
      (await write.updateRole(a.ownerSession, b.roleId, 'Hijacked', 'archived', c)).rows[0].outcome,
    ).toBe('not_found');
    // forbidden comes first (§8.2a): without the permission the caller cannot learn whether the id exists.
    expect((await write.updateBranch(bare.session, b.branchId, 'Hijacked', null, c)).rows[0].outcome).toBe(
      'forbidden',
    );
    const {
      rows: [untouched],
    } = await owner.query(
      `SELECT (SELECT name || status FROM tenancy.branches WHERE id = $1) AS branch,
              (SELECT name || status FROM tenancy.roles WHERE id = $2) AS role`,
      [b.branchId, b.roleId],
    );
    expect(untouched.branch).toMatch(/active$/);
    expect(untouched.role).toMatch(/active$/);
    expect(untouched.branch).not.toMatch(/Hijacked/);
    expect(await auditOf(c.requestId)).toEqual([]);
  });

  it('an active name is unique within the business: unique_violation, as before (the API answers 409)', async () => {
    const b = await business();
    await write.createBranch(b.ownerSession, 'Twin');
    const err = await expectSqlState(write.createBranch(b.ownerSession, 'TWIN'), SQLSTATE.uniqueViolation);
    expect(err.constraint).toBe('branches_active_name_per_merchant');
    await write.createRole(b.ownerSession, 'Twin');
    const roleErr = await expectSqlState(write.createRole(b.ownerSession, 'twin'), SQLSTATE.uniqueViolation);
    expect(roleErr.constraint).toBe('roles_active_name_per_merchant');
  });

  it('the user agent is recorded at most 512 characters long', async () => {
    const b = await business();
    const c = { ...ctx(), userAgent: 'x'.repeat(2000) };
    await write.createBranch(b.ownerSession, unique('Long'), c);
    const [row] = await auditOf(c.requestId);
    expect(row.user_agent).toHaveLength(512);
  });
});

describe('the footprint: the actor’s own row, and a staff actor’s role, are held (§7.2 authority lock)', () => {
  async function waitsFor(table: string, id: string, run: () => Promise<unknown>) {
    await blocker.query('BEGIN');
    await blocker.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    await app.query('BEGIN');
    try {
      await app.query(`SET LOCAL lock_timeout = '300ms'`);
      // A lock timeout, not a NOWAIT failure (same SQLSTATE): the function waited for the row in its footprint.
      const err = await expectSqlState(run(), LOCK_TIMEOUT);
      expect(err.message).toMatch(/lock timeout/);
    } finally {
      await app.query('ROLLBACK');
      await blocker.query('ROLLBACK');
    }
  }

  it('each writer waits for the acting member’s membership row', async () => {
    const b = await business();
    for (const run of [
      () => write.profile(b.ownerSession, 'x'),
      () => write.createBranch(b.ownerSession, unique('x')),
      () => write.updateBranch(b.ownerSession, b.branchId, 'x', null),
      () => write.createRole(b.ownerSession, unique('x')),
      () => write.updateRole(b.ownerSession, b.roleId, 'x', null),
    ])
      await waitsFor('tenancy.merchant_memberships', b.ownerMembershipId, run);
  });

  it('a staff actor’s role is held while the write is decided', async () => {
    const b = await business();
    const staff = await member(b, 'staff', ['merchant.branches.manage']);
    await waitsFor('tenancy.roles', staff.roleId!, () => write.createBranch(staff.session, unique('x')));
  });

  it('the profile writer holds the business row; the branch writer the edited branch', async () => {
    const b = await business();
    await waitsFor('tenancy.merchants', b.merchantId, () => write.profile(b.ownerSession, 'x'));
    await waitsFor('tenancy.branches', b.branchId, () =>
      write.updateBranch(b.ownerSession, b.branchId, 'x', null),
    );
    await waitsFor('tenancy.roles', b.roleId, () => write.updateRole(b.ownerSession, b.roleId, 'x', null));
  });
});

describe('no actor can be supplied: the parameters are the session, the targets and the request context', () => {
  it.each([
    ['update_profile', 'p_session_id p_name p_ip p_user_agent p_request_id'],
    ['create_branch', 'p_session_id p_name p_ip p_user_agent p_request_id'],
    ['update_branch', 'p_session_id p_branch_id p_name p_status p_ip p_user_agent p_request_id'],
    ['create_role', 'p_session_id p_name p_ip p_user_agent p_request_id'],
    ['update_role', 'p_session_id p_role_id p_name p_status p_ip p_user_agent p_request_id'],
    ['read_profile', 'p_session_id'],
    ['list_branches', 'p_session_id p_branch_id'],
    ['list_roles', 'p_session_id p_role_id'],
    ['list_permission_catalog', 'p_session_id'],
    ['list_invitations', 'p_session_id p_invitation_id'],
    ['read_own_membership', 'p_session_id'],
  ])('tenancy.%s(%s)', async (name, args) => {
    const {
      rows: [f],
    } = await owner.query(
      `SELECT array_to_string(p.proargnames[1:p.pronargs], ' ') AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'tenancy' AND p.proname = $1`,
      [name],
    );
    expect(f.args).toBe(args);
  });
});
