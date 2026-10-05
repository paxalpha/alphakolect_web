import { describe, expect, it } from 'vitest';
import {
  ARGON2_PARAMS,
  burnPasswordCheck,
  checkPasswordPolicy,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../src/modules/identity/passwords.js';
import { hashOpaqueToken, hashReceivedToken, newOpaqueToken } from '../../src/modules/identity/tokens.js';

describe('password hashing (D15)', () => {
  it('produces argon2id with the agreed parameters and a random salt', async () => {
    const a = await hashPassword('a perfectly fine passphrase');
    const b = await hashPassword('a perfectly fine passphrase');
    expect(a).toMatch(
      new RegExp(
        `^\\$argon2id\\$v=19\\$m=${ARGON2_PARAMS.memorySize},t=${ARGON2_PARAMS.iterations},p=${ARGON2_PARAMS.parallelism}\\$`,
      ),
    );
    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('a perfectly fine passphrase');
    expect(await verifyPassword('a perfectly fine passphrase', hash)).toBe(true);
    expect(await verifyPassword('a perfectly fine passphrasE', hash)).toBe(false);
  });

  it('treats missing, non-argon2id and malformed hashes as "no match" without throwing', async () => {
    for (const hash of [null, undefined, '', '$2a$10$legacybcrypthashvalue', '$argon2id$garbage']) {
      expect(await verifyPassword('anything at all', hash)).toBe(false);
    }
  });

  it('normalises Unicode (NFKC) so equivalent passwords match', async () => {
    const composed = 'café passphrase ok';
    const decomposed = 'café passphrase ok';
    expect(await verifyPassword(decomposed, await hashPassword(composed))).toBe(true);
  });

  it('flags hashes made with other parameters for rehash', async () => {
    expect(needsRehash(await hashPassword('another fine passphrase'))).toBe(false);
    expect(needsRehash('$argon2id$v=19$m=4096,t=3,p=1$c2FsdA$aGFzaA')).toBe(true);
    expect(needsRehash('$2a$10$legacy')).toBe(true);
  });

  it('burns comparable time for unknown accounts and always fails', async () => {
    expect(await burnPasswordCheck('whatever is typed')).toBe(false);
  });
});

describe('password policy (D10)', () => {
  it.each([
    ['11 characters', 'abcdefghijk', 'TOO_SHORT'],
    ['129 characters', 'x'.repeat(64) + 'y'.repeat(65), 'TOO_LONG'],
    ['a common long password', 'Password1234', 'TOO_COMMON'],
    ['a single repeated character', 'zzzzzzzzzzzzzzzz', 'TOO_COMMON'],
  ])('rejects %s', (_label, password, problem) => {
    expect(checkPasswordPolicy(password)).toBe(problem);
  });

  it.each([
    ['a 12-character passphrase without composition rules', 'blue horse s'],
    ['lowercase words only', 'correct horse battery stable'],
    ['128 characters', 'ab'.repeat(64)],
  ])('accepts %s', (_label, password) => {
    expect(checkPasswordPolicy(password)).toBeNull();
  });

  it('counts characters, not UTF-16 code units', () => {
    expect(checkPasswordPolicy('😀'.repeat(11) + 'x')).toBeNull(); // 12 characters, 23 code units
  });
});

describe('opaque tokens', () => {
  it('are 256-bit base64url values whose SHA-256 hex hash is what gets stored', () => {
    const t = newOpaqueToken();
    expect(t.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOpaqueToken(t.raw)).toBe(t.hash);
    expect(newOpaqueToken().raw).not.toBe(t.raw);
  });

  it('refuses to hash input that is not shaped like a token', () => {
    const t = newOpaqueToken();
    expect(hashReceivedToken(t.raw)).toBe(t.hash);
    for (const bad of ['', 'short', `${t.raw}x`, `${t.raw.slice(0, 42)}!`, 42, null, undefined]) {
      expect(hashReceivedToken(bad)).toBeNull();
    }
  });
});
