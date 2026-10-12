import { PERMISSIONS } from '@alphakolect/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

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
