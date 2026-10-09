import { randomBytes } from 'node:crypto';
import { MembershipChoices } from '@alphakolect/contracts';
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
    `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'staff') RETURNING id`,
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
