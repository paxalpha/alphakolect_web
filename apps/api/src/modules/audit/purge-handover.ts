import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import path, { join } from 'node:path';
import type { Queryable } from '../../platform/db.js';

// The handover of a confirmed copy to the owner's stick (P5 plan §8.6 item 9): two commands, the write and — after
// the stick was ejected, unplugged and inserted again — the verification. The volume's identity is read by the command
// (it needs the real device); these steps do the rest: the attempt's records in the database and the file on the
// stick, in an order that keeps every outcome recoverable when a step's answer is lost after it took effect.

/** A removable volume as the command read it. */
export type Medium = {
  path: string;
  volumeKey: string;
  label: string;
  serial: string;
  diskseq: string | null;
};
export type HandoverReport = { id: string; run_id: string; file_location: string; file_sha256: string };
type Attempt = {
  id: string;
  medium: string;
  write_diskseq: string | null;
  outcome: string | null;
  written_at: Date | null;
};

export const reportName = (runId: string) => `alphakolect-purge-report-${runId}.jsonl`;

export async function sha256File(pathname: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(pathname)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function parseStoredMedium(value: string): Omit<Medium, 'diskseq'> {
  const medium = JSON.parse(value) as Partial<Medium>;
  if (!medium.path || !medium.volumeKey || !medium.label || !medium.serial)
    throw new Error('stored_medium_metadata_invalid');
  return medium as Omit<Medium, 'diskseq'>;
}

/**
 * The first command: records the attempt, writes the copy onto the stick (a new file, never over another), flushes
 * it, then records it written. Any failure after the attempt exists leaves it listed as unended; `unresolved` tells the
 * operator what to do with the stick.
 */
export async function writeHandover(
  db: Queryable,
  report: HandoverReport,
  medium: Medium,
  unresolved: (attemptId: string) => void,
): Promise<{ attemptId: string }> {
  const [attemptRow] = await db.query<{ id: string }>(`SELECT audit.begin_report_handover($1, $2) AS id`, [
    report.id,
    JSON.stringify({
      path: medium.path,
      volumeKey: medium.volumeKey,
      label: medium.label,
      serial: medium.serial,
    }),
  ]);
  const attemptId = attemptRow!.id;
  const target = await open(join(medium.path, reportName(report.run_id)), 'wx', 0o600);
  try {
    for await (const chunk of createReadStream(report.file_location)) await target.writeFile(chunk as Buffer);
    await target.sync();
    await target.close();
    await db.query(`SELECT audit.record_handover_written($1, $2)`, [attemptId, medium.diskseq]);
  } catch (error) {
    await target.close().catch(() => undefined);
    unresolved(attemptId);
    throw error;
  }
  return { attemptId };
}

/**
 * The second command, in a new process after the stick was ejected and inserted again: the same stick, unplugged in
 * between (where the system gives a disk sequence), the eject confirmed by the operator, and the same bytes. A copy
 * that does not match is recorded failed before it is removed from the stick, so a refused record leaves the stick
 * untouched; a match is recorded handed over and the stick left as it is.
 */
export async function verifyHandover(
  db: Queryable,
  report: HandoverReport,
  medium: Medium,
  attemptId: string | undefined,
  confirmEject: (attemptId: string, label: string) => Promise<boolean>,
  failed: (attemptId: string) => void,
): Promise<{ attemptId: string; sha256: string }> {
  const [attempt] = attemptId
    ? await db.query<Attempt>(
        `SELECT id, medium, write_diskseq, outcome, written_at FROM audit.purge_report_handovers
          WHERE id = $1 AND report_id = $2`,
        [attemptId, report.id],
      )
    : await db.query<Attempt>(
        `SELECT id, medium, write_diskseq, outcome, written_at FROM audit.purge_report_handovers
          WHERE report_id = $1 AND outcome IS NULL AND written_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`,
        [report.id],
      );
  if (!attempt || attempt.outcome !== null || !attempt.written_at)
    throw new Error('handover_attempt_not_verifiable');
  const recorded = parseStoredMedium(attempt.medium);
  if (
    recorded.serial !== medium.serial ||
    recorded.label !== medium.label ||
    recorded.volumeKey !== medium.volumeKey ||
    path.resolve(recorded.path).toLowerCase() !== path.resolve(medium.path).toLowerCase()
  ) {
    throw new Error('medium_identity_mismatch');
  }
  if (attempt.write_diskseq !== null && (!medium.diskseq || medium.diskseq === attempt.write_diskseq)) {
    throw new Error('medium_not_ejected_and_reinserted');
  }
  if (!(await confirmEject(attempt.id, medium.label))) throw new Error('eject_not_confirmed');

  const targetPath = join(medium.path, reportName(report.run_id));
  let actualHash: string;
  try {
    actualHash = await sha256File(targetPath);
  } catch {
    actualHash = '';
  }
  if (actualHash !== report.file_sha256) {
    // Recorded first: if the record is refused (another command recorded the attempt meanwhile) the stick is left.
    await db.query(`SELECT audit.record_handover_failed($1, $2)`, [
      attempt.id,
      'medium_file_unreadable_or_hash_mismatch',
    ]);
    await rm(targetPath, { force: true });
    failed(attempt.id);
    throw new Error('medium_hash_mismatch');
  }
  await db.query(`SELECT audit.record_report_handover($1, $2, true, $3)`, [
    attempt.id,
    actualHash,
    medium.diskseq,
  ]);
  return { attemptId: attempt.id, sha256: actualHash };
}
