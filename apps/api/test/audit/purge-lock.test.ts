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
      await acquirePurgeLock(process.env.PURGE_LOCK_ADDRESS);
      process.stdout.write('ready\\n');
      await new Promise(() => {});
    `;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx/esm', '--input-type=module', '--eval', childSource],
      { env: { ...process.env, PURGE_LOCK_ADDRESS: address }, stdio: ['ignore', 'pipe', 'ignore'] },
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
});
