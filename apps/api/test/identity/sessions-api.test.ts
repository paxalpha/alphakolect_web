import { randomBytes } from 'node:crypto';
import {
  AUTH_COOKIES,
  CSRF_HEADER,
  ErrorResponse,
  LoginResponse,
  Session,
  type LoginRequest,
} from '@alphakolect/contracts';
import { argon2id } from 'hash-wasm';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MFA_CHALLENGE_COOKIE } from '../../src/modules/identity/cookies.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { LIMITS } from '../../src/modules/identity/rate-limits.js';
import { hashRecoveryCode, newRecoveryCodes } from '../../src/modules/identity/recovery-codes.js';
import { newOpaqueToken } from '../../src/modules/identity/tokens.js';
import { totpStep } from '../../src/modules/identity/totp.js';
import { createTestApp, TEST_WEB_ORIGIN } from '../support/app.js';
import { databaseWindow, inOneWindow } from '../support/rate-limit-window.js';

// /v1/auth login, refresh, logout and session through the real app and database (ADR-14; P3 exit criteria 3, 5,
// 6, 7, 8, 10, 11).

const { app, auth } = await createTestApp();
const repo = auth.identity;
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
const window = databaseWindow(owner);
beforeAll(() => owner.connect());
afterAll(() => owner.end());

const PASSWORD = 'a long enough passphrase';
const uniqueEmail = (tag: string) => `${tag}-${randomBytes(5).toString('hex')}@example.test`;

async function merchantOwner({ verified = true } = {}) {
  const email = uniqueEmail('owner');
  const signup = await repo.signupMerchantOwner(email, await hashPassword(PASSWORD), 'Session Biz');
  if (verified) {
    const token = newOpaqueToken();
    await repo.issueOneTimeToken(signup.identity_id!, 'email_verification', token.hash, 3600, null);
    await repo.verifyEmail(token.hash);
  }
  return { email, identityId: signup.identity_id!, merchantId: signup.merchant_id! };
}

/** A super admin as the bootstrap CLI leaves it, after following the set-password link (D9, option A). */
async function superAdmin({ totp }: { totp: boolean }) {
  const email = uniqueEmail('admin');
  const {
    rows: [{ id }],
  } = await owner.query(`SELECT identity.bootstrap_super_admin($1, true) AS id`, [email]);
  const setup = newOpaqueToken();
  await repo.issueOneTimeToken(id, 'account_setup', setup.hash, 86400, null);
  await repo.completeAccountSetup(setup.hash, await hashPassword(PASSWORD));
  if (totp) {
    await repo.beginTotpEnrollment(id, randomBytes(60), 'test');
    await repo.confirmTotpEnrollment(
      id,
      totpStep(),
      newRecoveryCodes().map((c) => hashRecoveryCode(c)!),
    );
  }
  return { email, identityId: id as string };
}

/**
 * A distinct client IP per request (the app trusts X-Forwarded-For from a loopback proxy, as behind nginx), so
 * this file does not exhaust the per-IP login limit; per-identifier limits are tested explicitly below.
 */
const clientIp = () => `10.${randomBytes(3).join('.')}`;

const login = (body: Partial<LoginRequest>) =>
  request(app).post('/v1/auth/login').set('X-Forwarded-For', clientIp()).send(body);

/** name → value of the cookies a response sets (empty value = cleared). */
function setCookies(res: request.Response): Map<string, { value: string; raw: string }> {
  const header = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return new Map(
    header.map((raw) => {
      const [pair] = raw.split(';');
      const eq = pair!.indexOf('=');
      return [pair!.slice(0, eq), { value: pair!.slice(eq + 1), raw }];
    }),
  );
}

type Jar = { access: string; refresh: string; csrf: string };

function jarOf(res: request.Response): Jar {
  const c = setCookies(res);
  return {
    access: c.get(AUTH_COOKIES.access)!.value,
    refresh: c.get(AUTH_COOKIES.refresh)!.value,
    csrf: c.get(AUTH_COOKIES.csrf)!.value,
  };
}

const cookieHeader = (pairs: Record<string, string>) =>
  Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

const getSession = (jar: Jar) =>
  request(app)
    .get('/v1/auth/session')
    .set('Cookie', cookieHeader({ [AUTH_COOKIES.access]: jar.access, [AUTH_COOKIES.csrf]: jar.csrf }));

const refresh = (jar: Partial<Jar>, { csrf = jar.csrf, origin = TEST_WEB_ORIGIN } = {}) => {
  const req = request(app)
    .post('/v1/auth/refresh')
    .set('X-Forwarded-For', clientIp())
    .set(
      'Cookie',
      cookieHeader({
        ...(jar.refresh ? { [AUTH_COOKIES.refresh]: jar.refresh } : {}),
        ...(jar.csrf ? { [AUTH_COOKIES.csrf]: jar.csrf } : {}),
      }),
    );
  if (origin) req.set('Origin', origin);
  if (csrf) req.set(CSRF_HEADER, csrf);
  return req;
};

const logout = (jar: Jar, { csrf = true } = {}) => {
  const req = request(app)
    .post('/v1/auth/logout')
    .set('Cookie', cookieHeader({ [AUTH_COOKIES.access]: jar.access, [AUTH_COOKIES.csrf]: jar.csrf }))
    .set('Origin', TEST_WEB_ORIGIN);
  return csrf ? req.set(CSRF_HEADER, jar.csrf) : req;
};

const auditRows = async (requestId: string | undefined) =>
  (
    await owner.query(
      `SELECT action, outcome, merchant_id, actor_identity_id, actor_audience, summary
         FROM audit.audit_events WHERE request_id = $1 ORDER BY occurred_at`,
      [requestId],
    )
  ).rows;

/** Max-Age is the time left, so allow for the seconds the test itself takes. */
function expectMaxAge(cookie: string, seconds: number) {
  const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
  expect(maxAge).toBeLessThanOrEqual(seconds);
  expect(maxAge).toBeGreaterThan(seconds - 30);
}

/** Exit criterion 3: no session secret may appear in a response body. */
function expectNoSecretsInBody(res: request.Response) {
  const body = JSON.stringify(res.body);
  for (const { value } of setCookies(res).values()) {
    if (value.length > 0) expect(body).not.toContain(value);
  }
  expect(body).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./); // no JWT
}

describe('POST /v1/auth/login — merchant owner', () => {
  it('signs in with session cookies only, a contract-conformant body, and an audit event', async () => {
    const m = await merchantOwner();
    const res = await login({ email: m.email.toUpperCase(), password: PASSWORD, audience: 'merchant' });

    expect(res.status).toBe(200);
    expect(LoginResponse.parse(res.body)).toEqual({
      status: 'authenticated',
      session: {
        identityId: m.identityId,
        audience: 'merchant',
        membershipId: expect.any(String),
        merchantId: m.merchantId,
        scope: 'full',
      },
    });
    const cookies = setCookies(res);
    expect([...cookies.keys()].sort()).toEqual(
      [AUTH_COOKIES.access, AUTH_COOKIES.csrf, AUTH_COOKIES.refresh].sort(),
    );
    expectMaxAge(cookies.get(AUTH_COOKIES.refresh)!.raw, 86400); // D5 merchant idle timeout
    expectNoSecretsInBody(res);

    expect(await auditRows(res.headers['x-request-id'])).toEqual([
      {
        action: 'auth.login',
        outcome: 'success',
        merchant_id: m.merchantId,
        actor_identity_id: m.identityId,
        actor_audience: 'merchant',
        summary: { stage: 'authenticated' },
      },
    ]);

    const session = await getSession(jarOf(res));
    expect(session.status).toBe(200);
    expect(Session.parse(session.body)).toEqual(res.body.session);
  });

  it('answers a wrong password and an unknown email identically (D12, exit criterion 8)', async () => {
    const m = await merchantOwner();
    const wrong = await login({ email: m.email, password: 'not the password at all', audience: 'merchant' });
    const unknown = await login({ email: uniqueEmail('nobody'), password: PASSWORD, audience: 'merchant' });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(ErrorResponse.parse(res.body).error.code).toBe('INVALID_CREDENTIALS');
    }
    const { requestId: _a, ...wrongError } = wrong.body.error;
    const { requestId: _b, ...unknownError } = unknown.body.error;
    expect(wrongError).toEqual(unknownError);

    const [audit] = await auditRows(wrong.headers['x-request-id']);
    expect(audit).toMatchObject({ outcome: 'failure', summary: { reason: 'wrong_password' } });
    expect(JSON.stringify(audit)).not.toContain('not the password at all');
  });

  it('tells only correct credentials that the email is unverified (D12)', async () => {
    const m = await merchantOwner({ verified: false });
    const wrong = await login({ email: m.email, password: 'not the password at all', audience: 'merchant' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const right = await login({ email: m.email, password: PASSWORD, audience: 'merchant' });
    expect(right.status).toBe(403);
    expect(right.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(right.headers['set-cookie']).toBeUndefined();
  });

  it('refuses an account without a membership for the requested audience, like a wrong password', async () => {
    const m = await merchantOwner();
    const res = await login({ email: m.email, password: PASSWORD, audience: 'platform' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses merchant staff in P3 (D3: owners only until P4), like a wrong password', async () => {
    const m = await merchantOwner();
    const email = uniqueEmail('staff');
    const {
      rows: [staff],
    } = await owner.query(
      `INSERT INTO identity.identities (email, password_hash, email_verified_at) VALUES ($1, $2, now()) RETURNING id`,
      [email, await hashPassword(PASSWORD)],
    );
    await owner.query(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'staff')`,
      [m.merchantId, staff.id],
    );
    const res = await login({ email, password: PASSWORD, audience: 'merchant' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('upgrades a password hash made with older parameters (D15)', async () => {
    const m = await merchantOwner();
    const weak = await argon2id({
      password: PASSWORD,
      salt: randomBytes(16),
      memorySize: 8192,
      iterations: 1,
      parallelism: 1,
      hashLength: 32,
      outputType: 'encoded',
    });
    await owner.query(`UPDATE identity.identities SET password_hash = $2 WHERE id = $1`, [
      m.identityId,
      weak,
    ]);

    expect((await login({ email: m.email, password: PASSWORD, audience: 'merchant' })).status).toBe(200);
    const {
      rows: [row],
    } = await owner.query(`SELECT password_hash FROM identity.identities WHERE id = $1`, [m.identityId]);
    expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('rate-limits per identifier with 429 and Retry-After (D13, exit criterion 8)', async () => {
    await inOneWindow(window, LIMITS.login.windowSeconds, async () => {
      const email = uniqueEmail('limited');
      for (let i = 0; i < LIMITS.login.perIdentifier; i++) {
        expect((await login({ email, password: 'whatever it is', audience: 'merchant' })).status).toBe(401);
      }
      const res = await login({ email, password: 'whatever it is', audience: 'merchant' });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  it('accepts only JSON, so a cross-site HTML form cannot sign a victim in (login CSRF)', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ email: 'a@example.test', password: PASSWORD, audience: 'merchant' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /v1/auth/login — platform super admin (D8, exit criterion 7)', () => {
  it('without TOTP: an enrolment-only session that cannot reach anything else', async () => {
    const a = await superAdmin({ totp: false });
    const res = await login({ email: a.email, password: PASSWORD, audience: 'platform' });
    expect(res.status).toBe(200);
    expect(LoginResponse.parse(res.body)).toMatchObject({
      status: 'mfa_enrollment_required',
      session: { audience: 'platform', scope: 'mfa_enrollment', merchantId: null },
    });
    expectMaxAge(setCookies(res).get(AUTH_COOKIES.refresh)!.raw, 900); // D8 enrolment session
    expectNoSecretsInBody(res);
    expect((await getSession(jarOf(res))).body.scope).toBe('mfa_enrollment');
  });

  it('with TOTP: no session at all, only an HttpOnly MFA challenge cookie scoped to /v1/auth/mfa', async () => {
    const a = await superAdmin({ totp: true });
    const res = await login({ email: a.email, password: PASSWORD, audience: 'platform' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'mfa_required' });
    const cookies = setCookies(res);
    expect([...cookies.keys()]).toEqual([MFA_CHALLENGE_COOKIE]);
    expect(cookies.get(MFA_CHALLENGE_COOKIE)!.raw).toMatch(/HttpOnly/);
    expect(cookies.get(MFA_CHALLENGE_COOKIE)!.raw).toMatch(/Path=\/v1\/auth\/mfa/);
    expectNoSecretsInBody(res);

    const {
      rows: [count],
    } = await owner.query(`SELECT count(*)::int AS n FROM identity.sessions WHERE identity_id = $1`, [
      a.identityId,
    ]);
    expect(count.n).toBe(0);
  });
});

describe('POST /v1/auth/refresh (exit criterion 5)', () => {
  const signedIn = async () => {
    const m = await merchantOwner();
    return jarOf(await login({ email: m.email, password: PASSWORD, audience: 'merchant' }));
  };

  it('rotates the refresh token and issues a new access token, keeping the CSRF token', async () => {
    const jar = await signedIn();
    const res = await refresh(jar);
    expect(res.status).toBe(200);
    expect(Session.safeParse(res.body).success).toBe(true);
    expectNoSecretsInBody(res);
    const next = jarOf(res);
    expect(next.refresh).not.toBe(jar.refresh);
    expect(next.csrf).toBe(jar.csrf);
    expect((await getSession(next)).status).toBe(200);
    expect((await refresh(next)).status).toBe(200);
  });

  it('audits every successful refresh, lightly and without any token (P3.5 review)', async () => {
    const m = await merchantOwner();
    const signin = await login({ email: m.email, password: PASSWORD, audience: 'merchant' });
    const jar = jarOf(signin);
    const res = await refresh(jar);
    const [row] = await auditRows(res.headers['x-request-id']);
    expect(row).toEqual({
      action: 'auth.refresh',
      outcome: 'success',
      merchant_id: m.merchantId,
      actor_identity_id: m.identityId,
      actor_audience: 'merchant',
      summary: {},
    });
    const {
      rows: [full],
    } = await owner.query(`SELECT * FROM audit.audit_events WHERE request_id = $1`, [
      res.headers['x-request-id'],
    ]);
    const stored = JSON.stringify(full);
    for (const secret of [jar.access, jar.refresh, jar.csrf, ...Object.values(jarOf(res))]) {
      expect(stored).not.toContain(secret);
    }
    expect(full).toMatchObject({
      target_type: 'session',
      target_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('reuse of a rotated token ends the session for everyone, clears cookies and is audited', async () => {
    const jar = await signedIn();
    const next = jarOf(await refresh(jar));

    const replay = await refresh(jar);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(setCookies(replay).get(AUTH_COOKIES.refresh)!.value).toBe('');

    expect((await refresh(next)).status).toBe(401);
    expect((await getSession(next)).status).toBe(401);
    expect(await auditRows(replay.headers['x-request-id'])).toEqual([
      expect.objectContaining({
        action: 'auth.refresh_token_reuse',
        outcome: 'denied',
        summary: { severity: 'high', sessionRevoked: true },
      }),
    ]);
  });

  it('a missing, malformed or unknown refresh cookie gets 401, cleared cookies and a failure audit', async () => {
    const jar = await signedIn();
    const cases: Array<[Partial<Jar>, string]> = [
      [{ csrf: jar.csrf }, 'no_token'],
      [{ ...jar, refresh: 'nope' }, 'malformed_token'],
      [{ ...jar, refresh: newOpaqueToken().raw }, 'invalid_or_expired'],
    ];
    for (const [cookies, reason] of cases) {
      const res = await refresh(cookies);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
      expect(setCookies(res).get(AUTH_COOKIES.access)!.value).toBe('');
      expect(await auditRows(res.headers['x-request-id'])).toEqual([
        expect.objectContaining({ action: 'auth.refresh', outcome: 'failure', summary: { reason } }),
      ]);
    }
  });

  it.each([
    ['no CSRF header', { csrf: '' }],
    ['a CSRF header that does not match', { csrf: 'something-else' }],
    ['a foreign Origin', { origin: 'https://evil.example' }],
    ['no Origin', { origin: '' }],
  ])('refuses %s with 403 CSRF_FAILED and leaves the cookies alone', async (_label, options) => {
    const jar = await signedIn();
    const res = await refresh(jar, options);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect((await refresh(jar)).status).toBe(200); // the token was not spent
  });
});

describe('POST /v1/auth/logout (exit criterion 6)', () => {
  it('revokes the session, clears cookies, audits, and the old access token stops working at once', async () => {
    const m = await merchantOwner();
    const jar = jarOf(await login({ email: m.email, password: PASSWORD, audience: 'merchant' }));

    const res = await logout(jar);
    expect(res.status).toBe(204);
    const cleared = setCookies(res);
    for (const name of [AUTH_COOKIES.access, AUTH_COOKIES.refresh, AUTH_COOKIES.csrf]) {
      expect(cleared.get(name)?.value).toBe('');
    }
    expect((await getSession(jar)).status).toBe(401);
    expect((await refresh(jar)).status).toBe(401);
    expect(await auditRows(res.headers['x-request-id'])).toEqual([
      expect.objectContaining({ action: 'auth.logout', outcome: 'success', merchant_id: m.merchantId }),
    ]);
  });

  it('requires the CSRF header like any cookie-authenticated state change', async () => {
    const m = await merchantOwner();
    const jar = jarOf(await login({ email: m.email, password: PASSWORD, audience: 'merchant' }));
    const res = await logout(jar, { csrf: false });
    expect(res.status).toBe(403);
    expect((await getSession(jar)).status).toBe(200);
  });

  it('works for an enrolment-only platform session', async () => {
    const a = await superAdmin({ totp: false });
    const jar = jarOf(await login({ email: a.email, password: PASSWORD, audience: 'platform' }));
    expect((await logout(jar)).status).toBe(204);
    expect((await getSession(jar)).status).toBe(401);
  });
});

describe('GET /v1/auth/session', () => {
  it('requires a session', async () => {
    const res = await request(app).get('/v1/auth/session');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
