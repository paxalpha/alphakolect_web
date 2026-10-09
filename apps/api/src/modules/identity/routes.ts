import {
  AUTH_COOKIES,
  type ChangePasswordRequest,
  type ConfirmTotpRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type PasswordEmailPending,
  type SetPasswordRequest,
  type LoginResponse,
  type MembershipChoices,
  type MfaVerified,
  type ResendVerificationRequest,
  type Session,
  type SignupRequest,
  type TotpEnrolled,
  type TotpEnrollment,
  type VerificationPending,
  type VerifyEmailRequest,
  type VerifyMfaRequest,
} from '@alphakolect/contracts';
import type { Request, RequestHandler, Response } from 'express';
import { AppError } from '../../platform/errors.js';
import { assertCsrf, parseCookies, type AuthContext } from '../../platform/http/authenticate.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './access-tokens.js';
import type { AccountService } from './accounts.js';
import type { MfaService } from './mfa.js';
import type { PasswordService } from './password-flows.js';
import {
  clearMfaChallengeCookie,
  clearSessionCookies,
  MFA_CHALLENGE_COOKIE,
  SELECTION_CHALLENGE_COOKIE,
  clearSelectionChallengeCookie,
  setSelectionChallengeCookie,
  setMfaChallengeCookie,
  setSessionCookies,
  type CookieSettings,
} from './cookies.js';
import type { IssuedTokens, RequestContext, SessionService } from './sessions.js';
import type { RateLimiter } from './rate-limits.js';
import type { IdentityRepository } from './repository.js';
import { hashReceivedToken, newOpaqueToken } from './tokens.js';

// /v1/auth handlers (contracts: packages/contracts/src/endpoints/auth.ts). Bodies are already validated against
// the contract; authentication, where declared, is already done. P3 audiences are web audiences, so every
// session secret goes into an HttpOnly cookie (ADR-14 D7) and never into a response body.

export type AuthHandlerDeps = {
  sessions: SessionService;
  cookies: CookieSettings;
  webOrigins: ReadonlySet<string>;
};

const contextOf = (req: Request): RequestContext => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
  requestId: String(req.id),
});

/** The session's cookies all end with its refresh token (idle timeout); the access cookie sooner. */
function setCookiesFor(res: Response, settings: CookieSettings, tokens: IssuedTokens, csrfToken: string) {
  const remaining = Math.max(1, Math.floor((tokens.refreshExpiresAt.getTime() - Date.now()) / 1000));
  setSessionCookies(res, settings, {
    accessToken: tokens.accessToken,
    accessMaxAgeSeconds: Math.min(ACCESS_TOKEN_TTL_SECONDS, remaining),
    refreshToken: tokens.refreshToken,
    refreshMaxAgeSeconds: remaining,
    csrfToken,
    csrfMaxAgeSeconds: remaining,
  });
}

const sessionOf = (auth: AuthContext): Session => ({
  identityId: auth.identityId,
  audience: auth.audience,
  membershipId: auth.membershipId,
  merchantId: auth.merchantId,
  scope: auth.scope,
});

export function authHandlers({ sessions, cookies, webOrigins }: AuthHandlerDeps) {
  const login: RequestHandler = async (req, res) => {
    const result = await sessions.login(req.body as LoginRequest, contextOf(req));
    if (result.kind === 'membership_selection') {
      // ADR-15 T4: no session yet — the challenge cookie lets the client fetch the choices and select one.
      setSelectionChallengeCookie(res, cookies, result.challengeToken);
      throw new AppError(409, 'MEMBERSHIP_SELECTION_REQUIRED', 'Choose which business to sign in to');
    }
    if (result.kind === 'mfa_challenge') {
      setMfaChallengeCookie(res, cookies, result.challengeToken);
      const body: LoginResponse = { status: 'mfa_required' };
      res.json(body);
      return;
    }
    setCookiesFor(res, cookies, result.issued.tokens, newOpaqueToken().raw);
    const body: LoginResponse = { status: result.status, session: result.issued.session };
    res.json(body);
  };

  const refreshSession: RequestHandler = async (req, res) => {
    const jar = parseCookies(req.headers.cookie);
    // Not authenticated by an access token (it may have expired), but cookie-driven: same CSRF rule (D7).
    // A CSRF failure leaves the cookies alone, so a cross-site request cannot sign anyone out.
    assertCsrf(req, jar, webOrigins);
    try {
      const issued = await sessions.refresh(jar.get(AUTH_COOKIES.refresh), contextOf(req));
      // The CSRF token stays for the life of the session, so open tabs keep working across a refresh.
      setCookiesFor(res, cookies, issued.tokens, jar.get(AUTH_COOKIES.csrf)!);
      const body: Session = issued.session;
      res.json(body);
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVALID_OR_EXPIRED_TOKEN')
        clearSessionCookies(res, cookies);
      throw err;
    }
  };

  const logout: RequestHandler = async (req, res) => {
    const auth = req.auth!;
    await sessions.logout(auth, contextOf(req));
    if (auth.transport === 'cookie') clearSessionCookies(res, cookies);
    res.status(204).end();
  };

  const getSession: RequestHandler = (req, res) => {
    const body: Session = sessionOf(req.auth!);
    res.json(body);
  };

  return { login, refreshSession, logout, getSession };
}

/** Signup and email verification. The 202 answers are identical for every email (D12). */
export function accountHandlers({ accounts }: { accounts: AccountService }) {
  const pending: VerificationPending = { status: 'verification_email_sent' };

  const signup: RequestHandler = async (req, res) => {
    await accounts.signup(req.body as SignupRequest, contextOf(req));
    res.status(202).json(pending);
  };

  const verifyEmail: RequestHandler = async (req, res) => {
    await accounts.verifyEmail((req.body as VerifyEmailRequest).token, contextOf(req));
    res.status(204).end();
  };

  const resendVerification: RequestHandler = async (req, res) => {
    await accounts.resendVerification(req.body as ResendVerificationRequest, contextOf(req));
    res.status(202).json(pending);
  };

  return { signup, verifyEmail, resendVerification };
}

/**
 * Forgot / reset / setup / change. Reset and change end every session of the account (D5), so they also clear
 * this browser's session cookies.
 */
export function passwordHandlers({
  passwords,
  cookies,
}: {
  passwords: PasswordService;
  cookies: CookieSettings;
}) {
  const sent: PasswordEmailPending = { status: 'password_email_sent' };

  const forgotPassword: RequestHandler = async (req, res) => {
    await passwords.forgot(req.body as ForgotPasswordRequest, contextOf(req));
    res.status(202).json(sent);
  };

  const resetPassword: RequestHandler = async (req, res) => {
    await passwords.reset(req.body as SetPasswordRequest, contextOf(req));
    clearSessionCookies(res, cookies);
    res.status(204).end();
  };

  const completeAccountSetup: RequestHandler = async (req, res) => {
    await passwords.completeSetup(req.body as SetPasswordRequest, contextOf(req));
    res.status(204).end();
  };

  const changePassword: RequestHandler = async (req, res) => {
    const auth = req.auth!;
    await passwords.change(auth, req.body as ChangePasswordRequest, contextOf(req));
    if (auth.transport === 'cookie') clearSessionCookies(res, cookies);
    res.status(204).end();
  };

  return { forgotPassword, resetPassword, completeAccountSetup, changePassword };
}

/** TOTP enrolment (enrolment-only session) and the login second step (MFA challenge cookie), D8. */
export function mfaHandlers({ mfa, cookies }: { mfa: MfaService; cookies: CookieSettings }) {
  const beginTotpEnrollment: RequestHandler = async (req, res) => {
    const body: TotpEnrollment = await mfa.beginEnrollment(req.auth!, contextOf(req));
    res.set('Cache-Control', 'no-store').json(body);
  };

  const confirmTotpEnrollment: RequestHandler = async (req, res) => {
    const { issued, recoveryCodes } = await mfa.confirmEnrollment(
      req.auth!,
      (req.body as ConfirmTotpRequest).code,
      contextOf(req),
    );
    // A new, full session replaces the enrolment one; the page keeps its CSRF token.
    const csrf = parseCookies(req.headers.cookie).get(AUTH_COOKIES.csrf) ?? newOpaqueToken().raw;
    setCookiesFor(res, cookies, issued.tokens, csrf);
    const body: TotpEnrolled = { session: issued.session, recoveryCodes };
    res.set('Cache-Control', 'no-store').json(body);
  };

  const verifyMfa: RequestHandler = async (req, res) => {
    const challenge = parseCookies(req.headers.cookie).get(MFA_CHALLENGE_COOKIE);
    try {
      const issued = await mfa.verifyChallenge(challenge, req.body as VerifyMfaRequest, contextOf(req));
      clearMfaChallengeCookie(res, cookies);
      setCookiesFor(res, cookies, issued.tokens, newOpaqueToken().raw);
      const body: MfaVerified = { status: 'authenticated', session: issued.session };
      res.json(body);
    } catch (err) {
      // A wrong code keeps the challenge (up to 5 attempts); a dead challenge means signing in again.
      if (err instanceof AppError && err.code === 'INVALID_OR_EXPIRED_TOKEN')
        clearMfaChallengeCookie(res, cookies);
      throw err;
    }
  };

  return { beginTotpEnrollment, confirmTotpEnrollment, verifyMfa };
}

/**
 * The membership-selection step after a 409 login answer (ADR-15 T4). Driven by the HttpOnly selection challenge;
 * nothing here is reachable without it. Choices are never cached and never sent with CORS headers.
 */
export function selectionHandlers({
  identity,
  limiter,
  cookies,
}: {
  identity: IdentityRepository;
  limiter: RateLimiter;
  cookies: CookieSettings;
}) {
  const challengeHash = async (req: Request) => {
    const hash = hashReceivedToken(parseCookies(req.headers.cookie).get(SELECTION_CHALLENGE_COOKIE));
    await limiter.enforce('membership_selection', req.ip ?? 'unknown', hash);
    return hash;
  };

  const listLoginMemberships: RequestHandler = async (req, res) => {
    const hash = await challengeHash(req);
    const choices = hash ? await identity.selectionChoices(hash) : [];
    // Fewer than two left (none, or all but one became ineligible) or no valid challenge: sign in again.
    if (choices.length < 2) {
      clearSelectionChallengeCookie(res, cookies);
      throw new AppError(401, 'INVALID_OR_EXPIRED_TOKEN', 'This sign-in has expired. Please sign in again.');
    }
    const body: MembershipChoices = {
      memberships: choices.map((c) => ({
        selectionId: c.membership_id,
        merchantName: c.merchant_name ?? '',
        kind: c.kind as 'owner' | 'staff',
      })),
    };
    res.set('Cache-Control', 'no-store').json(body);
  };

  return { listLoginMemberships };
}
