import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { connectionUrl, createTestDatabase, dropTestDatabase, migrateDeploy } from '@alphakolect/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newSigningJwk } from '../support/keys.js';

// The real worker process (src/worker.ts), started on its own against a database of its own, left to run, and stopped by SIGTERM
// (P9 plan §16.12, D1). It proves what the loop's unit tests cannot: that the process stays alive between passes, past the point where
// the database pool lets go of its idle connections (the defect found on 26 November 2026, where it ended after one pass); that
// each pass says so, with a number that goes up; and that SIGTERM, also while it waits between passes, ends it cleanly: its
// connections closed, the exit code 0, in seconds and not in a pass interval.
//
// Linux only (GitHub Actions): on Windows Node cannot deliver SIGTERM to a process, only end it by force. A database of its own, so
// the worker's sweep never touches the businesses of the test files beside this one.

const apiDir = fileURLToPath(new URL('../..', import.meta.url));
const posix = process.platform !== 'win32';

let database = '';
let signingKey = '';
const children: ChildProcessWithoutNullStreams[] = [];

beforeAll(async () => {
  if (!posix) return;
  database = await createTestDatabase();
  migrateDeploy(database);
  signingKey = JSON.stringify(await newSigningJwk('worker-process-test'));
}, 180_000);

afterAll(async () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  if (database) await dropTestDatabase(database);
});

type Started = {
  child: ChildProcessWithoutNullStreams;
  lines: Array<Record<string, unknown>>;
  exit: Promise<number | null>;
};

/** Start the worker with a rhythm of `passSeconds`, the fake provider, and nothing else of this machine's environment. */
function startWorker(passSeconds: number): Started {
  const child = spawn(
    process.execPath,
    ['--conditions=@alphakolect/source', '--import', 'tsx', 'src/worker.ts'],
    {
      cwd: apiDir,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        DATABASE_URL: connectionUrl('app', database),
        WORKER_DATABASE_URL: connectionUrl('worker', database),
        AUTH_SIGNING_JWK: signingKey,
        MFA_ENCRYPTION_KEY: `worker-process:${randomBytes(32).toString('base64')}`,
        WORKER_PASS_SECONDS: String(passSeconds),
        WORKER_RECONCILE_SECONDS: '3600',
      },
    },
  );
  children.push(child);
  const lines: Array<Record<string, unknown>> = [];
  let pending = '';
  child.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8');
    const parts = pending.split('\n');
    pending = parts.pop() ?? '';
    for (const part of parts) {
      try {
        lines.push(JSON.parse(part) as Record<string, unknown>);
      } catch {
        lines.push({ msg: part });
      }
    }
  });
  child.stderr.on('data', (chunk: Buffer) => lines.push({ stderr: chunk.toString('utf8').slice(0, 300) }));
  const exit = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, lines, exit };
}

async function until(what: string, condition: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const passesOf = (lines: Started['lines']) =>
  lines.filter((l) => l.msg === 'Worker pass completed').map((l) => l.pass as number);

describe.skipIf(!posix)('the worker process (Linux)', () => {
  it(
    'runs successive passes, says so, and ends cleanly on SIGTERM with its connections closed',
    { timeout: 90_000 },
    async () => {
      const w = startWorker(1);
      await until('three completed passes', () => passesOf(w.lines).length >= 3, 60_000);
      const passes = passesOf(w.lines);
      expect(passes.slice(0, 3)).toEqual([1, 2, 3]);
      for (const line of w.lines.filter((l) => l.msg === 'Worker pass completed'))
        expect(
          Object.keys(line)
            .filter((k) => ['pass', 'durationMs'].includes(k))
            .sort(),
        ).toEqual(['durationMs', 'pass']);
      expect(w.lines.some((l) => l.msg === 'A worker pass failed')).toBe(false);
      // The first pass also reconciled, once, and said so separately.
      expect(w.lines.filter((l) => l.msg === 'Reconciliation completed').map((l) => l.pass)).toEqual([1]);

      const stoppedAt = Date.now();
      w.child.kill('SIGTERM');
      expect(await w.exit).toBe(0);
      expect(Date.now() - stoppedAt).toBeLessThan(10_000);
      const messages = w.lines.map((l) => l.msg);
      expect(messages).toContain('Worker stopping');
      expect(messages).toContain('Worker stopped: its database connections are closed');
      expect(messages.indexOf('Worker stopping')).toBeLessThan(
        messages.indexOf('Worker stopped: its database connections are closed'),
      );
    },
  );

  it(
    'stays alive between passes past the pool’s idle time, and SIGTERM while it waits ends it at once, not after the interval',
    { timeout: 120_000 },
    async () => {
      // A pass every 20 s: longer than the pool keeps an idle connection (10 s), so between passes nothing but the timer is open.
      // The worker that ended after one pass did exactly that here.
      const w = startWorker(20);
      await until('the first pass', () => passesOf(w.lines).length >= 1, 60_000);
      await until('the second pass, 20 s later', () => passesOf(w.lines).length >= 2, 60_000);
      expect(passesOf(w.lines).slice(0, 2)).toEqual([1, 2]);
      expect(w.child.exitCode).toBeNull();

      // It is now waiting, with about 20 s to go to the next pass. A signal must not wait for it.
      const stoppedAt = Date.now();
      w.child.kill('SIGTERM');
      expect(await w.exit).toBe(0);
      expect(Date.now() - stoppedAt).toBeLessThan(8_000);
      expect(w.lines.map((l) => l.msg)).toContain('Worker stopped: its database connections are closed');
      expect(w.lines.some((l) => l.msg === 'A worker pass failed')).toBe(false);
    },
  );
});
