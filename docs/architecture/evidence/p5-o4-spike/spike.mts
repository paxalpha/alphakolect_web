// P5.8 step (c)(1), the O4 validation spike (P5 plan §8.5 "Indexes — chosen by measured plans, not assumed", §10 P5.8
// "Order inside P5.8 (O4)"). It builds a throwaway database with the project's own migrations, seeds a representative,
// skewed activity record, and records EXPLAIN (ANALYZE, BUFFERS) for every query shape of both audit reads — the
// merchant read (#33) and the platform read (#34) — under each candidate index set. Nothing from the spike becomes a
// migration: the evidence is this script, the dataset parameters and the plans it writes (plans.txt beside it).
//
// Run from the repository root, with the local database up (infrastructure/.env):
//   pnpm --filter @alphakolect/db exec tsx ../../docs/architecture/evidence/p5-o4-spike/spike.mts
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
    const line = `seeded in ${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(facts)}; busiest business ${big.n} events (${bigInWindow} in the window); a small one ${small.n}; all events in the window ${allInWindow}; the busiest business's busiest actor ${busyActor.n}`;
    out.push(line);
    summary.push(line);

    const COLS = `e.id, e.occurred_at, e.merchant_id, e.actor_identity_id, e.action, e.outcome, e.target_type, e.target_id, e.summary`;
    const W = `e.occurred_at >= $1 AND e.occurred_at < $2`;
    const ORDER = `ORDER BY e.occurred_at DESC, e.id DESC LIMIT ${PAGE + 1}`;
    const future = [new Date(to.getTime() + 86_400_000 * 10), new Date(to.getTime() + 86_400_000 * 41)];
    type Shape = { name: string; types: string; sql: string; args: unknown[] };
    const SHAPES: Shape[] = [
      // the merchant read (#33): its business from the session; filters by person
      { name: '#33 first page, busiest', types: '(timestamptz, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND ${W} ${ORDER}`, args: [from, to, big.id] },
      { name: '#33 continuation, busiest', types: '(timestamptz, timestamptz, uuid, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND ${W} AND (e.occurred_at, e.id) < ($4, $5) ${ORDER}`, args: [from, to, big.id, bigDeep.at, bigDeep.id] },
      { name: '#33 by person, busiest', types: '(timestamptz, timestamptz, uuid, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND e.actor_identity_id = $4 AND ${W} ${ORDER}`, args: [from, to, big.id, busyActor.id] },
      { name: '#33 first page, small', types: '(timestamptz, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND ${W} ${ORDER}`, args: [from, to, small.id] },
      { name: '#33 empty window', types: '(timestamptz, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND ${W} ${ORDER}`, args: [...future, big.id] },
      // the platform read (#34): every business; filters by business, person and event
      { name: '#34 first page', types: '(timestamptz, timestamptz)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE ${W} ${ORDER}`, args: [from, to] },
      { name: '#34 continuation', types: '(timestamptz, timestamptz, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE ${W} AND (e.occurred_at, e.id) < ($3, $4) ${ORDER}`, args: [from, to, allDeep.at, allDeep.id] },
      { name: '#34 by business', types: '(timestamptz, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.merchant_id = $3 AND ${W} ${ORDER}`, args: [from, to, big.id] },
      { name: '#34 by person', types: '(timestamptz, timestamptz, uuid)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.actor_identity_id = $3 AND ${W} ${ORDER}`, args: [from, to, busyActor.id] },
      { name: '#34 by event', types: '(timestamptz, timestamptz, text)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE e.action = $3 AND ${W} ${ORDER}`, args: [from, to, 'authz.denied'] },
      { name: '#34 empty window', types: '(timestamptz, timestamptz)', sql: `SELECT ${COLS} FROM audit.audit_events e WHERE ${W} ${ORDER}`, args: future },
    ];
    const STAGES: { name: string; ddl: string[] }[] = [
      { name: 'S0 existing: (merchant_id, occurred_at), (action, occurred_at)', ddl: [] },
      {
        name: 'S1 + (occurred_at, id), (merchant_id, occurred_at, id), (actor_identity_id, occurred_at, id)',
        ddl: [
          `CREATE INDEX spike_occurred_at_id ON audit.audit_events (occurred_at, id)`,
          `CREATE INDEX spike_merchant_occurred_at_id ON audit.audit_events (merchant_id, occurred_at, id)`,
          `CREATE INDEX spike_actor_occurred_at_id ON audit.audit_events (actor_identity_id, occurred_at, id)`,
        ],
      },
      {
        name: 'S2 = S1 + (action, occurred_at, id)',
        ddl: [`CREATE INDEX spike_action_occurred_at_id ON audit.audit_events (action, occurred_at, id)`],
      },
    ];
    const lit = (v: unknown) => (v instanceof Date ? `'${v.toISOString()}'` : `'${String(v)}'`);
    await c.query(`SET plan_cache_mode = force_generic_plan`);
    let k = 0;
    for (const stage of STAGES) {
      const t = Date.now();
      for (const ddl of stage.ddl) await c.query(ddl);
      await c.query('ANALYZE audit.audit_events');
      out.push('', `---- ${stage.name} (indexes built in ${Math.round((Date.now() - t) / 1000)} s)`);
      summary.push(`---- ${stage.name}`);
      for (const s of SHAPES) {
        const stmt = `p${k++}`;
        await c.query(`PREPARE ${stmt}${s.types} AS ${s.sql}`);
        const args = s.args.map(lit).join(', ');
        await c.query(`EXECUTE ${stmt}(${args})`);
        const plan = (await c.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE ${stmt}(${args})`)).rows.map(
          (r: Record<string, string>) => r['QUERY PLAN'],
        );
        const time = plan.find((l: string) => l.startsWith('Execution Time'))!.replace('Execution Time: ', '');
        const buffers = (plan.find((l: string) => /Buffers:/.test(l)) ?? '').trim().replace('Buffers: ', '');
        const node = (plan.find((l: string) => /Scan|Sort/.test(l)) ?? '').trim().replace(/\s+\(actual.*$/, '').replace(/^->\s+/, '');
        const removed = plan.filter((l: string) => /Rows Removed by Filter/.test(l)).map((l: string) => l.trim().replace('Rows Removed by Filter: ', 'filtered ')).join(' ');
        summary.push(`  ${s.name.padEnd(28)} ${time.padStart(12)}  ${buffers.padEnd(32)} ${node} ${removed}`);
        out.push('', `== ${stage.name}: ${s.name} (generic plan)`, ...plan);
      }
    }
  } finally {
    await c.end();
  }
} finally {
  await harness.dropTestDatabase(database);
  fs.writeFileSync(path.join(here, 'plans.txt'), out.join('\n') + '\n');
  process.stdout.write(`${summary.join('\n')}\nthrowaway database dropped; plans in plans.txt\n`);
}
