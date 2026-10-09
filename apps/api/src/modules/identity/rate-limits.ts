import { createHash } from 'node:crypto';
import { AppError } from '../../platform/errors.js';
import type { IdentityRepository } from './repository.js';

// Rate limits on authentication (TARGET_ARCHITECTURE §3.2, ADR-14 D13): per IP and per identifier, backed by
// the Postgres fixed-window counter (util.rate_limit_hit). Keys are hashed before they reach the database.

export type LimitName =
  | 'login'
  | 'signup'
  | 'verification_resend'
  | 'email_verify'
  | 'password_forgot'
  | 'password_reset'
  | 'password_change'
  | 'refresh'
  | 'mfa'
  | 'membership_selection';

type Rule = { windowSeconds: number; perIp: number; perIdentifier: number };

/** Limits per window. Generous for people, tight for scripts. */
export const LIMITS: Readonly<Record<LimitName, Rule>> = {
  login: { windowSeconds: 900, perIp: 30, perIdentifier: 10 },
  signup: { windowSeconds: 3600, perIp: 10, perIdentifier: 3 },
  verification_resend: { windowSeconds: 3600, perIp: 10, perIdentifier: 3 }, // D12: 3 resends per hour
  email_verify: { windowSeconds: 900, perIp: 30, perIdentifier: 30 },
  password_forgot: { windowSeconds: 3600, perIp: 10, perIdentifier: 3 },
  password_reset: { windowSeconds: 900, perIp: 20, perIdentifier: 20 },
  password_change: { windowSeconds: 900, perIp: 20, perIdentifier: 10 },
  refresh: { windowSeconds: 900, perIp: 120, perIdentifier: 120 },
  mfa: { windowSeconds: 900, perIp: 30, perIdentifier: 10 },
  // Reading the choices and selecting (ADR-15 T4); the identifier is the challenge.
  membership_selection: { windowSeconds: 900, perIp: 60, perIdentifier: 10 },
};

const key = (name: LimitName, kind: 'ip' | 'id', value: string) =>
  createHash('sha256').update(`${name}:${kind}:${value.toLowerCase()}`, 'utf8').digest('hex');

export class RateLimiter {
  constructor(private readonly identity: IdentityRepository) {}

  /**
   * Count one attempt against the IP and (if known) the identifier. Throws 429 RATE_LIMITED, with the wait in
   * `details.retryAfterSeconds` (also sent as Retry-After), when either is over its limit.
   */
  async enforce(name: LimitName, ip: string, identifier?: string | null): Promise<void> {
    const rule = LIMITS[name];
    const checks = [this.identity.rateLimitHit(key(name, 'ip', ip), rule.windowSeconds, rule.perIp)];
    if (identifier) {
      checks.push(
        this.identity.rateLimitHit(key(name, 'id', identifier), rule.windowSeconds, rule.perIdentifier),
      );
    }
    const results = await Promise.all(checks);
    const refused = results.filter((r) => !r.allowed);
    if (refused.length > 0) {
      const retryAfterSeconds = Math.max(...refused.map((r) => r.retry_after_seconds));
      throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.', {
        retryAfterSeconds,
      });
    }
  }
}
