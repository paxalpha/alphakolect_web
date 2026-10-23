import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';
import { purgeClientConfig } from '../../src/modules/audit/purge-connection.js';

// The purge command's connection (P5 plan §8.6 item 2 and its tests: "an idle transaction is ended after a minute"):
// the settings as the database applies them to a connection opened as the command opens it.
describe('the purge command’s connection', () => {
  it('ends a statement after five minutes and an idle transaction after one; keepalive on; named', async () => {
    const config = purgeClientConfig(inject('ownerDatabaseUrl'));
    expect(config.keepAlive).toBe(true);
    const client = new pg.Client(config);
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT current_setting('statement_timeout') AS statement, current_setting('idle_in_transaction_session_timeout') AS idle,
                current_setting('application_name') AS name`,
      );
      expect(rows[0]).toEqual({ statement: '5min', idle: '1min', name: 'alphakolect-audit-purge' });
    } finally {
      await client.end();
    }
  });

  it('a transaction left idle for a minute is ended by the database, and its connection with it', async () => {
    const client = new pg.Client(purgeClientConfig(inject('ownerDatabaseUrl')));
    const ended = new Promise<string>((resolve) =>
      client.on('error', (error: Error & { code?: string }) => resolve(error.code ?? error.message)),
    );
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1'); // then nothing: a hung command
      expect(await ended).toBe('25P03'); // idle_in_transaction_session_timeout
    } finally {
      await client.end().catch(() => undefined);
    }
  }, 90_000);
});
