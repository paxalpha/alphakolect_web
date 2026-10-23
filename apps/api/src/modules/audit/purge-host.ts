import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Who and where the operator's purge command runs (P5 plan §8.6 item 1): the machine, the operator's account, and the
// name of the kernel lock that keeps one command at a time per account — a named pipe on Windows, an abstract socket
// on Linux. Every command refuses on any other platform, inside a container (its abstract-socket namespace is not the
// host's, and its files are not the operator's machine), and when the machine's identity cannot be read.

export type Host = { hostId: string; lockKey: string; lockAddress: string };

/** What the identity is read from: the real system by default, a staged one in tests. */
export type HostSystem = {
  platform: NodeJS.Platform;
  /** Runs a program by absolute path and returns its standard output. */
  exec(command: string, args: string[]): string;
  readFile(path: string): string;
  exists(path: string): boolean;
  uid: number | undefined;
  systemRoot: string;
};

export const realSystem = (): HostSystem => ({
  platform: process.platform,
  exec: (command, args) =>
    execFileSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
  readFile: (path) => readFileSync(path, 'utf8'),
  exists: existsSync,
  uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
  // Windows' own tools by absolute path: a PATH lookup could find another program of the same name (Git for Windows
  // puts GNU whoami ahead of the system's) when the operator runs the command from such a shell.
  systemRoot: process.env.SystemRoot ?? 'C:\\Windows',
});

export function hostIdentity(system: HostSystem = realSystem()): Host {
  if (system.platform === 'win32') {
    const tool = (name: string) => join(system.systemRoot, 'System32', name);
    let sid: string | undefined;
    let machineId: string | undefined;
    try {
      sid = system.exec(tool('whoami.exe'), ['/user', '/fo', 'csv', '/nh']).match(/S-1-[0-9-]+/)?.[0];
      machineId = system
        .exec(tool('reg.exe'), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'])
        .match(/MachineGuid\s+REG_SZ\s+([^\s]+)/i)?.[1];
    } catch {
      throw new Error('cannot_read_windows_host_identity');
    }
    if (!sid || !machineId) throw new Error('cannot_read_windows_host_identity');
    return {
      hostId: machineId,
      lockKey: `windows:${sid}`,
      lockAddress: `\\\\.\\pipe\\alphakolect-purge-${sid}`,
    };
  }
  if (system.platform === 'linux' && system.uid !== undefined) {
    if (system.exists('/.dockerenv')) throw new Error('audit_purge_refuses_container');
    let machineId = '';
    try {
      machineId = system.readFile('/etc/machine-id').trim();
    } catch {
      throw new Error('cannot_read_linux_host_identity');
    }
    if (!machineId || !system.uid) throw new Error('cannot_read_linux_host_identity');
    return {
      hostId: machineId,
      lockKey: `linux:${system.uid}`,
      lockAddress: `\0alphakolect-purge-${system.uid}`,
    };
  }
  throw new Error('unsupported_platform_for_audit_purge');
}
