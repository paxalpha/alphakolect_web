import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { ErrorResponse, getHealth } from '@alphakolect/contracts';
import { createApiClient } from '@alphakolect/contracts/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/app.js';

// P2 exit criterion (amended 2026-10-03): the client GENERATED FROM openapi/v1.json round-trips against
// the real API over real HTTP — the spec, the client and the Express handlers agree.

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // The server as production builds it: its own request ids (P5 plan §8.6, P5.8).
  server = (await createTestApp({ serverRequestIds: true })).app.listen(0, '127.0.0.1');
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

  it('POST /v1/auth/login round-trips its typed request body and error envelope', async () => {
    const client = createApiClient({ baseUrl });

    const { data, error, response } = await client.POST('/v1/auth/login', {
      body: { email: 'nobody-roundtrip@example.test', password: 'not a real password', audience: 'merchant' },
    });

    expect(data).toBeUndefined();
    expect(response.status).toBe(401);
    expect(ErrorResponse.parse(error).error.code).toBe('INVALID_CREDENTIALS');
  });

  // P5.8 (§8.6): a deviation recorded in the P5 record — a caller's id was carried end to end; now it is ignored and
  // the server's own id comes back, for the proxy to log.
  it('ignores a caller request id: the response carries the server’s own', async () => {
    const client = createApiClient({ baseUrl, headers: { 'x-request-id': 'roundtrip-123' } });
    const { response } = await client.GET('/v1/health');
    expect(response.headers.get('x-request-id')).not.toBe('roundtrip-123');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
