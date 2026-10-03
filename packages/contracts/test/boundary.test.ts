import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// packages/contracts holds API shapes only (RESTRUCTURING_MAP §1, P2 decision): no application behaviour,
// database access, Express handlers, authentication or business rules. These guards keep it that way.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED_RUNTIME_DEPENDENCIES = ['openapi-fetch', 'zod'];

const FORBIDDEN_IMPORT =
  /from\s+['"](express|pg|pino|@prisma\/[^'"]*|@alphakolect\/(db|api)|node:[^'"]*|fs|path|http|crypto)['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('contracts stay shapes-only', () => {
  it('has no runtime dependencies beyond zod and openapi-fetch', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(ALLOWED_RUNTIME_DEPENDENCIES);
  });

  it('source never imports servers, databases, loggers, other workspace apps or Node built-ins', () => {
    const offenders = sourceFiles(path.join(root, 'src'))
      .filter((file) => FORBIDDEN_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});
