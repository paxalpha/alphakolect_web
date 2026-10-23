import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';
import { FIXTURE } from './support/fixtures.js';

// P4.3 branches and roles (ADR-15 T7, T8, T13): the tables' own rules — names, archiving, composite references —
// which hold for every writer, and the roles' privileges. Since P5.5 (the enforcement boundary, ADR-16 B1) the app
// has no direct access to either table: it reads and writes them only through the database functions, whose tenant
// isolation, authority and audit are tested in enforcement.test.ts; the table rules are exercised here as the table
// owner. inTenantTx rolls back, so nothing leaks between tests.

const { A, B } = FIXTURE;
let app: pg.Client;
let readonly: pg.Client;
let owner: pg.Client;

beforeAll(async () => {
  app = await connectAs('app');
  readonly = await connectAs('readonly');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await Promise.all([app.end(), readonly.end(), owner.end()]);
});

const unique = (label: string) => `${label} ${randomBytes(3).toString('hex')}`;

describe.each(['branches', 'roles'] as const)('tenancy.%s', (table) => {
  const ownId = table === 'branches' ? A.branchId : A.roleId;
  const foreignId = table === 'branches' ? B.branchId : B.roleId;

  it('the app has no direct access, whatever the tenant context: no read, no insert, no update (P5.5)', async () => {
    for (const tenant of [A.merchantId, null]) {
      for (const [sql, params] of [
        [`SELECT 1 FROM tenancy.${table} WHERE id = $1`, [ownId]],
        [`SELECT 1 FROM tenancy.${table} WHERE id = $1`, [foreignId]],
        [`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2)`, [A.merchantId, unique('X')]],
        [`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2)`, [B.merchantId, unique('X')]],
        [`UPDATE tenancy.${table} SET name = 'Hijacked' WHERE id = $1`, [ownId]],
        [`UPDATE tenancy.${table} SET name = 'Hijacked' WHERE id = $1`, [foreignId]],
      ] as const) {
        await inTenantTx(app, tenant, (db) =>
          expectSqlState(db.query(sql, [...params]), SQLSTATE.insufficientPrivilege),
        );
      }
    }
    const { rows } = await owner.query(`SELECT name FROM tenancy.${table} WHERE id = ANY($1)`, [
      [ownId, foreignId],
    ]);
    expect(rows.map((r) => r.name)).not.toContain('Hijacked');
  });

  it.each([
    ['delete (archive instead)', `DELETE FROM tenancy.${table} WHERE id = $1`],
    ['move a row to another tenant', `UPDATE tenancy.${table} SET merchant_id = merchant_id WHERE id = $1`],
    ['rewrite its creation time', `UPDATE tenancy.${table} SET created_at = now() WHERE id = $1`],
  ])('may not %s', async (_label, sql) => {
    await inTenantTx(app, A.merchantId, (db) =>
      expectSqlState(db.query(sql, [ownId]), SQLSTATE.insufficientPrivilege),
    );
  });

  it('readonly sees every tenant and writes nothing', async () => {
    const { rows } = await readonly.query(
      `SELECT count(DISTINCT merchant_id)::int AS n FROM tenancy.${table} WHERE id = ANY($1)`,
      [[ownId, foreignId]],
    );
    expect(rows[0].n).toBe(2);
    await expectSqlState(
      readonly.query(`UPDATE tenancy.${table} SET name = 'x' WHERE id = $1`, [ownId]),
      SQLSTATE.insufficientPrivilege,
    );
  });

  it('names: trimmed, 1–120 characters, one active per merchant (case-insensitive); reusable once archived and across merchants', async () => {
    for (const bad of ['', ' padded ', 'x'.repeat(121)]) {
      await inTenantTx(owner, A.merchantId, (db) =>
        expectSqlState(
          db.query(`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2)`, [A.merchantId, bad]),
          SQLSTATE.checkViolation,
        ),
      );
    }
    const name = unique('Main');
    await inTenantTx(owner, A.merchantId, async (db) => {
      await db.query(`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2)`, [
        A.merchantId,
        name,
      ]);
      await expectSqlState(
        db.query(`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2)`, [
          A.merchantId,
          name.toUpperCase(),
        ]),
        SQLSTATE.uniqueViolation,
      );
    });
    await inTenantTx(owner, A.merchantId, async (db) => {
      const {
        rows: [first],
      } = await db.query(`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
        A.merchantId,
        name,
      ]);
      await db.query(`UPDATE tenancy.${table} SET status = 'archived', archived_at = now() WHERE id = $1`, [
        first.id,
      ]);
      await db.query(`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2)`, [
        A.merchantId,
        name,
      ]);
    });
    await inTenantTx(owner, B.merchantId, (db) =>
      db.query(`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2)`, [B.merchantId, name]),
    );
  });

  it('archiving is consistent: archived ⇔ archived_at set', async () => {
    await inTenantTx(owner, A.merchantId, (db) =>
      expectSqlState(
        db.query(`UPDATE tenancy.${table} SET status = 'archived' WHERE id = $1`, [ownId]),
        SQLSTATE.checkViolation,
      ),
    );
  });
});

describe('a staff membership’s role and branch', () => {
  /** A staff membership of merchant A (inserted by the owner; the app cannot write memberships). */
  async function staffOfA() {
    const {
      rows: [identity],
    } = await owner.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
      `staff-${process.pid}-${randomBytes(4).toString('hex')}@example.test`,
    ]);
    const {
      rows: [m],
    } = await owner.query(
      `WITH r AS (INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Staff ' || gen_random_uuid()) RETURNING id)
       INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id)
       SELECT $1, $2, 'staff', r.id FROM r RETURNING id`,
      [A.merchantId, identity.id],
    );
    return m.id as string;
  }

  it('a staff membership must have a role (ADR-15 T8): none at creation, none taken away', async () => {
    const {
      rows: [identity],
    } = await owner.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
      `roleless-${process.pid}-${randomBytes(4).toString('hex')}@example.test`,
    ]);
    await expectSqlState(
      owner.query(
        `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'staff')`,
        [A.merchantId, identity.id],
      ),
      SQLSTATE.checkViolation,
    );
    const id = await staffOfA();
    await expectSqlState(
      owner.query(`UPDATE tenancy.merchant_memberships SET role_id = NULL WHERE id = $1`, [id]),
      SQLSTATE.checkViolation,
    );
  });

  it('the T8 migration refuses to run over role-less staff instead of inventing roles (its own guard, in a rolled-back transaction)', async () => {
    const sql = readFileSync(
      new URL('../prisma/migrations/20261010000100_staff_role_required/migration.sql', import.meta.url),
      'utf8',
    );
    const guard = /DO \$guard\$[\s\S]*?\$guard\$;/.exec(sql)?.[0];
    expect(guard).toBeDefined();
    await owner.query('BEGIN');
    try {
      await owner.query(
        `ALTER TABLE tenancy.merchant_memberships DROP CONSTRAINT merchant_memberships_staff_has_role`,
      );
      const {
        rows: [identity],
      } = await owner.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
        `legacy-staff-${process.pid}-${randomBytes(4).toString('hex')}@example.test`,
      ]);
      await owner.query(
        `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'staff')`,
        [A.merchantId, identity.id],
      );
      const err = await expectSqlState(owner.query(guard!), SQLSTATE.checkViolation);
      expect(err.message).toMatch(/staff membership\(s\) without a role\. ADR-15 T8 requires one/);
    } finally {
      await owner.query('ROLLBACK');
    }
  });

  it('a staff membership may move to another role of its own merchant', async () => {
    const id = await staffOfA();
    await owner.query(`UPDATE tenancy.merchant_memberships SET role_id = $2 WHERE id = $1`, [id, A.roleId]);
    const { rows } = await owner.query(`SELECT role_id FROM tenancy.merchant_memberships WHERE id = $1`, [
      id,
    ]);
    expect(rows[0].role_id).toBe(A.roleId);
  });

  it('an owner cannot become staff without a role (ownership transfer must assign one, T17)', async () => {
    const m = await owner.query(
      `INSERT INTO tenancy.merchants (name, status) VALUES ('Transfer Test', 'active') RETURNING id`,
    );
    const {
      rows: [identity],
    } = await owner.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
      `former-owner-${process.pid}-${randomBytes(4).toString('hex')}@example.test`,
    ]);
    const {
      rows: [membership],
    } = await owner.query(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'owner') RETURNING id`,
      [m.rows[0].id, identity.id],
    );
    await expectSqlState(
      owner.query(`UPDATE tenancy.merchant_memberships SET kind = 'staff' WHERE id = $1`, [membership.id]),
      SQLSTATE.checkViolation,
    );
  });

  it('may reference its own merchant’s role and branch; NULL branch = all branches (the default)', async () => {
    const id = await staffOfA();
    const { rows } = await owner.query(`SELECT branch_id FROM tenancy.merchant_memberships WHERE id = $1`, [
      id,
    ]);
    expect(rows[0].branch_id).toBeNull();
    await owner.query(`UPDATE tenancy.merchant_memberships SET role_id = $2, branch_id = $3 WHERE id = $1`, [
      id,
      A.roleId,
      A.branchId,
    ]);
  });

  it.each([
    ['another merchant’s role', 'role_id', () => B.roleId],
    ['another merchant’s branch', 'branch_id', () => B.branchId],
  ])('can never reference %s (composite foreign key)', async (_label, column, value) => {
    const id = await staffOfA();
    await expectSqlState(
      owner.query(`UPDATE tenancy.merchant_memberships SET ${column} = $2 WHERE id = $1`, [id, value()]),
      SQLSTATE.foreignKeyViolation,
    );
  });

  it.each([
    ['an owner', 'role_id', () => A.ownerMembershipId, () => A.roleId],
    ['an owner', 'branch_id', () => A.ownerMembershipId, () => A.branchId],
  ])('%s has no %s (fixed capability set, BR-3)', async (_label, column, membership, value) => {
    await expectSqlState(
      owner.query(`UPDATE tenancy.merchant_memberships SET ${column} = $2 WHERE id = $1`, [
        membership(),
        value(),
      ]),
      SQLSTATE.checkViolation,
    );
  });

  it('an agent has no role or branch', async () => {
    const {
      rows: [identity],
    } = await owner.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
      `agent-${process.pid}-${randomBytes(4).toString('hex')}@example.test`,
    ]);
    await expectSqlState(
      owner.query(
        `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, 'agent', $3)`,
        [A.merchantId, identity.id, A.roleId],
      ),
      SQLSTATE.checkViolation,
    );
  });

  it('the app cannot assign a role or branch directly (that comes as a function in P4.5)', async () => {
    const id = await staffOfA();
    await inTenantTx(app, A.merchantId, (db) =>
      expectSqlState(
        db.query(`UPDATE tenancy.merchant_memberships SET role_id = $2 WHERE id = $1`, [id, A.roleId]),
        SQLSTATE.insufficientPrivilege,
      ),
    );
  });

  it('a role or branch in use cannot be deleted out from under a membership', async () => {
    const id = await staffOfA();
    await owner.query(`UPDATE tenancy.merchant_memberships SET role_id = $2, branch_id = $3 WHERE id = $1`, [
      id,
      A.roleId,
      A.branchId,
    ]);
    await expectSqlState(
      owner.query(`DELETE FROM tenancy.roles WHERE id = $1`, [A.roleId]),
      SQLSTATE.foreignKeyViolation,
    );
    await expectSqlState(
      owner.query(`DELETE FROM tenancy.branches WHERE id = $1`, [A.branchId]),
      SQLSTATE.foreignKeyViolation,
    );
  });
});
