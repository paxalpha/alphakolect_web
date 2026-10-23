import { randomBytes } from 'node:crypto';
import { PERMISSIONS } from '@alphakolect/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { IdentityRepository } from '../../src/modules/identity/repository.js';
import type { RequestContext } from '../../src/modules/identity/sessions.js';
import { newOpaqueToken } from '../../src/modules/identity/tokens.js';
import {
  NameTakenError,
  tenancyRepository as repo,
  type SettingsWrite,
} from '../../src/modules/tenancy/repository.js';
import { createDb } from '../../src/platform/db.js';
import { withTenant, type TenantContext, type TenantTx } from '../../src/platform/tenant.js';

// The tenancy scoped repository against the real database as alphakolect_app (ADR-15 T13–T15): another merchant's
// rows are not found — read or written — and every function refuses a query object withTenant did not open. Since
// P5.5 every function is a database function called with the session, which decides the business and the permission
// (ADR-16 B1): the session, not the tenant context, is what the database trusts.

const db = createDb(inject('apiDatabaseUrl'));
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
beforeAll(() => owner.connect());
afterAll(async () => {
  await owner.end();
  await db.close();
});

const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const CTX: RequestContext = { ip: '203.0.113.9', userAgent: 'repository-test', requestId: 'req-repository' };

/** An active business whose owner is signed in (a live session: the database functions require one). */
async function merchant(name: string): Promise<TenantContext> {
  const identity = new IdentityRepository(db);
  const s = await identity.signupMerchantOwner(
    `repo-${randomBytes(5).toString('hex')}@example.test`,
    ARGON,
    name,
  );
  const t = newOpaqueToken();
  await identity.issueOneTimeToken(s.identity_id!, 'email_verification', t.hash, 3600, null);
  await identity.verifyEmail(t.hash);
  const {
    rows: [m],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  const session = await identity.createSession({
    identityId: s.identity_id!,
    audience: 'merchant',
    membershipId: m.id,
    scope: 'full',
    refreshHash: newOpaqueToken().hash,
    lifetime: { idleSeconds: 86400, absoluteSeconds: 1209600 },
    ip: null,
    userAgent: null,
  });
  return Object.freeze({
    merchantId: s.merchant_id!,
    identityId: s.identity_id!,
    membershipId: m.id,
    sessionId: session.session_id,
    audience: 'merchant',
    kind: 'owner',
    roleId: null,
    branchId: null,
    branchStatus: null,
    permissions: PERMISSIONS.filter((p) => p.startsWith('merchant.')),
  });
}

const as = <T>(tenant: TenantContext, fn: (tx: TenantTx) => Promise<T>) => withTenant(db, tenant, fn);
const ok = <R>(write: SettingsWrite<R>): R => {
  expect(write.outcome).toBe('ok');
  return write.row!;
};

let a: TenantContext;
let b: TenantContext;
beforeAll(async () => {
  a = await merchant('Alpha Repo');
  b = await merchant('Beta Repo');
});

describe('the merchant row and the caller’s membership', () => {
  it('reads and renames only the session’s own merchant', async () => {
    expect(await as(a, (tx) => repo.profile(tx))).toEqual({
      id: a.merchantId,
      name: 'Alpha Repo',
      status: 'active',
    });
    expect(ok(await as(a, (tx) => repo.updateProfile(tx, 'Alpha Renamed', CTX))).name).toBe('Alpha Renamed');
    const { rows } = await owner.query(`SELECT name FROM tenancy.merchants WHERE id = $1`, [b.merchantId]);
    expect(rows[0].name).toBe('Beta Repo');
  });

  it('finds the caller’s membership and business from the session only', async () => {
    expect(await as(a, (tx) => repo.ownMembership(tx))).toEqual({
      membership_id: a.membershipId,
      kind: 'owner',
      role_id: null,
      branch_id: null,
      merchant_id: a.merchantId,
      merchant_name: 'Alpha Renamed',
      merchant_status: 'active',
    });
    // The tenant context cannot steer it: B's tenant with A's session still answers A; an unknown session, nothing.
    expect((await as({ ...b, sessionId: a.sessionId }, (tx) => repo.ownMembership(tx)))?.merchant_id).toBe(
      a.merchantId,
    );
    const unknown = { ...a, sessionId: '01900000-0000-7000-8000-000000000001' };
    expect(await as(unknown, (tx) => repo.ownMembership(tx))).toBeNull();
    expect(await as(unknown, (tx) => repo.profile(tx))).toBeNull();
    expect(await as(unknown, (tx) => repo.updateProfile(tx, 'Nobody', CTX))).toEqual({
      outcome: 'forbidden',
      row: null,
    });
  });
});

describe.each(['branches', 'roles'] as const)('%s', (table) => {
  /** A read of a row just written: a role also carries its permission set (P5.6) — none yet. */
  const asRead = <R extends object>(row: R) => (table === 'roles' ? { ...row, permissions: [] } : row);
  it('creates, lists and reads within the tenant only', async () => {
    const mine = ok(await as(a, (tx) => repo.createCatalogItem(tx, table, `Main ${table}`, CTX)));
    const theirs = ok(await as(b, (tx) => repo.createCatalogItem(tx, table, `Main ${table}`, CTX))); // same name: fine
    expect(mine).toMatchObject({ name: `Main ${table}`, status: 'active', archived_at: null });

    const listed = await as(a, (tx) => repo.listCatalog(tx, table));
    expect(listed.map((r) => r.id)).toContain(mine.id);
    expect(listed.map((r) => r.id)).not.toContain(theirs.id);

    expect(await as(a, (tx) => repo.getCatalogItem(tx, table, mine.id))).toEqual(asRead(mine));
    expect(await as(a, (tx) => repo.getCatalogItem(tx, table, theirs.id))).toBeNull();
  });

  it('cannot change another tenant’s item: not found, and the item is untouched', async () => {
    const theirs = ok(await as(b, (tx) => repo.createCatalogItem(tx, table, `Theirs ${table}`, CTX)));
    expect(
      await as(a, (tx) =>
        repo.updateCatalogItem(tx, table, theirs.id, { name: 'Hijacked', status: 'archived' }, CTX),
      ),
    ).toEqual({ outcome: 'not_found', row: null });
    expect(await as(b, (tx) => repo.getCatalogItem(tx, table, theirs.id))).toEqual(asRead(theirs));
  });

  it('refuses a second active item with the same name (case-insensitive), allows reuse after archiving', async () => {
    const first = ok(await as(a, (tx) => repo.createCatalogItem(tx, table, `Dup ${table}`, CTX)));
    await expect(
      as(a, (tx) => repo.createCatalogItem(tx, table, `DUP ${table}`, CTX)),
    ).rejects.toBeInstanceOf(NameTakenError);

    const archived = ok(
      await as(a, (tx) => repo.updateCatalogItem(tx, table, first.id, { status: 'archived' }, CTX)),
    );
    expect(archived).toMatchObject({ status: 'archived', archived_at: expect.any(Date) });
    const second = ok(await as(a, (tx) => repo.createCatalogItem(tx, table, `Dup ${table}`, CTX)));

    // Restoring the first would make two active items with one name.
    await expect(
      as(a, (tx) => repo.updateCatalogItem(tx, table, first.id, { status: 'active' }, CTX)),
    ).rejects.toBeInstanceOf(NameTakenError);
    await as(a, (tx) => repo.updateCatalogItem(tx, table, second.id, { name: `Dup ${table} 2` }, CTX));
    expect(
      ok(await as(a, (tx) => repo.updateCatalogItem(tx, table, first.id, { status: 'active' }, CTX))),
    ).toMatchObject({ status: 'active', archived_at: null });
  });

  it('keeps the archive date when an archived item is renamed or archived again', async () => {
    const item = ok(await as(a, (tx) => repo.createCatalogItem(tx, table, `Keep ${table}`, CTX)));
    const archived = ok(
      await as(a, (tx) => repo.updateCatalogItem(tx, table, item.id, { status: 'archived' }, CTX)),
    );
    const renamed = ok(
      await as(a, (tx) => repo.updateCatalogItem(tx, table, item.id, { name: `Kept ${table}` }, CTX)),
    );
    const again = ok(
      await as(a, (tx) => repo.updateCatalogItem(tx, table, item.id, { status: 'archived' }, CTX)),
    );
    expect(renamed).toMatchObject({
      name: `Kept ${table}`,
      status: 'archived',
      archived_at: archived.archived_at,
    });
    expect(again.archived_at).toEqual(archived.archived_at);
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
