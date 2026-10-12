import { randomBytes } from 'node:crypto';
import { AUTH_COOKIES, CSRF_HEADER } from '@alphakolect/contracts';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { createTestApp, TEST_WEB_ORIGIN } from '../support/app.js';
import { auditRows, failAuditInsert, markerRequestId } from '../support/audit.js';
import { TEST_PASSWORD, tenancyFixtures, uniqueEmail } from '../support/tenancy.js';

// The A7 paths keep their status when their best-effort insert fails (P5.3a; P5 plan §8.3, §8.2a rule 5, §9.4): every
// refusal or failure path — and the link-issuing successes of O6 — answers exactly as it does when the event is stored,
// stores nothing, and logs one signal line: audit_denial_write_failure for a denial, audit_write_failure otherwise.

type Line = Record<string, unknown>;
const lines: Line[] = [];
const capture = {
  write(text: string) {
    try {
      lines.push(JSON.parse(text) as Line);
    } catch {
      // not a JSON line
    }
  },
};
const { app, auth } = await createTestApp({ logger: pino({ level: 'error' }, capture) });
const fx = tenancyFixtures(app, auth);
const { owner } = fx;

const clientIp = () => `10.${randomBytes(3).join('.')}`;
const marked = (req: request.Test, rid: string) =>
  req.set('X-Request-ID', rid).set('X-Forwarded-For', clientIp());
const UNKNOWN_ID = '01900000-0000-7000-8000-0000000000ff';

async function person({ verified = true } = {}) {
  const address = uniqueEmail('a7');
  const { rows } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [address, verified ? new Date() : null, await hashPassword(TEST_PASSWORD)],
  );
  return { email: address, identityId: rows[0].id as string };
}

type Case = { pair: string; run: (rid: string) => Promise<request.Response> };
const staffOf = async () => {
  const b = await fx.business();
  return { b, staff: await fx.member(b, 'staff') };
};
const asStaff = (token: string, method: 'post' | 'patch', path: string, rid: string, body?: object) =>
  fx.call(token, method, path, body).set('X-Request-ID', rid);

const CASES: Case[] = [
  // identity failures
  {
    pair: 'auth.login/failure',
    run: (rid) =>
      marked(request(app).post('/v1/auth/login'), rid).send({
        email: uniqueEmail('nobody'),
        password: TEST_PASSWORD,
        audience: 'merchant',
      }),
  },
  {
    pair: 'auth.login_select/failure',
    run: (rid) => marked(request(app).post('/v1/auth/login/select'), rid).send({ selectionId: UNKNOWN_ID }),
  },
  {
    pair: 'auth.refresh/failure',
    run: (rid) =>
      marked(request(app).post('/v1/auth/agent/refresh'), rid).send({ refreshToken: 'not-a-token' }),
  },
  {
    pair: 'auth.signup/failure',
    run: async (rid) =>
      marked(request(app).post('/v1/auth/signup'), rid).send({
        email: (await person()).email,
        password: TEST_PASSWORD,
        businessName: 'Taken Ltd',
      }),
  },
  {
    pair: 'auth.email_verify/failure',
    run: (rid) => marked(request(app).post('/v1/auth/email/verify'), rid).send({ token: 'x'.repeat(43) }),
  },
  {
    pair: 'auth.password_reset/failure',
    run: (rid) =>
      marked(request(app).post('/v1/auth/password/reset'), rid).send({
        token: 'x'.repeat(43),
        password: 'another long passphrase',
      }),
  },
  {
    pair: 'auth.account_setup/failure',
    run: (rid) =>
      marked(request(app).post('/v1/auth/password/setup'), rid).send({
        token: 'x'.repeat(43),
        password: 'another long passphrase',
      }),
  },
  {
    pair: 'auth.password_change/failure',
    run: async (rid) => {
      const { staff } = await staffOf();
      return asStaff(staff.token, 'post', '/v1/auth/password/change', rid, {
        currentPassword: 'wrong passphrase here',
        newPassword: 'another long passphrase',
      });
    },
  },
  {
    pair: 'auth.mfa_verify/failure',
    run: (rid) => marked(request(app).post('/v1/auth/mfa/verify'), rid).send({ code: '123456' }),
  },
  {
    pair: 'auth.mfa_enrollment_confirmed/failure',
    run: async (rid) => {
      const p = await person();
      await owner.query(
        `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'super_admin')`,
        [p.identityId],
      );
      const login = await request(app)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', clientIp())
        .send({ email: p.email, password: TEST_PASSWORD, audience: 'platform' });
      const cookies = new Map(
        ((login.headers['set-cookie'] as unknown as string[]) ?? []).map(
          (c) => c.split(';')[0]!.split('=') as [string, string],
        ),
      );
      const jar = { access: cookies.get(AUTH_COOKIES.access)!, csrf: cookies.get(AUTH_COOKIES.csrf)! };
      const web = (path: string) =>
        request(app)
          .post(path)
          .set('Cookie', `${AUTH_COOKIES.access}=${jar.access}; ${AUTH_COOKIES.csrf}=${jar.csrf}`)
          .set('Origin', TEST_WEB_ORIGIN)
          .set(CSRF_HEADER, jar.csrf);
      const begin = await web('/v1/auth/mfa/totp/enrollment').set('X-Forwarded-For', clientIp()).send();
      expect(begin.status).toBe(200); // a secret now exists, and the code below is wrong for it
      return marked(web('/v1/auth/mfa/totp/confirm'), rid).send({ code: '000000' });
    },
  },
  {
    pair: 'auth.invitation_accepted/failure',
    run: (rid) =>
      marked(request(app).post('/v1/auth/invitations/accept'), rid).send({
        token: 'x'.repeat(43),
        email: uniqueEmail('nobody'),
        password: TEST_PASSWORD,
      }),
  },
  // O6: the link-issuing requests, refused and granted
  {
    pair: 'auth.password_forgot/failure',
    run: (rid) =>
      marked(request(app).post('/v1/auth/password/forgot'), rid).send({ email: uniqueEmail('nobody') }),
  },
  {
    pair: 'auth.password_forgot/success',
    run: async (rid) =>
      marked(request(app).post('/v1/auth/password/forgot'), rid).send({ email: (await person()).email }),
  },
  {
    pair: 'auth.verification_resend/failure',
    run: (rid) =>
      marked(request(app).post('/v1/auth/email/resend'), rid).send({ email: uniqueEmail('nobody') }),
  },
  {
    pair: 'auth.verification_resend/success',
    run: async (rid) =>
      marked(request(app).post('/v1/auth/email/resend'), rid).send({
        email: (await person({ verified: false })).email,
      }),
  },
  // tenancy refusals (denied) and failures
  {
    pair: 'merchant.profile_updated/denied',
    run: async (rid) =>
      asStaff((await staffOf()).staff.token, 'patch', '/v1/merchant/profile', rid, { name: 'Not Mine Ltd' }),
  },
  {
    pair: 'merchant.branch_created/denied',
    run: async (rid) =>
      asStaff((await staffOf()).staff.token, 'post', '/v1/merchant/branches', rid, { name: 'Not Mine' }),
  },
  {
    pair: 'merchant.member_deactivated/denied',
    run: async (rid) => {
      const { b, staff } = await staffOf();
      return asStaff(staff.token, 'post', `/v1/merchant/members/${b.owner.membershipId}/deactivate`, rid);
    },
  },
  {
    pair: 'merchant.member_deactivated/failure',
    run: async (rid) => {
      const { b, staff } = await staffOf();
      await owner.query(
        `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
        [staff.membershipId],
      );
      return asStaff(b.owner.token, 'post', `/v1/merchant/members/${staff.membershipId}/deactivate`, rid);
    },
  },
  {
    pair: 'merchant.invitation_issued/denied',
    run: async (rid) =>
      asStaff((await staffOf()).staff.token, 'post', '/v1/merchant/invitations', rid, {
        email: uniqueEmail('x'),
        kind: 'agent',
      }),
  },
  {
    pair: 'merchant.invitation_issued/failure',
    run: async (rid) => {
      const { b, staff } = await staffOf();
      return asStaff(b.owner.token, 'post', '/v1/merchant/invitations', rid, {
        email: staff.email,
        kind: 'agent',
      });
    },
  },
  {
    pair: 'merchant.invitation_revoked/failure',
    run: async (rid) =>
      asStaff(
        (await fx.business()).owner.token,
        'post',
        `/v1/merchant/invitations/${UNKNOWN_ID}/revoke`,
        rid,
      ),
  },
  // platform refusals and failures
  {
    pair: 'platform.merchant_deactivated/denied',
    run: async (rid) => {
      const [b, support] = [await fx.business(), await fx.platformAdmin('support')];
      return asStaff(support.token, 'post', `/v1/platform/merchants/${b.merchantId}/deactivate`, rid, {
        reason: 'not allowed',
      });
    },
  },
  {
    pair: 'platform.merchant_reactivated/failure',
    run: async (rid) => {
      const [b, admin] = [await fx.business(), await fx.platformAdmin()];
      return asStaff(admin.token, 'post', `/v1/platform/merchants/${b.merchantId}/reactivate`, rid);
    },
  },
  {
    pair: 'platform.ownership_transferred/failure',
    run: async (rid) => {
      const [b, admin] = [await fx.business(), await fx.platformAdmin()];
      return asStaff(admin.token, 'post', `/v1/platform/merchants/${b.merchantId}/transfer-ownership`, rid, {
        newOwnerMembershipId: UNKNOWN_ID,
        formerOwnerRoleId: b.roleId,
        deactivateFormerOwner: false,
      });
    },
  },
];

describe.each(CASES)('$pair', ({ pair, run }) => {
  const [action, outcome] = pair.split('/') as [string, string];
  const ofPair = (rows: Line[]) => rows.filter((r) => r.action === action && r.outcome === outcome);

  it('answers the same, stores nothing and logs one signal line when its best-effort insert fails', async () => {
    // Without a failure: the normal answer, and the event stored.
    const normal = markerRequestId('a7');
    const expected = await run(normal);
    expect(expected.status, JSON.stringify(expected.body)).toBeGreaterThanOrEqual(200);
    expect(ofPair(await auditRows(owner, normal))).toHaveLength(1);

    // With the insert failing: the same status, nothing stored, the signal.
    const rid = markerRequestId('a7-fail');
    const restore = await failAuditInsert(owner, action, outcome, rid);
    let res: request.Response;
    try {
      res = await run(rid);
    } finally {
      await restore();
    }
    expect(res.status).toBe(expected.status);
    expect(ofPair(await auditRows(owner, rid))).toEqual([]);
    const signal = outcome === 'denied' ? 'audit_denial_write_failure' : 'audit_write_failure';
    expect(lines.filter((l) => l.requestId === rid && l.signal)).toEqual([
      expect.objectContaining({ signal, event: pair, requestId: rid, reason: 'XX000' }),
    ]);
  });
});
