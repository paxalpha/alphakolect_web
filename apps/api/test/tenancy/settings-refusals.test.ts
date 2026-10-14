import { randomBytes } from 'node:crypto';
import { PERMISSIONS } from '@alphakolect/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AuditLog } from '../../src/modules/audit/audit-log.js';
import { IdentityRepository } from '../../src/modules/identity/repository.js';
import type { RequestContext } from '../../src/modules/identity/sessions.js';
import { newOpaqueToken } from '../../src/modules/identity/tokens.js';
import { MerchantSettingsService } from '../../src/modules/tenancy/merchant-settings.js';
import { createDb } from '../../src/platform/db.js';
import { AppError } from '../../src/platform/errors.js';
import type { TenantContext } from '../../src/platform/tenant.js';
import { auditRows, failAuditInsert, markerRequestId } from '../support/audit.js';

// The settings writers' refusal contract (P5 plan §8.2a rules 2, 4, 5; P5.5 step 4), at the service. Through HTTP the
// policy middleware refuses first (authz.denied), so a refusal by the database alone happens only when a permission is
// withdrawn between the two checks. Here the tenant context claims the permission, as the middleware would have
// resolved it a moment earlier, while the session's database authority has none: the function returns 'forbidden'
// having written nothing; the service then records the write's denial best effort and answers 403. An exception inside
// the function is not a refusal: it fails the request and records no denial.

const db = createDb(inject('apiDatabaseUrl'));
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
const signals: Record<string, unknown>[] = [];
const audit = new AuditLog(db, { error: (obj: Record<string, unknown>) => void signals.push(obj) } as never);
const settings = new MerchantSettingsService({ db, audit });
beforeAll(() => owner.connect());
afterAll(async () => {
  await owner.end();
  await db.close();
});

const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const ctx = (requestId: string): RequestContext => ({ ip: '203.0.113.20', userAgent: 'refusals', requestId });
const one = async (sql: string, params: unknown[]) => (await owner.query(sql, params)).rows[0];

type Fixture = {
  merchantId: string;
  branchId: string;
  roleId: string;
  staff: TenantContext;
  owner: TenantContext;
};
let f: Fixture;

beforeAll(async () => {
  const identity = new IdentityRepository(db);
  const s = await identity.signupMerchantOwner(
    `refusal-${randomBytes(5).toString('hex')}@example.test`,
    ARGON,
    'Refusal Ltd',
  );
  const t = newOpaqueToken();
  await identity.issueOneTimeToken(s.identity_id!, 'email_verification', t.hash, 3600, null);
  await identity.verifyEmail(t.hash);
  const merchantId = s.merchant_id!;
  const ownerMembership = (
    await one(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [s.identity_id])
  ).id as string;
  const roleId = (
    await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Clerk') RETURNING id`, [merchantId])
  ).id as string;
  const branchId = (
    await one(`INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, 'Main') RETURNING id`, [
      merchantId,
    ])
  ).id as string;
  const staffIdentity = (
    await one(
      `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
      [`refusal-staff-${randomBytes(5).toString('hex')}@example.test`, ARGON],
    )
  ).id as string;
  const staffMembership = (
    await one(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, 'staff', $3) RETURNING id`,
      [merchantId, staffIdentity, roleId],
    )
  ).id as string;
  const session = async (identityId: string, membershipId: string) =>
    (
      await identity.createSession({
        identityId,
        audience: 'merchant',
        membershipId,
        scope: 'full',
        refreshHash: newOpaqueToken().hash,
        lifetime: { idleSeconds: 86400, absoluteSeconds: 1209600 },
        ip: null,
        userAgent: null,
      })
    ).session_id;
  const context = async (
    identityId: string,
    membershipId: string,
    kind: 'owner' | 'staff',
  ): Promise<TenantContext> =>
    Object.freeze({
      merchantId,
      identityId,
      membershipId,
      sessionId: await session(identityId, membershipId),
      audience: 'merchant',
      kind,
      roleId: kind === 'staff' ? roleId : null,
      branchId: null,
      branchStatus: null,
      // What the middleware resolved: every merchant permission (the staff member's role in fact holds none).
      permissions: PERMISSIONS.filter((p) => p.startsWith('merchant.')),
    });
  f = {
    merchantId,
    branchId,
    roleId,
    staff: await context(staffIdentity, staffMembership, 'staff'),
    owner: await context(s.identity_id!, ownerMembership, 'owner'),
  };
});

const state = async () =>
  one(
    `SELECT (SELECT name FROM tenancy.merchants WHERE id = $1) AS profile,
            (SELECT string_agg(name || status, ',' ORDER BY id) FROM tenancy.branches WHERE merchant_id = $1) AS branches,
            (SELECT string_agg(name || status, ',' ORDER BY id) FROM tenancy.roles WHERE merchant_id = $1) AS roles`,
    [f.merchantId],
  );

const WRITES = [
  [
    'merchant.profile_updated',
    'merchant',
    (c: RequestContext) => settings.rename(f.staff, 'Hijacked Ltd', c),
  ],
  [
    'merchant.branch_created',
    'branch',
    (c: RequestContext) => settings.create(f.staff, 'branches', 'Hijacked', c),
  ],
  [
    'merchant.branch_updated',
    'branch',
    (c: RequestContext) => settings.update(f.staff, 'branches', f.branchId, { status: 'archived' }, c),
  ],
  ['merchant.role_created', 'role', (c: RequestContext) => settings.create(f.staff, 'roles', 'Hijacked', c)],
  [
    'merchant.role_updated',
    'role',
    (c: RequestContext) => settings.update(f.staff, 'roles', f.roleId, { status: 'archived' }, c),
  ],
] as const;

describe('a refusal by the database alone (§8.2a rule 5)', () => {
  it.each(WRITES)(
    '%s: 403, nothing changed, the denial recorded best effort with the actor',
    async (action, targetType, run) => {
      const before = await state();
      const rid = markerRequestId('refusal');
      const err = await run(ctx(rid)).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect(await state()).toEqual(before);
      expect(await auditRows(owner, rid)).toEqual([
        expect.objectContaining({
          action,
          outcome: 'denied',
          merchant_id: f.merchantId,
          actor_identity_id: f.staff.identityId,
          actor_membership_id: f.staff.membershipId,
          target_type: targetType,
          summary: { reason: 'forbidden' },
        }),
      ]);
    },
  );

  it("with the denial's insert failing, the answer is the same 403 and one signal line is logged", async () => {
    const rid = markerRequestId('refusal-fail');
    const restore = await failAuditInsert(owner, 'merchant.branch_created', 'denied', rid);
    try {
      await expect(settings.create(f.staff, 'branches', 'Hijacked', ctx(rid))).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      });
    } finally {
      await restore();
    }
    expect(await auditRows(owner, rid)).toEqual([]);
    expect(signals.filter((l) => l.requestId === rid).map((l) => l.signal)).toEqual([
      'audit_denial_write_failure',
    ]);
  });

  it('another business’s item is 404 with no event (P4’s behaviour)', async () => {
    const rid = markerRequestId('refusal-404');
    await expect(
      settings.update(f.owner, 'branches', '01900000-0000-7000-8000-0000000000ee', { name: 'x' }, ctx(rid)),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(await auditRows(owner, rid)).toEqual([]);
  });

  it('an exception inside the function is not a refusal: the request fails, nothing changes, no denial is recorded', async () => {
    const before = await state();
    const rid = markerRequestId('refusal-error');
    const restore = await failAuditInsert(owner, 'merchant.branch_created', 'success', rid);
    try {
      const err = await settings.create(f.owner, 'branches', 'Never stored', ctx(rid)).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).not.toBeNull();
      expect(err).not.toBeInstanceOf(AppError); // an operational error: the router answers 500
    } finally {
      await restore();
    }
    expect(await state()).toEqual(before);
    expect(await auditRows(owner, rid)).toEqual([]);
  });
});
