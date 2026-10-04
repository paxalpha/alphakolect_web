import { endpoints, type EndpointContract, type EndpointId } from '@alphakolect/contracts';
import { Router, type RequestHandler } from 'express';
import { needsValidation, validateRequest } from './validate.js';

// Every HTTP route comes from the contract registry (packages/contracts). The Handlers type requires a
// handler for every registered endpoint (a missing one is a compile error), and test/route-parity.test.ts
// fails if any Express route exists that is not in the registry. Every endpoint whose contract declares
// `security` gets the authentication middleware mounted in front of its handler — it cannot be left out — and
// every endpoint with a request body gets that body validated against its contract schema.

export type Handlers = { [K in EndpointId]: RequestHandler };

export const API_PREFIX = '/v1';

/** '/v1/merchant/branches/{branchId}' -> '/merchant/branches/:branchId' (relative to the /v1 mount). */
export function toExpressPath(contractPath: string): string {
  const relative = contractPath.slice(API_PREFIX.length).replace(/\{([A-Za-z]+)\}/g, ':$1');
  return relative === '' ? '/' : relative;
}

export function buildV1Router(
  handlers: Handlers,
  authenticateFor: (endpoint: EndpointContract) => RequestHandler,
): Router {
  const router = Router();
  for (const id of Object.keys(endpoints) as EndpointId[]) {
    const endpoint: EndpointContract = endpoints[id];
    // Authentication first: an unauthenticated caller learns nothing from validation errors.
    const chain = [
      ...(endpoint.security?.length ? [authenticateFor(endpoint)] : []),
      ...(needsValidation(endpoint) ? [validateRequest(endpoint)] : []),
      handlers[id],
    ];
    router[endpoint.method](toExpressPath(endpoint.path), ...chain);
  }
  return router;
}
