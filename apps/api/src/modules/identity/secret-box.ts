import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Encryption of MFA secrets at rest (ADR-14 D8): AES-256-GCM under a configured key with a key id, so keys
// can be rotated (§22): the current key encrypts; current and previous keys decrypt.
// The identity id is bound as additional authenticated data, so a ciphertext copied onto another identity's
// row fails to decrypt.

export type EncryptionKey = { kid: string; key: Buffer };

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBox {
  private readonly keys: ReadonlyMap<string, Buffer>;

  constructor(
    private readonly current: EncryptionKey,
    previous?: EncryptionKey,
  ) {
    if (current.key.length !== 32) throw new Error('encryption key must be 32 bytes');
    const keys = new Map([[current.kid, current.key]]);
    if (previous) {
      if (previous.key.length !== 32) throw new Error('previous encryption key must be 32 bytes');
      if (previous.kid === current.kid) throw new Error('previous encryption key must have a different kid');
      keys.set(previous.kid, previous.key);
    }
    this.keys = keys;
  }

  /** Layout: version(1) | iv(12) | tag(16) | ciphertext. The key id is stored alongside (secret_key_id). */
  seal(plaintext: Buffer, boundTo: string): { ciphertext: Buffer; kid: string } {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.current.key, iv);
    cipher.setAAD(Buffer.from(boundTo, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      ciphertext: Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]),
      kid: this.current.kid,
    };
  }

  /** The plaintext, or null if the key id is unknown or the data was tampered with / bound elsewhere. */
  open(sealed: Buffer, kid: string, boundTo: string): Buffer | null {
    const key = this.keys.get(kid);
    if (!key || sealed.length < 1 + IV_BYTES + TAG_BYTES || sealed[0] !== VERSION) return null;
    try {
      const iv = sealed.subarray(1, 1 + IV_BYTES);
      const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(boundTo, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(sealed.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
    } catch {
      return null;
    }
  }
}
