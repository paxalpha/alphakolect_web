import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { connectionConfig } from './env.js';
import { loadFixtures } from './fixtures.js';
import { bootstrapRoles, createTestDatabase, dropTestDatabase, migrateDeploy } from './setup-db.js';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabase: string;
  }
}

// One throwaway database per test run: bootstrap roles → empty database → every migration applied
// from zero by the migrator → test-only fixtures → tests → database dropped.
export default async function setup(project: TestProject) {
  await bootstrapRoles();
  const database = await createTestDatabase();
  try {
    migrateDeploy(database);

    const owner = new pg.Client(connectionConfig('migrator', database));
    await owner.connect();
    try {
      await loadFixtures(owner);
    } finally {
      await owner.end();
    }
  } catch (err) {
    await dropTestDatabase(database);
    throw err;
  }

  project.provide('testDatabase', database);

  return async () => {
    await dropTestDatabase(database);
  };
}
