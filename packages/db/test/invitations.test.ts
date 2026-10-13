import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';

// P4.6 (ADR-15 T10, T11, T16; D12): invitations, called as the API calls them (alphakolect_app). Issuing and
// revoking need the owner's session; acceptance — with the password (existing account) or by completing account
// setup (new account) — re-checks everything at that moment. Replay, expiry, revocation, a deactivated business, an
// archived role, the wrong person: none of them creates a membership.

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
const DAY = 86400;

async function session(identityId: string, audience: string, membershipId: string) {
  const {
    rows: [s],
  } = await app.query(
    `SELECT * FROM identity.create_session($1, $2, $3, 'full', $4, 86400, 1209600, NULL, NULL)`,
    [identityId, audience, membershipId, hash()],
  );
  return s.session_id as string;
}

/** An active business: owner with a session, an active and an archived role, a branch, and a staff member. */
async function business() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Invites Ltd')`, [
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
  const one = async (sql: string) => (await owner.query(sql, [merchantId])).rows[0].id as string;
  const roleId = await one(
    `INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Cashier') RETURNING id`,
  );
  const archivedRoleId = await one(
    `INSERT INTO tenancy.roles (merchant_id, name, status, archived_at) VALUES ($1, 'Old', 'archived', now()) RETURNING id`,
  );
  const branchId = await one(
    `INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, 'Ikeja') RETURNING id`,
  );
  const {
    rows: [staffIdentity],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
    [email('staff'), ARGON],
  );
  const {
    rows: [staff],
  } = await owner.query(
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, 'staff', $3) RETURNING id`,
    [merchantId, staffIdentity.id, roleId],
  );
  return {
    merchantId,
    roleId,
    archivedRoleId,
    branchId,
    ownerSession: await session(s.identity_id, 'merchant', o.id),
    staffSession: await session(staffIdentity.id, 'merchant', staff.id),
    staffIdentityId: staffIdentity.id as string,
  };
}

/** An existing account: verified, with a password (unless told otherwise). */
async function account({ verified = true, status = 'active' } = {}) {
  const address = email('person');
  const {
    rows: [i],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at, password_hash, status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [address, verified ? new Date() : null, ARGON, status],
  );
  return { email: address, identityId: i.id as string };
}

type Issued = {
  outcome: string;
  invitation_id: string | null;
  expires_at: Date | null;
  delivery: string | null;
};
async function issue(
  sessionId: string,
  to: string,
  kind: string,
  roleId: string | null = null,
  branchId: string | null = null,
  ttl = DAY,
) {
  const token = hash();
  const setup = hash();
  const {
    rows: [r],
  } = await app.query<Issued>(`SELECT * FROM tenancy.issue_invitation($1, $2, $3, $4, $5, $6, $7, $8)`, [
    sessionId,
    to,
    kind,
    roleId,
    branchId,
    token,
    setup,
    ttl,
  ]);
  return { ...r!, token, setup };
}

const accept = async (token: string, identityId: string) =>
  (await app.query(`SELECT * FROM tenancy.accept_invitation($1, $2)`, [token, identityId])).rows[0];

const invitation = async (id: string) =>
  (
    await owner.query(
      `SELECT email, kind, role_id, branch_id, identity_id, accepted_at, accepted_membership_id, revoked_at
         FROM tenancy.invitations WHERE id = $1`,
      [id],
    )
  ).rows[0];

const membershipOf = async (merchantId: string, identityId: string) =>
  (
    await owner.query(
      `SELECT id, kind, role_id, branch_id, status FROM tenancy.merchant_memberships
        WHERE merchant_id = $1 AND identity_id = $2`,
      [merchantId, identityId],
    )
  ).rows[0] ?? null;

const identityByEmail = async (address: string) =>
  (
    await owner.query(
      `SELECT id, password_hash, email_verified_at FROM identity.identities WHERE email = lower(btrim($1))`,
      [address],
    )
  ).rows[0] ?? null;

let A: Awaited<ReturnType<typeof business>>;
let B: Awaited<ReturnType<typeof business>>;
beforeAll(async () => {
  A = await business();
  B = await business();
});

describe('issue_invitation', () => {
  it('a new email: a passwordless identity, an account-setup link, no membership — same answer shape as an existing one', async () => {
    const address = email('New.Person');
    const r = await issue(A.ownerSession, `  ${address.toUpperCase()} `, 'staff', A.roleId, A.branchId);
    expect(r).toMatchObject({ outcome: 'ok', delivery: 'setup', expires_at: expect.any(Date) });

    const identity = await identityByEmail(address);
    expect(identity).toMatchObject({ password_hash: null, email_verified_at: null });
    expect(await invitation(r.invitation_id!)).toMatchObject({
      email: address.toLowerCase(),
      kind: 'staff',
      role_id: A.roleId,
      branch_id: A.branchId,
      identity_id: identity.id,
      accepted_at: null,
    });
    const { rows: setups } = await owner.query(
      `SELECT 1 FROM identity.one_time_tokens WHERE identity_id = $1 AND purpose = 'account_setup' AND token_hash = $2`,
      [identity.id, r.setup],
    );
    expect(setups).toHaveLength(1);
    expect(await membershipOf(A.merchantId, identity.id)).toBeNull(); // T10: nothing before acceptance

    const existing = await account();
    const r2 = await issue(A.ownerSession, existing.email, 'agent');
    expect(Object.keys(r2).sort()).toEqual(Object.keys(r).sort());
    expect(r2).toMatchObject({ outcome: 'ok', delivery: 'accept' });
  });

  it('a disabled account: delivered nowhere, but the owner’s answer is the same', async () => {
    const disabled = await account({ status: 'disabled' });
    expect(await issue(A.ownerSession, disabled.email, 'agent')).toMatchObject({
      outcome: 'ok',
      delivery: 'none',
    });
  });

  it('only the owner — staff are forbidden', async () => {
    expect(await issue(A.staffSession, email('x'), 'agent')).toMatchObject({
      outcome: 'forbidden',
      invitation_id: null,
    });
  });

  it('refuses an assignment that is not an active one of this business', async () => {
    const cases: Array<[string, string | null, string | null]> = [
      ['staff', null, null], // staff need a role (T8)
      ['staff', A.archivedRoleId, null],
      ['staff', B.roleId, null],
      ['staff', A.roleId, B.branchId],
      ['agent', A.roleId, null], // agents have none (BR-3)
      ['agent', null, A.branchId],
    ];
    for (const [kind, role, branch] of cases) {
      expect((await issue(A.ownerSession, email('y'), kind, role, branch)).outcome).toBe(
        'invalid_assignment',
      );
    }
  });

  it('refuses an existing member, and supersedes an open invitation to the same email', async () => {
    const { rows } = await owner.query(`SELECT email FROM identity.identities WHERE id = $1`, [
      A.staffIdentityId,
    ]);
    expect((await issue(A.ownerSession, rows[0].email, 'agent')).outcome).toBe('already_member');

    const address = email('twice');
    const first = await issue(A.ownerSession, address, 'agent');
    const second = await issue(A.ownerSession, address, 'staff', A.roleId);
    expect((await invitation(first.invitation_id!)).revoked_at).not.toBeNull();
    expect((await invitation(second.invitation_id!)).revoked_at).toBeNull();
  });

  it('refuses an unknown kind or an out-of-range lifetime outright', async () => {
    await expectSqlState(issue(A.ownerSession, email('z'), 'owner'), SQLSTATE.checkViolation);
    // An existing account, so no setup token is issued: the invitation's own bound must refuse (1 min – 24 h).
    const person = await account();
    for (const ttl of [DAY + 1, 59]) {
      await expectSqlState(
        issue(A.ownerSession, person.email, 'agent', null, null, ttl),
        SQLSTATE.checkViolation,
      );
    }
    expect((await issue(A.ownerSession, person.email, 'agent', null, null, DAY)).outcome).toBe('ok');
  });
});

describe('accept_invitation (existing account, T11)', () => {
  it('creates the membership the invitation describes and consumes it — once', async () => {
    const person = await account();
    const r = await issue(A.ownerSession, person.email, 'staff', A.roleId, A.branchId);
    const res = await accept(r.token, person.identityId);
    expect(res).toMatchObject({ outcome: 'ok', merchant_id: A.merchantId, invitation_id: r.invitation_id });
    expect(await membershipOf(A.merchantId, person.identityId)).toMatchObject({
      id: res.membership_id,
      kind: 'staff',
      role_id: A.roleId,
      branch_id: A.branchId,
      status: 'active',
    });
    expect(await invitation(r.invitation_id!)).toMatchObject({ accepted_membership_id: res.membership_id });
    expect((await accept(r.token, person.identityId)).outcome).toBe('used'); // replay
  });

  it('refuses anyone but the invited person, and an unverified or disabled one', async () => {
    const person = await account();
    const other = await account();
    const r = await issue(A.ownerSession, person.email, 'agent');
    expect((await accept(r.token, other.identityId)).outcome).toBe('wrong_identity');

    const unverified = await account({ verified: false });
    const r2 = await issue(A.ownerSession, unverified.email, 'agent');
    expect((await accept(r2.token, unverified.identityId)).outcome).toBe('identity_ineligible');

    const later = await account();
    const r3 = await issue(A.ownerSession, later.email, 'agent');
    await owner.query(`UPDATE identity.identities SET status = 'disabled' WHERE id = $1`, [later.identityId]);
    expect((await accept(r3.token, later.identityId)).outcome).toBe('identity_ineligible');
    for (const p of [person, other, unverified, later])
      expect(await membershipOf(A.merchantId, p.identityId)).toBeNull();
  });

  it('refuses an unknown, revoked or expired invitation', async () => {
    const person = await account();
    expect((await accept(hash(), person.identityId)).outcome).toBe('not_found');

    const revoked = await issue(A.ownerSession, person.email, 'agent');
    await app.query(`SELECT * FROM tenancy.revoke_invitation($1, $2)`, [
      A.ownerSession,
      revoked.invitation_id,
    ]);
    expect((await accept(revoked.token, person.identityId)).outcome).toBe('revoked');

    const expired = await issue(A.ownerSession, person.email, 'agent');
    await owner.query(
      `UPDATE tenancy.invitations SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second' WHERE id = $1`,
      [expired.invitation_id],
    );
    expect((await accept(expired.token, person.identityId)).outcome).toBe('expired');
    expect(await membershipOf(A.merchantId, person.identityId)).toBeNull();
  });

  it('refuses while the business is deactivated, and after the role was archived', async () => {
    const b = await business();
    const person = await account();
    const r = await issue(b.ownerSession, person.email, 'staff', b.roleId);
    await owner.query(
      `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`,
      [b.merchantId],
    );
    expect((await accept(r.token, person.identityId)).outcome).toBe('merchant_inactive');
    await owner.query(
      `UPDATE tenancy.merchants SET status = 'active', deactivated_at = NULL, deactivation_reason = NULL WHERE id = $1`,
      [b.merchantId],
    );
    await owner.query(`UPDATE tenancy.roles SET status = 'archived', archived_at = now() WHERE id = $1`, [
      b.roleId,
    ]);
    expect((await accept(r.token, person.identityId)).outcome).toBe('assignment_inactive');
    expect(await membershipOf(b.merchantId, person.identityId)).toBeNull();
  });

  it('refuses someone who became a member meanwhile', async () => {
    const person = await account();
    const r = await issue(A.ownerSession, person.email, 'agent');
    await owner.query(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent')`,
      [A.merchantId, person.identityId],
    );
    expect((await accept(r.token, person.identityId)).outcome).toBe('already_member');
  });
});

describe('a password reset is not an acceptance (T11)', () => {
  it('resetting the password of an invited account creates no membership; explicit acceptance still works', async () => {
    const person = await account();
    const r = await issue(A.ownerSession, person.email, 'agent');
    expect(r.delivery).toBe('accept');

    const reset = hash();
    await app.query(`SELECT identity.issue_one_time_token($1, 'password_reset', $2, 1800, NULL)`, [
      person.identityId,
      reset,
    ]);
    expect((await app.query(`SELECT identity.reset_password($1, $2) AS id`, [reset, ARGON])).rows[0].id).toBe(
      person.identityId,
    );
    expect(await membershipOf(A.merchantId, person.identityId)).toBeNull();
    expect(await invitation(r.invitation_id!)).toMatchObject({ accepted_at: null, revoked_at: null });

    // An account with a password can never use account setup (P3), so acceptance is the only way in.
    const setup = hash();
    await expectSqlState(
      app.query(`SELECT identity.issue_one_time_token($1, 'account_setup', $2, 3600, NULL)`, [
        person.identityId,
        setup,
      ]),
      SQLSTATE.checkViolation,
    );
    expect((await accept(r.token, person.identityId)).outcome).toBe('ok');
  });
});

describe('complete_account_setup admits the new identity’s invitations (T10)', () => {
  const setup = (tokenHash: string) =>
    app
      .query(`SELECT identity.complete_account_setup($1, $2) AS id`, [tokenHash, ARGON])
      .then((r) => r.rows[0].id);

  it('sets the password, verifies the email and creates the membership — in one step', async () => {
    const address = email('newcomer');
    const r = await issue(A.ownerSession, address, 'staff', A.roleId);
    const identity = await identityByEmail(address);
    expect(await setup(r.setup)).toBe(identity.id);
    expect(await identityByEmail(address)).toMatchObject({
      password_hash: ARGON,
      email_verified_at: expect.any(Date),
    });
    expect(await membershipOf(A.merchantId, identity.id)).toMatchObject({ kind: 'staff', role_id: A.roleId });
    expect((await invitation(r.invitation_id!)).accepted_at).not.toBeNull();
  });

  it('a fresh setup link (forgot password) still leads to the invitation', async () => {
    const address = email('forgetful');
    const r = await issue(A.ownerSession, address, 'agent');
    const identity = await identityByEmail(address);
    const fresh = hash();
    await app.query(`SELECT identity.issue_one_time_token($1, 'account_setup', $2, 3600, NULL)`, [
      identity.id,
      fresh,
    ]);
    expect(await setup(r.setup)).toBeNull(); // the old link was superseded
    expect(await setup(fresh)).toBe(identity.id);
    expect((await membershipOf(A.merchantId, identity.id))?.kind).toBe('agent');
  });

  it('a revoked invitation: setup completes, no membership', async () => {
    const address = email('withdrawn');
    const r = await issue(A.ownerSession, address, 'agent');
    await app.query(`SELECT * FROM tenancy.revoke_invitation($1, $2)`, [A.ownerSession, r.invitation_id]);
    const identity = await identityByEmail(address);
    expect(await setup(r.setup)).toBe(identity.id);
    expect(await membershipOf(A.merchantId, identity.id)).toBeNull();
    expect((await identityByEmail(address)).password_hash).toBe(ARGON);
  });

  it('invited by two businesses: setup admits each still-valid invitation, and only those', async () => {
    const b = await business();
    const address = email('popular');
    await issue(A.ownerSession, address, 'agent');
    const fromB = await issue(b.ownerSession, address, 'agent');
    await owner.query(
      `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`,
      [b.merchantId],
    );
    const identity = await identityByEmail(address);
    expect(await setup(fromB.setup)).toBe(identity.id);
    expect(await membershipOf(A.merchantId, identity.id)).not.toBeNull();
    expect(await membershipOf(b.merchantId, identity.id)).toBeNull();
  });
});

describe('revoke_invitation', () => {
  it('the owner withdraws an open invitation once; another business’s is not found; staff are forbidden', async () => {
    const r = await issue(A.ownerSession, email('maybe'), 'agent');
    const theirs = await issue(B.ownerSession, email('theirs'), 'agent');
    const revoke = async (s: string, id: string) =>
      (await app.query(`SELECT * FROM tenancy.revoke_invitation($1, $2)`, [s, id])).rows[0].outcome;

    expect(await revoke(A.staffSession, r.invitation_id!)).toBe('forbidden');
    expect(await revoke(A.ownerSession, theirs.invitation_id!)).toBe('not_found');
    expect((await invitation(theirs.invitation_id!)).revoked_at).toBeNull();
    expect(await revoke(A.ownerSession, r.invitation_id!)).toBe('ok');
    expect(await revoke(A.ownerSession, r.invitation_id!)).toBe('invalid_transition');
  });
});

describe('privileges', () => {
  it('the app reads its own tenant’s invitations — never the token hash — and writes none directly', async () => {
    await inTenantTx(app, A.merchantId, async (db) => {
      const { rows } = await db.query(`SELECT DISTINCT merchant_id FROM tenancy.invitations`);
      expect(rows.map((r) => r.merchant_id)).toEqual([A.merchantId]);
    });
    await inTenantTx(app, A.merchantId, (db) =>
      expectSqlState(db.query(`SELECT token_hash FROM tenancy.invitations`), SQLSTATE.insufficientPrivilege),
    );
    await inTenantTx(app, A.merchantId, (db) =>
      expectSqlState(
        db.query(`UPDATE tenancy.invitations SET revoked_at = now()`),
        SQLSTATE.insufficientPrivilege,
      ),
    );
  });

  it('functions: the app may call issue, revoke and accept; nobody may call admit directly', async () => {
    const { rows } = await owner.query(`
      SELECT has_function_privilege('alphakolect_app', 'tenancy.issue_invitation(uuid, text, text, uuid, uuid, text, text, integer, text, text, text)', 'EXECUTE') AS issue,
             has_function_privilege('alphakolect_app', 'tenancy.revoke_invitation(uuid, uuid, text, text, text)', 'EXECUTE') AS revoke,
             has_function_privilege('alphakolect_app', 'tenancy.accept_invitation(text, uuid)', 'EXECUTE') AS accept,
             has_function_privilege('alphakolect_app', 'tenancy.admit_invitation_locked(uuid, uuid)', 'EXECUTE') AS admit,
             has_function_privilege('alphakolect_readonly', 'tenancy.accept_invitation(text, uuid)', 'EXECUTE') AS ro`);
    expect(rows[0]).toEqual({ issue: true, revoke: true, accept: true, admit: false, ro: false });
  });
});
