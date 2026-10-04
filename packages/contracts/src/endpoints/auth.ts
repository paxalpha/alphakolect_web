import { z } from 'zod';
import { AUTH_COOKIES, CSRF_HEADER } from '../auth.js';
import { ErrorResponse, Id } from '../primitives.js';
import { defineEndpoint } from '../registry.js';

// /v1/auth — sessions for the web audiences (TARGET_ARCHITECTURE §3.2, ADR-14). In P3 the session travels only
// in HttpOnly cookies (D7): no token, refresh token or MFA challenge ever appears in a response body.

/** D11: email is the identifier; the server normalises it to lowercase. */
export const Email = z.email().max(254).meta({ id: 'Email', example: 'owner@example.com' });

/** Audiences that sign in on the web in P3 (D3). Agents and customers (bearer) arrive later. */
export const WebAudience = z.enum(['platform', 'merchant']).meta({ id: 'WebAudience' });

export const SessionAudience = z.enum(['platform', 'merchant', 'agent']).meta({ id: 'SessionAudience' });

export const Session = z
  .object({
    identityId: Id,
    audience: SessionAudience,
    membershipId: Id,
    /** The tenant of a merchant or agent session; null for platform sessions. */
    merchantId: Id.nullable(),
    /** 'mfa_enrollment': a platform identity that must set up TOTP before anything else (D8). */
    scope: z.enum(['full', 'mfa_enrollment']),
  })
  .meta({ id: 'Session', description: 'The signed-in session (no tokens: those are in HttpOnly cookies)' });

export type Session = z.infer<typeof Session>;

export const LoginRequest = z
  .object({
    email: Email,
    // No policy check at login (only at set/change): any string up to the hashing limit is compared.
    password: z.string().min(1).max(1024),
    audience: WebAudience,
  })
  .meta({ id: 'LoginRequest' });

export type LoginRequest = z.infer<typeof LoginRequest>;

export const LoginResponse = z
  .discriminatedUnion('status', [
    z.object({ status: z.literal('authenticated'), session: Session }),
    // Platform identity without TOTP: an enrolment-only session (D8).
    z.object({ status: z.literal('mfa_enrollment_required'), session: Session }),
    // Platform identity with TOTP: the challenge is in an HttpOnly cookie; continue at POST /v1/auth/mfa/verify.
    z.object({ status: z.literal('mfa_required') }),
  ])
  .meta({ id: 'LoginResponse' });

export type LoginResponse = z.infer<typeof LoginResponse>;

const SetCookie = z.object({
  'Set-Cookie': z.string().meta({
    description: `Session cookies: ${AUTH_COOKIES.access}, ${AUTH_COOKIES.refresh} and ${AUTH_COOKIES.csrf} (HttpOnly except the CSRF cookie)`,
  }),
});

const RetryAfter = z.object({
  'Retry-After': z.string().meta({ description: 'Seconds to wait before retrying' }),
});

const error = (description: string) => ({ description, schema: ErrorResponse });
const rateLimited = { ...error('RATE_LIMITED'), headers: RetryAfter };

export const login = defineEndpoint({
  id: 'login',
  method: 'post',
  path: '/v1/auth/login',
  audience: 'public',
  summary: 'Sign in with email and password',
  request: { body: LoginRequest },
  responses: {
    200: {
      description: 'Signed in, or a second step is required',
      schema: LoginResponse,
      headers: SetCookie,
    },
    400: error('VALIDATION_ERROR'),
    401: error('INVALID_CREDENTIALS — identical for unknown accounts and wrong passwords'),
    403: error('EMAIL_VERIFICATION_REQUIRED — only after correct credentials'),
    429: rateLimited,
  },
});

export const refreshSession = defineEndpoint({
  id: 'refreshSession',
  method: 'post',
  path: '/v1/auth/refresh',
  audience: 'public',
  summary: `Rotate the session (refresh cookie; send the ${CSRF_HEADER} header)`,
  responses: {
    200: { description: 'New session cookies', schema: Session, headers: SetCookie },
    401: error('INVALID_OR_EXPIRED_TOKEN — the session cookies are cleared'),
    403: error('CSRF_FAILED'),
    429: rateLimited,
  },
});

export const logout = defineEndpoint({
  id: 'logout',
  method: 'post',
  path: '/v1/auth/logout',
  audience: 'authenticated',
  summary: 'End the current session',
  security: ['cookieSession', 'bearer'],
  sessionScope: 'mfa_enrollment',
  responses: {
    204: { description: 'Signed out; session cookies cleared', headers: SetCookie },
  },
});

export const getSession = defineEndpoint({
  id: 'getSession',
  method: 'get',
  path: '/v1/auth/session',
  audience: 'authenticated',
  summary: 'The current session',
  security: ['cookieSession', 'bearer'],
  sessionScope: 'mfa_enrollment',
  responses: {
    200: { description: 'The current session', schema: Session },
  },
});
