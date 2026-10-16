import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState } from './support/db.js';

// The platform team (P5.7; P5 plan §7.4, §7.5, §10 P5.7; §8.1 #30, #31, #32, #37; owner decisions D4, O8(a), O8(b)).
// identity.create_platform_staff, identity.set_platform_staff_status and identity.set_platform_grants are the super
// admin's alone (platform.staff.manage, reserved); identity.list_platform_staff is their B1 reader. Called as the API
// calls them (alphakolect_app); effects read as the table owner.

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
  ip: '203.0.113.40',
  userAgent: 'platform-staff-test',
  requestId: `ps-${randomBytes(6).toString('hex')}`,
});
type Ctx = ReturnType<typeof ctx>;
const one = async (sql: string, params: unknown[]) => (await owner.query(sql, params)).rows[0];
const SETUP_TTL = 86400;
const GRANTABLE = ['platform.audit.read', 'platform.merchants.read'];
const ALL_PLATFORM = [
  'platform.audit.read',
  'platform.merchants.lifecycle',
  'platform.merchants.read',
  'platform.merchants.transfer_ownership',
  'platform.staff.manage',
];

async function session(identityId: string, membershipId: string, scope = 'full') {
  // An enrolment-only session lives 15 minutes (D8); a full platform session 1 hour idle, 12 hours at most.
  const [idle, absolute] = scope === 'mfa_enrollment' ? [900, 900] : [3600, 43200];
  const {
    rows: [s],
  } = await app.query(
    `SELECT * FROM identity.create_session($1, 'platform', $2, $3, $4, $5, $6, NULL, NULL)`,
    [identityId, membershipId, scope, hash(), idle, absolute],
  );
  return s.session_id as string;
}

/** A platform member with a confirmed second factor (platform sessions require one), its grants, and a session. */
async function member(role: 'super_admin' | 'support' | 'verification' | 'finance', grants: string[] = []) {
  const identityId = (
    await one(
      `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
      [email(role), ARGON],
    )
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
  return { identityId, membershipId, session: await session(identityId, membershipId) };
}

/** A signed-up, verified business owner and their merchant session. */
async function merchantOwner() {
  const ownerEmail = email('owner');
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Staff Test Ltd')`, [
    ownerEmail,
    ARGON,
  ]);
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
  return { email: ownerEmail, identityId: s.identity_id as string, session: m.session_id as string };
}

const create = (sessionId: string, to: string, role = 'support', c: Ctx = ctx(), ttl = SETUP_TTL) =>
  app
    .query(`SELECT * FROM identity.create_platform_staff($1, $2, $3, $4, $5, $6, $7, $8)`, [
      sessionId,
      to,
      role,
      hash(),
      ttl,
      c.ip,
      c.userAgent,
      c.requestId,
    ])
    .then(
      (r) =>
        r.rows[0] as { outcome: string; membership_id: string | null; membership_created_at: Date | null },
    );
const setStatus = (sessionId: string, membershipId: string, action: string, c: Ctx = ctx()) =>
  app
    .query(`SELECT * FROM identity.set_platform_staff_status($1, $2, $3, $4, $5, $6)`, [
      sessionId,
      membershipId,
      action,
      c.ip,
      c.userAgent,
      c.requestId,
    ])
    .then((r) => r.rows[0] as { outcome: string; new_status: string | null });
const setGrants = (
  sessionId: string,
  membershipId: string,
  permissions: (string | null)[] | null,
  c: Ctx = ctx(),
) =>
  app
    .query(`SELECT * FROM identity.set_platform_grants($1, $2, $3, $4, $5, $6)`, [
      sessionId,
      membershipId,
      permissions,
      c.ip,
      c.userAgent,
      c.requestId,
    ])
    .then((r) => r.rows[0] as { outcome: string; permissions: string[] | null });
const list = (
  sessionId: string,
  opts: { membershipId?: string; limit?: number; after?: [Date, string] } = {},
) =>
  app
    .query(`SELECT * FROM identity.list_platform_staff($1, $2, $3, $4, $5)`, [
      sessionId,
      opts.membershipId ?? null,
      opts.limit ?? 50,
      opts.after?.[0] ?? null,
      opts.after?.[1] ?? null,
    ])
    .then((r) => r.rows);
const grantsOf = async (membershipId: string) =>
  (
    await owner.query(
      `SELECT permission FROM identity.platform_membership_grants WHERE platform_membership_id = $1 ORDER BY 1`,
      [membershipId],
    )
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
  ((await one(`SELECT permissions FROM identity.session_authority($1)`, [sessionId]))?.permissions ??
    null) as string[] | null;
const membership = (id: string) =>
  one(
    `SELECT role, status, deactivated_at IS NOT NULL AS has_deactivated_at FROM identity.platform_memberships WHERE id = $1`,
    [id],
  );
const identityCount = async (address: string) =>
  Number((await one(`SELECT count(*)::int AS n FROM identity.identities WHERE email = $1`, [address])).n);

describe('creating a staff member (#30)', () => {
  it('the super admin creates a passwordless identity, its membership with no grants and a setup token; #30 records it', async () => {
    const admin = await member('super_admin');
    const to = email('new-staff');
    const c = ctx();
    const created = await create(admin.session, `  ${to.toUpperCase()} `, 'verification', c);
    expect(created).toMatchObject({ outcome: 'ok', membership_id: expect.any(String) });
    const id = created.membership_id!;
    const identity = await one(
      `SELECT i.email, i.password_hash, i.email_verified_at FROM identity.identities i
         JOIN identity.platform_memberships pm ON pm.identity_id = i.id WHERE pm.id = $1`,
      [id],
    );
    // The email is normalised; no password and no verification until the person completes account setup.
    expect(identity).toEqual({ email: to, password_hash: null, email_verified_at: null });
    expect(await membership(id)).toEqual({
      role: 'verification',
      status: 'active',
      has_deactivated_at: false,
    });
    expect(await grantsOf(id)).toEqual([]);
    const tokens = (
      await owner.query(
        `SELECT t.purpose, t.consumed_at, t.expires_at - now() AS ttl FROM identity.one_time_tokens t
           JOIN identity.platform_memberships pm ON pm.identity_id = t.identity_id WHERE pm.id = $1`,
        [id],
      )
    ).rows;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ purpose: 'account_setup', consumed_at: null });
    expect(await eventsOf(c.requestId)).toEqual([
      {
        merchant_id: null,
        actor_identity_id: admin.identityId,
        actor_audience: 'platform',
        actor_membership_id: admin.membershipId,
        action: 'platform.staff_created',
        target_type: 'platform_membership',
        target_id: id,
        outcome: 'success',
        ip: c.ip,
        user_agent: c.userAgent,
        request_id: c.requestId,
        summary: { role: 'verification' },
      },
    ]);
  });

  it('the role is a label (D4): a session of the new member resolves no permission at all', async () => {
    const admin = await member('super_admin');
    const created = await create(admin.session, email('label'), 'finance');
    const identityId = (
      await one(`SELECT identity_id FROM identity.platform_memberships WHERE id = $1`, [
        created.membership_id,
      ])
    ).identity_id as string;
    await owner.query(
      `UPDATE identity.identities SET password_hash = $2, email_verified_at = now() WHERE id = $1`,
      [identityId, ARGON],
    );
    await owner.query(
      `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at)
       VALUES ($1, '\\x00', 'k1', now())`,
      [identityId],
    );
    expect(await resolved(await session(identityId, created.membership_id!))).toEqual([]);
  });

  it('a super admin, an unknown role or a setup lifetime out of range is refused by raising — nothing is created', async () => {
    const admin = await member('super_admin');
    for (const [role, ttl] of [
      ['super_admin', SETUP_TTL],
      ['admin', SETUP_TTL],
      ['support', 30],
      ['support', 86401],
    ] as const) {
      const to = email('bad');
      await expectSqlState(create(admin.session, to, role, ctx(), ttl), '23514');
      expect(await identityCount(to)).toBe(0);
    }
  });

  it('an email that already has an account is refused (O8(a)) — a business account or a platform one; nothing written', async () => {
    const admin = await member('super_admin');
    const business = await merchantOwner();
    const existingStaff = await create(admin.session, email('first'), 'support');
    const staffEmail = (
      await one(
        `SELECT i.email FROM identity.identities i JOIN identity.platform_memberships pm ON pm.identity_id = i.id WHERE pm.id = $1`,
        [existingStaff.membership_id],
      )
    ).email as string;
    for (const to of [business.email, ` ${business.email.toUpperCase()}`, staffEmail]) {
      const c = ctx();
      expect(await create(admin.session, to, 'support', c)).toEqual({
        outcome: 'email_in_use',
        membership_id: null,
        membership_created_at: null,
      });
      expect(await eventsOf(c.requestId)).toEqual([]);
    }
    expect(
      Number(
        (
          await one(`SELECT count(*)::int AS n FROM identity.platform_memberships WHERE identity_id = $1`, [
            business.identityId,
          ])
        ).n,
      ),
    ).toBe(0);
  });

  it('only the super admin: staff holding every grantable permission, a merchant owner and a dead session are refused', async () => {
    const staff = await member('support', GRANTABLE);
    const business = await merchantOwner();
    const ended = await member('super_admin');
    await app.query(`SELECT identity.revoke_session($1, 'test')`, [ended.session]);
    for (const s of [
      staff.session,
      business.session,
      ended.session,
      '01900000-0000-7000-8000-0000000000ad',
    ]) {
      const to = email('refused');
      const c = ctx();
      expect((await create(s, to, 'support', c)).outcome).toBe('forbidden');
      expect(await identityCount(to)).toBe(0);
      expect(await eventsOf(c.requestId)).toEqual([]);
    }
  });
});

describe('deactivating and reactivating a staff member (#31, #37)', () => {
  it('deactivation: the membership is deactivated, its grants removed and its sessions revoked; #31 lists the grants', async () => {
    const admin = await member('super_admin');
    const staff = await member('support', GRANTABLE);
    const enrolment = await session(staff.identityId, staff.membershipId, 'mfa_enrollment');
    const c = ctx();
    expect(await setStatus(admin.session, staff.membershipId, 'deactivate', c)).toEqual({
      outcome: 'ok',
      new_status: 'deactivated',
    });
    expect(await membership(staff.membershipId)).toEqual({
      role: 'support',
      status: 'deactivated',
      has_deactivated_at: true,
    });
    expect(await grantsOf(staff.membershipId)).toEqual([]);
    const open = await one(
      `SELECT count(*)::int AS n FROM identity.sessions WHERE platform_membership_id = $1 AND revoked_at IS NULL`,
      [staff.membershipId],
    );
    expect(open.n).toBe(0);
    expect(await resolved(staff.session)).toBeNull();
    expect(await resolved(enrolment)).toBeNull();
    expect(await eventsOf(c.requestId)).toEqual([
      expect.objectContaining({
        merchant_id: null,
        actor_identity_id: admin.identityId,
        actor_audience: 'platform',
        actor_membership_id: admin.membershipId,
        action: 'platform.staff_deactivated',
        target_type: 'platform_membership',
        target_id: staff.membershipId,
        outcome: 'success',
        summary: { grantsRemoved: GRANTABLE, sessionsRevoked: 2 },
      }),
    ]);
    // A deactivated member can no longer sign in.
    const eligible = await one(
      `SELECT eligible_count FROM identity.resolve_login_membership($1, 'platform', $2)`,
      [staff.identityId, hash()],
    );
    expect(eligible.eligible_count).toBe(0);
  });

  it('reactivation (O8(b)): active again with no grants; #37; the member can sign in again', async () => {
    const admin = await member('super_admin');
    const staff = await member('support', ['platform.merchants.read']);
    await setStatus(admin.session, staff.membershipId, 'deactivate');
    const c = ctx();
    expect(await setStatus(admin.session, staff.membershipId, 'reactivate', c)).toEqual({
      outcome: 'ok',
      new_status: 'active',
    });
    expect(await membership(staff.membershipId)).toEqual({
      role: 'support',
      status: 'active',
      has_deactivated_at: false,
    });
    expect(await grantsOf(staff.membershipId)).toEqual([]);
    expect(await eventsOf(c.requestId)).toEqual([
      expect.objectContaining({
        action: 'platform.staff_reactivated',
        target_id: staff.membershipId,
        actor_membership_id: admin.membershipId,
        summary: {},
      }),
    ]);
    expect(await resolved(await session(staff.identityId, staff.membershipId))).toEqual([]);
  });

  it('refusals write nothing: the super admin or an unknown id is not found; a repeated change is no transition; staff are forbidden', async () => {
    const admin = await member('super_admin');
    const otherAdmin = await member('super_admin');
    const staff = await member('support', GRANTABLE);
    const cases: [string, string, string, string][] = [
      [admin.session, otherAdmin.membershipId, 'deactivate', 'not_found'],
      [admin.session, admin.membershipId, 'deactivate', 'not_found'],
      [admin.session, '01900000-0000-7000-8000-0000000000ae', 'deactivate', 'not_found'],
      [admin.session, staff.membershipId, 'reactivate', 'invalid_transition'],
      [staff.session, staff.membershipId, 'deactivate', 'forbidden'],
    ];
    for (const [s, target, action, outcome] of cases) {
      const c = ctx();
      expect((await setStatus(s, target, action, c)).outcome, `${action} → ${outcome}`).toBe(outcome);
      expect(await eventsOf(c.requestId)).toEqual([]);
    }
    expect(await membership(staff.membershipId)).toMatchObject({ status: 'active' });
    expect(await grantsOf(staff.membershipId)).toEqual(GRANTABLE);
    expect(await membership(otherAdmin.membershipId)).toMatchObject({ status: 'active' });
    await setStatus(admin.session, staff.membershipId, 'deactivate');
    expect((await setStatus(admin.session, staff.membershipId, 'deactivate')).outcome).toBe(
      'invalid_transition',
    );
    await expectSqlState(setStatus(admin.session, staff.membershipId, 'suspend'), '23514');
  });
});

describe('a staff member’s grants (#32)', () => {
  it('the super admin replaces the set; #32 records it before and after; the member then holds exactly that', async () => {
    const admin = await member('super_admin');
    const staff = await member('support');
    expect(await resolved(staff.session)).toEqual([]);
    const c = ctx();
    expect(await setGrants(admin.session, staff.membershipId, ['platform.merchants.read'], c)).toEqual({
      outcome: 'ok',
      permissions: ['platform.merchants.read'],
    });
    // One grant ⇒ exactly that, from the member's next request.
    expect(await resolved(staff.session)).toEqual(['platform.merchants.read']);
    expect(await eventsOf(c.requestId)).toEqual([
      {
        merchant_id: null,
        actor_identity_id: admin.identityId,
        actor_audience: 'platform',
        actor_membership_id: admin.membershipId,
        action: 'platform.grants_set',
        target_type: 'platform_membership',
        target_id: staff.membershipId,
        outcome: 'success',
        ip: c.ip,
        user_agent: c.userAgent,
        request_id: c.requestId,
        summary: { before: [], after: ['platform.merchants.read'] },
      },
    ]);
    const c2 = ctx();
    await setGrants(admin.session, staff.membershipId, ['platform.audit.read'], c2);
    expect(await grantsOf(staff.membershipId)).toEqual(['platform.audit.read']);
    expect((await eventsOf(c2.requestId))[0].summary).toEqual({
      before: ['platform.merchants.read'],
      after: ['platform.audit.read'],
    });
    // A revoked grant is gone on the next request.
    await setGrants(admin.session, staff.membershipId, []);
    expect(await resolved(staff.session)).toEqual([]);
  });

  it('only active, grantable platform permissions, each once: anything else is refused and changes nothing', async () => {
    const admin = await member('super_admin');
    const staff = await member('support', ['platform.audit.read']);
    for (const permissions of [
      ['platform.merchants.lifecycle'],
      ['platform.merchants.transfer_ownership'],
      ['platform.staff.manage'],
      ['merchant.profile.read'],
      ['platform.unknown.read'],
      ['platform.merchants.read', 'platform.merchants.read'],
      ['platform.merchants.read', null],
      null,
    ]) {
      const c = ctx();
      expect(
        (await setGrants(admin.session, staff.membershipId, permissions, c)).outcome,
        JSON.stringify(permissions),
      ).toBe('invalid_permissions');
      expect(await eventsOf(c.requestId)).toEqual([]);
    }
    expect(await grantsOf(staff.membershipId)).toEqual(['platform.audit.read']);
  });

  it('a deactivated member gets none (no transition); the super admin and an unknown id are not found; staff are forbidden', async () => {
    const admin = await member('super_admin');
    const asleep = await member('finance');
    await setStatus(admin.session, asleep.membershipId, 'deactivate');
    const staff = await member('support', GRANTABLE);
    expect((await setGrants(admin.session, asleep.membershipId, ['platform.merchants.read'])).outcome).toBe(
      'invalid_transition',
    );
    expect((await setGrants(admin.session, admin.membershipId, [])).outcome).toBe('not_found');
    expect((await setGrants(admin.session, '01900000-0000-7000-8000-0000000000af', [])).outcome).toBe(
      'not_found',
    );
    expect((await setGrants(staff.session, asleep.membershipId, [])).outcome).toBe('forbidden');
    expect((await setGrants(staff.session, staff.membershipId, [])).outcome).toBe('forbidden');
    expect(await grantsOf(asleep.membershipId)).toEqual([]);
    expect(await grantsOf(staff.membershipId)).toEqual(GRANTABLE);
  });

  it('the reserved permissions stay the super admin’s: staff holding every grant are refused lifecycle, transfer and staff changes', async () => {
    const staff = await member('support', GRANTABLE);
    expect(await resolved(staff.session)).toEqual(GRANTABLE);
    const business = await merchantOwner();
    const merchantId = (
      await one(`SELECT merchant_id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
        business.identityId,
      ])
    ).merchant_id as string;
    expect(
      (
        await app.query(
          `SELECT outcome FROM tenancy.set_merchant_status($1, $2, 'deactivate', 'not theirs')`,
          [staff.session, merchantId],
        )
      ).rows[0].outcome,
    ).toBe('forbidden');
    expect((await create(staff.session, email('nope'))).outcome).toBe('forbidden');
    // The grant table itself refuses a reserved permission, whoever writes it (P5.1).
    await expectSqlState(
      owner.query(
        `INSERT INTO identity.platform_membership_grants (platform_membership_id, permission) VALUES ($1, 'platform.staff.manage')`,
        [staff.membershipId],
      ),
      '23514',
    );
  });

  it('a grant belongs to its membership: it authorizes no other membership, and an identity holds one platform membership', async () => {
    const granted = await member('support', ['platform.merchants.read']);
    const other = await member('support');
    expect(await resolved(granted.session)).toEqual(['platform.merchants.read']);
    expect(await resolved(other.session)).toEqual([]);
    // A second platform membership of the granted identity cannot exist (UNIQUE identity_id), so the grant can never
    // reach one: the resolver reads the session's own membership only.
    await expectSqlState(
      owner.query(`INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'finance')`, [
        granted.identityId,
      ]),
      '23505',
    );
  });

  it('the super admin is unchanged: every platform permission, from the role, with no grant rows', async () => {
    const admin = await member('super_admin');
    expect(await resolved(admin.session)).toEqual(ALL_PLATFORM);
    expect(await grantsOf(admin.membershipId)).toEqual([]);
  });
});

describe('the team (identity.list_platform_staff, a B1 reader)', () => {
  it('newest first, each with their grants; the super admin is not listed; one member by id; a page ends with one row more', async () => {
    const admin = await member('super_admin');
    const created: string[] = [];
    for (let i = 0; i < 3; i++)
      created.push((await create(admin.session, email(`team${i}`), 'support')).membership_id!);
    await setGrants(admin.session, created[1]!, ['platform.merchants.read']);
    const page = await list(admin.session, { limit: 2 });
    expect(page.map((r) => r.id)).toEqual([created[2], created[1], created[0]]);
    expect(page[1]).toMatchObject({
      role: 'support',
      status: 'active',
      permissions: ['platform.merchants.read'],
    });
    expect((await list(admin.session)).map((r) => r.role)).not.toContain('super_admin');
    const continued = await list(admin.session, { limit: 2, after: [page[1]!.created_at, page[1]!.id] });
    expect(continued[0]!.id).toBe(created[0]);
    expect(await list(admin.session, { membershipId: created[1] })).toEqual([page[1]]);
    expect(await list(admin.session, { membershipId: admin.membershipId })).toEqual([]);
  });

  it('nothing for anyone but the super admin; a page size out of range or half a cursor raises', async () => {
    const staff = await member('support', GRANTABLE);
    const business = await merchantOwner();
    expect(await list(staff.session)).toEqual([]);
    expect(await list(business.session)).toEqual([]);
    const admin = await member('super_admin');
    for (const limit of [0, 101]) await expectSqlState(list(admin.session, { limit }), '22023');
    await expectSqlState(
      app.query(`SELECT * FROM identity.list_platform_staff($1, NULL, 10, now(), NULL)`, [admin.session]),
      '22023',
    );
  });
});

describe('the footprint (§7.5): the actor’s platform membership, and the target’s, are held', () => {
  async function waitsFor(id: string, run: () => Promise<unknown>) {
    await blocker.query('BEGIN');
    await blocker.query(`SELECT 1 FROM identity.platform_memberships WHERE id = $1 FOR UPDATE`, [id]);
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

  it('each writer waits for the actor’s row; the status and grant writers also for the target’s', async () => {
    const admin = await member('super_admin');
    const staff = await member('support');
    await waitsFor(admin.membershipId, () => create(admin.session, email('wait')));
    await waitsFor(admin.membershipId, () => setGrants(admin.session, staff.membershipId, []));
    await waitsFor(staff.membershipId, () => setGrants(admin.session, staff.membershipId, []));
    await waitsFor(staff.membershipId, () => setStatus(admin.session, staff.membershipId, 'deactivate'));
  });
});

describe('no actor can be supplied', () => {
  it.each([
    [
      'create_platform_staff',
      'p_session_id p_email p_role p_setup_token_hash p_ttl_seconds p_ip p_user_agent p_request_id',
    ],
    ['set_platform_staff_status', 'p_session_id p_membership_id p_action p_ip p_user_agent p_request_id'],
    ['set_platform_grants', 'p_session_id p_membership_id p_permissions p_ip p_user_agent p_request_id'],
  ])('identity.%s(%s)', async (fn, args) => {
    const f = await one(
      `SELECT array_to_string(p.proargnames[1:p.pronargs], ' ') AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'identity' AND p.proname = $1`,
      [fn],
    );
    expect(f.args).toBe(args);
  });
});
