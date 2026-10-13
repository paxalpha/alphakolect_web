import {
  BRANCH_SCOPES,
  CAPABILITIES,
  endpoints,
  PERMISSIONS,
  type EndpointContract,
  type EndpointId,
} from '@alphakolect/contracts';
import { Router, type RequestHandler } from 'express';
import { validateRequest } from './validate.js';

// Every HTTP route comes from the contract registry (packages/contracts). The Handlers type requires a
// handler for every registered endpoint (a missing one is a compile error), and test/route-parity.test.ts
// fails if any Express route exists that is not in the registry. Every endpoint whose contract declares
// `security` gets the authentication middleware mounted in front of its handler — it cannot be left out — and
// every endpoint gets its path parameters, query parameters and body validated against its contract.
//
// P5.3: every endpoint declares exactly one authorization class (P5 plan §5). The router checks every declaration
// before it mounts anything and refuses to start on a missing or invalid one, so no endpoint is public by omission.
// P5.4: every `permission` endpoint — and only those — gets the authorization middleware, after validation.

export type Handlers = { [K in EndpointId]: RequestHandler };

export const API_PREFIX = '/v1';

/** '/v1/merchant/branches/{branchId}' -> '/merchant/branches/:branchId' (relative to the /v1 mount). */
export function toExpressPath(contractPath: string): string {
  const relative = contractPath.slice(API_PREFIX.length).replace(/\{([A-Za-z]+)\}/g, ':$1');
  return relative === '' ? '/' : relative;
}

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(PERMISSIONS);
const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set(CAPABILITIES);
const KNOWN_BRANCH_SCOPES: ReadonlySet<string> = new Set(BRANCH_SCOPES);
const FIELDS: Record<string, readonly string[]> = {
  public: ['class'],
  capability: ['class', 'capability'],
  self: ['class'],
  permission: ['class', 'permission', 'branchScope'],
};

/** Every problem with one endpoint's authorization declaration (P5 plan §5, §7.6); none = valid. */
export function authorizationProblems(endpoint: EndpointContract): string[] {
  const declared: unknown = endpoint.authorization;
  if (!declared || typeof declared !== 'object') return ['no authorization declared'];
  const a = declared as Record<string, unknown>;
  const fields = typeof a.class === 'string' ? FIELDS[a.class] : undefined;
  if (!fields) return [`unknown authorization class ${JSON.stringify(a.class)}`];

  const problems = Object.keys(a)
    .filter((k) => !fields.includes(k))
    .map((k) => `unexpected field "${k}" for class ${String(a.class)}`);
  const secured = (endpoint.security?.length ?? 0) > 0;

  if (a.class === 'public' || a.class === 'capability') {
    if (secured) problems.push(`${a.class} endpoints take no session, but security is declared`);
    if (endpoint.audience !== 'public') problems.push(`${a.class} endpoints must have the public audience`);
    if (a.class === 'capability' && !KNOWN_CAPABILITIES.has(String(a.capability))) {
      problems.push(`unknown capability ${JSON.stringify(a.capability)}`);
    }
    return problems;
  }

  // self and permission: a session is required.
  if (!secured) problems.push(`${a.class} endpoints require a session, but no security is declared`);
  if (endpoint.audience === 'public') problems.push(`${a.class} endpoints cannot have the public audience`);
  if (a.class === 'permission') {
    const permission = String(a.permission);
    if (!KNOWN_PERMISSIONS.has(permission)) {
      problems.push(`unknown permission ${JSON.stringify(a.permission)}`);
    } else if (endpoint.audience !== permission.split('.')[0]) {
      problems.push(`permission ${permission} does not belong to the ${endpoint.audience} audience`);
    }
    if (!KNOWN_BRANCH_SCOPES.has(String(a.branchScope))) {
      problems.push(`unknown branch scope ${JSON.stringify(a.branchScope)}`);
    } else if (a.branchScope === 'branch') {
      // §7.6: no branch-owned resource exists in P5, so no resolver for a resource's branch exists either.
      problems.push(
        'branch-scoped endpoints need a resolver for the resource’s branch; none exists (P5 plan §7.6)',
      );
    }
    if (endpoint.sessionScope === 'mfa_enrollment') {
      problems.push('permission endpoints never admit an MFA-enrolment session');
    }
  }
  return problems;
}

/** Throws, naming every problem, unless every endpoint of the registry has a valid authorization declaration. */
export function assertAuthorizationDeclared(registry: Record<string, EndpointContract>): void {
  const problems = Object.values(registry).flatMap((e) =>
    authorizationProblems(e).map((p) => `${e.id}: ${p}`),
  );
  if (problems.length > 0) {
    throw new Error(`Refusing to start: invalid authorization declarations\n  ${problems.join('\n  ')}`);
  }
}

export function buildV1Router(
  handlers: Handlers,
  authenticateFor: (endpoint: EndpointContract) => RequestHandler,
  authorizeFor: (endpoint: EndpointContract) => RequestHandler,
): Router {
  assertAuthorizationDeclared(endpoints);
  const router = Router();
  for (const id of Object.keys(endpoints) as EndpointId[]) {
    const endpoint: EndpointContract = endpoints[id];
    // Authentication first: an unauthenticated caller learns nothing from validation errors. Authorization after
    // validation, as P4's in-handler checks were, so every answer stays the same (P5.4: zero behaviour change).
    const chain = [
      ...(endpoint.security?.length ? [authenticateFor(endpoint)] : []),
      validateRequest(endpoint),
      ...(endpoint.authorization.class === 'permission' ? [authorizeFor(endpoint)] : []),
      handlers[id],
    ];
    router[endpoint.method](toExpressPath(endpoint.path), ...chain);
  }
  return router;
}
