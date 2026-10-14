import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs } from './support/db.js';
import {
  analyse,
  authorityLiterals,
  contestedIndexes,
  findingKey,
  loadCatalog,
  LOCK_FREE_EXPRESSION_FUNCTIONS,
  schemaFindings,
  type Catalog,
  type Finding,
  type FnClass,
  type FnRow,
} from './support/lock-analysis.js';
import * as plan from './support/lock-plan.js';
import { AUTHORITY_DATA_RULES, BASELINE, BASELINE_CLASSES, CLASSES, RESOLVER } from './support/lock-plan.js';

// The lock-order guard (P5.5 step 1; P5 plan §7.2 — L1–L6, the category order, the planned footprints and the
// authority rule, "What the guard can analyse, and failing closed outside it", R34). It reads every
// function of the identity, tenancy, audit and util schemas from the migrated catalog, computes each one's waiting
// footprint (recursively, triggers included) and checks it against its class (test/support/lock-plan.ts).
//
// Enforcing mode (R34, since P5.5 step 7): every finding fails. The report mode the guard ran in from step 1 — a
// tolerated list that could only shrink — ended when the list was empty; the mechanism is deleted and a test fails if
// it reappears. The baseline control runs the same analysis on the P4 definitions (5d8904b, kept as a fixture) and
// must report exactly the baseline reconciliation. The mutation and fail-closed self-tests install scratch functions
// and tables in a schema of their own and show each kind of violation fails the guard — and that a conforming copy
// passes, so the failures are not noise.

const SCHEMAS = ['identity', 'tenancy', 'audit', 'util'];
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/lock-baseline-5d8904b.json', import.meta.url), 'utf8'),
) as { commit: string; functions: FnRow[] };
const keys = (findings: Finding[]) => findings.map(findingKey).sort();
const report = (findings: Finding[]) => findings.map((f) => `[${f.kind}] ${f.fn}: ${f.detail}`).join('\n');

let owner: pg.Client;
let catalog: Catalog;
beforeAll(async () => {
  owner = await connectAs('migrator');
  catalog = await loadCatalog(owner, SCHEMAS);
});
afterAll(() => owner.end());

describe('enforcing mode (R34): no finding at all', () => {
  it('analyses every function of the four schemas (sanity: it is looking at the real code)', () => {
    const { footprints } = analyse(catalog, CLASSES, SCHEMAS);
    expect(catalog.functions.length).toBeGreaterThanOrEqual(59);
    expect(footprints.get('tenancy.update_membership')).toEqual(['2:S', 'A3:NKU', '7:S', '8:S', '10:W']);
    expect(footprints.get('tenancy.revoke_invitation')).toEqual(['2:S', 'A3:NKU', '4:NKU']);
    expect(footprints.get('identity.rotate_refresh_token')).toEqual(['5:NKU', '10:NKU']);
  });

  it('reports nothing: every function meets its class and every planned footprint is met', () => {
    const { findings } = analyse(catalog, CLASSES, SCHEMAS);
    expect(findings, report(findings)).toEqual([]);
  });

  it('the tolerance mechanism is gone and cannot come back: the plan data exports no tolerated list', () => {
    expect(Object.keys(plan).filter((name) => /TOLERAT/i.test(name))).toEqual([]);
  });

  it('every function of the four schemas is classified, and nothing classified is missing', () => {
    const names = new Set(catalog.functions.map((f) => `${f.schema}.${f.name}`));
    expect([...names].filter((n) => !CLASSES[n])).toEqual([]);
    // …and no class names a function that does not exist.
    expect(Object.keys(CLASSES).filter((n) => !names.has(n))).toEqual([]);
  });

  it('the contested unique keys of the tables written in scope are exactly the known ones (L3)', () => {
    const { writtenTables } = analyse(catalog, CLASSES, SCHEMAS);
    const contested = contestedIndexes(catalog)
      .filter((ix) => writtenTables.has(ix.table))
      .map(
        (ix) =>
          `${ix.table}(${[...ix.columns, ...(ix.expression ? ['<expr>'] : [])].join(', ')})${ix.partial ? ' partial' : ''}`,
      )
      .sort();
    expect(contested).toEqual([
      'identity.identities(email)',
      'identity.platform_memberships(identity_id)',
      'identity.totp_credentials(identity_id)',
      // P5.5 step 4: the branch and role writers insert under the one-active-name rule (merchant_id, lower(name))
      'tenancy.branches(merchant_id, <expr>) partial',
      'tenancy.invitations(merchant_id, email) partial',
      'tenancy.merchant_memberships(merchant_id) partial',
      'tenancy.merchant_memberships(merchant_id, identity_id)',
      // P5.6: the role grant writer inserts grant rows
      'tenancy.role_permissions(merchant_id, role_id, permission)',
      'tenancy.roles(merchant_id, <expr>) partial',
      // P5.5 step 6: the containment switch's one-row key (updated only, never inserted by a function)
      'util.authorization_containment(id)',
      'util.rate_limit_counters(key, window_start)',
    ]);
  });

  it('schema-level expressions of every table written in scope call only lock-free functions', async () => {
    const { writtenTables } = analyse(catalog, CLASSES, SCHEMAS);
    const { findings, seen } = await schemaFindings(owner, [...writtenTables]);
    expect(findings, report(findings)).toEqual([]);
    // Sanity: the check reads the expressions — the defaults' id generator and the policies' tenant function.
    expect(seen).toContain('util.uuid_v7');
    expect(seen).toContain('util.current_merchant_id');
    expect([...seen].filter((f) => !LOCK_FREE_EXPRESSION_FUNCTIONS.has(f))).toEqual([]);
  });
});

describe('the SQL authority guard (§10 P5.5): authority comes only from the resolver', () => {
  it('every kind or role literal outside the resolver is a listed data rule, exactly', () => {
    expect(authorityLiterals(catalog.functions, RESOLVER)).toEqual([...AUTHORITY_DATA_RULES].sort());
  });

  it('sanity: the resolver itself decides by kind and role, and is the one exemption', () => {
    expect(
      authorityLiterals(catalog.functions, new Set()).filter((l) => l.startsWith('identity.permissions_of:'))
        .length,
    ).toBeGreaterThan(0);
  });
});

describe('the baseline control (R34)', () => {
  it('the fixture is the P4 closure: every function as migrated at 5d8904b', () => {
    expect(fixture.commit).toBe('5d8904b');
    expect(fixture.functions).toHaveLength(45);
  });

  it('against the P4 definitions it reports exactly the baseline reconciliation — no more, no fewer', () => {
    const { findings } = analyse({ ...catalog, functions: fixture.functions }, BASELINE_CLASSES, SCHEMAS);
    expect(keys(findings), report(findings)).toEqual([...BASELINE].sort());
  });
});

describe('self-tests: each violation fails the guard, a conforming copy passes (§7.2, R11)', () => {
  const s = `lockguard_${randomBytes(4).toString('hex')}`;
  /** A planned operation, conforming: merchant S → actor's membership NKU (helper) → invitation NKU, then the write. */
  const body = (locks: string) => `
    DECLARE v_actor uuid;
    BEGIN
      SELECT v.membership_id INTO v_actor FROM identity.validate_session(p_session) v;
      ${locks}
      UPDATE tenancy.invitations i SET revoked_at = now() WHERE i.id = p_invitation;
    END`;
  const MERCHANT = `PERFORM 1 FROM tenancy.merchants m WHERE m.id = p_merchant FOR SHARE;`;
  const ACTOR = `PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);`;
  const INVITATION = `PERFORM 1 FROM tenancy.invitations i WHERE i.id = p_invitation FOR NO KEY UPDATE;`;
  const ARGS = 'p_session uuid, p_merchant uuid, p_invitation uuid';
  const op = (planned: string[]): FnClass => ({
    class: 'operation',
    planned,
    writes: ['tenancy.invitations'],
  });
  const IDENTITY: FnClass = { class: 'identity', writes: [] };
  const REVOKE: string[] = ['2:S', 'A3:NKU', '4:NKU'];

  const scratch: Record<string, { sql: string; cls: FnClass }> = {
    conforming: {
      sql: `(${ARGS}) RETURNS void LANGUAGE plpgsql AS $$${body(`${MERCHANT} ${ACTOR} ${INVITATION}`)}$$`,
      cls: op(REVOKE),
    },
    // (a) one inverted pair of categories
    inverted: {
      sql: `(${ARGS}) RETURNS void LANGUAGE plpgsql AS $$${body(`${MERCHANT} ${INVITATION} ${ACTOR}`)}$$`,
      cls: op(REVOKE),
    },
    // (b) an inversion reached only through a nested call
    nested: {
      sql: `(${ARGS}) RETURNS void LANGUAGE plpgsql AS $$${body(`${MERCHANT} ${ACTOR} ${INVITATION} PERFORM ${s}.inner_platform(p_session);`)}$$`,
      cls: op(REVOKE),
    },
    inner_platform: {
      sql: `(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1 FROM identity.platform_memberships pm WHERE pm.id = p_id FOR SHARE; END $$`,
      cls: IDENTITY,
    },
    // (c) a FOR UPDATE
    for_update: {
      sql: `(${ARGS}) RETURNS void LANGUAGE plpgsql AS $$${body(`${MERCHANT} ${ACTOR} ${INVITATION.replace('FOR NO KEY UPDATE', 'FOR UPDATE')}`)}$$`,
      cls: op(REVOKE),
    },
    // (d) a lock after a contested insert
    after_insert: {
      sql: `(p_merchant uuid, p_identity uuid, p_role uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
              INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES (p_merchant, p_identity, 'agent');
              PERFORM 1 FROM tenancy.roles r WHERE r.id = p_role FOR SHARE;
            END $$`,
      cls: { class: 'identity', writes: ['tenancy.merchant_memberships'] },
    },
    // (e) a waiting lock inside a …_locked function
    admit_locked: {
      sql: `(p_invitation uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
              PERFORM 1 FROM tenancy.invitations i WHERE i.id = p_invitation FOR NO KEY UPDATE;
            END $$`,
      cls: { class: 'locked', writes: [] },
    },
    // its conforming twin: re-asserts with NOWAIT, then writes the held row
    admit_ok_locked: {
      sql: `(p_invitation uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
              PERFORM 1 FROM tenancy.invitations i WHERE i.id = p_invitation FOR NO KEY UPDATE NOWAIT;
              UPDATE tenancy.invitations i SET accepted_at = now() WHERE i.id = p_invitation;
            END $$`,
      cls: { class: 'locked', writes: ['tenancy.invitations'] },
    },
    // R22: a conforming operation whose nested callee writes a table the operation does not approve
    unapproved: {
      sql: `(${ARGS}) RETURNS void LANGUAGE plpgsql AS $$${body(`${MERCHANT} ${ACTOR} ${INVITATION} PERFORM ${s}.sneaky(p_session);`)}$$`,
      cls: op(REVOKE),
    },
    sneaky: {
      sql: `(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN UPDATE tenancy.roles r SET name = r.name WHERE r.id = p_id; END $$`,
      cls: { class: 'identity', writes: ['tenancy.roles'] },
    },
    // the SQL authority guard: authority decided by a literal on the session, and a data rule copied elsewhere
    decides_by_kind: {
      sql: `(p_session uuid) RETURNS void LANGUAGE plpgsql AS $$ DECLARE v_actor uuid; BEGIN
              SELECT v.membership_id INTO v_actor FROM identity.validate_session(p_session) v WHERE v.kind = 'owner';
            END $$`,
      cls: IDENTITY,
    },
    copies_a_rule: {
      sql: `(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
              PERFORM 1 FROM tenancy.merchant_memberships mm WHERE mm.id = p_id AND mm.kind = 'owner';
            END $$`,
      cls: IDENTITY,
    },
    // fail closed: dynamic SQL, an unqualified call, an unclassified callee, a call outside the analysed schemas
    dynamic: {
      sql: `() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'SELECT 1'; END $$`,
      cls: IDENTITY,
    },
    unqualified: {
      sql: `() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM inner_platform(NULL); END $$`,
      cls: IDENTITY,
    },
    calls_unlisted: {
      sql: `() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM ${s}.unlisted(); END $$`,
      cls: IDENTITY,
    },
    unlisted: {
      sql: `() RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END $$`,
      cls: undefined as unknown as FnClass,
    },
    outside: {
      sql: `() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM ledger.assert_entry_balanced(NULL); END $$`,
      cls: IDENTITY,
    },
    // schema-level constructs on a table in scope: a default and a CHECK calling a non-allowlisted function, a cascading
    // foreign key and a rewrite rule — the table is in scope because this function writes it
    writes_scratch_table: {
      sql: `() RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO ${s}.t (n) VALUES ('x'); END $$`,
      cls: { class: 'standalone', writes: [`${s}.t`] },
    },
  };
  let run: ReturnType<typeof analyse>;
  let scratchFunctions: FnRow[];
  let schema: Awaited<ReturnType<typeof schemaFindings>>;
  const of = (name: string) => run.findings.filter((f) => f.fn === `${s}.${name}`);

  beforeAll(async () => {
    await owner.query(`CREATE SCHEMA ${s}`);
    await owner.query(
      `CREATE FUNCTION ${s}.fresh() RETURNS uuid LANGUAGE sql AS $$ SELECT util.uuid_v7() $$`,
    );
    await owner.query(
      `CREATE FUNCTION ${s}.ok(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT p <> '' $$`,
    );
    await owner.query(
      `CREATE TABLE ${s}.t (id uuid PRIMARY KEY DEFAULT ${s}.fresh(), n text CHECK (${s}.ok(n)),
         merchant_id uuid REFERENCES tenancy.merchants (id) ON DELETE CASCADE)`,
    );
    await owner.query(`CREATE RULE t_also AS ON UPDATE TO ${s}.t DO ALSO NOTHING`);
    for (const [name, { sql }] of Object.entries(scratch))
      await owner.query(`CREATE FUNCTION ${s}.${name}${sql}`);
    const withScratch = await loadCatalog(owner, [...SCHEMAS, s]);
    const classes: Record<string, FnClass> = { ...CLASSES };
    for (const [name, { cls }] of Object.entries(scratch)) if (cls) classes[`${s}.${name}`] = cls;
    classes[`${s}.fresh`] = { class: 'reader' };
    classes[`${s}.ok`] = { class: 'reader' };
    run = analyse(withScratch, classes, [...SCHEMAS, s]);
    scratchFunctions = withScratch.functions;
    schema = await schemaFindings(owner, [`${s}.t`]);
  });
  afterAll(async () => {
    await owner.query(`DROP SCHEMA ${s} CASCADE`);
  });

  it('control: a conforming copy of a planned operation, and a conforming …_locked function, pass', () => {
    expect(of('conforming'), report(of('conforming'))).toEqual([]);
    expect(run.footprints.get(`${s}.conforming`)).toEqual(REVOKE);
    expect(of('admit_ok_locked'), report(of('admit_ok_locked'))).toEqual([]);
  });

  it('(a) one inverted pair of categories fails (order and footprint)', () => {
    expect(
      of('inverted')
        .map((f) => f.kind)
        .sort(),
    ).toEqual(['footprint', 'order']);
  });

  it('(b) an inversion reached only through a nested call fails', () => {
    expect(of('nested').map((f) => f.kind)).toContain('order');
    expect(of('nested').find((f) => f.kind === 'order')?.detail).toContain(`${s}.inner_platform`);
  });

  it('(c) a FOR UPDATE fails (L1)', () => {
    expect(of('for_update').map((f) => f.kind)).toEqual(['L1']);
  });

  it('(d) a lock after a contested insert fails (L3)', () => {
    expect(of('after_insert').map((f) => f.kind)).toEqual(['L3']);
  });

  it('(e) a waiting lock inside a …_locked function fails (L6)', () => {
    expect(of('admit_locked').map((f) => f.kind)).toEqual(['L6']);
  });

  it('R22: an unapproved write reached through a nested call fails the operation that reaches it', () => {
    expect(of('unapproved').map((f) => f.detail)).toEqual(
      expect.arrayContaining([`an unapproved write to tenancy.roles (at ${s}.sneaky)`]),
    );
    expect(of('sneaky'), report(of('sneaky'))).toEqual([]);
  });

  it('the SQL authority guard refuses authority decided by a literal, and a listed data rule anywhere else', () => {
    const scratchLiterals = authorityLiterals(scratchFunctions, RESOLVER).filter((l) =>
      l.startsWith(`${s}.`),
    );
    expect(scratchLiterals).toEqual([
      `${s}.copies_a_rule: mm.kind = 'owner'`,
      `${s}.decides_by_kind: v.kind = 'owner'`,
    ]);
    // Neither is on the list, so the guard's exact comparison fails for each.
    for (const l of scratchLiterals) expect(AUTHORITY_DATA_RULES).not.toContain(l);
  });

  it('fails closed: dynamic SQL, an unqualified call, an unclassified function, a call outside the analysed schemas', () => {
    expect(of('dynamic').map((f) => f.detail)).toEqual([expect.stringContaining('dynamic SQL (EXECUTE)')]);
    expect(of('unqualified').map((f) => f.detail)).toEqual([
      expect.stringContaining('unqualified call of inner_platform'),
    ]);
    expect(of('unlisted').map((f) => f.detail)).toEqual([expect.stringContaining('not classified')]);
    expect(of('outside').map((f) => f.detail)).toEqual([
      expect.stringContaining('outside the analysed schemas'),
    ]);
  });

  it('fails closed on schema-level constructs of a table in scope: default, CHECK, cascading foreign key, rule', () => {
    expect(run.writtenTables).toContain(`${s}.t`);
    const details = schema.findings.map((f) => f.detail);
    expect(details).toEqual(
      expect.arrayContaining([
        expect.stringMatching(new RegExp(`^a default calls ${s}\\.fresh`)),
        expect.stringMatching(new RegExp(`^a check calls ${s}\\.ok`)),
        expect.stringMatching(/^a foreign-key action: .*ON DELETE CASCADE/),
        expect.stringMatching(/^a rule: t_also/),
      ]),
    );
    expect(details).toHaveLength(4);
  });
});
