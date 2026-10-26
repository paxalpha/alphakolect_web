import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { AUTH_COOKIES, CSRF_HEADER, TotpEnrollment } from '@alphakolect/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { MFA_CHALLENGE_COOKIE, SELECTION_CHALLENGE_COOKIE } from '../../src/modules/identity/cookies.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { newOpaqueToken } from '../../src/modules/identity/tokens.js';
import { totpCode, totpStep } from '../../src/modules/identity/totp.js';
import { createTestApp, TEST_WEB_APP_URL, TEST_WEB_ORIGIN } from '../support/app.js';
import { AUDIT_CATALOG } from '../../src/modules/audit/catalog.js';
import { auditRows, FORMER_TRANSITIONAL_PAIRS, failAuditInsert, markerRequestId } from '../support/audit.js';
import { ledgerBodies, ledgerResources } from '../support/ledger.js';
import { customerOf, uniquePhone } from '../support/customers.js';
import { savingsResources } from '../support/savings.js';
import { TEST_PASSWORD, tenancyFixtures, uniqueEmail } from '../support/tenancy.js';

// The coverage guard's per-pair tests (P5.3a; P5 plan §8.1): for every atomic pair the API writes, one real request
// stores exactly one row of that pair — with its actor identity, audience and membership, its business, its target and
// the request's id — and the change it describes commits with it; and with that pair's insert made to fail, the request
// fails and the change is absent. Each test is tagged "[coverage <identifier>/<outcome>]"; the coverage guard
// (guards.test.ts) requires such a pair of tests for every atomic pair. Agent sign-in, selection and refresh write the
// same identifiers as the web flows and run once per audience.

const { app, auth, email } = await createTestApp();
const fx = tenancyFixtures(app, auth);
const { owner } = fx;

const NEW_PASSWORD = 'another long enough passphrase';
const clientIp = () => `10.${randomBytes(3).join('.')}`;

type Row = Record<string, unknown>;
type Run = { res: request.Response; expected: Row; changed: () => Promise<boolean> };
type Case = { pair: string; audience?: string; status: number; run: (rid: string) => Promise<Run> };

/** A request carrying the marker request id, from a fresh client address (rate limits are per address). */
const marked = (req: request.Test, rid: string) =>
  req.set('X-Request-ID', rid).set('X-Forwarded-For', clientIp());
const post = (path: string) => request(app).post(path).set('X-Forwarded-For', clientIp());

function cookiesOf(res: request.Response): Map<string, string> {
  const header = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return new Map(header.map((c) => c.split(';')[0]!.split('=') as [string, string]));
}
type Jar = { access: string; refresh: string; csrf: string };
const jarOf = (res: request.Response): Jar => {
  const c = cookiesOf(res);
  return {
    access: c.get(AUTH_COOKIES.access)!,
    refresh: c.get(AUTH_COOKIES.refresh)!,
    csrf: c.get(AUTH_COOKIES.csrf)!,
  };
};
/** A cookie-authenticated state change, as the web app makes it. */
const webPost = (jar: Jar, path: string) =>
  request(app)
    .post(path)
    .set(
      'Cookie',
      `${AUTH_COOKIES.access}=${jar.access}; ${AUTH_COOKIES.refresh}=${jar.refresh}; ${AUTH_COOKIES.csrf}=${jar.csrf}`,
    )
    .set('Origin', TEST_WEB_ORIGIN)
    .set(CSRF_HEADER, jar.csrf);

const one = async (sql: string, params: unknown[]) => (await owner.query(sql, params)).rows[0];
const count = async (sql: string, params: unknown[]) => Number((await one(sql, params))?.n ?? 0);
const sessionsOf = (identityId: string) =>
  count(`SELECT count(*)::int AS n FROM identity.sessions WHERE identity_id = $1`, [identityId]);
const passwordOf = async (identityId: string) =>
  (await one(`SELECT password_hash FROM identity.identities WHERE id = $1`, [identityId])).password_hash as
    string | null;

/** A person with a password and no membership. */
async function person(tag: string) {
  const address = uniqueEmail(tag);
  const row = await one(
    `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
    [address, await hashPassword(TEST_PASSWORD)],
  );
  return { email: address, identityId: row.id as string };
}
/** A membership of an existing person in a business. */
async function joins(identityId: string, merchantId: string, kind: 'staff' | 'agent', roleId: string | null) {
  return (
    await one(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [merchantId, identityId, kind, kind === 'staff' ? roleId : null],
    )
  ).id as string;
}
/** A platform super admin with a password; with `totp`, a confirmed (dummy) second factor. */
async function platformPerson({ totp }: { totp: boolean }) {
  const p = await person('admin');
  const pm = await one(
    `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'super_admin') RETURNING id`,
    [p.identityId],
  );
  if (totp) {
    await owner.query(
      `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at) VALUES ($1, '\\x00', 'k1', now())`,
      [p.identityId],
    );
  }
  return { ...p, membershipId: pm.id as string };
}
/** Platform sign-in without a second factor yet: the enrolment-only session. */
async function enrolling() {
  const admin = await platformPerson({ totp: false });
  const res = await post('/v1/auth/login').send({
    email: admin.email,
    password: TEST_PASSWORD,
    audience: 'platform',
  });
  expect(res.body.status).toBe('mfa_enrollment_required');
  return { ...admin, jar: jarOf(res) };
}
function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of text) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
/** A web sign-in of a business owner. */
async function ownerSignedIn() {
  const b = await fx.business();
  const res = await post('/v1/auth/login').send({
    email: b.owner.email,
    password: TEST_PASSWORD,
    audience: 'merchant',
  });
  expect(res.status).toBe(200);
  return { b, jar: jarOf(res) };
}
/** An agent's bearer sign-in. */
async function agentSignedIn() {
  const b = await fx.business();
  const agent = await fx.member(b, 'agent');
  const res = await post('/v1/auth/agent/login').send({ email: agent.email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return { b, agent, refreshToken: res.body.refreshToken as string };
}
/** A person who is staff (or an agent) of two businesses: signing in needs a choice. */
async function twoBusinesses(kind: 'staff' | 'agent') {
  const [a, b] = [await fx.business(), await fx.business()];
  const p = await person(kind);
  return {
    p,
    a,
    inA: await joins(p.identityId, a.merchantId, kind, a.roleId),
    inB: await joins(p.identityId, b.merchantId, kind, b.roleId),
  };
}
const ownerActor = (b: Awaited<ReturnType<typeof fx.business>>) => ({
  merchant_id: b.merchantId,
  actor_identity_id: b.owner.identityId,
  actor_audience: 'merchant',
  actor_membership_id: b.owner.membershipId,
});
const asOwner = (
  b: Awaited<ReturnType<typeof fx.business>>,
  method: 'post' | 'patch' | 'put',
  path: string,
  rid: string,
  body?: object,
) => fx.call(b.owner.token, method, path, body).set('X-Request-ID', rid);

const CASES: Case[] = [
  // ── identity flows, pattern B (§8.4) ─────────────────────────────────────────────────────────
  {
    pair: 'auth.signup/success',
    status: 202,
    run: async (rid) => {
      const address = uniqueEmail('signup');
      const res = await marked(request(app).post('/v1/auth/signup'), rid).send({
        email: address,
        password: TEST_PASSWORD,
        businessName: 'Coverage Ltd',
      });
      const created = await one(
        `SELECT i.id, m.merchant_id FROM identity.identities i JOIN tenancy.merchant_memberships m ON m.identity_id = i.id WHERE i.email = $1`,
        [address],
      );
      return {
        res,
        expected: created
          ? {
              merchant_id: created.merchant_id,
              actor_identity_id: created.id,
              actor_audience: 'merchant',
              target_type: 'merchant',
              target_id: created.merchant_id,
            }
          : {},
        changed: async () =>
          (await count(`SELECT count(*)::int AS n FROM identity.identities WHERE email = $1`, [address])) > 0,
      };
    },
  },
  {
    pair: 'auth.email_verify/success',
    status: 204,
    run: async (rid) => {
      const signup = await auth.identity.signupMerchantOwner(
        uniqueEmail('verify'),
        await hashPassword(TEST_PASSWORD),
        'Verify Ltd',
      );
      const token = newOpaqueToken();
      await auth.identity.issueOneTimeToken(
        signup.identity_id!,
        'email_verification',
        token.hash,
        3600,
        null,
      );
      const res = await marked(request(app).post('/v1/auth/email/verify'), rid).send({ token: token.raw });
      return {
        res,
        expected: { actor_identity_id: signup.identity_id },
        changed: async () =>
          Boolean(
            (
              await one(`SELECT email_verified_at FROM identity.identities WHERE id = $1`, [
                signup.identity_id,
              ])
            ).email_verified_at,
          ),
      };
    },
  },
  {
    pair: 'auth.login/success',
    audience: 'merchant',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const before = await sessionsOf(b.owner.identityId);
      const res = await marked(request(app).post('/v1/auth/login'), rid).send({
        email: b.owner.email,
        password: TEST_PASSWORD,
        audience: 'merchant',
      });
      return {
        res,
        expected: ownerActor(b),
        changed: async () => (await sessionsOf(b.owner.identityId)) > before,
      };
    },
  },
  {
    pair: 'auth.login/success',
    audience: 'agent',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const agent = await fx.member(b, 'agent');
      const before = await sessionsOf(agent.identityId);
      const res = await marked(request(app).post('/v1/auth/agent/login'), rid).send({
        email: agent.email,
        password: TEST_PASSWORD,
      });
      return {
        res,
        expected: {
          merchant_id: b.merchantId,
          actor_identity_id: agent.identityId,
          actor_audience: 'agent',
          actor_membership_id: agent.membershipId,
        },
        changed: async () => (await sessionsOf(agent.identityId)) > before,
      };
    },
  },
  {
    pair: 'auth.login/success',
    audience: 'platform (MFA challenge)',
    status: 200,
    run: async (rid) => {
      const admin = await platformPerson({ totp: true });
      const challenges = () =>
        count(`SELECT count(*)::int AS n FROM identity.mfa_challenges WHERE identity_id = $1`, [
          admin.identityId,
        ]);
      const before = await challenges();
      const res = await marked(request(app).post('/v1/auth/login'), rid).send({
        email: admin.email,
        password: TEST_PASSWORD,
        audience: 'platform',
      });
      return {
        res,
        expected: {
          merchant_id: null,
          actor_identity_id: admin.identityId,
          actor_audience: 'platform',
          actor_membership_id: admin.membershipId,
        },
        changed: async () => (await challenges()) > before,
      };
    },
  },
  {
    pair: 'auth.login/success',
    audience: 'merchant (a choice of businesses)',
    status: 409,
    run: async (rid) => {
      const { p } = await twoBusinesses('staff');
      const challenges = () =>
        count(
          `SELECT count(*)::int AS n FROM identity.membership_selection_challenges WHERE identity_id = $1`,
          [p.identityId],
        );
      const before = await challenges();
      const res = await marked(request(app).post('/v1/auth/login'), rid).send({
        email: p.email,
        password: TEST_PASSWORD,
        audience: 'merchant',
      });
      return {
        res,
        expected: {
          merchant_id: null,
          actor_identity_id: p.identityId,
          actor_audience: 'merchant',
          actor_membership_id: null,
        },
        changed: async () => (await challenges()) > before,
      };
    },
  },
  {
    pair: 'auth.login_select/success',
    audience: 'merchant',
    status: 200,
    run: async (rid) => {
      const { p, a, inA } = await twoBusinesses('staff');
      const login = await post('/v1/auth/login').send({
        email: p.email,
        password: TEST_PASSWORD,
        audience: 'merchant',
      });
      const challenge = cookiesOf(login).get(SELECTION_CHALLENGE_COOKIE)!;
      const before = await sessionsOf(p.identityId);
      const res = await marked(request(app).post('/v1/auth/login/select'), rid)
        .set('Cookie', `${SELECTION_CHALLENGE_COOKIE}=${challenge}`)
        .send({ selectionId: inA });
      return {
        res,
        expected: {
          merchant_id: a.merchantId,
          actor_identity_id: p.identityId,
          actor_audience: 'merchant',
          actor_membership_id: inA,
        },
        changed: async () => (await sessionsOf(p.identityId)) > before,
      };
    },
  },
  {
    pair: 'auth.login_select/success',
    audience: 'agent',
    status: 200,
    run: async (rid) => {
      const { p, a, inA } = await twoBusinesses('agent');
      const login = await post('/v1/auth/agent/login').send({ email: p.email, password: TEST_PASSWORD });
      const before = await sessionsOf(p.identityId);
      const res = await marked(request(app).post('/v1/auth/agent/login/select'), rid).send({
        selectionToken: login.body.selectionToken,
        selectionId: inA,
      });
      return {
        res,
        expected: {
          merchant_id: a.merchantId,
          actor_identity_id: p.identityId,
          actor_audience: 'agent',
          actor_membership_id: inA,
        },
        changed: async () => (await sessionsOf(p.identityId)) > before,
      };
    },
  },
  {
    pair: 'auth.refresh/success',
    audience: 'merchant (web)',
    status: 200,
    run: async (rid) => {
      const { b, jar } = await ownerSignedIn();
      const tokens = () =>
        count(
          `SELECT count(*)::int AS n FROM identity.refresh_tokens r JOIN identity.sessions s ON s.id = r.session_id WHERE s.identity_id = $1`,
          [b.owner.identityId],
        );
      const before = await tokens();
      const res = await marked(webPost(jar, '/v1/auth/refresh'), rid).send();
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'session' },
        changed: async () => (await tokens()) > before,
      };
    },
  },
  {
    pair: 'auth.refresh/success',
    audience: 'agent',
    status: 200,
    run: async (rid) => {
      const { b, agent, refreshToken } = await agentSignedIn();
      const tokens = () =>
        count(
          `SELECT count(*)::int AS n FROM identity.refresh_tokens r JOIN identity.sessions s ON s.id = r.session_id WHERE s.identity_id = $1`,
          [agent.identityId],
        );
      const before = await tokens();
      const res = await marked(request(app).post('/v1/auth/agent/refresh'), rid).send({ refreshToken });
      return {
        res,
        expected: {
          merchant_id: b.merchantId,
          actor_identity_id: agent.identityId,
          actor_audience: 'agent',
          actor_membership_id: agent.membershipId,
          target_type: 'session',
        },
        changed: async () => (await tokens()) > before,
      };
    },
  },
  {
    pair: 'auth.refresh_token_reuse/denied',
    status: 401,
    run: async (rid) => {
      const { b, jar } = await ownerSignedIn();
      const rotated = await webPost(jar, '/v1/auth/refresh').set('X-Forwarded-For', clientIp()).send();
      expect(rotated.status).toBe(200);
      const session = await one(
        `SELECT id FROM identity.sessions WHERE identity_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [b.owner.identityId],
      );
      const res = await marked(webPost(jar, '/v1/auth/refresh'), rid).send(); // the spent token again
      return {
        res,
        expected: { actor_identity_id: b.owner.identityId, target_type: 'session', target_id: session.id },
        changed: async () =>
          Boolean(
            (await one(`SELECT revoked_at FROM identity.sessions WHERE id = $1`, [session.id])).revoked_at,
          ),
      };
    },
  },
  {
    pair: 'auth.logout/success',
    status: 204,
    run: async (rid) => {
      const { b, jar } = await ownerSignedIn();
      const session = await one(
        `SELECT id FROM identity.sessions WHERE identity_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [b.owner.identityId],
      );
      const res = await marked(webPost(jar, '/v1/auth/logout'), rid).send();
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'session', target_id: session.id },
        changed: async () =>
          Boolean(
            (await one(`SELECT revoked_at FROM identity.sessions WHERE id = $1`, [session.id])).revoked_at,
          ),
      };
    },
  },
  {
    pair: 'auth.password_change/success',
    status: 204,
    run: async (rid) => {
      const b = await fx.business();
      const staff = await fx.member(b, 'staff');
      const before = await passwordOf(staff.identityId);
      const res = await fx
        .call(staff.token, 'post', '/v1/auth/password/change', {
          currentPassword: TEST_PASSWORD,
          newPassword: NEW_PASSWORD,
        })
        .set('X-Request-ID', rid);
      return {
        res,
        expected: {
          merchant_id: b.merchantId,
          actor_identity_id: staff.identityId,
          actor_audience: 'merchant',
          actor_membership_id: staff.membershipId,
        },
        changed: async () => (await passwordOf(staff.identityId)) !== before,
      };
    },
  },
  {
    pair: 'auth.password_reset/success',
    status: 204,
    run: async (rid) => {
      const p = await person('reset');
      const token = newOpaqueToken();
      await auth.identity.issueOneTimeToken(p.identityId, 'password_reset', token.hash, 1800, null);
      const before = await passwordOf(p.identityId);
      const res = await marked(request(app).post('/v1/auth/password/reset'), rid).send({
        token: token.raw,
        password: NEW_PASSWORD,
      });
      return {
        res,
        expected: { actor_identity_id: p.identityId },
        changed: async () => (await passwordOf(p.identityId)) !== before,
      };
    },
  },
  {
    pair: 'auth.account_setup/success',
    status: 204,
    run: async (rid) => {
      const row = await one(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
        uniqueEmail('setup'),
      ]);
      const token = newOpaqueToken();
      await auth.identity.issueOneTimeToken(row.id, 'account_setup', token.hash, 86400, null);
      const res = await marked(request(app).post('/v1/auth/password/setup'), rid).send({
        token: token.raw,
        password: NEW_PASSWORD,
      });
      return {
        res,
        expected: { actor_identity_id: row.id },
        changed: async () => (await passwordOf(row.id)) !== null,
      };
    },
  },
  {
    pair: 'auth.mfa_enrollment_started/success',
    status: 200,
    run: async (rid) => {
      const admin = await enrolling();
      const res = await marked(webPost(admin.jar, '/v1/auth/mfa/totp/enrollment'), rid).send();
      return {
        res,
        expected: {
          actor_identity_id: admin.identityId,
          actor_audience: 'platform',
          actor_membership_id: admin.membershipId,
        },
        changed: async () =>
          (await count(`SELECT count(*)::int AS n FROM identity.totp_credentials WHERE identity_id = $1`, [
            admin.identityId,
          ])) > 0,
      };
    },
  },
  {
    pair: 'auth.mfa_enrollment_confirmed/success',
    status: 200,
    run: async (rid) => {
      const admin = await enrolling();
      const begin = await webPost(admin.jar, '/v1/auth/mfa/totp/enrollment')
        .set('X-Forwarded-For', clientIp())
        .send();
      const secret = base32Decode(TotpEnrollment.parse(begin.body).secret);
      const res = await marked(webPost(admin.jar, '/v1/auth/mfa/totp/confirm'), rid).send({
        code: totpCode(secret, totpStep()),
      });
      return {
        res,
        expected: {
          actor_identity_id: admin.identityId,
          actor_audience: 'platform',
          actor_membership_id: admin.membershipId,
        },
        changed: async () =>
          Boolean(
            (
              await one(`SELECT confirmed_at FROM identity.totp_credentials WHERE identity_id = $1`, [
                admin.identityId,
              ])
            ).confirmed_at,
          ),
      };
    },
  },
  {
    pair: 'auth.mfa_verify/success',
    status: 200,
    run: async (rid) => {
      const admin = await enrolling();
      const begin = await webPost(admin.jar, '/v1/auth/mfa/totp/enrollment')
        .set('X-Forwarded-For', clientIp())
        .send();
      const secret = base32Decode(TotpEnrollment.parse(begin.body).secret);
      const confirm = await webPost(admin.jar, '/v1/auth/mfa/totp/confirm')
        .set('X-Forwarded-For', clientIp())
        .send({ code: totpCode(secret, totpStep()) });
      expect(confirm.status).toBe(200);
      const login = await post('/v1/auth/login').send({
        email: admin.email,
        password: TEST_PASSWORD,
        audience: 'platform',
      });
      const challenge = cookiesOf(login).get(MFA_CHALLENGE_COOKIE)!;
      const before = await sessionsOf(admin.identityId);
      const res = await marked(request(app).post('/v1/auth/mfa/verify'), rid)
        .set('Cookie', `${MFA_CHALLENGE_COOKIE}=${challenge}`)
        .send({ code: totpCode(secret, totpStep() + 1) });
      return {
        res,
        expected: {
          actor_identity_id: admin.identityId,
          actor_audience: 'platform',
          actor_membership_id: admin.membershipId,
        },
        changed: async () => (await sessionsOf(admin.identityId)) > before,
      };
    },
  },
  // ── pattern A, written by admission (P5.5 step 5); the setup path: nested-writers.test.ts ──────────
  {
    pair: 'auth.invitation_accepted/success',
    status: 204,
    run: async (rid) => {
      const b = await fx.business();
      const p = await person('invitee');
      const issued = await fx.call(b.owner.token, 'post', '/v1/merchant/invitations', {
        email: p.email,
        kind: 'agent',
      });
      expect(issued.status).toBe(201);
      const message = () => email.to(p.email).filter((m) => m.template === 'invitation_accept');
      await vi.waitFor(() => expect(message().length).toBeGreaterThanOrEqual(1));
      const token = new RegExp(`^${TEST_WEB_APP_URL}/accept-invitation#token=([A-Za-z0-9_-]{43})$`, 'm').exec(
        message().at(-1)!.text,
      )![1]!;
      const res = await marked(request(app).post('/v1/auth/invitations/accept'), rid).send({
        token,
        email: p.email,
        password: TEST_PASSWORD,
      });
      const membership = () =>
        one(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1 AND merchant_id = $2`, [
          p.identityId,
          b.merchantId,
        ]);
      const joined = await membership();
      return {
        res,
        expected: {
          merchant_id: b.merchantId,
          actor_identity_id: p.identityId,
          actor_membership_id: joined?.id ?? null,
          target_type: 'invitation',
          target_id: issued.body.invitationId,
        },
        changed: async () => Boolean(await membership()),
      };
    },
  },
  {
    pair: 'merchant.profile_updated/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const res = await asOwner(b, 'patch', '/v1/merchant/profile', rid, { name: 'Renamed Coverage Ltd' });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'merchant', target_id: b.merchantId },
        changed: async () =>
          (await one(`SELECT name FROM tenancy.merchants WHERE id = $1`, [b.merchantId])).name ===
          'Renamed Coverage Ltd',
      };
    },
  },
  ...(['branch', 'role'] as const).flatMap((item): Case[] => {
    const table = item === 'branch' ? 'branches' : 'roles';
    const idOf = (b: Awaited<ReturnType<typeof fx.business>>) => (item === 'branch' ? b.branchId : b.roleId);
    return [
      {
        pair: `merchant.${item}_created/success`,
        status: 201,
        run: async (rid) => {
          const b = await fx.business();
          const name = `New ${item} ${randomBytes(3).toString('hex')}`;
          const res = await asOwner(b, 'post', `/v1/merchant/${table}`, rid, { name });
          return {
            res,
            expected: { ...ownerActor(b), target_type: item, target_id: res.body[`${item}Id`] ?? null },
            changed: async () =>
              (await count(
                `SELECT count(*)::int AS n FROM tenancy.${table} WHERE merchant_id = $1 AND name = $2`,
                [b.merchantId, name],
              )) > 0,
          };
        },
      },
      {
        pair: `merchant.${item}_updated/success`,
        status: 200,
        run: async (rid) => {
          const b = await fx.business();
          const name = `Renamed ${item} ${randomBytes(3).toString('hex')}`;
          const res = await asOwner(b, 'patch', `/v1/merchant/${table}/${idOf(b)}`, rid, { name });
          return {
            res,
            expected: { ...ownerActor(b), target_type: item, target_id: idOf(b) },
            changed: async () =>
              (await one(`SELECT name FROM tenancy.${table} WHERE id = $1`, [idOf(b)])).name === name,
          };
        },
      },
    ];
  }),
  {
    pair: 'merchant.role_permissions_set/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const res = await asOwner(b, 'put', `/v1/merchant/roles/${b.roleId}/permissions`, rid, {
        permissions: ['merchant.branches.read'],
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'role', target_id: b.roleId },
        changed: async () =>
          (await count(`SELECT count(*)::int AS n FROM tenancy.role_permissions WHERE role_id = $1`, [
            b.roleId,
          ])) === 1,
      };
    },
  },
  {
    pair: 'merchant.member_assigned/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const staff = await fx.member(b, 'staff');
      const role = await one(
        `INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Supervisor') RETURNING id`,
        [b.merchantId],
      );
      const res = await asOwner(b, 'post', `/v1/merchant/members/${staff.membershipId}/assignment`, rid, {
        roleId: role.id,
        branchId: null,
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'membership', target_id: staff.membershipId },
        changed: async () =>
          (await one(`SELECT role_id FROM tenancy.merchant_memberships WHERE id = $1`, [staff.membershipId]))
            .role_id === role.id,
      };
    },
  },
  ...(['deactivate', 'reactivate'] as const).map((action): Case => ({
    pair: `merchant.member_${action}d/success`,
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const staff = await fx.member(b, 'staff');
      if (action === 'reactivate') {
        await owner.query(
          `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
          [staff.membershipId],
        );
      }
      const res = await asOwner(b, 'post', `/v1/merchant/members/${staff.membershipId}/${action}`, rid);
      const want = action === 'deactivate' ? 'deactivated' : 'active';
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'membership', target_id: staff.membershipId },
        changed: async () =>
          (await one(`SELECT status FROM tenancy.merchant_memberships WHERE id = $1`, [staff.membershipId]))
            .status === want,
      };
    },
  })),
  {
    pair: 'merchant.invitation_issued/success',
    status: 201,
    run: async (rid) => {
      const b = await fx.business();
      const address = uniqueEmail('invited');
      const res = await asOwner(b, 'post', '/v1/merchant/invitations', rid, {
        email: address,
        kind: 'agent',
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'invitation', target_id: res.body.invitationId ?? null },
        changed: async () =>
          (await count(
            `SELECT count(*)::int AS n FROM tenancy.invitations WHERE merchant_id = $1 AND email = $2`,
            [b.merchantId, address],
          )) > 0,
      };
    },
  },
  {
    pair: 'merchant.invitation_revoked/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const issued = await fx.call(b.owner.token, 'post', '/v1/merchant/invitations', {
        email: uniqueEmail('revoked'),
        kind: 'agent',
      });
      const id = issued.body.invitationId as string;
      const res = await asOwner(b, 'post', `/v1/merchant/invitations/${id}/revoke`, rid);
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'invitation', target_id: id },
        changed: async () =>
          Boolean((await one(`SELECT revoked_at FROM tenancy.invitations WHERE id = $1`, [id])).revoked_at),
      };
    },
  },
  ...(['deactivate', 'reactivate'] as const).map((action): Case => ({
    pair: `platform.merchant_${action}d/success`,
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const admin = await fx.platformAdmin();
      if (action === 'reactivate') {
        await owner.query(
          `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'coverage' WHERE id = $1`,
          [b.merchantId],
        );
      }
      const res = await fx
        .call(
          admin.token,
          'post',
          `/v1/platform/merchants/${b.merchantId}/${action}`,
          action === 'deactivate' ? { reason: 'coverage' } : undefined,
        )
        .set('X-Request-ID', rid);
      const want = action === 'deactivate' ? 'deactivated' : 'active';
      return {
        res,
        expected: {
          merchant_id: b.merchantId,
          actor_identity_id: admin.identityId,
          actor_audience: 'platform',
          actor_membership_id: admin.membershipId,
          target_type: 'merchant',
          target_id: b.merchantId,
        },
        changed: async () =>
          (await one(`SELECT status FROM tenancy.merchants WHERE id = $1`, [b.merchantId])).status === want,
      };
    },
  })),
  {
    pair: 'platform.ownership_transferred/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const staff = await fx.member(b, 'staff');
      const admin = await fx.platformAdmin();
      const res = await fx
        .call(admin.token, 'post', `/v1/platform/merchants/${b.merchantId}/transfer-ownership`, {
          newOwnerMembershipId: staff.membershipId,
          formerOwnerRoleId: b.roleId,
          deactivateFormerOwner: false,
        })
        .set('X-Request-ID', rid);
      return {
        res,
        expected: {
          merchant_id: b.merchantId,
          actor_identity_id: admin.identityId,
          actor_audience: 'platform',
          actor_membership_id: admin.membershipId,
          target_type: 'merchant',
          target_id: b.merchantId,
        },
        changed: async () =>
          (await one(`SELECT kind FROM tenancy.merchant_memberships WHERE id = $1`, [staff.membershipId]))
            .kind === 'owner',
      };
    },
  },
  // P5.7: the platform team (#30, #31, #32, #37) — the super admin's changes, each recorded by its function
  {
    pair: 'platform.staff_created/success',
    status: 201,
    run: async (rid) => {
      const admin = await fx.platformAdmin();
      const staffEmail = uniqueEmail('cov-staff');
      const res = await fx
        .call(admin.token, 'post', '/v1/platform/staff', { email: staffEmail, role: 'support' })
        .set('X-Request-ID', rid);
      return {
        res,
        expected: {
          merchant_id: null,
          actor_identity_id: admin.identityId,
          actor_audience: 'platform',
          actor_membership_id: admin.membershipId,
          target_type: 'platform_membership',
          target_id: res.body.platformMembershipId,
        },
        changed: async () =>
          (await count(`SELECT count(*)::int AS n FROM identity.identities WHERE email = $1`, [
            staffEmail,
          ])) === 1,
      };
    },
  },
  ...(['deactivate', 'reactivate'] as const).map((action): Case => ({
    pair: `platform.staff_${action}d/success`,
    status: 200,
    run: async (rid) => {
      const admin = await fx.platformAdmin();
      const member = await fx.platformAdmin('support');
      if (action === 'reactivate') {
        await owner.query(
          `UPDATE identity.platform_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
          [member.membershipId],
        );
      }
      const res = await fx
        .call(admin.token, 'post', `/v1/platform/staff/${member.membershipId}/${action}`)
        .set('X-Request-ID', rid);
      const want = action === 'deactivate' ? 'deactivated' : 'active';
      return {
        res,
        expected: {
          merchant_id: null,
          actor_identity_id: admin.identityId,
          actor_audience: 'platform',
          actor_membership_id: admin.membershipId,
          target_type: 'platform_membership',
          target_id: member.membershipId,
        },
        changed: async () =>
          (await one(`SELECT status FROM identity.platform_memberships WHERE id = $1`, [member.membershipId]))
            .status === want,
      };
    },
  })),
  {
    pair: 'platform.grants_set/success',
    status: 200,
    run: async (rid) => {
      const admin = await fx.platformAdmin();
      const member = await fx.platformAdmin('support');
      const res = await fx
        .call(admin.token, 'put', `/v1/platform/staff/${member.membershipId}/permissions`, {
          permissions: ['platform.merchants.read'],
        })
        .set('X-Request-ID', rid);
      return {
        res,
        expected: {
          merchant_id: null,
          actor_identity_id: admin.identityId,
          actor_audience: 'platform',
          actor_membership_id: admin.membershipId,
          target_type: 'platform_membership',
          target_id: member.membershipId,
        },
        changed: async () =>
          (await count(
            `SELECT count(*)::int AS n FROM identity.platform_membership_grants WHERE platform_membership_id = $1`,
            [member.membershipId],
          )) === 1,
      };
    },
  },
  // P6: the ledger's commands (pattern A: ledger.create_account, post_manual_entry, reverse_entry)
  {
    pair: 'ledger.account_created/success',
    status: 201,
    run: async (rid) => {
      const b = await fx.business();
      const code = `9${String(randomBytes(3).readUIntBE(0, 3) % 100000).padStart(5, '0')}`;
      const res = await asOwner(b, 'post', '/v1/merchant/ledger/accounts', rid, {
        code,
        name: 'Coverage account',
        type: 'expense',
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'ledger_account', target_id: res.body.accountId ?? null },
        changed: async () =>
          (await count(
            `SELECT count(*)::int AS n FROM ledger.accounts WHERE merchant_id = $1 AND code = $2`,
            [b.merchantId, code],
          )) === 1,
      };
    },
  },
  {
    pair: 'ledger.account_updated/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const code = `9${String(randomBytes(3).readUIntBE(0, 3) % 100000).padStart(5, '0')}`;
      const created = await asOwner(b, 'post', '/v1/merchant/ledger/accounts', markerRequestId('cov-setup'), {
        code,
        name: 'Coverage account',
        type: 'expense',
      });
      const accountId = created.body.accountId as string;
      const res = await asOwner(b, 'patch', `/v1/merchant/ledger/accounts/${accountId}`, rid, {
        name: 'Renamed coverage account',
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'ledger_account', target_id: accountId },
        changed: async () =>
          (await one(`SELECT name FROM ledger.accounts WHERE id = $1`, [accountId])).name ===
          'Renamed coverage account',
      };
    },
  },
  ...(['posted', 'reversed'] as const).map((step): Case => ({
    pair: step === 'posted' ? 'ledger.manual_entry_posted/success' : 'ledger.entry_reversed/success',
    status: 201,
    run: async (rid) => {
      const b = await fx.business();
      const l = await ledgerResources(owner, b.merchantId);
      const entry = (r: string) =>
        asOwner(b, 'post', '/v1/merchant/ledger/entries', r, ledgerBodies.postJournalEntry(l)).set(
          'Idempotency-Key',
          `cov-${randomBytes(8).toString('hex')}`,
        );
      const manual = step === 'reversed' ? (await entry(markerRequestId('cov-setup'))).body.entryId : null;
      const res =
        step === 'posted'
          ? await entry(rid)
          : await asOwner(b, 'post', `/v1/merchant/ledger/entries/${manual}/reversal`, rid, {}).set(
              'Idempotency-Key',
              `cov-${randomBytes(8).toString('hex')}`,
            );
      return {
        res,
        expected: {
          ...ownerActor(b),
          target_type: 'ledger_entry',
          target_id: step === 'posted' ? (res.body.entryId ?? null) : manual,
        },
        changed: async () =>
          step === 'posted'
            ? (await count(
                `SELECT count(*)::int AS n FROM ledger.journal_entries WHERE merchant_id = $1 AND entry_type = 'manual'`,
                [b.merchantId],
              )) === 1
            : (await count(
                `SELECT count(*)::int AS n FROM ledger.journal_entries WHERE reverses_entry_id = $1`,
                [manual],
              )) === 1,
      };
    },
  })),
  // P7: the customers' commands (pattern A: each its own customers.* function)
  {
    pair: 'customer.created/success',
    status: 201,
    run: async (rid) => {
      const b = await fx.business();
      const phone = uniquePhone();
      const res = await asOwner(b, 'post', '/v1/merchant/customers', rid, {
        branchId: b.branchId,
        fullName: 'Coverage customer',
        phone,
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'customer', target_id: res.body.customerId ?? null },
        changed: async () =>
          (await count(
            `SELECT count(*)::int AS n FROM customers.customers WHERE merchant_id = $1 AND phone = $2`,
            [b.merchantId, phone],
          )) === 1,
      };
    },
  },
  {
    pair: 'customer.updated/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const customerId = await customerOf(owner, b.merchantId, b.branchId);
      const res = await asOwner(b, 'patch', `/v1/merchant/customers/${customerId}`, rid, {
        nickname: 'Covered',
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'customer', target_id: customerId },
        changed: async () =>
          (await one(`SELECT nickname FROM customers.customers WHERE id = $1`, [customerId])).nickname ===
          'Covered',
      };
    },
  },
  ...(['deactivated', 'reactivated'] as const).map((step): Case => ({
    pair: `customer.${step}/success`,
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const customerId = await customerOf(owner, b.merchantId, b.branchId);
      if (step === 'reactivated')
        await owner.query(
          `UPDATE customers.customers SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
          [customerId],
        );
      const action = step === 'deactivated' ? 'deactivate' : 'reactivate';
      const res = await asOwner(b, 'post', `/v1/merchant/customers/${customerId}/${action}`, rid);
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'customer', target_id: customerId },
        changed: async () =>
          (await one(`SELECT status FROM customers.customers WHERE id = $1`, [customerId])).status ===
          (step === 'deactivated' ? 'deactivated' : 'active'),
      };
    },
  })),
  {
    pair: 'customer.agent_assigned/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const agent = await fx.member(b, 'agent');
      const customerId = await customerOf(owner, b.merchantId, b.branchId);
      const res = await asOwner(b, 'put', `/v1/merchant/customers/${customerId}/agent`, rid, {
        agentMembershipId: agent.membershipId,
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'customer', target_id: customerId },
        changed: async () =>
          (await count(
            `SELECT count(*)::int AS n FROM customers.assignments WHERE customer_id = $1 AND ended_at IS NULL`,
            [customerId],
          )) === 1,
      };
    },
  },
  {
    pair: 'customer.app_invited/success',
    status: 202,
    run: async (rid) => {
      const b = await fx.business();
      const customerId = await customerOf(owner, b.merchantId, b.branchId);
      await owner.query(`UPDATE customers.customers SET email = $2 WHERE id = $1`, [
        customerId,
        uniqueEmail('cov-saver'),
      ]);
      const res = await asOwner(b, 'post', `/v1/merchant/customers/${customerId}/app-invitation`, rid);
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'customer', target_id: customerId },
        changed: async () =>
          (await count(`SELECT count(*)::int AS n FROM customers.app_invitations WHERE customer_id = $1`, [
            customerId,
          ])) === 1,
      };
    },
  },
  {
    pair: 'customer.app_access_accepted/success',
    status: 204,
    run: async (rid) => {
      const b = await fx.business();
      const customerId = await customerOf(owner, b.merchantId, b.branchId);
      const address = uniqueEmail('cov-accept');
      await owner.query(`UPDATE customers.customers SET email = $2 WHERE id = $1`, [customerId, address]);
      const token = newOpaqueToken();
      const issued = await owner.query(
        `SELECT outcome FROM customers.issue_app_invitation($1, $2, $3, 3600, NULL, NULL, NULL)`,
        [b.owner.sessionId, customerId, token.hash],
      );
      expect(issued.rows[0].outcome).toBe('ok');
      const identityId = (await one(`SELECT id FROM identity.identities WHERE email = $1`, [address])).id;
      const res = await marked(request(app).post('/v1/auth/customer/invitation/accept'), rid).send({
        token: token.raw,
        email: address,
        password: NEW_PASSWORD,
      });
      return {
        res,
        expected: {
          merchant_id: b.merchantId,
          actor_identity_id: identityId,
          actor_audience: null,
          actor_membership_id: null,
          target_type: 'customer',
          target_id: customerId,
        },
        changed: async () =>
          (await one(`SELECT identity_id FROM customers.customers WHERE id = $1`, [customerId]))
            .identity_id === identityId,
      };
    },
  },
  {
    pair: 'customer.anonymised/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const customerId = await customerOf(owner, b.merchantId, b.branchId);
      const res = await asOwner(b, 'post', `/v1/merchant/customers/${customerId}/anonymisation`, rid);
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'customer', target_id: customerId },
        changed: async () =>
          (await one(`SELECT status FROM customers.customers WHERE id = $1`, [customerId])).status ===
          'anonymised',
      };
    },
  },
  // ── savings (P8): pattern A, each command's definer function ─────────────────────────────────
  {
    pair: 'savings.package_created/success',
    status: 201,
    run: async (rid) => {
      const b = await fx.business();
      const name = `Cover ${randomBytes(3).toString('hex')}`;
      const res = await asOwner(b, 'post', '/v1/merchant/packages', rid, {
        name,
        kind: 'fixed',
        amountMinor: '100000',
        feeRule: 'first_contribution',
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'savings_package', target_id: res.body.packageId ?? null },
        changed: async () =>
          (await count(`SELECT count(*) AS n FROM savings.packages WHERE merchant_id = $1 AND name = $2`, [
            b.merchantId,
            name,
          ])) === 1,
      };
    },
  },
  {
    pair: 'savings.package_updated/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const s = await savingsResources(owner, b.merchantId, b.branchId, b.owner.sessionId);
      const res = await asOwner(b, 'patch', `/v1/merchant/packages/${s.packageId}`, rid, { name: 'Renamed' });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'savings_package', target_id: s.packageId },
        changed: async () =>
          (await one(`SELECT name FROM savings.packages WHERE id = $1`, [s.packageId])).name === 'Renamed',
      };
    },
  },
  {
    pair: 'savings.customer_enrolled/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const s = await savingsResources(owner, b.merchantId, b.branchId, b.owner.sessionId);
      const customerId = await customerOf(owner, b.merchantId, b.branchId);
      const res = await asOwner(b, 'put', `/v1/merchant/customers/${customerId}/enrolment`, rid, {
        packageId: s.packageId,
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'customer', target_id: customerId },
        changed: async () =>
          (await count(`SELECT count(*) AS n FROM savings.enrolments WHERE customer_id = $1`, [
            customerId,
          ])) === 1,
      };
    },
  },
  {
    pair: 'savings.collection_recorded/success',
    audience: 'agent',
    status: 201,
    run: async (rid) => {
      const b = await fx.business();
      const agent = await fx.member(b, 'agent');
      const s = await savingsResources(owner, b.merchantId, b.branchId, b.owner.sessionId, agent);
      const res = await marked(request(app).post('/v1/agent/collections'), rid)
        .set('Authorization', `Bearer ${agent.token}`)
        .set('Idempotency-Key', `cover-${randomBytes(8).toString('hex')}`)
        .send({ customerId: s.customerId, amountMinor: '100000' });
      return {
        res,
        expected: {
          merchant_id: b.merchantId,
          actor_identity_id: agent.identityId,
          actor_audience: 'agent',
          actor_membership_id: agent.membershipId,
          target_type: 'savings_collection',
          target_id: res.body.collectionId ?? null,
        },
        changed: async () =>
          (await count(`SELECT count(*) AS n FROM savings.collections WHERE customer_id = $1`, [
            s.customerId,
          ])) === 3,
      };
    },
  },
  {
    pair: 'savings.collection_cancelled/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const s = await savingsResources(owner, b.merchantId, b.branchId, b.owner.sessionId);
      const res = await asOwner(b, 'post', `/v1/merchant/collections/${s.collectionId}/cancellation`, rid, {
        reason: 'Recorded twice',
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'savings_collection', target_id: s.collectionId },
        changed: async () =>
          (await one(`SELECT status FROM savings.collections WHERE id = $1`, [s.collectionId])).status ===
          'cancelled',
      };
    },
  },
  {
    pair: 'savings.remittance_approved/success',
    status: 201,
    run: async (rid) => {
      const b = await fx.business();
      const s = await savingsResources(owner, b.merchantId, b.branchId, b.owner.sessionId);
      const res = await asOwner(b, 'post', '/v1/merchant/remittances', rid, {
        agentMembershipId: s.agentMembershipId,
        collectionIds: [s.remittedId],
        cashMinor: '100000',
      });
      return {
        res,
        expected: {
          ...ownerActor(b),
          target_type: 'savings_remittance',
          target_id: res.body.remittanceId ?? null,
        },
        changed: async () =>
          (await one(`SELECT status FROM savings.collections WHERE id = $1`, [s.remittedId])).status ===
          'approved',
      };
    },
  },
  {
    pair: 'savings.money_moved/success',
    status: 201,
    run: async (rid) => {
      const b = await fx.business();
      const s = await savingsResources(owner, b.merchantId, b.branchId, b.owner.sessionId);
      // Both approved: the first is the cycle's fee, the second the customer's savings.
      await owner.query(`SELECT * FROM savings.approve_remittance($1, $2, $3, 200000)`, [
        b.owner.sessionId,
        s.agentMembershipId,
        [s.collectionId, s.remittedId],
      ]);
      const res = await asOwner(b, 'post', `/v1/merchant/customers/${s.customerId}/withdrawals`, rid, {
        wallet: 'savings',
        amountMinor: '1000',
      }).set('Idempotency-Key', `cover-${randomBytes(8).toString('hex')}`);
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'customer', target_id: s.customerId },
        changed: async () =>
          (await count(`SELECT count(*) AS n FROM savings.movements WHERE customer_id = $1`, [
            s.customerId,
          ])) === 1,
      };
    },
  },
  {
    pair: 'savings.target_goal_set/success',
    status: 200,
    run: async (rid) => {
      const b = await fx.business();
      const customerId = await customerOf(owner, b.merchantId, b.branchId);
      const res = await asOwner(b, 'put', `/v1/merchant/customers/${customerId}/target-goal`, rid, {
        goalAmountMinor: '500000',
        goalDate: null,
      });
      return {
        res,
        expected: { ...ownerActor(b), target_type: 'customer', target_id: customerId },
        changed: async () =>
          (await count(`SELECT count(*) AS n FROM savings.target_goals WHERE customer_id = $1`, [
            customerId,
          ])) === 1,
      };
    },
  },
];

/** The atomic pairs this file covers. */
const COVERED_PAIRS = [...new Set(CASES.map((c) => c.pair))];
/** Atomic pairs written in SQL outside any API route (operator functions): their tagged tests are in packages/db. */
const DATABASE_COVERED = [
  'platform.super_admin_bootstrapped/success',
  'platform.authorization_containment_set/success', // P5.5 step 6: containment.test.ts (db)
  'platform.audit_purged/success',
  'platform.request_metadata_cleared/success',
  'platform.purge_report_delivered/success',
  'platform.purge_report_requested/success',
  'platform.purge_report_lost/success',
  'platform.purge_report_copy_destroyed/success',
  'platform.purge_export_discarded/success',
  'platform.purge_report_confirmed/success',
  'platform.purge_report_handed_over/success',
  'platform.purge_report_request_cancelled/success',
  'platform.purge_report_handover_abandoned/success',
  'platform.purge_report_handover_failed/success',
  // P6: written by the posting function for any posting, the session's or a domain's (ledger.test.ts, db)
  'ledger.capital_debited/success',
  'ledger.income_debited/success',
];

describe('the coverage guard: every atomic pair has its two tests', () => {
  it('R32 (4): every pair of the former transitional list has its co-commit and injected-rollback tests here', () => {
    expect(FORMER_TRANSITIONAL_PAIRS.filter((pair) => !COVERED_PAIRS.includes(pair))).toEqual([]);
  });

  it('this file covers every atomic pair the API writes, and packages/db the operator ones', () => {
    const atomic = AUDIT_CATALOG.filter((e) => e.class === 'atomic').map(
      (e) => `${e.identifier}/${e.outcome}`,
    );
    expect([...COVERED_PAIRS, ...DATABASE_COVERED].sort()).toEqual(atomic.sort());
  });

  it('the operator pairs are tagged in packages/db — the co-commit test and the injected-rollback test', () => {
    const dir = new URL('../../../../packages/db/test/', import.meta.url);
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => readFileSync(new URL(f, dir), 'utf8'))
      .join('\n');
    for (const pair of DATABASE_COVERED) {
      expect(sources.split(`[coverage ${pair}]`).length - 1, pair).toBe(2);
    }
  });
});

describe.each(CASES)('$pair $audience', (c) => {
  const [action, outcome] = c.pair.split('/') as [string, string];

  it(`[coverage ${c.pair}] one row of the pair, with its actor, business, target and request id, commits with the change`, async () => {
    const rid = markerRequestId('cov');
    const { res, expected, changed } = await c.run(rid);
    expect(res.status, JSON.stringify(res.body)).toBe(c.status);
    const rows = (await auditRows(owner, rid)).filter((r) => r.action === action && r.outcome === outcome);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...expected, request_id: rid });
    expect(await changed()).toBe(true);
  });

  it(`[coverage ${c.pair}] with that pair's insert failing, the request fails and the change is absent`, async () => {
    const rid = markerRequestId('cov-fail');
    const restore = await failAuditInsert(owner, action, outcome, rid);
    try {
      const { res, changed } = await c.run(rid);
      expect(res.status).toBe(500);
      expect(await changed()).toBe(false);
    } finally {
      await restore();
    }
    expect((await auditRows(owner, rid)).filter((r) => r.action === action && r.outcome === outcome)).toEqual(
      [],
    );
  });
});
