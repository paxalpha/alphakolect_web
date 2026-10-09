import { randomBytes } from 'node:crypto';
import { AUTH_COOKIES, CSRF_HEADER, defineEndpoint, type EndpointContract } from '@alphakolect/contracts';
import express from 'express';
import pg from 'pg';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { AccessClaims } from '../../src/modules/identity/access-tokens.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { newOpaqueToken } from '../../src/modules/identity/tokens.js';
import { authenticate } from '../../src/platform/http/authenticate.js';
import { errorHandler } from '../../src/platform/http/error-handler.js';
import { resolveRequestId } from '../../src/platform/http/request-id.js';
import { createTestApp, TEST_WEB_ORIGIN } from '../support/app.js';

// The authentication middleware (ADR-14 D6, D7; P3 exit criteria 6, 9, 10) against real sessions in the real
// database. Synthetic endpoints isolate each rule.

const { auth } = await createTestApp();
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
afterAll(() => owner.end());

const ep = (e: Omit<EndpointContract, 'id' | 'path' | 'summary' | 'responses'> & { id: string }) =>
  defineEndpoint({
    ...e,
    path: `/v1/test/${e.id}`,
    summary: e.id,
    responses: { 200: { description: 'ok' } },
  });

const E = {
  merchantRead: ep({
    id: 'merchantRead',
    method: 'get',
    audience: 'merchant',
    security: ['cookieSession', 'bearer'],
  }),
  merchantWrite: ep({
    id: 'merchantWrite',
    method: 'post',
    audience: 'merchant',
    security: ['cookieSession'],
  }),
  anyRead: ep({
    id: 'anyRead',
    method: 'get',
    audience: 'authenticated',
    security: ['cookieSession', 'bearer'],
  }),
  platformRead: ep({ id: 'platformRead', method: 'get', audience: 'platform', security: ['cookieSession'] }),
  enrol: ep({
    id: 'enrol',
    method: 'post',
    audience: 'platform',
    security: ['cookieSession'],
    sessionScope: 'mfa_enrollment',
  }),
  agentRead: ep({ id: 'agentRead', method: 'get', audience: 'agent', security: ['bearer'] }),
};

const app = express();
app.use(express.json());
app.use(pinoHttp({ logger: pino({ level: 'silent' }), genReqId: resolveRequestId }));
for (const e of Object.values(E)) {
  app[e.method](e.path, authenticate(e, auth), (req, res) => {
    res.json(req.auth);
  });
}
app.use(errorHandler);

type Session = { claims: AccessClaims; token: string };
let merchant: Session;
let platformEnrolment: Session;
let agent: Session;

async function session(
  identityId: string,
  audience: AccessClaims['aud'],
  membershipId: string,
  scope: 'full' | 'mfa_enrollment',
  lifetime: { idleSeconds: number; absoluteSeconds: number },
): Promise<Session> {
  const s = await auth.identity.createSession({
    identityId,
    audience,
    membershipId,
    scope,
    refreshHash: newOpaqueToken().hash,
    lifetime,
    ip: null,
    userAgent: null,
  });
  const claims = { sub: identityId, sid: s.session_id, aud: audience, mid: membershipId };
  return { claims, token: await auth.accessTokens.sign(claims) };
}

beforeAll(async () => {
  await owner.connect();
  // merchant owner
  const email = `auth-${randomBytes(4).toString('hex')}@example.test`;
  const signup = await auth.identity.signupMerchantOwner(
    email,
    await hashPassword('a long enough passphrase'),
    'Auth Biz',
  );
  // Verified, as a real owner is before signing in: only an active merchant's members get sessions (P4.1).
  const verification = newOpaqueToken();
  await auth.identity.issueOneTimeToken(
    signup.identity_id!,
    'email_verification',
    verification.hash,
    3600,
    null,
  );
  await auth.identity.verifyEmail(verification.hash);
  const resolved = await auth.identity.resolveLoginMembership(
    signup.identity_id!,
    'merchant',
    newOpaqueToken().hash,
  );
  merchant = await session(signup.identity_id!, 'merchant', resolved.membership_id!, 'full', {
    idleSeconds: 86400,
    absoluteSeconds: 1209600,
  });

  // platform super admin without TOTP yet: only an enrolment session is possible
  const {
    rows: [p],
  } = await owner.query(`SELECT identity.bootstrap_super_admin($1, true) AS id`, [
    `sa-${randomBytes(4).toString('hex')}@example.test`,
  ]);
  const {
    rows: [pm],
  } = await owner.query(`SELECT id FROM identity.platform_memberships WHERE identity_id = $1`, [p.id]);
  platformEnrolment = await session(p.id, 'platform', pm.id, 'mfa_enrollment', {
    idleSeconds: 900,
    absoluteSeconds: 900,
  });

  // agent of the merchant
  const {
    rows: [a],
  } = await owner.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
    `agent-${randomBytes(4).toString('hex')}@example.test`,
  ]);
  const {
    rows: [am],
  } = await owner.query(
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent') RETURNING id`,
    [signup.merchant_id, a.id],
  );
  agent = await session(a.id, 'agent', am.id, 'full', { idleSeconds: 86400, absoluteSeconds: 864000 });
});

const cookie = (token: string, csrf = 'csrf-token-value') =>
  `${AUTH_COOKIES.access}=${token}; ${AUTH_COOKIES.csrf}=${csrf}`;
const get = (e: EndpointContract) => request(app).get(e.path);
const post = (e: EndpointContract) => request(app).post(e.path);

describe('who gets in', () => {
  it('a valid merchant cookie session, with its context attached', async () => {
    const res = await get(E.merchantRead).set('Cookie', cookie(merchant.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      identityId: merchant.claims.sub,
      sessionId: merchant.claims.sid,
      audience: 'merchant',
      membershipId: merchant.claims.mid,
      scope: 'full',
      transport: 'cookie',
    });
    expect(res.body.merchantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('an agent bearer session on an agent endpoint', async () => {
    const res = await get(E.agentRead).set('Authorization', `Bearer ${agent.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ audience: 'agent', transport: 'bearer' });
  });

  it("any audience on an 'authenticated' endpoint", async () => {
    expect((await get(E.anyRead).set('Cookie', cookie(merchant.token))).status).toBe(200);
    expect((await get(E.anyRead).set('Authorization', `Bearer ${agent.token}`)).status).toBe(200);
  });
});

describe('who is kept out', () => {
  const expectCode = async (res: request.Response, status: number, code: string) => {
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  };

  it('no credential at all', async () => {
    await expectCode(await get(E.merchantRead), 401, 'UNAUTHENTICATED');
  });

  it('tokens in the query string or request body (never read)', async () => {
    await expectCode(
      await request(app).get(`${E.merchantRead.path}?access_token=${merchant.token}`),
      401,
      'UNAUTHENTICATED',
    );
    await expectCode(
      await post(E.merchantWrite).send({ access_token: merchant.token, token: merchant.token }),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('a web-audience token sent as a bearer (transport fixed per audience, D7)', async () => {
    await expectCode(
      await get(E.merchantRead).set('Authorization', `Bearer ${merchant.token}`),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('a mobile-audience token sent as a cookie', async () => {
    await expectCode(await get(E.anyRead).set('Cookie', cookie(agent.token)), 401, 'UNAUTHENTICATED');
  });

  it('a scheme the endpoint does not accept', async () => {
    await expectCode(await get(E.agentRead).set('Cookie', cookie(agent.token)), 401, 'UNAUTHENTICATED');
  });

  it('cookie and bearer together (ambiguous)', async () => {
    await expectCode(
      await get(E.anyRead)
        .set('Cookie', cookie(merchant.token))
        .set('Authorization', `Bearer ${agent.token}`),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('a session of another audience (exit criterion 9)', async () => {
    await expectCode(await get(E.platformRead).set('Cookie', cookie(merchant.token)), 403, 'WRONG_AUDIENCE');
  });

  it('forged or mismatched claims', async () => {
    await expectCode(
      await get(E.merchantRead).set('Cookie', cookie(`${merchant.token}x`)),
      401,
      'UNAUTHENTICATED',
    );
    // a correctly signed token whose session belongs to someone else's membership
    const mismatched = await auth.accessTokens.sign({ ...merchant.claims, mid: agent.claims.mid });
    await expectCode(await get(E.merchantRead).set('Cookie', cookie(mismatched)), 401, 'UNAUTHENTICATED');
  });

  it('an enrolment-only platform session outside the enrolment endpoints', async () => {
    await expectCode(
      await get(E.platformRead).set('Cookie', cookie(platformEnrolment.token)),
      403,
      'MFA_ENROLLMENT_REQUIRED',
    );
    const ok = await post(E.enrol)
      .set('Cookie', cookie(platformEnrolment.token))
      .set('Origin', TEST_WEB_ORIGIN)
      .set(CSRF_HEADER, 'csrf-token-value');
    expect(ok.status).toBe(200);
  });

  it('a revoked session, on the very next request (exit criterion 6)', async () => {
    const victim = await session(merchant.claims.sub, 'merchant', merchant.claims.mid, 'full', {
      idleSeconds: 86400,
      absoluteSeconds: 1209600,
    });
    expect((await get(E.merchantRead).set('Cookie', cookie(victim.token))).status).toBe(200);
    await auth.identity.revokeSession(victim.claims.sid, 'logout');
    await expectCode(await get(E.merchantRead).set('Cookie', cookie(victim.token)), 401, 'UNAUTHENTICATED');
  });

  it('a deactivated membership, on the very next request (BR-10.6b)', async () => {
    const before = await get(E.agentRead).set('Authorization', `Bearer ${agent.token}`);
    expect(before.status).toBe(200);
    await owner.query(
      `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [agent.claims.mid],
    );
    await expectCode(
      await get(E.agentRead).set('Authorization', `Bearer ${agent.token}`),
      401,
      'UNAUTHENTICATED',
    );
  });
});

describe('CSRF on cookie-authenticated state changes (D7, exit criterion 10)', () => {
  const write = () => post(E.merchantWrite).set('Cookie', cookie(merchant.token));

  it('passes with an allowed Origin and the matching CSRF header', async () => {
    expect((await write().set('Origin', TEST_WEB_ORIGIN).set(CSRF_HEADER, 'csrf-token-value')).status).toBe(
      200,
    );
  });

  it.each([
    ['no Origin', (r: request.Test) => r.set(CSRF_HEADER, 'csrf-token-value')],
    [
      'a foreign Origin',
      (r: request.Test) => r.set('Origin', 'https://evil.example').set(CSRF_HEADER, 'csrf-token-value'),
    ],
    ['no CSRF header', (r: request.Test) => r.set('Origin', TEST_WEB_ORIGIN)],
    [
      'a CSRF header that does not match the cookie',
      (r: request.Test) => r.set('Origin', TEST_WEB_ORIGIN).set(CSRF_HEADER, 'something-else'),
    ],
  ])('is refused with %s', async (_label, decorate) => {
    const res = await decorate(write());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('is not required for safe methods', async () => {
    expect((await get(E.merchantRead).set('Cookie', cookie(merchant.token))).status).toBe(200);
  });
});
