import type {
  MerchantAuditEventList,
  MerchantAuditEventsQuery,
  PlatformAuditEventList,
  PlatformAuditEventsQuery,
} from '@alphakolect/contracts';
import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../platform/request-context.js';
import type { AuditReadService } from './reads.js';

// GET /v1/merchant/audit-events (#33) and GET /v1/platform/audit-events (#34) (contracts:
// packages/contracts/src/endpoints/audit.ts). The query is already validated against the contract (limit coerced, its
// default applied); the session is authenticated and the policy middleware has checked merchant.audit.read or
// platform.audit.read. Each page is a sensitive read the database records (P5.8).

const contextOf = (req: Request): RequestContext => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
  requestId: String(req.id),
});

export function auditReadHandlers({ reads }: { reads: AuditReadService }) {
  const listMerchantAuditEvents: RequestHandler = async (req, res) => {
    const body: MerchantAuditEventList = await reads.merchant(
      req.auth!,
      req.query as unknown as MerchantAuditEventsQuery,
      contextOf(req),
    );
    res.json(body);
  };

  const listPlatformAuditEvents: RequestHandler = async (req, res) => {
    const body: PlatformAuditEventList = await reads.platform(
      req.auth!,
      req.query as unknown as PlatformAuditEventsQuery,
      contextOf(req),
    );
    res.json(body);
  };

  return { listMerchantAuditEvents, listPlatformAuditEvents };
}
