import { ErrorResponse, getHealth } from '@alphakolect/contracts';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/platform/http/app.js';

// Responses the API actually sends must satisfy the contract schemas (the same schemas the OpenAPI
// document and the typed client are generated from).

const app = createApp({ logger: pino({ level: 'silent' }) });

describe('responses conform to the contracts', () => {
  it('GET /v1/health matches its 200 schema', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(getHealth.responses[200].schema.safeParse(res.body).success).toBe(true);
  });

  it.each([
    ['unknown route (404)', () => request(app).get('/v1/does-not-exist')],
    [
      'malformed JSON (400)',
      () => request(app).post('/v1/health').set('content-type', 'application/json').send('{'),
    ],
  ])('%s uses the ErrorResponse envelope', async (_label, send) => {
    const res = await send();
    const parsed = ErrorResponse.safeParse(res.body);
    expect(parsed.success, JSON.stringify(res.body)).toBe(true);
    expect(parsed.data?.error.requestId).toBe(res.headers['x-request-id']);
  });
});
