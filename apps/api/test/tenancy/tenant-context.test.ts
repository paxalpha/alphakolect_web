import { describe, expect, inject, it, afterAll } from 'vitest';
import { createDb } from '../../src/platform/db.js';
import type { AuthContext } from '../../src/platform/http/authenticate.js';
import {
  requireOwner,
  scopeOf,
  tenantContextOf,
  withTenant,
  type TenantContext,
  type TenantTx,
} from '../../src/platform/tenant.js';

// TenantContext and tenant-scoped transactions (ADR-15 T3, T9, T14): the tenant comes only from the authenticated
// session; a scoped transaction sets app.merchant_id before anything else; scoped repositories refuse any query
// object that withTenant did not open.

const db = createDb(inject('apiDatabaseUrl'));
afterAll(() => db.close());

const MERCHANT = '01900000-0000-7000-8000-0000000000a1';
const auth = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  identityId: '01900000-0000-7000-8000-0000000000a2',
  sessionId: '01900000-0000-7000-8000-0000000000a3',
  audience: 'merchant',
  membershipId: '01900000-0000-7000-8000-0000000000a4',
  merchantId: MERCHANT,
  scope: 'full',
  kind: 'staff',
  roleId: '01900000-0000-7000-8000-0000000000a5',
  branchId: null,
  transport: 'cookie',
  ...overrides,
});

describe('tenantContextOf', () => {
  it('is built from the authenticated session only', () => {
    expect(tenantContextOf(auth())).toEqual({
      merchantId: MERCHANT,
      identityId: '01900000-0000-7000-8000-0000000000a2',
      membershipId: '01900000-0000-7000-8000-0000000000a4',
      sessionId: '01900000-0000-7000-8000-0000000000a3',
      audience: 'merchant',
      kind: 'staff',
      roleId: '01900000-0000-7000-8000-0000000000a5',
      branchId: null,
    });
    expect(Object.isFrozen(tenantContextOf(auth()))).toBe(true);
    expect(tenantContextOf(auth({ audience: 'agent', kind: 'agent', roleId: null })).kind).toBe('agent');
  });

  it('refuses a platform session, a missing tenant, an unknown kind and no session at all', () => {
    expect(() => tenantContextOf(auth({ audience: 'platform', merchantId: null, kind: 'super_admin' }))).toThrow();
    // The audience alone decides, even if a platform context somehow carried a tenant and a membership kind.
    expect(() => tenantContextOf(auth({ audience: 'platform', kind: 'owner' }))).toThrow();
    expect(() => tenantContextOf(auth({ merchantId: null }))).toThrow();
    expect(() => tenantContextOf(auth({ kind: 'super_admin' }))).toThrow();
    expect(() => tenantContextOf(undefined)).toThrow();
  });
});

describe('withTenant and scopeOf', () => {
  const tenant = tenantContextOf(auth());

  it('sets app.merchant_id for the transaction only, before the callback runs', async () => {
    const seen = await withTenant(db, tenant, async (tx) => {
      const [row] = await tx.query<{ m: string }>(`SELECT current_setting('app.merchant_id', true) AS m`);
      return { m: row!.m, scoped: scopeOf(tx) };
    });
    expect(seen).toEqual({ m: MERCHANT, scoped: tenant });
    const [after] = await db.query<{ m: string | null }>(
      `SELECT nullif(current_setting('app.merchant_id', true), '') AS m`,
    );
    expect(after!.m).toBeNull();
  });

  it('refuses a query object that withTenant did not open — even one claiming a tenant', () => {
    const forged: TenantTx = { query: db.query, tenant };
    expect(() => scopeOf(forged)).toThrow(/withTenant/);
    expect(() => scopeOf({ ...forged })).toThrow(/withTenant/);
  });

  it('rolls back on error', async () => {
    await expect(
      withTenant(db, tenant, async (tx) => {
        await tx.query(`SELECT 1`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

describe('requireOwner (T9 interim check)', () => {
  const as = (kind: TenantContext['kind']) => tenantContextOf(auth({ kind, roleId: null }));

  it('admits the owner and refuses staff and agents with 403 FORBIDDEN', () => {
    expect(() => requireOwner(as('owner'))).not.toThrow();
    for (const kind of ['staff', 'agent'] as const) {
      expect(() => requireOwner(as(kind))).toThrow(expect.objectContaining({ status: 403, code: 'FORBIDDEN' }));
    }
  });
});
