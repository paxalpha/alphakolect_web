import { pino } from 'pino';
import { afterAll, inject } from 'vitest';
import { AccessTokens } from '../../src/modules/identity/access-tokens.js';
import { IdentityRepository } from '../../src/modules/identity/repository.js';
import { createDb } from '../../src/platform/db.js';
import type { AuthDeps } from '../../src/platform/http/authenticate.js';
import { createApp } from '../../src/platform/http/app.js';
import { newSigningJwk } from './keys.js';

export const TEST_WEB_ORIGIN = 'https://app.alphakolect.test';

/**
 * The real app wired to the run's test database (as alphakolect_app) and a throwaway signing key.
 * Call at module level in a test file; the pool is closed after the file's tests.
 */
export async function createTestApp() {
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
  const app = createApp({ logger: pino({ level: 'silent' }), auth });
  return { app, db, auth };
}
