import { Member, MemberList, OwnershipTransferred } from '@alphakolect/contracts';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app.js';
import { expectError, tenancyFixtures } from '../support/tenancy.js';

// P4.5 through the real app and database (ADR-15 T5, T7–T9, T15, T17): the owner manages members; every change applies
// to the member's very next request; a stale session never acts on a state that no longer holds; the platform super
// admin transfers ownership atomically.

const { app, auth } = await createTestApp();
const { owner, business, member, platformAdmin, call, auditFor } = tenancyFixtures(app, auth);

const membership = (token: string) => call(token, 'get', '/v1/merchant/membership');

describe('the member directory (owner)', () => {
  it('lists every member with email, oldest first; one member by id', async () => {
    const b = await business();
    const staff = await member(b, 'staff');
    const agent = await member(b, 'agent');
    const res = await call(b.owner.token, 'get', '/v1/merchant/members');
    expect(res.status).toBe(200);
    const list = MemberList.parse(res.body);
    expect(list.items.map((m) => [m.membershipId, m.kind, m.email])).toEqual([
      [b.owner.membershipId, 'owner', b.owner.email],
      [staff.membershipId, 'staff', staff.email],
      [agent.membershipId, 'agent', agent.email],
    ]);
    expect(list.nextCursor).toBeNull();

    const one = await call(b.owner.token, 'get', `/v1/merchant/members/${staff.membershipId}`);
    expect(Member.parse(one.body)).toMatchObject({
      kind: 'staff',
      roleId: b.roleId,
      branchId: null,
      status: 'active',
    });
  });

  it('another business’s member is 404 like a missing one', async () => {
    const a = await business();
    const b = await business();
    const theirs = await member(b, 'staff');
    const foreign = await call(a.owner.token, 'get', `/v1/merchant/members/${theirs.membershipId}`);
    const missing = await call(
      a.owner.token,
      'get',
      '/v1/merchant/members/01900000-0000-7000-8000-00000000dead',
    );
    expectError(foreign, 404, 'NOT_FOUND');
    expect(foreign.body.error.message).toBe(missing.body.error.message);
    const list = MemberList.parse((await call(a.owner.token, 'get', '/v1/merchant/members')).body);
    expect(list.items.map((m) => m.membershipId)).not.toContain(theirs.membershipId);
  });
});

describe('assignment, deactivation and reactivation (owner)', () => {
  it('assigns a role and branch — visible on the staff member’s very next request, audited', async () => {
    const b = await business();
    const staff = await member(b, 'staff');
    const {
      rows: [role],
    } = await owner.query(
      `INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Supervisor') RETURNING id`,
      [b.merchantId],
    );
    const res = await call(b.owner.token, 'post', `/v1/merchant/members/${staff.membershipId}/assignment`, {
      roleId: role.id,
      branchId: b.branchId,
    });
    expect(res.status).toBe(200);
    expect(Member.parse(res.body)).toMatchObject({ roleId: role.id, branchId: b.branchId });
    expect((await membership(staff.token)).body).toMatchObject({ roleId: role.id, branchId: b.branchId });
    expect(await auditFor(res)).toEqual([
      {
        action: 'merchant.member_assigned',
        outcome: 'success',
        merchant_id: b.merchantId,
        actor_identity_id: b.owner.identityId,
        target_type: 'membership',
        target_id: staff.membershipId,
        summary: { kind: 'staff', status: 'active', roleId: role.id, branchId: b.branchId },
      },
    ]);
  });

  it('409 INVALID_ASSIGNMENT for another business’s role or branch, an archived role, or an agent', async () => {
    const a = await business();
    const b = await business();
    const staff = await member(a, 'staff');
    const agent = await member(a, 'agent');
    await owner.query(
      `INSERT INTO tenancy.roles (merchant_id, name, status, archived_at) VALUES ($1, 'Old', 'archived', now())`,
      [a.merchantId],
    );
    const {
      rows: [archived],
    } = await owner.query(`SELECT id FROM tenancy.roles WHERE merchant_id = $1 AND status = 'archived'`, [
      a.merchantId,
    ]);
    const assign = (target: string, roleId: string, branchId: string | null) =>
      call(a.owner.token, 'post', `/v1/merchant/members/${target}/assignment`, { roleId, branchId });

    for (const res of [
      await assign(staff.membershipId, b.roleId, null),
      await assign(staff.membershipId, a.roleId, b.branchId),
      await assign(staff.membershipId, archived.id, null),
      await assign(agent.membershipId, a.roleId, null),
    ]) {
      expectError(res, 409, 'INVALID_ASSIGNMENT');
      expect(await auditFor(res)).toMatchObject([{ outcome: 'failure', merchant_id: a.merchantId }]);
    }
    expect((await membership(staff.token)).body).toMatchObject({ roleId: a.roleId, branchId: null });
  });

  it.each(['staff', 'agent'] as const)(
    'deactivating a %s signs them out at once; reactivation needs a new sign-in',
    async (kind) => {
      const b = await business();
      const target = await member(b, kind);
      const probe = () =>
        kind === 'staff'
          ? membership(target.token)
          : call(b.owner.token, 'get', `/v1/merchant/members/${target.membershipId}`);

      const res = await call(b.owner.token, 'post', `/v1/merchant/members/${target.membershipId}/deactivate`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'deactivated' });
      expect(res.body.deactivatedAt).not.toBeNull();
      if (kind === 'staff') expectError(await probe(), 401, 'UNAUTHENTICATED');
      expect(await auditFor(res)).toMatchObject([
        { action: 'merchant.member_deactivated', outcome: 'success' },
      ]);

      expectError(
        await call(b.owner.token, 'post', `/v1/merchant/members/${target.membershipId}/deactivate`),
        409,
        'INVALID_LIFECYCLE_TRANSITION',
      );
      const back = await call(
        b.owner.token,
        'post',
        `/v1/merchant/members/${target.membershipId}/reactivate`,
      );
      expect(back.body).toMatchObject({ status: 'active', deactivatedAt: null });
      if (kind === 'staff') expectError(await probe(), 401, 'UNAUTHENTICATED'); // the old session stays revoked
    },
  );

  it('the owner’s own membership is protected (403); another business’s member is 404 and untouched', async () => {
    const a = await business();
    const b = await business();
    const theirs = await member(b, 'staff');
    expectError(
      await call(a.owner.token, 'post', `/v1/merchant/members/${a.owner.membershipId}/deactivate`),
      403,
      'FORBIDDEN',
    );
    const foreign = await call(
      a.owner.token,
      'post',
      `/v1/merchant/members/${theirs.membershipId}/deactivate`,
    );
    expectError(foreign, 404, 'NOT_FOUND');
    expect((await membership(theirs.token)).status).toBe(200);
  });

  it('staff and agents cannot manage members (403, audited as denied)', async () => {
    const b = await business();
    const staff = await member(b, 'staff');
    const other = await member(b, 'staff');
    expectError(await call(staff.token, 'get', '/v1/merchant/members'), 403, 'FORBIDDEN');
    const res = await call(staff.token, 'post', `/v1/merchant/members/${other.membershipId}/deactivate`);
    expectError(res, 403, 'FORBIDDEN');
    expect(await auditFor(res)).toMatchObject([
      {
        action: 'merchant.member_deactivated',
        outcome: 'denied',
        summary: { reason: 'not_owner', kind: 'staff' },
      },
    ]);
    expect((await membership(other.token)).status).toBe(200);
  });
});

describe('ownership transfer (platform super admin, T17)', () => {
  const transfer = (token: string, merchantId: string, body: object) =>
    call(token, 'post', `/v1/platform/merchants/${merchantId}/transfer-ownership`, body);

  it('swaps owner and staff atomically; both existing sessions follow on their next request; audited with both identities', async () => {
    const admin = await platformAdmin();
    const b = await business();
    const staff = await member(b, 'staff');
    expect((await call(staff.token, 'get', '/v1/merchant/profile')).status).toBe(403);

    const res = await transfer(admin.token, b.merchantId, {
      newOwnerMembershipId: staff.membershipId,
      formerOwnerRoleId: b.roleId,
      deactivateFormerOwner: false,
    });
    expect(res.status).toBe(200);
    expect(OwnershipTransferred.parse(res.body)).toEqual({
      merchantId: b.merchantId,
      ownerMembershipId: staff.membershipId,
      formerOwnerMembershipId: b.owner.membershipId,
    });

    // Stale sessions act on the current state, not the one they were created in.
    expect((await call(staff.token, 'get', '/v1/merchant/profile')).status).toBe(200);
    expectError(await call(b.owner.token, 'get', '/v1/merchant/profile'), 403, 'FORBIDDEN');
    expect((await membership(b.owner.token)).body).toMatchObject({ kind: 'staff', roleId: b.roleId });

    expect(await auditFor(res)).toEqual([
      {
        action: 'platform.ownership_transferred',
        outcome: 'success',
        merchant_id: b.merchantId,
        actor_identity_id: admin.identityId,
        target_type: 'merchant',
        target_id: b.merchantId,
        summary: {
          formerOwnerIdentityId: b.owner.identityId,
          formerOwnerMembershipId: b.owner.membershipId,
          newOwnerIdentityId: staff.identityId,
          newOwnerMembershipId: staff.membershipId,
          formerOwnerRoleId: b.roleId,
          formerOwnerDeactivated: false,
        },
      },
    ]);
  });

  it('can deactivate the former owner, who is signed out at once', async () => {
    const admin = await platformAdmin();
    const b = await business();
    const staff = await member(b, 'staff');
    const res = await transfer(admin.token, b.merchantId, {
      newOwnerMembershipId: staff.membershipId,
      formerOwnerRoleId: b.roleId,
      deactivateFormerOwner: true,
    });
    expect(res.status).toBe(200);
    expectError(await membership(b.owner.token), 401, 'UNAUTHENTICATED');
  });

  it('refusals change nothing and are audited', async () => {
    const admin = await platformAdmin();
    const b = await business();
    const other = await business();
    const unverified = await member(b, 'staff', { verified: false });
    const staff = await member(b, 'staff');
    const body = (newOwnerMembershipId: string, formerOwnerRoleId: string) => ({
      newOwnerMembershipId,
      formerOwnerRoleId,
      deactivateFormerOwner: false,
    });

    const r1 = await transfer(admin.token, b.merchantId, body(unverified.membershipId, b.roleId));
    expectError(r1, 409, 'INVALID_NEW_OWNER');
    expect(await auditFor(r1)).toMatchObject([
      { outcome: 'failure', summary: { reason: 'invalid_new_owner' } },
    ]);
    expectError(
      await transfer(admin.token, b.merchantId, body(staff.membershipId, other.roleId)),
      409,
      'INVALID_ASSIGNMENT',
    );
    expectError(
      await transfer(admin.token, other.merchantId, body(staff.membershipId, other.roleId)),
      409,
      'INVALID_NEW_OWNER',
    );
    expectError(
      await transfer(admin.token, '01900000-0000-7000-8000-00000000dead', body(staff.membershipId, b.roleId)),
      404,
      'NOT_FOUND',
    );
    const support = await platformAdmin('support');
    const r2 = await transfer(support.token, b.merchantId, body(staff.membershipId, b.roleId));
    expectError(r2, 403, 'FORBIDDEN');
    expect(await auditFor(r2)).toMatchObject([{ outcome: 'denied' }]);
    expectError(
      await transfer(b.owner.token, b.merchantId, body(staff.membershipId, b.roleId)),
      403,
      'WRONG_AUDIENCE',
    );

    expect((await call(b.owner.token, 'get', '/v1/merchant/profile')).status).toBe(200);
    expect((await membership(staff.token)).body.kind).toBe('staff');
  });
});
