import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept a caller-supplied request id only if it is short and plain; otherwise generate one.
// This keeps ids useful for tracing across the proxy without allowing log injection.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
