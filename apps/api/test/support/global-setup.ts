import {
  bootstrapRoles,
  connectionUrl,
  createTestDatabase,
  dropTestDatabase,
  migrateDeploy,
} from '@alphakolect/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The API's connection: the least-privilege alphakolect_app role. */
    apiDatabaseUrl: string;
    /** The worker's connection: alphakolect_worker (P9-R1). */
    workerDatabaseUrl: string;
    /** Table-owner connection, for test setup and assertions only. */
    ownerDatabaseUrl: string;
  }
}

// One throwaway database per API test run, built exactly as in production: roles bootstrapped, every
// migration applied from zero by the migrator (the same harness as packages/db).
export default async function setup(project: TestProject) {
  await bootstrapRoles();
  const database = await createTestDatabase();
  try {
    migrateDeploy(database);
  } catch (err) {
    await dropTestDatabase(database);
    throw err;
  }
  project.provide('apiDatabaseUrl', connectionUrl('app', database));
  project.provide('workerDatabaseUrl', connectionUrl('worker', database));
  project.provide('ownerDatabaseUrl', connectionUrl('migrator', database));
  return async () => {
    await dropTestDatabase(database);
  };
}
