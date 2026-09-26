// Minimal in-memory fixed-window rate limiter (no external dependency).
//
// Limits are per process: they reset on restart and are not shared between PM2 instances.
// That is acceptable for the single-instance legacy backend; the rebuilt API uses a shared store.

const { getClientIp } = require('../utils/clientIp');

const buckets = new Map(); // key -> { count, resetAt }

// Drop expired windows periodically so the map cannot grow without bound.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60 * 1000);
if (sweeper.unref) sweeper.unref();

// Returns true if the request identified by `key` is still within `max` per `windowMs`.
const hit = (key, max, windowMs) => {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return { allowed: bucket.count <= max, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

/**
 * Build a limiter middleware.
 * @param {Object} opts
 * @param {string} opts.name        - namespace for keys (e.g. 'superadmin-login')
 * @param {number} opts.windowMs    - window length
 * @param {number} opts.maxPerIp    - max requests per client IP per window
 * @param {number} [opts.maxPerEmail] - max requests per req.body.email per window (skipped if absent)
 */
const rateLimit = ({ name, windowMs, maxPerIp, maxPerEmail }) => (req, res, next) => {
  const checks = [hit(`${name}:ip:${getClientIp(req)}`, maxPerIp, windowMs)];

  const email = normalizeEmail(req.body && req.body.email);
  if (maxPerEmail && email) {
    checks.push(hit(`${name}:email:${email}`, maxPerEmail, windowMs));
  }

  const blocked = checks.find((c) => !c.allowed);
  if (blocked) {
    res.set('Retry-After', String(blocked.retryAfterSec));
    return res.status(429).json({ message: 'Too many requests. Please try again later.' });
  }
  next();
};

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const superAdminLoginLimiter = rateLimit({
  name: 'superadmin-login', windowMs: FIFTEEN_MINUTES, maxPerIp: 20, maxPerEmail: 10
});
const superAdminForgotPasswordLimiter = rateLimit({
  name: 'superadmin-forgot', windowMs: ONE_HOUR, maxPerIp: 10, maxPerEmail: 3
});
// Reset requests carry a 256-bit token, not an email, so only the per-IP limit applies.
const superAdminResetPasswordLimiter = rateLimit({
  name: 'superadmin-reset', windowMs: FIFTEEN_MINUTES, maxPerIp: 10
});

module.exports = {
  rateLimit,
  normalizeEmail,
  superAdminLoginLimiter,
  superAdminForgotPasswordLimiter,
  superAdminResetPasswordLimiter,
};
