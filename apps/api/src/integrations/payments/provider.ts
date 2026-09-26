import type { Money } from '../../platform/money.js';

// Payment provider port (ADR-8, TARGET_ARCHITECTURE §12). Domain code depends on this interface only;
// TransactPay is one adapter (built in P9), FakeProvider is the deterministic local/test adapter.

export type VaOwner = Readonly<{
  kind: 'merchant' | 'customer' | 'platform';
  ownerId: string;
  name: string;
}>;

export type VirtualAccountRef = Readonly<{
  providerRef: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
}>;

export type VirtualAccountState = VirtualAccountRef & Readonly<{ status: 'active' | 'closed' }>;

export type VaRef = Readonly<{ kind: 'va'; providerRef: string }>;
export type BankAccount = Readonly<{ kind: 'bank'; bankCode: string; accountNumber: string }>;
/** Money arriving from outside the provider (e.g. a customer's bank transfer into a VA). */
export type ExternalSource = Readonly<{ kind: 'external'; description: string }>;

export type ProviderTxStatus = 'pending' | 'successful' | 'failed';

export type ProviderTxRef = Readonly<{ providerTxId: string; status: ProviderTxStatus }>;

export type ProviderTransaction = Readonly<{
  providerTxId: string;
  reference: string;
  status: ProviderTxStatus;
  amount: Money;
  from: VaRef | ExternalSource;
  to: VaRef | BankAccount;
  createdAt: Date;
}>;

export type Page<T> = Readonly<{ items: readonly T[]; nextCursor?: string }>;

/**
 * A provider event exactly as received. It is UNTRUSTED: consumers must re-fetch the transaction
 * with getTransaction() before acting on it (§12), and deduplicate on (provider, providerTxId).
 */
export type ProviderEvent = Readonly<{
  verified: false;
  type: string;
  providerTxId?: string;
  raw: unknown;
}>;

export class ProviderError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'INSUFFICIENT_FUNDS'
      | 'ACCOUNT_CLOSED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'INVALID_REQUEST'
      | 'INVALID_EVENT',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface PaymentProvider {
  readonly name: string;
  createVirtualAccount(owner: VaOwner, idempotencyKey: string): Promise<VirtualAccountRef>;
  getVirtualAccount(providerRef: string): Promise<VirtualAccountState>;
  transfer(
    from: VaRef,
    to: VaRef | BankAccount,
    amount: Money,
    reference: string,
    idempotencyKey: string,
  ): Promise<ProviderTxRef>;
  /** Verification source of truth for any event. */
  getTransaction(providerTxId: string): Promise<ProviderTransaction>;
  /** For polling/reconciliation; transactions touching `account`, oldest first. */
  listTransactions(account: VaRef, since: Date, cursor?: string): Promise<Page<ProviderTransaction>>;
  /** Balance of one VA, or the provider-wide (pooled) balance when `account` is omitted. */
  getBalance(account?: VaRef): Promise<Money>;
  parseEvent(raw: unknown, headers: Readonly<Record<string, string | undefined>>): ProviderEvent;
  closeVirtualAccount?(providerRef: string): Promise<void>;
}
