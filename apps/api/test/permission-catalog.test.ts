import { PERMISSIONS } from '@alphakolect/contracts';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { refusalMessage } from '../src/platform/authorization.js';

// P5 plan §4 invariant 1 (ADR-16): the database catalog is the only authority for permissions; the contracts package
// lists the same identifiers for typing only. This compares the two on every run against the fully migrated database,
// so a permission added, renamed or retired on one side alone fails here. The catalog has no app grant (B1), so it is
// read as the table owner.

const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
beforeAll(() => owner.connect());
afterAll(() => owner.end());

describe('contracts PERMISSIONS = the catalog', () => {
  it('lists exactly the catalog’s active permission identifiers', async () => {
    const { rows } = await owner.query<{ identifier: string }>(
      `SELECT identifier FROM identity.permission_catalog WHERE status = 'active'`,
    );
    expect(rows.map((r) => r.identifier).sort()).toEqual([...PERMISSIONS].sort());
  });

  it('lists each identifier once', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });
});

// The refusal wording follows the catalog's grantable flag (the owner's answers R1–R4, 2026-10-14): a permission that
// can be given says whom to ask — the business owner for a merchant permission, a super admin for a platform one; a
// reserved one says who alone may act. A permission whose flag changes on one side alone fails here.
describe('each refusal message = the catalog’s grantable flag', () => {
  it('a grantable permission says whom to ask; a reserved one says who alone may act', async () => {
    const { rows } = await owner.query<{ identifier: string; scope: string; grantable: boolean }>(
      `SELECT identifier, scope, grantable FROM identity.permission_catalog WHERE status = 'active'`,
    );
    expect(rows.length).toBe(PERMISSIONS.length);
    for (const r of rows) {
      const message = refusalMessage(r.identifier as (typeof PERMISSIONS)[number]);
      const whom = r.scope === 'merchant' ? 'the business owner' : 'a super admin';
      if (r.grantable) {
        expect(message, r.identifier).toBe(
          `You don't have permission to do this. Ask ${whom} if you need it.`,
        );
      } else {
        expect(message, r.identifier).toMatch(
          r.scope === 'merchant' ? /^Only the business owner / : /^Only a platform super admin /,
        );
      }
    }
  });

  it('the two messages that ask are the owner’s signed answers R1 and R3, character for character', () => {
    const form = readFileSync(
      new URL('../../../docs/business/P5_OWNER_REFUSAL_MESSAGES.md', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(form).toMatch(/^\*\*Answered by:\*\* Mayowa Edward Fadahunsi \*\*Date:\*\* \S/m);
    const answer = (item: string) =>
      form.match(new RegExp(`^## ${item}\\.[\\s\\S]*?^> Answer: (.+)$`, 'm'))?.[1];
    expect(refusalMessage('merchant.profile.read')).toBe(answer('R1'));
    expect(refusalMessage('platform.audit.read')).toBe(answer('R3'));
  });
});
