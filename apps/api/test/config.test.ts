import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/platform/config.js';
import { newSigningJwk } from './support/keys.js';

// Test fixtures only; not real credentials.
const DATABASE_URL = 'postgresql://user:s3cret-value@127.0.0.1:5436/alphakolect'; // gitleaks:allow
let valid: Record<string, string>;

beforeAll(async () => {
  valid = {
    DATABASE_URL,
    AUTH_SIGNING_JWK: JSON.stringify(await newSigningJwk('test-key')),
    MFA_ENCRYPTION_KEY: `mfa-1:${randomBytes(32).toString('base64')}`,
  };
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
    expect(config.auth.mfaEncryptionKey.kid).toBe('mfa-1');
    expect(config.auth.mfaEncryptionKey.key).toHaveLength(32);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('refuses to load without its required secrets', () => {
    expect(problemsOf({}).problems).toEqual([
      'DATABASE_URL is required',
      'AUTH_SIGNING_JWK is required',
      'MFA_ENCRYPTION_KEY is required',
    ]);
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

  it.each([
    ['without a kid', 'do-not-print-this-key-material'],
    ['with a 16-byte key', `k:${Buffer.from('do-not-print-me!').toString('base64')}`],
  ])('rejects MFA_ENCRYPTION_KEY %s, without echoing it', (_label, value) => {
    const { problems, message } = problemsOf({ ...valid, MFA_ENCRYPTION_KEY: value });
    expect(problems).toEqual(['MFA_ENCRYPTION_KEY must be "<kid>:<base64 of 32 bytes>"']);
    expect(message).not.toContain('do-not-print');
  });

  it('reports every invalid variable at once', () => {
    const names = problemsOf({ PORT: '70000', LOG_LEVEL: 'loud', NODE_ENV: 'staging' })
      .problems.map((p) => p.split(' ')[0])
      .sort();
    expect(names).toEqual([
      'AUTH_SIGNING_JWK',
      'DATABASE_URL',
      'LOG_LEVEL',
      'MFA_ENCRYPTION_KEY',
      'NODE_ENV',
      'PORT',
    ]);
  });

  it('defaults email to local Mailpit and links to a local web app outside production', () => {
    const config = loadConfig(valid);
    expect(config.email.smtpUrl).toBe('smtp://127.0.0.1:1025');
    expect(config.email.from).toMatch(/@/);
    expect(config.webAppUrl).toBe('http://localhost:3000');
  });

  it('P9: the provider’s keys are required with TransactPay; production refuses the fake and customer wallets (OPEN-12)', () => {
    expect(problemsOf({ ...valid, PAYMENT_PROVIDER: 'transactpay' }).problems).toEqual([
      'TRANSACTPAY_BASE_URL is required when PAYMENT_PROVIDER is transactpay',
      'TRANSACTPAY_PUBLIC_KEY is required when PAYMENT_PROVIDER is transactpay',
      'TRANSACTPAY_SECRET_KEY is required when PAYMENT_PROVIDER is transactpay',
      'TRANSACTPAY_ENCRYPTION_KEY_BASE64 is required when PAYMENT_PROVIDER is transactpay',
    ]);
    const live = {
      ...valid,
      NODE_ENV: 'production',
      SMTP_URL: 'smtp://mail.example.test:25',
      MAIL_FROM: 'AlphaKolect <no-reply@example.test>',
      WEB_APP_URL: 'https://app.example.test',
    };
    expect(problemsOf(live).problems).toEqual(['PAYMENT_PROVIDER must be transactpay in production']);
    expect(
      problemsOf({
        ...live,
        PAYMENT_PROVIDER: 'transactpay',
        TRANSACTPAY_BASE_URL: 'https://tp.example.test',
        TRANSACTPAY_PUBLIC_KEY: 'p',
        TRANSACTPAY_SECRET_KEY: 's',
        TRANSACTPAY_ENCRYPTION_KEY_BASE64: 'e',
        CUSTOMER_LIVE_WALLETS: 'true',
      }).problems,
    ).toEqual([
      'CUSTOMER_LIVE_WALLETS must be false in production until custody is settled in writing (OPEN-12)',
    ]);
  });

  it('requires the email settings and the web app URL in production', () => {
    expect(problemsOf({ ...valid, NODE_ENV: 'production' }).problems).toEqual([
      'PAYMENT_PROVIDER must be transactpay in production',
      'SMTP_URL is required in production',
      'MAIL_FROM is required in production',
      'WEB_APP_URL is required in production',
    ]);
    const config = loadConfig({
      ...valid,
      NODE_ENV: 'production',
      SMTP_URL: 'smtps://mailer:pw@smtp.example.com:465', // gitleaks:allow
      MAIL_FROM: 'AlphaKolect <no-reply@alphakolect.com>',
      WEB_APP_URL: 'https://app.alphakolect.com/',
      PAYMENT_PROVIDER: 'transactpay',
      TRANSACTPAY_BASE_URL: 'https://tp.example.test',
      TRANSACTPAY_PUBLIC_KEY: 'p',
      TRANSACTPAY_SECRET_KEY: 's',
      TRANSACTPAY_ENCRYPTION_KEY_BASE64: 'e',
    });
    expect(config.webAppUrl).toBe('https://app.alphakolect.com');
  });

  it('rejects a non-SMTP SMTP_URL without echoing it, and a WEB_APP_URL with a path', () => {
    const { problems, message } = problemsOf({
      ...valid,
      SMTP_URL: 'https://user:do-not-print-me@mail.example.com', // gitleaks:allow
      WEB_APP_URL: 'https://app.alphakolect.com/login',
    });
    expect(problems.map((p) => p.split(' ')[0])).toEqual(['SMTP_URL', 'WEB_APP_URL']);
    expect(message).not.toContain('do-not-print-me');
  });

  it('trusts only reverse proxies named by address (default: this host)', () => {
    expect(loadConfig(valid).trustProxy).toEqual(['loopback']);
    expect(loadConfig({ ...valid, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(
      loadConfig({ ...valid, TRUST_PROXY: 'loopback, 10.0.0.5, 192.168.10.0/24, fd00::/8' }).trustProxy,
    ).toEqual(['loopback', '10.0.0.5', '192.168.10.0/24', 'fd00::/8']);
  });

  it.each([
    ['a hop count (trusts whoever connects)', '1'],
    ['another hop count', '2'],
    ['a broad named range', 'uniquelocal'],
    ['an impossible prefix', '10.0.0.0/33'],
    ['not an address', 'nginx.internal'],
    ['empty', ' '],
  ])('rejects TRUST_PROXY as %s', (_label, value) => {
    expect(problemsOf({ ...valid, TRUST_PROXY: value }).problems).toEqual([
      expect.stringMatching(/^TRUST_PROXY must be "false", or a comma-separated list/),
    ]);
  });

  it('accepts a cookie domain and rejects look-alikes', () => {
    expect(loadConfig({ ...valid, COOKIE_DOMAIN: '.alphakolect.com' }).cookieDomain).toBe('.alphakolect.com');
    for (const bad of ['alphakolect_com', '.alphakolectXcom', 'https://alphakolect.com']) {
      expect(problemsOf({ ...valid, COOKIE_DOMAIN: bad }).problems[0], bad).toMatch(/^COOKIE_DOMAIN/);
    }
  });
});
