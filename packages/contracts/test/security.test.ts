import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { buildDocument } from '../scripts/openapi-document.js';
import { AUTH_COOKIES, AUTH_ERROR_CODES, CSRF_HEADER, defineEndpoint, ErrorCode } from '../src/index.js';

// P3.1 registry extensions: security requirements, response headers and 429 render into OpenAPI as intended.
// Synthetic endpoints are used so the rendering is tested before real authenticated endpoints exist.

const registry = {
  readSession: defineEndpoint({
    id: 'readSession',
    method: 'get',
    path: '/v1/auth/example',
    audience: 'merchant',
    authorization: { class: 'self' },
    summary: 'Cookie-authenticated read',
    security: ['cookieSession', 'bearer'],
    responses: { 200: { description: 'ok', schema: z.object({ ok: z.boolean() }) } },
  }),
  changeSomething: defineEndpoint({
    id: 'changeSomething',
    method: 'post',
    path: '/v1/auth/example',
    audience: 'merchant',
    authorization: { class: 'self' },
    summary: 'Cookie-authenticated state change',
    security: ['cookieSession'],
    responses: {
      204: {
        description: 'done',
        headers: z.object({ 'set-cookie': z.string().meta({ description: 'Rotated session cookies' }) }),
      },
      429: {
        description: 'Too many attempts',
        headers: z.object({ 'retry-after': z.string() }),
      },
    },
  }),
};

const doc = buildDocument(registry);
const path = doc.paths?.['/v1/auth/example'];

describe('security requirements (ADR-14 D7)', () => {
  it('publishes the cookie, CSRF and bearer schemes', () => {
    expect(doc.components?.securitySchemes).toMatchObject({
      cookieSession: { type: 'apiKey', in: 'cookie', name: AUTH_COOKIES.access },
      csrfToken: { type: 'apiKey', in: 'header', name: CSRF_HEADER },
      bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    });
  });

  it('accepts either scheme on reads (cookie needs no CSRF header for GET)', () => {
    expect(path?.get?.security).toEqual([{ cookieSession: [] }, { bearer: [] }]);
  });

  it('requires the CSRF header together with the cookie on state changes', () => {
    expect(path?.post?.security).toEqual([{ cookieSession: [], csrfToken: [] }]);
  });

  it('leaves public endpoints without security requirements', () => {
    expect(buildDocument().paths?.['/v1/health']?.get?.security).toBeUndefined();
  });
});

describe('response headers and 429', () => {
  it('documents Set-Cookie and Retry-After headers', () => {
    expect(Object.keys(path?.post?.responses?.['204']?.headers ?? {})).toEqual(['set-cookie']);
    expect(Object.keys(path?.post?.responses?.['429']?.headers ?? {})).toEqual(['retry-after']);
  });
});

describe('auth error codes', () => {
  it('are valid envelope codes and unique', () => {
    for (const code of AUTH_ERROR_CODES) expect(ErrorCode.safeParse(code).success, code).toBe(true);
    expect(new Set(AUTH_ERROR_CODES).size).toBe(AUTH_ERROR_CODES.length);
  });
});
