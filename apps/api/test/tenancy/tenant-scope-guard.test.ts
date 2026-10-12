import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { tenancyRepository } from '../../src/modules/tenancy/repository.js';

// ADR-15 T14 — no unscoped repository for tenant data — checked against the source. The tenant tables are read from
// the migrated database (every table under row-level security), so a new tenant table is covered without editing
// this test. In apps/api/src, such a table may be named only in a scoped repository (which reaches it through a
// TenantTx; test/tenancy/repository.test.ts proves each function refuses anything else) or in the audit log (which
// sets the tenant of the event itself). Setting app.merchant_id is equally confined.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

/** Scoped repositories: every function takes a TenantTx and calls scopeOf first. */
const SCOPED_REPOSITORIES: Record<string, object> = { 'modules/tenancy/repository.ts': tenancyRepository };
/** Writes tenant audit events inside a transaction that sets that event's tenant (AuditLog). */
const TENANT_SELF_SCOPING = ['modules/audit/audit-log.ts'];
/** The only places that set app.merchant_id. */
const SETS_TENANT = [
  'platform/tenant.ts', // withTenant
  'modules/audit/audit-log.ts', // a tenant event recorded on its own
  'modules/tenancy/merchant-lifecycle.ts', // platform action: audit row of the target merchant (P4.1)
  // Capability flow without a tenant session: the invitation-link acceptance's audit row, in the business just joined,
  // committed with the admission (P5.3a — atomic until P5.5's pattern-A function writes it in the database).
  'modules/tenancy/invitations.ts',
];

const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
let tenantTables: string[] = [];
beforeAll(async () => {
  await owner.connect();
  const { rows } = await owner.query<{ name: string }>(`
    SELECT n.nspname || '.' || c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND c.relrowsecurity
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     ORDER BY 1`);
  tenantTables = rows.map((r) => r.name);
});
afterAll(() => owner.end());

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const files = sourceFiles(SRC).map((full) => ({
  file: path.relative(SRC, full).split(path.sep).join('/'),
  text: fs.readFileSync(full, 'utf8'),
}));

/** `tenancy.branches`, `"tenancy"."branches"`, `tenancy."branches"` … as a whole name. */
const mentions = (text: string, table: string) => {
  const [schema, name] = table.split('.');
  return new RegExp(`(?<![\\w.])"?${schema}"?\\s*\\.\\s*"?${name}"?(?![\\w])`).test(text);
};

describe('tenant data only through scoped repositories (T14)', () => {
  it('finds the tenant tables (control)', () => {
    expect(tenantTables).toEqual(
      expect.arrayContaining([
        'tenancy.merchants',
        'tenancy.branches',
        'tenancy.roles',
        'tenancy.merchant_memberships',
        'ledger.journal_lines',
        'audit.audit_events',
      ]),
    );
  });

  it('no other source file names a tenant table', () => {
    const allowed = new Set([...Object.keys(SCOPED_REPOSITORIES), ...TENANT_SELF_SCOPING]);
    const offenders = files.flatMap(({ file, text }) =>
      allowed.has(file) ? [] : tenantTables.filter((t) => mentions(text, t)).map((t) => `${file}: ${t}`),
    );
    expect(offenders).toEqual([]);
  });

  it('a scoped repository reaches tenant tables only through functions that call scopeOf', () => {
    for (const [file, repository] of Object.entries(SCOPED_REPOSITORIES)) {
      const text = files.find((f) => f.file === file)!.text;
      // Each `async name(tx: TenantTx, …) { … }` body starts with scopeOf(tx); no other query handle exists.
      // \r?\n: a Windows checkout (core.autocrlf) has CRLF line endings; CI checks out LF.
      const functions = [...text.matchAll(/async (\w+)\(\s*tx: TenantTx[^)]*\)[^{]*\{\r?\n\s*(.*)/g)];
      expect(functions.map(([, name]) => name).sort(), file).toEqual(Object.keys(repository).sort());
      for (const [, name, firstLine] of functions)
        expect(firstLine, `${file}: ${name}`).toMatch(/scopeOf\(tx\)/);
      expect(text, file).not.toMatch(/\bdb\.(query|transaction)\b/);
    }
  });

  it('only withTenant, the audit log and the lifecycle service set app.merchant_id', () => {
    const setters = files.filter(({ text }) => text.includes(`'app.merchant_id'`)).map((f) => f.file);
    expect(setters.sort()).toEqual([...SETS_TENANT].sort());
  });

  it('the matcher recognises quoted and unquoted names, and not prefixes (control)', () => {
    expect(mentions('FROM tenancy.roles WHERE', 'tenancy.roles')).toBe(true);
    expect(mentions('FROM "tenancy"."roles"', 'tenancy.roles')).toBe(true);
    expect(mentions('FROM tenancy.roles_archive', 'tenancy.roles')).toBe(false);
    expect(mentions('identity.validate_session', 'tenancy.roles')).toBe(false);
  });
});
