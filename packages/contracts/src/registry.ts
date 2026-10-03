import type { z } from 'zod';

// The endpoint registry: every API endpoint is described here exactly once (TARGET_ARCHITECTURE §17).
// The OpenAPI document is generated from it, and apps/api mounts its routes from it; a parity test in
// apps/api fails if an Express route has no contract or a contract has no route.

/** Who an endpoint is for (§3.1, §17). `public` = no session (e.g. health). */
export type Audience = 'public' | 'platform' | 'merchant' | 'agent' | 'customer' | 'webhook';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type ResponseContract = {
  description: string;
  /** Omitted for responses without a body (e.g. 204). */
  schema?: z.ZodType;
};

export type EndpointContract = {
  /** Stable operation id, used by clients and in the OpenAPI document. */
  id: string;
  method: HttpMethod;
  /** OpenAPI path template, always under /v1, e.g. /v1/merchant/branches/{branchId}. */
  path: `/v1/${string}`;
  audience: Audience;
  summary: string;
  request?: {
    params?: z.ZodObject;
    query?: z.ZodObject;
    headers?: z.ZodObject;
    body?: z.ZodType;
  };
  /** Success and endpoint-specific error responses. Every endpoint also gets the standard error envelope. */
  responses: Partial<
    Record<200 | 201 | 202 | 204 | 400 | 401 | 403 | 404 | 409 | 422 | 423, ResponseContract>
  >;
};

/** Identity helper that keeps literal types (paths, methods) for typed consumers. */
export const defineEndpoint = <const T extends EndpointContract>(endpoint: T): T => endpoint;
