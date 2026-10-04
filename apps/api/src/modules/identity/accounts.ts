import type { ResendVerificationRequest, SignupRequest } from '@alphakolect/contracts';
import { AppError } from '../../platform/errors.js';
import type { Mailer } from '../../platform/email.js';
import type { AuditLog } from '../audit/audit-log.js';
import { EMAIL_VERIFICATION_TTL_SECONDS, verificationEmail } from './emails.js';
import { checkPasswordPolicy, hashPassword } from './passwords.js';
import type { RateLimiter } from './rate-limits.js';
import type { IdentityRepository } from './repository.js';
import type { RequestContext } from './sessions.js';
import { hashReceivedToken, newOpaqueToken } from './tokens.js';

// Signup and email verification (TARGET_ARCHITECTURE §3.2, ADR-14 D1, D2, D10, D12, D13, D14).
// Anti-enumeration (D12): signup and resend answer identically whether or not the email has an account, and do
// the same expensive work (the password hash) either way; the email is sent outside the request (Mailer).

/** D14: a CAPTCHA (or similar) check before signup, added before launch (P15). Throws to refuse. */
export type SignupGuard = (ctx: RequestContext) => Promise<void>;

export const invalidOrExpiredToken = () =>
  new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This link is invalid or has expired');

export class AccountService {
  constructor(
    private readonly deps: {
      identity: IdentityRepository;
      audit: AuditLog;
      limiter: RateLimiter;
      mailer: Mailer;
      webAppUrl: string;
      signupGuard?: SignupGuard;
    },
  ) {}

  async signup(input: SignupRequest, ctx: RequestContext): Promise<void> {
    const { identity, audit, limiter } = this.deps;
    await this.deps.signupGuard?.(ctx);
    await limiter.enforce('signup', ctx.ip, input.email);

    // D10. Says nothing about the email, so it may come before the account check.
    const problem = checkPasswordPolicy(input.password);
    if (problem) {
      throw new AppError(422, 'WEAK_PASSWORD', 'Choose a longer or less common password', { problem });
    }

    const passwordHash = await hashPassword(input.password);
    const result = await identity.signupMerchantOwner(input.email, passwordHash, input.businessName);
    const request = { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };

    if (!result.created) {
      // The caller is told exactly what a new signup is told. The real owner can sign in or reset.
      await audit.record({
        action: 'auth.signup',
        outcome: 'failure',
        ...request,
        summary: { reason: 'email_taken' },
      });
      return;
    }

    await audit.record({
      action: 'auth.signup',
      outcome: 'success',
      merchantId: result.merchant_id,
      actorIdentityId: result.identity_id,
      actorAudience: 'merchant',
      targetType: 'merchant',
      targetId: result.merchant_id,
      ...request,
    });
    await this.sendVerification(result.identity_id!, input.email, ctx);
  }

  async verifyEmail(rawToken: string, ctx: RequestContext): Promise<void> {
    const { identity, audit, limiter } = this.deps;
    await limiter.enforce('email_verify', ctx.ip);
    const request = { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };

    const tokenHash = hashReceivedToken(rawToken);
    const identityId = tokenHash ? await identity.verifyEmail(tokenHash) : null;
    if (!identityId) {
      await audit.record({
        action: 'auth.email_verify',
        outcome: 'failure',
        ...request,
        summary: { reason: tokenHash ? 'invalid_or_expired' : 'malformed_token' },
      });
      throw invalidOrExpiredToken();
    }
    await audit.record({
      action: 'auth.email_verify',
      outcome: 'success',
      actorIdentityId: identityId,
      ...request,
    });
  }

  async resendVerification(input: ResendVerificationRequest, ctx: RequestContext): Promise<void> {
    const { identity, audit, limiter } = this.deps;
    await limiter.enforce('verification_resend', ctx.ip, input.email); // D12: 3 per hour per email

    const account = await identity.accountForEmail(input.email);
    const skip = !account
      ? 'unknown_account'
      : account.identity_status !== 'active'
        ? 'identity_disabled'
        : account.email_verified
          ? 'already_verified'
          : null;
    if (skip) {
      await audit.record({
        action: 'auth.verification_resend',
        outcome: 'failure',
        actorIdentityId: account?.identity_id ?? null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        summary: { reason: skip },
      });
      return;
    }
    await audit.record({
      action: 'auth.verification_resend',
      outcome: 'success',
      actorIdentityId: account!.identity_id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    await this.sendVerification(account!.identity_id, input.email, ctx);
  }

  /** A new token supersedes any earlier unused one (identity.issue_one_time_token); sent after it is stored. */
  private async sendVerification(identityId: string, email: string, ctx: RequestContext): Promise<void> {
    const token = newOpaqueToken();
    await this.deps.identity.issueOneTimeToken(
      identityId,
      'email_verification',
      token.hash,
      EMAIL_VERIFICATION_TTL_SECONDS,
      ctx.ip,
    );
    this.deps.mailer.dispatch(verificationEmail(email.trim().toLowerCase(), this.deps.webAppUrl, token.raw));
  }
}
