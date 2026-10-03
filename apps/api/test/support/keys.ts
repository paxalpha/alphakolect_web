import { exportJWK, generateKeyPair } from 'jose';
import type { Ed25519PrivateJwk } from '../../src/platform/config.js';

/** A throwaway Ed25519 private JWK for tests. */
export async function newSigningJwk(kid: string): Promise<Ed25519PrivateJwk> {
  const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const jwk = await exportJWK(privateKey);
  return { kty: 'OKP', crv: 'Ed25519', d: jwk.d!, x: jwk.x!, kid };
}
