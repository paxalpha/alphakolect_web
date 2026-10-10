import type {
  AssignMemberRequest,
  Branch,
  BranchList,
  CreateCatalogItemRequest,
  CurrentMembership,
  DeactivateMerchantRequest,
  Member,
  MemberList,
  MerchantLifecycle,
  MerchantProfile,
  OwnershipTransferred,
  Role,
  RoleList,
  TransferOwnershipRequest,
  UpdateCatalogItemRequest,
  UpdateMerchantProfileRequest,
} from '@alphakolect/contracts';
import type { Request, RequestHandler } from 'express';
import { tenantContextOf } from '../../platform/tenant.js';
import type { RequestContext } from '../identity/sessions.js';
import type { MerchantLifecycleService } from './merchant-lifecycle.js';
import { toBranch, toRole, type MerchantSettingsService } from './merchant-settings.js';
import { toMember, type MembershipService } from './memberships.js';

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

  const transferOwnership: RequestHandler = async (req, res) => {
    const body: OwnershipTransferred = await lifecycle.transferOwnership(
      req.auth!,
      String(req.params.merchantId),
      req.body as TransferOwnershipRequest,
      contextOf(req),
    );
    res.json(body);
  };

  return { deactivateMerchant, reactivateMerchant, transferOwnership };
}

// /v1/merchant/… (contracts: packages/contracts/src/endpoints/merchant.ts). The merchant session is already
// authenticated and re-validated; its TenantContext is the only tenant these handlers know (§4).
export function merchantHandlers({
  settings,
  members,
}: {
  settings: MerchantSettingsService;
  members: MembershipService;
}) {
  const tenant = (req: Request) => tenantContextOf(req.auth);
  const branchId = (req: Request) => String(req.params.branchId);
  const roleId = (req: Request) => String(req.params.roleId);
  const membershipId = (req: Request) => String(req.params.membershipId);

  const getCurrentMembership: RequestHandler = async (req, res) => {
    const body: CurrentMembership = await settings.currentMembership(tenant(req));
    res.json(body);
  };

  const getMerchantProfile: RequestHandler = async (req, res) => {
    const body: MerchantProfile = await settings.profile(tenant(req));
    res.json(body);
  };

  const updateMerchantProfile: RequestHandler = async (req, res) => {
    const { name } = req.body as UpdateMerchantProfileRequest;
    const body: MerchantProfile = await settings.rename(tenant(req), name, contextOf(req));
    res.json(body);
  };

  const listBranches: RequestHandler = async (req, res) => {
    const body: BranchList = {
      items: (await settings.list(tenant(req), 'branches')).map(toBranch),
      nextCursor: null,
    };
    res.json(body);
  };

  const createBranch: RequestHandler = async (req, res) => {
    const { name } = req.body as CreateCatalogItemRequest;
    const body: Branch = toBranch(await settings.create(tenant(req), 'branches', name, contextOf(req)));
    res.status(201).json(body);
  };

  const getBranch: RequestHandler = async (req, res) => {
    const body: Branch = toBranch(await settings.get(tenant(req), 'branches', branchId(req)));
    res.json(body);
  };

  const updateBranch: RequestHandler = async (req, res) => {
    const change = req.body as UpdateCatalogItemRequest;
    const row = await settings.update(tenant(req), 'branches', branchId(req), change, contextOf(req));
    const body: Branch = toBranch(row);
    res.json(body);
  };

  const listRoles: RequestHandler = async (req, res) => {
    const body: RoleList = {
      items: (await settings.list(tenant(req), 'roles')).map(toRole),
      nextCursor: null,
    };
    res.json(body);
  };

  const createRole: RequestHandler = async (req, res) => {
    const { name } = req.body as CreateCatalogItemRequest;
    const body: Role = toRole(await settings.create(tenant(req), 'roles', name, contextOf(req)));
    res.status(201).json(body);
  };

  const getRole: RequestHandler = async (req, res) => {
    const body: Role = toRole(await settings.get(tenant(req), 'roles', roleId(req)));
    res.json(body);
  };

  const updateRole: RequestHandler = async (req, res) => {
    const change = req.body as UpdateCatalogItemRequest;
    const body: Role = toRole(
      await settings.update(tenant(req), 'roles', roleId(req), change, contextOf(req)),
    );
    res.json(body);
  };

  const listMembers: RequestHandler = async (req, res) => {
    const body: MemberList = { items: (await members.list(tenant(req))).map(toMember), nextCursor: null };
    res.json(body);
  };

  const getMember: RequestHandler = async (req, res) => {
    const body: Member = toMember(await members.get(tenant(req), membershipId(req)));
    res.json(body);
  };

  const assignMember: RequestHandler = async (req, res) => {
    const assignment = req.body as AssignMemberRequest;
    const row = await members.change(tenant(req), membershipId(req), 'assign', assignment, contextOf(req));
    const body: Member = toMember(row);
    res.json(body);
  };

  const deactivateMember: RequestHandler = async (req, res) => {
    const row = await members.change(tenant(req), membershipId(req), 'deactivate', null, contextOf(req));
    const body: Member = toMember(row);
    res.json(body);
  };

  const reactivateMember: RequestHandler = async (req, res) => {
    const row = await members.change(tenant(req), membershipId(req), 'reactivate', null, contextOf(req));
    const body: Member = toMember(row);
    res.json(body);
  };

  return {
    listMembers,
    getMember,
    assignMember,
    deactivateMember,
    reactivateMember,
    getCurrentMembership,
    getMerchantProfile,
    updateMerchantProfile,
    listBranches,
    createBranch,
    getBranch,
    updateBranch,
    listRoles,
    createRole,
    getRole,
    updateRole,
  };
}
