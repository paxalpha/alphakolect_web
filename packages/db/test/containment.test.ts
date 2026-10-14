import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// The containment switch (P5 plan §11.1, R30; P5.5 step 6). While a flag is set, the resolver and every write-time
// re-check ignore every grant row of that kind; the owner's and the super admin's fixed sets are unaffected. Set and
// cleared only by util.set_authorization_containment (operator-only), which records #39 in the same transaction. The
// flags are shared by the whole test database, so every test clears them when it ends (the database test files run
// one at a time).

let app: pg.Client;
let op: pg.Client; // the operator (migrator connection)
let blocker: pg.Client;
let watcher: pg.Client;
beforeAll(async () => {
  [app, op, blocker, watcher] = await Promise.all([
    connectAs('app'),
    connectAs('migrator'),
    connectAs('migrator'),
    connectAs('migrator'),
  ]);
});
afterAll(async () => {
  await Promise.all([app.end(), op.end(), blocker.end(), watcher.end()]);
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
const one = async (sql: string, params: unknown[] = []) => (await op.query(sql, params)).rows[0];

const contain = (merchant: boolean, platform: boolean, reason = 'containment test') =>
  op.query(`SELECT * FROM util.set_authorization_containment($1, $2, $3)`, [merchant, platform, reason]);
afterEach(async () => {
  await contain(false, false, 'containment test: cleared');
});

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
const permissions = async (sessionId: string) =>
  (await one(`SELECT permissions FROM identity.session_authority($1)`, [sessionId])).permissions as string[];

/** A business: the owner's session, a branch, and a staff member whose role holds `granted`. */
async function business(granted: string[]) {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Contained Ltd')`, [
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
  const ownerMembership = (
    await one(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [s.identity_id])
  ).id as string;
  const roleId = (
    await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
      merchantId,
      `Role ${hash().slice(0, 6)}`,
    ])
  ).id as string;
  await op.query(
    `INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission) SELECT $1, $2, unnest($3::text[])`,
    [merchantId, roleId, granted],
  );
  const branchId = (
    await one(`INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
      merchantId,
      `Branch ${hash().slice(0, 6)}`,
    ])
  ).id as string;
  const staffIdentity = (
    await one(
      `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
      [email('staff'), ARGON],
    )
  ).id as string;
  const staffMembership = (
    await one(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, 'staff', $3) RETURNING id`,
      [merchantId, staffIdentity, roleId],
    )
  ).id as string;
  return {
    merchantId,
    branchId,
    ownerSession: await session(s.identity_id, 'merchant', ownerMembership),
    staffSession: await session(staffIdentity, 'merchant', staffMembership),
  };
}

/** A platform member of `role` (TOTP confirmed, so a full session exists), holding `granted`. */
async function platformMember(role: string, granted: string[] = []) {
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
  await op.query(
    `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at) VALUES ($1, '\\x00', 'k1', now())`,
    [identityId],
  );
  await op.query(
    `INSERT INTO identity.platform_membership_grants (platform_membership_id, permission) SELECT $1, unnest($2::text[])`,
    [membershipId, granted],
  );
  return session(identityId, 'platform', membershipId);
}

const MERCHANT_GRANTS = ['merchant.branches.manage', 'merchant.branches.read'];
const PLATFORM_GRANTS = ['platform.audit.read', 'platform.merchants.read'];

describe('the switch is the operator’s alone', () => {
  it('the app can neither call it nor read or write its table; the reporting role cannot read it either', async () => {
    await expectSqlState(
      app.query(`SELECT * FROM util.set_authorization_containment(true, true, 'x')`),
      SQLSTATE.insufficientPrivilege,
    );
    for (const sql of [
      `SELECT * FROM util.authorization_containment`,
      `UPDATE util.authorization_containment SET merchant_grants_suspended = true`,
    ])
      await expectSqlState(app.query(sql), SQLSTATE.insufficientPrivilege);
    const {
      rows: [p],
    } = await op.query(
      `SELECT (SELECT bool_or(has_table_privilege(r, 'util.authorization_containment', priv))
                 FROM unnest(ARRAY['alphakolect_app', 'alphakolect_readonly']) r,
                      unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) priv) AS any_priv`,
    );
    expect(p.any_priv).toBe(false);
  });

  it('it holds exactly one row, which cannot be duplicated', async () => {
    expect((await op.query(`SELECT count(*)::int AS n FROM util.authorization_containment`)).rows[0].n).toBe(
      1,
    );
    await op.query('BEGIN');
    try {
      await expectSqlState(
        op.query(`INSERT INTO util.authorization_containment (id) VALUES (true)`),
        SQLSTATE.uniqueViolation,
      );
    } finally {
      await op.query('ROLLBACK');
    }
  });

  it('a reason is required and both flags must be given', async () => {
    for (const [m, p, reason] of [
      [true, false, ''],
      [true, false, '   '],
      [true, false, null],
      [null, false, 'x'],
      [true, null, 'x'],
      [true, false, 'x'.repeat(501)],
    ] as const) {
      await op.query('BEGIN');
      try {
        await expectSqlState(
          op.query(`SELECT * FROM util.set_authorization_containment($1, $2, $3)`, [m, p, reason]),
          SQLSTATE.checkViolation,
        );
      } finally {
        await op.query('ROLLBACK');
      }
    }
  });
});

describe('with a flag set, grants of that kind count for nothing; the fixed sets are untouched', () => {
  it('merchant flag: staff lose every granted permission on the next request; the owner and platform staff do not', async () => {
    const b = await business(MERCHANT_GRANTS);
    const platformStaff = await platformMember('support', PLATFORM_GRANTS);
    const ownerSet = await permissions(b.ownerSession);
    expect(await permissions(b.staffSession)).toEqual(MERCHANT_GRANTS);

    expect((await contain(true, false)).rows).toEqual([
      { merchant_grants_suspended: true, platform_grants_suspended: false },
    ]);
    expect(await permissions(b.staffSession)).toEqual([]);
    expect(await permissions(b.ownerSession)).toEqual(ownerSet);
    expect(await permissions(platformStaff)).toEqual(PLATFORM_GRANTS);
    // …and the write-time re-check agrees with the resolver.
    expect(
      (await one(`SELECT tenancy.assert_authority($1, 'merchant.branches.manage') AS o`, [b.staffSession])).o,
    ).toBe('forbidden');
    expect(
      (await one(`SELECT tenancy.assert_authority($1, 'merchant.branches.manage') AS o`, [b.ownerSession])).o,
    ).toBe('ok');

    await contain(false, false, 'lifted');
    expect(await permissions(b.staffSession)).toEqual(MERCHANT_GRANTS);
  });

  it('platform flag: platform staff lose every granted permission; the super admin and merchant staff do not', async () => {
    const b = await business(MERCHANT_GRANTS);
    const platformStaff = await platformMember('support', PLATFORM_GRANTS);
    const superAdmin = await platformMember('super_admin');
    const superSet = await permissions(superAdmin);
    expect(superSet.length).toBeGreaterThan(PLATFORM_GRANTS.length);

    await contain(false, true);
    expect(await permissions(platformStaff)).toEqual([]);
    expect(await permissions(superAdmin)).toEqual(superSet);
    expect(await permissions(b.staffSession)).toEqual(MERCHANT_GRANTS);

    await contain(false, false, 'lifted');
    expect(await permissions(platformStaff)).toEqual(PLATFORM_GRANTS);
  });

  it('a write already waiting for its re-check when the flag is set is refused, and writes nothing', async () => {
    const b = await business(MERCHANT_GRANTS);
    const writer = await connectAs('app');
    try {
      const pid = (await writer.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
      // The writer holds its footprint up to the branch, which the blocker holds; it has not reached its re-check.
      await blocker.query('BEGIN');
      await blocker.query(`SELECT 1 FROM tenancy.branches WHERE id = $1 FOR UPDATE`, [b.branchId]);
      const pending = writer.query(
        `SELECT outcome FROM tenancy.update_branch($1, $2, 'Renamed while contained', NULL)`,
        [b.staffSession, b.branchId],
      );
      for (let i = 0; ; i++) {
        const { rowCount } = await watcher.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [
          pid,
        ]);
        if (rowCount) break;
        if (i > 400) throw new Error('the writer never waited');
        await new Promise((r) => setTimeout(r, 10));
      }
      await contain(true, false, 'contained while a write waits');
      await blocker.query('ROLLBACK');
      expect((await pending).rows[0].outcome).toBe('forbidden');
      expect((await one(`SELECT name FROM tenancy.branches WHERE id = $1`, [b.branchId])).name).not.toBe(
        'Renamed while contained',
      );
    } finally {
      await writer.end();
    }
  });

  it('a missing row counts as suspended (fail closed)', async () => {
    const b = await business(MERCHANT_GRANTS);
    const platformStaff = await platformMember('support', PLATFORM_GRANTS);
    await op.query('BEGIN');
    try {
      await op.query(`DELETE FROM util.authorization_containment`);
      expect(await permissions(b.staffSession)).toEqual([]);
      expect(await permissions(platformStaff)).toEqual([]);
      expect((await permissions(b.ownerSession)).length).toBeGreaterThan(0);
    } finally {
      await op.query('ROLLBACK');
    }
  });
});

// The coverage guard's tests for this pattern-A pair (plan §8.1 #39): written by the operator function itself, the
// actor is no one (operator), it commits with the change, and without it nothing does.
describe('#39 platform.authorization_containment_set', () => {
  it('[coverage platform.authorization_containment_set/success] one row, operator actor, both flags and the reason, committed with the change', async () => {
    const reason = `incident ${randomBytes(4).toString('hex')}`;
    await contain(true, true, reason);
    const { rows } = await op.query(
      `SELECT merchant_id, actor_identity_id, actor_audience, actor_membership_id, target_type, target_id, outcome, summary
         FROM audit.audit_events WHERE action = 'platform.authorization_containment_set' AND summary ->> 'reason' = $1`,
      [reason],
    );
    expect(rows).toEqual([
      {
        merchant_id: null,
        actor_identity_id: null,
        actor_audience: null,
        actor_membership_id: null,
        target_type: 'authorization_containment',
        target_id: null,
        outcome: 'success',
        summary: { merchantGrantsSuspended: true, platformGrantsSuspended: true, reason },
      },
    ]);
    expect(
      await one(
        `SELECT merchant_grants_suspended, platform_grants_suspended FROM util.authorization_containment`,
      ),
    ).toEqual({
      merchant_grants_suspended: true,
      platform_grants_suspended: true,
    });
  });

  it("[coverage platform.authorization_containment_set/success] with that pair's insert failing, the flags are unchanged", async () => {
    await op.query('BEGIN');
    try {
      // A test-only trigger, created and dropped inside this transaction.
      await op.query(
        `CREATE FUNCTION audit.test_fail_containment() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW.action = 'platform.authorization_containment_set' AND NEW.outcome = 'success' THEN
             RAISE EXCEPTION 'injected audit storage failure' USING ERRCODE = 'XX000';
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await op.query(
        `CREATE TRIGGER test_fail_containment BEFORE INSERT ON audit.audit_events
           FOR EACH ROW EXECUTE FUNCTION audit.test_fail_containment()`,
      );
      await op.query('SAVEPOINT switch');
      await expectSqlState(
        op.query(`SELECT * FROM util.set_authorization_containment(true, true, 'never stored')`),
        'XX000',
      );
      await op.query('ROLLBACK TO SAVEPOINT switch');
      expect(
        await one(
          `SELECT merchant_grants_suspended, platform_grants_suspended FROM util.authorization_containment`,
        ),
      ).toEqual({ merchant_grants_suspended: false, platform_grants_suspended: false });
    } finally {
      await op.query('ROLLBACK');
    }
  });
});
