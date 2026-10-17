import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// P4.5 (ADR-15 T5, T7–T9, T15): tenancy.list_members and tenancy.update_membership, called as the API calls them
// (alphakolect_app). Authority comes from the session, re-checked at the moment of the call; the merchant is the
// session's; another merchant's membership, role or branch is not found / not usable. Effects checked as owner.

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

async function member(merchantId: string, kind: 'staff' | 'agent', roleId: string | null) {
  const address = email(kind);
  const {
    rows: [identity],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
    [address],
  );
  const {
    rows: [m],
  } = await owner.query(
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [merchantId, identity.id, kind, roleId],
  );
  const membershipId = m.id as string;
  return {
    email: address,
    identityId: identity.id as string,
    membershipId,
    session: await session(identity.id, kind === 'agent' ? 'agent' : 'merchant', membershipId),
  };
}

/** An active business: owner (with a session), two roles (one archived), two branches (one archived), staff, agent. */
async function business() {
  const ownerEmail = email('owner');
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Members Ltd')`, [
    ownerEmail,
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
  const insert = async (table: string, name: string, archived = false) =>
    (
      await owner.query(
        `INSERT INTO tenancy.${table} (merchant_id, name, status, archived_at) VALUES ($1, $2, $3, $4) RETURNING id`,
        [merchantId, name, archived ? 'archived' : 'active', archived ? new Date() : null],
      )
    ).rows[0].id as string;
  const cashier = await insert('roles', 'Cashier');
  const supervisor = await insert('roles', 'Supervisor');
  const oldRole = await insert('roles', 'Retired', true);
  const ikeja = await insert('branches', 'Ikeja');
  const closed = await insert('branches', 'Closed', true);
  return {
    merchantId,
    owner: {
      email: ownerEmail,
      identityId: s.identity_id as string,
      membershipId: o.id as string,
      session: await session(s.identity_id, 'merchant', o.id),
    },
    roles: { cashier, supervisor, oldRole },
    branches: { ikeja, closed },
    staff: await member(merchantId, 'staff', cashier),
    agent: await member(merchantId, 'agent', null),
  };
}

const list = async (sessionId: string, membershipId: string | null = null) =>
  (await app.query(`SELECT * FROM tenancy.list_members($1, $2)`, [sessionId, membershipId])).rows;

const update = async (
  sessionId: string,
  membershipId: string,
  action: string,
  roleId: string | null = null,
  branchId: string | null = null,
) =>
  (
    await app.query(`SELECT * FROM tenancy.update_membership($1, $2, $3, $4, $5)`, [
      sessionId,
      membershipId,
      action,
      roleId,
      branchId,
    ])
  ).rows[0];

const row = async (membershipId: string) =>
  (
    await owner.query(
      `SELECT kind, status, role_id, branch_id, deactivated_at FROM tenancy.merchant_memberships WHERE id = $1`,
      [membershipId],
    )
  ).rows[0];

const validates = async (sessionId: string) =>
  (await app.query(`SELECT 1 FROM identity.validate_session($1)`, [sessionId])).rowCount === 1;

let A: Awaited<ReturnType<typeof business>>;
let B: Awaited<ReturnType<typeof business>>;
beforeAll(async () => {
  A = await business();
  B = await business();
});

describe('list_members', () => {
  it('the owner sees every member of their business, with email, oldest first', async () => {
    const rows = await list(A.owner.session);
    expect(rows.map((r) => [r.membership_id, r.kind, r.email])).toEqual([
      [A.owner.membershipId, 'owner', A.owner.email],
      [A.staff.membershipId, 'staff', A.staff.email],
      [A.agent.membershipId, 'agent', A.agent.email],
    ]);
    expect(rows[1]).toMatchObject({ status: 'active', role_id: A.roles.cashier, branch_id: null });
  });

  it('one member by id — but never another business’s', async () => {
    expect(await list(A.owner.session, A.staff.membershipId)).toHaveLength(1);
    expect(await list(A.owner.session, B.staff.membershipId)).toEqual([]);
  });

  it('staff, agents and dead sessions see nothing', async () => {
    expect(await list(A.staff.session)).toEqual([]);
    expect(await list(A.agent.session)).toEqual([]);
    const s = await session(A.owner.identityId, 'merchant', A.owner.membershipId);
    await app.query(`SELECT identity.revoke_session($1, 'logout')`, [s]);
    expect(await list(s)).toEqual([]);
  });
});

describe('update_membership: who may', () => {
  it('only the active owner’s full merchant session — staff and agents are forbidden', async () => {
    for (const caller of [A.staff.session, A.agent.session]) {
      expect(await update(caller, A.staff.membershipId, 'deactivate')).toMatchObject({
        outcome: 'forbidden',
      });
    }
    expect((await row(A.staff.membershipId)).status).toBe('active');
  });

  it('another business’s member is not found, and untouched', async () => {
    for (const action of ['assign', 'deactivate', 'reactivate']) {
      expect(await update(A.owner.session, B.staff.membershipId, action, A.roles.cashier)).toMatchObject({
        outcome: 'not_found',
        membership_id: null,
      });
    }
    expect(await row(B.staff.membershipId)).toMatchObject({ status: 'active', role_id: B.roles.cashier });
  });

  it('the owner’s own row is protected (ownership changes only by transfer)', async () => {
    for (const action of ['assign', 'deactivate', 'reactivate']) {
      expect(await update(A.owner.session, A.owner.membershipId, action, A.roles.cashier)).toMatchObject({
        outcome: 'owner_protected',
      });
    }
    expect(await row(A.owner.membershipId)).toMatchObject({ kind: 'owner', status: 'active', role_id: null });
  });

  it('a former owner’s session loses the authority at once (T5)', async () => {
    const b = await business();
    await owner.query('BEGIN');
    await owner.query(`UPDATE tenancy.merchant_memberships SET kind = 'staff', role_id = $2 WHERE id = $1`, [
      b.owner.membershipId,
      b.roles.cashier,
    ]);
    await owner.query(
      `UPDATE tenancy.merchant_memberships SET kind = 'owner', role_id = NULL WHERE id = $1`,
      [b.staff.membershipId],
    );
    await owner.query('COMMIT');
    expect(await update(b.owner.session, b.agent.membershipId, 'deactivate')).toMatchObject({
      outcome: 'forbidden',
    });
    expect(await update(b.staff.session, b.agent.membershipId, 'deactivate')).toMatchObject({
      outcome: 'ok',
    });
  });

  it('authority is decided under the merchant lock: a transfer committing meanwhile wins', async () => {
    const b = await business();
    const {
      rows: [{ pid }],
    } = await app.query(`SELECT pg_backend_pid() AS pid`);
    const transfer = await connectAs('migrator');
    try {
      // A transfer in progress: merchant locked, owner demoted, staff promoted — not yet committed.
      await transfer.query('BEGIN');
      await transfer.query(`SELECT 1 FROM tenancy.merchants WHERE id = $1 FOR UPDATE`, [b.merchantId]);
      await transfer.query(
        `UPDATE tenancy.merchant_memberships SET kind = 'staff', role_id = $2 WHERE id = $1`,
        [b.owner.membershipId, b.roles.cashier],
      );
      await transfer.query(
        `UPDATE tenancy.merchant_memberships SET kind = 'owner', role_id = NULL WHERE id = $1`,
        [b.staff.membershipId],
      );

      // The still-owner (as far as committed data says) acts; the call waits on the merchant lock.
      const pending = update(b.owner.session, b.agent.membershipId, 'deactivate');
      for (let i = 0; ; i++) {
        const { rowCount } = await owner.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [
          pid,
        ]);
        if (rowCount) break;
        if (i > 200) throw new Error('the call never waited on the merchant lock');
        await new Promise((r) => setTimeout(r, 25));
      }
      await transfer.query('COMMIT');

      expect(await pending).toMatchObject({ outcome: 'forbidden' });
      expect((await row(b.agent.membershipId)).status).toBe('active');
    } finally {
      await transfer.end();
    }
  });

  it('refuses an unknown action outright', async () => {
    await expectSqlState(update(A.owner.session, A.staff.membershipId, 'promote'), SQLSTATE.checkViolation);
  });
});

describe('update_membership: assign', () => {
  it('sets a staff member’s role and branch; NULL branch = all branches', async () => {
    const b = await business();
    expect(
      await update(b.owner.session, b.staff.membershipId, 'assign', b.roles.supervisor, b.branches.ikeja),
    ).toEqual({
      outcome: 'ok',
      membership_id: b.staff.membershipId,
      kind: 'staff',
      status: 'active',
      role_id: b.roles.supervisor,
      branch_id: b.branches.ikeja,
    });
    expect(
      await update(b.owner.session, b.staff.membershipId, 'assign', b.roles.cashier, null),
    ).toMatchObject({
      outcome: 'ok',
      role_id: b.roles.cashier,
      branch_id: null,
    });
  });

  it('refuses an agent (no roles, BR-3)', async () => {
    expect(await update(A.owner.session, A.agent.membershipId, 'assign', A.roles.cashier)).toMatchObject({
      outcome: 'invalid_target',
    });
    expect((await row(A.agent.membershipId)).role_id).toBeNull();
  });

  it('one answer for a missing, archived or other business’s role or branch — and nothing changes', async () => {
    const cases: Array<[string | null, string | null]> = [
      [null, null],
      [A.roles.oldRole, null],
      [B.roles.cashier, null],
      ['01900000-0000-7000-8000-00000000beef', null],
      [A.roles.supervisor, A.branches.closed],
      [A.roles.supervisor, B.branches.ikeja],
    ];
    for (const [roleId, branchId] of cases) {
      expect(await update(A.owner.session, A.staff.membershipId, 'assign', roleId, branchId)).toMatchObject({
        outcome: 'invalid_assignment',
      });
    }
    expect(await row(A.staff.membershipId)).toMatchObject({ role_id: A.roles.cashier, branch_id: null });
  });
});

describe('update_membership: deactivate and reactivate', () => {
  it.each(['staff', 'agent'] as const)(
    'a %s: out at once, sessions revoked; back only by signing in again',
    async (kind) => {
      const b = await business();
      const target = b[kind];
      expect(await validates(target.session)).toBe(true);

      expect(await update(b.owner.session, target.membershipId, 'deactivate')).toMatchObject({
        outcome: 'ok',
        status: 'deactivated',
      });
      expect(await row(target.membershipId)).toMatchObject({
        status: 'deactivated',
        deactivated_at: expect.any(Date),
      });
      const {
        rows: [s],
      } = await owner.query(`SELECT revoke_reason FROM identity.sessions WHERE id = $1`, [target.session]);
      expect(s.revoke_reason).toBe('membership_deactivated');
      expect(await validates(target.session)).toBe(false);
      expect(await update(b.owner.session, target.membershipId, 'deactivate')).toMatchObject({
        outcome: 'invalid_transition',
        status: 'deactivated',
      });

      expect(await update(b.owner.session, target.membershipId, 'reactivate')).toMatchObject({
        outcome: 'ok',
        status: 'active',
      });
      expect(await row(target.membershipId)).toMatchObject({ status: 'active', deactivated_at: null });
      expect(await validates(target.session)).toBe(false); // the old session stays revoked
      expect(await update(b.owner.session, target.membershipId, 'reactivate')).toMatchObject({
        outcome: 'invalid_transition',
      });
    },
  );

  it('touches no other member’s sessions', async () => {
    const b = await business();
    await update(b.owner.session, b.staff.membershipId, 'deactivate');
    expect(await validates(b.agent.session)).toBe(true);
    expect(await validates(b.owner.session)).toBe(true);
  });
});

describe('grants', () => {
  it('both functions: executable by the app only', async () => {
    const { rows } = await owner.query(`
      SELECT has_function_privilege('alphakolect_app', 'tenancy.list_members(uuid, uuid, integer, timestamptz, uuid)', 'EXECUTE') AS list_app,
             has_function_privilege('alphakolect_readonly', 'tenancy.list_members(uuid, uuid, integer, timestamptz, uuid)', 'EXECUTE') AS list_ro,
             has_function_privilege('alphakolect_app', 'tenancy.update_membership(uuid, uuid, text, uuid, uuid, text, text, text)', 'EXECUTE') AS upd_app,
             has_function_privilege('alphakolect_readonly', 'tenancy.update_membership(uuid, uuid, text, uuid, uuid, text, text, text)', 'EXECUTE') AS upd_ro`);
    expect(rows[0]).toEqual({ list_app: true, list_ro: false, upd_app: true, upd_ro: false });
  });
});
