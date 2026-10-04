import type {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  SetPasswordRequest,
} from '@alphakolect/contracts';
import { AppError } from '../../platform/errors.js';
import type { Mailer } from '../../platform/email.js';
import type { AuthContext } from '../../platform/http/authenticate.js';
import type { AuditLog } from '../audit/audit-log.js';
import { invalidOrExpiredToken } from './accounts.js';
import {
  ACCOUNT_SETUP_TTL_SECONDS,
  accountSetupEmail,
  PASSWORD_RESET_TTL_SECONDS,
  passwordResetEmail,
} from './emails.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './passwords.js';
import type { RateLimiter } from './rate-limits.js';
import type { IdentityRepository } from './repository.js';
import type { RequestContext } from './sessions.js';
import { hashReceivedToken, newOpaqueToken } from './tokens.js';

// Forgot / reset / first-password setup / change (TARGET_ARCHITECTURE §3.2; ADR-14 D5, D9, D10, D12, and the
// 2026-10-04 clarifications). Reset and change revoke every session of the identity (in the database). A reset
// never verifies an email; only the setup link (or the verification link) does.

const weakPassword = (problem: string) =>
  new AppError(422, 'WEAK_PASSWORD', 'Choose a longer or less common password', { problem });

function assertPolicy(password: string) {
  const problem = checkPasswordPolicy(password);
  if (problem) throw weakPassword(problem);
}

export class PasswordService {
  constructor(
    private readonly deps: {
      identity: IdentityRepository;
      audit: AuditLog;
      limiter: RateLimiter;
      mailer: Mailer;
      webAppUrl: string;
    },
  ) {}

  /**
   * D12 / exit criterion 4: the same answer for every email. An active account gets a 30-minute reset link — or,
   * if it has never had a password (a bootstrapped super admin), a fresh setup link instead.
   */
  async forgot(input: ForgotPasswordRequest, ctx: RequestContext): Promise<void> {
    const { identity, audit, limiter, mailer, webAppUrl } = this.deps;
    await limiter.enforce('password_forgot', ctx.ip, input.email);
    const request = { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
    const to = input.email.trim().toLowerCase();

    const account = await identity.accountForEmail(input.email);
    if (!account || account.identity_status !== 'active') {
      await audit.record({
        action: 'auth.password_forgot',
        outcome: 'failure',
        actorIdentityId: account?.identity_id ?? null,
        ...request,
        summary: { reason: account ? 'identity_disabled' : 'unknown_account' },
      });
      return;
    }

    const token = newOpaqueToken();
    const hasPassword = Boolean((await identity.credentialsFor(account.identity_id))?.password_hash);
    if (hasPassword) {
      await identity.issueOneTimeToken(
        account.identity_id,
        'password_reset',
        token.hash,
        PASSWORD_RESET_TTL_SECONDS,
        ctx.ip,
      );
    } else {
      await identity.issueOneTimeToken(
        account.identity_id,
        'account_setup',
        token.hash,
        ACCOUNT_SETUP_TTL_SECONDS,
        ctx.ip,
      );
    }
    await audit.record({
      action: 'auth.password_forgot',
      outcome: 'success',
      actorIdentityId: account.identity_id,
      ...request,
      summary: { link: hasPassword ? 'password_reset' : 'account_setup' },
    });
    mailer.dispatch(
      hasPassword
        ? passwordResetEmail(to, webAppUrl, token.raw)
        : accountSetupEmail(to, webAppUrl, token.raw),
    );
  }

  /** Exit criterion 4: single use, 30 minutes, superseded by a newer request; every session ends. */
  async reset(input: SetPasswordRequest, ctx: RequestContext): Promise<void> {
    await this.useLink(input, ctx, 'auth.password_reset', (tokenHash, passwordHash) =>
      this.deps.identity.resetPassword(tokenHash, passwordHash),
    );
  }

  /** First password through the setup link; also verifies the email (D9, option A). */
  async completeSetup(input: SetPasswordRequest, ctx: RequestContext): Promise<void> {
    await this.useLink(input, ctx, 'auth.account_setup', (tokenHash, passwordHash) =>
      this.deps.identity.completeAccountSetup(tokenHash, passwordHash),
    );
  }

  async change(auth: AuthContext, input: ChangePasswordRequest, ctx: RequestContext): Promise<void> {
    const { identity, audit, limiter } = this.deps;
    await limiter.enforce('password_change', ctx.ip, auth.identityId);
    const event = {
      action: 'auth.password_change',
      merchantId: auth.merchantId,
      actorIdentityId: auth.identityId,
      actorAudience: auth.audience,
      actorMembershipId: auth.membershipId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };

    const credentials = await identity.credentialsFor(auth.identityId);
    if (!(await verifyPassword(input.currentPassword, credentials?.password_hash))) {
      await audit.record({ ...event, outcome: 'failure', summary: { reason: 'wrong_current_password' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'The current password is incorrect');
    }
    assertPolicy(input.newPassword);

    await identity.changePassword(auth.identityId, await hashPassword(input.newPassword));
    await audit.record({ ...event, outcome: 'success', summary: { sessionsRevoked: true } });
  }

  /** Shared by reset and setup. The policy is checked first, so a weak password does not use the link up. */
  private async useLink(
    input: SetPasswordRequest,
    ctx: RequestContext,
    action: string,
    apply: (tokenHash: string, passwordHash: string) => Promise<string | null>,
  ): Promise<void> {
    await this.deps.limiter.enforce('password_reset', ctx.ip);
    const request = { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
    assertPolicy(input.password);

    const tokenHash = hashReceivedToken(input.token);
    const identityId = tokenHash ? await apply(tokenHash, await hashPassword(input.password)) : null;
    if (!identityId) {
      await this.deps.audit.record({
        action,
        outcome: 'failure',
        ...request,
        summary: { reason: tokenHash ? 'invalid_or_expired' : 'malformed_token' },
      });
      throw invalidOrExpiredToken();
    }
    await this.deps.audit.record({
      action,
      outcome: 'success',
      actorIdentityId: identityId,
      ...request,
      summary: { sessionsRevoked: true },
    });
  }
}
