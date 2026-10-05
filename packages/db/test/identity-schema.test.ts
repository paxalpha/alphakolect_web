import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';
import { FIXTURE } from './support/fixtures.js';

// P3 identity schema (ADR-14 D4): the app and readonly roles have NO direct access to identity data.
// Tests connect as the real roles and try anyway.

let app: pg.Client;
let readonly: pg.Client;
let owner: pg.Client;
let identityTables: string[] = [];

beforeAll(async () => {
  app = await connectAs('app');
  readonly = await connectAs('readonly');
  owner = await connectAs('migrator');
  const { rows } = await owner.query(
    `SELECT n.nspname || '.' || c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND (n.nspname = 'identity' OR (n.nspname = 'util' AND c.relname = 'rate_limit_counters'))
     ORDER BY 1`,
  );
  identityTables = rows.map((r) => r.name as string);
});
afterAll(async () => {
  await app.end();
  await readonly.end();
  await owner.end();
});

describe('no direct access to identity data (P3 exit criterion 1)', () => {
  it('covers every identity table (and the rate-limit counters)', () => {
    expect(identityTables.length).toBeGreaterThanOrEqual(9);
  });

  it('alphakolect_app cannot SELECT, INSERT, UPDATE or DELETE any of them', async () => {
    for (const table of identityTables) {
      for (const sql of [
        `SELECT * FROM ${table} LIMIT 1`,
        `INSERT INTO ${table} DEFAULT VALUES`,
        `UPDATE ${table} SET created_at = created_at`,
        `DELETE FROM ${table}`,
      ]) {
        if (table === 'util.rate_limit_counters' && sql.startsWith('UPDATE')) continue; // no created_at column
        await inTenantTx(app, FIXTURE.A.merchantId, (db) =>
          expectSqlState(db.query(sql), SQLSTATE.insufficientPrivilege),
        );
      }
    }
  });

  it('alphakolect_readonly cannot read them either (they hold password and token hashes)', async () => {
    for (const table of identityTables) {
      await inTenantTx(readonly, null, (db) =>
        expectSqlState(db.query(`SELECT * FROM ${table} LIMIT 1`), SQLSTATE.insufficientPrivilege),
      );
    }
  });

  it('the app has no privilege of any kind on identity tables (catalog check)', async () => {
    const { rows } = await owner.query(
      `SELECT table_schema || '.' || table_name AS t, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee IN ('alphakolect_app', 'alphakolect_readonly')
         AND (table_schema = 'identity' OR (table_schema = 'util' AND table_name = 'rate_limit_counters'))`,
    );
    expect(rows).toEqual([]);
  });
});

describe('identity invariants enforced by PostgreSQL', () => {
  const insertIdentity = (email: string, extra = '') =>
    owner.query(
      `INSERT INTO identity.identities (email${extra ? ', password_hash' : ''}) VALUES ($1${extra ? ', $2' : ''})`,
      extra ? [email, extra] : [email],
    );

  async function inOwnerTx(fn: () => Promise<unknown>) {
    await owner.query('BEGIN');
    try {
      await fn();
    } finally {
      await owner.query('ROLLBACK');
    }
  }

  it.each([
    ['upper-case email', 'Owner@Example.test'],
    ['email with surrounding spaces', ' owner@example.test'],
    ['malformed email', 'not-an-email'],
  ])('rejects a %s', async (_label, email) => {
    await inOwnerTx(() => expectSqlState(insertIdentity(email), SQLSTATE.checkViolation));
  });

  it('rejects a duplicate email', async () => {
    await inOwnerTx(() => expectSqlState(insertIdentity('owner-a@example.test'), SQLSTATE.uniqueViolation));
  });

  it('accepts only argon2id password hashes', async () => {
    // Separate transactions: after an error PostgreSQL aborts the rest of a transaction.
    await inOwnerTx(() =>
      expectSqlState(
        insertIdentity('bcrypt@example.test', '$2a$10$abcdefghijklmnopqrstuv'),
        SQLSTATE.checkViolation,
      ),
    );
    await inOwnerTx(() =>
      insertIdentity('argon@example.test', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'),
    );
  });

  it('stores tokens only as SHA-256 hex hashes', async () => {
    await inOwnerTx(() =>
      expectSqlState(
        owner.query(
          `INSERT INTO identity.one_time_tokens (identity_id, purpose, token_hash, expires_at)
           VALUES ($1, 'password_reset', 'raw-token-value-that-is-not-a-hash-0000000000000000000000000000', now() + interval '1 hour')`,
          [FIXTURE.A.ownerIdentityId],
        ),
        SQLSTATE.checkViolation,
      ),
    );
  });

  it('binds a session to exactly one membership matching its audience', async () => {
    await inOwnerTx(async () => {
      // merchant session without a merchant membership
      await expectSqlState(
        owner.query(
          `INSERT INTO identity.sessions (identity_id, audience, absolute_expires_at) VALUES ($1, 'merchant', now() + interval '1 day')`,
          [FIXTURE.A.ownerIdentityId],
        ),
        SQLSTATE.checkViolation,
      );
    });
    await inOwnerTx(async () => {
      // an MFA-enrolment session is only possible for the platform audience
      await expectSqlState(
        owner.query(
          `INSERT INTO identity.sessions (identity_id, audience, merchant_membership_id, scope, absolute_expires_at)
           VALUES ($1, 'merchant', $2, 'mfa_enrollment', now() + interval '1 day')`,
          [FIXTURE.A.ownerIdentityId, FIXTURE.A.ownerMembershipId],
        ),
        SQLSTATE.checkViolation,
      );
    });
    await inOwnerTx(() =>
      owner.query(
        `INSERT INTO identity.sessions (identity_id, audience, merchant_membership_id, absolute_expires_at)
         VALUES ($1, 'merchant', $2, now() + interval '1 day')`,
        [FIXTURE.A.ownerIdentityId, FIXTURE.A.ownerMembershipId],
      ),
    );
  });

  it('allows one owner per merchant', async () => {
    await inOwnerTx(async () => {
      const {
        rows: [other],
      } = await owner.query(
        `INSERT INTO identity.identities (email) VALUES ('second-owner@example.test') RETURNING id`,
      );
      await expectSqlState(
        owner.query(
          `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'owner')`,
          [FIXTURE.A.merchantId, other.id],
        ),
        SQLSTATE.uniqueViolation,
      );
    });
  });

  it('links audit events to identities', async () => {
    await inOwnerTx(() =>
      expectSqlState(
        owner.query(
          `INSERT INTO audit.audit_events (actor_identity_id, action, outcome) VALUES ('01900000-0000-7000-8000-00000000dead', 'x', 'success')`,
        ),
        SQLSTATE.foreignKeyViolation,
      ),
    );
  });
});
