import { randomBytes } from 'node:crypto';
import { AUTH_COOKIES, CSRF_HEADER, PasswordEmailPending } from '@alphakolect/contracts';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { LIMITS } from '../../src/modules/identity/rate-limits.js';
import { newOpaqueToken } from '../../src/modules/identity/tokens.js';
import { createTestApp, TEST_WEB_APP_URL, TEST_WEB_ORIGIN } from '../support/app.js';
import { databaseWindow, inOneWindow } from '../support/rate-limit-window.js';

// Forgot / reset / first-password setup / change through the real app and database (§3.2; ADR-14 D5, D9, D10,
// D12 and the 2026-10-04 clarifications; P3 exit criteria 4, 6, 8, 11).

const { app, auth, email } = await createTestApp();
const repo = auth.identity;
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
const window = databaseWindow(owner);
beforeAll(() => owner.connect());
afterAll(() => owner.end());

const PASSWORD = 'a long enough passphrase';
const NEW_PASSWORD = 'an entirely new passphrase';
const uniqueEmail = (tag: string) => `${tag}-${randomBytes(5).toString('hex')}@example.test`;
const clientIp = () => `10.${randomBytes(3).join('.')}`;
const post = (path: string, body: unknown) =>
  request(app)
    .post(path)
    .set('X-Forwarded-For', clientIp())
    .send(body as object);

const forgot = (address: string) => post('/v1/auth/password/forgot', { email: address });
const reset = (token: string, password = NEW_PASSWORD) =>
  post('/v1/auth/password/reset', { token, password });
const setup = (token: string, password = PASSWORD) => post('/v1/auth/password/setup', { token, password });
const login = (address: string, password: string, audience: 'merchant' | 'platform' = 'merchant') =>
  post('/v1/auth/login', { email: address, password, audience });

async function merchantOwner({ verified = true } = {}) {
  const address = uniqueEmail('owner');
  const signup = await repo.signupMerchantOwner(address, await hashPassword(PASSWORD), 'Password Biz');
  if (verified) {
    const t = newOpaqueToken();
    await repo.issueOneTimeToken(signup.identity_id!, 'email_verification', t.hash, 3600, null);
    await repo.verifyEmail(t.hash);
  }
  return { address, identityId: signup.identity_id!, merchantId: signup.merchant_id! };
}

/** The n-th email of a template to an address, and the token in its link. */
async function linkToken(address: string, template: string, path: string, n = 1): Promise<string> {
  const of = () => email.to(address).filter((m) => m.template === template);
  await vi.waitFor(() => expect(of().length).toBeGreaterThanOrEqual(n));
  const match = new RegExp(`^${TEST_WEB_APP_URL}/${path}#token=([A-Za-z0-9_-]{43})$`, 'm').exec(
    of()[n - 1]!.text,
  );
  expect(match).not.toBeNull();
  return match![1]!;
}
const resetToken = (address: string, n = 1) => linkToken(address, 'password_reset', 'reset-password', n);
const setupToken = (address: string, n = 1) => linkToken(address, 'account_setup', 'set-password', n);
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

type Jar = { access: string; csrf: string };
function jarOf(res: request.Response): Jar {
  const cookies = Object.fromEntries(
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).map((c) => c.split(';')[0]!.split('=')),
  );
  return { access: cookies[AUTH_COOKIES.access], csrf: cookies[AUTH_COOKIES.csrf] };
}
const session = (jar: Jar) =>
  request(app).get('/v1/auth/session').set('Cookie', `${AUTH_COOKIES.access}=${jar.access}`);
const change = (jar: Jar, body: { currentPassword: string; newPassword: string }, { csrf = true } = {}) => {
  const req = request(app)
    .post('/v1/auth/password/change')
    .set('X-Forwarded-For', clientIp())
    .set('Cookie', `${AUTH_COOKIES.access}=${jar.access}; ${AUTH_COOKIES.csrf}=${jar.csrf}`)
    .set('Origin', TEST_WEB_ORIGIN);
  if (csrf) req.set(CSRF_HEADER, jar.csrf);
  return req.send(body);
};

const auditFor = async (res: request.Response) =>
  (
    await owner.query(`SELECT action, outcome, summary FROM audit.audit_events WHERE request_id = $1`, [
      res.headers['x-request-id'],
    ])
  ).rows;

describe('forgot (D12, exit criterion 4)', () => {
  it('answers identically for known, unknown and disabled accounts, emailing only the active one', async () => {
    const known = await merchantOwner();
    const disabled = await merchantOwner();
    await owner.query(`UPDATE identity.identities SET status = 'disabled' WHERE id = $1`, [
      disabled.identityId,
    ]);
    const unknown = uniqueEmail('nobody');

    const answers = [await forgot(known.address), await forgot(unknown), await forgot(disabled.address)];
    for (const res of answers) {
      expect(res.status).toBe(202);
      expect(PasswordEmailPending.parse(res.body)).toEqual({ status: 'password_email_sent' });
    }
    await resetToken(known.address);
    await settle();
    expect(email.to(unknown)).toHaveLength(0);
    expect(email.to(disabled.address)).toHaveLength(0);
  });

  it('limits requests per email (D13)', async () => {
    await inOneWindow(window, LIMITS.password_forgot.windowSeconds, async () => {
      const address = uniqueEmail('forgot-limit');
      for (let i = 0; i < LIMITS.password_forgot.perIdentifier; i++)
        expect((await forgot(address)).status).toBe(202);
      expect((await forgot(address)).status).toBe(429);
    });
  });
});

describe('reset (exit criterion 4)', () => {
  it('sets the password, ends every session, and works only once', async () => {
    const m = await merchantOwner();
    const a = jarOf(await login(m.address, PASSWORD));
    const b = jarOf(await login(m.address, PASSWORD));
    expect((await session(a)).status).toBe(200);

    await forgot(m.address);
    const token = await resetToken(m.address);
    const res = await reset(token);
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringMatching(new RegExp(`^${AUTH_COOKIES.access}=;`))]),
    );
    expect(await auditFor(res)).toEqual([
      { action: 'auth.password_reset', outcome: 'success', summary: { sessionsRevoked: true } },
    ]);

    expect((await session(a)).status).toBe(401);
    expect((await session(b)).status).toBe(401);
    expect((await login(m.address, PASSWORD)).status).toBe(401);
    expect((await login(m.address, NEW_PASSWORD)).status).toBe(200);

    const again = await reset(token, 'yet another long passphrase');
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('a newer request supersedes the older link, and an expired link is refused like any other', async () => {
    const m = await merchantOwner();
    await forgot(m.address);
    const first = await resetToken(m.address, 1);
    await forgot(m.address);
    const second = await resetToken(m.address, 2);
    expect((await reset(first)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    await owner.query(
      `UPDATE identity.one_time_tokens SET expires_at = now() - interval '1 second'
        WHERE identity_id = $1 AND purpose = 'password_reset'`,
      [m.identityId],
    );
    expect((await reset(second)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect((await login(m.address, PASSWORD)).status).toBe(200);
  });

  it('lives 30 minutes', async () => {
    const m = await merchantOwner();
    await forgot(m.address);
    await resetToken(m.address);
    const {
      rows: [row],
    } = await owner.query(
      `SELECT extract(epoch FROM expires_at - created_at)::int AS seconds FROM identity.one_time_tokens
        WHERE identity_id = $1 AND purpose = 'password_reset'`,
      [m.identityId],
    );
    expect(row.seconds).toBe(1800);
  });

  it('refuses a weak password without using the link up', async () => {
    const m = await merchantOwner();
    await forgot(m.address);
    const token = await resetToken(m.address);
    const weak = await reset(token, 'password1234');
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe('WEAK_PASSWORD');
    expect((await reset(token)).status).toBe(204);
  });

  it('does not verify an email or activate a business (P3.5 review invariant)', async () => {
    const m = await merchantOwner({ verified: false });
    await forgot(m.address);
    expect((await reset(await resetToken(m.address))).status).toBe(204);

    const res = await login(m.address, NEW_PASSWORD);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    const { rows } = await owner.query(`SELECT status FROM tenancy.merchants WHERE id = $1`, [m.merchantId]);
    expect(rows[0].status).toBe('pending_verification');
  });
});

describe('first-password setup (D9, option A)', () => {
  async function bootstrappedAdmin() {
    const address = uniqueEmail('admin');
    const {
      rows: [{ id }],
    } = await owner.query(`SELECT identity.bootstrap_super_admin($1, true) AS id`, [address]);
    return { address, identityId: id as string };
  }

  it('sets the first password, confirms the email, and the next login must enrol MFA', async () => {
    const a = await bootstrappedAdmin();
    await forgot(a.address); // an account without a password gets a setup link, not a reset link
    const token = await setupToken(a.address);
    expect(email.to(a.address).map((m) => m.template)).toEqual(['account_setup']);

    const res = await setup(token);
    expect(res.status).toBe(204);
    expect(await auditFor(res)).toEqual([
      { action: 'auth.account_setup', outcome: 'success', summary: { sessionsRevoked: true } },
    ]);
    const signin = await login(a.address, PASSWORD, 'platform');
    expect(signin.status).toBe(200);
    expect(signin.body.status).toBe('mfa_enrollment_required');

    expect((await setup(token, 'a second long passphrase')).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('setup and reset links are not interchangeable', async () => {
    const a = await bootstrappedAdmin();
    await forgot(a.address);
    const setupLink = await setupToken(a.address);
    expect((await reset(setupLink)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    const m = await merchantOwner();
    await forgot(m.address);
    const resetLink = await resetToken(m.address);
    expect((await setup(resetLink)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    expect((await setup(setupLink)).status).toBe(204); // neither attempt used the right link up
    expect((await reset(resetLink)).status).toBe(204);
  });
});

describe('change (D5, exit criterion 6)', () => {
  it('needs the current password', async () => {
    const m = await merchantOwner();
    const jar = jarOf(await login(m.address, PASSWORD));
    const res = await change(jar, { currentPassword: 'not my password at all', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await session(jar)).status).toBe(200);
    expect(await auditFor(res)).toEqual([
      { action: 'auth.password_change', outcome: 'failure', summary: { reason: 'wrong_current_password' } },
    ]);
  });

  it('changes the password and ends every session, this one included', async () => {
    const m = await merchantOwner();
    const jar = jarOf(await login(m.address, PASSWORD));
    const other = jarOf(await login(m.address, PASSWORD));
    const res = await change(jar, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);
    expect((await session(jar)).status).toBe(401);
    expect((await session(other)).status).toBe(401);
    expect((await login(m.address, NEW_PASSWORD)).status).toBe(200);
  });

  it('refuses a weak new password, needs the CSRF header, and is not open to enrolment-only sessions', async () => {
    const m = await merchantOwner();
    const jar = jarOf(await login(m.address, PASSWORD));
    expect((await change(jar, { currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(422);
    expect(
      (await change(jar, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { csrf: false })).status,
    ).toBe(403);

    const address = uniqueEmail('enrolling');
    const {
      rows: [{ id }],
    } = await owner.query(`SELECT identity.bootstrap_super_admin($1, true) AS id`, [address]);
    const t = newOpaqueToken();
    await repo.issueOneTimeToken(id, 'account_setup', t.hash, 3600, null);
    await repo.completeAccountSetup(t.hash, await hashPassword(PASSWORD));
    const enrolling = jarOf(await login(address, PASSWORD, 'platform'));
    const res = await change(enrolling, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });
});
