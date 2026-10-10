import { scopeOf, type TenantTx } from '../../platform/tenant.js';

// The tenancy module's scoped repository (TARGET_ARCHITECTURE §4, ADR-15 T13–T15). Every function takes a TenantTx
// — a transaction opened by withTenant, with app.merchant_id set — and calls scopeOf(tx) before any query, so it
// cannot be used outside a tenant scope. Each query also filters on that merchant explicitly: RLS is the last line
// of defence, not the only one. A row of another merchant is simply not found.

export type MerchantRow = {
  id: string;
  name: string;
  status: 'pending_verification' | 'active' | 'deactivated';
};

export type MembershipRow = {
  id: string;
  kind: 'owner' | 'staff' | 'agent';
  role_id: string | null;
  branch_id: string | null;
};

export type CatalogRow = {
  id: string;
  name: string;
  status: 'active' | 'archived';
  created_at: Date;
  archived_at: Date | null;
};

export type CatalogTable = 'branches' | 'roles';

export type MemberRow = {
  membership_id: string;
  kind: 'owner' | 'staff' | 'agent';
  status: 'active' | 'deactivated';
  role_id: string | null;
  branch_id: string | null;
  email: string;
  created_at: Date;
  deactivated_at: Date | null;
};

export type MembershipAction = 'assign' | 'deactivate' | 'reactivate';

export type MembershipChange = {
  outcome:
    | 'ok'
    | 'forbidden'
    | 'not_found'
    | 'owner_protected'
    | 'invalid_target'
    | 'invalid_assignment'
    | 'invalid_transition';
  membership_id: string | null;
};

/** A uniqueness violation of the one-active-name-per-merchant index of `table`. */
export class NameTakenError extends Error {
  constructor(readonly table: CatalogTable) {
    super(`An active ${table === 'branches' ? 'branch' : 'role'} already has this name`);
    this.name = 'NameTakenError';
  }
}

const CATALOG_COLUMNS = 'id, name, status, created_at, archived_at';

// The table name is never client input: it comes from this closed set and is interpolated only from it.
const CATALOG_TABLES: Readonly<Record<CatalogTable, string>> = {
  branches: 'tenancy.branches',
  roles: 'tenancy.roles',
};

function nameTaken(err: unknown, table: CatalogTable): boolean {
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505' && e.constraint === `${table}_active_name_per_merchant`;
}

export const tenancyRepository = {
  async merchant(tx: TenantTx): Promise<MerchantRow | null> {
    const { merchantId } = scopeOf(tx);
    const [row] = await tx.query<MerchantRow>(
      `SELECT id, name, status FROM tenancy.merchants WHERE id = $1`,
      [merchantId],
    );
    return row ?? null;
  },

  async renameMerchant(tx: TenantTx, name: string): Promise<MerchantRow | null> {
    const { merchantId } = scopeOf(tx);
    const [row] = await tx.query<MerchantRow>(
      `UPDATE tenancy.merchants SET name = $2, updated_at = now() WHERE id = $1 RETURNING id, name, status`,
      [merchantId, name],
    );
    return row ?? null;
  },

  /** The caller's own membership (read under RLS; validate_session has already established it is active). */
  async membership(tx: TenantTx): Promise<MembershipRow | null> {
    const { merchantId, membershipId } = scopeOf(tx);
    const [row] = await tx.query<MembershipRow>(
      `SELECT id, kind, role_id, branch_id FROM tenancy.merchant_memberships WHERE merchant_id = $1 AND id = $2`,
      [merchantId, membershipId],
    );
    return row ?? null;
  },

  async listCatalog(tx: TenantTx, table: CatalogTable): Promise<CatalogRow[]> {
    const { merchantId } = scopeOf(tx);
    return tx.query<CatalogRow>(
      `SELECT ${CATALOG_COLUMNS} FROM ${CATALOG_TABLES[table]} WHERE merchant_id = $1 ORDER BY created_at, id`,
      [merchantId],
    );
  },

  async getCatalogItem(tx: TenantTx, table: CatalogTable, id: string): Promise<CatalogRow | null> {
    const { merchantId } = scopeOf(tx);
    const [row] = await tx.query<CatalogRow>(
      `SELECT ${CATALOG_COLUMNS} FROM ${CATALOG_TABLES[table]} WHERE merchant_id = $1 AND id = $2`,
      [merchantId, id],
    );
    return row ?? null;
  },

  /** @throws NameTakenError */
  async createCatalogItem(tx: TenantTx, table: CatalogTable, name: string): Promise<CatalogRow> {
    const { merchantId } = scopeOf(tx);
    try {
      const [row] = await tx.query<CatalogRow>(
        `INSERT INTO ${CATALOG_TABLES[table]} (merchant_id, name) VALUES ($1, $2) RETURNING ${CATALOG_COLUMNS}`,
        [merchantId, name],
      );
      return row!;
    } catch (err) {
      throw nameTaken(err, table) ? new NameTakenError(table) : err;
    }
  },

  /**
   * Rename and/or archive/restore; null if no such item in this tenant. Archiving sets archived_at, restoring
   * clears it (the table's CHECK keeps the two consistent). @throws NameTakenError
   */
  async updateCatalogItem(
    tx: TenantTx,
    table: CatalogTable,
    id: string,
    change: { name?: string | undefined; status?: 'active' | 'archived' | undefined },
  ): Promise<CatalogRow | null> {
    const { merchantId } = scopeOf(tx);
    try {
      const [row] = await tx.query<CatalogRow>(
        `UPDATE ${CATALOG_TABLES[table]}
            SET name = coalesce($3, name),
                status = coalesce($4, status),
                archived_at = CASE
                  WHEN coalesce($4, status) = 'active' THEN NULL
                  WHEN status = 'archived' THEN archived_at
                  ELSE now()
                END,
                updated_at = now()
          WHERE merchant_id = $1 AND id = $2
          RETURNING ${CATALOG_COLUMNS}`,
        [merchantId, id, change.name ?? null, change.status ?? null],
      );
      return row ?? null;
    } catch (err) {
      throw nameTaken(err, table) ? new NameTakenError(table) : err;
    }
  },

  /**
   * The business's members with their email (tenancy.list_members, P4.5). Authority is decided in the database from
   * the session: only the active owner's session sees anything.
   */
  async members(tx: TenantTx, membershipId: string | null = null): Promise<MemberRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<MemberRow>(
      `SELECT membership_id, kind, status, role_id, branch_id, email, created_at, deactivated_at
         FROM tenancy.list_members($1, $2)`,
      [sessionId, membershipId],
    );
  },

  /** tenancy.update_membership (P4.5): authority, tenant and every rule are decided in the database. */
  async changeMembership(
    tx: TenantTx,
    membershipId: string,
    action: MembershipAction,
    assignment: { roleId: string; branchId: string | null } | null,
  ): Promise<MembershipChange> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<MembershipChange>(
      `SELECT outcome, membership_id FROM tenancy.update_membership($1, $2, $3, $4, $5)`,
      [sessionId, membershipId, action, assignment?.roleId ?? null, assignment?.branchId ?? null],
    );
    return row!;
  },
} satisfies Record<string, (tx: TenantTx, ...args: never[]) => Promise<unknown>>;
