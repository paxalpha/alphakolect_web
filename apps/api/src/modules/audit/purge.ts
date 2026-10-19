import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, link, open, rm, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type pg from 'pg';
import type { Queryable } from '../../platform/db.js';

const PAGE_LIMIT = 1000;
/** How often an export renews its run's lease between its own statements (the lease is 15 minutes). */
const HEARTBEAT_MS = 60_000;
const REPORT_PREFIX = 'alphakolect-purge-report-';

type PurgeRun = { run_id: string; kind: 'plain' | 'export'; as_of: string };
type PurgePage = {
  page_no: number;
  row_count: number;
  page_digest: string | null;
  exhausted: boolean;
  event_ids: string[] | null;
  texts: string[] | null;
};
type ExportState = { outcome: 'confirmed' | 'discarded' | null; artifact_recorded_at: Date | null };

export type PurgeResult =
  | { kind: 'plain'; runId: string; pages: number; rowsDeleted: number; metadataCleared: number }
  | { kind: 'export_skipped'; runId: string; reason: 'directory_required'; metadataCleared: number }
  | {
      kind: 'export';
      runId: string;
      reportId: string;
      directory: string;
      reportPath: string;
      sha256: string;
      rows: number;
      pages: number;
      directoryFsync: boolean;
      metadataCleared: number;
    };

/**
 * The points where a test may stop an export (a test-only gate, §8.6's tests: a kill mid-write, between the link and
 * the unlink, between the link and the confirmation, and after a confirmation whose answer is lost).
 */
export type PauseStage = 'mid_write' | 'after_link' | 'before_confirm' | 'after_confirm';
export type Pause = (stage: PauseStage) => Promise<void>;
const noPause: Pause = async () => undefined;

export class PurgeError extends Error {
  override name = 'PurgeError';
}

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/**
 * The command's one client, one statement at a time — the heartbeat's included. Every statement of the engine is its
 * own transaction, so a heartbeat queued behind a page statement runs after it, never inside it (§8.6 item 2: heartbeats
 * go only between the command's own transactions).
 */
function serialized(db: Queryable): Queryable {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = tail.then(() => db.query<T>(sql, params));
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

/**
 * Renews the run's lease every `everyMs` while an export works between statements (the file's writes, its read-back).
 * A renewal refused because the run is no longer live stops the export at its next step; a momentary
 * lock_not_available (another command holding the reservation row for one statement) is not a refusal.
 */
function startHeartbeat(db: Queryable, run: PurgeRun, everyMs: number) {
  let refused: unknown;
  const timer = setInterval(() => {
    db.query(`SELECT audit.renew_purge_run($1, $2)`, [run.run_id, run.as_of]).catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code !== '55P03') refused ??= error;
    });
  }, everyMs);
  timer.unref();
  return {
    check() {
      if (refused) throw new PurgeError('heartbeat_refused');
    },
    stop() {
      clearInterval(timer);
    },
  };
}

const reportName = (runId: string) => `${REPORT_PREFIX}${runId}.jsonl`;

async function syncDirectory(directory: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
    return true;
  } catch (error) {
    if (
      process.platform === 'win32' &&
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ['EINVAL', 'EPERM', 'EISDIR', 'EACCES'].includes(String(error.code))
    ) {
      return false;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function clearExpiredMetadata(db: Queryable, pAsOf: string): Promise<number> {
  let total = 0;
  for (;;) {
    const [row] = await db.query<{ tokens_cleared: number; sessions_cleared: number }>(
      `SELECT * FROM audit.clear_expired_request_metadata($1, $2)`,
      [pAsOf, PAGE_LIMIT],
    );
    const cleared = (row?.tokens_cleared ?? 0) + (row?.sessions_cleared ?? 0);
    total += cleared;
    if (cleared === 0) return total;
  }
}

async function readExportState(db: Queryable, runId: string): Promise<ExportState | undefined> {
  const [row] = await db.query<ExportState>(
    `SELECT outcome, artifact_recorded_at FROM audit.purge_exports WHERE run_id = $1`,
    [runId],
  );
  return row;
}

async function verifyReportFile(
  path: string,
  pageCounts: number[],
  pageDigests: string[],
): Promise<{ rowCount: number; sha256: string }> {
  const pageHashes = pageCounts.map(() => createHash('sha256'));
  const wholeHash = createHash('sha256');
  const wholeStream = createReadStream(path);
  for await (const chunk of wholeStream) wholeHash.update(chunk as Buffer);

  let rowCount = 0;
  let pageIndex = 0;
  let inPage = 0;
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of reader) {
    if (pageIndex >= pageCounts.length) throw new PurgeError('report_has_extra_rows');
    try {
      JSON.parse(line);
    } catch {
      throw new PurgeError('report_has_invalid_json');
    }
    pageHashes[pageIndex]!.update(`${line}\n`);
    inPage++;
    rowCount++;
    if (inPage === pageCounts[pageIndex]) {
      if (pageHashes[pageIndex]!.digest('hex') !== pageDigests[pageIndex]) {
        throw new PurgeError(`report_page_digest_mismatch_${pageIndex + 1}`);
      }
      pageIndex++;
      inPage = 0;
    }
  }
  if (pageIndex !== pageCounts.length || inPage !== 0) throw new PurgeError('report_is_truncated');
  return { rowCount, sha256: wholeHash.digest('hex') };
}

async function writeReport(
  db: Queryable,
  run: PurgeRun,
  directory: string,
  hostId: string,
  lockKey: string,
  heartbeatMs: number,
  pause: Pause,
): Promise<Omit<Extract<PurgeResult, { kind: 'export' }>, 'metadataCleared'>> {
  const name = reportName(run.run_id);
  const finalPath = join(directory, name);
  const partialPath = `${finalPath}.partial`;
  const markerPath = join(directory, `alphakolect-purge-run-${run.run_id}.marker`);
  let markerCreated = false;
  let partialCreated = false;
  let finalCreated = false;
  let markerCollision = false;
  let pathCollision = false;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  const pageCounts: number[] = [];
  const pageDigests: string[] = [];
  let rowCount = 0;
  let heartbeat: ReturnType<typeof startHeartbeat> | undefined;

  try {
    await db.query(`SELECT audit.begin_purge_export($1, $2, $3, $4, $5)`, [
      run.run_id,
      run.as_of,
      directory,
      hostId,
      lockKey,
    ]);
    let marker;
    try {
      marker = await open(markerPath, 'wx', 0o600);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
        markerCollision = true;
      }
      throw error;
    }
    markerCreated = true;
    try {
      await marker.writeFile(`${JSON.stringify({ runId: run.run_id, hostId })}\n`, 'utf8');
      await marker.sync();
    } finally {
      await marker.close();
    }
    await syncDirectory(directory);
    heartbeat = startHeartbeat(db, run, heartbeatMs);

    try {
      handle = await open(partialPath, 'wx', 0o600);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
        pathCollision = true;
      }
      throw error;
    }
    partialCreated = true;
    await db.query(`SELECT audit.record_export_artifact($1, $2)`, [run.run_id, run.as_of]);

    // A step that examined its ceiling of rows and took none (rows held, or kept by a longer retention) records no
    // page: the next step asks for the same page number (P5 plan §8.6 item 5).
    for (let pageNo = 1; ;) {
      const [page] = await db.query<PurgePage>(`SELECT * FROM audit.purge_candidates($1, $2, $3, $4)`, [
        run.run_id,
        run.as_of,
        pageNo,
        PAGE_LIMIT,
      ]);
      if (!page) throw new PurgeError('purge_page_missing');
      if (page.row_count > 0) {
        const texts = page.texts ?? [];
        if (texts.length !== page.row_count || !page.page_digest)
          throw new PurgeError('purge_manifest_invalid');
        const digest = sha256(texts.map((text) => `${text}\n`).join(''));
        if (digest !== page.page_digest) throw new PurgeError(`purge_page_digest_mismatch_${pageNo}`);
        for (const text of texts) await handle.writeFile(`${text}\n`, 'utf8');
        if (pageNo === 1) await pause('mid_write');
        pageCounts.push(page.row_count);
        pageDigests.push(page.page_digest);
        rowCount += page.row_count;
        pageNo++;
      }
      heartbeat.check();
      if (page.exhausted) break;
    }

    if (rowCount === 0) throw new PurgeError('export_empty');
    await handle.sync();
    await handle.close();
    handle = undefined;

    const verified = await verifyReportFile(partialPath, pageCounts, pageDigests);
    if (verified.rowCount !== rowCount) throw new PurgeError('report_row_count_mismatch');
    heartbeat.check();
    const pageManifestDigest = sha256(`${pageDigests.join('\n')}\n`);

    try {
      await link(partialPath, finalPath);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
        pathCollision = true;
      }
      throw error;
    }
    finalCreated = true;
    await pause('after_link');
    await unlink(partialPath);
    partialCreated = false;
    const directoryFsync = await syncDirectory(directory);
    if (!directoryFsync && process.platform === 'win32') {
      // Windows does not expose a portable directory-handle fsync; read the published file back before confirming.
      const published = await verifyReportFile(finalPath, pageCounts, pageDigests);
      if (published.sha256 !== verified.sha256) throw new PurgeError('published_report_hash_mismatch');
    }

    await pause('before_confirm');
    heartbeat.check();
    heartbeat.stop();
    const fileLocation = finalPath;
    const [confirmedRow] = await db.query<{ report_id: string }>(
      `SELECT audit.confirm_purge_report($1, $2, $3, $4, $5, $6, $7) AS report_id`,
      [run.run_id, run.as_of, rowCount, pageCounts.length, pageManifestDigest, verified.sha256, fileLocation],
    );
    if (!confirmedRow) throw new PurgeError('report_confirmation_missing');
    await pause('after_confirm');
    return {
      kind: 'export',
      runId: run.run_id,
      reportId: confirmedRow.report_id,
      directory,
      reportPath: finalPath,
      sha256: verified.sha256,
      rows: rowCount,
      pages: pageCounts.length,
      directoryFsync,
    };
  } catch (error) {
    heartbeat?.stop();
    if (handle) await handle.close().catch(() => undefined);
    const state = await readExportState(db, run.run_id).catch(() => undefined);
    if (state?.outcome === 'confirmed') {
      throw error;
    }
    if (!state || state.outcome === 'discarded') throw error;

    let cleanupComplete = true;
    try {
      if (partialCreated) await rm(partialPath, { force: true });
      if (finalCreated) await rm(finalPath, { force: true });
      await syncDirectory(directory);
      if (partialCreated || finalCreated) {
        const [partialExists, finalExists] = await Promise.all([
          access(partialPath).then(
            () => true,
            () => false,
          ),
          access(finalPath).then(
            () => true,
            () => false,
          ),
        ]);
        cleanupComplete = !partialExists && !finalExists;
      }
    } catch {
      cleanupComplete = false;
    }
    if (cleanupComplete && state.outcome === null && !markerCollision && !pathCollision) {
      await db.query(`SELECT audit.discard_purge_export($1, $2, 'automatic')`, [
        run.run_id,
        error instanceof Error ? error.message.slice(0, 500) : 'export_failed',
      ]);
      if (markerCreated) await rm(markerPath, { force: true });
      await syncDirectory(directory);
    }
    throw error;
  } finally {
    heartbeat?.stop();
    if (handle) await handle.close().catch(() => undefined);
  }
}

export async function runPurge(args: {
  db: Queryable;
  asOf: string;
  directory?: string;
  writerHostId?: string;
  writerLockKey?: string;
  /** The export's heartbeat interval (tests shorten it). */
  heartbeatMs?: number;
  /** A test-only gate: called at each PauseStage of an export. */
  pause?: Pause;
}): Promise<PurgeResult> {
  args = { ...args, db: serialized(args.db) };
  const [run] = await args.db.query<PurgeRun>(`SELECT * FROM audit.reserve_purge_run($1::timestamptz)`, [
    args.asOf,
  ]);
  if (!run) throw new PurgeError('purge_reservation_missing');
  let completed = false;
  let cleared: number | undefined;
  let pages = 0;
  let rowsDeleted = 0;
  let exportResult: Omit<Extract<PurgeResult, { kind: 'export' }>, 'metadataCleared'> | undefined;
  try {
    if (run.kind === 'export' && (!args.directory || !args.writerHostId || !args.writerLockKey)) {
      cleared = await clearExpiredMetadata(args.db, run.as_of);
      completed = true;
      return {
        kind: 'export_skipped',
        runId: run.run_id,
        reason: 'directory_required',
        metadataCleared: cleared,
      };
    }

    if (run.kind === 'plain') {
      // As in an export, the page number advances only when a page was recorded.
      for (let pageNo = 1; ;) {
        const [current] = await args.db.query<PurgePage>(
          `SELECT * FROM audit.purge_candidates($1, $2, $3, $4)`,
          [run.run_id, run.as_of, pageNo, PAGE_LIMIT],
        );
        if (!current) throw new PurgeError('purge_page_missing');
        if (current.row_count > 0) {
          rowsDeleted += await deletePage(args.db, run, pageNo);
          pages++;
          pageNo++;
        }
        if (current.exhausted) break;
      }
    } else {
      exportResult = await writeReport(
        args.db,
        run,
        args.directory!,
        args.writerHostId!,
        args.writerLockKey!,
        args.heartbeatMs ?? HEARTBEAT_MS,
        args.pause ?? noPause,
      );
      pages = exportResult.pages;
    }

    cleared = await clearExpiredMetadata(args.db, run.as_of);
    completed = true;
    if (run.kind === 'plain')
      return { kind: 'plain', runId: run.run_id, pages, rowsDeleted, metadataCleared: cleared };
    if (!exportResult) throw new PurgeError('confirmed_report_missing');
    return {
      ...exportResult,
      metadataCleared: cleared,
    };
  } finally {
    // The clearing (CF4) is attempted whatever happened before (§8.6 item 6.5); it needs no reservation.
    if (cleared === undefined) await clearExpiredMetadata(args.db, run.as_of).catch(() => undefined);
    await args.db.query(`SELECT audit.release_purge_run($1, $2)`, [run.run_id, completed]);
  }
}

/**
 * Deletes one page. After an unknown outcome (a lost response), the page's own mark says whether it was deleted: the
 * command moves on rather than retrying (§8.6 item 5); any other failure stops the run, deleting nothing more.
 */
async function deletePage(db: Queryable, run: PurgeRun, pageNo: number): Promise<number> {
  try {
    const [deleted] = await db.query<{ purge_expired_events: number }>(
      `SELECT audit.purge_expired_events($1, $2, $3)`,
      [run.run_id, run.as_of, pageNo],
    );
    return deleted?.purge_expired_events ?? 0;
  } catch (error) {
    const [page] = await db
      .query<{ processed_at: Date | null; deleted_count: number | null }>(
        `SELECT processed_at, deleted_count FROM audit.purge_run_pages WHERE run_id = $1 AND page_no = $2`,
        [run.run_id, pageNo],
      )
      .catch(() => [] as { processed_at: Date | null; deleted_count: number | null }[]);
    if (page?.processed_at) return page.deleted_count ?? 0;
    throw error;
  }
}

export async function inspectReportFile(
  path: string,
  expectedSha256: string,
  pageCounts: number[],
  pageDigests: string[],
): Promise<'present_and_matching' | 'missing' | 'altered' | 'directory_unavailable'> {
  try {
    const actual = await verifyReportFile(path, pageCounts, pageDigests);
    return actual.sha256 === expectedSha256 ? 'present_and_matching' : 'altered';
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return 'missing';
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ['EACCES', 'EPERM', 'ENOTDIR'].includes(String(error.code))
    )
      return 'directory_unavailable';
    return 'altered';
  }
}
