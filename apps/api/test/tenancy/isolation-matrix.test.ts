import { randomBytes } from 'node:crypto';
import { AUTH_COOKIES, CSRF_HEADER, endpoints, type EndpointContract } from '@alphakolect/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TEST_WEB_ORIGIN } from '../support/app.js';
import { tenancyFixtures, uniqueEmail } from '../support/tenancy.js';

// The tenant-isolation matrix (P4 exit criterion; ADR-15 T3, T9, T14, T15), driven by the contract registry: every
// merchant- and agent-audience endpoint, as it is registered — not a hand-picked list. A new tenant endpoint is in
// the matrix automatically, and the matrix FAILS (rather than skips it) if it cannot address that endpoint: every
// path parameter needs a resolver below, every request body a valid sample.
//
//   1. another tenant's resource, addressed by its real id → 404 NOT_FOUND, the same answer as for an id that does
//      not exist, and the other tenant's data is unchanged afterwards;
//   2. collection endpoints answer with nothing of the other tenant;
//   3. same tenant, wrong kind: staff get 403 FORBIDDEN wherever the declaration requires a permission (T9), and
//      success elsewhere;
//   4. wrong audience or transport: agent tokens on merchant endpoints, merchant cookies on agent endpoints, and
//      platform sessions are all refused.

const { app, auth } = await createTestApp();
const { owner, business, member, platformAdmin, call } = tenancyFixtures(app, auth);

type Tenant = Awaited<ReturnType<typeof setUp>>;
async function setUp(name: string) {
  const b = await business(name);
  const staff = await member(b, 'staff');
  const agent = await member(b, 'agent');
  // Addressed by the membership endpoints (which may deactivate it), never a caller.
  const target = await member(b, 'staff');
  const invited = await call(b.owner.token, 'post', '/v1/merchant/invitations', {
    email: uniqueEmail('matrix-invitee'),
    kind: 'agent',
  });
  expect(invited.status).toBe(201);
  return { ...b, staff, agent, target, invitationId: invited.body.invitationId as string };
}

/** How to address each path parameter in a tenant: a real resource of that tenant. */
const RESOLVERS: Record<string, (t: Tenant) => string> = {
  branchId: (t) => t.branchId,
  roleId: (t) => t.roleId,
  membershipId: (t) => t.target.membershipId,
  invitationId: (t) => t.invitationId,
};

/** A valid request body for each tenant endpoint that takes one (`t` is the CALLER's tenant). */
const BODIES: Partial<Record<keyof typeof endpoints, (t: Tenant) => object>> = {
  updateMerchantProfile: () => ({ name: `Matrix ${randomBytes(3).toString('hex')}` }),
  createBranch: () => ({ name: `Branch ${randomBytes(3).toString('hex')}` }),
  updateBranch: () => ({ name: `Branch ${randomBytes(3).toString('hex')}` }),
  createRole: () => ({ name: `Role ${randomBytes(3).toString('hex')}` }),
  updateRole: () => ({ name: `Role ${randomBytes(3).toString('hex')}` }),
  setRolePermissions: () => ({ permissions: [] }),
  assignMember: (t) => ({ roleId: t.roleId, branchId: null }),
  createInvitation: () => ({ email: uniqueEmail('matrix'), kind: 'agent' }),
};

const TENANT_ENDPOINTS = (
  Object.entries(endpoints) as Array<[keyof typeof endpoints, EndpointContract]>
).filter(([, e]) => e.audience === 'merchant' || e.audience === 'agent');
const paramsOf = (e: EndpointContract) => Object.keys(e.request?.params?.shape ?? {});
const withParams = TENANT_ENDPOINTS.filter(([, e]) => paramsOf(e).length > 0);
const withoutParams = TENANT_ENDPOINTS.filter(([, e]) => paramsOf(e).length === 0);
const MISSING = '01900000-0000-7000-8000-00000000dead';

type Caller = { kind: 'cookie' | 'bearer'; token: string };
/** Call an endpoint from the registry: path parameters from `ids`, the body sample for the caller's tenant. */
function send(
  id: keyof typeof endpoints,
  e: EndpointContract,
  caller: Caller,
  ids: (p: string) => string,
  t: Tenant,
) {
  const path = e.path.replace(/\{([A-Za-z]+)\}/g, (_, p: string) => ids(p));
  let req = request(app)[e.method](path);
  if (caller.kind === 'bearer') {
    req = req.set('Authorization', `Bearer ${caller.token}`);
  } else {
    req = req
      .set('Cookie', `${AUTH_COOKIES.access}=${caller.token}; ${AUTH_COOKIES.csrf}=matrix-csrf`)
      .set('Origin', TEST_WEB_ORIGIN)
      .set(CSRF_HEADER, 'matrix-csrf');
  }
  const body = BODIES[id]?.(t);
  return body ? req.send(body) : req.send();
}

/** The tenant's own caller for an endpoint's audience: the owner on merchant endpoints, the agent on agent ones. */
const callerFor = (e: EndpointContract, t: Tenant): Caller =>
  e.audience === 'agent'
    ? { kind: 'bearer', token: t.agent.token }
    : { kind: 'cookie', token: t.owner.token };

/** Everything of tenant B, as the table owner sees it — compared before and after the matrix runs. */
const snapshot = async (merchantId: string) =>
  (
    await owner.query(
      `SELECT json_build_object(
         'merchant', (SELECT row_to_json(m) FROM tenancy.merchants m WHERE id = $1),
         'branches', (SELECT json_agg(b ORDER BY b.id) FROM tenancy.branches b WHERE merchant_id = $1),
         'roles', (SELECT json_agg(r ORDER BY r.id) FROM tenancy.roles r WHERE merchant_id = $1),
         'memberships', (SELECT json_agg(mm ORDER BY mm.id) FROM tenancy.merchant_memberships mm WHERE merchant_id = $1),
         'invitations', (SELECT json_agg(i ORDER BY i.id) FROM tenancy.invitations i WHERE merchant_id = $1)
       )::text AS s`,
      [merchantId],
    )
  ).rows[0].s as string;

const answer = (res: request.Response) => ({
  status: res.status,
  code: res.body?.error?.code,
  message: res.body?.error?.message,
});

let A: Tenant;
let B: Tenant;
beforeAll(async () => {
  A = await setUp('Matrix Alpha');
  B = await setUp('Matrix Beta');
});

describe('the matrix covers every tenant endpoint in the registry', () => {
  it('finds the tenant endpoints (control)', () => {
    expect(TENANT_ENDPOINTS.length).toBeGreaterThanOrEqual(20);
    expect(withParams.length).toBeGreaterThanOrEqual(8);
  });

  it('every path parameter has a resolver — a new one fails here until the matrix can address it', () => {
    const unresolved = withParams.flatMap(([id, e]) =>
      paramsOf(e)
        .filter((p) => !RESOLVERS[p])
        .map((p) => `${id}: {${p}}`),
    );
    expect(unresolved).toEqual([]);
  });

  it('every request body has a sample that satisfies its contract', () => {
    const problems = TENANT_ENDPOINTS.flatMap(([id, e]) => {
      if (!e.request?.body) return [];
      const sample = BODIES[id];
      if (!sample) return [`${id}: no sample body`];
      return e.request.body.safeParse(sample(A)).success ? [] : [`${id}: sample does not match the contract`];
    });
    expect(problems).toEqual([]);
  });
});

describe('another tenant’s resources are not found (T15)', () => {
  it.each(withParams)(
    '%s: B’s resource → 404, the same answer as a missing one; B unchanged',
    async (id, e) => {
      const before = await snapshot(B.merchantId);
      const foreign = await send(id, e, callerFor(e, A), (p) => RESOLVERS[p]!(B), A);
      const missing = await send(id, e, callerFor(e, A), () => MISSING, A);
      expect(answer(foreign), JSON.stringify(foreign.body)).toEqual({
        status: 404,
        code: 'NOT_FOUND',
        message: expect.any(String),
      });
      expect(answer(foreign)).toEqual(answer(missing));
      expect(await snapshot(B.merchantId)).toBe(before);
    },
  );

  it.each(withParams)('%s: control — the same call on A’s own resource is not a 404', async (id, e) => {
    const own = await send(id, e, callerFor(e, A), (p) => RESOLVERS[p]!(A), A);
    expect(own.status, JSON.stringify(own.body)).not.toBe(404);
  });
});

describe('collections show nothing of another tenant', () => {
  it.each(withoutParams)('%s: no identifier, email or name of B in A’s answer', async (id, e) => {
    const res = await send(id, e, callerFor(e, A), () => '', A);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const text = JSON.stringify(res.body);
    const markers = [
      B.merchantId,
      B.owner.membershipId,
      B.owner.email,
      B.staff.membershipId,
      B.staff.email,
      B.agent.membershipId,
      B.agent.email,
      B.target.membershipId,
      B.target.email,
      B.roleId,
      B.branchId,
      B.invitationId,
      'Matrix Beta',
    ];
    expect(markers.filter((m) => text.includes(m))).toEqual([]);
  });
});

describe('same tenant, wrong kind (T9)', () => {
  const merchantEndpoints = TENANT_ENDPOINTS.filter(([, e]) => e.audience === 'merchant');
  // From the declaration, never the description (P5.9): this staff member holds no grant, so every endpoint that
  // requires a permission refuses them. The full actor matrix is authorization-matrix.test.ts.
  const forbids = (e: EndpointContract) => e.authorization.class === 'permission';

  // ADR-15 T5/T7: a staff branch restriction is stored and re-read per request, but no branch-scoped data exists in
  // P4, so nothing reads it yet. That is safe only while staff and agents can reach their own membership and nothing
  // else. Any endpoint that opens to them fails here until its branch scope is decided (and tested) — P5 policies.
  it('staff and agents reach only their own membership — nothing branch-scoped is open to them yet', () => {
    expect(merchantEndpoints.filter(([, e]) => !forbids(e)).map(([id]) => id)).toEqual([
      'getCurrentMembership',
    ]);
    expect(TENANT_ENDPOINTS.filter(([, e]) => e.audience === 'agent').map(([id]) => id)).toEqual([
      'getAgentMembership',
    ]);
  });

  it.each(merchantEndpoints)(
    '%s: staff without a grant get 403 where the declaration requires a permission, success otherwise',
    async (id, e) => {
      const before = await snapshot(A.merchantId);
      const res = await send(id, e, { kind: 'cookie', token: A.staff.token }, (p) => RESOLVERS[p]!(A), A);
      if (forbids(e)) {
        expect(answer(res), JSON.stringify(res.body)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
        expect(await snapshot(A.merchantId)).toBe(before);
      } else {
        expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      }
    },
  );
});

describe('wrong audience or transport', () => {
  let platform: Awaited<ReturnType<typeof platformAdmin>>;
  beforeAll(async () => {
    platform = await platformAdmin();
  });

  it.each(TENANT_ENDPOINTS)(
    '%s: refused to the other tenant audience and to a platform session',
    async (id, e) => {
      const ids = (p: string) => RESOLVERS[p]!(A);
      if (e.audience === 'merchant') {
        expect((await send(id, e, { kind: 'bearer', token: A.agent.token }, ids, A)).status).toBe(401);
        const asPlatform = await send(id, e, { kind: 'cookie', token: platform.token }, ids, A);
        expect(answer(asPlatform)).toMatchObject({ status: 403, code: 'WRONG_AUDIENCE' });
      } else {
        expect((await send(id, e, { kind: 'cookie', token: A.owner.token }, ids, A)).status).toBe(401);
        expect((await send(id, e, { kind: 'bearer', token: A.owner.token }, ids, A)).status).toBe(401);
      }
    },
  );
});
