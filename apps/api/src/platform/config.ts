import { z } from 'zod';

// All configuration comes from the environment and is validated at startup (TARGET_ARCHITECTURE §22).
// Missing or invalid required values => refuse to boot. There are no secret defaults.

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: 'must be a postgres:// or postgresql:// URL',
});

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Required now so every environment is wired to its own database before P1 lands.
  DATABASE_URL: postgresUrl,
});

export type Config = Readonly<{
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  databaseUrl: string;
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
  const result = EnvSchema.safeParse(env);
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
  });
}
