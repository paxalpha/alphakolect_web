import { describe, expect, it } from 'vitest';
import { endpoints } from '../src/index.js';

const all = Object.entries(endpoints);

describe('endpoint registry', () => {
  it('is keyed by each endpoint’s own id', () => {
    for (const [key, endpoint] of all) expect(endpoint.id).toBe(key);
  });

  it('has unique method + path pairs', () => {
    const pairs = all.map(([, e]) => `${e.method.toUpperCase()} ${e.path}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('keeps every path under /v1 with OpenAPI-style {params}', () => {
    for (const [, e] of all) {
      expect(e.path).toMatch(/^\/v1(\/[a-z0-9-]+|\/\{[a-zA-Z]+\})+$/);
    }
  });

  it('declares every path parameter in request.params', () => {
    for (const [, e] of all) {
      const inPath = [...e.path.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort();
      const request = 'request' in e ? (e.request as { params?: { shape: object } } | undefined) : undefined;
      const declared = Object.keys(request?.params?.shape ?? {}).sort();
      expect(declared, `${e.id} path params`).toEqual(inPath);
    }
  });

  it('documents at least one success response per endpoint', () => {
    for (const [, e] of all) {
      expect(
        Object.keys(e.responses).some((s) => s.startsWith('2')),
        e.id,
      ).toBe(true);
    }
  });
});
