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
    409: {
      ...error(
        'MEMBERSHIP_SELECTION_REQUIRED — only after correct credentials, when several memberships are eligible: no session yet; a short-lived selection challenge is set as an HttpOnly cookie. Continue with GET /v1/auth/login/memberships and POST /v1/auth/login/select.',
      ),
      headers: SetCookie,
    },
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

// ── membership selection (ADR-15 T4) ──────────────────────────────────────────────────────────

export const MembershipChoice = z
  .object({
    /** Opaque to the client: send it back to POST /v1/auth/login/select. Never authorization by itself. */
    selectionId: Id,
    merchantName: z.string(),
    kind: z.enum(['owner', 'staff']),
  })
  .meta({ id: 'MembershipChoice' });

export const MembershipChoices = z
  .object({ memberships: z.array(MembershipChoice).min(2) })
  .meta({ id: 'MembershipChoices', description: 'The businesses this account may sign in to' });

export type MembershipChoices = z.infer<typeof MembershipChoices>;

const NoStoreChoices = z.object({
  'Cache-Control': z.literal('no-store').meta({ description: 'The choices are never cached' }),
});

export const listLoginMemberships = defineEndpoint({
  id: 'listLoginMemberships',
  method: 'get',
  path: '/v1/auth/login/memberships',
  audience: 'public',
  summary: 'The businesses to choose from (needs the selection challenge cookie set by a 409 login answer)',
  responses: {
    200: {
      description: 'The choices; the challenge is not used up',
      schema: MembershipChoices,
      headers: NoStoreChoices,
    },
    401: error('INVALID_OR_EXPIRED_TOKEN — no valid selection challenge: sign in again'),
    429: rateLimited,
  },
});

export const SelectMembershipRequest = z.object({ selectionId: Id }).meta({ id: 'SelectMembershipRequest' });

export type SelectMembershipRequest = z.infer<typeof SelectMembershipRequest>;

/** Its own schema (not LoginResponse), like MfaVerified: signed in to the chosen business. */
export const MembershipSelected = z
  .object({ status: z.literal('authenticated'), session: Session })
  .meta({ id: 'MembershipSelected' });

export type MembershipSelected = z.infer<typeof MembershipSelected>;

export const selectLoginMembership = defineEndpoint({
  id: 'selectLoginMembership',
  method: 'post',
  path: '/v1/auth/login/select',
  audience: 'public',
  summary: 'Sign in to the chosen business (uses the selection challenge cookie; JSON only)',
  request: { body: SelectMembershipRequest },
  responses: {
    200: {
      description: 'Signed in; the selection challenge is used up',
      schema: MembershipSelected,
      headers: SetCookie,
    },
    400: error('VALIDATION_ERROR'),
    401: error(
      'INVALID_OR_EXPIRED_TOKEN — no valid challenge, or the choice is not (or no longer) available: the challenge is used up either way; sign in again',
    ),
    429: rateLimited,
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

// ── signup and email verification (D2, D12) ─────────────────────────────────────────────────────

export const NewPassword = z.string().min(1).max(1024).meta({
  id: 'NewPassword',
  description:
    '12-128 characters, no composition rules; very common passwords are refused (422 WEAK_PASSWORD, D10)',
});

export const SignupRequest = z
  .object({
    email: Email,
    password: NewPassword,
    businessName: z.string().trim().min(2).max(120),
  })
  .meta({ id: 'SignupRequest' });

export type SignupRequest = z.infer<typeof SignupRequest>;

/** The same answer whether or not the email already has an account (D12). */
export const VerificationPending = z.object({ status: z.literal('verification_email_sent') }).meta({
  id: 'VerificationPending',
  description: 'If the email can receive a verification link, one has been sent. Identical for every email.',
});

export type VerificationPending = z.infer<typeof VerificationPending>;

export const VerifyEmailRequest = z
  .object({
    /** From the link in the verification email (sent in the URL fragment, never to a server log). */
    token: z.string().min(1).max(256),
  })
  .meta({ id: 'VerifyEmailRequest' });

export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequest>;

export const ResendVerificationRequest = z.object({ email: Email }).meta({ id: 'ResendVerificationRequest' });

export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequest>;

export const signup = defineEndpoint({
  id: 'signup',
  method: 'post',
  path: '/v1/auth/signup',
  audience: 'public',
  summary: 'Create a business and its owner account; a verification email follows',
  request: { body: SignupRequest },
  responses: {
    202: { description: 'Accepted — identical whether or not the email is new', schema: VerificationPending },
    400: error('VALIDATION_ERROR'),
    422: error('WEAK_PASSWORD'),
    429: rateLimited,
  },
});

export const verifyEmail = defineEndpoint({
  id: 'verifyEmail',
  method: 'post',
  path: '/v1/auth/email/verify',
  audience: 'public',
  summary: 'Confirm an email address with the token from the verification email',
  request: { body: VerifyEmailRequest },
  responses: {
    204: { description: 'Email verified (and the business activated); the owner can now sign in' },
    400: error('INVALID_OR_EXPIRED_TOKEN — the same for every reason; or VALIDATION_ERROR'),
    429: rateLimited,
  },
});

export const resendVerification = defineEndpoint({
  id: 'resendVerification',
  method: 'post',
  path: '/v1/auth/email/resend',
  audience: 'public',
  summary: 'Send a new verification email',
  request: { body: ResendVerificationRequest },
  responses: {
    202: { description: 'Accepted — identical for every email (D12)', schema: VerificationPending },
    400: error('VALIDATION_ERROR'),
    429: rateLimited,
  },
});

// ── passwords: forgot, reset, first-password setup, change (§3.2, D5, D9, D10, D12) ──────────────

export const PasswordEmailPending = z.object({ status: z.literal('password_email_sent') }).meta({
  id: 'PasswordEmailPending',
  description: 'If the email has an account, a link has been sent to it. Identical for every email.',
});

export type PasswordEmailPending = z.infer<typeof PasswordEmailPending>;

export const ForgotPasswordRequest = z.object({ email: Email }).meta({ id: 'ForgotPasswordRequest' });

export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

/** Reset and first-password setup: the token from the emailed link (URL fragment) and the new password. */
export const SetPasswordRequest = z
  .object({ token: z.string().min(1).max(256), password: NewPassword })
  .meta({ id: 'SetPasswordRequest' });

export type SetPasswordRequest = z.infer<typeof SetPasswordRequest>;

export const ChangePasswordRequest = z
  .object({ currentPassword: z.string().min(1).max(1024), newPassword: NewPassword })
  .meta({ id: 'ChangePasswordRequest' });

export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

export const forgotPassword = defineEndpoint({
  id: 'forgotPassword',
  method: 'post',
  path: '/v1/auth/password/forgot',
  audience: 'public',
  summary: 'Email a password reset link (or, for an account that has never had a password, a setup link)',
  request: { body: ForgotPasswordRequest },
  responses: {
    202: { description: 'Accepted — identical for every email (D12)', schema: PasswordEmailPending },
    400: error('VALIDATION_ERROR'),
    429: rateLimited,
  },
});

export const resetPassword = defineEndpoint({
  id: 'resetPassword',
  method: 'post',
  path: '/v1/auth/password/reset',
  audience: 'public',
  summary: 'Set a new password with a reset link; every session of the account ends',
  request: { body: SetPasswordRequest },
  responses: {
    204: {
      description: 'Password changed; every session revoked and this browser signed out',
      headers: SetCookie,
    },
    400: error('INVALID_OR_EXPIRED_TOKEN — the same for every reason; or VALIDATION_ERROR'),
    422: error('WEAK_PASSWORD — the link is not used up'),
    429: rateLimited,
  },
});

export const completeAccountSetup = defineEndpoint({
  id: 'completeAccountSetup',
  method: 'post',
  path: '/v1/auth/password/setup',
  audience: 'public',
  summary: 'Set the first password of an account with its setup link (this also confirms the email)',
  request: { body: SetPasswordRequest },
  responses: {
    204: { description: 'Password set and email confirmed; the account can now sign in' },
    400: error('INVALID_OR_EXPIRED_TOKEN — the same for every reason; or VALIDATION_ERROR'),
    422: error('WEAK_PASSWORD — the link is not used up'),
    429: rateLimited,
  },
});

export const changePassword = defineEndpoint({
  id: 'changePassword',
  method: 'post',
  path: '/v1/auth/password/change',
  audience: 'authenticated',
  summary: 'Change the password; every session of the account ends, including this one',
  security: ['cookieSession', 'bearer'],
  request: { body: ChangePasswordRequest },
  responses: {
    204: {
      description: 'Password changed; every session revoked and this browser signed out',
      headers: SetCookie,
    },
    400: error('VALIDATION_ERROR'),
    401: error('INVALID_CREDENTIALS — the current password is wrong'),
    422: error('WEAK_PASSWORD'),
    429: rateLimited,
  },
});

// ── MFA: TOTP enrolment and the login second step (D8) ──────────────────────────────────────────
// The two enrolment responses are the only ones that ever carry a secret: the TOTP secret (to add it to an
// authenticator app) and the 10 recovery codes (shown once). Both are sent with Cache-Control: no-store.

export const TotpEnrollment = z
  .object({
    /** otpauth:// URI for a QR code. */
    otpauthUri: z.string().startsWith('otpauth://totp/'),
    /** The same secret, base32, for typing in by hand. */
    secret: z.string().regex(/^[A-Z2-7]+$/),
  })
  .meta({ id: 'TotpEnrollment', description: 'Shown once. Not stored by the client.' });

export type TotpEnrollment = z.infer<typeof TotpEnrollment>;

export const TotpCode = z
  .string()
  .regex(/^\d{6}$/, 'must be the 6-digit code')
  .meta({ id: 'TotpCode' });

export const ConfirmTotpRequest = z.object({ code: TotpCode }).meta({ id: 'ConfirmTotpRequest' });

export type ConfirmTotpRequest = z.infer<typeof ConfirmTotpRequest>;

export const TotpEnrolled = z
  .object({
    session: Session,
    /** 10 single-use recovery codes. Shown once: store them somewhere safe. */
    recoveryCodes: z.array(z.string()).length(10),
  })
  .meta({ id: 'TotpEnrolled' });

export type TotpEnrolled = z.infer<typeof TotpEnrolled>;

export const VerifyMfaRequest = z
  .union([z.strictObject({ code: TotpCode }), z.strictObject({ recoveryCode: z.string().min(1).max(64) })])
  .meta({
    id: 'VerifyMfaRequest',
    description: 'Either the current authenticator code or one recovery code',
  });

export type VerifyMfaRequest = z.infer<typeof VerifyMfaRequest>;

const NoStore = z.object({
  'Cache-Control': z.literal('no-store').meta({ description: 'The body holds a secret shown once' }),
});

export const beginTotpEnrollment = defineEndpoint({
  id: 'beginTotpEnrollment',
  method: 'post',
  path: '/v1/auth/mfa/totp/enrollment',
  audience: 'platform',
  summary: 'Start TOTP enrolment: a new secret for an authenticator app',
  security: ['cookieSession'],
  sessionScope: 'mfa_enrollment',
  responses: {
    200: {
      description: 'A new, unconfirmed secret (replaces any earlier unconfirmed one)',
      schema: TotpEnrollment,
      headers: NoStore,
    },
    409: error('MFA_ALREADY_ENROLLED'),
  },
});

export const confirmTotpEnrollment = defineEndpoint({
  id: 'confirmTotpEnrollment',
  method: 'post',
  path: '/v1/auth/mfa/totp/confirm',
  audience: 'platform',
  summary: 'Confirm TOTP enrolment with a code; the enrolment session becomes a full session',
  security: ['cookieSession'],
  sessionScope: 'mfa_enrollment',
  request: { body: ConfirmTotpRequest },
  responses: {
    200: {
      description: 'Enrolled: a full session (new cookies) and the recovery codes, shown once',
      schema: TotpEnrolled,
      headers: SetCookie.extend(NoStore.shape),
    },
    400: error('VALIDATION_ERROR'),
    401: error('INVALID_MFA_CODE'),
    409: error('MFA_ALREADY_ENROLLED — or enrolment was not started'),
    429: rateLimited,
  },
});

/**
 * The only answer of the MFA second step: signed in. Its own schema (not LoginResponse), so a change to the login
 * outcomes can never silently change the MFA contract (ADR-15; measured with oasdiff 2026-10-09).
 */
export const MfaVerified = z
  .object({ status: z.literal('authenticated'), session: Session })
  .meta({ id: 'MfaVerified' });

export type MfaVerified = z.infer<typeof MfaVerified>;

export const verifyMfa = defineEndpoint({
  id: 'verifyMfa',
  method: 'post',
  path: '/v1/auth/mfa/verify',
  audience: 'public',
  summary: 'Second login step for platform accounts (uses the MFA challenge cookie set by login)',
  request: { body: VerifyMfaRequest },
  responses: {
    200: { description: 'Signed in', schema: MfaVerified, headers: SetCookie },
    400: error('VALIDATION_ERROR'),
    401: error(
      'INVALID_MFA_CODE (try again; 5 attempts per challenge) or INVALID_OR_EXPIRED_TOKEN (sign in again)',
    ),
    429: rateLimited,
  },
});
