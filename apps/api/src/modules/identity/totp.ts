import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP per RFC 6238 / HOTP RFC 4226 (ADR-14 D8): HMAC-SHA-1, 6 digits, 30-second steps, ±1 step tolerance.
// Interoperable with standard authenticator apps. Replay protection of accepted steps lives in the database
// (identity.accept_totp_step), so verifyTotp returns the matched step rather than a boolean.

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW = 1;
const SECRET_BYTES = 20; // 160 bits, the RFC 4226 recommendation

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export const newTotpSecret = (): Buffer => randomBytes(SECRET_BYTES);

export const totpStep = (atMs: number = Date.now()): number => Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);

/** The code for a given time step. */
export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The time step a submitted code matches (current ±1), or null. Constant-time comparison per candidate. */
export function verifyTotp(secret: Buffer, code: unknown, atMs: number = Date.now()): number | null {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const submitted = Buffer.from(code);
  const now = totpStep(atMs);
  let matched: number | null = null;
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    // Check every candidate (no early exit) so timing does not reveal which step matched.
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), submitted) && matched === null) matched = step;
  }
  return matched;
}

/** otpauth:// URI for authenticator apps (rendered as a QR code by the client). */
export function otpauthUri(secret: Buffer, accountEmail: string, issuer = 'AlphaKolect'): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
