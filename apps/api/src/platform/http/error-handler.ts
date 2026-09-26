import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, errorBody, notFound } from '../errors.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound());
};

// Errors raised by express.json() carry a `type` and an HTTP `status`.
type BodyParserError = Error & { type?: string; status?: number };

const fromBodyParser = (err: BodyParserError): AppError | undefined => {
  if (err.type === 'entity.parse.failed')
    return new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (err.type === 'entity.too.large')
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  return undefined;
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = String(req.id);
  const known = err instanceof AppError ? err : fromBodyParser(err as BodyParserError);

  if (known) {
    if (known.status >= 500) req.log.error({ err }, known.message);
    res.status(known.status).json(errorBody(known, requestId));
    return;
  }

  // Unknown failure: log everything server-side, reveal nothing to the client.
  req.log.error({ err }, 'Unhandled error');
  res.status(500).json(errorBody({ code: 'INTERNAL_ERROR', message: 'Something went wrong' }, requestId));
};
