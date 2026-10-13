import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// The mixed-version test of the enforcement boundary (P5 plan §7.2 "Enforcement boundary = one migration"; owner
// review (B), revision 2). With the migration applied, the previous API version's repository statements — every one
// that reads or writes the business, its branches, roles or invitations directly, extracted from
// apps/api/src/modules/tenancy/repository.ts at 4319177 with its constants folded — are run as alphakolect_app, in a
// transaction with the tenant set exactly as that version set it. Each must fail with insufficient_privilege:
// over-denial, never a bypass. The control runs the same statements, with the same values, as the table owner and
// they succeed, so the refusal is the privilege and nothing else (not a syntax error, not a missing row).

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/repository-sql-4319177.json', import.meta.url), 'utf8'),
) as { commit: string; statements: { method: string; sql: string }[] };

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [app, owner] = await Promise.all([connectAs('app'), connectAs('migrator')]);
});
afterAll(async () => {
  await Promise.all([app.end(), owner.end()]);
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;

let merchantId: string;
let branchId: string;
let roleId: string;
beforeAll(async () => {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Mixed Version Ltd')`, [
    `mixed-${process.pid}-${randomBytes(4).toString('hex')}@example.test`,
    ARGON,
  ]);
  merchantId = s.merchant_id;
  const one = async (sql: string) =>
    (await owner.query(sql, [merchantId, `Item ${hash().slice(0, 6)}`])).rows[0].id;
  branchId = await one(`INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, $2) RETURNING id`);
  roleId = await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`);
});

/** The values that version passed, per repository method (a method this map does not know fails the test). */
const PARAMS: Record<string, (sql: string) => unknown[]> = {
  merchant: () => [merchantId],
  renameMerchant: () => [merchantId, 'Renamed by the old version'],
  listCatalog: () => [merchantId],
  getCatalogItem: (sql) => [merchantId, sql.includes('tenancy.branches') ? branchId : roleId],
  createCatalogItem: () => [merchantId, `Created ${hash().slice(0, 6)}`],
  updateCatalogItem: (sql) => [
    merchantId,
    sql.includes('tenancy.branches') ? branchId : roleId,
    `Updated ${hash().slice(0, 6)}`,
    'archived',
  ],
  invitations: () => [merchantId, null],
};

/** Run `sql` on `client` in a rolled-back transaction with the tenant set as the previous version set it. */
async function inPreviousVersionTx(client: pg.Client, sql: string, params: unknown[]) {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.merchant_id', $1, true)`, [merchantId]);
    return await client.query(sql, params);
  } finally {
    await client.query('ROLLBACK');
  }
}

describe(`the previous version (${FIXTURE.commit}) against the migrated database`, () => {
  it('the fixture is that version’s complete direct access: 11 statements over the four tables', () => {
    expect(FIXTURE.commit).toBe('4319177');
    expect(FIXTURE.statements.map((s) => s.method)).toEqual([
      'merchant',
      'renameMerchant',
      'listCatalog',
      'listCatalog',
      'getCatalogItem',
      'getCatalogItem',
      'createCatalogItem',
      'createCatalogItem',
      'updateCatalogItem',
      'updateCatalogItem',
      'invitations',
    ]);
  });

  it.each(FIXTURE.statements.map((s, i) => [i, s.method, s.sql] as const))(
    '#%i %s fails with insufficient_privilege as the app',
    async (_i, method, sql) => {
      const params = PARAMS[method];
      expect(params, `no values for ${method}`).toBeDefined();
      const err = await expectSqlState(
        inPreviousVersionTx(app, sql, params!(sql)),
        SQLSTATE.insufficientPrivilege,
      );
      expect(err.message).toMatch(/permission denied for table (merchants|branches|roles|invitations)/);
    },
  );

  it.each(FIXTURE.statements.map((s, i) => [i, s.method, s.sql] as const))(
    'control: #%i %s succeeds as the table owner with the same values (the refusal is the privilege alone)',
    async (_i, method, sql) => {
      const result = await inPreviousVersionTx(owner, sql, PARAMS[method]!(sql));
      if (method !== 'invitations') expect(result.rowCount).toBeGreaterThan(0);
    },
  );
});
