import { timingSafeEqual } from 'node:crypto';
import { AUTH_COOKIES, CSRF_HEADER, type EndpointContract } from '@alphakolect/contracts';
import type { Request, RequestHandler } from 'express';
import type { AccessTokens, SessionAudience } from '../../modules/identity/access-tokens.js';
import type { IdentityRepository } from '../../modules/identity/repository.js';
import { AppError } from '../errors.js';

// Authentication for secured endpoints (TARGET_ARCHITECTURE §3.2, ADR-14 D6, D7). Mounted automatically by the
// router for every endpoint whose contract declares `security`, so a secured endpoint cannot be reached
// without it.

export type AuthContext = Readonly<{
  identityId: string;
  sessionId: string;
  audience: SessionAudience;
  membershipId: string;
  /** Tenant of a merchant/agent session (for TenantContext in P4); null for platform. */
  merchantId: string | null;
  scope: 'full' | 'mfa_enrollment';
  transport: 'cookie' | 'bearer';
}>;

// Express's request type merges the global Express.Request interface.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export type AuthDeps = {
  accessTokens: AccessTokens;
  identity: IdentityRepository;
  /** Origins allowed to make cookie-authenticated state changes (CSRF defence). Empty = none. */
  webOrigins: ReadonlySet<string>;
};

/** D7: which transport each audience may use. */
const COOKIE_AUDIENCES: ReadonlySet<SessionAudience> = new Set(['platform', 'merchant']);
const BEARER_AUDIENCES: ReadonlySet<SessionAudience> = new Set(['agent']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!cookies.has(name)) cookies.set(name, part.slice(eq + 1).trim());
  }
  return cookies;
}

const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

function sameSecret(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * D7 CSRF defence for a cookie-carrying state change: an allowed Origin, and the CSRF header equal to the CSRF
 * cookie (double-submit). Used here and by the refresh endpoint, which is cookie-driven but not authenticated
 * by an access token.
 */
export function assertCsrf(
  req: Request,
  cookies: ReadonlyMap<string, string>,
  webOrigins: ReadonlySet<string>,
): void {
  const origin = req.headers.origin;
  if (
    !origin ||
    !webOrigins.has(origin) ||
    !sameSecret(req.get(CSRF_HEADER), cookies.get(AUTH_COOKIES.csrf))
  ) {
    throw new AppError(403, 'CSRF_FAILED', 'Request could not be verified');
  }
}

function presentedCredential(req: Request, endpoint: EndpointContract) {
  const allowed = new Set(endpoint.security ?? []);
  const authorization = req.headers.authorization;
  const bearer = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : undefined;
  const cookies = parseCookies(req.headers.cookie);
  const cookie = cookies.get(AUTH_COOKIES.access);

  if (bearer && cookie) return null; // ambiguous: refuse rather than guess
  if (bearer && allowed.has('bearer')) return { token: bearer, transport: 'bearer' as const, cookies };
  if (cookie && allowed.has('cookieSession')) return { token: cookie, transport: 'cookie' as const, cookies };
  return null; // includes tokens sent in the query string or body: never read, never accepted
}

export function authenticate(endpoint: EndpointContract, deps: AuthDeps): RequestHandler {
  return async function authenticateRequest(req, _res, next) {
    try {
      const credential = presentedCredential(req, endpoint);
      if (!credential) throw unauthenticated();

      const claims = await deps.accessTokens.verify(credential.token);
      if (!claims) throw unauthenticated();

      const transportAllowed =
        credential.transport === 'cookie'
          ? COOKIE_AUDIENCES.has(claims.aud)
          : BEARER_AUDIENCES.has(claims.aud);
      if (!transportAllowed) throw unauthenticated();

      if (endpoint.audience !== 'authenticated' && endpoint.audience !== claims.aud) {
        throw new AppError(403, 'WRONG_AUDIENCE', 'This endpoint is not available to this session');
      }

      // Claims are hints: the session, identity and membership are re-validated on every request (§3.2).
      const session = await deps.identity.validateSession(claims.sid);
      if (
        !session ||
        session.identity_id !== claims.sub ||
        session.audience !== claims.aud ||
        session.membership_id !== claims.mid
      ) {
        throw unauthenticated();
      }

      if (session.scope === 'mfa_enrollment' && endpoint.sessionScope !== 'mfa_enrollment') {
        throw new AppError(403, 'MFA_ENROLLMENT_REQUIRED', 'Set up two-factor authentication to continue');
      }

      if (credential.transport === 'cookie' && !SAFE_METHODS.has(req.method)) {
        assertCsrf(req, credential.cookies, deps.webOrigins);
      }

      req.auth = Object.freeze({
        identityId: session.identity_id,
        sessionId: claims.sid,
        audience: session.audience,
        membershipId: session.membership_id,
        merchantId: session.merchant_id,
        scope: session.scope,
        transport: credential.transport,
      });
      next();
    } catch (err) {
      next(err);
    }
  };
}
