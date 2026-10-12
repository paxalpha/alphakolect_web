import type { Permission } from '@alphakolect/contracts';
import type { Db, Queryable } from './db.js';
import { AppError } from './errors.js';
import type { AuthContext } from './http/authenticate.js';

// TenantContext and tenant-scoped transactions (TARGET_ARCHITECTURE §4, ADR-15 T3, T5, T14).
//
// A request's tenant comes only from its authenticated session's membership, re-validated on this very request
// (identity.validate_session) — never from a client-supplied merchant id, which no tenant contract accepts.
// Tenant data is reached only through a TenantTx: a transaction that has set app.merchant_id locally (so RLS
// applies) and carries the TenantContext it was opened for. Scoped repositories take a TenantTx and call
// `scopeOf(tx)`, which refuses anything that `withTenant` did not create — an unscoped query object cannot reach
// tenant data through them.

export type MembershipKind = 'owner' | 'staff' | 'agent';

export type TenantContext = Readonly<{
  merchantId: string;
  identityId: string;
  membershipId: string;
  sessionId: string;
  audience: 'merchant' | 'agent';
  kind: MembershipKind;
  /** Staff only: their merchant-defined role (data only until P5). */
  roleId: string | null;
  /** Staff only: the one branch they are restricted to; null = all branches (ADR-15 T7). */
  branchId: string | null;
  /** Effective permissions from this request's resolver (P5.2, ADR-16); the database still decides every write. */
  permissions: readonly Permission[];
}>;

export type TenantTx = Queryable & { readonly tenant: TenantContext };

const MEMBERSHIP_KINDS: ReadonlySet<string> = new Set(['owner', 'staff', 'agent']);

/** The TenantContext of an authenticated merchant or agent session; refuses any other session. */
export function tenantContextOf(auth: AuthContext | undefined): TenantContext {
  if (
    !auth ||
    (auth.audience !== 'merchant' && auth.audience !== 'agent') ||
    !auth.merchantId ||
    !MEMBERSHIP_KINDS.has(auth.kind)
  ) {
    // Unreachable through the router (audience-checked endpoints); a programming error if it ever happens.
    throw new Error('A tenant endpoint was reached without a merchant or agent session');
  }
  return Object.freeze({
    merchantId: auth.merchantId,
    identityId: auth.identityId,
    membershipId: auth.membershipId,
    sessionId: auth.sessionId,
    audience: auth.audience,
    kind: auth.kind as MembershipKind,
    roleId: auth.roleId,
    branchId: auth.branchId,
    permissions: auth.permissions,
  });
}

const opened = new WeakSet<TenantTx>();

/** Run `fn` in one transaction scoped to the tenant: app.merchant_id is set locally before anything else. */
export function withTenant<T>(db: Db, tenant: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db.transaction(async (raw) => {
    await raw.query(`SELECT set_config('app.merchant_id', $1, true)`, [tenant.merchantId]);
    const tx: TenantTx = Object.freeze({ query: raw.query.bind(raw), tenant });
    opened.add(tx);
    return fn(tx);
  });
}

/** For scoped repositories: the tenant of a transaction opened by `withTenant` — anything else is refused. */
export function scopeOf(tx: TenantTx): TenantContext {
  if (!opened.has(tx)) throw new Error('Tenant data requires a transaction opened by withTenant');
  return tx.tenant;
}

/**
 * ADR-15 T9, the P4 interim check, kept in this one place: merchant-management endpoints require the owner.
 * Replaced wholesale by P5 policies — not a permission system.
 */
export function requireOwner(tenant: TenantContext): void {
  if (tenant.kind !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Only the business owner can do this');
  }
}
