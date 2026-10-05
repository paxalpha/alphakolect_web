import { randomBytes } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp } from '../support/app.js';

// The client IP keys the per-IP rate limits and is recorded in audit events, so it must not be forgeable
// (P3.5 review, 2026-10-04): X-Forwarded-For is believed only when the request comes from a configured
// trusted reverse proxy. The tests send requests from loopback, so "loopback" plays the proxy on this host.

const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
beforeAll(() => owner.connect());
afterAll(() => owner.end());

const FORGED = '203.0.113.9';

/** The IP the app attributed a failed login to, as recorded in its audit event. */
async function attributedIp(app: Awaited<ReturnType<typeof createTestApp>>['app']): Promise<string> {
  const res = await request(app)
    .post('/v1/auth/login')
    .set('X-Forwarded-For', FORGED)
    .send({
      email: `proxy-${randomBytes(5).toString('hex')}@example.test`,
      password: 'not a password',
      audience: 'merchant',
    });
  expect(res.status).toBe(401);
  const { rows } = await owner.query(`SELECT ip FROM audit.audit_events WHERE request_id = $1`, [
    res.headers['x-request-id'],
  ]);
  return rows[0].ip;
}

const isLoopback = (ip: string) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

describe('trusted reverse proxies', () => {
  it('believes X-Forwarded-For from a configured proxy (default: one on this host, e.g. nginx)', async () => {
    const { app } = await createTestApp();
    expect(await attributedIp(app)).toBe(FORGED);
  });

  it('ignores X-Forwarded-For from a peer that is not a configured proxy', async () => {
    const { app } = await createTestApp({ trustProxy: ['10.20.30.40'] });
    expect(isLoopback(await attributedIp(app))).toBe(true);
  });

  it('ignores X-Forwarded-For entirely when no proxy is trusted', async () => {
    const { app } = await createTestApp({ trustProxy: false });
    expect(isLoopback(await attributedIp(app))).toBe(true);
  });

  it('by default, a client connecting directly from any other address is never trusted as a proxy', async () => {
    const { app } = await createTestApp();
    const trusts = app.get('trust proxy fn') as (address: string, hop: number) => boolean;
    expect(trusts('127.0.0.1', 0)).toBe(true);
    for (const direct of ['198.51.100.7', '10.0.0.8', '192.168.1.10', '2001:db8::1']) {
      expect(trusts(direct, 0), direct).toBe(false);
    }
  });
});
