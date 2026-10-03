import { createHmac } from 'node:crypto';
import { importJWK, SignJWT, type CryptoKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { AccessTokens, type AccessClaims } from '../../src/modules/identity/access-tokens.js';
import type { Ed25519PrivateJwk } from '../../src/platform/config.js';
import { newSigningJwk } from '../support/keys.js';

// ADR-14 D6: EdDSA-only access tokens with kid, current + previous keys. Every forgery must verify to null.

const ISSUER = 'alphakolect-api';
const claims: AccessClaims = {
  sub: '01900000-0000-7000-8000-000000000001',
  sid: '01900000-0000-7000-8000-000000000002',
  aud: 'merchant',
  mid: '01900000-0000-7000-8000-000000000003',
};

let key1: Ed25519PrivateJwk;
let key2: Ed25519PrivateJwk;
let tokens: AccessTokens;

beforeAll(async () => {
  key1 = await newSigningJwk('k1');
  key2 = await newSigningJwk('k2');
  tokens = await AccessTokens.create({ issuer: ISSUER, signingKey: key1 });
});

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);
const payload = (overrides: Record<string, unknown> = {}) => ({
  sub: claims.sub,
  sid: claims.sid,
  mid: claims.mid,
  aud: claims.aud,
  iss: ISSUER,
  iat: nowSec(),
  exp: nowSec() + 900,
  ...overrides,
});

/** Sign arbitrary claims with a given key, bypassing AccessTokens (to craft edge cases). */
async function signRaw(
  jwk: Ed25519PrivateJwk,
  body: Record<string, unknown>,
  header: Record<string, unknown> = {},
) {
  const key = (await importJWK(jwk, 'EdDSA')) as CryptoKey;
  return new SignJWT(body)
    .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid, typ: 'at+jwt', ...header })
    .sign(key);
}

describe('signing and verifying', () => {
  it('round-trips the claims with a 15-minute expiry, kid and EdDSA header', async () => {
    const token = await tokens.sign(claims);
    expect(await tokens.verify(token)).toEqual(claims);
    // header and payload are JSON; the third part is the binary signature
    const [h, p] = token
      .split('.')
      .slice(0, 2)
      .map((part) => JSON.parse(Buffer.from(part, 'base64url').toString()));
    expect(h).toEqual({ alg: 'EdDSA', kid: 'k1', typ: 'at+jwt' });
    expect(p.exp - p.iat).toBe(900);
    expect(p.iss).toBe(ISSUER);
  });
});

describe('forgeries and misuse verify to null', () => {
  it('alg "none" (unsigned)', async () => {
    const token = `${b64({ alg: 'none', kid: 'k1', typ: 'at+jwt' })}.${b64(payload())}.`;
    expect(await tokens.verify(token)).toBeNull();
  });

  it('HS256 signed with the public key as an HMAC secret (algorithm confusion)', async () => {
    const head = `${b64({ alg: 'HS256', kid: 'k1', typ: 'at+jwt' })}.${b64(payload())}`;
    const sig = createHmac('sha256', Buffer.from(key1.x, 'base64url')).update(head).digest('base64url');
    expect(await tokens.verify(`${head}.${sig}`)).toBeNull();
  });

  it('a different key claiming the trusted kid', async () => {
    const impostor = { ...key2, kid: 'k1' };
    expect(await tokens.verify(await signRaw(impostor, payload()))).toBeNull();
  });

  it('an unknown kid', async () => {
    expect(await tokens.verify(await signRaw(key2, payload()))).toBeNull();
  });

  it('a tampered payload (audience switched after signing)', async () => {
    const [h, , s] = (await tokens.sign(claims)).split('.');
    expect(await tokens.verify(`${h}.${b64(payload({ aud: 'platform' }))}.${s}`)).toBeNull();
  });

  it.each([
    ['expired', { exp: nowSec() - 10, iat: nowSec() - 1000 }],
    ['a foreign issuer', { iss: 'someone-else' }],
    ['an unknown audience', { aud: 'customer' }],
    ['no session id', { sid: undefined }],
    ['no membership id', { mid: undefined }],
  ])('%s', async (_label, overrides) => {
    expect(await tokens.verify(await signRaw(key1, payload(overrides)))).toBeNull();
  });

  it('the wrong token type (e.g. an ID token)', async () => {
    expect(await tokens.verify(await signRaw(key1, payload(), { typ: 'JWT' }))).toBeNull();
  });

  it.each([[''], ['not.a.jwt'], [null], [12345], ['x'.repeat(5000)]])('garbage input %#', async (input) => {
    expect(await tokens.verify(input)).toBeNull();
  });
});

describe('key rotation (§22)', () => {
  it('tokens signed with the previous key still verify after rotation; new tokens use the new kid', async () => {
    const old = await tokens.sign(claims);
    const rotated = await AccessTokens.create({ issuer: ISSUER, signingKey: key2, previousSigningKey: key1 });
    expect(await rotated.verify(old)).toEqual(claims);
    const fresh = await rotated.sign(claims);
    expect(JSON.parse(Buffer.from(fresh.split('.')[0]!, 'base64url').toString()).kid).toBe('k2');
  });

  it('once the previous key is dropped, its tokens stop verifying', async () => {
    const old = await tokens.sign(claims);
    const dropped = await AccessTokens.create({ issuer: ISSUER, signingKey: key2 });
    expect(await dropped.verify(old)).toBeNull();
  });

  it('refuses a previous key with the same kid as the current one', async () => {
    await expect(
      AccessTokens.create({ issuer: ISSUER, signingKey: key1, previousSigningKey: { ...key2, kid: 'k1' } }),
    ).rejects.toThrow();
  });
});
