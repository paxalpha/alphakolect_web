import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashRecoveryCode,
  newRecoveryCodes,
  RECOVERY_CODE_COUNT,
} from '../../src/modules/identity/recovery-codes.js';
import { SecretBox } from '../../src/modules/identity/secret-box.js';
import { base32Encode, otpauthUri, totpCode, totpStep, verifyTotp } from '../../src/modules/identity/totp.js';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B test vectors for SHA-1, truncated to our 6 digits.
  const rfcSecret = Buffer.from('12345678901234567890', 'ascii');
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('matches the RFC vector at T=%i', (seconds, code) => {
    expect(totpCode(rfcSecret, totpStep(seconds * 1000))).toBe(code);
  });

  it('accepts the current step and ±1, returning the matched step; rejects ±2', () => {
    const secret = randomBytes(20);
    const now = Date.now();
    const step = totpStep(now);
    for (const delta of [-1, 0, 1]) {
      expect(verifyTotp(secret, totpCode(secret, step + delta), now)).toBe(step + delta);
    }
    for (const delta of [-2, 2]) expect(verifyTotp(secret, totpCode(secret, step + delta), now)).toBeNull();
  });

  it.each([['12345'], ['1234567'], ['abcdef'], [123456], [null]])('rejects malformed codes (%s)', (code) => {
    expect(verifyTotp(randomBytes(20), code)).toBeNull();
  });

  it('builds an otpauth URI authenticator apps understand', () => {
    const secret = Buffer.from('12345678901234567890', 'ascii');
    expect(base32Encode(secret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    const uri = new URL(otpauthUri(secret, 'owner@example.test'));
    expect(uri.protocol).toBe('otpauth:');
    // otpauth://totp/<label>: the URL parser reads 'totp' as the host
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/AlphaKolect:owner@example.test');
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      issuer: 'AlphaKolect',
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
  });
});

describe('SecretBox (AES-256-GCM, D8)', () => {
  const k1 = { kid: 'm1', key: randomBytes(32) };
  const k2 = { kid: 'm2', key: randomBytes(32) };
  const identity = '01900000-0000-7000-8000-000000000001';

  it('round-trips and never stores the plaintext', () => {
    const box = new SecretBox(k1);
    const secret = randomBytes(20);
    const { ciphertext, kid } = box.seal(secret, identity);
    expect(kid).toBe('m1');
    expect(ciphertext.includes(secret)).toBe(false);
    expect(box.open(ciphertext, kid, identity)).toEqual(secret);
  });

  it('fails for another identity (bound as associated data), tampering, or an unknown key', () => {
    const box = new SecretBox(k1);
    const { ciphertext, kid } = box.seal(randomBytes(20), identity);
    expect(box.open(ciphertext, kid, '01900000-0000-7000-8000-000000000002')).toBeNull();
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1]! ^= 1;
    expect(box.open(tampered, kid, identity)).toBeNull();
    expect(box.open(ciphertext, 'unknown', identity)).toBeNull();
    expect(box.open(Buffer.from([1, 2, 3]), kid, identity)).toBeNull();
  });

  it('decrypts with the previous key after rotation and encrypts with the new one', () => {
    const { ciphertext, kid } = new SecretBox(k1).seal(Buffer.from('old'), identity);
    const rotated = new SecretBox(k2, k1);
    expect(rotated.open(ciphertext, kid, identity)?.toString()).toBe('old');
    expect(rotated.seal(Buffer.from('new'), identity).kid).toBe('m2');
  });

  it('rejects keys of the wrong size and duplicate kids', () => {
    expect(() => new SecretBox({ kid: 'x', key: randomBytes(16) })).toThrow();
    expect(() => new SecretBox(k1, { ...k2, kid: 'm1' })).toThrow();
  });
});

describe('recovery codes (D8)', () => {
  it('generates 10 distinct human-friendly codes', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
  });

  it('hashes regardless of case, spaces and dashes, and rejects non-codes', () => {
    const [code] = newRecoveryCodes();
    const hash = hashRecoveryCode(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(code!.toLowerCase().replace(/-/g, ' '))).toBe(hash);
    for (const bad of ['', 'ABCD-EFGH', '0000-0000-0000-0000', 42, null])
      expect(hashRecoveryCode(bad)).toBeNull();
  });
});
