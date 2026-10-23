import { PermissionCatalog, Role, RoleList } from '@alphakolect/contracts';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app.js';
import { expectError, tenancyFixtures } from '../support/tenancy.js';

// Role permission management through the real app and database (P5.6; ADR-16's frozen contracts listPermissionCatalog,
// setRolePermissions and Role.permissions; D5′, D6; the owner's answers O13, O14). The owner chooses what each role may
// do; staff holding a role get exactly its set, decided again on every request; nothing a staff member does can widen it.

const { app, auth } = await createTestApp();
const { owner, business, member, call, auditFor } = tenancyFixtures(app, auth);

const put = (token: string, roleId: string, permissions: unknown) =>
  call(token, 'put', `/v1/merchant/roles/${roleId}/permissions`, { permissions });

describe('the permission catalog (GET /v1/merchant/permissions)', () => {
  it('lists every active merchant permission with its owner-approved description and whether a role can grant it', async () => {
    const b = await business();
    const res = await call(b.owner.token, 'get', '/v1/merchant/permissions');
    expect(res.status).toBe(200);
    const body = PermissionCatalog.parse(res.body);
    expect(body.items.map((i) => i.permission)).toEqual([...body.items.map((i) => i.permission)].sort());
    expect(body.items).toContainEqual({
      permission: 'merchant.branches.manage',
      description: 'Add branches, rename them, and archive or restore them.',
      grantable: true,
    });
    expect(body.items).toContainEqual({
      permission: 'merchant.roles.manage',
      description:
        "Create, rename, archive and restore roles, and choose each role's permissions. Owner only.",
      grantable: false,
    });
    expect(body.items.every((i) => i.permission.startsWith('merchant.'))).toBe(true);
  });
});

describe('setting a role’s permissions (PUT /v1/merchant/roles/{roleId}/permissions)', () => {
  it('the owner replaces the set; every role answer carries it, sorted; one #21 row', async () => {
    const b = await business();
    const res = await put(b.owner.token, b.roleId, ['merchant.members.read', 'merchant.branches.read']);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Role.parse(res.body)).toMatchObject({
      roleId: b.roleId,
      permissions: ['merchant.branches.read', 'merchant.members.read'],
    });
    expect(await auditFor(res)).toEqual([
      expect.objectContaining({
        action: 'merchant.role_permissions_set',
        outcome: 'success',
        merchant_id: b.merchantId,
        target_id: b.roleId,
        summary: { before: [], after: ['merchant.branches.read', 'merchant.members.read'] },
      }),
    ]);
    const one = Role.parse((await call(b.owner.token, 'get', `/v1/merchant/roles/${b.roleId}`)).body);
    expect(one.permissions).toEqual(['merchant.branches.read', 'merchant.members.read']);
    const list = RoleList.parse((await call(b.owner.token, 'get', '/v1/merchant/roles')).body);
    expect(list.items.find((r) => r.roleId === b.roleId)?.permissions).toEqual([
      'merchant.branches.read',
      'merchant.members.read',
    ]);
    // A role just created grants nothing.
    const created = await call(b.owner.token, 'post', '/v1/merchant/roles', { name: 'Fresh role' });
    expect(Role.parse(created.body).permissions).toEqual([]);
  });

  it('a staff member gets exactly the role’s set, from their next request; taking it away takes effect at once', async () => {
    const b = await business();
    const s = await member(b, 'staff');
    expectError(await call(s.token, 'get', '/v1/merchant/branches'), 403, 'FORBIDDEN');
    await put(b.owner.token, b.roleId, ['merchant.branches.read']);
    expect((await call(s.token, 'get', '/v1/merchant/branches')).status).toBe(200);
    expectError(await call(s.token, 'get', '/v1/merchant/members'), 403, 'FORBIDDEN');
    const me = await call(s.token, 'get', '/v1/merchant/membership');
    expect(me.body.permissions).toEqual(['merchant.branches.read']);
    await put(b.owner.token, b.roleId, []);
    expectError(await call(s.token, 'get', '/v1/merchant/branches'), 403, 'FORBIDDEN');
  });

  it('archiving the role takes its permissions away; restoring gives them back at once (D6, O14)', async () => {
    const b = await business();
    const s = await member(b, 'staff');
    await put(b.owner.token, b.roleId, ['merchant.branches.read']);
    await call(b.owner.token, 'patch', `/v1/merchant/roles/${b.roleId}`, { status: 'archived' });
    expectError(await call(s.token, 'get', '/v1/merchant/branches'), 403, 'FORBIDDEN');
    const archived = Role.parse((await call(b.owner.token, 'get', `/v1/merchant/roles/${b.roleId}`)).body);
    expect(archived).toMatchObject({ status: 'archived', permissions: ['merchant.branches.read'] });
    await call(b.owner.token, 'patch', `/v1/merchant/roles/${b.roleId}`, { status: 'active' });
    expect((await call(s.token, 'get', '/v1/merchant/branches')).status).toBe(200);
  });

  it('staff cannot set permissions — not even with every permission a role can grant (D5′)', async () => {
    const b = await business();
    const s = await member(b, 'staff');
    const catalog = PermissionCatalog.parse(
      (await call(b.owner.token, 'get', '/v1/merchant/permissions')).body,
    );
    await put(
      b.owner.token,
      b.roleId,
      catalog.items.filter((i) => i.grantable).map((i) => i.permission),
    );
    const res = await put(s.token, b.roleId, ['merchant.profile.read']);
    expectError(res, 403, 'FORBIDDEN');
    expect(await auditFor(res)).toEqual([
      expect.objectContaining({ action: 'authz.denied', outcome: 'denied' }),
    ]);
  });

  it.each([
    ['an unknown permission', ['merchant.unknown.read']],
    ['a platform permission', ['platform.audit.read']],
    ['an owner-only permission', ['merchant.members.manage']],
  ])('%s: 400, nothing changed, the failure recorded', async (_label, permissions) => {
    const b = await business();
    await put(b.owner.token, b.roleId, ['merchant.profile.read']);
    const res = await put(b.owner.token, b.roleId, permissions);
    expectError(res, 400, 'VALIDATION_ERROR');
    expect(await auditFor(res)).toEqual([
      expect.objectContaining({
        action: 'merchant.role_permissions_set',
        outcome: 'failure',
        summary: { reason: 'invalid_permissions' },
      }),
    ]);
    const { rows } = await owner.query(`SELECT permission FROM tenancy.role_permissions WHERE role_id = $1`, [
      b.roleId,
    ]);
    expect(rows.map((r) => r.permission)).toEqual(['merchant.profile.read']);
  });

  it('a malformed request (repeated identifiers, not a list) is refused by the contract before the database', async () => {
    const b = await business();
    expectError(
      await put(b.owner.token, b.roleId, ['merchant.profile.read', 'merchant.profile.read']),
      400,
      'VALIDATION_ERROR',
    );
    expectError(await put(b.owner.token, b.roleId, 'merchant.profile.read'), 400, 'VALIDATION_ERROR');
  });

  it('another business’s role is not found, and untouched', async () => {
    const a = await business();
    const b = await business();
    const res = await put(a.owner.token, b.roleId, ['merchant.profile.read']);
    expectError(res, 404, 'NOT_FOUND');
    expect(await auditFor(res)).toEqual([]);
    const { rows } = await owner.query(`SELECT 1 FROM tenancy.role_permissions WHERE role_id = $1`, [
      b.roleId,
    ]);
    expect(rows).toEqual([]);
  });
});
