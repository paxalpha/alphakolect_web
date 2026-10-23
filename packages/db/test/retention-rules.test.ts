import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState } from './support/db.js';

// The retention purge's rules beyond the main flows (P5 plan §8.6, Part 2; the tests of item 13 and the critic rounds'
// findings): a held block larger than one call's ceiling is crossed and the rows after it deleted (O21 S1); nothing is
// deleted while a copy is awaited (the purge function's re-check, under the reservation row); pages are idempotent and
// ordered; a dead run's reservation is taken over after its lease and the old run refused; a future p_as_of refused;
// the session and link details cleared on the earliest end of a session; one open request at most. Every test leaves
// the purge state as it found it: no open request, no active report, no live reservation.

let op: pg.Client;
beforeAll(async () => {
  op = await connectAs('migrator');
});
afterAll(async () => {
  await op.end();
});

type Run = { run_id: string; kind: string; as_of: string };
type Page = {
  page_no: number;
  row_count: number;
  page_digest: string | null;
  exhausted: boolean;
  event_ids: string[];
};

const reserve = async () => (await op.query<Run>(`SELECT * FROM audit.reserve_purge_run(now())`)).rows[0]!;
const page = async (run: Run, n: number, limit: number) =>
  (
    await op.query<Page>(`SELECT * FROM audit.purge_candidates($1, $2, $3, $4)`, [
      run.run_id,
      run.as_of,
      n,
      limit,
    ])
  ).rows[0]!;
const release = (run: Run, completed = true) =>
  op.query(`SELECT audit.release_purge_run($1, $2)`, [run.run_id, completed]);
const events = async (n: number, yearsAgo: number) => {
  const ids: string[] = [];
  for (let i = 0; i < n; i++)
    ids.push(
      (
        await op.query<{ id: string }>(
          `INSERT INTO audit.audit_events (occurred_at, action, outcome, summary)
           VALUES (now() - make_interval(days => $1) + make_interval(secs => $2), 'auth.logout', 'success', '{}') RETURNING id`,
          [Math.round(yearsAgo * 365), i],
        )
      ).rows[0]!.id,
    );
  return ids;
};
const existing = async (ids: string[]) =>
  (
    await op.query<{ id: string }>(`SELECT id FROM audit.audit_events WHERE id = ANY($1::uuid[])`, [ids])
  ).rows.map((r) => r.id);
/**
 * Reads a run's pages to the end, calling `each` on every recorded page. A step that examined its ceiling of rows and
 * took none records no page, so the next step asks for the same page number.
 */
async function walk(run: Run, limit: number, each: (p: Page, n: number) => Promise<void>) {
  let emptySteps = 0;
  for (let n = 1; ;) {
    const p = await page(run, n, limit);
    if (p.row_count > 0) {
      await each(p, n);
      n++;
    } else if (!p.exhausted) emptySteps++;
    if (p.exhausted) return emptySteps;
  }
}
const deletePage = (run: Run, n: number) =>
  op.query(`SELECT audit.purge_expired_events($1, $2, $3)`, [run.run_id, run.as_of, n]);
/** Deletes every eligible, unheld row, so each test starts from a clean purge state. */
async function purgeAll(limit = 1000) {
  const run = await reserve();
  expect(run.kind).toBe('plain');
  await walk(run, limit, async (_, n) => {
    await deletePage(run, n);
  });
  await release(run);
}

afterEach(async () => {
  const { rows } = await op.query<{ open: number; active: number; live: boolean }>(
    `SELECT (SELECT count(*) FROM audit.purge_report_requests WHERE state = 'open')::int AS open,
            (SELECT count(*) FROM audit.purge_reports WHERE delivered_at IS NULL AND withdrawn_at IS NULL AND lost_at IS NULL)::int AS active,
            (SELECT run_id IS NOT NULL FROM audit.purge_reservation) AS live`,
  );
  expect(rows[0]).toEqual({ open: 0, active: 0, live: false });
});

describe('a held block does not stall the purge (O21 S1; the critic’s round 5)', () => {
  it('crosses 25 held rows with a ceiling of 20 per call and deletes the eligible rows after them', async () => {
    await purgeAll();
    const held = await events(25, 3);
    // An active report holding them: requested, exported (the export run deletes nothing), confirmed.
    const request = (await op.query<{ id: string }>(`SELECT audit.request_purge_report('rules test') AS id`))
      .rows[0]!.id;
    const exportRun = await reserve();
    expect(exportRun.kind).toBe('export');
    const dir = `C:\\purge-rules-${randomBytes(4).toString('hex')}`;
    await op.query(`SELECT audit.begin_purge_export($1, $2, $3, 'host', 'key')`, [
      exportRun.run_id,
      exportRun.as_of,
      dir,
    ]);
    await op.query(`SELECT audit.record_export_artifact($1, $2)`, [exportRun.run_id, exportRun.as_of]);
    const digests: string[] = [];
    let rows = 0;
    await walk(exportRun, 100, async (p) => {
      digests.push(p.page_digest!);
      rows += p.row_count;
    });
    expect(rows).toBe(25);
    const { rows: manifest } = await op.query<{ d: string }>(
      `SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') AS d`,
      [`${digests.join('\n')}\n`],
    );
    const report = (
      await op.query<{ id: string }>(`SELECT audit.confirm_purge_report($1, $2, $3, $4, $5, $6, $7) AS id`, [
        exportRun.run_id,
        exportRun.as_of,
        rows,
        digests.length,
        manifest[0]!.d,
        'a'.repeat(64),
        `${dir}\\alphakolect-purge-report-${exportRun.run_id}.jsonl`,
      ])
    ).rows[0]!.id;
    await release(exportRun);
    // Rows that became eligible after the copy, later in the scan order than the held block.
    const later = await events(2, 2.5);

    const run = await reserve();
    expect(run.kind).toBe('plain');
    const taken: string[] = [];
    const emptySteps = await walk(run, 1, async (p, n) => {
      taken.push(...p.event_ids);
      await deletePage(run, n);
    });
    await release(run);
    // The first step examined twenty held rows (its ceiling with a limit of 1) and took none, yet the run went on.
    expect(emptySteps).toBeGreaterThan(0);
    expect(taken.sort()).toEqual([...later].sort());
    expect(await existing(later)).toEqual([]);
    expect((await existing(held)).length).toBe(25);

    // Cancelled in writing: the report is withdrawn, its rows no longer held, and the next plain run deletes them.
    await op.query(`SELECT audit.cancel_purge_report_request($1, 'rules test: cancelled')`, [request]);
    await op.query(`SELECT audit.record_report_copy_destroyed($1, 'attested', 'test report copy removed')`, [
      report,
    ]);
    expect(
      (await op.query(`SELECT withdrawn_at FROM audit.purge_reports WHERE id = $1`, [report])).rows[0]
        .withdrawn_at,
    ).not.toBeNull();
    await purgeAll();
    expect(await existing(held)).toEqual([]);
  });
});

describe('nothing is deleted while a copy is awaited', () => {
  it('a request recorded under a live run is refused; one present at the page (inserted by the owner) refuses it', async () => {
    await purgeAll();
    const ids = await events(2, 3);
    const run = await reserve();
    expect(run.kind).toBe('plain');
    await expectSqlState(op.query(`SELECT audit.request_purge_report('during a run')`), '55006');
    const p = await page(run, 1, 100);
    expect(p.row_count).toBe(2);
    // A request that appeared anyway (the table owner, bypassing the function): the page refuses, deleting nothing.
    const { rows } = await op.query<{ id: string }>(
      `INSERT INTO audit.purge_report_requests (note) VALUES ('appeared') RETURNING id`,
    );
    await expectSqlState(deletePage(run, 1), '55000');
    expect((await existing(ids)).length).toBe(2);
    await op.query(
      `UPDATE audit.purge_report_requests SET state = 'cancelled', closed_at = now() WHERE id = $1`,
      [rows[0]!.id],
    );
    await release(run, false);
    await purgeAll();
    expect(await existing(ids)).toEqual([]);
  });
});

describe('pages and the reservation', () => {
  it('pages are ordered and idempotent: a repeat returns the page as recorded, a processed one is refused', async () => {
    await purgeAll();
    await events(3, 3);
    const run = await reserve();
    await expectSqlState(page(run, 2, 1), '23514');
    const first = await page(run, 1, 1);
    const again = await page(run, 1, 1);
    expect(again.event_ids).toEqual(first.event_ids);
    expect(again.page_digest).toBe(first.page_digest);
    await deletePage(run, 1);
    await expectSqlState(page(run, 1, 1), '55000');
    await expectSqlState(deletePage(run, 1), '55000');
    await expectSqlState(deletePage(run, 9), '23514');
    await expectSqlState(
      op.query(`SELECT audit.purge_candidates($1, now() - interval '1 day', 2, 1)`, [run.run_id]),
      '55000',
    );
    await release(run);
    await purgeAll();
  });

  it('a second run is refused while one is live; after the lease a new run takes over and the old one is refused', async () => {
    const a = await reserve();
    await expectSqlState(reserve(), '55006');
    await op.query(`CREATE OR REPLACE FUNCTION audit.purge_lease() RETURNS interval
                    LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$ SELECT interval '0 seconds' $fn$`);
    try {
      const b = await reserve();
      expect(
        (await op.query(`SELECT taken_over_run FROM audit.purge_runs WHERE run_id = $1`, [b.run_id])).rows[0]
          .taken_over_run,
      ).toBe(a.run_id);
      await expectSqlState(op.query(`SELECT audit.renew_purge_run($1, $2)`, [a.run_id, a.as_of]), '55000');
      // b itself has a zero lease now: release it while the redefinition is in place.
      expect((await op.query(`SELECT audit.release_purge_run($1, true) AS r`, [b.run_id])).rows[0].r).toBe(
        true,
      );
    } finally {
      await op.query(`CREATE OR REPLACE FUNCTION audit.purge_lease() RETURNS interval
                      LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$ SELECT interval '15 minutes' $fn$`);
    }
  });

  it('a p_as_of later than now() is refused by every function that takes it', async () => {
    await expectSqlState(op.query(`SELECT audit.reserve_purge_run(now() + interval '1 second')`), '23514');
    await expectSqlState(
      op.query(`SELECT audit.clear_expired_request_metadata(now() + interval '1 second', 10)`),
      '23514',
    );
  });

  it('at most one open request: a second is refused, and a direct insert fails the partial unique index', async () => {
    const id = (await op.query<{ id: string }>(`SELECT audit.request_purge_report('one') AS id`)).rows[0]!.id;
    await expectSqlState(op.query(`SELECT audit.request_purge_report('two')`), '23505');
    await expectSqlState(
      op.query(`INSERT INTO audit.purge_report_requests (note) VALUES ('three')`),
      '23505',
    );
    await op.query(`SELECT audit.cancel_purge_report_request($1, 'rules test: cancelled')`, [id]);
  });
});

describe('the session and link details (CF4)', () => {
  it('a session expired long ago and revoked later is cleared two years after it expired; active ones never', async () => {
    const identity = (
      await op.query<{ id: string }>(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
        `cf4-${randomBytes(4).toString('hex')}@example.test`,
      ])
    ).rows[0]!.id;
    const membership = (
      await op.query<{ id: string }>(
        `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'support') RETURNING id`,
        [identity],
      )
    ).rows[0]!.id;
    const session = async (absoluteYearsAgo: number, revokedYearsAgo: number | null) =>
      (
        await op.query<{ id: string }>(
          `INSERT INTO identity.sessions (identity_id, audience, platform_membership_id, created_at, absolute_expires_at,
                                          revoked_at, revoke_reason, created_ip, user_agent)
           VALUES ($1, 'platform', $4, now() - make_interval(days => greatest($2, 0) + 30), now() - make_interval(days => $2),
                   CASE WHEN $3::int IS NULL THEN NULL ELSE now() - make_interval(days => $3::int) END,
                   CASE WHEN $3::int IS NULL THEN NULL ELSE 'password_changed' END, '198.51.100.7', 'cf4-agent')
           RETURNING id`,
          [
            identity,
            Math.round(absoluteYearsAgo * 365),
            revokedYearsAgo === null ? null : Math.round(revokedYearsAgo * 365),
            membership,
          ],
        )
      ).rows[0]!.id;
    const expiredThenRevoked = await session(3, 1); // ended when it expired, three years ago
    const recentlyEnded = await session(1, null); // ended a year ago: kept
    const active = await session(-1, null); // expires next year
    for (;;) {
      const { rows } = await op.query<{ tokens_cleared: number; sessions_cleared: number }>(
        `SELECT * FROM audit.clear_expired_request_metadata(now(), 1000)`,
      );
      if (rows[0]!.tokens_cleared + rows[0]!.sessions_cleared === 0) break;
    }
    const details = async (id: string) =>
      (await op.query(`SELECT created_ip, user_agent FROM identity.sessions WHERE id = $1`, [id])).rows[0];
    expect(await details(expiredThenRevoked)).toEqual({ created_ip: null, user_agent: null });
    expect(await details(recentlyEnded)).toEqual({ created_ip: '198.51.100.7', user_agent: 'cf4-agent' });
    expect(await details(active)).toEqual({ created_ip: '198.51.100.7', user_agent: 'cf4-agent' });
    // A second pass clears nothing: a row is cleared once.
    const { rows } = await op.query<{ tokens_cleared: number; sessions_cleared: number }>(
      `SELECT * FROM audit.clear_expired_request_metadata(now(), 1000)`,
    );
    expect(rows[0]).toEqual({ tokens_cleared: 0, sessions_cleared: 0 });
  });
});
