import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// P4.7 (ADR-15 T12, "Agent refresh"): identity.rotate_refresh_token takes the audiences the calling endpoint serves.
// A token of another audience is 'invalid' with no side effect — not rotated, and not even reuse-revoked — so a web
// refresh token can never be turned into a body-delivered token at the agent endpoint, nor the reverse. Agent
// sessions rotate with the agent lifetimes (D5: 30 days idle, 90 days absolute). Called as alphakolect_app.

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  app = await connectAs('app');
  owner = await connectAs('migrator');
});
afterAll(async () => {
  await Promise.all([app.end(), owner.end()]);
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
const WEB = ['platform', 'merchant'];
const AGENT = ['agent'];
const DAY = 86400;

/** An active business with an owner (merchant session) and an agent (agent session), each with a refresh token. */
async function business() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Refresh Ltd')`, [
    email('owner'),
    ARGON,
  ]);
  const t = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    t,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [t]);
  const {
    rows: [o],
  } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
    s.identity_id,
  ]);
  const {
    rows: [agentIdentity],
  } = await owner.query(
    `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
    [email('agent'), ARGON],
  );
  const {
    rows: [a],
  } = await owner.query(
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent') RETURNING id`,
    [s.merchant_id, agentIdentity.id],
  );
  const session = async (
    identityId: string,
    audience: string,
    membershipId: string,
    idle: number,
    absolute: number,
  ) => {
    const refresh = hash();
    const {
      rows: [r],
    } = await app.query(`SELECT * FROM identity.create_session($1, $2, $3, 'full', $4, $5, $6, NULL, NULL)`, [
      identityId,
      audience,
      membershipId,
      refresh,
      idle,
      absolute,
    ]);
    return { sessionId: r.session_id as string, refresh };
  };
  return {
    merchantId: s.merchant_id as string,
    agentMembershipId: a.id as string,
    web: await session(s.identity_id, 'merchant', o.id, DAY, 14 * DAY),
    agent: await session(agentIdentity.id, 'agent', a.id, 30 * DAY, 90 * DAY),
  };
}

const rotate = async (oldHash: string, audiences: string[] | null, newHash = hash()) =>
  (
    await app.query(`SELECT * FROM identity.rotate_refresh_token($1, $2, NULL, $3)`, [
      oldHash,
      newHash,
      audiences,
    ])
  ).rows[0];

const tokenState = async (tokenHash: string) =>
  (
    await owner.query(
      `SELECT rt.rotated_at, s.revoked_at FROM identity.refresh_tokens rt JOIN identity.sessions s ON s.id = rt.session_id
        WHERE rt.token_hash = $1`,
      [tokenHash],
    )
  ).rows[0];

describe('audience-checked rotation (T12)', () => {
  it('a web token at the agent endpoint: invalid, and nothing changes — at its own endpoint it rotates', async () => {
    const b = await business();
    expect(await rotate(b.web.refresh, AGENT)).toMatchObject({ outcome: 'invalid', session_id: null });
    expect(await tokenState(b.web.refresh)).toEqual({ rotated_at: null, revoked_at: null });
    expect(await rotate(b.web.refresh, WEB)).toMatchObject({ outcome: 'rotated', audience: 'merchant' });
  });

  it('an agent token at the web endpoint: invalid, and nothing changes — at the agent endpoint it rotates', async () => {
    const b = await business();
    expect((await rotate(b.agent.refresh, WEB)).outcome).toBe('invalid');
    expect(await tokenState(b.agent.refresh)).toEqual({ rotated_at: null, revoked_at: null });
    expect(await rotate(b.agent.refresh, AGENT)).toMatchObject({
      outcome: 'rotated',
      audience: 'agent',
      membership_id: b.agentMembershipId,
    });
  });

  it('a reused token at the wrong endpoint does not even revoke; at its own endpoint reuse revokes the session', async () => {
    const b = await business();
    const next = hash();
    await rotate(b.agent.refresh, AGENT, next);
    expect((await rotate(b.agent.refresh, WEB)).outcome).toBe('invalid');
    expect((await tokenState(next)).revoked_at).toBeNull();
    expect((await rotate(b.agent.refresh, AGENT)).outcome).toBe('reuse_detected');
    expect((await tokenState(next)).revoked_at).not.toBeNull();
  });

  it('agent sessions rotate with the agent idle timeout (30 days), capped by the absolute 90 days (D5)', async () => {
    const b = await business();
    const rotated = await rotate(b.agent.refresh, AGENT);
    const idleMs = rotated.refresh_expires_at.getTime() - Date.now();
    expect(idleMs).toBeGreaterThan(30 * DAY * 1000 - 60_000);
    expect(idleMs).toBeLessThanOrEqual(30 * DAY * 1000 + 60_000);

    await owner.query(
      `UPDATE identity.sessions SET absolute_expires_at = now() + interval '2 days' WHERE id = $1`,
      [b.agent.sessionId],
    );
    const capped = await rotate(
      (
        await owner.query(
          `SELECT token_hash FROM identity.refresh_tokens WHERE session_id = $1 AND rotated_at IS NULL`,
          [b.agent.sessionId],
        )
      ).rows[0].token_hash,
      AGENT,
    );
    expect(capped.refresh_expires_at.getTime() - Date.now()).toBeLessThanOrEqual(2 * DAY * 1000 + 60_000);
  });

  it('a deactivated agent cannot refresh (BR-10.6b)', async () => {
    const b = await business();
    await owner.query(
      `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [b.agentMembershipId],
    );
    expect((await rotate(b.agent.refresh, AGENT)).outcome).toBe('invalid');
  });

  it('the endpoint must say which audiences it serves', async () => {
    const b = await business();
    // P7: 'customer' is an audience now; an unknown one is still refused.
    for (const audiences of [null, [], ['shopper'], ['agent', 'admin']]) {
      await expectSqlState(rotate(b.agent.refresh, audiences), SQLSTATE.checkViolation);
    }
  });

  it('the three-argument function is gone; the new one is the app’s only', async () => {
    const { rows } = await owner.query(`
      SELECT to_regprocedure('identity.rotate_refresh_token(text, text, integer)') AS old,
             has_function_privilege('alphakolect_app', 'identity.rotate_refresh_token(text, text, integer, text[])', 'EXECUTE') AS app,
             has_function_privilege('alphakolect_readonly', 'identity.rotate_refresh_token(text, text, integer, text[])', 'EXECUTE') AS ro`);
    expect(rows[0]).toEqual({ old: null, app: true, ro: false });
  });
});
