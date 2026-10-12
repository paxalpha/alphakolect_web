import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { AuditLog } from '../../src/modules/audit/audit-log.js';
import { AUDIT_CATALOG, catalogEntry, TRANSITIONAL_PAIRS } from '../../src/modules/audit/catalog.js';

// The writer guard and the coverage guard (P5.3a; P5 plan §8.1). Every audit writer in the code is found — TypeScript
// call sites of the three entry points, resolved through the compiler to the exact (identifier, outcome) pairs they
// can write, and SQL inserts into the activity record, resolved by their literals — and each is accepted only if the
// pair's class and writer pattern match the writer: mutateAudited only pattern-B atomic pairs, recordBestEffort only
// best-effort pairs, recordWithin only the transitional list (at its listed files), SQL only pattern-A atomic pairs.
// The coverage guard then compares the catalog with the plan's inventory in both directions and requires exactly one
// writer per atomic pair; coverage.test.ts proves each atomic pair commits with its change and rolls back with it.

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
beforeAll(() => owner.connect());
afterAll(() => owner.end());

/**
 * The plan's §8.1 inventory of every pair that exists at this point (P5.3a), with each atomic pair's one writer.
 * Each later package adds its pairs here together with its writer and its coverage tests.
 */
const INVENTORY: Record<string, { class: 'atomic' | 'best_effort'; pattern?: 'A' | 'B'; writer?: string }> = {
  'auth.signup/success': { class: 'atomic', pattern: 'B', writer: 'AccountService.signup' },
  'auth.email_verify/success': { class: 'atomic', pattern: 'B', writer: 'AccountService.verifyEmail' },
  'auth.login/success': { class: 'atomic', pattern: 'B', writer: 'SessionService.login' },
  'auth.login_select/success': { class: 'atomic', pattern: 'B', writer: 'SessionService.selectMembership' },
  'auth.refresh/success': { class: 'atomic', pattern: 'B', writer: 'SessionService.refresh' },
  'auth.refresh_token_reuse/denied': { class: 'atomic', pattern: 'B', writer: 'SessionService.refresh' },
  'auth.logout/success': { class: 'atomic', pattern: 'B', writer: 'SessionService.logout' },
  'auth.password_change/success': { class: 'atomic', pattern: 'B', writer: 'PasswordService.change' },
  'auth.password_reset/success': { class: 'atomic', pattern: 'B', writer: 'PasswordService.useLink' },
  'auth.account_setup/success': { class: 'atomic', pattern: 'B', writer: 'PasswordService.useLink' },
  'auth.mfa_enrollment_started/success': {
    class: 'atomic',
    pattern: 'B',
    writer: 'MfaService.beginEnrollment',
  },
  'auth.mfa_enrollment_confirmed/success': {
    class: 'atomic',
    pattern: 'B',
    writer: 'MfaService.confirmEnrollment',
  },
  'auth.mfa_verify/success': { class: 'atomic', pattern: 'B', writer: 'MfaService.verifyChallenge' },
  'auth.invitation_accepted/success': { class: 'atomic', pattern: 'A', writer: 'InvitationService.accept' },
  'platform.super_admin_bootstrapped/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'identity.bootstrap_super_admin',
  },
  'merchant.profile_updated/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'MerchantSettingsService.rename',
  },
  'merchant.branch_created/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'MerchantSettingsService.create',
  },
  'merchant.branch_updated/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'MerchantSettingsService.update',
  },
  'merchant.role_created/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'MerchantSettingsService.create',
  },
  'merchant.role_updated/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'MerchantSettingsService.update',
  },
  'merchant.member_assigned/success': { class: 'atomic', pattern: 'A', writer: 'MembershipService.change' },
  'merchant.member_deactivated/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'MembershipService.change',
  },
  'merchant.member_reactivated/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'MembershipService.change',
  },
  'merchant.invitation_issued/success': { class: 'atomic', pattern: 'A', writer: 'InvitationService.create' },
  'merchant.invitation_revoked/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'InvitationService.revoke',
  },
  'platform.merchant_deactivated/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'MerchantLifecycleService.change',
  },
  'platform.merchant_reactivated/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'MerchantLifecycleService.change',
  },
  'platform.ownership_transferred/success': {
    class: 'atomic',
    pattern: 'A',
    writer: 'MerchantLifecycleService.transferOwnership',
  },
  ...Object.fromEntries(
    [
      ...[
        'auth.signup',
        'auth.email_verify',
        'auth.login',
        'auth.login_select',
        'auth.refresh',
        'auth.password_change',
      ].map((i) => `${i}/failure`),
      ...[
        'auth.password_reset',
        'auth.account_setup',
        'auth.mfa_enrollment_confirmed',
        'auth.mfa_verify',
        'auth.invitation_accepted',
      ].map((i) => `${i}/failure`),
      // O6: the link-issuing requests, success and failure
      'auth.password_forgot/success',
      'auth.password_forgot/failure',
      'auth.verification_resend/success',
      'auth.verification_resend/failure',
      ...['profile_updated', 'branch_created', 'branch_updated', 'role_created', 'role_updated'].map(
        (i) => `merchant.${i}/denied`,
      ),
      ...[
        'member_assigned',
        'member_deactivated',
        'member_reactivated',
        'invitation_issued',
        'invitation_revoked',
      ].flatMap((i) => [`merchant.${i}/denied`, `merchant.${i}/failure`]),
      ...['merchant_deactivated', 'merchant_reactivated', 'ownership_transferred'].flatMap((i) => [
        `platform.${i}/denied`,
        `platform.${i}/failure`,
      ]),
    ].map((pair) => [pair, { class: 'best_effort' as const }]),
  ),
};

const ENTRY_POINTS = ['mutateAudited', 'recordBestEffort', 'recordWithin'] as const;
type EntryPoint = (typeof ENTRY_POINTS)[number];
/** Where the transitional writers live (§10 P5.3a); P5.5 empties the list. */
const TRANSITIONAL_FILES = [
  'src/modules/tenancy/invitations.ts',
  'src/modules/tenancy/memberships.ts',
  'src/modules/tenancy/merchant-lifecycle.ts',
  'src/modules/tenancy/merchant-settings.ts',
];

type Site = { writer: EntryPoint | 'sql'; where: string; file: string; pairs: string[] | null };

/** The one place that decides whether a writer may write its pairs (used by the real guard and its mutation tests). */
function problemsOf(site: Site): string[] {
  if (site.pairs === null)
    return [`${site.where}: the identifier or outcome is not a literal the guard can resolve`];
  return site.pairs.flatMap((pair) => {
    const [identifier, outcome] = pair.split('/') as [string, string];
    const entry = catalogEntry(identifier, outcome);
    const accepted =
      site.writer === 'mutateAudited'
        ? entry?.class === 'atomic' && entry.pattern === 'B'
        : site.writer === 'recordBestEffort'
          ? entry?.class === 'best_effort'
          : site.writer === 'recordWithin'
            ? entry?.class === 'atomic' &&
              entry.pattern === 'A' &&
              (TRANSITIONAL_PAIRS as readonly string[]).includes(pair) &&
              TRANSITIONAL_FILES.includes(site.file)
            : entry?.class === 'atomic' &&
              entry.pattern === 'A' &&
              !(TRANSITIONAL_PAIRS as readonly string[]).includes(pair);
    return accepted ? [] : [`${site.where}: ${site.writer} may not write ${pair}`];
  });
}

// ── TypeScript writers, resolved through the compiler ──────────────────────────────────────────────
/** Problems no type can show: an identifier or outcome asserted into a literal type (a cast can lie). */
const assertionProblems: string[] = [];
const OUTCOMES = new Set(['success', 'failure', 'denied']);
const isConst = (node: ts.AsExpression | ts.TypeAssertion) =>
  ts.isTypeReferenceNode(node.type) && node.type.typeName.getText() === 'const';

function typescriptSites(): Site[] {
  const configPath = path.join(apiRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, apiRoot);
  const sources = parsed.fileNames.filter((f) =>
    path.relative(apiRoot, f).replace(/\\/g, '/').startsWith('src/'),
  );
  const program = ts.createProgram(sources, parsed.options);
  const checker = program.getTypeChecker();

  const literals = (type: ts.Type): string[] | null => {
    const parts = type.isUnion() ? type.types : [type];
    const values = parts.map((t) => (t.isStringLiteral() ? t.value : null));
    return values.includes(null) ? null : (values as string[]);
  };
  const pairsOf = (type: ts.Type, at: ts.Node): string[] | null => {
    const out: string[] = [];
    for (const member of type.isUnion() ? type.types : [type]) {
      const prop = (name: string) => {
        const symbol = checker.getPropertyOfType(member, name);
        return symbol ? literals(checker.getTypeOfSymbolAtLocation(symbol, at)) : null;
      };
      const actions = prop('action');
      const outcomes = prop('outcome');
      if (!actions || !outcomes) return null;
      for (const a of actions) for (const o of outcomes) out.push(`${a}/${o}`);
    }
    return [...new Set(out)];
  };
  const enclosing = (node: ts.Node): string => {
    for (let n: ts.Node | undefined = node; n; n = n.parent) {
      if (ts.isMethodDeclaration(n) && ts.isClassDeclaration(n.parent))
        return `${n.parent.name?.text}.${n.name.getText()}`;
      if (ts.isFunctionDeclaration(n)) return n.name?.text ?? '<anonymous>';
    }
    return '<module>';
  };

  const sites: Site[] = [];
  for (const sf of program.getSourceFiles().filter((s) => sources.includes(s.fileName))) {
    const file = path.relative(apiRoot, sf.fileName).replace(/\\/g, '/');
    const visit = (node: ts.Node) => {
      // Anywhere in the source: never assert an audit identifier or outcome into a literal type.
      if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && !isConst(node)) {
        const literalTypes = ts.isUnionTypeNode(node.type) ? node.type.types : [node.type];
        const named = literalTypes.some(
          (t) =>
            ts.isLiteralTypeNode(t) &&
            ts.isStringLiteral(t.literal) &&
            (IDENTIFIERS.has(t.literal.text) || OUTCOMES.has(t.literal.text)),
        );
        if (named)
          assertionProblems.push(
            `${file}: ${node.getText()} — an audit identifier or outcome is never asserted`,
          );
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text as EntryPoint;
        const receiver = checker.typeToString(checker.getTypeAtLocation(node.expression.expression));
        if (ENTRY_POINTS.includes(name) && receiver.includes('AuditLog')) {
          const arg = node.arguments[name === 'recordBestEffort' ? 0 : 1];
          // Inside the event argument: no assertion but `as const` (the guard must see the real types).
          const scan = (n: ts.Node) => {
            if ((ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) && !isConst(n)) {
              assertionProblems.push(
                `${file} ${enclosing(node)}: ${n.getText()} — a type assertion in an audit event`,
              );
            }
            ts.forEachChild(n, scan);
          };
          if (arg) scan(arg);
          sites.push({
            writer: name,
            file,
            where: `${file} ${enclosing(node)}`,
            pairs: arg ? pairsOf(checker.getTypeAtLocation(arg), arg) : null,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sites;
}

// ── SQL writers, resolved by their literals ───────────────────────────────────────────────────────
const IDENTIFIERS: ReadonlySet<string> = new Set(AUDIT_CATALOG.map((e) => e.identifier));
async function sqlSites(
  schemaFilter = `n.nspname NOT IN ('pg_catalog', 'information_schema')`,
): Promise<Site[]> {
  const { rows } = await owner.query<{ fn: string; src: string }>(
    `SELECT n.nspname || '.' || p.proname AS fn, p.prosrc AS src
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ${schemaFilter} AND p.prosrc ~* 'insert\\s+into\\s+"?audit"?\\s*\\.\\s*"?audit_events'`,
  );
  return rows.map((r) => {
    const statements = r.src
      .split(/(?=insert\s+into)/i)
      .filter((s) => /^insert\s+into\s+"?audit"?\s*\.\s*"?audit_events/i.test(s));
    const pairs = statements.map((s) => {
      const quoted = [...s.split(';')[0]!.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]!);
      const action = quoted.find(
        (q) => q.includes('.') && /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/.test(q) && IDENTIFIERS.has(q),
      );
      const outcome = quoted.find((q) => ['success', 'failure', 'denied'].includes(q));
      return action && outcome ? `${action}/${outcome}` : null;
    });
    return {
      writer: 'sql',
      file: r.fn,
      where: r.fn,
      pairs: pairs.includes(null) ? null : (pairs as string[]),
    };
  });
}

describe('the writer guard', () => {
  let sites: Site[];
  beforeAll(async () => {
    sites = [...typescriptSites(), ...(await sqlSites())];
  }, 120_000);

  it('finds the writers (sanity: the guard is looking at the real code)', () => {
    const writers = new Set(sites.map((s) => s.writer));
    expect(writers).toEqual(new Set(['mutateAudited', 'recordBestEffort', 'recordWithin', 'sql']));
    expect(sites.length).toBeGreaterThan(40);
  });

  it('every writer writes only pairs of its own class — resolved to literals, nothing template-built outside the list', () => {
    expect(sites.flatMap(problemsOf)).toEqual([]);
  });

  it('no audit identifier or outcome is asserted into existence — only `as const`', () => {
    expect(assertionProblems).toEqual([]);
  });

  it('no TypeScript code other than the audit log inserts into the activity record', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          entry.name.endsWith('.ts') &&
          /insert\s+into\s+audit\.audit_events/i.test(readFileSync(full, 'utf8'))
        ) {
          offenders.push(path.relative(apiRoot, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(path.join(apiRoot, 'src'));
    expect(offenders).toEqual(['src/modules/audit/audit-log.ts']);
  });

  describe('the coverage guard', () => {
    it('the catalog equals the inventory, in both directions, class and pattern included', async () => {
      const { rows } = await owner.query(
        `SELECT identifier || '/' || outcome AS pair, class, writer_pattern FROM audit.event_catalog WHERE status = 'active'`,
      );
      const catalog = Object.fromEntries(
        rows.map((r) => [
          r.pair,
          { class: r.class, ...(r.writer_pattern ? { pattern: r.writer_pattern } : {}) },
        ]),
      );
      const inventory = Object.fromEntries(
        Object.entries(INVENTORY).map(([pair, e]) => [
          pair,
          { class: e.class, ...(e.pattern ? { pattern: e.pattern } : {}) },
        ]),
      );
      expect(catalog).toEqual(inventory);
    });

    it('every atomic pair has exactly one writer, the one the inventory names', () => {
      const writersOf = new Map<string, Set<string>>();
      for (const site of sites) {
        for (const pair of site.pairs ?? []) {
          if (catalogEntry(...(pair.split('/') as [string, string]))?.class !== 'atomic') continue;
          const writer = site.writer === 'sql' ? site.where : site.where.split(' ')[1]!;
          writersOf.set(pair, (writersOf.get(pair) ?? new Set()).add(writer));
        }
      }
      const atomic = Object.entries(INVENTORY).filter(([, e]) => e.class === 'atomic');
      expect(Object.fromEntries([...writersOf].map(([pair, w]) => [pair, [...w]]))).toEqual(
        Object.fromEntries(atomic.map(([pair, e]) => [pair, [e.writer]])),
      );
    });
  });

  // §8.1 writer-guard mutation tests.
  describe('mutations', () => {
    const site = (
      writer: Site['writer'],
      pairs: string[],
      file = 'src/modules/identity/sessions.ts',
    ): Site => ({
      writer,
      file,
      where: `${file} Mutation.probe`,
      pairs,
    });

    it('(1) best-effort calls for identifiers whose success is atomic are accepted', () => {
      expect(
        problemsOf(site('recordBestEffort', ['auth.signup/failure', 'merchant.member_assigned/denied'])),
      ).toEqual([]);
    });

    it('(2) an atomic success through the wrong writer is rejected', async () => {
      expect(problemsOf(site('recordBestEffort', ['auth.signup/success']))).toHaveLength(1);
      expect(problemsOf(site('mutateAudited', ['merchant.member_assigned/success']))).toHaveLength(1);
      expect(
        problemsOf(
          site('recordWithin', ['merchant.member_assigned/success'], 'src/modules/identity/sessions.ts'),
        ),
      ).toHaveLength(1);
      // …and auth.password_change/success written in SQL, found in a scratch schema by the real SQL scan.
      const schema = `test_writer_guard_${randomBytes(4).toString('hex')}`;
      await owner.query(`CREATE SCHEMA ${schema}`);
      try {
        await owner.query(
          `CREATE FUNCTION ${schema}.change_password_in_sql() RETURNS void LANGUAGE sql AS $fn$
             INSERT INTO audit.audit_events (action, outcome) VALUES ('auth.password_change', 'success');
           $fn$`,
        );
        const found = await sqlSites(`n.nspname = '${schema}'`);
        expect(found.map((s) => s.pairs)).toEqual([['auth.password_change/success']]);
        expect(found.flatMap(problemsOf)).toHaveLength(1);
      } finally {
        await owner.query(`DROP SCHEMA ${schema} CASCADE`);
      }
    });

    it('(3) a downgrade is rejected at run time by the guard and at build time by the types', () => {
      expect(
        problemsOf(site('recordBestEffort', ['auth.password_change/success', 'auth.logout/success'])),
      ).toHaveLength(2);
      // Never called: the compiler refuses these lines unless the types forbid them (pnpm typecheck runs over tests).
      const _compileTimeOnly = (audit: AuditLog) => {
        // @ts-expect-error — an atomic event can never go through the best-effort writer
        void audit.recordBestEffort({ action: 'auth.signup', outcome: 'success' });
        // @ts-expect-error — nor a best-effort one through mutateAudited
        void audit.mutateAudited(null as never, { action: 'auth.login', outcome: 'failure' });
        // @ts-expect-error — nor a pattern-A pair through mutateAudited
        void audit.mutateAudited(null as never, { action: 'merchant.member_assigned', outcome: 'success' });
      };
      expect(typeof _compileTimeOnly).toBe('function');
    });

    it('an unresolvable identifier (a plain string) is rejected', () => {
      expect(problemsOf({ writer: 'recordBestEffort', file: 'x', where: 'x', pairs: null })).toHaveLength(1);
    });
  });
});
