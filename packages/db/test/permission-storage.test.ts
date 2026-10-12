import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';
import { FIXTURE } from './support/fixtures.js';

// P5.1 (TARGET_ARCHITECTURE ADR-16 §3.5; P5 plan §4 invariants 1, 3, 4, §6): the permission catalog and the two grant
// tables. No function writes them yet (the writers arrive in P5.6 and P5.7), so the database rules are exercised as the
// table owner — the only role that can write — inside transactions that roll back. The app and readonly roles are
// shown to hold no privilege on any of the three tables.

const { A, B } = FIXTURE;
let owner: pg.Client;
let app: pg.Client;
let readonly: pg.Client;

beforeAll(async () => {
  owner = await connectAs('migrator');
  app = await connectAs('app');
  readonly = await connectAs('readonly');
});
afterAll(async () => {
  await Promise.all([owner.end(), app.end(), readonly.end()]);
});

/** The catalog frozen in P5.0 (plan §6): identifier, scope, grantable. */
const CATALOG: ReadonlyArray<readonly [string, 'merchant' | 'platform', boolean]> = [
  ['merchant.profile.read', 'merchant', true],
  ['merchant.profile.update', 'merchant', true],
  ['merchant.branches.read', 'merchant', true],
  ['merchant.branches.manage', 'merchant', true],
  ['merchant.roles.read', 'merchant', true],
  ['merchant.roles.manage', 'merchant', false],
  ['merchant.members.read', 'merchant', true],
  ['merchant.members.manage', 'merchant', false],
  ['merchant.invitations.read', 'merchant', true],
  ['merchant.invitations.manage', 'merchant', false],
  ['merchant.audit.read', 'merchant', false],
  ['platform.merchants.read', 'platform', true],
  ['platform.audit.read', 'platform', true],
  ['platform.merchants.lifecycle', 'platform', false],
  ['platform.merchants.transfer_ownership', 'platform', false],
  ['platform.staff.manage', 'platform', false],
];
const RESERVED_MERCHANT = CATALOG.filter(([, s, g]) => s === 'merchant' && !g).map(([id]) => id);
const RESERVED_PLATFORM = CATALOG.filter(([, s, g]) => s === 'platform' && !g).map(([id]) => id);
const GRANTABLE_MERCHANT = CATALOG.filter(([, s, g]) => s === 'merchant' && g).map(([id]) => id);
const GRANTABLE_PLATFORM = CATALOG.filter(([, s, g]) => s === 'platform' && g).map(([id]) => id);

/** Run as the table owner in a transaction that is always rolled back. */
const asOwner = <T>(fn: (db: pg.Client) => Promise<T>) => inTenantTx(owner, null, fn);

/** Add a retired permission inside the current transaction (the seed has none). */
async function retiredPermission(db: pg.Client, scope: 'merchant' | 'platform') {
  // Identifiers are lower-case letters, underscores and dots only (plan §6), so the random part uses letters.
  const letters = randomBytes(4)
    .toString('hex')
    .replace(/[0-9]/g, (d) => 'ghijklmnop'[Number(d)]!);
  const identifier = `${scope}.test_${letters}.read`;
  await db.query(
    `INSERT INTO identity.permission_catalog (identifier, scope, grantable, status) VALUES ($1, $2, true, 'retired')`,
    [identifier, scope],
  );
  return identifier;
}

/** A platform staff membership inside the current transaction. */
async function platformStaff(db: pg.Client) {
  const {
    rows: [identity],
  } = await db.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
    `staff-${process.pid}-${randomBytes(4).toString('hex')}@example.test`,
  ]);
  const {
    rows: [membership],
  } = await db.query(
    `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'support') RETURNING id`,
    [identity.id],
  );
  return membership.id as string;
}

const grantRefused = (constraint: string) => async (promise: Promise<unknown>) => {
  const err = await expectSqlState(promise, SQLSTATE.checkViolation);
  expect(err.constraint).toBe(constraint);
};

describe('identity.permission_catalog', () => {
  it('holds exactly the permissions frozen in P5.0, all active (plan §6)', async () => {
    const { rows } = await owner.query(
      `SELECT identifier, scope, grantable, status FROM identity.permission_catalog`,
    );
    const actual = rows.map((r) => [r.identifier, r.scope, r.grantable, r.status]).sort();
    const expected = CATALOG.map(([id, scope, grantable]) => [id, scope, grantable, 'active']).sort();
    expect(actual).toEqual(expected);
  });

  it.each([
    ['upper case', 'Merchant.profile.read', 'merchant', 'active'],
    ['a single segment', 'merchant', 'merchant', 'active'],
    ['an empty segment', 'merchant..read', 'merchant', 'active'],
    ['a trailing dot', 'merchant.profile.', 'merchant', 'active'],
    ['an unknown scope', 'tenant.profile.read', 'tenant', 'active'],
    ['a scope that differs from the first segment', 'merchant.staff.read', 'platform', 'active'],
    ['an unknown status', 'merchant.staff.read', 'merchant', 'deleted'],
  ])('refuses a row with %s', async (_label, identifier, scope, status) => {
    await asOwner((db) =>
      expectSqlState(
        db.query(
          `INSERT INTO identity.permission_catalog (identifier, scope, grantable, status) VALUES ($1, $2, true, $3)`,
          [identifier, scope, status],
        ),
        SQLSTATE.checkViolation,
      ),
    );
  });

  it.each([
    [
      'scope',
      `UPDATE identity.permission_catalog SET scope = 'platform' WHERE identifier = 'merchant.profile.read'`,
    ],
    [
      'grantable',
      `UPDATE identity.permission_catalog SET grantable = true WHERE identifier = 'merchant.roles.manage'`,
    ],
    [
      'the identifier',
      `UPDATE identity.permission_catalog SET identifier = 'merchant.profile.view' WHERE identifier = 'merchant.profile.read'`,
    ],
    ['created_at', `UPDATE identity.permission_catalog SET created_at = now() - interval '1 day'`],
    ['a row, by DELETE', `DELETE FROM identity.permission_catalog WHERE identifier = 'merchant.audit.read'`],
    ['every row, by TRUNCATE', `TRUNCATE identity.permission_catalog CASCADE`],
  ])('never changes %s — not even for the owner', async (_label, sql) => {
    await asOwner((db) => expectSqlState(db.query(sql), SQLSTATE.restrictViolation));
  });

  it('a permission can be retired, and a retired permission is never re-activated', async () => {
    await asOwner(async (db) => {
      await db.query(
        `UPDATE identity.permission_catalog SET status = 'retired' WHERE identifier = 'merchant.profile.read'`,
      );
      await expectSqlState(
        db.query(
          `UPDATE identity.permission_catalog SET status = 'active' WHERE identifier = 'merchant.profile.read'`,
        ),
        SQLSTATE.restrictViolation,
      );
    });
  });

  it.each([
    ['SELECT', `SELECT identifier FROM identity.permission_catalog`],
    [
      'INSERT',
      `INSERT INTO identity.permission_catalog (identifier, scope, grantable) VALUES ('merchant.x.read', 'merchant', true)`,
    ],
    ['UPDATE', `UPDATE identity.permission_catalog SET status = 'retired'`],
    ['DELETE', `DELETE FROM identity.permission_catalog`],
  ])('the app and readonly roles hold no privilege: %s is refused', async (_op, sql) => {
    for (const db of [app, readonly]) {
      await inTenantTx(db, A.merchantId, (tx) =>
        expectSqlState(tx.query(sql), SQLSTATE.insufficientPrivilege),
      );
    }
  });
});

describe('tenancy.role_permissions', () => {
  const insert = (db: pg.Client, merchantId: string, roleId: string, permission: string) =>
    db.query(`INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission) VALUES ($1, $2, $3)`, [
      merchantId,
      roleId,
      permission,
    ]);
  const refused = grantRefused('role_permissions_permission_grantable');

  it('stores every grantable merchant permission for a role of the same merchant', async () => {
    await asOwner(async (db) => {
      for (const permission of GRANTABLE_MERCHANT) await insert(db, A.merchantId, A.roleId, permission);
      const { rows } = await db.query(`SELECT permission FROM tenancy.role_permissions WHERE role_id = $1`, [
        A.roleId,
      ]);
      expect(rows.map((r) => r.permission).sort()).toEqual([...GRANTABLE_MERCHANT].sort());
    });
  });

  it.each(RESERVED_MERCHANT)('refuses the reserved permission %s (owner only)', async (permission) => {
    await asOwner((db) => refused(insert(db, A.merchantId, A.roleId, permission)));
  });

  it.each([...GRANTABLE_PLATFORM, ...RESERVED_PLATFORM])(
    'refuses the platform permission %s',
    async (permission) => {
      await asOwner((db) => refused(insert(db, A.merchantId, A.roleId, permission)));
    },
  );

  it('refuses a retired permission', async () => {
    await asOwner(async (db) =>
      refused(insert(db, A.merchantId, A.roleId, await retiredPermission(db, 'merchant'))),
    );
  });

  it('refuses an update that would turn a grant into a reserved permission', async () => {
    await asOwner(async (db) => {
      await insert(db, A.merchantId, A.roleId, 'merchant.members.read');
      await refused(
        db.query(
          `UPDATE tenancy.role_permissions SET permission = 'merchant.members.manage'
            WHERE role_id = $1 AND permission = 'merchant.members.read'`,
          [A.roleId],
        ),
      );
    });
  });

  it('refuses an unknown permission', async () => {
    await asOwner((db) =>
      expectSqlState(
        insert(db, A.merchantId, A.roleId, 'merchant.unknown.read'),
        SQLSTATE.foreignKeyViolation,
      ),
    );
  });

  it('refuses another merchant’s role (composite key)', async () => {
    await asOwner((db) =>
      expectSqlState(
        insert(db, A.merchantId, B.roleId, 'merchant.profile.read'),
        SQLSTATE.foreignKeyViolation,
      ),
    );
  });

  it('stores a permission once per role', async () => {
    await asOwner(async (db) => {
      await insert(db, A.merchantId, A.roleId, 'merchant.profile.read');
      await expectSqlState(
        insert(db, A.merchantId, A.roleId, 'merchant.profile.read'),
        SQLSTATE.uniqueViolation,
      );
    });
  });

  it('retiring a permission keeps existing grant rows as history', async () => {
    await asOwner(async (db) => {
      await insert(db, A.merchantId, A.roleId, 'merchant.branches.read');
      await db.query(
        `UPDATE identity.permission_catalog SET status = 'retired' WHERE identifier = 'merchant.branches.read'`,
      );
      const { rowCount } = await db.query(
        `SELECT 1 FROM tenancy.role_permissions WHERE role_id = $1 AND permission = 'merchant.branches.read'`,
        [A.roleId],
      );
      expect(rowCount).toBe(1);
    });
  });

  it.each([
    ['SELECT', `SELECT permission FROM tenancy.role_permissions`],
    [
      'INSERT',
      `INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission) VALUES ('${A.merchantId}', '${A.roleId}', 'merchant.profile.read')`,
    ],
    ['UPDATE', `UPDATE tenancy.role_permissions SET permission = 'merchant.profile.read'`],
    ['DELETE', `DELETE FROM tenancy.role_permissions`],
  ])(
    'the app and readonly roles hold no privilege: %s is refused, even in their own tenant',
    async (_op, sql) => {
      for (const db of [app, readonly]) {
        await inTenantTx(db, A.merchantId, (tx) =>
          expectSqlState(tx.query(sql), SQLSTATE.insufficientPrivilege),
        );
      }
    },
  );
});

describe('identity.platform_membership_grants', () => {
  const insert = (db: pg.Client, membershipId: string, permission: string) =>
    db.query(
      `INSERT INTO identity.platform_membership_grants (platform_membership_id, permission) VALUES ($1, $2)`,
      [membershipId, permission],
    );
  const refused = grantRefused('platform_membership_grants_permission_grantable');

  it('stores every grantable platform permission for a platform membership', async () => {
    await asOwner(async (db) => {
      const staff = await platformStaff(db);
      for (const permission of GRANTABLE_PLATFORM) await insert(db, staff, permission);
      const { rows } = await db.query(
        `SELECT permission FROM identity.platform_membership_grants WHERE platform_membership_id = $1`,
        [staff],
      );
      expect(rows.map((r) => r.permission).sort()).toEqual([...GRANTABLE_PLATFORM].sort());
    });
  });

  it.each(RESERVED_PLATFORM)('refuses the reserved permission %s (super admin only)', async (permission) => {
    await asOwner(async (db) => refused(insert(db, await platformStaff(db), permission)));
  });

  it.each([...GRANTABLE_MERCHANT, ...RESERVED_MERCHANT])(
    'refuses the merchant permission %s',
    async (permission) => {
      await asOwner(async (db) => refused(insert(db, await platformStaff(db), permission)));
    },
  );

  it('refuses a retired permission', async () => {
    await asOwner(async (db) =>
      refused(insert(db, await platformStaff(db), await retiredPermission(db, 'platform'))),
    );
  });

  it('refuses an update that would turn a grant into a reserved permission', async () => {
    await asOwner(async (db) => {
      const staff = await platformStaff(db);
      await insert(db, staff, 'platform.audit.read');
      await refused(
        db.query(
          `UPDATE identity.platform_membership_grants SET permission = 'platform.staff.manage'
            WHERE platform_membership_id = $1`,
          [staff],
        ),
      );
    });
  });

  it('refuses an unknown permission or an unknown membership', async () => {
    await asOwner(async (db) => {
      await expectSqlState(
        insert(db, await platformStaff(db), 'platform.unknown.read'),
        SQLSTATE.foreignKeyViolation,
      );
    });
    await asOwner((db) =>
      expectSqlState(
        insert(db, '01900000-0000-7000-8000-0000000000ff', 'platform.audit.read'),
        SQLSTATE.foreignKeyViolation,
      ),
    );
  });

  it.each([
    ['SELECT', `SELECT permission FROM identity.platform_membership_grants`],
    [
      'INSERT',
      `INSERT INTO identity.platform_membership_grants (platform_membership_id, permission) VALUES ('01900000-0000-7000-8000-0000000000ff', 'platform.audit.read')`,
    ],
    ['UPDATE', `UPDATE identity.platform_membership_grants SET permission = 'platform.audit.read'`],
    ['DELETE', `DELETE FROM identity.platform_membership_grants`],
  ])('the app and readonly roles hold no privilege: %s is refused', async (_op, sql) => {
    for (const db of [app, readonly]) {
      await inTenantTx(db, null, (tx) => expectSqlState(tx.query(sql), SQLSTATE.insufficientPrivilege));
    }
  });
});

// P5.1 gate review: "no access" must hold at the SQL privilege level, through role membership included — not only for
// the statements tried above, and not by relying on row-level security.
describe('effective privileges on the permission storage (inheritance included)', () => {
  const TABLES = [
    'identity.permission_catalog',
    'tenancy.role_permissions',
    'identity.platform_membership_grants',
  ];
  const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

  it.each(['alphakolect_app', 'alphakolect_readonly'])(
    '%s belongs to no other role, so it inherits nothing',
    async (role) => {
      const { rows } = await owner.query(
        `SELECT m.roleid::regrole::text AS granted FROM pg_auth_members m WHERE m.member = $1::regrole`,
        [role],
      );
      expect(rows).toEqual([]);
    },
  );

  it.each(['alphakolect_app', 'alphakolect_readonly'])(
    '%s holds no table or column privilege on any of the three tables (has_*_privilege: effective, PUBLIC included)',
    async (role) => {
      const { rows } = await owner.query(
        `SELECT t AS "table", p AS privilege
           FROM unnest($1::text[]) AS t, unnest($2::text[]) AS p
          WHERE has_table_privilege($3, t, p)
         UNION ALL
         SELECT t, 'some column' FROM unnest($1::text[]) AS t
          WHERE has_any_column_privilege($3, t, 'SELECT, INSERT, UPDATE, REFERENCES')`,
        [TABLES, PRIVILEGES, role],
      );
      expect(rows).toEqual([]);
    },
  );

  it.each([
    `ALTER TABLE identity.permission_catalog DISABLE TRIGGER permission_catalog_protected`,
    `ALTER TABLE tenancy.role_permissions DISABLE TRIGGER role_permissions_grantable`,
    `ALTER TABLE identity.platform_membership_grants DISABLE TRIGGER platform_membership_grants_grantable`,
    `ALTER TABLE tenancy.role_permissions DISABLE ROW LEVEL SECURITY`,
  ])(
    'the app cannot switch a protection off (only the owner, through a reviewed migration): %s',
    async (sql) => {
      await expectSqlState(app.query(sql), SQLSTATE.insufficientPrivilege);
    },
  );
});
