import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';
import { FIXTURE } from './support/fixtures.js';

// P5.3a (ADR-16 §3.5 "Audit (Part 1)"; plan §8.1): the event catalog and the BEFORE INSERT trigger that validates every
// row of audit.audit_events against it — for every writer and every role, the table owner included. Rows are inserted
// raw here, as the app would and as the owner can, inside transactions that roll back.

const { A } = FIXTURE;
let app: pg.Client;
let owner: pg.Client;
let readonly: pg.Client;

beforeAll(async () => {
  app = await connectAs('app');
  owner = await connectAs('migrator');
  readonly = await connectAs('readonly');
});
afterAll(async () => {
  await Promise.all([app.end(), owner.end(), readonly.end()]);
});

const insert = (db: pg.Client, action: string, outcome: string, summary: unknown) =>
  db.query(`INSERT INTO audit.audit_events (merchant_id, action, outcome, summary) VALUES ($1, $2, $3, $4)`, [
    A.merchantId,
    action,
    outcome,
    JSON.stringify(summary),
  ]);

/** Refused by the catalog trigger, by name. */
async function refused(promise: Promise<unknown>) {
  const err = await expectSqlState(promise, SQLSTATE.checkViolation);
  expect(err.constraint).toBe('audit_event_catalog');
  return err;
}

const SECRET = 'correct-horse-battery-staple-value';

describe('the validation trigger accepts every legitimate row', () => {
  it.each([
    ['a pair without summary fields', 'auth.logout', 'success', {}],
    ['an allowed string field', 'auth.login', 'failure', { reason: 'wrong_password' }],
    ['an allowed integer and string', 'auth.login', 'success', { stage: 'authenticated', choices: 2 }],
    ['an allowed boolean', 'auth.password_change', 'success', { sessionsRevoked: true }],
    [
      'an allowed null',
      'merchant.member_assigned',
      'success',
      { kind: 'staff', status: 'active', roleId: null, branchId: null },
    ],
    ['a string at its bound', 'merchant.profile_updated', 'success', { name: 'n'.repeat(120) }],
  ])('%s', async (_label, action, outcome, summary) => {
    for (const db of [app, owner]) {
      await inTenantTx(db, A.merchantId, async (tx) => {
        await insert(tx, action, outcome, summary);
      });
    }
  });
});

describe('the validation trigger refuses an invalid row — as the app and as the table owner', () => {
  it.each([
    ['an unknown identifier', 'auth.teleport', 'success', {}],
    ['a known identifier with an outcome not in the catalog', 'auth.logout', 'failure', {}],
    [
      'a field outside the allowlist',
      'auth.login',
      'failure',
      { reason: 'wrong_password', password: SECRET },
    ],
    ['a string over its bound', 'merchant.profile_updated', 'success', { name: 'n'.repeat(121) }],
    ['a string where an integer belongs', 'auth.login', 'success', { stage: 'authenticated', choices: '2' }],
    ['a fractional integer', 'auth.login', 'success', { stage: 'authenticated', choices: 1.5 }],
    ['a number where a boolean belongs', 'auth.password_change', 'success', { sessionsRevoked: 1 }],
    ['a null where none is allowed', 'auth.login', 'failure', { reason: null }],
    ['a nested object', 'auth.login', 'failure', { reason: { nested: SECRET } }],
  ])('%s', async (_label, action, outcome, summary) => {
    for (const db of [app, owner]) {
      await inTenantTx(db, A.merchantId, async (tx) => {
        const err = await refused(insert(tx, action, outcome, summary));
        // The field may be named; the value is never echoed (it may be personal data).
        expect(`${err.message} ${err.detail ?? ''}`).not.toContain(SECRET);
      });
    }
  });

  it('a retired pair is refused', async () => {
    await inTenantTx(owner, A.merchantId, async (tx) => {
      await tx.query(
        `UPDATE audit.event_catalog SET status = 'retired' WHERE identifier = 'auth.logout' AND outcome = 'success'`,
      );
      await refused(insert(tx, 'auth.logout', 'success', {}));
    });
  });
});

describe('audit.event_catalog', () => {
  it('declares a writer pattern exactly for atomic pairs, and no P5 pair carries a retention override', async () => {
    const { rows } = await owner.query(
      `SELECT identifier, outcome, class, writer_pattern, retention_override::text AS r FROM audit.event_catalog`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.writer_pattern !== null, `${row.identifier}/${row.outcome}`).toBe(row.class === 'atomic');
      expect(row.r, `${row.identifier}/${row.outcome}`).toBeNull();
    }
  });

  it('is never deleted or truncated — not even by the owner (retire instead)', async () => {
    await inTenantTx(owner, null, (tx) =>
      expectSqlState(
        tx.query(`DELETE FROM audit.event_catalog WHERE identifier = 'auth.logout'`),
        SQLSTATE.restrictViolation,
      ),
    );
    await inTenantTx(owner, null, (tx) =>
      expectSqlState(tx.query(`TRUNCATE audit.event_catalog`), SQLSTATE.restrictViolation),
    );
  });

  it('the app may read it and nothing else; the reporting role holds no privilege on it', async () => {
    const { rows } = await app.query(`SELECT count(*)::int AS n FROM audit.event_catalog`);
    expect(rows[0].n).toBeGreaterThan(0);
    for (const sql of [
      `INSERT INTO audit.event_catalog (identifier, outcome, class) VALUES ('auth.teleport', 'success', 'best_effort')`,
      `UPDATE audit.event_catalog SET class = 'best_effort'`,
      `DELETE FROM audit.event_catalog`,
    ]) {
      await inTenantTx(app, null, (tx) => expectSqlState(tx.query(sql), SQLSTATE.insufficientPrivilege));
    }
    const {
      rows: [effective],
    } = await owner.query(
      `SELECT has_table_privilege('alphakolect_readonly', 'audit.event_catalog', 'SELECT') AS can_read,
              has_any_column_privilege('alphakolect_readonly', 'audit.event_catalog', 'SELECT') AS any_column`,
    );
    expect(effective).toEqual({ can_read: false, any_column: false });
    await expectSqlState(readonly.query(`SELECT 1 FROM audit.event_catalog`), SQLSTATE.insufficientPrivilege);
  });
});
