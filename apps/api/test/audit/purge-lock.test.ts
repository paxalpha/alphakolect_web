import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { acquirePurgeLock } from '../../src/modules/audit/purge-lock.js';

const lockAddress = () =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\alphakolect-purge-test-${process.pid}-${randomUUID()}`
    : `\0alphakolect-purge-test-${process.getuid?.() ?? 'user'}-${randomUUID()}`;

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
});
