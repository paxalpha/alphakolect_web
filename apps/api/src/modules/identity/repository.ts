import type { Queryable } from '../../platform/db.js';
import type { SessionAudience } from './access-tokens.js';

// Typed wrappers over the identity.* SECURITY DEFINER functions (ADR-14 D4) — the only way the API reaches
// identity data. Every token argument is a SHA-256 hex HASH (see tokens.ts); raw tokens never reach the DB.

/** Credentials for the password check — no membership (P4.2). */
export type LoginIdentity = {
  identity_id: string;
  identity_status: string;
  email_verified: boolean;
  password_hash: string | null;
  mfa_enrolled: boolean;
};

/** A membership the caller may choose at login: no merchant id, nothing but what the chooser needs. */
export type SelectionChoice = { membership_id: string; merchant_name: string | null; kind: string };

export type ValidSession = {
  identity_id: string;
  audience: SessionAudience;
  membership_id: string;
  merchant_id: string | null;
  scope: 'full' | 'mfa_enrollment';
  /** Merchant membership kind (owner | staff | agent) or platform role — current, re-read per call (T5). */
  kind: string;
  /** A staff member's role and branch restriction (null = all branches); null for everyone else. */
  role_id: string | null;
  branch_id: string | null;
};

/** The per-request resolver's row (P5.2, identity.session_authority): the validated session plus its authority. */
export type SessionAuthority = ValidSession & {
  /** The staff member's role and branch state (active | archived); null when there is none. */
  role_status: string | null;
  branch_status: string | null;
  /** Effective permissions, resolved by the database now (never cached, never from claims). Sorted. */
  permissions: string[];
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
    purpose: 'email_verification' | 'password_reset' | 'account_setup',
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

  /** First password through the setup link; also verifies the email (it was sent there). */
  async completeAccountSetup(tokenHash: string, passwordHash: string): Promise<string | null> {
    const [row] = await this.db.query<{ id: string | null }>(
      `SELECT identity.complete_account_setup($1, $2) AS id`,
      [tokenHash, passwordHash],
    );
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

  async loginIdentity(email: string): Promise<LoginIdentity | null> {
    const [row] = await this.db.query<LoginIdentity>(`SELECT * FROM identity.login_identity($1)`, [email]);
    return row ?? null;
  }

  /**
   * After a successful password check only. One eligible membership ⇒ it is returned; several ⇒ a selection
   * challenge is stored under `challengeHash` and no membership is returned (ADR-15 T4).
   */
  async resolveLoginMembership(identityId: string, audience: SessionAudience, challengeHash: string) {
    const [row] = await this.db.query<{ eligible_count: number; membership_id: string | null }>(
      `SELECT * FROM identity.resolve_login_membership($1, $2, $3)`,
      [identityId, audience, challengeHash],
    );
    return row!;
  }

  /** The choices for a valid selection challenge; does not consume it. */
  async selectionChoices(challengeHash: string): Promise<SelectionChoice[]> {
    return this.db.query<SelectionChoice>(`SELECT * FROM identity.selection_choices($1)`, [challengeHash]);
  }

  /** Consumes the challenge (whatever the outcome) and returns the chosen membership if still eligible. */
  async takeSelection(challengeHash: string, membershipId: string) {
    const [row] = await this.db.query<{
      identity_id: string;
      audience: SessionAudience;
      membership_id: string;
    }>(`SELECT * FROM identity.take_selection($1, $2)`, [challengeHash, membershipId]);
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

  /**
   * `audiences`: the session audiences the calling endpoint serves — a token of any other audience is 'invalid',
   * with no side effect (ADR-15 T12). `idleSeconds` null = the standard idle timeout of the session's audience
   * and scope (D5).
   */
  async rotateRefreshToken(
    oldHash: string,
    newHash: string,
    audiences: readonly SessionAudience[],
    idleSeconds: number | null = null,
  ): Promise<RotationResult> {
    const [row] = await this.db.query<RotationResult>(
      `SELECT * FROM identity.rotate_refresh_token($1, $2, $3, $4)`,
      [oldHash, newHash, idleSeconds, audiences],
    );
    return row!;
  }

  async validateSession(sessionId: string): Promise<ValidSession | null> {
    const [row] = await this.db.query<ValidSession>(`SELECT * FROM identity.validate_session($1)`, [
      sessionId,
    ]);
    return row ?? null;
  }

  /** P5.2 (ADR-16): the session re-validated and its effective permissions, in one round trip; null = invalid. */
  async sessionAuthority(sessionId: string): Promise<SessionAuthority | null> {
    const [row] = await this.db.query<SessionAuthority>(`SELECT * FROM identity.session_authority($1)`, [
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
