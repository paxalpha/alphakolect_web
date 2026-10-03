import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';
import { FIXTURE } from './support/fixtures.js';

// P3 session functions (§3.2, ADR-14 D5, D6, D8), called as alphakolect_app with refresh-token HASHES only.

let app: pg.Client;
let owner: pg.Client;

beforeAll(async () => {
  app = await connectAs('app');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await app.end();
  await owner.end();
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const MERCHANT = { idle: 86400, absolute: 1209600 };
const A = FIXTURE.A;

async function createSession(
  args: Partial<{
    identity: string;
    audience: string;
    membership: string;
    scope: string;
    idle: number;
    absolute: number;
  }> = {},
) {
  const refresh = hash();
  const { rows } = await app.query(
    `SELECT * FROM identity.create_session($1, $2, $3, $4, $5, $6, $7, '127.0.0.1', 'vitest')`,
    [
      args.identity ?? A.ownerIdentityId,
      args.audience ?? 'merchant',
      args.membership ?? A.ownerMembershipId,
      args.scope ?? 'full',
      refresh,
      args.idle ?? MERCHANT.idle,
      args.absolute ?? MERCHANT.absolute,
    ],
  );
  return { sessionId: rows[0].session_id as string, refresh };
}

const rotate = async (oldHash: string, newHash = hash(), idle = MERCHANT.idle) =>
  (await app.query(`SELECT * FROM identity.rotate_refresh_token($1, $2, $3)`, [oldHash, newHash, idle]))
    .rows[0];

const validate = async (sessionId: string) =>
  (await app.query(`SELECT * FROM identity.validate_session($1)`, [sessionId])).rows;

/** A platform identity with an active super-admin membership; TOTP confirmed or not. */
async function platformIdentity(totpConfirmed: boolean) {
  const email = `platform-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
  const {
    rows: [identity],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
    [email],
  );
  const {
    rows: [membership],
  } = await owner.query(
    `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'super_admin') RETURNING id`,
    [identity.id],
  );
  await owner.query(
    `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at) VALUES ($1, '\\x00', 'k1', $2)`,
    [identity.id, totpConfirmed ? new Date() : null],
  );
  return { identityId: identity.id as string, membershipId: membership.id as string };
}

describe('creating sessions', () => {
  it('creates a session with a refresh token capped by the absolute expiry', async () => {
    const { sessionId } = await createSession();
    const [row] = await validate(sessionId);
    expect(row).toMatchObject({
      identity_id: A.ownerIdentityId,
      audience: 'merchant',
      membership_id: A.ownerMembershipId,
      merchant_id: A.merchantId,
      scope: 'full',
    });
  });

  type SessionArgs = Partial<{
    audience: string;
    membership: string;
    scope: string;
    idle: number;
    absolute: number;
  }>;
  it.each<[string, SessionArgs]>([
    ['an idle lifetime above the audience cap', { idle: MERCHANT.idle + 1 }],
    ['an absolute lifetime above the audience cap', { absolute: MERCHANT.absolute + 1 }],
    ['a membership of another identity', { membership: FIXTURE.B.ownerMembershipId }],
    [
      'a merchant membership for the platform audience',
      { audience: 'platform', idle: 3600, absolute: 43200 },
    ],
    ['an unsupported audience', { audience: 'customer' }],
    ['an MFA-enrolment session longer than 15 minutes', { scope: 'mfa_enrollment', audience: 'platform' }],
  ])('rejects %s', async (_label, args) => {
    await inTenantTx(app, null, (db) =>
      expectSqlState(
        db.query(`SELECT * FROM identity.create_session($1, $2, $3, $4, $5, $6, $7, null, null)`, [
          A.ownerIdentityId,
          args.audience ?? 'merchant',
          args.membership ?? A.ownerMembershipId,
          args.scope ?? 'full',
          hash(),
          args.idle ?? MERCHANT.idle,
          args.absolute ?? MERCHANT.absolute,
        ]),
        SQLSTATE.checkViolation,
      ),
    );
  });

  it('refuses a full platform session without a confirmed TOTP (exit criterion 7)', async () => {
    const p = await platformIdentity(false);
    await inTenantTx(app, null, (db) =>
      expectSqlState(
        db.query(
          `SELECT * FROM identity.create_session($1, 'platform', $2, 'full', $3, 3600, 43200, null, null)`,
          [p.identityId, p.membershipId, hash()],
        ),
        SQLSTATE.checkViolation,
      ),
    );
    // ...but allows the short enrolment-only session that lets it enrol
    const { sessionId } = await createSession({
      identity: p.identityId,
      audience: 'platform',
      membership: p.membershipId,
      scope: 'mfa_enrollment',
      idle: 900,
      absolute: 900,
    });
    expect((await validate(sessionId))[0]).toMatchObject({
      audience: 'platform',
      scope: 'mfa_enrollment',
      merchant_id: null,
    });
  });

  it('allows a full platform session once TOTP is confirmed', async () => {
    const p = await platformIdentity(true);
    const { sessionId } = await createSession({
      identity: p.identityId,
      audience: 'platform',
      membership: p.membershipId,
      idle: 3600,
      absolute: 43200,
    });
    expect((await validate(sessionId))[0]).toMatchObject({ audience: 'platform', scope: 'full' });
  });
});

describe('refresh rotation and reuse detection (§3.2, exit criterion 5)', () => {
  it('rotates: the old token is spent and the new one works', async () => {
    const { sessionId, refresh } = await createSession();
    const next = hash();
    const r1 = await rotate(refresh, next);
    expect(r1).toMatchObject({
      outcome: 'rotated',
      session_id: sessionId,
      audience: 'merchant',
      scope: 'full',
    });
    expect((await rotate(next)).outcome).toBe('rotated');
  });

  it('reusing a rotated token revokes the whole session — including the newer token', async () => {
    const { sessionId, refresh } = await createSession();
    const next = hash();
    await rotate(refresh, next);

    expect((await rotate(refresh)).outcome).toBe('reuse_detected');
    expect(await validate(sessionId)).toEqual([]);
    expect((await rotate(next)).outcome).toBe('invalid');
    const { rows } = await owner.query(`SELECT revoke_reason FROM identity.sessions WHERE id = $1`, [
      sessionId,
    ]);
    expect(rows[0].revoke_reason).toBe('refresh_token_reuse');
  });

  it('rejects unknown, idle-expired and absolute-expired tokens', async () => {
    expect((await rotate(hash())).outcome).toBe('invalid');

    const idle = await createSession();
    await owner.query(
      `UPDATE identity.refresh_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [idle.refresh],
    );
    expect((await rotate(idle.refresh)).outcome).toBe('invalid');

    const absolute = await createSession();
    await owner.query(
      `UPDATE identity.sessions SET created_at = now() - interval '20 days', absolute_expires_at = now() - interval '1 second' WHERE id = $1`,
      [absolute.sessionId],
    );
    expect((await rotate(absolute.refresh)).outcome).toBe('invalid');
    expect(await validate(absolute.sessionId)).toEqual([]);
  });
});

describe('revocation and per-request validation (exit criterion 6)', () => {
  it('logout revokes one session; the next validation fails', async () => {
    const one = await createSession();
    const other = await createSession();
    expect(
      (await app.query(`SELECT identity.revoke_session($1, 'logout') AS ok`, [one.sessionId])).rows[0].ok,
    ).toBe(true);
    expect(await validate(one.sessionId)).toEqual([]);
    expect(await validate(other.sessionId)).toHaveLength(1);
    expect((await rotate(one.refresh)).outcome).toBe('invalid');
  });

  it('a disabled identity or a deactivated membership invalidates live sessions immediately (BR-10.6b)', async () => {
    const p = await platformIdentity(true);
    const s = await createSession({
      identity: p.identityId,
      audience: 'platform',
      membership: p.membershipId,
      idle: 3600,
      absolute: 43200,
    });
    expect(await validate(s.sessionId)).toHaveLength(1);

    await owner.query(
      `UPDATE identity.platform_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [p.membershipId],
    );
    expect(await validate(s.sessionId)).toEqual([]);
    expect((await rotate(s.refresh, hash(), 3600)).outcome).toBe('invalid');

    const q = await platformIdentity(true);
    const t = await createSession({
      identity: q.identityId,
      audience: 'platform',
      membership: q.membershipId,
      idle: 3600,
      absolute: 43200,
    });
    await owner.query(`UPDATE identity.identities SET status = 'disabled' WHERE id = $1`, [q.identityId]);
    expect(await validate(t.sessionId)).toEqual([]);
  });

  it('revoke_all_sessions ends every session of the identity', async () => {
    const p = await platformIdentity(true);
    const sessions = [
      await createSession({
        identity: p.identityId,
        audience: 'platform',
        membership: p.membershipId,
        idle: 3600,
        absolute: 43200,
      }),
      await createSession({
        identity: p.identityId,
        audience: 'platform',
        membership: p.membershipId,
        idle: 3600,
        absolute: 43200,
      }),
    ];
    expect(
      (await app.query(`SELECT identity.revoke_all_sessions($1, 'admin') AS n`, [p.identityId])).rows[0].n,
    ).toBe(2);
    for (const s of sessions) expect(await validate(s.sessionId)).toEqual([]);
  });
});

describe('internal helpers are not callable by the app', () => {
  it.each([
    [`SELECT * FROM identity.session_limits('merchant', 'full')`],
    [`SELECT identity.active_membership('${A.ownerIdentityId}', 'merchant', '${A.ownerMembershipId}')`],
  ])('%s', async (sql) => {
    await inTenantTx(app, null, (db) => expectSqlState(db.query(sql), SQLSTATE.insufficientPrivilege));
  });
});
