import { randomBytes } from 'node:crypto';
import { AUTH_COOKIES, CSRF_HEADER, MerchantLifecycle, PERMISSIONS } from '@alphakolect/contracts';
import pg from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AuditLog } from '../../src/modules/audit/audit-log.js';
import type { SessionAudience } from '../../src/modules/identity/access-tokens.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { newOpaqueToken } from '../../src/modules/identity/tokens.js';
import { MerchantLifecycleService } from '../../src/modules/tenancy/merchant-lifecycle.js';
import type { AuthContext } from '../../src/platform/http/authenticate.js';
import { createTestApp, TEST_WEB_ORIGIN } from '../support/app.js';
import { failAuditInsert, markerRequestId } from '../support/audit.js';

// P4.1 merchant lifecycle through the real app and database (ADR-15 T5, T6, T9; P4 exit criteria 5, 10): the
// platform endpoints, their effect on a member's very next request, refresh and login, reactivation, every refusal,
// audit atomicity and isolation.

const { app, auth, db } = await createTestApp();
const repo = auth.identity;
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
beforeAll(() => owner.connect());
afterAll(() => owner.end());

const PASSWORD = 'a long enough passphrase';
const CSRF = 'csrf-token-for-the-test';
const uniqueEmail = (tag: string) => `${tag}-${randomBytes(5).toString('hex')}@example.test`;
const clientIp = () => `10.${randomBytes(3).join('.')}`;

/** A platform identity with a session as the API would hold it after login (+ MFA), and its access token. */
async function platformAdmin({ role = 'super_admin', scope = 'full' as 'full' | 'mfa_enrollment' } = {}) {
  const {
    rows: [identity],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
    [uniqueEmail('admin')],
  );
  const {
    rows: [membership],
  } = await owner.query(
    `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, $2) RETURNING id`,
    [identity.id, role],
  );
  await owner.query(
    `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at) VALUES ($1, '\\x00', 'k1', $2)`,
    [identity.id, scope === 'full' ? new Date() : null],
  );
  return tokenFor(identity.id, 'platform', membership.id, scope);
}

async function tokenFor(
  identityId: string,
  audience: SessionAudience,
  membershipId: string,
  scope: 'full' | 'mfa_enrollment',
) {
  const lifetime =
    scope === 'mfa_enrollment'
      ? { idleSeconds: 900, absoluteSeconds: 900 }
      : audience === 'platform'
        ? { idleSeconds: 3600, absoluteSeconds: 43200 }
        : { idleSeconds: 86400, absoluteSeconds: 1209600 };
  const s = await repo.createSession({
    identityId,
    audience,
    membershipId,
    scope,
    refreshHash: newOpaqueToken().hash,
    lifetime,
    ip: null,
    userAgent: null,
  });
  return {
    identityId,
    membershipId,
    sessionId: s.session_id,
    token: await auth.accessTokens.sign({
      sub: identityId,
      sid: s.session_id,
      aud: audience,
      mid: membershipId,
    }),
  };
}

/** A merchant from signup; verified (active) unless told otherwise. */
async function merchant({ verified = true } = {}) {
  const email = uniqueEmail('owner');
  const signup = await repo.signupMerchantOwner(email, await hashPassword(PASSWORD), 'Lifecycle Biz');
  if (verified) {
    const t = newOpaqueToken();
    await repo.issueOneTimeToken(signup.identity_id!, 'email_verification', t.hash, 3600, null);
    await repo.verifyEmail(t.hash);
  }
  return { email, merchantId: signup.merchant_id!, identityId: signup.identity_id! };
}

type Jar = { access: string; refresh: string; csrf: string };
const jarOf = (res: request.Response): Jar => {
  const c = Object.fromEntries(
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).map((x) => x.split(';')[0]!.split('=')),
  );
  return { access: c[AUTH_COOKIES.access], refresh: c[AUTH_COOKIES.refresh], csrf: c[AUTH_COOKIES.csrf] };
};
const login = (email: string) =>
  request(app)
    .post('/v1/auth/login')
    .set('X-Forwarded-For', clientIp())
    .send({ email, password: PASSWORD, audience: 'merchant' });
const session = (access: string) =>
  request(app).get('/v1/auth/session').set('Cookie', `${AUTH_COOKIES.access}=${access}`);
const refresh = (jar: Jar) =>
  request(app)
    .post('/v1/auth/refresh')
    .set('X-Forwarded-For', clientIp())
    .set('Cookie', `${AUTH_COOKIES.refresh}=${jar.refresh}; ${AUTH_COOKIES.csrf}=${jar.csrf}`)
    .set('Origin', TEST_WEB_ORIGIN)
    .set(CSRF_HEADER, jar.csrf);

/** A platform action as the web console makes it: cookie session, Origin, CSRF header. */
const platform = (
  token: string,
  merchantId: string,
  action: 'deactivate' | 'reactivate',
  body?: object,
  { csrf = true } = {},
) => {
  const req = request(app)
    .post(`/v1/platform/merchants/${merchantId}/${action}`)
    .set('Cookie', `${AUTH_COOKIES.access}=${token}; ${AUTH_COOKIES.csrf}=${CSRF}`)
    .set('Origin', TEST_WEB_ORIGIN);
  if (csrf) req.set(CSRF_HEADER, CSRF);
  return body ? req.send(body) : req.send();
};

const status = async (merchantId: string) =>
  (await owner.query(`SELECT status FROM tenancy.merchants WHERE id = $1`, [merchantId])).rows[0]
    .status as string;

const auditFor = async (res: request.Response) =>
  (
    await owner.query(
      `SELECT action, outcome, merchant_id, actor_identity_id, target_id, summary FROM audit.audit_events WHERE request_id = $1`,
      [res.headers['x-request-id']],
    )
  ).rows;

let admin: Awaited<ReturnType<typeof platformAdmin>>;
beforeAll(async () => {
  admin = await platformAdmin();
});

describe('deactivation and reactivation, end to end', () => {
  it('cuts off a member’s existing session on the next request, refresh and login — and reactivation restores them', async () => {
    const m = await merchant();
    const signin = await login(m.email);
    expect(signin.status).toBe(200);
    const jar = jarOf(signin);
    expect((await session(jar.access)).status).toBe(200);

    const res = await platform(admin.token, m.merchantId, 'deactivate', { reason: 'Chargeback fraud' });
    expect(res.status).toBe(200);
    expect(MerchantLifecycle.parse(res.body)).toEqual({ merchantId: m.merchantId, status: 'deactivated' });
    expect(await auditFor(res)).toEqual([
      {
        action: 'platform.merchant_deactivated',
        outcome: 'success',
        merchant_id: m.merchantId,
        actor_identity_id: admin.identityId,
        target_id: m.merchantId,
        summary: { status: 'deactivated', reason: 'Chargeback fraud' },
      },
    ]);

    expect((await session(jar.access)).status).toBe(401); // the very next request
    expect((await refresh(jar)).body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    const refused = await login(m.email);
    expect(refused.status).toBe(401);
    expect(refused.body.error.code).toBe('INVALID_CREDENTIALS'); // generic; never a 500

    const back = await platform(admin.token, m.merchantId, 'reactivate');
    expect(back.status).toBe(200);
    expect(back.body).toEqual({ merchantId: m.merchantId, status: 'active' });
    expect((await session(jar.access)).status).toBe(200); // not revoked: usable again
    expect((await login(m.email)).status).toBe(200);
  });

  it('reactivating a never-verified signup returns it to pending verification (BR-2.2)', async () => {
    const m = await merchant({ verified: false });
    expect((await platform(admin.token, m.merchantId, 'deactivate', { reason: 'Fake signup' })).status).toBe(
      200,
    );
    const back = await platform(admin.token, m.merchantId, 'reactivate');
    expect(back.body.status).toBe('pending_verification');
    expect((await login(m.email)).body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
  });

  it('leaves every other merchant alone', async () => {
    const target = await merchant();
    const bystander = await merchant();
    const bystanderJar = jarOf(await login(bystander.email));
    await platform(admin.token, target.merchantId, 'deactivate', { reason: 'Review' });
    expect((await session(bystanderJar.access)).status).toBe(200);
    expect(await status(bystander.merchantId)).toBe('active');
  });
});

describe('refusals', () => {
  it.each([
    ['an unknown merchant', 404, 'NOT_FOUND'],
    ['a merchant that is already deactivated', 409, 'INVALID_LIFECYCLE_TRANSITION'],
  ])('%s', async (label, code, errorCode) => {
    const m = await merchant();
    let target = m.merchantId;
    if (label.startsWith('an unknown')) target = '01900000-0000-7000-8000-0000000fffff';
    else await platform(admin.token, m.merchantId, 'deactivate', { reason: 'First' });
    const res = await platform(admin.token, target, 'deactivate', { reason: 'Again' });
    expect(res.status).toBe(code);
    expect(res.body.error.code).toBe(errorCode);
  });

  it.each([
    ['no reason', {}],
    ['a blank reason', { reason: '   ' }],
    ['a reason over 500 characters', { reason: 'x'.repeat(501) }],
  ])('refuses %s with 400 and changes nothing', async (_label, body) => {
    const m = await merchant();
    const res = await platform(admin.token, m.merchantId, 'deactivate', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await status(m.merchantId)).toBe('active');
  });

  it('refuses a malformed merchant id', async () => {
    const res = await platform(admin.token, 'not-an-id', 'reactivate');
    expect(res.status).toBe(400);
  });

  it('requires the CSRF header like any cookie-authenticated change', async () => {
    const m = await merchant();
    const res = await platform(admin.token, m.merchantId, 'deactivate', { reason: 'x' }, { csrf: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
    expect(await status(m.merchantId)).toBe('active');
  });

  it('refuses a merchant owner (wrong audience) and an enrolment-only platform session', async () => {
    const m = await merchant();
    const ownerJar = jarOf(await login(m.email));
    const asOwner = await platform(ownerJar.access, m.merchantId, 'deactivate', { reason: 'x' });
    expect(asOwner.body.error.code).toBe('WRONG_AUDIENCE');

    const enrolling = await platformAdmin({ scope: 'mfa_enrollment' });
    const asEnrolling = await platform(enrolling.token, m.merchantId, 'deactivate', { reason: 'x' });
    expect(asEnrolling.body.error.code).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(await status(m.merchantId)).toBe('active');
  });

  it('refuses a fully signed-in platform member who is not a super admin — at the policy middleware — and records it', async () => {
    const support = await platformAdmin({ role: 'support' });
    const m = await merchant();
    const res = await platform(support.token, m.merchantId, 'deactivate', { reason: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Only a platform super admin may change a merchant’s status',
    });
    expect(await status(m.merchantId)).toBe('active');
    expect(await auditFor(res)).toEqual([
      expect.objectContaining({
        action: 'authz.denied',
        outcome: 'denied',
        merchant_id: null,
        actor_identity_id: support.identityId,
        target_id: null,
        summary: { operation: 'deactivateMerchant', permission: 'platform.merchants.lifecycle' },
      }),
    ]);
  });

  it('the database still refuses that member when the middleware is bypassed, and audits it (defence in depth)', async () => {
    const support = await platformAdmin({ role: 'support' });
    const m = await merchant();
    const service = new MerchantLifecycleService({ db, audit: new AuditLog(db, pino({ level: 'silent' })) });
    const requestId = `lifecycle-bypass-${randomBytes(4).toString('hex')}`;
    const supportContext: AuthContext = {
      identityId: support.identityId,
      sessionId: support.sessionId,
      audience: 'platform',
      membershipId: support.membershipId,
      merchantId: null,
      scope: 'full',
      kind: 'support',
      roleId: null,
      branchId: null,
      branchStatus: null,
      permissions: [],
      transport: 'cookie',
    };
    await expect(
      service.change(supportContext, m.merchantId, 'deactivate', 'Bypass check', {
        ip: '127.0.0.1',
        userAgent: null,
        requestId,
      }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(await status(m.merchantId)).toBe('active');
    const { rows } = await owner.query(
      `SELECT action, outcome, merchant_id, summary FROM audit.audit_events WHERE request_id = $1`,
      [requestId],
    );
    expect(rows).toEqual([
      {
        action: 'platform.merchant_deactivated',
        outcome: 'denied',
        merchant_id: null,
        summary: { reason: 'forbidden' },
      },
    ]);
  });
});

describe('atomicity', () => {
  it('a failed audit write rolls the status change back (the function writes its own row, P5.5)', async () => {
    const m = await merchant();
    const requestId = markerRequestId('lifecycle-atomicity');
    const restore = await failAuditInsert(owner, 'platform.merchant_deactivated', 'success', requestId);
    const service = new MerchantLifecycleService({ db, audit: new AuditLog(db, pino({ level: 'silent' })) });
    const authContext: AuthContext = {
      identityId: admin.identityId,
      sessionId: admin.sessionId,
      audience: 'platform',
      membershipId: admin.membershipId,
      merchantId: null,
      scope: 'full',
      kind: 'super_admin',
      roleId: null,
      branchId: null,
      branchStatus: null,
      permissions: PERMISSIONS.filter((p) => p.startsWith('platform.')),
      transport: 'cookie',
    };
    try {
      await expect(
        service.change(authContext, m.merchantId, 'deactivate', 'Atomicity check', {
          ip: '127.0.0.1',
          userAgent: null,
          requestId,
        }),
      ).rejects.toMatchObject({ code: 'XX000' });
    } finally {
      await restore();
    }
    expect(await status(m.merchantId)).toBe('active');
  });
});
