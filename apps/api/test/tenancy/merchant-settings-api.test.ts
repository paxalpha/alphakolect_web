import { randomBytes } from 'node:crypto';
import {
  AUTH_COOKIES,
  Branch,
  BranchList,
  CSRF_HEADER,
  CurrentMembership,
  MerchantProfile,
  PERMISSIONS,
  Role,
  RoleList,
} from '@alphakolect/contracts';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { SessionAudience } from '../../src/modules/identity/access-tokens.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { newOpaqueToken } from '../../src/modules/identity/tokens.js';
import { createTestApp, TEST_WEB_ORIGIN } from '../support/app.js';

// P4.4 through the real app and database: the caller's membership, the business profile, branches and roles
// (ADR-15 T3, T5, T7â€“T9, T14, T15). The tenant is only ever the session's; another merchant's items are 404 exactly
// like missing ones; staff are refused management (403) and see their own membership change on the next request.

const { app, auth } = await createTestApp();
const repo = auth.identity;
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
beforeAll(() => owner.connect());
afterAll(() => owner.end());

const CSRF = 'csrf-token-for-the-test';
const uniqueEmail = (tag: string) => `${tag}-${randomBytes(5).toString('hex')}@example.test`;

async function sessionToken(identityId: string, audience: SessionAudience, membershipId: string) {
  const s = await repo.createSession({
    identityId,
    audience,
    membershipId,
    scope: 'full',
    refreshHash: newOpaqueToken().hash,
    lifetime:
      audience === 'platform'
        ? { idleSeconds: 3600, absoluteSeconds: 43200 }
        : { idleSeconds: 86400, absoluteSeconds: 1209600 },
    ip: null,
    userAgent: null,
  });
  return auth.accessTokens.sign({ sub: identityId, sid: s.session_id, aud: audience, mid: membershipId });
}

/** An active merchant (signup + email verification) and its owner's merchant session. */
async function merchant(name: string) {
  const signup = await repo.signupMerchantOwner(
    uniqueEmail('owner'),
    await hashPassword('x'.repeat(16)),
    name,
  );
  const t = newOpaqueToken();
  await repo.issueOneTimeToken(signup.identity_id!, 'email_verification', t.hash, 3600, null);
  await repo.verifyEmail(t.hash);
  const {
    rows: [m],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    signup.identity_id,
  ]);
  return {
    merchantId: signup.merchant_id!,
    membershipId: m.id as string,
    token: await sessionToken(signup.identity_id!, 'merchant', m.id),
  };
}

/** A member of `merchantId` of the given kind (staff get a role), with a session of the right audience. */
async function member(merchantId: string, kind: 'staff' | 'agent') {
  const {
    rows: [identity],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
    [uniqueEmail(kind)],
  );
  let roleId: string | null = null;
  if (kind === 'staff') {
    const { rows } = await owner.query(
      `INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`,
      [merchantId, `Role ${randomBytes(3).toString('hex')}`],
    );
    roleId = rows[0].id;
  }
  const {
    rows: [m],
  } = await owner.query(
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [merchantId, identity.id, kind, roleId],
  );
  const audience = kind === 'agent' ? 'agent' : 'merchant';
  return { membershipId: m.id as string, roleId, token: await sessionToken(identity.id, audience, m.id) };
}

/** A request as the web app makes it: cookie session, plus Origin and CSRF header for state changes. */
function call(token: string, method: 'get' | 'post' | 'patch', path: string, body?: object) {
  const client = request(app);
  const req = client[method](path).set(
    'Cookie',
    `${AUTH_COOKIES.access}=${token}; ${AUTH_COOKIES.csrf}=${CSRF}`,
  );
  if (method !== 'get') req.set('Origin', TEST_WEB_ORIGIN).set(CSRF_HEADER, CSRF);
  return body ? req.send(body) : req.send();
}

const auditFor = async (res: request.Response) =>
  (
    await owner.query(
      `SELECT action, outcome, merchant_id, target_type, target_id, summary FROM audit.audit_events WHERE request_id = $1`,
      [res.headers['x-request-id']],
    )
  ).rows;

const expectError = (res: request.Response, status: number, code: string) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
};

let a: Awaited<ReturnType<typeof merchant>>;
let b: Awaited<ReturnType<typeof merchant>>;
beforeAll(async () => {
  a = await merchant('Alpha Savings');
  b = await merchant('Beta Savings');
});

describe('the callerâ€™s membership', () => {
  it('the owner sees their membership and business', async () => {
    const res = await call(a.token, 'get', '/v1/merchant/membership');
    expect(res.status).toBe(200);
    expect(CurrentMembership.parse(res.body)).toEqual({
      membershipId: a.membershipId,
      kind: 'owner',
      roleId: null,
      branchId: null,
      merchant: { merchantId: a.merchantId, name: 'Alpha Savings', status: 'active' },
      // P5.4: the owner's fixed set — every merchant permission, sorted.
      permissions: PERMISSIONS.filter((p) => p.startsWith('merchant.')).sort(),
    });
  });

  it('staff see theirs â€” and a role or branch change shows on the very next request (T5)', async () => {
    const staff = await member(a.merchantId, 'staff');
    const first = await call(staff.token, 'get', '/v1/merchant/membership');
    expect(first.body).toMatchObject({
      kind: 'staff',
      roleId: staff.roleId,
      branchId: null,
      permissions: [],
    });

    const {
      rows: [branch],
    } = await owner.query(
      `INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, 'Yaba') RETURNING id`,
      [a.merchantId],
    );
    await owner.query(`UPDATE tenancy.merchant_memberships SET branch_id = $2 WHERE id = $1`, [
      staff.membershipId,
      branch.id,
    ]);
    expect((await call(staff.token, 'get', '/v1/merchant/membership')).body.branchId).toBe(branch.id);

    await owner.query(
      `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [staff.membershipId],
    );
    expectError(await call(staff.token, 'get', '/v1/merchant/membership'), 401, 'UNAUTHENTICATED');
  });
});

describe('the business profile (owner)', () => {
  it('reads and renames â€” the rename audited in the same request', async () => {
    const m = await merchant('Gamma Savings');
    const read = await call(m.token, 'get', '/v1/merchant/profile');
    expect(MerchantProfile.parse(read.body)).toEqual({
      merchantId: m.merchantId,
      name: 'Gamma Savings',
      status: 'active',
    });

    const res = await call(m.token, 'patch', '/v1/merchant/profile', { name: '  Gamma Thrift  ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ merchantId: m.merchantId, name: 'Gamma Thrift', status: 'active' });
    expect(await auditFor(res)).toEqual([
      {
        action: 'merchant.profile_updated',
        outcome: 'success',
        merchant_id: m.merchantId,
        target_type: 'merchant',
        target_id: m.merchantId,
        summary: { name: 'Gamma Thrift' },
      },
    ]);
  });

  it('refuses a blank or overlong name', async () => {
    expectError(
      await call(a.token, 'patch', '/v1/merchant/profile', { name: '   ' }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await call(a.token, 'patch', '/v1/merchant/profile', { name: 'x'.repeat(121) }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('ignores a client-supplied merchantId: only the sessionâ€™s business changes', async () => {
    const res = await call(a.token, 'patch', '/v1/merchant/profile', {
      name: 'Alpha Savings',
      merchantId: b.merchantId,
    });
    expect(res.body.merchantId).toBe(a.merchantId);
    const { rows } = await owner.query(`SELECT name FROM tenancy.merchants WHERE id = $1`, [b.merchantId]);
    expect(rows[0].name).toBe('Beta Savings');
  });
});

describe.each([
  { kind: 'branches', idField: 'branchId', item: Branch, list: BranchList, noun: 'branch' },
  { kind: 'roles', idField: 'roleId', item: Role, list: RoleList, noun: 'role' },
] as const)('$kind (owner)', ({ kind, idField, item, list, noun }) => {
  const base = `/v1/merchant/${kind}`;

  it('creates, lists, reads, renames, archives and restores â€” each change audited', async () => {
    const created = await call(a.token, 'post', base, { name: ` Head office ${kind} ` });
    expect(created.status).toBe(201);
    const body = item.parse(created.body) as Record<string, unknown>;
    const id = body[idField] as string;
    expect(body).toMatchObject({ name: `Head office ${kind}`, status: 'active', archivedAt: null });
    expect(await auditFor(created)).toEqual([
      {
        action: `merchant.${noun}_created`,
        outcome: 'success',
        merchant_id: a.merchantId,
        target_type: noun,
        target_id: id,
        summary: { name: `Head office ${kind}` },
      },
    ]);

    const listed = list.parse((await call(a.token, 'get', base)).body);
    expect(listed.nextCursor).toBeNull();
    expect(listed.items.map((i) => (i as Record<string, unknown>)[idField])).toContain(id);

    expect((await call(a.token, 'get', `${base}/${id}`)).body).toEqual(body);

    const archived = await call(a.token, 'patch', `${base}/${id}`, {
      name: `HQ ${kind}`,
      status: 'archived',
    });
    expect(archived.status).toBe(200);
    expect(item.parse(archived.body)).toMatchObject({ name: `HQ ${kind}`, status: 'archived' });
    expect(archived.body.archivedAt).not.toBeNull();
    expect(await auditFor(archived)).toMatchObject([
      {
        action: `merchant.${noun}_updated`,
        outcome: 'success',
        summary: { name: `HQ ${kind}`, status: 'archived' },
      },
    ]);

    const restored = await call(a.token, 'patch', `${base}/${id}`, { status: 'active' });
    expect(restored.body).toMatchObject({ status: 'active', archivedAt: null });
  });

  it('409 NAME_TAKEN for a second active item of the same name (case-insensitive), nothing audited', async () => {
    expect((await call(a.token, 'post', base, { name: `Ikeja ${kind}` })).status).toBe(201);
    const dup = await call(a.token, 'post', base, { name: `IKEJA ${kind}` });
    expectError(dup, 409, 'NAME_TAKEN');
    expect(await auditFor(dup)).toEqual([]);
    // Another business may use the name.
    expect((await call(b.token, 'post', base, { name: `Ikeja ${kind}` })).status).toBe(201);
  });

  it('400 for an empty change or an invalid id', async () => {
    const created = await call(a.token, 'post', base, { name: `Empty change ${kind}` });
    expectError(
      await call(a.token, 'patch', `${base}/${created.body[idField]}`, {}),
      400,
      'VALIDATION_ERROR',
    );
    expectError(await call(a.token, 'get', `${base}/not-a-uuid`), 400, 'VALIDATION_ERROR');
  });

  it('another businessâ€™s item is 404 â€” indistinguishable from a missing one â€” and stays untouched (T15)', async () => {
    const theirs = await call(b.token, 'post', base, { name: `Theirs ${kind}` });
    const theirId = theirs.body[idField] as string;
    const missing = '01900000-0000-7000-8000-00000000dead';

    const strip = (res: request.Response) => ({
      status: res.status,
      code: res.body.error?.code,
      message: res.body.error?.message,
    });
    const foreignRead = await call(a.token, 'get', `${base}/${theirId}`);
    const missingRead = await call(a.token, 'get', `${base}/${missing}`);
    expectError(foreignRead, 404, 'NOT_FOUND');
    expect(strip(foreignRead)).toEqual(strip(missingRead));

    const foreignWrite = await call(a.token, 'patch', `${base}/${theirId}`, {
      name: 'Hijack',
      status: 'archived',
    });
    expectError(foreignWrite, 404, 'NOT_FOUND');
    expect(strip(foreignWrite)).toEqual(
      strip(await call(a.token, 'patch', `${base}/${missing}`, { name: 'Hijack' })),
    );
    expect(await auditFor(foreignWrite)).toEqual([]);
    expect((await call(b.token, 'get', `${base}/${theirId}`)).body).toEqual(theirs.body);

    const mine = list.parse((await call(a.token, 'get', base)).body);
    expect(mine.items.map((i) => (i as Record<string, unknown>)[idField])).not.toContain(theirId);
  });
});

describe('who may manage (T9) and who may call at all', () => {
  const management = [
    ['get', '/v1/merchant/profile'],
    ['patch', '/v1/merchant/profile', { name: 'Staff Rename' }],
    ['get', '/v1/merchant/branches'],
    ['post', '/v1/merchant/branches', { name: 'Staff Branch' }],
    ['get', '/v1/merchant/roles'],
    ['post', '/v1/merchant/roles', { name: 'Staff Role' }],
  ] as const;

  it('staff: 403 FORBIDDEN on every management endpoint; refused changes audited as denied', async () => {
    const staff = await member(a.merchantId, 'staff');
    for (const [method, path, body] of management) {
      const res = await call(staff.token, method, path, body);
      expectError(res, 403, 'FORBIDDEN');
      if (method !== 'get') {
        expect(await auditFor(res)).toMatchObject([
          { outcome: 'denied', merchant_id: a.merchantId, summary: { reason: 'not_owner', kind: 'staff' } },
        ]);
      }
    }
    const branch = (await call(a.token, 'post', '/v1/merchant/branches', { name: 'Staff target' })).body
      .branchId;
    expectError(await call(staff.token, 'get', `/v1/merchant/branches/${branch}`), 403, 'FORBIDDEN');
    expectError(
      await call(staff.token, 'patch', `/v1/merchant/branches/${branch}`, { status: 'archived' }),
      403,
      'FORBIDDEN',
    );
    const { rows } = await owner.query(`SELECT name FROM tenancy.merchants WHERE id = $1`, [a.merchantId]);
    expect(rows[0].name).not.toBe('Staff Rename');
  });

  it('agents (bearer) and platform sessions cannot use the merchant endpoints', async () => {
    const agent = await member(a.merchantId, 'agent');
    const bearer = await request(app)
      .get('/v1/merchant/membership')
      .set('Authorization', `Bearer ${agent.token}`);
    expectError(bearer, 401, 'UNAUTHENTICATED');

    const {
      rows: [admin],
    } = await owner.query(
      `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
      [uniqueEmail('admin')],
    );
    const {
      rows: [pm],
    } = await owner.query(
      `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'super_admin') RETURNING id`,
      [admin.id],
    );
    await owner.query(
      `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at) VALUES ($1, '\\x00', 'k1', now())`,
      [admin.id],
    );
    const platform = await sessionToken(admin.id, 'platform', pm.id);
    expectError(await call(platform, 'get', '/v1/merchant/profile'), 403, 'WRONG_AUDIENCE');
  });

  it('a state change needs the CSRF header', async () => {
    const res = await request(app)
      .post('/v1/merchant/branches')
      .set('Cookie', `${AUTH_COOKIES.access}=${a.token}; ${AUTH_COOKIES.csrf}=${CSRF}`)
      .set('Origin', TEST_WEB_ORIGIN)
      .send({ name: 'No CSRF' });
    expectError(res, 403, 'CSRF_FAILED');
  });

  it('a deactivated businessâ€™s owner is out on the next request', async () => {
    const m = await merchant('Delta Savings');
    expect((await call(m.token, 'get', '/v1/merchant/profile')).status).toBe(200);
    await owner.query(
      `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`,
      [m.merchantId],
    );
    expectError(await call(m.token, 'get', '/v1/merchant/profile'), 401, 'UNAUTHENTICATED');
  });
});
