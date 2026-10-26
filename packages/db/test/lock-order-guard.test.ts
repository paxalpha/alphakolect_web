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
  merchantScopeFindings,
  schemaFindings,
  tenantTables,
  type Catalog,
  type Finding,
  type FnClass,
  type FnRow,
} from './support/lock-analysis.js';
import * as plan from './support/lock-plan.js';
import {
  AUTHORITY_DATA_RULES,
  BASELINE,
  BASELINE_CLASSES,
  CLASSES,
  MERCHANT_SCOPE_EXEMPT,
  MERCHANT_SCOPE_INTERNAL,
  MERCHANT_SCOPED_READS,
  RESOLVER,
  SENSITIVE_READS,
} from './support/lock-plan.js';

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

const SCHEMAS = ['identity', 'tenancy', 'audit', 'util', 'ledger', 'customers', 'savings'];
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
      // P5.8 Part 2: run, manifest, export and report state inserted under unique keys
      'audit.purge_exports(run_id)',
      'audit.purge_report_handovers(report_id) partial',
      'audit.purge_reports(request_id) partial',
      'audit.purge_reports(run_id)',
      'audit.purge_reservation(id)',
      'audit.purge_run_events(run_id, page_no, ordinal)',
      'audit.purge_run_pages(run_id, page_no)',
      'audit.purge_runs(run_id)',
      // P7: the customers' unique keys — a link, an agent, a sign-in and a phone number per business
      'customers.app_invitations(customer_id) partial',
      'customers.assignments(customer_id) partial',
      'customers.customers(merchant_id, identity_id) partial',
      'customers.customers(merchant_id, phone) partial',
      'identity.identities(email)',
      // P5.7: the platform grant writer inserts grant rows
      'identity.platform_membership_grants(platform_membership_id, permission)',
      'identity.platform_memberships(identity_id)',
      'identity.totp_credentials(identity_id)',
      // P6: a ledger opened with its system accounts and their projections (at signup; one platform ledger)
      'ledger.accounts(ledger_id, code, subject_type, subject_id)',
      'ledger.balance_projection(account_id)',
      'ledger.balance_projection(merchant_id, account_id)',
      // P6: a posting's entry, under its key and (a reversal) its original (TA-4)
      'ledger.journal_entries(ledger_id, idempotency_key)',
      'ledger.journal_entries(merchant_id, idempotency_key)',
      'ledger.journal_entries(reverses_entry_id) partial',
      'ledger.ledgers(merchant_id)',
      'ledger.ledgers(owner_kind) partial',
      // P8: savings — a collection and a movement under the actor's key, a cycle's number, one enrolment and one
      // goal per customer, one active package per name
      'savings.collections(merchant_id, agent_membership_id, idem_key)',
      'savings.cycles(customer_id, number)',
      'savings.enrolments(customer_id)',
      'savings.movements(merchant_id, made_by_membership_id, idem_key)',
      'savings.packages(merchant_id, <expr>) partial',
      'savings.target_goals(customer_id)',
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
      // P6 (TA-6): a command's claim
      'util.idempotency_records(merchant_id, identity_id, operation, idem_key)',
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

// R19 (P5 plan §8.5; the reviewer's condition at the P5.7 gate): a merchant-scoped definer read filters every tenant
// table by the business its own session gives — row-level security filters nothing inside a definer function.
describe('the merchant-scope guard (R19): merchant-scoped definer reads filter by the session’s business', () => {
  let tenant: Map<string, string>;
  beforeAll(async () => {
    tenant = await tenantTables(owner);
  });
  const fn = (key: string) => catalog.functions.find((f) => `${f.schema}.${f.name}` === key)!;
  const readsTenant = (f: FnRow) =>
    [...tenant.keys()].some((t) => new RegExp(`\\b${t.replace('.', '\\.')}\\b(?!\\s*\\()`, 'i').test(f.def));

  it('sees the tenant tables (sanity): the businesses by id, the rest by merchant_id', () => {
    expect(tenant.get('tenancy.merchants')).toBe('id');
    for (const t of [
      'tenancy.merchant_memberships',
      'tenancy.roles',
      'tenancy.invitations',
      'audit.audit_events',
    ])
      expect(tenant.get(t), t).toBe('merchant_id');
  });

  it('every listed merchant-scoped read filters every tenant table it reads by the session’s business', () => {
    const findings = MERCHANT_SCOPED_READS.flatMap((key) => {
      expect(fn(key), key).toBeDefined();
      return merchantScopeFindings(fn(key), tenant);
    });
    expect(findings).toEqual([]);
  });

  /**
   * The readers and sensitive reads that read a tenant table: the check's scope, from the catalog — whatever their
   * parameters are called (the P5.8 hold-point review: a scope keyed on `p_session_id` missed a reader that names its
   * session otherwise).
   */
  const inScope = (functions: FnRow[], classes: Readonly<Record<string, FnClass>>) => {
    const designated = new Set(Object.values(SENSITIVE_READS));
    return functions
      .filter((f) => {
        const key = `${f.schema}.${f.name}`;
        return classes[key]?.class === 'reader' || designated.has(key);
      })
      .filter(readsTenant)
      .map((f) => `${f.schema}.${f.name}`)
      .sort();
  };
  const listed = () =>
    [
      ...MERCHANT_SCOPED_READS,
      ...Object.keys(MERCHANT_SCOPE_EXEMPT),
      ...Object.keys(MERCHANT_SCOPE_INTERNAL),
    ].sort();
  /** Parameters that name a session but are not the convention's `p_session_id`: the resolvers are read with it. */
  const sessionParamFindings = (functions: FnRow[]) =>
    functions.flatMap((f) =>
      f.args
        .split(',')
        .map(
          (a) =>
            a
              .trim()
              .replace(/^(?:in|out|inout|variadic)\s+/i, '')
              .split(/\s+/)[0]!,
        )
        .filter((name) => /session/i.test(name) && name !== 'p_session_id')
        .map((name) => `${f.schema}.${f.name}: ${name}`),
    );

  it('every reader of a tenant table is listed: checked, exempt with its reason, or internal', () => {
    expect(inScope(catalog.functions, CLASSES)).toEqual(listed());
    expect(listed()).toEqual([...new Set(listed())]);
  });

  it('a session parameter is always p_session_id, the name the check reads the resolvers with', () => {
    expect(sessionParamFindings(catalog.functions)).toEqual([]);
  });

  it('the exempt readers are exempt for a reason: the check would refuse each of them', () => {
    for (const key of Object.keys(MERCHANT_SCOPE_EXEMPT))
      expect(merchantScopeFindings(fn(key), tenant), key).not.toEqual([]);
  });

  it('the internal readers take no session, and no application role may execute them', () => {
    for (const key of Object.keys(MERCHANT_SCOPE_INTERNAL)) {
      expect(fn(key), key).toBeDefined();
      expect(fn(key).args, key).not.toMatch(/session/i);
      expect(fn(key).executors, key).toEqual([]);
    }
  });

  describe('self-tests: each way of escaping the session’s business fails the check, a conforming read passes', () => {
    const probe = (body: string, lang = 'sql'): FnRow => ({
      schema: 'probe',
      name: 'read',
      args: 'p_session_id uuid, p_merchant_id uuid, p_branch_id uuid',
      lang,
      definer: true,
      executors: [],
      def: `CREATE FUNCTION probe.read() RETURNS SETOF record LANGUAGE ${lang} AS $function$${body}$function$`,
    });
    const findings = (body: string, lang = 'sql') => merchantScopeFindings(probe(body, lang), tenant);
    const AUTHORITY = `FROM identity.session_authority(p_session_id) a`;

    it('controls: a join on the resolver, a session variable, a chain, a correlated subquery, a left join — all pass', () => {
      expect(
        findings(`SELECT b.id ${AUTHORITY} JOIN tenancy.branches b ON b.merchant_id = a.merchant_id`),
      ).toEqual([]);
      expect(
        findings(
          `DECLARE v_merchant uuid; BEGIN
             SELECT v.merchant_id, v.membership_id INTO v_merchant, v_actor FROM identity.validate_session(p_session_id) v;
             RETURN QUERY SELECT b.id FROM tenancy.branches b WHERE b.merchant_id = v_merchant AND b.id = p_branch_id;
           END`,
          'plpgsql',
        ),
      ).toEqual([]);
      expect(
        findings(
          `SELECT r.id, ARRAY(SELECT rp.permission FROM tenancy.role_permissions rp
                              WHERE rp.merchant_id = r.merchant_id AND rp.role_id = r.id)
             ${AUTHORITY} JOIN tenancy.merchants m ON m.id = a.merchant_id
             JOIN tenancy.roles r ON r.merchant_id = m.id`,
        ),
      ).toEqual([]);
      expect(
        findings(`SELECT b.id ${AUTHORITY} LEFT JOIN tenancy.branches b ON b.merchant_id = a.merchant_id`),
      ).toEqual([]);
    });

    it('(1) a business taken from a parameter fails', () => {
      expect(
        findings(`SELECT b.id ${AUTHORITY} JOIN tenancy.branches b ON b.merchant_id = p_merchant_id`),
      ).toHaveLength(1);
    });

    it('(2) no business filter at all fails, whatever else filters the rows', () => {
      expect(findings(`SELECT b.id ${AUTHORITY} JOIN tenancy.branches b ON b.id = p_branch_id`)).toHaveLength(
        1,
      );
    });

    it('(3) a business filter only inside an OR fails', () => {
      expect(
        findings(
          `SELECT b.id ${AUTHORITY} JOIN tenancy.branches b ON true WHERE (b.merchant_id = a.merchant_id OR b.id = p_branch_id)`,
        ),
      ).toHaveLength(1);
    });

    it('(4) an unfiltered table in a subquery fails, though the outer query is filtered', () => {
      expect(
        findings(
          `SELECT b.id, ARRAY(SELECT r.id FROM tenancy.roles r) ${AUTHORITY}
             JOIN tenancy.branches b ON b.merchant_id = a.merchant_id`,
        ),
      ).toHaveLength(1);
    });

    it('(5) a session resolver called with another session, or a variable not taken from the session, fails', () => {
      expect(
        findings(
          `SELECT b.id FROM identity.session_authority(p_merchant_id) a JOIN tenancy.branches b ON b.merchant_id = a.merchant_id`,
        ),
      ).toHaveLength(1);
      expect(
        findings(
          `DECLARE v_merchant uuid; BEGIN
             v_merchant := p_merchant_id;
             RETURN QUERY SELECT b.id FROM tenancy.branches b WHERE b.merchant_id = v_merchant;
           END`,
          'plpgsql',
        ),
      ).toHaveLength(1);
    });

    it('(7) a read event inserted into another business, or by a statement the check cannot read, fails', () => {
      const SESSION = `SELECT v.merchant_id, v.membership_id INTO v_merchant, v_actor FROM identity.validate_session(p_session_id) v;`;
      const insert = (merchant: string, rest = '') =>
        findings(
          `DECLARE v_merchant uuid; BEGIN ${SESSION}
             INSERT INTO audit.audit_events (merchant_id, action, outcome, summary)
             VALUES (${merchant}, 'merchant.audit_read', 'success', jsonb_build_object('limit', p_limit))${rest};
           END`,
          'plpgsql',
        );
      expect(insert('v_merchant')).toEqual([]); // the control: its own business
      expect(insert('p_merchant_id')).toHaveLength(1); // a parameter
      expect(insert('NULL')).toHaveLength(1); // no business
      expect(insert('v_merchant', `, (p_merchant_id, 'x', 'y', '{}')`)).not.toEqual([]); // a second row
      expect(
        findings(
          `DECLARE v_merchant uuid; BEGIN ${SESSION}
             INSERT INTO audit.audit_events (action, outcome, summary) VALUES ('merchant.audit_read', 'success', '{}');
           END`,
          'plpgsql',
        ),
      ).toHaveLength(1); // no business column at all
      expect(
        findings(
          `DECLARE v_merchant uuid; BEGIN ${SESSION}
             INSERT INTO audit.audit_events (merchant_id, action, outcome) SELECT p_merchant_id, 'x', 'y';
           END`,
          'plpgsql',
        ),
      ).toHaveLength(1); // INSERT … SELECT
    });

    it('(6) a left join filters only the table it joins: the table on its left stays unfiltered', () => {
      expect(
        findings(
          `SELECT b.id FROM tenancy.branches b LEFT JOIN identity.session_authority(p_session_id) a ON b.merchant_id = a.merchant_id`,
        ),
      ).toHaveLength(1);
    });

    it('(8) a new reader of a tenant table cannot escape the check by not being listed', () => {
      const unlisted = probe(
        `SELECT b.id ${AUTHORITY} JOIN tenancy.branches b ON b.merchant_id = a.merchant_id`,
      );
      const scope = inScope([...catalog.functions, unlisted], {
        ...CLASSES,
        'probe.read': { class: 'reader' },
      });
      expect(scope.filter((k) => !listed().includes(k))).toEqual(['probe.read']);
    });

    it('(9) nor by naming its session parameter otherwise: it is in scope, unbound, and breaks the convention', () => {
      const renamed: FnRow = {
        ...probe(
          `SELECT b.id FROM identity.session_authority(p_session) a JOIN tenancy.branches b ON b.merchant_id = a.merchant_id`,
        ),
        name: 'renamed',
        args: 'p_session uuid, p_branch_id uuid',
      };
      const scope = inScope([...catalog.functions, renamed], {
        ...CLASSES,
        'probe.renamed': { class: 'reader' },
      });
      expect(scope.filter((k) => !listed().includes(k))).toEqual(['probe.renamed']);
      expect(merchantScopeFindings(renamed, tenant)).toHaveLength(1);
      expect(sessionParamFindings([renamed])).toEqual(['probe.renamed: p_session']);
      // An internal reader is in scope too, whatever it takes: one that is not listed fails the inventory.
      const internal: FnRow = { ...probe(`SELECT b.id FROM tenancy.branches b`), name: 'internal', args: '' };
      const all = inScope([...catalog.functions, internal], {
        ...CLASSES,
        'probe.internal': { class: 'reader' },
      });
      expect(all.filter((k) => !listed().includes(k))).toEqual(['probe.internal']);
    });

    it('(7) fails closed: a comma join, and a right or full outer join, are findings', () => {
      expect(
        findings(`SELECT b.id ${AUTHORITY}, tenancy.branches b WHERE b.merchant_id = a.merchant_id`).length,
      ).toBeGreaterThan(0);
      expect(
        findings(`SELECT b.id ${AUTHORITY} RIGHT JOIN tenancy.branches b ON b.merchant_id = a.merchant_id`)
          .length,
      ).toBeGreaterThan(0);
    });
  });
});

// The retention purge's two lock rules (P5 plan §8.6 item 12, Part 2): activity rows (category 11) are deleted by the
// purge alone, and the purge's own tables (category 0) are written only after the reservation row, taken NOWAIT first.
describe('the purge’s lock rules (§8.6 item 12): category 11 and the purge tables', () => {
  const PURGE_TABLES =
    /\b(?:insert\s+into|update|delete\s+from)\s+audit\.purge_(?:runs|run_pages|run_events|report_requests|exports|reports|report_handovers)\b/i;
  const RESERVATION_FIRST =
    /from\s+audit\.purge_reservation\s+r\s+where\s+r\.id\s+for\s+no\s+key\s+update\s+nowait/i;
  const bodyOf = (f: FnRow) => {
    const a = f.def.indexOf('$function$');
    const b = f.def.lastIndexOf('$function$');
    return a >= 0 && b > a ? f.def.slice(a + 10, b) : f.def;
  };
  /** Every function that deletes activity rows. */
  const deletesActivity = (functions: FnRow[]) =>
    functions
      .filter((f) => /\bdelete\s+from\s+audit\.audit_events\b/i.test(bodyOf(f)))
      .map((f) => `${f.schema}.${f.name}`)
      .sort();
  /** Every function that writes a purge table before taking the reservation row. */
  const writesBeforeReservation = (functions: FnRow[]) =>
    functions
      .filter((f) => {
        const body = bodyOf(f);
        const write = body.search(PURGE_TABLES);
        if (write < 0) return false;
        const reservation = body.search(RESERVATION_FIRST);
        return reservation < 0 || reservation > write;
      })
      .map((f) => `${f.schema}.${f.name}`)
      .sort();
  const probe = (name: string, body: string): FnRow => ({
    schema: 'probe',
    name,
    args: '',
    lang: 'plpgsql',
    definer: true,
    executors: [],
    def: `CREATE FUNCTION probe.${name}() RETURNS void LANGUAGE plpgsql AS $function$${body}$function$`,
  });

  it('activity rows are deleted by audit.purge_expired_events alone', () => {
    expect(deletesActivity(catalog.functions)).toEqual(['audit.purge_expired_events']);
  });

  it('every write to a purge table follows the reservation row, taken NOWAIT first', () => {
    expect(writesBeforeReservation(catalog.functions)).toEqual([]);
  });

  it('mutations: a second function deleting activity rows, and a purge-table write without the reservation, fail', () => {
    const deleter = probe(
      'deleter',
      `BEGIN DELETE FROM audit.audit_events a WHERE a.id = gen_random_uuid(); END`,
    );
    expect(deletesActivity([...catalog.functions, deleter])).toEqual([
      'audit.purge_expired_events',
      'probe.deleter',
    ]);
    const unreserved = probe('unreserved', `BEGIN UPDATE audit.purge_runs pr SET completed = true; END`);
    const late = probe(
      'late',
      `BEGIN UPDATE audit.purge_runs pr SET completed = true;
         PERFORM 1 FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT; END`,
    );
    const conforming = probe(
      'conforming',
      `BEGIN PERFORM 1 FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
         UPDATE audit.purge_runs pr SET completed = true; END`,
    );
    expect(writesBeforeReservation([unreserved, late, conforming])).toEqual([
      'probe.late',
      'probe.unreserved',
    ]);
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
  const POSTS: FnClass = {
    class: 'identity',
    writes: [
      'ledger.journal_entries',
      'ledger.journal_lines',
      'ledger.balance_projection',
      'audit.audit_events',
    ],
  };

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
    // P8 review (R2): no exception for the posting core. ledger.post_entry waits for its projections, so after the
    // customer (category 16) it fails the order even when the caller already holds them; the …_locked core re-asserts
    // them NOWAIT and waits for nothing, whichever rows the caller holds (a row it does not hold is taken at once or
    // the command fails — savings.test.ts shows the failure is immediate)
    posts_waiting: {
      sql: `(p_ledger uuid, p_customer uuid, p_lines jsonb) RETURNS void LANGUAGE plpgsql AS $$ DECLARE v_accounts uuid[]; BEGIN
              v_accounts := ARRAY[p_customer];
              PERFORM ledger.lock_projections(NULL, v_accounts);
              PERFORM 1 FROM customers.customers c WHERE c.id = p_customer FOR SHARE;
              PERFORM ledger.post_entry(p_ledger, 'k', 'test', current_date, 'n', NULL, NULL, p_lines, NULL, NULL);
            END $$`,
      cls: POSTS,
    },
    posts_locked: {
      sql: `(p_ledger uuid, p_customer uuid, p_lines jsonb) RETURNS void LANGUAGE plpgsql AS $$ DECLARE v_accounts uuid[]; BEGIN
              v_accounts := ARRAY[p_customer];
              PERFORM ledger.lock_projections(NULL, v_accounts);
              PERFORM 1 FROM customers.customers c WHERE c.id = p_customer FOR SHARE;
              PERFORM ledger.post_entry_locked(p_ledger, 'k', 'test', current_date, 'n', NULL, NULL, p_lines, NULL, NULL);
            END $$`,
      cls: POSTS,
    },
    posts_locked_unheld: {
      sql: `(p_ledger uuid, p_customer uuid, p_lines jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
              PERFORM 1 FROM customers.customers c WHERE c.id = p_customer FOR SHARE;
              PERFORM ledger.post_entry_locked(p_ledger, 'k', 'test', current_date, 'n', NULL, NULL, p_lines, NULL, NULL);
            END $$`,
      cls: POSTS,
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
      sql: `() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM loans.no_such_function(NULL); END $$`,
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

  it('R2: the waiting posting core after the customer fails, held or not; the …_locked core waits for nothing', () => {
    expect(of('posts_waiting').map((f) => f.kind)).toEqual(['order']);
    expect(of('posts_locked'), report(of('posts_locked'))).toEqual([]);
    expect(run.footprints.get(`${s}.posts_locked`)).toEqual(['14:NKU', '16:S', '+15']);
    expect(of('posts_locked_unheld'), report(of('posts_locked_unheld'))).toEqual([]);
    expect(run.footprints.get(`${s}.posts_locked_unheld`)).toEqual(['16:S', '+15']);
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
