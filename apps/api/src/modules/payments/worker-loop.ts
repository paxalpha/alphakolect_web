// The payments worker's main loop (P9 §3.7), apart from its entry point so it can be tested.
//
// Why it is a module of its own: the entry point once waited between passes on a timer that did not keep the process alive
// (`setTimeout(...).unref()`). With nothing else open (the database pool closes its idle connections), Node found nothing to wait
// for and ended the process after the first pass, with only a warning about an unsettled top-level await: a worker that ran
// once and never again, and said nothing. Seen on 26 November 2026 in the local integration check (D1). The wait here keeps the
// process alive, and ends at once when the signal says to stop.
import type { PaymentsWorker } from './worker-tasks.js';

export type WorkerLoopDeps = Readonly<{
  worker: Pick<PaymentsWorker, 'runOnce' | 'reconcile'>;
  logger: { error: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void };
  /** Time between passes of the tasks that run often. */
  passMs: number;
  /** Time between reconciliations: the first pass also reconciles. */
  reconcileMs: number;
  /** Aborted when the process is told to stop. */
  signal: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}>;

/** Wait `ms`, holding the process open, and return early (clearing the timer) if the signal aborts. */
export function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms); // not unref'd: while the worker waits, the process is alive
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Run passes until the signal aborts. A pass that fails is logged and the next one still runs. */
export async function runWorkerLoop(deps: WorkerLoopDeps): Promise<void> {
  const { worker, logger, passMs, reconcileMs, signal } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? sleepUnlessAborted;
  let lastReconcile = 0;
  let pass = 0;
  while (!signal.aborted) {
    pass += 1;
    const started = now();
    try {
      await worker.runOnce();
      // Evidence that a pass completed, one line each: its number, which only goes up, and how long it took. Nothing about what it did,
      // so no customer, amount or credential can reach the log through it.
      logger.info({ pass, durationMs: now() - started }, 'Worker pass completed');
      if (now() - lastReconcile >= reconcileMs) {
        lastReconcile = now();
        const reconcileStarted = now();
        await worker.reconcile();
        logger.info({ pass, durationMs: now() - reconcileStarted }, 'Reconciliation completed');
      }
    } catch (err) {
      logger.error({ err, pass }, 'A worker pass failed');
    }
    await sleep(passMs, signal);
  }
}
