import { describe, expect, expectTypeOf, it } from 'vitest';
import { createApiClient, type ApiSchemas } from '../src/client.js';

// A fetch stub stands in for the server here; the real round trip against apps/api lives in apps/api tests.
function stubFetch(status: number, body: unknown) {
  const calls: Request[] = [];
  const fetch = async (input: Request) => {
    calls.push(input);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetch };
}

describe('generated typed client', () => {
  it('calls GET /v1/health and returns the typed body', async () => {
    const { calls, fetch } = stubFetch(200, { status: 'ok' });
    const client = createApiClient({ baseUrl: 'http://api.test', fetch });

    const { data, error } = await client.GET('/v1/health');

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://api.test/v1/health');
    expect(error).toBeUndefined();
    expect(data).toEqual({ status: 'ok' });
    expectTypeOf(data).toEqualTypeOf<{ status: 'ok' } | undefined>();
  });

  it('exposes errors as the standard envelope type', async () => {
    const envelope = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: 'r1' } };
    const { fetch } = stubFetch(500, envelope);
    const client = createApiClient({ baseUrl: 'http://api.test', fetch });

    const { data, error } = await client.GET('/v1/health');

    expect(data).toBeUndefined();
    expect(error).toEqual(envelope);
    expectTypeOf(error).toEqualTypeOf<ApiSchemas['ErrorResponse'] | undefined>();
  });

  it('types money as the digit-string format', () => {
    expectTypeOf<ApiSchemas['Money']>().toEqualTypeOf<{ amountMinor: string; currency: 'NGN' }>();
  });
});
