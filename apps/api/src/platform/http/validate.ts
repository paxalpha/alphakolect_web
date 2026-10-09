import type { EndpointContract } from '@alphakolect/contracts';
import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { AppError } from '../errors.js';

// Request validation from the contract (TARGET_ARCHITECTURE §17): the same zod schemas that the OpenAPI document
// and the typed client are generated from decide what a handler receives. Mounted automatically by the router
// for every endpoint whose contract declares path parameters or a request body, so a handler never sees
// unvalidated input.

/** Problems are reported by field and message only — never the submitted value (it may be a password). */
export type ValidationIssue = { path: string; message: string };

const issuesOf = (error: z.ZodError, prefix: string): ValidationIssue[] =>
  error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.'),
    message: issue.message,
  }));

export function needsValidation(endpoint: EndpointContract): boolean {
  const request = endpoint.request ?? {};
  // Fail at startup, not silently at runtime, if a contract declares input this middleware does not check yet.
  for (const part of ['query', 'headers'] as const) {
    if (request[part]) throw new Error(`${endpoint.id}: request.${part} validation is not implemented yet`);
  }
  return request.body !== undefined || request.params !== undefined;
}

export function validateRequest(endpoint: EndpointContract): RequestHandler {
  const { params, body } = endpoint.request ?? {};
  if (!params && !body) throw new Error(`${endpoint.id}: nothing to validate`);
  return function validateRequestInput(req, _res, next) {
    const issues: ValidationIssue[] = [];
    if (params) {
      const result = params.safeParse(req.params);
      if (!result.success) issues.push(...issuesOf(result.error, 'params'));
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
    // Handlers receive the parsed body: unknown fields stripped, defaults applied. Path parameters are already
    // strings in req.params and have now been checked against the contract.
    if (body) req.body = parsedBody;
    next();
  };
}
