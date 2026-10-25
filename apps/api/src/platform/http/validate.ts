import type { EndpointContract } from '@alphakolect/contracts';
import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { AppError } from '../errors.js';

// Request validation from the contract (TARGET_ARCHITECTURE §17): the same zod schemas that the OpenAPI document
// and the typed client are generated from decide what a handler receives. Mounted by the router in front of every
// endpoint, so a handler never sees unvalidated path parameters, query parameters or body.
//
// Query parameters (P5.3): a contract that declares `query` gets exactly those parameters, parsed (coerced, defaults
// applied) — an unknown or invalid one is refused with 400 before the handler runs; a contract without `query` gets
// none, whatever the URL carries.
//
// Headers (P6, TA-6): a contract that declares `headers` gets exactly those headers checked (names in lower case, as
// Node gives them); other headers are the transport's and pass untouched. The handler reads a checked header with
// req.get().

/** Problems are reported by field and message only — never the submitted value (it may be a password). */
export type ValidationIssue = { path: string; message: string };

const issuesOf = (error: z.ZodError, prefix: string): ValidationIssue[] =>
  error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.'),
    message: issue.message,
  }));

const NO_QUERY: Readonly<Record<string, never>> = Object.freeze({});

export function validateRequest(endpoint: EndpointContract): RequestHandler {
  const { params, query, headers, body } = endpoint.request ?? {};
  const headerNames = headers ? Object.keys(headers.shape) : [];
  if (headerNames.some((name) => name !== name.toLowerCase())) {
    throw new Error(`${endpoint.id}: request header names must be lower case`);
  }
  const declared: ReadonlySet<string> = new Set(query ? Object.keys(query.shape) : []);

  return function validateRequestInput(req, _res, next) {
    const issues: ValidationIssue[] = [];
    if (params) {
      const result = params.safeParse(req.params);
      if (!result.success) issues.push(...issuesOf(result.error, 'params'));
    }
    if (headers) {
      const presented = Object.fromEntries(headerNames.map((name) => [name, req.headers[name]]));
      const result = headers.safeParse(presented);
      if (!result.success) issues.push(...issuesOf(result.error, 'headers'));
    }
    let parsedQuery: Readonly<Record<string, unknown>> = NO_QUERY;
    if (query) {
      const presented = req.query as Record<string, unknown>;
      for (const name of Object.keys(presented)) {
        if (!declared.has(name)) issues.push({ path: `query.${name}`, message: 'Unknown query parameter' });
      }
      const result = query.safeParse(presented);
      if (result.success) parsedQuery = Object.freeze(result.data as Record<string, unknown>);
      else issues.push(...issuesOf(result.error, 'query'));
    }
    let parsedBody: unknown;
    if (body) {
      const result = body.safeParse(req.body);
      if (result.success) parsedBody = result.data;
      else issues.push(...issuesOf(result.error, ''));
    }
    if (issues.length > 0) {
      next(new AppError(400, 'VALIDATION_ERROR', 'The request is not valid', { issues }));
      return;
    }
    // Express 5 defines req.query as a getter; an own property replaces it for this request. Handlers see only the
    // contract's parameters, parsed — or none.
    Object.defineProperty(req, 'query', { value: parsedQuery, enumerable: true, configurable: true });
    // Handlers receive the parsed body: unknown fields stripped, defaults applied. Path parameters are already
    // strings in req.params and have now been checked against the contract.
    if (body) req.body = parsedBody;
    next();
  };
}
