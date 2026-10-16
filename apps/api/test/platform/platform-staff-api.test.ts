import { randomBytes } from 'node:crypto';
import {
  AUTH_COOKIES,
  CSRF_HEADER,
  PlatformStaffList,
  PlatformStaffMember,
  Session,
  TotpEnrollment,
} from '@alphakolect/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { MFA_CHALLENGE_COOKIE } from '../../src/modules/identity/cookies.js';
import { totpCode, totpStep } from '../../src/modules/identity/totp.js';
import { createTestApp, TEST_WEB_APP_URL, TEST_WEB_ORIGIN } from '../support/app.js';
import { auditRows, failAuditInsert, markerRequestId } from '../support/audit.js';
import { expectError, TEST_PASSWORD, tenancyFixtures, uniqueEmail } from '../support/tenancy.js';

// The platform team through the real app and database (P5.7; P5 plan §7.4, §7.5, §10 P5.7; D4, O8(a), O8(b)): the
// super admin creates a staff member, who sets a password from the emailed link and must enrol MFA before any full
// session; the role grants nothing; access comes only from the grants the super admin sets, and goes with them;
// deactivation ends the person's sessions; reactivation starts again with nothing.

const { app, auth, email } = await createTestApp();
const fx = tenancyFixtures(app, auth);
const { owner, call } = fx;

const ASK_A_SUPER_ADMIN = "You don't have permission to do this. Ask a super admin if you need it.";
const SUPER_ADMIN_ONLY = 'Only a platform super admin can do this';
const clientIp = () => `10.${randomBytes(3).join('.')}`;

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of text) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
const cookiesOf = (res: request.Response) =>
  new Map(
    ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map(
      (c) => c.split(';')[0]!.split('=') as [string, string],
    ),
  );
type Jar = { access: string; csrf: string };
const jarOf = (res: request.Response): Jar => {
  const c = cookiesOf(res);
  return { access: c.get(AUTH_COOKIES.access)!, csrf: c.get(AUTH_COOKIES.csrf)! };
};
const as = (jar: Jar, method: 'get' | 'post' | 'put', path: string, body?: object) => {
  const client = request(app);
  const req = client[method](path)
    .set('X-Forwarded-For', clientIp())
    .set('Cookie', `${AUTH_COOKIES.access}=${jar.access}; ${AUTH_COOKIES.csrf}=${jar.csrf}`);
  if (method !== 'get') req.set('Origin', TEST_WEB_ORIGIN).set(CSRF_HEADER, jar.csrf);
  return body ? req.send(body) : req.send();
};
const login = (address: string) =>
  request(app)
    .post('/v1/auth/login')
    .set('X-Forwarded-For', clientIp())
    .send({ email: address, password: TEST_PASSWORD, audience: 'platform' });

async function setupToken(address: string): Promise<string> {
  const of = () => email.to(address).filter((m) => m.template === 'account_setup');
  await vi.waitFor(() => expect(of().length).toBeGreaterThanOrEqual(1));
  const match = new RegExp(`^${TEST_WEB_APP_URL}/set-password#token=([A-Za-z0-9_-]{43})$`, 'm').exec(
    of().at(-1)!.text,
  );
  expect(match).not.toBeNull();
  return match![1]!;
}

const create = (token: string, address: string, role = 'support', rid = markerRequestId('staff')) =>
  call(token, 'post', '/v1/platform/staff', { email: address, role }).set('X-Request-ID', rid);
const setGrants = (token: string, id: string, permissions: string[], rid = markerRequestId('grants')) =>
  call(token, 'put', `/v1/platform/staff/${id}/permissions`, { permissions }).set('X-Request-ID', rid);
const lifecycle = (
  token: string,
  id: string,
  action: 'deactivate' | 'reactivate',
  rid = markerRequestId('life'),
) => call(token, 'post', `/v1/platform/staff/${id}/${action}`).set('X-Request-ID', rid);

describe('a staff member’s whole journey (§7.4)', () => {
  it('created with nothing; setup link, password, forced MFA; exactly the grants given; deactivated and reactivated', async () => {
    const admin = await fx.platformAdmin();
    const address = uniqueEmail('journey');

    // Created by the super admin: no permissions; the setup link is sent after the commit.
    const created = await create(admin.token, address, 'support');
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const staff = PlatformStaffMember.parse(created.body);
    expect(staff).toMatchObject({ email: address, role: 'support', status: 'active', permissions: [] });
    expect(staff.deactivatedAt).toBeNull();
    const id = staff.platformMembershipId;

    // The person sets a password, then must enrol MFA: their first session can do nothing else.
    const setup = await request(app)
      .post('/v1/auth/password/setup')
      .set('X-Forwarded-For', clientIp())
      .send({ token: await setupToken(address), password: TEST_PASSWORD });
    expect(setup.status).toBe(204);
    const first = await login(address);
    expect(first.body.status).toBe('mfa_enrollment_required');
    const enrolment = jarOf(first);
    expect(Session.parse((await as(enrolment, 'get', '/v1/auth/session')).body)).toMatchObject({
      audience: 'platform',
      scope: 'mfa_enrollment',
      permissions: [],
    });
    const begin = await as(enrolment, 'post', '/v1/auth/mfa/totp/enrollment');
    const secret = base32Decode(TotpEnrollment.parse(begin.body).secret);
    const confirmed = await as(enrolment, 'post', '/v1/auth/mfa/totp/confirm', {
      code: totpCode(secret, totpStep()),
    });
    expect(confirmed.status).toBe(200);
    let jar = jarOf(confirmed);

    // A full session with no permissions (D4: the role is a label): refused everything but itself.
    expect(Session.parse((await as(jar, 'get', '/v1/auth/session')).body)).toMatchObject({
      scope: 'full',
      permissions: [],
    });
    const listRefused = await as(jar, 'get', '/v1/platform/merchants');
    expectError(listRefused, 403, 'FORBIDDEN');
    expect(listRefused.body.error.message).toBe(ASK_A_SUPER_ADMIN);
    const teamRefused = await as(jar, 'get', '/v1/platform/staff');
    expectError(teamRefused, 403, 'FORBIDDEN');
    expect(teamRefused.body.error.message).toBe(SUPER_ADMIN_ONLY);

    // One grant ⇒ exactly that, from the next request.
    const granted = await setGrants(admin.token, id, ['platform.merchants.read']);
    expect(granted.status).toBe(200);
    expect(PlatformStaffMember.parse(granted.body).permissions).toEqual(['platform.merchants.read']);
    expect((await as(jar, 'get', '/v1/auth/session')).body.permissions).toEqual(['platform.merchants.read']);
    expect((await as(jar, 'get', '/v1/platform/merchants?limit=1')).status).toBe(200);
    expectError(await as(jar, 'get', '/v1/platform/staff'), 403, 'FORBIDDEN');
    expectError(
      await as(jar, 'post', '/v1/platform/merchants/01900000-0000-7000-8000-0000000000c0/deactivate', {
        reason: 'not theirs',
      }),
      403,
      'FORBIDDEN',
    );

    // Revoked ⇒ gone on the next request.
    expect((await setGrants(admin.token, id, [])).status).toBe(200);
    expectError(await as(jar, 'get', '/v1/platform/merchants'), 403, 'FORBIDDEN');

    // Deactivated: the person's sessions end and they cannot sign in.
    await setGrants(admin.token, id, ['platform.audit.read']);
    const deactivated = await lifecycle(admin.token, id, 'deactivate');
    expect(deactivated.status).toBe(200);
    expect(PlatformStaffMember.parse(deactivated.body)).toMatchObject({
      status: 'deactivated',
      permissions: [],
    });
    expectError(await as(jar, 'get', '/v1/auth/session'), 401, 'UNAUTHENTICATED');
    expect((await login(address)).status).toBe(401);

    // Reactivated (O8(b)): active again with nothing; they sign in with their second factor as before.
    const reactivated = await lifecycle(admin.token, id, 'reactivate');
    expect(reactivated.status).toBe(200);
    expect(PlatformStaffMember.parse(reactivated.body)).toMatchObject({ status: 'active', permissions: [] });
    const again = await login(address);
    expect(again.body).toEqual({ status: 'mfa_required' });
    const verified = await request(app)
      .post('/v1/auth/mfa/verify')
      .set('X-Forwarded-For', clientIp())
      .set('Cookie', `${MFA_CHALLENGE_COOKIE}=${cookiesOf(again).get(MFA_CHALLENGE_COOKIE)}`)
      .send({ code: totpCode(secret, totpStep() + 1) });
    expect(verified.status).toBe(200);
    jar = jarOf(verified);
    expect((await as(jar, 'get', '/v1/auth/session')).body).toMatchObject({ scope: 'full', permissions: [] });
  });
});

describe('creating: refusals', () => {
  it('an email that already has an account: 409 EMAIL_IN_USE, nothing created, no email, the denial recorded (O8(a))', async () => {
    const admin = await fx.platformAdmin();
    const b = await fx.business();
    const existing = (
      await owner.query(`SELECT email FROM identity.identities WHERE id = $1`, [b.owner.identityId])
    ).rows[0].email as string;
    const rid = markerRequestId('in-use');
    const res = await create(admin.token, existing, 'support', rid);
    expectError(res, 409, 'EMAIL_IN_USE');
    expect(
      (
        await owner.query(
          `SELECT count(*)::int AS n FROM identity.platform_memberships WHERE identity_id = $1`,
          [b.owner.identityId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(await auditRows(owner, rid)).toEqual([
      expect.objectContaining({
        action: 'platform.staff_created',
        outcome: 'denied',
        actor_identity_id: admin.identityId,
        actor_membership_id: admin.membershipId,
        summary: { reason: 'email_in_use' },
      }),
    ]);
    await new Promise((r) => setTimeout(r, 50));
    expect(email.to(existing).filter((m) => m.template === 'account_setup')).toEqual([]);
  });

  it('a super admin cannot be created (400, nothing recorded); staff without the permission are refused (403)', async () => {
    const admin = await fx.platformAdmin();
    const rid = markerRequestId('as-admin');
    expectError(await create(admin.token, uniqueEmail('x'), 'super_admin', rid), 400, 'VALIDATION_ERROR');
    expect(await auditRows(owner, rid)).toEqual([]);
    const support = await fx.platformAdmin('support');
    const refused = await create(support.token, uniqueEmail('y'));
    expectError(refused, 403, 'FORBIDDEN');
    expect(refused.body.error.message).toBe(SUPER_ADMIN_ONLY);
  });
});

describe('managing: refusals by the database', () => {
  it('the super admin is not staff (404); a repeated change and grants for a deactivated member are 409; unknown grants 400', async () => {
    const admin = await fx.platformAdmin();
    const other = await fx.platformAdmin();
    expectError(await lifecycle(admin.token, other.membershipId, 'deactivate'), 404, 'NOT_FOUND');
    expectError(await setGrants(admin.token, other.membershipId, []), 404, 'NOT_FOUND');
    const staff = PlatformStaffMember.parse((await create(admin.token, uniqueEmail('m'))).body);
    const rid = markerRequestId('again');
    expectError(
      await lifecycle(admin.token, staff.platformMembershipId, 'reactivate', rid),
      409,
      'INVALID_LIFECYCLE_TRANSITION',
    );
    expect(await auditRows(owner, rid)).toEqual([
      expect.objectContaining({
        action: 'platform.staff_reactivated',
        outcome: 'failure',
        summary: { reason: 'invalid_transition' },
      }),
    ]);
    const bad = markerRequestId('bad-grants');
    expectError(
      await setGrants(admin.token, staff.platformMembershipId, ['platform.merchants.lifecycle'], bad),
      400,
      'VALIDATION_ERROR',
    );
    expect(await auditRows(owner, bad)).toEqual([
      expect.objectContaining({
        action: 'platform.grants_set',
        outcome: 'failure',
        summary: { reason: 'invalid_permissions' },
      }),
    ]);
    await lifecycle(admin.token, staff.platformMembershipId, 'deactivate');
    expectError(
      await setGrants(admin.token, staff.platformMembershipId, ['platform.merchants.read']),
      409,
      'INVALID_LIFECYCLE_TRANSITION',
    );
  });

  it('an exception inside the function is not a refusal: 500, nothing changed, no denial recorded (§8.2a)', async () => {
    const admin = await fx.platformAdmin();
    const staff = PlatformStaffMember.parse((await create(admin.token, uniqueEmail('boom'))).body);
    const rid = markerRequestId('boom');
    const restore = await failAuditInsert(owner, 'platform.staff_deactivated', 'success', rid);
    try {
      expect((await lifecycle(admin.token, staff.platformMembershipId, 'deactivate', rid)).status).toBe(500);
    } finally {
      await restore();
    }
    expect(
      (
        await owner.query(`SELECT status FROM identity.platform_memberships WHERE id = $1`, [
          staff.platformMembershipId,
        ])
      ).rows[0].status,
    ).toBe('active');
    expect(await auditRows(owner, rid)).toEqual([]);
  });
});

describe('the team list', () => {
  it('newest first, the super admin not listed, pages joined by a cursor; another list’s cursor is refused', async () => {
    const admin = await fx.platformAdmin();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        PlatformStaffMember.parse((await create(admin.token, uniqueEmail(`team${i}`))).body)
          .platformMembershipId,
      );
    const first = PlatformStaffList.parse(
      (await call(admin.token, 'get', '/v1/platform/staff?limit=2')).body,
    );
    expect(first.items.map((m) => m.platformMembershipId)).toEqual([ids[2], ids[1]]);
    expect(first.nextCursor).not.toBeNull();
    const second = PlatformStaffList.parse(
      (await call(admin.token, 'get', `/v1/platform/staff?limit=2&cursor=${first.nextCursor}`)).body,
    );
    expect(second.items[0]!.platformMembershipId).toBe(ids[0]);
    expect(first.items.concat(second.items).map((m) => m.role)).not.toContain('super_admin');

    const merchantsCursor = (await call(admin.token, 'get', '/v1/platform/merchants?limit=1')).body
      .nextCursor as string;
    for (const cursor of [merchantsCursor, 'not-a-cursor', Buffer.from('{}').toString('base64url')])
      expectError(
        await call(admin.token, 'get', `/v1/platform/staff?cursor=${cursor}`),
        400,
        'INVALID_CURSOR',
      );
    expectError(await call(admin.token, 'get', '/v1/platform/staff?limit=101'), 400, 'VALIDATION_ERROR');
  });
});
