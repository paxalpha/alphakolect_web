import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  appendFile,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { hostIdentity } from '../../src/modules/audit/purge-host.js';
import { sha256File, verifyHandover, writeHandover } from '../../src/modules/audit/purge-handover.js';
import { acquirePurgeLock } from '../../src/modules/audit/purge-lock.js';
import { runPurge } from '../../src/modules/audit/purge.js';
import type { Queryable } from '../../src/platform/db.js';

// The operator's purge command as the operator runs it — a process of its own, against this run's database (P5 plan
// §8.6, the Tests paragraph): the listing while another command holds the lock, a squatted lock name, the export and
// `--check-files` in every state (present, altered, missing, the folder unavailable), a loss and the export made again,
// kills at each point of an export and their recovery, the seven-day reminders, an unwritable folder, and a fixed
// disk refused as the medium. The handover onto a real removable stick is a manual step (the runbook). Each test
// leaves no open request, no active report, no live reservation and no unresolved export.

const API = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../scripts/audit-purge.ts', import.meta.url));
const host = hostIdentity();
let owner: pg.Client;
beforeAll(async () => {
  owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
  await owner.connect();
});
afterAll(() => owner.end());

type Result = { code: number | null; stdout: string; stderr: string };
/** Starts the command; `done` settles when it exits. */
function start(args: string[], env: Record<string, string> = {}) {
  const overrides: Record<string, string> = { DATABASE_MIGRATOR_URL: inject('ownerDatabaseUrl'), ...env };
  // Windows names are case-insensitive: drop an inherited ONEDRIVE before setting OneDrive, or it may win.
  const names = new Set(Object.keys(overrides).map((k) => k.toLowerCase()));
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !names.has(k.toLowerCase())),
  );
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--conditions=@alphakolect/source', SCRIPT, ...args],
    {
      cwd: API,
      env: { ...inherited, ...overrides },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const done = new Promise<Result>((resolve) =>
    child.on('exit', (code) => resolve({ code, stdout, stderr })),
  );
  return { child, done };
}
const cli = (...args: string[]) => start(args).done;
const json = (r: Result) => {
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Record<string, unknown>;
};
const refused = (r: Result, code: string) => {
  expect(r.code, r.stdout).toBe(1);
  expect(r.stderr).toContain(`Audit purge failed: ${code}`);
};

/** A local folder only the operator (with SYSTEM and Administrators on Windows) may open, as the runbook makes it. */
async function privateDir() {
  const dir = await mkdtemp(join(tmpdir(), 'akpurge-'));
  if (process.platform === 'win32')
    execFileSync('C:\\Windows\\System32\\icacls.exe', [
      dir,
      '/inheritance:r',
      '/grant:r',
      `${process.env.USERNAME}:(OI)(CI)F`,
      '/grant:r',
      '*S-1-5-18:(OI)(CI)F',
      '/grant:r',
      '*S-1-5-32-544:(OI)(CI)F',
    ]);
  else await chmod(dir, 0o700);
  return dir;
}
async function oldEvents(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++)
    ids.push(
      (
        await owner.query(
          `INSERT INTO audit.audit_events (occurred_at, action, outcome, summary)
           VALUES (now() - interval '3 years' + make_interval(secs => $1), 'auth.logout', 'success', '{}') RETURNING id`,
          [i],
        )
      ).rows[0].id as string,
    );
  return ids;
}
const present = async (ids: string[]) =>
  (await owner.query(`SELECT count(*)::int AS n FROM audit.audit_events WHERE id = ANY($1)`, [ids])).rows[0]
    .n as number;
const requestId = (r: Result) => /[0-9a-f-]{36}/.exec(r.stdout)![0];
const exportOf = async (runId: string) =>
  (await owner.query(`SELECT outcome, lost FROM audit.purge_exports WHERE run_id = $1`, [runId])).rows[0] as {
    outcome: string | null;
  };
const setLease = (interval: string) =>
  owner.query(`CREATE OR REPLACE FUNCTION audit.purge_lease() RETURNS interval
               LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$ SELECT interval '${interval}' $fn$`);
const runFiles = async (dir: string) => (await readdir(dir)).sort();

describe('the lock, as commands meet it', () => {
  it('the listing reads the state while another command holds the lock; a state-changing command is refused, doing nothing', async () => {
    const before = (await owner.query(`SELECT count(*)::int AS n FROM audit.purge_report_requests`)).rows[0]
      .n;
    const lock = await acquirePurgeLock(host.lockAddress);
    try {
      expect(json(await cli('reports'))).toHaveProperty('requests');
      refused(await cli('request-report', '--note', 'while the lock is held'), 'purge_lock_already_held');
    } finally {
      await lock.close();
    }
    expect((await owner.query(`SELECT count(*)::int AS n FROM audit.purge_report_requests`)).rows[0].n).toBe(
      before,
    );
  });

  it('a name squatted by another program refuses every command', async () => {
    const squatter = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => squatter.listen(host.lockAddress, resolve));
    try {
      refused(await cli('request-report', '--note', 'squatted'), 'purge_lock_already_held');
      refused(await cli('run'), 'purge_lock_already_held');
    } finally {
      await new Promise((r) => squatter.close(r));
    }
  });
});

describe('a copy, its files and their checks', () => {
  it('export, check (present, altered, missing, folder unavailable), lose, export again, cancel — rows deleted only at the end', async () => {
    const ids = await oldEvents(3);
    const request = requestId(await cli('request-report', '--note', 'cli test'));
    expect(json(await cli('run'))).toMatchObject({ kind: 'export_skipped' });
    expect(await present(ids)).toBe(3);

    const dir = await privateDir();
    const exported = json(await cli('run', '--dir', dir)) as {
      runId: string;
      reportId: string;
      reportPath: string;
    };
    expect(await runFiles(dir)).toEqual([
      `alphakolect-purge-report-${exported.runId}.jsonl`,
      `alphakolect-purge-run-${exported.runId}.marker`,
    ]);
    expect(await present(ids)).toBe(3); // an export deletes nothing
    const check = async () =>
      (json(await cli('reports', '--check-files')) as { fileChecks: Record<string, string> }).fileChecks[
        exported.runId
      ];
    expect(await check()).toBe('present_and_matching');
    const original = await readFile(exported.reportPath);
    await appendFile(exported.reportPath, '{"planted":true}\n');
    expect(await check()).toBe('altered');
    await writeFile(exported.reportPath, original);
    expect(await check()).toBe('present_and_matching');

    // The folder unavailable (a volume unmounted, a drive remapped): every file step says so and records nothing.
    const moved = `${dir}-moved`;
    await rename(dir, moved);
    try {
      expect(await check()).toBe('directory_unavailable');
      refused(
        await cli('report-lost', '--report', exported.reportId, '--note', 'cli test'),
        'report_directory_unavailable_use_attestation',
      );
      expect(
        (await owner.query(`SELECT lost_at FROM audit.purge_reports WHERE id = $1`, [exported.reportId]))
          .rows[0].lost_at,
      ).toBeNull();
      // A fixed disk is never the medium (it is not removable, and it is the report's own volume).
      const handover = await cli('report-handover', '--report', exported.reportId, '--to', tmpdir());
      if (process.platform === 'win32') refused(handover, 'wrong_drive_type');
      else expect(handover.code).toBe(1);
      expect(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM audit.purge_report_handovers WHERE report_id = $1`,
            [exported.reportId],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await rename(moved, dir);
    }
    await rm(exported.reportPath);
    expect(await check()).toBe('missing');

    // Lost before delivery: the run's files removed (the report already gone), the marker after; the request stays
    // open and the next run exports again from the same rows.
    expect((await cli('report-lost', '--report', exported.reportId, '--note', 'cli test: lost')).code).toBe(
      0,
    );
    expect(await runFiles(dir)).toEqual([]);
    const again = json(await cli('run', '--dir', dir)) as { runId: string; rows: number };
    expect(again.rows).toBeGreaterThanOrEqual(3);
    expect(await present(ids)).toBe(3);

    // Cancelled in writing: the active report withdrawn, its files removed, and the next plain run deletes the rows.
    expect((await cli('request-cancel', '--request', request, '--note', 'cli test: cancelled')).code).toBe(0);
    expect(await runFiles(dir)).toEqual([]);
    expect(json(await cli('run'))).toMatchObject({ kind: 'plain' });
    expect(await present(ids)).toBe(0);
    await rm(dir, { recursive: true, force: true });
  }, 180_000);

  it('an unwritable folder is refused before anything is recorded', async () => {
    const request = requestId(await cli('request-report', '--note', 'cli test: unwritable'));
    const dir = await privateDir();
    if (process.platform === 'win32')
      execFileSync('C:\\Windows\\System32\\icacls.exe', [dir, '/deny', `${process.env.USERNAME}:(W,AD)`]);
    else await chmod(dir, 0o500);
    const exportsBefore = (await owner.query(`SELECT count(*)::int AS n FROM audit.purge_exports`)).rows[0].n;
    try {
      const r = await cli('run', '--dir', dir);
      expect(r.code).toBe(1);
      // Windows refuses to resolve a folder its owner may not write to; elsewhere the write probe fails.
      expect(r.stderr).toMatch(/Audit purge failed: report_directory_not_(accessible|writable)/);
      expect((await owner.query(`SELECT count(*)::int AS n FROM audit.purge_exports`)).rows[0].n).toBe(
        exportsBefore,
      );
    } finally {
      if (process.platform === 'win32')
        execFileSync('C:\\Windows\\System32\\icacls.exe', [dir, '/remove:d', process.env.USERNAME!]);
      else await chmod(dir, 0o700);
      await rm(dir, { recursive: true, force: true });
      expect((await cli('request-cancel', '--request', request, '--note', 'cli test: cancelled')).code).toBe(
        0,
      );
    }
  }, 120_000);
});

describe('an export killed at each point, and its recovery', () => {
  beforeAll(() => setLease('1 second')); // a killed command's reservation is taken over at once
  afterAll(() => setLease('15 minutes'));

  /** Runs an export that stops at `stage`, kills it there, and returns its run and the folder. */
  async function killedAt(stage: string) {
    const dir = await privateDir();
    const pauseFile = join(tmpdir(), `akpause-${process.pid}-${stage}-${randomUUID()}`);
    await rm(pauseFile, { force: true });
    const { child, done } = start(['run', '--dir', dir], {
      AUDIT_PURGE_TEST_PAUSE_AT: stage,
      AUDIT_PURGE_TEST_PAUSE_FILE: pauseFile,
    });
    let exited: Result | undefined;
    void done.then((r) => (exited = r));
    try {
      for (let i = 0; i < 600 && !existsSync(pauseFile) && !exited; i++)
        await new Promise((r) => setTimeout(r, 100));
      if (!existsSync(pauseFile)) {
        const detail = exited?.stderr ?? 'still running';
        child.kill('SIGKILL');
        await done;
        throw new Error(`the export never reached ${stage}: ${detail}`);
      }
      child.kill('SIGKILL');
      await done;
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await done;
      }
      await rm(pauseFile, { force: true });
    }
    await new Promise((r) => setTimeout(r, 1100)); // the lease runs out
    const { run_id: runId } = (
      await owner.query(
        `SELECT run_id FROM audit.purge_exports WHERE directory = $1 ORDER BY started_at DESC LIMIT 1`,
        [dir],
      )
    ).rows[0];
    if (stage === 'mid_write') {
      const partial = await readFile(join(dir, `alphakolect-purge-report-${runId}.jsonl.partial`), 'utf8');
      expect(partial.split('\n').filter(Boolean)).toHaveLength(1);
    }
    return { dir, runId: runId as string };
  }

  for (const [stage, files] of [
    ['mid_write', ['partial', 'marker']],
    ['after_link', ['final', 'partial', 'marker']],
    ['before_confirm', ['final', 'marker']],
  ] as const) {
    it(`killed ${stage.replace('_', ' ')}: nothing deleted, the export unresolved until the next command discards it and removes its files`, async () => {
      const ids = await oldEvents(2);
      const request = requestId(await cli('request-report', '--note', `cli test: ${stage}`));
      const { dir, runId } = await killedAt(stage);
      await writeFile(join(dir, 'operator-notes.txt'), 'not the run’s'); // every other file is left alone
      const name = `alphakolect-purge-report-${runId}.jsonl`;
      const expected = {
        final: name,
        partial: `${name}.partial`,
        marker: `alphakolect-purge-run-${runId}.marker`,
      };
      expect(await runFiles(dir)).toEqual([...files.map((f) => expected[f]), 'operator-notes.txt'].sort());
      expect((await exportOf(runId)).outcome).toBeNull();
      refused(await cli('run', '--dir', dir), 'export_unresolved'); // it blocks every new run
      expect(await present(ids)).toBe(2);

      expect((await cli('export-discarded', '--run', runId)).code).toBe(0);
      expect(await runFiles(dir)).toEqual(['operator-notes.txt']);
      expect((await exportOf(runId)).outcome).toBe('discarded');
      expect(await present(ids)).toBe(2);
      expect((await cli('request-cancel', '--request', request, '--note', 'cli test: cancelled')).code).toBe(
        0,
      );
      json(await cli('run'));
      expect(await present(ids)).toBe(0);
      await rm(dir, { recursive: true, force: true });
    }, 180_000);
  }

  it('recovery by attestation (files removed by hand) and as lost (the machine gone)', async () => {
    await oldEvents(2);
    const request = requestId(await cli('request-report', '--note', 'cli test: attest and lost'));
    try {
      // Attested: only once the run's files are gone; then the record, then the marker.
      const first = await killedAt('mid_write');
      expect((await cli('export-discarded', '--run', first.runId, '--attest', 'removed by hand')).code).toBe(
        1,
      );
      expect((await exportOf(first.runId)).outcome).toBeNull();
      await rm(join(first.dir, `alphakolect-purge-report-${first.runId}.jsonl.partial`));
      expect((await cli('export-discarded', '--run', first.runId, '--attest', 'removed by hand')).code).toBe(
        0,
      );
      expect(await exportOf(first.runId)).toMatchObject({ outcome: 'discarded', lost: false });
      expect(await runFiles(first.dir)).toEqual([]);
      // Lost: recorded without the files (an incident); the files stay where they were.
      const second = await killedAt('after_link');
      expect(
        (await cli('export-discarded', '--run', second.runId, '--lost', 'cli test: the machine is gone'))
          .code,
      ).toBe(0);
      expect(await exportOf(second.runId)).toMatchObject({ outcome: 'discarded', lost: true });
      expect((await runFiles(second.dir)).length).toBe(3);
      await rm(first.dir, { recursive: true, force: true });
      await rm(second.dir, { recursive: true, force: true });
    } finally {
      expect((await cli('request-cancel', '--request', request, '--note', 'cli test: cancelled')).code).toBe(
        0,
      );
    }
  }, 240_000);

  it('the marker is removed only after the outcome is recorded: a failed record leaves it, and the retry finishes', async () => {
    await oldEvents(2);
    const request = requestId(await cli('request-report', '--note', 'cli test: marker order'));
    try {
      const { dir, runId } = await killedAt('mid_write');
      const fn = `test_fail_discard_${process.pid}`;
      await owner.query(
        `CREATE FUNCTION audit.${fn}() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW.action = 'platform.purge_export_discarded' THEN RAISE EXCEPTION 'injected' USING ERRCODE = 'XX000'; END IF;
           RETURN NEW;
         END $fn$`,
      );
      await owner.query(
        `CREATE TRIGGER ${fn} BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.${fn}()`,
      );
      try {
        expect((await cli('export-discarded', '--run', runId)).code).toBe(1);
        expect(await runFiles(dir)).toEqual([`alphakolect-purge-run-${runId}.marker`]); // the files gone, the marker kept
        expect((await exportOf(runId)).outcome).toBeNull();
      } finally {
        await owner.query(`DROP TRIGGER ${fn} ON audit.audit_events`);
        await owner.query(`DROP FUNCTION audit.${fn}()`);
      }
      expect((await cli('export-discarded', '--run', runId)).code).toBe(0);
      expect(await runFiles(dir)).toEqual([]);
      expect((await exportOf(runId)).outcome).toBe('discarded');
      await rm(dir, { recursive: true, force: true });
    } finally {
      expect((await cli('request-cancel', '--request', request, '--note', 'cli test: cancelled')).code).toBe(
        0,
      );
    }
  }, 180_000);

  it('killed after its confirmation committed: the report stands, its file present and matching', async () => {
    await oldEvents(2);
    const request = requestId(await cli('request-report', '--note', 'cli test: after confirm'));
    const { dir, runId } = await killedAt('after_confirm');
    expect((await exportOf(runId)).outcome).toBe('confirmed');
    const listing = json(await cli('reports', '--check-files')) as { fileChecks: Record<string, string> };
    expect(listing.fileChecks[runId]).toBe('present_and_matching');
    expect((await cli('request-cancel', '--request', request, '--note', 'cli test: cancelled')).code).toBe(0);
    expect(await runFiles(dir)).toEqual([]);
    json(await cli('run'));
    await rm(dir, { recursive: true, force: true });
  }, 180_000);
});

describe('the seven-day reminders (O21 S3)', () => {
  it('flags a copy awaited, a report not handed over, a stick not verified, and a receipt not recorded, each after seven days', async () => {
    const ago = (days: number) => `now() - interval '${days} days'`;
    const ids: { requests: string[]; reports: string[]; attempts: string[] } = {
      requests: [],
      reports: [],
      attempts: [],
    };
    const newRequest = async (days: number) => {
      const id = (
        await owner.query(
          `INSERT INTO audit.purge_report_requests (note, requested_at) VALUES ('reminders', ${ago(days)}) RETURNING id`,
        )
      ).rows[0].id as string;
      ids.requests.push(id);
      return id;
    };
    const newReport = async (requestId: string, days: number) => {
      const id = (
        await owner.query(
          `INSERT INTO audit.purge_reports (request_id, run_id, p_as_of, confirmed_at, row_count, page_count, manifest_digest,
                                            file_sha256, file_location)
           VALUES ($1, gen_random_uuid(), now(), ${ago(days)}, 1, 1, 'd', $2, 'x') RETURNING id`,
          [requestId, 'a'.repeat(64)],
        )
      ).rows[0].id as string;
      ids.reports.push(id);
      return id;
    };
    try {
      // A request open eight days with no report; then, alone (one open request at most), one open a day.
      const awaited = await newRequest(8);
      let listing = json(await cli('reports')) as {
        requests: { id: string; reminderCopyPending: boolean }[];
      };
      expect(listing.requests.find((r) => r.id === awaited)?.reminderCopyPending).toBe(true);
      await owner.query(
        `UPDATE audit.purge_report_requests SET state = 'cancelled', closed_at = now() WHERE id = $1`,
        [awaited],
      );
      const fresh = await newRequest(1);
      listing = json(await cli('reports')) as typeof listing;
      expect(listing.requests.find((r) => r.id === fresh)?.reminderCopyPending).toBe(false);

      // A report confirmed eight days ago with no recorded attempt; a stick written eight days ago, not verified.
      const report = await newReport(fresh, 8);
      const unverified = (
        await owner.query(
          `INSERT INTO audit.purge_report_handovers (report_id, started_at, medium, written_at)
           VALUES ($1, ${ago(8)}, 'E:', ${ago(8)}) RETURNING id`,
          [report],
        )
      ).rows[0].id as string;
      ids.attempts.push(unverified);
      type Listing = {
        reports: { id: string; reminderHandover: boolean; reminderReceipt: boolean }[];
        handovers: { id: string; reminderVerification: boolean }[];
      };
      let l = json(await cli('reports')) as Listing;
      expect(l.reports.find((r) => r.id === report)).toMatchObject({
        reminderHandover: true,
        reminderReceipt: false,
      });
      expect(l.handovers.find((h) => h.id === unverified)?.reminderVerification).toBe(true);
      // Verified (recorded) eight days ago, no receipt yet: the receipt is awaited.
      await owner.query(
        `UPDATE audit.purge_report_handovers SET outcome = 'recorded', ended_at = ${ago(8)}, medium_sha256 = $2,
                eject_attested = true WHERE id = $1`,
        [unverified, 'a'.repeat(64)],
      );
      l = json(await cli('reports')) as Listing;
      expect(l.reports.find((r) => r.id === report)).toMatchObject({
        reminderHandover: false,
        reminderReceipt: true,
      });
      expect(l.handovers.find((h) => h.id === unverified)?.reminderVerification).toBe(false);
    } finally {
      await owner.query(`DELETE FROM audit.purge_report_handovers WHERE id = ANY($1)`, [ids.attempts]);
      await owner.query(`DELETE FROM audit.purge_reports WHERE id = ANY($1)`, [ids.reports]);
      await owner.query(`DELETE FROM audit.purge_report_requests WHERE id = ANY($1)`, [ids.requests]);
    }
  }, 120_000);
});

describe('the report folder’s checks, and a marker left behind', () => {
  it('refuses a git work tree, a OneDrive folder, and a folder other accounts may open, recording nothing', async () => {
    const exportsBefore = (await owner.query(`SELECT count(*)::int AS n FROM audit.purge_exports`)).rows[0].n;
    const request = requestId(await cli('request-report', '--note', 'cli test: folders'));
    const roots: string[] = [];
    try {
      const repo = await privateDir();
      roots.push(repo);
      await mkdir(join(repo, '.git'));
      const inside = join(repo, 'reports');
      await mkdir(inside);
      refused(await cli('run', '--dir', inside), 'report_directory_is_git_worktree');

      const synced = await privateDir();
      roots.push(synced);
      refused(await start(['run', '--dir', synced], { OneDrive: synced }).done, 'report_directory_is_synced');

      const shared = await privateDir();
      roots.push(shared);
      if (process.platform === 'win32') {
        // Readable by every local user (the Users group), beside the operator.
        execFileSync('C:\\Windows\\System32\\icacls.exe', [shared, '/grant', '*S-1-5-32-545:(OI)(CI)R']);
        refused(await cli('run', '--dir', shared), 'non_operator_acl');
      } else {
        await chmod(shared, 0o750);
        refused(await cli('run', '--dir', shared), 'report_directory_not_owner_only');
      }
      expect((await owner.query(`SELECT count(*)::int AS n FROM audit.purge_exports`)).rows[0].n).toBe(
        exportsBefore,
      );
    } finally {
      for (const root of roots) await rm(root, { recursive: true, force: true });
      expect((await cli('request-cancel', '--request', request, '--note', 'cli test: cancelled')).code).toBe(
        0,
      );
    }
  }, 120_000);

  it('--check-files lists a marker left behind after its run’s outcome is recorded', async () => {
    await oldEvents(1);
    const request = requestId(await cli('request-report', '--note', 'cli test: leftover marker'));
    const dir = await privateDir();
    const exported = json(await cli('run', '--dir', dir)) as { runId: string };
    const marker = join(dir, `alphakolect-purge-run-${exported.runId}.marker`);
    const kept = await readFile(marker);
    expect((await cli('request-cancel', '--request', request, '--note', 'cli test: cancelled')).code).toBe(0);
    expect(await runFiles(dir)).toEqual([]);
    await writeFile(marker, kept); // left behind (a copy restored, a removal that failed)
    const listing = json(await cli('reports', '--check-files')) as { leftoverMarkers: string[] };
    expect(listing.leftoverMarkers).toContain(exported.runId);
    await rm(dir, { recursive: true, force: true });
    json(await cli('run'));
  }, 120_000);
});

// Answers lost after a step took effect (P5 plan §8.6; the reviewer's finding of 2026-10-19): the database committed,
// or the file system did the work, and the command saw an error instead. Each step's real effect is kept; the command
// fails, and what it leaves is what its recovery expects. The engine and the handover steps run in this process, on a
// connection that loses the answer of one chosen statement after the statement committed (each is its own transaction).
describe('answers lost after a step took effect', () => {
  const lostError = () =>
    Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
  /**
   * Runs every statement. The first that contains `match` runs `before` first (another command's step, if given), and
   * then — unless `lose` is false — commits and throws as a lost answer.
   */
  const losing = (
    match: string,
    { before, lose = true }: { before?: () => Promise<void>; lose?: boolean } = {},
  ): Queryable & { lost: number } => {
    let met = false;
    const db = {
      lost: 0,
      async query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
        const hit = !met && sql.includes(match);
        if (hit) met = true;
        if (hit && before) await before();
        const rows = (await owner.query<T>(sql, params)).rows;
        if (hit && lose) {
          db.lost++;
          throw lostError();
        }
        return rows;
      },
    };
    return db;
  };
  const plainDb: Queryable = {
    query: async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
      (await owner.query<T>(sql, params)).rows,
  };
  const databaseNow = async () =>
    (await owner.query(`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`))
      .rows[0].now as string;
  const exportInto = async (
    db: Queryable,
    dir: string,
    extra: Partial<Parameters<typeof runPurge>[0]> = {},
  ) =>
    runPurge({
      db,
      asOf: await databaseNow(),
      directory: dir,
      writerHostId: host.hostId,
      writerLockKey: host.lockKey,
      ...extra,
    });
  const request = async (note: string) =>
    (await owner.query(`SELECT audit.request_purge_report($1) AS id`, [note])).rows[0].id as string;
  const cancel = async (id: string) => {
    const [report] = (
      await owner.query<{ id: string; file_location: string; directory: string; run_id: string }>(
        `SELECT p.id, p.file_location, e.directory, p.run_id
           FROM audit.purge_reports p JOIN audit.purge_exports e ON e.run_id = p.run_id
          WHERE p.request_id = $1 AND p.delivered_at IS NULL AND p.withdrawn_at IS NULL AND p.lost_at IS NULL`,
        [id],
      )
    ).rows;
    await owner.query(`SELECT audit.cancel_purge_report_request($1, 'lost answers: cancelled')`, [id]);
    if (report) {
      await Promise.all([
        rm(report.file_location, { force: true }),
        rm(`${report.file_location}.partial`, { force: true }),
        rm(join(report.directory, `alphakolect-purge-run-${report.run_id}.marker`), { force: true }),
      ]);
      await owner.query(`SELECT audit.record_report_copy_destroyed($1, 'automatic', $2)`, [
        report.id,
        'test files removed; no other operator copy retained',
      ]);
    }
  };
  const reservationFree = async () =>
    (await owner.query(`SELECT run_id IS NULL AS free FROM audit.purge_reservation`)).rows[0].free as boolean;
  const lastExport = async () =>
    (await owner.query(`SELECT run_id, outcome FROM audit.purge_exports ORDER BY started_at DESC LIMIT 1`))
      .rows[0] as {
      run_id: string;
      outcome: string | null;
    };
  beforeAll(() => setLease('1 second')); // a run left reserved by a lost release is taken over by the next one
  afterAll(() => setLease('15 minutes'));
  const leaseOut = () => new Promise((r) => setTimeout(r, 1100));

  describe('the purge run', () => {
    it('a page deleted, its answer lost: the run reads the page’s own mark, counts it once, and goes on', async () => {
      const ids = await oldEvents(3);
      const db = losing('audit.purge_expired_events');
      const result = await runPurge({ db, asOf: await databaseNow() });
      expect(db.lost).toBe(1);
      expect(result).toMatchObject({ kind: 'plain' });
      expect(await present(ids)).toBe(0);
      const { rows } = await owner.query(`SELECT rows_deleted FROM audit.purge_runs WHERE run_id = $1`, [
        (result as { runId: string }).runId,
      ]);
      expect(rows[0].rows_deleted).toBe((result as { rowsDeleted: number }).rowsDeleted);
    });

    it('the release, its answer lost: the reservation is free all the same; the command reports a failure', async () => {
      await oldEvents(1);
      await expect(
        runPurge({ db: losing('audit.release_purge_run'), asOf: await databaseNow() }),
      ).rejects.toMatchObject({
        code: 'ECONNRESET',
      });
      expect(await reservationFree()).toBe(true);
    });
  });

  describe('the export', () => {
    for (const step of ['audit.begin_purge_export', 'audit.record_export_artifact'] as const) {
      it(`${step.slice(6)} took effect, its answer lost: nothing deleted, the export discarded, its files removed`, async () => {
        const ids = await oldEvents(2);
        const id = await request(`lost answers: ${step}`);
        const dir = await privateDir();
        try {
          await expect(exportInto(losing(step), dir)).rejects.toMatchObject({ code: 'ECONNRESET' });
          expect((await lastExport()).outcome).toBe('discarded');
          expect(await runFiles(dir)).toEqual([]);
          expect(await present(ids)).toBe(2);
        } finally {
          await leaseOut();
          await cancel(id);
          await rm(dir, { recursive: true, force: true });
        }
      });
    }

    it('the confirmation committed, its answer lost: the report stands with its file and marker; nothing is removed', async () => {
      const ids = await oldEvents(2);
      const id = await request('lost answers: confirm');
      const dir = await privateDir();
      try {
        await expect(exportInto(losing('audit.confirm_purge_report'), dir)).rejects.toMatchObject({
          code: 'ECONNRESET',
        });
        const { run_id: runId, outcome } = await lastExport();
        expect(outcome).toBe('confirmed');
        const { rows } = await owner.query(
          `SELECT file_location, file_sha256 FROM audit.purge_reports WHERE run_id = $1`,
          [runId],
        );
        expect(await sha256File(rows[0].file_location)).toBe(rows[0].file_sha256); // the report's own file, intact
        expect((await runFiles(dir)).length).toBe(2); // the report and its marker
        expect(await present(ids)).toBe(2);
      } finally {
        await leaseOut();
        await cancel(id); // withdraws the report; its files are the operator's to destroy (report-destroyed)
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('a failed write discarded, the discard’s answer lost: recorded discarded, files removed, the marker left for the listing', async () => {
      const id = await request('lost answers: discard');
      await oldEvents(1);
      const dir = await privateDir();
      try {
        const full = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
        await expect(
          exportInto(losing('audit.discard_purge_export'), dir, {
            writeChunk: async () => {
              throw full;
            },
          }),
        ).rejects.toMatchObject({ code: 'ECONNRESET' }); // what the operator sees: the lost answer
        const { run_id: runId, outcome } = await lastExport();
        expect(outcome).toBe('discarded');
        expect(await runFiles(dir)).toEqual([`alphakolect-purge-run-${runId}.marker`]);
      } finally {
        await leaseOut();
        await cancel(id);
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('the publication link made, its answer lost: the export left unresolved with both names, for export-discarded', async () => {
      const ids = await oldEvents(1);
      const id = await request('lost answers: publish');
      const dir = await privateDir();
      try {
        await expect(
          exportInto(plainDb, dir, {
            publish: async (from, to) => {
              await link(from, to);
              throw Object.assign(new Error('i/o error'), { code: 'EIO' });
            },
          }),
        ).rejects.toMatchObject({ code: 'EIO' });
        const { run_id: runId, outcome } = await lastExport();
        // Something it cannot account for is in the folder (the final name): never discarded automatically here.
        expect(outcome).toBeNull();
        expect(await runFiles(dir)).toEqual(
          [`alphakolect-purge-report-${runId}.jsonl`, `alphakolect-purge-run-${runId}.marker`].sort(),
        );
        expect(await present(ids)).toBe(1);
        await leaseOut();
        // The recovery the runbook names removes the run's files and records the discard.
        expect((await cli('export-discarded', '--run', runId)).code).toBe(0);
        expect(await runFiles(dir)).toEqual([]);
        expect((await lastExport()).outcome).toBe('discarded');
      } finally {
        await cancel(id);
        await rm(dir, { recursive: true, force: true });
      }
    }, 120_000);
  });

  describe('the handover', () => {
    /** A confirmed report in a private folder, and a folder standing in for the stick. */
    async function confirmedReport() {
      await oldEvents(1);
      const requestId = await request('lost answers: handover');
      const dir = await privateDir();
      const exported = (await exportInto(plainDb, dir)) as {
        reportId: string;
        runId: string;
        reportPath: string;
        sha256: string;
      };
      const stick = await mkdtemp(join(tmpdir(), 'akstick-'));
      const report = {
        id: exported.reportId,
        run_id: exported.runId,
        file_location: exported.reportPath,
        file_sha256: exported.sha256,
      };
      const medium = { path: stick, volumeKey: 'E:', label: 'OWNER COPY', serial: '1A2B3C4D', diskseq: null };
      const onStick = join(stick, `alphakolect-purge-report-${exported.runId}.jsonl`);
      const done = async () => {
        await owner.query(
          `SELECT audit.record_handover_abandoned(id, 'lost answers: stick wiped')
             FROM audit.purge_report_handovers WHERE report_id = $1 AND fate_attested_at IS NULL`,
          [report.id],
        );
        await owner.query(`SELECT audit.cancel_purge_report_request($1, 'lost answers: cancelled')`, [
          requestId,
        ]);
        await rm(dir, { recursive: true, force: true });
        await rm(stick, { recursive: true, force: true });
        await owner.query(`SELECT audit.record_report_copy_destroyed($1, 'automatic', $2)`, [
          report.id,
          'test files and stick removed; no other operator copy retained',
        ]);
      };
      return { report, medium, onStick, done };
    }
    const attemptOf = async (reportId: string) =>
      (
        await owner.query(
          `SELECT id, outcome, written_at FROM audit.purge_report_handovers WHERE report_id = $1`,
          [reportId],
        )
      ).rows[0] as { id: string; outcome: string | null; written_at: Date | null };
    const yes = async () => true;
    const quiet = () => undefined;

    it('the write recorded, its answer lost: the attempt is recorded written, the copy on the stick whole, the operator told', async () => {
      const h = await confirmedReport();
      try {
        const unresolved: string[] = [];
        await expect(
          writeHandover(losing('audit.record_handover_written'), h.report, h.medium, (a) =>
            unresolved.push(a),
          ),
        ).rejects.toMatchObject({ code: 'ECONNRESET' });
        const attempt = await attemptOf(h.report.id);
        expect(attempt.written_at).not.toBeNull();
        expect(unresolved).toEqual([attempt.id]);
        expect(await sha256File(h.onStick)).toBe(h.report.file_sha256);
      } finally {
        await h.done();
      }
    });

    it('the handover recorded, its answer lost: the attempt is recorded, the stick untouched', async () => {
      const h = await confirmedReport();
      try {
        await writeHandover(plainDb, h.report, h.medium, quiet);
        await expect(
          verifyHandover(losing('audit.record_report_handover'), h.report, h.medium, undefined, yes, quiet),
        ).rejects.toMatchObject({ code: 'ECONNRESET' });
        expect((await attemptOf(h.report.id)).outcome).toBe('recorded');
        expect(await sha256File(h.onStick)).toBe(h.report.file_sha256);
      } finally {
        await h.done();
      }
    });

    it('a failed verification recorded, its answer lost: the attempt is abandoned, the stick left for the operator', async () => {
      const h = await confirmedReport();
      try {
        await writeHandover(plainDb, h.report, h.medium, quiet);
        await appendFile(h.onStick, '{"changed":true}\n'); // the stick's bytes changed between the two steps
        const failed: string[] = [];
        await expect(
          verifyHandover(losing('audit.record_handover_failed'), h.report, h.medium, undefined, yes, (a) =>
            failed.push(a),
          ),
        ).rejects.toMatchObject({ code: 'ECONNRESET' });
        expect((await attemptOf(h.report.id)).outcome).toBe('abandoned');
        expect(existsSync(h.onStick)).toBe(true); // not removed: the command stopped at the lost answer
        expect(failed).toEqual([]);
      } finally {
        await h.done();
      }
    });

    it('the attempt recorded by another command after this one read it: the failure record is refused and the stick untouched', async () => {
      const h = await confirmedReport();
      try {
        const { attemptId } = await writeHandover(plainDb, h.report, h.medium, quiet);
        await appendFile(h.onStick, '{"changed":true}\n');
        const before = await readFile(h.onStick);
        const db = losing('audit.record_handover_failed', {
          lose: false,
          before: async () => {
            await owner.query(`SELECT audit.record_report_handover($1, $2, true, NULL)`, [
              attemptId,
              h.report.file_sha256,
            ]);
          },
        });
        await expect(verifyHandover(db, h.report, h.medium, attemptId, yes, quiet)).rejects.toMatchObject({
          code: '55000',
        });
        expect((await attemptOf(h.report.id)).outcome).toBe('recorded');
        expect(await readFile(h.onStick)).toEqual(before);
      } finally {
        await h.done();
      }
    });
  });
});
