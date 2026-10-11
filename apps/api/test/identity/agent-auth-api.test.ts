import { randomBytes } from 'node:crypto';
import { AgentLoginResponse, AgentTokens, AUTH_COOKIES, CSRF_HEADER } from '@alphakolect/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/modules/identity/rate-limits.js';
import { createTestApp, TEST_WEB_ORIGIN } from '../support/app.js';
import { databaseWindow, inOneWindow } from '../support/rate-limit-window.js';
import { expectError, TEST_PASSWORD, tenancyFixtures } from '../support/tenancy.js';

// P4.7 (ADR-14 D5, D7; ADR-15 T4, T5, T12): the agent journey on its dedicated bearer endpoints — sign in (with a
// selection step for an agent of several businesses), use, refresh with rotation and reuse detection, sign out —
// and the boundaries: web and agent tokens never cross endpoints, an agent cannot use merchant endpoints, and a
// deactivated agent (or business) is out from the next request.

const { app, auth } = await createTestApp();
const { owner, business, member, call } = tenancyFixtures(app, auth);

const clientIp = () => `10.${randomBytes(3).join('.')}`;
const post = (path: string, body: object) =>
  request(app).post(path).set('X-Forwarded-For', clientIp()).send(body);
const agentLogin = (email: string, password = TEST_PASSWORD) =>
  post('/v1/auth/agent/login', { email, password });
const agentRefresh = (refreshToken: string) => post('/v1/auth/agent/refresh', { refreshToken });
const me = (accessToken: string) =>
  request(app).get('/v1/agent/membership').set('Authorization', `Bearer ${accessToken}`);

async function signedInAgent() {
  const b = await business('Field Savings');
  const agent = await member(b, 'agent');
  const res = await agentLogin(agent.email);
  expect(res.status).toBe(200);
  const body = AgentLoginResponse.parse(res.body);
  if (body.status !== 'authenticated') throw new Error('expected a session');
  return { b, agent, tokens: body };
}

describe('the agent journey', () => {
  it('signs in with tokens in the body (no cookies, no-store), uses them, refreshes, signs out', async () => {
    const b = await business('Field Savings');
    const agent = await member(b, 'agent');
    const res = await agentLogin(agent.email);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
    const login = AgentLoginResponse.parse(res.body);
    expect(login).toMatchObject({
      status: 'authenticated',
      session: {
        audience: 'agent',
        merchantId: b.merchantId,
        membershipId: agent.membershipId,
        scope: 'full',
      },
    });
    if (login.status !== 'authenticated') throw new Error('unreachable');
    // D5: refresh 30 days idle.
    const idleMs = Date.parse(login.refreshTokenExpiresAt) - Date.now();
    expect(idleMs).toBeGreaterThan(30 * 86400_000 - 120_000);
    expect(idleMs).toBeLessThanOrEqual(30 * 86400_000 + 120_000);

    const self = await me(login.accessToken);
    expect(self.status).toBe(200);
    expect(self.body).toMatchObject({ kind: 'agent', membershipId: agent.membershipId, roleId: null });
    expect(self.body.merchant).toMatchObject({ merchantId: b.merchantId, name: 'Field Savings' });

    const refreshed = await agentRefresh(login.refreshToken);
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers['cache-control']).toBe('no-store');
    const next = AgentTokens.parse(refreshed.body);
    expect(next.refreshToken).not.toBe(login.refreshToken);
    expect((await me(next.accessToken)).status).toBe(200);

    const out = await request(app).post('/v1/auth/logout').set('Authorization', `Bearer ${next.accessToken}`);
    expect(out.status).toBe(204);
    expectError(await me(next.accessToken), 401, 'UNAUTHENTICATED');
    expectError(await agentRefresh(next.refreshToken), 401, 'INVALID_OR_EXPIRED_TOKEN');
  });

  it('reusing a spent refresh token ends the session (reuse detection)', async () => {
    const { tokens } = await signedInAgent();
    const next = AgentTokens.parse((await agentRefresh(tokens.refreshToken)).body);
    expectError(await agentRefresh(tokens.refreshToken), 401, 'INVALID_OR_EXPIRED_TOKEN');
    expectError(await me(next.accessToken), 401, 'UNAUTHENTICATED');
    expectError(await agentRefresh(next.refreshToken), 401, 'INVALID_OR_EXPIRED_TOKEN');
  });

  it('an agent of several businesses chooses one (choices only after the password); the token works once', async () => {
    const a = await business('Alpha Thrift');
    const agent = await member(a, 'agent');
    const b = await business('Beta Thrift');
    await owner.query(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent')`,
      [b.merchantId, agent.identityId],
    );

    expectError(await agentLogin(agent.email, 'not the password'), 401, 'INVALID_CREDENTIALS');
    const res = await agentLogin(agent.email);
    const body = AgentLoginResponse.parse(res.body);
    if (body.status !== 'membership_selection_required') throw new Error('expected a selection');
    expect(body.memberships.map((m) => m.merchantName)).toEqual(['Alpha Thrift', 'Beta Thrift']);
    expect(res.headers['cache-control']).toBe('no-store');

    const choice = body.memberships.find((m) => m.merchantName === 'Beta Thrift')!;
    const chosen = await post('/v1/auth/agent/login/select', {
      selectionToken: body.selectionToken,
      selectionId: choice.selectionId,
    });
    expect(chosen.status).toBe(200);
    expect(AgentTokens.parse(chosen.body).session).toMatchObject({
      audience: 'agent',
      merchantId: b.merchantId,
    });

    expectError(
      await post('/v1/auth/agent/login/select', {
        selectionToken: body.selectionToken,
        selectionId: choice.selectionId,
      }),
      401,
      'INVALID_OR_EXPIRED_TOKEN',
    );
  });
});

describe('selection is rate-limited per selection token', () => {
  it('after the limit: 429 with Retry-After, before any further check', async () => {
    const window = databaseWindow(owner);
    await inOneWindow(window, LIMITS.membership_selection.windowSeconds, async () => {
      const a = await business('Rate A');
      const agent = await member(a, 'agent');
      const b = await business('Rate B');
      await owner.query(
        `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent')`,
        [b.merchantId, agent.identityId],
      );
      const body = AgentLoginResponse.parse((await agentLogin(agent.email)).body);
      if (body.status !== 'membership_selection_required') throw new Error('expected a selection');
      const attempt = () =>
        post('/v1/auth/agent/login/select', {
          selectionToken: body.selectionToken,
          selectionId: '01900000-0000-7000-8000-00000000dead',
        });
      for (let i = 0; i < LIMITS.membership_selection.perIdentifier; i++) {
        expect((await attempt()).status).toBe(401); // the first attempt spends the token; the rest find nothing
      }
      const limited = await attempt();
      expect(limited.status).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    });
  });
});

describe('who is not an agent, and where agent tokens do not work', () => {
  it('an owner or staff member cannot sign in as an agent, and an agent cannot sign in on the web', async () => {
    const b = await business();
    const staff = await member(b, 'staff');
    const agent = await member(b, 'agent');
    expectError(await agentLogin(b.owner.email), 401, 'INVALID_CREDENTIALS');
    expectError(await agentLogin(staff.email), 401, 'INVALID_CREDENTIALS');
    const web = await post('/v1/auth/login', {
      email: agent.email,
      password: TEST_PASSWORD,
      audience: 'merchant',
    });
    expectError(web, 401, 'INVALID_CREDENTIALS');
  });

  it('an agent token opens no merchant endpoint — as bearer or as a cookie', async () => {
    const { tokens } = await signedInAgent();
    expectError(
      await request(app).get('/v1/merchant/membership').set('Authorization', `Bearer ${tokens.accessToken}`),
      401,
      'UNAUTHENTICATED',
    );
    expectError(await call(tokens.accessToken, 'get', '/v1/merchant/membership'), 401, 'UNAUTHENTICATED');
  });

  it('a merchant token opens no agent endpoint', async () => {
    const b = await business();
    expectError(await me(b.owner.token), 401, 'UNAUTHENTICATED'); // a web token as bearer
  });

  it('refresh tokens never cross endpoints, and the refused attempt changes nothing (T12)', async () => {
    const { tokens } = await signedInAgent();
    const b = await business();
    const web = await post('/v1/auth/login', {
      email: b.owner.email,
      password: TEST_PASSWORD,
      audience: 'merchant',
    });
    const cookies = Object.fromEntries(
      (web.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]!.split('=')),
    );

    // A web refresh token at the agent endpoint: refused, and still good at its own endpoint.
    expectError(await agentRefresh(cookies[AUTH_COOKIES.refresh]), 401, 'INVALID_OR_EXPIRED_TOKEN');
    const webRefresh = await request(app)
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', clientIp())
      .set(
        'Cookie',
        `${AUTH_COOKIES.refresh}=${cookies[AUTH_COOKIES.refresh]}; ${AUTH_COOKIES.csrf}=${cookies[AUTH_COOKIES.csrf]}`,
      )
      .set('Origin', TEST_WEB_ORIGIN)
      .set(CSRF_HEADER, cookies[AUTH_COOKIES.csrf]);
    expect(webRefresh.status).toBe(200);

    // An agent refresh token as the web cookie: refused, and still good at the agent endpoint.
    const csrf = 'csrf-for-the-test';
    const crossed = await request(app)
      .post('/v1/auth/refresh')
      .set('X-Forwarded-For', clientIp())
      .set('Cookie', `${AUTH_COOKIES.refresh}=${tokens.refreshToken}; ${AUTH_COOKIES.csrf}=${csrf}`)
      .set('Origin', TEST_WEB_ORIGIN)
      .set(CSRF_HEADER, csrf);
    expectError(crossed, 401, 'INVALID_OR_EXPIRED_TOKEN');
    expect((await agentRefresh(tokens.refreshToken)).status).toBe(200);
  });

  it('a merchant selection challenge cannot be redeemed at the agent endpoint', async () => {
    const a = await business();
    const b = await business();
    const staff = await member(a, 'staff');
    await owner.query(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, 'staff', $3)`,
      [b.merchantId, staff.identityId, b.roleId],
    );
    const web = await post('/v1/auth/login', {
      email: staff.email,
      password: TEST_PASSWORD,
      audience: 'merchant',
    });
    expectError(web, 409, 'MEMBERSHIP_SELECTION_REQUIRED');
    const challenge = Object.fromEntries(
      (web.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]!.split('=')),
    )['__Secure-ak_sel'];
    expectError(
      await post('/v1/auth/agent/login/select', {
        selectionToken: challenge,
        selectionId: staff.membershipId,
      }),
      401,
      'INVALID_OR_EXPIRED_TOKEN',
    );
  });
});

describe('deactivation (BR-10.6b, T5)', () => {
  it('a deactivated agent is out from the next request and cannot refresh or sign in', async () => {
    const { b, agent, tokens } = await signedInAgent();
    const res = await call(b.owner.token, 'post', `/v1/merchant/members/${agent.membershipId}/deactivate`);
    expect(res.status).toBe(200);
    expectError(await me(tokens.accessToken), 401, 'UNAUTHENTICATED');
    expectError(await agentRefresh(tokens.refreshToken), 401, 'INVALID_OR_EXPIRED_TOKEN');
    expectError(await agentLogin(agent.email), 401, 'INVALID_CREDENTIALS');
  });

  it('a deactivated business takes its agents out too', async () => {
    const { b, tokens } = await signedInAgent();
    await owner.query(
      `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`,
      [b.merchantId],
    );
    expectError(await me(tokens.accessToken), 401, 'UNAUTHENTICATED');
    expectError(await agentRefresh(tokens.refreshToken), 401, 'INVALID_OR_EXPIRED_TOKEN');
  });
});
