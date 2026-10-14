import { randomBytes } from 'node:crypto';
import { AUTH_COOKIES, CSRF_HEADER } from '@alphakolect/contracts';
import type { Express } from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, expect, inject } from 'vitest';
import type { AccessTokens, SessionAudience } from '../../src/modules/identity/access-tokens.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import type { IdentityRepository } from '../../src/modules/identity/repository.js';
import { newOpaqueToken } from '../../src/modules/identity/tokens.js';
import { TEST_WEB_ORIGIN } from './app.js';

// Tenancy fixtures for API tests (P4): businesses, members of each kind and platform admins, each with a live
// session token as the API would hold it after sign-in. Rows the app may not write are created as the table owner.

export const TEST_PASSWORD = 'a long enough passphrase';
const CSRF = 'csrf-token-for-the-test';

export const uniqueEmail = (tag: string) => `${tag}-${randomBytes(5).toString('hex')}@example.test`;

export function tenancyFixtures(
  app: Express,
  auth: { identity: IdentityRepository; accessTokens: AccessTokens },
) {
  const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
  beforeAll(() => owner.connect());
  afterAll(() => owner.end());

  async function token(identityId: string, audience: SessionAudience, membershipId: string) {
    const s = await auth.identity.createSession({
      identityId,
      audience,
      membershipId,
      scope: 'full',
      refreshHash: newOpaqueToken().hash,
      lifetime:
        audience === 'platform'
          ? { idleSeconds: 3600, absoluteSeconds: 43200 }
          : { idleSeconds: 86400, absoluteSeconds: 1209600 },
      ip: null,
      userAgent: null,
    });
    return {
      sessionId: s.session_id,
      token: await auth.accessTokens.sign({
        sub: identityId,
        sid: s.session_id,
        aud: audience,
        mid: membershipId,
      }),
    };
  }

  /** An active business (signup + verification) with one role and one branch; its owner signed in. */
  async function business(name = 'Fixture Savings') {
    const email = uniqueEmail('owner');
    const signup = await auth.identity.signupMerchantOwner(email, await hashPassword(TEST_PASSWORD), name);
    const t = newOpaqueToken();
    await auth.identity.issueOneTimeToken(signup.identity_id!, 'email_verification', t.hash, 3600, null);
    await auth.identity.verifyEmail(t.hash);
    const merchantId = signup.merchant_id!;
    const {
      rows: [m],
    } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
      signup.identity_id,
    ]);
    const insert = async (table: 'roles' | 'branches', itemName: string) =>
      (
        await owner.query(`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
          merchantId,
          itemName,
        ])
      ).rows[0].id as string;
    return {
      merchantId,
      roleId: await insert('roles', 'Cashier'),
      branchId: await insert('branches', 'Head office'),
      owner: {
        email,
        identityId: signup.identity_id!,
        membershipId: m.id as string,
        ...(await token(signup.identity_id!, 'merchant', m.id)),
      },
    };
  }

  /** A member of the business; staff get its role. Verified email unless told otherwise. */
  async function member(
    b: { merchantId: string; roleId: string },
    kind: 'staff' | 'agent',
    { verified = true } = {},
  ) {
    const email = uniqueEmail(kind);
    const {
      rows: [identity],
    } = await owner.query(
      `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [email, verified ? new Date() : null, await hashPassword(TEST_PASSWORD)],
    );
    const {
      rows: [m],
    } = await owner.query(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [b.merchantId, identity.id, kind, kind === 'staff' ? b.roleId : null],
    );
    return {
      email,
      identityId: identity.id as string,
      membershipId: m.id as string,
      ...(await token(identity.id, kind === 'agent' ? 'agent' : 'merchant', m.id)),
    };
  }

  /** A platform admin (TOTP enrolled) with a full platform session. */
  async function platformAdmin(role = 'super_admin') {
    const {
      rows: [identity],
    } = await owner.query(
      `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
      [uniqueEmail('admin')],
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
      ...(await token(identity.id, 'platform', pm.id)),
    };
  }

  /** A request as the web app makes it: cookie session, plus Origin and CSRF header for state changes. */
  function call(accessToken: string, method: 'get' | 'post' | 'patch' | 'put', path: string, body?: object) {
    const client = request(app);
    const req = client[method](path).set(
      'Cookie',
      `${AUTH_COOKIES.access}=${accessToken}; ${AUTH_COOKIES.csrf}=${CSRF}`,
    );
    if (method !== 'get') req.set('Origin', TEST_WEB_ORIGIN).set(CSRF_HEADER, CSRF);
    return body ? req.send(body) : req.send();
  }

  /** The audit rows written while serving `res`. */
  const auditFor = async (res: request.Response) =>
    (
      await owner.query(
        `SELECT action, outcome, merchant_id, actor_identity_id, target_type, target_id, summary
           FROM audit.audit_events WHERE request_id = $1 ORDER BY occurred_at`,
        [res.headers['x-request-id']],
      )
    ).rows;

  return { owner, token, business, member, platformAdmin, call, auditFor };
}

export function expectError(res: request.Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}
