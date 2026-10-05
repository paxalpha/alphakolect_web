import { describe, expect, it, vi } from 'vitest';
import { inOneWindow, type WindowClock } from './support/rate-limit-window.js';

// The test helper that keeps rate-limit scenarios inside one fixed window, with an injected clock.

const clockReading = (...windows: number[]): WindowClock => {
  const readings = [...windows];
  return async () => readings.shift() ?? windows.at(-1)!;
};

describe('inOneWindow', () => {
  it('runs a passing scenario once', async () => {
    const scenario = vi.fn(async () => 'ok');
    expect(await inOneWindow(clockReading(7, 7), 900, scenario)).toBe('ok');
    expect(scenario).toHaveBeenCalledOnce();
  });

  it('rethrows a failure that happened within one window — a real failure is never retried', async () => {
    const scenario = vi.fn(async () => {
      throw new Error('limiter broken');
    });
    await expect(inOneWindow(clockReading(7, 7), 900, scenario)).rejects.toThrow('limiter broken');
    expect(scenario).toHaveBeenCalledOnce();
  });

  it('reruns once, in the new window, a failure during which a boundary passed', async () => {
    const scenario = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('counter restarted at the boundary'))
      .mockResolvedValueOnce('ok');
    expect(await inOneWindow(clockReading(7, 8), 900, scenario)).toBe('ok');
    expect(scenario).toHaveBeenCalledTimes(2);
  });

  it('a rerun that fails again is reported', async () => {
    const scenario = vi.fn(async () => {
      throw new Error('still failing');
    });
    await expect(inOneWindow(clockReading(7, 8), 900, scenario)).rejects.toThrow('still failing');
    expect(scenario).toHaveBeenCalledTimes(2);
  });
});
