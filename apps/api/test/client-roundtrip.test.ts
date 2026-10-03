import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { getHealth } from '@alphakolect/contracts';
import { createApiClient } from '@alphakolect/contracts/client';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/platform/http/app.js';

// P2 exit criterion (amended 2026-10-03): the client GENERATED FROM openapi/v1.json round-trips against
// the real API over real HTTP — the spec, the client and the Express handlers agree.

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp({ logger: pino({ level: 'silent' }) }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe('generated client ↔ real API', () => {
  it('GET /v1/health round-trips with the contract-typed body', async () => {
    const client = createApiClient({ baseUrl });

    const { data, error, response } = await client.GET('/v1/health');

    expect(error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(data).toEqual({ status: 'ok' });
    // The body the generated client received also satisfies the zod contract it was generated from.
    expect(getHealth.responses[200].schema.parse(data)).toEqual({ status: 'ok' });
  });

  it('carries a caller request id end to end', async () => {
    const client = createApiClient({ baseUrl, headers: { 'x-request-id': 'roundtrip-123' } });
    const { response } = await client.GET('/v1/health');
    expect(response.headers.get('x-request-id')).toBe('roundtrip-123');
  });
});
