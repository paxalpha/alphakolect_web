import { AUTH_COOKIES } from '@alphakolect/contracts';
import type { CookieOptions, Response } from 'express';

// Session cookies for the web audiences (ADR-14 D7): __Secure- prefix, HttpOnly (except the CSRF cookie the
// page must echo), Secure, SameSite=Lax, Domain only when configured (production: .alphakolect.com).

/** The MFA login challenge travels as a short-lived HttpOnly cookie, never in a response body. */
export const MFA_CHALLENGE_COOKIE = '__Secure-ak_mfa';
export const REFRESH_PATH = '/v1/auth/refresh';
export const MFA_PATH = '/v1/auth/mfa';

export type CookieSettings = { domain?: string | undefined };

function base(settings: CookieSettings, maxAgeSeconds: number, path = '/'): CookieOptions {
  return {
    secure: true,
    sameSite: 'lax',
    path,
    maxAge: maxAgeSeconds * 1000,
    ...(settings.domain ? { domain: settings.domain } : {}),
  };
}

export function setSessionCookies(
  res: Response,
  settings: CookieSettings,
  values: {
    accessToken: string;
    accessMaxAgeSeconds: number;
    refreshToken: string;
    refreshMaxAgeSeconds: number;
    csrfToken: string;
    csrfMaxAgeSeconds: number;
  },
): void {
  res.cookie(AUTH_COOKIES.access, values.accessToken, {
    ...base(settings, values.accessMaxAgeSeconds),
    httpOnly: true,
  });
  res.cookie(AUTH_COOKIES.refresh, values.refreshToken, {
    ...base(settings, values.refreshMaxAgeSeconds, REFRESH_PATH),
    httpOnly: true,
  });
  // Readable by the page so it can echo it in the CSRF header (double-submit).
  res.cookie(AUTH_COOKIES.csrf, values.csrfToken, {
    ...base(settings, values.csrfMaxAgeSeconds),
    httpOnly: false,
  });
}

export function clearSessionCookies(res: Response, settings: CookieSettings): void {
  const clear = (name: string, path = '/') =>
    res.clearCookie(name, {
      secure: true,
      sameSite: 'lax',
      path,
      ...(settings.domain ? { domain: settings.domain } : {}),
    });
  clear(AUTH_COOKIES.access);
  clear(AUTH_COOKIES.refresh, REFRESH_PATH);
  clear(AUTH_COOKIES.csrf);
}

export function setMfaChallengeCookie(res: Response, settings: CookieSettings, token: string): void {
  res.cookie(MFA_CHALLENGE_COOKIE, token, { ...base(settings, 300, MFA_PATH), httpOnly: true });
}

export function clearMfaChallengeCookie(res: Response, settings: CookieSettings): void {
  res.clearCookie(MFA_CHALLENGE_COOKIE, {
    secure: true,
    sameSite: 'lax',
    path: MFA_PATH,
    ...(settings.domain ? { domain: settings.domain } : {}),
  });
}
