import { existsSync } from 'node:fs';

// Shared by the two test runs of this package (vitest.config.ts and vitest.concurrency.config.ts).

// Locally, the database passwords live in infrastructure/.env (gitignored). CI sets them directly.
const localEnv = new URL('../../infrastructure/.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

/**
 * The two-connection suites (P5 plan §9.3, test budget; split at the P5.6 gate when this package passed five minutes).
 * They run in their own command, `pnpm test:concurrency`, which is part of every gate — never skipped, and never with
 * fewer than 50 staged runs per race without a recorded decision. `pnpm test` runs everything else.
 */
export const CONCURRENCY_SUITES = [
  'test/lock-races.test.ts',
  'test/ledger-races.test.ts',
  'test/customers-races.test.ts',
];

export const baseTest = {
  environment: 'node' as const,
  globalSetup: ['test/support/global-setup.ts'],
  // Tests share one database; run files one at a time so privilege/RLS assertions never interleave.
  fileParallelism: false,
  testTimeout: 30_000,
  hookTimeout: 120_000,
};
