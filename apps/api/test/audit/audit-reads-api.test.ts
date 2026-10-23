import { MerchantAuditEventList, PlatformAuditEventList } from '@alphakolect/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app.js';
import { auditRows, failAuditInsert, markerRequestId } from '../support/audit.js';
import { expectError, tenancyFixtures } from '../support/tenancy.js';

// The activity-record reads through the real app (P5.8; ADR-16 §3.5 "Addendum — the activity-record reads", confirmed
// 2026-10-19): GET /v1/merchant/audit-events (#33) and GET /v1/platform/audit-events (#34). Real actions write the
// events read here. Other test files write events at the same time, so these tests look only at their own rows.

const { app, auth } = await createTestApp();
const fx = tenancyFixtures(app, auth);
const { owner, call } = fx;

const hour = 3_600_000;
/** A window around now: [now − 1 h, now + 1 h). */
const around = () => ({
  from: new Date(Date.now() - hour).toISOString(),
  to: new Date(Date.now() + hour).toISOString(),
});
const query = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
const get = (token: string, path: string, rid = markerRequestId('reads')) =>
  call(token, 'get', path).set('X-Request-ID', rid);
const merchantRead = (token: string, params: Record<string, string | number | undefined>, rid?: string) =>
  get(token, `/v1/merchant/audit-events?${query(params)}`, rid);
const platformRead = (token: string, params: Record<string, string | number | undefined>, rid?: string) =>
  get(token, `/v1/platform/audit-events?${query(params)}`, rid);
async function staffWith(grants: string[]) {
  const staff = await fx.platformAdmin('support');
  for (const g of grants)
    await owner.query(
      `INSERT INTO identity.platform_membership_grants (platform_membership_id, permission) VALUES ($1, $2)`,
      [staff.membershipId, g],
    );
  return staff;
}
/** Every page of a read, followed to its end. */
async function allPages(read: (cursor?: string) => Promise<{ status: number; body: unknown }>) {
  const items: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const res = await read(cursor);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as { items: Record<string, unknown>[]; nextCursor: string | null };
    items.push(...body.items);
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return items;
}

describe('the business’s record (#33)', () => {
  it('the owner sees the business’s actions with addresses, the AlphaKolect team unnamed, each page recorded', async () => {
    const b = await fx.business();
    const other = await fx.business();
    const admin = await fx.platformAdmin();
    const branchRid = markerRequestId('branch');
    expect(
      (
        await call(b.owner.token, 'post', '/v1/merchant/branches', { name: 'Reads branch' }).set(
          'X-Request-ID',
          branchRid,
        )
      ).status,
    ).toBe(201);
    const teamRid = markerRequestId('team');
    expect((await get(admin.token, `/v1/platform/merchants/${b.merchantId}/members`, teamRid)).status).toBe(
      200,
    );
    await call(other.owner.token, 'post', '/v1/merchant/branches', { name: 'Elsewhere' });

    const w = around();
    const readRid = markerRequestId('read');
    const first = await merchantRead(b.owner.token, { ...w, limit: 100 }, readRid);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const body = MerchantAuditEventList.parse(first.body);
    const byRequest = async (rid: string) =>
      (await owner.query(`SELECT id FROM audit.audit_events WHERE request_id = $1`, [rid])).rows[0]
        .id as string;
    const branchEvent = body.items.find((e) => e.event === 'merchant.branch_created');
    expect(branchEvent).toMatchObject({
      eventId: await byRequest(branchRid),
      outcome: 'success',
      actor: { audience: 'merchant', membershipId: b.owner.membershipId, email: b.owner.email },
      actorLabel: null,
    });
    expect(branchEvent!.ip).toEqual(expect.any(String));
    const teamEvent = body.items.find((e) => e.event === 'platform.merchant_members_read');
    expect(teamEvent).toMatchObject({
      eventId: await byRequest(teamRid),
      actor: { audience: 'platform', membershipId: null, email: null },
      actorLabel: 'AlphaKolect team',
      ip: null,
      userAgent: null,
      target: { type: 'merchant', id: b.merchantId },
    });
    // Nothing of another business; newest first.
    const ids = new Set(
      (
        await owner.query(`SELECT id FROM audit.audit_events WHERE merchant_id = $1`, [other.merchantId])
      ).rows.map((r) => r.id as string),
    );
    expect(body.items.filter((e) => ids.has(e.eventId))).toEqual([]);
    const order = body.items.map((e) => `${e.occurredAt}|${e.eventId}`);
    expect([...order].sort().reverse()).toEqual(order);
    // The read is recorded in the business's own record.
    expect(await auditRows(owner, readRid)).toEqual([
      expect.objectContaining({
        action: 'merchant.audit_read',
        outcome: 'success',
        merchant_id: b.merchantId,
        actor_identity_id: b.owner.identityId,
      }),
    ]);
  });

  it('pages exactly once; the cursor belongs to its window and filters; the window and the page are bounded', async () => {
    const b = await fx.business();
    for (let k = 0; k < 4; k++)
      await call(b.owner.token, 'post', '/v1/merchant/branches', { name: `Paged ${k}` });
    const w = around();
    const events = await allPages((cursor) => merchantRead(b.owner.token, { ...w, limit: 2, cursor }));
    const created = events.filter((e) => e.event === 'merchant.branch_created');
    expect(created).toHaveLength(4);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(events.length);

    const cursor = (await merchantRead(b.owner.token, { ...w, limit: 1 })).body.nextCursor as string;
    expect(cursor).toBeTruthy();
    expectError(
      await merchantRead(b.owner.token, { ...w, to: new Date(Date.now() + 2 * hour).toISOString(), cursor }),
      400,
      'INVALID_CURSOR',
    );
    const member = await fx.member(b, 'staff');
    expectError(
      await merchantRead(b.owner.token, { ...w, membershipId: member.membershipId, cursor }),
      400,
      'INVALID_CURSOR',
    );
    expectError(await merchantRead(b.owner.token, { ...w, cursor: 'forged' }), 400, 'INVALID_CURSOR');
    const longest = { from: w.from, to: new Date(Date.parse(w.from) + 744 * hour).toISOString() };
    expect((await merchantRead(b.owner.token, longest)).status).toBe(200);
    expectError(
      await merchantRead(b.owner.token, {
        from: w.from,
        to: new Date(Date.parse(w.from) + 744 * hour + 1).toISOString(),
      }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(await merchantRead(b.owner.token, { from: w.to, to: w.from }), 400, 'VALIDATION_ERROR');
    expectError(await merchantRead(b.owner.token, { to: w.to }), 400, 'VALIDATION_ERROR');
    expectError(await merchantRead(b.owner.token, { ...w, limit: 101 }), 400, 'VALIDATION_ERROR');
  });

  it('by person: one member’s events; another business’s member is 404 and nothing is recorded', async () => {
    const b = await fx.business();
    const other = await fx.business();
    const staff = await fx.member(b, 'staff');
    const outsider = await fx.member(other, 'staff');
    await call(b.owner.token, 'post', '/v1/merchant/branches', { name: 'Owner only' });
    const w = around();
    const res = await merchantRead(b.owner.token, { ...w, membershipId: staff.membershipId });
    expect(res.status).toBe(200);
    expect(
      (res.body as MerchantAuditEventList).items.every((e) => e.actor?.membershipId === staff.membershipId),
    ).toBe(true);
    const rid = markerRequestId('outsider');
    expectError(
      await merchantRead(b.owner.token, { ...w, membershipId: outsider.membershipId }, rid),
      404,
      'NOT_FOUND',
    );
    expect(await auditRows(owner, rid)).toEqual([]);
  });

  it('the owner only: staff are refused (and the refusal recorded), an agent and a platform session too', async () => {
    const b = await fx.business();
    const staff = await fx.member(b, 'staff');
    await owner.query(
      `INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission)
       SELECT $1, $2, identifier FROM identity.permission_catalog
        WHERE scope = 'merchant' AND grantable AND status = 'active'`,
      [b.merchantId, b.roleId],
    );
    const w = around();
    const rid = markerRequestId('staff');
    expectError(await merchantRead(staff.token, w, rid), 403, 'FORBIDDEN');
    expect(await auditRows(owner, rid)).toEqual([
      expect.objectContaining({ action: 'authz.denied', outcome: 'denied' }),
    ]);
    const agent = await fx.member(b, 'agent');
    const asAgent = await request(app)
      .get(`/v1/merchant/audit-events?${query(w)}`)
      .set('Authorization', `Bearer ${agent.token}`);
    expect(asAgent.status).toBe(401);
    expectError(await merchantRead((await fx.platformAdmin()).token, w), 403, 'WRONG_AUDIENCE');
  });

  it('returns nothing when its read cannot be recorded', async () => {
    const b = await fx.business();
    const rid = markerRequestId('fail');
    const restore = await failAuditInsert(owner, 'merchant.audit_read', 'success', rid);
    try {
      const res = await merchantRead(b.owner.token, around(), rid);
      expect(res.status).toBe(500);
      expect(res.body).not.toHaveProperty('items');
    } finally {
      await restore();
    }
  });
});

describe('the platform’s record (#34)', () => {
  it('the super admin sees addresses; platform staff with the grant do not; staff without it are refused', async () => {
    const b = await fx.business();
    const admin = await fx.platformAdmin();
    const reader = await staffWith(['platform.audit.read']);
    const without = await staffWith([]);
    const branchRid = markerRequestId('branch');
    await call(b.owner.token, 'post', '/v1/merchant/branches', { name: 'Seen' }).set(
      'X-Request-ID',
      branchRid,
    );
    const eventId = (
      await owner.query(`SELECT id FROM audit.audit_events WHERE request_id = $1`, [branchRid])
    ).rows[0].id as string;
    const w = around();
    const seen = async (token: string) =>
      (await allPages((cursor) => platformRead(token, { ...w, merchantId: b.merchantId, cursor }))).find(
        (e) => e.eventId === eventId,
      );
    const asAdmin = PlatformAuditEventList.shape.items.element.parse(await seen(admin.token));
    expect(asAdmin).toMatchObject({
      merchantId: b.merchantId,
      actor: { audience: 'merchant', membershipId: b.owner.membershipId, email: b.owner.email },
    });
    expect(asAdmin.ip).toEqual(expect.any(String));
    expect(await seen(reader.token)).toMatchObject({
      ip: null,
      userAgent: null,
      actor: { email: b.owner.email },
    });
    const rid = markerRequestId('without');
    expectError(await platformRead(without.token, w, rid), 403, 'FORBIDDEN');
    expect(await auditRows(owner, rid)).toEqual([expect.objectContaining({ action: 'authz.denied' })]);
    expectError(await platformRead(b.owner.token, w), 403, 'WRONG_AUDIENCE');
  });

  it('filters; a read filtered by a business is in that business’s record; unknown filters answered', async () => {
    const b = await fx.business();
    const admin = await fx.platformAdmin();
    await call(b.owner.token, 'post', '/v1/merchant/branches', { name: 'Filtered' });
    const w = around();
    const rid = markerRequestId('filtered');
    const res = await platformRead(
      admin.token,
      { ...w, merchantId: b.merchantId, event: 'merchant.branch_created' },
      rid,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = PlatformAuditEventList.parse(res.body).items;
    expect(items.map((e) => [e.event, e.merchantId])).toEqual([['merchant.branch_created', b.merchantId]]);
    expect(await auditRows(owner, rid)).toEqual([
      expect.objectContaining({
        action: 'platform.audit_read',
        merchant_id: b.merchantId,
        target_type: 'merchant',
        target_id: b.merchantId,
      }),
    ]);
    const byPerson = await platformRead(admin.token, { ...w, membershipId: b.owner.membershipId });
    expect(
      (byPerson.body as PlatformAuditEventList).items.every((e) => e.actor?.email === b.owner.email),
    ).toBe(true);
    expectError(await platformRead(admin.token, { ...w, event: 'no.such_event' }), 400, 'VALIDATION_ERROR');
    expectError(await platformRead(admin.token, { ...w, event: 'Not An Event' }), 400, 'VALIDATION_ERROR');
    expectError(
      await platformRead(admin.token, { ...w, merchantId: '01900000-0000-7000-8000-00000000dead' }),
      404,
      'NOT_FOUND',
    );
  });
});
