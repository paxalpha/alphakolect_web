import type {
  Branch,
  CurrentMembership,
  MerchantProfile,
  Role,
  UpdateCatalogItemRequest,
} from '@alphakolect/contracts';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { requireOwner, withTenant, type TenantContext } from '../../platform/tenant.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { RequestContext } from '../identity/sessions.js';
import {
  NameTakenError,
  tenancyRepository as repo,
  type CatalogRow,
  type CatalogTable,
  type MerchantRow,
} from './repository.js';

// The merchant's own settings — profile, branches, roles (P4.4; TARGET_ARCHITECTURE §4, ADR-15 T7–T9, T14, T15).
//
// The tenant is the caller's TenantContext, never a request field. Every read and write runs in one withTenant
// transaction through the scoped repository; each change and its audit row commit together. Until P5 only the
// owner manages these (T9: requireOwner); a refused change is audited as denied. Another merchant's branch or role
// is "not found", exactly like one that does not exist (T15).

const ITEM: Record<CatalogTable, 'branch' | 'role'> = { branches: 'branch', roles: 'role' };

/** The audit identifiers of these settings (P5.3a: literal types, so each writer accepts only catalog pairs). */
type SettingsAction = 'merchant.profile_updated' | `merchant.${'branch' | 'role'}_${'created' | 'updated'}`;

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
export const toRole = (row: CatalogRow): Role => ({ roleId: row.id, ...toItem(row) });

export class MerchantSettingsService {
  constructor(
    private readonly deps: { db: Db; audit: Pick<AuditLog, 'recordBestEffort' | 'recordWithin'> },
  ) {}

  /** Any member: their own membership, business and effective permissions, as of this request. */
  async currentMembership(tenant: TenantContext): Promise<CurrentMembership> {
    const { membership, merchant } = await withTenant(this.deps.db, tenant, async (tx) => ({
      membership: await repo.membership(tx),
      merchant: await repo.merchant(tx),
    }));
    // validate_session established both on this request; absent only if changed in between.
    if (!membership || !merchant) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    return {
      membershipId: membership.id,
      kind: membership.kind,
      roleId: membership.role_id,
      branchId: membership.branch_id,
      merchant: toProfile(merchant),
      // Resolved by the database on this request (P5.2) — never cached, never from the token.
      permissions: [...tenant.permissions].sort(),
    };
  }

  async profile(tenant: TenantContext): Promise<MerchantProfile> {
    requireOwner(tenant);
    const merchant = await withTenant(this.deps.db, tenant, (tx) => repo.merchant(tx));
    if (!merchant) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    return toProfile(merchant);
  }

  async rename(tenant: TenantContext, name: string, ctx: RequestContext): Promise<MerchantProfile> {
    await this.ownerOrDenied(tenant, 'merchant.profile_updated', 'merchant', tenant.merchantId, ctx);
    const merchant = await withTenant(this.deps.db, tenant, async (tx) => {
      const row = await repo.renameMerchant(tx, name);
      if (row) {
        await this.deps.audit.recordWithin(tx, {
          ...this.event(tenant, 'merchant.profile_updated', 'merchant', row.id, ctx),
          outcome: 'success',
          summary: { name: row.name },
        });
      }
      return row;
    });
    if (!merchant) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    return toProfile(merchant);
  }

  async list(tenant: TenantContext, table: CatalogTable): Promise<CatalogRow[]> {
    requireOwner(tenant);
    return withTenant(this.deps.db, tenant, (tx) => repo.listCatalog(tx, table));
  }

  async get(tenant: TenantContext, table: CatalogTable, id: string): Promise<CatalogRow> {
    requireOwner(tenant);
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
    // Template-built (P5.3a transitional list: these two call sites and their four identifiers only).
    const action = `merchant.${ITEM[table]}_created` as const;
    await this.ownerOrDenied(tenant, action, ITEM[table], null, ctx);
    try {
      return await withTenant(this.deps.db, tenant, async (tx) => {
        const row = await repo.createCatalogItem(tx, table, name);
        await this.deps.audit.recordWithin(tx, {
          ...this.event(tenant, action, ITEM[table], row.id, ctx),
          outcome: 'success',
          summary: { name: row.name },
        });
        return row;
      });
    } catch (err) {
      throw err instanceof NameTakenError ? nameTaken(table) : err;
    }
  }

  async update(
    tenant: TenantContext,
    table: CatalogTable,
    id: string,
    change: UpdateCatalogItemRequest,
    ctx: RequestContext,
  ): Promise<CatalogRow> {
    // Template-built (P5.3a transitional list: these two call sites and their four identifiers only).
    const action = `merchant.${ITEM[table]}_updated` as const;
    await this.ownerOrDenied(tenant, action, ITEM[table], id, ctx);
    let row: CatalogRow | null;
    try {
      row = await withTenant(this.deps.db, tenant, async (tx) => {
        const updated = await repo.updateCatalogItem(tx, table, id, change);
        if (updated) {
          await this.deps.audit.recordWithin(tx, {
            ...this.event(tenant, action, ITEM[table], updated.id, ctx),
            outcome: 'success',
            summary: { name: updated.name, status: updated.status },
          });
        }
        return updated;
      });
    } catch (err) {
      throw err instanceof NameTakenError ? nameTaken(table) : err;
    }
    if (!row) throw notFound(table);
    return row;
  }

  /** T9: only the owner changes settings. A refused attempt is audited, best effort (in the caller's own tenant). */
  private async ownerOrDenied(
    tenant: TenantContext,
    action: SettingsAction,
    targetType: string,
    targetId: string | null,
    ctx: RequestContext,
  ): Promise<void> {
    try {
      requireOwner(tenant);
    } catch (err) {
      await this.deps.audit.recordBestEffort({
        ...this.event(tenant, action, targetType, targetId, ctx),
        outcome: 'denied',
        summary: { reason: 'not_owner', kind: tenant.kind },
      });
      throw err;
    }
  }

  private event<A extends SettingsAction>(
    tenant: TenantContext,
    action: A,
    targetType: string,
    targetId: string | null,
    ctx: RequestContext,
  ) {
    return {
      action,
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
}
