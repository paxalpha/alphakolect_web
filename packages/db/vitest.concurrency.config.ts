import { defineConfig } from 'vitest/config';
import { baseTest, CONCURRENCY_SUITES } from './vitest.base.js';

// `pnpm test:concurrency`: the two-connection suites only (P5 plan §9.3) — 50 staged runs per race. Part of the gate.
export default defineConfig({
  test: {
    ...baseTest,
    include: CONCURRENCY_SUITES,
  },
});
