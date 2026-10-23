import { configDefaults, defineConfig } from 'vitest/config';
import { baseTest, CONCURRENCY_SUITES } from './vitest.base.js';

// `pnpm test`: every suite except the two-connection ones, which run in `pnpm test:concurrency`
// (vitest.concurrency.config.ts) — both are part of the gate.
export default defineConfig({
  test: {
    ...baseTest,
    include: ['test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...CONCURRENCY_SUITES],
  },
});
