import { describe, expect, it } from 'vitest';
import { buildDocument } from '../scripts/openapi-document.js';
import { endpoints, type EndpointContract } from '../src/index.js';

// TARGET_ARCHITECTURE §4, ADR-15 T3: the tenant of a merchant or agent request is its session membership. No
// tenant-audience contract may accept a merchantId — in its path, query, headers or body, at any depth — so a client
// cannot even ask for another tenant. Checked on the generated OpenAPI document (what clients actually see).

const TENANT_AUDIENCES = new Set(['merchant', 'agent']);
const doc = buildDocument();

/** Every property name reachable from a JSON schema (following $refs into components). */
function propertyNames(schema: unknown, seen = new Set<unknown>()): string[] {
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return [];
  seen.add(schema);
  const s = schema as Record<string, unknown>;
  if (typeof s.$ref === 'string') {
    const name = s.$ref.split('/').pop()!;
    return propertyNames(doc.components?.schemas?.[name], seen);
  }
  const own = Object.keys((s.properties as object | undefined) ?? {});
  return [...own, ...Object.values(s).flatMap((child) => propertyNames(child, seen))];
}

function requestNames(endpoint: EndpointContract): string[] {
  type Operation = { parameters?: { name: string }[]; requestBody?: unknown };
  const operation = (doc.paths?.[endpoint.path] as Record<string, Operation> | undefined)?.[endpoint.method];
  return [...(operation?.parameters ?? []).map((p) => p.name), ...propertyNames(operation?.requestBody)];
}

const tenantEndpoints = Object.values(endpoints as Record<string, EndpointContract>).filter((e) =>
  TENANT_AUDIENCES.has(e.audience),
);

describe('no client-supplied tenant (§4)', () => {
  it('there are tenant-audience endpoints to check', () => {
    expect(tenantEndpoints.length).toBeGreaterThan(0);
  });

  it.each(tenantEndpoints.map((e) => [e.id, e] as const))('%s accepts no merchantId', (_id, endpoint) => {
    expect(requestNames(endpoint).filter((n) => /merchant_?id/i.test(n))).toEqual([]);
  });

  it('the check can see request fields at all (control)', () => {
    const update = endpoints.updateBranch;
    expect(requestNames(update)).toEqual(expect.arrayContaining(['branchId', 'name', 'status']));
  });
});
