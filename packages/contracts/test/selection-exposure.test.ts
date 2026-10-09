import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ADR-15 T4 (P4.2): login membership choices are exposed by exactly one operation —
// GET /v1/auth/login/memberships, which requires the selection challenge created after a successful password
// check. This walks the COMMITTED spec: every schema reachable from every operation's responses (following $refs),
// and fails if any other operation could return a MembershipChoice. A new endpoint that returned choices — for
// example by reusing the schema in a session or profile response — fails here.

type Json = Record<string, unknown>;
const spec = JSON.parse(readFileSync(new URL('../openapi/v1.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, { operationId: string; responses?: Json }>>;
  components: { schemas: Record<string, Json> };
};

const CHOICE = '#/components/schemas/MembershipChoice';

/** Every component $ref reachable from a value, transitively. */
function refsIn(value: unknown, seen = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) refsIn(v, seen);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === '$ref' && typeof v === 'string' && !seen.has(v)) {
        seen.add(v);
        const name = v.replace('#/components/schemas/', '');
        refsIn(spec.components.schemas[name], seen);
      } else {
        refsIn(v, seen);
      }
    }
  }
  return seen;
}

describe('login membership choices are exposed by one operation only (ADR-15 T4)', () => {
  it('only listLoginMemberships can return MembershipChoice', () => {
    const exposing: string[] = [];
    for (const methods of Object.values(spec.paths)) {
      for (const op of Object.values(methods)) {
        if (refsIn(op.responses).has(CHOICE)) exposing.push(op.operationId);
      }
    }
    expect(exposing).toEqual(['listLoginMemberships']);
  });

  it('the guard can see the schema at all (it is defined and referenced)', () => {
    expect(spec.components.schemas.MembershipChoice).toBeDefined();
  });
});
