import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { connectionConfig, connectionUrl, dbTestEnv } from './env.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bootstrapDir = path.join(packageDir, 'sql/bootstrap');
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

/** Apply the cluster-level role bootstrap exactly as operators do (roles.sql), as the superuser. */
export async function bootstrapRoles(): Promise<void> {
  const env = dbTestEnv();
  const admin = new pg.Client(connectionConfig('superuser', 'postgres'));
  await admin.connect();
  try {
    await admin.query(
      `SELECT set_config('alphakolect.migrator_password', $1, false),
              set_config('alphakolect.app_password', $2, false),
              set_config('alphakolect.readonly_password', $3, false)`,
      [env.passwords.migrator, env.passwords.app, env.passwords.readonly],
    );
    await admin.query(readFileSync(path.join(bootstrapDir, 'roles.sql'), 'utf8'));
  } finally {
    await admin.end();
  }
}

/** Create an empty, uniquely named database and apply database.sql to it. */
export async function createTestDatabase(): Promise<string> {
  const name = `alphakolect_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client(connectionConfig('superuser', 'postgres'));
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const db = new pg.Client(connectionConfig('superuser', name));
  await db.connect();
  try {
    await db.query(readFileSync(path.join(bootstrapDir, 'database.sql'), 'utf8'));
  } finally {
    await db.end();
  }
  return name;
}

export async function dropTestDatabase(name: string): Promise<void> {
  const admin = new pg.Client(connectionConfig('superuser', 'postgres'));
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/** Run the real `prisma migrate deploy` as alphakolect_migrator. Returns combined output. */
export function migrateDeploy(database: string): string {
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_MIGRATOR_URL: connectionUrl('migrator', database) },
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed (exit ${result.status}):\n${output}`);
  }
  return output;
}
