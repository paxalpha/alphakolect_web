import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState } from './support/db.js';

// P4.5 (ADR-15 T17): tenancy.transfer_ownership, called as alphakolect_app. Super admin only (from the session);
// the new owner is an active, verified staff member of the same business; the former owner becomes staff with the
// chosen role, optionally deactivated; demote and promote commit together; sessions follow the new state at once.

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  app = await connectAs('app');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await Promise.all([app.end(), owner.end()]);
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;

async function session(identityId: string, audience: string, membershipId: string) {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.create_session($1, $2, $3, 'full', $4, $5, $6, NULL, NULL)`, [
    identityId,
    audience,
    membershipId,
    hash(),
    audience === 'platform' ? 3600 : 86400,
    audience === 'platform' ? 43200 : 1209600,
  ]);
  return s.session_id as string;
}

async function platformAdmin(role = 'super_admin') {
  const {
    rows: [identity],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
    [email('admin')],
  );
  const {
    rows: [pm],
  } = await owner.query(
    `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, $2) RETURNING id`,
    [identity.id, role],
  );
  await owner.query(
    `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at) VALUES ($1, '\\x00', 'k1', now())`,
    [identity.id],
  );
  return {
    identityId: identity.id as string,
    membershipId: pm.id as string,
    session: await session(identity.id, 'platform', pm.id),
  };
}

async function member(merchantId: string, kind: 'staff' | 'agent', roleId: string | null, verified = true) {
  const {
    rows: [identity],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, $2) RETURNING id`,
    [email(kind), verified ? new Date() : null],
  );
  const {
    rows: [m],
  } = await owner.query(
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [merchantId, identity.id, kind, roleId],
  );
  return {
    identityId: identity.id as string,
    membershipId: m.id as string,
    session: verified ? await session(identity.id, kind === 'agent' ? 'agent' : 'merchant', m.id) : null,
  };
}

async function business() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Transfer Ltd')`, [
    email('owner'),
    ARGON,
  ]);
  const token = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    token,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [token]);
  const merchantId = s.merchant_id as string;
  const {
    rows: [o],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  const {
    rows: [role],
  } = await owner.query(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Manager') RETURNING id`, [
    merchantId,
  ]);
  const {
    rows: [archived],
  } = await owner.query(
    `INSERT INTO tenancy.roles (merchant_id, name, status, archived_at) VALUES ($1, 'Old', 'archived', now()) RETURNING id`,
    [merchantId],
  );
  return {
    merchantId,
    roleId: role.id as string,
    archivedRoleId: archived.id as string,
    owner: {
      identityId: s.identity_id as string,
      membershipId: o.id as string,
      session: await session(s.identity_id, 'merchant', o.id),
    },
    staff: await member(merchantId, 'staff', role.id),
  };
}

const transfer = async (
  sessionId: string,
  merchantId: string,
  newOwner: string,
  roleId: string | null,
  deactivate: boolean | null = false,
) =>
  (
    await app.query(`SELECT * FROM tenancy.transfer_ownership($1, $2, $3, $4, $5)`, [
      sessionId,
      merchantId,
      newOwner,
      roleId,
      deactivate,
    ])
  ).rows[0];

const membership = async (id: string) =>
  (
    await owner.query(
      `SELECT kind, status, role_id, branch_id FROM tenancy.merchant_memberships WHERE id = $1`,
      [id],
    )
  ).rows[0];

const context = async (sessionId: string) =>
  (await app.query(`SELECT kind, role_id FROM identity.validate_session($1)`, [sessionId])).rows[0] ?? null;

let admin: Awaited<ReturnType<typeof platformAdmin>>;
beforeAll(async () => {
  admin = await platformAdmin();
});

describe('a transfer', () => {
  it('swaps owner and staff atomically; both sessions follow on the next check (T5)', async () => {
    const b = await business();
    expect(await transfer(admin.session, b.merchantId, b.staff.membershipId, b.roleId)).toEqual({
      outcome: 'ok',
      former_owner_membership_id: b.owner.membershipId,
      former_owner_identity_id: b.owner.identityId,
      new_owner_identity_id: b.staff.identityId,
      actor_identity_id: admin.identityId,
      actor_membership_id: admin.membershipId,
    });
    expect(await membership(b.staff.membershipId)).toEqual({
      kind: 'owner',
      status: 'active',
      role_id: null,
      branch_id: null,
    });
    expect(await membership(b.owner.membershipId)).toEqual({
      kind: 'staff',
      status: 'active',
      role_id: b.roleId,
      branch_id: null,
    });
    expect(await context(b.staff.session!)).toEqual({ kind: 'owner', role_id: null });
    expect(await context(b.owner.session)).toEqual({ kind: 'staff', role_id: b.roleId });
  });

  it('optionally deactivates the former owner, revoking their sessions', async () => {
    const b = await business();
    expect((await transfer(admin.session, b.merchantId, b.staff.membershipId, b.roleId, true)).outcome).toBe(
      'ok',
    );
    expect(await membership(b.owner.membershipId)).toMatchObject({ kind: 'staff', status: 'deactivated' });
    expect(await context(b.owner.session)).toBeNull();
    const {
      rows: [s],
    } = await owner.query(`SELECT revoke_reason FROM identity.sessions WHERE id = $1`, [b.owner.session]);
    expect(s.revoke_reason).toBe('ownership_transferred');
    expect(await context(b.staff.session!)).toEqual({ kind: 'owner', role_id: null });
  });

  it('can be reversed by a second transfer', async () => {
    const b = await business();
    await transfer(admin.session, b.merchantId, b.staff.membershipId, b.roleId);
    expect((await transfer(admin.session, b.merchantId, b.owner.membershipId, b.roleId)).outcome).toBe('ok');
    expect((await membership(b.owner.membershipId)).kind).toBe('owner');
    expect((await membership(b.staff.membershipId)).kind).toBe('staff');
  });
});

describe('refusals change nothing', () => {
  async function expectUnchanged(b: Awaited<ReturnType<typeof business>>) {
    expect((await membership(b.owner.membershipId)).kind).toBe('owner');
    expect((await membership(b.staff.membershipId)).kind).toBe('staff');
  }

  it('only a super admin’s full platform session — never another platform role or a merchant owner', async () => {
    const b = await business();
    const support = await platformAdmin('support');
    // A super admin who has not enrolled TOTP yet holds only an enrolment-scoped session (D8).
    const {
      rows: [pending],
    } = await owner.query(`SELECT identity.bootstrap_super_admin($1, true) AS id`, [email('enrolling')]);
    const {
      rows: [pm],
    } = await owner.query(`SELECT id FROM identity.platform_memberships WHERE identity_id = $1`, [
      pending.id,
    ]);
    const {
      rows: [enrolment],
    } = await app.query(
      `SELECT * FROM identity.create_session($1, 'platform', $2, 'mfa_enrollment', $3, 900, 900, NULL, NULL)`,
      [pending.id, pm.id, hash()],
    );
    for (const caller of [support.session, enrolment.session_id, b.owner.session, b.staff.session!]) {
      expect((await transfer(caller, b.merchantId, b.staff.membershipId, b.roleId)).outcome).toBe(
        'forbidden',
      );
    }
    await expectUnchanged(b);
  });

  it('an unknown merchant is not found', async () => {
    const b = await business();
    expect(
      (await transfer(admin.session, '01900000-0000-7000-8000-00000000beef', b.staff.membershipId, b.roleId))
        .outcome,
    ).toBe('not_found');
  });

  it('the new owner must be an active, verified staff member of this business', async () => {
    const b = await business();
    const other = await business();
    const agent = await member(b.merchantId, 'agent', null);
    const unverified = await member(b.merchantId, 'staff', b.roleId, false);
    const inactive = await member(b.merchantId, 'staff', b.roleId);
    await owner.query(
      `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [inactive.membershipId],
    );
    const suspended = await member(b.merchantId, 'staff', b.roleId);
    await owner.query(`UPDATE identity.identities SET status = 'disabled' WHERE id = $1`, [
      suspended.identityId,
    ]);

    for (const candidate of [
      agent.membershipId,
      unverified.membershipId,
      inactive.membershipId,
      suspended.membershipId,
      other.staff.membershipId, // another business's staff member
      b.owner.membershipId, // already the owner
    ]) {
      expect((await transfer(admin.session, b.merchantId, candidate, b.roleId)).outcome, candidate).toBe(
        'invalid_new_owner',
      );
    }
    await expectUnchanged(b);
    expect((await membership(other.staff.membershipId)).kind).toBe('staff');
  });

  it('the former owner’s role must be an active role of this business (T8)', async () => {
    const b = await business();
    const other = await business();
    for (const roleId of [null, b.archivedRoleId, other.roleId]) {
      expect((await transfer(admin.session, b.merchantId, b.staff.membershipId, roleId)).outcome).toBe(
        'invalid_role',
      );
    }
    await expectUnchanged(b);
  });

  it('the deactivation choice is required', async () => {
    const b = await business();
    await expectSqlState(
      transfer(admin.session, b.merchantId, b.staff.membershipId, b.roleId, null),
      '22004', // null_value_not_allowed
    );
    await expectUnchanged(b);
  });
});

describe('grants', () => {
  it('executable by the app only', async () => {
    const sig = 'tenancy.transfer_ownership(uuid, uuid, uuid, uuid, boolean, text, text, text)';
    const { rows } = await owner.query(
      `SELECT has_function_privilege('alphakolect_app', $1, 'EXECUTE') AS app,
              has_function_privilege('alphakolect_readonly', $1, 'EXECUTE') AS ro`,
      [sig],
    );
    expect(rows[0]).toEqual({ app: true, ro: false });
  });
});
