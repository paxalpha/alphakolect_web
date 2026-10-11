import { z } from 'zod';
import { ErrorResponse, Id } from '../primitives.js';
import { defineEndpoint } from '../registry.js';
import { Email, Session } from './auth.js';
import { CurrentMembership } from './merchant.js';

// Agents — the mobile audience (TARGET_ARCHITECTURE ADR-14 D5, D7; ADR-15 T4, T12; P4.7).
//
// Bearer tokens, carried in request and response BODIES on dedicated endpoints: the web login and refresh contracts
// (cookies) are unchanged and never serve agents. Lifetimes (D5): access token 15 minutes; refresh 30 days idle,
// 90 days absolute, rotated on every use with reuse detection, audience-checked in the database (an agent endpoint
// never rotates a web token, nor the reverse). Every request re-validates the session, the agent membership and the
// business (T5): a deactivated agent is out from the next request. No MFA for agents in P4 (D8 is platform-only).
// Token-bearing responses are sent Cache-Control: no-store.

const error = (description: string) => ({ description, schema: ErrorResponse });
const rateLimited = {
  ...error('RATE_LIMITED'),
  headers: z.object({ 'retry-after': z.string().meta({ description: 'Seconds to wait' }) }),
};
const NoStore = z.object({
  'Cache-Control': z.literal('no-store').meta({ description: 'Tokens are never cached' }),
});

export const AgentLoginRequest = z
  .object({ email: Email, password: z.string().min(1).max(1024) })
  .meta({ id: 'AgentLoginRequest' });

export type AgentLoginRequest = z.infer<typeof AgentLoginRequest>;

export const AgentTokens = z
  .object({
    /** Bearer token for the Authorization header; 15 minutes. */
    accessToken: z.string(),
    /** For POST /v1/auth/agent/refresh only; rotated on every use. Store it in the device's secure storage. */
    refreshToken: z.string(),
    refreshTokenExpiresAt: z.iso.datetime(),
    session: Session,
  })
  .meta({ id: 'AgentTokens', description: 'A signed-in agent session' });

export type AgentTokens = z.infer<typeof AgentTokens>;

export const AgentMembershipChoice = z
  .object({
    /** Opaque: send it back to POST /v1/auth/agent/login/select. Never authorization by itself. */
    selectionId: Id,
    merchantName: z.string(),
  })
  .meta({ id: 'AgentMembershipChoice' });

export const AgentLoginResponse = z
  .discriminatedUnion('status', [
    AgentTokens.extend({ status: z.literal('authenticated') }),
    // Agent of several businesses (ADR-15 T4): no session yet — choose one, within 5 minutes, once.
    z.object({
      status: z.literal('membership_selection_required'),
      selectionToken: z.string(),
      memberships: z.array(AgentMembershipChoice).min(2),
    }),
  ])
  .meta({ id: 'AgentLoginResponse' });

export type AgentLoginResponse = z.infer<typeof AgentLoginResponse>;

export const AgentSelectRequest = z
  .object({ selectionToken: z.string().min(1).max(256), selectionId: Id })
  .meta({ id: 'AgentSelectRequest' });

export type AgentSelectRequest = z.infer<typeof AgentSelectRequest>;

export const AgentRefreshRequest = z
  .object({ refreshToken: z.string().min(1).max(256) })
  .meta({ id: 'AgentRefreshRequest' });

export type AgentRefreshRequest = z.infer<typeof AgentRefreshRequest>;

export const agentLogin = defineEndpoint({
  id: 'agentLogin',
  method: 'post',
  path: '/v1/auth/agent/login',
  audience: 'public',
  summary: 'Agent sign-in (mobile): tokens in the body, or the businesses to choose from',
  request: { body: AgentLoginRequest },
  responses: {
    200: { description: 'Signed in, or a choice is needed', schema: AgentLoginResponse, headers: NoStore },
    400: error('VALIDATION_ERROR'),
    401: error('INVALID_CREDENTIALS — identical for every reason, including "not an agent"'),
    403: error('EMAIL_VERIFICATION_REQUIRED — only after correct credentials'),
    429: rateLimited,
  },
});

export const agentSelectMembership = defineEndpoint({
  id: 'agentSelectMembership',
  method: 'post',
  path: '/v1/auth/agent/login/select',
  audience: 'public',
  summary: 'Finish agent sign-in by choosing a business (the selection token is used up either way)',
  request: { body: AgentSelectRequest },
  responses: {
    200: { description: 'Signed in', schema: AgentTokens, headers: NoStore },
    400: error('VALIDATION_ERROR'),
    401: error('INVALID_OR_EXPIRED_TOKEN — the same for every reason'),
    429: rateLimited,
  },
});

export const agentRefresh = defineEndpoint({
  id: 'agentRefresh',
  method: 'post',
  path: '/v1/auth/agent/refresh',
  audience: 'public',
  summary:
    'Rotate an agent refresh token: new tokens; the old refresh token is spent (reuse ends the session)',
  request: { body: AgentRefreshRequest },
  responses: {
    200: { description: 'New tokens', schema: AgentTokens, headers: NoStore },
    400: error('VALIDATION_ERROR'),
    401: error('INVALID_OR_EXPIRED_TOKEN — the same for every reason (also for a web refresh token)'),
    429: rateLimited,
  },
});

export const getAgentMembership = defineEndpoint({
  id: 'getAgentMembership',
  method: 'get',
  path: '/v1/agent/membership',
  audience: 'agent',
  summary: 'The signed-in agent’s membership and business, as of this request',
  security: ['bearer'],
  responses: { 200: { description: 'The current membership', schema: CurrentMembership } },
});
