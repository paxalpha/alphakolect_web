import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

type Run = { run_id: string; kind: string; as_of: string };
type Page = {
  page_no: number;
  row_count: number;
  page_digest: string | null;
  exhausted: boolean;
  event_ids: string[] | null;
  texts: string[] | null;
};

let operator: pg.Client;

beforeAll(async () => {
  operator = await connectAs('migrator');
});

afterAll(async () => {
  await operator.end();
});

const unique = () => randomBytes(8).toString('hex');

async function asOf(): Promise<Date> {
  const { rows } = await operator.query<{ value: Date }>(`SELECT clock_timestamp() AS value`);
  return rows[0]!.value;
}

async function eventAt(occurredAt: Date): Promise<string> {
  const { rows } = await operator.query<{ id: string }>(
    `INSERT INTO audit.audit_events (occurred_at, action, outcome, summary)
     VALUES ($1, 'auth.logout', 'success', '{}') RETURNING id`,
    [occurredAt],
  );
  return rows[0]!.id;
}

async function reserve(pAsOf: Date): Promise<Run> {
  const { rows } = await operator.query<Run>(`SELECT * FROM audit.reserve_purge_run($1)`, [pAsOf]);
  return rows[0]!;
}

async function page(run: Run, pageNo: number, limit = 100): Promise<Page> {
  const { rows } = await operator.query<Page>(`SELECT * FROM audit.purge_candidates($1, $2, $3, $4)`, [
    run.run_id,
    run.as_of,
    pageNo,
    limit,
  ]);
  return rows[0]!;
}

async function deletePages(run: Run): Promise<string[]> {
  const ids: string[] = [];
  for (let pageNo = 1; ; pageNo++) {
    const current = await page(run, pageNo);
    if (current.row_count > 0) {
      ids.push(...(current.event_ids ?? []));
      await operator.query(`SELECT audit.purge_expired_events($1, $2, $3)`, [run.run_id, run.as_of, pageNo]);
    }
    if (current.exhausted) break;
  }
  return ids;
}

async function release(run: Run, completed = true): Promise<void> {
  await operator.query(`SELECT audit.release_purge_run($1, $2)`, [run.run_id, completed]);
}

async function expectAuditInsertFailure(action: string, operation: () => Promise<unknown>): Promise<void> {
  const functionName = `test_fail_retention_${unique()}`;
  const triggerName = functionName;
  const escapedAction = action.replaceAll("'", "''");
  await operator.query('BEGIN');
  try {
    await operator.query(
      `CREATE FUNCTION audit.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN
         IF NEW.action = '${escapedAction}' AND NEW.outcome = 'success' THEN
           RAISE EXCEPTION 'injected audit storage failure' USING ERRCODE = 'XX000';
         END IF;
         RETURN NEW;
       END $fn$`,
    );
    await operator.query(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit.audit_events
       FOR EACH ROW EXECUTE FUNCTION audit.${functionName}()`,
    );
    await operator.query('SAVEPOINT retention_audit_failure');
    await expectSqlState(operation(), 'XX000');
    await operator.query('ROLLBACK TO SAVEPOINT retention_audit_failure');
    await operator.query(`DROP TRIGGER ${triggerName} ON audit.audit_events`);
    await operator.query(`DROP FUNCTION audit.${functionName}()`);
    await operator.query('COMMIT');
  } catch (error) {
    await operator.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

describe('Part 2 retention database contract', () => {
  it('deletes only entries strictly older than the calendar cutoff and records each page atomically', async () => {
    const pAsOf = await asOf();
    const {
      rows: [cutoff],
    } = await operator.query<{ value: Date }>(`SELECT $1::timestamptz - audit.d9_retention() AS value`, [
      pAsOf,
    ]);
    const oldId = await eventAt(new Date(cutoff!.value.getTime() - 1));
    const boundaryId = await eventAt(cutoff!.value);
    const youngId = await eventAt(new Date(pAsOf.getTime() - 365 * 24 * 60 * 60 * 1000));

    const run = await reserve(pAsOf);
    expect(run.kind).toBe('plain');
    const firstPage = await page(run, 1);
    // [coverage platform.audit_purged/success] audit failure rolls the page deletion back.
    await expectAuditInsertFailure('platform.audit_purged', () =>
      operator.query(`SELECT audit.purge_expired_events($1, $2, 1)`, [run.run_id, run.as_of]),
    );
    const { rows: retainedAfterFailure } = await operator.query<{ id: string }>(
      `SELECT id FROM audit.audit_events WHERE id = $1`,
      [oldId],
    );
    expect(retainedAfterFailure).toHaveLength(1);
    expect(firstPage.row_count).toBeGreaterThan(0);
    // [coverage platform.audit_purged/success] the page and its audit row commit together.
    const deletedIds = await deletePages(run);
    await release(run);

    expect(deletedIds).toContain(oldId);
    expect(deletedIds).not.toContain(boundaryId);
    expect(deletedIds).not.toContain(youngId);
    const { rows } = await operator.query<{ id: string }>(
      `SELECT id FROM audit.audit_events WHERE id = ANY($1::uuid[])`,
      [[oldId, boundaryId, youngId]],
    );
    expect(rows.map((row) => row.id)).toEqual([boundaryId, youngId]);
    const { rows: auditRows } = await operator.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit.audit_events
        WHERE action = 'platform.audit_purged' AND target_id = $1`,
      [run.run_id],
    );
    expect(auditRows[0]!.count).toBeGreaterThan(0);
    await expectSqlState(
      operator.query(`DELETE FROM audit.audit_events WHERE id = $1`, [boundaryId]),
      SQLSTATE.restrictViolation,
    );
    await expectSqlState(
      operator.query(`UPDATE audit.audit_events SET action = 'auth.login' WHERE id = $1`, [boundaryId]),
      SQLSTATE.restrictViolation,
    );
    await expectSqlState(operator.query(`TRUNCATE audit.audit_events`), SQLSTATE.restrictViolation);
  });

  it('holds copied rows until written receipt, then releases them to a later plain run', async () => {
    const sourceId = await eventAt(new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000));
    // [coverage platform.purge_report_requested/success] a request is recorded atomically.
    await expectAuditInsertFailure('platform.purge_report_requested', () =>
      operator.query(`SELECT audit.request_purge_report($1)`, [`failed request ${unique()}`]),
    );
    const { rows: requestRows } = await operator.query<{ id: string }>(
      // [coverage platform.purge_report_requested/success] successful request event and request row commit together.
      `SELECT audit.request_purge_report($1) AS id`,
      [`test request ${unique()}`],
    );
    const requestId = requestRows[0]!.id;
    const exportRun = await reserve(await asOf());
    expect(exportRun.kind).toBe('export');
    const directory = `/tmp/alphakolect-test-${unique()}`;
    const writerHost = `test-host-${unique()}`;
    const writerLock = `test-lock-${unique()}`;
    await operator.query(`SELECT audit.begin_purge_export($1, $2, $3, $4, $5)`, [
      exportRun.run_id,
      exportRun.as_of,
      directory,
      writerHost,
      writerLock,
    ]);
    await operator.query(`SELECT audit.record_export_artifact($1, $2)`, [exportRun.run_id, exportRun.as_of]);

    const pages: Page[] = [];
    for (let pageNo = 1; ; pageNo++) {
      const current = await page(exportRun, pageNo);
      if (current.row_count > 0) pages.push(current);
      if (current.exhausted) break;
    }
    const includedIds = pages.flatMap((item) => item.event_ids ?? []);
    expect(includedIds).toContain(sourceId);
    const rowCount = pages.reduce((sum, item) => sum + item.row_count, 0);
    const manifestDigest = createHash('sha256')
      .update(`${pages.map((item) => item.page_digest).join('\n')}\n`)
      .digest('hex');
    const fileBytes = pages
      .flatMap((item) => item.texts ?? [])
      .map((text) => `${text}\n`)
      .join('');
    const fileSha256 = createHash('sha256').update(fileBytes).digest('hex');
    const reportName = `alphakolect-purge-report-${exportRun.run_id}.jsonl`;
    const fileLocation = `${directory}/${reportName}`;
    // [coverage platform.purge_report_confirmed/success] a report cannot commit without its audit event.
    await expectAuditInsertFailure('platform.purge_report_confirmed', () =>
      operator.query(`SELECT audit.confirm_purge_report($1, $2, $3, $4, $5, $6, $7)`, [
        exportRun.run_id,
        exportRun.as_of,
        rowCount,
        pages.length,
        manifestDigest,
        fileSha256,
        fileLocation,
      ]),
    );
    const { rows: reportRows } = await operator.query<{ id: string }>(
      // [coverage platform.purge_report_confirmed/success] report confirmation commits with its audit event.
      `SELECT audit.confirm_purge_report($1, $2, $3, $4, $5, $6, $7) AS id`,
      [exportRun.run_id, exportRun.as_of, rowCount, pages.length, manifestDigest, fileSha256, fileLocation],
    );
    const reportId = reportRows[0]!.id;
    await release(exportRun);

    const plainRun = await reserve(await asOf());
    expect(plainRun.kind).toBe('plain');
    const skipped = await page(plainRun, 1);
    expect(skipped.event_ids ?? []).not.toContain(sourceId);
    await release(plainRun);
    const { rows: heldRows } = await operator.query<{ id: string }>(
      `SELECT id FROM audit.audit_events WHERE id = $1`,
      [sourceId],
    );
    expect(heldRows).toHaveLength(1);

    const medium = JSON.stringify({ label: `TEST-${unique()}`, serial: 'serial-1', path: 'E:/' });
    const { rows: attemptRows } = await operator.query<{ id: string }>(
      `SELECT audit.begin_report_handover($1, $2) AS id`,
      [reportId, medium],
    );
    let attemptId = attemptRows[0]!.id;
    await operator.query(`SELECT audit.record_handover_written($1, $2)`, [attemptId, 'diskseq-1']);
    // [coverage platform.purge_report_handover_failed/success] failure state and audit event roll back together.
    await expectAuditInsertFailure('platform.purge_report_handover_failed', () =>
      operator.query(`SELECT audit.record_handover_failed($1, $2)`, [attemptId, 'injected rollback']),
    );
    // [coverage platform.purge_report_handover_failed/success] successful failure record commits with its event.
    await operator.query(`SELECT audit.record_handover_failed($1, $2)`, [
      attemptId,
      'test verification failure',
    ]);
    // [coverage platform.purge_report_handover_abandoned/success] the written stick's fate is recorded atomically.
    await expectAuditInsertFailure('platform.purge_report_handover_abandoned', () =>
      operator.query(`SELECT audit.record_handover_abandoned($1, $2)`, [attemptId, 'injected rollback']),
    );
    // [coverage platform.purge_report_handover_abandoned/success] successful fate attestation commits with its event.
    await operator.query(`SELECT audit.record_handover_abandoned($1, $2)`, [attemptId, 'test stick wiped']);
    const { rows: replacementAttemptRows } = await operator.query<{ id: string }>(
      `SELECT audit.begin_report_handover($1, $2) AS id`,
      [reportId, medium],
    );
    attemptId = replacementAttemptRows[0]!.id;
    await operator.query(`SELECT audit.record_handover_written($1, $2)`, [attemptId, 'diskseq-2']);
    await expectSqlState(
      operator.query(`SELECT audit.record_report_handover($1, $2, false, $3)`, [
        attemptId,
        fileSha256,
        'diskseq-3',
      ]),
      SQLSTATE.checkViolation,
    );
    await expectSqlState(
      operator.query(`SELECT audit.record_report_handover($1, $2, true, $3)`, [
        attemptId,
        fileSha256,
        'diskseq-2',
      ]),
      SQLSTATE.checkViolation,
    );
    const { rows: unchangedAttempt } = await operator.query<{
      outcome: string | null;
      medium_sha256: string | null;
    }>(`SELECT outcome, medium_sha256 FROM audit.purge_report_handovers WHERE id = $1`, [attemptId]);
    expect(unchangedAttempt[0]).toEqual({ outcome: null, medium_sha256: null });
    // [coverage platform.purge_report_handed_over/success] the verified handover and its event commit together.
    await expectAuditInsertFailure('platform.purge_report_handed_over', () =>
      operator.query(`SELECT audit.record_report_handover($1, $2, true, $3)`, [
        attemptId,
        fileSha256,
        'diskseq-3',
      ]),
    );
    // [coverage platform.purge_report_handed_over/success] verified handover commits with its event.
    await operator.query(`SELECT audit.record_report_handover($1, $2, true, $3)`, [
      attemptId,
      fileSha256,
      'diskseq-3',
    ]);
    // [coverage platform.purge_report_delivered/success] delivery and request satisfaction are atomic.
    await expectAuditInsertFailure('platform.purge_report_delivered', () =>
      operator.query(`SELECT audit.record_report_delivery($1, $2, $3, $4)`, [
        reportId,
        attemptId,
        `failed-receipt-${unique()}`,
        'injected rollback',
      ]),
    );
    // [coverage platform.purge_report_delivered/success] successful receipt commits with request satisfaction.
    await operator.query(`SELECT audit.record_report_delivery($1, $2, $3, $4)`, [
      reportId,
      attemptId,
      `receipt-${unique()}`,
      'database integration test',
    ]);
    // [coverage platform.purge_report_copy_destroyed/success] destruction state rolls back on audit failure.
    await expectAuditInsertFailure('platform.purge_report_copy_destroyed', () =>
      operator.query(`SELECT audit.record_report_copy_destroyed($1, 'automatic', $2)`, [
        reportId,
        'injected rollback',
      ]),
    );
    // [coverage platform.purge_report_copy_destroyed/success] destruction commits with its event.
    await operator.query(`SELECT audit.record_report_copy_destroyed($1, 'automatic', $2)`, [
      reportId,
      'test copy removed',
    ]);

    const afterDelivery = await reserve(await asOf());
    expect(afterDelivery.kind).toBe('plain');
    const deletedIds = await deletePages(afterDelivery);
    await release(afterDelivery);
    expect(deletedIds).toContain(sourceId);

    const { rows: requestState } = await operator.query<{ state: string }>(
      `SELECT state FROM audit.purge_report_requests WHERE id = $1`,
      [requestId],
    );
    expect(requestState[0]!.state).toBe('satisfied');
  });

  it('cancels an open request in writing without inventing a report', async () => {
    const { rows } = await operator.query<{ id: string }>(`SELECT audit.request_purge_report($1) AS id`, [
      `cancel before export ${unique()}`,
    ]);
    const requestId = rows[0]!.id;
    // [coverage platform.purge_report_request_cancelled/success] cancellation rolls back if its audit insert fails.
    await expectAuditInsertFailure('platform.purge_report_request_cancelled', () =>
      operator.query(`SELECT audit.cancel_purge_report_request($1, $2)`, [
        requestId,
        `injected cancellation failure ${unique()}`,
      ]),
    );
    // [coverage platform.purge_report_request_cancelled/success] successful cancellation commits with its event.
    const { rows: cancelled } = await operator.query<{ cancel_purge_report_request: string | null }>(
      `SELECT audit.cancel_purge_report_request($1, $2)`,
      [requestId, `owner written cancellation ${unique()}`],
    );
    expect(cancelled[0]!.cancel_purge_report_request).toBeNull();
    const { rows: state } = await operator.query<{ state: string; close_note: string }>(
      `SELECT state, close_note FROM audit.purge_report_requests WHERE id = $1`,
      [requestId],
    );
    expect(state[0]).toMatchObject({ state: 'cancelled' });
    expect(state[0]!.close_note).toContain('owner written cancellation');
  });

  it('[coverage platform.request_metadata_cleared/success] clears expired token metadata atomically with its event', async () => {
    const email = `retention-${unique()}@example.test`;
    const { rows: identityRows } = await operator.query<{ id: string }>(
      `INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`,
      [email],
    );
    const tokenHash = randomBytes(32).toString('hex');
    const { rows: tokenRows } = await operator.query<{ id: string }>(
      `INSERT INTO identity.one_time_tokens
         (identity_id, purpose, token_hash, expires_at, consumed_at, requested_ip, created_at)
       VALUES ($1, 'email_verification', $2, now() - interval '3 years', now() - interval '3 years', '192.0.2.1', now() - interval '3 years')
       RETURNING id`,
      [identityRows[0]!.id, tokenHash],
    );
    const pAsOf = await asOf();
    // [coverage platform.request_metadata_cleared/success] injected audit failure preserves the metadata.
    await expectAuditInsertFailure('platform.request_metadata_cleared', () =>
      operator.query(`SELECT * FROM audit.clear_expired_request_metadata($1, 100)`, [pAsOf]),
    );
    const { rows: beforeRetry } = await operator.query<{ requested_ip: string | null }>(
      `SELECT requested_ip FROM identity.one_time_tokens WHERE id = $1`,
      [tokenRows[0]!.id],
    );
    expect(beforeRetry[0]!.requested_ip).toBe('192.0.2.1');
    const { rows: cleared } = await operator.query<{ tokens_cleared: number; sessions_cleared: number }>(
      `SELECT * FROM audit.clear_expired_request_metadata($1, 100)`,
      [pAsOf],
    );
    expect(cleared[0]).toEqual({ tokens_cleared: 1, sessions_cleared: 0 });
  });

  it('an unresolved export is discarded atomically', async () => {
    const { rows: requests } = await operator.query<{ id: string }>(
      `SELECT audit.request_purge_report($1) AS id`,
      [`discard ${unique()}`],
    );
    const run = await reserve(await asOf());
    const directory = `/tmp/alphakolect-test-${unique()}`;
    await operator.query(`SELECT audit.begin_purge_export($1, $2, $3, $4, $5)`, [
      run.run_id,
      run.as_of,
      directory,
      `host-${unique()}`,
      `lock-${unique()}`,
    ]);
    // [coverage platform.purge_export_discarded/success] the export stays open if its audit insert fails.
    await expectAuditInsertFailure('platform.purge_export_discarded', () =>
      operator.query(`SELECT audit.discard_purge_export($1, $2, 'automatic')`, [
        run.run_id,
        'injected rollback',
      ]),
    );
    const { rows: openExport } = await operator.query<{ outcome: string | null }>(
      `SELECT outcome FROM audit.purge_exports WHERE run_id = $1`,
      [run.run_id],
    );
    expect(openExport[0]!.outcome).toBeNull();
    // [coverage platform.purge_export_discarded/success] successful discard commits with its event.
    await operator.query(`SELECT audit.discard_purge_export($1, $2, 'automatic')`, [
      run.run_id,
      'test export discarded',
    ]);
    await release(run, false);
    await operator.query(`SELECT audit.cancel_purge_report_request($1::uuid, $2::text)`, [
      requests[0]!.id,
      'test request closed',
    ]);
  });

  it('a lost report releases its manifest only after its audit row commits', async () => {
    await eventAt(new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000));
    const { rows: requests } = await operator.query<{ id: string }>(
      `SELECT audit.request_purge_report($1) AS id`,
      [`lost report ${unique()}`],
    );
    const run = await reserve(await asOf());
    const directory = `/tmp/alphakolect-test-${unique()}`;
    await operator.query(`SELECT audit.begin_purge_export($1, $2, $3, $4, $5)`, [
      run.run_id,
      run.as_of,
      directory,
      `host-${unique()}`,
      `lock-${unique()}`,
    ]);
    await operator.query(`SELECT audit.record_export_artifact($1, $2)`, [run.run_id, run.as_of]);
    const pages: Page[] = [];
    for (let pageNo = 1; ; pageNo++) {
      const current = await page(run, pageNo);
      if (current.row_count > 0) pages.push(current);
      if (current.exhausted) break;
    }
    const manifest = createHash('sha256')
      .update(`${pages.map((item) => item.page_digest).join('\n')}\n`)
      .digest('hex');
    const rowCount = pages.reduce((sum, item) => sum + item.row_count, 0);
    const { rows: reports } = await operator.query<{ id: string }>(
      `SELECT audit.confirm_purge_report($1, $2, $3, $4, $5, $6, $7) AS id`,
      [
        run.run_id,
        run.as_of,
        rowCount,
        pages.length,
        manifest,
        'a'.repeat(64),
        `${directory}/alphakolect-purge-report-${run.run_id}.jsonl`,
      ],
    );
    await release(run);
    // [coverage platform.purge_report_lost/success] the report and manifest remain active when audit storage fails.
    await expectAuditInsertFailure('platform.purge_report_lost', () =>
      operator.query(`SELECT audit.record_report_lost($1, 'attested', $2)`, [
        reports[0]!.id,
        'injected rollback',
      ]),
    );
    const { rows: activeReport } = await operator.query<{ lost_at: Date | null }>(
      `SELECT lost_at FROM audit.purge_reports WHERE id = $1`,
      [reports[0]!.id],
    );
    expect(activeReport[0]!.lost_at).toBeNull();
    // [coverage platform.purge_report_lost/success] loss and manifest release commit with the event.
    await operator.query(`SELECT audit.record_report_lost($1, 'attested', $2)`, [
      reports[0]!.id,
      'test report lost',
    ]);
    await operator.query(`SELECT audit.cancel_purge_report_request($1, $2)`, [
      requests[0]!.id,
      'test request closed',
    ]);
  });
});
