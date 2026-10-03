// @alphakolect/contracts — API shapes only: zod schemas, the endpoint registry and API primitives.
// No application behaviour, database access, Express handlers, authentication or business rules.

import { getHealth } from './endpoints/health.js';

export * from './primitives.js';
export * from './registry.js';
export { HealthResponse, getHealth } from './endpoints/health.js';

/** Every endpoint of the v1 API, keyed by operation id. Add new endpoints here. */
export const endpoints = {
  getHealth,
} as const;

export type EndpointId = keyof typeof endpoints;
