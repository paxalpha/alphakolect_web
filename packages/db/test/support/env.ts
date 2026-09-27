// Connection settings for the database tests. Values come from the environment; locally
// vitest.config.ts loads infrastructure/.env (gitignored). Nothing here has a secret default.

export type Role = 'superuser' | 'migrator' | 'app' | 'readonly';

export const ROLE_NAMES: Record<Exclude<Role, 'superuser'>, string> = {
  migrator: 'alphakolect_migrator',
  app: 'alphakolect_app',
  readonly: 'alphakolect_readonly',
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Start the local database (infrastructure/compose.yaml) with infrastructure/.env, ` +
        'or set the DB test variables (see packages/db/README.md).',
    );
  }
  return value;
}

export function dbTestEnv() {
  return {
    host: process.env.DB_TEST_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_TEST_PORT ?? 5436),
    superuser: process.env.POSTGRES_USER ?? 'alphakolect',
    passwords: {
      superuser: required('POSTGRES_PASSWORD'),
      migrator: required('DB_MIGRATOR_PASSWORD'),
      app: required('DB_APP_PASSWORD'),
      readonly: required('DB_READONLY_PASSWORD'),
    },
  };
}

export function connectionConfig(role: Role, database: string) {
  const env = dbTestEnv();
  return {
    host: env.host,
    port: env.port,
    database,
    user: role === 'superuser' ? env.superuser : ROLE_NAMES[role],
    password: env.passwords[role],
  };
}

export function connectionUrl(role: Role, database: string): string {
  const c = connectionConfig(role, database);
  return `postgresql://${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${database}`;
}
