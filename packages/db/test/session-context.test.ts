import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs } from './support/db.js';

// P4.4 (ADR-15 T5): identity.validate_session returns the membership's kind, role and branch, re-read on every call,
// so the API's TenantContext is always current. Called as alphakolect_app.

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

async function activeMerchant() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Context Ltd')`, [
    email('owner'),
    ARGON,
  ]);
  const token = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    token,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [token]);
  const {
    rows: [m],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  return {
    merchantId: s.merchant_id as string,
    identityId: s.identity_id as string,
    membershipId: m.id as string,
  };
}

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

const validate = async (sessionId: string) =>
  (await app.query(`SELECT * FROM identity.validate_session($1)`, [sessionId])).rows[0];

describe('validate_session returns kind, role and branch (T5)', () => {
  it('an owner: kind owner, no role, no branch restriction', async () => {
    const m = await activeMerchant();
    expect(await validate(await session(m.identityId, 'merchant', m.membershipId))).toMatchObject({
      merchant_id: m.merchantId,
      kind: 'owner',
      role_id: null,
      branch_id: null,
    });
  });

  it('a staff member: their role and branch — and a change shows on the very next call', async () => {
    const m = await activeMerchant();
    const roles = await owner.query(
      `INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Cashier'), ($1, 'Supervisor') RETURNING id`,
      [m.merchantId],
    );
    const [cashier, supervisor] = roles.rows.map((r) => r.id as string);
    const {
      rows: [branch],
    } = await owner.query(
      `INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, 'Ikeja') RETURNING id`,
      [m.merchantId],
    );
    const {
      rows: [staffIdentity],
    } = await owner.query(
      `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
      [email('staff')],
    );
    const {
      rows: [staff],
    } = await owner.query(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id, branch_id)
       VALUES ($1, $2, 'staff', $3, $4) RETURNING id`,
      [m.merchantId, staffIdentity.id, cashier, branch.id],
    );
    const sessionId = await session(staffIdentity.id, 'merchant', staff.id);
    expect(await validate(sessionId)).toMatchObject({
      kind: 'staff',
      role_id: cashier,
      branch_id: branch.id,
    });

    await owner.query(
      `UPDATE tenancy.merchant_memberships SET role_id = $2, branch_id = NULL WHERE id = $1`,
      [staff.id, supervisor],
    );
    expect(await validate(sessionId)).toMatchObject({ kind: 'staff', role_id: supervisor, branch_id: null });
  });

  it('a platform super admin: kind is the platform role; no merchant, role or branch', async () => {
    const {
      rows: [identity],
    } = await owner.query(
      `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
      [email('admin')],
    );
    const {
      rows: [pm],
    } = await owner.query(
      `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'super_admin') RETURNING id`,
      [identity.id],
    );
    await owner.query(
      `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at) VALUES ($1, '\\x00', 'k1', now())`,
      [identity.id],
    );
    expect(await validate(await session(identity.id, 'platform', pm.id))).toMatchObject({
      audience: 'platform',
      merchant_id: null,
      kind: 'super_admin',
      role_id: null,
      branch_id: null,
    });
  });

  it('keeps its grant: executable by the app only', async () => {
    const { rows } = await owner.query(`
      SELECT has_function_privilege('alphakolect_app', 'identity.validate_session(uuid)', 'EXECUTE') AS app,
             has_function_privilege('alphakolect_readonly', 'identity.validate_session(uuid)', 'EXECUTE') AS readonly`);
    expect(rows[0]).toEqual({ app: true, readonly: false });
  });
});
