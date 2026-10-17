import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/platform/errors.js';
import { errorHandler } from '../src/platform/http/error-handler.js';
import { serverRequestId } from '../src/platform/http/request-id.js';
import { createTestApp } from './support/app.js';

const logger = pino({ level: 'silent' });
// The server as production builds it: its own request ids (P5 plan §8.6, P5.8).
const { app } = await createTestApp({ serverRequestIds: true });

describe('the request id is the server’s own (§8.6, P5.8)', () => {
  it('nothing in the API source reads a caller’s X-Request-ID: only the tests’ app does, from test/support', () => {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
    const reads =
      /headers\[\s*(REQUEST_ID_HEADER|['"]x-request-id['"])\s*\]|\.(get|header)\(\s*['"]x-request-id['"]|test\/support/i;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && reads.test(readFileSync(full, 'utf8')))
          offenders.push(path.relative(src, full));
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
    // Sanity: the pattern finds the reading the tests' generator does.
    expect(reads.test(readFileSync(new URL('./support/request-id.ts', import.meta.url), 'utf8'))).toBe(true);
  });
});

describe('GET /v1/health', () => {
  it('returns ok with a generated request id', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  // P5.8 (§8.6, R50): a deviation recorded in the P5 record — before, a plain caller-supplied id was echoed. Now the
  // server ignores every incoming X-Request-ID, plain or not: a caller controls it, and an IP address looks plain.
  it.each([
    ['plain', 'trace-123.abc'],
    ['an IP address', '203.0.113.42'],
    ['spaces and markup', 'bad id <script>injected</script>'],
    ['oversized', 'a'.repeat(129)],
  ])('ignores a caller-supplied request id (%s): the id is the server’s own', async (_label, unsafe) => {
    const res = await request(app).get('/v1/health').set('x-request-id', unsafe);
    expect(res.headers['x-request-id']).not.toBe(unsafe);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('error envelope', () => {
  it('404 for unknown routes, including unversioned legacy paths', async () => {
    const res = await request(app).get('/merchant/login');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found', requestId: res.headers['x-request-id'] },
    });
  });

  it('400 INVALID_JSON for a malformed body', async () => {
    const res = await request(app).post('/v1/health').set('content-type', 'application/json').send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  // A small app exercising the shared error handler with routes that throw.
  const probe = express();
  probe.use(pinoHttp({ logger, genReqId: serverRequestId }));
  probe.get('/app-error', () => {
    throw new AppError(409, 'CONFLICT_EXAMPLE', 'Already exists', { field: 'email' });
  });
  probe.get('/boom', () => {
    throw new Error('database password is hunter2');
  });
  probe.use(errorHandler);

  it('renders AppError with its status, code and details', async () => {
    const res = await request(probe).get('/app-error');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'CONFLICT_EXAMPLE',
      message: 'Already exists',
      details: { field: 'email' },
    });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await request(probe).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
