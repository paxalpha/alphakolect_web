import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// The copy's life in the database (P5 plan §8.6 items 6, 8, 9; the Tests paragraph's "the export", "recovery",
// "handover and delivery" and "loss"): what each function refuses, and that a refusal changes nothing. The command's
// file and process steps are tested in apps/api; here, only the database's rules. Each case runs in a transaction that
// is rolled back.

let op: pg.Client;
beforeAll(async () => {
  op = await connectAs('migrator');
});
afterAll(async () => {
  await op.end();
});

type Run = { run_id: string; kind: string; as_of: string };
const NOT_READY = '55000'; // object_not_in_prerequisite_state
const CHECK = SQLSTATE.checkViolation;
const SHA = 'c'.repeat(64);
const OLD = 3 * 365;

async function rolledBack(fn: () => Promise<void>) {
  await op.query('BEGIN');
  try {
    await fn();
  } finally {
    await op.query('ROLLBACK');
  }
}
async function refused(sql: string, params: unknown[], sqlState: string) {
  await op.query('SAVEPOINT s');
  await expectSqlState(op.query(sql, params), sqlState);
  await op.query('ROLLBACK TO SAVEPOINT s');
}
const one = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
  (await op.query<T>(sql, params)).rows[0]!;
const event = async () =>
  (
    await one<{ id: string }>(
      `INSERT INTO audit.audit_events (occurred_at, action, outcome, summary)
       VALUES (now() - make_interval(days => $1), 'auth.logout', 'success', '{}') RETURNING id`,
      [OLD],
    )
  ).id;
const reserve = () => one<Run>(`SELECT * FROM audit.reserve_purge_run(now() - interval '1 day')`);
const location = (run: Run) => `C:\\reports\\alphakolect-purge-report-${run.run_id}.jsonl`;
const manifest = (run: Run) =>
  one<{ rows: number; pages: number; digest: string }>(
    `SELECT coalesce(sum(row_count), 0)::int AS rows, count(*)::int AS pages,
            encode(sha256(convert_to(string_agg(digest || E'\\n', '' ORDER BY page_no), 'UTF8')), 'hex') AS digest
       FROM audit.purge_run_pages WHERE run_id = $1`,
    [run.run_id],
  );
const confirmSql = `SELECT audit.confirm_purge_report($1, $2, $3, $4, $5, $6, $7) AS id`;

/** A requested export run, its file recorded and every page read, ready to confirm. */
async function readyExport() {
  const held = [await event(), await event()];
  const request = (await one<{ id: string }>(`SELECT audit.request_purge_report('reports test') AS id`)).id;
  const run = await reserve();
  expect(run.kind).toBe('export');
  await op.query(`SELECT audit.begin_purge_export($1, $2, 'C:\\reports', 'host', 'key')`, [
    run.run_id,
    run.as_of,
  ]);
  await op.query(`SELECT audit.record_export_artifact($1, $2)`, [run.run_id, run.as_of]);
  for (let n = 1; ;) {
    const p = await one<{ row_count: number; exhausted: boolean }>(
      `SELECT * FROM audit.purge_candidates($1, $2, $3, 1000)`,
      [run.run_id, run.as_of, n],
    );
    if (p.row_count > 0) n++;
    if (p.exhausted) break;
  }
  return { held, request, run };
}
/** A confirmed report, its run released: active, holding its rows. */
async function activeReport() {
  const x = await readyExport();
  const m = await manifest(x.run);
  const report = (
    await one<{ id: string }>(confirmSql, [
      x.run.run_id,
      x.run.as_of,
      m.rows,
      m.pages,
      m.digest,
      SHA,
      location(x.run),
    ])
  ).id;
  await op.query(`SELECT audit.release_purge_run($1, true)`, [x.run.run_id]);
  return { ...x, report };
}
const begin = async (report: string) =>
  (await one<{ id: string }>(`SELECT audit.begin_report_handover($1, 'E:') AS id`, [report])).id;
const written = (attempt: string, diskseq: string | null = null) =>
  op.query(`SELECT audit.record_handover_written($1, $2)`, [attempt, diskseq]);
const verifySql = `SELECT audit.record_report_handover($1, $2, $3, $4)`;
const deliverSql = `SELECT audit.record_report_delivery($1, $2, $3, 'reports test')`;
const abandonSql = `SELECT audit.record_handover_abandoned($1, 'stick wiped') AS outcome`;
const attemptRow = (attempt: string) =>
  one<{ outcome: string | null; fate_attested_at: Date | null }>(
    `SELECT outcome, fate_attested_at FROM audit.purge_report_handovers WHERE id = $1`,
    [attempt],
  );

describe('the export', () => {
  it("an export run's as-of is the reservation's own time, whatever was asked", async () => {
    await rolledBack(async () => {
      await op.query(`SELECT audit.request_purge_report('reports test')`);
      const run = await reserve(); // asked for a day ago
      const { now } = await one<{ now: string }>(
        `SELECT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
      );
      expect(run.as_of).toBe(now);
    });
  });

  it('pages are refused before the file is recorded; confirmation before the file and before the end', async () => {
    await rolledBack(async () => {
      await event();
      await event();
      await op.query(`SELECT audit.request_purge_report('reports test')`);
      const run = await reserve();
      await op.query(`SELECT audit.begin_purge_export($1, $2, 'C:\\reports', 'host', 'key')`, [
        run.run_id,
        run.as_of,
      ]);
      await refused(`SELECT * FROM audit.purge_candidates($1, $2, 1, 1)`, [run.run_id, run.as_of], NOT_READY);
      await refused(confirmSql, [run.run_id, run.as_of, 1, 1, 'd', SHA, location(run)], NOT_READY);
      await op.query(`SELECT audit.record_export_artifact($1, $2)`, [run.run_id, run.as_of]);
      await refused(`SELECT audit.record_export_artifact($1, $2)`, [run.run_id, run.as_of], NOT_READY);
      await op.query(`SELECT * FROM audit.purge_candidates($1, $2, 1, 1)`, [run.run_id, run.as_of]);
      const m = await manifest(run);
      await refused(
        confirmSql,
        [run.run_id, run.as_of, m.rows, m.pages, m.digest, SHA, location(run)],
        NOT_READY,
      );
    });
  });

  it('confirmation refuses another row count, page count, manifest, an invalid hash and another location', async () => {
    await rolledBack(async () => {
      const { run } = await readyExport();
      const m = await manifest(run);
      const args = (over: Partial<Record<'rows' | 'pages' | 'digest' | 'sha' | 'loc', unknown>>) => [
        run.run_id,
        run.as_of,
        over.rows ?? m.rows,
        over.pages ?? m.pages,
        over.digest ?? m.digest,
        over.sha ?? SHA,
        over.loc ?? location(run),
      ];
      await refused(confirmSql, args({ rows: m.rows + 1 }), CHECK); // a page written twice
      await refused(confirmSql, args({ pages: m.pages + 1 }), CHECK);
      await refused(confirmSql, args({ digest: 'f'.repeat(64) }), CHECK); // a page skipped or altered
      await refused(confirmSql, args({ sha: 'not-a-hash' }), CHECK);
      await refused(
        confirmSql,
        args({ loc: `C:\\elsewhere\\alphakolect-purge-report-${run.run_id}.jsonl` }),
        CHECK,
      );
      // The right values confirm, also with forward slashes; a second confirmation is refused.
      await op.query(
        confirmSql,
        args({ loc: location(run).replace(/\\/g, '/').replace('C:/reports/', 'C:\\reports/') }),
      );
      await refused(confirmSql, args({}), NOT_READY);
    });
  });

  it('a discarded export cannot be confirmed; a "lost" discard is refused while its run is live', async () => {
    await rolledBack(async () => {
      const { run } = await readyExport();
      const m = await manifest(run);
      await refused(`SELECT audit.discard_purge_export($1, 'gone', 'lost')`, [run.run_id], NOT_READY);
      await refused(`SELECT audit.discard_purge_export($1, 'x', 'whatever')`, [run.run_id], CHECK);
      await op.query(`SELECT audit.discard_purge_export($1, 'failed write', 'automatic')`, [run.run_id]);
      await refused(
        confirmSql,
        [run.run_id, run.as_of, m.rows, m.pages, m.digest, SHA, location(run)],
        NOT_READY,
      );
      await refused(`SELECT audit.discard_purge_export($1, 'again', 'automatic')`, [run.run_id], NOT_READY);
      // Its manifest is removed at the discard, and the request still awaits a copy.
      expect((await manifest(run)).pages).toBe(0);
      await op.query(`SELECT audit.release_purge_run($1, false)`, [run.run_id]);
      expect((await reserve()).kind).toBe('export');
    });
  });
});

describe('handover and delivery', () => {
  it('verification needs the write first, the eject attested, a changed disk sequence and the same bytes', async () => {
    await rolledBack(async () => {
      const { report } = await activeReport();
      const attempt = await begin(report);
      await refused(verifySql, [attempt, SHA, true, null], NOT_READY); // not written yet
      await written(attempt, '41');
      await refused(verifySql, [attempt, SHA, false, '42'], CHECK); // eject not attested
      await refused(verifySql, [attempt, SHA, true, null], CHECK); // a null sequence never passes
      await refused(verifySql, [attempt, SHA, true, '41'], CHECK); // unchanged: never unplugged
      await refused(verifySql, [attempt, 'd'.repeat(64), true, '42'], CHECK); // the stick's bytes changed
      expect(await attemptRow(attempt)).toEqual({ outcome: null, fate_attested_at: null });
      await op.query(verifySql, [attempt, SHA, true, '42']);
      expect((await attemptRow(attempt)).outcome).toBe('recorded');
    });
  });

  it('one live attempt at a time; a recorded one superseded before a replacement; the delivery names the live one', async () => {
    await rolledBack(async () => {
      const { report, request, run } = await activeReport();
      const first = await begin(report);
      await refused(`SELECT audit.begin_report_handover($1, 'F:')`, [report], NOT_READY);
      await written(first);
      await op.query(verifySql, [first, SHA, true, null]);
      await refused(`SELECT audit.begin_report_handover($1, 'F:')`, [report], NOT_READY); // recorded is live
      expect((await one<{ outcome: string }>(abandonSql, [first])).outcome).toBe('superseded');
      const second = await begin(report);
      await written(second);
      await refused(deliverSql, [report, second, 'receipt 1'], NOT_READY); // second not yet recorded
      await op.query(verifySql, [second, SHA, true, null]);
      await refused(deliverSql, [report, first, 'receipt 1'], NOT_READY); // the receipt names the wrong attempt
      await refused(deliverSql, [report, second, '  '], CHECK); // no receipt reference
      await op.query(deliverSql, [report, second, 'receipt 1']);
      // One transaction: the request satisfied, the manifest removed, the rows released.
      expect(
        (
          await one<{ state: string }>(`SELECT state FROM audit.purge_report_requests WHERE id = $1`, [
            request,
          ])
        ).state,
      ).toBe('satisfied');
      expect((await manifest(run)).pages).toBe(0);
      await refused(deliverSql, [report, second, 'receipt 2'], NOT_READY);
      await refused(abandonSql, [second], NOT_READY); // the delivered attempt
      await refused(abandonSql, [first], NOT_READY); // its fate already attested
      await refused(`SELECT audit.begin_report_handover($1, 'F:')`, [report], NOT_READY); // not active
    });
  });

  it("the operator's copy: destroyed only after delivery, once, and only with every other stick accounted for", async () => {
    await rolledBack(async () => {
      const { report } = await activeReport();
      const destroySql = `SELECT audit.record_report_copy_destroyed($1, 'automatic', 'deleted')`;
      await refused(destroySql, [report], NOT_READY); // before delivery
      const failed = await begin(report);
      await written(failed);
      await op.query(`SELECT audit.record_handover_failed($1, 'hash mismatch on the stick')`, [failed]);
      expect(await attemptRow(failed)).toEqual({ outcome: 'abandoned', fate_attested_at: null });
      const good = await begin(report);
      await written(good);
      await op.query(verifySql, [good, SHA, true, null]);
      await op.query(deliverSql, [report, good, 'receipt']);
      await refused(destroySql, [report], NOT_READY); // the failed attempt's stick is unaccounted
      expect((await one<{ outcome: string }>(abandonSql, [failed])).outcome).toBe('abandoned'); // fate attested after delivery
      await op.query(destroySql, [report]);
      await refused(destroySql, [report], NOT_READY); // twice
    });
  });
});

describe('loss', () => {
  it('a lost report needs every stick accounted for, releases nothing to deletion, and the next run exports again', async () => {
    await rolledBack(async () => {
      const { report, held } = await activeReport();
      const lostSql = `SELECT audit.record_report_lost($1, 'automatic', 'files lost')`;
      const attempt = await begin(report);
      await refused(lostSql, [report], NOT_READY); // an unended attempt
      await op.query(abandonSql, [attempt]);
      await op.query(lostSql, [report]);
      await refused(lostSql, [report], NOT_READY); // once lost
      const run = await reserve();
      expect(run.kind).toBe('export'); // the request stays open
      const { rows } = await op.query(`SELECT id FROM audit.audit_events WHERE id = ANY($1::uuid[])`, [held]);
      expect(rows.length).toBe(2); // the rows are still there to copy again
    });
  });
});
