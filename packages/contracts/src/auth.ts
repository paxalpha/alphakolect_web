// Authentication constants shared by the API and its clients (ADR-14). Names and codes only — no behaviour.

/**
 * Cookie names for the web audiences (D7). The `__Secure-` prefix makes browsers refuse them unless they
 * are set with `Secure` over HTTPS (localhost counts as secure in modern browsers).
 */
export const AUTH_COOKIES = {
  /** Short-lived access token (HttpOnly). */
  access: '__Secure-ak_at',
  /** Refresh token (HttpOnly, sent only to the refresh endpoint). */
  refresh: '__Secure-ak_rt',
  /** CSRF token (readable by the page, echoed in the CSRF header — double-submit). */
  csrf: '__Secure-ak_csrf',
} as const;

/** Header that must echo the CSRF cookie on state-changing cookie-authenticated requests (D7). */
export const CSRF_HEADER = 'X-CSRF-Token';

/**
 * Stable error codes for authentication (TARGET_ARCHITECTURE §17 envelope `error.code`).
 * Messages are generic; codes never reveal whether an account exists (D12).
 */
export const AUTH_ERROR_CODES = [
  'UNAUTHENTICATED', // no or invalid session/token
  'INVALID_CREDENTIALS', // wrong identifier or password — identical for unknown and known accounts
  'EMAIL_VERIFICATION_REQUIRED', // only after correct credentials on an unverified account (D12)
  'MFA_REQUIRED', // platform login needs a TOTP step (D8)
  'MFA_ENROLLMENT_REQUIRED', // platform identity has not enrolled TOTP yet (D8)
  'INVALID_MFA_CODE',
  'MFA_ALREADY_ENROLLED', // TOTP is already confirmed for this identity
  'INVALID_OR_EXPIRED_TOKEN', // verification / reset / refresh token unusable — same for every reason
  'WEAK_PASSWORD', // fails the password policy (D10)
  'CSRF_FAILED',
  'WRONG_AUDIENCE', // session of one audience used on another audience's endpoint
  'RATE_LIMITED',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];
