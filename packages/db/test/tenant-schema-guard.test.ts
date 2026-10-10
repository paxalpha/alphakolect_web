import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs } from './support/db.js';

// P4 exit criterion 2 (ADR-15 T13), enforced from the catalog — not from hand-kept lists: any table, present or
// future, with a merchant_id column must carry the tenant rules. A new tenant table that forgets one fails here.
//
//   1. RLS is enabled and at least one policy applies to alphakolect_app.
//   2. merchant_id NOT NULL + an id column ⇒ a unique index on exactly (merchant_id, id), so other tenant tables can
//      reference it by composite key; without an id column, the primary key must include merchant_id.
//   3. Every foreign key between two tenant tables pairs merchant_id with merchant_id (a composite key), so a row
//      can never reference another tenant's row. References to tenancy.merchants (the tenant root) are exempt.

let owner: pg.Client;
beforeAll(async () => {
  owner = await connectAs('migrator');
});
afterAll(() => owner.end());

type Table = { table: string; nullable: boolean; has_id: boolean };

const tenantTables = async () =>
  (
    await owner.query<Table>(`
      SELECT format('%I.%I', n.nspname, c.relname) AS table,
             NOT a.attnotnull AS nullable,
             EXISTS (SELECT 1 FROM pg_attribute i WHERE i.attrelid = c.oid AND i.attname = 'id' AND NOT i.attisdropped) AS has_id
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'merchant_id' AND NOT a.attisdropped
       WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       ORDER BY 1`)
  ).rows;

describe('every tenant table carries the tenant rules (catalog-driven)', () => {
  it('finds the tenant tables (sanity: the guard is looking at the real schema)', async () => {
    const names = (await tenantTables()).map((t) => t.table);
    for (const expected of [
      'tenancy.branches',
      'tenancy.roles',
      'tenancy.merchant_memberships',
      'ledger.ledgers',
      'ledger.journal_lines',
      'audit.audit_events',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('1. RLS is enabled, with a policy for the app', async () => {
    const { rows } = await owner.query<{ table: string }>(`
      SELECT format('%I.%I', n.nspname, c.relname) AS table
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'merchant_id' AND NOT a.attisdropped
       WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND (NOT c.relrowsecurity OR NOT EXISTS (
               SELECT 1 FROM pg_policy p
                WHERE p.polrelid = c.oid AND 'alphakolect_app'::regrole = ANY (p.polroles)))
       ORDER BY 1`);
    expect(rows.map((r) => r.table)).toEqual([]);
  });

  it('2. a (merchant_id, id) unique key — or merchant_id inside the primary key when there is no id', async () => {
    const { rows } = await owner.query<{ table: string }>(`
      SELECT format('%I.%I', n.nspname, c.relname) AS table
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute m ON m.attrelid = c.oid AND m.attname = 'merchant_id' AND NOT m.attisdropped AND m.attnotnull
        LEFT JOIN pg_attribute i ON i.attrelid = c.oid AND i.attname = 'id' AND NOT i.attisdropped
       WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND CASE
               WHEN i.attnum IS NOT NULL THEN NOT EXISTS (
                 SELECT 1 FROM pg_index x
                  WHERE x.indrelid = c.oid AND x.indisunique AND x.indpred IS NULL AND x.indnkeyatts = 2
                    AND x.indkey[0] = m.attnum AND x.indkey[1] = i.attnum)
               ELSE NOT EXISTS (
                 SELECT 1 FROM pg_index x
                  WHERE x.indrelid = c.oid AND (x.indisprimary OR x.indisunique) AND x.indpred IS NULL
                    AND m.attnum = ANY (x.indkey::int2[]))
             END
       ORDER BY 1`);
    expect(rows.map((r) => r.table)).toEqual([]);
  });

  it('3. every foreign key between tenant tables pairs merchant_id with merchant_id', async () => {
    const { rows } = await owner.query<{ fk: string }>(`
      SELECT format('%I.%I.%I', n.nspname, c.relname, k.conname) AS fk
        FROM pg_constraint k
        JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute cm ON cm.attrelid = k.conrelid AND cm.attname = 'merchant_id' AND NOT cm.attisdropped
        JOIN pg_attribute rm ON rm.attrelid = k.confrelid AND rm.attname = 'merchant_id' AND NOT rm.attisdropped
       WHERE k.contype = 'f'
         AND NOT EXISTS (
           SELECT 1 FROM generate_subscripts(k.conkey, 1) s
            WHERE k.conkey[s] = cm.attnum AND k.confkey[s] = rm.attnum)
       ORDER BY 1`);
    expect(rows.map((r) => r.fk)).toEqual([]);
  });
});
