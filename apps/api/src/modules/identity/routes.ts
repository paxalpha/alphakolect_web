import {
  AUTH_COOKIES,
  type LoginRequest,
  type LoginResponse,
  type ResendVerificationRequest,
  type Session,
  type SignupRequest,
  type VerificationPending,
  type VerifyEmailRequest,
} from '@alphakolect/contracts';
import type { Request, RequestHandler, Response } from 'express';
import { AppError } from '../../platform/errors.js';
import { assertCsrf, parseCookies, type AuthContext } from '../../platform/http/authenticate.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './access-tokens.js';
import type { AccountService } from './accounts.js';
import {
  clearSessionCookies,
  setMfaChallengeCookie,
  setSessionCookies,
  type CookieSettings,
} from './cookies.js';
import type { IssuedTokens, RequestContext, SessionService } from './sessions.js';
import { newOpaqueToken } from './tokens.js';

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
