import { createHash, randomBytes } from 'node:crypto';
import { base32Encode } from './totp.js';

// MFA recovery codes (ADR-14 D8): 10 single-use codes shown once. Each carries 80 bits of randomness, so a
// SHA-256 hash is enough at rest (no slow hash needed). Users may type them with any case, spaces or dashes.

export const RECOVERY_CODE_COUNT = 10;

/** Formatted for humans: XXXX-XXXX-XXXX-XXXX (base32). */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(10)).slice(0, 16);
    return raw.match(/.{4}/g)!.join('-');
  });
}

/** Hash of a code as entered, or null if it cannot be one of ours. */
export function hashRecoveryCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const normalised = input.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z2-7]{16}$/.test(normalised)) return null;
  return createHash('sha256').update(`recovery:${normalised}`, 'utf8').digest('hex');
}
