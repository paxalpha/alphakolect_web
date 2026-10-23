import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { acquirePurgeLock } from '../../src/modules/audit/purge-lock.js';

const lockAddress = () =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\alphakolect-purge-test-${process.pid}-${randomUUID()}`
    : `\0alphakolect-purge-test-${process.getuid?.() ?? 'user'}-${randomUUID()}`;

async function waitForReady(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`purge lock child did not start: ${output}`)), 10_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('ready')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`purge lock child exited before ready (${code ?? signal})`));
    });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  await exited;
}

describe('operator purge process lock', () => {
  it('refuses a second holder and becomes available immediately after release', async () => {
    const address = lockAddress();
    const first = await acquirePurgeLock(address);
    try {
      await expect(acquirePurgeLock(address)).rejects.toThrow('purge_lock_already_held');
    } finally {
      await first.close();
    }
    const second = await acquirePurgeLock(address);
    await second.close();
  });

  it('releases the kernel lock when its holder process is killed', async () => {
    const address = lockAddress();
    const moduleUrl = new URL('../../src/modules/audit/purge-lock.ts', import.meta.url).href;
    const childSource = `
      import { acquirePurgeLock } from ${JSON.stringify(moduleUrl)};
      await acquirePurgeLock(${JSON.stringify(address)});
      process.stdout.write('ready\\n');
      await new Promise(() => {});
    `;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx/esm', '--input-type=module', '--eval', childSource],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );

    try {
      await waitForReady(child);
      await expect(acquirePurgeLock(address)).rejects.toThrow('purge_lock_already_held');
      const probe = net.createConnection(address);
      await new Promise<void>((resolve, reject) => {
        probe.once('connect', resolve);
        probe.once('error', reject);
      });
      await new Promise<void>((resolve, reject) => {
        probe.once('close', resolve);
        probe.once('error', reject);
      });
      await expect(acquirePurgeLock(address)).rejects.toThrow('purge_lock_already_held');
      await stopChild(child);
      const recovered = await acquirePurgeLock(address);
      await recovered.close();
    } finally {
      await stopChild(child);
    }
  }, 15_000);

  it('a child process of the holder does not keep the lock once the holder is gone', async () => {
    const address = lockAddress();
    const moduleUrl = new URL('../../src/modules/audit/purge-lock.ts', import.meta.url).href;
    // The holder starts a long-lived child of its own while it holds the lock (as a command starting a program would),
    // and reports the child's pid.
    const childSource = `
      import { spawn } from 'node:child_process';
      import { acquirePurgeLock } from ${JSON.stringify(moduleUrl)};
      await acquirePurgeLock(${JSON.stringify(address)});
      // Detached, so that it outlives the holder (on Windows a child is otherwise ended with its parent's job).
      const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', detached: true });
      process.stdout.write('ready ' + grandchild.pid + '\\n');
      await new Promise(() => {});
    `;
    let output = '';
    const child = spawn(
      process.execPath,
      ['--import', 'tsx/esm', '--input-type=module', '--eval', childSource],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    let grandchild = 0;
    try {
      await waitForReady(child);
      grandchild = Number(/ready (\d+)/.exec(output)![1]);
      await expect(acquirePurgeLock(address)).rejects.toThrow('purge_lock_already_held');
      await stopChild(child);
      expect(() => process.kill(grandchild, 0)).not.toThrow(); // the child lives on …
      const recovered = await acquirePurgeLock(address); // … and the lock is free
      await recovered.close();
    } finally {
      await stopChild(child);
      if (grandchild) {
        try {
          process.kill(grandchild);
        } catch {
          // already gone
        }
      }
    }
  }, 15_000);
});
