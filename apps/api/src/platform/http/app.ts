import type { IncomingMessage } from 'node:http';
import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { AuditLog } from '../../modules/audit/audit-log.js';
import { healthHandlers } from '../../modules/health/routes.js';
import { AccountService, type SignupGuard } from '../../modules/identity/accounts.js';
import { agentHandlers } from '../../modules/identity/agent-routes.js';
import { customerAuthHandlers } from '../../modules/identity/customer-routes.js';
import { CustomerService } from '../../modules/customers/service.js';
import { customerHandlers } from '../../modules/customers/routes.js';
import { SavingsService } from '../../modules/savings/service.js';
import { savingsHandlers } from '../../modules/savings/routes.js';
import { PaymentsService } from '../../modules/payments/service.js';
import { paymentHandlers } from '../../modules/payments/routes.js';
import type { PaymentProvider } from '../../integrations/payments/provider.js';
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
import { LedgerService } from '../../modules/ledger/service.js';
import { ledgerHandlers } from '../../modules/ledger/routes.js';
import { AuditReadService } from '../../modules/audit/reads.js';
import { auditReadHandlers } from '../../modules/audit/routes.js';
import { PlatformMerchantListService } from '../../modules/platform/merchant-lists.js';
import { platformMerchantListHandlers, platformStaffHandlers } from '../../modules/platform/routes.js';
import { PlatformStaffService } from '../../modules/platform/staff.js';
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
import { IdempotencyStore } from '../idempotency.js';
import { HTTP_LOG_SERIALIZERS, routeProps } from '../logger.js';
import { authenticate, type AuthDeps } from './authenticate.js';
import { errorHandler, notFoundHandler } from './error-handler.js';
import { serverRequestId, type RequestIdSource } from './request-id.js';
import { API_PREFIX, buildV1Router } from './routes.js';

type RawBodyRequest = IncomingMessage & { rawBody?: string };

export type AppDeps = {
  logger: Logger;
  db: Db;
  /** The payment provider the webhook and the Platform Live wallet name (P9). */
  paymentProvider: PaymentProvider;
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
  /** How a request gets its id: the server's own, always (§8.6). Only the tests' app passes another. */
  requestId?: RequestIdSource;
};

export function createApp({
  logger,
  db,
  auth,
  paymentProvider,
  cookieDomain,
  trustProxy = ['loopback'],
  email,
  webAppUrl,
  signupGuard,
  mfaEncryption,
  requestId = serverRequestId,
}: AppDeps): Express {
  const app = express();
  // An array of addresses/subnets (never a hop count): see TrustedProxies.
  app.set('trust proxy', trustProxy === false ? false : [...trustProxy]);

  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: requestId,
      // The allowlist (§8.6): id, method, matched route and status — no path as sent, header, query string or
      // remote address.
      serializers: HTTP_LOG_SERIALIZERS,
      customProps: (req) => routeProps(req),
      // Health probes are frequent and uninteresting.
      autoLogging: { ignore: (req) => req.url === '/v1/health' },
    }),
  );
  app.use(
    express.json({
      limit: '100kb',
      // A provider's notification is kept as it arrived (TA-8).
      verify: (req, _res, buf) => {
        if (req.url?.includes('/webhooks/')) (req as RawBodyRequest).rawBody = buf.toString('utf8');
      },
    }),
  );

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
  const customers = new CustomerService({ db, identity: auth.identity, audit, limiter, mailer, webAppUrl });
  const savings = new SavingsService({ db, audit });
  const payments = new PaymentsService({ db, audit, limiter, provider: paymentProvider });
  const handlers = {
    ...healthHandlers,
    ...authHandlers({ sessions, cookies, webOrigins: auth.webOrigins }),
    ...accountHandlers({ accounts }),
    ...passwordHandlers({ passwords, cookies }),
    ...mfaHandlers({ mfa, cookies }),
    ...selectionHandlers({ identity: auth.identity, sessions, limiter, cookies }),
    ...platformMerchantHandlers({ lifecycle: new MerchantLifecycleService({ db, audit }) }),
    ...platformStaffHandlers({ staff: new PlatformStaffService({ db, audit, mailer, webAppUrl }) }),
    ...platformMerchantListHandlers({ lists: new PlatformMerchantListService({ db, audit }) }),
    ...auditReadHandlers({ reads: new AuditReadService({ db, audit }) }),
    ...merchantHandlers({
      settings,
      members: new MembershipService({ db, audit }),
      invitations,
    }),
    ...invitationAcceptHandlers({ invitations }),
    ...agentHandlers({ identity: auth.identity, sessions, limiter, settings }),
    ...customerAuthHandlers({ identity: auth.identity, sessions, limiter }),
    ...customerHandlers({ customers }),
    ...savingsHandlers({ savings }),
    ...paymentHandlers({ payments }),
    ...ledgerHandlers({ books: new LedgerService({ db, audit, idempotency: new IdempotencyStore(db) }) }),
  };

  // All endpoints are versioned (§17) and come from the contract registry (packages/contracts).
  app.use(
    API_PREFIX,
    buildV1Router(
      handlers,
      (endpoint) => authenticate(endpoint, { ...auth, logger }),
      (endpoint) =>
        authorize(endpoint, {
          audit,
          logger,
          branchResolvers: { ...customers.branchResolvers(), ...savings.branchResolvers() },
        }),
    ),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
