import { randomBytes } from 'node:crypto';
import {
  AUTH_COOKIES,
  CSRF_HEADER,
  CurrentMembership,
  defineEndpoint,
  endpoints,
  PERMISSIONS,
  type EndpointContract,
  type Permission,
} from '@alphakolect/contracts';
import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  authorize,
  decide,
  type Actor,
  type AuthorizeDeps,
  type PermissionRequirement,
} from '../src/platform/authorization.js';
import type { AuthContext } from '../src/platform/http/authenticate.js';
import { errorHandler } from '../src/platform/http/error-handler.js';
import { resolveRequestId } from '../src/platform/http/request-id.js';
import { createTestApp, TEST_WEB_ORIGIN } from './support/app.js';
import { auditRows, markerRequestId } from './support/audit.js';
import { tenancyFixtures, uniqueEmail } from './support/tenancy.js';

// The policy middleware (P5.4; TARGET_ARCHITECTURE ADR-16 §3.5; P5 plan §4 invariants 3–8, §7.6, §8.2a rule 6, §9.4):
// the decision, unit-tested with synthetic branch resources; the middleware's behaviour, including failing closed;
// through the real app, every permission endpoint refused with exactly P4's answer and recorded as authz.denied, a
// failure to resolve authority answered 500 with its signal and nothing recorded or changed, and the effective
// permissions on the membership endpoints.

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

const MERCHANT_WIDE = (permission: Permission): PermissionRequirement => ({
  class: 'permission',
  permission,
  branchScope: 'merchant_wide',
});
const BRANCH = (permission: Permission) =>
  ({ class: 'permission', permission, branchScope: 'branch' }) as PermissionRequirement;
const BRANCH_A = '01900000-0000-7000-8000-00000000b0a1';
const BRANCH_B = '01900000-0000-7000-8000-00000000b0b2';
const actor = (overrides: Partial<Actor> = {}): Actor => ({
  permissions: ['merchant.branches.read'],
  branchId: null,
  branchStatus: null,
  ...overrides,
});

describe('decide (§4, §7.6)', () => {
  it('refuses a permission the actor does not hold with 403, whatever the branch scope', () => {
    const refused = { allowed: false, status: 403, reason: 'missing_permission' };
    expect(decide(actor(), MERCHANT_WIDE('merchant.branches.manage'))).toEqual(refused);
    expect(decide(actor(), BRANCH('merchant.branches.manage'), { branchId: null })).toEqual(refused);
    expect(decide(actor({ permissions: [] }), MERCHANT_WIDE('merchant.branches.read'))).toEqual(refused);
    // A permission of the other scope is never held by a merchant actor's set, so it is refused the same way.
    expect(decide(actor(), MERCHANT_WIDE('platform.merchants.read'))).toEqual(refused);
  });

  it('a merchant-wide endpoint is not narrowed by a branch restriction — even one to an archived branch', () => {
    const required = MERCHANT_WIDE('merchant.branches.read');
    expect(decide(actor(), required)).toEqual({ allowed: true });
    expect(decide(actor({ branchId: BRANCH_A, branchStatus: 'active' }), required)).toEqual({
      allowed: true,
    });
    expect(decide(actor({ branchId: BRANCH_A, branchStatus: 'archived' }), required)).toEqual({
      allowed: true,
    });
  });

  it('a branch endpoint: no restriction reaches every branch; a restriction reaches its own branch only (T15)', () => {
    const required = BRANCH('merchant.branches.read');
    for (const branchId of [BRANCH_A, BRANCH_B, null]) {
      expect(decide(actor(), required, { branchId })).toEqual({ allowed: true });
    }
    const restricted = actor({ branchId: BRANCH_A, branchStatus: 'active' });
    expect(decide(restricted, required, { branchId: BRANCH_A })).toEqual({ allowed: true });
    const notFound = { allowed: false, status: 404, reason: 'other_branch' };
    expect(decide(restricted, required, { branchId: BRANCH_B })).toEqual(notFound);
    // A resource of no branch is not the restricted member's branch.
    expect(decide(restricted, required, { branchId: null })).toEqual(notFound);
  });

  it('a restriction to an archived branch reaches nothing branch-scoped, its own branch included (D7, fail closed)', () => {
    const archived = actor({ branchId: BRANCH_A, branchStatus: 'archived' });
    for (const branchId of [BRANCH_A, BRANCH_B, null]) {
      expect(decide(archived, BRANCH('merchant.branches.read'), { branchId })).toEqual({
        allowed: false,
        status: 404,
        reason: 'archived_branch',
      });
    }
    // An unknown state is treated as not active.
    expect(
      decide(actor({ branchId: BRANCH_A, branchStatus: null }), BRANCH('merchant.branches.read'), {
        branchId: BRANCH_A,
      }),
    ).toMatchObject({ allowed: false, status: 404 });
  });

  it('a branch decision without the resource’s branch throws rather than guess', () => {
    expect(() => decide(actor(), BRANCH('merchant.branches.read'))).toThrow(/resource/);
  });
});

describe('the middleware (synthetic endpoints)', () => {
  const ep = (id: string, authorization: EndpointContract['authorization']) =>
    defineEndpoint({
      id,
      method: 'get',
      path: `/v1/test/${id}`,
      audience: 'merchant',
      security: ['cookieSession'],
      authorization,
      summary: id,
      responses: { 200: { description: 'ok' } },
    });
  const E = {
    read: ep('read', MERCHANT_WIDE('merchant.branches.read')),
    manage: ep('manage', MERCHANT_WIDE('merchant.branches.manage')),
    branchOnly: ep('branchOnly', BRANCH('merchant.branches.read')),
  };
  const AUTH: AuthContext = Object.freeze<AuthContext>({
    identityId: '01900000-0000-7000-8000-0000000000c1',
    sessionId: '01900000-0000-7000-8000-0000000000c2',
    audience: 'merchant',
    membershipId: '01900000-0000-7000-8000-0000000000c3',
    merchantId: '01900000-0000-7000-8000-0000000000c4',
    scope: 'full',
    kind: 'staff',
    roleId: '01900000-0000-7000-8000-0000000000c5',
    branchId: null,
    branchStatus: null,
    permissions: ['merchant.branches.read'],
    transport: 'cookie',
  });

  function appWith(deps: AuthorizeDeps, auth: AuthContext | null = AUTH) {
    const app = express();
    app.use(pinoHttp({ logger: pino({ level: 'silent' }), genReqId: resolveRequestId }));
    app.use((req, _res, next) => {
      if (auth) req.auth = auth;
      next();
    });
    for (const e of Object.values(E)) {
      app.get(e.path, authorize(e, deps), (_req, res) => {
        res.json({ reached: true });
      });
    }
    app.use(errorHandler);
    return app;
  }
  const depsFor = () => {
    const signals: unknown[] = [];
    const deps = {
      audit: { recordBestEffort: vi.fn(async () => undefined) },
      logger: { error: (obj: unknown) => void signals.push(obj) },
    };
    return { deps: deps as unknown as AuthorizeDeps & typeof deps, signals };
  };

  it('is mounted only on permission endpoints: any other class is refused when the route is built', () => {
    const self = ep('self', { class: 'self' });
    expect(() => authorize(self, depsFor().deps)).toThrow(/only on permission endpoints/);
  });

  it('lets a held permission through to the handler, recording nothing', async () => {
    const { deps, signals } = depsFor();
    const res = await request(appWith(deps)).get('/v1/test/read');
    expect(res.body).toEqual({ reached: true });
    expect(deps.audit.recordBestEffort).not.toHaveBeenCalled();
    expect(signals).toEqual([]);
  });

  it('refuses a missing permission with 403 before the handler, and records authz.denied with no request value', async () => {
    const { deps, signals } = depsFor();
    const res = await request(appWith(deps))
      .get('/v1/test/manage?secret=never-recorded')
      .set('X-Request-ID', 'policy-unit-1')
      .set('User-Agent', 'policy-test');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Only the business owner can do this',
        requestId: 'policy-unit-1',
      },
    });
    expect(deps.audit.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(deps.audit.recordBestEffort).toHaveBeenCalledWith({
      action: 'authz.denied',
      outcome: 'denied',
      merchantId: AUTH.merchantId,
      actorIdentityId: AUTH.identityId,
      actorAudience: 'merchant',
      actorMembershipId: AUTH.membershipId,
      ip: expect.any(String),
      userAgent: 'policy-test',
      requestId: 'policy-unit-1',
      summary: { operation: 'manage', permission: 'merchant.branches.manage' },
    });
    expect(signals).toEqual([]);
  });

  it('fails closed with 500 and the resolution signal when no session reached it — never next(), never a denial', async () => {
    const { deps, signals } = depsFor();
    const res = await request(appWith(deps, null)).get('/v1/test/read').set('X-Request-ID', 'policy-unit-2');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(deps.audit.recordBestEffort).not.toHaveBeenCalled();
    expect(signals).toEqual([{ signal: 'authorization_resolution_failure', requestId: 'policy-unit-2' }]);
  });

  it('fails closed the same way when the decision cannot be made (a branch endpoint without its resolver)', async () => {
    const { deps, signals } = depsFor();
    const res = await request(appWith(deps)).get('/v1/test/branchOnly').set('X-Request-ID', 'policy-unit-3');
    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty('reached');
    expect(deps.audit.recordBestEffort).not.toHaveBeenCalled();
    expect(signals).toEqual([{ signal: 'authorization_resolution_failure', requestId: 'policy-unit-3' }]);
  });

  it('a misuse of the audit entry point (it throws) ends in 500, never in a silent pass', async () => {
    const { deps } = depsFor();
    deps.audit.recordBestEffort.mockRejectedValueOnce(new Error('AuditUsageError'));
    const res = await request(appWith(deps)).get('/v1/test/manage');
    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty('reached');
  });
});

// ── through the real app ──────────────────────────────────────────────────────────────────────────────────────────

const { app, auth } = await createTestApp({ logger: pino({ level: 'error' }, capture) });
const fx = tenancyFixtures(app, auth);
const { owner } = fx;

/** P4's refusal answers — the equivalence oracle (P4 code at 3add9ea: requireOwner and the lifecycle refusals). */
const P4_MESSAGE: Partial<Record<keyof typeof endpoints, string>> = {
  deactivateMerchant: 'Only a platform super admin may change a merchant’s status',
  reactivateMerchant: 'Only a platform super admin may change a merchant’s status',
  transferOwnership: 'Only a platform super admin may transfer ownership',
};
const p4Message = (id: keyof typeof endpoints) => P4_MESSAGE[id] ?? 'Only the business owner can do this';

const PERMISSION_ENDPOINTS = (
  Object.entries(endpoints) as Array<[keyof typeof endpoints, EndpointContract]>
).filter(([, e]) => e.authorization.class === 'permission');

type World = Awaited<ReturnType<typeof setUp>>;
async function setUp() {
  const b = await fx.business();
  const staff = await fx.member(b, 'staff');
  const target = await fx.member(b, 'staff');
  const invited = await fx.call(b.owner.token, 'post', '/v1/merchant/invitations', {
    email: uniqueEmail('policy-invitee'),
    kind: 'agent',
  });
  expect(invited.status).toBe(201);
  const support = await fx.platformAdmin('support');
  return { ...b, staff, target, support, invitationId: invited.body.invitationId as string };
}

const PARAMS: Record<string, (w: World) => string> = {
  branchId: (w) => w.branchId,
  roleId: (w) => w.roleId,
  membershipId: (w) => w.target.membershipId,
  invitationId: (w) => w.invitationId,
  merchantId: (w) => w.merchantId,
};
const BODIES: Partial<Record<keyof typeof endpoints, (w: World) => object>> = {
  updateMerchantProfile: () => ({ name: `Policy ${randomBytes(3).toString('hex')}` }),
  createBranch: () => ({ name: `Branch ${randomBytes(3).toString('hex')}` }),
  updateBranch: () => ({ name: `Branch ${randomBytes(3).toString('hex')}` }),
  createRole: () => ({ name: `Role ${randomBytes(3).toString('hex')}` }),
  updateRole: () => ({ name: `Role ${randomBytes(3).toString('hex')}` }),
  assignMember: (w) => ({ roleId: w.roleId, branchId: null }),
  createInvitation: () => ({ email: uniqueEmail('policy'), kind: 'agent' }),
  deactivateMerchant: () => ({ reason: 'policy test' }),
  transferOwnership: (w) => ({
    newOwnerMembershipId: w.target.membershipId,
    formerOwnerRoleId: w.roleId,
    deactivateFormerOwner: false,
  }),
};

function send(id: keyof typeof endpoints, e: EndpointContract, token: string, w: World, rid: string) {
  const target = e.path.replace(/\{([A-Za-z]+)\}/g, (_, p: string) => PARAMS[p]!(w));
  const client = request(app);
  const req = client[e.method](target)
    .set('Cookie', `${AUTH_COOKIES.access}=${token}; ${AUTH_COOKIES.csrf}=policy-csrf`)
    .set('Origin', TEST_WEB_ORIGIN)
    .set(CSRF_HEADER, 'policy-csrf')
    .set('X-Request-ID', rid);
  const body = BODIES[id]?.(w);
  return body ? req.send(body) : req.send();
}

/** Everything the refused calls could have touched, as the table owner sees it. */
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

let W: World;
beforeAll(async () => {
  W = await setUp();
});

describe('denial responses unchanged (the P4 oracle), each recorded as authz.denied', () => {
  it('covers every permission endpoint of the registry (control)', () => {
    expect(PERMISSION_ENDPOINTS.length).toBeGreaterThanOrEqual(20);
    for (const [, e] of PERMISSION_ENDPOINTS) {
      for (const p of Object.keys(e.request?.params?.shape ?? {})) expect(PARAMS, p).toHaveProperty(p);
    }
  });

  it.each(PERMISSION_ENDPOINTS)(
    '%s: staff or platform support get P4’s exact 403; one authz.denied row; nothing changes',
    async (id, e) => {
      const caller = e.audience === 'platform' ? W.support : W.staff;
      const before = await snapshot(W.merchantId);
      const rid = markerRequestId('policy');
      const res = await send(id, e, caller.token, W, rid);

      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: p4Message(id), requestId: rid } });
      expect(await snapshot(W.merchantId)).toBe(before);
      const permission = (e.authorization as PermissionRequirement).permission;
      expect(await auditRows(owner, rid)).toEqual([
        expect.objectContaining({
          action: 'authz.denied',
          outcome: 'denied',
          // Denial events carry the actor's business: none for a platform actor.
          merchant_id: e.audience === 'platform' ? null : W.merchantId,
          actor_identity_id: caller.identityId,
          actor_membership_id: caller.membershipId,
          target_type: null,
          target_id: null,
          summary: { operation: id, permission },
        }),
      ]);
    },
  );

  it('the owner and the super admin pass the middleware on the same endpoints (no 403 anywhere)', async () => {
    const admin = await fx.platformAdmin();
    // The platform operations address a business that does not exist, so the fixture's business is never changed;
    // they pass the middleware and are refused further on (404), as before.
    const elsewhere = { ...W, merchantId: '01900000-0000-7000-8000-00000000dead' };
    for (const [id, e] of PERMISSION_ENDPOINTS) {
      const caller = e.audience === 'platform' ? admin : W.owner;
      const world = e.audience === 'platform' ? elsewhere : W;
      const res = await send(id, e, caller.token, world, markerRequestId('policy-allowed'));
      expect(res.status, `${id}: ${JSON.stringify(res.body)}`).not.toBe(403);
      expect(res.status, id).toBeLessThan(500);
    }
  });

  it('validation still answers first, as in P4: staff with an invalid body get 400, and nothing is recorded', async () => {
    const rid = markerRequestId('policy-invalid');
    const res = await fx
      .call(W.staff.token, 'post', '/v1/merchant/branches', { name: '' })
      .set('X-Request-ID', rid);
    expect(res.status).toBe(400);
    expect(await auditRows(owner, rid)).toEqual([]);
  });
});

describe('a failure to resolve authority (§9.4 authorization_resolution_failure)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers 500, logs the signal with the request id only, records nothing and changes nothing', async () => {
    const spy = vi
      .spyOn(auth.identity, 'sessionAuthority')
      .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
    const before = await snapshot(W.merchantId);
    const rid = markerRequestId('policy-resolve');
    const res = await fx
      .call(W.owner.token, 'patch', '/v1/merchant/profile', { name: 'Never Applied' })
      .set('X-Request-ID', rid);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: rid },
    });
    const signals = lines.filter(
      (l) => l.signal === 'authorization_resolution_failure' && l.requestId === rid,
    );
    expect(signals).toHaveLength(1);
    expect(Object.keys(signals[0]!).sort()).toEqual(
      ['hostname', 'level', 'msg', 'pid', 'requestId', 'signal', 'time'].sort(),
    );
    expect(await auditRows(owner, rid)).toEqual([]);
    expect(await snapshot(W.merchantId)).toBe(before);
  });
});

describe('effective permissions on the membership endpoints (§5, TARGET_ARCHITECTURE CurrentMembership.permissions)', () => {
  const merchantSet = PERMISSIONS.filter((p) => p.startsWith('merchant.')).sort();

  it('the owner: every merchant permission, sorted; staff without grants and agents: none', async () => {
    const asOwner = await fx.call(W.owner.token, 'get', '/v1/merchant/membership');
    expect(asOwner.status).toBe(200);
    expect(CurrentMembership.parse(asOwner.body).permissions).toEqual(merchantSet);

    const asStaff = await fx.call(W.staff.token, 'get', '/v1/merchant/membership');
    expect(CurrentMembership.parse(asStaff.body)).toMatchObject({ kind: 'staff', permissions: [] });

    const agent = await fx.member(W, 'agent');
    const asAgent = await request(app)
      .get('/v1/agent/membership')
      .set('Authorization', `Bearer ${agent.token}`);
    expect(asAgent.status).toBe(200);
    expect(CurrentMembership.parse(asAgent.body)).toMatchObject({ kind: 'agent', permissions: [] });
  });
});
