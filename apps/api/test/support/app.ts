import { FakeProvider } from '../../src/integrations/payments/fake-provider.js';
import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import { afterAll, inject } from 'vitest';
import { AccessTokens } from '../../src/modules/identity/access-tokens.js';
import { IdentityRepository } from '../../src/modules/identity/repository.js';
import { createDb } from '../../src/platform/db.js';
import { InMemoryEmailSender } from '../../src/platform/email.js';
import type { AuthDeps } from '../../src/platform/http/authenticate.js';
import { createApp, type AppDeps } from '../../src/platform/http/app.js';
import { newSigningJwk } from './keys.js';
import { honourRequestId } from './request-id.js';

export const TEST_WEB_ORIGIN = 'https://app.alphakolect.test';
export const TEST_WEB_APP_URL = TEST_WEB_ORIGIN;
/** A throwaway TOTP-secret encryption key for the test run. */
export const TEST_MFA_KEY = { kid: 'test-mfa', key: randomBytes(32) };

/**
 * The real app wired to the run's test database (as alphakolect_app) and a throwaway signing key.
 * Call at module level in a test file; the pool is closed after the file's tests. It takes a plain caller-supplied
 * X-Request-ID, so a test can find its request's activity rows (support/request-id.ts); `serverRequestIds` builds it
 * as production does, ignoring the header (§8.6).
 */
export async function createTestApp({
  serverRequestIds = false,
  ...options
}: Partial<Pick<AppDeps, 'trustProxy' | 'signupGuard' | 'email' | 'logger'>> & {
  serverRequestIds?: boolean;
} = {}) {
  const db = createDb(inject('apiDatabaseUrl'));
  afterAll(() => db.close());
  const auth: AuthDeps = {
    accessTokens: await AccessTokens.create({
      issuer: 'alphakolect-api',
      signingKey: await newSigningJwk('test'),
    }),
    identity: new IdentityRepository(db),
    webOrigins: new Set([TEST_WEB_ORIGIN]),
  };
  const email = new InMemoryEmailSender();
  const app = createApp({
    // Silent by default; API_TEST_LOG_LEVEL=error shows the cause of any unexpected 500 while investigating.
    logger: pino({ level: process.env.API_TEST_LOG_LEVEL ?? 'silent' }),
    db,
    auth,
    email,
    webAppUrl: TEST_WEB_APP_URL,
    paymentProvider: new FakeProvider(),
    mfaEncryption: { current: TEST_MFA_KEY },
    ...(serverRequestIds ? {} : { requestId: honourRequestId }),
    ...options,
  });
  return { app, db, auth, email };
}
