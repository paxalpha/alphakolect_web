import type {
  CustomerLoginRequest,
  CustomerLoginResponse,
  CustomerRefreshRequest,
  CustomerSelectRequest,
  CustomerTokens,
} from '@alphakolect/contracts';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../../platform/errors.js';
import type { RateLimiter } from './rate-limits.js';
import type { IdentityRepository } from './repository.js';
import { type IssuedSession, type RequestContext, type SessionService } from './sessions.js';
import { hashReceivedToken } from './tokens.js';

// Customer sign-in, selection and refresh (P7; contracts: packages/contracts/src/endpoints/customers.ts; the owner's
// answer Q7). The agent flow with the customer audience: bearer transport (D7), tokens in JSON bodies, every
// token-bearing response no-store; credentials first, then the database decides eligibility — an active customer
// record with this sign-in, of an active business; several ⇒ a selection token and the businesses, only ever after a
// successful password check (T4). Refresh rotates only customer tokens (T12).

const contextOf = (req: Request): RequestContext => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
  requestId: String(req.id),
});

const tokensOf = (issued: IssuedSession): CustomerTokens => ({
  accessToken: issued.tokens.accessToken,
  refreshToken: issued.tokens.refreshToken,
  refreshTokenExpiresAt: issued.tokens.refreshExpiresAt.toISOString(),
  session: issued.session,
});

export function customerAuthHandlers({
  identity,
  sessions,
  limiter,
}: {
  identity: IdentityRepository;
  sessions: SessionService;
  limiter: RateLimiter;
}) {
  const customerLogin: RequestHandler = async (req, res) => {
    const { email, password } = req.body as CustomerLoginRequest;
    const result = await sessions.login({ email, password, audience: 'customer' }, contextOf(req));
    let body: CustomerLoginResponse;
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
      // D8: second factors are platform-only; a customer sign-in never produces an MFA challenge.
      throw new Error('unexpected MFA challenge for a customer sign-in');
    }
    res.set('Cache-Control', 'no-store').json(body);
  };

  const customerSelectMembership: RequestHandler = async (req, res) => {
    const { selectionToken, selectionId } = req.body as CustomerSelectRequest;
    const hash = hashReceivedToken(selectionToken);
    await limiter.enforce('membership_selection', req.ip ?? 'unknown', hash);
    const issued = await sessions.selectMembership(hash, selectionId, contextOf(req), 'customer');
    const body: CustomerTokens = tokensOf(issued);
    res.set('Cache-Control', 'no-store').json(body);
  };

  const customerRefresh: RequestHandler = async (req, res) => {
    const { refreshToken } = req.body as CustomerRefreshRequest;
    const issued = await sessions.refresh(refreshToken, contextOf(req), ['customer']);
    if (issued.session.audience !== 'customer') {
      // Unreachable: the database rotates only customer tokens here (T12). Refuse rather than hand out another.
      throw new AppError(401, 'INVALID_OR_EXPIRED_TOKEN', 'Your session has ended. Please sign in again.');
    }
    const body: CustomerTokens = tokensOf(issued);
    res.set('Cache-Control', 'no-store').json(body);
  };

  return { customerLogin, customerSelectMembership, customerRefresh };
}
