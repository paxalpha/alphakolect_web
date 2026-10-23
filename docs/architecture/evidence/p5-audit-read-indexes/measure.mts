// P5.8, the audit reads' indexes — the reviewer's condition of 2026-10-19 on the ADR-16 activity-record addendum:
// "Before finalizing indexes, measure the platform-team-member-across-many-businesses query shape identified in the
// addendum". The O4 spike's dataset (../p5-o4-spike/spike.mts), plus one platform team member busy across many
// businesses; a business's events filtered by that person, and the platform read filtered by them, measured under the
// addendum's index set and with (merchant_id, actor_identity_id, occurred_at, id) added, beside the other shapes as
// controls. The evidence is this script and the plans it writes (plans.txt beside it).
//
// Run from the repository root, with the local database up (infrastructure/.env):
//   pnpm --filter @alphakolect/db exec tsx ../../docs/architecture/evidence/p5-audit-read-indexes/measure.mts
// It prints a summary, writes plans.txt next to itself, drops the database, and prints no connection details.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
process.loadEnvFile(path.join(repo, 'infrastructure/.env'));
const require = createRequire(path.join(repo, 'packages/db/package.json'));
const pg = require('pg');
const harness = await import(new URL('../../../../packages/db/test/support/setup-db.ts', import.meta.url).href);

/** The dataset (§8.5: "order of millions of events across thousands of merchants and actors"). */
const DATASET = {
  events: 2_000_000,
  merchants: 3_000,
  actors: 15_000,
  days: 730, // the D9 retention: two years of activity
  platformShare: 0.05, // events with no business (platform staff, operator)
  groupSizes: '1–4 events per transaction, sharing its timestamp',
  skew: 'business = floor(3000 · u³): the busiest holds about 7% of all events',
  actorsPerMerchant: 5,
};
const WINDOW_DAYS = 31; // O4's proposal: a window of at most 31 days
const PAGE = 100; // O4's proposal: at most 100 events a page

const out: string[] = [`dataset: ${JSON.stringify(DATASET)}`, `window: ${WINDOW_DAYS} days; page: ${PAGE}`];
const summary: string[] = [...out];
await harness.bootstrapRoles();
const database: string = await harness.createTestDatabase();
try {
  harness.migrateDeploy(database);
  const c = new pg.Client(harness.connectionConfig('migrator', database));
  await c.connect();
  try {
    const t0 = Date.now();
    await c.query(`INSERT INTO tenancy.merchants (name, status) SELECT 'Spike ' || g, 'active' FROM generate_series(1, $1) g`, [
      DATASET.merchants,
    ]);
    await c.query(
      `INSERT INTO identity.identities (email) SELECT 'spike-' || g || '@example.test' FROM generate_series(1, $1) g`,
      [DATASET.actors],
    );
    // Seeding only: the validation trigger checks each pair against the catalog; the rows below use catalog pairs.
    await c.query(`ALTER TABLE audit.audit_events DISABLE TRIGGER USER`);
    await c.query(`
      CREATE TEMP TABLE m AS SELECT id, row_number() OVER (ORDER BY id) - 1 AS n FROM tenancy.merchants;
      CREATE TEMP TABLE a AS SELECT id, row_number() OVER (ORDER BY id) - 1 AS n FROM identity.identities;
      CREATE INDEX ON m (n); CREATE INDEX ON a (n);`);
    const groups = Math.round(DATASET.events / 2.5);
    await c.query(
      `WITH g AS (
         SELECT g AS grp,
                1 + (g % 4) AS size,
                timestamptz '2027-01-01 00:00:00+00' - random() * make_interval(days => $2::int) AS at,
                CASE WHEN random() < $3::float8 THEN NULL ELSE floor($4::int * power(random(), 3))::int END AS merchant_n,
                floor(random() * $5::int)::int AS actor_pick
           FROM generate_series(1, $1::int) g)
       INSERT INTO audit.audit_events
         (occurred_at, merchant_id, actor_identity_id, actor_audience, action, outcome, ip, user_agent, request_id, summary)
       SELECT g.at, m.id, a.id,
              CASE WHEN g.merchant_n IS NULL THEN 'platform' ELSE 'merchant' END,
              (ARRAY['auth.login', 'merchant.branch_updated', 'merchant.member_assigned', 'authz.denied',
                     'merchant.profile_updated', 'auth.refresh'])[1 + (g.grp + k) % 6],
              CASE WHEN (g.grp + k) % 6 = 3 THEN 'denied' ELSE 'success' END,
              '198.51.100.' || (g.grp % 250), 'spike-agent', md5(g.grp::text), '{}'::jsonb
         FROM g
         CROSS JOIN LATERAL generate_series(1, g.size) k
         LEFT JOIN m ON m.n = g.merchant_n
         JOIN a ON a.n = CASE WHEN g.merchant_n IS NULL THEN g.actor_pick
                              ELSE (g.merchant_n * $6::int + g.actor_pick % $6::int) % $5::int END`,
      [groups, DATASET.days, DATASET.platformShare, DATASET.merchants, DATASET.actors, DATASET.actorsPerMerchant],
    );
    // The platform team member the addendum names: 60,000 events over the two years spread across 2,000 businesses (the
    // platform team's actions on a business are recorded against it, #27–#29, #36).
    await c.query(`INSERT INTO identity.identities (email) VALUES ('spike-busy-staff@example.test')`);
    const staff = (await c.query(`SELECT id FROM identity.identities WHERE email = 'spike-busy-staff@example.test'`))
      .rows[0].id as string;
    await c.query(
      `INSERT INTO audit.audit_events
         (occurred_at, merchant_id, actor_identity_id, actor_audience, action, outcome, ip, user_agent, request_id, summary)
       SELECT timestamptz '2027-01-01 00:00:00+00' - random() * make_interval(days => $2::int), m.id, $3,
              'platform', 'platform.merchant_members_read', 'success', '203.0.113.9', 'staff-agent', md5(g::text), '{}'::jsonb
         FROM generate_series(1, $1::int) g
         JOIN m ON m.n = (g * 7919) % 2000`,
      [60_000, DATASET.days, staff],
    );
    await c.query(`ALTER TABLE audit.audit_events ENABLE TRIGGER USER`);
    await c.query(`ANALYZE audit.audit_events`);

    const facts = (
      await c.query(`
        SELECT count(*)::int AS events,
               count(*) FILTER (WHERE merchant_id IS NULL)::int AS platform_events,
               (SELECT count(*) FROM (SELECT occurred_at FROM audit.audit_events GROUP BY occurred_at HAVING count(*) > 1) t)::int
                 AS shared_timestamps,
               max(occurred_at) AS latest
          FROM audit.audit_events`)
    ).rows[0];
    const big = (
      await c.query(`SELECT merchant_id AS id, count(*)::int AS n FROM audit.audit_events WHERE merchant_id IS NOT NULL
                      GROUP BY merchant_id ORDER BY count(*) DESC LIMIT 1`)
    ).rows[0];
    const small = (
      await c.query(`SELECT merchant_id AS id, count(*)::int AS n FROM audit.audit_events WHERE merchant_id IS NOT NULL
                      GROUP BY merchant_id HAVING count(*) BETWEEN 20 AND 200 ORDER BY merchant_id LIMIT 1`)
    ).rows[0];
    const to = new Date(facts.latest);
    const from = new Date(to.getTime() - WINDOW_DAYS * 86_400_000);
    // ... and 40 of that member's events in the busiest business inside the window: sparse there, busy everywhere else.
    await c.query(`ALTER TABLE audit.audit_events DISABLE TRIGGER USER`);
    await c.query(
      `INSERT INTO audit.audit_events (occurred_at, merchant_id, actor_identity_id, actor_audience, action, outcome, summary)
       SELECT $1::timestamptz - (g * interval '17 hours'), $2, $3, 'platform', 'platform.merchant_members_read',
              'success', '{}'::jsonb FROM generate_series(1, 40) g`,
      [facts.latest, big.id, staff],
    );
    await c.query(`ALTER TABLE audit.audit_events ENABLE TRIGGER USER`);
    await c.query('ANALYZE audit.audit_events');
    const busyActor = (
      await c.query(
        `SELECT actor_identity_id AS id, count(*)::int AS n FROM audit.audit_events WHERE merchant_id = $1
          GROUP BY actor_identity_id ORDER BY count(*) DESC LIMIT 1`,
        [big.id],
      )
    ).rows[0];
    const windowCount = async (where: string, p: unknown[]) =>
      (await c.query(`SELECT count(*)::int AS n FROM audit.audit_events WHERE occurred_at >= $1 AND occurred_at < $2 ${where}`, [from, to, ...p])).rows[0].n;
    const bigInWindow = await windowCount('AND merchant_id = $3', [big.id]);
    const staffInWindow = await windowCount('AND actor_identity_id = $3', [staff]);
    const staffInBig = await windowCount('AND actor_identity_id = $3 AND merchant_id = $4', [staff, big.id]);
    const allInWindow = await windowCount('', []);
    const deep = async (where: string, p: unknown[], n: number) =>
      (
        await c.query(
          `SELECT occurred_at AS at, id FROM audit.audit_events WHERE occurred_at >= $1 AND occurred_at < $2 ${where}
            ORDER BY occurred_at DESC, id DESC OFFSET $${3 + p.length} LIMIT 1`,
          [from, to, ...p, Math.floor(n * 0.75)],
        )
      ).rows[0] as { at: Date; id: string };
    const bigDeep = await deep('AND merchant_id = $3', [big.id], bigInWindow);
    const allDeep = await deep('', [], allInWindow);
    const line = `seeded in ${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(facts)}; busiest business ${big.n} events (${bigInWindow} in the window); a small one ${small.n}; all events in the window ${allInWindow}; the busiest business's busiest actor ${busyActor.n}; the busy staff member: ${staffInWindow} events in the window across businesses, ${staffInBig} of them in the busiest business`;
    out.push(line);
    summary.push(line);

    const COLS = `e.id, e.occurred_at, e.merchant_id, e.actor_identity_id, e.action, e.outcome, e.target_type, e.target_id, e.summary`;
    const W = `e.occurred_at >= $1 AND e.occurred_at < $2`;
    const ORDER = `ORDER BY e.occurred_at DESC, e.id DESC LIMIT ${PAGE + 1}`;
    const future = [new Date(to.getTime() + 86_400_000 * 10), new Date(to.getTime() + 86_400_000 * 41)];
    type Shape = { name: string; types: string; sql: string; args: unknown[] };
    const SHAPES: Shape[] = [
      // the shape the addendum names: one business's events by a platform team member busy across many businesses
      { name: '#34 busiest + busy staff', types: '(timestamptz, timestamptz, uuid, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND e.actor_identity_id = $4 AND ${W} ${ORDER}`, args: [from, to, big.id, staff] },
      { name: '#34 small + busy staff', types: '(timestamptz, timestamptz, uuid, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND e.actor_identity_id = $4 AND ${W} ${ORDER}`, args: [from, to, small.id, staff] },
      { name: '#34 by busy staff', types: '(timestamptz, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.actor_identity_id = $3 AND ${W} ${ORDER}`, args: [from, to, staff] },
      // the other shapes again, as controls (#33 filters by one of the business's own members, never the platform team)
      { name: '#33 first page, busiest', types: '(timestamptz, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND ${W} ${ORDER}`, args: [from, to, big.id] },
      { name: '#33 continuation, busiest', types: '(timestamptz, timestamptz, uuid, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND ${W} AND (e.occurred_at, e.id) < ($4, $5) ${ORDER}`, args: [from, to, big.id, bigDeep.at, bigDeep.id] },
      { name: '#33 by person, busiest', types: '(timestamptz, timestamptz, uuid, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND e.actor_identity_id = $4 AND ${W} ${ORDER}`, args: [from, to, big.id, busyActor.id] },
      { name: '#34 first page', types: '(timestamptz, timestamptz)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE ${W} ${ORDER}`, args: [from, to] },
      { name: '#34 continuation', types: '(timestamptz, timestamptz, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE ${W} AND (e.occurred_at, e.id) < ($3, $4) ${ORDER}`, args: [from, to, allDeep.at, allDeep.id] },
      { name: '#34 by business', types: '(timestamptz, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND ${W} ${ORDER}`, args: [from, to, big.id] },
      { name: '#34 by person', types: '(timestamptz, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.actor_identity_id = $3 AND ${W} ${ORDER}`, args: [from, to, busyActor.id] },
      { name: '#34 by event', types: '(timestamptz, timestamptz, text)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.action = $3 AND ${W} ${ORDER}`, args: [from, to, 'authz.denied'] },
      { name: '#34 empty window', types: '(timestamptz, timestamptz)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE ${W} ${ORDER}`, args: future },
    ];
    // The migrated database already has (occurred_at, id) (Part 2's migration) besides P1's (merchant_id, occurred_at)
    // and (action, occurred_at).
    const STAGES: { name: string; ddl: string[] }[] = [
      {
        name: 'A the addendum: (merchant_id, occurred_at, id) replacing (merchant_id, occurred_at); (actor_identity_id, occurred_at, id)',
        ddl: [
          `DROP INDEX audit.audit_events_merchant_id_occurred_at_idx`,
          `CREATE INDEX spike_merchant_occurred_at_id ON audit.audit_events (merchant_id, occurred_at, id)`,
          `CREATE INDEX spike_actor_occurred_at_id ON audit.audit_events (actor_identity_id, occurred_at, id)`,
        ],
      },
      {
        name: 'B = A + (merchant_id, actor_identity_id, occurred_at, id)',
        ddl: [
          `CREATE INDEX spike_merchant_actor_occurred_at_id ON audit.audit_events (merchant_id, actor_identity_id, occurred_at, id)`,
        ],
      },
    ];
    const lit = (v: unknown) =>
      v === null ? 'NULL' : v instanceof Date ? `'${v.toISOString()}'` : `'${String(v)}'`;
    // The functions' own statements (20261019000100_audit_reads), each optional filter `parameter IS NULL OR …`, as
    // the functions run them: planned per call (plan_cache_mode = force_custom_plan).
    const FN33 = {
      types: '(timestamptz, timestamptz, uuid, uuid, timestamptz, uuid)',
      sql: `SELECT ${COLS}, i.email, t.team FROM audit.audit_events e
              LEFT JOIN identity.identities i ON i.id = e.actor_identity_id
              CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM identity.platform_memberships pm
                                                  WHERE pm.identity_id = e.actor_identity_id) AS team) t
             WHERE e.merchant_id = $3 AND ${W} AND ($4::uuid IS NULL OR e.actor_identity_id = $4)
               AND ($6::uuid IS NULL OR (e.occurred_at, e.id) < ($5, $6)) ${ORDER}`,
    };
    const FN34 = {
      types: '(timestamptz, timestamptz, uuid, uuid, text, timestamptz, uuid)',
      sql: `SELECT ${COLS}, i.email FROM audit.audit_events e
              LEFT JOIN identity.identities i ON i.id = e.actor_identity_id
             WHERE ${W} AND ($3::uuid IS NULL OR e.merchant_id = $3) AND ($4::uuid IS NULL OR e.actor_identity_id = $4)
               AND ($5::text IS NULL OR e.action = $5) AND ($7::uuid IS NULL OR (e.occurred_at, e.id) < ($6, $7)) ${ORDER}`,
    };
    const CALLS: { name: string; fn: typeof FN33; args: unknown[] }[] = [
      { name: '#34 busiest + busy staff', fn: FN34, args: [from, to, big.id, staff, null, null, null] },
      { name: '#34 small + busy staff', fn: FN34, args: [from, to, small.id, staff, null, null, null] },
      { name: '#34 by busy staff', fn: FN34, args: [from, to, null, staff, null, null, null] },
      { name: '#33 first page, busiest', fn: FN33, args: [from, to, big.id, null, null, null] },
      { name: '#33 continuation, busiest', fn: FN33, args: [from, to, big.id, null, bigDeep.at, bigDeep.id] },
      { name: '#33 by person, busiest', fn: FN33, args: [from, to, big.id, busyActor.id, null, null] },
      { name: '#34 first page', fn: FN34, args: [from, to, null, null, null, null, null] },
      { name: '#34 continuation', fn: FN34, args: [from, to, null, null, null, allDeep.at, allDeep.id] },
      { name: '#34 by business', fn: FN34, args: [from, to, big.id, null, null, null, null] },
      { name: '#34 by person', fn: FN34, args: [from, to, null, busyActor.id, null, null, null] },
      { name: '#34 by event', fn: FN34, args: [from, to, null, null, 'authz.denied', null, null] },
      { name: '#34 empty window', fn: FN34, args: [...future, null, null, null, null, null] },
    ];
    let k = 0;
    const measure = async (label: string, name: string, types: string, sql: string, args: unknown[]) => {
      const stmt = `p${k++}`;
      await c.query(`PREPARE ${stmt}${types} AS ${sql}`);
      const values = args.map(lit).join(', ');
      await c.query(`EXECUTE ${stmt}(${values})`);
      const plan = (await c.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE ${stmt}(${values})`)).rows.map(
        (r: Record<string, string>) => r['QUERY PLAN'],
      );
      const time = plan.find((l: string) => l.startsWith('Execution Time'))!.replace('Execution Time: ', '');
      const buffers = (plan.find((l: string) => /Buffers:/.test(l)) ?? '').trim().replace('Buffers: ', '');
      const node = (plan.find((l: string) => /Scan on audit_events|Scan Backward|Sort/.test(l)) ?? '').trim().replace(/\s+\(actual.*$/, '').replace(/^->\s+/, '');
      const removed = plan.filter((l: string) => /Rows Removed by Filter/.test(l)).map((l: string) => l.trim().replace('Rows Removed by Filter: ', 'filtered ')).join(' ');
      summary.push(`  ${name.padEnd(28)} ${time.padStart(12)}  ${buffers.padEnd(32)} ${node} ${removed}`);
      out.push('', `== ${label}: ${name}`, ...plan);
    };
    for (const stage of STAGES) {
      const t = Date.now();
      for (const ddl of stage.ddl) await c.query(ddl);
      await c.query('ANALYZE audit.audit_events');
      out.push('', `---- ${stage.name} (indexes built in ${Math.round((Date.now() - t) / 1000)} s)`);
      summary.push(`---- ${stage.name}: generic plans of the exact shapes`);
      await c.query(`SET plan_cache_mode = force_generic_plan`);
      for (const s of SHAPES) await measure(`${stage.name}, generic`, s.name, s.types, s.sql, s.args);
      summary.push(`---- ${stage.name}: the functions' statements, planned per call`);
      await c.query(`SET plan_cache_mode = force_custom_plan`);
      for (const s of CALLS) await measure(`${stage.name}, per call`, s.name, s.fn.types, s.fn.sql, s.args);
    }
  } finally {
    await c.end();
  }
} finally {
  await harness.dropTestDatabase(database);
  fs.writeFileSync(path.join(here, 'plans.txt'), out.join('\n') + '\n');
  process.stdout.write(`${summary.join('\n')}\nthrowaway database dropped; plans in plans.txt\n`);
}
