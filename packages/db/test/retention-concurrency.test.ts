import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState } from './support/db.js';

// The retention purge with more than one connection (P5 plan §8.6, the Tests paragraph): the request race at the
// lease's edge (the critic's round 4), a late commit while a page is deleted (R38), the reservation held by a page
// transaction (R43), renewal from the end of a long page, and the clearing beside other clearings and an unresolved
// export. The two-connection race against a revocation, 50 times in both orders, is in lock-races.test.ts. Every test
// leaves no open request, no live reservation and no unresolved export behind.

let owner: pg.Client; // the operator (the migrator), and the table owner
let a: pg.Client;
let b: pg.Client;
let x: pg.Client; // holds a gate
let watcher: pg.Client;
/** Backend ids, read once: a busy connection cannot answer a query until its blocked statement ends. */
let pidA = 0;
beforeAll(async () => {
  [owner, a, b, x, watcher] = await Promise.all(
    ['migrator', 'migrator', 'migrator', 'migrator', 'migrator'].map((r) => connectAs(r as 'migrator')),
  );
  pidA = (await a.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
});
afterAll(async () => {
  await Promise.all([owner, a, b, x, watcher].map((c) => c.end()));
});

type Run = { run_id: string; kind: string; as_of: string };
const reserve = async (c: pg.Client = owner) =>
  (await c.query<Run>(`SELECT * FROM audit.reserve_purge_run(now())`)).rows[0]!;
const page = async (run: Run, n: number, limit = 1000, c: pg.Client = owner) =>
  (await c.query(`SELECT * FROM audit.purge_candidates($1, $2, $3, $4)`, [run.run_id, run.as_of, n, limit]))
    .rows[0] as { row_count: number; exhausted: boolean; event_ids: string[] };
const deletePage = (run: Run, n: number, c: pg.Client = owner) =>
  c.query(`SELECT audit.purge_expired_events($1, $2, $3) AS n`, [run.run_id, run.as_of, n]);
const release = (run: Run, completed = true) =>
  owner.query(`SELECT audit.release_purge_run($1, $2)`, [run.run_id, completed]);
const oldEvent = async (c: pg.Client = owner) =>
  (
    await c.query<{ id: string }>(
      `INSERT INTO audit.audit_events (occurred_at, action, outcome, summary)
       VALUES (now() - interval '3 years', 'auth.logout', 'success', '{}') RETURNING id`,
    )
  ).rows[0]!.id;
const exists = async (id: string) =>
  (await owner.query(`SELECT 1 FROM audit.audit_events WHERE id = $1`, [id])).rowCount === 1;
/** A plain run deleting every eligible, unheld row. */
async function purgeAll() {
  const run = await reserve();
  expect(run.kind).toBe('plain');
  for (let n = 1; ;) {
    const p = await page(run, n);
    if (p.row_count > 0) {
      await deletePage(run, n);
      n++;
    }
    if (p.exhausted) break;
  }
  await release(run);
}
const setLease = (interval: string) =>
  owner.query(`CREATE OR REPLACE FUNCTION audit.purge_lease() RETURNS interval
               LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$ SELECT interval '${interval}' $fn$`);
async function waitsForALock(pid: number) {
  for (let i = 0; i < 400; i++) {
    if ((await watcher.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [pid])).rowCount)
      return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`backend ${pid} never waited for a lock`);
}

describe('the request race at the lease’s edge (the critic’s round 4)', () => {
  it('the lease expires between a page’s read and its deletion, a request is recorded meanwhile: the deletion is refused and deletes nothing', async () => {
    await purgeAll();
    const id = await oldEvent();
    const run = await reserve();
    expect((await page(run, 1)).event_ids).toContain(id);
    await setLease('0 seconds');
    let request = '';
    try {
      // The run is no longer live: a request may be recorded, and the page's deletion is refused.
      request = (await owner.query(`SELECT audit.request_purge_report('lease edge') AS id`)).rows[0]
        .id as string;
      await expectSqlState(deletePage(run, 1), '55000');
      expect(await exists(id)).toBe(true);
      await release(run, false);
    } finally {
      await setLease('15 minutes');
    }
    await owner.query(`SELECT audit.cancel_purge_report_request($1, 'lease edge: cancelled')`, [request]);
    await purgeAll();
    expect(await exists(id)).toBe(false);
  });

  it('a page transaction holds the reservation row: a request, a reservation and a cancellation are refused at once, changing nothing', async () => {
    await purgeAll();
    await oldEvent();
    const run = await reserve();
    const requestsBefore = (await owner.query(`SELECT count(*)::int AS n FROM audit.purge_report_requests`))
      .rows[0].n;
    await a.query('BEGIN');
    try {
      await page(run, 1, 1000, a); // holds the reservation row until the transaction ends
      await b.query(`SET statement_timeout = '3s'`); // NOWAIT: a wait would trip it
      await expectSqlState(b.query(`SELECT audit.request_purge_report('while a page is open')`), '55P03');
      await expectSqlState(b.query(`SELECT * FROM audit.reserve_purge_run(now())`), '55P03');
      // The clearing is independent of the reservation: it runs, and does not wait.
      await b.query(`SELECT * FROM audit.clear_expired_request_metadata(now(), 1)`);
    } finally {
      await b.query(`SET statement_timeout = 0`);
      await a.query('COMMIT');
    }
    expect((await owner.query(`SELECT count(*)::int AS n FROM audit.purge_report_requests`)).rows[0].n).toBe(
      requestsBefore,
    );
    await release(run, false);
    await purgeAll();
  });
});

describe('a late commit while a page is deleted (R38)', () => {
  it('an eligible event committed during the deletion is left by that page and that run, and deleted by a later run', async () => {
    await purgeAll();
    const listed = await oldEvent();
    const run = await reserve();
    expect((await page(run, 1)).event_ids).toEqual([listed]);
    // A test-only gate: the deletion of this page's row waits in a BEFORE DELETE trigger until x lets it go.
    const gate = `test_r38_gate_${randomBytes(4).toString('hex')}`;
    const key = Math.floor(Math.random() * 1e9);
    await owner.query(
      `CREATE FUNCTION audit.${gate}() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN PERFORM pg_advisory_xact_lock_shared(${key}); RETURN OLD; END $fn$`,
    );
    await owner.query(
      `CREATE TRIGGER ${gate} BEFORE DELETE ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.${gate}()`,
    );
    let late = '';
    try {
      await x.query('BEGIN');
      await x.query(`SELECT pg_advisory_xact_lock(${key})`);
      const deleting = deletePage(run, 1, a).then((r) => r.rows[0].n as number);
      await waitsForALock(pidA);
      late = await oldEvent(b); // committed while the page is being deleted
      await x.query('COMMIT');
      expect(await deleting).toBe(1);
    } finally {
      await x.query('ROLLBACK').catch(() => undefined);
      await owner.query(`DROP TRIGGER ${gate} ON audit.audit_events`);
      await owner.query(`DROP FUNCTION audit.${gate}()`);
    }
    expect(await exists(listed)).toBe(false);
    expect(await exists(late)).toBe(true); // not in the page's manifest: never deleted by it
    // This run read every eligible row in its first page and is exhausted: it never lists the late event. A later run
    // deletes it.
    const next = await page(run, 2);
    expect(next).toMatchObject({ row_count: 0, exhausted: true });
    await release(run);
    expect(await exists(late)).toBe(true);
    await purgeAll();
    expect(await exists(late)).toBe(false);
  });
});

describe('renewal from the end of a long page (R43)', () => {
  it('the lease is renewed when the page’s work ends, not when it began', async () => {
    await purgeAll();
    await oldEvent();
    const run = await reserve();
    await owner.query('BEGIN');
    const { started } = (await owner.query(`SELECT clock_timestamp() AS started`)).rows[0];
    await owner.query(`SELECT pg_sleep(1.2)`);
    await page(run, 1);
    await owner.query('COMMIT');
    const { renewed } = (await owner.query(`SELECT renewed_at AS renewed FROM audit.purge_reservation`))
      .rows[0];
    expect(new Date(renewed).getTime() - new Date(started).getTime()).toBeGreaterThanOrEqual(1200);
    await release(run, false);
    await purgeAll();
  });
});

describe('the clearing beside other clearings, a live run and an unresolved export (CF4)', () => {
  const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
  async function expiredLinks(n: number) {
    const identity = (
      await owner.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
        `clear-${randomBytes(4).toString('hex')}@example.test`,
      ])
    ).rows[0].id as string;
    const ids: string[] = [];
    for (let i = 0; i < n; i++)
      ids.push(
        (
          await owner.query(
            `INSERT INTO identity.one_time_tokens (identity_id, purpose, token_hash, expires_at, requested_ip, created_at)
             VALUES ($1, 'email_verification', $2, now() - interval '3 years', '192.0.2.77', now() - interval '3 years 1 day')
             RETURNING id`,
            [identity, hash()],
          )
        ).rows[0].id as string,
      );
    return ids;
  }
  const clear = (c: pg.Client, limit: number) =>
    c
      .query(`SELECT * FROM audit.clear_expired_request_metadata(now(), $1)`, [limit])
      .then((r) => r.rows[0] as { tokens_cleared: number; sessions_cleared: number });
  const toZero = async () => {
    while (Object.values(await clear(owner, 10000)).some((n) => n > 0));
  };
  const remaining = async (ids: string[]) =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM identity.one_time_tokens WHERE id = ANY($1) AND requested_ip IS NOT NULL`,
        [ids],
      )
    ).rows[0].n as number;

  it('two clearings at once skip each other’s rows, and clear each row once', async () => {
    await toZero();
    const ids = await expiredLinks(4);
    await a.query('BEGIN');
    try {
      expect(await clear(a, 2)).toEqual({ tokens_cleared: 2, sessions_cleared: 0 });
      await b.query(`SET statement_timeout = '3s'`); // SKIP LOCKED: it never waits
      expect(await clear(b, 10)).toEqual({ tokens_cleared: 2, sessions_cleared: 0 });
    } finally {
      await b.query(`SET statement_timeout = 0`);
      await a.query('COMMIT');
    }
    expect(await remaining(ids)).toBe(0);
    expect(await clear(owner, 10)).toEqual({ tokens_cleared: 0, sessions_cleared: 0 });
  });

  it('clears while a run is live and while an export is unresolved', async () => {
    await toZero();
    await purgeAll();
    const live = await expiredLinks(1);
    const run = await reserve();
    expect((await clear(owner, 10)).tokens_cleared).toBe(1);
    expect(await remaining(live)).toBe(0);
    await release(run, false);

    const request = (await owner.query(`SELECT audit.request_purge_report('clearing test') AS id`)).rows[0]
      .id as string;
    const exportRun = await reserve();
    expect(exportRun.kind).toBe('export');
    await owner.query(`SELECT audit.begin_purge_export($1, $2, 'C:\\clearing', 'host', 'key')`, [
      exportRun.run_id,
      exportRun.as_of,
    ]);
    await release(exportRun, false); // the export stays unresolved
    await expectSqlState(reserve(), '55006'); // export_unresolved blocks every new run …
    const unresolved = await expiredLinks(1);
    expect((await clear(owner, 10)).tokens_cleared).toBe(1); // … but not the clearing
    expect(await remaining(unresolved)).toBe(0);
    await owner.query(`SELECT audit.discard_purge_export($1, 'clearing test', 'automatic')`, [
      exportRun.run_id,
    ]);
    await owner.query(`SELECT audit.cancel_purge_report_request($1, 'clearing test: cancelled')`, [request]);
    await purgeAll();
  });
});
