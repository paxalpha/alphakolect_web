import { isIP } from 'node:net';
import { z } from 'zod';

// All configuration comes from the environment and is validated at startup (TARGET_ARCHITECTURE §22).
// Missing or invalid required values => refuse to boot. There are no secret defaults.

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: 'must be a postgres:// or postgresql:// URL',
});

/** An Ed25519 private key as a JWK with a key id (ADR-14 D6). Given as single-line JSON in the environment. */
const Ed25519PrivateJwk = z.object({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  d: z.string().min(1),
  x: z.string().min(1),
  kid: z.string().min(1).max(64),
});
export type Ed25519PrivateJwk = z.infer<typeof Ed25519PrivateJwk>;

const jsonJwk = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be a JSON Ed25519 private JWK with a kid' });
      return z.NEVER;
    }
  })
  .pipe(Ed25519PrivateJwk);

/** "<kid>:<base64 of exactly 32 random bytes>" — an AES-256 key for MFA secrets at rest (ADR-14 D8). */
const encryptionKey = z.string().transform((value, ctx) => {
  const match = /^([A-Za-z0-9._-]{1,64}):([A-Za-z0-9+/=_-]+)$/.exec(value);
  const key = match ? Buffer.from(match[2]!, 'base64') : undefined;
  if (!match || !key || key.length !== 32) {
    ctx.addIssue({ code: 'custom', message: 'must be "<kid>:<base64 of 32 bytes>"' });
    return z.NEVER;
  }
  return { kid: match[1]!, key };
});

/** Comma-separated web origins (scheme://host[:port]) allowed to make cookie-authenticated state changes. */
const originList = z
  .string()
  .default('')
  .transform((value, ctx) => {
    const origins = value
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    for (const origin of origins) {
      let parsed: URL | undefined;
      try {
        parsed = new URL(origin);
      } catch {
        parsed = undefined;
      }
      if (!parsed || parsed.origin !== origin) {
        ctx.addIssue({
          code: 'custom',
          message: 'must be comma-separated origins like https://app.example.com',
        });
        return z.NEVER;
      }
    }
    return new Set(origins) as ReadonlySet<string>;
  });

/**
 * Reverse proxies whose X-Forwarded-For is believed (rate-limit keys, audit IPs). Only proxies named by address
 * are trusted: "loopback" (a proxy on this host, e.g. nginx) and/or explicit IPs or CIDR subnets. Hop counts are
 * deliberately not accepted — they trust whoever connects, so a client reaching the listener directly could
 * forge its IP. "false" trusts nobody (the client IP is the TCP peer).
 */
export type TrustedProxies = false | readonly string[];

const proxyEntry = (entry: string): boolean => {
  if (entry === 'loopback') return true;
  const [address, prefix, extra] = entry.split('/');
  const family = isIP(address ?? '');
  if (!family || extra !== undefined) return false;
  if (prefix === undefined) return true;
  const bits = Number(prefix);
  return /^\d+$/.test(prefix) && bits >= 0 && bits <= (family === 4 ? 32 : 128);
};

const trustedProxies = z
  .string()
  .default('loopback')
  .transform((value, ctx): TrustedProxies => {
    if (value.trim() === 'false') return false;
    const entries = value
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (entries.length === 0 || !entries.every(proxyEntry)) {
      ctx.addIssue({
        code: 'custom',
        message: 'must be "false", or a comma-separated list of "loopback", IP addresses and CIDR subnets',
      });
      return z.NEVER;
    }
    return Object.freeze(entries);
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Required now so every environment is wired to its own database before P1 lands.
  DATABASE_URL: postgresUrl,
  // The worker's own connection, as alphakolect_worker (P9-R1). Only the worker reads it, and refuses to start without.
  WORKER_DATABASE_URL: postgresUrl.optional(),
  // Access-token signing (ADR-14 D6): the current key signs; the previous one (if set) still verifies.
  AUTH_SIGNING_JWK: jsonJwk,
  AUTH_SIGNING_JWK_PREVIOUS: jsonJwk.optional(),
  AUTH_ISSUER: z.string().min(1).default('alphakolect-api'),
  // MFA secret encryption at rest (ADR-14 D8); the previous key (if set) still decrypts.
  MFA_ENCRYPTION_KEY: encryptionKey,
  MFA_ENCRYPTION_KEY_PREVIOUS: encryptionKey.optional(),
  // CSRF defence (ADR-14 D7): empty means no origin may make cookie-authenticated state changes.
  WEB_ORIGINS: originList,
  // Cookie Domain for the web session cookies (production: .alphakolect.com); unset = host-only (D7).
  COOKIE_DOMAIN: z
    .string()
    .regex(/^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'must be a domain such as .alphakolect.com')
    .optional(),
  // Reverse proxies trusted for the client IP (rate limits, audit): by address only. Default: a proxy on this host.
  TRUST_PROXY: trustedProxies,
  // Outgoing email (ADR-14 D1). May contain credentials; never logged. Default (not in production): local Mailpit.
  SMTP_URL: z.url({ protocol: /^smtps?$/, error: 'must be an smtp:// or smtps:// URL' }).optional(),
  MAIL_FROM: z.string().min(3).max(200).optional(),
  // The web app that serves the links in emails (verify email, reset password). Default (not in production): local.
  WEB_APP_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s):// URL' })
    .refine((v) => new URL(v).pathname === '/' && !new URL(v).search && !new URL(v).hash, {
      message: 'must be an origin such as https://app.alphakolect.com, without a path',
    })
    .optional(),
  // Payments (P9). The provider the worker and the webhook use; its keys are required when it is TransactPay. The fake
  // is refused in production.
  PAYMENT_PROVIDER: z.enum(['fake', 'transactpay']).default('fake'),
  TRANSACTPAY_BASE_URL: z.url({ protocol: /^https$/, error: 'must be an https:// URL' }).optional(),
  TRANSACTPAY_PUBLIC_KEY: z.string().min(1).optional(),
  TRANSACTPAY_SECRET_KEY: z.string().min(1).optional(),
  TRANSACTPAY_ENCRYPTION_KEY_BASE64: z.string().min(1).optional(),
});

/** Settings that have a convenient local default but must be set explicitly in production. */
const LOCAL_DEFAULTS = {
  SMTP_URL: 'smtp://127.0.0.1:1025',
  MAIL_FROM: 'AlphaKolect <no-reply@alphakolect.local>',
  WEB_APP_URL: 'http://localhost:3000',
} as const;

const EnvSchemaWithProductionRules = EnvSchema.superRefine((e, ctx) => {
  if (e.PAYMENT_PROVIDER === 'transactpay') {
    for (const name of [
      'TRANSACTPAY_BASE_URL',
      'TRANSACTPAY_PUBLIC_KEY',
      'TRANSACTPAY_SECRET_KEY',
      'TRANSACTPAY_ENCRYPTION_KEY_BASE64',
    ] as const) {
      if (e[name] === undefined)
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'is required when PAYMENT_PROVIDER is transactpay',
        });
    }
  }
  if (e.NODE_ENV !== 'production') return;
  if (e.PAYMENT_PROVIDER === 'fake')
    ctx.addIssue({
      code: 'custom',
      path: ['PAYMENT_PROVIDER'],
      message: 'must be transactpay in production',
    });
  for (const name of Object.keys(LOCAL_DEFAULTS) as Array<keyof typeof LOCAL_DEFAULTS>) {
    if (e[name] === undefined)
      ctx.addIssue({ code: 'custom', path: [name], message: 'is required in production' });
  }
});

export type Config = Readonly<{
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  databaseUrl: string;
  workerDatabaseUrl: string | undefined;
  webOrigins: ReadonlySet<string>;
  cookieDomain: string | undefined;
  trustProxy: TrustedProxies;
  email: Readonly<{ smtpUrl: string; from: string }>;
  /** Origin of the web app, for links in emails. */
  webAppUrl: string;
  payments: Readonly<{
    provider: 'fake' | 'transactpay';
    transactPay?: Readonly<{ baseUrl: string; publicKey: string; secretKey: string; encryptionKey: string }>;
  }>;
  auth: Readonly<{
    issuer: string;
    signingKey: Ed25519PrivateJwk;
    previousSigningKey?: Ed25519PrivateJwk;
    mfaEncryptionKey: Readonly<{ kid: string; key: Buffer }>;
    previousMfaEncryptionKey?: Readonly<{ kid: string; key: Buffer }>;
  }>;
}>;

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Parse and validate configuration. Error messages name the variable and the rule
 * but never include the supplied value, so secrets cannot leak into logs.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchemaWithProductionRules.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.join('.') || '(root)';
      // Environment values are always strings, so a type error means the variable is missing.
      const reason = issue.code === 'invalid_type' ? 'is required' : issue.message;
      return `${name} ${reason}`;
    });
    throw new ConfigError(problems);
  }

  const e = result.data;
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    workerDatabaseUrl: e.WORKER_DATABASE_URL,
    webOrigins: e.WEB_ORIGINS,
    cookieDomain: e.COOKIE_DOMAIN,
    trustProxy: e.TRUST_PROXY,
    email: Object.freeze({
      smtpUrl: e.SMTP_URL ?? LOCAL_DEFAULTS.SMTP_URL,
      from: e.MAIL_FROM ?? LOCAL_DEFAULTS.MAIL_FROM,
    }),
    webAppUrl: new URL(e.WEB_APP_URL ?? LOCAL_DEFAULTS.WEB_APP_URL).origin,
    payments: Object.freeze({
      provider: e.PAYMENT_PROVIDER,
      ...(e.PAYMENT_PROVIDER === 'transactpay'
        ? {
            transactPay: Object.freeze({
              baseUrl: e.TRANSACTPAY_BASE_URL!,
              publicKey: e.TRANSACTPAY_PUBLIC_KEY!,
              secretKey: e.TRANSACTPAY_SECRET_KEY!,
              encryptionKey: e.TRANSACTPAY_ENCRYPTION_KEY_BASE64!,
            }),
          }
        : {}),
    }),
    auth: Object.freeze({
      issuer: e.AUTH_ISSUER,
      signingKey: e.AUTH_SIGNING_JWK,
      ...(e.AUTH_SIGNING_JWK_PREVIOUS ? { previousSigningKey: e.AUTH_SIGNING_JWK_PREVIOUS } : {}),
      mfaEncryptionKey: e.MFA_ENCRYPTION_KEY,
      ...(e.MFA_ENCRYPTION_KEY_PREVIOUS ? { previousMfaEncryptionKey: e.MFA_ENCRYPTION_KEY_PREVIOUS } : {}),
    }),
  });
}
