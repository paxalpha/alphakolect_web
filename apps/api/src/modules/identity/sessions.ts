import type { LoginRequest, LoginResponse, Session } from '@alphakolect/contracts';
import type { Db } from '../../platform/db.js';
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

/** The audiences of the cookie (web) refresh endpoint; agents refresh on their own endpoint (ADR-15 T12). */
const WEB_AUDIENCES: readonly SessionAudience[] = ['platform', 'merchant'];

export type RequestContext = { ip: string; userAgent: string | null; requestId: string };

/** Credentials for any audience: the web login (platform, merchant) or the agent login (ADR-15 T12). */
export type SignInRequest = Omit<LoginRequest, 'audience'> & { audience: SessionAudience };

/** Secrets for the client. Never logged, never in a response body. */
export type IssuedTokens = { accessToken: string; refreshToken: string; refreshExpiresAt: Date };

export type IssuedSession = { session: Session; tokens: IssuedTokens };

export type LoginResult =
  | { kind: 'session'; status: 'authenticated' | 'mfa_enrollment_required'; issued: IssuedSession }
  | { kind: 'mfa_challenge'; status: 'mfa_required'; challengeToken: string }
  /** Several eligible memberships (ADR-15 T4): no session, a selection challenge for the client to continue with. */
  | { kind: 'membership_selection'; challengeToken: string };

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
      db: Db;
      identity: IdentityRepository;
      accessTokens: AccessTokens;
      audit: AuditLog;
      limiter: RateLimiter;
    },
  ) {}

  // Audit (P5.3a, plan §8.4): every successful step commits together with its event — the session, challenge,
  // rotation or revocation and the event in one transaction (pattern B); refusals are best effort, after it.

  async login(input: SignInRequest, ctx: RequestContext): Promise<LoginResult> {
    const { db, identity, audit, limiter } = this.deps;
    await limiter.enforce('login', ctx.ip, input.email);

    // Credentials only (P4.2): which membership to use is decided after the password check, by the database.
    const candidate = await identity.loginIdentity(input.email);
    // D12: an unknown account costs the same password check as a known one and fails identically.
    const passwordOk = candidate?.password_hash
      ? await verifyPassword(input.password, candidate.password_hash)
      : await burnPasswordCheck(input.password);

    const request = { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
    const fail = async (reason: string) => {
      await audit.recordBestEffort({
        action: 'auth.login',
        outcome: 'failure',
        actorIdentityId: candidate?.identity_id ?? null,
        actorAudience: input.audience,
        ...request,
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
    // ADR-15 T4: never guess. Eligibility (active membership of a kind valid for the audience, in an active
    // merchant; platform: the super admin) is decided by the database. Several eligible memberships create a
    // selection challenge and no session — that challenge and its event commit together.
    const selection = newOpaqueToken();
    const resolved = await db.transaction(async (tx) => {
      const r = await identity
        .within(tx)
        .resolveLoginMembership(candidate.identity_id, input.audience, selection.hash);
      if (r.eligible_count > 0 && r.membership_id === null) {
        await audit.mutateAudited(tx, {
          action: 'auth.login',
          outcome: 'success',
          actorIdentityId: candidate.identity_id,
          actorAudience: input.audience,
          ...request,
          summary: { stage: 'membership_selection_required', choices: r.eligible_count },
        });
      }
      return r;
    });
    if (resolved.eligible_count === 0) {
      await fail('no_active_membership');
      throw invalidCredentials();
    }
    if (resolved.membership_id === null) {
      return { kind: 'membership_selection', challengeToken: selection.raw };
    }
    const membershipId = resolved.membership_id;

    // D15: upgrade hashes made with older parameters. Best effort: a lost race (another login rehashed first) is fine.
    if (needsRehash(candidate.password_hash!)) {
      await identity.rehashPassword(
        candidate.identity_id,
        candidate.password_hash!,
        await hashPassword(input.password),
      );
    }

    const succeeded = (stage: LoginResponse['status'], merchantId: string | null) =>
      ({
        action: 'auth.login',
        outcome: 'success',
        merchantId,
        actorIdentityId: candidate.identity_id,
        actorAudience: input.audience,
        actorMembershipId: membershipId,
        ...request,
        summary: { stage },
      }) as const;

    // D8: platform identities always need a second factor — the challenge and its event commit together.
    if (input.audience === 'platform' && candidate.mfa_enrolled) {
      const challenge = newOpaqueToken();
      await db.transaction(async (tx) => {
        await identity.within(tx).createMfaChallenge(candidate.identity_id, membershipId, challenge.hash);
        await audit.mutateAudited(tx, succeeded('mfa_required', null));
      });
      return { kind: 'mfa_challenge', status: 'mfa_required', challengeToken: challenge.raw };
    }

    const enrolmentOnly = input.audience === 'platform';
    const status = enrolmentOnly ? 'mfa_enrollment_required' : 'authenticated';
    const issued = await db.transaction(async (tx) => {
      const started = await this.startSession(
        {
          identityId: candidate.identity_id,
          audience: input.audience,
          membershipId,
          scope: enrolmentOnly ? 'mfa_enrollment' : 'full',
          ctx,
        },
        identity.within(tx),
      );
      await audit.mutateAudited(tx, succeeded(status, started.session.merchantId));
      return started;
    });
    return { kind: 'session', status, issued };
  }

  /**
   * The selection step (ADR-15 T4, T16): the database locks and consumes the challenge whatever the outcome, then
   * re-checks that the choice is still eligible; only then is a session created, bound to that one membership.
   * Merchant (web) or agent (P4.7, its own endpoint) — platform sign-in never needs a choice. A challenge issued
   * for one audience is never redeemed at the other's endpoint.
   */
  async selectMembership(
    challengeHash: string | null,
    selectionId: string,
    ctx: RequestContext,
    audience: 'merchant' | 'agent' = 'merchant',
  ): Promise<IssuedSession> {
    const { db, identity, audit } = this.deps;
    const request = { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
    // #4: the challenge's consumption, the session and the event commit together.
    const result = challengeHash
      ? await db.transaction(async (tx) => {
          const repo = identity.within(tx);
          const taken = await repo.takeSelection(challengeHash, selectionId);
          if (!taken || taken.audience !== audience) return { taken, issued: null };
          const issued = await this.startSession(
            {
              identityId: taken.identity_id,
              audience,
              membershipId: taken.membership_id,
              scope: 'full',
              ctx,
            },
            repo,
          );
          await audit.mutateAudited(tx, {
            action: 'auth.login_select',
            outcome: 'success',
            merchantId: issued.session.merchantId,
            actorIdentityId: taken.identity_id,
            actorAudience: audience,
            actorMembershipId: taken.membership_id,
            ...request,
          });
          return { taken, issued };
        })
      : { taken: null, issued: null };
    if (!result.issued) {
      await audit.recordBestEffort({
        action: 'auth.login_select',
        outcome: 'failure',
        ...(result.taken ? { actorIdentityId: result.taken.identity_id } : {}),
        ...request,
        summary: { reason: challengeHash ? 'not_available' : 'no_challenge' },
      });
      throw invalidRefresh();
    }
    return result.issued;
  }

  /**
   * Create a session and its first tokens. Also used after a successful MFA step (P3.8). `repo` binds it to the
   * caller's transaction, so the session commits with the caller's audit event (P5.3a).
   */
  async startSession(
    args: {
      identityId: string;
      audience: SessionAudience;
      membershipId: string;
      scope: 'full' | 'mfa_enrollment';
      ctx: RequestContext;
    },
    repo: IdentityRepository = this.deps.identity,
  ): Promise<IssuedSession> {
    const { accessTokens } = this.deps;
    const refresh = newOpaqueToken();
    const created = await repo.createSession({
      identityId: args.identityId,
      audience: args.audience,
      membershipId: args.membershipId,
      scope: args.scope,
      refreshHash: refresh.hash,
      lifetime: args.scope === 'mfa_enrollment' ? ENROLMENT_LIFETIME : LIFETIMES[args.audience],
      ip: args.ctx.ip,
      userAgent: args.ctx.userAgent,
    });
    const valid = await repo.validateSession(created.session_id);
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

  /**
   * Rotate a refresh token (§3.2). Reuse of a spent token ends the whole session (exit criterion 5).
   * Every outcome is audited (P3.5 review): success and the reuse revocation commit together with their events
   * (#5, #6 — the reuse is a high-severity security event); a plain failure is best effort. Tokens never reach the
   * audit log.
   */
  async refresh(
    rawRefreshToken: string | undefined,
    ctx: RequestContext,
    audiences: readonly SessionAudience[] = WEB_AUDIENCES,
  ): Promise<IssuedSession> {
    const { db, identity, accessTokens, audit, limiter } = this.deps;
    await limiter.enforce('refresh', ctx.ip);
    const request = { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
    const failed = async (reason: string) => {
      await audit.recordBestEffort({
        action: 'auth.refresh',
        outcome: 'failure',
        ...request,
        summary: { reason },
      });
      return invalidRefresh();
    };

    const oldHash = hashReceivedToken(rawRefreshToken);
    if (!oldHash) throw await failed(rawRefreshToken ? 'malformed_token' : 'no_token');

    const next = newOpaqueToken();
    const result = await db.transaction(async (tx) => {
      const repo = identity.within(tx);
      // Each endpoint rotates only its own audiences' tokens: cookies the web ones, the agent endpoint agents' (T12).
      const rotated = await repo.rotateRefreshToken(oldHash, next.hash, audiences);
      if (rotated.outcome === 'reuse_detected') {
        // The revocation inside rotate_refresh_token and this event commit together (#6).
        await audit.mutateAudited(tx, {
          action: 'auth.refresh_token_reuse',
          outcome: 'denied',
          actorIdentityId: rotated.identity_id,
          targetType: 'session',
          targetId: rotated.session_id,
          ...request,
          summary: { severity: 'high', sessionRevoked: true },
        });
        return { kind: 'reuse' as const };
      }
      if (rotated.outcome !== 'rotated') return { kind: 'invalid' as const };
      const valid = await repo.validateSession(rotated.session_id!);
      if (!valid) return { kind: 'invalid' as const };
      await audit.mutateAudited(tx, {
        action: 'auth.refresh',
        outcome: 'success',
        merchantId: valid.merchant_id,
        actorIdentityId: valid.identity_id,
        actorAudience: valid.audience,
        actorMembershipId: valid.membership_id,
        targetType: 'session',
        targetId: rotated.session_id,
        ...request,
      });
      return { kind: 'rotated' as const, rotated, valid };
    });
    if (result.kind === 'reuse') throw invalidRefresh();
    if (result.kind === 'invalid') throw await failed('invalid_or_expired');

    const { rotated, valid } = result;
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
    // #7: the revocation and its event commit together.
    await this.deps.db.transaction(async (tx) => {
      await this.deps.identity.within(tx).revokeSession(auth.sessionId, 'logout');
      await this.deps.audit.mutateAudited(tx, {
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
    });
  }
}
