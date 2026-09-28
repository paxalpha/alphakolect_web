import pg from 'pg';
import { expect, inject } from 'vitest';
import { connectionConfig, type Role } from './env.js';

/** Open a connection to the run's test database as a real database role (its own login). */
export async function connectAs(role: Role): Promise<pg.Client> {
  const client = new pg.Client(connectionConfig(role, inject('testDatabase')));
  await client.connect();
  return client;
}

/**
 * Run `fn` in a transaction with the tenant context set exactly as the application will
 * (SET LOCAL app.merchant_id), then roll back so tests never leave data behind.
 * Pass merchantId = null to run with no tenant context.
 */
export async function inTenantTx<T>(
  client: pg.Client,
  merchantId: string | null,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    if (merchantId !== null) {
      await client.query(`SELECT set_config('app.merchant_id', $1, true)`, [merchantId]);
    }
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

/** Assert that a query fails with the given PostgreSQL SQLSTATE (e.g. 42501 insufficient_privilege). */
export async function expectSqlState(promise: Promise<unknown>, sqlState: string): Promise<pg.DatabaseError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, `expected SQLSTATE ${sqlState}, but the statement succeeded`).toBeInstanceOf(pg.DatabaseError);
  expect((err as pg.DatabaseError).code).toBe(sqlState);
  return err as pg.DatabaseError;
}

export const SQLSTATE = {
  insufficientPrivilege: '42501',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
  uniqueViolation: '23505',
  restrictViolation: '23001',
  rlsViolation: '42501', // "new row violates row-level security policy" is also insufficient_privilege
} as const;
