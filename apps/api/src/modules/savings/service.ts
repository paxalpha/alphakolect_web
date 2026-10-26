import type {
  AgentCollection,
  AgentCollectionList,
  AgentCollectionListQuery,
  Collection,
  CollectionList,
  CollectionListQuery,
  CreatePackageRequest,
  CreateRemittanceRequest,
  CustomerCollection,
  CustomerCollectionList,
  CustomerSavings,
  Enrolment,
  Money,
  PageQuery,
  Permission,
  Remittance,
  RemittanceList,
  RemittanceListQuery,
  SavingsMovement,
  SavingsMovementList,
  SavingsPackage,
  SavingsPackageList,
  TargetGoal,
  TargetGoalRequest,
  UpdatePackageRequest,
} from '@alphakolect/contracts';
import type { AuthContext } from '../../platform/http/authenticate.js';
import { refusalMessage, type BranchResolver } from '../../platform/authorization.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { decodeCursor, pageOf } from '../../platform/pagination.js';
import type { RequestContext } from '../../platform/request-context.js';
import { tenantContextOf, withTenant, type TenantContext } from '../../platform/tenant.js';
import type { AuditLog } from '../audit/index.js';
import { customersRepository } from '../customers/index.js';
import {
  savingsRepository as repo,
  type CollectionFields,
  type MovementFields,
  type MovementKind,
  type PackageFields,
  type RemittanceFields,
  type SummaryRow,
} from './repository.js';

// Savings (P8; docs/architecture/P8_IMPLEMENTATION_PLAN.md; the owner's answers of 2026-10-25). The business is the
// session's. Who may act is decided by the router's policy middleware from the endpoint's permission and — for the
// branch-scoped endpoints — the customer's branch (P5 §7.6), then again by every database function under its locks
// (B1); an agent records only for their own customers (BR-3, D1), which the database decides. On success each command's
// function records its activity event (pattern A) and posts to the ledger; nothing is written on a refusal.

const money = (amountMinor: string): Money => ({ amountMinor, currency: 'NGN' });
const iso = (d: Date) => d.toISOString();

const toPackage = (r: PackageFields): SavingsPackage => ({
  packageId: r.id,
  name: r.name,
  kind: r.kind,
  amount: money(r.amount_minor),
  feeRule: r.fee_rule,
  feeRateBp: r.fee_rate_bp,
  status: r.status,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  archivedAt: r.archived_at ? iso(r.archived_at) : null,
});

const toCollection = (r: CollectionFields): Collection => ({
  collectionId: r.id,
  customerId: r.customer_id,
  agentMembershipId: r.agent_membership_id,
  packageId: r.package_id,
  amount: money(r.amount_minor),
  days: r.days,
  collectedOn: r.collected_on,
  status: r.status,
  remittanceId: r.remittance_id,
  cycleId: r.cycle_id,
  fee: r.fee_minor === null ? null : money(r.fee_minor),
  createdAt: iso(r.created_at),
  approvedAt: r.approved_at ? iso(r.approved_at) : null,
  cancelledAt: r.cancelled_at ? iso(r.cancelled_at) : null,
  cancelReason: r.cancel_reason,
});

const toAgentCollection = (r: CollectionFields): AgentCollection => ({
  collectionId: r.id,
  customerId: r.customer_id,
  packageId: r.package_id,
  amount: money(r.amount_minor),
  days: r.days,
  collectedOn: r.collected_on,
  status: r.status,
  createdAt: iso(r.created_at),
  approvedAt: r.approved_at ? iso(r.approved_at) : null,
  cancelledAt: r.cancelled_at ? iso(r.cancelled_at) : null,
});

const toCustomerCollection = (r: CollectionFields): CustomerCollection => ({
  collectionId: r.id,
  amount: money(r.amount_minor),
  days: r.days,
  collectedOn: r.collected_on,
  status: r.status,
  fee: r.fee_minor === null ? null : money(r.fee_minor),
  createdAt: iso(r.created_at),
  approvedAt: r.approved_at ? iso(r.approved_at) : null,
  cancelledAt: r.cancelled_at ? iso(r.cancelled_at) : null,
});

const toRemittance = (r: RemittanceFields & { approved_by_membership_id: string }): Remittance => ({
  remittanceId: r.id,
  agentMembershipId: r.agent_membership_id,
  cash: money(r.cash_minor),
  collectionCount: r.collection_count,
  feeTotal: money(r.fee_total_minor),
  approvedByMembershipId: r.approved_by_membership_id,
  createdAt: iso(r.created_at),
});

const toMovement = (r: MovementFields): SavingsMovement => ({
  movementId: r.id,
  customerId: r.customer_id,
  kind: r.kind,
  amount: money(r.amount_minor),
  entryId: r.entry_id,
  createdAt: iso(r.created_at),
});

const toSummary = (r: SummaryRow): CustomerSavings => ({
  customerId: r.customer_id,
  packageId: r.package_id,
  nextPackageId: r.next_package_id,
  enrolledAt: r.enrolled_at ? iso(r.enrolled_at) : null,
  cycle:
    r.cycle_number === null
      ? null
      : { number: r.cycle_number, startsOn: r.cycle_starts_on!, endsOn: r.cycle_ends_on! },
  savings: money(r.savings_minor),
  targetSavings: money(r.target_minor),
  awaitingConfirmation: money(r.pending_minor),
  goal:
    r.goal_amount_minor === null && r.goal_date === null
      ? null
      : { amount: r.goal_amount_minor === null ? null : money(r.goal_amount_minor), date: r.goal_date },
});

const customerNotFound = () => new AppError(404, 'NOT_FOUND', 'Customer not found');
const transition = () => new AppError(409, 'INVALID_LIFECYCLE_TRANSITION', 'The status does not allow this');
const keyReused = () =>
  new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used with another request');
/** The session is no longer an active agent's: authentication found it valid moments ago. */
const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

/** The commands whose refusal by the database alone is recorded, with what they act on. */
type SavingsAction =
  | 'savings.package_created'
  | 'savings.package_updated'
  | 'savings.customer_enrolled'
  | 'savings.collection_cancelled'
  | 'savings.remittance_approved'
  | 'savings.money_moved'
  | 'savings.target_goal_set';
const REFUSED: Record<SavingsAction, { permission: Permission; targetType: string }> = {
  'savings.package_created': { permission: 'merchant.packages.manage', targetType: 'savings_package' },
  'savings.package_updated': { permission: 'merchant.packages.manage', targetType: 'savings_package' },
  'savings.customer_enrolled': { permission: 'merchant.packages.manage', targetType: 'customer' },
  'savings.collection_cancelled': {
    permission: 'merchant.remittances.approve',
    targetType: 'savings_collection',
  },
  'savings.remittance_approved': {
    permission: 'merchant.remittances.approve',
    targetType: 'savings_remittance',
  },
  'savings.money_moved': { permission: 'merchant.withdrawals.create', targetType: 'customer' },
  'savings.target_goal_set': { permission: 'merchant.withdrawals.create', targetType: 'customer' },
};

export type SavingsDeps = { db: Db; audit: Pick<AuditLog, 'recordBestEffort'> };

export class SavingsService {
  constructor(private readonly deps: SavingsDeps) {}

  /** The branch resolvers of the branch-scoped savings endpoints (P5 §7.6): read before the policy decision. */
  branchResolvers(): Readonly<Record<string, BranchResolver>> {
    const ofCustomer: BranchResolver = async (req, auth) => ({
      branchId: await withTenant(this.deps.db, tenantContextOf(auth as AuthContext), (tx) =>
        customersRepository.branchOf(tx, String(req.params.customerId)),
      ),
    });
    const ofCollection: BranchResolver = async (req, auth) => ({
      branchId: await withTenant(this.deps.db, tenantContextOf(auth as AuthContext), (tx) =>
        repo.collectionBranch(tx, String(req.params.collectionId)),
      ),
    });
    const own: BranchResolver = async (_req, auth) => ({ branchId: auth.branchId });
    return {
      listCollections: own,
      listRemittances: own,
      enrolCustomer: ofCustomer,
      getCustomerSavings: ofCustomer,
      listSavingsMovements: ofCustomer,
      createWithdrawal: ofCustomer,
      createTargetTransfer: ofCustomer,
      setTargetGoal: ofCustomer,
      cancelCollection: ofCollection,
    };
  }

  // ── packages (Q1, Q2; BR-6.1) ──

  async packages(tenant: TenantContext, status: string | null): Promise<SavingsPackageList> {
    const rows = await withTenant(this.deps.db, tenant, (tx) => repo.packages(tx, status));
    return { items: rows.map(toPackage) };
  }

  async createPackage(
    tenant: TenantContext,
    input: CreatePackageRequest,
    ctx: RequestContext,
  ): Promise<SavingsPackage> {
    const r = await withTenant(this.deps.db, tenant, (tx) =>
      repo.createPackage(tx, { ...input, feeRateBp: input.feeRateBp ?? null }, ctx),
    );
    if (r.outcome === 'forbidden') throw await this.refused(tenant, 'savings.package_created', null, ctx);
    return this.packageAnswer(r.outcome, r as PackageFields);
  }

  async updatePackage(
    tenant: TenantContext,
    packageId: string,
    change: UpdatePackageRequest,
    ctx: RequestContext,
  ): Promise<SavingsPackage> {
    const r = await withTenant(this.deps.db, tenant, (tx) => repo.updatePackage(tx, packageId, change, ctx));
    if (r.outcome === 'forbidden')
      throw await this.refused(tenant, 'savings.package_updated', packageId, ctx);
    return this.packageAnswer(r.outcome, r as PackageFields);
  }

  private packageAnswer(outcome: string, row: PackageFields): SavingsPackage {
    switch (outcome) {
      case 'ok':
        return toPackage(row);
      case 'not_found':
        throw new AppError(404, 'NOT_FOUND', 'Package not found');
      case 'name_taken':
        throw new AppError(409, 'NAME_TAKEN', 'An active package of the business has this name');
      default:
        throw new AppError(400, 'VALIDATION_ERROR', 'The package is not valid');
    }
  }

  async enrol(
    tenant: TenantContext,
    customerId: string,
    packageId: string,
    ctx: RequestContext,
  ): Promise<Enrolment> {
    const r = await withTenant(this.deps.db, tenant, (tx) => repo.enrol(tx, customerId, packageId, ctx));
    switch (r.outcome) {
      case 'ok':
        return {
          customerId: r.customer_id!,
          packageId: r.package_id!,
          nextPackageId: r.next_package_id,
          effective: r.effective!,
          enrolledAt: iso(r.enrolled_at!),
          updatedAt: iso(r.updated_at!),
        };
      case 'forbidden':
        throw await this.refused(tenant, 'savings.customer_enrolled', customerId, ctx);
      case 'not_found':
        throw customerNotFound();
      case 'invalid_status':
        throw transition();
      case 'invalid_package':
        throw new AppError(422, 'INVALID_PACKAGE', 'Choose an active package of the business');
    }
  }

  async customerSavings(tenant: TenantContext, customerId: string): Promise<CustomerSavings> {
    const row = await withTenant(this.deps.db, tenant, (tx) => repo.customerSavings(tx, customerId));
    if (!row) throw customerNotFound();
    return toSummary(row);
  }

  // ── collections and remittances (BR-5.3, 5.5, 5.6; Q5, Q6; TA-13) ──

  async collections(tenant: TenantContext, query: CollectionListQuery): Promise<CollectionList> {
    const scope = `listCollections|customerId=${query.customerId ?? ''}|agentMembershipId=${query.agentMembershipId ?? ''}|status=${query.status ?? ''}|remittanceId=${query.remittanceId ?? ''}`;
    const after = decodeCursor(query.cursor, scope);
    const rows = await withTenant(this.deps.db, tenant, (tx) =>
      repo.collections(
        tx,
        {
          customerId: query.customerId ?? null,
          agentMembershipId: query.agentMembershipId ?? null,
          status: query.status ?? null,
          remittanceId: query.remittanceId ?? null,
        },
        { limit: query.limit, after },
      ),
    );
    return pageOf(rows, query.limit, scope, toCollection);
  }

  async cancelCollection(
    tenant: TenantContext,
    collectionId: string,
    reason: string,
    ctx: RequestContext,
  ): Promise<Collection> {
    const r = await withTenant(this.deps.db, tenant, (tx) =>
      repo.cancelCollection(tx, collectionId, reason, ctx),
    );
    switch (r.outcome) {
      case 'ok':
        return toCollection(r as CollectionFields);
      case 'forbidden':
        throw await this.refused(tenant, 'savings.collection_cancelled', collectionId, ctx);
      case 'not_found':
        throw new AppError(404, 'NOT_FOUND', 'Collection not found');
      case 'invalid_status':
        throw transition();
      default:
        throw new AppError(400, 'VALIDATION_ERROR', 'Give a reason');
    }
  }

  async remittances(tenant: TenantContext, query: RemittanceListQuery): Promise<RemittanceList> {
    const scope = `listRemittances|agentMembershipId=${query.agentMembershipId ?? ''}`;
    const after = decodeCursor(query.cursor, scope);
    const rows = await withTenant(this.deps.db, tenant, (tx) =>
      repo.remittances(tx, query.agentMembershipId ?? null, { limit: query.limit, after }),
    );
    return pageOf(rows, query.limit, scope, toRemittance);
  }

  async approveRemittance(
    tenant: TenantContext,
    input: CreateRemittanceRequest,
    ctx: RequestContext,
  ): Promise<Remittance> {
    const r = await withTenant(this.deps.db, tenant, (tx) => repo.approveRemittance(tx, input, ctx));
    switch (r.outcome) {
      case 'ok':
        return toRemittance({ ...(r as RemittanceFields), approved_by_membership_id: tenant.membershipId! });
      case 'forbidden':
        throw await this.refused(tenant, 'savings.remittance_approved', null, ctx);
      case 'not_found':
        throw new AppError(404, 'NOT_FOUND', 'A collection is not this agent’s, or not one you can reach');
      case 'invalid_status':
        throw new AppError(
          409,
          'INVALID_LIFECYCLE_TRANSITION',
          'A collection is already approved or cancelled',
        );
      case 'cash_mismatch':
        throw new AppError(422, 'CASH_MISMATCH', 'The cash is not the total of the collections it covers');
      case 'invalid_agent':
        throw new AppError(422, 'INVALID_AGENT', 'Choose an agent of the business');
      case 'inactive_customer':
        throw new AppError(
          422,
          'INACTIVE_CUSTOMER',
          'A customer is not active: cancel their collection instead',
        );
      case 'package_changed':
        throw new AppError(
          422,
          'PACKAGE_CHANGED',
          'A collection was recorded under another package than its cycle’s: cancel it, and record it again',
        );
      case 'invalid':
        throw new AppError(400, 'VALIDATION_ERROR', 'Name each collection once');
    }
  }

  // ── withdrawals and target savings (BR-7, Q7–Q9) ──

  async move(
    tenant: TenantContext,
    customerId: string,
    kind: MovementKind,
    amountMinor: string,
    idempotencyKey: string,
    ctx: RequestContext,
  ): Promise<SavingsMovement> {
    const r = await withTenant(this.deps.db, tenant, (tx) =>
      repo.move(tx, customerId, kind, amountMinor, idempotencyKey, ctx),
    );
    switch (r.outcome) {
      case 'ok':
      case 'replayed':
        return toMovement(r as MovementFields);
      case 'forbidden':
        throw await this.refused(tenant, 'savings.money_moved', customerId, ctx);
      case 'not_found':
        throw customerNotFound();
      case 'invalid_status':
        throw transition();
      case 'key_reused':
        throw keyReused();
      case 'insufficient_balance':
        throw new AppError(422, 'INSUFFICIENT_BALANCE', 'More than the wallet holds');
      case 'invalid':
        throw new AppError(400, 'VALIDATION_ERROR', 'The request is not valid');
    }
  }

  async movements(tenant: TenantContext, customerId: string, query: PageQuery): Promise<SavingsMovementList> {
    const scope = `listSavingsMovements|customerId=${customerId}`;
    const after = decodeCursor(query.cursor, scope);
    const { customer, rows } = await withTenant(this.deps.db, tenant, async (tx) => ({
      customer: await repo.customerSavings(tx, customerId),
      rows: await repo.movements(tx, customerId, { limit: query.limit, after }),
    }));
    if (!customer) throw customerNotFound();
    return pageOf(rows, query.limit, scope, toMovement);
  }

  async setGoal(
    tenant: TenantContext,
    customerId: string,
    input: TargetGoalRequest,
    ctx: RequestContext,
  ): Promise<TargetGoal> {
    const r = await withTenant(this.deps.db, tenant, (tx) =>
      repo.setGoal(tx, customerId, { amountMinor: input.goalAmountMinor, date: input.goalDate }, ctx),
    );
    switch (r.outcome) {
      case 'ok':
        return {
          customerId: r.customer_id!,
          goalAmount: r.goal_amount_minor === null ? null : money(r.goal_amount_minor),
          goalDate: r.goal_date,
          updatedAt: iso(r.updated_at!),
        };
      case 'forbidden':
        throw await this.refused(tenant, 'savings.target_goal_set', customerId, ctx);
      case 'not_found':
        throw customerNotFound();
      case 'invalid_status':
        throw transition();
      case 'invalid':
        throw new AppError(400, 'VALIDATION_ERROR', 'A goal date is today or later');
    }
  }

  // ── agents (BR-3, D1) ──

  async record(
    tenant: TenantContext,
    customerId: string,
    amountMinor: string,
    idempotencyKey: string,
    ctx: RequestContext,
  ): Promise<AgentCollection> {
    const r = await withTenant(this.deps.db, tenant, (tx) =>
      repo.record(tx, customerId, amountMinor, idempotencyKey, ctx),
    );
    switch (r.outcome) {
      case 'ok':
      case 'replayed':
        return toAgentCollection(r as CollectionFields);
      case 'forbidden':
        throw unauthenticated();
      case 'not_found':
        throw customerNotFound();
      case 'invalid_status':
        throw transition();
      case 'key_reused':
        throw keyReused();
      case 'not_enrolled':
        throw new AppError(422, 'NOT_ENROLLED', 'The customer is not on a package');
      case 'invalid_amount':
        throw new AppError(
          422,
          'INVALID_AMOUNT',
          'The amount is not the package’s amount or a multiple of it, or is below its minimum',
        );
      case 'invalid':
        throw new AppError(400, 'VALIDATION_ERROR', 'The request is not valid');
    }
  }

  async agentCollections(
    tenant: TenantContext,
    query: AgentCollectionListQuery,
  ): Promise<AgentCollectionList> {
    const scope = `listAgentCollections|status=${query.status ?? ''}`;
    const after = decodeCursor(query.cursor, scope);
    const rows = await withTenant(this.deps.db, tenant, (tx) =>
      repo.agentCollections(tx, query.status ?? null, { limit: query.limit, after }),
    );
    return pageOf(rows, query.limit, scope, toAgentCollection);
  }

  // ── the customer audience (BR-5.6) ──

  async selfSavings(tenant: TenantContext): Promise<CustomerSavings> {
    const row = await withTenant(this.deps.db, tenant, (tx) => repo.selfSavings(tx));
    // validate_session established the customer on this request; absent only if it changed in between.
    if (!row) throw unauthenticated();
    return toSummary(row);
  }

  async selfCollections(tenant: TenantContext, query: PageQuery): Promise<CustomerCollectionList> {
    const scope = 'listCustomerSelfCollections';
    const after = decodeCursor(query.cursor, scope);
    const rows = await withTenant(this.deps.db, tenant, (tx) =>
      repo.selfCollections(tx, { limit: query.limit, after }),
    );
    return pageOf(rows, query.limit, scope, toCustomerCollection);
  }

  /**
   * A refusal by the database alone (a permission withdrawn between the API's check and the command's), recorded best
   * effort and answered 403 with the permission's message.
   */
  private async refused(
    tenant: TenantContext,
    action: SavingsAction,
    targetId: string | null,
    ctx: RequestContext,
  ): Promise<AppError> {
    const { permission, targetType } = REFUSED[action];
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
      summary: { reason: 'forbidden' },
    });
    return new AppError(403, 'FORBIDDEN', refusalMessage(permission));
  }
}
