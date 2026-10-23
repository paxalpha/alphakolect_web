import type { TotpEnrollment, VerifyMfaRequest } from '@alphakolect/contracts';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { AuthContext } from '../../platform/http/authenticate.js';
import type { AuditLog } from '../audit/index.js';
import type { RateLimiter } from './rate-limits.js';
import { hashRecoveryCode, newRecoveryCodes } from './recovery-codes.js';
import type { IdentityRepository } from './repository.js';
import type { SecretBox } from './secret-box.js';
import type { IssuedSession, RequestContext, SessionService } from './sessions.js';
import { hashReceivedToken } from './tokens.js';
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from './totp.js';

// Platform MFA (TARGET_ARCHITECTURE §3.2, ADR-14 D8; P3 exit criterion 7): forced TOTP enrolment from the
// enrolment-only session, and the second login step against the 5-minute, 5-attempt challenge. The TOTP secret
// is stored only encrypted (AES-256-GCM, bound to the identity); recovery codes only hashed.

const invalidCode = () => new AppError(401, 'INVALID_MFA_CODE', 'That code is not valid');
const challengeOver = () =>
  new AppError(401, 'INVALID_OR_EXPIRED_TOKEN', 'This sign-in has expired. Please sign in again.');
const alreadyEnrolled = () =>
  new AppError(409, 'MFA_ALREADY_ENROLLED', 'Two-factor authentication is already set up');

export class MfaService {
  constructor(
    private readonly deps: {
      db: Db;
      identity: IdentityRepository;
      sessions: SessionService;
      secretBox: SecretBox;
      audit: AuditLog;
      limiter: RateLimiter;
    },
  ) {}

  // Audit (P5.3a, plan §8.3, §8.4): each successful step commits together with its event (pattern B); failures are
  // best effort. The P3 shared helper is split accordingly.

  /** A new unconfirmed secret (replacing any earlier unconfirmed one). The response is its only appearance. */
  async beginEnrollment(auth: AuthContext, ctx: RequestContext): Promise<TotpEnrollment> {
    const secret = newTotpSecret();
    const sealed = this.deps.secretBox.seal(secret, auth.identityId);
    // #11: the new secret and its event commit together.
    const started = await this.deps.db.transaction(async (tx) => {
      const ok = await this.deps.identity
        .within(tx)
        .beginTotpEnrollment(auth.identityId, sealed.ciphertext, sealed.kid);
      if (ok) await this.deps.audit.mutateAudited(tx, this.event(auth, ctx, 'auth.mfa_enrollment_started'));
      return ok;
    });
    if (!started) throw alreadyEnrolled();
    return { otpauthUri: otpauthUri(secret, 'platform'), secret: base32Encode(secret) };
  }

  /**
   * Confirm with a valid code: TOTP becomes active, 10 recovery codes are issued (returned once), and the
   * enrolment-only session is replaced by a full platform session — all of it with its event, in one transaction.
   */
  async confirmEnrollment(
    auth: AuthContext,
    code: string,
    ctx: RequestContext,
  ): Promise<{ issued: IssuedSession; recoveryCodes: string[] }> {
    const { db, identity, limiter, sessions, audit } = this.deps;
    await limiter.enforce('mfa', ctx.ip, auth.identityId);

    const credential = await identity.mfaCredential(auth.identityId);
    if (!credential) throw new AppError(409, 'MFA_ALREADY_ENROLLED', 'Start enrolment first');
    if (credential.confirmed) throw alreadyEnrolled();
    const secret = this.deps.secretBox.open(
      credential.secret_ciphertext,
      credential.secret_key_id,
      auth.identityId,
    );
    const step = secret ? verifyTotp(secret, code) : null;
    if (step === null) {
      await audit.recordBestEffort({
        ...this.event(auth, ctx, 'auth.mfa_enrollment_confirmed'),
        outcome: 'failure',
        summary: { reason: 'invalid_code' },
      });
      throw invalidCode();
    }

    const recoveryCodes = newRecoveryCodes();
    // #12: the confirmation, the recovery codes, the session swap and the event commit together.
    const issued = await db.transaction(async (tx) => {
      const repo = identity.within(tx);
      const confirmed = await repo.confirmTotpEnrollment(
        auth.identityId,
        step,
        recoveryCodes.map((c) => hashRecoveryCode(c)!),
      );
      if (!confirmed) return null;
      await repo.revokeSession(auth.sessionId, 'mfa_enrolled');
      const started = await sessions.startSession(
        {
          identityId: auth.identityId,
          audience: 'platform',
          membershipId: auth.membershipId,
          scope: 'full',
          ctx,
        },
        repo,
      );
      await audit.mutateAudited(tx, this.event(auth, ctx, 'auth.mfa_enrollment_confirmed'));
      return started;
    });
    if (!issued) throw alreadyEnrolled();
    return { issued, recoveryCodes };
  }

  /** The second login step. Every attempt counts against the challenge (max 5) before the code is checked. */
  async verifyChallenge(
    rawChallenge: string | undefined,
    input: VerifyMfaRequest,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const { db, identity, limiter, sessions, audit } = this.deps;
    const challengeHash = hashReceivedToken(rawChallenge);
    // The attempt is counted in its own statement, so a failed code still uses one up.
    const challenge = challengeHash ? await identity.takeMfaChallengeAttempt(challengeHash) : null;
    const request = { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
    if (!challenge || !challengeHash) {
      await audit.recordBestEffort({
        action: 'auth.mfa_verify',
        outcome: 'failure',
        ...request,
        summary: { reason: 'challenge_invalid_or_expired' },
      });
      throw challengeOver();
    }
    await limiter.enforce('mfa', ctx.ip, challenge.identity_id);

    const method = 'code' in input ? 'totp' : 'recovery_code';
    const event = {
      action: 'auth.mfa_verify' as const,
      actorIdentityId: challenge.identity_id,
      actorAudience: 'platform',
      actorMembershipId: challenge.platform_membership_id,
      ...request,
    };
    // #13: the code's use (the TOTP step, or the recovery code), the challenge's consumption, the session and the
    // event commit together — so a failed event leaves a recovery code unused.
    const result = await db.transaction(async (tx) => {
      const repo = identity.within(tx);
      const ok =
        'code' in input
          ? await this.acceptTotp(repo, challenge.identity_id, input.code)
          : await this.acceptRecoveryCode(repo, challenge.identity_id, input.recoveryCode);
      if (!ok) return 'invalid_code' as const;
      if (!(await repo.consumeMfaChallenge(challengeHash))) return 'challenge_over' as const;
      const issued = await sessions.startSession(
        {
          identityId: challenge.identity_id,
          audience: 'platform',
          membershipId: challenge.platform_membership_id,
          scope: 'full',
          ctx,
        },
        repo,
      );
      await audit.mutateAudited(tx, { ...event, outcome: 'success', summary: { method } });
      return issued;
    });
    if (result === 'invalid_code') {
      await audit.recordBestEffort({
        ...event,
        outcome: 'failure',
        summary: { method, reason: 'invalid_code' },
      });
      throw invalidCode();
    }
    if (result === 'challenge_over') throw challengeOver();
    return result;
  }

  /** A valid code whose time step is newer than the last one used (replay protection, in the database). */
  private async acceptTotp(repo: IdentityRepository, identityId: string, code: string): Promise<boolean> {
    const credential = await repo.mfaCredential(identityId);
    if (!credential?.confirmed) return false;
    const secret = this.deps.secretBox.open(
      credential.secret_ciphertext,
      credential.secret_key_id,
      identityId,
    );
    const step = secret ? verifyTotp(secret, code) : null;
    return step !== null && (await repo.acceptTotpStep(identityId, step));
  }

  private async acceptRecoveryCode(
    repo: IdentityRepository,
    identityId: string,
    code: string,
  ): Promise<boolean> {
    const hash = hashRecoveryCode(code);
    return hash !== null && (await repo.consumeRecoveryCode(identityId, hash));
  }

  private event<A extends 'auth.mfa_enrollment_started' | 'auth.mfa_enrollment_confirmed'>(
    auth: AuthContext,
    ctx: RequestContext,
    action: A,
  ) {
    return {
      action,
      outcome: 'success' as const,
      actorIdentityId: auth.identityId,
      actorAudience: auth.audience,
      actorMembershipId: auth.membershipId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };
  }
}
