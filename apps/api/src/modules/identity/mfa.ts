import type { TotpEnrollment, VerifyMfaRequest } from '@alphakolect/contracts';
import { AppError } from '../../platform/errors.js';
import type { AuthContext } from '../../platform/http/authenticate.js';
import type { AuditLog } from '../audit/audit-log.js';
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
      identity: IdentityRepository;
      sessions: SessionService;
      secretBox: SecretBox;
      audit: AuditLog;
      limiter: RateLimiter;
    },
  ) {}

  /** A new unconfirmed secret (replacing any earlier unconfirmed one). The response is its only appearance. */
  async beginEnrollment(auth: AuthContext, ctx: RequestContext): Promise<TotpEnrollment> {
    const secret = newTotpSecret();
    const sealed = this.deps.secretBox.seal(secret, auth.identityId);
    if (!(await this.deps.identity.beginTotpEnrollment(auth.identityId, sealed.ciphertext, sealed.kid))) {
      throw alreadyEnrolled();
    }
    await this.audit(auth, ctx, 'auth.mfa_enrollment_started', 'success');
    return { otpauthUri: otpauthUri(secret, 'platform'), secret: base32Encode(secret) };
  }

  /**
   * Confirm with a valid code: TOTP becomes active, 10 recovery codes are issued (returned once), and the
   * enrolment-only session is replaced by a full platform session.
   */
  async confirmEnrollment(
    auth: AuthContext,
    code: string,
    ctx: RequestContext,
  ): Promise<{ issued: IssuedSession; recoveryCodes: string[] }> {
    const { identity, limiter, sessions } = this.deps;
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
      await this.audit(auth, ctx, 'auth.mfa_enrollment_confirmed', 'failure', { reason: 'invalid_code' });
      throw invalidCode();
    }

    const recoveryCodes = newRecoveryCodes();
    const confirmed = await identity.confirmTotpEnrollment(
      auth.identityId,
      step,
      recoveryCodes.map((c) => hashRecoveryCode(c)!),
    );
    if (!confirmed) throw alreadyEnrolled();

    await identity.revokeSession(auth.sessionId, 'mfa_enrolled');
    const issued = await sessions.startSession({
      identityId: auth.identityId,
      audience: 'platform',
      membershipId: auth.membershipId,
      scope: 'full',
      ctx,
    });
    await this.audit(auth, ctx, 'auth.mfa_enrollment_confirmed', 'success');
    return { issued, recoveryCodes };
  }

  /** The second login step. Every attempt counts against the challenge (max 5) before the code is checked. */
  async verifyChallenge(
    rawChallenge: string | undefined,
    input: VerifyMfaRequest,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const { identity, limiter, sessions } = this.deps;
    const challengeHash = hashReceivedToken(rawChallenge);
    const challenge = challengeHash ? await identity.takeMfaChallengeAttempt(challengeHash) : null;
    const request = { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
    if (!challenge || !challengeHash) {
      await this.deps.audit.record({
        action: 'auth.mfa_verify',
        outcome: 'failure',
        ...request,
        summary: { reason: 'challenge_invalid_or_expired' },
      });
      throw challengeOver();
    }
    await limiter.enforce('mfa', ctx.ip, challenge.identity_id);

    const method = 'code' in input ? 'totp' : 'recovery_code';
    const ok =
      'code' in input
        ? await this.acceptTotp(challenge.identity_id, input.code)
        : await this.acceptRecoveryCode(challenge.identity_id, input.recoveryCode);
    const event = {
      action: 'auth.mfa_verify',
      actorIdentityId: challenge.identity_id,
      actorAudience: 'platform',
      actorMembershipId: challenge.platform_membership_id,
      ...request,
    };
    if (!ok) {
      await this.deps.audit.record({
        ...event,
        outcome: 'failure',
        summary: { method, reason: 'invalid_code' },
      });
      throw invalidCode();
    }
    if (!(await identity.consumeMfaChallenge(challengeHash))) throw challengeOver();

    const issued = await sessions.startSession({
      identityId: challenge.identity_id,
      audience: 'platform',
      membershipId: challenge.platform_membership_id,
      scope: 'full',
      ctx,
    });
    await this.deps.audit.record({ ...event, outcome: 'success', summary: { method } });
    return issued;
  }

  /** A valid code whose time step is newer than the last one used (replay protection, in the database). */
  private async acceptTotp(identityId: string, code: string): Promise<boolean> {
    const credential = await this.deps.identity.mfaCredential(identityId);
    if (!credential?.confirmed) return false;
    const secret = this.deps.secretBox.open(
      credential.secret_ciphertext,
      credential.secret_key_id,
      identityId,
    );
    const step = secret ? verifyTotp(secret, code) : null;
    return step !== null && (await this.deps.identity.acceptTotpStep(identityId, step));
  }

  private async acceptRecoveryCode(identityId: string, code: string): Promise<boolean> {
    const hash = hashRecoveryCode(code);
    return hash !== null && (await this.deps.identity.consumeRecoveryCode(identityId, hash));
  }

  private async audit(
    auth: AuthContext,
    ctx: RequestContext,
    action: string,
    outcome: 'success' | 'failure',
    summary?: Record<string, string>,
  ) {
    await this.deps.audit.record({
      action,
      outcome,
      actorIdentityId: auth.identityId,
      actorAudience: auth.audience,
      actorMembershipId: auth.membershipId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      ...(summary ? { summary } : {}),
    });
  }
}
