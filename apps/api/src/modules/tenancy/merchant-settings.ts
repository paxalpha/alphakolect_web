import type {
  Branch,
  CurrentMembership,
  MerchantProfile,
  Permission,
  PermissionCatalog,
  Role,
  UpdateCatalogItemRequest,
} from '@alphakolect/contracts';
import { refusalMessage } from '../../platform/authorization.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { withTenant, type TenantContext, type TenantTx } from '../../platform/tenant.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { RequestContext } from '../identity/sessions.js';
import {
  NameTakenError,
  tenancyRepository as repo,
  type CatalogRow,
  type CatalogTable,
  type MerchantRow,
  type SettingsWrite,
} from './repository.js';

// The merchant's own settings — profile, branches, roles (P4.4; TARGET_ARCHITECTURE §4, ADR-15 T7–T9, T14, T15).
//
// The tenant is the caller's session, never a request field. Who may read or change them is decided twice: first by
// the router's policy middleware from the endpoint's declared permission (P5.4, ADR-16), which records a refusal as
// authz.denied; then by the database function each read and write calls (P5.5, the enforcement boundary), which
// takes the business from the session, checks the permission in the resolver and, for a write, records the change's
// audit row in the same transaction (pattern A). A refusal by the database alone — a permission withdrawn between the
// two checks — is answered 403 and recorded best effort as the write's denial. Another merchant's branch or role is
// "not found", exactly like one that does not exist (T15).

const ITEM: Record<CatalogTable, 'branch' | 'role'> = { branches: 'branch', roles: 'role' };

/** The audit identifiers of these settings (P5.3a: literal types, so each writer accepts only catalog pairs). */
type SettingsAction =
  | 'merchant.profile_updated'
  | `merchant.${'branch' | 'role'}_${'created' | 'updated'}`
  | 'merchant.role_permissions_set';

/** The permission each write needs — the one its refusal names (the database decides it again under its locks). */
const PERMISSION: Record<SettingsAction, Permission> = {
  'merchant.profile_updated': 'merchant.profile.update',
  'merchant.branch_created': 'merchant.branches.manage',
  'merchant.branch_updated': 'merchant.branches.manage',
  'merchant.role_created': 'merchant.roles.manage',
  'merchant.role_updated': 'merchant.roles.manage',
  'merchant.role_permissions_set': 'merchant.roles.manage',
};

const notFound = (table: CatalogTable) =>
  new AppError(404, 'NOT_FOUND', table === 'branches' ? 'Branch not found' : 'Role not found');

const nameTaken = (table: CatalogTable) =>
  new AppError(409, 'NAME_TAKEN', `An active ${ITEM[table]} already has this name`);

const toProfile = (m: MerchantRow): MerchantProfile => ({ merchantId: m.id, name: m.name, status: m.status });

const toItem = (row: CatalogRow) => ({
  name: row.name,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  archivedAt: row.archived_at?.toISOString() ?? null,
});
export const toBranch = (row: CatalogRow): Branch => ({ branchId: row.id, ...toItem(row) });
export const toRole = (row: CatalogRow): Role => {
  // Every role read carries its permission set (P5.6); a role row without one is a programming error.
  if (!row.permissions) throw new Error('a role was read without its permissions');
  return { roleId: row.id, ...toItem(row), permissions: row.permissions };
};

export class MerchantSettingsService {
  constructor(private readonly deps: { db: Db; audit: Pick<AuditLog, 'recordBestEffort'> }) {}

  /** Any member: their own membership, business and effective permissions, as of this request. */
  async currentMembership(tenant: TenantContext): Promise<CurrentMembership> {
    const own = await withTenant(this.deps.db, tenant, (tx) => repo.ownMembership(tx));
    // validate_session established both on this request; absent only if changed in between.
    if (!own) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    return {
      membershipId: own.membership_id,
      kind: own.kind,
      roleId: own.role_id,
      branchId: own.branch_id,
      merchant: { merchantId: own.merchant_id, name: own.merchant_name, status: own.merchant_status },
      // Resolved by the database on this request (P5.2) — never cached, never from the token.
      permissions: [...tenant.permissions].sort(),
    };
  }

  async profile(tenant: TenantContext): Promise<MerchantProfile> {
    const merchant = await withTenant(this.deps.db, tenant, (tx) => repo.profile(tx));
    // The middleware found the permission on this request; absent only if the session or the permission changed in
    // between (P4's answer for a business that disappeared, unchanged).
    if (!merchant) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    return toProfile(merchant);
  }

  async rename(tenant: TenantContext, name: string, ctx: RequestContext): Promise<MerchantProfile> {
    const result = await withTenant(this.deps.db, tenant, (tx) => repo.updateProfile(tx, name, ctx));
    // On success the function wrote the change's audit row itself, in this transaction (pattern A, §8.1).
    const merchant = await this.settled(
      tenant,
      result,
      'merchant.profile_updated',
      'merchant',
      tenant.merchantId,
      ctx,
    );
    if (!merchant) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    return toProfile(merchant);
  }

  async list(tenant: TenantContext, table: CatalogTable): Promise<CatalogRow[]> {
    return withTenant(this.deps.db, tenant, (tx) => repo.listCatalog(tx, table));
  }

  async get(tenant: TenantContext, table: CatalogTable, id: string): Promise<CatalogRow> {
    const row = await withTenant(this.deps.db, tenant, (tx) => repo.getCatalogItem(tx, table, id));
    if (!row) throw notFound(table);
    return row;
  }

  async create(
    tenant: TenantContext,
    table: CatalogTable,
    name: string,
    ctx: RequestContext,
  ): Promise<CatalogRow> {
    let result: SettingsWrite<CatalogRow>;
    try {
      result = await withTenant(this.deps.db, tenant, async (tx) =>
        this.withPermissions(tx, table, await repo.createCatalogItem(tx, table, name, ctx)),
      );
    } catch (err) {
      throw err instanceof NameTakenError ? nameTaken(table) : err;
    }
    const row = await this.settled(tenant, result, `merchant.${ITEM[table]}_created`, ITEM[table], null, ctx);
    if (!row) throw notFound(table);
    return row;
  }

  async update(
    tenant: TenantContext,
    table: CatalogTable,
    id: string,
    change: UpdateCatalogItemRequest,
    ctx: RequestContext,
  ): Promise<CatalogRow> {
    let result: SettingsWrite<CatalogRow>;
    try {
      result = await withTenant(this.deps.db, tenant, async (tx) =>
        this.withPermissions(tx, table, await repo.updateCatalogItem(tx, table, id, change, ctx)),
      );
    } catch (err) {
      throw err instanceof NameTakenError ? nameTaken(table) : err;
    }
    const row = await this.settled(tenant, result, `merchant.${ITEM[table]}_updated`, ITEM[table], id, ctx);
    if (!row) throw notFound(table);
    return row;
  }

  /** The merchant permissions a role can be given, with the owner-approved descriptions (P5.6). */
  async permissionCatalog(tenant: TenantContext): Promise<PermissionCatalog> {
    const rows = await withTenant(this.deps.db, tenant, (tx) => repo.permissionCatalog(tx));
    return {
      items: rows.map((r) => ({
        permission: r.identifier,
        description: r.description,
        grantable: r.grantable,
      })),
    };
  }

  /**
   * Replace a role's permission set (P5.6). The database decides authority (the owner's alone), the tenant and every
   * identifier, and records #21 itself; the answer is the role with its new set, read in the same transaction.
   */
  async setRolePermissions(
    tenant: TenantContext,
    roleId: string,
    permissions: readonly string[],
    ctx: RequestContext,
  ): Promise<CatalogRow> {
    type Answer = SettingsWrite<CatalogRow> | { outcome: 'invalid_permissions'; row: null };
    const result = await withTenant(this.deps.db, tenant, async (tx): Promise<Answer> => {
      const outcome = await repo.setRolePermissions(tx, roleId, permissions, ctx);
      if (outcome !== 'ok') return { outcome, row: null };
      const row = await repo.getCatalogItem(tx, 'roles', roleId);
      return { outcome, row: row! };
    });
    if (result.outcome === 'invalid_permissions') {
      await this.deps.audit.recordBestEffort({
        ...this.context(tenant, 'role', roleId, ctx),
        action: 'merchant.role_permissions_set',
        outcome: 'failure',
        summary: { reason: 'invalid_permissions' },
      });
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Each permission must be a merchant permission a role can be given, listed once',
      );
    }
    const row = await this.settled(tenant, result, 'merchant.role_permissions_set', 'role', roleId, ctx);
    if (!row) throw notFound('roles');
    return row;
  }

  /** A role's answer carries its permission set: after a successful write, the role is read back in the same transaction. */
  private async withPermissions(
    tx: TenantTx,
    table: CatalogTable,
    result: SettingsWrite<CatalogRow>,
  ): Promise<SettingsWrite<CatalogRow>> {
    if (table !== 'roles' || result.outcome !== 'ok') return result;
    const row = await repo.getCatalogItem(tx, 'roles', result.row.id);
    return { outcome: 'ok', row: row! };
  }

  private context(tenant: TenantContext, targetType: string, targetId: string | null, ctx: RequestContext) {
    return {
      merchantId: tenant.merchantId,
      actorIdentityId: tenant.identityId,
      actorAudience: tenant.audience,
      actorMembershipId: tenant.membershipId,
      targetType,
      targetId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };
  }

  /**
   * A write's answer: the row on success; null for 'not_found' (no event — P4 recorded none); a 'forbidden' refusal
   * is recorded best effort as the write's denial (§8.2a) and answered 403.
   */
  private async settled<R>(
    tenant: TenantContext,
    result: SettingsWrite<R>,
    action: SettingsAction,
    targetType: string,
    targetId: string | null,
    ctx: RequestContext,
  ): Promise<R | null> {
    if (result.outcome === 'ok') return result.row;
    if (result.outcome === 'not_found') return null;
    await this.deps.audit.recordBestEffort({
      action,
      outcome: 'denied',
      merchantId: tenant.merchantId,
      actorIdentityId: tenant.identityId,
      actorAudience: tenant.audience,
      actorMembershipId: tenant.membershipId,
      targetType,
      targetId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      summary: { reason: result.outcome },
    });
    throw new AppError(403, 'FORBIDDEN', refusalMessage(PERMISSION[action]));
  }
}
