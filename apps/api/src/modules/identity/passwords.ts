import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import { COMMON_PASSWORDS } from './common-passwords.js';

// Password hashing and policy (TARGET_ARCHITECTURE §3.2; ADR-14 D10, D15).

/** argon2id parameters (D15: OWASP minimum, may be raised; stored hashes are upgraded on login). */
export const ARGON2_PARAMS = { memorySize: 19456, iterations: 2, parallelism: 1, hashLength: 32 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** NIST SP 800-63B: normalise Unicode so visually identical passwords hash identically. */
const normalise = (password: string) => password.normalize('NFKC');

/** argon2id PHC string, e.g. $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>. */
export function hashPassword(password: string): Promise<string> {
  return argon2id({
    password: normalise(password),
    salt: randomBytes(16),
    ...ARGON2_PARAMS,
    outputType: 'encoded',
  });
}

/** Constant-format verification; a malformed or missing hash is simply "no match", never an exception. */
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash || !hash.startsWith('$argon2id$')) return false;
  try {
    return await argon2Verify({ password: normalise(password), hash });
  } catch {
    return false;
  }
}

/** True when a stored hash was made with parameters other than the current ones (D15 rehash on login). */
export function needsRehash(hash: string): boolean {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hash);
  if (!match) return true;
  const [, m, t, p] = match.map(Number);
  return m !== ARGON2_PARAMS.memorySize || t !== ARGON2_PARAMS.iterations || p !== ARGON2_PARAMS.parallelism;
}

// A real hash of a random password, computed once. Verifying against it when an account does not exist makes
// "unknown email" cost the same time as "wrong password" (no timing-based account enumeration).
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  await verifyPassword(password, await dummyHash);
  return false;
}

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG' | 'TOO_COMMON';

/**
 * D10: 12–128 characters, no composition rules (NIST SP 800-63B), and no trivially guessable passwords:
 * the bundled common-password list or a single repeated character.
 */
export function checkPasswordPolicy(password: string): PasswordProblem | null {
  const length = [...normalise(password)].length; // characters, not UTF-16 units
  if (length < PASSWORD_MIN_LENGTH) return 'TOO_SHORT';
  if (length > PASSWORD_MAX_LENGTH) return 'TOO_LONG';
  const lowered = normalise(password).toLowerCase();
  if (COMMON_PASSWORDS.has(lowered) || /^(.)\1+$/u.test(lowered)) return 'TOO_COMMON';
  return null;
}
