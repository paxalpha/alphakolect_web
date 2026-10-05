import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Locally, database passwords live in infrastructure/.env (gitignored). CI sets them directly.
const localEnv = new URL('../../infrastructure/.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

export default defineConfig({
  // Resolve workspace packages to their source in tests (see their package.json "exports").
  resolve: { conditions: ['@alphakolect/source'] },
  ssr: { resolve: { conditions: ['@alphakolect/source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // A throwaway, fully migrated database per run (test/support/global-setup.ts).
    globalSetup: ['test/support/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Each worker hashes passwords with argon2 (19 MiB per hash) against the shared test database. One worker
    // per CPU (11 on a 12-thread laptop) exhausted memory on a busy 8 GB machine — the OS refused allocations,
    // giving scattered 500s and a crashed worker (investigated 2026-10-04). Four matches a typical CI runner.
    maxWorkers: 4,
  },
});
