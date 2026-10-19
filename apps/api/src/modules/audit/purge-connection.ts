import type pg from 'pg';

/**
 * The purge command's one dedicated connection (P5 plan §8.6 item 2), never the app's pool: statements end after five
 * minutes (longer than the worst bounded page, shorter than the 15-minute lease), an idle transaction after one
 * minute, and TCP keepalive is on — so a hung command cannot hold the lock or a transaction indefinitely.
 */
export const purgeClientConfig = (connectionString: string): pg.ClientConfig => ({
  connectionString,
  application_name: 'alphakolect-audit-purge',
  statement_timeout: 300_000,
  idle_in_transaction_session_timeout: 60_000,
  keepAlive: true,
});
