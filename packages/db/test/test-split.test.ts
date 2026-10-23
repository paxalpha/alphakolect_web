import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONCURRENCY_SUITES } from '../vitest.base.js';

// The split of this package's tests (P5 plan §9.3; applied at the P5.6 gate): `pnpm test` runs every suite except the
// two-connection ones, which `pnpm test:concurrency` runs — both part of the gate. Both runs take the list from one
// place (vitest.base.ts), so a suite is in exactly one of them; these checks keep the list honest.

const root = new URL('../', import.meta.url);

describe('the test split (§9.3)', () => {
  it('every listed concurrency suite exists — a renamed one cannot drop out of both runs', () => {
    expect(CONCURRENCY_SUITES.filter((f) => !existsSync(new URL(f, root)))).toEqual([]);
  });

  it('the races still run 50 staged times each — never fewer without a recorded decision', () => {
    for (const suite of CONCURRENCY_SUITES)
      expect(readFileSync(new URL(suite, root), 'utf8'), suite).toMatch(/^const RUNS = 50;$/m);
    // P6: the ledger's races (TA-4, TA-5, TA-6, the non-negative rule) joined P5's
    expect(CONCURRENCY_SUITES).toEqual(['test/lock-races.test.ts', 'test/ledger-races.test.ts']);
  });

  it('the concurrency command is wired into the root and the CI gate', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
    expect(pkg.scripts['test:concurrency']).toMatch(/vitest run --config vitest\.concurrency\.config\.ts/);
    const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', root), 'utf8'));
    expect(rootPkg.scripts['test:concurrency']).toBeDefined();
    const ci = readFileSync(new URL('../../.github/workflows/ci.yml', root), 'utf8');
    expect(ci).toMatch(/^\s+- run: pnpm test:concurrency\s*$/m);
  });
});
