import type {
  AgentLoginRequest,
  AgentLoginResponse,
  AgentRefreshRequest,
  AgentSelectRequest,
  AgentTokens,
  CurrentMembership,
} from '@alphakolect/contracts';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../../platform/errors.js';
import { tenantContextOf, type TenantContext } from '../../platform/tenant.js';
import type { RateLimiter } from './rate-limits.js';
import type { IdentityRepository } from './repository.js';
import { type IssuedSession, type RequestContext, type SessionService } from './sessions.js';
import { hashReceivedToken } from './tokens.js';

// Agent sign-in, selection, refresh and self (contracts: packages/contracts/src/endpoints/agent.ts; ADR-15 T4, T12).
//
// Bearer transport (D7): tokens travel in JSON bodies, never in cookies, and every token-bearing response is
// no-store. The session logic is the web one (SessionService) with the agent audience: credentials first, then the
// database decides eligibility; several eligible memberships ⇒ a selection token (stored hashed, 5 minutes, single
// use) and the choices — only ever after a successful password check. Refresh rotates only agent tokens.

const contextOf = (req: Request): RequestContext => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
  requestId: String(req.id),
});

const tokensOf = (issued: IssuedSession): AgentTokens => ({
  accessToken: issued.tokens.accessToken,
  refreshToken: issued.tokens.refreshToken,
  refreshTokenExpiresAt: issued.tokens.refreshExpiresAt.toISOString(),
  session: issued.session,
});

/**
 * What the agent routes need from the business side: the agent's own membership. Declared here, so that identity does
 * not depend on tenancy (TA-10); the composition root passes tenancy's settings service, which satisfies it.
 */
export type MembershipReader = { currentMembership(tenant: TenantContext): Promise<CurrentMembership> };

export function agentHandlers({
  identity,
  sessions,
  limiter,
  settings,
}: {
  identity: IdentityRepository;
  sessions: SessionService;
  limiter: RateLimiter;
  settings: MembershipReader;
}) {
  const agentLogin: RequestHandler = async (req, res) => {
    const { email, password } = req.body as AgentLoginRequest;
    const result = await sessions.login({ email, password, audience: 'agent' }, contextOf(req));
    let body: AgentLoginResponse;
    if (result.kind === 'session') {
      body = { status: 'authenticated', ...tokensOf(result.issued) };
    } else if (result.kind === 'membership_selection') {
      const choices = await identity.selectionChoices(hashReceivedToken(result.challengeToken)!);
      body = {
        status: 'membership_selection_required',
        selectionToken: result.challengeToken,
        memberships: choices.map((c) => ({
          selectionId: c.membership_id,
          merchantName: c.merchant_name ?? '',
        })),
      };
    } else {
      // D8: second factors are platform-only; an agent sign-in never produces an MFA challenge.
      throw new Error('unexpected MFA challenge for an agent sign-in');
    }
    res.set('Cache-Control', 'no-store').json(body);
  };

  const agentSelectMembership: RequestHandler = async (req, res) => {
    const { selectionToken, selectionId } = req.body as AgentSelectRequest;
    const hash = hashReceivedToken(selectionToken);
    await limiter.enforce('membership_selection', req.ip ?? 'unknown', hash);
    const issued = await sessions.selectMembership(hash, selectionId, contextOf(req), 'agent');
    const body: AgentTokens = tokensOf(issued);
    res.set('Cache-Control', 'no-store').json(body);
  };

  const agentRefresh: RequestHandler = async (req, res) => {
    const { refreshToken } = req.body as AgentRefreshRequest;
    const issued = await sessions.refresh(refreshToken, contextOf(req), ['agent']);
    if (issued.session.audience !== 'agent') {
      // Unreachable: the database rotates only agent tokens here (T12). Refuse rather than hand out a web token.
      throw new AppError(401, 'INVALID_OR_EXPIRED_TOKEN', 'Your session has ended. Please sign in again.');
    }
    const body: AgentTokens = tokensOf(issued);
    res.set('Cache-Control', 'no-store').json(body);
  };

  const getAgentMembership: RequestHandler = async (req, res) => {
    const body: CurrentMembership = await settings.currentMembership(tenantContextOf(req.auth));
    res.json(body);
  };

  return { agentLogin, agentSelectMembership, agentRefresh, getAgentMembership };
}
