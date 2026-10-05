import { randomBytes } from 'node:crypto';
import { VerificationPending } from '@alphakolect/contracts';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { LIMITS } from '../../src/modules/identity/rate-limits.js';
import { AppError } from '../../src/platform/errors.js';
import type { EmailSender } from '../../src/platform/email.js';
import { createTestApp, TEST_WEB_APP_URL } from '../support/app.js';
import { databaseWindow, inOneWindow } from '../support/rate-limit-window.js';

// Signup, email verification and resend through the real app and database (ADR-14 D1, D2, D10, D12, D13, D14;
// P3 exit criteria 2, 3, 8, 11).

const { app, email } = await createTestApp();
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
const window = databaseWindow(owner);
beforeAll(() => owner.connect());
afterAll(() => owner.end());

const PASSWORD = 'a long enough passphrase';
const uniqueEmail = (tag: string) => `${tag}-${randomBytes(5).toString('hex')}@example.test`;
/** A distinct client IP per request (see sessions-api.test.ts), so per-IP limits do not couple the tests. */
const clientIp = () => `10.${randomBytes(3).join('.')}`;
const post = (path: string, body: unknown) =>
  request(app)
    .post(path)
    .set('X-Forwarded-For', clientIp())
    .send(body as object);

const signup = (address: string, password = PASSWORD) =>
  post('/v1/auth/signup', { email: address, password, businessName: 'Ada Ventures' });
const verify = (token: string) => post('/v1/auth/email/verify', { token });
const resend = (address: string) => post('/v1/auth/email/resend', { email: address });
const login = (address: string) =>
  post('/v1/auth/login', { email: address, password: PASSWORD, audience: 'merchant' });

/** Waits for the n-th email to an address and returns the token from its link. */
async function tokenFromEmail(address: string, n = 1): Promise<string> {
  await vi.waitFor(() => expect(email.to(address).length).toBeGreaterThanOrEqual(n));
  const message = email.to(address)[n - 1]!;
  expect(message.template).toBe('email_verification');
  const match = new RegExp(`^${TEST_WEB_APP_URL}/verify-email#token=([A-Za-z0-9_-]{43})$`, 'm').exec(
    message.text,
  );
  expect(match, message.text).not.toBeNull();
  return match![1]!;
}

/** Lets any dispatched email be delivered before asserting that none was. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const merchantStatus = async (address: string) =>
  (
    await owner.query(
      `SELECT m.status FROM tenancy.merchants m
         JOIN tenancy.merchant_memberships mm ON mm.merchant_id = m.id AND mm.kind = 'owner'
         JOIN identity.identities i ON i.id = mm.identity_id
        WHERE i.email = lower($1)`,
      [address],
    )
  ).rows[0]?.status;

describe('signup → verification email → verify → login (D2)', () => {
  it('creates a pending business, emails a single-use link, and activates on verification', async () => {
    const address = uniqueEmail('Signup').replace('signup', 'SignUp');
    const res = await signup(address);
    expect(res.status).toBe(202);
    expect(VerificationPending.parse(res.body)).toEqual({ status: 'verification_email_sent' });
    expect(await merchantStatus(address)).toBe('pending_verification');

    const token = await tokenFromEmail(address.toLowerCase());
    expect(JSON.stringify(res.body)).not.toContain(token); // exit criterion 3

    expect((await login(address)).body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect((await verify(token)).status).toBe(204);
    expect(await merchantStatus(address)).toBe('active');
    expect((await login(address)).status).toBe(200);

    const again = await verify(token);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('stores the password only as argon2id and the token only as a hash (exit criterion 2)', async () => {
    const address = uniqueEmail('stored');
    await signup(address);
    const token = await tokenFromEmail(address);
    const {
      rows: [row],
    } = await owner.query(
      `SELECT i.password_hash, t.token_hash FROM identity.identities i
         JOIN identity.one_time_tokens t ON t.identity_id = i.id WHERE i.email = $1`,
      [address],
    );
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(PASSWORD);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_hash).not.toBe(token);
  });

  it('audits the signup and the verification', async () => {
    const address = uniqueEmail('audited');
    const res = await signup(address);
    const verified = await verify(await tokenFromEmail(address));
    const { rows } = await owner.query(
      `SELECT action, outcome, merchant_id IS NOT NULL AS tenant, actor_identity_id IS NOT NULL AS actor, summary
         FROM audit.audit_events WHERE request_id = ANY($1) ORDER BY occurred_at`,
      [[res.headers['x-request-id'], verified.headers['x-request-id']]],
    );
    expect(rows).toEqual([
      { action: 'auth.signup', outcome: 'success', tenant: true, actor: true, summary: {} },
      { action: 'auth.email_verify', outcome: 'success', tenant: false, actor: true, summary: {} },
    ]);
  });
});

describe('anti-enumeration (D12, exit criterion 8)', () => {
  it('answers a signup for an existing email exactly like a new one, sends nothing, and changes nothing', async () => {
    const address = uniqueEmail('taken');
    const first = await signup(address);
    await verify(await tokenFromEmail(address));

    const second = await signup(address, 'a different long passphrase');
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    await settle();
    expect(email.to(address)).toHaveLength(1);
    expect((await login(address)).status).toBe(200); // the original password still works
  });

  it('answers resend identically for unknown, verified and unverified emails, emailing only the last', async () => {
    const unknown = uniqueEmail('unknown');
    const verified = uniqueEmail('verified');
    const unverified = uniqueEmail('unverified');
    await signup(verified);
    await verify(await tokenFromEmail(verified));
    await signup(unverified);
    await tokenFromEmail(unverified);

    const answers = await Promise.all([resend(unknown), resend(verified), resend(unverified)]);
    for (const res of answers) {
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ status: 'verification_email_sent' });
    }
    await settle();
    expect(email.to(unknown)).toHaveLength(0);
    expect(email.to(verified)).toHaveLength(1);
    expect(email.to(unverified)).toHaveLength(2);
  });
});

describe('verification tokens', () => {
  it('a resend supersedes the earlier link', async () => {
    const address = uniqueEmail('resend');
    await signup(address);
    const first = await tokenFromEmail(address, 1);
    await resend(address);
    const second = await tokenFromEmail(address, 2);

    expect((await verify(first)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect((await verify(second)).status).toBe(204);
  });

  it('refuses malformed, unknown and expired tokens identically', async () => {
    const address = uniqueEmail('expired');
    await signup(address);
    const token = await tokenFromEmail(address);
    await owner.query(
      `UPDATE identity.one_time_tokens SET expires_at = now() - interval '1 second'
        WHERE identity_id = (SELECT id FROM identity.identities WHERE email = $1)`,
      [address],
    );
    const answers = [
      await verify('not-a-token'),
      await verify(randomBytes(32).toString('base64url')),
      await verify(token),
    ];
    for (const res of answers) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
      expect(res.body.error.message).toBe(answers[0]!.body.error.message);
    }
    expect(await merchantStatus(address)).toBe('pending_verification');
  });
});

describe('password policy and limits', () => {
  it.each([
    ['too short', 'short pass', 'TOO_SHORT'],
    ['too common', 'password1234', 'TOO_COMMON'],
  ])(
    'refuses a %s password with 422 WEAK_PASSWORD and creates nothing (D10)',
    async (_label, password, problem) => {
      const address = uniqueEmail('weak');
      const res = await signup(address, password);
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'WEAK_PASSWORD', details: { problem } });
      expect(JSON.stringify(res.body)).not.toContain(password);
      expect(await merchantStatus(address)).toBeUndefined();
    },
  );

  it('limits signups per email (D13)', async () => {
    await inOneWindow(window, LIMITS.signup.windowSeconds, async () => {
      const address = uniqueEmail('signup-limit');
      for (let i = 0; i < LIMITS.signup.perIdentifier; i++) expect((await signup(address)).status).toBe(202);
      const res = await signup(address);
      expect(res.status).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  it('limits resends to 3 per hour per email (D12)', async () => {
    await inOneWindow(window, LIMITS.verification_resend.windowSeconds, async () => {
      const address = uniqueEmail('resend-limit');
      for (let i = 0; i < LIMITS.verification_resend.perIdentifier; i++) {
        expect((await resend(address)).status).toBe(202);
      }
      expect((await resend(address)).status).toBe(429);
    });
  });
});

describe('collaborators', () => {
  it('a failing email provider does not change the answer (D1: delivery is outside the request)', async () => {
    const failing: EmailSender = { send: () => Promise.reject(new Error('smtp down')) };
    const { app: broken } = await createTestApp({ email: failing });
    const res = await request(broken)
      .post('/v1/auth/signup')
      .set('X-Forwarded-For', clientIp())
      .send({ email: uniqueEmail('smtp-down'), password: PASSWORD, businessName: 'Down Ltd' });
    expect(res.status).toBe(202);
  });

  it('calls the signup guard first, so a CAPTCHA can refuse before anything happens (D14)', async () => {
    const guard = vi.fn(async () => {
      throw new AppError(403, 'HUMAN_CHECK_FAILED', 'Please try again');
    });
    const { app: guarded } = await createTestApp({ signupGuard: guard });
    const address = uniqueEmail('guarded');
    const res = await request(guarded)
      .post('/v1/auth/signup')
      .set('X-Forwarded-For', clientIp())
      .send({ email: address, password: PASSWORD, businessName: 'Guarded Ltd' });
    expect(guard).toHaveBeenCalledOnce();
    expect(res.status).toBe(403);
    expect(await merchantStatus(address)).toBeUndefined();
  });
});
