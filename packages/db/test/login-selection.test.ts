import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// P4.2 login membership selection (ADR-15 T3, T4, T16), called as alphakolect_app with token HASHES only.
// Fresh merchants per test (signup + verification); effects checked through the table owner.

let app: pg.Client;
let app2: pg.Client;
let owner: pg.Client;

beforeAll(async () => {
  app = await connectAs('app');
  app2 = await connectAs('app');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await Promise.all([app.end(), app2.end(), owner.end()]);
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = (tag: string) => `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$${tag}`;
const uniqueEmail = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;

/** A verified (active) merchant from signup. */
async function newMerchant(name: string) {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, $3)`, [
    uniqueEmail('owner'),
    ARGON('pw'),
    name,
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
    identityId: s.identity_id as string,
    membershipId: m.id as string,
  };
}

/** Adds a membership of `kind` for `identityId` in `merchantId`. */
async function addMembership(identityId: string, merchantId: string, kind: 'staff' | 'agent') {
  const {
    rows: [m],
  } = await owner.query(
    kind === 'staff'
      ? // staff carry a role of the same merchant (ADR-15 T8)
        `WITH r AS (INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Staff ' || gen_random_uuid()) RETURNING id)
          INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id)
          SELECT $1, $2, 'staff', r.id FROM r RETURNING id`
      : `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent') RETURNING id`,
    [merchantId, identityId],
  );
  return m.id as string;
}

/** One identity: owner of "Zeta Stores", staff at "Alpha Foods" — two eligible merchant memberships. */
async function twoMemberships() {
  const zeta = await newMerchant(`Zeta Stores ${randomBytes(2).toString('hex')}`);
  const alpha = await newMerchant(`Alpha Foods ${randomBytes(2).toString('hex')}`);
  const staffAtAlpha = await addMembership(zeta.identityId, alpha.merchantId, 'staff');
  return { identityId: zeta.identityId, zeta, alpha, ownerAtZeta: zeta.membershipId, staffAtAlpha };
}

const resolve = async (identityId: string, audience: string, challenge = hash()) => ({
  challenge,
  ...((
    await app.query(`SELECT * FROM identity.resolve_login_membership($1, $2, $3)`, [
      identityId,
      audience,
      challenge,
    ])
  ).rows[0] as { eligible_count: number; membership_id: string | null }),
});
const choices = async (challenge: string) =>
  (await app.query(`SELECT * FROM identity.selection_choices($1)`, [challenge])).rows as Array<{
    membership_id: string;
    merchant_name: string;
    kind: string;
  }>;
const take = async (challenge: string, membershipId: string, db: pg.Client = app) =>
  (await db.query(`SELECT * FROM identity.take_selection($1, $2)`, [challenge, membershipId])).rows;
const challengeRow = async (challenge: string) =>
  (
    await owner.query(
      `SELECT consumed_at IS NOT NULL AS consumed FROM identity.membership_selection_challenges WHERE token_hash = $1`,
      [challenge],
    )
  ).rows[0] as { consumed: boolean } | undefined;

describe('nothing exposes memberships without a challenge', () => {
  it('eligible_memberships and the challenge table are out of the app’s reach; login_candidate is gone', async () => {
    const { rows } = await owner.query(`
      SELECT has_function_privilege('alphakolect_app', 'identity.eligible_memberships(uuid,text)', 'EXECUTE') AS eligible,
             has_table_privilege('alphakolect_app', 'identity.membership_selection_challenges', 'SELECT') AS read_challenges,
             has_function_privilege('alphakolect_app', 'identity.resolve_login_membership(uuid,text,text)', 'EXECUTE') AS resolve,
             has_function_privilege('alphakolect_app', 'identity.selection_choices(text)', 'EXECUTE') AS choices,
             has_function_privilege('alphakolect_app', 'identity.take_selection(text,uuid)', 'EXECUTE') AS take,
             has_function_privilege('alphakolect_readonly', 'identity.selection_choices(text)', 'EXECUTE') AS readonly_choices,
             to_regprocedure('identity.login_candidate(text,text)') IS NULL AS login_candidate_dropped`);
    expect(rows[0]).toEqual({
      eligible: false,
      read_challenges: false,
      resolve: true,
      choices: true,
      take: true,
      readonly_choices: false,
      login_candidate_dropped: true,
    });
    await expectSqlState(
      app.query(`SELECT * FROM identity.eligible_memberships(gen_random_uuid(), 'merchant')`),
      SQLSTATE.insufficientPrivilege,
    );
  });

  it('resolve returns only a count and, for exactly one, that membership — never names', async () => {
    const m = await newMerchant('Solo Ltd');
    const { rows, fields } = await app.query(
      `SELECT * FROM identity.resolve_login_membership($1, 'merchant', $2)`,
      [m.identityId, hash()],
    );
    expect(fields.map((f) => f.name)).toEqual(['eligible_count', 'membership_id']);
    expect(rows[0]).toEqual({ eligible_count: 1, membership_id: m.membershipId });
  });
});

describe('eligibility (T4, T5)', () => {
  it('several eligible memberships ⇒ no membership chosen, a challenge created; one ⇒ no challenge', async () => {
    const two = await twoMemberships();
    const r = await resolve(two.identityId, 'merchant');
    expect(r.eligible_count).toBe(2);
    expect(r.membership_id).toBeNull();
    expect(await challengeRow(r.challenge)).toEqual({ consumed: false });

    const one = await newMerchant('Single Co');
    const single = await resolve(one.identityId, 'merchant');
    expect(single).toMatchObject({ eligible_count: 1, membership_id: one.membershipId });
    expect(await challengeRow(single.challenge)).toBeUndefined();
  });

  it.each([
    ['a deactivated membership', 'membership'],
    ['an inactive merchant', 'merchant'],
  ])('excludes %s', async (_label, what) => {
    const two = await twoMemberships();
    if (what === 'membership') {
      await owner.query(
        `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
        [two.staffAtAlpha],
      );
    } else {
      await owner.query(
        `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`,
        [two.alpha.merchantId],
      );
    }
    expect(await resolve(two.identityId, 'merchant')).toMatchObject({
      eligible_count: 1,
      membership_id: two.ownerAtZeta,
    });
  });

  it('keeps audiences apart: an agent membership is not a merchant-audience choice, and vice versa', async () => {
    const m = await newMerchant('Agents Inc');
    const other = await newMerchant('Field Co');
    await addMembership(m.identityId, other.merchantId, 'agent');
    expect(await resolve(m.identityId, 'merchant')).toMatchObject({
      eligible_count: 1,
      membership_id: m.membershipId,
    });
    expect((await resolve(m.identityId, 'agent')).eligible_count).toBe(1);
  });

  it('a disabled identity has nothing eligible; every active platform membership is eligible, whatever its role (P5.7)', async () => {
    const m = await newMerchant('Disabled Ltd');
    await owner.query(`UPDATE identity.identities SET status = 'disabled' WHERE id = $1`, [m.identityId]);
    expect((await resolve(m.identityId, 'merchant')).eligible_count).toBe(0);

    const {
      rows: [support],
    } = await owner.query(
      `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
      [uniqueEmail('support')],
    );
    const {
      rows: [membership],
    } = await owner.query(
      `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'support') RETURNING id`,
      [support.id],
    );
    // A staff member signs in with no permissions (the role is a label, D4); MFA is still required at login.
    expect(await resolve(support.id, 'platform')).toMatchObject({
      eligible_count: 1,
      membership_id: membership.id,
    });
    await owner.query(
      `UPDATE identity.platform_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [membership.id],
    );
    expect((await resolve(support.id, 'platform')).eligible_count).toBe(0);
  });
});

describe('choices (GET): only to a valid challenge, never consuming it', () => {
  it('lists the eligible memberships by merchant name, minimal fields, as often as asked', async () => {
    const two = await twoMemberships();
    const { challenge } = await resolve(two.identityId, 'merchant');
    const first = await choices(challenge);
    expect(first.map((c) => [c.membership_id, c.kind])).toEqual([
      [two.staffAtAlpha, 'staff'], // "Alpha Foods …" sorts before "Zeta Stores …"
      [two.ownerAtZeta, 'owner'],
    ]);
    expect(Object.keys(first[0]!).sort()).toEqual(['kind', 'membership_id', 'merchant_name']);
    expect(await choices(challenge)).toEqual(first);
    expect(await challengeRow(challenge)).toEqual({ consumed: false });
  });

  it('shows nothing for an unknown, expired or consumed challenge', async () => {
    const two = await twoMemberships();
    expect(await choices(hash())).toEqual([]);

    const expired = await resolve(two.identityId, 'merchant');
    await owner.query(
      `UPDATE identity.membership_selection_challenges SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [expired.challenge],
    );
    expect(await choices(expired.challenge)).toEqual([]);

    const used = await resolve(two.identityId, 'merchant');
    await take(used.challenge, two.ownerAtZeta);
    expect(await choices(used.challenge)).toEqual([]);
  });

  it('reflects current state: a membership deactivated after the challenge disappears from the choices', async () => {
    const two = await twoMemberships();
    const { challenge } = await resolve(two.identityId, 'merchant');
    await owner.query(
      `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [two.staffAtAlpha],
    );
    expect((await choices(challenge)).map((c) => c.membership_id)).toEqual([two.ownerAtZeta]);
  });
});

describe('selection (POST): consumed exactly once, then re-checked (T16)', () => {
  it('returns the chosen eligible membership once; a replay gets nothing', async () => {
    const two = await twoMemberships();
    const { challenge } = await resolve(two.identityId, 'merchant');
    expect(await take(challenge, two.staffAtAlpha)).toEqual([
      { identity_id: two.identityId, audience: 'merchant', membership_id: two.staffAtAlpha },
    ]);
    expect(await challengeRow(challenge)).toEqual({ consumed: true });
    expect(await take(challenge, two.ownerAtZeta)).toEqual([]);
  });

  it('a choice that is not (or no longer) eligible gets nothing — and still uses the challenge up (decision b)', async () => {
    const two = await twoMemberships();
    const stranger = await newMerchant('Stranger Ltd');

    const a = await resolve(two.identityId, 'merchant');
    expect(await take(a.challenge, stranger.membershipId)).toEqual([]); // someone else's membership
    expect(await challengeRow(a.challenge)).toEqual({ consumed: true });
    expect(await take(a.challenge, two.ownerAtZeta)).toEqual([]);

    const b = await resolve(two.identityId, 'merchant');
    await owner.query(
      `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`,
      [two.alpha.merchantId],
    );
    expect(await take(b.challenge, two.staffAtAlpha)).toEqual([]); // merchant deactivated meanwhile
    expect(await challengeRow(b.challenge)).toEqual({ consumed: true });
  });

  it('an expired challenge gets nothing; an identity disabled after the challenge gets nothing', async () => {
    const two = await twoMemberships();
    const expired = await resolve(two.identityId, 'merchant');
    await owner.query(
      `UPDATE identity.membership_selection_challenges SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [expired.challenge],
    );
    expect(await take(expired.challenge, two.ownerAtZeta)).toEqual([]);

    const live = await resolve(two.identityId, 'merchant');
    await owner.query(`UPDATE identity.identities SET status = 'disabled' WHERE id = $1`, [two.identityId]);
    expect(await take(live.challenge, two.ownerAtZeta)).toEqual([]);
  });

  it('a challenge is bound to the audience it was issued for', async () => {
    // One identity: owner at "Audience Co" (merchant audience) and an agent at two other merchants (agent audience).
    const m = await newMerchant('Audience Co');
    const fieldA = await newMerchant('Audience Field A');
    const fieldB = await newMerchant('Audience Field B');
    const agentA = await addMembership(m.identityId, fieldA.merchantId, 'agent');
    const agentB = await addMembership(m.identityId, fieldB.merchantId, 'agent');

    const agentChallenge = await resolve(m.identityId, 'agent'); // two agent memberships ⇒ a challenge
    expect(agentChallenge.eligible_count).toBe(2);
    // The choices are the agent memberships only — never the owner membership of the merchant audience…
    expect((await choices(agentChallenge.challenge)).map((c) => c.membership_id).sort()).toEqual(
      [agentA, agentB].sort(),
    );
    // …and the selection is an agent-audience membership.
    expect(await take(agentChallenge.challenge, agentA)).toEqual([
      { identity_id: m.identityId, audience: 'agent', membership_id: agentA },
    ]);

    // The other way round: an agent membership is never a merchant-audience choice.
    const extra = await newMerchant('Audience Extra');
    await addMembership(m.identityId, extra.merchantId, 'staff');
    const merchantChallenge = await resolve(m.identityId, 'merchant'); // owner + staff ⇒ a challenge
    expect(await take(merchantChallenge.challenge, agentB)).toEqual([]);
  });

  it('two concurrent selections with the same challenge: exactly one succeeds', async () => {
    const two = await twoMemberships();
    const { challenge } = await resolve(two.identityId, 'merchant');
    await app.query('BEGIN');
    try {
      const first = await take(challenge, two.ownerAtZeta, app); // holds the row lock
      const second = take(challenge, two.staffAtAlpha, app2); // waits for it
      await new Promise((r) => setTimeout(r, 200));
      await app.query('COMMIT');
      expect(first).toHaveLength(1);
      expect(await second).toEqual([]);
    } catch (err) {
      await app.query('ROLLBACK');
      throw err;
    }
  });

  it('only SHA-256 hashes can be stored', async () => {
    const m = await newMerchant('Hash Check');
    await expectSqlState(
      owner.query(
        `INSERT INTO identity.membership_selection_challenges (identity_id, audience, token_hash, expires_at)
         VALUES ($1, 'merchant', repeat('Z', 64), now() + interval '1 minute')`,
        [m.identityId],
      ),
      SQLSTATE.checkViolation,
    );
  });
});
