import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';
import { FIXTURE } from './support/fixtures.js';

// P3 account functions, called exactly as the API will: as alphakolect_app, with token HASHES only.
// Effects are checked through the table owner (the app cannot read identity tables).

let app: pg.Client;
let readonly: pg.Client;
let owner: pg.Client;

beforeAll(async () => {
  app = await connectAs('app');
  readonly = await connectAs('readonly');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await app.end();
  await readonly.end();
  await owner.end();
});

const newToken = () => {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: createHash('sha256').update(raw).digest('hex') };
};
const ARGON = (tag: string) => `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$${tag}`;
let n = 0;
const uniqueEmail = () => `user-${process.pid}-${Date.now()}-${++n}@example.test`;

async function signup(email = uniqueEmail()) {
  const { rows } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Test Business')`, [
    email,
    ARGON('initial'),
  ]);
  return { email, ...rows[0] } as {
    email: string;
    created: boolean;
    identity_id: string;
    merchant_id: string;
  };
}

async function issue(identityId: string, purpose: string, ttl = 600) {
  const t = newToken();
  await app.query(`SELECT identity.issue_one_time_token($1, $2, $3, $4, '127.0.0.1')`, [
    identityId,
    purpose,
    t.hash,
    ttl,
  ]);
  return t;
}

async function openSession(identityId: string, membershipId: string) {
  const { rows } = await owner.query(
    `INSERT INTO identity.sessions (identity_id, audience, merchant_membership_id, absolute_expires_at)
     VALUES ($1, 'merchant', $2, now() + interval '1 day') RETURNING id`,
    [identityId, membershipId],
  );
  return rows[0].id as string;
}

const ownerMembership = async (identityId: string) =>
  (await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [identityId]))
    .rows[0].id as string;

describe('schema USAGE without table access (D4)', () => {
  it('the app may resolve identity functions but still cannot read identity tables', async () => {
    await inTenantTx(app, null, (db) =>
      expectSqlState(
        db.query(`SELECT email FROM identity.identities LIMIT 1`),
        SQLSTATE.insufficientPrivilege,
      ),
    );
  });

  it('internal building blocks are not callable by the app', async () => {
    await inTenantTx(app, null, (db) =>
      expectSqlState(
        db.query(`SELECT identity.consume_one_time_token('password_reset', repeat('a', 64))`),
        SQLSTATE.insufficientPrivilege,
      ),
    );
  });

  it('readonly cannot call identity functions', async () => {
    await inTenantTx(readonly, null, (db) =>
      expectSqlState(
        db.query(`SELECT * FROM identity.account_for_email('x@example.test')`),
        SQLSTATE.insufficientPrivilege,
      ),
    );
  });
});

describe('signup (D2)', () => {
  it('creates the identity, a pending merchant and the owner membership — nothing else', async () => {
    const s = await signup();
    expect(s.created).toBe(true);
    const { rows } = await owner.query(
      `SELECT i.email, i.email_verified_at, m.status, mm.kind
         FROM identity.identities i
         JOIN tenancy.merchant_memberships mm ON mm.identity_id = i.id
         JOIN tenancy.merchants m ON m.id = mm.merchant_id
        WHERE i.id = $1`,
      [s.identity_id],
    );
    expect(rows).toEqual([
      { email: s.email, email_verified_at: null, status: 'pending_verification', kind: 'owner' },
    ]);
  });

  it('an existing email (any case) is not an error and creates nothing', async () => {
    const s = await signup();
    const before = (await owner.query(`SELECT count(*)::int AS n FROM tenancy.merchants`)).rows[0].n;
    const again = await signup(s.email.toUpperCase());
    expect(again).toMatchObject({ created: false, identity_id: null, merchant_id: null });
    expect((await owner.query(`SELECT count(*)::int AS n FROM tenancy.merchants`)).rows[0].n).toBe(before);
  });
});

describe('email verification tokens (D12)', () => {
  it('verifies once, marks the email verified and activates the merchant', async () => {
    const s = await signup();
    const t = await issue(s.identity_id, 'email_verification');
    expect((await app.query(`SELECT identity.verify_email($1) AS id`, [t.hash])).rows[0].id).toBe(
      s.identity_id,
    );
    const { rows } = await owner.query(
      `SELECT i.email_verified_at IS NOT NULL AS verified, m.status FROM identity.identities i, tenancy.merchants m
       WHERE i.id = $1 AND m.id = $2`,
      [s.identity_id, s.merchant_id],
    );
    expect(rows[0]).toEqual({ verified: true, status: 'active' });
    // single use
    expect((await app.query(`SELECT identity.verify_email($1) AS id`, [t.hash])).rows[0].id).toBeNull();
  });

  it('rejects an expired token, a superseded token, a wrong-purpose token and the raw token value', async () => {
    const s = await signup();
    const expired = await issue(s.identity_id, 'email_verification');
    await owner.query(
      `UPDATE identity.one_time_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [expired.hash],
    );
    expect((await app.query(`SELECT identity.verify_email($1) AS id`, [expired.hash])).rows[0].id).toBeNull();

    const first = await issue(s.identity_id, 'email_verification');
    await issue(s.identity_id, 'email_verification'); // supersedes `first`
    expect((await app.query(`SELECT identity.verify_email($1) AS id`, [first.hash])).rows[0].id).toBeNull();

    const reset = await issue(s.identity_id, 'password_reset');
    expect((await app.query(`SELECT identity.verify_email($1) AS id`, [reset.hash])).rows[0].id).toBeNull();

    const live = await issue(s.identity_id, 'email_verification');
    expect((await app.query(`SELECT identity.verify_email($1) AS id`, [live.raw])).rows[0].id).toBeNull();
  });

  it('caps token lifetimes in the database: verification <= 24 h, reset <= 30 min', async () => {
    const s = await signup();
    await inTenantTx(app, null, (db) =>
      expectSqlState(
        db.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 86401, null)`, [
          s.identity_id,
          newToken().hash,
        ]),
        SQLSTATE.checkViolation,
      ),
    );
    await inTenantTx(app, null, (db) =>
      expectSqlState(
        db.query(`SELECT identity.issue_one_time_token($1, 'password_reset', $2, 1801, null)`, [
          s.identity_id,
          newToken().hash,
        ]),
        SQLSTATE.checkViolation,
      ),
    );
  });
});

describe('passwords (§3.2, D5, D15)', () => {
  it('reset: single use, sets the hash and revokes every session', async () => {
    const s = await signup();
    const membership = await ownerMembership(s.identity_id);
    const sessions = [
      await openSession(s.identity_id, membership),
      await openSession(s.identity_id, membership),
    ];
    const t = await issue(s.identity_id, 'password_reset');

    expect(
      (await app.query(`SELECT identity.reset_password($1, $2) AS id`, [t.hash, ARGON('reset')])).rows[0].id,
    ).toBe(s.identity_id);
    const { rows } = await owner.query(
      `SELECT password_hash, password_changed_at IS NOT NULL AS changed FROM identity.identities WHERE id = $1`,
      [s.identity_id],
    );
    expect(rows[0]).toEqual({ password_hash: ARGON('reset'), changed: true });
    const revoked = await owner.query(`SELECT revoke_reason FROM identity.sessions WHERE id = ANY($1)`, [
      sessions,
    ]);
    expect(revoked.rows.map((r) => r.revoke_reason)).toEqual(['password_reset', 'password_reset']);

    expect(
      (await app.query(`SELECT identity.reset_password($1, $2) AS id`, [t.hash, ARGON('again')])).rows[0].id,
    ).toBeNull();
  });

  it('reset: an expired token changes nothing', async () => {
    const s = await signup();
    const t = await issue(s.identity_id, 'password_reset');
    await owner.query(
      `UPDATE identity.one_time_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [t.hash],
    );
    expect(
      (await app.query(`SELECT identity.reset_password($1, $2) AS id`, [t.hash, ARGON('x')])).rows[0].id,
    ).toBeNull();
    const { rows } = await owner.query(`SELECT password_hash FROM identity.identities WHERE id = $1`, [
      s.identity_id,
    ]);
    expect(rows[0].password_hash).toBe(ARGON('initial'));
  });

  it('a disabled identity cannot use its tokens', async () => {
    const s = await signup();
    const t = await issue(s.identity_id, 'password_reset');
    await owner.query(`UPDATE identity.identities SET status = 'disabled' WHERE id = $1`, [s.identity_id]);
    expect(
      (await app.query(`SELECT identity.reset_password($1, $2) AS id`, [t.hash, ARGON('x')])).rows[0].id,
    ).toBeNull();
  });

  it('change revokes every session', async () => {
    const s = await signup();
    const session = await openSession(s.identity_id, await ownerMembership(s.identity_id));
    await app.query(`SELECT identity.change_password($1, $2)`, [s.identity_id, ARGON('changed')]);
    const { rows } = await owner.query(`SELECT revoke_reason FROM identity.sessions WHERE id = $1`, [
      session,
    ]);
    expect(rows[0].revoke_reason).toBe('password_changed');
  });

  it('rehash is compare-and-set and does not revoke sessions', async () => {
    const s = await signup();
    const session = await openSession(s.identity_id, await ownerMembership(s.identity_id));
    expect(
      (
        await app.query(`SELECT identity.rehash_password($1, $2, $3) AS ok`, [
          s.identity_id,
          ARGON('stale'),
          ARGON('new'),
        ])
      ).rows[0].ok,
    ).toBe(false);
    expect(
      (
        await app.query(`SELECT identity.rehash_password($1, $2, $3) AS ok`, [
          s.identity_id,
          ARGON('initial'),
          ARGON('new'),
        ])
      ).rows[0].ok,
    ).toBe(true);
    const { rows } = await owner.query(`SELECT revoked_at FROM identity.sessions WHERE id = $1`, [session]);
    expect(rows[0].revoked_at).toBeNull();
  });
});

describe('narrow reads', () => {
  it('login_candidate returns what login needs for the audience, case-insensitively', async () => {
    const s = await signup();
    await app.query(`SELECT identity.verify_email($1)`, [
      (await issue(s.identity_id, 'email_verification')).hash,
    ]);
    const { rows } = await app.query(`SELECT * FROM identity.login_candidate($1, 'merchant')`, [
      s.email.toUpperCase(),
    ]);
    expect(rows[0]).toMatchObject({
      identity_id: s.identity_id,
      identity_status: 'active',
      email_verified: true,
      password_hash: ARGON('initial'),
      membership_kind: 'owner',
      membership_status: 'active',
      mfa_enrolled: false,
    });
  });

  it('login_candidate offers no membership of a merchant that is not active (P4.1, ADR-15 T5)', async () => {
    // Still pending verification: the credentials row comes back (so the API can answer
    // EMAIL_VERIFICATION_REQUIRED after a correct password), but no membership is offered.
    const s = await signup();
    const { rows } = await app.query(`SELECT * FROM identity.login_candidate($1, 'merchant')`, [s.email]);
    expect(rows[0]).toMatchObject({ identity_id: s.identity_id, email_verified: false, membership_id: null });
  });

  it('returns no membership for an audience the identity does not belong to, and no row for unknown emails', async () => {
    const s = await signup();
    const platform = await app.query(`SELECT * FROM identity.login_candidate($1, 'platform')`, [s.email]);
    expect(platform.rows[0]).toMatchObject({ identity_id: s.identity_id, membership_id: null });
    const unknown = await app.query(
      `SELECT * FROM identity.login_candidate('nobody@example.test', 'merchant')`,
    );
    expect(unknown.rowCount).toBe(0);
  });

  it('account_for_email exposes existence and state only', async () => {
    const s = await signup();
    const { rows, fields } = await app.query(`SELECT * FROM identity.account_for_email($1)`, [s.email]);
    expect(fields.map((f) => f.name)).toEqual(['identity_id', 'identity_status', 'email_verified']);
    expect(rows[0]).toEqual({ identity_id: s.identity_id, identity_status: 'active', email_verified: false });
  });

  it('works for fixture owners too (no password set)', async () => {
    const { rows } = await app.query(`SELECT * FROM identity.credentials_for($1)`, [
      FIXTURE.A.ownerIdentityId,
    ]);
    expect(rows[0]).toEqual({ identity_status: 'active', password_hash: null });
  });
});
