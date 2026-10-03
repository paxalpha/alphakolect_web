import pg from 'pg';

// Database access for the API. The API connects as the least-privilege alphakolect_app role (P1); identity data
// is reachable only through SECURITY DEFINER functions (ADR-14 D4), so this layer only needs plain queries
// and transactions.

export type Queryable = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
};

export type Db = Queryable & {
  /** Run `fn` in one transaction (BEGIN … COMMIT, ROLLBACK on error). */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

// Return bigint columns (e.g. TOTP time steps) as strings instead of lossy numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => value);

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    application_name: 'alphakolect-api',
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 10_000,
  });

  const queryOn =
    (client: pg.Pool | pg.PoolClient) =>
    async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
      (await client.query<T>(sql, params)).rows;

  return {
    query: queryOn(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: queryOn(client) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
