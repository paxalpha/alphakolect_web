import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';
import { FIXTURE } from './support/fixtures.js';

// Every test here connects as the real database role with its own login, and attempts the SQL
// directly. Nothing goes through application code.

const A = FIXTURE.A;
let app: pg.Client;
let readonly: pg.Client;

beforeAll(async () => {
  app = await connectAs('app');
  readonly = await connectAs('readonly');
});
afterAll(async () => {
  await app.end();
  await readonly.end();
});

describe('alphakolect_app role attributes', () => {
  it('is a plain login role: not superuser, cannot bypass RLS, create roles or databases', async () => {
    const { rows } = await app.query(
      `SELECT current_user AS me, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
       FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]).toEqual({
      me: 'alphakolect_app',
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
  });

  it('cannot become the migrator (no role membership)', async () => {
    await expectSqlState(app.query('SET ROLE alphakolect_migrator'), SQLSTATE.insufficientPrivilege);
  });
});

describe('ledger lines and entries are INSERT-only for the app (P1 exit criterion)', () => {
  const attempts: Array<[string, string, unknown[]]> = [
    [
      'UPDATE journal_lines',
      `UPDATE ledger.journal_lines SET amount_minor = 1 WHERE entry_id = $1`,
      [A.entryId],
    ],
    ['DELETE journal_lines', `DELETE FROM ledger.journal_lines WHERE entry_id = $1`, [A.entryId]],
    ['TRUNCATE journal_lines', `TRUNCATE ledger.journal_lines`, []],
    [
      'UPDATE journal_entries',
      `UPDATE ledger.journal_entries SET narrative = 'x' WHERE id = $1`,
      [A.entryId],
    ],
    ['DELETE journal_entries', `DELETE FROM ledger.journal_entries WHERE id = $1`, [A.entryId]],
    ['TRUNCATE journal_entries', `TRUNCATE ledger.journal_entries CASCADE`, []],
  ];

  it.each(attempts)('%s is denied with insufficient_privilege', async (_label, sql, params) => {
    await inTenantTx(app, A.merchantId, (db) =>
      expectSqlState(db.query(sql, params), SQLSTATE.insufficientPrivilege),
    );
  });

  it('can still INSERT and SELECT (append-only, not read-only)', async () => {
    const { rows } = await app.query(`SELECT has_table_privilege('ledger.journal_lines', 'INSERT') AS ins,
      has_table_privilege('ledger.journal_lines', 'SELECT') AS sel`);
    expect(rows[0]).toEqual({ ins: true, sel: true });
  });
});

describe('other append-only and immutable data', () => {
  it.each([
    ['UPDATE audit_events', `UPDATE audit.audit_events SET action = 'x' WHERE id = $1`, [A.auditEventId]],
    ['DELETE audit_events', `DELETE FROM audit.audit_events WHERE id = $1`, [A.auditEventId]],
    ['DELETE merchants', `DELETE FROM tenancy.merchants WHERE id = $1`, [A.merchantId]],
    ['UPDATE ledgers', `UPDATE ledger.ledgers SET currency = 'USD' WHERE id = $1`, [A.ledgerId]],
    ['UPDATE account code', `UPDATE ledger.accounts SET code = '0000' WHERE id = $1`, [A.cashAccountId]],
    ['DELETE accounts', `DELETE FROM ledger.accounts WHERE id = $1`, [A.cashAccountId]],
    ['DELETE projections', `DELETE FROM ledger.balance_projection WHERE account_id = $1`, [A.cashAccountId]],
  ])('%s is denied', async (_label, sql, params) => {
    await inTenantTx(app, A.merchantId, (db) =>
      expectSqlState(db.query(sql, params as unknown[]), SQLSTATE.insufficientPrivilege),
    );
  });

  it('may update only the columns granted (account name, projection figures)', async () => {
    await inTenantTx(app, A.merchantId, async (db) => {
      await db.query(`UPDATE ledger.accounts SET name = 'Cash (renamed)' WHERE id = $1`, [A.cashAccountId]);
      await db.query(
        `UPDATE ledger.balance_projection SET balance_minor = balance_minor, version = version + 1 WHERE account_id = $1`,
        [A.cashAccountId],
      );
    });
  });
});

describe('the app cannot change the schema or read migration bookkeeping', () => {
  it.each([
    ['CREATE TABLE in a module schema', `CREATE TABLE ledger.sneaky (id int)`],
    ['ALTER TABLE', `ALTER TABLE ledger.journal_lines DISABLE TRIGGER ALL`],
    ['CREATE SCHEMA', `CREATE SCHEMA sneaky`],
    ['read _prisma_migrations', `SELECT * FROM public._prisma_migrations`],
  ])('%s is denied', async (_label, sql) => {
    await inTenantTx(app, null, (db) => expectSqlState(db.query(sql), SQLSTATE.insufficientPrivilege));
  });
});

describe('alphakolect_readonly', () => {
  it('can read but not write', async () => {
    const { rows } = await readonly.query(`SELECT count(*)::int AS n FROM tenancy.merchants`);
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
    await inTenantTx(readonly, A.merchantId, (db) =>
      expectSqlState(
        db.query(`INSERT INTO audit.audit_events (action, outcome) VALUES ('x', 'success')`),
        SQLSTATE.insufficientPrivilege,
      ),
    );
  });
});
