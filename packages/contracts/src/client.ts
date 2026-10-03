// Typed HTTP client for the AlphaKolect API, generated from openapi/v1.json (P2).
// The types in ./generated/v1.ts come from openapi-typescript (client:generate); this file only wires them
// to openapi-fetch. Paths, methods, request and response bodies are all checked at compile time.
import createClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './generated/v1.js';

export type ApiPaths = paths;
export type ApiSchemas = components['schemas'];

/** Create a client for the v1 API, e.g. createApiClient({ baseUrl: 'https://api.example.com' }). */
export function createApiClient(options: ClientOptions) {
  return createClient<paths>(options);
}

export type ApiClient = ReturnType<typeof createApiClient>;
