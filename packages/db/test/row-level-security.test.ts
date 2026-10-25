import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';
import { FIXTURE, MERCHANT_A, MERCHANT_B } from './support/fixtures.js';

// Database-level tenant isolation, tested as the real alphakolect_app login (not via application code).

const A = FIXTURE.A;
const B = FIXTURE.B;

// Every tenant table the app reads directly, with the column that names its tenant.
const TENANT_TABLES: Array<[table: string, tenantColumn: string]> = [
  ['tenancy.merchant_memberships', 'merchant_id'],
];

// Tenant tables the app holds no privilege on at all (so the visibility tests above, which read as the app, do not
// apply); they still must carry RLS and an app policy, so that any later grant is tenant-scoped from the start.
// P5.1: role permissions are read and written only through database functions (ADR-16). P5.5 (the enforcement
// boundary, owner decision B1): the business, its branches, roles and invitations too — their tenant isolation is the
// read functions' (the business from the session; enforcement.test.ts), and the P1 criterion holds a fortiori: the app
// cannot read them at all. P5.8: the activity record too — the app only inserts into it, and reads it through the
// designated read functions alone (audit.read_merchant_events, the business from the session; audit-reads.test.ts).
// P6 (TA-3): the ledger too — posted only through ledger.post_entry, read only through its read functions.
const LEDGER_TABLES = [
  'ledger.ledgers',
  'ledger.accounts',
  'ledger.journal_entries',
  'ledger.journal_lines',
  'ledger.balance_projection',
];
const NO_APP_ACCESS_TENANT_TABLES = [
  ...LEDGER_TABLES,
  // P6 (TA-6): a command's idempotency claims, through util.claim_idempotency and the commands alone
  'util.idempotency_records',
  'audit.audit_events',
  'tenancy.role_permissions',
  'tenancy.merchants',
  'tenancy.branches',
  'tenancy.roles',
  'tenancy.invitations',
];

let app: pg.Client;
let readonly: pg.Client;
let owner: pg.Client;

beforeAll(async () => {
  app = await connectAs('app');
  readonly = await connectAs('readonly');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await app.end();
  await readonly.end();
  await owner.end();
});

describe('tenant A cannot read tenant B (P1 exit criterion)', () => {
  it.each(TENANT_TABLES)('%s: only the current tenant’s rows are visible', async (table, col) => {
    await inTenantTx(app, MERCHANT_A, async (db) => {
      const { rows } = await db.query(`SELECT DISTINCT ${col}::text AS tenant FROM ${table}`);
      expect(rows.map((r) => r.tenant)).toEqual([MERCHANT_A]);
    });
  });

  it("B's rows are invisible even when addressed by exact id", async () => {
    await inTenantTx(app, MERCHANT_A, async (db) => {
      const { rowCount } = await db.query(
        `SELECT 1 FROM tenancy.merchant_memberships WHERE merchant_id = $1`,
        [B.merchantId],
      );
      expect(rowCount).toBe(0);
    });
  });

  it.each(NO_APP_ACCESS_TENANT_TABLES)('%s: the app cannot read it at all, in any context', async (table) => {
    for (const tenant of [MERCHANT_A, null])
      await inTenantTx(app, tenant, (db) =>
        expectSqlState(db.query(`SELECT 1 FROM ${table} LIMIT 1`), SQLSTATE.insufficientPrivilege),
      );
  });

  it('the same connection sees B, and only B, when switched to B’s context', async () => {
    await inTenantTx(app, MERCHANT_B, async (db) => {
      const { rows } = await db.query(
        `SELECT DISTINCT merchant_id::text AS m FROM tenancy.merchant_memberships`,
      );
      expect(rows.map((r) => r.m)).toEqual([MERCHANT_B]);
    });
  });
});

describe('fail closed', () => {
  it.each(TENANT_TABLES)('%s: no tenant context => no rows', async (table) => {
    await inTenantTx(app, null, async (db) => {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0].n).toBe(0);
    });
  });

  it('a malformed tenant context is an error, not a wildcard', async () => {
    await inTenantTx(app, null, async (db) => {
      await db.query(`SELECT set_config('app.merchant_id', 'not-a-uuid', true)`);
      await expectSqlState(db.query(`SELECT count(*) FROM tenancy.merchant_memberships`), '22P02');
    });
  });

  it('tenant context does not leak into the next transaction on the same (pooled) connection', async () => {
    await inTenantTx(app, MERCHANT_A, async (db) => {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM tenancy.merchant_memberships`);
      expect(rows[0].n).toBeGreaterThan(0);
    });
    await inTenantTx(app, null, async (db) => {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM tenancy.merchant_memberships`);
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('tenant A cannot write into tenant B', () => {
  // P6 (TA-3): the app cannot write the ledger at all, in its own context or another's.
  it.each([
    [
      `INSERT INTO ledger.accounts (merchant_id, ledger_id, code, name, type) VALUES ($1, $2, '9000', 'Planted', 'asset')`,
      [A.merchantId, A.ledgerId],
    ],
    [
      `INSERT INTO ledger.accounts (merchant_id, ledger_id, code, name, type) VALUES ($1, $2, '9000', 'Planted', 'asset')`,
      [B.merchantId, B.ledgerId],
    ],
    [`UPDATE ledger.accounts SET name = 'Hijacked' WHERE id = $1`, [B.cashAccountId]],
    [
      `INSERT INTO ledger.balance_projection (merchant_id, account_id, balance_minor) VALUES ($1, $2, 0)`,
      [B.merchantId, B.savingsAccountId],
    ],
    [`UPDATE ledger.accounts SET merchant_id = $1 WHERE id = $2`, [B.merchantId, A.cashAccountId]],
  ] as Array<[string, string[]]>)('the ledger is refused: %s', async (sql, params) => {
    await inTenantTx(app, MERCHANT_A, (db) =>
      expectSqlState(db.query(sql, params), SQLSTATE.insufficientPrivilege),
    );
    const { rows } = await owner.query(`SELECT name FROM ledger.accounts WHERE id = $1`, [B.cashAccountId]);
    expect(rows[0].name).toBe('Cash at business');
  });

  it('cannot create another merchant', async () => {
    await inTenantTx(app, MERCHANT_A, (db) =>
      expectSqlState(
        db.query(
          `INSERT INTO tenancy.merchants (id, name) VALUES ('01900000-0000-7000-8000-0000000000cc', 'Other')`,
        ),
        SQLSTATE.rlsViolation,
      ),
    );
  });

  it("no writer can post a line of A's entry against B's account (composite tenant key)", async () => {
    await inTenantTx(owner, MERCHANT_A, (db) =>
      expectSqlState(
        db.query(
          `INSERT INTO ledger.journal_lines (merchant_id, entry_id, account_id, side, amount_minor, currency)
           VALUES ($1, $2, $3, 'debit', 1, 'NGN')`,
          [A.merchantId, A.entryId, B.cashAccountId],
        ),
        SQLSTATE.foreignKeyViolation,
      ),
    );
  });

  it('may record tenant-less audit events, but not events for another tenant', async () => {
    await inTenantTx(app, MERCHANT_A, async (db) => {
      await db.query(
        `INSERT INTO audit.audit_events (merchant_id, action, outcome) VALUES (NULL, 'auth.login', 'failure')`,
      );
      await db.query(
        `INSERT INTO audit.audit_events (merchant_id, action, outcome) VALUES ($1, 'merchant.profile_updated', 'success')`,
        [MERCHANT_A],
      );
      await expectSqlState(
        db.query(
          `INSERT INTO audit.audit_events (merchant_id, action, outcome) VALUES ($1, 'merchant.profile_updated', 'success')`,
          [MERCHANT_B],
        ),
        SQLSTATE.rlsViolation,
      );
    });
  });
});

describe('alphakolect_readonly (reporting)', () => {
  it('reads across tenants', async () => {
    const { rows } = await readonly.query(
      `SELECT DISTINCT merchant_id::text AS m FROM ledger.journal_lines ORDER BY 1`,
    );
    // Both fixture businesses at least: other suites (the ledger's, P6) post for businesses of their own.
    expect(rows.map((r) => r.m)).toEqual(expect.arrayContaining([MERCHANT_A, MERCHANT_B]));
  });
});

describe('catalog guard: no tenant table may ship without RLS', () => {
  it('every table with a merchant_id column (and tenancy.merchants) has RLS enabled and an app policy', async () => {
    const { rows } = await owner.query(`
      SELECT n.nspname || '.' || c.relname AS name,
             c.relrowsecurity AS rls,
             EXISTS (SELECT 1 FROM pg_policy p
                     WHERE p.polrelid = c.oid
                       AND 'alphakolect_app'::regrole = ANY (p.polroles)) AS app_policy
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
        AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'merchant_id' AND NOT a.attisdropped)
             OR (n.nspname = 'tenancy' AND c.relname = 'merchants'))
      ORDER BY 1`);
    expect(rows.map((r) => r.name).sort()).toEqual(
      [...TENANT_TABLES.map(([t]) => t), ...NO_APP_ACCESS_TENANT_TABLES].sort(),
    );
    for (const r of rows) {
      expect({ table: r.name, rls: r.rls, appPolicy: r.app_policy }).toEqual({
        table: r.name,
        rls: true,
        appPolicy: true,
      });
    }
  });
});
