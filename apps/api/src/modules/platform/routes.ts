import type {
  CreatePlatformStaffRequest,
  PageQuery,
  PlatformMemberList,
  PlatformMerchantList,
  PlatformStaffList,
  PlatformStaffMember,
  SetPlatformStaffPermissionsRequest,
} from '@alphakolect/contracts';
import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../platform/request-context.js';
import type { PlatformMerchantListService } from './merchant-lists.js';
import type { PlatformStaffService } from './staff.js';

// /v1/platform/staff… (contracts: packages/contracts/src/endpoints/platform-team.ts). Path and query parameters and
// bodies are already validated against the contract; the platform session is already authenticated (cookie, CSRF,
// full scope) and the policy middleware has checked platform.staff.manage. The database decides again (P5.7).

const contextOf = (req: Request): RequestContext => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
  requestId: String(req.id),
});

export function platformStaffHandlers({ staff }: { staff: PlatformStaffService }) {
  const listPlatformStaff: RequestHandler = async (req, res) => {
    // The validator replaced req.query with the contract's parsed values (limit coerced, its default applied).
    const body: PlatformStaffList = await staff.list(req.auth!, req.query as unknown as PageQuery);
    res.json(body);
  };

  const createPlatformStaff: RequestHandler = async (req, res) => {
    const body: PlatformStaffMember = await staff.create(
      req.auth!,
      req.body as CreatePlatformStaffRequest,
      contextOf(req),
    );
    res.status(201).json(body);
  };

  const deactivatePlatformStaff: RequestHandler = async (req, res) => {
    const body: PlatformStaffMember = await staff.setStatus(
      req.auth!,
      String(req.params.platformMembershipId),
      'deactivate',
      contextOf(req),
    );
    res.json(body);
  };

  const reactivatePlatformStaff: RequestHandler = async (req, res) => {
    const body: PlatformStaffMember = await staff.setStatus(
      req.auth!,
      String(req.params.platformMembershipId),
      'reactivate',
      contextOf(req),
    );
    res.json(body);
  };

  const setPlatformStaffPermissions: RequestHandler = async (req, res) => {
    const { permissions } = req.body as SetPlatformStaffPermissionsRequest;
    const body: PlatformStaffMember = await staff.setPermissions(
      req.auth!,
      String(req.params.platformMembershipId),
      permissions,
      contextOf(req),
    );
    res.json(body);
  };

  return {
    listPlatformStaff,
    createPlatformStaff,
    deactivatePlatformStaff,
    reactivatePlatformStaff,
    setPlatformStaffPermissions,
  };
}

// GET /v1/platform/merchants and …/{merchantId}/members — the policy middleware has checked platform.merchants.read;
// each page is a sensitive read the database records (P5.7).
export function platformMerchantListHandlers({ lists }: { lists: PlatformMerchantListService }) {
  const listPlatformMerchants: RequestHandler = async (req, res) => {
    // The validator replaced req.query with the contract's parsed values (limit coerced, its default applied).
    const body: PlatformMerchantList = await lists.merchants(
      req.auth!,
      req.query as unknown as PageQuery,
      contextOf(req),
    );
    res.json(body);
  };

  const listPlatformMerchantMembers: RequestHandler = async (req, res) => {
    const body: PlatformMemberList = await lists.members(
      req.auth!,
      String(req.params.merchantId),
      req.query as unknown as PageQuery,
      contextOf(req),
    );
    res.json(body);
  };

  return { listPlatformMerchants, listPlatformMerchantMembers };
}
