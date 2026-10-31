import { z } from 'zod';
import { ErrorResponse, Id, Money, PageQuery } from '../primitives.js';
import { defineEndpoint } from '../registry.js';
import { Timestamp } from './merchant.js';

// Payments (P9; docs/architecture/P9_IMPLEMENTATION_PLAN.md; the owner's answers of 2026-10-26,
// docs/business/P9_OWNER_PAYMENTS.md). Three audiences:
//   /v1/merchant/wallet — the business: its Live wallet, the money received, and recording what it was for (Q1).
//   /v1/platform/payments, /v1/platform/wallet — AlphaKolect's team: every wallet, money we have no record of (Q4),
//     differences found by reconciliation (Q5), and the Platform Live wallet (Q6). Each page of a platform list is
//     recorded in the activity record.
//   /v1/webhooks/transactpay — TransactPay's notifications: stored, answered, and acted on only after the worker has
//     confirmed the transaction with TransactPay. Nothing in a notification is trusted.

const error = (description: string) => ({ description, schema: ErrorResponse });
const rateLimited = {
  ...error('RATE_LIMITED'),
  headers: z.object({ 'retry-after': z.string().meta({ description: 'Seconds to wait' }) }),
};

export const LiveWallet = z
  .object({
    /** 'none' until the business's wallet has been requested, moments after its email is confirmed (BR-2.3). */
    status: z.enum(['none', 'provisioning', 'active', 'failed', 'closed']),
    accountNumber: z.string().nullable(),
    accountName: z.string().nullable(),
    bankName: z.string().nullable(),
    balance: Money,
    /** Money received that the business has not yet recorded the purpose of (Q1). */
    toClassify: Money,
    activatedAt: Timestamp.nullable(),
  })
  .meta({ id: 'LiveWallet', description: 'The business’s Live wallet: its bank virtual account' });
export type LiveWallet = z.infer<typeof LiveWallet>;

export const WalletReceipt = z
  .object({
    receiptId: Id,
    amount: Money,
    receivedAt: Timestamp.nullable(),
    classifiedAccountId: Id.nullable(),
    classifiedNote: z.string().nullable(),
    classifiedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'WalletReceipt', description: 'Money received in the Live wallet' });
export type WalletReceipt = z.infer<typeof WalletReceipt>;

export const WalletReceiptList = z
  .object({ items: z.array(WalletReceipt), nextCursor: z.string().nullable() })
  .meta({ id: 'WalletReceiptList', description: 'Oldest first' });
export type WalletReceiptList = z.infer<typeof WalletReceiptList>;

export const WalletReceiptQuery = PageQuery.extend({
  /** "true" or "false": only those classified, or not yet. */
  classified: z.enum(['true', 'false']).optional(),
});
export type WalletReceiptQuery = z.infer<typeof WalletReceiptQuery>;

export const ClassifyReceiptRequest = z
  .object({
    /** One of the business's own accounts: not a customer's or an agent's. */
    accountId: Id,
    note: z.string().trim().min(1).max(300).optional(),
  })
  .meta({ id: 'ClassifyReceiptRequest' });
export type ClassifyReceiptRequest = z.infer<typeof ClassifyReceiptRequest>;

export const PlatformWallet = z
  .object({
    walletId: Id,
    ownerKind: z.enum(['merchant', 'platform', 'customer']),
    merchantId: Id.nullable(),
    merchantName: z.string().nullable(),
    status: z.enum(['provisioning', 'active', 'failed', 'closed']),
    accountNumber: z.string().nullable(),
    bankName: z.string().nullable(),
    attempts: z.number().int(),
    lastError: z.string().nullable(),
    /** The balance of the account it mirrors in the books; null for a customer's (OPEN-12). */
    books: Money.nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'PlatformWallet', description: 'A Live wallet, as AlphaKolect’s team sees it' });
export type PlatformWallet = z.infer<typeof PlatformWallet>;
export const PlatformWalletList = z
  .object({ items: z.array(PlatformWallet), nextCursor: z.string().nullable() })
  .meta({ id: 'PlatformWalletList', description: 'Newest first' });
export type PlatformWalletList = z.infer<typeof PlatformWalletList>;

export const UnmatchedTransaction = z
  .object({
    transactionId: Id,
    provider: z.string(),
    providerTxId: z.string(),
    accountNumber: z.string().nullable(),
    amount: Money,
    providerStatus: z.enum(['successful', 'failed', 'reversed']),
    /** 'unmatched': nobody's books hold it. 'review': TransactPay later said something that contradicts the record. */
    matched: z.enum(['unmatched', 'review']),
    merchantId: Id.nullable(),
    occurredAt: Timestamp.nullable(),
    confirmedAt: Timestamp,
  })
  .meta({ id: 'UnmatchedTransaction', description: 'A provider transaction waiting for a person' });
export type UnmatchedTransaction = z.infer<typeof UnmatchedTransaction>;
export const UnmatchedTransactionList = z
  .object({ items: z.array(UnmatchedTransaction), nextCursor: z.string().nullable() })
  .meta({ id: 'UnmatchedTransactionList', description: 'Newest first' });
export type UnmatchedTransactionList = z.infer<typeof UnmatchedTransactionList>;

export const ResolveUnmatchedRequest = z
  .object({
    resolution: z.enum(['credited', 'returned', 'dismissed']),
    /** The business's wallet to credit: required for 'credited'. */
    walletId: Id.optional(),
    note: z.string().trim().min(1).max(500),
  })
  .refine((v) => (v.resolution === 'credited') === (v.walletId !== undefined), {
    message: 'a wallet exactly when crediting',
    path: ['walletId'],
  })
  .meta({ id: 'ResolveUnmatchedRequest' });
export type ResolveUnmatchedRequest = z.infer<typeof ResolveUnmatchedRequest>;

export const ResolvedTransaction = z
  .object({
    transactionId: Id,
    resolution: z.enum(['credited', 'returned', 'dismissed']),
    merchantId: Id.nullable(),
    resolvedAt: Timestamp,
  })
  .meta({ id: 'ResolvedTransaction' });
export type ResolvedTransaction = z.infer<typeof ResolvedTransaction>;

export const ReconciliationFinding = z
  .object({
    findingId: Id,
    scope: z.enum(['wallet', 'pooled', 'event']),
    walletId: Id.nullable(),
    merchantId: Id.nullable(),
    provider: Money,
    books: Money,
    status: z.enum(['open', 'resolved']),
    foundAt: Timestamp,
    lastSeenAt: Timestamp,
    resolutionNote: z.string().nullable(),
    resolvedAt: Timestamp.nullable(),
  })
  .meta({ id: 'ReconciliationFinding', description: 'A difference between the books and TransactPay' });
export type ReconciliationFinding = z.infer<typeof ReconciliationFinding>;
export const ReconciliationFindingList = z
  .object({ items: z.array(ReconciliationFinding), nextCursor: z.string().nullable() })
  .meta({ id: 'ReconciliationFindingList', description: 'Newest first' });
export type ReconciliationFindingList = z.infer<typeof ReconciliationFindingList>;

export const FindingListQuery = PageQuery.extend({
  /** "open" (the default) or "all". */
  status: z.enum(['open', 'all']).default('open'),
});
export type FindingListQuery = z.infer<typeof FindingListQuery>;

export const ResolveFindingRequest = z
  .object({ note: z.string().trim().min(1).max(500) })
  .meta({ id: 'ResolveFindingRequest' });
export type ResolveFindingRequest = z.infer<typeof ResolveFindingRequest>;

export const ResolvedFinding = z
  .object({ findingId: Id, resolutionNote: z.string(), resolvedAt: Timestamp })
  .meta({ id: 'ResolvedFinding' });
export type ResolvedFinding = z.infer<typeof ResolvedFinding>;

export const PlatformWalletRequested = z
  .object({
    walletId: Id,
    status: z.enum(['provisioning', 'active', 'failed', 'closed']),
    createdAt: Timestamp,
  })
  .meta({ id: 'PlatformWalletRequested', description: 'The worker creates the account at TransactPay' });
export type PlatformWalletRequested = z.infer<typeof PlatformWalletRequested>;

const merchantPermission = (permission: 'merchant.wallet.read' | 'merchant.wallet.classify') =>
  ({ class: 'permission', permission, branchScope: 'merchant_wide' }) as const;
const platformPermission = (
  permission: 'platform.payments.read' | 'platform.payments.resolve' | 'platform.wallet.create',
) => ({ class: 'permission', permission, branchScope: 'merchant_wide' }) as const;
const forbidden = (permission: string) => ({
  403: error(`FORBIDDEN — the caller does not hold ${permission}`),
});
const pageRefused = {
  400: error('VALIDATION_ERROR; INVALID_CURSOR — not a cursor of this list'),
  ...forbidden('platform.payments.read'),
};

export const getMerchantWallet = defineEndpoint({
  id: 'getMerchantWallet',
  method: 'get',
  path: '/v1/merchant/wallet',
  authorization: merchantPermission('merchant.wallet.read'),
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'The business’s Live wallet: its account number, balance and the money still to classify',
  responses: { 200: { description: 'The wallet', schema: LiveWallet }, ...forbidden('merchant.wallet.read') },
});

export const listWalletReceipts = defineEndpoint({
  id: 'listWalletReceipts',
  method: 'get',
  path: '/v1/merchant/wallet/receipts',
  authorization: merchantPermission('merchant.wallet.read'),
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'The money received in the Live wallet',
  request: { query: WalletReceiptQuery },
  responses: {
    200: { description: 'One page of receipts', schema: WalletReceiptList },
    400: error('VALIDATION_ERROR; INVALID_CURSOR'),
    ...forbidden('merchant.wallet.read'),
  },
});

export const classifyWalletReceipt = defineEndpoint({
  id: 'classifyWalletReceipt',
  method: 'post',
  path: '/v1/merchant/wallet/receipts/{receiptId}/classification',
  authorization: merchantPermission('merchant.wallet.classify'),
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Record what money received was for (moved from "to classify" to the account chosen)',
  request: { params: z.object({ receiptId: Id }), body: ClassifyReceiptRequest },
  responses: {
    200: { description: 'The receipt', schema: WalletReceipt },
    400: error('VALIDATION_ERROR'),
    ...forbidden('merchant.wallet.classify'),
    404: error('NOT_FOUND — no such receipt in this business'),
    409: error('ALREADY_CLASSIFIED'),
    422: error('INVALID_ACCOUNT — not one of the business’s own active accounts'),
  },
});

export const listPlatformWallets = defineEndpoint({
  id: 'listPlatformWallets',
  method: 'get',
  path: '/v1/platform/payments/wallets',
  authorization: platformPermission('platform.payments.read'),
  audience: 'platform',
  security: ['cookieSession'],
  summary: 'Every Live wallet, newest first (each page is recorded in the activity record)',
  request: { query: PageQuery },
  responses: { 200: { description: 'One page of wallets', schema: PlatformWalletList }, ...pageRefused },
});

export const listPlatformUnmatched = defineEndpoint({
  id: 'listPlatformUnmatched',
  method: 'get',
  path: '/v1/platform/payments/unmatched',
  authorization: platformPermission('platform.payments.read'),
  audience: 'platform',
  security: ['cookieSession'],
  summary: 'Money we have no record of, and transactions under review (each page is recorded)',
  request: { query: PageQuery },
  responses: { 200: { description: 'One page', schema: UnmatchedTransactionList }, ...pageRefused },
});

export const listPlatformFindings = defineEndpoint({
  id: 'listPlatformFindings',
  method: 'get',
  path: '/v1/platform/payments/findings',
  authorization: platformPermission('platform.payments.read'),
  audience: 'platform',
  security: ['cookieSession'],
  summary: 'Differences between the books and TransactPay (each page is recorded)',
  request: { query: FindingListQuery },
  responses: { 200: { description: 'One page', schema: ReconciliationFindingList }, ...pageRefused },
});

export const resolveUnmatchedTransaction = defineEndpoint({
  id: 'resolveUnmatchedTransaction',
  method: 'post',
  path: '/v1/platform/payments/unmatched/{transactionId}/resolution',
  authorization: platformPermission('platform.payments.resolve'),
  audience: 'platform',
  security: ['cookieSession'],
  summary: 'Credit money we had no record of to a business, or note that it was returned or dismissed',
  request: { params: z.object({ transactionId: Id }), body: ResolveUnmatchedRequest },
  responses: {
    200: { description: 'Resolved', schema: ResolvedTransaction },
    400: error('VALIDATION_ERROR'),
    ...forbidden('platform.payments.resolve'),
    404: error('NOT_FOUND'),
    409: error('INVALID_LIFECYCLE_TRANSITION — already resolved, or it cannot be credited'),
    422: error('INVALID_WALLET — not an active business wallet'),
  },
});

export const resolveReconciliationFinding = defineEndpoint({
  id: 'resolveReconciliationFinding',
  method: 'post',
  path: '/v1/platform/payments/findings/{findingId}/resolution',
  authorization: platformPermission('platform.payments.resolve'),
  audience: 'platform',
  security: ['cookieSession'],
  summary: 'Close a difference that has been understood, with a note',
  request: { params: z.object({ findingId: Id }), body: ResolveFindingRequest },
  responses: {
    200: { description: 'Resolved', schema: ResolvedFinding },
    400: error('VALIDATION_ERROR'),
    ...forbidden('platform.payments.resolve'),
    404: error('NOT_FOUND'),
    409: error('INVALID_LIFECYCLE_TRANSITION — already resolved'),
  },
});

export const createPlatformWallet = defineEndpoint({
  id: 'createPlatformWallet',
  method: 'post',
  path: '/v1/platform/wallet',
  authorization: platformPermission('platform.wallet.create'),
  audience: 'platform',
  security: ['cookieSession'],
  summary: 'Request AlphaKolect’s Platform Live wallet, once (the super admin only)',
  responses: {
    201: { description: 'Requested', schema: PlatformWalletRequested },
    ...forbidden('platform.wallet.create'),
    409: error('ALREADY_EXISTS'),
  },
});

export const receiveTransactPayEvent = defineEndpoint({
  id: 'receiveTransactPayEvent',
  method: 'post',
  path: '/v1/webhooks/transactpay',
  authorization: { class: 'public' },
  audience: 'public',
  summary: 'TransactPay’s notifications: stored, then confirmed with TransactPay before anything is done',
  request: { body: z.looseObject({}).meta({ id: 'ProviderEventBody' }) },
  responses: {
    200: { description: 'Stored', schema: z.object({ received: z.literal(true) }) },
    400: error('VALIDATION_ERROR'),
    413: error('PAYLOAD_TOO_LARGE'),
    429: rateLimited,
  },
});
