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

export type ProviderTxStatus = 'pending' | 'successful' | 'failed' | 'reversed';

export type ProviderTxRef = Readonly<{ providerTxId: string; status: ProviderTxStatus }>;

export type ProviderTransaction = Readonly<{
  providerTxId: string;
  reference: string;
  status: ProviderTxStatus;
  amount: Money;
  from: VaRef | ExternalSource;
  to: VaRef | BankAccount;
  /** The account the money arrived in, as the provider names it: what a credit is matched by (P9). */
  toAccountNumber?: string;
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
      | 'INVALID_EVENT'
      /** A timeout, no answer or a server error: the request may or may not have taken effect (TA-8). */
      | 'UNKNOWN_OUTCOME'
      /** The provider does not offer this (see capabilities). */
      | 'UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface PaymentProvider {
  readonly name: string;
  /** What this provider offers beyond the core; the worker adapts (P9-3). */
  /** The longest one call can take before it gives up: the worker's lease has to outlast it (P9-R3). */
  readonly requestTimeoutMs: number;
  readonly capabilities: Readonly<{
    listTransactions: boolean;
    perAccountBalance: boolean;
    vaTransfer: boolean;
  }>;
  /** The idempotency key is the wallet's alias, whatever the provider guarantees: see findVirtualAccountByAlias. */
  createVirtualAccount(owner: VaOwner, idempotencyKey: string): Promise<VirtualAccountRef>;
  /** The account created under an alias, if any: what a retry asks first, so a timeout never creates a second one. */
  findVirtualAccountByAlias(alias: string): Promise<VirtualAccountRef | null>;
  getVirtualAccount(providerRef: string): Promise<VirtualAccountState>;
  transfer(
    from: VaRef,
    to: VaRef | BankAccount,
    amount: Money,
    reference: string,
    idempotencyKey: string,
  ): Promise<ProviderTxRef>;
  /** A transfer by our own reference, if the provider has it: how an order in doubt is settled (TA-8). */
  findTransferByReference(reference: string): Promise<ProviderTxRef | null>;
  /** Verification source of truth for any event. */
  getTransaction(providerTxId: string): Promise<ProviderTransaction>;
  /** For polling/reconciliation; transactions touching `account`, oldest first. */
  listTransactions(account: VaRef, since: Date, cursor?: string): Promise<Page<ProviderTransaction>>;
  /** Balance of one VA, or the provider-wide (pooled) balance when `account` is omitted. */
  getBalance(account?: VaRef): Promise<Money>;
  parseEvent(raw: unknown, headers: Readonly<Record<string, string | undefined>>): ProviderEvent;
  closeVirtualAccount?(providerRef: string): Promise<void>;
}
