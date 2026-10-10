import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { IdentityRepository } from '../../src/modules/identity/repository.js';
import { NameTakenError, tenancyRepository as repo } from '../../src/modules/tenancy/repository.js';
import { createDb } from '../../src/platform/db.js';
import { withTenant, type TenantContext, type TenantTx } from '../../src/platform/tenant.js';

// The tenancy scoped repository against the real database as alphakolect_app (ADR-15 T13–T15): another merchant's
// rows are not found — read or written — and every function refuses a query object withTenant did not open.

const db = createDb(inject('apiDatabaseUrl'));
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
beforeAll(() => owner.connect());
afterAll(async () => {
  await owner.end();
  await db.close();
});

const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;

async function merchant(name: string): Promise<TenantContext> {
  const identity = new IdentityRepository(db);
  const s = await identity.signupMerchantOwner(
    `repo-${randomBytes(5).toString('hex')}@example.test`,
    ARGON,
    name,
  );
  const {
    rows: [m],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  return Object.freeze({
    merchantId: s.merchant_id!,
    identityId: s.identity_id!,
    membershipId: m.id,
    sessionId: '01900000-0000-7000-8000-000000000001',
    audience: 'merchant',
    kind: 'owner',
    roleId: null,
    branchId: null,
  });
}

const as = <T>(tenant: TenantContext, fn: (tx: TenantTx) => Promise<T>) => withTenant(db, tenant, fn);

let a: TenantContext;
let b: TenantContext;
beforeAll(async () => {
  a = await merchant('Alpha Repo');
  b = await merchant('Beta Repo');
});

describe('the merchant row and the caller’s membership', () => {
  it('reads and renames only the session’s own merchant', async () => {
    expect(await as(a, (tx) => repo.merchant(tx))).toEqual({
      id: a.merchantId,
      name: 'Alpha Repo',
      status: 'pending_verification',
    });
    expect((await as(a, (tx) => repo.renameMerchant(tx, 'Alpha Renamed')))?.name).toBe('Alpha Renamed');
    const { rows } = await owner.query(`SELECT name FROM tenancy.merchants WHERE id = $1`, [b.merchantId]);
    expect(rows[0].name).toBe('Beta Repo');
  });

  it('finds the caller’s membership only in their own tenant', async () => {
    expect(await as(a, (tx) => repo.membership(tx))).toEqual({
      id: a.membershipId,
      kind: 'owner',
      role_id: null,
      branch_id: null,
    });
    // A context pairing B's tenant with A's membership finds nothing.
    expect(await as({ ...b, membershipId: a.membershipId }, (tx) => repo.membership(tx))).toBeNull();
  });
});

describe.each(['branches', 'roles'] as const)('%s', (table) => {
  it('creates, lists and reads within the tenant only', async () => {
    const mine = await as(a, (tx) => repo.createCatalogItem(tx, table, `Main ${table}`));
    const theirs = await as(b, (tx) => repo.createCatalogItem(tx, table, `Main ${table}`)); // same name: fine
    expect(mine).toMatchObject({ name: `Main ${table}`, status: 'active', archived_at: null });

    const listed = await as(a, (tx) => repo.listCatalog(tx, table));
    expect(listed.map((r) => r.id)).toContain(mine.id);
    expect(listed.map((r) => r.id)).not.toContain(theirs.id);

    expect(await as(a, (tx) => repo.getCatalogItem(tx, table, mine.id))).toEqual(mine);
    expect(await as(a, (tx) => repo.getCatalogItem(tx, table, theirs.id))).toBeNull();
  });

  it('cannot change another tenant’s item: not found, and the item is untouched', async () => {
    const theirs = await as(b, (tx) => repo.createCatalogItem(tx, table, `Theirs ${table}`));
    expect(
      await as(a, (tx) =>
        repo.updateCatalogItem(tx, table, theirs.id, { name: 'Hijacked', status: 'archived' }),
      ),
    ).toBeNull();
    expect(await as(b, (tx) => repo.getCatalogItem(tx, table, theirs.id))).toEqual(theirs);
  });

  it('refuses a second active item with the same name (case-insensitive), allows reuse after archiving', async () => {
    const first = await as(a, (tx) => repo.createCatalogItem(tx, table, `Dup ${table}`));
    await expect(as(a, (tx) => repo.createCatalogItem(tx, table, `DUP ${table}`))).rejects.toBeInstanceOf(
      NameTakenError,
    );

    const archived = await as(a, (tx) => repo.updateCatalogItem(tx, table, first.id, { status: 'archived' }));
    expect(archived).toMatchObject({ status: 'archived', archived_at: expect.any(Date) });
    const second = await as(a, (tx) => repo.createCatalogItem(tx, table, `Dup ${table}`));

    // Restoring the first would make two active items with one name.
    await expect(
      as(a, (tx) => repo.updateCatalogItem(tx, table, first.id, { status: 'active' })),
    ).rejects.toBeInstanceOf(NameTakenError);
    await as(a, (tx) => repo.updateCatalogItem(tx, table, second.id, { name: `Dup ${table} 2` }));
    expect(
      await as(a, (tx) => repo.updateCatalogItem(tx, table, first.id, { status: 'active' })),
    ).toMatchObject({ status: 'active', archived_at: null });
  });

  it('keeps the archive date when an archived item is renamed or archived again', async () => {
    const item = await as(a, (tx) => repo.createCatalogItem(tx, table, `Keep ${table}`));
    const archived = await as(a, (tx) => repo.updateCatalogItem(tx, table, item.id, { status: 'archived' }));
    const renamed = await as(a, (tx) =>
      repo.updateCatalogItem(tx, table, item.id, { name: `Kept ${table}` }),
    );
    const again = await as(a, (tx) => repo.updateCatalogItem(tx, table, item.id, { status: 'archived' }));
    expect(renamed).toMatchObject({
      name: `Kept ${table}`,
      status: 'archived',
      archived_at: archived!.archived_at,
    });
    expect(again!.archived_at).toEqual(archived!.archived_at);
  });
});

describe('no unscoped use (T14)', () => {
  it('every repository function refuses a query object that withTenant did not open — before querying', async () => {
    let queried = false;
    const forged: TenantTx = {
      tenant: a,
      query: async () => {
        queried = true;
        return [];
      },
    };
    const id = '01900000-0000-7000-8000-000000000002';
    for (const [name, fn] of Object.entries(repo)) {
      const call = fn as (tx: TenantTx, ...args: unknown[]) => Promise<unknown>;
      await expect(call(forged, 'branches', id, { name: 'x' }), name).rejects.toThrow(/withTenant/);
    }
    expect(queried).toBe(false);
  });
});
