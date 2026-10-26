import { z } from 'zod';
import { AmountMinor, ErrorResponse, Id, IdempotencyKeyHeader, Money, PageQuery } from '../primitives.js';
import { defineEndpoint } from '../registry.js';
import { LedgerDate } from './ledger.js';
import { Timestamp } from './merchant.js';

// Savings (P8; docs/architecture/P8_IMPLEMENTATION_PLAN.md; the owner's answers of 2026-10-25,
// docs/business/P8_OWNER_SAVINGS.md). Three audiences:
//   /v1/merchant/… — the business: packages, enrolment, collections and their cancellation, remittances, withdrawals and
//     target savings. A staff member restricted to a branch reaches that branch's customers only (P5 §7.6).
//   /v1/agent/collections — an agent records cash collections for their own customers (BR-3, D1).
//   /v1/customer/savings — the customer's app: balances, and collections "recorded by agent — awaiting confirmation"
//     until the business approves them (BR-5.6).
// Amounts are kobo strings (ADR-11). The money-moving POSTs take an Idempotency-Key: a retry with the same key and body
// gets the first answer; the same key with another body is refused.

const error = (description: string) => ({ description, schema: ErrorResponse });
const PositiveAmountMinor = AmountMinor.refine((v) => v !== '0', 'must be more than zero');

export const PackageKind = z.enum(['fixed', 'flexible']).meta({
  id: 'PackageKind',
  description: 'fixed: the amount or a multiple of it; flexible: any amount from it',
});
export const FeeRule = z
  .enum(['first_contribution', 'percentage'])
  .meta({ id: 'FeeRule', description: 'Exactly one per package (BR-6.1)' });

export const SavingsPackage = z
  .object({
    packageId: Id,
    name: z.string(),
    kind: PackageKind,
    /** The daily amount of a fixed package, or the minimum of a flexible one. */
    amount: Money,
    feeRule: FeeRule,
    /** The percentage in basis points (200 = 2%); null for the first-contribution rule. */
    feeRateBp: z.number().int().nullable(),
    status: z.enum(['active', 'archived']),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    archivedAt: Timestamp.nullable(),
  })
  .meta({ id: 'SavingsPackage', description: 'A savings package; its terms never change once created' });
export type SavingsPackage = z.infer<typeof SavingsPackage>;

export const SavingsPackageList = z
  .object({ items: z.array(SavingsPackage) })
  .meta({ id: 'SavingsPackageList', description: 'Oldest first' });
export type SavingsPackageList = z.infer<typeof SavingsPackageList>;

export const SavingsPackageQuery = z.object({ status: z.enum(['active', 'archived']).optional() });
export type SavingsPackageQuery = z.infer<typeof SavingsPackageQuery>;

export const CreatePackageRequest = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: PackageKind,
    amountMinor: PositiveAmountMinor,
    feeRule: FeeRule,
    /** Required for a percentage (1–10000 basis points); absent for the first-contribution rule. */
    feeRateBp: z.number().int().min(1).max(10000).optional(),
  })
  .refine((v) => (v.feeRule === 'percentage') === (v.feeRateBp !== undefined), {
    message: 'a percentage has a rate; the first-contribution rule has none',
    path: ['feeRateBp'],
  })
  .meta({ id: 'CreatePackageRequest' });
export type CreatePackageRequest = z.infer<typeof CreatePackageRequest>;

export const UpdatePackageRequest = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    /** An archived package takes no new enrolment; its customers stay on it. */
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'at least one field to change')
  .meta({ id: 'UpdatePackageRequest' });
export type UpdatePackageRequest = z.infer<typeof UpdatePackageRequest>;

export const EnrolRequest = z.object({ packageId: Id }).meta({ id: 'EnrolRequest' });
export type EnrolRequest = z.infer<typeof EnrolRequest>;

export const Enrolment = z
  .object({
    customerId: Id,
    packageId: Id,
    /** The next cycle's package, while a change waits for the current cycle to end (Q10). */
    nextPackageId: Id.nullable(),
    effective: z.enum(['now', 'next_cycle']),
    enrolledAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Enrolment' });
export type Enrolment = z.infer<typeof Enrolment>;

export const CustomerSavings = z
  .object({
    customerId: Id,
    packageId: Id.nullable(),
    nextPackageId: Id.nullable(),
    enrolledAt: Timestamp.nullable(),
    /** The latest 31-day cycle (BR-5.2). */
    cycle: z.object({ number: z.number().int(), startsOn: LedgerDate, endsOn: LedgerDate }).nullable(),
    savings: Money,
    targetSavings: Money,
    /** Recorded by the agent, awaiting the business's confirmation (BR-5.6): not in the savings yet. */
    awaitingConfirmation: Money,
    goal: z.object({ amount: Money.nullable(), date: LedgerDate.nullable() }).nullable(),
  })
  .meta({ id: 'CustomerSavings', description: 'A customer’s savings at a glance' });
export type CustomerSavings = z.infer<typeof CustomerSavings>;

export const CollectionStatus = z
  .enum(['recorded', 'approved', 'cancelled'])
  .meta({ id: 'CollectionStatus' });

export const Collection = z
  .object({
    collectionId: Id,
    customerId: Id,
    agentMembershipId: Id,
    packageId: Id,
    amount: Money,
    /** The days a fixed package's collection covers; null on a flexible package. */
    days: z.number().int().nullable(),
    collectedOn: LedgerDate,
    status: CollectionStatus,
    remittanceId: Id.nullable(),
    cycleId: Id.nullable(),
    /** The fee taken at approval (BR-6.1); null until approved. */
    fee: Money.nullable(),
    createdAt: Timestamp,
    approvedAt: Timestamp.nullable(),
    cancelledAt: Timestamp.nullable(),
    cancelReason: z.string().nullable(),
  })
  .meta({ id: 'Collection', description: 'A cash collection recorded by an agent' });
export type Collection = z.infer<typeof Collection>;

export const CollectionList = z
  .object({ items: z.array(Collection), nextCursor: z.string().nullable() })
  .meta({ id: 'CollectionList', description: 'Oldest first' });
export type CollectionList = z.infer<typeof CollectionList>;

export const CollectionListQuery = PageQuery.extend({
  customerId: Id.optional(),
  agentMembershipId: Id.optional(),
  status: CollectionStatus.optional(),
  remittanceId: Id.optional(),
});
export type CollectionListQuery = z.infer<typeof CollectionListQuery>;

export const CancelCollectionRequest = z
  .object({ reason: z.string().trim().min(1).max(300) })
  .meta({ id: 'CancelCollectionRequest' });
export type CancelCollectionRequest = z.infer<typeof CancelCollectionRequest>;

export const Remittance = z
  .object({
    remittanceId: Id,
    agentMembershipId: Id,
    cash: Money,
    collectionCount: z.number().int(),
    /** The fees taken from the approved collections. */
    feeTotal: Money,
    approvedByMembershipId: Id,
    createdAt: Timestamp,
  })
  .meta({ id: 'Remittance', description: 'An agent’s cash, approved for the collections it covers' });
export type Remittance = z.infer<typeof Remittance>;

export const RemittanceList = z
  .object({ items: z.array(Remittance), nextCursor: z.string().nullable() })
  .meta({ id: 'RemittanceList', description: 'Oldest first' });
export type RemittanceList = z.infer<typeof RemittanceList>;

export const RemittanceListQuery = PageQuery.extend({ agentMembershipId: Id.optional() });
export type RemittanceListQuery = z.infer<typeof RemittanceListQuery>;

export const CreateRemittanceRequest = z
  .object({
    agentMembershipId: Id,
    /** The collections the cash covers (Q5); the agent's others stay recorded. */
    collectionIds: z.array(Id).min(1).max(200),
    /** The cash counted: it equals the collections' total. */
    cashMinor: PositiveAmountMinor,
  })
  .meta({ id: 'CreateRemittanceRequest' });
export type CreateRemittanceRequest = z.infer<typeof CreateRemittanceRequest>;

export const WithdrawalRequest = z
  .object({ wallet: z.enum(['savings', 'target']), amountMinor: PositiveAmountMinor })
  .meta({
    id: 'WithdrawalRequest',
    description: 'Cash paid out from the customer’s savings or target savings',
  });
export type WithdrawalRequest = z.infer<typeof WithdrawalRequest>;

export const TargetTransferRequest = z
  .object({ amountMinor: PositiveAmountMinor })
  .meta({ id: 'TargetTransferRequest', description: 'Savings moved into target savings' });
export type TargetTransferRequest = z.infer<typeof TargetTransferRequest>;

export const SavingsMovement = z
  .object({
    movementId: Id,
    customerId: Id,
    kind: z.enum(['savings_withdrawal', 'target_withdrawal', 'to_target']),
    amount: Money,
    entryId: Id,
    createdAt: Timestamp,
  })
  .meta({ id: 'SavingsMovement' });
export type SavingsMovement = z.infer<typeof SavingsMovement>;

export const SavingsMovementList = z
  .object({ items: z.array(SavingsMovement), nextCursor: z.string().nullable() })
  .meta({ id: 'SavingsMovementList', description: 'Oldest first' });
export type SavingsMovementList = z.infer<typeof SavingsMovementList>;

export const TargetGoalRequest = z
  .object({ goalAmountMinor: PositiveAmountMinor.nullable(), goalDate: LedgerDate.nullable() })
  .meta({ id: 'TargetGoalRequest', description: 'An amount and/or a date; both null clears the goal' });
export type TargetGoalRequest = z.infer<typeof TargetGoalRequest>;

export const TargetGoal = z
  .object({
    customerId: Id,
    goalAmount: Money.nullable(),
    goalDate: LedgerDate.nullable(),
    updatedAt: Timestamp,
  })
  .meta({ id: 'TargetGoal' });
export type TargetGoal = z.infer<typeof TargetGoal>;

export const RecordCollectionRequest = z
  .object({ customerId: Id, amountMinor: PositiveAmountMinor })
  .meta({ id: 'RecordCollectionRequest' });
export type RecordCollectionRequest = z.infer<typeof RecordCollectionRequest>;

export const AgentCollection = Collection.pick({
  collectionId: true,
  customerId: true,
  packageId: true,
  amount: true,
  days: true,
  collectedOn: true,
  status: true,
  createdAt: true,
  approvedAt: true,
  cancelledAt: true,
}).meta({ id: 'AgentCollection', description: 'A collection the agent recorded' });
export type AgentCollection = z.infer<typeof AgentCollection>;
export const AgentCollectionList = z
  .object({ items: z.array(AgentCollection), nextCursor: z.string().nullable() })
  .meta({ id: 'AgentCollectionList', description: 'Oldest first' });
export type AgentCollectionList = z.infer<typeof AgentCollectionList>;
export const AgentCollectionListQuery = PageQuery.extend({ status: CollectionStatus.optional() });
export type AgentCollectionListQuery = z.infer<typeof AgentCollectionListQuery>;

export const CustomerCollection = Collection.pick({
  collectionId: true,
  amount: true,
  days: true,
  collectedOn: true,
  status: true,
  fee: true,
  createdAt: true,
  approvedAt: true,
  cancelledAt: true,
}).meta({
  id: 'CustomerCollection',
  description: 'One of the customer’s collections; "recorded" is awaiting the business’s confirmation',
});
export type CustomerCollection = z.infer<typeof CustomerCollection>;
export const CustomerCollectionList = z
  .object({ items: z.array(CustomerCollection), nextCursor: z.string().nullable() })
  .meta({ id: 'CustomerCollectionList', description: 'Oldest first' });
export type CustomerCollectionList = z.infer<typeof CustomerCollectionList>;

const customerParams = z.object({ customerId: Id });
const read = { class: 'permission', permission: 'merchant.savings.read', branchScope: 'branch' } as const;
const readWide = {
  class: 'permission',
  permission: 'merchant.savings.read',
  branchScope: 'merchant_wide',
} as const;
const packages = {
  class: 'permission',
  permission: 'merchant.packages.manage',
  branchScope: 'merchant_wide',
} as const;
const remittances = {
  class: 'permission',
  permission: 'merchant.remittances.approve',
  branchScope: 'merchant_wide',
} as const;
const withdrawals = {
  class: 'permission',
  permission: 'merchant.withdrawals.create',
  branchScope: 'branch',
} as const;
const forbidden = (permission: string) => ({
  403: error(`FORBIDDEN — the caller does not hold ${permission}`),
});
const customerNotFound = { 404: error('NOT_FOUND — no such customer in this business (or in your branch)') };
const idempotency = {
  409: error(
    'IDEMPOTENCY_KEY_REUSED — the key was used with another request; INVALID_LIFECYCLE_TRANSITION — the customer is not active',
  ),
};

export const listSavingsPackages = defineEndpoint({
  id: 'listSavingsPackages',
  method: 'get',
  path: '/v1/merchant/packages',
  authorization: readWide,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'The business’s savings packages',
  request: { query: SavingsPackageQuery },
  responses: {
    200: { description: 'Every package, oldest first', schema: SavingsPackageList },
    ...forbidden('merchant.savings.read'),
  },
});

export const createSavingsPackage = defineEndpoint({
  id: 'createSavingsPackage',
  method: 'post',
  path: '/v1/merchant/packages',
  authorization: packages,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Create a savings package with exactly one fee rule (BR-6.1)',
  request: { body: CreatePackageRequest },
  responses: {
    201: { description: 'The package', schema: SavingsPackage },
    400: error('VALIDATION_ERROR'),
    ...forbidden('merchant.packages.manage'),
    409: error('NAME_TAKEN — an active package of the business has this name'),
  },
});

export const updateSavingsPackage = defineEndpoint({
  id: 'updateSavingsPackage',
  method: 'patch',
  path: '/v1/merchant/packages/{packageId}',
  authorization: packages,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Rename or archive a package (its terms never change)',
  request: { params: z.object({ packageId: Id }), body: UpdatePackageRequest },
  responses: {
    200: { description: 'The package', schema: SavingsPackage },
    400: error('VALIDATION_ERROR'),
    ...forbidden('merchant.packages.manage'),
    404: error('NOT_FOUND — no such package in this business'),
    409: error('NAME_TAKEN — an active package of the business has this name'),
  },
});

export const enrolCustomer = defineEndpoint({
  id: 'enrolCustomer',
  method: 'put',
  path: '/v1/merchant/customers/{customerId}/enrolment',
  authorization: { class: 'permission', permission: 'merchant.packages.manage', branchScope: 'branch' },
  audience: 'merchant',
  security: ['cookieSession'],
  summary:
    'Put a customer on a package (one at a time, BR-5.1); during a cycle the change takes effect with the next (Q10)',
  request: { params: customerParams, body: EnrolRequest },
  responses: {
    200: { description: 'The enrolment', schema: Enrolment },
    ...forbidden('merchant.packages.manage'),
    ...customerNotFound,
    409: error('INVALID_LIFECYCLE_TRANSITION — the customer is not active'),
    422: error('INVALID_PACKAGE — not an active package of the business'),
  },
});

export const getCustomerSavings = defineEndpoint({
  id: 'getCustomerSavings',
  method: 'get',
  path: '/v1/merchant/customers/{customerId}/savings',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'A customer’s package, cycle, balances, collections awaiting confirmation and goal',
  request: { params: customerParams },
  responses: {
    200: { description: 'The customer’s savings', schema: CustomerSavings },
    ...forbidden('merchant.savings.read'),
    ...customerNotFound,
  },
});

export const listSavingsMovements = defineEndpoint({
  id: 'listSavingsMovements',
  method: 'get',
  path: '/v1/merchant/customers/{customerId}/savings/movements',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'A customer’s withdrawals and moves into target savings',
  request: { params: customerParams, query: PageQuery },
  responses: {
    200: { description: 'One page, oldest first', schema: SavingsMovementList },
    400: error('VALIDATION_ERROR; INVALID_CURSOR'),
    ...forbidden('merchant.savings.read'),
    ...customerNotFound,
  },
});

export const listCollections = defineEndpoint({
  id: 'listCollections',
  method: 'get',
  path: '/v1/merchant/collections',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary:
    'The business’s cash collections (a branch-restricted staff member’s branch only), by customer, agent, status or remittance',
  request: { query: CollectionListQuery },
  responses: {
    200: { description: 'One page of collections', schema: CollectionList },
    400: error('VALIDATION_ERROR; INVALID_CURSOR'),
    ...forbidden('merchant.savings.read'),
  },
});

export const cancelCollection = defineEndpoint({
  id: 'cancelCollection',
  method: 'post',
  path: '/v1/merchant/collections/{collectionId}/cancellation',
  authorization: { class: 'permission', permission: 'merchant.remittances.approve', branchScope: 'branch' },
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Cancel a collection recorded by mistake, before approval, with a reason (reversed in the books)',
  request: { params: z.object({ collectionId: Id }), body: CancelCollectionRequest },
  responses: {
    200: { description: 'The collection', schema: Collection },
    400: error('VALIDATION_ERROR'),
    ...forbidden('merchant.remittances.approve'),
    404: error('NOT_FOUND — no such collection in this business (or in your branch)'),
    409: error('INVALID_LIFECYCLE_TRANSITION — already approved or cancelled'),
  },
});

export const listRemittances = defineEndpoint({
  id: 'listRemittances',
  method: 'get',
  path: '/v1/merchant/remittances',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'The business’s remittances',
  request: { query: RemittanceListQuery },
  responses: {
    200: { description: 'One page of remittances', schema: RemittanceList },
    400: error('VALIDATION_ERROR; INVALID_CURSOR'),
    ...forbidden('merchant.savings.read'),
  },
});

export const createRemittance = defineEndpoint({
  id: 'createRemittance',
  method: 'post',
  path: '/v1/merchant/remittances',
  authorization: remittances,
  audience: 'merchant',
  security: ['cookieSession'],
  summary:
    'Approve the collections an agent’s cash covers: the customers are credited and the fees taken, each its own entry',
  request: { body: CreateRemittanceRequest },
  responses: {
    201: { description: 'The remittance', schema: Remittance },
    400: error('VALIDATION_ERROR'),
    ...forbidden('merchant.remittances.approve'),
    404: error('NOT_FOUND — a collection is not this agent’s in this business (or in your branch)'),
    409: error('INVALID_LIFECYCLE_TRANSITION — a collection is already approved or cancelled'),
    422: error(
      'CASH_MISMATCH — the cash is not the collections’ total; INVALID_AGENT — not an agent of the business; INACTIVE_CUSTOMER — a customer is not active (cancel the collection); PACKAGE_CHANGED — a collection was recorded under another package than its cycle’s (cancel it, record it again)',
    ),
  },
});

export const createWithdrawal = defineEndpoint({
  id: 'createWithdrawal',
  method: 'post',
  path: '/v1/merchant/customers/{customerId}/withdrawals',
  authorization: withdrawals,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Pay a customer cash from their savings or target savings (never above the balance, BR-7.4)',
  request: { params: customerParams, headers: IdempotencyKeyHeader, body: WithdrawalRequest },
  responses: {
    201: { description: 'Paid (or, for a retry, the first answer)', schema: SavingsMovement },
    400: error('VALIDATION_ERROR'),
    ...forbidden('merchant.withdrawals.create'),
    ...customerNotFound,
    ...idempotency,
    422: error('INSUFFICIENT_BALANCE — more than the wallet holds'),
  },
});

export const createTargetTransfer = defineEndpoint({
  id: 'createTargetTransfer',
  method: 'post',
  path: '/v1/merchant/customers/{customerId}/target-transfers',
  authorization: withdrawals,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Move a customer’s savings into their target savings',
  request: { params: customerParams, headers: IdempotencyKeyHeader, body: TargetTransferRequest },
  responses: {
    201: { description: 'Moved (or, for a retry, the first answer)', schema: SavingsMovement },
    400: error('VALIDATION_ERROR'),
    ...forbidden('merchant.withdrawals.create'),
    ...customerNotFound,
    ...idempotency,
    422: error('INSUFFICIENT_BALANCE — more than the savings hold'),
  },
});

export const setTargetGoal = defineEndpoint({
  id: 'setTargetGoal',
  method: 'put',
  path: '/v1/merchant/customers/{customerId}/target-goal',
  authorization: withdrawals,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Set or clear a customer’s target-savings goal (an amount and/or a date)',
  request: { params: customerParams, body: TargetGoalRequest },
  responses: {
    200: { description: 'The goal', schema: TargetGoal },
    400: error('VALIDATION_ERROR — a date in the past'),
    ...forbidden('merchant.withdrawals.create'),
    ...customerNotFound,
    409: error('INVALID_LIFECYCLE_TRANSITION — the customer is not active'),
  },
});

// ── agents (BR-3, D1: their own customers now; the database decides) ──

export const recordCollection = defineEndpoint({
  id: 'recordCollection',
  method: 'post',
  path: '/v1/agent/collections',
  authorization: { class: 'self' },
  audience: 'agent',
  security: ['bearer'],
  summary:
    'Record a cash collection from one of the agent’s own customers (counted in their savings once the business approves it)',
  request: { headers: IdempotencyKeyHeader, body: RecordCollectionRequest },
  responses: {
    201: { description: 'Recorded (or, for a retry, the first answer)', schema: AgentCollection },
    400: error('VALIDATION_ERROR'),
    404: error('NOT_FOUND — not one of the agent’s customers'),
    409: error(
      'IDEMPOTENCY_KEY_REUSED — the key was used with another request; INVALID_LIFECYCLE_TRANSITION — the customer is not active',
    ),
    422: error(
      'NOT_ENROLLED — the customer has no package; INVALID_AMOUNT — not the package’s amount or a multiple of it (fixed), or below its minimum (flexible)',
    ),
  },
});

export const listAgentCollections = defineEndpoint({
  id: 'listAgentCollections',
  method: 'get',
  path: '/v1/agent/collections',
  authorization: { class: 'self' },
  audience: 'agent',
  security: ['bearer'],
  summary: 'The collections the signed-in agent recorded',
  request: { query: AgentCollectionListQuery },
  responses: {
    200: { description: 'One page, oldest first', schema: AgentCollectionList },
    400: error('VALIDATION_ERROR; INVALID_CURSOR'),
  },
});

// ── the customer's app (BR-5.6) ──

export const getCustomerSelfSavings = defineEndpoint({
  id: 'getCustomerSelfSavings',
  method: 'get',
  path: '/v1/customer/savings',
  authorization: { class: 'self' },
  audience: 'customer',
  security: ['bearer'],
  summary: 'The signed-in customer’s savings, with what awaits the business’s confirmation',
  responses: { 200: { description: 'The customer’s savings', schema: CustomerSavings } },
});

export const listCustomerSelfCollections = defineEndpoint({
  id: 'listCustomerSelfCollections',
  method: 'get',
  path: '/v1/customer/savings/collections',
  authorization: { class: 'self' },
  audience: 'customer',
  security: ['bearer'],
  summary: 'The signed-in customer’s collections, pending ones included',
  request: { query: PageQuery },
  responses: {
    200: { description: 'One page, oldest first', schema: CustomerCollectionList },
    400: error('VALIDATION_ERROR; INVALID_CURSOR'),
  },
});
