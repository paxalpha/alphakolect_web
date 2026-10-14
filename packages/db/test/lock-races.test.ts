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

// ── P5.5 step 4: the branch and role writers ───────────────────────────────────────────────────────────────────────

/** A role of `b` holding `permissions` — granted as the table owner (a fixture; no app path grants before P5.6). */
/** A role of `b` holding `permissions`, set by its owner through tenancy.set_role_permissions (P5.6). */
async function grantedRole(b: Awaited<ReturnType<typeof business>>, permissions: string[]) {
  const roleId = await role(b.merchantId);
  const {
    rows: [set],
  } = await t1.query(`SELECT outcome FROM tenancy.set_role_permissions($1, $2, $3)`, [
    b.ownerSession,
    roleId,
    permissions,
  ]);
  expect(set.outcome).toBe('ok');
  return roleId;
}
async function branch(merchantId: string) {
  return (
    await owner.query(`INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
      merchantId,
      `Race branch ${randomBytes(3).toString('hex')}`,
    ])
  ).rows[0].id as string;
}
const updateBranch = (c: pg.Client, sessionId: string, branchId: string, name: string) =>
  c.query(`SELECT * FROM tenancy.update_branch($1, $2, $3, NULL)`, [sessionId, branchId, name]);
const updateRole = (c: pg.Client, sessionId: string, roleId: string, status: string) =>
  c.query(`SELECT * FROM tenancy.update_role($1, $2, NULL, $3)`, [sessionId, roleId, status]);
const branchName = async (id: string) =>
  (await owner.query(`SELECT name FROM tenancy.branches WHERE id = $1`, [id])).rows[0].name as string;

describe('(b) a staff member’s branch write against the owner deactivating that staff member, in both orders (§7.2)', () => {
  it(`never deadlocks: ${RUNS} staged runs; the write is made when it ran first, refused when the deactivation did`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const b = await business();
      const roleId = await grantedRole(b, ['merchant.branches.manage']);
      const member = await staff(b, roleId);
      const staffSession = await session(member.identityId, 'merchant', member.membershipId);
      const branchId = await branch(b.merchantId);
      const name = `Renamed ${i}`;
      const write = { c: t1, pid: pid.t1, run: () => updateBranch(t1, staffSession, branchId, name) };
      const deactivate = {
        c: t2,
        pid: pid.t2,
        run: () => updateMembership(t2, b.ownerSession, member.membershipId, 'deactivate', null),
      };
      if (i % 2 === 0) {
        // The write first: it holds the staff member's membership and role and waits for the branch; the deactivation
        // waits for that membership.
        const results = await staged({ table: 'tenancy.branches', id: branchId }, [write, deactivate]);
        expect(outcomes(results), `run ${i}`).toEqual(['ok', 'ok']);
        expect(await branchName(branchId)).toBe(name);
      } else {
        // The deactivation first: it holds the membership and waits to revoke the staff member's session; the write
        // waits for the membership, then its re-check finds the session revoked — refused, nothing written.
        const results = await staged({ table: 'identity.sessions', id: staffSession }, [deactivate, write]);
        expect(outcomes(results), `run ${i}`).toEqual(['ok', 'forbidden']);
        expect(await branchName(branchId)).not.toBe(name);
      }
      expect((await membershipState(member.membershipId)).status).toBe('deactivated');
    }
  }, 600_000);
});

describe('(i) account setup admitting two invitations of two businesses against member operations and role edits in both (§7.2)', () => {
  /** Two businesses inviting one new person as staff (role and branch each); the second issue's setup link is live. */
  async function fixture() {
    const [m1, m2] = [await business(), await business()];
    const address = email('race-two-invitations');
    const per = async (b: Awaited<ReturnType<typeof business>>) => {
      const roleId = await role(b.merchantId);
      const branchId = await branch(b.merchantId);
      const setupHash = hash();
      await t1.query(`SELECT * FROM tenancy.issue_invitation($1, $2, 'staff', $3, $4, $5, $6, 86400)`, [
        b.ownerSession,
        address,
        roleId,
        branchId,
        hash(),
        setupHash,
      ]);
      // A member of this business for the concurrent member operation.
      const other = await staff(b, roleId);
      return { ...b, roleId, branchId, setupHash, other };
    };
    const one = await per(m1);
    const two = await per(m2);
    const {
      rows: [person],
    } = await owner.query(`SELECT id FROM identity.identities WHERE email = $1`, [address]);
    return { one, two, personId: person.id as string };
  }
  const admitted = async (merchantId: string, personId: string) =>
    (
      await owner.query(
        `SELECT 1 FROM tenancy.merchant_memberships WHERE merchant_id = $1 AND identity_id = $2`,
        [merchantId, personId],
      )
    ).rowCount;

  /** x holds `holds`; each racer starts and is waiting for a lock before the next starts; then x releases. */
  async function stagedMany(holds: { table: string; id: string }[], racers: Racer[]): Promise<Settled[]> {
    await x.query('BEGIN');
    for (const h of holds) await x.query(`SELECT 1 FROM ${h.table} WHERE id = $1 FOR UPDATE`, [h.id]);
    const pending: Promise<Settled>[] = [];
    for (const r of racers) {
      await r.c.query('BEGIN');
      pending.push(inTransaction(r.c, r.run()));
      await waitsForALock(r.pid);
    }
    await x.query('ROLLBACK');
    return Promise.all(pending);
  }

  it(`never deadlocks: ${RUNS} staged runs in both orders; admission follows the role's state when setup reached it`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const { one, two, personId } = await fixture();
      const setup = {
        c: t1,
        pid: pid.t1,
        run: () => t1.query(`SELECT identity.complete_account_setup($1, $2) AS id`, [two.setupHash, ARGON]),
      };
      // In the first business, the owner moves another member to the invited branch; in the second, the owner
      // archives the role the invitation assigns.
      const memberOp = {
        c: t3,
        pid: pid.t3,
        run: () =>
          t3.query(`SELECT * FROM tenancy.update_membership($1, $2, 'assign', $3, $4)`, [
            one.ownerSession,
            one.other.membershipId,
            one.roleId,
            one.branchId,
          ]),
      };
      const roleEdit = {
        c: t2,
        pid: pid.t2,
        run: () => updateRole(t2, two.ownerSession, two.roleId, 'archived'),
      };

      let results: Settled[];
      if (i % 2 === 0) {
        // Setup first: it holds both businesses, both invitations, the token, the person and both roles (S) and waits
        // for the branches; the role edit waits for setup's hold on the role; the member operation for the branch.
        results = await stagedMany(
          [
            { table: 'tenancy.branches', id: one.branchId },
            { table: 'tenancy.branches', id: two.branchId },
          ],
          [setup, roleEdit, memberOp],
        );
        expect(
          results.map((r) => r.code),
          `run ${i}`,
        ).toEqual([null, null, null]);
        expect(outcomes(results.slice(1)), `run ${i}`).toEqual(['ok', 'ok']);
        expect(await admitted(two.merchantId, personId), `run ${i}: admitted to the second`).toBe(1);
      } else {
        // The edits first: the role edit waits for the role (x), the member operation for its owner's membership (x);
        // setup queues behind the role edit, and finds the role archived when it gets it — not admitted there.
        results = await stagedMany(
          [
            { table: 'tenancy.roles', id: two.roleId },
            { table: 'tenancy.merchant_memberships', id: one.ownerMembershipId },
          ],
          [roleEdit, memberOp, setup],
        );
        expect(
          results.map((r) => r.code),
          `run ${i}`,
        ).toEqual([null, null, null]);
        expect(outcomes(results.slice(0, 2)), `run ${i}`).toEqual(['ok', 'ok']);
        expect(await admitted(two.merchantId, personId), `run ${i}: admitted to the second`).toBe(0);
      }
      // Setup completed either way, and the first business admitted the person.
      expect(await admitted(one.merchantId, personId), `run ${i}: admitted to the first`).toBe(1);
      expect((await membershipState(one.other.membershipId)).status).toBe('active');
    }
  }, 600_000);
});

// ── P5.5 step 5: the account separation (§7.4) ─────────────────────────────────────────────────────────────────────

describe('admission of an invitation against the bootstrap of the same email, in both orders (§7.4)', () => {
  let op: pg.Client; // the operator's connection: the bootstrap is owner-only
  let opPid = 0;
  beforeAll(async () => {
    op = await connectAs('migrator');
    opPid = await pidOf(op);
  });
  afterAll(() => op.end());

  it(`never deadlocks: ${RUNS} staged runs; the identity ends in one audience — the one that reached it first`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const b = await business();
      const roleId = await role(b.merchantId);
      const {
        rows: [person],
      } = await owner.query(
        `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id, email`,
        [email('race-both-ways'), ARGON],
      );
      const token = hash();
      await t1.query(`SELECT * FROM tenancy.issue_invitation($1, $2, 'staff', $3, NULL, $4, $5, 86400)`, [
        b.ownerSession,
        person.email,
        roleId,
        token,
        hash(),
      ]);
      const admit = {
        c: t1,
        pid: pid.t1,
        run: () => t1.query(`SELECT * FROM tenancy.accept_invitation($1, $2)`, [token, person.id]),
      };
      const boot = {
        c: op,
        pid: opPid,
        run: () => op.query(`SELECT identity.bootstrap_super_admin($1, true) AS outcome`, [person.email]),
      };
      let results: Settled[];
      if (i % 2 === 0) {
        // Admission first: it holds the identity (FOR SHARE) and waits for the role; the bootstrap waits for the
        // identity, then finds the new merchant membership and refuses.
        results = await staged({ table: 'tenancy.roles', id: roleId }, [admit, boot]);
        expect(results[0]!.code, `run ${i}: admission`).toBeNull();
        expect(results[0]!.rows![0]!.outcome).toBe('ok');
        expect(results[1]!.code, `run ${i}: bootstrap`).toBe('23514');
      } else {
        // The bootstrap first: both queue for the identity; the bootstrap takes it, adds the platform membership and
        // commits; admission then finds a platform account — the generic refusal.
        results = await staged({ table: 'identity.identities', id: person.id }, [boot, admit]);
        expect(results[0]!.code, `run ${i}: bootstrap`).toBeNull();
        expect(results[1]!.code, `run ${i}: admission`).toBeNull();
        expect(results[1]!.rows![0]!.outcome).toBe('identity_ineligible');
      }
      expect(
        results.map((r) => r.code),
        `run ${i}`,
      ).not.toContain(DEADLOCK);
      const {
        rows: [audiences],
      } = await owner.query(
        `SELECT (SELECT count(*)::int FROM identity.platform_memberships WHERE identity_id = $1) AS platform,
                (SELECT count(*)::int FROM tenancy.merchant_memberships WHERE identity_id = $1) AS business`,
        [person.id],
      );
      expect(audiences, `run ${i}`).toEqual(
        i % 2 === 0 ? { platform: 0, business: 1 } : { platform: 1, business: 0 },
      );
    }
  }, 600_000);
});

// ── P5.6: the role grant writer ───────────────────────────────────────────────────────────────────────────────────

const setRolePermissions = (c: pg.Client, sessionId: string, roleId: string, permissions: string[]) =>
  c.query(`SELECT * FROM tenancy.set_role_permissions($1, $2, $3)`, [sessionId, roleId, permissions]);
const grantsOf = async (roleId: string) =>
  (
    await owner.query(`SELECT permission FROM tenancy.role_permissions WHERE role_id = $1 ORDER BY 1`, [
      roleId,
    ])
  ).rows.map((r) => r.permission as string);
const resolvedFor = async (sessionId: string) =>
  (await owner.query(`SELECT permissions FROM identity.session_authority($1)`, [sessionId])).rows[0]
    .permissions as string[];

/** x holds the rows `holdSql` selects; each racer starts and is waiting for a lock before the next; then x releases. */
async function stagedOn(holdSql: string, params: unknown[], racers: Racer[]): Promise<Settled[]> {
  await x.query('BEGIN');
  await x.query(`${holdSql} FOR UPDATE`, params);
  const pending: Promise<Settled>[] = [];
  for (const r of racers) {
    await r.c.query('BEGIN');
    pending.push(inTransaction(r.c, r.run()));
    await waitsForALock(r.pid);
  }
  await x.query('ROLLBACK');
  return Promise.all(pending);
}

describe('(c) a role-permission edit against an assignment into that role, in both orders (§7.2)', () => {
  it(`never deadlocks: ${RUNS} staged runs; both succeed, and the member ends in the role with its new set`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const b = await business();
      const from = await role(b.merchantId);
      const into = await grantedRole(b, ['merchant.profile.read']);
      const member = await staff(b, from);
      const memberSession = await session(member.identityId, 'merchant', member.membershipId);
      const second = await session(b.ownerIdentityId, 'merchant', b.ownerMembershipId);
      const edit = {
        c: t1,
        pid: pid.t1,
        run: () =>
          setRolePermissions(t1, b.ownerSession, into, ['merchant.branches.read', 'merchant.roles.read']),
      };
      const assign = {
        c: t2,
        pid: pid.t2,
        run: () => updateMembership(t2, second, member.membershipId, 'assign', into),
      };
      // Even runs: the edit first — it holds the owner's membership and waits for the role (x); the assignment waits
      // for the owner's membership. Odd runs: the assignment first — it holds both memberships and waits for the
      // role (x); the edit waits for the owner's membership.
      const results = await staged(
        { table: 'tenancy.roles', id: into },
        i % 2 === 0 ? [edit, assign] : [assign, edit],
      );
      expect(outcomes(results), `run ${i}`).toEqual(['ok', 'ok']);
      expect(await grantsOf(into)).toEqual(['merchant.branches.read', 'merchant.roles.read']);
      expect(await resolvedFor(memberSession)).toEqual(['merchant.branches.read', 'merchant.roles.read']);
    }
  }, 600_000);
});

describe('(k) a staff write against the owner editing that staff member’s role permissions, in both orders (§7.2)', () => {
  it(`never deadlocks: ${RUNS} staged runs; the write is made when it ran first, refused when the edit did`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const b = await business();
      const roleId = await grantedRole(b, ['merchant.branches.manage']);
      const member = await staff(b, roleId);
      const staffSession = await session(member.identityId, 'merchant', member.membershipId);
      const branchId = await branch(b.merchantId);
      const name = `Renamed ${i}`;
      const write = { c: t1, pid: pid.t1, run: () => updateBranch(t1, staffSession, branchId, name) };
      const edit = { c: t2, pid: pid.t2, run: () => setRolePermissions(t2, b.ownerSession, roleId, []) };
      if (i % 2 === 0) {
        // The write first: it holds the staff member's role (S) and waits for the branch (x); the edit waits for the
        // role. The write was authorized when it ran.
        const results = await stagedOn(
          `SELECT 1 FROM tenancy.branches WHERE id = $1`,
          [branchId],
          [write, edit],
        );
        expect(outcomes(results), `run ${i}`).toEqual(['ok', 'ok']);
        expect(await branchName(branchId)).toBe(name);
      } else {
        // The edit first: it holds the role (NKU) and waits to rewrite its grant rows (x); the write waits for the
        // role, then its re-check finds the permission gone — refused, nothing written.
        const results = await stagedOn(
          `SELECT 1 FROM tenancy.role_permissions WHERE role_id = $1`,
          [roleId],
          [edit, write],
        );
        expect(outcomes(results), `run ${i}`).toEqual(['ok', 'forbidden']);
        expect(await branchName(branchId)).not.toBe(name);
      }
      expect(await grantsOf(roleId)).toEqual([]);
    }
  }, 600_000);
});
