import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs } from './support/db.js';

// The two-connection tests of §7.2 (P5.5): staged races between functions that touch the same rows, repeated 50
// times each. A deadlock (SQLSTATE 40P01) in any run fails — PostgreSQL's detector aborting a transaction is a defect,
// not a success. Each race is staged with a third connection holding one row, so that both functions are inside their
// footprints at the moment the cycle would close; the static guard (lock-order-guard.test.ts) is the proof, these runs
// are the adversarial evidence.

const RUNS = 50;
const DEADLOCK = '40P01';

let x: pg.Client; // stages a race by holding one row
let t1: pg.Client;
let t2: pg.Client;
let watcher: pg.Client;
let owner: pg.Client;
/** Backend ids, read once: a busy connection cannot answer a query until its blocked statement ends. */
const pid = { t1: 0, t2: 0 };
beforeAll(async () => {
  [x, t1, t2, watcher, owner] = await Promise.all([
    connectAs('migrator'),
    connectAs('app'),
    connectAs('app'),
    connectAs('migrator'),
    connectAs('migrator'),
  ]);
  pid.t1 = await pidOf(t1);
  pid.t2 = await pidOf(t2);
});
afterAll(async () => {
  await Promise.all([x, t1, t2, watcher, owner].map((c) => c.end()));
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
const pidOf = async (c: pg.Client) => (await c.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;

async function waitsForALock(pid: number) {
  for (let i = 0; i < 400; i++) {
    const { rowCount } = await watcher.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [pid]);
    if (rowCount) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`backend ${pid} never waited for a lock`);
}

type Settled = { rows: Record<string, unknown>[] | null; code: string | null };
const settle = (p: Promise<pg.QueryResult>): Promise<Settled> =>
  p.then(
    (r) => ({ rows: r.rows, code: null }),
    (e: { code?: string }) => ({ rows: null, code: e.code ?? 'error' }),
  );
/**
 * Runs one statement in an open transaction and ends the transaction as soon as the statement settles — commit what
 * succeeded, roll back what failed — so the other side of a race is never left waiting on a finished statement.
 */
const inTransaction = (c: pg.Client, p: Promise<pg.QueryResult>): Promise<Settled> =>
  settle(p).then(async (r) => {
    await c.query(r.code ? 'ROLLBACK' : 'COMMIT');
    return r;
  });

async function session(identityId: string, audience: string, membershipId: string) {
  const [idle, absolute] = audience === 'platform' ? [3600, 43200] : [86400, 1209600];
  const {
    rows: [s],
  } = await t1.query(`SELECT * FROM identity.create_session($1, $2, $3, 'full', $4, $5, $6, NULL, NULL)`, [
    identityId,
    audience,
    membershipId,
    hash(),
    idle,
    absolute,
  ]);
  return s.session_id as string;
}

/** A signed-up owner and business; verified (active) unless told otherwise. */
async function business({ verified = true } = {}) {
  const {
    rows: [s],
  } = await t1.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Races Ltd')`, [
    email('owner'),
    ARGON,
  ]);
  const verification = hash();
  await t1.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    verification,
  ]);
  if (verified) await t1.query(`SELECT identity.verify_email($1)`, [verification]);
  const {
    rows: [o],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  return {
    merchantId: s.merchant_id as string,
    ownerIdentityId: s.identity_id as string,
    // A business pending verification has no active membership to sign in with.
    ownerSession: verified ? await session(s.identity_id, 'merchant', o.id) : '',
    verification,
  };
}

async function superAdmin() {
  const {
    rows: [i],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
    [email('admin')],
  );
  const {
    rows: [m],
  } = await owner.query(
    `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'super_admin') RETURNING id`,
    [i.id],
  );
  // Platform sessions require a confirmed second factor.
  await owner.query(
    `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at)
     VALUES ($1, '\\x00', 'k1', now())`,
    [i.id],
  );
  return { session: await session(i.id, 'platform', m.id) };
}

const issue = (c: pg.Client, ownerSession: string, to: string) =>
  c.query(`SELECT * FROM tenancy.issue_invitation($1, $2, 'agent', NULL, NULL, $3, $4, 86400)`, [
    ownerSession,
    to,
    hash(),
    hash(),
  ]);

describe('(h) re-issuing an invitation while the invitee completes account setup (§7.2)', () => {
  let A: Awaited<ReturnType<typeof business>>;
  beforeAll(async () => {
    A = await business();
  });

  /**
   * Staged where the P4 functions cycle: the re-issue holds the invitee's identity FOR SHARE and waits for the older
   * setup token (held by x); account setup holds the newer token and waits for the identity; x releases, and the
   * re-issue reaches for the newer token.
   */
  async function run() {
    const address = email('invitee');
    await issue(t1, A.ownerSession, address);
    const {
      rows: [person],
    } = await owner.query(`SELECT id FROM identity.identities WHERE email = $1`, [address]);
    const {
      rows: [older],
    } = await owner.query(
      `SELECT id FROM identity.one_time_tokens WHERE identity_id = $1 AND purpose = 'account_setup' AND consumed_at IS NULL`,
      [person.id],
    );
    const newer = hash();
    await owner.query(
      `INSERT INTO identity.one_time_tokens (identity_id, purpose, token_hash, expires_at)
       VALUES ($1, 'account_setup', $2, now() + interval '1 hour')`,
      [person.id, newer],
    );

    await x.query('BEGIN');
    await x.query(`SELECT 1 FROM identity.one_time_tokens WHERE id = $1 FOR UPDATE`, [older.id]);
    await t2.query('BEGIN');
    const reissue = inTransaction(t2, issue(t2, A.ownerSession, address));
    await waitsForALock(pid.t2);
    await t1.query('BEGIN');
    const setup = inTransaction(
      t1,
      t1.query(`SELECT identity.complete_account_setup($1, $2) AS id`, [newer, ARGON]),
    );
    await waitsForALock(pid.t1);
    await x.query('ROLLBACK');
    const [r, s] = await Promise.all([reissue, setup]);
    return { reissue: r, setup: s, identityId: person.id as string };
  }

  it(`never deadlocks: ${RUNS} staged runs, every outcome valid`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const { reissue, setup, identityId } = await run();
      expect([reissue.code, setup.code], `run ${i}`).not.toContain(DEADLOCK);
      expect(reissue.code, `run ${i}: re-issue`).toBeNull();
      expect(setup.code, `run ${i}: setup`).toBeNull();
      expect(reissue.rows![0]!.outcome).toBe('ok');
      // Setup either completed (and the person exists with a password) or its token had been superseded.
      expect([null, identityId]).toContain(setup.rows![0]!.id);
    }
  }, 600_000);
});

describe('email verification while a super admin deactivates the business (§7.2, finding at P5.5 step 1)', () => {
  let admin: Awaited<ReturnType<typeof superAdmin>>;
  beforeAll(async () => {
    admin = await superAdmin();
  });

  /** Staged with x holding the owner's identity: the deactivation holds the merchant and waits for the identity. */
  async function run() {
    const b = await business({ verified: false });
    await x.query('BEGIN');
    await x.query(`SELECT 1 FROM identity.identities WHERE id = $1 FOR UPDATE`, [b.ownerIdentityId]);
    await t2.query('BEGIN');
    const deactivate = inTransaction(
      t2,
      t2.query(`SELECT * FROM tenancy.set_merchant_status($1, $2, 'deactivate', 'race')`, [
        admin.session,
        b.merchantId,
      ]),
    );
    await waitsForALock(pid.t2);
    await t1.query('BEGIN');
    const verify = inTransaction(t1, t1.query(`SELECT identity.verify_email($1) AS id`, [b.verification]));
    await waitsForALock(pid.t1);
    await x.query('ROLLBACK');
    const [d, v] = await Promise.all([deactivate, verify]);
    const {
      rows: [m],
    } = await owner.query(`SELECT status FROM tenancy.merchants WHERE id = $1`, [b.merchantId]);
    return { deactivate: d, verify: v, status: m.status as string, ownerIdentityId: b.ownerIdentityId };
  }

  it(`never deadlocks: ${RUNS} staged runs; the deactivation always wins and verification never revives the business`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const { deactivate, verify, status, ownerIdentityId } = await run();
      expect([deactivate.code, verify.code], `run ${i}`).not.toContain(DEADLOCK);
      expect(deactivate.code, `run ${i}: deactivation`).toBeNull();
      expect(verify.code, `run ${i}: verification`).toBeNull();
      expect(deactivate.rows![0]!.outcome).toBe('ok');
      expect(verify.rows![0]!.id).toBe(ownerIdentityId);
      expect(status).toBe('deactivated');
    }
  }, 600_000);
});
