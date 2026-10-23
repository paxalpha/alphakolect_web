import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { access, link, open, readFile, realpath, rm, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path, { dirname, isAbsolute, join, parse as parsePath, relative, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import pg from 'pg';
import { z } from 'zod';
import type { Queryable } from '../src/platform/db.js';
import { inspectReportFile, runPurge, type Pause } from '../src/modules/audit/purge.js';
import { purgeClientConfig } from '../src/modules/audit/purge-connection.js';
import { hostIdentity, type Host } from '../src/modules/audit/purge-host.js';
import { verifyHandover, writeHandover } from '../src/modules/audit/purge-handover.js';
import { acquirePurgeLock } from '../src/modules/audit/purge-lock.js';

type VolumeInfo = {
  path: string;
  volumeKey: string;
  label: string;
  serial: string;
  diskseq: string | null;
  removable: boolean;
};
type ReportState = {
  id: string;
  run_id: string;
  file_location: string;
  file_sha256: string;
  writer_host_id: string;
  directory: string;
  delivered_at: Date | null;
  withdrawn_at: Date | null;
  lost_at: Date | null;
  copy_destroyed_at: Date | null;
};

// Windows' own tools by absolute path: a PATH lookup could find another program of the same name (Git for Windows
// puts GNU whoami ahead of the system's) when the operator runs the command from such a shell.
const windowsTool = (...parts: string[]) =>
  join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', ...parts);

function exec(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const isWithin = (root: string, candidate: string) => {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

function inGitWorkTree(directory: string): boolean {
  let current = path.resolve(directory);
  for (;;) {
    if (existsSync(join(current, '.git'))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function powershell(script: string): string {
  try {
    return exec(windowsTool('WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
  } catch (error) {
    // The scripts refuse with `throw '<code>'`; PowerShell prints the code alone on the first line of its error.
    // Pass that code on, so the operator sees why (the command's own text, which names paths, is not printed).
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : '';
    const code = stderr.split(/\r?\n/, 1)[0]?.trim() ?? '';
    throw new Error(/^[a-z0-9_]+$/.test(code) ? code : 'powershell_check_failed');
  }
}

async function validateReportDirectory(input: string, host: Host): Promise<string> {
  const directory = await realpath(input).catch((error: unknown) => {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    // Windows answers EPERM for a folder its owner may not write to; say what the operator must fix.
    throw new Error(code === 'ENOENT' ? 'report_directory_not_found' : 'report_directory_not_accessible');
  });
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error('report_path_not_directory');
  if (inGitWorkTree(directory)) throw new Error('report_directory_is_git_worktree');
  const resolved = path.resolve(directory);
  const oneDriveRoots = [
    process.env.OneDrive,
    process.env.OneDriveCommercial,
    process.env.OneDriveConsumer,
    join(process.env.USERPROFILE ?? '', 'OneDrive'),
  ].filter((value): value is string => Boolean(value));
  if (oneDriveRoots.some((root) => isWithin(path.resolve(root), resolved))) {
    throw new Error('report_directory_is_synced');
  }

  if (process.platform === 'win32') {
    if (directory.startsWith('\\\\')) throw new Error('report_directory_is_network_drive');
    const drive = parsePath(directory).root.slice(0, 2).toUpperCase();
    const substituted = exec(windowsTool('subst.exe'), [])
      .split(/\r?\n/)
      .some((line) => line.toUpperCase().startsWith(`${drive}\\:`));
    if (substituted) throw new Error('report_directory_is_subst_drive');
    const escapedDirectory = directory.replaceAll("'", "''");
    const escapedSid = host.lockKey.slice('windows:'.length);
    const check =
      `$ErrorActionPreference='Stop';` +
      `$p='${escapedDirectory}';$sid='${escapedSid}';` +
      `$owner=(Get-Acl -LiteralPath $p).Owner;` +
      `$ownerSid=(New-Object System.Security.Principal.NTAccount($owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value;` +
      `if($ownerSid -ne $sid){throw 'owner_mismatch'};` +
      `$allowed=@($sid,'S-1-5-18','S-1-5-32-544');` +
      `foreach($r in (Get-Acl -LiteralPath $p).Access){` +
      `if($r.AccessControlType -eq 'Allow'){` +
      `$rid=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;` +
      `if($allowed -notcontains $rid){throw 'non_operator_acl'}}};` +
      `$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'";` +
      `if(-not $d -or $d.DriveType -ne 3){throw 'not_local_fixed_disk'};` +
      `Write-Output 'ok'`;
    powershell(check);
  } else {
    if ((info.mode & 0o077) !== 0) throw new Error('report_directory_not_owner_only');
    const fileSystem = exec('findmnt', ['-n', '-o', 'FSTYPE', '-T', directory]).toLowerCase();
    if (/nfs|cifs|smb|sshfs|fuse/.test(fileSystem)) throw new Error('report_directory_not_local');
  }

  const probe = join(directory, `.alphakolect-hardlink-${randomUUID()}`);
  const probeLink = `${probe}.link`;
  try {
    let probeHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      probeHandle = await open(probe, 'wx', 0o600);
      await probeHandle.writeFile('probe');
      await probeHandle.sync();
    } catch {
      // Nothing can be written there: the export would fail at its first file.
      throw new Error('report_directory_not_writable');
    } finally {
      await probeHandle?.close().catch(() => undefined);
    }
    try {
      await link(probe, probeLink);
    } catch {
      throw new Error('report_directory_must_support_hard_links');
    }
  } finally {
    await Promise.all([rm(probe, { force: true }), rm(probeLink, { force: true })]);
  }
  return directory;
}

async function inspectVolume(input: string, requireRemovable: boolean): Promise<VolumeInfo> {
  const target = await realpath(input);
  if (process.platform === 'win32') {
    if (target.startsWith('\\\\')) throw new Error('medium_must_be_local');
    const escaped = target.replaceAll("'", "''");
    const root = parsePath(target).root;
    const drive = root.slice(0, 2).toUpperCase();
    const raw = powershell(
      `$ErrorActionPreference='Stop';$v=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'";` +
        `if(-not $v){throw 'volume_unavailable'};if(${requireRemovable ? '$v.DriveType -ne 2' : '$v.DriveType -ne 3'}){throw 'wrong_drive_type'};` +
        `$o=[pscustomobject]@{path='${escaped}';volumeKey=$v.DeviceID;label=[string]$v.VolumeName;serial=[string]$v.VolumeSerialNumber;diskseq=$null;removable=($v.DriveType -eq 2)};` +
        `$o|ConvertTo-Json -Compress`,
    );
    const result = JSON.parse(raw) as VolumeInfo;
    if (!result.serial.trim()) throw new Error('medium_serial_unavailable');
    if (requireRemovable && (!result.label.trim() || /^(NO NAME|UNTITLED)$/i.test(result.label.trim()))) {
      throw new Error('medium_requires_nondefault_volume_label');
    }
    return { ...result, path: target };
  }
  if (process.platform === 'linux') {
    const source = exec('findmnt', ['-n', '-o', 'SOURCE', '-T', target]);
    const fileSystem = exec('findmnt', ['-n', '-o', 'FSTYPE', '-T', target]);
    if (/nfs|cifs|smb|sshfs/.test(fileSystem.toLowerCase())) throw new Error('medium_must_be_local');
    const removable = exec('lsblk', ['-ndo', 'RM', source]) === '1';
    if (requireRemovable && !removable) throw new Error('medium_must_be_removable');
    const label = exec('lsblk', ['-ndo', 'LABEL', source]);
    const serial = exec('lsblk', ['-ndo', 'SERIAL', source]);
    if (!serial) throw new Error('medium_serial_unavailable');
    if (requireRemovable && (!label || /^(NO NAME|UNTITLED)$/i.test(label))) {
      throw new Error('medium_requires_nondefault_volume_label');
    }
    const majorMinor = exec('lsblk', ['-ndo', 'MAJ:MIN', source]);
    let diskseq: string | null = null;
    try {
      const sysfs = realpathSync(`/sys/dev/block/${majorMinor}`);
      const direct = join(sysfs, 'diskseq');
      const parent = join(dirname(sysfs), 'diskseq');
      diskseq = readFileSync(existsSync(direct) ? direct : parent, 'utf8').trim() || null;
    } catch {
      diskseq = null;
    }
    return { path: target, volumeKey: source, label, serial, diskseq, removable };
  }
  throw new Error('unsupported_platform_for_medium_inspection');
}

function realpathSync(pathname: string): string {
  return exec('realpath', [pathname]);
}

async function requireSeparateVolume(sourceDirectory: string, targetDirectory: string): Promise<void> {
  const [source, target] = await Promise.all([stat(sourceDirectory), stat(targetDirectory)]);
  if (source.dev === target.dev) throw new Error('handover_medium_must_be_separate_volume');
}

async function reportState(db: Queryable, reportId: string): Promise<ReportState | undefined> {
  const [row] = await db.query<ReportState>(
    `SELECT p.id, p.run_id, p.file_location, p.file_sha256, p.delivered_at, p.withdrawn_at, p.lost_at,
            p.copy_destroyed_at, e.writer_host_id, e.directory
       FROM audit.purge_reports p
       JOIN audit.purge_exports e ON e.run_id = p.run_id
      WHERE p.id = $1`,
    [reportId],
  );
  return row;
}

async function requireLocalMarker(report: ReportState, host: Host): Promise<void> {
  if (report.writer_host_id !== host.hostId) throw new Error('report_is_on_another_host');
  if (!(await hasValidMarker(report.directory, report.run_id, host.hostId))) {
    throw new Error('report_directory_unavailable');
  }
}

async function destroyLocalCopy(report: ReportState, host: Host): Promise<void> {
  await requireLocalMarker(report, host);
  await removeRunFiles(report.directory, report.run_id);
}

async function askEject(attemptId: string, label: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `After ejecting and reinserting ${label}, type "ejected ${attemptId} ${label}": `,
    );
    return answer === `ejected ${attemptId} ${label}`;
  } finally {
    rl.close();
  }
}

const reportName = (runId: string) => `alphakolect-purge-report-${runId}.jsonl`;
const markerName = (runId: string) => `alphakolect-purge-run-${runId}.marker`;

async function hasValidMarker(directory: string, runId: string, hostId: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(directory, markerName(runId)), 'utf8')) as {
      runId?: string;
      hostId?: string;
    };
    return marker.runId === runId && marker.hostId === hostId;
  } catch {
    return false;
  }
}

async function removeRunFiles(directory: string, runId: string): Promise<void> {
  const finalPath = join(directory, reportName(runId));
  const partialPath = `${finalPath}.partial`;
  await Promise.all([rm(finalPath, { force: true }), rm(partialPath, { force: true })]);
  const handle = await open(directory, 'r').catch(() => undefined);
  if (handle) {
    try {
      await handle.sync();
    } catch (error) {
      if (process.platform !== 'win32') throw error;
    } finally {
      await handle.close();
    }
  }
  const remaining = await Promise.all([
    access(finalPath).then(
      () => true,
      () => false,
    ),
    access(partialPath).then(
      () => true,
      () => false,
    ),
  ]);
  if (remaining.some(Boolean)) throw new Error('run_files_remain');
}

async function assertNoRunFiles(directory: string, runId: string): Promise<void> {
  const finalPath = join(directory, reportName(runId));
  const partialPath = `${finalPath}.partial`;
  const [finalExists, partialExists] = await Promise.all([
    access(finalPath).then(
      () => true,
      () => false,
    ),
    access(partialPath).then(
      () => true,
      () => false,
    ),
  ]);
  if (finalExists || partialExists) throw new Error('run_files_must_be_removed_before_attestation');
}

async function removeMarker(directory: string, runId: string): Promise<void> {
  await rm(join(directory, markerName(runId)), { force: true });
  const handle = await open(directory, 'r').catch(() => undefined);
  if (handle) {
    try {
      await handle.sync();
    } catch (error) {
      if (process.platform !== 'win32') throw error;
    } finally {
      await handle.close();
    }
  }
}

async function openMigrator(): Promise<{ db: Queryable; close(): Promise<void> }> {
  const env = z
    .object({ DATABASE_MIGRATOR_URL: z.url({ protocol: /^postgres(ql)?$/ }) })
    .safeParse(process.env);
  if (!env.success) throw new Error('invalid_configuration_DATABASE_MIGRATOR_URL');
  const client = new pg.Client(purgeClientConfig(env.data.DATABASE_MIGRATOR_URL));
  await client.connect();
  return {
    db: {
      query: async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
        (await client.query<T>(sql, params)).rows,
    },
    close: () => client.end(),
  };
}

/**
 * A test-only gate (§8.6's tests stop an export at a chosen point and kill the command): with
 * AUDIT_PURGE_TEST_PAUSE_AT naming a stage and AUDIT_PURGE_TEST_PAUSE_FILE a file, the export writes the stage into
 * the file there and waits until the file is gone. Without both variables it does nothing.
 */
function testPause(): { pause?: Pause } {
  const at = process.env.AUDIT_PURGE_TEST_PAUSE_AT;
  const file = process.env.AUDIT_PURGE_TEST_PAUSE_FILE;
  if (process.env.NODE_ENV !== 'test' || !at || !file) return {};
  return {
    pause: async (stage) => {
      if (stage !== at) return;
      writeFileSync(file, stage);
      while (existsSync(file)) await new Promise((r) => setTimeout(r, 50));
    },
  };
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const command = args.shift() ?? 'run';
  const parsed = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      'as-of': { type: 'string' },
      note: { type: 'string' },
      request: { type: 'string' },
      report: { type: 'string' },
      attempt: { type: 'string' },
      run: { type: 'string' },
      receipt: { type: 'string' },
      to: { type: 'string' },
      verify: { type: 'boolean', default: false },
      'check-files': { type: 'boolean', default: false },
      attest: { type: 'string' },
      lost: { type: 'string' },
    },
  });
  if (parsed.positionals.length > 0) throw new Error('unexpected_positional_arguments');

  const lostWithoutLock =
    Boolean(parsed.values.lost) && ['export-discarded', 'report-lost', 'report-destroyed'].includes(command);
  const readOnlyList = command === 'reports' && !parsed.values['check-files'];
  const host = readOnlyList || lostWithoutLock ? undefined : hostIdentity();
  const directory =
    command === 'run' && parsed.values.dir
      ? await validateReportDirectory(parsed.values.dir, host!)
      : undefined;
  const medium =
    command === 'report-handover' && parsed.values.to
      ? await inspectVolume(parsed.values.to, true)
      : undefined;
  const lock = readOnlyList || lostWithoutLock ? undefined : await acquirePurgeLock(host!.lockAddress);
  let connection: Awaited<ReturnType<typeof openMigrator>> | undefined;
  try {
    connection = await openMigrator();
    if (command === 'run') {
      // By default the database's own clock, read in a statement before the reservation's: the operator's machine may
      // run ahead of it, and a p_as_of later than the database's now() is refused (as_of_in_future).
      const asOf =
        parsed.values['as-of'] ??
        (
          await connection.db.query<{ now: string }>(
            `SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
          )
        )[0]!.now;
      const result = await runPurge({
        db: connection.db,
        asOf,
        directory,
        writerHostId: host!.hostId,
        writerLockKey: host!.lockKey,
        ...testPause(),
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.kind === 'export_skipped') {
        process.stderr.write(
          'A report request is open; this run deleted no audit rows and created no copy. Supply --dir.\n',
        );
      }
      if (result.kind === 'export' && !result.directoryFsync) {
        process.stderr.write(
          'Directory fsync unavailable; file was fsynced and read back before confirmation.\n',
        );
      }
      return;
    }
    if (command === 'request-report') {
      const note = parsed.values.note?.trim();
      if (!note) throw new Error('request_report_requires_note');
      const [row] = await connection.db.query<{ id: string }>(`SELECT audit.request_purge_report($1) AS id`, [
        note,
      ]);
      process.stdout.write(`Report request recorded: ${row!.id}\n`);
      return;
    }
    if (command === 'request-cancel') {
      const requestId = parsed.values.request;
      const note = parsed.values.note?.trim();
      if (!requestId || !note) throw new Error('request_cancel_requires_id_and_note');
      const [activeReport] = await connection.db.query<{ id: string }>(
        `SELECT id FROM audit.purge_reports
          WHERE request_id = $1 AND delivered_at IS NULL AND withdrawn_at IS NULL AND lost_at IS NULL`,
        [requestId],
      );
      const [row] = await connection.db.query<{ cancel_purge_report_request: string | null }>(
        `SELECT audit.cancel_purge_report_request($1, $2)`,
        [requestId, note],
      );
      if (activeReport && row?.cancel_purge_report_request) {
        const report = await reportState(connection.db, activeReport.id);
        if (!report) throw new Error('withdrawn_report_missing');
        const attestation = parsed.values.attest?.trim();
        if (report.writer_host_id !== host!.hostId) throw new Error('report_is_on_another_host');
        const marked = await hasValidMarker(report.directory, report.run_id, host!.hostId);
        let mode: 'automatic' | 'attested' = 'automatic';
        if (marked) await removeRunFiles(report.directory, report.run_id);
        else {
          if (!attestation) throw new Error('withdrawn_copy_requires_destruction_attestation');
          const finalPath = join(report.directory, reportName(report.run_id));
          const partialPath = `${finalPath}.partial`;
          const [finalExists, partialExists] = await Promise.all([
            access(finalPath).then(
              () => true,
              () => false,
            ),
            access(partialPath).then(
              () => true,
              () => false,
            ),
          ]);
          if (finalExists || partialExists) throw new Error('remove_report_files_before_attesting');
          mode = 'attested';
        }
        await connection.db.query(`SELECT audit.record_report_copy_destroyed($1, $2, $3)`, [
          report.id,
          mode,
          attestation ?? 'withdrawn report copy removed by the operator',
        ]);
        if (marked) await removeMarker(report.directory, report.run_id);
      }
      process.stdout.write(
        `Request cancelled${row?.cancel_purge_report_request ? `; withdrawn report ${row.cancel_purge_report_request}` : ''}.\n`,
      );
      return;
    }
    if (command === 'reports') {
      // One after another: a single client runs one query at a time.
      const requests = await connection.db.query(
        `SELECT id, requested_at, state, closed_at FROM audit.purge_report_requests ORDER BY requested_at`,
      );
      const exports = await connection.db.query(
        `SELECT run_id, directory, writer_host_id, started_at, artifact_recorded_at, outcome, lost FROM audit.purge_exports ORDER BY started_at`,
      );
      const reports = await connection.db.query(
        `SELECT id, run_id, request_id, confirmed_at, row_count, file_location, file_sha256, delivered_at, withdrawn_at, lost_at, copy_destroyed_at FROM audit.purge_reports ORDER BY confirmed_at`,
      );
      const handovers = await connection.db.query(
        `SELECT id, report_id, started_at, medium, written_at, outcome, fate_attested_at FROM audit.purge_report_handovers ORDER BY started_at`,
      );
      const fileChecks: Record<string, string> = {};
      const markers: string[] = [];
      if (parsed.values['check-files']) {
        for (const report of (
          reports as {
            run_id: string;
            file_location: string;
            file_sha256: string;
            copy_destroyed_at: Date | null;
            lost_at: Date | null;
          }[]
        ).filter((item) => item.copy_destroyed_at === null && item.lost_at === null)) {
          const [metadata] = await connection.db.query<{
            directory: string;
            writer_host_id: string;
            outcome: string | null;
          }>(`SELECT directory, writer_host_id, outcome FROM audit.purge_exports WHERE run_id = $1`, [
            report.run_id,
          ]);
          if (!metadata || metadata.writer_host_id !== host!.hostId) {
            fileChecks[report.run_id] = 'directory_unavailable';
            continue;
          }
          if (!(await hasValidMarker(metadata.directory, report.run_id, host!.hostId))) {
            fileChecks[report.run_id] = 'directory_unavailable';
            continue;
          }
          const pages = await connection.db.query<{ row_count: number; digest: string }>(
            `SELECT row_count, digest FROM audit.purge_run_pages WHERE run_id = $1 ORDER BY page_no`,
            [report.run_id],
          );
          fileChecks[report.run_id] = await inspectReportFile(
            report.file_location,
            report.file_sha256,
            pages.map((page) => page.row_count),
            pages.map((page) => page.digest),
          );
        }
        const allExports = exports as {
          run_id: string;
          directory: string;
          writer_host_id: string;
          outcome: string | null;
        }[];
        const reportsByRun = new Map(
          (reports as { run_id: string; copy_destroyed_at: Date | null; lost_at: Date | null }[]).map(
            (report) => [report.run_id, report],
          ),
        );
        for (const entry of allExports.filter(
          (item) => item.outcome !== null && item.writer_host_id === host!.hostId,
        )) {
          const report = reportsByRun.get(entry.run_id);
          const markerPath = join(entry.directory, markerName(entry.run_id));
          const markerExists = await access(markerPath).then(
            () => true,
            () => false,
          );
          const markerShouldRemain = Boolean(
            report && report.copy_destroyed_at === null && report.lost_at === null,
          );
          if (markerExists && !markerShouldRemain) markers.push(entry.run_id);
        }
      }
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const activeReports = (
        reports as {
          id: string;
          request_id: string;
          confirmed_at: Date;
          delivered_at: Date | null;
          withdrawn_at: Date | null;
          lost_at: Date | null;
        }[]
      ).filter((report) => !report.delivered_at && !report.withdrawn_at && !report.lost_at);
      const reportsWithReminders = (
        reports as {
          id: string;
          request_id: string;
          confirmed_at: Date;
          delivered_at: Date | null;
          withdrawn_at: Date | null;
          lost_at: Date | null;
        }[]
      ).map((report) => {
        const attempts = (
          handovers as {
            report_id: string;
            started_at: Date;
            written_at: Date | null;
            outcome: string | null;
          }[]
        ).filter((attempt) => attempt.report_id === report.id);
        const liveRecorded = attempts.find((attempt) => attempt.outcome === 'recorded');
        return {
          ...report,
          reminderHandover:
            !report.delivered_at &&
            !report.withdrawn_at &&
            !report.lost_at &&
            !liveRecorded &&
            now - new Date(report.confirmed_at).getTime() >= sevenDays,
          reminderReceipt: Boolean(
            liveRecorded?.written_at && now - new Date(liveRecorded.written_at).getTime() >= sevenDays,
          ),
        };
      });
      const requestsWithReminders = (
        requests as { id: string; requested_at: Date; state: string; closed_at: Date | null }[]
      ).map((request) => ({
        ...request,
        reminderCopyPending:
          request.state === 'open' &&
          !activeReports.some((report) => report.request_id === request.id) &&
          now - new Date(request.requested_at).getTime() >= sevenDays,
      }));
      const handoversWithReminders = (
        handovers as {
          id: string;
          report_id: string;
          started_at: Date;
          written_at: Date | null;
          outcome: string | null;
        }[]
      ).map((attempt) => ({
        ...attempt,
        reminderVerification:
          attempt.outcome === null &&
          Boolean(attempt.written_at) &&
          now - new Date(attempt.written_at!).getTime() >= sevenDays,
      }));
      process.stdout.write(
        `${JSON.stringify({ requests: requestsWithReminders, exports, reports: reportsWithReminders, handovers: handoversWithReminders, ...(parsed.values['check-files'] ? { fileChecks, leftoverMarkers: markers } : {}) }, null, 2)}\n`,
      );
      return;
    }
    if (command === 'report-handover') {
      const reportId = parsed.values.report;
      if (!reportId || !medium) throw new Error('handover_requires_report_and_removable_medium');
      const report = await reportState(connection.db, reportId);
      if (!report) throw new Error('report_not_found');
      await requireLocalMarker(report, host!);
      await requireSeparateVolume(report.directory, medium.path);
      if (!parsed.values.verify) {
        const { attemptId } = await writeHandover(connection.db, report, medium, (attempt) =>
          process.stderr.write(
            `Handover attempt ${attempt} is unresolved. Do not use this medium; inspect and securely wipe or destroy it, then run audit:purge-report-handover-abandoned --attempt ${attempt} --note "what became of the stick".\n`,
          ),
        );
        process.stdout.write(
          `Report written to ${medium.label} (${medium.serial}), SHA-256 ${report.file_sha256}, attempt ${attemptId}. Safely eject and physically reinsert the stick, then run audit:purge-report-handover --report ${reportId} --attempt ${attemptId} --verify --to "${medium.path}".\n`,
        );
        return;
      }

      const verified = await verifyHandover(
        connection.db,
        report,
        medium,
        parsed.values.attempt,
        askEject,
        (attempt) =>
          process.stderr.write(
            `The handover failed. Securely wipe or destroy the stick, then record its fate with audit:purge-report-handover-abandoned --attempt ${attempt} --note "what became of the stick".\n`,
          ),
      );
      process.stdout.write(
        `Handover verified: attempt ${verified.attemptId}, ${medium.label}, SHA-256 ${verified.sha256}. Obtain the owner's written receipt quoting this attempt, label, and hash prefix.\n`,
      );
      return;
    }
    if (command === 'handover-abandoned') {
      const attemptId = parsed.values.attempt;
      const note = parsed.values.note?.trim();
      if (!attemptId || !note) throw new Error('handover_abandoned_requires_attempt_and_note');
      const [row] = await connection.db.query<{ record_handover_abandoned: string }>(
        `SELECT audit.record_handover_abandoned($1, $2)`,
        [attemptId, note],
      );
      process.stdout.write(
        `Handover attempt ${attemptId} recorded ${row?.record_handover_abandoned ?? 'abandoned'}.\n`,
      );
      return;
    }
    if (command === 'report-delivered') {
      const reportId = parsed.values.report;
      const attemptId = parsed.values.attempt;
      const receipt = parsed.values.receipt?.trim();
      const note = parsed.values.note?.trim();
      if (!reportId || !attemptId || !receipt || !note) {
        throw new Error('report_delivery_requires_report_attempt_receipt_and_note');
      }
      const report = await reportState(connection.db, reportId);
      if (!report) throw new Error('report_not_found');
      await connection.db.query(`SELECT audit.record_report_delivery($1, $2, $3, $4)`, [
        reportId,
        attemptId,
        receipt,
        note,
      ]);
      try {
        await destroyLocalCopy(report, host!);
        await connection.db.query(`SELECT audit.record_report_copy_destroyed($1, 'automatic', $2)`, [
          reportId,
          'owner receipt recorded; operator copy deleted and verified; no other operator copy retained',
        ]);
        await removeMarker(report.directory, report.run_id);
        process.stdout.write(`Delivery recorded and operator copy destroyed for report ${reportId}.\n`);
      } catch {
        process.stdout.write(
          `Delivery recorded for report ${reportId}; operator-copy destruction is still pending. Run audit:purge-report-destroyed --report ${reportId} after resolving the file.\n`,
        );
      }
      return;
    }
    if (command === 'report-destroyed') {
      const reportId = parsed.values.report;
      const note = parsed.values.note?.trim() ?? parsed.values.attest?.trim() ?? parsed.values.lost?.trim();
      if (!reportId || !note) throw new Error('report_destroyed_requires_report_and_note');
      const report = await reportState(connection.db, reportId);
      if (!report) throw new Error('report_not_found');
      const mode: 'automatic' | 'attested' | 'lost' = parsed.values.lost
        ? 'lost'
        : parsed.values.attest
          ? 'attested'
          : 'automatic';
      if (mode !== 'lost') {
        if (report.writer_host_id !== host!.hostId) throw new Error('report_is_on_another_host');
        const marked = await hasValidMarker(report.directory, report.run_id, host!.hostId);
        if (mode === 'automatic') {
          if (!marked) throw new Error('report_directory_unavailable_use_attestation');
          await destroyLocalCopy(report, host!);
        } else {
          const finalPath = join(report.directory, reportName(report.run_id));
          const partialPath = `${finalPath}.partial`;
          const [finalExists, partialExists] = await Promise.all([
            access(finalPath).then(
              () => true,
              () => false,
            ),
            access(partialPath).then(
              () => true,
              () => false,
            ),
          ]);
          if (finalExists || partialExists) throw new Error('remove_report_files_before_attesting');
        }
        await connection.db.query(`SELECT audit.record_report_copy_destroyed($1, $2, $3)`, [
          reportId,
          mode,
          note,
        ]);
        if (marked) await removeMarker(report.directory, report.run_id);
      } else {
        await connection.db.query(`SELECT audit.record_report_copy_destroyed($1, $2, $3)`, [
          reportId,
          mode,
          note,
        ]);
      }
      process.stdout.write(`Operator-copy destruction recorded for report ${reportId} (${mode}).\n`);
      return;
    }
    if (command === 'report-lost') {
      const reportId = parsed.values.report;
      const note = parsed.values.note?.trim() ?? parsed.values.attest?.trim() ?? parsed.values.lost?.trim();
      if (!reportId || !note) throw new Error('report_lost_requires_report_and_note');
      const report = await reportState(connection.db, reportId);
      if (!report) throw new Error('report_not_found');
      const mode: 'automatic' | 'attested' | 'lost' = parsed.values.lost
        ? 'lost'
        : parsed.values.attest
          ? 'attested'
          : 'automatic';
      if (mode !== 'lost') {
        if (report.writer_host_id !== host!.hostId) throw new Error('report_is_on_another_host');
        const marked = await hasValidMarker(report.directory, report.run_id, host!.hostId);
        if (mode === 'automatic') {
          if (!marked) throw new Error('report_directory_unavailable_use_attestation');
          await destroyLocalCopy(report, host!);
        } else {
          const finalPath = join(report.directory, reportName(report.run_id));
          const partialPath = `${finalPath}.partial`;
          const [finalExists, partialExists] = await Promise.all([
            access(finalPath).then(
              () => true,
              () => false,
            ),
            access(partialPath).then(
              () => true,
              () => false,
            ),
          ]);
          if (finalExists || partialExists) throw new Error('remove_report_files_before_attesting');
        }
      }
      await connection.db.query(`SELECT audit.record_report_lost($1, $2, $3)`, [reportId, mode, note]);
      if (mode !== 'lost' && (await hasValidMarker(report.directory, report.run_id, host!.hostId))) {
        await removeMarker(report.directory, report.run_id);
      }
      process.stdout.write(`Report ${reportId} recorded lost (${mode}); a later run will make a new copy.\n`);
      return;
    }
    if (command === 'export-discarded') {
      const runId = parsed.values.run;
      if (!runId) throw new Error('export_discard_requires_run_id');
      const [entry] = await connection.db.query<{
        directory: string;
        writer_host_id: string;
        outcome: string | null;
        artifact_recorded_at: Date | null;
      }>(
        `SELECT directory, writer_host_id, outcome, artifact_recorded_at FROM audit.purge_exports WHERE run_id = $1`,
        [runId],
      );
      if (!entry || entry.outcome !== null) throw new Error('export_not_open');
      const note = parsed.values.attest ?? parsed.values.lost;
      const mode = parsed.values.lost ? 'lost' : parsed.values.attest ? 'attested' : 'automatic';
      if (mode === 'lost') {
        if (!note) throw new Error('lost_export_requires_note');
      } else if (entry.writer_host_id !== host!.hostId) {
        throw new Error('export_must_be_resolved_on_recorded_host');
      } else {
        const marked = await hasValidMarker(entry.directory, runId, host!.hostId);
        if (mode === 'automatic' && (!marked || !entry.artifact_recorded_at)) {
          throw new Error('export_requires_operator_attestation');
        }
        if (mode === 'automatic') await removeRunFiles(entry.directory, runId);
        if (mode === 'attested') {
          if (!note) throw new Error('attested_export_discard_requires_note');
          await assertNoRunFiles(entry.directory, runId);
        }
        if (!note && mode === 'attested') throw new Error('attested_export_discard_requires_note');
      }
      await connection.db.query(`SELECT audit.discard_purge_export($1, $2, $3)`, [
        runId,
        note ?? 'automatic cleanup',
        mode,
      ]);
      if (
        mode !== 'lost' &&
        entry.writer_host_id === host!.hostId &&
        (await hasValidMarker(entry.directory, runId, host!.hostId))
      ) {
        await removeMarker(entry.directory, runId);
      }
      process.stdout.write(`Export ${runId} recorded ${mode}.\n`);
      return;
    }
    throw new Error(`unsupported_command_${command}`);
  } finally {
    await connection?.close();
    await lock?.close();
  }
}

run().catch((error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  const safeMessage =
    error instanceof Error && /^[a-z0-9_:-]+$/i.test(error.message)
      ? error.message
      : (code ?? 'operator_command_failed');
  process.stderr.write(`Audit purge failed: ${safeMessage}\n`);
  process.exitCode = 1;
});
