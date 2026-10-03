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
  },
});
