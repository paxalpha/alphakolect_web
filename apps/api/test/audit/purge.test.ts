import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import type { Queryable } from '../../src/platform/db.js';
import { runPurge } from '../../src/modules/audit/purge.js';

const RUN_ID = '01900000-0000-7000-8000-000000000001';
const AS_OF = '2026-10-18T12:00:00.123456Z';
const ROW = '{"action":"auth.logout","outcome":"success"}';
const PAGE_DIGEST = createHash('sha256').update(`${ROW}\n`).digest('hex');
const FILE_SHA256 = createHash('sha256').update(`${ROW}\n`).digest('hex');

class ScriptedDb implements Queryable {
  readonly calls: { sql: string; params: unknown[] }[] = [];
  outcome: 'confirmed' | 'discarded' | null = null;
  artifactRecordedAt: Date | null = null;
  failDuringExport = false;
  kind: 'plain' | 'export' = 'export';
  /** Steps that examine their ceiling of rows and take none (a held block) before the first page. */
  emptySteps = 0;
  emptyExport = false;
  private nextPage = 1;

  async query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params });
    let rows: Record<string, unknown>[] = [];
    if (sql.includes('audit.reserve_purge_run')) {
      rows = [{ run_id: RUN_ID, kind: this.kind, as_of: AS_OF }];
    } else if (sql.includes('audit.begin_purge_export')) {
      rows = [];
    } else if (sql.includes('audit.record_export_artifact')) {
      this.artifactRecordedAt = new Date();
    } else if (sql.includes('audit.purge_candidates')) {
      if (this.failDuringExport && this.kind === 'export') throw new Error('injected page failure');
      const pageNo = params[2];
      // As the database does: a page number other than the next one is refused.
      if (pageNo !== this.nextPage) throw Object.assign(new Error('page_out_of_order'), { code: '23514' });
      if (this.emptySteps > 0) {
        this.emptySteps--;
        return [
          { page_no: pageNo, row_count: 0, page_digest: null, exhausted: false, event_ids: [], texts: [] },
        ] as unknown as T[];
      }
      if (this.emptyExport) {
        return [
          { page_no: pageNo, row_count: 0, page_digest: null, exhausted: true, event_ids: [], texts: [] },
        ] as unknown as T[];
      }
      if (pageNo === 1) this.nextPage = 2;
      rows =
        pageNo === 1
          ? [
              {
                page_no: 1,
                row_count: 1,
                page_digest: PAGE_DIGEST,
                exhausted: true,
                event_ids: ['01900000-0000-7000-8000-000000000002'],
                texts: [ROW],
              },
            ]
          : [];
    } else if (sql.includes('audit.confirm_purge_report')) {
      this.outcome = 'confirmed';
      rows = [{ report_id: '01900000-0000-7000-8000-000000000003' }];
    } else if (sql.includes('SELECT outcome, artifact_recorded_at')) {
      rows = [{ outcome: this.outcome, artifact_recorded_at: this.artifactRecordedAt }];
    } else if (sql.includes('audit.discard_purge_export')) {
      this.outcome = 'discarded';
    } else if (sql.includes('audit.clear_expired_request_metadata')) {
      rows = [{ tokens_cleared: 0, sessions_cleared: 0 }];
    } else if (sql.includes('audit.purge_expired_events')) {
      rows = [{ purge_expired_events: 1 }];
    }
    return rows as unknown as T[];
  }
}

const directories: string[] = [];
async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'alphakolect-purge-'));
  directories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('operator purge run engine', () => {
  it('deletes plain pages and clears metadata with the run timestamp', async () => {
    const db = new ScriptedDb();
    db.kind = 'plain';

    const result = await runPurge({ db, asOf: AS_OF });

    expect(result).toMatchObject({
      kind: 'plain',
      runId: RUN_ID,
      pages: 1,
      rowsDeleted: 1,
      metadataCleared: 0,
    });
    expect(db.calls.some(({ sql }) => sql.includes('audit.purge_expired_events'))).toBe(true);
    expect(
      db.calls.some(
        ({ sql, params }) => sql.includes('audit.clear_expired_request_metadata') && params[0] === AS_OF,
      ),
    ).toBe(true);
    expect(db.calls.at(-1)?.sql).toContain('audit.release_purge_run');
  });

  it('crosses steps that record no page without skipping a page number (P5 plan §8.6 item 5)', async () => {
    for (const kind of ['plain', 'export'] as const) {
      const db = new ScriptedDb();
      db.kind = kind;
      db.emptySteps = 2;
      const result = await runPurge({
        db,
        asOf: AS_OF,
        ...(kind === 'export'
          ? { directory: await tempDirectory(), writerHostId: 'host', writerLockKey: 'key' }
          : {}),
      });
      expect(result).toMatchObject({ kind, pages: 1 });
      const asked = db.calls
        .filter(({ sql }) => sql.includes('audit.purge_candidates'))
        .map(({ params }) => params[2]);
      expect(asked).toEqual([1, 1, 1]);
    }
  });

  it('publishes an export only after streaming bytes pass the page and whole-file checks', async () => {
    const db = new ScriptedDb();
    const directory = await tempDirectory();

    const result = await runPurge({
      db,
      asOf: AS_OF,
      directory,
      writerHostId: 'test-host',
      writerLockKey: 'test-lock',
    });

    expect(result).toMatchObject({
      kind: 'export',
      runId: RUN_ID,
      reportId: '01900000-0000-7000-8000-000000000003',
      sha256: FILE_SHA256,
      rows: 1,
      pages: 1,
    });
    const resultValue = result as Extract<typeof result, { kind: 'export' }>;
    expect(await readFile(resultValue.reportPath, 'utf8')).toBe(`${ROW}\n`);
    expect(await readdir(directory)).toEqual([
      `alphakolect-purge-report-${RUN_ID}.jsonl`,
      `alphakolect-purge-run-${RUN_ID}.marker`,
    ]);
    expect(db.outcome).toBe('confirmed');
  });

  it('cleans only its own partial file and records a failed export', async () => {
    const db = new ScriptedDb();
    db.failDuringExport = true;
    const directory = await tempDirectory();

    await expect(
      runPurge({ db, asOf: AS_OF, directory, writerHostId: 'test-host', writerLockKey: 'test-lock' }),
    ).rejects.toThrow('injected page failure');

    expect(await readdir(directory)).toEqual([]);
    expect(db.outcome).toBe('discarded');
    expect(db.calls.at(-1)?.sql).toContain('audit.release_purge_run');
  });

  it('discards an empty export with its reason and removes its files', async () => {
    const db = new ScriptedDb();
    db.emptyExport = true;
    const directory = await tempDirectory();

    await expect(
      runPurge({ db, asOf: AS_OF, directory, writerHostId: 'test-host', writerLockKey: 'test-lock' }),
    ).rejects.toThrow('export_empty');

    expect(db.outcome).toBe('discarded');
    expect(
      db.calls.some(
        ({ sql, params }) => sql.includes('audit.discard_purge_export') && params[1] === 'export_empty',
      ),
    ).toBe(true);
    expect(db.calls.some(({ sql }) => sql.includes('audit.confirm_purge_report'))).toBe(false);
    expect(await readdir(directory)).toEqual([]);
  });

  it('leaves a pre-existing partial file untouched and leaves the export unresolved', async () => {
    const db = new ScriptedDb();
    const directory = await tempDirectory();
    const collision = join(directory, `alphakolect-purge-report-${RUN_ID}.jsonl.partial`);
    await writeFile(collision, 'pre-existing bytes', { flag: 'wx' });

    await expect(
      runPurge({ db, asOf: AS_OF, directory, writerHostId: 'test-host', writerLockKey: 'test-lock' }),
    ).rejects.toMatchObject({ code: 'EEXIST' });

    expect(await readFile(collision, 'utf8')).toBe('pre-existing bytes');
    expect(db.outcome).toBeNull();
    expect(db.calls.some(({ sql }) => sql.includes('audit.discard_purge_export'))).toBe(false);
  });
});
