import type { z } from 'zod';
import type { Permission } from './permissions.js';

// The endpoint registry: every API endpoint is described here exactly once (TARGET_ARCHITECTURE §17).
// The OpenAPI document is generated from it, and apps/api mounts its routes from it; a parity test in
// apps/api fails if an Express route has no contract or a contract has no route.

/**
 * Who an endpoint is for (§3.1, §17). `public` = no session (e.g. health); `authenticated` = any signed-in
 * audience (e.g. logout, current session). Secured endpoints reject sessions of other audiences.
 */
export type Audience =
  'public' | 'authenticated' | 'platform' | 'merchant' | 'agent' | 'customer' | 'webhook';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * How a caller authenticates (ADR-14 D7): `cookieSession` for the web audiences (platform, merchant) —
 * state-changing requests must also send the CSRF header — and `bearer` for the mobile audiences
 * (agent, customer). An endpoint lists the schemes it accepts; omitting `security` means no authentication.
 */
export type SecurityScheme = 'cookieSession' | 'bearer';

export type ResponseContract = {
  description: string;
  /** Omitted for responses without a body (e.g. 204). */
  schema?: z.ZodType;
  /** Response headers, e.g. Set-Cookie or Retry-After. */
  headers?: z.ZodObject;
};

export type ResponseStatus = 200 | 201 | 202 | 204 | 400 | 401 | 403 | 404 | 409 | 422 | 423 | 429;

/** The narrow credential of a `capability` endpoint — something other than a session (P5 plan §5). */
export const CAPABILITIES = [
  'credentials',
  'refresh_token',
  'mfa_challenge',
  'selection_challenge',
  'email_verification_token',
  'password_reset_token',
  'account_setup_token',
  'invitation_token',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Whether a staff member's branch restriction narrows a `permission` endpoint (P5 plan §7.6). `merchant_wide`: it does
 * not — every platform endpoint and every P5 merchant endpoint (business-level administration). `branch` is reserved
 * for branch-owned resources (P7/P8); the API refuses to start on a `branch` endpoint without a resolver for the
 * resource's branch.
 */
export const BRANCH_SCOPES = ['merchant_wide', 'branch'] as const;
export type BranchScope = (typeof BRANCH_SCOPES)[number];

/**
 * How an endpoint is authorized (P5 plan §5; TARGET_ARCHITECTURE ADR-16 §3.5). Exactly one class per endpoint, declared
 * here and nowhere else; the API refuses to start on a missing or invalid declaration, so nothing is public by omission.
 *   public      no credential (health, sign-up, resend, forgot)
 *   capability  a named credential other than a session (credentials, a token, a challenge)
 *   self        a session acting only on its own identity or membership
 *   permission  a catalog permission; reserved permissions and owner protection are enforced by the database
 */
export type Authorization =
  | { class: 'public' }
  | { class: 'capability'; capability: Capability }
  | { class: 'self' }
  | { class: 'permission'; permission: Permission; branchScope: BranchScope };

export type EndpointContract = {
  /** Stable operation id, used by clients and in the OpenAPI document. */
  id: string;
  method: HttpMethod;
  /** OpenAPI path template, always under /v1, e.g. /v1/merchant/branches/{branchId}. */
  path: `/v1/${string}`;
  audience: Audience;
  /** P5.3: how the endpoint is authorized (required; published as the OpenAPI extension `x-authorization`). */
  authorization: Authorization;
  summary: string;
  /** Accepted authentication schemes (any one suffices). Omitted = no authentication required. */
  security?: readonly SecurityScheme[];
  /**
   * Secured endpoints accept only full sessions by default. 'mfa_enrollment' also admits the short-lived
   * enrolment-only platform session (ADR-14 D8) — used solely by the TOTP enrolment endpoints.
   */
  sessionScope?: 'mfa_enrollment';
  request?: {
    params?: z.ZodObject;
    query?: z.ZodObject;
    headers?: z.ZodObject;
    body?: z.ZodType;
  };
  /** Success and endpoint-specific error responses. Every endpoint also gets the standard error envelope. */
  responses: Partial<Record<ResponseStatus, ResponseContract>>;
};

/** Identity helper that keeps literal types (paths, methods) for typed consumers. */
export const defineEndpoint = <const T extends EndpointContract>(endpoint: T): T => endpoint;
