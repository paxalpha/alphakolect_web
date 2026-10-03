import { endpoints, type EndpointId } from '@alphakolect/contracts';
import { Router, type RequestHandler } from 'express';

// Every HTTP route comes from the contract registry (packages/contracts). The Handlers type requires a
// handler for every registered endpoint (a missing one is a compile error), and test/route-parity.test.ts
// fails if any Express route exists that is not in the registry.

export type Handlers = { [K in EndpointId]: RequestHandler };

export const API_PREFIX = '/v1';

/** '/v1/merchant/branches/{branchId}' -> '/merchant/branches/:branchId' (relative to the /v1 mount). */
export function toExpressPath(contractPath: string): string {
  const relative = contractPath.slice(API_PREFIX.length).replace(/\{([A-Za-z]+)\}/g, ':$1');
  return relative === '' ? '/' : relative;
}

export function buildV1Router(handlers: Handlers): Router {
  const router = Router();
  for (const id of Object.keys(endpoints) as EndpointId[]) {
    const endpoint = endpoints[id];
    router[endpoint.method](toExpressPath(endpoint.path), handlers[id]);
  }
  return router;
}
