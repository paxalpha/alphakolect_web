import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// P5.2 (TARGET_ARCHITECTURE ADR-16 §3.5; P5 plan §4 invariants 2–6, §7.1, §7.2, D12): the per-request resolver
// identity.session_authority, called as authenticate() calls it (alphakolect_app), and the write-time re-check
// tenancy.assert_authority, called as a definer function will call it (the table owner, inside a transaction holding
// the caller's footprint). Resolution must be current (no cache), complete (every rule of §4) and isolated (nothing
// leaks between memberships). Changes that must not persist are made inside owner transactions that roll back.

let app: pg.Client;
let owner: pg.Client;

beforeAll(async () => {
  app = await connectAs('app');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await Promise.all([app.end(), owner.end()]);
});

const MERCHANT = [
  'merchant.audit.read',
  'merchant.branches.manage',
  'merchant.branches.read',
  'merchant.customers.anonymise',
  'merchant.customers.assign',
  'merchant.customers.manage',
  'merchant.customers.read',
  'merchant.invitations.manage',
  'merchant.invitations.read',
  'merchant.ledger.manage',
  'merchant.ledger.post',
  'merchant.ledger.read',
  'merchant.members.manage',
  'merchant.members.read',
  'merchant.profile.read',
  'merchant.profile.update',
  'merchant.roles.manage',
  'merchant.roles.read',
];
const PLATFORM = [
  'platform.audit.read',
  'platform.merchants.lifecycle',
  'platform.merchants.read',
  'platform.merchants.transfer_ownership',
  'platform.staff.manage',
];
const sorted = (xs: readonly string[]) => [...xs].sort();

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
const label = (tag: string) => `${tag} ${randomBytes(3).toString('hex')}`;

async function session(
  identityId: string,
  audience: 'merchant' | 'agent' | 'platform',
  membershipId: string,
  scope: 'full' | 'mfa_enrollment' = 'full',
) {
  const short = scope === 'mfa_enrollment';
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.create_session($1, $2, $3, $4, $5, $6, $7, NULL, NULL)`, [
    identityId,
    audience,
    membershipId,
    scope,
    hash(),
    short ? 600 : audience === 'platform' ? 3600 : 86400,
    short ? 900 : audience === 'platform' ? 43200 : 1209600,
  ]);
  return s.session_id as string;
}

async function newIdentity() {
  const {
    rows: [i],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
    [email('person')],
  );
  return i.id as string;
}

/** An active business with its owner (and the owner's session). */
async function business() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Authority Ltd')`, [
    email('owner'),
    ARGON,
  ]);
  const token = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    token,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [token]);
  const {
    rows: [m],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  return {
    merchantId: s.merchant_id as string,
    ownerMembership: m.id as string,
    ownerSession: await session(s.identity_id, 'merchant', m.id),
  };
}

/** A role with the given permissions, written as the table owner (no writer function exists before P5.6). */
async function role(merchantId: string, permissions: string[] = []) {
  const {
    rows: [r],
  } = await owner.query(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
    merchantId,
    label('Role'),
  ]);
  for (const p of permissions) {
    await owner.query(
      `INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission) VALUES ($1, $2, $3)`,
      [merchantId, r.id, p],
    );
  }
  return r.id as string;
}

async function branch(merchantId: string) {
  const {
    rows: [b],
  } = await owner.query(`INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
    merchantId,
    label('Branch'),
  ]);
  return b.id as string;
}

async function member(
  merchantId: string,
  kind: 'staff' | 'agent',
  roleId: string | null,
  opts: { branchId?: string; identityId?: string } = {},
) {
  const identityId = opts.identityId ?? (await newIdentity());
  const {
    rows: [m],
  } = await owner.query(
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id, branch_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [merchantId, identityId, kind, roleId, opts.branchId ?? null],
  );
  const membershipId = m.id as string;
  return {
    identityId,
    membershipId,
    session: await session(identityId, kind === 'agent' ? 'agent' : 'merchant', membershipId),
  };
}

/** A platform member (super admin or staff) with a confirmed second factor, its grants and a full session. */
async function platformMember(platformRole: 'super_admin' | 'support', grants: string[] = []) {
  const identityId = await newIdentity();
  await owner.query(
    `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at)
     VALUES ($1, '\\x00', 'k1', now())`,
    [identityId],
  );
  const {
    rows: [pm],
  } = await owner.query(
    `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, $2) RETURNING id`,
    [identityId, platformRole],
  );
  for (const p of grants) {
    await owner.query(
      `INSERT INTO identity.platform_membership_grants (platform_membership_id, permission) VALUES ($1, $2)`,
      [pm.id, p],
    );
  }
  return { membershipId: pm.id as string, session: await session(identityId, 'platform', pm.id) };
}

type Authority = {
  audience: string;
  kind: string;
  scope: string;
  role_status: string | null;
  branch_status: string | null;
  permissions: string[];
};
const authority = async (sessionId: string, db: pg.Client = app): Promise<Authority | null> =>
  ((await db.query<Authority>(`SELECT * FROM identity.session_authority($1)`, [sessionId])).rows[0] ??
    null) as Authority | null;
const permissions = async (sessionId: string, db: pg.Client = app) =>
  sorted((await authority(sessionId, db))?.permissions ?? ['<no session>']);

/** Run as the table owner in a transaction that is always rolled back. */
async function rolledBack<T>(fn: () => Promise<T>): Promise<T> {
  await owner.query('BEGIN');
  try {
    return await fn();
  } finally {
    await owner.query('ROLLBACK');
  }
}

describe('identity.session_authority — who holds what (plan §4 rules 3–5)', () => {
  it('the owner holds every active merchant permission — a fixed set, not rows', async () => {
    const b = await business();
    const a = await authority(b.ownerSession);
    expect(a).toMatchObject({ audience: 'merchant', kind: 'owner', scope: 'full', role_status: null });
    expect(sorted(a!.permissions)).toEqual(MERCHANT);
  });

  it('the super admin holds every active platform permission', async () => {
    const admin = await platformMember('super_admin');
    expect(await permissions(admin.session)).toEqual(PLATFORM);
  });

  it('a staff member holds exactly their role’s permissions', async () => {
    const b = await business();
    const s = await member(
      b.merchantId,
      'staff',
      await role(b.merchantId, ['merchant.members.read', 'merchant.profile.read']),
    );
    expect(await authority(s.session)).toMatchObject({ kind: 'staff', role_status: 'active' });
    expect(await permissions(s.session)).toEqual(['merchant.members.read', 'merchant.profile.read']);
  });

  it('an archived role grants nothing (D6)', async () => {
    const b = await business();
    const r = await role(b.merchantId, ['merchant.profile.read']);
    const s = await member(b.merchantId, 'staff', r);
    await owner.query(`UPDATE tenancy.roles SET status = 'archived', archived_at = now() WHERE id = $1`, [r]);
    expect(await authority(s.session)).toMatchObject({ role_status: 'archived', permissions: [] });
  });

  it('a role without permissions, an agent and an MFA-enrolment session hold nothing', async () => {
    const b = await business();
    const s = await member(b.merchantId, 'staff', await role(b.merchantId));
    const agent = await member(b.merchantId, 'agent', null);
    // Enrolment sessions exist only for the platform (sessions_enrollment_scope_is_platform): a super admin who has
    // not confirmed MFA yet holds nothing, although a full super-admin session holds every platform permission.
    const identityId = await newIdentity();
    const {
      rows: [pm],
    } = await owner.query(
      `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'super_admin') RETURNING id`,
      [identityId],
    );
    const enrolment = await session(identityId, 'platform', pm.id, 'mfa_enrollment');
    expect(await permissions(s.session)).toEqual([]);
    expect(await authority(agent.session)).toMatchObject({
      audience: 'agent',
      kind: 'agent',
      permissions: [],
    });
    expect(await authority(enrolment)).toMatchObject({ scope: 'mfa_enrollment', permissions: [] });
  });

  it('platform staff hold exactly their own grants; without grants, nothing', async () => {
    const granted = await platformMember('support', ['platform.audit.read']);
    const bare = await platformMember('support');
    expect(await authority(granted.session)).toMatchObject({
      kind: 'support',
      permissions: ['platform.audit.read'],
    });
    expect(await permissions(bare.session)).toEqual([]);
  });

  it('a grant never leaks to another membership — of another person, or of the same person', async () => {
    const a = await business();
    const b = await business();
    const person = await newIdentity();
    const inA = await member(a.merchantId, 'staff', await role(a.merchantId, ['merchant.branches.read']), {
      identityId: person,
    });
    const inB = await member(b.merchantId, 'staff', await role(b.merchantId), { identityId: person });
    const colleague = await member(a.merchantId, 'staff', await role(a.merchantId));
    expect(await permissions(inA.session)).toEqual(['merchant.branches.read']);
    expect(await permissions(inB.session)).toEqual([]);
    expect(await permissions(colleague.session)).toEqual([]);

    const staffWithGrant = await platformMember('support', ['platform.merchants.read']);
    const otherStaff = await platformMember('support');
    expect(await permissions(staffWithGrant.session)).toEqual(['platform.merchants.read']);
    expect(await permissions(otherStaff.session)).toEqual([]);
  });

  it('a retired permission is held by no one — owner, super admin or staff', async () => {
    const b = await business();
    const s = await member(
      b.merchantId,
      'staff',
      await role(b.merchantId, ['merchant.profile.read', 'merchant.roles.read']),
    );
    const admin = await platformMember('super_admin');
    await rolledBack(async () => {
      await owner.query(
        `UPDATE identity.permission_catalog SET status = 'retired'
          WHERE identifier IN ('merchant.profile.read', 'platform.audit.read')`,
      );
      expect(await permissions(b.ownerSession, owner)).toEqual(
        MERCHANT.filter((p) => p !== 'merchant.profile.read'),
      );
      expect(await permissions(s.session, owner)).toEqual(['merchant.roles.read']);
      expect(await permissions(admin.session, owner)).toEqual(
        PLATFORM.filter((p) => p !== 'platform.audit.read'),
      );
    });
  });

  it('a reserved permission is never resolved from a grant row — even one that bypassed the grant rule', async () => {
    const b = await business();
    const r = await role(b.merchantId, ['merchant.members.read']);
    const s = await member(b.merchantId, 'staff', r);
    const staff = await platformMember('support', ['platform.audit.read']);
    await rolledBack(async () => {
      // Simulate a defect that stored reserved permissions despite the trigger (defence in depth, §4 invariant 4).
      await owner.query(`ALTER TABLE tenancy.role_permissions DISABLE TRIGGER role_permissions_grantable`);
      await owner.query(
        `ALTER TABLE identity.platform_membership_grants DISABLE TRIGGER platform_membership_grants_grantable`,
      );
      await owner.query(
        `INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission) VALUES ($1, $2, 'merchant.members.manage')`,
        [b.merchantId, r],
      );
      await owner.query(
        `INSERT INTO identity.platform_membership_grants (platform_membership_id, permission) VALUES ($1, 'platform.staff.manage')`,
        [staff.membershipId],
      );
      expect(await permissions(s.session, owner)).toEqual(['merchant.members.read']);
      expect(await permissions(staff.session, owner)).toEqual(['platform.audit.read']);
    });
  });

  it('a deactivated membership or merchant, an ended session and a forged session id resolve to nothing (401)', async () => {
    const b = await business();
    const s = await member(b.merchantId, 'staff', await role(b.merchantId, ['merchant.profile.read']));
    await owner.query(
      `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [s.membershipId],
    );
    expect(await authority(s.session)).toBeNull();

    const c = await business();
    await owner.query(
      `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`,
      [c.merchantId],
    );
    expect(await authority(c.ownerSession)).toBeNull();

    const d = await business();
    await app.query(`SELECT identity.revoke_session($1, 'logout')`, [d.ownerSession]);
    expect(await authority(d.ownerSession)).toBeNull();

    expect(await authority('01900000-0000-7000-8000-0000000000ff')).toBeNull();
  });

  it('a change applies to the very next call — nothing is cached (§4 rule 2)', async () => {
    const b = await business();
    const r = await role(b.merchantId, ['merchant.branches.read', 'merchant.profile.read']);
    const s = await member(b.merchantId, 'staff', r);
    expect(await permissions(s.session)).toEqual(['merchant.branches.read', 'merchant.profile.read']);
    await owner.query(
      `DELETE FROM tenancy.role_permissions WHERE role_id = $1 AND permission = 'merchant.profile.read'`,
      [r],
    );
    expect(await permissions(s.session)).toEqual(['merchant.branches.read']);
    await owner.query(`UPDATE tenancy.roles SET status = 'archived', archived_at = now() WHERE id = $1`, [r]);
    expect(await permissions(s.session)).toEqual([]);
  });

  it('a branch restriction narrows no permission (every P5 endpoint is merchant-wide, §7.6); its state is reported', async () => {
    const b = await business();
    const br = await branch(b.merchantId);
    const s = await member(b.merchantId, 'staff', await role(b.merchantId, ['merchant.profile.read']), {
      branchId: br,
    });
    expect(await authority(s.session)).toMatchObject({
      branch_status: 'active',
      permissions: ['merchant.profile.read'],
    });
    await owner.query(`UPDATE tenancy.branches SET status = 'archived', archived_at = now() WHERE id = $1`, [
      br,
    ]);
    expect(await authority(s.session)).toMatchObject({
      branch_status: 'archived',
      permissions: ['merchant.profile.read'],
    });
  });
});

describe('tenancy.assert_authority — the write-time re-check (§7.2, §8.2a)', () => {
  const check = async (sessionId: string, permission: string, db: pg.Client = owner) =>
    (
      await db.query<{ outcome: string }>(`SELECT tenancy.assert_authority($1, $2) AS outcome`, [
        sessionId,
        permission,
      ])
    ).rows[0]!.outcome;

  it('is not executable by the app: only definer functions call it (L6)', async () => {
    const b = await business();
    await expectSqlState(check(b.ownerSession, 'merchant.profile.read', app), SQLSTATE.insufficientPrivilege);
  });

  it('answers ok, forbidden or unauthenticated — the same decision as the resolver', async () => {
    const b = await business();
    const s = await member(b.merchantId, 'staff', await role(b.merchantId, ['merchant.members.read']));
    const agent = await member(b.merchantId, 'agent', null);
    const admin = await platformMember('super_admin');
    const staff = await platformMember('support', ['platform.audit.read']);
    const ended = (await business()).ownerSession;
    await app.query(`SELECT identity.revoke_session($1, 'logout')`, [ended]);

    expect(await check(b.ownerSession, 'merchant.roles.manage')).toBe('ok');
    expect(await check(b.ownerSession, 'platform.audit.read')).toBe('forbidden');
    expect(await check(s.session, 'merchant.members.read')).toBe('ok');
    expect(await check(s.session, 'merchant.profile.read')).toBe('forbidden');
    expect(await check(s.session, 'merchant.members.manage')).toBe('forbidden');
    expect(await check(agent.session, 'merchant.profile.read')).toBe('forbidden');
    expect(await check(admin.session, 'platform.staff.manage')).toBe('ok');
    expect(await check(admin.session, 'merchant.profile.read')).toBe('forbidden');
    expect(await check(staff.session, 'platform.audit.read')).toBe('ok');
    expect(await check(staff.session, 'platform.merchants.read')).toBe('forbidden');
    expect(await check(ended, 'merchant.profile.read')).toBe('unauthenticated');
    expect(await check('01900000-0000-7000-8000-0000000000ff', 'merchant.profile.read')).toBe(
      'unauthenticated',
    );
  });

  it('raises on an identifier that is not in the catalog, so a misspelling can never pass as "not held"', async () => {
    const b = await business();
    await expectSqlState(check(b.ownerSession, 'merchant.profile.raed'), '22023');
  });

  it('never waits: an authority row locked by another transaction and not by the caller fails at once (55P03)', async () => {
    const b = await business();
    const s = await member(b.merchantId, 'staff', await role(b.merchantId, ['merchant.branches.manage']));
    const blocker = await connectAs('migrator');
    try {
      await blocker.query('BEGIN');
      await blocker.query(`SELECT 1 FROM tenancy.merchant_memberships WHERE id = $1 FOR NO KEY UPDATE`, [
        s.membershipId,
      ]);
      await owner.query('BEGIN');
      await owner.query(`SET LOCAL lock_timeout = '10s'`);
      const started = Date.now();
      await expectSqlState(check(s.session, 'merchant.branches.manage'), '55P03');
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await owner.query('ROLLBACK');
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
  });
});

// §7.2: "A permission revoked concurrently is either committed before the write's re-check (write refused) or waits
// until the write commits (the write was authorized when it happened)." The revocations that exist at this point are
// membership deactivation (tenancy.update_membership, the owner's) and role archive (the app's direct UPDATE until
// P5.5). The writer stands in for a P5.5 definer function: whole footprint first (merchant S → actor membership NKU →
// actor's role S), then the re-check, then the write.
describe('two connections: the re-check followed by a write vs a concurrent revocation (§7.2)', () => {
  let revoker: pg.Client;
  let watcher: pg.Client;
  beforeAll(async () => {
    revoker = await connectAs('app');
    watcher = await connectAs('migrator');
  });
  afterAll(async () => {
    await Promise.all([revoker.end(), watcher.end()]);
  });

  async function setup() {
    const b = await business();
    const r = await role(b.merchantId, ['merchant.branches.manage']);
    const s = await member(b.merchantId, 'staff', r);
    return { ...b, roleId: r, staff: s, branchId: await branch(b.merchantId) };
  }
  type Fixture = Awaited<ReturnType<typeof setup>>;

  /** Writer, part 1: footprint, then the re-check. Leaves its transaction open. */
  async function lockAndCheck(f: Fixture) {
    await owner.query('BEGIN');
    await owner.query(`SELECT 1 FROM tenancy.merchants WHERE id = $1 FOR SHARE`, [f.merchantId]);
    await owner.query(`SELECT 1 FROM tenancy.merchant_memberships WHERE id = $1 FOR NO KEY UPDATE`, [
      f.staff.membershipId,
    ]);
    await owner.query(`SELECT 1 FROM tenancy.roles WHERE id = $1 FOR SHARE`, [f.roleId]);
    const {
      rows: [{ outcome }],
    } = await owner.query(`SELECT tenancy.assert_authority($1, 'merchant.branches.manage') AS outcome`, [
      f.staff.session,
    ]);
    return outcome as string;
  }
  /** Writer, part 2: write only on 'ok', then commit. */
  async function writeAndCommit(f: Fixture, outcome: string, name: string) {
    if (outcome === 'ok') {
      await owner.query(`UPDATE tenancy.branches SET name = $2, updated_at = now() WHERE id = $1`, [
        f.branchId,
        name,
      ]);
    }
    await owner.query('COMMIT');
  }
  const branchName = async (f: Fixture) =>
    (await owner.query(`SELECT name FROM tenancy.branches WHERE id = $1`, [f.branchId])).rows[0]
      .name as string;

  const revocations = {
    'membership deactivation': {
      start: async (f: Fixture) => {
        await revoker.query('BEGIN');
        return revoker.query(
          `SELECT outcome FROM tenancy.update_membership($1, $2, 'deactivate', NULL, NULL)`,
          [f.ownerSession, f.staff.membershipId],
        );
      },
      refusal: 'unauthenticated',
    },
    'role archive': {
      start: async (f: Fixture) => {
        await revoker.query('BEGIN');
        // Since P5.5 the owner archives a role only through tenancy.update_role (the enforcement boundary).
        return revoker.query(`SELECT outcome FROM tenancy.update_role($1, $2, NULL, 'archived')`, [
          f.ownerSession,
          f.roleId,
        ]);
      },
      refusal: 'forbidden',
    },
  } as const;

  async function waitsForALock(pid: number) {
    for (let i = 0; i < 200; i++) {
      const { rowCount } = await watcher.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [
        pid,
      ]);
      if (rowCount) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`backend ${pid} never waited for a lock`);
  }
  const pidOf = async (db: pg.Client) =>
    (await db.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;

  describe.each(Object.entries(revocations))('%s', (_name, revocation) => {
    it('committed before the re-check: the re-check refuses and nothing is written', async () => {
      const f = await setup();
      await revocation.start(f);
      await revoker.query('COMMIT');
      const outcome = await lockAndCheck(f);
      expect(outcome).toBe(revocation.refusal);
      const before = await branchName(f);
      await writeAndCommit(f, outcome, 'Should not be written');
      expect(await branchName(f)).toBe(before);
    });

    it('re-checked first: the revocation waits until the write commits; the write was authorized when it ran', async () => {
      const f = await setup();
      expect(await lockAndCheck(f)).toBe('ok');
      const pid = await pidOf(revoker);
      const pending = revocation.start(f);
      await waitsForALock(pid);
      await writeAndCommit(f, 'ok', 'Written under authority');
      await pending;
      await revoker.query('COMMIT');
      expect(await branchName(f)).toBe('Written under authority');
      // …and the revocation took effect afterwards.
      expect(await check(f.staff.session)).toBe(revocation.refusal);
    });

    it('in progress when the writer starts: the writer waits for it, then its re-check refuses', async () => {
      const f = await setup();
      await revocation.start(f);
      const pid = await pidOf(owner);
      const writer = lockAndCheck(f);
      await waitsForALock(pid);
      await revoker.query('COMMIT');
      const outcome = await writer;
      expect(outcome).toBe(revocation.refusal);
      const before = await branchName(f);
      await writeAndCommit(f, outcome, 'Should not be written');
      expect(await branchName(f)).toBe(before);
    });
  });

  const check = async (sessionId: string) =>
    (
      await owner.query(`SELECT tenancy.assert_authority($1, 'merchant.branches.manage') AS outcome`, [
        sessionId,
      ])
    ).rows[0].outcome as string;
});
