import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Locally, the database passwords live in infrastructure/.env (gitignored). CI sets them directly.
const localEnv = new URL('../../infrastructure/.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/support/global-setup.ts'],
    // Tests share one database; run files one at a time so privilege/RLS assertions never interleave.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
