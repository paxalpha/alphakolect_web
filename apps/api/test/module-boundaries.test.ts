import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The module boundaries of apps/api (TA-10): the root lint config allows each module only the modules listed for it,
// and only through their public entry file. Each case lints a one-line import as if it were a file of a module.
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const eslint = new ESLint({ cwd: repo });
const lint = async (module: string, line: string) => {
  const [result] = await eslint.lintText(`${line}\nexport {};\n`, {
    filePath: `${repo}/apps/api/src/modules/${module}/probe.ts`,
  });
  return result!.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
};

describe('the module boundaries (TA-10)', () => {
  it('allows a listed module through its entry file', async () => {
    expect(await lint('tenancy', `import type { AuditLog } from '../audit/index.js';`)).toEqual([]);
    expect(await lint('platform', `import { toMember } from '../tenancy/index.js';`)).toEqual([]);
  });

  it('refuses another module’s internals, even a listed one', async () => {
    const messages = await lint('tenancy', `import type { AuditLog } from '../audit/audit-log.js';`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Import the audit module only through ../audit/index.js (TA-10).');
  });

  it('refuses a dependency against the direction: identity on tenancy, audit on identity', async () => {
    expect(await lint('identity', `import { toMember } from '../tenancy/index.js';`)).toHaveLength(1);
    expect(await lint('audit', `import type { X } from '../identity/index.js';`)).toHaveLength(1);
  });

  it('still refuses the legacy app', async () => {
    expect(await lint('ledger', `import x from '../../../../../legacy/server.js';`)).toHaveLength(1);
  });
});
