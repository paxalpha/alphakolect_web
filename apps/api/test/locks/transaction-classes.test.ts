import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, loadCatalog, type Catalog, type FnClass, type FnRow } from '@alphakolect/db/lock-analysis';
import { CLASSES, NESTED_WRITERS, SENSITIVE_READS } from '@alphakolect/db/lock-plan';
import pg from 'pg';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { catalogEntry } from '../../src/modules/audit/catalog.js';
import {
  classify,
  repositoryTransactions,
  unreachableNestedWriters,
  type ClassRules,
  type RepoTransaction,
} from '../support/transaction-classes.js';

// The lock-order guard's repository-transaction classes (P5.5 step 1; P5 plan §7.2 R17, R22, R27). Every
// `db.transaction` / `withTenant` body in apps/api/src is followed through everything it calls with the transaction
// (test/support/transaction-classes.ts) and must match exactly one class: T1 privileged write (one planned
// operation), T2 pattern-B audited write (identity definer calls and mutateAudited for pattern-B pairs; nested
// pattern-A inserts only as the nested-writer table lists), T3 read-only, T4 sensitive read (one call of one designated
// read function, from P5.7), T5 best-effort audit (one insert into the activity record). A class is decided on the complete call graph:
// a definer the SQL guard finds reaching an unapproved write cannot anchor one (R22).
//
// Enforcing mode (R34, since P5.5 step 7): every transaction must be classified and every nested-writer entry
// reachable — nothing is tolerated (the lock-order guard fails if a tolerated list is exported again).

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMAS = ['identity', 'tenancy', 'audit', 'util', 'ledger'];
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
let catalog: Catalog;
let rules: ClassRules;

const pairOf: ClassRules['pairOf'] = (pair) => {
  const [identifier, outcome] = pair.split('/') as [string, string];
  const e = catalogEntry(identifier, outcome);
  return e ? { class: e.class, pattern: e.pattern } : undefined;
};
function rulesFor(c: Catalog, classes: Readonly<Record<string, FnClass>>, schemas: string[]): ClassRules {
  const analysis = analyse(c, classes, schemas);
  return {
    classes,
    reachableWrites: analysis.reachableWrites,
    unapproved: new Set(
      analysis.findings.filter((f) => f.detail.startsWith('an unapproved write')).map((f) => f.fn),
    ),
    nestedWriters: NESTED_WRITERS,
    pairOf,
    sensitiveReads: new Set(Object.values(SENSITIVE_READS)),
  };
}

/** The API's program (src/), plus virtual files given as path → text. */
function program(extra: Record<string, string> = {}) {
  const config = ts.readConfigFile(path.join(apiRoot, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, apiRoot);
  const sources = parsed.fileNames.filter((f) =>
    path.relative(apiRoot, f).replace(/\\/g, '/').startsWith('src/'),
  );
  const virtual = new Map(Object.entries(extra).map(([f, text]) => [path.resolve(f), text]));
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, language) => {
    const text = virtual.get(path.resolve(fileName));
    return text !== undefined
      ? ts.createSourceFile(fileName, text, language, true)
      : getSourceFile(fileName, language);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (f) => virtual.has(path.resolve(f)) || fileExists(f);
  const roots = [...sources, ...Object.keys(extra).map((f) => f.replace(/\\/g, '/'))];
  return { program: ts.createProgram(roots, parsed.options, host), sources };
}

beforeAll(async () => {
  await owner.connect();
  catalog = await loadCatalog(owner, SCHEMAS);
  rules = rulesFor(catalog, CLASSES, SCHEMAS);
}, 120_000);
afterAll(() => owner.end());

describe('enforcing mode (R34, R17): every repository transaction matches exactly one class', () => {
  let transactions: RepoTransaction[];
  beforeAll(() => {
    const { program: p, sources } = program();
    transactions = repositoryTransactions(p, sources, apiRoot);
  }, 120_000);

  it('finds the transactions (sanity: it is looking at the real code), each fully resolved', () => {
    expect(transactions.length).toBeGreaterThanOrEqual(31);
    expect(transactions.flatMap((t) => t.unresolved)).toEqual([]);
    // A function-typed parameter resolved at its call sites: one variant each.
    expect(transactions.map((t) => t.name)).toEqual(
      expect.arrayContaining(['PasswordService.reset', 'PasswordService.completeSetup']),
    );
  });

  it('every transaction is classified', () => {
    const unclassified = transactions.map((t) => classify(t, rules)).filter((r) => r.cls === null);
    expect(unclassified.map((r) => `${r.tx.name} (${r.tx.at}): ${r.problems.join('; ')}`)).toEqual([]);
  });

  it('the classes, as found', () => {
    const byClass = (cls: string) =>
      transactions
        .map((t) => classify(t, rules))
        .filter((r) => r.cls === cls)
        .map((r) => r.tx.name)
        .sort();
    expect(byClass('T5')).toEqual(['AuditLog.recordBestEffort']);
    expect(byClass('T3')).toContain('MembershipService.list');
    expect(byClass('T3')).toContain('PlatformStaffService.list');
    // P5.7: the platform team's view of the businesses, and P5.8: the activity record — each page one call of its
    // designated read function
    expect(byClass('T4')).toEqual([
      'AuditReadService.merchant',
      'AuditReadService.platform',
      'PlatformMerchantListService.members',
      'PlatformMerchantListService.merchants',
    ]);
    expect(byClass('T2')).toEqual(
      expect.arrayContaining(['PasswordService.completeSetup', 'SessionService.refresh']),
    );
    // P5.5 steps 3–5: the privileged functions write their own audit rows; their transactions are one operation each
    // (the branch-or-role writes: one of a constant map's two functions; acceptance: admission records #14).
    expect(byClass('T1')).toEqual([
      'InvitationService.accept',
      'InvitationService.create',
      'InvitationService.revoke',
      // P6: the ledger's commands — each one call of its planned operation (the account read back after creation)
      'LedgerService.createAccount',
      'LedgerService.postEntry',
      'LedgerService.reverseEntry',
      'LedgerService.updateAccount',
      'MembershipService.change',
      'MerchantLifecycleService.change',
      'MerchantLifecycleService.transferOwnership',
      'MerchantSettingsService.create',
      'MerchantSettingsService.rename',
      'MerchantSettingsService.setRolePermissions',
      'MerchantSettingsService.update',
      'PlatformStaffService.create',
      'PlatformStaffService.setPermissions',
      'PlatformStaffService.setStatus',
    ]);
  });

  it('R27: every nested-writer entry is reachable from its flow', () => {
    expect(unreachableNestedWriters(transactions, rules)).toEqual([]);
  });
});

describe('self-tests: each kind of violation fails the classification, the controls pass (R17, R22, R27)', () => {
  const s = `txguard_${randomBytes(4).toString('hex')}`;
  const probePath = path.join(apiRoot, 'test/locks/__probe__.ts').replace(/\\/g, '/');
  const probe = `
    import type { AuditLog } from '../../src/modules/audit/audit-log.js';
    import type { IdentityRepository } from '../../src/modules/identity/repository.js';
    import type { Db } from '../../src/platform/db.js';
    const WRITER = { members: 'tenancy.update_membership', invitations: 'tenancy.revoke_invitation' };
    const BOTH = {
      members: 'tenancy.update_membership($1, 1), tenancy.revoke_invitation($1, 1)',
      invitations: 'tenancy.revoke_invitation($1, 1)',
    };
    export class Probe {
      constructor(private readonly db: Db, private readonly identity: IdentityRepository, private readonly audit: AuditLog) {}
      async validB(id: string) {
        await this.db.transaction(async (tx) => {
          await this.identity.within(tx).changePassword(id, 'h');
          await this.audit.mutateAudited(tx, { action: 'auth.password_change', outcome: 'success', summary: { sessionsRevoked: true } });
        });
      }
      async validT1(session: string, invitation: string) {
        await this.db.transaction(async (tx) => {
          await tx.query(\`SELECT outcome FROM tenancy.revoke_invitation($1, $2)\`, [session, invitation]);
        });
      }
      async eitherOperation(session: string, kind: 'members' | 'invitations') {
        await this.db.transaction(async (tx) => {
          await tx.query(\`SELECT outcome FROM \${WRITER[kind]}($1, 'x')\`, [session]);
        });
      }
      async twoOperations(session: string, invitation: string) {
        await this.db.transaction(async (tx) => {
          await tx.query(\`SELECT outcome FROM tenancy.revoke_invitation($1, $2)\`, [session, invitation]);
          await tx.query(\`SELECT outcome FROM tenancy.update_membership($1, 'x')\`, [session]);
        });
      }
      async bothInOneAlternative(session: string, kind: 'members' | 'invitations') {
        await this.db.transaction(async (tx) => {
          await tx.query(\`SELECT \${BOTH[kind]}\`, [session]);
        });
      }
      async validT3(email: string) {
        await this.db.transaction(async (tx) => {
          await this.identity.within(tx).loginIdentity(email);
        });
      }
      async validT5() {
        await this.db.transaction(async (tx) => {
          await tx.query(\`INSERT INTO audit.audit_events (action, outcome) VALUES ('auth.login', 'failure')\`);
        });
      }
      async unknownFunction() {
        await this.db.transaction(async (tx) => {
          await tx.query(\`SELECT ghost.fn($1)\`, [1]);
        });
      }
      async directBranchUpdate() {
        await this.db.transaction(async (tx) => {
          await tx.query(\`UPDATE tenancy.branches SET name = name\`);
        });
      }
      async patternAThroughB(id: string) {
        await this.db.transaction(async (tx) => {
          await this.identity.within(tx).changePassword(id, 'h');
          await this.audit.mutateAudited(tx, { action: 'merchant.branch_created', outcome: 'success', summary: { name: 'x' } });
        });
      }
      async readWithHiddenUpdate(email: string) {
        await this.db.transaction(async (tx) => {
          await this.identity.within(tx).loginIdentity(email);
          await tx.query(\`UPDATE identity.identities SET status = status\`);
        });
      }
      async readWithHiddenLock(email: string) {
        await this.db.transaction(async (tx) => {
          await this.identity.within(tx).loginIdentity(email);
          await tx.query(\`SELECT 1 FROM tenancy.merchants m FOR SHARE\`);
        });
      }
      async bestEffortPlusOne(session: string) {
        await this.db.transaction(async (tx) => {
          await tx.query(\`INSERT INTO audit.audit_events (action, outcome) VALUES ('auth.login', 'failure')\`);
          await tx.query(\`SELECT identity.revoke_session($1, 'probe')\`, [session]);
        });
      }
      async sensitiveRead(id: string) {
        await this.db.transaction(async (tx) => {
          await this.identity.within(tx).changePassword(id, 'h');
          await this.audit.mutateAudited(tx, { action: 'auth.logout', outcome: 'success' });
        });
      }
      async privilegedR22(id: string) {
        await this.db.transaction(async (tx) => {
          await tx.query(\`SELECT ${s}.op($1)\`, [id]);
        });
      }
      async patternBR22(id: string) {
        await this.db.transaction(async (tx) => {
          await tx.query(\`SELECT ${s}.flow_def($1)\`, [id]);
          await this.audit.mutateAudited(tx, { action: 'auth.password_change', outcome: 'success', summary: { sessionsRevoked: true } });
        });
      }
      async nestedAudit(id: string) {
        await this.db.transaction(async (tx) => {
          await tx.query(\`SELECT ${s}.flow_audit($1)\`, [id]);
          await this.audit.mutateAudited(tx, { action: 'auth.password_change', outcome: 'success', summary: { sessionsRevoked: true } });
        });
      }
    }`;
  /** Scratch definer functions, analysed exactly as the catalog's (pg_get_functiondef form), never installed. */
  const scratchFn = (name: string, body: string): FnRow => ({
    schema: s,
    name,
    args: 'p uuid',
    lang: 'plpgsql',
    definer: true,
    executors: [],
    def: `CREATE OR REPLACE FUNCTION ${s}.${name}(p uuid)\n RETURNS void\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n${body}\nEND\n$function$\n`,
  });
  const scratch: Record<string, { fn: FnRow; cls: FnClass }> = {
    op: {
      fn: scratchFn(
        'op',
        `UPDATE tenancy.invitations i SET revoked_at = now() WHERE i.id = p; PERFORM ${s}.sneaky(p);`,
      ),
      cls: { class: 'operation', planned: [], writes: ['tenancy.invitations'] },
    },
    flow_def: {
      fn: scratchFn('flow_def', `PERFORM ${s}.sneaky(p);`),
      cls: { class: 'identity', writes: [] },
    },
    flow_audit: {
      fn: scratchFn(
        'flow_audit',
        `INSERT INTO audit.audit_events (action, outcome) VALUES ('merchant.branch_created', 'success');`,
      ),
      cls: { class: 'identity', writes: ['audit.audit_events'] },
    },
    sneaky: {
      fn: scratchFn('sneaky', `UPDATE tenancy.roles r SET name = r.name WHERE r.id = p;`),
      cls: { class: 'identity', writes: ['tenancy.roles'] },
    },
  };
  let results: Map<string, ReturnType<typeof classify>>;
  let probeTxs: RepoTransaction[];
  let probeRules: ClassRules;

  beforeAll(() => {
    const classes: Record<string, FnClass> = { ...CLASSES };
    for (const [name, { cls }] of Object.entries(scratch)) classes[`${s}.${name}`] = cls;
    probeRules = rulesFor(
      { ...catalog, functions: [...catalog.functions, ...Object.values(scratch).map((x) => x.fn)] },
      classes,
      [...SCHEMAS, s],
    );
    const { program: p } = program({ [probePath]: probe });
    probeTxs = repositoryTransactions(p, [probePath], apiRoot);
    results = new Map(probeTxs.map((t) => [t.name.replace(/^Probe\./, ''), classify(t, probeRules)]));
  }, 120_000);
  const problems = (name: string) => results.get(name)!.problems.join('; ');

  it('controls: a valid pattern-B, privileged, read-only and best-effort transaction each get their class', () => {
    expect(results.get('validB')!.cls, problems('validB')).toBe('T2');
    expect(results.get('validT1')!.cls, problems('validT1')).toBe('T1');
    expect(results.get('validT3')!.cls, problems('validT3')).toBe('T3');
    expect(results.get('validT5')!.cls, problems('validT5')).toBe('T5');
  });

  it('one privileged operation, counted per statement: a constant map’s alternatives are one, two statements two', () => {
    expect(results.get('eitherOperation')!.cls, problems('eitherOperation')).toBe('T1');
    expect(results.get('twoOperations')!.cls).toBeNull();
    expect(problems('twoOperations')).toContain('matches no class');
    // An alternative that calls two operations is two, whatever the other alternatives call.
    expect(results.get('bothInOneAlternative')!.cls).toBeNull();
  });

  it('a call of a function the guard does not know fails — never passes as read-only', () => {
    expect(results.get('unknownFunction')!.cls).toBeNull();
    expect(problems('unknownFunction')).toContain('ghost.fn is not a classified function');
  });

  it('a direct UPDATE of tenancy.branches fails', () => {
    expect(results.get('directBranchUpdate')!.cls).toBeNull();
    expect(problems('directBranchUpdate')).toContain('writes tenancy.branches directly');
  });

  it('mutateAudited with a pattern-A pair fails', () => {
    expect(results.get('patternAThroughB')!.cls).toBeNull();
    expect(problems('patternAThroughB')).toContain('not pattern-B atomic: merchant.branch_created/success');
  });

  it('a read-only transaction with a hidden UPDATE or a hidden locking clause fails', () => {
    expect(results.get('readWithHiddenUpdate')!.cls).toBeNull();
    expect(problems('readWithHiddenUpdate')).toContain('writes identity.identities directly');
    expect(results.get('readWithHiddenLock')!.cls).toBeNull();
    expect(problems('readWithHiddenLock')).toContain('takes a locking clause');
  });

  it('a best-effort transaction with a second statement fails', () => {
    expect(results.get('bestEffortPlusOne')!.cls).toBeNull();
  });

  it('a TypeScript insert of a sensitive-read pair fails', () => {
    const marked: ClassRules = {
      ...probeRules,
      pairOf: (pair) =>
        pair === 'auth.logout/success' ? { class: 'sensitive_read', pattern: 'A' } : pairOf(pair),
    };
    const tx = probeTxs.find((t) => t.name === 'Probe.sensitiveRead')!;
    const r = classify(tx, marked);
    expect(r.cls).toBeNull();
    expect(r.problems.join('; ')).toContain('auth.logout/success is a sensitive read');
  });

  it('R22: a T1 and a T2 transaction whose definer reaches an unapproved write through a nested call fail', () => {
    expect(results.get('privilegedR22')!.cls).toBeNull();
    expect(problems('privilegedR22')).toContain(`${s}.op reaches an unapproved write (R22)`);
    expect(results.get('patternBR22')!.cls).toBeNull();
    expect(problems('patternBR22')).toContain(`${s}.flow_def reaches an unapproved write (R22)`);
  });

  it('R27: a T2 flow whose definer writes a pattern-A pair the nested-writer table does not list fails', () => {
    expect(results.get('nestedAudit')!.cls).toBeNull();
    expect(problems('nestedAudit')).toContain(`a nested audit insert by ${s}.flow_audit`);
  });

  it('R27: a nested-writer entry whose function is not reachable from its flow fails', () => {
    const withEntry: ClassRules = {
      ...probeRules,
      nestedWriters: [
        ...NESTED_WRITERS,
        { flow: 'Probe.validB', fn: `${s}.never_called`, pair: 'auth.password_change/success' },
      ],
    };
    expect(unreachableNestedWriters(probeTxs, withEntry)).toEqual(
      expect.arrayContaining([expect.stringContaining(`Probe.validB → ${s}.never_called`)]),
    );
  });
});
