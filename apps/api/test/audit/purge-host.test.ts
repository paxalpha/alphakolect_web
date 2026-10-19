import { describe, expect, it } from 'vitest';
import { hostIdentity, realSystem, type HostSystem } from '../../src/modules/audit/purge-host.js';

// The purge command's host identity (P5 plan §8.6 item 1 and its tests: "an unsupported platform, a detected container,
// a missing machine id refuse"), read from staged systems; and once from the real one, as the command reads it.

const SID = 'S-1-5-21-1111111111-2222222222-3333333333-1001';
const GUID = 'e2d5e004-b688-42b6-8378-038b466b9070';
const windows = (over: Partial<HostSystem> = {}): HostSystem => ({
  platform: 'win32',
  exec: (command) =>
    command.endsWith('whoami.exe')
      ? `"desktop\\\\operator","${SID}"`
      : `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    ${GUID}\r\n`,
  readFile: () => '',
  exists: () => false,
  uid: undefined,
  systemRoot: 'C:\\Windows',
  ...over,
});
const linux = (over: Partial<HostSystem> = {}): HostSystem => ({
  platform: 'linux',
  exec: () => '',
  readFile: (path) => (path === '/etc/machine-id' ? '0f3c1d2e4b5a69788796a5b4c3d2e1f0\n' : ''),
  exists: () => false,
  uid: 1000,
  systemRoot: '',
  ...over,
});

describe('the purge command’s host identity', () => {
  it('Windows: the machine GUID, the operator’s SID, and a named pipe of that SID — Windows’ own tools by absolute path', () => {
    const called: string[] = [];
    const host = hostIdentity(
      windows({
        exec: (command, args) => {
          called.push(command);
          return windows().exec(command, args);
        },
      }),
    );
    expect(host).toEqual({
      hostId: GUID,
      lockKey: `windows:${SID}`,
      lockAddress: `\\\\.\\pipe\\alphakolect-purge-${SID}`,
    });
    expect(called).toEqual(['C:\\Windows\\System32\\whoami.exe', 'C:\\Windows\\System32\\reg.exe']);
  });

  it('Linux: the machine id, the uid, and an abstract socket of that uid', () => {
    expect(hostIdentity(linux())).toEqual({
      hostId: '0f3c1d2e4b5a69788796a5b4c3d2e1f0',
      lockKey: 'linux:1000',
      lockAddress: '\0alphakolect-purge-1000',
    });
  });

  it('refuses an unsupported platform, a container, a missing machine id, and an identity it cannot read', () => {
    expect(() => hostIdentity(linux({ platform: 'darwin' }))).toThrow('unsupported_platform_for_audit_purge');
    expect(() => hostIdentity(linux({ uid: undefined }))).toThrow('unsupported_platform_for_audit_purge');
    expect(() => hostIdentity(linux({ exists: (p) => p === '/.dockerenv' }))).toThrow(
      'audit_purge_refuses_container',
    );
    expect(() =>
      hostIdentity(
        linux({
          readFile: () => {
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          },
        }),
      ),
    ).toThrow('cannot_read_linux_host_identity');
    expect(() => hostIdentity(linux({ readFile: () => '\n' }))).toThrow('cannot_read_linux_host_identity');
    expect(() => hostIdentity(linux({ uid: 0 }))).toThrow('cannot_read_linux_host_identity'); // never as root
    expect(() => hostIdentity(windows({ exec: () => 'no sid here' }))).toThrow(
      'cannot_read_windows_host_identity',
    );
    expect(() =>
      hostIdentity(
        windows({
          exec: () => {
            throw new Error('whoami: extra operand');
          },
        }),
      ),
    ).toThrow('cannot_read_windows_host_identity');
  });

  it.runIf(process.platform === 'win32' || process.platform === 'linux')(
    'reads this machine’s identity, as the command does',
    () => {
      const host = hostIdentity(realSystem());
      expect(host.hostId).toMatch(/\S/);
      expect(host.lockAddress).toContain('alphakolect-purge-');
    },
  );
});
