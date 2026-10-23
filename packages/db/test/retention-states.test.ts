import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// More of the retention design's Tests paragraph (P5 plan §8.6): the guard's refusals case by case, each beside a
// positive control; the ledger's guard unchanged; the calendar, the time zone, a redefined retention and the catalog's
// overrides; the app and reporting roles kept out; every CHECK and partial unique index of the purge's tables; the
// clearing's batches and its idle-expiry rule. Every case runs in a transaction that is rolled back, so the purge state
// is left as found.

let op: pg.Client;
beforeAll(async () => {
  op = await connectAs('migrator');
});
afterAll(async () => {
  await op.end();
});

type Run = { run_id: string; kind: string; as_of: string };

/** Runs `fn` in a transaction that is always rolled back. */
async function rolledBack(fn: () => Promise<void>) {
  await op.query('BEGIN');
  try {
    await fn();
  } finally {
    await op.query('ROLLBACK');
  }
}
/** Runs one statement expected to fail, inside a savepoint so the transaction goes on. */
async function refused(sql: string, params: unknown[], sqlState: string) {
  await op.query('SAVEPOINT s');
  await expectSqlState(op.query(sql, params), sqlState);
  await op.query('ROLLBACK TO SAVEPOINT s');
}
const reserve = async () => (await op.query<Run>(`SELECT * FROM audit.reserve_purge_run(now())`)).rows[0]!;
const event = async (daysAgo: number, action = 'auth.logout') =>
  (
    await op.query<{ id: string }>(
      `INSERT INTO audit.audit_events (occurred_at, action, outcome, summary)
       VALUES (now() - make_interval(days => $1), $2, 'success', '{}') RETURNING id`,
      [daysAgo, action],
    )
  ).rows[0]!.id;
const candidates = async (run: Run) =>
  (
    await op.query<{ event_ids: string[] }>(
      `SELECT event_ids FROM audit.purge_candidates($1, $2, 1, 10000)`,
      [run.run_id, run.as_of],
    )
  ).rows[0]!.event_ids;
const asRun = (run: Run) => op.query(`SELECT set_config('audit.purge_run_id', $1, true)`, [run.run_id]);
const del = (id: string) => op.query(`DELETE FROM audit.audit_events WHERE id = $1`, [id]);
/** An active report holding `eventId`, built directly as the table owner: a request, its report, the manifest row. */
async function holdingReport(eventId: string) {
  const request = (
    await op.query<{ id: string }>(
      `INSERT INTO audit.purge_report_requests (note) VALUES ('states') RETURNING id`,
    )
  ).rows[0]!.id;
  const runId = (await op.query<{ id: string }>(`SELECT util.uuid_v7() AS id`)).rows[0]!.id;
  const report = (
    await op.query<{ id: string }>(
      `INSERT INTO audit.purge_reports (request_id, run_id, p_as_of, confirmed_at, row_count, page_count,
                                        manifest_digest, file_sha256, file_location)
       VALUES ($1, $2, now(), now(), 1, 1, 'd', $3, 'C:\\r\\x.jsonl') RETURNING id`,
      [request, runId, 'a'.repeat(64)],
    )
  ).rows[0]!.id;
  await op.query(
    `INSERT INTO audit.purge_run_events (run_id, page_no, ordinal, event_id) VALUES ($1, 1, 1, $2)`,
    [runId, eventId],
  );
  return { request, report, runId };
}

const OLD = 3 * 365;
const RESTRICT = SQLSTATE.restrictViolation;

describe('the guard, case by case (each beside a deletion it allows)', () => {
  it('refuses a row younger than its retention inside a live plain run', async () => {
    await rolledBack(async () => {
      const young = await event(365);
      const old = await event(OLD);
      const run = await reserve();
      expect(run.kind).toBe('plain');
      await asRun(run);
      await refused(`DELETE FROM audit.audit_events WHERE id = $1`, [young], RESTRICT);
      expect((await del(old)).rowCount).toBe(1);
    });
  });

  it('refuses a row an active report holds, and allows an unheld one, in the same run', async () => {
    await rolledBack(async () => {
      const held = await event(OLD);
      const free = await event(OLD);
      await holdingReport(held);
      const run = await reserve();
      expect(run.kind).toBe('plain'); // the open request has its active report
      expect(await candidates(run)).not.toContain(held);
      await asRun(run);
      await refused(`DELETE FROM audit.audit_events WHERE id = $1`, [held], RESTRICT);
      expect((await del(free)).rowCount).toBe(1);
    });
  });

  it('refuses every row in an export run', async () => {
    await rolledBack(async () => {
      const old = await event(OLD);
      await op.query(`SELECT audit.request_purge_report('states: export')`);
      const run = await reserve();
      expect(run.kind).toBe('export');
      await asRun(run);
      await refused(`DELETE FROM audit.audit_events WHERE id = $1`, [old], RESTRICT);
    });
  });

  it('refuses every row while a request awaits its copy, even one that appeared during a plain run', async () => {
    await rolledBack(async () => {
      const old = await event(OLD);
      const run = await reserve();
      expect(run.kind).toBe('plain');
      await op.query(`INSERT INTO audit.purge_report_requests (note) VALUES ('appeared')`);
      await asRun(run);
      await refused(`DELETE FROM audit.audit_events WHERE id = $1`, [old], RESTRICT);
    });
  });

  it('refuses a run that is not the live one', async () => {
    await rolledBack(async () => {
      const old = await event(OLD);
      await reserve();
      await op.query(`SELECT set_config('audit.purge_run_id', util.uuid_v7()::text, true)`);
      await refused(`DELETE FROM audit.audit_events WHERE id = $1`, [old], RESTRICT);
    });
  });

  it("the activity table's triggers call its own guard; the ledger's still call P1's unchanged function", async () => {
    const { rows } = await op.query<{ table: string; fn: string }>(
      `SELECT c.relnamespace::regnamespace || '.' || c.relname AS table, p.proname AS fn
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal
          AND c.oid IN ('audit.audit_events'::regclass, 'ledger.journal_entries'::regclass,
                        'ledger.journal_lines'::regclass)
          AND p.proname IN ('audit_events_guard', 'reject_modification')
        ORDER BY 1, 2`,
    );
    expect(rows).toEqual([
      { table: 'audit.audit_events', fn: 'audit_events_guard' },
      { table: 'audit.audit_events', fn: 'audit_events_guard' },
      { table: 'ledger.journal_entries', fn: 'reject_modification' },
      { table: 'ledger.journal_entries', fn: 'reject_modification' },
      { table: 'ledger.journal_lines', fn: 'reject_modification' },
      { table: 'ledger.journal_lines', fn: 'reject_modification' },
    ]);
    const p1 = readFileSync(
      new URL('../prisma/migrations/20260927000300_ledger_invariants/migration.sql', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const body = /CREATE FUNCTION "util"\."reject_modification"\(\)[\s\S]*?AS \$fn\$([\s\S]*?)\$fn\$/.exec(
      p1,
    )![1];
    const { rows: src } = await op.query<{ prosrc: string }>(
      `SELECT prosrc FROM pg_proc WHERE oid = 'util.reject_modification()'::regprocedure`,
    );
    expect(src[0]!.prosrc.replace(/\r\n/g, '\n')).toBe(body);
  });
});

describe('the cutoff: calendar years, UTC, the retention as defined now, overrides that only lengthen', () => {
  it('two years before 29 February 2028 is 28 February 2026, and every purge function computes in UTC', async () => {
    const { rows } = await op.query<{ d: string }>(
      `SELECT to_char(('2028-02-29T12:00:00Z'::timestamptz - audit.d9_retention()) AT TIME ZONE 'UTC',
                      'YYYY-MM-DD HH24:MI') AS d`,
    );
    expect(rows[0]!.d).toBe('2026-02-28 12:00');
    const { rows: fns } = await op.query<{ name: string; utc: boolean }>(
      `SELECT p.proname AS name, coalesce('TimeZone=UTC' = ANY(p.proconfig), false) AS utc
         FROM pg_proc p
        WHERE p.pronamespace = 'audit'::regnamespace
          AND p.proname <> 'purge_lease' -- a constant interval: nothing to compute in a time zone
          AND (p.proname LIKE '%purge%' OR p.proname LIKE '%report%' OR p.proname LIKE '%handover%'
               OR p.proname IN ('audit_events_guard', 'event_canonical_text', 'clear_expired_request_metadata',
                                'record_export_artifact', 'begin_purge_export', 'discard_purge_export'))`,
    );
    expect(fns.length).toBeGreaterThanOrEqual(21);
    expect(fns.filter((f) => !f.utc).map((f) => f.name)).toEqual([]);
  });

  it('the canonical text of a row is the same under two session time zones', async () => {
    await rolledBack(async () => {
      const id = await event(10);
      const text = async (tz: string) => {
        await op.query(`SELECT set_config('TimeZone', $1, true)`, [tz]);
        return (
          await op.query<{ t: string }>(
            `SELECT audit.event_canonical_text(a) AS t FROM audit.audit_events a WHERE a.id = $1`,
            [id],
          )
        ).rows[0]!.t;
      };
      expect(await text('Pacific/Kiritimati')).toBe(await text('America/Los_Angeles'));
    });
  });

  it('redefining audit.d9_retention() moves the cutoff on the next call', async () => {
    await rolledBack(async () => {
      const id = await event(Math.round(2.5 * 365));
      await op.query(`CREATE OR REPLACE FUNCTION audit.d9_retention() RETURNS interval
                      LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$ SELECT interval '3 years' $fn$`);
      expect(await candidates(await reserve())).not.toContain(id);
    });
    await rolledBack(async () => {
      const id = await event(Math.round(2.5 * 365));
      expect(await candidates(await reserve())).toContain(id);
    });
  });

  it('a longer override is used and a shorter one ignored', async () => {
    await rolledBack(async () => {
      await op.query(
        `INSERT INTO audit.event_catalog (identifier, outcome, class, retention_override)
         VALUES ('scratch.kept_longer', 'success', 'best_effort', interval '3 years'),
                ('scratch.asked_shorter', 'success', 'best_effort', interval '1 year')`,
      );
      const longer = await event(Math.round(2.5 * 365), 'scratch.kept_longer');
      const shorterYoung = await event(Math.round(1.5 * 365), 'scratch.asked_shorter');
      const shorterOld = await event(Math.round(2.5 * 365), 'scratch.asked_shorter');
      const run = await reserve();
      const ids = await candidates(run);
      expect(ids).not.toContain(longer);
      expect(ids).not.toContain(shorterYoung);
      expect(ids).toContain(shorterOld);
      // The guard applies the same rule.
      await asRun(run);
      await refused(`DELETE FROM audit.audit_events WHERE id = $1`, [longer], RESTRICT);
      await refused(`DELETE FROM audit.audit_events WHERE id = $1`, [shorterYoung], RESTRICT);
    });
  });
});

describe('the app and the reporting role are kept out', () => {
  const TABLES = [
    'purge_reservation',
    'purge_runs',
    'purge_run_pages',
    'purge_run_events',
    'purge_report_requests',
    'purge_exports',
    'purge_reports',
    'purge_report_handovers',
  ];
  for (const role of ['app', 'readonly'] as const) {
    it(`${role}: no purge table, no purge function, no deletion of activity entries`, async () => {
      const c = await connectAs(role);
      try {
        for (const t of TABLES)
          await expectSqlState(c.query(`SELECT 1 FROM audit.${t} LIMIT 1`), SQLSTATE.insufficientPrivilege);
        await expectSqlState(
          c.query(`SELECT * FROM audit.reserve_purge_run(now())`),
          SQLSTATE.insufficientPrivilege,
        );
        await expectSqlState(
          c.query(`SELECT * FROM audit.clear_expired_request_metadata(now(), 1)`),
          SQLSTATE.insufficientPrivilege,
        );
        await expectSqlState(
          c.query(`SELECT audit.request_purge_report('x')`),
          SQLSTATE.insufficientPrivilege,
        );
        await expectSqlState(c.query(`DELETE FROM audit.audit_events`), SQLSTATE.insufficientPrivilege);
      } finally {
        await c.end();
      }
    });
  }
});

describe("the purge tables' states: every CHECK and partial unique index refuses its violation", () => {
  it('refuses two terminal states, a destruction before delivery or withdrawal, a delivery without a handover', async () => {
    await rolledBack(async () => {
      const { report } = await holdingReport(await event(OLD));
      const set = (assignments: string) => `UPDATE audit.purge_reports SET ${assignments} WHERE id = $1`;
      await refused(set(`withdrawn_at = now(), lost_at = now()`), [report], SQLSTATE.checkViolation);
      await refused(
        set(`copy_destroyed_at = now(), destroy_mode = 'automatic'`),
        [report],
        SQLSTATE.checkViolation,
      );
      await refused(set(`delivered_at = now(), receipt_reference = 'r'`), [report], SQLSTATE.checkViolation);
      await refused(
        set(`withdrawn_at = now(), copy_destroyed_at = now()`),
        [report],
        SQLSTATE.checkViolation,
      );
    });
  });

  it('refuses a second active report for a request, a second live handover attempt, a second reservation row', async () => {
    await rolledBack(async () => {
      const { request, report } = await holdingReport(await event(OLD));
      await refused(
        `INSERT INTO audit.purge_reports (request_id, run_id, p_as_of, confirmed_at, row_count, page_count,
                                          manifest_digest, file_sha256, file_location)
         VALUES ($1, util.uuid_v7(), now(), now(), 1, 1, 'd', $2, 'C:\\r\\y.jsonl')`,
        [request, 'b'.repeat(64)],
        SQLSTATE.uniqueViolation,
      );
      const attempt = `INSERT INTO audit.purge_report_handovers (report_id, started_at, medium) VALUES ($1, now(), 'E:')`;
      await op.query(attempt, [report]);
      await refused(attempt, [report], SQLSTATE.uniqueViolation);
      await refused(`INSERT INTO audit.purge_reservation (id) VALUES (true)`, [], SQLSTATE.uniqueViolation);
      await refused(`INSERT INTO audit.purge_reservation (id) VALUES (false)`, [], SQLSTATE.checkViolation);
    });
  });

  it('refuses a recorded handover without its hash, its eject attested and its write', async () => {
    await rolledBack(async () => {
      const { report } = await holdingReport(await event(OLD));
      await refused(
        `INSERT INTO audit.purge_report_handovers (report_id, started_at, medium, outcome, ended_at)
         VALUES ($1, now(), 'E:', 'recorded', now())`,
        [report],
        SQLSTATE.checkViolation,
      );
    });
  });

  it('cancelling a request is refused while a run is live', async () => {
    await rolledBack(async () => {
      const request = (await op.query<{ id: string }>(`SELECT audit.request_purge_report('states') AS id`))
        .rows[0]!.id;
      await reserve();
      await refused(`SELECT audit.cancel_purge_report_request($1, 'states')`, [request], '55006');
    });
  });
});

describe('the clearing (CF4)', () => {
  it('clears at most p_limit rows a call, an idle-expired session like an expired one, never a valid link or a live session', async () => {
    await rolledBack(async () => {
      for (;;) {
        const { rows } = await op.query<{ t: number; s: number }>(
          `SELECT tokens_cleared AS t, sessions_cleared AS s FROM audit.clear_expired_request_metadata(now(), 10000)`,
        );
        if (rows[0]!.t + rows[0]!.s === 0) break;
      }
      const identity = (
        await op.query<{ id: string }>(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
          `states-${randomBytes(4).toString('hex')}@example.test`,
        ])
      ).rows[0]!.id;
      const token = async (expiresDaysAgo: number) =>
        (
          await op.query<{ id: string }>(
            `INSERT INTO identity.one_time_tokens (identity_id, purpose, token_hash, expires_at, requested_ip, created_at)
             VALUES ($1, 'email_verification', $2, now() - make_interval(days => $3), '192.0.2.9',
                     now() - interval '3 years') RETURNING id`,
            [identity, randomBytes(32).toString('hex'), expiresDaysAgo],
          )
        ).rows[0]!.id;
      const expired = [await token(OLD - 1), await token(OLD - 1), await token(OLD - 1)];
      const stillValid = await token(-1); // sent three years ago, valid until tomorrow
      const membership = (
        await op.query<{ id: string }>(
          `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'support') RETURNING id`,
          [identity],
        )
      ).rows[0]!.id;
      const session = async (refreshExpiresDaysAgo: number) => {
        const id = (
          await op.query<{ id: string }>(
            `INSERT INTO identity.sessions (identity_id, audience, platform_membership_id, created_at,
                                            absolute_expires_at, created_ip, user_agent)
             VALUES ($1, 'platform', $2, now() - interval '3 years', now() + interval '1 year', '192.0.2.9', 'ua')
             RETURNING id`,
            [identity, membership],
          )
        ).rows[0]!.id;
        await op.query(
          `INSERT INTO identity.refresh_tokens (session_id, token_hash, expires_at)
           VALUES ($1, $2, now() - make_interval(days => $3))`,
          [id, randomBytes(32).toString('hex'), refreshExpiresDaysAgo],
        );
        return id;
      };
      const idleExpired = await session(OLD - 30); // idle for almost three years
      const live = await session(-1);

      const call = async (limit: number) =>
        (
          await op.query<{ t: number; s: number }>(
            `SELECT tokens_cleared AS t, sessions_cleared AS s FROM audit.clear_expired_request_metadata(now(), $1)`,
            [limit],
          )
        ).rows[0];
      expect(await call(1)).toEqual({ t: 1, s: 0 });
      expect(await call(1)).toEqual({ t: 1, s: 0 });
      expect(await call(2)).toEqual({ t: 1, s: 1 });
      expect(await call(10)).toEqual({ t: 0, s: 0 });

      const { rows: tokens } = await op.query<{ id: string; requested_ip: string | null }>(
        `SELECT id, requested_ip FROM identity.one_time_tokens WHERE id = ANY($1::uuid[])`,
        [[...expired, stillValid]],
      );
      for (const t of tokens) expect(t.requested_ip, t.id).toBe(t.id === stillValid ? '192.0.2.9' : null);
      const { rows: sessions } = await op.query<{
        id: string;
        created_ip: string | null;
        user_agent: string | null;
      }>(`SELECT id, created_ip, user_agent FROM identity.sessions WHERE id = ANY($1::uuid[])`, [
        [idleExpired, live],
      ]);
      for (const s of sessions)
        expect({ ip: s.created_ip, ua: s.user_agent }, s.id).toEqual(
          s.id === live ? { ip: '192.0.2.9', ua: 'ua' } : { ip: null, ua: null },
        );
    });
  });
});
