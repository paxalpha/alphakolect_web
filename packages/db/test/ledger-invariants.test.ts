import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';
import { FIXTURE } from './support/fixtures.js';

const A = FIXTURE.A;
let app: pg.Client;
let owner: pg.Client;

beforeAll(async () => {
  app = await connectAs('app');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await app.end();
  await owner.end();
});

type Line = { account: string; side: string; amount: number | bigint; currency?: string };
let seq = 0;

/** Insert an entry with lines as the app in merchant A's context, then run the commit-time checks. */
async function postEntry(db: pg.Client, lines: Line[], extra: { reverses?: string } = {}) {
  const key = `test-${process.pid}-${++seq}`;
  const {
    rows: [entry],
  } = await db.query(
    `INSERT INTO ledger.journal_entries (merchant_id, ledger_id, effective_date, entry_type, narrative, idempotency_key, reverses_entry_id)
     VALUES ($1, $2, CURRENT_DATE, 'test', 'Test posting', $3, $4) RETURNING id`,
    [A.merchantId, A.ledgerId, key, extra.reverses ?? null],
  );
  for (const l of lines) {
    await db.query(
      `INSERT INTO ledger.journal_lines (merchant_id, entry_id, account_id, side, amount_minor, currency)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [A.merchantId, entry.id, l.account, l.side, l.amount.toString(), l.currency ?? 'NGN'],
    );
  }
  // Deferred constraint triggers normally run at COMMIT; force them now so the test can roll back.
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  return entry.id as string;
}

const cash = A.cashAccountId;
const savings = A.savingsAccountId;

describe('balanced double entry (ADR-5)', () => {
  it('accepts a balanced multi-line entry', async () => {
    await inTenantTx(app, A.merchantId, async (db) => {
      await postEntry(db, [
        { account: cash, side: 'debit', amount: 30_000 },
        { account: savings, side: 'credit', amount: 20_000 },
        { account: savings, side: 'credit', amount: 10_000 },
      ]);
    });
  });

  it('rejects an unbalanced entry at commit', async () => {
    await inTenantTx(app, A.merchantId, async (db) => {
      const err = await expectSqlState(
        postEntry(db, [
          { account: cash, side: 'debit', amount: 30_000 },
          { account: savings, side: 'credit', amount: 29_999 },
        ]),
        SQLSTATE.checkViolation,
      );
      expect(err.constraint).toBe('journal_entry_balanced');
    });
  });

  it('rejects an entry with a single line', async () => {
    await inTenantTx(app, A.merchantId, async (db) => {
      const err = await expectSqlState(
        postEntry(db, [{ account: cash, side: 'debit', amount: 100 }]),
        SQLSTATE.checkViolation,
      );
      expect(err.constraint).toBe('journal_entry_min_two_lines');
    });
  });

  it('rejects an entry with no lines at all', async () => {
    await inTenantTx(app, A.merchantId, async (db) => {
      const err = await expectSqlState(postEntry(db, []), SQLSTATE.checkViolation);
      expect(err.constraint).toBe('journal_entry_min_two_lines');
    });
  });

  it('rejects appending a line to an entry committed earlier (would unbalance it)', async () => {
    await inTenantTx(app, A.merchantId, async (db) => {
      await db.query(
        `INSERT INTO ledger.journal_lines (merchant_id, entry_id, account_id, side, amount_minor, currency)
         VALUES ($1, $2, $3, 'debit', 1, 'NGN')`,
        [A.merchantId, A.entryId, cash],
      );
      const err = await expectSqlState(db.query('SET CONSTRAINTS ALL IMMEDIATE'), SQLSTATE.checkViolation);
      expect(err.constraint).toBe('journal_entry_balanced');
    });
  });

  it('really enforces at COMMIT (not only when forced early)', async () => {
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.merchant_id', $1, true)`, [A.merchantId]);
    await app.query(
      `INSERT INTO ledger.journal_entries (id, merchant_id, ledger_id, effective_date, entry_type, narrative, idempotency_key)
       VALUES ('01900000-0000-7000-8000-00000000ffff', $1, $2, CURRENT_DATE, 'test', 'Unbalanced at commit', $3)`,
      [A.merchantId, A.ledgerId, `commit-check-${process.pid}`],
    );
    await app.query(
      `INSERT INTO ledger.journal_lines (merchant_id, entry_id, account_id, side, amount_minor, currency)
       VALUES ($1, '01900000-0000-7000-8000-00000000ffff', $2, 'debit', 500, 'NGN')`,
      [A.merchantId, cash],
    );
    await expectSqlState(app.query('COMMIT'), SQLSTATE.checkViolation);
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM ledger.journal_entries WHERE id = '01900000-0000-7000-8000-00000000ffff'`,
    );
    expect(rows[0].n).toBe(0); // nothing persisted
  });
});

describe('line and amount rules', () => {
  it.each([
    ['zero amount', { account: cash, side: 'debit', amount: 0 }],
    ['negative amount', { account: cash, side: 'debit', amount: -5 }],
    ['non-NGN currency', { account: cash, side: 'debit', amount: 5, currency: 'USD' }],
    ['unknown side', { account: cash, side: 'sideways', amount: 5 }],
  ])('rejects a line with %s', async (_label, line) => {
    await inTenantTx(app, A.merchantId, (db) =>
      expectSqlState(
        postEntry(db, [line as Line, { account: savings, side: 'credit', amount: 5 }]),
        SQLSTATE.checkViolation,
      ),
    );
  });

  it('stores amounts as bigint minor units beyond 32-bit range', async () => {
    const big = 900_000_000_000n; // ₦9,000,000,000.00 in kobo
    await inTenantTx(app, A.merchantId, async (db) => {
      const id = await postEntry(db, [
        { account: cash, side: 'debit', amount: big },
        { account: savings, side: 'credit', amount: big },
      ]);
      const { rows } = await db.query(
        `SELECT sum(amount_minor)::text AS s FROM ledger.journal_lines WHERE entry_id = $1`,
        [id],
      );
      expect(rows[0].s).toBe((big * 2n).toString());
    });
  });

  it('allows one entry per idempotency key per merchant', async () => {
    await inTenantTx(app, A.merchantId, (db) =>
      expectSqlState(
        db.query(
          `INSERT INTO ledger.journal_entries (merchant_id, ledger_id, effective_date, entry_type, narrative, idempotency_key)
           VALUES ($1, $2, CURRENT_DATE, 'test', 'Duplicate key', 'fixture-A')`,
          [A.merchantId, A.ledgerId],
        ),
        SQLSTATE.uniqueViolation,
      ),
    );
  });

  it("rejects a reversal pointing at another merchant's entry", async () => {
    await inTenantTx(app, A.merchantId, (db) =>
      expectSqlState(
        postEntry(
          db,
          [
            { account: cash, side: 'credit', amount: 50_000 },
            { account: savings, side: 'debit', amount: 50_000 },
          ],
          { reverses: FIXTURE.B.entryId },
        ),
        SQLSTATE.foreignKeyViolation,
      ),
    );
  });

  it('accepts a reversal of an entry of the same merchant', async () => {
    await inTenantTx(app, A.merchantId, (db) =>
      postEntry(
        db,
        [
          { account: cash, side: 'credit', amount: 50_000 },
          { account: savings, side: 'debit', amount: 50_000 },
        ],
        { reverses: A.entryId },
      ),
    );
  });
});

describe('immutability applies even to the table owner', () => {
  it.each([
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
    ['UPDATE audit_events', `UPDATE audit.audit_events SET action = 'x' WHERE id = $1`, [A.auditEventId]],
    ['DELETE audit_events', `DELETE FROM audit.audit_events WHERE id = $1`, [A.auditEventId]],
    ['TRUNCATE audit_events', `TRUNCATE audit.audit_events`, []],
  ])('migrator: %s is rejected', async (_label, sql, params) => {
    await inTenantTx(owner, null, (db) =>
      expectSqlState(db.query(sql, params as unknown[]), SQLSTATE.restrictViolation),
    );
  });
});

describe('audit event rules', () => {
  it.each([
    [
      'an unknown outcome',
      `INSERT INTO audit.audit_events (merchant_id, action, outcome) VALUES ($1, 'x', 'maybe')`,
    ],
    [
      'a blank action',
      `INSERT INTO audit.audit_events (merchant_id, action, outcome) VALUES ($1, '  ', 'success')`,
    ],
    [
      'a non-object summary',
      `INSERT INTO audit.audit_events (merchant_id, action, outcome, summary) VALUES ($1, 'x', 'success', '[1]')`,
    ],
  ])('rejects %s', async (_label, sql) => {
    await inTenantTx(app, A.merchantId, (db) =>
      expectSqlState(db.query(sql, [A.merchantId]), SQLSTATE.checkViolation),
    );
  });

  // P5.3a's catalog trigger (audit_events_validate) now refuses these rows first. The P1 CHECK constraints must still
  // hold on their own beneath it: with the trigger switched off (owner, rolled back), each is refused by its CHECK.
  it.each([
    ['an unknown outcome', `VALUES ($1, 'auth.logout', 'maybe', '{}')`, 'audit_events_outcome_valid'],
    ['a blank action', `VALUES ($1, '  ', 'success', '{}')`, 'audit_events_action_not_blank'],
    [
      'a non-object summary',
      `VALUES ($1, 'auth.logout', 'success', '[1]')`,
      'audit_events_summary_is_object',
    ],
  ])('rejects %s by its P1 CHECK, beneath the catalog trigger', async (_label, values, constraint) => {
    await inTenantTx(owner, A.merchantId, async (db) => {
      await db.query(`ALTER TABLE audit.audit_events DISABLE TRIGGER audit_events_validate`);
      const err = await expectSqlState(
        db.query(`INSERT INTO audit.audit_events (merchant_id, action, outcome, summary) ${values}`, [
          A.merchantId,
        ]),
        SQLSTATE.checkViolation,
      );
      expect(err.constraint).toBe(constraint);
    });
  });
});
