import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { AuditLog } from '../../modules/audit/audit-log.js';
import { healthHandlers } from '../../modules/health/routes.js';
import { RateLimiter } from '../../modules/identity/rate-limits.js';
import { authHandlers } from '../../modules/identity/routes.js';
import { SessionService } from '../../modules/identity/sessions.js';
import type { Db } from '../db.js';
import { authenticate, type AuthDeps } from './authenticate.js';
import { errorHandler, notFoundHandler } from './error-handler.js';
import { resolveRequestId } from './request-id.js';
import { API_PREFIX, buildV1Router } from './routes.js';

export type AppDeps = {
  logger: Logger;
  db: Db;
  auth: AuthDeps;
  /** Session cookie Domain (production: .alphakolect.com); host-only when undefined (ADR-14 D7). */
  cookieDomain?: string | undefined;
  /** Proxy hops trusted for req.ip (rate-limit keys). Default: only a proxy on this host. */
  trustProxy?: false | 'loopback' | number;
};

export function createApp({ logger, db, auth, cookieDomain, trustProxy = 'loopback' }: AppDeps): Express {
  const app = express();
  app.set('trust proxy', trustProxy);

  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: resolveRequestId,
      // Health probes are frequent and uninteresting.
      autoLogging: { ignore: (req) => req.url === '/v1/health' },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  const sessions = new SessionService({
    identity: auth.identity,
    accessTokens: auth.accessTokens,
    audit: new AuditLog(db),
    limiter: new RateLimiter(auth.identity),
  });
  const handlers = {
    ...healthHandlers,
    ...authHandlers({ sessions, cookies: { domain: cookieDomain }, webOrigins: auth.webOrigins }),
  };

  // All endpoints are versioned (§17) and come from the contract registry (packages/contracts).
  app.use(
    API_PREFIX,
    buildV1Router(handlers, (endpoint) => authenticate(endpoint, auth)),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
