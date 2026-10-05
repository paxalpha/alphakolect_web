import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from './config.js';

// Structured JSON logs with redaction (TARGET_ARCHITECTURE §28).
// Anything that could carry a credential or personal financial identifier is removed.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  // The double-submit CSRF token (ADR-14 D7) — found in request logs by the P3 leak sweep.
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.recoveryCode',
  '*.recoveryCodes',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.otp',
  '*.secret',
  '*.authorization',
  '*.accountNumber',
  '*.bvn',
  '*.nin',
];

export function createLogger(config: Pick<Config, 'logLevel'>, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.logLevel,
      base: { service: 'api' },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}
