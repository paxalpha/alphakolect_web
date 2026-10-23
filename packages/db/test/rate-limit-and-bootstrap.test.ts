import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, inTenantTx, SQLSTATE } from './support/db.js';

let app: pg.Client;
let owner: pg.Client;

beforeAll(async () => {
  app = await connectAs('app');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await app.end();
  await owner.end();
});

const key = () => createHash('sha256').update(randomBytes(16)).digest('hex');
const hit = async (k: string, windowSeconds = 3600, max = 3) =>
  (await app.query(`SELECT * FROM util.rate_limit_hit($1, $2, $3)`, [k, windowSeconds, max])).rows[0] as {
    allowed: boolean;
    retry_after_seconds: number;
  };

describe('util.rate_limit_hit (ADR-14 D13)', () => {
  it('allows up to the limit per window, then refuses with a retry-after within the window', async () => {
    const k = key();
    for (let i = 0; i < 3; i++) expect((await hit(k)).allowed).toBe(true);
    const refused = await hit(k);
    expect(refused.allowed).toBe(false);
    expect(refused.retry_after_seconds).toBeGreaterThan(0);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(3600);
  });

  it('counts keys independently', async () => {
    const a = key();
    const b = key();
    for (let i = 0; i < 3; i++) await hit(a);
    expect((await hit(a)).allowed).toBe(false);
    expect((await hit(b)).allowed).toBe(true);
  });

  it('starts fresh in the next window', async () => {
    const k = key();
    for (let i = 0; i < 4; i++) await hit(k);
    await owner.query(
      `UPDATE util.rate_limit_counters SET window_start = window_start - interval '2 hours', expires_at = now() - interval '1 hour' WHERE key = $1`,
      [k],
    );
    expect((await hit(k)).allowed).toBe(true);
  });

  it('is atomic under concurrency: exactly max hits are allowed', async () => {
    const k = key();
    const clients = await Promise.all(Array.from({ length: 10 }, () => connectAs('app')));
    try {
      const results = await Promise.all(
        clients.map((c) => c.query(`SELECT allowed FROM util.rate_limit_hit($1, 3600, 4)`, [k])),
      );
      expect(results.filter((r) => r.rows[0].allowed).length).toBe(4);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it('rejects absurd arguments', async () => {
    await inTenantTx(app, null, (db) =>
      expectSqlState(db.query(`SELECT * FROM util.rate_limit_hit('k', 0, 1)`), SQLSTATE.checkViolation),
    );
  });

  it('the app still cannot read or reset the counters directly', async () => {
    await inTenantTx(app, null, (db) =>
      expectSqlState(db.query(`DELETE FROM util.rate_limit_counters`), SQLSTATE.insufficientPrivilege),
    );
  });
});

describe('identity.bootstrap_super_admin (ADR-14 D9)', () => {
  it('cannot be called by the app role (a compromised API cannot mint a super admin)', async () => {
    await inTenantTx(app, null, (db) =>
      expectSqlState(
        db.query(`SELECT identity.bootstrap_super_admin('attacker@example.test', true)`),
        SQLSTATE.insufficientPrivilege,
      ),
    );
  });

  it('creates a passwordless super admin once, audited; a second needs allow_additional', async () => {
    // The test database may already hold a super admin from other tests (session/MFA fixtures), so start from
    // the "additional" path, then prove the guard.
    const email = `owner-${process.pid}-${randomBytes(3).toString('hex')}@example.test`;
    const {
      rows: [created],
    } = await owner.query(`SELECT identity.bootstrap_super_admin($1, true) AS id`, [email]);
    const { rows } = await owner.query(
      `SELECT i.password_hash, i.email_verified_at, pm.role, pm.status
         FROM identity.identities i JOIN identity.platform_memberships pm ON pm.identity_id = i.id WHERE i.id = $1`,
      [created.id],
    );
    expect(rows[0]).toEqual({
      password_hash: null,
      email_verified_at: null,
      role: 'super_admin',
      status: 'active',
    });
    const audit = await owner.query(
      `SELECT action, outcome FROM audit.audit_events WHERE target_id = $1 AND action = 'platform.super_admin_bootstrapped'`,
      [created.id],
    );
    expect(audit.rows).toEqual([{ action: 'platform.super_admin_bootstrapped', outcome: 'success' }]);

    await owner.query('BEGIN');
    try {
      await expectSqlState(
        owner.query(`SELECT identity.bootstrap_super_admin('second-${process.pid}@example.test', false)`),
        SQLSTATE.checkViolation,
      );
    } finally {
      await owner.query('ROLLBACK');
    }
  });

  // The coverage guard's tests for this pattern-A pair (P5.3a, plan §8.1): written by the operator function itself, the
  // actor is no one (operator), the target the new identity; it commits with the bootstrap, and without it nothing does.
  it('[coverage platform.super_admin_bootstrapped/success] one row, operator actor, the new identity as target, committed with it', async () => {
    const email = `cov-${process.pid}-${randomBytes(3).toString('hex')}@example.test`;
    const {
      rows: [created],
    } = await owner.query(`SELECT identity.bootstrap_super_admin($1, true) AS id`, [email]);
    const { rows } = await owner.query(
      `SELECT merchant_id, actor_identity_id, actor_audience, actor_membership_id, target_type, target_id, request_id, summary
         FROM audit.audit_events WHERE action = 'platform.super_admin_bootstrapped' AND outcome = 'success' AND target_id = $1`,
      [created.id],
    );
    expect(rows).toEqual([
      {
        merchant_id: null,
        actor_identity_id: null,
        actor_audience: 'platform',
        actor_membership_id: null,
        target_type: 'identity',
        target_id: created.id,
        request_id: null,
        summary: { additional: true },
      },
    ]);
  });

  it("[coverage platform.super_admin_bootstrapped/success] with that pair's insert failing, the bootstrap is absent", async () => {
    const email = `cov-fail-${process.pid}-${randomBytes(3).toString('hex')}@example.test`;
    await owner.query('BEGIN');
    try {
      // A test-only trigger, created and dropped inside this transaction (the database tests run one file at a time).
      await owner.query(
        `CREATE FUNCTION audit.test_fail_bootstrap() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW.action = 'platform.super_admin_bootstrapped' AND NEW.outcome = 'success' THEN
             RAISE EXCEPTION 'injected audit storage failure' USING ERRCODE = 'XX000';
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await owner.query(
        `CREATE TRIGGER test_fail_bootstrap BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.test_fail_bootstrap()`,
      );
      await owner.query('SAVEPOINT bootstrap');
      await expectSqlState(owner.query(`SELECT identity.bootstrap_super_admin($1, true)`, [email]), 'XX000');
      await owner.query('ROLLBACK TO SAVEPOINT bootstrap');
      const { rows } = await owner.query(`SELECT 1 FROM identity.identities WHERE email = $1`, [email]);
      expect(rows).toEqual([]);
    } finally {
      await owner.query('ROLLBACK');
    }
  });

  it('refuses to give one identity two platform memberships', async () => {
    const email = `dup-${process.pid}-${randomBytes(3).toString('hex')}@example.test`;
    await owner.query(`SELECT identity.bootstrap_super_admin($1, true)`, [email]);
    await owner.query('BEGIN');
    try {
      await expectSqlState(
        owner.query(`SELECT identity.bootstrap_super_admin($1, true)`, [email]),
        SQLSTATE.checkViolation,
      );
    } finally {
      await owner.query('ROLLBACK');
    }
  });
});
