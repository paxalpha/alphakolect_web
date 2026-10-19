import { randomBytes } from 'node:crypto';
import { AUTH_COOKIES, CSRF_HEADER, endpoints, type EndpointContract } from '@alphakolect/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PermissionRequirement } from '../src/platform/authorization.js';
import { createTestApp, TEST_WEB_ORIGIN } from './support/app.js';
import { tenancyFixtures, uniqueEmail } from './support/tenancy.js';
import { requiredQuery } from './support/required-query.js';

// The authorization matrix (P5.9; P5 plan §10 P5.9, §13 exit criterion 2): every permission endpoint of the registry,
// called by every kind of actor, the expected answer computed from the endpoint's declaration — its class, audience and
// permission, and whether the catalog lets that permission be granted — never from its description. Actors:
// anonymous, an invalid session, the owner, staff with every grantable merchant permission, staff without any, staff
// whose role holding them is archived, staff with them restricted to a branch, staff with them restricted to an
// archived branch, an agent, the super admin, platform staff with every grantable platform permission, platform staff
// without any, and platform staff whose grants were revoked. A refusal changes nothing (the business's and the platform's
// rows compared before and after); an allowed call passes both layers (the API policy and the database's own check).
// Every merchant endpoint is merchant-wide in P5 (the router refuses a branch scope without a resolver, §7.6), so a
// branch restriction — even to an archived branch — narrows none of them.

const { app, auth } = await createTestApp();
const fx = tenancyFixtures(app, auth);
const { owner } = fx;

type Expected = 'allowed' | 'unauthenticated' | 'forbidden' | 'wrong_audience';
type Caller = { kind: 'cookie' | 'bearer' | 'none'; token: string };
type ActorName =
  | 'anonymous'
  | 'invalid session'
  | 'owner'
  | 'staff, granted'
  | 'staff, no grant'
  | 'staff, archived role'
  | 'staff, branch-restricted'
  | 'staff, archived branch'
  | 'agent'
  | 'super admin'
  | 'platform staff, granted'
  | 'platform staff, no grant'
  | 'platform staff, revoked';

const PERMISSION_ENDPOINTS = (
  Object.entries(endpoints) as Array<[keyof typeof endpoints, EndpointContract]>
).filter(([, e]) => e.authorization.class === 'permission');
const permissionOf = (e: EndpointContract) => (e.authorization as PermissionRequirement).permission;

let GRANTABLE: ReadonlySet<string>;
const grantable = (scope: 'merchant' | 'platform') =>
  [...GRANTABLE].filter((p) => p.startsWith(`${scope}.`)).sort();

/** What the declaration says this actor gets on this endpoint. */
function expected(actor: ActorName, e: EndpointContract): Expected {
  if (actor === 'anonymous' || actor === 'invalid session') return 'unauthenticated';
  const merchantSide = [
    'owner',
    'staff, granted',
    'staff, no grant',
    'staff, archived role',
    'staff, branch-restricted',
    'staff, archived branch',
  ];
  const platformSide = [
    'super admin',
    'platform staff, granted',
    'platform staff, no grant',
    'platform staff, revoked',
  ];
  const permission = permissionOf(e);
  if (e.audience === 'merchant') {
    // An agent's bearer token is another transport and audience: refused before any policy.
    if (actor === 'agent') return 'unauthenticated';
    if (platformSide.includes(actor)) return 'wrong_audience';
    if (actor === 'owner') return 'allowed';
    if (['staff, granted', 'staff, branch-restricted', 'staff, archived branch'].includes(actor))
      return GRANTABLE.has(permission) ? 'allowed' : 'forbidden';
    return 'forbidden';
  }
  // platform
  if (actor === 'agent') return 'unauthenticated';
  if (merchantSide.includes(actor)) return 'wrong_audience';
  if (actor === 'super admin') return 'allowed';
  if (actor === 'platform staff, granted') return GRANTABLE.has(permission) ? 'allowed' : 'forbidden';
  return 'forbidden';
}

type World = Awaited<ReturnType<typeof setUp>>;
async function setUp() {
  const b = await fx.business('Matrix Business');
  const merchantGrants = grantable('merchant');
  const platformGrants = grantable('platform');
  const role = async (name: string, status: 'active' | 'archived') => {
    const id = (
      await owner.query(
        `INSERT INTO tenancy.roles (merchant_id, name, status, archived_at)
         VALUES ($1, $2, $3, CASE WHEN $3 = 'archived' THEN now() END) RETURNING id`,
        [b.merchantId, `${name} ${randomBytes(3).toString('hex')}`, status],
      )
    ).rows[0].id as string;
    for (const p of merchantGrants)
      await owner.query(
        `INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission) VALUES ($1, $2, $3)`,
        [b.merchantId, id, p],
      );
    return id;
  };
  const archivedBranch = (
    await owner.query(
      `INSERT INTO tenancy.branches (merchant_id, name, status, archived_at) VALUES ($1, $2, 'archived', now()) RETURNING id`,
      [b.merchantId, `Closed ${randomBytes(3).toString('hex')}`],
    )
  ).rows[0].id as string;
  const grantedRole = await role('Granted', 'active');
  const archivedRole = await role('Archived', 'archived');
  // Staff members on a role of their own, optionally restricted to a branch.
  const staffOn = async (roleId: string, branchId: string | null = null) => {
    const m = await fx.member({ merchantId: b.merchantId, roleId }, 'staff');
    if (branchId)
      await owner.query(`UPDATE tenancy.merchant_memberships SET branch_id = $2 WHERE id = $1`, [
        m.membershipId,
        branchId,
      ]);
    return m;
  };
  const platformStaff = async (grants: readonly string[], revoke = false) => {
    const s = await fx.platformAdmin('support');
    for (const p of grants)
      await owner.query(
        `INSERT INTO identity.platform_membership_grants (platform_membership_id, permission) VALUES ($1, $2)`,
        [s.membershipId, p],
      );
    if (revoke)
      await owner.query(`DELETE FROM identity.platform_membership_grants WHERE platform_membership_id = $1`, [
        s.membershipId,
      ]);
    return s;
  };
  const target = await fx.member(b, 'staff');
  const invited = await fx.call(b.owner.token, 'post', '/v1/merchant/invitations', {
    email: uniqueEmail('matrix-invitee'),
    kind: 'agent',
  });
  expect(invited.status).toBe(201);
  const actors: Record<ActorName, Caller> = {
    anonymous: { kind: 'none', token: '' },
    'invalid session': { kind: 'cookie', token: `not.a.token.${randomBytes(8).toString('hex')}` },
    owner: { kind: 'cookie', token: b.owner.token },
    'staff, granted': { kind: 'cookie', token: (await staffOn(grantedRole)).token },
    'staff, no grant': { kind: 'cookie', token: (await fx.member(b, 'staff')).token },
    'staff, archived role': { kind: 'cookie', token: (await staffOn(archivedRole)).token },
    'staff, branch-restricted': { kind: 'cookie', token: (await staffOn(grantedRole, b.branchId)).token },
    'staff, archived branch': { kind: 'cookie', token: (await staffOn(grantedRole, archivedBranch)).token },
    agent: { kind: 'bearer', token: (await fx.member(b, 'agent')).token },
    'super admin': { kind: 'cookie', token: (await fx.platformAdmin()).token },
    'platform staff, granted': { kind: 'cookie', token: (await platformStaff(platformGrants)).token },
    'platform staff, no grant': { kind: 'cookie', token: (await platformStaff([])).token },
    'platform staff, revoked': { kind: 'cookie', token: (await platformStaff(platformGrants, true)).token },
  };
  const support = await fx.platformAdmin('support');
  return {
    ...b,
    actors,
    target,
    support,
    invitationId: invited.body.invitationId as string,
  };
}

// Allowed platform operations address a business that does not exist, so the fixture's business is never switched off
// or handed over: they pass both layers and are answered further on (404).
const ELSEWHERE = '01900000-0000-7000-8000-00000000dead';
const PARAMS: Record<string, (w: World, allowed: boolean) => string> = {
  branchId: (w) => w.branchId,
  roleId: (w) => w.roleId,
  membershipId: (w) => w.target.membershipId,
  invitationId: (w) => w.invitationId,
  merchantId: (w, allowed) => (allowed ? ELSEWHERE : w.merchantId),
  platformMembershipId: (w) => w.support.membershipId,
};
const BODIES: Partial<Record<keyof typeof endpoints, (w: World) => object>> = {
  updateMerchantProfile: () => ({ name: `Matrix ${randomBytes(3).toString('hex')}` }),
  createBranch: () => ({ name: `Branch ${randomBytes(3).toString('hex')}` }),
  updateBranch: () => ({ name: `Branch ${randomBytes(3).toString('hex')}` }),
  createRole: () => ({ name: `Role ${randomBytes(3).toString('hex')}` }),
  updateRole: () => ({ name: `Role ${randomBytes(3).toString('hex')}` }),
  setRolePermissions: () => ({ permissions: [] }),
  assignMember: (w) => ({ roleId: w.roleId, branchId: null }),
  createInvitation: () => ({ email: uniqueEmail('matrix'), kind: 'agent' }),
  deactivateMerchant: () => ({ reason: 'matrix test' }),
  createPlatformStaff: () => ({ email: uniqueEmail('matrix-staff'), role: 'support' }),
  setPlatformStaffPermissions: () => ({ permissions: [] }),
  transferOwnership: (w) => ({
    newOwnerMembershipId: w.target.membershipId,
    formerOwnerRoleId: w.roleId,
    deactivateFormerOwner: false,
  }),
};

function send(id: keyof typeof endpoints, e: EndpointContract, caller: Caller, w: World, allowed: boolean) {
  const path =
    e.path.replace(/\{([A-Za-z]+)\}/g, (_, p: string) => PARAMS[p]!(w, allowed)) + requiredQuery(id);
  let req = request(app)[e.method](path);
  if (caller.kind === 'bearer') req = req.set('Authorization', `Bearer ${caller.token}`);
  if (caller.kind === 'cookie')
    req = req
      .set('Cookie', `${AUTH_COOKIES.access}=${caller.token}; ${AUTH_COOKIES.csrf}=matrix-csrf`)
      .set('Origin', TEST_WEB_ORIGIN)
      .set(CSRF_HEADER, 'matrix-csrf');
  const body = BODIES[id]?.(w);
  return body ? req.send(body) : req.send();
}

/**
 * Everything a refused call could have touched — the business's rows and the platform's — as the table owner sees it.
 * The platform side is scoped to what this file's calls address (the support member they target, and staff they would
 * create, whose emails carry this file's tag): other test files add platform staff concurrently.
 */
const snapshot = async (merchantId: string, platformMembershipId: string) =>
  (
    await owner.query(
      `SELECT json_build_object(
         'merchant', (SELECT row_to_json(m) FROM tenancy.merchants m WHERE id = $1),
         'branches', (SELECT json_agg(b ORDER BY b.id) FROM tenancy.branches b WHERE merchant_id = $1),
         'roles', (SELECT json_agg(r ORDER BY r.id) FROM tenancy.roles r WHERE merchant_id = $1),
         'grants', (SELECT json_agg(rp ORDER BY rp.role_id, rp.permission) FROM tenancy.role_permissions rp WHERE merchant_id = $1),
         'memberships', (SELECT json_agg(mm ORDER BY mm.id) FROM tenancy.merchant_memberships mm WHERE merchant_id = $1),
         'invitations', (SELECT json_agg(i ORDER BY i.id) FROM tenancy.invitations i WHERE merchant_id = $1),
         'platform', (SELECT json_agg(pm ORDER BY pm.id) FROM identity.platform_memberships pm
                       WHERE pm.id = $2
                          OR pm.identity_id IN (SELECT id FROM identity.identities WHERE email LIKE 'matrix-staff-%')),
         'platformGrants', (SELECT json_agg(g.permission ORDER BY g.permission)
                              FROM identity.platform_membership_grants g WHERE g.platform_membership_id = $2)
       )::text AS s`,
      [merchantId, platformMembershipId],
    )
  ).rows[0].s as string;

let W: World;
beforeAll(async () => {
  const { rows } = await owner.query<{ identifier: string }>(
    `SELECT identifier FROM identity.permission_catalog WHERE grantable AND status = 'active'`,
  );
  GRANTABLE = new Set(rows.map((r) => r.identifier));
  W = await setUp();
});

const ACTORS: ActorName[] = [
  'anonymous',
  'invalid session',
  'owner',
  'staff, granted',
  'staff, no grant',
  'staff, archived role',
  'staff, branch-restricted',
  'staff, archived branch',
  'agent',
  'super admin',
  'platform staff, granted',
  'platform staff, no grant',
  'platform staff, revoked',
];
const CASES = PERMISSION_ENDPOINTS.flatMap(([id, e]) => ACTORS.map((actor) => [id, actor, e] as const));

describe('the authorization matrix (P5.9): every permission endpoint, every actor, expected from the declaration', () => {
  it('covers every permission endpoint, grantable and reserved, merchant and platform (control)', () => {
    expect(PERMISSION_ENDPOINTS.length).toBeGreaterThanOrEqual(20);
    expect(PERMISSION_ENDPOINTS.some(([, e]) => e.audience === 'platform')).toBe(true);
    expect(PERMISSION_ENDPOINTS.some(([, e]) => GRANTABLE.has(permissionOf(e)))).toBe(true);
    expect(PERMISSION_ENDPOINTS.some(([, e]) => !GRANTABLE.has(permissionOf(e)))).toBe(true);
    for (const [, e] of PERMISSION_ENDPOINTS)
      for (const p of Object.keys(e.request?.params?.shape ?? {})) expect(PARAMS, p).toHaveProperty(p);
    // Every merchant endpoint is merchant-wide: a branch restriction narrows none of them in P5 (§7.6).
    expect(
      PERMISSION_ENDPOINTS.filter(
        ([, e]) => (e.authorization as PermissionRequirement).branchScope !== 'merchant_wide',
      ),
    ).toEqual([]);
  });

  it.each(CASES)('%s as %s', async (id, actor, e) => {
    const want = expected(actor, e);
    const allowed = want === 'allowed';
    const before = allowed ? '' : await snapshot(W.merchantId, W.support.membershipId);
    const res = await send(id, e, W.actors[actor], W, allowed);
    const detail = `${id} as ${actor}: ${res.status} ${JSON.stringify(res.body)}`;
    if (allowed) {
      expect([401, 403], detail).not.toContain(res.status);
      expect(res.status, detail).toBeLessThan(500);
      return;
    }
    if (want === 'unauthenticated') expect(res.status, detail).toBe(401);
    if (want === 'forbidden') {
      expect(res.status, detail).toBe(403);
      expect(res.body.error.code, detail).toBe('FORBIDDEN');
    }
    if (want === 'wrong_audience') {
      expect(res.status, detail).toBe(403);
      expect(res.body.error.code, detail).toBe('WRONG_AUDIENCE');
    }
    expect(
      await snapshot(W.merchantId, W.support.membershipId),
      `${detail}: a refused call changed nothing`,
    ).toBe(before);
  });
});
