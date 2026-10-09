import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { IdentityRepository } from '../../src/modules/identity/repository.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { newOpaqueToken } from '../../src/modules/identity/tokens.js';
import { createDb } from '../../src/platform/db.js';

// The repository against a real, fully migrated database, connected as the least-privilege app role.

const db = createDb(inject('apiDatabaseUrl'));
const repo = new IdentityRepository(db);
afterAll(() => db.close());

const email = () => `repo-${randomBytes(5).toString('hex')}@example.test`;
const MERCHANT = { idleSeconds: 86400, absoluteSeconds: 1209600 };

describe('IdentityRepository (as alphakolect_app)', () => {
  it('runs signup → verification → login candidate', async () => {
    const address = email();
    const signup = await repo.signupMerchantOwner(
      address,
      await hashPassword('a long enough passphrase'),
      'Repo Biz',
    );
    expect(signup.created).toBe(true);

    const token = newOpaqueToken();
    await repo.issueOneTimeToken(signup.identity_id!, 'email_verification', token.hash, 3600, '127.0.0.1');
    expect(await repo.verifyEmail(token.hash)).toBe(signup.identity_id);

    const candidate = await repo.loginCandidate(address.toUpperCase(), 'merchant');
    expect(candidate).toMatchObject({
      identity_id: signup.identity_id,
      email_verified: true,
      membership_kind: 'owner',
      mfa_enrolled: false,
    });
    expect(candidate?.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('creates, validates, rotates and detects reuse of a session', async () => {
    const address = email();
    const signup = await repo.signupMerchantOwner(
      address,
      await hashPassword('a long enough passphrase'),
      'Repo Biz',
    );
    // Verified first: only an active merchant's members get sessions (P4.1).
    const verification = newOpaqueToken();
    await repo.issueOneTimeToken(signup.identity_id!, 'email_verification', verification.hash, 3600, null);
    await repo.verifyEmail(verification.hash);
    const candidate = await repo.loginCandidate(address, 'merchant');
    const first = newOpaqueToken();

    const session = await repo.createSession({
      identityId: signup.identity_id!,
      audience: 'merchant',
      membershipId: candidate!.membership_id!,
      scope: 'full',
      refreshHash: first.hash,
      lifetime: MERCHANT,
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(await repo.validateSession(session.session_id)).toMatchObject({
      identity_id: signup.identity_id,
      audience: 'merchant',
      merchant_id: signup.merchant_id,
      scope: 'full',
    });

    const second = newOpaqueToken();
    expect((await repo.rotateRefreshToken(first.hash, second.hash, MERCHANT.idleSeconds)).outcome).toBe(
      'rotated',
    );
    expect(
      (await repo.rotateRefreshToken(first.hash, newOpaqueToken().hash, MERCHANT.idleSeconds)).outcome,
    ).toBe('reuse_detected');
    expect(await repo.validateSession(session.session_id)).toBeNull();
  });

  it('returns nothing for unknown accounts', async () => {
    expect(await repo.loginCandidate('nobody@example.test', 'merchant')).toBeNull();
    expect(await repo.accountForEmail('nobody@example.test')).toBeNull();
  });

  it('returns bigint TOTP steps as strings (no precision loss)', async () => {
    // Exercised fully with MFA endpoints; here only the type parser.
    const [row] = await db.query<{ v: string }>(`SELECT 9007199254740993::bigint AS v`);
    expect(row?.v).toBe('9007199254740993');
  });

  it('cannot read identity tables directly even through the API connection', async () => {
    await expect(db.query(`SELECT email FROM identity.identities LIMIT 1`)).rejects.toMatchObject({
      code: '42501',
    });
  });
});
