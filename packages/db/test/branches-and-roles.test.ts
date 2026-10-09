import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';
import { FIXTURE } from './support/fixtures.js';

// P4.3 branches and roles (ADR-15 T7, T8, T13), as the API will use them: alphakolect_app inside a transaction with
// app.merchant_id set. Positive (same tenant works) and negative (other tenants, no context, grants, bypass
// attempts, mismatched composite references). inTenantTx rolls back, so nothing leaks between tests.

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

  it('same tenant: insert, read, rename and archive', async () => {
    await inTenantTx(app, A.merchantId, async (db) => {
      const name = unique('North');
      const {
        rows: [row],
      } = await db.query(
        `INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2) RETURNING id, status`,
        [A.merchantId, name],
      );
      expect(row.status).toBe('active');
      await db.query(`UPDATE tenancy.${table} SET name = $2, updated_at = now() WHERE id = $1`, [
        row.id,
        `${name} 2`,
      ]);
      await db.query(`UPDATE tenancy.${table} SET status = 'archived', archived_at = now() WHERE id = $1`, [
        row.id,
      ]);
      const { rows } = await db.query(`SELECT name, status FROM tenancy.${table} WHERE id = $1`, [row.id]);
      expect(rows).toEqual([{ name: `${name} 2`, status: 'archived' }]);
    });
  });

  it('another tenant’s rows are invisible and unchangeable', async () => {
    await inTenantTx(app, A.merchantId, async (db) => {
      expect((await db.query(`SELECT 1 FROM tenancy.${table} WHERE id = $1`, [foreignId])).rowCount).toBe(0);
      const updated = await db.query(`UPDATE tenancy.${table} SET name = 'Hijacked' WHERE id = $1`, [
        foreignId,
      ]);
      expect(updated.rowCount).toBe(0);
      expect((await db.query(`SELECT DISTINCT merchant_id::text AS m FROM tenancy.${table}`)).rows).toEqual([
        { m: A.merchantId },
      ]);
    });
    const { rows } = await owner.query(`SELECT name FROM tenancy.${table} WHERE id = $1`, [foreignId]);
    expect(rows[0].name).not.toBe('Hijacked');
  });

  it('cannot insert a row for another tenant', async () => {
    await inTenantTx(app, A.merchantId, (db) =>
      expectSqlState(
        db.query(`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2)`, [
          B.merchantId,
          unique('X'),
        ]),
        SQLSTATE.rlsViolation,
      ),
    );
  });

  it('without a tenant context: sees nothing and writes nothing', async () => {
    await inTenantTx(app, null, async (db) => {
      expect((await db.query(`SELECT 1 FROM tenancy.${table}`)).rowCount).toBe(0);
    });
    await inTenantTx(app, null, (db) =>
      expectSqlState(
        db.query(`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2)`, [
          A.merchantId,
          unique('X'),
        ]),
        SQLSTATE.rlsViolation,
      ),
    );
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

  it('cannot switch row security off', async () => {
    await inTenantTx(app, A.merchantId, async (db) => {
      await db.query('SET LOCAL row_security = off');
      // For a role subject to RLS, Postgres refuses the query instead of silently bypassing the policy.
      await expectSqlState(db.query(`SELECT 1 FROM tenancy.${table}`), SQLSTATE.insufficientPrivilege);
    });
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
      await inTenantTx(app, A.merchantId, (db) =>
        expectSqlState(
          db.query(`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2)`, [A.merchantId, bad]),
          SQLSTATE.checkViolation,
        ),
      );
    }
    const name = unique('Main');
    await inTenantTx(app, A.merchantId, async (db) => {
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
    await inTenantTx(app, A.merchantId, async (db) => {
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
    await inTenantTx(app, B.merchantId, (db) =>
      db.query(`INSERT INTO tenancy.${table} (merchant_id, name) VALUES ($1, $2)`, [B.merchantId, name]),
    );
  });

  it('archiving is consistent: archived ⇔ archived_at set', async () => {
    await inTenantTx(app, A.merchantId, (db) =>
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
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'staff') RETURNING id`,
      [A.merchantId, identity.id],
    );
    return m.id as string;
  }

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
