import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/platform/errors.js';
import { createApp } from '../src/platform/http/app.js';
import { errorHandler } from '../src/platform/http/error-handler.js';
import { resolveRequestId } from '../src/platform/http/request-id.js';

const logger = pino({ level: 'silent' });
const app = createApp({ logger });

describe('GET /v1/health', () => {
  it('returns ok with a generated request id', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('echoes a safe caller-supplied request id', async () => {
    const res = await request(app).get('/v1/health').set('x-request-id', 'trace-123.abc');
    expect(res.headers['x-request-id']).toBe('trace-123.abc');
  });

  it.each([
    ['spaces and markup', 'bad id <script>injected</script>'],
    ['oversized', 'a'.repeat(129)],
  ])('replaces an unsafe caller-supplied request id (%s)', async (_label, unsafe) => {
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
  probe.use(pinoHttp({ logger, genReqId: resolveRequestId }));
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
