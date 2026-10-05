import type { EndpointContract } from '@alphakolect/contracts';
import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { AppError } from '../errors.js';

// Request validation from the contract (TARGET_ARCHITECTURE §17): the same zod schema that the OpenAPI document
// and the typed client are generated from decides what a handler receives. Mounted automatically by the router
// for every endpoint whose contract declares a request body, so a handler never sees an unvalidated body.

/** Problems are reported by field and message only — never the submitted value (it may be a password). */
export type ValidationIssue = { path: string; message: string };

const issuesOf = (error: z.ZodError): ValidationIssue[] =>
  error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));

export function needsValidation(endpoint: EndpointContract): boolean {
  const request = endpoint.request ?? {};
  // Fail at startup, not silently at runtime, if a contract declares input this middleware does not check yet.
  for (const part of ['params', 'query', 'headers'] as const) {
    if (request[part]) throw new Error(`${endpoint.id}: request.${part} validation is not implemented yet`);
  }
  return request.body !== undefined;
}

export function validateRequest(endpoint: EndpointContract): RequestHandler {
  const schema = endpoint.request?.body;
  if (!schema) throw new Error(`${endpoint.id}: no request body schema`);
  return function validateRequestBody(req, _res, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        new AppError(400, 'VALIDATION_ERROR', 'The request is not valid', { issues: issuesOf(result.error) }),
      );
      return;
    }
    // Handlers receive the parsed value: unknown fields stripped, defaults applied.
    req.body = result.data;
    next();
  };
}
