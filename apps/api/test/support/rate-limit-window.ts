import type pg from 'pg';

// Rate limits are fixed windows aligned to the database clock (util.rate_limit_hit, ADR-14 D13): a 900-second
// window starts at :00, :15, :30 and :45. A test that spends N allowed attempts and then expects a 429 is only
// meaningful if all of them fall in ONE window — if a boundary passes mid-scenario, the counter restarts and the
// test fails although the limiter is correct (the production semantics are intended; the test must adapt).
//
// inOneWindow() runs a scenario and, only if it FAILED while the window changed under it, runs it once more in
// the new window (a second crossing is impossible: scenarios take seconds, windows 15+ minutes). A failure within
// a single window is a real failure and is rethrown unchanged. Scenarios must create their own fresh
// identifiers on each run.

export type WindowClock = (windowSeconds: number) => Promise<number>;

/** The current window number on the database clock, computed exactly as util.rate_limit_hit does. */
export const databaseWindow =
  (db: Pick<pg.Client, 'query'>): WindowClock =>
  async (windowSeconds) =>
    Number(
      (
        await db.query<{ w: string }>(`SELECT floor(extract(epoch FROM now()) / $1)::bigint AS w`, [
          windowSeconds,
        ])
      ).rows[0]!.w,
    );

export async function inOneWindow<T>(
  clock: WindowClock,
  windowSeconds: number,
  scenario: () => Promise<T>,
): Promise<T> {
  const before = await clock(windowSeconds);
  try {
    return await scenario();
  } catch (err) {
    if ((await clock(windowSeconds)) === before) throw err;
    return scenario(); // the boundary passed mid-scenario: once more, wholly inside the new window
  }
}
