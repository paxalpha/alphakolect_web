import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/platform/config.js';
import { newSigningJwk } from './support/keys.js';

// Test fixtures only; not real credentials.
const DATABASE_URL = 'postgresql://user:s3cret-value@127.0.0.1:5436/alphakolect'; // gitleaks:allow
let valid: Record<string, string>;

beforeAll(async () => {
  valid = { DATABASE_URL, AUTH_SIGNING_JWK: JSON.stringify(await newSigningJwk('test-key')) };
});

const problemsOf = (env: Record<string, string | undefined>) => {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return { problems: (err as ConfigError).problems, message: (err as Error).message };
  }
  throw new Error('expected loadConfig to throw');
};

describe('loadConfig', () => {
  it('applies safe defaults for non-secret settings', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({ nodeEnv: 'development', port: 4000, logLevel: 'info' });
    expect(config.auth.issuer).toBe('alphakolect-api');
    expect(config.auth.signingKey.kid).toBe('test-key');
    expect(config.auth.previousSigningKey).toBeUndefined();
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('refuses to load without its required secrets', () => {
    expect(problemsOf({}).problems).toEqual(['DATABASE_URL is required', 'AUTH_SIGNING_JWK is required']);
  });

  it('rejects a non-postgres DATABASE_URL without echoing the value', () => {
    const secretish = 'mysql://root:do-not-print-me@db/app'; // gitleaks:allow
    const { message } = problemsOf({ ...valid, DATABASE_URL: secretish });
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('do-not-print-me');
  });

  it.each([
    ['not JSON', 'do-not-print-this-key-material'],
    ['an RSA key', JSON.stringify({ kty: 'RSA', n: 'do-not-print-this-key-material', e: 'AQAB', kid: 'x' })],
    [
      'an Ed25519 key without a kid',
      JSON.stringify({ kty: 'OKP', crv: 'Ed25519', d: 'do-not-print-this-key-material', x: 'y' }),
    ],
  ])('rejects AUTH_SIGNING_JWK that is %s, without echoing it', (_label, value) => {
    const { problems, message } = problemsOf({ ...valid, AUTH_SIGNING_JWK: value });
    expect(problems.every((p) => p.startsWith('AUTH_SIGNING_JWK'))).toBe(true);
    expect(message).not.toContain('do-not-print-this-key-material');
  });

  it('reports every invalid variable at once', () => {
    const names = problemsOf({ PORT: '70000', LOG_LEVEL: 'loud', NODE_ENV: 'staging' })
      .problems.map((p) => p.split(' ')[0])
      .sort();
    expect(names).toEqual(['AUTH_SIGNING_JWK', 'DATABASE_URL', 'LOG_LEVEL', 'NODE_ENV', 'PORT']);
  });
});
