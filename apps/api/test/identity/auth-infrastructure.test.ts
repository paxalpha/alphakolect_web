import { randomBytes } from 'node:crypto';
import { AUTH_COOKIES } from '@alphakolect/contracts';
import express from 'express';
import pg from 'pg';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AuditLog } from '../../src/modules/audit/audit-log.js';
import { clearSessionCookies, setSessionCookies } from '../../src/modules/identity/cookies.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { LIMITS, RateLimiter } from '../../src/modules/identity/rate-limits.js';
import { errorHandler } from '../../src/platform/http/error-handler.js';
import { resolveRequestId } from '../../src/platform/http/request-id.js';
import { createTestApp } from '../support/app.js';
import { databaseWindow, inOneWindow } from '../support/rate-limit-window.js';

const { auth, db } = await createTestApp();
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
const window = databaseWindow(owner);
beforeAll(() => owner.connect());
afterAll(() => owner.end());

describe('AuditLog (as alphakolect_app, through RLS)', () => {
  it('records tenant-less and tenant events without secrets', async () => {
    const audit = new AuditLog(db, pino({ level: 'silent' }));
    const email = `audit-${randomBytes(4).toString('hex')}@example.test`;
    const signup = await auth.identity.signupMerchantOwner(
      email,
      await hashPassword('a long enough passphrase'),
      'Biz',
    );
    const requestId = `req-${randomBytes(4).toString('hex')}`;

    await audit.record({
      action: 'auth.login',
      outcome: 'failure',
      requestId,
      summary: { reason: 'invalid_credentials' },
    });
    await audit.record({
      action: 'auth.login',
      outcome: 'success',
      merchantId: signup.merchant_id,
      actorIdentityId: signup.identity_id,
      actorAudience: 'merchant',
      requestId,
    });

    const { rows } = await owner.query(
      `SELECT merchant_id, actor_identity_id, outcome, summary FROM audit.audit_events WHERE request_id = $1 ORDER BY occurred_at`,
      [requestId],
    );
    expect(rows).toEqual([
      {
        merchant_id: null,
        actor_identity_id: null,
        outcome: 'failure',
        summary: { reason: 'invalid_credentials' },
      },
      {
        merchant_id: signup.merchant_id,
        actor_identity_id: signup.identity_id,
        outcome: 'success',
        summary: {},
      },
    ]);
  });
});

describe('RateLimiter (D13)', () => {
  it('refuses with 429 and a retry-after once the per-identifier limit is reached', async () => {
    const limiter = new RateLimiter(auth.identity);
    await inOneWindow(window, LIMITS.login.windowSeconds, async () => {
      const id = `limit-${randomBytes(4).toString('hex')}@example.test`;
      for (let i = 0; i < LIMITS.login.perIdentifier; i++) {
        await limiter.enforce('login', `10.0.${i}.1`, id);
      }
      await expect(limiter.enforce('login', '10.9.9.9', id)).rejects.toMatchObject({
        status: 429,
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: expect.any(Number) },
      });
    });
  });

  it('limits per IP independently of the identifier', async () => {
    const limiter = new RateLimiter(auth.identity);
    await inOneWindow(window, LIMITS.password_forgot.windowSeconds, async () => {
      const ip = `192.0.2.${Math.floor(Math.random() * 200)}-${randomBytes(3).toString('hex')}`;
      for (let i = 0; i < LIMITS.password_forgot.perIp; i++) {
        await limiter.enforce(
          'password_forgot',
          ip,
          `user${i}-${randomBytes(3).toString('hex')}@example.test`,
        );
      }
      await expect(limiter.enforce('password_forgot', ip, 'fresh@example.test')).rejects.toMatchObject({
        status: 429,
      });
    });
  });

  it('stores only hashed keys (no emails or IPs in clear)', async () => {
    const limiter = new RateLimiter(auth.identity);
    const id = `cleartext-check-${randomBytes(4).toString('hex')}@example.test`;
    await limiter.enforce('signup', '203.0.113.7', id);
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM util.rate_limit_counters WHERE key LIKE '%@%' OR key LIKE '%203.0.113.7%'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('sends Retry-After on the 429 response', async () => {
    const limiter = new RateLimiter(auth.identity);
    await inOneWindow(window, LIMITS.mfa.windowSeconds, async () => {
      const id = `retry-${randomBytes(4).toString('hex')}@example.test`;
      const app = express();
      app.use(pinoHttp({ logger: pino({ level: 'silent' }), genReqId: resolveRequestId }));
      app.post('/try', async (_req, res, next) => {
        try {
          await limiter.enforce('mfa', '198.51.100.1', id);
          res.status(204).end();
        } catch (err) {
          next(err);
        }
      });
      app.use(errorHandler);
      let res = await request(app).post('/try');
      for (let i = 1; i <= LIMITS.mfa.perIdentifier; i++) res = await request(app).post('/try');
      expect(res.status).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    });
  });
});

describe('session cookies (D7)', () => {
  const app = express();
  app.get('/set', (_req, res) => {
    setSessionCookies(
      res,
      { domain: '.alphakolect.test' },
      {
        accessToken: 'a',
        accessMaxAgeSeconds: 900,
        refreshToken: 'r',
        refreshMaxAgeSeconds: 86400,
        csrfToken: 'c',
        csrfMaxAgeSeconds: 1209600,
      },
    );
    res.end();
  });
  app.get('/clear', (_req, res) => {
    clearSessionCookies(res, {});
    res.end();
  });

  it('sets __Secure- cookies with HttpOnly, Secure, SameSite=Lax, the domain and a path-scoped refresh cookie', async () => {
    const cookies = (await request(app).get('/set')).headers['set-cookie'] as unknown as string[];
    const byName = Object.fromEntries(cookies.map((c) => [c.split('=')[0], c]));
    for (const name of [AUTH_COOKIES.access, AUTH_COOKIES.refresh, AUTH_COOKIES.csrf]) {
      expect(byName[name]).toMatch(/; Secure/);
      expect(byName[name]).toMatch(/; SameSite=Lax/);
      expect(byName[name]).toMatch(/; Domain=\.alphakolect\.test/);
    }
    expect(byName[AUTH_COOKIES.access]).toMatch(/; HttpOnly/);
    expect(byName[AUTH_COOKIES.access]).toMatch(/Max-Age=900/);
    expect(byName[AUTH_COOKIES.refresh]).toMatch(/; HttpOnly/);
    expect(byName[AUTH_COOKIES.refresh]).toMatch(/; Path=\/v1\/auth\/refresh/);
    expect(byName[AUTH_COOKIES.csrf]).not.toMatch(/HttpOnly/);
  });

  it('clears all three, host-only when no domain is configured', async () => {
    const cookies = (await request(app).get('/clear')).headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(3);
    for (const c of cookies) {
      expect(c).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(c).not.toMatch(/Domain=/);
    }
  });
});
