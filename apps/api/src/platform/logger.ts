import { pino, stdSerializers, type DestinationStream, type Logger } from 'pino';
import type { Config } from './config.js';

// Structured JSON logs (TARGET_ARCHITECTURE §28). From P5.8 (P5 plan §8.6, R49, R50) a request is logged by an
// **allowlist**: its id and method, the contract route it matched, and its status code — no path as sent, no header,
// no query string and no remote address, so no IP address or user agent (D9: the AlphaKolect team cannot see them; the
// activity record keeps them under the D9 rules). A database error is logged as its structural fields only. The
// redaction list stays, as defence in depth for credentials.
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

/**
 * The request line: the id and the method — never the path as sent (a caller can put anything in it, an address or a
 * user agent included: the P5.8 hold-point review), the query string, a header or the remote address.
 */
const requestLine = (req: { id?: unknown; method?: unknown }) => ({ id: req.id, method: req.method });

/** The contract path each request matched, recorded by the v1 router; an unmatched request has none. */
const matchedRoutes = new WeakMap<object, string>();

/** Records the contract path a request matched ('/v1/merchant/branches/{branchId}'), for its completion line. */
export function recordRoute(req: object, contractPath: string): void {
  matchedRoutes.set(req, contractPath);
}

/**
 * The completion line's route (pino-http customProps): the contract path the request matched, its parameters
 * unfilled — none for a request that matched no route.
 */
export function routeProps(req: object): { route?: string } {
  const route = matchedRoutes.get(req);
  return route === undefined ? {} : { route };
}

/** The response line: the status code — never a header. */
const responseLine = (res: { statusCode?: unknown }) => ({ statusCode: res.statusCode });

/** The structural fields of a PostgreSQL error: none can hold a value of a row or of the input. */
const DATABASE_ERROR_FIELDS = [
  'code',
  'severity',
  'constraint',
  'schema',
  'table',
  'column',
  'routine',
] as const;

/**
 * An error, for a log line. A database error — a SQLSTATE code and a severity — is logged as its structural fields
 * only, under a fixed message: its message, detail, where, hint and stack can print a row's values or the input (a
 * failed session insert's "Failing row contains (…)" holds its IP address and user agent). Any other error keeps its
 * type, message and stack: the IP address and user agent reach code only as request context passed to SQL.
 */
export function logError(err: unknown): unknown {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) && typeof e.severity === 'string') {
      const out: Record<string, unknown> = { type: 'DatabaseError', message: `database error ${e.code}` };
      for (const field of DATABASE_ERROR_FIELDS) if (typeof e[field] === 'string') out[field] = e[field];
      return out;
    }
  }
  return stdSerializers.err(err as Error);
}

/** The request logger's serializers (pino-http): the allowlist above. */
export const HTTP_LOG_SERIALIZERS = { req: requestLine, res: responseLine, err: logError };

export function createLogger(config: Pick<Config, 'logLevel'>, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.logLevel,
      base: { service: 'api' },
      serializers: { err: logError },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}
