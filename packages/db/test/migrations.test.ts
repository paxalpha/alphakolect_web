import { readdirSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';
import { FIXTURE } from './support/fixtures.js';
import { migrateDeploy } from './support/setup-db.js';

const MODULE_SCHEMAS = [
  'audit',
  'billing',
  'customers',
  'documents',
  'identity',
  'investments',
  'jobs',
  'kyc',
  'ledger',
  'loans',
  'notifications',
  'payments',
  'savings',
  'support',
  'tenancy',
  'util',
];

const TABLES = [
  'audit.audit_events',
  'ledger.accounts',
  'ledger.balance_projection',
  'ledger.journal_entries',
  'ledger.journal_lines',
  'ledger.ledgers',
  'tenancy.merchants',
];

let owner: pg.Client;

beforeAll(async () => {
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await owner.end();
});

describe('migrations from zero (P1 exit criterion)', () => {
  it('applied every migration in the repository, all finished, none rolled back', async () => {
    const onDisk = readdirSync(new URL('../prisma/migrations', import.meta.url), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const { rows } = await owner.query(
      `SELECT migration_name FROM public._prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    );
    expect(rows.map((r) => r.migration_name)).toEqual(onDisk);
  });

  it('re-running migrate deploy is a no-op', () => {
    expect(migrateDeploy(inject('testDatabase'))).toMatch(/No pending migrations to apply/);
  });

  it('created one schema per module (TARGET_ARCHITECTURE §19)', async () => {
    const { rows } = await owner.query(
      `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1) ORDER BY nspname`,
      [MODULE_SCHEMAS],
    );
    expect(rows.map((r) => r.nspname)).toEqual(MODULE_SCHEMAS);
  });

  it('created exactly the P1 tables, all owned by the migrator (never the app role)', async () => {
    const { rows } = await owner.query(
      `SELECT n.nspname || '.' || c.relname AS name, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY($1) ORDER BY 1`,
      [MODULE_SCHEMAS],
    );
    expect(rows.map((r) => r.name)).toEqual(TABLES);
    expect(new Set(rows.map((r) => r.owner))).toEqual(new Set(['alphakolect_migrator']));
  });
});

describe('ids and tenant keys', () => {
  it('generates UUIDv7 ids by default', async () => {
    const { rows } = await owner.query(`SELECT util.uuid_v7()::text AS id`);
    expect(rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("composite (merchant_id, id) keys reject a reference to another merchant's ledger", async () => {
    await owner.query('BEGIN');
    try {
      await expectSqlState(
        owner.query(
          `INSERT INTO ledger.accounts (merchant_id, ledger_id, code, name, type)
           VALUES ($1, $2, '9999', 'Cross-tenant', 'asset')`,
          [FIXTURE.A.merchantId, FIXTURE.B.ledgerId],
        ),
        SQLSTATE.foreignKeyViolation,
      );
    } finally {
      await owner.query('ROLLBACK');
    }
  });
});
