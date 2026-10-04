import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';

// P3.7 (ADR-14 clarifications, 2026-10-04): a password reset does not verify an email; only the verification
// link or the first-password setup link does. Account-setup tokens are their own purpose, for identities that
// have never had a password. Called as alphakolect_app with token HASHES; effects checked through the owner.

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
const uniqueEmail = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;

async function issue(identityId: string, purpose: string, ttl = 600) {
  const t = newToken();
  await app.query(`SELECT identity.issue_one_time_token($1, $2, $3, $4, NULL)`, [
    identityId,
    purpose,
    t.hash,
    ttl,
  ]);
  return t;
}

/** A super admin as bootstrap leaves it: no password, email unverified. */
async function passwordlessAdmin(): Promise<string> {
  const { rows } = await owner.query(`SELECT identity.bootstrap_super_admin($1, true) AS id`, [
    uniqueEmail('admin'),
  ]);
  return rows[0].id;
}

/** A merchant owner who signed up but has not verified yet. */
async function unverifiedOwner() {
  const { rows } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Pending Ltd')`, [
    uniqueEmail('owner'),
    ARGON('initial'),
  ]);
  return rows[0] as { identity_id: string; merchant_id: string };
}

const identityState = async (id: string) =>
  (
    await owner.query(
      `SELECT password_hash, email_verified_at IS NOT NULL AS verified FROM identity.identities WHERE id = $1`,
      [id],
    )
  ).rows[0] as { password_hash: string | null; verified: boolean };

const complete = async (hash: string, password = ARGON('first')) =>
  (await app.query(`SELECT identity.complete_account_setup($1, $2) AS id`, [hash, password])).rows[0].id as
    string | null;

describe('password reset does not verify (P3.5 review → P3.7)', () => {
  it('sets the password but leaves the email unverified and the business pending', async () => {
    const s = await unverifiedOwner();
    const t = await issue(s.identity_id, 'password_reset');
    expect(
      (await app.query(`SELECT identity.reset_password($1, $2) AS id`, [t.hash, ARGON('reset')])).rows[0].id,
    ).toBe(s.identity_id);

    expect(await identityState(s.identity_id)).toEqual({ password_hash: ARGON('reset'), verified: false });
    const { rows } = await owner.query(`SELECT status FROM tenancy.merchants WHERE id = $1`, [s.merchant_id]);
    expect(rows[0].status).toBe('pending_verification');
  });
});

describe('account setup tokens (D9 → option A)', () => {
  it('set the first password and verify the email, once', async () => {
    const id = await passwordlessAdmin();
    const t = await issue(id, 'account_setup');
    expect(await complete(t.hash)).toBe(id);
    expect(await identityState(id)).toEqual({ password_hash: ARGON('first'), verified: true });
    expect(await complete(t.hash, ARGON('second'))).toBeNull();
    expect((await identityState(id)).password_hash).toBe(ARGON('first'));
  });

  it('cannot be issued for an identity that already has a password', async () => {
    const s = await unverifiedOwner();
    await expectSqlState(issue(s.identity_id, 'account_setup'), SQLSTATE.checkViolation);
  });

  it('are refused if a password appeared after issue, without changing it', async () => {
    const id = await passwordlessAdmin();
    const t = await issue(id, 'account_setup');
    await owner.query(`UPDATE identity.identities SET password_hash = $2 WHERE id = $1`, [
      id,
      ARGON('meanwhile'),
    ]);
    expect(await complete(t.hash)).toBeNull();
    expect(await identityState(id)).toEqual({ password_hash: ARGON('meanwhile'), verified: false });
  });

  it('live at most 24 hours, and a newer one supersedes the older', async () => {
    const id = await passwordlessAdmin();
    await expectSqlState(issue(id, 'account_setup', 86401), SQLSTATE.checkViolation);
    const older = await issue(id, 'account_setup', 86400);
    const newer = await issue(id, 'account_setup');
    expect(await complete(older.hash)).toBeNull();
    expect(await complete(newer.hash)).toBe(id);
  });

  it('are not interchangeable with reset or verification tokens', async () => {
    const id = await passwordlessAdmin();
    const reset = await issue(id, 'password_reset');
    const verification = await issue(id, 'email_verification');
    expect(await complete(reset.hash)).toBeNull();
    expect(await complete(verification.hash)).toBeNull();

    const setup = await issue(id, 'account_setup');
    expect(
      (await app.query(`SELECT identity.reset_password($1, $2) AS id`, [setup.hash, ARGON('x')])).rows[0].id,
    ).toBeNull();
    expect((await app.query(`SELECT identity.verify_email($1) AS id`, [setup.hash])).rows[0].id).toBeNull();
    expect(await identityState(id)).toEqual({ password_hash: null, verified: false });
    expect(await complete(setup.hash)).toBe(id);
  });

  it('a disabled identity cannot complete setup', async () => {
    const id = await passwordlessAdmin();
    const t = await issue(id, 'account_setup');
    await owner.query(`UPDATE identity.identities SET status = 'disabled' WHERE id = $1`, [id]);
    expect(await complete(t.hash)).toBeNull();
  });

  it('only the app may complete setup; readonly may not', async () => {
    await inTenantTx(readonly, null, (db) =>
      expectSqlState(
        db.query(`SELECT identity.complete_account_setup(repeat('a', 64), $1)`, [ARGON('x')]),
        SQLSTATE.insufficientPrivilege,
      ),
    );
  });

  it('the purpose list is enforced by the table itself', async () => {
    const id = await passwordlessAdmin();
    await expectSqlState(
      owner.query(
        `INSERT INTO identity.one_time_tokens (identity_id, purpose, token_hash, expires_at)
         VALUES ($1, 'magic_login', repeat('b', 64), now() + interval '1 minute')`,
        [id],
      ),
      SQLSTATE.checkViolation,
    );
  });
});
