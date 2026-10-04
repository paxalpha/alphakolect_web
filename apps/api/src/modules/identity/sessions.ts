import type { LoginRequest, LoginResponse, Session } from '@alphakolect/contracts';
import { AppError } from '../../platform/errors.js';
import type { AuthContext } from '../../platform/http/authenticate.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { AccessTokens, SessionAudience } from './access-tokens.js';
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from './passwords.js';
import type { RateLimiter } from './rate-limits.js';
import type { IdentityRepository, SessionLifetime, ValidSession } from './repository.js';
import { hashReceivedToken, newOpaqueToken } from './tokens.js';

// Signing in, session rotation and signing out (TARGET_ARCHITECTURE §3.2, ADR-14 D3, D5, D8, D12, D13).
// Transport-agnostic: returns the secrets to hand to the client; the HTTP layer decides how (cookies, D7).

/** D5. The database enforces these as maxima (identity.session_limits); the API asks for exactly them. */
const LIFETIMES: Readonly<Record<SessionAudience, SessionLifetime>> = {
  platform: { idleSeconds: 3600, absoluteSeconds: 43200 },
  merchant: { idleSeconds: 86400, absoluteSeconds: 1209600 },
  agent: { idleSeconds: 2592000, absoluteSeconds: 7776000 },
};
/** D8: the session of a platform identity that must enrol TOTP first. */
const ENROLMENT_LIFETIME: SessionLifetime = { idleSeconds: 900, absoluteSeconds: 900 };

/** D3: who may sign in per web audience in P3. Platform staff and merchant staff arrive with P4/P5. */
const P3_MEMBERSHIP_KIND = { platform: 'super_admin', merchant: 'owner' } as const;

export type RequestContext = { ip: string; userAgent: string | null; requestId: string };

/** Secrets for the client. Never logged, never in a response body. */
export type IssuedTokens = { accessToken: string; refreshToken: string; refreshExpiresAt: Date };

export type IssuedSession = { session: Session; tokens: IssuedTokens };

export type LoginResult =
  | { kind: 'session'; status: 'authenticated' | 'mfa_enrollment_required'; issued: IssuedSession }
  | { kind: 'mfa_challenge'; status: 'mfa_required'; challengeToken: string };

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect');
export const invalidRefresh = () =>
  new AppError(401, 'INVALID_OR_EXPIRED_TOKEN', 'Your session has ended. Please sign in again.');

export const toSession = (v: ValidSession): Session => ({
  identityId: v.identity_id,
  audience: v.audience,
  membershipId: v.membership_id,
  merchantId: v.merchant_id,
  scope: v.scope,
});

export class SessionService {
  constructor(
    private readonly deps: {
      identity: IdentityRepository;
      accessTokens: AccessTokens;
      audit: AuditLog;
      limiter: RateLimiter;
    },
  ) {}

  async login(input: LoginRequest, ctx: RequestContext): Promise<LoginResult> {
    const { identity, audit, limiter } = this.deps;
    await limiter.enforce('login', ctx.ip, input.email);

    const candidate = await identity.loginCandidate(input.email, input.audience);
    // D12: an unknown account costs the same password check as a known one and fails identically.
    const passwordOk = candidate?.password_hash
      ? await verifyPassword(input.password, candidate.password_hash)
      : await burnPasswordCheck(input.password);

    const fail = async (reason: string) => {
      await audit.record({
        action: 'auth.login',
        outcome: 'failure',
        actorIdentityId: candidate?.identity_id ?? null,
        actorAudience: input.audience,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        summary: { reason },
      });
    };

    if (!candidate || !passwordOk) {
      await fail(candidate ? 'wrong_password' : 'unknown_account');
      throw invalidCredentials();
    }
    if (candidate.identity_status !== 'active') {
      await fail('identity_disabled');
      throw invalidCredentials();
    }
    // D12: only correct credentials learn that the email is unverified.
    if (!candidate.email_verified) {
      await fail('email_unverified');
      throw new AppError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email address to sign in');
    }
    if (
      !candidate.membership_id ||
      candidate.membership_status !== 'active' ||
      candidate.membership_kind !== P3_MEMBERSHIP_KIND[input.audience]
    ) {
      await fail('no_active_membership');
      throw invalidCredentials();
    }

    // D15: upgrade hashes made with older parameters. Best effort: a lost race (another login rehashed first) is fine.
    if (needsRehash(candidate.password_hash!)) {
      await identity.rehashPassword(
        candidate.identity_id,
        candidate.password_hash!,
        await hashPassword(input.password),
      );
    }

    const succeed = async (stage: LoginResponse['status'], merchantId: string | null) => {
      await audit.record({
        action: 'auth.login',
        outcome: 'success',
        merchantId,
        actorIdentityId: candidate.identity_id,
        actorAudience: input.audience,
        actorMembershipId: candidate.membership_id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        summary: { stage },
      });
    };

    // D8: platform identities always need a second factor.
    if (input.audience === 'platform' && candidate.mfa_enrolled) {
      const challenge = newOpaqueToken();
      await identity.createMfaChallenge(candidate.identity_id, candidate.membership_id, challenge.hash);
      await succeed('mfa_required', null);
      return { kind: 'mfa_challenge', status: 'mfa_required', challengeToken: challenge.raw };
    }

    const enrolmentOnly = input.audience === 'platform';
    const issued = await this.startSession({
      identityId: candidate.identity_id,
      audience: input.audience,
      membershipId: candidate.membership_id,
      scope: enrolmentOnly ? 'mfa_enrollment' : 'full',
      ctx,
    });
    const status = enrolmentOnly ? 'mfa_enrollment_required' : 'authenticated';
    await succeed(status, issued.session.merchantId);
    return { kind: 'session', status, issued };
  }

  /** Create a session and its first tokens. Also used after a successful MFA step (P3.8). */
  async startSession(args: {
    identityId: string;
    audience: SessionAudience;
    membershipId: string;
    scope: 'full' | 'mfa_enrollment';
    ctx: RequestContext;
  }): Promise<IssuedSession> {
    const { identity, accessTokens } = this.deps;
    const refresh = newOpaqueToken();
    const created = await identity.createSession({
      identityId: args.identityId,
      audience: args.audience,
      membershipId: args.membershipId,
      scope: args.scope,
      refreshHash: refresh.hash,
      lifetime: args.scope === 'mfa_enrollment' ? ENROLMENT_LIFETIME : LIFETIMES[args.audience],
      ip: args.ctx.ip,
      userAgent: args.ctx.userAgent,
    });
    const valid = await identity.validateSession(created.session_id);
    if (!valid) throw new Error('a session just created is not valid');
    return {
      session: toSession(valid),
      tokens: {
        accessToken: await accessTokens.sign({
          sub: valid.identity_id,
          sid: created.session_id,
          aud: valid.audience,
          mid: valid.membership_id,
        }),
        refreshToken: refresh.raw,
        refreshExpiresAt: created.refresh_expires_at,
      },
    };
  }

  /** Rotate a refresh token (§3.2). Reuse of a spent token ends the whole session (exit criterion 5). */
  async refresh(rawRefreshToken: string | undefined, ctx: RequestContext): Promise<IssuedSession> {
    const { identity, accessTokens, audit, limiter } = this.deps;
    await limiter.enforce('refresh', ctx.ip);

    const oldHash = hashReceivedToken(rawRefreshToken);
    if (!oldHash) throw invalidRefresh();

    const next = newOpaqueToken();
    const rotated = await identity.rotateRefreshToken(oldHash, next.hash);
    if (rotated.outcome === 'reuse_detected') {
      await audit.record({
        action: 'auth.refresh',
        outcome: 'denied',
        actorIdentityId: rotated.identity_id,
        targetType: 'session',
        targetId: rotated.session_id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        summary: { reason: 'refresh_token_reuse', sessionRevoked: true },
      });
      throw invalidRefresh();
    }
    if (rotated.outcome !== 'rotated') throw invalidRefresh();

    const valid = await identity.validateSession(rotated.session_id!);
    if (!valid) throw invalidRefresh();
    return {
      session: toSession(valid),
      tokens: {
        accessToken: await accessTokens.sign({
          sub: valid.identity_id,
          sid: rotated.session_id!,
          aud: valid.audience,
          mid: valid.membership_id,
        }),
        refreshToken: next.raw,
        refreshExpiresAt: rotated.refresh_expires_at!,
      },
    };
  }

  async logout(
    auth: Pick<AuthContext, 'sessionId' | 'identityId' | 'audience' | 'membershipId' | 'merchantId'>,
    ctx: RequestContext,
  ): Promise<void> {
    await this.deps.identity.revokeSession(auth.sessionId, 'logout');
    await this.deps.audit.record({
      action: 'auth.logout',
      outcome: 'success',
      merchantId: auth.merchantId,
      actorIdentityId: auth.identityId,
      actorAudience: auth.audience,
      actorMembershipId: auth.membershipId,
      targetType: 'session',
      targetId: auth.sessionId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
  }
}
