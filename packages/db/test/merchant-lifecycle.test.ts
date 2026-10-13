import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// P4.1 merchant lifecycle (ADR-15 T5, T6, T9), called as the API calls it: as alphakolect_app. Every test uses
// fresh merchants (signup + verification), never the shared A/B fixtures, so a deactivation cannot leak into other
// test files. Effects are checked through the table owner.

let app: pg.Client;
let app2: pg.Client;
let readonly: pg.Client;
let owner: pg.Client;

beforeAll(async () => {
  app = await connectAs('app');
  app2 = await connectAs('app');
  readonly = await connectAs('readonly');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await Promise.all([app.end(), app2.end(), readonly.end(), owner.end()]);
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = (tag: string) => `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$${tag}`;
const uniqueEmail = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
const MERCHANT_LIFETIME = [86400, 1209600];
const PLATFORM_LIFETIME = [3600, 43200];

async function verify(identityId: string, db: pg.Client = app) {
  const token = hash();
  await db.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    identityId,
    token,
  ]);
  return token;
}

/** A merchant from public signup; verified (active) unless told otherwise. */
async function newMerchant({ verified = true } = {}) {
  const email = uniqueEmail('owner');
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Lifecycle Ltd')`, [
    email,
    ARGON('pw'),
  ]);
  if (verified) await app.query(`SELECT identity.verify_email($1)`, [await verify(s.identity_id)]);
  const {
    rows: [m],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  return {
    email,
    merchantId: s.merchant_id as string,
    ownerIdentityId: s.identity_id as string,
    ownerMembershipId: m.id as string,
  };
}

/** A live session; returns its id and its current refresh-token hash. */
async function openSession(identity: string, audience: string, membership: string, scope = 'full') {
  const refresh = hash();
  const [idle, absolute] = audience === 'platform' ? PLATFORM_LIFETIME : MERCHANT_LIFETIME;
  const lifetime = scope === 'mfa_enrollment' ? [900, 900] : [idle, absolute];
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.create_session($1, $2, $3, $4, $5, $6, $7, NULL, NULL)`, [
    identity,
    audience,
    membership,
    scope,
    refresh,
    lifetime[0],
    lifetime[1],
  ]);
  return { sessionId: s.session_id as string, refresh };
}

/** A platform super admin with confirmed TOTP, and a full (MFA-completed) session. */
async function superAdmin({ totp = true, role = 'super_admin' } = {}) {
  const {
    rows: [identity],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
    [uniqueEmail('admin')],
  );
  const {
    rows: [membership],
  } = await owner.query(
    `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, $2) RETURNING id`,
    [identity.id, role],
  );
  await owner.query(
    `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at) VALUES ($1, '\\x00', 'k1', $2)`,
    [identity.id, totp ? new Date() : null],
  );
  const session = await openSession(identity.id, 'platform', membership.id, totp ? 'full' : 'mfa_enrollment');
  return { identityId: identity.id as string, membershipId: membership.id as string, ...session };
}

const setStatus = async (
  sessionId: string,
  merchantId: string,
  action: string,
  reason: string | null = 'policy review',
  db: pg.Client = app,
) =>
  (
    await db.query(`SELECT * FROM tenancy.set_merchant_status($1, $2, $3, $4)`, [
      sessionId,
      merchantId,
      action,
      reason,
    ])
  ).rows[0] as { outcome: string; status: string | null; actor_identity_id: string | null };

const merchantRow = async (id: string) =>
  (
    await owner.query(
      `SELECT status, deactivated_at IS NOT NULL AS has_deactivated_at, deactivation_reason FROM tenancy.merchants WHERE id = $1`,
      [id],
    )
  ).rows[0] as { status: string; has_deactivated_at: boolean; deactivation_reason: string | null };

const validate = async (sessionId: string) =>
  (await app.query(`SELECT * FROM identity.validate_session($1)`, [sessionId])).rows;

const rotate = async (oldHash: string) =>
  (
    await app.query(`SELECT * FROM identity.rotate_refresh_token($1, $2, NULL, ARRAY['merchant'])`, [
      oldHash,
      hash(),
    ])
  ).rows[0].outcome as string;

let admin: Awaited<ReturnType<typeof superAdmin>>;
beforeAll(async () => {
  admin = await superAdmin();
});

describe('status integrity', () => {
  it('only the three lifecycle states are storable; the reason travels with deactivation', async () => {
    const m = await newMerchant();
    await expectSqlState(
      owner.query(`UPDATE tenancy.merchants SET status = 'suspended' WHERE id = $1`, [m.merchantId]),
      SQLSTATE.checkViolation,
    );
    await expectSqlState(
      owner.query(`UPDATE tenancy.merchants SET status = 'deactivated' WHERE id = $1`, [m.merchantId]),
      SQLSTATE.checkViolation,
    );
    await expectSqlState(
      owner.query(
        `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = $2 WHERE id = $1`,
        [m.merchantId, 'x'.repeat(501)],
      ),
      SQLSTATE.checkViolation,
    );
    await expectSqlState(
      owner.query(`UPDATE tenancy.merchants SET deactivation_reason = 'stray' WHERE id = $1`, [m.merchantId]),
      SQLSTATE.checkViolation,
    );
  });
});

describe('no direct status changes (privileges)', () => {
  it('the app may not insert merchants or update status or deactivation columns — inherited privileges included', async () => {
    const { rows } = await owner.query(`
      SELECT has_table_privilege('alphakolect_app', 'tenancy.merchants', 'INSERT') AS insert,
             has_table_privilege('alphakolect_app', 'tenancy.merchants', 'UPDATE') AS table_update,
             has_column_privilege('alphakolect_app', 'tenancy.merchants', 'status', 'UPDATE') AS status,
             has_column_privilege('alphakolect_app', 'tenancy.merchants', 'deactivated_at', 'UPDATE') AS deactivated_at,
             has_column_privilege('alphakolect_app', 'tenancy.merchants', 'deactivation_reason', 'UPDATE') AS reason,
             has_column_privilege('alphakolect_app', 'tenancy.merchants', 'name', 'UPDATE') AS name,
             has_function_privilege('alphakolect_app', 'tenancy.set_merchant_status(uuid,uuid,text,text,text,text,text)', 'EXECUTE') AS app_exec,
             has_function_privilege('alphakolect_readonly', 'tenancy.set_merchant_status(uuid,uuid,text,text,text,text,text)', 'EXECUTE') AS readonly_exec`);
    expect(rows[0]).toEqual({
      insert: false,
      table_update: false,
      status: false,
      deactivated_at: false,
      reason: false,
      name: true, // the merchant profile (P4.4), under RLS
      app_exec: true,
      readonly_exec: false,
    });
  });

  it('a direct attempt from the merchant’s own tenant context is refused', async () => {
    const m = await newMerchant();
    for (const sql of [
      `UPDATE tenancy.merchants SET status = 'active' WHERE id = $1`,
      `INSERT INTO tenancy.merchants (id, name, status) VALUES ($1, 'Forged', 'active')`,
    ]) {
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.merchant_id', $1, true)`, [m.merchantId]);
        await expectSqlState(app.query(sql, [m.merchantId]), SQLSTATE.insufficientPrivilege);
      } finally {
        await app.query('ROLLBACK');
      }
    }
  });
});

describe('transitions (T6)', () => {
  it('active → deactivated (reason kept) → active again, clearing the deactivation fields', async () => {
    const m = await newMerchant();
    expect(await setStatus(admin.sessionId, m.merchantId, 'deactivate', '  fraud report  ')).toMatchObject({
      outcome: 'ok',
      status: 'deactivated',
      actor_identity_id: admin.identityId,
    });
    expect(await merchantRow(m.merchantId)).toEqual({
      status: 'deactivated',
      has_deactivated_at: true,
      deactivation_reason: 'fraud report',
    });
    expect(await setStatus(admin.sessionId, m.merchantId, 'reactivate', null)).toMatchObject({
      outcome: 'ok',
      status: 'active',
    });
    expect(await merchantRow(m.merchantId)).toEqual({
      status: 'active',
      has_deactivated_at: false,
      deactivation_reason: null,
    });
  });

  it('an unverified signup can be deactivated, and reactivation returns it to pending_verification (BR-2.2)', async () => {
    const m = await newMerchant({ verified: false });
    expect((await setStatus(admin.sessionId, m.merchantId, 'deactivate')).outcome).toBe('ok');
    expect((await setStatus(admin.sessionId, m.merchantId, 'reactivate')).status).toBe(
      'pending_verification',
    );
    const {
      rows: [identity],
    } = await owner.query(`SELECT email_verified_at FROM identity.identities WHERE id = $1`, [
      m.ownerIdentityId,
    ]);
    expect(identity.email_verified_at).toBeNull(); // reactivation verified nothing
  });

  it('email verification while deactivated does not reactivate; a later reactivation lands on active', async () => {
    const m = await newMerchant({ verified: false });
    await setStatus(admin.sessionId, m.merchantId, 'deactivate');
    await app.query(`SELECT identity.verify_email($1)`, [await verify(m.ownerIdentityId)]);
    expect((await merchantRow(m.merchantId)).status).toBe('deactivated');
    expect((await setStatus(admin.sessionId, m.merchantId, 'reactivate')).status).toBe('active');
  });

  it.each([
    ['deactivate a deactivated merchant', 'deactivated', 'deactivate'],
    ['reactivate an active merchant', 'active', 'reactivate'],
    ['reactivate a pending merchant', 'pending_verification', 'reactivate'],
  ])('refuses to %s, changing nothing', async (_label, start, action) => {
    const m = await newMerchant({ verified: start !== 'pending_verification' });
    if (start === 'deactivated') await setStatus(admin.sessionId, m.merchantId, 'deactivate');
    const before = await merchantRow(m.merchantId);
    expect((await setStatus(admin.sessionId, m.merchantId, action)).outcome).toBe('invalid_transition');
    expect(await merchantRow(m.merchantId)).toEqual(before);
  });

  it.each([
    ['no reason', null],
    ['a blank reason', '   '],
    ['a reason over 500 characters', 'x'.repeat(501)],
  ])('refuses deactivation with %s', async (_label, reason) => {
    const m = await newMerchant();
    expect((await setStatus(admin.sessionId, m.merchantId, 'deactivate', reason)).outcome).toBe(
      'invalid_reason',
    );
    expect((await merchantRow(m.merchantId)).status).toBe('active');
  });

  it('reports an unknown merchant and rejects an unknown action', async () => {
    expect(
      (await setStatus(admin.sessionId, '01900000-0000-7000-8000-0000000fffff', 'deactivate')).outcome,
    ).toBe('not_found');
    const m = await newMerchant();
    await expectSqlState(setStatus(admin.sessionId, m.merchantId, 'suspend'), SQLSTATE.checkViolation);
  });
});

describe('authority comes only from a live super-admin platform session (T9)', () => {
  const forbidden = async (sessionId: string, merchantId: string) => {
    expect((await setStatus(sessionId, merchantId, 'deactivate')).outcome).toBe('forbidden');
    expect((await merchantRow(merchantId)).status).toBe('active');
  };

  it('refuses a merchant owner’s session — even with the target merchant as tenant context', async () => {
    const m = await newMerchant();
    const s = await openSession(m.ownerIdentityId, 'merchant', m.ownerMembershipId);
    await forbidden(s.sessionId, m.merchantId);
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.merchant_id', $1, true)`, [m.merchantId]);
      expect((await setStatus(s.sessionId, m.merchantId, 'deactivate')).outcome).toBe('forbidden');
    } finally {
      await app.query('ROLLBACK');
    }
  });

  it('refuses a full, MFA-completed session of a platform member who is not a super admin', async () => {
    const support = await superAdmin({ role: 'support' }); // platform staff arrive with P5
    await forbidden(support.sessionId, (await newMerchant()).merchantId);
  });

  it('refuses an enrolment-only (no MFA yet) platform session', async () => {
    const enrolling = await superAdmin({ totp: false });
    await forbidden(enrolling.sessionId, (await newMerchant()).merchantId);
  });

  it('refuses a revoked session, a deactivated platform membership and an unknown session', async () => {
    const m = await newMerchant();
    const revoked = await superAdmin();
    await app.query(`SELECT identity.revoke_session($1, 'logout')`, [revoked.sessionId]);
    await forbidden(revoked.sessionId, m.merchantId);

    const demoted = await superAdmin();
    await owner.query(
      `UPDATE identity.platform_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [demoted.membershipId],
    );
    await forbidden(demoted.sessionId, m.merchantId);
    await forbidden('01900000-0000-7000-8000-0000000eeeee', m.merchantId);
  });
});

describe('the merchant gate (T5)', () => {
  it('a deactivated merchant’s member can no longer validate, refresh, open a session or be offered at login', async () => {
    const m = await newMerchant();
    const s = await openSession(m.ownerIdentityId, 'merchant', m.ownerMembershipId);
    expect(await validate(s.sessionId)).toHaveLength(1);

    await setStatus(admin.sessionId, m.merchantId, 'deactivate');
    expect(await validate(s.sessionId)).toEqual([]);
    expect(await rotate(s.refresh)).toBe('invalid');
    await expectSqlState(
      openSession(m.ownerIdentityId, 'merchant', m.ownerMembershipId),
      SQLSTATE.checkViolation,
    );
    const {
      rows: [resolved],
    } = await app.query(`SELECT * FROM identity.resolve_login_membership($1, 'merchant', $2)`, [
      m.ownerIdentityId,
      hash(),
    ]);
    expect(resolved).toEqual({ eligible_count: 0, membership_id: null }); // login answers INVALID_CREDENTIALS
  });

  it('deactivation changes no identity, membership or session row; reactivation restores only what is otherwise valid', async () => {
    const m = await newMerchant();
    const kept = await openSession(m.ownerIdentityId, 'merchant', m.ownerMembershipId);
    const revokedMeanwhile = await openSession(m.ownerIdentityId, 'merchant', m.ownerMembershipId);
    const snapshot = async () =>
      (
        await owner.query(
          `SELECT (SELECT row_to_json(i) FROM identity.identities i WHERE i.id = $1) AS identity,
                  (SELECT row_to_json(mm) FROM tenancy.merchant_memberships mm WHERE mm.merchant_id = $2) AS membership,
                  (SELECT json_agg(row_to_json(s) ORDER BY s.id) FROM identity.sessions s WHERE s.identity_id = $1) AS sessions`,
          [m.ownerIdentityId, m.merchantId],
        )
      ).rows[0];

    const before = await snapshot();
    await setStatus(admin.sessionId, m.merchantId, 'deactivate');
    expect(await snapshot()).toEqual(before);

    await app.query(`SELECT identity.revoke_session($1, 'logout')`, [revokedMeanwhile.sessionId]);
    await setStatus(admin.sessionId, m.merchantId, 'reactivate');
    expect(await validate(kept.sessionId)).toHaveLength(1);
    expect(await validate(revokedMeanwhile.sessionId)).toEqual([]); // reactivation revives nothing revoked
  });

  it('a deactivated membership stays unusable after its merchant is reactivated', async () => {
    const m = await newMerchant();
    const s = await openSession(m.ownerIdentityId, 'merchant', m.ownerMembershipId);
    await setStatus(admin.sessionId, m.merchantId, 'deactivate');
    await owner.query(
      `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [m.ownerMembershipId],
    );
    await setStatus(admin.sessionId, m.merchantId, 'reactivate');
    expect(await validate(s.sessionId)).toEqual([]);
  });

  it('only the target merchant is affected; platform sessions are not gated by any merchant', async () => {
    const target = await newMerchant();
    const bystander = await newMerchant();
    const bystanderSession = await openSession(
      bystander.ownerIdentityId,
      'merchant',
      bystander.ownerMembershipId,
    );
    await setStatus(admin.sessionId, target.merchantId, 'deactivate');
    expect((await merchantRow(bystander.merchantId)).status).toBe('active');
    expect(await validate(bystanderSession.sessionId)).toHaveLength(1);
    expect(await validate(admin.sessionId)).toHaveLength(1);
  });
});

describe('concurrency (row locks)', () => {
  it('two concurrent deactivations: one succeeds, the other sees the new state and is refused', async () => {
    const m = await newMerchant();
    await app.query('BEGIN');
    try {
      expect((await setStatus(admin.sessionId, m.merchantId, 'deactivate', 'first')).outcome).toBe('ok');
      const second = setStatus(admin.sessionId, m.merchantId, 'deactivate', 'second', app2); // waits for the lock
      await new Promise((resolve) => setTimeout(resolve, 200));
      await app.query('COMMIT');
      expect((await second).outcome).toBe('invalid_transition');
    } catch (err) {
      await app.query('ROLLBACK');
      throw err;
    }
    expect((await merchantRow(m.merchantId)).deactivation_reason).toBe('first');
  });

  it('a reactivation racing the owner’s email verification waits for it and lands on active', async () => {
    const m = await newMerchant({ verified: false });
    await setStatus(admin.sessionId, m.merchantId, 'deactivate');
    const token = await verify(m.ownerIdentityId);

    await app.query('BEGIN');
    try {
      await app.query(`SELECT identity.verify_email($1)`, [token]); // locks the owner's identity row
      const reactivation = setStatus(admin.sessionId, m.merchantId, 'reactivate', null, app2);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await app.query('COMMIT');
      expect((await reactivation).status).toBe('active');
    } catch (err) {
      await app.query('ROLLBACK');
      throw err;
    }
  });
});
