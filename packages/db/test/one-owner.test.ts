import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// P4.5 (ADR-15 T17): every business keeps exactly one owner. At most one: the P3 unique index, immediately. At
// least one: a deferred constraint trigger, at COMMIT. Exercised as the table owner — the only role that can change
// membership rows directly — on fresh merchants from signup.

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  app = await connectAs('app');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await Promise.all([app.end(), owner.end()]);
});

const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;

/** A merchant from signup, a role, and an active staff member holding it. */
async function business() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'One Owner Ltd')`, [
    email('owner'),
    ARGON,
  ]);
  const merchantId = s.merchant_id as string;
  const {
    rows: [ownerRow],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  const {
    rows: [role],
  } = await owner.query(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Manager') RETURNING id`, [
    merchantId,
  ]);
  const {
    rows: [identity],
  } = await owner.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [email('staff')]);
  const {
    rows: [staff],
  } = await owner.query(
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, 'staff', $3) RETURNING id`,
    [merchantId, identity.id, role.id],
  );
  return {
    merchantId,
    ownerId: ownerRow.id as string,
    staffId: staff.id as string,
    roleId: role.id as string,
  };
}

const owners = async (merchantId: string) =>
  (
    await owner.query(
      `SELECT id FROM tenancy.merchant_memberships WHERE merchant_id = $1 AND kind = 'owner' ORDER BY id`,
      [merchantId],
    )
  ).rows.map((r) => r.id as string);

async function inTx(fn: () => Promise<unknown>) {
  await owner.query('BEGIN');
  try {
    await fn();
    await owner.query('COMMIT');
  } catch (err) {
    await owner.query('ROLLBACK');
    throw err;
  }
}

const demote = (b: Awaited<ReturnType<typeof business>>) =>
  owner.query(`UPDATE tenancy.merchant_memberships SET kind = 'staff', role_id = $2 WHERE id = $1`, [
    b.ownerId,
    b.roleId,
  ]);
const promote = (b: Awaited<ReturnType<typeof business>>) =>
  owner.query(`UPDATE tenancy.merchant_memberships SET kind = 'owner', role_id = NULL WHERE id = $1`, [
    b.staffId,
  ]);

describe('exactly one owner (T17)', () => {
  it('demote then promote in one transaction: commits, one owner — the new one', async () => {
    const b = await business();
    await inTx(async () => {
      await demote(b);
      await promote(b);
    });
    expect(await owners(b.merchantId)).toEqual([b.staffId]);
  });

  it('demoting the owner without promoting anyone fails at COMMIT, and nothing changes', async () => {
    const b = await business();
    await expectSqlState(
      inTx(async () => {
        await demote(b); // accepted for now: the check is deferred
      }),
      SQLSTATE.checkViolation,
    );
    expect(await owners(b.merchantId)).toEqual([b.ownerId]);
  });

  it('removing the owner row fails at COMMIT', async () => {
    const b = await business();
    await expectSqlState(
      inTx(() => owner.query(`DELETE FROM tenancy.merchant_memberships WHERE id = $1`, [b.ownerId])),
      SQLSTATE.checkViolation,
    );
    expect(await owners(b.merchantId)).toEqual([b.ownerId]);
  });

  it('promoting before demoting is refused at once: never two owners, even inside a transaction', async () => {
    const b = await business();
    await expectSqlState(
      inTx(async () => {
        await promote(b);
        await demote(b);
      }),
      SQLSTATE.uniqueViolation,
    );
    expect(await owners(b.merchantId)).toEqual([b.ownerId]);
  });

  it('other changes to the owner row (e.g. status) are unaffected', async () => {
    const b = await business();
    await inTx(() =>
      owner.query(
        `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
        [b.ownerId],
      ),
    );
    expect(await owners(b.merchantId)).toEqual([b.ownerId]);
  });

  it('the trigger function is nobody’s to call', async () => {
    const { rows } = await owner.query(`
      SELECT has_function_privilege('alphakolect_app', 'tenancy.merchant_keeps_one_owner()', 'EXECUTE') AS app,
             has_function_privilege('alphakolect_readonly', 'tenancy.merchant_keeps_one_owner()', 'EXECUTE') AS ro`);
    expect(rows[0]).toEqual({ app: false, ro: false });
  });
});
