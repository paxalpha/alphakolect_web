import { randomBytes } from 'node:crypto';
import { AUTH_COOKIES, CSRF_HEADER, MfaVerified, TotpEnrolled, TotpEnrollment } from '@alphakolect/contracts';
import request from 'supertest';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { bootstrapSuperAdmin } from '../../src/modules/identity/bootstrap.js';
import { MFA_CHALLENGE_COOKIE } from '../../src/modules/identity/cookies.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { totpCode, totpStep } from '../../src/modules/identity/totp.js';
import { createDb } from '../../src/platform/db.js';
import type { EmailSender } from '../../src/platform/email.js';
import { createTestApp, TEST_WEB_APP_URL, TEST_WEB_ORIGIN } from '../support/app.js';

// The D9 → D8 journey through the real app and database: bootstrap (migrator), setup link, first login
// (enrolment-only), TOTP enrolment, then the login second step with TOTP or a recovery code (exit criterion 7).

const { app, auth, email } = await createTestApp();
const migrator = createDb(inject('ownerDatabaseUrl'));
afterAll(() => migrator.close());

const PASSWORD = 'a long enough passphrase';
const uniqueEmail = (tag: string) => `${tag}-${randomBytes(5).toString('hex')}@example.test`;
const clientIp = () => `10.${randomBytes(3).join('.')}`;

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of text) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}

function cookiesOf(res: request.Response): Map<string, string> {
  const header = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return new Map(header.map((c) => c.split(';')[0]!.split('=') as [string, string]));
}

type Jar = { access: string; csrf: string };
const jarOf = (res: request.Response): Jar => {
  const c = cookiesOf(res);
  return { access: c.get(AUTH_COOKIES.access)!, csrf: c.get(AUTH_COOKIES.csrf)! };
};

/** A cookie-authenticated, CSRF-protected POST, as the web app makes it. */
const postAs = (jar: Jar, path: string, body?: object) => {
  const req = request(app)
    .post(path)
    .set('X-Forwarded-For', clientIp())
    .set('Cookie', `${AUTH_COOKIES.access}=${jar.access}; ${AUTH_COOKIES.csrf}=${jar.csrf}`)
    .set('Origin', TEST_WEB_ORIGIN)
    .set(CSRF_HEADER, jar.csrf);
  return body ? req.send(body) : req.send();
};
const session = (jar: Jar) =>
  request(app).get('/v1/auth/session').set('Cookie', `${AUTH_COOKIES.access}=${jar.access}`);
const login = (address: string) =>
  request(app)
    .post('/v1/auth/login')
    .set('X-Forwarded-For', clientIp())
    .send({ email: address, password: PASSWORD, audience: 'platform' });
const verify = (challenge: string | undefined, body: object) => {
  const req = request(app).post('/v1/auth/mfa/verify').set('X-Forwarded-For', clientIp());
  if (challenge) req.set('Cookie', `${MFA_CHALLENGE_COOKIE}=${challenge}`);
  return req.send(body);
};

/** Bootstrap → setup link → first password → first login: an enrolment-only platform session. */
async function newAdmin() {
  const address = uniqueEmail('admin');
  const result = await bootstrapSuperAdmin({
    migrator,
    sender: email,
    webAppUrl: TEST_WEB_APP_URL,
    email: address,
    allowAdditional: true,
  });
  expect(result.outcome).toBe('setup_link_sent');
  const message = email.to(address).find((m) => m.template === 'account_setup')!;
  const token = /set-password#token=([A-Za-z0-9_-]{43})/.exec(message.text)![1]!;
  const setup = await request(app)
    .post('/v1/auth/password/setup')
    .set('X-Forwarded-For', clientIp())
    .send({ token, password: PASSWORD });
  expect(setup.status).toBe(204);
  const first = await login(address);
  expect(first.body.status).toBe('mfa_enrollment_required');
  return { address, identityId: result.identityId, jar: jarOf(first) };
}

/** Enrol TOTP; returns the secret, the recovery codes and the new full session. */
async function enrolled() {
  const admin = await newAdmin();
  const begin = await postAs(admin.jar, '/v1/auth/mfa/totp/enrollment');
  const secret = base32Decode(TotpEnrollment.parse(begin.body).secret);
  const confirm = await postAs(admin.jar, '/v1/auth/mfa/totp/confirm', {
    code: totpCode(secret, totpStep()),
  });
  expect(confirm.status).toBe(200);
  return {
    ...admin,
    secret,
    recoveryCodes: TotpEnrolled.parse(confirm.body).recoveryCodes,
    full: jarOf(confirm),
  };
}

/** Sign in with the password: only an MFA challenge cookie comes back. */
async function challenge(address: string): Promise<string> {
  const res = await login(address);
  expect(res.body).toEqual({ status: 'mfa_required' });
  return cookiesOf(res).get(MFA_CHALLENGE_COOKIE)!;
}

describe('TOTP enrolment from the enrolment-only session (D8)', () => {
  it('issues a secret once (no-store), confirms with a code, returns 10 recovery codes and a full session', async () => {
    const admin = await newAdmin();
    const begin = await postAs(admin.jar, '/v1/auth/mfa/totp/enrollment');
    expect(begin.status).toBe(200);
    expect(begin.headers['cache-control']).toBe('no-store');
    const enrolment = TotpEnrollment.parse(begin.body);
    expect(enrolment.otpauthUri).toContain(`secret=${enrolment.secret}`);
    const secret = base32Decode(enrolment.secret);

    const wrong = await postAs(admin.jar, '/v1/auth/mfa/totp/confirm', {
      code: '000000' === totpCode(secret, totpStep()) ? '111111' : '000000',
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_MFA_CODE');

    const code = totpCode(secret, totpStep());
    const confirm = await postAs(admin.jar, '/v1/auth/mfa/totp/confirm', { code });
    expect(confirm.status).toBe(200);
    expect(confirm.headers['cache-control']).toBe('no-store');
    const body = TotpEnrolled.parse(confirm.body);
    expect(body.session).toMatchObject({ audience: 'platform', scope: 'full' });
    expect(new Set(body.recoveryCodes).size).toBe(10);
    expect(JSON.stringify(body)).not.toContain(code);

    expect((await session(admin.jar)).status).toBe(401); // the enrolment session is over
    expect((await session(jarOf(confirm))).body.scope).toBe('full');

    const rows = await migrator.query<{ secret_ciphertext: Buffer; hashes: string[] }>(
      `SELECT t.secret_ciphertext, array_agg(r.code_hash) AS hashes FROM identity.totp_credentials t
         JOIN identity.recovery_codes r ON r.identity_id = t.identity_id
        WHERE t.identity_id = $1 GROUP BY t.secret_ciphertext`,
      [admin.identityId],
    );
    expect(rows[0]!.secret_ciphertext.includes(secret)).toBe(false); // encrypted at rest
    expect(rows[0]!.hashes.join()).not.toContain(body.recoveryCodes[0]!.replace(/-/g, ''));
  });

  it('cannot enrol twice', async () => {
    const admin = await enrolled();
    const res = await postAs(admin.full, '/v1/auth/mfa/totp/enrollment');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MFA_ALREADY_ENROLLED');
  });
});

describe('login second step (exit criterion 7)', () => {
  it('a valid code completes sign-in; the same code cannot be replayed', async () => {
    const admin = await enrolled();
    const code = totpCode(admin.secret, totpStep() + 1); // the enrolment code used the current step
    const res = await verify(await challenge(admin.address), { code });
    expect(res.status).toBe(200);
    expect(MfaVerified.parse(res.body)).toMatchObject({
      status: 'authenticated',
      session: { scope: 'full' },
    });
    const cookies = cookiesOf(res);
    expect(cookies.get(MFA_CHALLENGE_COOKIE)).toBe('');
    expect((await session(jarOf(res))).status).toBe(200);

    const replay = await verify(await challenge(admin.address), { code });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_MFA_CODE');
  });

  it('a challenge that completed sign-in cannot be used again', async () => {
    const admin = await enrolled();
    const c = await challenge(admin.address);
    expect((await verify(c, { recoveryCode: admin.recoveryCodes[0]! })).status).toBe(200);
    const again = await verify(c, { recoveryCode: admin.recoveryCodes[1]! });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('a recovery code works once', async () => {
    const admin = await enrolled();
    const [recovery] = admin.recoveryCodes;
    expect(
      (await verify(await challenge(admin.address), { recoveryCode: recovery!.toLowerCase() })).status,
    ).toBe(200);
    const again = await verify(await challenge(admin.address), { recoveryCode: recovery });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('INVALID_MFA_CODE');
  });

  it('a challenge allows 5 attempts, then sign-in must start again', async () => {
    const admin = await enrolled();
    const c = await challenge(admin.address);
    for (let i = 0; i < 5; i++) {
      const res = await verify(c, { recoveryCode: 'AAAA-AAAA-AAAA-AAAA' });
      expect(res.body.error.code).toBe('INVALID_MFA_CODE');
    }
    const sixth = await verify(c, { code: totpCode(admin.secret, totpStep() + 1) });
    expect(sixth.status).toBe(401);
    expect(sixth.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(cookiesOf(sixth).get(MFA_CHALLENGE_COOKIE)).toBe('');
  });

  it('there is no way in without a challenge (the password step) — and no session without a code', async () => {
    const admin = await enrolled();
    const res = await verify(undefined, { code: totpCode(admin.secret, totpStep() + 1) });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    const bodyOnly = await verify(undefined, { code: '123456', challenge: 'x' });
    expect(bodyOnly.status).toBe(400);
  });

  it('audits enrolment and both outcomes of the second step', async () => {
    const admin = await enrolled();
    const c = await challenge(admin.address);
    await verify(c, { recoveryCode: 'AAAA-AAAA-AAAA-AAAA' });
    await verify(c, { code: totpCode(admin.secret, totpStep() + 1) });
    const rows = await migrator.query<{ action: string; outcome: string }>(
      `SELECT action, outcome FROM audit.audit_events
        WHERE actor_identity_id = $1 AND action LIKE 'auth.mfa%' ORDER BY occurred_at`,
      [admin.identityId],
    );
    expect(rows.map((r) => `${r.action}:${r.outcome}`)).toEqual([
      'auth.mfa_enrollment_started:success',
      'auth.mfa_enrollment_confirmed:success',
      'auth.mfa_verify:failure',
      'auth.mfa_verify:success',
    ]);
  });
});

describe('bootstrap CLI core (D9, option A)', () => {
  it('refuses a second super admin unless explicitly asked', async () => {
    await expect(
      bootstrapSuperAdmin({
        migrator,
        sender: email,
        webAppUrl: TEST_WEB_APP_URL,
        email: uniqueEmail('second'),
        allowAdditional: false,
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('an existing account with a password and no membership gets the membership and no link', async () => {
    // As one is after finishing setup for an invitation withdrawn in the meantime: a password, in no audience.
    const address = uniqueEmail('unaffiliated');
    await migrator.query(
      `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2)`,
      [address, await hashPassword(PASSWORD)],
    );
    const result = await bootstrapSuperAdmin({
      migrator,
      sender: email,
      webAppUrl: TEST_WEB_APP_URL,
      email: address,
      allowAdditional: true,
    });
    expect(result.outcome).toBe('existing_password');
    expect(email.to(address)).toHaveLength(0);
  });

  it('a business account is refused: platform and business accounts stay apart (P5.5, CF3)', async () => {
    const address = uniqueEmail('owner');
    const signup = await auth.identity.signupMerchantOwner(
      address,
      await hashPassword(PASSWORD),
      'Existing Ltd',
    );
    await expect(
      bootstrapSuperAdmin({
        migrator,
        sender: email,
        webAppUrl: TEST_WEB_APP_URL,
        email: address,
        allowAdditional: true,
      }),
    ).rejects.toMatchObject({ code: '23514' });
    expect(email.to(address)).toHaveLength(0);
    const rows = await migrator.query(`SELECT 1 FROM identity.platform_memberships WHERE identity_id = $1`, [
      signup.identity_id,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('reports an email failure without the link, and forgot-password then sends a fresh setup link', async () => {
    const address = uniqueEmail('mail-down');
    const failing: EmailSender = { send: () => Promise.reject(new Error('smtp down')) };
    const result = await bootstrapSuperAdmin({
      migrator,
      sender: failing,
      webAppUrl: TEST_WEB_APP_URL,
      email: address,
      allowAdditional: true,
    });
    expect(result).toEqual({
      outcome: 'setup_link_not_sent',
      identityId: expect.any(String),
      error: 'Error',
    });

    await request(app)
      .post('/v1/auth/password/forgot')
      .set('X-Forwarded-For', clientIp())
      .send({ email: address });
    await vi.waitFor(() => expect(email.to(address).map((m) => m.template)).toEqual(['account_setup']));
  });
});
