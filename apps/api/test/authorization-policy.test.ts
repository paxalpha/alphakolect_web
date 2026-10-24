import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import ts from 'typescript';
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
import { honourRequestId } from './support/request-id.js';
import { createTestApp, TEST_WEB_ORIGIN } from './support/app.js';
import { apiProgram, authorityFlows, type Finding as FlowFinding } from './support/authority-flow.js';
import { auditRows, markerRequestId } from './support/audit.js';
import { tenancyFixtures, uniqueEmail } from './support/tenancy.js';
import { requiredQuery } from './support/required-query.js';
import { ledgerBodies, ledgerResources, LEDGER_SNAPSHOT_SQL, requiredHeaders } from './support/ledger.js';

// The policy middleware (P5.4; TARGET_ARCHITECTURE ADR-16 §3.5; P5 plan §4 invariants 3–8, §7.6, §8.2a rule 6, §9.4):
// the decision, unit-tested with synthetic branch resources; the middleware's behaviour, including failing closed;
// through the real app, every permission endpoint refused with the owner’s wording and recorded as authz.denied, a
// failure to resolve authority answered 500 with its signal and nothing recorded or changed, and the effective
// permissions on the membership endpoints; and the source guard that keeps authority decisions in one module.

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
    app.use(pinoHttp({ logger: pino({ level: 'silent' }), genReqId: honourRequestId }));
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
        message: "You don't have permission to do this. Ask the business owner if you need it.",
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

/**
 * The refusal answers the owner chose (R1–R4, 2026-10-14; P5 plan §14), spelled out here rather than read from the code.
 * A permission the catalog marks grantable says whom to ask; a reserved one keeps P4's answer (P4 code at 3add9ea:
 * requireOwner and the lifecycle refusals), which says who alone may act.
 */
const ASK_FOR_IT = {
  merchant: "You don't have permission to do this. Ask the business owner if you need it.",
  platform: "You don't have permission to do this. Ask a super admin if you need it.",
};
const P4_MESSAGE: Partial<Record<keyof typeof endpoints, string>> = {
  deactivateMerchant: 'Only a platform super admin may change a merchant’s status',
  reactivateMerchant: 'Only a platform super admin may change a merchant’s status',
  transferOwnership: 'Only a platform super admin may transfer ownership',
};
/** The catalog's grantable permissions, read as the table owner (the catalog has no app grant, B1). */
let GRANTABLE: ReadonlySet<string>;
const permissionOf = (e: EndpointContract) => (e.authorization as PermissionRequirement).permission;
const chosenMessage = (id: keyof typeof endpoints, e: EndpointContract) => {
  const permission = permissionOf(e);
  const scope = permission.startsWith('merchant.') ? 'merchant' : 'platform';
  if (GRANTABLE.has(permission)) return ASK_FOR_IT[scope];
  return (
    P4_MESSAGE[id] ??
    (scope === 'merchant' ? 'Only the business owner can do this' : 'Only a platform super admin can do this')
  );
};

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
  return {
    ...b,
    staff,
    target,
    support,
    invitationId: invited.body.invitationId as string,
    ledger: await ledgerResources(owner, b.merchantId),
  };
}

const PARAMS: Record<string, (w: World) => string> = {
  branchId: (w) => w.branchId,
  roleId: (w) => w.roleId,
  membershipId: (w) => w.target.membershipId,
  invitationId: (w) => w.invitationId,
  merchantId: (w) => w.merchantId,
  platformMembershipId: (w) => w.support.membershipId,
  accountId: (w) => w.ledger.accountId,
  entryId: (w) => w.ledger.entryId,
};
const BODIES: Partial<Record<keyof typeof endpoints, (w: World) => object>> = {
  ...ledgerBodies,
  postJournalEntry: (w) => ledgerBodies.postJournalEntry(w.ledger),
  updateMerchantProfile: () => ({ name: `Policy ${randomBytes(3).toString('hex')}` }),
  createBranch: () => ({ name: `Branch ${randomBytes(3).toString('hex')}` }),
  updateBranch: () => ({ name: `Branch ${randomBytes(3).toString('hex')}` }),
  createRole: () => ({ name: `Role ${randomBytes(3).toString('hex')}` }),
  updateRole: () => ({ name: `Role ${randomBytes(3).toString('hex')}` }),
  setRolePermissions: () => ({ permissions: [] }),
  assignMember: (w) => ({ roleId: w.roleId, branchId: null }),
  createInvitation: () => ({ email: uniqueEmail('policy'), kind: 'agent' }),
  deactivateMerchant: () => ({ reason: 'policy test' }),
  createPlatformStaff: () => ({ email: uniqueEmail('policy-staff'), role: 'support' }),
  setPlatformStaffPermissions: () => ({ permissions: [] }),
  transferOwnership: (w) => ({
    newOwnerMembershipId: w.target.membershipId,
    formerOwnerRoleId: w.roleId,
    deactivateFormerOwner: false,
  }),
};

function send(id: keyof typeof endpoints, e: EndpointContract, token: string, w: World, rid: string) {
  const target = e.path.replace(/\{([A-Za-z]+)\}/g, (_, p: string) => PARAMS[p]!(w)) + requiredQuery(id);
  const client = request(app);
  const req = client[e.method](target)
    .set('Cookie', `${AUTH_COOKIES.access}=${token}; ${AUTH_COOKIES.csrf}=policy-csrf`)
    .set('Origin', TEST_WEB_ORIGIN)
    .set(CSRF_HEADER, 'policy-csrf')
    .set('X-Request-ID', rid)
    .set(requiredHeaders(id));
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
         'invitations', (SELECT json_agg(i ORDER BY i.id) FROM tenancy.invitations i WHERE merchant_id = $1),
         ${LEDGER_SNAPSHOT_SQL}
       )::text AS s`,
      [merchantId],
    )
  ).rows[0].s as string;

let W: World;
beforeAll(async () => {
  W = await setUp();
  const { rows } = await owner.query<{ identifier: string }>(
    `SELECT identifier FROM identity.permission_catalog WHERE grantable AND status = 'active'`,
  );
  GRANTABLE = new Set(rows.map((r) => r.identifier));
});

describe('denial responses: the owner’s wording (R1–R4), each recorded as authz.denied', () => {
  it('covers every permission endpoint of the registry, both a grantable and a reserved permission (control)', () => {
    expect(PERMISSION_ENDPOINTS.length).toBeGreaterThanOrEqual(20);
    for (const [, e] of PERMISSION_ENDPOINTS) {
      for (const p of Object.keys(e.request?.params?.shape ?? {})) expect(PARAMS, p).toHaveProperty(p);
    }
    const grantable = PERMISSION_ENDPOINTS.filter(([, e]) => GRANTABLE.has(permissionOf(e)));
    expect(grantable.length).toBeGreaterThan(0);
    expect(grantable.length).toBeLessThan(PERMISSION_ENDPOINTS.length);
  });

  it.each(PERMISSION_ENDPOINTS)(
    '%s: staff or platform support get the owner’s chosen 403; one authz.denied row; nothing changes',
    async (id, e) => {
      const caller = e.audience === 'platform' ? W.support : W.staff;
      const before = await snapshot(W.merchantId);
      const rid = markerRequestId('policy');
      const res = await send(id, e, caller.token, W, rid);

      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body).toEqual({
        error: { code: 'FORBIDDEN', message: chosenMessage(id, e), requestId: rid },
      });
      expect(await snapshot(W.merchantId)).toBe(before);
      const permission = permissionOf(e);
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

// ── the source guard ──────────────────────────────────────────────────────────────────────────────────────────────

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_MODULE = 'src/platform/authorization.ts';
/** Kinds and roles that must never decide authority outside the policy module (they hold fixed sets, ADR-16). */
const AUTHORITY_LITERALS = new Set(['owner', 'super_admin']);
const RETIRED_CHECKS = new Set(['requireOwner', 'ownerOrDenied']);
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/** Every authority decision by kind or role in one source: a comparison or case on 'owner'/'super_admin', or a retired check. */
function authorityChecks(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const isAuthorityLiteral = (n: ts.Node) =>
    (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && AUTHORITY_LITERALS.has(n.text);
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && RETIRED_CHECKS.has(n.text)) found.push(`${at(n)} ${n.text}`);
    if (
      ts.isBinaryExpression(n) &&
      EQUALITY.has(n.operatorToken.kind) &&
      (isAuthorityLiteral(n.left) || isAuthorityLiteral(n.right))
    ) {
      found.push(`${at(n)} ${n.getText(sf)}`);
    }
    if (ts.isCaseClause(n) && isAuthorityLiteral(n.expression))
      found.push(`${at(n)} case ${n.expression.getText(sf)}`);
    // ['owner', …].includes(kind), kinds.includes('owner'), allowed.has('super_admin'), …
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ['includes', 'has', 'indexOf'].includes(n.expression.name.text) &&
      (n.arguments.some(isAuthorityLiteral) ||
        (ts.isArrayLiteralExpression(n.expression.expression) &&
          n.expression.expression.elements.some(isAuthorityLiteral)))
    ) {
      found.push(`${at(n)} ${n.getText(sf)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe('the source guard: authority is decided only by the policy module (P5.4)', () => {
  it('no requireOwner, ownerOrDenied, or owner / super admin comparison anywhere else in the API source', () => {
    const offenders: string[] = [];
    let files = 0;
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(apiRoot, full).replace(/\\/g, '/');
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && rel !== POLICY_MODULE) {
          files += 1;
          offenders.push(...authorityChecks(rel, readFileSync(full, 'utf8')));
        }
      }
    };
    walk(path.join(apiRoot, 'src'));
    expect(files).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });

  it('catches each form it refuses (mutation tests), and leaves types and data alone', () => {
    const probe = (code: string) => authorityChecks('probe.ts', code);
    expect(probe(`if (tenant.kind !== 'owner') throw forbidden();`)).toHaveLength(1);
    expect(probe(`const ok = 'owner' === auth.kind;`)).toHaveLength(1);
    expect(probe('if (auth.kind == `super_admin`) allow();')).toHaveLength(1);
    expect(probe(`switch (auth.kind) { case 'owner': break; }`)).toHaveLength(1);
    expect(probe(`if (['owner', 'staff'].includes(kind)) allow();`)).toHaveLength(1);
    expect(probe(`if (auth.permissions.length && fixed.has('super_admin')) allow();`)).toHaveLength(1);
    expect(probe(`requireOwner(tenant);`)).toHaveLength(1);
    expect(probe(`await this.ownerOrDenied(tenant, event);`)).toHaveLength(1);
    expect(
      probe(`type Kind = 'owner' | 'staff'; const k: Kind = 'owner'; const s = new Set(['owner']);`),
    ).toEqual([]);
  });
});

// ── the strengthened source guard (P5.6 precondition; the reviewer's condition at the P5.4 gate) ──────────────────────

/**
 * Indirect authority decisions the type-aware guard allows, each with its reason. Matched by file and expression text;
 * an entry that no longer occurs fails, so the list cannot go stale.
 */
const ALLOWED_FLOWS = [
  {
    file: 'src/platform/tenant.ts',
    text: 'MEMBERSHIP_KINDS.has(auth.kind)',
    // tenantContextOf refuses a session that is not a merchant membership — a validation of the context it builds,
    // not a grant: every permission still comes from the resolver.
  },
];

const PROBE_DIR = path.join(apiRoot, 'test/__authority_probes__');
const PROBE_HEADER = `
  import type { AuthContext } from '../../src/platform/http/authenticate.js';
  import type { MembershipKind, TenantContext } from '../../src/platform/tenant.js';
  declare const someString: string;
  declare function decide(kind: string): boolean;
`;
/** Each indirect form the guard must catch: probe name → its code and the form it is reported as. */
const CAUGHT: Record<string, { code: string; form: string }> = {
  'comparison through a constant': {
    code: `const OWNER = 'owner'; export const f = (t: TenantContext) => t.kind === OWNER;`,
    form: 'comparison',
  },
  'comparison through a copied variable': {
    code: `export function f(a: AuthContext) { const k = a.kind; return k === someString; }`,
    form: 'comparison',
  },
  'comparison through destructuring': {
    code: `export function f(t: TenantContext) { const { kind } = t; return kind !== 'agent'; }`,
    form: 'comparison',
  },
  'lookup table keyed by kind': {
    code: `const ALLOWED: Record<string, boolean> = { owner: true }; export const f = (a: AuthContext) => ALLOWED[a.kind];`,
    form: 'lookup key',
  },
  'lookup through a template key': {
    code: 'const T: Record<string, boolean> = {}; export const f = (a: AuthContext) => T[`${a.kind}`];',
    form: 'lookup key',
  },
  'map get': {
    code: `const M = new Map<string, number>([['owner', 1]]); export const f = (a: AuthContext) => M.get(a.kind);`,
    form: 'call argument',
  },
  'set has': {
    code: `const S = new Set<string>(['owner']); export const f = (t: TenantContext) => S.has(t.kind);`,
    form: 'call argument',
  },
  'array includes through a variable': {
    code: `const ADMIN: string[] = ['owner']; export const f = (a: AuthContext) => ADMIN.includes(a.kind);`,
    form: 'call argument',
  },
  'in operator': {
    code: `const T = { owner: 1 }; export const f = (a: AuthContext) => a.kind in T;`,
    form: 'in',
  },
  switch: {
    code: `export function f(t: TenantContext) { switch (t.kind) { case 'staff': return 1; default: return 0; } }`,
    form: 'switch',
  },
  'helper that returns the kind': {
    code: `const kindOf = (a: AuthContext) => a.kind; export const f = (a: AuthContext) => kindOf(a) === someString;`,
    form: 'comparison',
  },
  'helper that returns a table': {
    code: `const table = (): Record<string, boolean> => ({ owner: true }); export const f = (a: AuthContext) => table()[a.kind];`,
    form: 'lookup key',
  },
  'helper that decides': {
    code: `export const f = (a: AuthContext) => decide(a.kind);`,
    form: 'call argument',
  },
  'a value typed with the kinds, from elsewhere': {
    code: `export const f = (k: MembershipKind) => k === someString;`,
    form: 'comparison',
  },
  'the platform role through a constant': {
    code: `const SA = 'super_admin'; export const f = (a: AuthContext) => a.kind === SA;`,
    form: 'comparison',
  },
  'element access by name': {
    code: `export const f = (a: AuthContext) => a['kind'] === someString;`,
    form: 'comparison',
  },
  'an untyped kind (not assumed safe)': {
    code: `export const f = (row: any) => row.kind === someString;`,
    form: 'comparison',
  },
};
/** What the guard must leave alone. */
const CONTROLS: Record<string, string> = {
  'an unrelated discriminant': `type R = { kind: 'session' } | { kind: 'other' }; export const f = (r: R) => r.kind === 'session';`,
  'a copy into data': `export const f = (t: TenantContext) => Object.freeze({ kind: t.kind, id: t.membershipId });`,
  'a type assertion into data': `export const f = (a: AuthContext) => ({ kind: a.kind as MembershipKind });`,
  'the audience': `export const f = (a: AuthContext) => a.audience === 'merchant';`,
  'the permissions': `export const f = (a: AuthContext) => a.permissions.includes('merchant.roles.read');`,
  'a kind type without owner': `export const f = (r: { kind: 'staff' | 'agent' }) => r.kind === 'staff';`,
  'a type': `export type K = TenantContext['kind'];`,
};

describe('the strengthened source guard: no indirect authority by kind or role (P5.6 precondition)', () => {
  const probeFile = (name: string) => path.join(PROBE_DIR, `${name.replace(/[^a-z0-9]+/gi, '-')}.ts`);
  const relOf = (name: string) => path.relative(apiRoot, probeFile(name)).replace(/\\/g, '/');
  let findings: FlowFinding[];
  let probeErrors: string[];
  beforeAll(() => {
    const probes = Object.fromEntries(
      [...Object.entries(CAUGHT).map(([n, p]) => [n, p.code] as const), ...Object.entries(CONTROLS)].map(
        ([n, code]) => [probeFile(n), `${PROBE_HEADER}\n${code}\n`],
      ),
    );
    const program = apiProgram(apiRoot, probes);
    probeErrors = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file && path.resolve(d.file.fileName).startsWith(PROBE_DIR))
      .map(
        (d) => `${path.basename(d.file!.fileName)}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
      );
    findings = authorityFlows(
      program,
      apiRoot,
      (f) => f.startsWith('src/') || f.startsWith('test/__authority_probes__/'),
      new Set([POLICY_MODULE]),
    );
  }, 120_000);

  it('the probes type-check (a typed guard is only proven by typed code)', () => {
    expect(probeErrors).toEqual([]);
  });

  it('the API source holds no indirect authority decision outside the policy module — only the listed ones', () => {
    const real = findings
      .filter((f) => f.file.startsWith('src/'))
      .map((f) => ({ file: f.file, text: f.text }));
    expect(real).toEqual(ALLOWED_FLOWS.map(({ file, text }) => ({ file, text })));
  });

  it.each(Object.entries(CAUGHT))('catches %s', (name, { form }) => {
    expect(findings.filter((f) => f.file === relOf(name)).map((f) => f.form)).toContain(form);
  });

  it.each(Object.keys(CONTROLS))('leaves %s alone', (name) => {
    expect(findings.filter((f) => f.file === relOf(name))).toEqual([]);
  });
});
