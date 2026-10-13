import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { AuditLog } from '../../modules/audit/audit-log.js';
import { healthHandlers } from '../../modules/health/routes.js';
import { AccountService, type SignupGuard } from '../../modules/identity/accounts.js';
import { agentHandlers } from '../../modules/identity/agent-routes.js';
import { RateLimiter } from '../../modules/identity/rate-limits.js';
import { MfaService } from '../../modules/identity/mfa.js';
import { PasswordService } from '../../modules/identity/password-flows.js';
import {
  accountHandlers,
  authHandlers,
  mfaHandlers,
  passwordHandlers,
  selectionHandlers,
} from '../../modules/identity/routes.js';
import { SecretBox, type EncryptionKey } from '../../modules/identity/secret-box.js';
import { MerchantLifecycleService } from '../../modules/tenancy/merchant-lifecycle.js';
import { MerchantSettingsService } from '../../modules/tenancy/merchant-settings.js';
import { InvitationService } from '../../modules/tenancy/invitations.js';
import { MembershipService } from '../../modules/tenancy/memberships.js';
import {
  invitationAcceptHandlers,
  merchantHandlers,
  platformMerchantHandlers,
} from '../../modules/tenancy/routes.js';
import { SessionService } from '../../modules/identity/sessions.js';
import { authorize } from '../authorization.js';
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
  /** TOTP secret encryption keys (ADR-14 D8): the current one seals; the previous one (if any) still opens. */
  mfaEncryption: { current: EncryptionKey; previous?: EncryptionKey | undefined };
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
  mfaEncryption,
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

  const audit = new AuditLog(db, logger);
  const limiter = new RateLimiter(auth.identity);
  const sessions = new SessionService({
    db,
    identity: auth.identity,
    accessTokens: auth.accessTokens,
    audit,
    limiter,
  });
  const mailer = new Mailer(email, logger);
  const accounts = new AccountService({
    db,
    identity: auth.identity,
    audit,
    limiter,
    mailer,
    webAppUrl,
    ...(signupGuard ? { signupGuard } : {}),
  });
  const passwords = new PasswordService({ db, identity: auth.identity, audit, limiter, mailer, webAppUrl });
  const cookies = { domain: cookieDomain };
  const mfa = new MfaService({
    db,
    identity: auth.identity,
    sessions,
    secretBox: new SecretBox(mfaEncryption.current, mfaEncryption.previous),
    audit,
    limiter,
  });
  const invitations = new InvitationService({
    db,
    identity: auth.identity,
    audit,
    limiter,
    mailer,
    webAppUrl,
  });
  const settings = new MerchantSettingsService({ db, audit });
  const handlers = {
    ...healthHandlers,
    ...authHandlers({ sessions, cookies, webOrigins: auth.webOrigins }),
    ...accountHandlers({ accounts }),
    ...passwordHandlers({ passwords, cookies }),
    ...mfaHandlers({ mfa, cookies }),
    ...selectionHandlers({ identity: auth.identity, sessions, limiter, cookies }),
    ...platformMerchantHandlers({ lifecycle: new MerchantLifecycleService({ db, audit }) }),
    ...merchantHandlers({
      settings,
      members: new MembershipService({ db, audit }),
      invitations,
    }),
    ...invitationAcceptHandlers({ invitations }),
    ...agentHandlers({ identity: auth.identity, sessions, limiter, settings }),
  };

  // All endpoints are versioned (§17) and come from the contract registry (packages/contracts).
  app.use(
    API_PREFIX,
    buildV1Router(
      handlers,
      (endpoint) => authenticate(endpoint, { ...auth, logger }),
      (endpoint) => authorize(endpoint, { audit, logger }),
    ),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
