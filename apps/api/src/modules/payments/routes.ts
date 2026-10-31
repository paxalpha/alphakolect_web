import type {
  ClassifyReceiptRequest,
  FindingListQuery,
  PageQuery,
  ResolveFindingRequest,
  ResolveUnmatchedRequest,
  WalletReceiptQuery,
} from '@alphakolect/contracts';
import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../platform/request-context.js';
import { tenantContextOf } from '../../platform/tenant.js';
import type { PaymentsService } from './service.js';

// /v1/merchant/wallet…, /v1/platform/payments…, /v1/platform/wallet and /v1/webhooks/transactpay (contracts:
// packages/contracts/src/endpoints/payments.ts). A session is already authenticated and its permission checked by the
// policy middleware; bodies and queries are already validated. The database decides again (B1).

const contextOf = (req: Request): RequestContext => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
  requestId: String(req.id),
});

export function paymentHandlers({ payments: service }: { payments: PaymentsService }) {
  const tenant = (req: Request) => tenantContextOf(req.auth);

  const getMerchantWallet: RequestHandler = async (req, res) => {
    res.json(await service.wallet(tenant(req)));
  };

  const listWalletReceipts: RequestHandler = async (req, res) => {
    res.json(await service.receipts(tenant(req), req.query as unknown as WalletReceiptQuery));
  };

  const classifyWalletReceipt: RequestHandler = async (req, res) => {
    res.json(
      await service.classify(
        tenant(req),
        String(req.params.receiptId),
        req.body as ClassifyReceiptRequest,
        contextOf(req),
      ),
    );
  };

  const listPlatformWallets: RequestHandler = async (req, res) => {
    res.json(await service.platformWallets(req.auth!, req.query as unknown as PageQuery, contextOf(req)));
  };

  const listPlatformUnmatched: RequestHandler = async (req, res) => {
    res.json(await service.platformUnmatched(req.auth!, req.query as unknown as PageQuery, contextOf(req)));
  };

  const listPlatformFindings: RequestHandler = async (req, res) => {
    res.json(
      await service.platformFindings(req.auth!, req.query as unknown as FindingListQuery, contextOf(req)),
    );
  };

  const resolveUnmatchedTransaction: RequestHandler = async (req, res) => {
    res.json(
      await service.resolveUnmatched(
        req.auth!,
        String(req.params.transactionId),
        req.body as ResolveUnmatchedRequest,
        contextOf(req),
      ),
    );
  };

  const resolveReconciliationFinding: RequestHandler = async (req, res) => {
    const { note } = req.body as ResolveFindingRequest;
    res.json(await service.resolveFinding(req.auth!, String(req.params.findingId), note, contextOf(req)));
  };

  const createPlatformWallet: RequestHandler = async (req, res) => {
    res.status(201).json(await service.requestPlatformWallet(req.auth!, contextOf(req)));
  };

  const receiveTransactPayEvent: RequestHandler = async (req, res) => {
    const { rawBody } = req as Request & { rawBody?: string };
    await service.receiveEvent(req.body, rawBody ?? JSON.stringify(req.body), req.headers, contextOf(req));
    res.json({ received: true });
  };

  return {
    getMerchantWallet,
    listWalletReceipts,
    classifyWalletReceipt,
    listPlatformWallets,
    listPlatformUnmatched,
    listPlatformFindings,
    resolveUnmatchedTransaction,
    resolveReconciliationFinding,
    createPlatformWallet,
    receiveTransactPayEvent,
  };
}
