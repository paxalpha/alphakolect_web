import type { Queryable } from '../../platform/db.js';
import type { SessionAudience } from './access-tokens.js';

// Typed wrappers over the identity.* SECURITY DEFINER functions (ADR-14 D4) — the only way the API reaches
// identity data. Every token argument is a SHA-256 hex HASH (see tokens.ts); raw tokens never reach the DB.

export type LoginCandidate = {
  identity_id: string;
  identity_status: string;
  email_verified: boolean;
  password_hash: string | null;
  membership_id: string | null;
  membership_kind: string | null;
  membership_status: string | null;
  mfa_enrolled: boolean;
};

export type ValidSession = {
  identity_id: string;
  audience: SessionAudience;
  membership_id: string;
  merchant_id: string | null;
  scope: 'full' | 'mfa_enrollment';
};

export type RotationResult = {
  outcome: 'rotated' | 'invalid' | 'reuse_detected';
  session_id: string | null;
  identity_id: string | null;
  audience: SessionAudience | null;
  membership_id: string | null;
  scope: 'full' | 'mfa_enrollment' | null;
  refresh_expires_at: Date | null;
};

export type SessionLifetime = { idleSeconds: number; absoluteSeconds: number };

export class IdentityRepository {
  constructor(private readonly db: Queryable) {}

  // ── accounts ──────────────────────────────────────────────────────────────────────────────────
  async signupMerchantOwner(email: string, passwordHash: string, merchantName: string) {
    const [row] = await this.db.query<{
      created: boolean;
      identity_id: string | null;
      merchant_id: string | null;
    }>(`SELECT * FROM identity.signup_merchant_owner($1, $2, $3)`, [email, passwordHash, merchantName]);
    return row!;
  }

  async issueOneTimeToken(
    identityId: string,
    purpose: 'email_verification' | 'password_reset',
    tokenHash: string,
    ttlSeconds: number,
    ip: string | null,
  ): Promise<void> {
    await this.db.query(`SELECT identity.issue_one_time_token($1, $2, $3, $4, $5)`, [
      identityId,
      purpose,
      tokenHash,
      ttlSeconds,
      ip,
    ]);
  }

  async verifyEmail(tokenHash: string): Promise<string | null> {
    const [row] = await this.db.query<{ id: string | null }>(`SELECT identity.verify_email($1) AS id`, [
      tokenHash,
    ]);
    return row?.id ?? null;
  }

  async resetPassword(tokenHash: string, passwordHash: string): Promise<string | null> {
    const [row] = await this.db.query<{ id: string | null }>(`SELECT identity.reset_password($1, $2) AS id`, [
      tokenHash,
      passwordHash,
    ]);
    return row?.id ?? null;
  }

  async changePassword(identityId: string, passwordHash: string): Promise<void> {
    await this.db.query(`SELECT identity.change_password($1, $2)`, [identityId, passwordHash]);
  }

  async rehashPassword(identityId: string, expectedHash: string, newHash: string): Promise<boolean> {
    const [row] = await this.db.query<{ ok: boolean }>(`SELECT identity.rehash_password($1, $2, $3) AS ok`, [
      identityId,
      expectedHash,
      newHash,
    ]);
    return row?.ok ?? false;
  }

  async loginCandidate(email: string, audience: SessionAudience): Promise<LoginCandidate | null> {
    const [row] = await this.db.query<LoginCandidate>(`SELECT * FROM identity.login_candidate($1, $2)`, [
      email,
      audience,
    ]);
    return row ?? null;
  }

  async accountForEmail(email: string) {
    const [row] = await this.db.query<{
      identity_id: string;
      identity_status: string;
      email_verified: boolean;
    }>(`SELECT * FROM identity.account_for_email($1)`, [email]);
    return row ?? null;
  }

  async credentialsFor(identityId: string) {
    const [row] = await this.db.query<{ identity_status: string; password_hash: string | null }>(
      `SELECT * FROM identity.credentials_for($1)`,
      [identityId],
    );
    return row ?? null;
  }

  // ── sessions ──────────────────────────────────────────────────────────────────────────────────
  async createSession(args: {
    identityId: string;
    audience: SessionAudience;
    membershipId: string;
    scope: 'full' | 'mfa_enrollment';
    refreshHash: string;
    lifetime: SessionLifetime;
    ip: string | null;
    userAgent: string | null;
  }) {
    const [row] = await this.db.query<{
      session_id: string;
      refresh_expires_at: Date;
      absolute_expires_at: Date;
    }>(`SELECT * FROM identity.create_session($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      args.identityId,
      args.audience,
      args.membershipId,
      args.scope,
      args.refreshHash,
      args.lifetime.idleSeconds,
      args.lifetime.absoluteSeconds,
      args.ip,
      args.userAgent,
    ]);
    return row!;
  }

  /** `idleSeconds` null = the standard idle timeout of the session's audience and scope (D5). */
  async rotateRefreshToken(
    oldHash: string,
    newHash: string,
    idleSeconds: number | null = null,
  ): Promise<RotationResult> {
    const [row] = await this.db.query<RotationResult>(
      `SELECT * FROM identity.rotate_refresh_token($1, $2, $3)`,
      [oldHash, newHash, idleSeconds],
    );
    return row!;
  }

  async validateSession(sessionId: string): Promise<ValidSession | null> {
    const [row] = await this.db.query<ValidSession>(`SELECT * FROM identity.validate_session($1)`, [
      sessionId,
    ]);
    return row ?? null;
  }

  async revokeSession(sessionId: string, reason: string): Promise<boolean> {
    const [row] = await this.db.query<{ ok: boolean }>(`SELECT identity.revoke_session($1, $2) AS ok`, [
      sessionId,
      reason,
    ]);
    return row?.ok ?? false;
  }

  async revokeAllSessions(identityId: string, reason: string): Promise<number> {
    const [row] = await this.db.query<{ n: number }>(`SELECT identity.revoke_all_sessions($1, $2) AS n`, [
      identityId,
      reason,
    ]);
    return row?.n ?? 0;
  }

  // ── MFA ───────────────────────────────────────────────────────────────────────────────────────
  async mfaCredential(identityId: string) {
    const [row] = await this.db.query<{
      secret_ciphertext: Buffer;
      secret_key_id: string;
      confirmed: boolean;
      last_used_step: string | null;
    }>(`SELECT * FROM identity.mfa_credential($1)`, [identityId]);
    return row ?? null;
  }

  async beginTotpEnrollment(identityId: string, ciphertext: Buffer, keyId: string): Promise<boolean> {
    const [row] = await this.db.query<{ ok: boolean }>(
      `SELECT identity.begin_totp_enrollment($1, $2, $3) AS ok`,
      [identityId, ciphertext, keyId],
    );
    return row?.ok ?? false;
  }

  async confirmTotpEnrollment(
    identityId: string,
    step: number,
    recoveryCodeHashes: string[],
  ): Promise<boolean> {
    const [row] = await this.db.query<{ ok: boolean }>(
      `SELECT identity.confirm_totp_enrollment($1, $2, $3) AS ok`,
      [identityId, step, recoveryCodeHashes],
    );
    return row?.ok ?? false;
  }

  async acceptTotpStep(identityId: string, step: number): Promise<boolean> {
    const [row] = await this.db.query<{ ok: boolean }>(`SELECT identity.accept_totp_step($1, $2) AS ok`, [
      identityId,
      step,
    ]);
    return row?.ok ?? false;
  }

  async consumeRecoveryCode(identityId: string, codeHash: string): Promise<boolean> {
    const [row] = await this.db.query<{ ok: boolean }>(
      `SELECT identity.consume_recovery_code($1, $2) AS ok`,
      [identityId, codeHash],
    );
    return row?.ok ?? false;
  }

  async createMfaChallenge(
    identityId: string,
    platformMembershipId: string,
    tokenHash: string,
  ): Promise<void> {
    await this.db.query(`SELECT identity.create_mfa_challenge($1, $2, $3)`, [
      identityId,
      platformMembershipId,
      tokenHash,
    ]);
  }

  async takeMfaChallengeAttempt(tokenHash: string) {
    const [row] = await this.db.query<{ identity_id: string; platform_membership_id: string }>(
      `SELECT * FROM identity.take_mfa_challenge_attempt($1)`,
      [tokenHash],
    );
    return row ?? null;
  }

  async consumeMfaChallenge(tokenHash: string): Promise<boolean> {
    const [row] = await this.db.query<{ ok: boolean }>(`SELECT identity.consume_mfa_challenge($1) AS ok`, [
      tokenHash,
    ]);
    return row?.ok ?? false;
  }

  // ── rate limiting ─────────────────────────────────────────────────────────────────────────────
  async rateLimitHit(keyHash: string, windowSeconds: number, max: number) {
    const [row] = await this.db.query<{ allowed: boolean; retry_after_seconds: number }>(
      `SELECT * FROM util.rate_limit_hit($1, $2, $3)`,
      [keyHash, windowSeconds, max],
    );
    return row!;
  }
}
