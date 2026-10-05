import { createHash, randomBytes } from 'node:crypto';

// Opaque bearer secrets: refresh tokens, email-verification and password-reset tokens, MFA challenges
// (TARGET_ARCHITECTURE §3.2). 256 bits of randomness, sent to the client once; the database only ever
// receives the SHA-256 hex hash (its CHECK constraints reject anything else).

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // base64url of 32 bytes, no padding

export type OpaqueToken = { raw: string; hash: string };

export const hashOpaqueToken = (raw: string): string =>
  createHash('sha256').update(raw, 'utf8').digest('hex');

export function newOpaqueToken(): OpaqueToken {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  return { raw, hash: hashOpaqueToken(raw) };
}

/** Hash a token received from a client, or null if it is not even shaped like one of ours. */
export function hashReceivedToken(raw: unknown): string | null {
  return typeof raw === 'string' && TOKEN_PATTERN.test(raw) ? hashOpaqueToken(raw) : null;
}
