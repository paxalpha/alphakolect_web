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
let t3: pg.Client;
let watcher: pg.Client;
let owner: pg.Client;
/** Backend ids, read once: a busy connection cannot answer a query until its blocked statement ends. */
const pid = { t1: 0, t2: 0, t3: 0 };
beforeAll(async () => {
  [x, t1, t2, t3, watcher, owner] = await Promise.all([
    connectAs('migrator'),
    connectAs('app'),
    connectAs('app'),
    connectAs('app'),
    connectAs('migrator'),
    connectAs('migrator'),
  ]);
  pid.t1 = await pidOf(t1);
  pid.t2 = await pidOf(t2);
  pid.t3 = await pidOf(t3);
});
afterAll(async () => {
  await Promise.all([x, t1, t2, t3, watcher, owner].map((c) => c.end()));
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
    ownerMembershipId: o.id as string,
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

// ── P5.5 step 3: the privileged operations under their authority locks ──────────────────────────────────────────────

type Racer = { c: pg.Client; pid: number; run: () => Promise<pg.QueryResult> };
/**
 * x holds one row FOR UPDATE; each racer starts in turn and must be waiting for a lock (on that row or behind an earlier
 * racer) before the next starts; then x releases, and every racer's transaction ends as soon as its statement does.
 */
async function staged(hold: { table: string; id: string }, racers: Racer[]): Promise<Settled[]> {
  await x.query('BEGIN');
  await x.query(`SELECT 1 FROM ${hold.table} WHERE id = $1 FOR UPDATE`, [hold.id]);
  const pending: Promise<Settled>[] = [];
  for (const r of racers) {
    await r.c.query('BEGIN');
    pending.push(inTransaction(r.c, r.run()));
    await waitsForALock(r.pid);
  }
  await x.query('ROLLBACK');
  return Promise.all(pending);
}
const outcomes = (settled: Settled[]) =>
  settled.map((s) => (s.code ? `error ${s.code}` : String(s.rows![0]!.outcome)));

/** A staff member (verified, with a password) holding the given role. */
async function staff(b: Awaited<ReturnType<typeof business>>, roleId: string) {
  const {
    rows: [i],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
    [email('staff'), ARGON],
  );
  const {
    rows: [m],
  } = await owner.query(
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, 'staff', $3) RETURNING id`,
    [b.merchantId, i.id, roleId],
  );
  return { identityId: i.id as string, membershipId: m.id as string };
}
async function role(merchantId: string) {
  return (
    await owner.query(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
      merchantId,
      `Race role ${randomBytes(3).toString('hex')}`,
    ])
  ).rows[0].id as string;
}
const membershipState = async (id: string) =>
  (await owner.query(`SELECT kind, status FROM tenancy.merchant_memberships WHERE id = $1`, [id]))
    .rows[0] as {
    kind: string;
    status: string;
  };
const merchantStatus = async (id: string) =>
  (await owner.query(`SELECT status FROM tenancy.merchants WHERE id = $1`, [id])).rows[0].status as string;

const updateMembership = (
  c: pg.Client,
  sessionId: string,
  target: string,
  action: string,
  roleId: string | null,
) =>
  c.query(`SELECT * FROM tenancy.update_membership($1, $2, $3, $4, NULL)`, [
    sessionId,
    target,
    action,
    roleId,
  ]);
const setStatus = (c: pg.Client, sessionId: string, merchantId: string, action: string) =>
  c.query(`SELECT * FROM tenancy.set_merchant_status($1, $2, $3, 'race')`, [sessionId, merchantId, action]);
const transfer = (c: pg.Client, sessionId: string, merchantId: string, newOwner: string, roleId: string) =>
  c.query(`SELECT * FROM tenancy.transfer_ownership($1, $2, $3, $4, false)`, [
    sessionId,
    merchantId,
    newOwner,
    roleId,
  ]);

describe('(b) two of the owner’s sessions act on two members at once, in both orders (§7.2)', () => {
  it(`never deadlocks: ${RUNS} staged runs, both changes made`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const b = await business();
      const roleId = await role(b.merchantId);
      const [a, z] = [await staff(b, roleId), await staff(b, roleId)];
      const second = await session(b.ownerIdentityId, 'merchant', b.ownerMembershipId);
      // Even runs: deactivate A while reassigning Z; odd runs: the reverse.
      const [first, other] = i % 2 ? [z, a] : [a, z];
      const results = await staged({ table: 'tenancy.merchant_memberships', id: b.ownerMembershipId }, [
        {
          c: t1,
          pid: pid.t1,
          run: () => updateMembership(t1, b.ownerSession, first.membershipId, 'deactivate', null),
        },
        { c: t2, pid: pid.t2, run: () => updateMembership(t2, second, other.membershipId, 'assign', roleId) },
      ]);
      expect(outcomes(results), `run ${i}`).toEqual(['ok', 'ok']);
      expect((await membershipState(first.membershipId)).status).toBe('deactivated');
    }
  }, 600_000);
});

describe('(a), (d) an ownership transfer against the outgoing owner’s member change, in both orders (§7.2)', () => {
  let admin: Awaited<ReturnType<typeof superAdmin>>;
  beforeAll(async () => {
    admin = await superAdmin();
  });

  it(`never deadlocks: ${RUNS} staged runs; the change is made when it ran first, refused when the transfer did`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const b = await business();
      const roleId = await role(b.merchantId);
      const target = await staff(b, roleId);
      const successor = await staff(b, roleId);
      const change = {
        c: t1,
        pid: pid.t1,
        run: () => updateMembership(t1, b.ownerSession, target.membershipId, 'deactivate', null),
      };
      const handOver = {
        c: t2,
        pid: pid.t2,
        run: () => transfer(t2, admin.session, b.merchantId, successor.membershipId, roleId),
      };
      if (i % 2 === 0) {
        // The owner's change first: it holds the merchant (S) and waits for its target; the transfer waits for it.
        const results = await staged({ table: 'tenancy.merchant_memberships', id: target.membershipId }, [
          change,
          handOver,
        ]);
        expect(outcomes(results), `run ${i}`).toEqual(['ok', 'ok']);
        expect((await membershipState(target.membershipId)).status).toBe('deactivated');
      } else {
        // The transfer first: it holds the merchant (NKU) and waits for the successor's identity; the change waits for
        // it, then its re-check finds the former owner without the permission — refused, nothing changed.
        const results = await staged({ table: 'identity.identities', id: successor.identityId }, [
          handOver,
          change,
        ]);
        expect(outcomes(results), `run ${i}`).toEqual(['ok', 'forbidden']);
        expect((await membershipState(target.membershipId)).status).toBe('active');
      }
      expect((await membershipState(successor.membershipId)).kind).toBe('owner');
    }
  }, 600_000);
});

describe('(f) a merchant deactivation against an ownership transfer and against an invitation issue (§7.2)', () => {
  let admin: Awaited<ReturnType<typeof superAdmin>>;
  beforeAll(async () => {
    admin = await superAdmin();
  });

  it(`deactivation and transfer: never deadlocks, ${RUNS} staged runs in both orders, both succeed`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const b = await business();
      const roleId = await role(b.merchantId);
      const successor = await staff(b, roleId);
      const deactivate = {
        c: t1,
        pid: pid.t1,
        run: () => setStatus(t1, admin.session, b.merchantId, 'deactivate'),
      };
      const handOver = {
        c: t2,
        pid: pid.t2,
        run: () => transfer(t2, admin.session, b.merchantId, successor.membershipId, roleId),
      };
      const results =
        i % 2 === 0
          ? await staged({ table: 'identity.identities', id: b.ownerIdentityId }, [deactivate, handOver])
          : await staged({ table: 'identity.identities', id: successor.identityId }, [handOver, deactivate]);
      expect(outcomes(results), `run ${i}`).toEqual(['ok', 'ok']);
      expect(await merchantStatus(b.merchantId)).toBe('deactivated');
    }
  }, 600_000);

  it(`deactivation and invitation issue: never deadlocks, ${RUNS} staged runs; an issue after the deactivation is refused`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const b = await business();
      const deactivate = {
        c: t1,
        pid: pid.t1,
        run: () => setStatus(t1, admin.session, b.merchantId, 'deactivate'),
      };
      const invite = { c: t2, pid: pid.t2, run: () => issue(t2, b.ownerSession, email('race-invitee')) };
      if (i % 2 === 0) {
        // The issue first: it holds the merchant (S) and waits for the owner's own membership.
        const results = await staged({ table: 'tenancy.merchant_memberships', id: b.ownerMembershipId }, [
          invite,
          deactivate,
        ]);
        expect(outcomes(results), `run ${i}`).toEqual(['ok', 'ok']);
      } else {
        // The deactivation first: the issue's re-check finds the business deactivated — refused.
        const results = await staged({ table: 'identity.identities', id: b.ownerIdentityId }, [
          deactivate,
          invite,
        ]);
        expect(outcomes(results), `run ${i}`).toEqual(['ok', 'forbidden']);
      }
      expect(await merchantStatus(b.merchantId)).toBe('deactivated');
    }
  }, 600_000);
});

describe('(g) account setup admitting an invitation against a merchant deactivation (§7.2)', () => {
  let admin: Awaited<ReturnType<typeof superAdmin>>;
  beforeAll(async () => {
    admin = await superAdmin();
  });

  it(`never deadlocks: ${RUNS} staged runs; admitted when setup ran first, not admitted when the deactivation did`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const b = await business();
      const setupHash = hash();
      const address = email('race-newcomer');
      const {
        rows: [issued],
      } = await t1.query(
        `SELECT * FROM tenancy.issue_invitation($1, $2, 'agent', NULL, NULL, $3, $4, 86400)`,
        [b.ownerSession, address, hash(), setupHash],
      );
      const setup = {
        c: t1,
        pid: pid.t1,
        run: () => t1.query(`SELECT identity.complete_account_setup($1, $2) AS outcome`, [setupHash, ARGON]),
      };
      const deactivate = {
        c: t2,
        pid: pid.t2,
        run: () => setStatus(t2, admin.session, b.merchantId, 'deactivate'),
      };
      const results =
        i % 2 === 0
          ? await staged({ table: 'tenancy.invitations', id: issued.invitation_id }, [setup, deactivate])
          : await staged({ table: 'identity.identities', id: b.ownerIdentityId }, [deactivate, setup]);
      expect(
        results.map((r) => r.code),
        `run ${i}`,
      ).toEqual([null, null]);
      const {
        rows: [person],
      } = await owner.query(`SELECT id FROM identity.identities WHERE email = $1`, [address]);
      const { rowCount } = await owner.query(
        `SELECT 1 FROM tenancy.merchant_memberships WHERE merchant_id = $1 AND identity_id = $2`,
        [b.merchantId, person.id],
      );
      expect(rowCount, `run ${i}: admitted`).toBe(i % 2 === 0 ? 1 : 0);
      expect(await merchantStatus(b.merchantId)).toBe('deactivated');
    }
  }, 600_000);
});

describe('(j) acceptance of an invitation against its revocation and its re-issue (§7.2)', () => {
  it(`never deadlocks: ${RUNS} staged runs; exactly one of acceptance and withdrawal takes effect`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const b = await business();
      // An existing account (verified, with a password): invited by link.
      const {
        rows: [person],
      } = await owner.query(
        `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id, email`,
        [email('race-member'), ARGON],
      );
      const token = hash();
      const {
        rows: [issued],
      } = await t1.query(
        `SELECT * FROM tenancy.issue_invitation($1, $2, 'agent', NULL, NULL, $3, $4, 86400)`,
        [b.ownerSession, person.email, token, hash()],
      );
      const second = await session(b.ownerIdentityId, 'merchant', b.ownerMembershipId);
      const results = await staged({ table: 'tenancy.invitations', id: issued.invitation_id }, [
        {
          c: t1,
          pid: pid.t1,
          run: () => t1.query(`SELECT * FROM tenancy.accept_invitation($1, $2)`, [token, person.id]),
        },
        {
          c: t2,
          pid: pid.t2,
          run: () =>
            t2.query(`SELECT * FROM tenancy.revoke_invitation($1, $2)`, [
              b.ownerSession,
              issued.invitation_id,
            ]),
        },
        { c: t3, pid: pid.t3, run: () => issue(t3, second, person.email) },
      ]);
      const all = outcomes(results);
      const [accepted, revoked, reissued] = all;
      expect(
        all.filter((o) => o.startsWith('error')),
        `run ${i}: ${all.join(', ')}`,
      ).toEqual([]);
      const { rowCount: members } = await owner.query(
        `SELECT 1 FROM tenancy.merchant_memberships WHERE merchant_id = $1 AND identity_id = $2`,
        [b.merchantId, person.id],
      );
      const {
        rows: [first],
      } = await owner.query(`SELECT accepted_at, revoked_at FROM tenancy.invitations WHERE id = $1`, [
        issued.invitation_id,
      ]);
      // Exactly one of acceptance and withdrawal took effect on that invitation; a membership exists iff it was accepted.
      expect([first.accepted_at, first.revoked_at].filter(Boolean)).toHaveLength(1);
      expect(members).toBe(first.accepted_at ? 1 : 0);
      if (accepted === 'ok') {
        expect(revoked).toBe('invalid_transition');
        expect(reissued).toBe('already_member');
      }
    }
  }, 600_000);
});
