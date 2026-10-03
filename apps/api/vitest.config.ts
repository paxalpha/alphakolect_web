import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve workspace packages to their source in tests (see their package.json "exports").
  resolve: { conditions: ['@alphakolect/source'] },
  ssr: { resolve: { conditions: ['@alphakolect/source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
