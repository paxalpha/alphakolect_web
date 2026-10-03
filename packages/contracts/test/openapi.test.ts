import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDocument, OPENAPI_PATH, renderDocument } from '../scripts/openapi-document.js';
import { endpoints } from '../src/index.js';

describe('openapi/v1.json', () => {
  it('is exactly what the contracts generate (run openapi:generate and commit if this fails)', () => {
    const committed = readFileSync(OPENAPI_PATH, 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(renderDocument());
  });

  it('describes every registry endpoint, each with the standard error envelope', () => {
    const doc = buildDocument();
    for (const e of Object.values(endpoints)) {
      const op = doc.paths?.[e.path]?.[e.method];
      expect(op?.operationId, `${e.method.toUpperCase()} ${e.path}`).toBe(e.id);
      expect(op?.responses?.default).toBeDefined();
    }
  });

  it('is OpenAPI 3.1 and publishes the money and id formats', () => {
    const doc = buildDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['Money', 'AmountMinor', 'Currency', 'Id', 'ErrorResponse']),
    );
  });
});
