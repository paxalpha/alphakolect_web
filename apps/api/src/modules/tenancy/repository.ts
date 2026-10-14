import { scopeOf, type TenantTx } from '../../platform/tenant.js';
import type { RequestContext } from '../identity/sessions.js';

// The tenancy module's scoped repository (TARGET_ARCHITECTURE §4, ADR-15 T13–T15). Every function takes a TenantTx
// — a transaction opened by withTenant, with app.merchant_id set — and calls scopeOf(tx) before any query, so it
// cannot be used outside a tenant scope. A row of another merchant is simply not found.
//
// Since P5.5 (the enforcement boundary, ADR-16 B1) the app has no direct access to the business, its branches, roles
// or invitations: every read and write here is a database function called with the caller's session, which takes
// the business from the session and decides the permission itself from the resolver. The router's policy middleware
// decided it first; the database is the second layer, not the only one.

export type MerchantRow = {
  id: string;
  name: string;
  status: 'pending_verification' | 'active' | 'deactivated';
};

/** The caller's own membership and business (tenancy.read_own_membership: any member, no permission). */
export type OwnMembershipRow = {
  membership_id: string;
  kind: 'owner' | 'staff' | 'agent';
  role_id: string | null;
  branch_id: string | null;
  merchant_id: string;
  merchant_name: string;
  merchant_status: MerchantRow['status'];
};

/** A settings write's answer: refusals are returned, not raised (§8.2a); the row comes only with 'ok'. */
export type SettingsOutcome = 'ok' | 'forbidden' | 'not_found';
export type SettingsWrite<R> =
  { outcome: 'ok'; row: R } | { outcome: Exclude<SettingsOutcome, 'ok'>; row: null };

export type CatalogRow = {
  id: string;
  name: string;
  status: 'active' | 'archived';
  created_at: Date;
  archived_at: Date | null;
  /** Roles only (P5.6): the permissions the role grants, sorted; present on every role read. */
  permissions?: string[];
};

/** One merchant permission of the catalog (tenancy.list_permission_catalog). */
export type PermissionRow = { identifier: string; description: string; grantable: boolean };

/** tenancy.set_role_permissions' answer: refusals are returned, not raised (§8.2a). */
export type RolePermissionsOutcome = 'ok' | 'forbidden' | 'not_found' | 'invalid_permissions';

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

export type InvitationRow = {
  id: string;
  email: string;
  kind: 'staff' | 'agent';
  role_id: string | null;
  branch_id: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
};

export type IssuedInvitation = {
  outcome: 'ok' | 'forbidden' | 'invalid_assignment' | 'already_member';
  invitation_id: string | null;
  /** For the API only — never shown to the owner (D12). */
  delivery: 'setup' | 'accept' | 'none' | null;
};

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
/** What a read returns: a role also its permissions (P5.6). */
const READ_COLUMNS: Readonly<Record<CatalogTable, string>> = {
  branches: 'id, name, status, created_at, archived_at',
  roles: 'id, name, status, created_at, archived_at, permissions',
};

// The function names are never client input: they come from these closed sets and are interpolated only from them.
const LIST_FUNCTION: Readonly<Record<CatalogTable, string>> = {
  branches: 'tenancy.list_branches',
  roles: 'tenancy.list_roles',
};
const CREATE_FUNCTION: Readonly<Record<CatalogTable, string>> = {
  branches: 'tenancy.create_branch',
  roles: 'tenancy.create_role',
};
const UPDATE_FUNCTION: Readonly<Record<CatalogTable, string>> = {
  branches: 'tenancy.update_branch',
  roles: 'tenancy.update_role',
};

function settingsWrite<R>(result: R & { outcome: SettingsOutcome }): SettingsWrite<R> {
  const { outcome, ...row } = result;
  return outcome === 'ok' ? { outcome, row: row as R } : { outcome, row: null };
}

function nameTaken(err: unknown, table: CatalogTable): boolean {
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505' && e.constraint === `${table}_active_name_per_merchant`;
}

export const tenancyRepository = {
  /** tenancy.read_profile: the business, if the session holds merchant.profile.read; otherwise null. */
  async profile(tx: TenantTx): Promise<MerchantRow | null> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<MerchantRow>(`SELECT id, name, status FROM tenancy.read_profile($1)`, [
      sessionId,
    ]);
    return row ?? null;
  },

  /**
   * tenancy.update_profile (P5.5): authority (merchant.profile.update) is decided in the database, which also writes
   * the change's audit row (pattern A); the request context is recorded as given.
   */
  async updateProfile(tx: TenantTx, name: string, ctx: RequestContext): Promise<SettingsWrite<MerchantRow>> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<MerchantRow & { outcome: SettingsOutcome }>(
      `SELECT outcome, id, name, status FROM tenancy.update_profile($1, $2, $3, $4, $5)`,
      [sessionId, name, ctx.ip, ctx.userAgent, ctx.requestId],
    );
    return settingsWrite(row!);
  },

  /** tenancy.read_own_membership: the caller's own membership and business (validate_session established both). */
  async ownMembership(tx: TenantTx): Promise<OwnMembershipRow | null> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<OwnMembershipRow>(
      `SELECT membership_id, kind, role_id, branch_id, merchant_id, merchant_name, merchant_status
         FROM tenancy.read_own_membership($1)`,
      [sessionId],
    );
    return row ?? null;
  },

  /** tenancy.list_branches / list_roles: empty unless the session holds the read permission. */
  async listCatalog(tx: TenantTx, table: CatalogTable): Promise<CatalogRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<CatalogRow>(`SELECT ${READ_COLUMNS[table]} FROM ${LIST_FUNCTION[table]}($1)`, [
      sessionId,
    ]);
  },

  async getCatalogItem(tx: TenantTx, table: CatalogTable, id: string): Promise<CatalogRow | null> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<CatalogRow>(
      `SELECT ${READ_COLUMNS[table]} FROM ${LIST_FUNCTION[table]}($1, $2)`,
      [sessionId, id],
    );
    return row ?? null;
  },

  /** tenancy.list_permission_catalog: the active merchant permissions; empty unless the session holds roles.read. */
  async permissionCatalog(tx: TenantTx): Promise<PermissionRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<PermissionRow>(
      `SELECT identifier, description, grantable FROM tenancy.list_permission_catalog($1)`,
      [sessionId],
    );
  },

  /**
   * tenancy.set_role_permissions (P5.6): replaces the role's permission set. Authority (merchant.roles.manage, the
   * owner's alone), the tenant and every identifier are decided in the database, which writes #21 (pattern A).
   */
  async setRolePermissions(
    tx: TenantTx,
    roleId: string,
    permissions: readonly string[],
    ctx: RequestContext,
  ): Promise<RolePermissionsOutcome> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<{ outcome: RolePermissionsOutcome }>(
      `SELECT outcome FROM tenancy.set_role_permissions($1, $2, $3, $4, $5, $6)`,
      [sessionId, roleId, permissions, ctx.ip, ctx.userAgent, ctx.requestId],
    );
    return row!.outcome;
  },

  /**
   * tenancy.create_branch / create_role (P5.5): authority is decided in the database, which writes the audit row
   * (pattern A). @throws NameTakenError
   */
  async createCatalogItem(
    tx: TenantTx,
    table: CatalogTable,
    name: string,
    ctx: RequestContext,
  ): Promise<SettingsWrite<CatalogRow>> {
    const { sessionId } = scopeOf(tx);
    try {
      const [row] = await tx.query<CatalogRow & { outcome: SettingsOutcome }>(
        `SELECT outcome, ${CATALOG_COLUMNS} FROM ${CREATE_FUNCTION[table]}($1, $2, $3, $4, $5)`,
        [sessionId, name, ctx.ip, ctx.userAgent, ctx.requestId],
      );
      return settingsWrite(row!);
    } catch (err) {
      throw nameTaken(err, table) ? new NameTakenError(table) : err;
    }
  },

  /**
   * tenancy.update_branch / update_role (P5.5): rename and/or archive or restore, decided in the database, which
   * writes the audit row (pattern A); 'not_found' for an item that is not this business's. Archiving sets
   * archived_at, restoring clears it (the table's CHECK keeps the two consistent). @throws NameTakenError
   */
  async updateCatalogItem(
    tx: TenantTx,
    table: CatalogTable,
    id: string,
    change: { name?: string | undefined; status?: 'active' | 'archived' | undefined },
    ctx: RequestContext,
  ): Promise<SettingsWrite<CatalogRow>> {
    const { sessionId } = scopeOf(tx);
    try {
      const [row] = await tx.query<CatalogRow & { outcome: SettingsOutcome }>(
        `SELECT outcome, ${CATALOG_COLUMNS} FROM ${UPDATE_FUNCTION[table]}($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, id, change.name ?? null, change.status ?? null, ctx.ip, ctx.userAgent, ctx.requestId],
      );
      return settingsWrite(row!);
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

  /**
   * tenancy.update_membership (P4.5; P5.5): authority, tenant and every rule are decided in the database, which also
   * writes the change's audit row (pattern A); the request context is recorded as given.
   */
  async changeMembership(
    tx: TenantTx,
    membershipId: string,
    action: MembershipAction,
    assignment: { roleId: string; branchId: string | null } | null,
    ctx: RequestContext,
  ): Promise<MembershipChange> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<MembershipChange>(
      `SELECT outcome, membership_id FROM tenancy.update_membership($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        sessionId,
        membershipId,
        action,
        assignment?.roleId ?? null,
        assignment?.branchId ?? null,
        ctx.ip,
        ctx.userAgent,
        ctx.requestId,
      ],
    );
    return row!;
  },

  /**
   * tenancy.list_invitations: the business's invitations, newest first; empty unless the session holds
   * merchant.invitations.read. The token hash is never returned.
   */
  async invitations(tx: TenantTx, invitationId: string | null = null): Promise<InvitationRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<InvitationRow>(
      `SELECT id, email, kind, role_id, branch_id, expires_at, accepted_at, revoked_at, created_at
         FROM tenancy.list_invitations($1, $2)`,
      [sessionId, invitationId],
    );
  },

  /**
   * tenancy.issue_invitation (P4.6; P5.5): authority, tenant and every rule are decided in the database, which also
   * writes the invitation's audit row (pattern A); the request context is recorded as given.
   */
  async issueInvitation(
    tx: TenantTx,
    invite: { email: string; kind: 'staff' | 'agent'; roleId: string | null; branchId: string | null },
    tokenHash: string,
    setupTokenHash: string,
    ttlSeconds: number,
    ctx: RequestContext,
  ): Promise<IssuedInvitation> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<IssuedInvitation>(
      `SELECT outcome, invitation_id, delivery
         FROM tenancy.issue_invitation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        sessionId,
        invite.email,
        invite.kind,
        invite.roleId,
        invite.branchId,
        tokenHash,
        setupTokenHash,
        ttlSeconds,
        ctx.ip,
        ctx.userAgent,
        ctx.requestId,
      ],
    );
    return row!;
  },

  /** tenancy.revoke_invitation (P4.6; P5.5): decided in the database, which writes the audit row (pattern A). */
  async revokeInvitation(
    tx: TenantTx,
    invitationId: string,
    ctx: RequestContext,
  ): Promise<'ok' | 'forbidden' | 'not_found' | 'invalid_transition'> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<{ outcome: 'ok' | 'forbidden' | 'not_found' | 'invalid_transition' }>(
      `SELECT outcome FROM tenancy.revoke_invitation($1, $2, $3, $4, $5)`,
      [sessionId, invitationId, ctx.ip, ctx.userAgent, ctx.requestId],
    );
    return row!.outcome;
  },
} satisfies Record<string, (tx: TenantTx, ...args: never[]) => Promise<unknown>>;
