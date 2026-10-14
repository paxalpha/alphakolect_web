import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { readContainment, setContainment } from '../src/platform/containment.js';
import { createDb, type Queryable } from '../src/platform/db.js';

// The containment CLI core (P5 plan §11.1; `admin:containment`). The API test database is shared by four workers,
// so every change is made inside a transaction that is rolled back: the other workers never see a flag set. The
// switch's behaviour (the resolver, the re-checks, a write waiting for its re-check, #39) is tested in the database
// package (containment.test.ts).

const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
const app = createDb(inject('apiDatabaseUrl'));
beforeAll(() => owner.connect());
afterAll(async () => {
  await owner.end();
  await app.close();
});

/** The migrator connection as the CLI uses it, inside the open transaction. */
const migrator: Queryable = {
  query: async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
    (await owner.query<T>(sql, params)).rows,
};

async function rolledBack(fn: () => Promise<void>) {
  await owner.query('BEGIN');
  try {
    await fn();
  } finally {
    await owner.query('ROLLBACK');
  }
}

describe('admin:containment core', () => {
  it('reads the flags, sets both with a reason, and the change is recorded with it', async () => {
    await rolledBack(async () => {
      expect(await readContainment(migrator)).toMatchObject({
        merchantGrantsSuspended: false,
        platformGrantsSuspended: false,
      });
      expect(
        await setContainment({
          migrator,
          merchantGrantsSuspended: true,
          platformGrantsSuspended: false,
          reason: 'cli core test',
        }),
      ).toEqual({ merchantGrantsSuspended: true, platformGrantsSuspended: false });
      expect(await readContainment(migrator)).toMatchObject({
        merchantGrantsSuspended: true,
        platformGrantsSuspended: false,
      });
      const { rows } = await owner.query(
        `SELECT summary FROM audit.audit_events
          WHERE action = 'platform.authorization_containment_set' AND summary ->> 'reason' = 'cli core test'`,
      );
      expect(rows).toEqual([
        {
          summary: { merchantGrantsSuspended: true, platformGrantsSuspended: false, reason: 'cli core test' },
        },
      ]);
    });
  });

  it('the database refuses a blank reason with a safe message (23514), which the CLI prints', async () => {
    await rolledBack(async () => {
      await expect(
        setContainment({
          migrator,
          merchantGrantsSuspended: true,
          platformGrantsSuspended: true,
          reason: '  ',
        }),
      ).rejects.toMatchObject({ code: '23514', message: expect.stringMatching(/reason/) });
    });
  });

  it('the API’s own role can neither read nor set it', async () => {
    await expect(readContainment(app)).rejects.toMatchObject({ code: '42501' });
    await expect(
      setContainment({
        migrator: app,
        merchantGrantsSuspended: true,
        platformGrantsSuspended: true,
        reason: 'x',
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
