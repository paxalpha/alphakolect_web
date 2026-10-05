import { importJWK, jwtVerify, SignJWT, type CryptoKey, type JWTHeaderParameters } from 'jose';
import type { Ed25519PrivateJwk } from '../../platform/config.js';

// Short-lived access tokens (TARGET_ARCHITECTURE §3.2, ADR-14 D6): EdDSA (Ed25519) JWTs with a key id.
// Claims are HINTS — every request re-validates the session in the database (identity.validate_session).

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ALGORITHM = 'EdDSA';

export type SessionAudience = 'platform' | 'merchant' | 'agent';

export type AccessClaims = {
  /** identity id */
  sub: string;
  /** session id */
  sid: string;
  aud: SessionAudience;
  /** membership id */
  mid: string;
};

type KeyPair = { kid: string; privateKey: CryptoKey; publicKey: CryptoKey };

async function importPair(jwk: Ed25519PrivateJwk): Promise<KeyPair> {
  const { d: _d, ...publicJwk } = jwk;
  return {
    kid: jwk.kid,
    privateKey: (await importJWK(jwk, ALGORITHM)) as CryptoKey,
    publicKey: (await importJWK(publicJwk, ALGORITHM)) as CryptoKey,
  };
}

export class AccessTokens {
  private constructor(
    private readonly issuer: string,
    private readonly current: KeyPair,
    private readonly verifyKeys: ReadonlyMap<string, CryptoKey>,
  ) {}

  static async create(options: {
    issuer: string;
    signingKey: Ed25519PrivateJwk;
    previousSigningKey?: Ed25519PrivateJwk | undefined;
  }): Promise<AccessTokens> {
    const current = await importPair(options.signingKey);
    const keys = new Map([[current.kid, current.publicKey]]);
    if (options.previousSigningKey) {
      const previous = await importPair(options.previousSigningKey);
      if (previous.kid === current.kid) throw new Error('previous signing key must have a different kid');
      keys.set(previous.kid, previous.publicKey);
    }
    return new AccessTokens(options.issuer, current, keys);
  }

  sign(claims: AccessClaims): Promise<string> {
    return new SignJWT({ sid: claims.sid, mid: claims.mid })
      .setProtectedHeader({ alg: ALGORITHM, kid: this.current.kid, typ: 'at+jwt' })
      .setSubject(claims.sub)
      .setAudience(claims.aud)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.current.privateKey);
  }

  /** The claims of a valid token, or null for anything else (bad signature, alg, kid, issuer, expiry, shape). */
  async verify(token: unknown): Promise<AccessClaims | null> {
    if (typeof token !== 'string' || token.length > 4096) return null;
    try {
      const { payload } = await jwtVerify(
        token,
        async (header: JWTHeaderParameters) => {
          const key = header.kid ? this.verifyKeys.get(header.kid) : undefined;
          if (!key) throw new Error('unknown kid');
          return key;
        },
        {
          algorithms: [ALGORITHM],
          issuer: this.issuer,
          typ: 'at+jwt',
          requiredClaims: ['sub', 'sid', 'mid', 'aud', 'exp', 'iat'],
        },
      );
      const aud = payload.aud;
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        typeof payload.mid !== 'string' ||
        (aud !== 'platform' && aud !== 'merchant' && aud !== 'agent')
      ) {
        return null;
      }
      return { sub: payload.sub, sid: payload.sid, mid: payload.mid, aud };
    } catch {
      return null;
    }
  }
}
