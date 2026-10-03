import { endpoints } from '@alphakolect/contracts';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './support/app.js';
import { API_PREFIX, toExpressPath } from '../src/platform/http/routes.js';

// Registry parity (P2): OpenAPI must never become documentation that silently diverges from Express.
// This walks the real Express router of the real app and requires the set of routes to equal the
// contract registry exactly — no route without a contract, no contract without a route.

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> };
  handle?: { stack?: Layer[] };
  match: (path: string) => boolean;
};

const { app } = await createTestApp();
const appStack = (app as unknown as { router: { stack: Layer[] } }).router.stack;

const isRouter = (layer: Layer) => Array.isArray(layer.handle?.stack);

function routesOf(stack: Layer[], prefix: string): string[] {
  const out: string[] = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled)
          out.push(`${method === '_all' ? 'ALL' : method.toUpperCase()} ${prefix}${layer.route.path}`);
      }
    } else if (isRouter(layer)) {
      out.push(`NESTED ROUTER under ${prefix}`);
    }
  }
  return out;
}

const contractRoutes = Object.values(endpoints)
  .map((e) => `${e.method.toUpperCase()} ${API_PREFIX}${toExpressPath(e.path)}`)
  .sort();

describe('Express routes and the contract registry are identical', () => {
  it('registers no routes directly on the app (everything goes through the /v1 registry router)', () => {
    expect(
      routesOf(
        appStack.filter((l) => !isRouter(l)),
        '',
      ),
    ).toEqual([]);
  });

  it('mounts exactly one router, at /v1 only', () => {
    const routers = appStack.filter(isRouter);
    expect(routers).toHaveLength(1);
    const [v1] = routers;
    expect(v1!.match('/v1/health')).toBe(true);
    expect(v1!.match('/health')).toBe(false);
    expect(v1!.match('/v2/health')).toBe(false);
  });

  it('every route has a contract and every contract has a route', () => {
    const v1 = appStack.find(isRouter)!;
    const expressRoutes = routesOf(v1.handle!.stack!, API_PREFIX).sort();
    expect(expressRoutes).toEqual(contractRoutes);
  });

  it('mounts authentication in front of every secured endpoint, and only there', () => {
    const v1 = appStack.find(isRouter)!;
    const byRoute = new Map(
      v1.handle!.stack!.filter((l) => l.route).map((l) => [l.route!.path, l.route!.stack.map((h) => h.name)]),
    );
    for (const e of Object.values(endpoints)) {
      const chain = byRoute.get(toExpressPath(e.path));
      const secured = 'security' in e && Array.isArray(e.security) && e.security.length > 0;
      expect(chain?.[0] === 'authenticateRequest', `${e.id} authentication`).toBe(secured);
      expect(chain?.length, `${e.id} handler chain`).toBe(secured ? 2 : 1);
    }
  });
});
