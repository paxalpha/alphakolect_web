import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';

// P3 MFA functions (ADR-14 D8), called as alphakolect_app. Codes themselves are checked by the API; these
// tests cover what the database guarantees: replay protection, single-use recovery codes, and the
// challenge's 5-minute / 5-attempt limits.

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
const tenCodes = () => Array.from({ length: 10 }, hash);

async function platformIdentity() {
  const email = `mfa-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
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
  return { identityId: identity.id as string, membershipId: membership.id as string };
}

async function enrolled(step = 100) {
  const p = await platformIdentity();
  const codes = tenCodes();
  await app.query(`SELECT identity.begin_totp_enrollment($1, '\\xdeadbeef', 'k1')`, [p.identityId]);
  await app.query(`SELECT identity.confirm_totp_enrollment($1, $2, $3)`, [p.identityId, step, codes]);
  return { ...p, codes };
}

const accept = async (identityId: string, step: number) =>
  (await app.query(`SELECT identity.accept_totp_step($1, $2) AS ok`, [identityId, step])).rows[0]
    .ok as boolean;

describe('TOTP enrolment', () => {
  it('stores only ciphertext and becomes confirmed with 10 recovery codes', async () => {
    const p = await enrolled();
    const { rows } = await app.query(`SELECT * FROM identity.mfa_credential($1)`, [p.identityId]);
    expect(rows[0]).toMatchObject({ secret_key_id: 'k1', confirmed: true, last_used_step: '100' });
    expect(Buffer.from(rows[0].secret_ciphertext).toString('hex')).toBe('deadbeef');
    const { rows: codes } = await owner.query(
      `SELECT count(*)::int AS n FROM identity.recovery_codes WHERE identity_id = $1`,
      [p.identityId],
    );
    expect(codes[0].n).toBe(10);
  });

  it('requires exactly 10 recovery codes', async () => {
    const p = await platformIdentity();
    await app.query(`SELECT identity.begin_totp_enrollment($1, '\\x01', 'k1')`, [p.identityId]);
    await inTenantTx(app, null, (db) =>
      expectSqlState(
        db.query(`SELECT identity.confirm_totp_enrollment($1, 1, $2)`, [
          p.identityId,
          tenCodes().slice(0, 9),
        ]),
        SQLSTATE.checkViolation,
      ),
    );
  });

  it('cannot restart enrolment once a factor is confirmed', async () => {
    const p = await enrolled();
    expect(
      (await app.query(`SELECT identity.begin_totp_enrollment($1, '\\x02', 'k2') AS ok`, [p.identityId]))
        .rows[0].ok,
    ).toBe(false);
    const { rows } = await app.query(`SELECT secret_key_id FROM identity.mfa_credential($1)`, [p.identityId]);
    expect(rows[0].secret_key_id).toBe('k1');
  });
});

describe('replay protection (RFC 6238)', () => {
  it('accepts only a time step newer than the last one used', async () => {
    const p = await enrolled(100);
    expect(await accept(p.identityId, 100)).toBe(false); // the enrolment step itself
    expect(await accept(p.identityId, 99)).toBe(false);
    expect(await accept(p.identityId, 101)).toBe(true);
    expect(await accept(p.identityId, 101)).toBe(false); // replay of the same code
  });

  it('accepts nothing before enrolment is confirmed', async () => {
    const p = await platformIdentity();
    await app.query(`SELECT identity.begin_totp_enrollment($1, '\\x01', 'k1')`, [p.identityId]);
    expect(await accept(p.identityId, 500)).toBe(false);
  });
});

describe('recovery codes', () => {
  it('are single use', async () => {
    const p = await enrolled();
    const code = p.codes[3]!;
    const use = async () =>
      (await app.query(`SELECT identity.consume_recovery_code($1, $2) AS ok`, [p.identityId, code])).rows[0]
        .ok;
    expect(await use()).toBe(true);
    expect(await use()).toBe(false);
    expect(
      (await app.query(`SELECT identity.consume_recovery_code($1, $2) AS ok`, [p.identityId, hash()])).rows[0]
        .ok,
    ).toBe(false);
  });
});

describe('login challenge (5 minutes, 5 attempts)', () => {
  async function challenge() {
    const p = await enrolled();
    const token = hash();
    await app.query(`SELECT identity.create_mfa_challenge($1, $2, $3)`, [
      p.identityId,
      p.membershipId,
      token,
    ]);
    return { ...p, token };
  }
  const attempt = async (token: string) =>
    (await app.query(`SELECT * FROM identity.take_mfa_challenge_attempt($1)`, [token])).rows;

  it('allows at most 5 attempts', async () => {
    const c = await challenge();
    for (let i = 0; i < 5; i++) expect(await attempt(c.token)).toHaveLength(1);
    expect(await attempt(c.token)).toEqual([]);
  });

  it('expires after 5 minutes and cannot be used once consumed', async () => {
    const c = await challenge();
    const { rows } = await owner.query(
      `SELECT extract(epoch FROM expires_at - created_at)::int AS ttl FROM identity.mfa_challenges WHERE token_hash = $1`,
      [c.token],
    );
    expect(rows[0].ttl).toBe(300);
    expect((await app.query(`SELECT identity.consume_mfa_challenge($1) AS ok`, [c.token])).rows[0].ok).toBe(
      true,
    );
    expect(await attempt(c.token)).toEqual([]);

    const d = await challenge();
    await owner.query(
      `UPDATE identity.mfa_challenges SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [d.token],
    );
    expect(await attempt(d.token)).toEqual([]);
  });

  it('dies with the membership', async () => {
    const c = await challenge();
    await owner.query(
      `UPDATE identity.platform_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [c.membershipId],
    );
    expect(await attempt(c.token)).toEqual([]);
  });

  it('cannot be created for an identity without an active platform membership', async () => {
    const p = await platformIdentity();
    await owner.query(
      `UPDATE identity.platform_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [p.membershipId],
    );
    await inTenantTx(app, null, (db) =>
      expectSqlState(
        db.query(`SELECT identity.create_mfa_challenge($1, $2, $3)`, [p.identityId, p.membershipId, hash()]),
        SQLSTATE.checkViolation,
      ),
    );
  });
});
