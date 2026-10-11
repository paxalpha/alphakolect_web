import { randomBytes } from 'node:crypto';
import { AUTH_COOKIES, MembershipChoices, MembershipSelected } from '@alphakolect/contracts';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { SELECTION_CHALLENGE_COOKIE } from '../../src/modules/identity/cookies.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { LIMITS } from '../../src/modules/identity/rate-limits.js';
import { hashOpaqueToken, newOpaqueToken } from '../../src/modules/identity/tokens.js';
import { createTestApp } from '../support/app.js';
import { databaseWindow, inOneWindow } from '../support/rate-limit-window.js';

// P4.2 login membership selection through the real app and database (ADR-15 T3, T4, T16; P4 exit criterion 4).

const { app, auth } = await createTestApp();
const repo = auth.identity;
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
const window = databaseWindow(owner);
beforeAll(() => owner.connect());
afterAll(() => owner.end());

const PASSWORD = 'a long enough passphrase';
const uniqueEmail = (tag: string) => `${tag}-${randomBytes(5).toString('hex')}@example.test`;
const clientIp = () => `10.${randomBytes(3).join('.')}`;

async function verifiedMerchant(name: string) {
  const email = uniqueEmail('owner');
  const signup = await repo.signupMerchantOwner(email, await hashPassword(PASSWORD), name);
  const t = newOpaqueToken();
  await repo.issueOneTimeToken(signup.identity_id!, 'email_verification', t.hash, 3600, null);
  await repo.verifyEmail(t.hash);
  return { email, identityId: signup.identity_id!, merchantId: signup.merchant_id! };
}

/** One person: owner of "Zeta …", staff at "Alpha …" — two eligible memberships. */
async function twoBusinesses() {
  const suffix = randomBytes(2).toString('hex');
  const zeta = await verifiedMerchant(`Zeta Stores ${suffix}`);
  const alpha = await verifiedMerchant(`Alpha Foods ${suffix}`);
  const {
    rows: [staff],
  } = await owner.query(
    `WITH r AS (INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, 'Staff ' || gen_random_uuid()) RETURNING id)
     INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id)
     SELECT $1, $2, 'staff', r.id FROM r RETURNING id`,
    [alpha.merchantId, zeta.identityId],
  );
  const {
    rows: [own],
  } = await owner.query(
    `SELECT id FROM tenancy.merchant_memberships WHERE merchant_id = $1 AND kind = 'owner'`,
    [zeta.merchantId],
  );
  return {
    email: zeta.email,
    identityId: zeta.identityId,
    zeta,
    alpha,
    ownerAtZeta: own.id as string,
    staffAtAlpha: staff.id as string,
    names: { zeta: `Zeta Stores ${suffix}`, alpha: `Alpha Foods ${suffix}` },
  };
}

/** Signs in and returns the selection challenge from the 409 answer. */
async function challengeFor(email: string): Promise<string> {
  const res = await request(app)
    .post('/v1/auth/login')
    .set('X-Forwarded-For', clientIp())
    .send({ email, password: PASSWORD, audience: 'merchant' });
  expect(res.status).toBe(409);
  const cookie = ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) =>
    c.startsWith(`${SELECTION_CHALLENGE_COOKIE}=`),
  );
  return cookie!.split(';')[0]!.split('=')[1]!;
}

const choices = (challenge: string | null, origin?: string) => {
  const req = request(app).get('/v1/auth/login/memberships').set('X-Forwarded-For', clientIp());
  if (challenge !== null) req.set('Cookie', `${SELECTION_CHALLENGE_COOKIE}=${challenge}`);
  if (origin) req.set('Origin', origin);
  return req;
};

const consumed = async (challenge: string) =>
  (
    await owner.query(
      `SELECT consumed_at IS NOT NULL AS c FROM identity.membership_selection_challenges WHERE token_hash = $1`,
      [hashOpaqueToken(challenge)],
    )
  ).rows[0].c as boolean;

const clearsChallenge = (res: request.Response) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? []).some((c) =>
    c.startsWith(`${SELECTION_CHALLENGE_COOKIE}=;`),
  );

describe('GET /v1/auth/login/memberships', () => {
  it('lists the choices by name to the challenge holder — no-store, no CORS, nothing secret — without using the challenge up', async () => {
    const b = await twoBusinesses();
    const challenge = await challengeFor(b.email);
    const res = await choices(challenge, 'https://evil.example');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(MembershipChoices.parse(res.body)).toEqual({
      memberships: [
        { selectionId: b.staffAtAlpha, merchantName: b.names.alpha, kind: 'staff' },
        { selectionId: b.ownerAtZeta, merchantName: b.names.zeta, kind: 'owner' },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain(challenge);

    expect((await choices(challenge)).status).toBe(200); // read again: still valid
    expect(await consumed(challenge)).toBe(false);
  });

  it.each([
    ['no challenge', () => null],
    ['a forged challenge', () => newOpaqueToken().raw],
    ['a malformed challenge', () => 'not-a-token'],
  ])('refuses %s with 401 and clears the cookie', async (_label, make) => {
    const res = await choices(make());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(clearsChallenge(res)).toBe(true);
  });

  it('refuses an expired challenge', async () => {
    const b = await twoBusinesses();
    const challenge = await challengeFor(b.email);
    await owner.query(
      `UPDATE identity.membership_selection_challenges SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [hashOpaqueToken(challenge)],
    );
    expect((await choices(challenge)).status).toBe(401);
  });

  it('reflects current state: when only one choice is left, it asks to sign in again', async () => {
    const b = await twoBusinesses();
    const challenge = await challengeFor(b.email);
    await owner.query(
      `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`,
      [b.alpha.merchantId],
    );
    const res = await choices(challenge);
    expect(res.status).toBe(401);
    expect(clearsChallenge(res)).toBe(true);
  });

  it('is rate-limited per challenge', async () => {
    await inOneWindow(window, LIMITS.membership_selection.windowSeconds, async () => {
      const b = await twoBusinesses();
      const challenge = await challengeFor(b.email);
      for (let i = 0; i < LIMITS.membership_selection.perIdentifier; i++) {
        expect((await choices(challenge)).status).toBe(200);
      }
      const res = await choices(challenge);
      expect(res.status).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
  });
});

const select = (challenge: string | null, selectionId: string) => {
  const req = request(app).post('/v1/auth/login/select').set('X-Forwarded-For', clientIp());
  if (challenge !== null) req.set('Cookie', `${SELECTION_CHALLENGE_COOKIE}=${challenge}`);
  return req.send({ selectionId });
};

const sessionsOf = async (identityId: string) =>
  (await owner.query(`SELECT count(*)::int AS n FROM identity.sessions WHERE identity_id = $1`, [identityId]))
    .rows[0].n as number;

const accessCookie = (res: request.Response) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? [])
    .find((c) => c.startsWith(`${AUTH_COOKIES.access}=`))
    ?.split(';')[0]
    ?.split('=')[1];

describe('POST /v1/auth/login/select', () => {
  it('signs in to exactly the chosen business, uses the challenge up and clears its cookie', async () => {
    const b = await twoBusinesses();
    const challenge = await challengeFor(b.email);
    expect(await sessionsOf(b.identityId)).toBe(0); // nothing before the selection

    const res = await select(challenge, b.staffAtAlpha);
    expect(res.status).toBe(200);
    expect(MembershipSelected.parse(res.body)).toEqual({
      status: 'authenticated',
      session: {
        identityId: b.identityId,
        audience: 'merchant',
        membershipId: b.staffAtAlpha,
        merchantId: b.alpha.merchantId,
        scope: 'full',
      },
    });
    expect(clearsChallenge(res)).toBe(true);
    expect(await consumed(challenge)).toBe(true);
    expect(await sessionsOf(b.identityId)).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain(challenge);

    const me = await request(app)
      .get('/v1/auth/session')
      .set('Cookie', `${AUTH_COOKIES.access}=${accessCookie(res)}`);
    expect(me.body).toMatchObject({ membershipId: b.staffAtAlpha, merchantId: b.alpha.merchantId });
  });

  it('a replay gets 401, even for the other choice', async () => {
    const b = await twoBusinesses();
    const challenge = await challengeFor(b.email);
    expect((await select(challenge, b.ownerAtZeta)).status).toBe(200);
    const replay = await select(challenge, b.staffAtAlpha);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(await sessionsOf(b.identityId)).toBe(1);
  });

  it('a choice that is no longer available (merchant deactivated after listing) gets 401, uses the challenge up, and creates nothing', async () => {
    const b = await twoBusinesses();
    const challenge = await challengeFor(b.email);
    expect((await choices(challenge)).status).toBe(200);
    await owner.query(
      `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`,
      [b.alpha.merchantId],
    );
    const res = await select(challenge, b.staffAtAlpha);
    expect(res.status).toBe(401);
    expect(clearsChallenge(res)).toBe(true);
    expect(await consumed(challenge)).toBe(true); // decision (b): used up whatever the outcome
    expect(await sessionsOf(b.identityId)).toBe(0);
    expect((await select(challenge, b.ownerAtZeta)).status).toBe(401); // sign in again
  });

  it('someone else’s membership id is never selectable', async () => {
    const b = await twoBusinesses();
    const stranger = await verifiedMerchant('Stranger Ltd');
    const { rows } = await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [
      stranger.identityId,
    ]);
    const res = await select(await challengeFor(b.email), rows[0].id);
    expect(res.status).toBe(401);
    expect(await sessionsOf(b.identityId)).toBe(0);
    expect(await sessionsOf(stranger.identityId)).toBe(0);
  });

  it('refuses without a challenge, and refuses a form-encoded or text body (JSON only)', async () => {
    const b = await twoBusinesses();
    expect((await select(null, b.ownerAtZeta)).status).toBe(401);
    const challenge = await challengeFor(b.email);
    for (const type of ['application/x-www-form-urlencoded', 'text/plain']) {
      const res = await request(app)
        .post('/v1/auth/login/select')
        .set('X-Forwarded-For', clientIp())
        .set('Cookie', `${SELECTION_CHALLENGE_COOKIE}=${challenge}`)
        .set('Content-Type', type)
        .send(`selectionId=${b.ownerAtZeta}`);
      expect(res.status).toBe(400);
    }
    expect(await sessionsOf(b.identityId)).toBe(0);
  });

  it('the web endpoint never completes an agent-audience selection (agents have their own endpoints, P4.7)', async () => {
    const field = await verifiedMerchant('Field A');
    const field2 = await verifiedMerchant('Field B');
    const agent = await verifiedMerchant('Agent Home');
    const agentIds: string[] = [];
    for (const m of [field, field2]) {
      const {
        rows: [row],
      } = await owner.query(
        `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent') RETURNING id`,
        [m.merchantId, agent.identityId],
      );
      agentIds.push(row.id);
    }
    const challenge = newOpaqueToken();
    expect(
      (await repo.resolveLoginMembership(agent.identityId, 'agent', challenge.hash)).eligible_count,
    ).toBe(2);
    const res = await select(challenge.raw, agentIds[0]!);
    expect(res.status).toBe(401);
    expect(await sessionsOf(agent.identityId)).toBe(0);
  });

  it('two concurrent selections with one challenge: exactly one session', async () => {
    const b = await twoBusinesses();
    const challenge = await challengeFor(b.email);
    const results = await Promise.all([select(challenge, b.ownerAtZeta), select(challenge, b.staffAtAlpha)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await sessionsOf(b.identityId)).toBe(1);
  });

  it('audits success and failure without the challenge or its hash', async () => {
    const b = await twoBusinesses();
    const challenge = await challengeFor(b.email);
    const ok = await select(challenge, b.ownerAtZeta);
    const replay = await select(challenge, b.ownerAtZeta);
    const { rows } = await owner.query(
      `SELECT action, outcome, merchant_id, actor_membership_id, summary, row_to_json(a)::text AS raw
         FROM audit.audit_events a WHERE request_id = ANY($1) ORDER BY occurred_at`,
      [[ok.headers['x-request-id'], replay.headers['x-request-id']]],
    );
    expect(rows.map((r) => [r.action, r.outcome])).toEqual([
      ['auth.login_select', 'success'],
      ['auth.login_select', 'failure'],
    ]);
    expect(rows[0]).toMatchObject({ merchant_id: b.zeta.merchantId, actor_membership_id: b.ownerAtZeta });
    for (const r of rows) {
      expect(r.raw).not.toContain(challenge);
      expect(r.raw).not.toContain(hashOpaqueToken(challenge));
    }
  });
});
