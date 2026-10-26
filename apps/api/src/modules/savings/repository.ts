import { POSITION_AT, type Position, type Positioned } from '../../platform/pagination.js';
import type { RequestContext } from '../../platform/request-context.js';
import { scopeOf, type TenantTx } from '../../platform/tenant.js';

// The savings module's scoped repository (P8; ADR-15 T13–T15, B1). The app holds no privilege on the savings tables:
// every read and write here is a savings.* database function called with the caller's session, which takes the business
// from the session, decides the permission and the branch scope itself (an agent's own customers, D1), posts to the
// ledger and records its activity event (pattern A). Refusals are returned as outcomes, not raised (§8.2a). Amounts are
// kobo strings (int8 is read as text); dates are read as text.

export type PackageFields = {
  id: string;
  name: string;
  kind: 'fixed' | 'flexible';
  amount_minor: string;
  fee_rule: 'first_contribution' | 'percentage';
  fee_rate_bp: number | null;
  status: 'active' | 'archived';
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
};
export type PackageOutcome = 'ok' | 'forbidden' | 'not_found' | 'invalid' | 'name_taken';
export type PackageWrite = { outcome: PackageOutcome } & {
  [K in keyof PackageFields]: PackageFields[K] | null;
};

export type EnrolmentWrite = {
  outcome: 'ok' | 'forbidden' | 'not_found' | 'invalid_status' | 'invalid_package';
  customer_id: string | null;
  package_id: string | null;
  next_package_id: string | null;
  effective: 'now' | 'next_cycle' | null;
  enrolled_at: Date | null;
  updated_at: Date | null;
};

export type CollectionFields = {
  id: string;
  customer_id: string;
  agent_membership_id: string;
  package_id: string;
  amount_minor: string;
  days: number | null;
  collected_on: string;
  status: 'recorded' | 'approved' | 'cancelled';
  remittance_id: string | null;
  cycle_id: string | null;
  fee_minor: string | null;
  created_at: Date;
  approved_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
};
export type CollectionRow = CollectionFields & Positioned;
export type CollectionOutcome =
  | 'ok'
  | 'replayed'
  | 'key_reused'
  | 'forbidden'
  | 'invalid'
  | 'not_found'
  | 'invalid_status'
  | 'not_enrolled'
  | 'invalid_amount';
export type CollectionWrite = { outcome: CollectionOutcome } & {
  [K in keyof CollectionFields]: CollectionFields[K] | null;
};

export type RemittanceFields = {
  id: string;
  agent_membership_id: string;
  cash_minor: string;
  collection_count: number;
  fee_total_minor: string;
  created_at: Date;
};
export type RemittanceRow = RemittanceFields & Positioned & { approved_by_membership_id: string };
export type RemittanceWrite = {
  outcome:
    | 'ok'
    | 'forbidden'
    | 'invalid'
    | 'invalid_agent'
    | 'not_found'
    | 'invalid_status'
    | 'cash_mismatch'
    | 'inactive_customer';
} & { [K in keyof RemittanceFields]: RemittanceFields[K] | null };

export type MovementKind = 'savings_withdrawal' | 'target_withdrawal' | 'to_target';
export type MovementFields = {
  id: string;
  customer_id: string;
  kind: MovementKind;
  amount_minor: string;
  entry_id: string;
  created_at: Date;
};
export type MovementRow = MovementFields & Positioned;
export type MovementWrite = {
  outcome:
    | 'ok'
    | 'replayed'
    | 'key_reused'
    | 'forbidden'
    | 'invalid'
    | 'not_found'
    | 'invalid_status'
    | 'insufficient_balance';
} & { [K in keyof MovementFields]: MovementFields[K] | null };

export type GoalWrite = {
  outcome: 'ok' | 'forbidden' | 'not_found' | 'invalid' | 'invalid_status';
  customer_id: string | null;
  goal_amount_minor: string | null;
  goal_date: string | null;
  updated_at: Date | null;
};

export type SummaryRow = {
  customer_id: string;
  package_id: string | null;
  next_package_id: string | null;
  enrolled_at: Date | null;
  cycle_number: number | null;
  cycle_starts_on: string | null;
  cycle_ends_on: string | null;
  savings_minor: string;
  target_minor: string;
  pending_minor: string;
  goal_amount_minor: string | null;
  goal_date: string | null;
};

/** A page of a list: its size, and the position a cursor gave (null for the first page). */
export type Page = { limit: number; after: Position | null };

const PACKAGE_FIELDS = `id, name, kind, amount_minor, fee_rule, fee_rate_bp, status, created_at, updated_at, archived_at`;
const COLLECTION_FIELDS = `id, customer_id, agent_membership_id, package_id, amount_minor, days,
              collected_on::text AS collected_on, status, remittance_id, cycle_id, fee_minor, created_at, approved_at,
              cancelled_at, cancel_reason`;
const MOVEMENT_FIELDS = `id, customer_id, kind, amount_minor, entry_id, created_at`;
const SUMMARY_FIELDS = `customer_id, package_id, next_package_id, enrolled_at, cycle_number,
              cycle_starts_on::text AS cycle_starts_on, cycle_ends_on::text AS cycle_ends_on, savings_minor,
              target_minor, pending_minor, goal_amount_minor, goal_date::text AS goal_date`;
const audit = (ctx: RequestContext) => [ctx.ip, ctx.userAgent, ctx.requestId];

export const savingsRepository = {
  /** savings.list_packages: the business's packages, oldest first. */
  async packages(tx: TenantTx, status: string | null): Promise<PackageFields[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<PackageFields>(`SELECT ${PACKAGE_FIELDS} FROM savings.list_packages($1, NULL, $2)`, [
      sessionId,
      status,
    ]);
  },

  /** savings.create_package (Q1, Q2; BR-6.1). */
  async createPackage(
    tx: TenantTx,
    input: { name: string; kind: string; amountMinor: string; feeRule: string; feeRateBp: number | null },
    ctx: RequestContext,
  ): Promise<PackageWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<PackageWrite>(
      `SELECT outcome, ${PACKAGE_FIELDS}
         FROM savings.create_package($1, $2, $3, $4::bigint, $5, $6, $7, $8, $9)`,
      [sessionId, input.name, input.kind, input.amountMinor, input.feeRule, input.feeRateBp, ...audit(ctx)],
    );
    return row!;
  },

  /** savings.update_package: a name or a status (P8-7). */
  async updatePackage(
    tx: TenantTx,
    packageId: string,
    change: object,
    ctx: RequestContext,
  ): Promise<PackageWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<PackageWrite>(
      `SELECT outcome, ${PACKAGE_FIELDS} FROM savings.update_package($1, $2, $3::jsonb, $4, $5, $6)`,
      [sessionId, packageId, JSON.stringify(change), ...audit(ctx)],
    );
    return row!;
  },

  /** savings.enrol_customer (BR-5.1, Q10). */
  async enrol(
    tx: TenantTx,
    customerId: string,
    packageId: string,
    ctx: RequestContext,
  ): Promise<EnrolmentWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<EnrolmentWrite>(
      `SELECT outcome, customer_id, package_id, next_package_id, effective, enrolled_at, updated_at
         FROM savings.enrol_customer($1, $2, $3, $4, $5, $6)`,
      [sessionId, customerId, packageId, ...audit(ctx)],
    );
    return row!;
  },

  /** savings.customer_savings: null when the customer is not one the caller may read. */
  async customerSavings(tx: TenantTx, customerId: string): Promise<SummaryRow | null> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<SummaryRow>(
      `SELECT ${SUMMARY_FIELDS} FROM savings.customer_savings($1, $2)`,
      [sessionId, customerId],
    );
    return row ?? null;
  },

  /** savings.list_collections: a page of the business's collections (a restricted staff member's branch only). */
  async collections(
    tx: TenantTx,
    filter: {
      customerId: string | null;
      agentMembershipId: string | null;
      status: string | null;
      remittanceId: string | null;
    },
    page: Page,
  ): Promise<CollectionRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<CollectionRow>(
      `SELECT ${COLLECTION_FIELDS}, ${POSITION_AT}
         FROM savings.list_collections($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)`,
      [
        sessionId,
        filter.customerId,
        filter.agentMembershipId,
        filter.status,
        filter.remittanceId,
        page.limit,
        page.after?.at ?? null,
        page.after?.id ?? null,
      ],
    );
  },

  /** savings.collection_branch: the branch of one of the business's collections (its customer's), for §7.6. */
  async collectionBranch(tx: TenantTx, collectionId: string): Promise<string | null> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<{ branch_id: string | null }>(
      `SELECT savings.collection_branch($1, $2) AS branch_id`,
      [sessionId, collectionId],
    );
    return row?.branch_id ?? null;
  },

  /** savings.cancel_collection (Q6). */
  async cancelCollection(
    tx: TenantTx,
    collectionId: string,
    reason: string,
    ctx: RequestContext,
  ): Promise<CollectionWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<CollectionWrite>(
      `SELECT outcome, ${COLLECTION_FIELDS} FROM savings.cancel_collection($1, $2, $3, $4, $5, $6)`,
      [sessionId, collectionId, reason, ...audit(ctx)],
    );
    return row!;
  },

  /** savings.list_remittances: a page of the business's remittances. */
  async remittances(tx: TenantTx, agentMembershipId: string | null, page: Page): Promise<RemittanceRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<RemittanceRow>(
      `SELECT id, agent_membership_id, cash_minor, collection_count, fee_total_minor, approved_by_membership_id,
              created_at, ${POSITION_AT}
         FROM savings.list_remittances($1, $2, $3, $4::timestamptz, $5)`,
      [sessionId, agentMembershipId, page.limit, page.after?.at ?? null, page.after?.id ?? null],
    );
  },

  /** savings.approve_remittance (Q5; TA-13): the collections the agent's cash covers. */
  async approveRemittance(
    tx: TenantTx,
    input: { agentMembershipId: string; collectionIds: string[]; cashMinor: string },
    ctx: RequestContext,
  ): Promise<RemittanceWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<RemittanceWrite>(
      `SELECT outcome, id, agent_membership_id, cash_minor, collection_count, fee_total_minor, created_at
         FROM savings.approve_remittance($1, $2, $3::uuid[], $4::bigint, $5, $6, $7)`,
      [sessionId, input.agentMembershipId, input.collectionIds, input.cashMinor, ...audit(ctx)],
    );
    return row!;
  },

  /** savings.move_savings (BR-7, Q9): a withdrawal to cash, or a move into target savings; the key makes it once. */
  async move(
    tx: TenantTx,
    customerId: string,
    kind: MovementKind,
    amountMinor: string,
    idempotencyKey: string,
    ctx: RequestContext,
  ): Promise<MovementWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<MovementWrite>(
      `SELECT outcome, ${MOVEMENT_FIELDS}
         FROM savings.move_savings($1, $2, $3, $4::bigint, $5, $6, $7, $8)`,
      [sessionId, customerId, kind, amountMinor, idempotencyKey, ...audit(ctx)],
    );
    return row!;
  },

  /** savings.list_movements: a page of a customer's withdrawals and moves. */
  async movements(tx: TenantTx, customerId: string, page: Page): Promise<MovementRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<MovementRow>(
      `SELECT ${MOVEMENT_FIELDS}, ${POSITION_AT}
         FROM savings.list_movements($1, $2, $3, $4::timestamptz, $5)`,
      [sessionId, customerId, page.limit, page.after?.at ?? null, page.after?.id ?? null],
    );
  },

  /** savings.set_target_goal (Q9). */
  async setGoal(
    tx: TenantTx,
    customerId: string,
    goal: { amountMinor: string | null; date: string | null },
    ctx: RequestContext,
  ): Promise<GoalWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<GoalWrite>(
      `SELECT outcome, customer_id, goal_amount_minor, goal_date::text AS goal_date, updated_at
         FROM savings.set_target_goal($1, $2, $3::bigint, $4::date, $5, $6, $7)`,
      [sessionId, customerId, goal.amountMinor, goal.date, ...audit(ctx)],
    );
    return row!;
  },

  /** savings.record_collection (BR-3, 5.3; D1): an agent records for one of their own customers. */
  async record(
    tx: TenantTx,
    customerId: string,
    amountMinor: string,
    idempotencyKey: string,
    ctx: RequestContext,
  ): Promise<CollectionWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<CollectionWrite>(
      `SELECT outcome, ${COLLECTION_FIELDS}
         FROM savings.record_collection($1, $2, $3::bigint, $4, $5, $6, $7)`,
      [sessionId, customerId, amountMinor, idempotencyKey, ...audit(ctx)],
    );
    return row!;
  },

  /** savings.agent_collections: a page of what the agent recorded. */
  async agentCollections(tx: TenantTx, status: string | null, page: Page): Promise<CollectionRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<CollectionRow>(
      `SELECT id, customer_id, NULL::uuid AS agent_membership_id, package_id, amount_minor, days,
              collected_on::text AS collected_on, status, NULL::uuid AS remittance_id, NULL::uuid AS cycle_id,
              NULL::bigint AS fee_minor, created_at, approved_at, cancelled_at, NULL::text AS cancel_reason,
              ${POSITION_AT}
         FROM savings.agent_collections($1, $2, $3, $4::timestamptz, $5)`,
      [sessionId, status, page.limit, page.after?.at ?? null, page.after?.id ?? null],
    );
  },

  /** savings.self_savings: the signed-in customer's own savings. */
  async selfSavings(tx: TenantTx): Promise<SummaryRow | null> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<SummaryRow>(`SELECT ${SUMMARY_FIELDS} FROM savings.self_savings($1)`, [
      sessionId,
    ]);
    return row ?? null;
  },

  /** savings.self_collections: a page of the signed-in customer's collections. */
  async selfCollections(tx: TenantTx, page: Page): Promise<CollectionRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<CollectionRow>(
      `SELECT id, NULL::uuid AS customer_id, NULL::uuid AS agent_membership_id, NULL::uuid AS package_id,
              amount_minor, days, collected_on::text AS collected_on, status, NULL::uuid AS remittance_id,
              NULL::uuid AS cycle_id, fee_minor, created_at, approved_at, cancelled_at, NULL::text AS cancel_reason,
              ${POSITION_AT}
         FROM savings.self_collections($1, $2, $3::timestamptz, $4)`,
      [sessionId, page.limit, page.after?.at ?? null, page.after?.id ?? null],
    );
  },
} satisfies Record<string, (tx: TenantTx, ...args: never[]) => Promise<unknown>>;
