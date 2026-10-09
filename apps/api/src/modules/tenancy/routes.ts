import type { DeactivateMerchantRequest, MerchantLifecycle } from '@alphakolect/contracts';
import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../identity/sessions.js';
import type { MerchantLifecycleService } from './merchant-lifecycle.js';

// /v1/platform/merchants/{merchantId}/… (contracts: packages/contracts/src/endpoints/platform.ts). Path parameters
// and bodies are already validated against the contract; the platform session is already authenticated (cookie,
// CSRF, full scope). Super-admin authority is checked in the database (ADR-15 T9).

const contextOf = (req: Request): RequestContext => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
  requestId: String(req.id),
});

export function platformMerchantHandlers({ lifecycle }: { lifecycle: MerchantLifecycleService }) {
  const deactivateMerchant: RequestHandler = async (req, res) => {
    const { reason } = req.body as DeactivateMerchantRequest;
    const body: MerchantLifecycle = await lifecycle.change(
      req.auth!,
      String(req.params.merchantId),
      'deactivate',
      reason,
      contextOf(req),
    );
    res.json(body);
  };

  const reactivateMerchant: RequestHandler = async (req, res) => {
    const body: MerchantLifecycle = await lifecycle.change(
      req.auth!,
      String(req.params.merchantId),
      'reactivate',
      null,
      contextOf(req),
    );
    res.json(body);
  };

  return { deactivateMerchant, reactivateMerchant };
}
