import net from 'node:net';

export type PurgeLock = { close(): Promise<void> };

/** A kernel-owned listening endpoint: the OS releases it on every process exit, unlike stale-age lock files. */
export async function acquirePurgeLock(address: string): Promise<PurgeLock> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => reject(error);
    server.once('error', onError);
    server.listen(address, () => {
      server.off('error', onError);
      resolve();
    });
  }).catch((error: unknown) => {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
    throw new Error(code === 'EADDRINUSE' ? 'purge_lock_already_held' : `purge_lock_unavailable_${code}`);
  });
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
