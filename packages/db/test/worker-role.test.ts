import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { connectionConfig } from './support/env.js';
import { bootstrapRoles } from './support/setup-db.js';

// The worker's role (P9 plan §16.4 conditions 9 and 10): the role bootstrap strips any membership it finds, so a re-run restores
// what a fresh cluster has, and the operator's check (sql/checks/worker-role.sql) passes on a good role and names what is wrong on
// a bad one. Files run one at a time in this package, so a membership made here is seen by no other test.

const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql');
const check = readFileSync(path.join(sqlDir, 'checks/worker-role.sql'), 'utf8');

let admin: pg.Client;
let inDatabase: pg.Client;
const extraRoles: string[] = [];

const memberships = async () =>
  (
    await admin.query(
      `SELECT count(*)::int AS n FROM pg_auth_members m JOIN pg_roles r ON r.oid IN (m.member, m.roleid)
        WHERE r.rolname = 'alphakolect_worker'`,
    )
  ).rows[0].n as number;

beforeAll(async () => {
  admin = new pg.Client(connectionConfig('superuser', 'postgres'));
  await admin.connect();
  inDatabase = new pg.Client(connectionConfig('superuser', inject('testDatabase')));
  await inDatabase.connect();
});
afterAll(async () => {
  // Leave the role as a fresh cluster has it, and drop what this file made.
  await admin.query(`REVOKE pg_read_all_data FROM alphakolect_worker`).catch(() => undefined);
  for (const role of extraRoles) await admin.query(`DROP ROLE IF EXISTS "${role}"`);
  await admin.end();
  await inDatabase.end();
});

describe('the role bootstrap and the worker', () => {
  it('a fresh cluster: no memberships either way, and the operator’s check passes', async () => {
    expect(await memberships()).toBe(0);
    await expect(inDatabase.query(check)).resolves.toBeDefined();
  });

  it('a membership in a built-in role, and a role made a member of it, are both revoked by re-running the bootstrap', async () => {
    const stray = `zz_worker_member_${randomBytes(4).toString('hex')}`;
    extraRoles.push(stray);
    await admin.query(`CREATE ROLE "${stray}" NOLOGIN`);
    await admin.query(`GRANT pg_read_all_data TO alphakolect_worker`);
    await admin.query(`GRANT alphakolect_worker TO "${stray}"`);
    expect(await memberships()).toBe(2);

    // The operator's check names what is wrong, and prints nothing of any credential.
    const failure = await inDatabase.query(check).then(
      () => null,
      (err: Error) => err.message,
    );
    expect(failure).toMatch(/^alphakolect_worker has role memberships: /);
    expect(failure).toContain('pg_read_all_data');
    expect(failure).toContain(stray);

    await bootstrapRoles();
    expect(await memberships()).toBe(0);
    await expect(inDatabase.query(check)).resolves.toBeDefined();
    // Idempotent, and the other roles and the worker's attributes are as they were.
    await bootstrapRoles();
    expect(await memberships()).toBe(0);
    expect(
      (
        await admin.query(
          `SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication
             FROM pg_roles WHERE rolname = 'alphakolect_worker'`,
        )
      ).rows[0],
    ).toEqual({
      rolcanlogin: true,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
      rolreplication: false,
    });
  });

  it('the check also refuses a privilege on a table, and a right to create objects', async () => {
    await inDatabase.query(`CREATE SCHEMA zz_worker_check`);
    try {
      await inDatabase.query(`CREATE TABLE zz_worker_check.t (id int)`);
      await inDatabase.query(`GRANT USAGE ON SCHEMA zz_worker_check TO alphakolect_worker`);
      await inDatabase.query(`GRANT SELECT ON zz_worker_check.t TO alphakolect_worker`);
      let message = await inDatabase.query(check).then(
        () => null,
        (err: Error) => err.message,
      );
      expect(message).toMatch(/^alphakolect_worker has privileges on: zz_worker_check\.t/);
      await inDatabase.query(`REVOKE SELECT ON zz_worker_check.t FROM alphakolect_worker`);
      await inDatabase.query(`GRANT CREATE ON SCHEMA zz_worker_check TO alphakolect_worker`);
      message = await inDatabase.query(check).then(
        () => null,
        (err: Error) => err.message,
      );
      expect(message).toMatch(/^alphakolect_worker can create objects in schemas: zz_worker_check/);
    } finally {
      await inDatabase.query(`DROP SCHEMA zz_worker_check CASCADE`);
    }
    await expect(inDatabase.query(check)).resolves.toBeDefined();
  });
});
