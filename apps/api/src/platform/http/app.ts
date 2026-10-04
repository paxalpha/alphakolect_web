import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { AuditLog } from '../../modules/audit/audit-log.js';
import { healthHandlers } from '../../modules/health/routes.js';
import { AccountService, type SignupGuard } from '../../modules/identity/accounts.js';
import { RateLimiter } from '../../modules/identity/rate-limits.js';
import { accountHandlers, authHandlers } from '../../modules/identity/routes.js';
import { SessionService } from '../../modules/identity/sessions.js';
import type { TrustedProxies } from '../config.js';
import type { Db } from '../db.js';
import { Mailer, type EmailSender } from '../email.js';
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
  /** Reverse proxies whose X-Forwarded-For sets req.ip (rate limits, audit), by address. Default: this host only. */
  trustProxy?: TrustedProxies;
  /** Outgoing email (ADR-14 D1): SMTP in the server, in-memory in tests. */
  email: EmailSender;
  /** Origin of the web app, for links in emails. */
  webAppUrl: string;
  /** D14: CAPTCHA hook for signup (P15). */
  signupGuard?: SignupGuard;
};

export function createApp({
  logger,
  db,
  auth,
  cookieDomain,
  trustProxy = ['loopback'],
  email,
  webAppUrl,
  signupGuard,
}: AppDeps): Express {
  const app = express();
  // An array of addresses/subnets (never a hop count): see TrustedProxies.
  app.set('trust proxy', trustProxy === false ? false : [...trustProxy]);

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

  const audit = new AuditLog(db);
  const limiter = new RateLimiter(auth.identity);
  const sessions = new SessionService({
    identity: auth.identity,
    accessTokens: auth.accessTokens,
    audit,
    limiter,
  });
  const accounts = new AccountService({
    identity: auth.identity,
    audit,
    limiter,
    mailer: new Mailer(email, logger),
    webAppUrl,
    ...(signupGuard ? { signupGuard } : {}),
  });
  const handlers = {
    ...healthHandlers,
    ...authHandlers({ sessions, cookies: { domain: cookieDomain }, webOrigins: auth.webOrigins }),
    ...accountHandlers({ accounts }),
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
