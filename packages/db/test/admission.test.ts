import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// Admission after P5.5 step 5 (P5 plan §8.1 pattern A, §7.4 CF3). tenancy.admit_invitation_locked records each
// acceptance itself (auth.invitation_accepted, #14) on both paths — the invitation link (accept_invitation) and
// account setup (complete_account_setup) — with the capability-based actor: the invitation's identity, no audience,
// the membership just created, the invitation's business, the invitation as target. Platform and business accounts
// stay apart both ways: admission refuses a platform account, the bootstrap refuses a business account. Called as
// the API calls them (alphakolect_app); the bootstrap as the operator (the migrator); effects read as the owner.

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [app, owner] = await Promise.all([connectAs('app'), connectAs('migrator')]);
});
afterAll(async () => {
  await Promise.all([app.end(), owner.end()]);
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
const ctx = () => ({
  ip: '203.0.113.9',
  userAgent: 'admission-test',
  requestId: `ad-${randomBytes(6).toString('hex')}`,
});

async function session(identityId: string, membershipId: string) {
  const {
    rows: [s],
  } = await app.query(
    `SELECT * FROM identity.create_session($1, 'merchant', $2, 'full', $3, 86400, 1209600, NULL, NULL)`,
    [identityId, membershipId, hash()],
  );
  return s.session_id as string;
}

/** An active business with its owner signed in and a role. */
async function business() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Admission Ltd')`, [
    email('owner'),
    ARGON,
  ]);
  const verification = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    verification,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [verification]);
  const {
    rows: [o],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  const {
    rows: [r],
  } = await owner.query(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
    s.merchant_id,
    `Role ${randomBytes(3).toString('hex')}`,
  ]);
  return {
    merchantId: s.merchant_id as string,
    roleId: r.id as string,
    ownerSession: await session(s.identity_id, o.id),
  };
}
type Business = Awaited<ReturnType<typeof business>>;

/** An invitation of `b` to `address`; the token and setup token are returned with the function's answer. */
async function invite(b: Business, address: string, kind: 'staff' | 'agent' = 'agent') {
  const token = hash();
  const setupToken = hash();
  const {
    rows: [issued],
  } = await app.query(`SELECT * FROM tenancy.issue_invitation($1, $2, $3, $4, NULL, $5, $6, 86400)`, [
    b.ownerSession,
    address,
    kind,
    kind === 'staff' ? b.roleId : null,
    token,
    setupToken,
  ]);
  return { ...issued, token, setupToken } as {
    outcome: string;
    invitation_id: string;
    delivery: string;
    token: string;
    setupToken: string;
  };
}

/** An existing account (verified, with a password) — a business member elsewhere or nobody's. */
async function account(tag = 'account') {
  const {
    rows: [i],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id, email`,
    [email(tag), ARGON],
  );
  return { identityId: i.id as string, email: i.email as string };
}

const accept = (token: string, identityId: string, c = ctx()) =>
  app.query(`SELECT * FROM tenancy.accept_invitation($1, $2, $3, $4, $5)`, [
    token,
    identityId,
    c.ip,
    c.userAgent,
    c.requestId,
  ]);
const completeSetup = (token: string, c = ctx()) =>
  app.query(`SELECT identity.complete_account_setup($1, $2, $3, $4, $5) AS id`, [
    token,
    ARGON,
    c.ip,
    c.userAgent,
    c.requestId,
  ]);

const acceptances = async (requestId: string) =>
  (
    await owner.query(
      `SELECT merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id,
              outcome, ip, user_agent, request_id, summary
         FROM audit.audit_events WHERE request_id = $1 AND action = 'auth.invitation_accepted'`,
      [requestId],
    )
  ).rows;
const membershipsOf = async (identityId: string) =>
  (
    await owner.query(
      `SELECT id, merchant_id, kind FROM tenancy.merchant_memberships WHERE identity_id = $1`,
      [identityId],
    )
  ).rows;
const invitationState = async (id: string) =>
  (
    await owner.query(`SELECT accepted_at, accepted_membership_id FROM tenancy.invitations WHERE id = $1`, [
      id,
    ])
  ).rows[0];
const platformMemberships = async (identityId: string) =>
  (
    await owner.query(`SELECT role, status FROM identity.platform_memberships WHERE identity_id = $1`, [
      identityId,
    ])
  ).rows;
const bootstrap = (address: string) =>
  owner.query(`SELECT identity.bootstrap_super_admin($1, true) AS id`, [address]);

describe('#14 written by admission, with the capability-based actor (§8.1)', () => {
  it('the invitation link: one row in the same transaction — the invitation’s identity, no audience, the new membership', async () => {
    const b = await business();
    const person = await account('linked');
    const issued = await invite(b, person.email, 'staff');
    expect(issued).toMatchObject({ outcome: 'ok', delivery: 'accept' });
    const c = ctx();
    const {
      rows: [result],
    } = await accept(issued.token, person.identityId, c);
    expect(result.outcome).toBe('ok');
    expect(await acceptances(c.requestId)).toEqual([
      {
        merchant_id: b.merchantId,
        actor_identity_id: person.identityId,
        actor_audience: null,
        actor_membership_id: result.membership_id,
        action: 'auth.invitation_accepted',
        target_type: 'invitation',
        target_id: issued.invitation_id,
        outcome: 'success',
        ip: '203.0.113.9',
        user_agent: 'admission-test',
        request_id: c.requestId,
        summary: { path: 'invitation_link', kind: 'staff' },
      },
    ]);
  });

  it('account setup: one row per admission, the consumed token’s identity as actor, path account_setup', async () => {
    const b = await business();
    const address = email('newcomer');
    const issued = await invite(b, address);
    expect(issued.delivery).toBe('setup');
    const c = ctx();
    const {
      rows: [{ id }],
    } = await completeSetup(issued.setupToken, c);
    const [m] = await membershipsOf(id);
    expect(await acceptances(c.requestId)).toEqual([
      expect.objectContaining({
        merchant_id: b.merchantId,
        actor_identity_id: id,
        actor_audience: null,
        actor_membership_id: m.id,
        target_id: issued.invitation_id,
        summary: { path: 'account_setup', kind: 'agent' },
      }),
    ]);
  });

  it('a call with another identity is refused and writes nothing — the argument is compared, never recorded', async () => {
    const b = await business();
    const invited = await account('invited');
    const intruder = await account('intruder');
    const issued = await invite(b, invited.email);
    const c = ctx();
    const {
      rows: [result],
    } = await accept(issued.token, intruder.identityId, c);
    expect(result.outcome).toBe('wrong_identity');
    expect(await membershipsOf(intruder.identityId)).toEqual([]);
    expect(await membershipsOf(invited.identityId)).toEqual([]);
    expect(await invitationState(issued.invitation_id)).toEqual({
      accepted_at: null,
      accepted_membership_id: null,
    });
    expect(await acceptances(c.requestId)).toEqual([]);
  });

  it('the row failing to store rolls the admission back: no membership, the invitation still pending', async () => {
    const b = await business();
    const person = await account('rollback');
    const issued = await invite(b, person.email);
    await owner.query('BEGIN');
    try {
      // A test-only trigger inside this transaction (the database tests run one file at a time).
      await owner.query(
        `CREATE FUNCTION audit.test_fail_acceptance() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW.action = 'auth.invitation_accepted' AND NEW.outcome = 'success' THEN
             RAISE EXCEPTION 'injected audit storage failure' USING ERRCODE = 'XX000';
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await owner.query(
        `CREATE TRIGGER test_fail_acceptance BEFORE INSERT ON audit.audit_events
           FOR EACH ROW EXECUTE FUNCTION audit.test_fail_acceptance()`,
      );
      await owner.query('SAVEPOINT acceptance');
      await expectSqlState(
        owner.query(`SELECT * FROM tenancy.accept_invitation($1, $2)`, [issued.token, person.identityId]),
        'XX000',
      );
      await owner.query('ROLLBACK TO SAVEPOINT acceptance');
      const { rowCount } = await owner.query(
        `SELECT 1 FROM tenancy.merchant_memberships WHERE identity_id = $1`,
        [person.identityId],
      );
      expect(rowCount).toBe(0);
      const {
        rows: [inv],
      } = await owner.query(`SELECT accepted_at FROM tenancy.invitations WHERE id = $1`, [
        issued.invitation_id,
      ]);
      expect(inv.accepted_at).toBeNull();
    } finally {
      await owner.query('ROLLBACK');
    }
  });
});

describe('platform and business accounts stay apart, both ways (§7.4, CF3)', () => {
  /** A platform account with a password (as one is after its setup), of any role and status. */
  async function platformAccount(role: string, status: 'active' | 'deactivated' = 'active') {
    const a = await account(`platform-${role}`);
    await owner.query(
      `INSERT INTO identity.platform_memberships (identity_id, role, status, deactivated_at)
       VALUES ($1, $2, $3, CASE WHEN $3 = 'deactivated' THEN now() END)`,
      [a.identityId, role, status],
    );
    return a;
  }

  it('the issue answer for a platform account is the same as for any existing account', async () => {
    const b = await business();
    const platform = await invite(b, (await platformAccount('support')).email);
    const ordinary = await invite(b, (await account()).email);
    const shape = (r: { outcome: string; delivery: string }) => ({
      outcome: r.outcome,
      delivery: r.delivery,
    });
    expect(shape(platform)).toEqual(shape(ordinary));
  });

  it.each([
    ['a super admin', 'super_admin', 'active'],
    ['a support member', 'support', 'active'],
    ['a deactivated platform member', 'finance', 'deactivated'],
  ] as const)(
    '%s cannot join a business by the invitation link — the generic refusal, nothing written',
    async (_l, role, status) => {
      const b = await business();
      const p = await platformAccount(role, status);
      const issued = await invite(b, p.email);
      const c = ctx();
      const {
        rows: [result],
      } = await accept(issued.token, p.identityId, c);
      expect(result.outcome).toBe('identity_ineligible');
      expect(await membershipsOf(p.identityId)).toEqual([]);
      expect(await invitationState(issued.invitation_id)).toEqual({
        accepted_at: null,
        accepted_membership_id: null,
      });
      expect(await acceptances(c.requestId)).toEqual([]);
    },
  );

  it('a bootstrapped super admin finishing setup through a business’s invitation is not admitted', async () => {
    const address = email('bootstrapped');
    const {
      rows: [{ id }],
    } = await bootstrap(address);
    const b = await business();
    const issued = await invite(b, address);
    // A passwordless account: the business's answer is the setup link, as for any new person.
    expect(issued).toMatchObject({ outcome: 'ok', delivery: 'setup' });
    const c = ctx();
    const {
      rows: [done],
    } = await completeSetup(issued.setupToken, c);
    expect(done.id).toBe(id); // the setup itself completes (the password is set) …
    expect(await membershipsOf(id)).toEqual([]); // … but the platform account joins no business
    expect(await acceptances(c.requestId)).toEqual([]);
    expect(await platformMemberships(id)).toEqual([{ role: 'super_admin', status: 'active' }]);
  });

  it('the bootstrap refuses an email with a merchant membership and creates nothing', async () => {
    const b = await business();
    const member = await account('member');
    const issued = await invite(b, member.email);
    expect((await accept(issued.token, member.identityId)).rows[0].outcome).toBe('ok');
    const before = (
      await owner.query(
        `SELECT count(*)::int AS n FROM audit.audit_events WHERE action = 'platform.super_admin_bootstrapped'`,
      )
    ).rows[0].n;
    await owner.query('BEGIN');
    try {
      const err = await expectSqlState(bootstrap(member.email), SQLSTATE.checkViolation);
      expect(err.message).toMatch(/business account/);
    } finally {
      await owner.query('ROLLBACK');
    }
    expect(await platformMemberships(member.identityId)).toEqual([]);
    const after = (
      await owner.query(
        `SELECT count(*)::int AS n FROM audit.audit_events WHERE action = 'platform.super_admin_bootstrapped'`,
      )
    ).rows[0].n;
    expect(after).toBe(before);
  });

  it('a deactivated merchant membership still makes it a business account', async () => {
    const b = await business();
    const member = await account('former-member');
    await owner.query(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, status, deactivated_at)
       VALUES ($1, $2, 'agent', 'deactivated', now())`,
      [b.merchantId, member.identityId],
    );
    await owner.query('BEGIN');
    try {
      await expectSqlState(bootstrap(member.email), SQLSTATE.checkViolation);
    } finally {
      await owner.query('ROLLBACK');
    }
  });

  it('the bootstrap still takes a passwordless identity in no audience (an invitation withdrawn before setup)', async () => {
    const b = await business();
    const address = email('withdrawn');
    const issued = await invite(b, address);
    await app.query(`SELECT * FROM tenancy.revoke_invitation($1, $2)`, [
      b.ownerSession,
      issued.invitation_id,
    ]);
    const {
      rows: [person],
    } = await owner.query(`SELECT id FROM identity.identities WHERE email = $1`, [address]);
    const {
      rows: [{ id }],
    } = await bootstrap(address);
    expect(id).toBe(person.id);
    expect(await platformMemberships(id)).toEqual([{ role: 'super_admin', status: 'active' }]);
  });

  it('the migration refuses to run over an identity already in both audiences (its own guard, rolled back)', async () => {
    const sql = readFileSync(
      new URL('../prisma/migrations/20261014000100_account_setup/migration.sql', import.meta.url),
      'utf8',
    );
    const guard = /DO \$guard\$[\s\S]*?\$guard\$;/.exec(sql)?.[0];
    expect(guard).toBeDefined();
    await owner.query('BEGIN');
    try {
      const b = await business();
      const both = await account('both');
      await owner.query(
        `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'support')`,
        [both.identityId],
      );
      await owner.query(
        `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent')`,
        [b.merchantId, both.identityId],
      );
      const err = await expectSqlState(owner.query(guard!), SQLSTATE.checkViolation);
      expect(err.message).toMatch(/both a platform and a merchant membership/);
    } finally {
      await owner.query('ROLLBACK');
    }
  });
});

describe('no actor can be supplied', () => {
  it.each([
    [
      'tenancy',
      'admit_invitation_locked',
      'p_invitation_id p_identity_id p_path p_ip p_user_agent p_request_id',
    ],
    ['tenancy', 'accept_invitation', 'p_token_hash p_identity_id p_ip p_user_agent p_request_id'],
    ['identity', 'complete_account_setup', 'p_token_hash p_password_hash p_ip p_user_agent p_request_id'],
  ])('%s.%s(%s)', async (schema, name, args) => {
    const {
      rows: [f],
    } = await owner.query(
      `SELECT array_to_string(p.proargnames[1:p.pronargs], ' ') AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.proname = $2`,
      [schema, name],
    );
    expect(f.args).toBe(args);
  });
});
