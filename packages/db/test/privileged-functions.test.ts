import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState } from './support/db.js';

// The privileged functions after P5.5 step 3 (P5 plan §7.2 the authority rule, §7.3 D5′, §8.1 pattern A, §8.2a, §8.5):
// authority comes from the resolver under the footprint's locks — never from a literal — and each success writes its
// own audit row in the same transaction, with the actor taken from the session (there is no actor parameter) and the
// request context recorded as given. Called as the API calls them (alphakolect_app); effects read as the table owner.

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
  ip: '203.0.113.7',
  userAgent: 'privileged-functions-test',
  requestId: `pf-${randomBytes(6).toString('hex')}`,
});
const LOCK_TIMEOUT = '55P03';

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

/** An active business: its owner (session), a role, a branch, and helpers to add members. */
async function business() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Authority Ltd')`, [
    email('owner'),
    ARGON,
  ]);
  const verification = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    verification,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [verification]);
  const merchantId = s.merchant_id as string;
  const {
    rows: [o],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  const one = async (sql: string, params: unknown[]) => (await owner.query(sql, params)).rows[0].id as string;
  const roleId = await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
    merchantId,
    `Role ${randomBytes(3).toString('hex')}`,
  ]);
  return {
    merchantId,
    roleId,
    ownerIdentityId: s.identity_id as string,
    ownerMembershipId: o.id as string,
    ownerSession: await session(s.identity_id, 'merchant', o.id),
  };
}
type Business = Awaited<ReturnType<typeof business>>;

async function member(
  b: Business,
  kind: 'staff' | 'agent',
  roleId: string | null = kind === 'staff' ? b.roleId : null,
) {
  const {
    rows: [i],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
    [email(kind), ARGON],
  );
  const {
    rows: [m],
  } = await owner.query(
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [b.merchantId, i.id, kind, roleId],
  );
  return {
    identityId: i.id as string,
    membershipId: m.id as string,
    session: await session(i.id, kind === 'agent' ? 'agent' : 'merchant', m.id),
  };
}

async function platformMember(role: string) {
  const {
    rows: [i],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
    [email('platform')],
  );
  const {
    rows: [m],
  } = await owner.query(
    `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, $2) RETURNING id`,
    [i.id, role],
  );
  await owner.query(
    `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at) VALUES ($1, '\\x00', 'k1', now())`,
    [i.id],
  );
  return {
    identityId: i.id as string,
    membershipId: m.id as string,
    session: await session(i.id, 'platform', m.id),
  };
}

/** Every grantable merchant permission, granted to `roleId` as the table owner (a fixture; no app path grants yet). */
async function grantEverything(b: Business, roleId: string) {
  await owner.query(
    `INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission)
     SELECT $1, $2, c.identifier FROM identity.permission_catalog c
      WHERE c.scope = 'merchant' AND c.grantable AND c.status = 'active'`,
    [b.merchantId, roleId],
  );
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

const membership = async (id: string) =>
  (await owner.query(`SELECT kind, status, role_id FROM tenancy.merchant_memberships WHERE id = $1`, [id]))
    .rows[0];

const call = {
  updateMembership: (sessionId: string, target: string, action: string, roleId: string | null, c = ctx()) =>
    app.query(`SELECT * FROM tenancy.update_membership($1, $2, $3, $4, NULL, $5, $6, $7)`, [
      sessionId,
      target,
      action,
      roleId,
      c.ip,
      c.userAgent,
      c.requestId,
    ]),
  issue: (sessionId: string, to: string, c = ctx()) =>
    app.query(
      `SELECT * FROM tenancy.issue_invitation($1, $2, 'agent', NULL, NULL, $3, $4, 86400, $5, $6, $7)`,
      [sessionId, to, hash(), hash(), c.ip, c.userAgent, c.requestId],
    ),
  revoke: (sessionId: string, invitationId: string, c = ctx()) =>
    app.query(`SELECT * FROM tenancy.revoke_invitation($1, $2, $3, $4, $5)`, [
      sessionId,
      invitationId,
      c.ip,
      c.userAgent,
      c.requestId,
    ]),
  setStatus: (sessionId: string, merchantId: string, action: string, c = ctx()) =>
    app.query(`SELECT * FROM tenancy.set_merchant_status($1, $2, $3, 'authority test', $4, $5, $6)`, [
      sessionId,
      merchantId,
      action,
      c.ip,
      c.userAgent,
      c.requestId,
    ]),
  transfer: (sessionId: string, merchantId: string, newOwner: string, roleId: string, c = ctx()) =>
    app.query(`SELECT * FROM tenancy.transfer_ownership($1, $2, $3, $4, false, $5, $6, $7)`, [
      sessionId,
      merchantId,
      newOwner,
      roleId,
      c.ip,
      c.userAgent,
      c.requestId,
    ]),
};

describe('success: the change and its one audit row commit together; the actor comes from the session (pattern A)', () => {
  it('update_membership', async () => {
    const b = await business();
    const staff = await member(b, 'staff');
    const c = ctx();
    const { rows } = await call.updateMembership(b.ownerSession, staff.membershipId, 'deactivate', null, c);
    expect(rows[0]!.outcome).toBe('ok');
    expect(await auditOf(c.requestId)).toEqual([
      {
        merchant_id: b.merchantId,
        actor_identity_id: b.ownerIdentityId,
        actor_audience: 'merchant',
        actor_membership_id: b.ownerMembershipId,
        action: 'merchant.member_deactivated',
        target_type: 'membership',
        target_id: staff.membershipId,
        outcome: 'success',
        ip: c.ip,
        user_agent: c.userAgent,
        request_id: c.requestId,
        summary: { kind: 'staff', status: 'deactivated', roleId: b.roleId, branchId: null },
      },
    ]);
  });

  it('issue_invitation and revoke_invitation', async () => {
    const b = await business();
    const c1 = ctx();
    const { rows } = await call.issue(b.ownerSession, email('invitee'), c1);
    expect(rows[0]!.outcome).toBe('ok');
    expect(await auditOf(c1.requestId)).toMatchObject([
      {
        merchant_id: b.merchantId,
        actor_identity_id: b.ownerIdentityId,
        actor_membership_id: b.ownerMembershipId,
        action: 'merchant.invitation_issued',
        target_type: 'invitation',
        target_id: rows[0]!.invitation_id,
        request_id: c1.requestId,
        summary: { kind: 'agent', roleId: null, branchId: null, delivery: 'setup' },
      },
    ]);
    const c2 = ctx();
    expect((await call.revoke(b.ownerSession, rows[0]!.invitation_id, c2)).rows[0]!.outcome).toBe('ok');
    expect(await auditOf(c2.requestId)).toMatchObject([
      {
        action: 'merchant.invitation_revoked',
        target_id: rows[0]!.invitation_id,
        summary: { kind: 'agent' },
      },
    ]);
  });

  it('set_merchant_status and transfer_ownership', async () => {
    const admin = await platformMember('super_admin');
    const b = await business();
    const staff = await member(b, 'staff');
    const c1 = ctx();
    expect(
      (await call.transfer(admin.session, b.merchantId, staff.membershipId, b.roleId, c1)).rows[0]!.outcome,
    ).toBe('ok');
    expect(await auditOf(c1.requestId)).toMatchObject([
      {
        merchant_id: b.merchantId,
        actor_identity_id: admin.identityId,
        actor_audience: 'platform',
        actor_membership_id: admin.membershipId,
        action: 'platform.ownership_transferred',
        target_type: 'merchant',
        target_id: b.merchantId,
        summary: {
          formerOwnerIdentityId: b.ownerIdentityId,
          formerOwnerMembershipId: b.ownerMembershipId,
          newOwnerIdentityId: staff.identityId,
          newOwnerMembershipId: staff.membershipId,
          formerOwnerRoleId: b.roleId,
          formerOwnerDeactivated: false,
        },
      },
    ]);
    const c2 = ctx();
    expect((await call.setStatus(admin.session, b.merchantId, 'deactivate', c2)).rows[0]!.outcome).toBe('ok');
    expect(await auditOf(c2.requestId)).toMatchObject([
      {
        action: 'platform.merchant_deactivated',
        summary: { status: 'deactivated', reason: 'authority test' },
      },
    ]);
  });
});

describe('refusals: returned, nothing changed, no audit row (§8.2a rules 1, 2)', () => {
  it('a staff member holding every grantable permission cannot change members or invitations (reserved, D5′)', async () => {
    const b = await business();
    const powerful = await member(b, 'staff');
    await grantEverything(b, b.roleId);
    const target = await member(b, 'agent');
    const c1 = ctx();
    expect(
      (await call.updateMembership(powerful.session, target.membershipId, 'deactivate', null, c1)).rows[0]!
        .outcome,
    ).toBe('forbidden');
    expect((await membership(target.membershipId)).status).toBe('active');
    expect(await auditOf(c1.requestId)).toEqual([]);
    const c2 = ctx();
    expect((await call.issue(powerful.session, email('nope'), c2)).rows[0]!.outcome).toBe('forbidden');
    expect(await auditOf(c2.requestId)).toEqual([]);
    const { rows: invitation } = await call.issue(b.ownerSession, email('open'));
    const c3 = ctx();
    expect((await call.revoke(powerful.session, invitation[0]!.invitation_id, c3)).rows[0]!.outcome).toBe(
      'forbidden',
    );
    expect(await auditOf(c3.requestId)).toEqual([]);
  });

  it('the reserved permissions themselves cannot be granted to a role (the grant table refuses them, P5.1)', async () => {
    const b = await business();
    for (const permission of ['merchant.members.manage', 'merchant.invitations.manage']) {
      await expectSqlState(
        owner.query(
          `INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission) VALUES ($1, $2, $3)`,
          [b.merchantId, b.roleId, permission],
        ),
        '23514',
      );
    }
  });

  it('a platform member who is not the super admin cannot change a business or its ownership', async () => {
    const support = await platformMember('support');
    const b = await business();
    const staff = await member(b, 'staff');
    const c1 = ctx();
    expect((await call.setStatus(support.session, b.merchantId, 'deactivate', c1)).rows[0]!.outcome).toBe(
      'forbidden',
    );
    const c2 = ctx();
    expect(
      (await call.transfer(support.session, b.merchantId, staff.membershipId, b.roleId, c2)).rows[0]!.outcome,
    ).toBe('forbidden');
    const { rows } = await owner.query(`SELECT status FROM tenancy.merchants WHERE id = $1`, [b.merchantId]);
    expect(rows[0].status).toBe('active');
    expect((await membership(b.ownerMembershipId)).kind).toBe('owner');
    expect([...(await auditOf(c1.requestId)), ...(await auditOf(c2.requestId))]).toEqual([]);
  });

  it('forbidden comes first, as in P4: a non-owner learns nothing about the target', async () => {
    const b = await business();
    const staff = await member(b, 'staff');
    const missing = '01900000-0000-7000-8000-00000000dead';
    expect((await call.updateMembership(staff.session, missing, 'deactivate', null)).rows[0]!.outcome).toBe(
      'forbidden',
    );
    expect((await call.updateMembership(b.ownerSession, missing, 'deactivate', null)).rows[0]!.outcome).toBe(
      'not_found',
    );
    const admin = await platformMember('super_admin');
    const support = await platformMember('support');
    expect((await call.setStatus(support.session, missing, 'deactivate')).rows[0]!.outcome).toBe('forbidden');
    expect((await call.setStatus(admin.session, missing, 'deactivate')).rows[0]!.outcome).toBe('not_found');
  });

  it('an owner still cannot change their own membership (owner protection), and that writes no row', async () => {
    const b = await business();
    const c = ctx();
    expect(
      (await call.updateMembership(b.ownerSession, b.ownerMembershipId, 'deactivate', null, c)).rows[0]!
        .outcome,
    ).toBe('owner_protected');
    expect(await auditOf(c.requestId)).toEqual([]);
  });
});

describe('the authority lock holds the actor’s own row (§7.2 "Authority is acquired by category, not by row")', () => {
  /**
   * Holds `table` row `id` FOR UPDATE in another transaction; the call must WAIT for it and time out. A NOWAIT failure
   * shares the SQLSTATE (55P03) — tenancy.assert_authority would raise one at once if a function forgot the actor's lock
   * — so the message must be the lock timeout's, not NOWAIT's.
   */
  async function waitsFor(table: string, id: string, run: () => Promise<unknown>) {
    await blocker.query('BEGIN');
    await blocker.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    await app.query('BEGIN');
    try {
      await app.query(`SET LOCAL lock_timeout = '300ms'`);
      const err = await expectSqlState(run(), LOCK_TIMEOUT);
      expect(err.message).toMatch(/lock timeout/);
    } finally {
      await app.query('ROLLBACK');
      await blocker.query('ROLLBACK');
    }
  }

  it('merchant operations lock the acting owner’s membership', async () => {
    const b = await business();
    const staff = await member(b, 'staff');
    await waitsFor('tenancy.merchant_memberships', b.ownerMembershipId, () =>
      call.updateMembership(b.ownerSession, staff.membershipId, 'deactivate', null),
    );
    await waitsFor('tenancy.merchant_memberships', b.ownerMembershipId, () =>
      call.issue(b.ownerSession, email('x')),
    );
  });

  it('platform operations lock the acting super admin’s platform membership', async () => {
    const admin = await platformMember('super_admin');
    const b = await business();
    await waitsFor('identity.platform_memberships', admin.membershipId, () =>
      call.setStatus(admin.session, b.merchantId, 'deactivate'),
    );
  });
});

describe('no actor can be supplied: the parameters are the session, the targets and the request context', () => {
  it.each([
    [
      'update_membership',
      'p_session_id p_membership_id p_action p_role_id p_branch_id p_ip p_user_agent p_request_id',
    ],
    [
      'issue_invitation',
      'p_session_id p_email p_kind p_role_id p_branch_id p_token_hash p_setup_token_hash p_ttl_seconds p_ip p_user_agent p_request_id',
    ],
    ['revoke_invitation', 'p_session_id p_invitation_id p_ip p_user_agent p_request_id'],
    ['set_merchant_status', 'p_session_id p_merchant_id p_action p_reason p_ip p_user_agent p_request_id'],
    [
      'transfer_ownership',
      'p_session_id p_merchant_id p_new_owner_membership_id p_former_owner_role_id p_deactivate_former p_ip p_user_agent p_request_id',
    ],
  ])('tenancy.%s', async (name, expected) => {
    const { rows } = await owner.query(
      `SELECT array_to_string(p.proargnames[1:p.pronargs], ' ') AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'tenancy' AND p.proname = $1`,
      [name],
    );
    expect(rows).toEqual([{ args: expected }]);
  });
});

describe('list_members reads by permission (merchant.members.read), no longer by the owner’s kind', () => {
  it('the owner sees the business’s members; staff with no grant see nothing; a grant would open it (P5.6)', async () => {
    const b = await business();
    const staff = await member(b, 'staff');
    const list = (s: string) => app.query(`SELECT membership_id FROM tenancy.list_members($1)`, [s]);
    expect((await list(b.ownerSession)).rows.map((r) => r.membership_id).sort()).toEqual(
      [b.ownerMembershipId, staff.membershipId].sort(),
    );
    expect((await list(staff.session)).rows).toEqual([]);
    await owner.query(
      `INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission) VALUES ($1, $2, 'merchant.members.read')`,
      [b.merchantId, b.roleId],
    );
    expect((await list(staff.session)).rows).toHaveLength(2);
  });
});
