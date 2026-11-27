import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWorkerLoop, sleepUnlessAborted } from '../../src/modules/payments/worker-loop.js';

// The worker's main loop (P9 §3.7). Found on 26 November 2026 in the local integration check: the entry point waited between passes on
// an unref'd timer, so with nothing else open Node ended the process after one pass, silently. The loop now waits on a timer that keeps
// the process alive, ends at once on a stop signal, and goes on after a pass that fails.

afterEach(() => vi.useRealTimers());

const quiet = () => ({
  infos: [] as Array<{ obj: Record<string, unknown>; msg: string }>,
  info(obj: object, msg: string) {
    this.infos.push({ obj: obj as Record<string, unknown>, msg });
  },
  errors: [] as unknown[],
  error(obj: object) {
    this.errors.push(obj);
  },
});

describe('the worker loop', () => {
  it('runs a pass, waits, and runs again until told to stop; it reconciles on the first pass and then only when due', async () => {
    const calls: string[] = [];
    let clock = 1_000_000;
    const control = new AbortController();
    let sleeps = 0;
    await runWorkerLoop({
      worker: {
        runOnce: async () => void calls.push('pass'),
        reconcile: async () => void calls.push('reconcile'),
      },
      logger: quiet(),
      passMs: 30_000,
      reconcileMs: 120_000,
      signal: control.signal,
      now: () => clock,
      sleep: async (ms) => {
        expect(ms).toBe(30_000);
        clock += ms;
        if (++sleeps === 6) control.abort();
      },
    });
    // Six passes, 30 s apart: a reconciliation on the first, and the next on the fifth, 120 s later.
    expect(calls).toEqual(['pass', 'reconcile', 'pass', 'pass', 'pass', 'pass', 'reconcile', 'pass']);
  });

  it('a pass that fails is logged, with no stop: the next pass still runs', async () => {
    const control = new AbortController();
    const log = quiet();
    let passes = 0;
    await runWorkerLoop({
      worker: {
        runOnce: async () => {
          if (++passes === 1) throw new Error('database unavailable');
        },
        reconcile: async () => undefined,
      },
      logger: log,
      passMs: 1,
      reconcileMs: 1_000_000,
      signal: control.signal,
      sleep: async () => {
        if (passes >= 3) control.abort();
      },
    });
    expect(passes).toBe(3);
    expect(log.errors).toHaveLength(1);
  });

  it('a failing reconciliation does not stop the loop either', async () => {
    const control = new AbortController();
    const log = quiet();
    let passes = 0;
    await runWorkerLoop({
      worker: {
        runOnce: async () => void passes++,
        reconcile: async () => {
          throw new Error('provider unreachable');
        },
      },
      logger: log,
      passMs: 1,
      reconcileMs: 0,
      signal: control.signal,
      sleep: async () => {
        if (passes >= 2) control.abort();
      },
    });
    expect(passes).toBe(2);
    expect(log.errors).toHaveLength(2);
  });

  it('does not start a pass when it is already told to stop', async () => {
    const control = new AbortController();
    control.abort();
    const runOnce = vi.fn();
    await runWorkerLoop({
      worker: { runOnce, reconcile: vi.fn() },
      logger: quiet(),
      passMs: 1,
      reconcileMs: 1,
      signal: control.signal,
    });
    expect(runOnce).not.toHaveBeenCalled();
  });
});

describe('the evidence a pass leaves', () => {
  it('logs one line for each completed pass with a number that only goes up and how long it took, and a separate one for a reconciliation', async () => {
    let clock = 5_000;
    const control = new AbortController();
    const log = quiet();
    let sleeps = 0;
    await runWorkerLoop({
      worker: {
        runOnce: async () => void (clock += 40),
        reconcile: async () => void (clock += 7),
      },
      logger: log,
      passMs: 1_000,
      reconcileMs: 2_500,
      signal: control.signal,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        if (++sleeps === 4) control.abort();
      },
    });
    const passes = log.infos.filter((i) => i.msg === 'Worker pass completed');
    expect(passes.map((p) => p.obj.pass)).toEqual([1, 2, 3, 4]);
    expect(passes.every((p) => p.obj.durationMs === 40)).toBe(true);
    // Reconciled on the first pass, then once 2.5 s had gone by: the third.
    const reconciliations = log.infos.filter((i) => i.msg === 'Reconciliation completed');
    expect(reconciliations.map((r) => r.obj.pass)).toEqual([1, 3]);
    expect(reconciliations.every((r) => r.obj.durationMs === 7)).toBe(true);
    // Only a number and a duration: nothing a pass handled can reach the log through these lines.
    for (const line of log.infos) expect(Object.keys(line.obj).sort()).toEqual(['durationMs', 'pass']);
    expect(log.errors).toEqual([]);
  });

  it('a pass that fails logs its number with the error, and no completion line', async () => {
    const control = new AbortController();
    const log = quiet();
    await runWorkerLoop({
      worker: {
        runOnce: async () => {
          throw new Error('database unavailable');
        },
        reconcile: async () => undefined,
      },
      logger: log,
      passMs: 1,
      reconcileMs: 1_000_000,
      signal: control.signal,
      sleep: async () => control.abort(),
    });
    expect(log.infos).toEqual([]);
    expect(log.errors).toMatchObject([{ pass: 1 }]);
  });
});

describe('the wait between passes', () => {
  it('waits the time given, and nothing sooner', async () => {
    vi.useFakeTimers();
    let done = false;
    const wait = sleepUnlessAborted(30_000, new AbortController().signal).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(done).toBe(true);
  });

  it('ends at once when told to stop, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const control = new AbortController();
    const wait = sleepUnlessAborted(30_000, control.signal);
    expect(vi.getTimerCount()).toBe(1);
    control.abort();
    await wait;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('with a signal already aborted, does not wait at all', async () => {
    vi.useFakeTimers();
    const control = new AbortController();
    control.abort();
    await sleepUnlessAborted(30_000, control.signal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds the process open while it waits: a real timer, not an unref’d one', async () => {
    const control = new AbortController();
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const wait = sleepUnlessAborted(5_000, control.signal);
    const timer = spy.mock.results.at(-1)!.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(true);
    control.abort();
    await wait;
    spy.mockRestore();
  });

  it('regression guard: neither the entry point nor the loop waits on an unref’d timer', () => {
    for (const file of ['../../src/worker.ts', '../../src/modules/payments/worker-loop.ts']) {
      const code = readFileSync(new URL(file, import.meta.url), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');
      expect(code, file).not.toMatch(/\.unref\s*\(/);
    }
  });
});
