import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, chmod, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { hostIdentity } from '../../src/modules/audit/purge-host.js';
import { acquirePurgeLock } from '../../src/modules/audit/purge-lock.js';

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
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--conditions=@alphakolect/source', SCRIPT, ...args],
    {
      cwd: API,
      env: { ...process.env, DATABASE_MIGRATOR_URL: inject('ownerDatabaseUrl'), ...env },
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
    const pauseFile = join(tmpdir(), `akpause-${process.pid}-${stage}`);
    const { child, done } = start(['run', '--dir', dir], {
      AUDIT_PURGE_TEST_PAUSE_AT: stage,
      AUDIT_PURGE_TEST_PAUSE_FILE: pauseFile,
    });
    for (let i = 0; i < 600 && !existsSync(pauseFile); i++) await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(pauseFile), `the export never reached ${stage}`).toBe(true);
    child.kill('SIGKILL');
    await done;
    await rm(pauseFile, { force: true });
    await new Promise((r) => setTimeout(r, 1100)); // the lease runs out
    const { run_id: runId } = (
      await owner.query(`SELECT run_id FROM audit.purge_exports ORDER BY started_at DESC LIMIT 1`)
    ).rows[0];
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
      const name = `alphakolect-purge-report-${runId}.jsonl`;
      const expected = {
        final: name,
        partial: `${name}.partial`,
        marker: `alphakolect-purge-run-${runId}.marker`,
      };
      expect(await runFiles(dir)).toEqual(files.map((f) => expected[f]).sort());
      expect((await exportOf(runId)).outcome).toBeNull();
      refused(await cli('run', '--dir', dir), 'export_unresolved'); // it blocks every new run
      expect(await present(ids)).toBe(2);

      expect((await cli('export-discarded', '--run', runId)).code).toBe(0);
      expect(await runFiles(dir)).toEqual([]);
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
