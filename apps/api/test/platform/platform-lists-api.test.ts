import { PERMISSIONS, PlatformMemberList, PlatformMerchantList, Session } from '@alphakolect/contracts';
import { pino } from 'pino';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { AuditLog } from '../../src/modules/audit/audit-log.js';
import { PlatformMerchantListService } from '../../src/modules/platform/merchant-lists.js';
import { createDb } from '../../src/platform/db.js';
import { AppError } from '../../src/platform/errors.js';
import type { AuthContext } from '../../src/platform/http/authenticate.js';
import { createTestApp } from '../support/app.js';
import { auditRows, failAuditInsert, markerRequestId } from '../support/audit.js';
import { expectError, tenancyFixtures } from '../support/tenancy.js';

// The platform team's view of the businesses through the real app (P5.7; closes P4 limitation 1; §8.1 #35, #36;
// §8.2a rule 7): every page is a sensitive read the database records before returning the rows. Other test files
// create businesses at the same time, so these tests look only at their own rows, in their relative order.

const { app, auth } = await createTestApp();
const fx = tenancyFixtures(app, auth);
const { owner, call } = fx;
const db = createDb(inject('apiDatabaseUrl'));
afterAll(() => db.close());

/** A support staff member holding exactly the given grants. */
async function staffWith(grants: string[]) {
  const staff = await fx.platformAdmin('support');
  for (const g of grants)
    await owner.query(
      `INSERT INTO identity.platform_membership_grants (platform_membership_id, permission) VALUES ($1, $2)`,
      [staff.membershipId, g],
    );
  return staff;
}
const get = (token: string, path: string, rid = markerRequestId('lists')) =>
  call(token, 'get', path).set('X-Request-ID', rid);

describe('the businesses (#35)', () => {
  it('newest first, page by page; each page is its own recorded read', async () => {
    const reader = await staffWith(['platform.merchants.read']);
    const mine = [
      (await fx.business()).merchantId,
      (await fx.business()).merchantId,
      (await fx.business()).merchantId,
    ];
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50 && seen.length < 3; page++) {
      const rid = markerRequestId('merchants');
      const res = await get(
        reader.token,
        `/v1/platform/merchants?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        rid,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const body = PlatformMerchantList.parse(res.body);
      expect(body.items.length).toBeLessThanOrEqual(2);
      seen.push(...body.items.map((m) => m.merchantId).filter((id) => mine.includes(id)));
      expect(await auditRows(owner, rid)).toEqual([
        expect.objectContaining({
          action: 'platform.merchant_list_read',
          outcome: 'success',
          merchant_id: null,
          actor_identity_id: reader.identityId,
          actor_membership_id: reader.membershipId,
          summary: { limit: 2, continued: page > 0 },
        }),
      ]);
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual([mine[2], mine[1], mine[0]]);
  });

  it('a cursor belongs to its list: another list’s, another business’s or a forged one is 400 INVALID_CURSOR', async () => {
    const reader = await staffWith(['platform.merchants.read']);
    const [a, b] = [await fx.business(), await fx.business()];
    await fx.member(a, 'agent');
    const membersCursor = (await get(reader.token, `/v1/platform/merchants/${a.merchantId}/members?limit=1`))
      .body.nextCursor as string;
    expect(membersCursor).toBeTruthy();
    const merchantsCursor = (await get(reader.token, '/v1/platform/merchants?limit=1')).body
      .nextCursor as string;
    expectError(
      await get(reader.token, `/v1/platform/merchants/${b.merchantId}/members?cursor=${membersCursor}`),
      400,
      'INVALID_CURSOR',
    );
    expectError(
      await get(reader.token, `/v1/platform/merchants/${a.merchantId}/members?cursor=${merchantsCursor}`),
      400,
      'INVALID_CURSOR',
    );
    expectError(
      await get(reader.token, `/v1/platform/merchants?cursor=${membersCursor}`),
      400,
      'INVALID_CURSOR',
    );
    const forged = Buffer.from(
      JSON.stringify({ at: '2099-01-01T00:00:00.000000Z', id: a.merchantId, d: 'x' }),
    ).toString('base64url');
    expectError(await get(reader.token, `/v1/platform/merchants?cursor=${forged}`), 400, 'INVALID_CURSOR');
  });

  it('if the read cannot be recorded, the request fails and returns no data (§8.2a rule 7)', async () => {
    const reader = await staffWith(['platform.merchants.read']);
    const rid = markerRequestId('unrecorded');
    const restore = await failAuditInsert(owner, 'platform.merchant_list_read', 'success', rid);
    try {
      const res = await get(reader.token, '/v1/platform/merchants', rid);
      expect(res.status).toBe(500);
      expect(res.body).not.toHaveProperty('items');
    } finally {
      await restore();
    }
    expect(await auditRows(owner, rid)).toEqual([]);
  });

  it('refused by the database alone (the grant withdrawn after the policy check): 403, and the denial recorded', async () => {
    const reader = await staffWith([]);
    const lists = new PlatformMerchantListService({ db, audit: new AuditLog(db, pino({ level: 'silent' })) });
    // What the middleware resolved a moment earlier: the permission; the database finds none now.
    const claimed: AuthContext = {
      identityId: reader.identityId,
      sessionId: reader.sessionId,
      audience: 'platform',
      membershipId: reader.membershipId,
      merchantId: null,
      scope: 'full',
      kind: 'support',
      roleId: null,
      branchId: null,
      branchStatus: null,
      permissions: ['platform.merchants.read'],
      transport: 'cookie',
    };
    const rid = markerRequestId('db-refused');
    const ctx = { ip: '198.51.100.9', userAgent: 'lists', requestId: rid };
    const err = await lists.merchants(claimed, { limit: 5 }, ctx).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: "You don't have permission to do this. Ask a super admin if you need it.",
    });
    expect(await auditRows(owner, rid)).toEqual([
      expect.objectContaining({
        action: 'platform.merchant_list_read',
        outcome: 'denied',
        merchant_id: null,
        actor_membership_id: reader.membershipId,
        summary: { reason: 'forbidden' },
      }),
    ]);
  });
});

describe('a business’s members (#36)', () => {
  it('every member, newest first, recorded against the business; an unknown business is 404 and unrecorded', async () => {
    const reader = await staffWith(['platform.merchants.read']);
    const b = await fx.business();
    const staff = await fx.member(b, 'staff');
    const agent = await fx.member(b, 'agent');
    const rid = markerRequestId('members');
    const res = await get(reader.token, `/v1/platform/merchants/${b.merchantId}/members`, rid);
    expect(res.status).toBe(200);
    const body = PlatformMemberList.parse(res.body);
    expect(body.items.map((m) => [m.membershipId, m.kind])).toEqual([
      [agent.membershipId, 'agent'],
      [staff.membershipId, 'staff'],
      [b.owner.membershipId, 'owner'],
    ]);
    expect(body.nextCursor).toBeNull();
    expect(await auditRows(owner, rid)).toEqual([
      expect.objectContaining({
        action: 'platform.merchant_members_read',
        outcome: 'success',
        merchant_id: b.merchantId,
        target_type: 'merchant',
        target_id: b.merchantId,
        summary: { limit: 50, continued: false },
      }),
    ]);
    const missing = markerRequestId('missing');
    expectError(
      await get(reader.token, '/v1/platform/merchants/01900000-0000-7000-8000-0000000000c1/members', missing),
      404,
      'NOT_FOUND',
    );
    expect(await auditRows(owner, missing)).toEqual([]);
  });
});

describe('Session.permissions (GET /v1/auth/session)', () => {
  it('the super admin: every platform permission; a business owner: every merchant one; a bare staff member: none', async () => {
    const sorted = (prefix: string) => PERMISSIONS.filter((p) => p.startsWith(prefix)).sort();
    const admin = await fx.platformAdmin();
    expect(Session.parse((await call(admin.token, 'get', '/v1/auth/session')).body).permissions).toEqual(
      sorted('platform.'),
    );
    const b = await fx.business();
    expect((await call(b.owner.token, 'get', '/v1/auth/session')).body.permissions).toEqual(
      sorted('merchant.'),
    );
    const staff = await fx.member(b, 'staff');
    expect((await call(staff.token, 'get', '/v1/auth/session')).body.permissions).toEqual([]);
    const reader = await staffWith(['platform.audit.read']);
    expect((await call(reader.token, 'get', '/v1/auth/session')).body.permissions).toEqual([
      'platform.audit.read',
    ]);
  });
});
