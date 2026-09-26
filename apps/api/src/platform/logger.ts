import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from './config.js';

// Structured JSON logs with redaction (TARGET_ARCHITECTURE §28).
// Anything that could carry a credential or personal financial identifier is removed.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
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
