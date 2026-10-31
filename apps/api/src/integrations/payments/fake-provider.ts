import { assertPositive, ngn, type Money } from '../../platform/money.js';
import {
  ProviderError,
  type BankAccount,
  type Page,
  type PaymentProvider,
  type ProviderEvent,
  type ProviderTransaction,
  type ProviderTxRef,
  type VaOwner,
  type VaRef,
  type VirtualAccountRef,
  type VirtualAccountState,
} from './provider.js';

type Account = { state: VirtualAccountState; balance: bigint };

const PAGE_SIZE = 50;

/**
 * Deterministic in-memory PaymentProvider for local development and tests (§12, §23).
 * Ids and account numbers are sequential, so test output is stable. Not for production.
 */
export class FakeProvider implements PaymentProvider {
  readonly name = 'fake';
  readonly requestTimeoutMs = 0;
  readonly capabilities: PaymentProvider['capabilities'];

  private readonly accounts = new Map<string, Account>();
  private readonly transactions: ProviderTransaction[] = [];
  private readonly vaByIdempotencyKey = new Map<string, { ownerKey: string; ref: VirtualAccountRef }>();
  private readonly txByIdempotencyKey = new Map<string, { fingerprint: string; ref: ProviderTxRef }>();
  private seq = 0;
  private readonly lookupDelays = new Map<string, number>();
  private readonly failures: {
    op: 'create' | 'transfer' | 'get' | 'find';
    code: ProviderError['code'];
    afterEffect: boolean;
    match: string | undefined;
  }[] = [];

  constructor(
    private readonly clock: () => Date = () => new Date(),
    capabilities: Partial<PaymentProvider['capabilities']> = {},
  ) {
    this.capabilities = {
      listTransactions: true,
      perAccountBalance: true,
      vaTransfer: true,
      ...capabilities,
    };
  }

  async createVirtualAccount(owner: VaOwner, idempotencyKey: string): Promise<VirtualAccountRef> {
    const failure = this.takeFailure('create', idempotencyKey);
    if (failure && !failure.afterEffect) throw new ProviderError(failure.code, 'Injected failure');
    const ref = this.createAccount(owner, idempotencyKey);
    if (failure) throw new ProviderError(failure.code, 'Injected failure, after the account was created');
    return ref;
  }

  async findVirtualAccountByAlias(alias: string): Promise<VirtualAccountRef | null> {
    const failure = this.takeFailure('find', alias);
    if (failure) throw new ProviderError(failure.code, 'Injected failure');
    // Read before the delay: a slow answer can be out of date by the time it arrives.
    const found = this.vaByIdempotencyKey.get(alias)?.ref ?? null;
    const delay = this.lookupDelays.get(alias);
    if (delay !== undefined) {
      this.lookupDelays.delete(alias);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return found;
  }

  private createAccount(owner: VaOwner, idempotencyKey: string): VirtualAccountRef {
    const ownerKey = `${owner.kind}:${owner.ownerId}`;
    const existing = this.vaByIdempotencyKey.get(idempotencyKey);
    if (existing) {
      if (existing.ownerKey !== ownerKey) {
        throw new ProviderError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused for a different owner');
      }
      return existing.ref;
    }

    const n = ++this.seq;
    const ref: VirtualAccountRef = {
      providerRef: `fake-va-${n}`,
      accountNumber: String(9_900_000_000 + n),
      accountName: owner.name,
      bankName: 'Fake Bank',
    };
    this.accounts.set(ref.providerRef, { state: { ...ref, status: 'active' }, balance: 0n });
    this.vaByIdempotencyKey.set(idempotencyKey, { ownerKey, ref });
    return ref;
  }

  async getVirtualAccount(providerRef: string): Promise<VirtualAccountState> {
    return this.account(providerRef).state;
  }

  async transfer(
    from: VaRef,
    to: VaRef | BankAccount,
    amount: Money,
    reference: string,
    idempotencyKey: string,
  ): Promise<ProviderTxRef> {
    const failure = this.takeFailure('transfer', reference);
    if (failure && !failure.afterEffect) throw new ProviderError(failure.code, 'Injected failure');
    const ref = this.doTransfer(from, to, amount, reference, idempotencyKey);
    if (failure) throw new ProviderError(failure.code, 'Injected failure, after the transfer was made');
    return ref;
  }

  async findTransferByReference(reference: string): Promise<ProviderTxRef | null> {
    const tx = this.transactions.find((t) => t.reference === reference && t.from.kind === 'va');
    return tx ? { providerTxId: tx.providerTxId, status: tx.status } : null;
  }

  private doTransfer(
    from: VaRef,
    to: VaRef | BankAccount,
    amount: Money,
    reference: string,
    idempotencyKey: string,
  ): ProviderTxRef {
    const fingerprint = JSON.stringify([from, to, amount.amountMinor.toString(), amount.currency, reference]);
    const existing = this.txByIdempotencyKey.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ProviderError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused for a different transfer');
      }
      return existing.ref;
    }

    this.validateAmount(amount);
    const source = this.activeAccount(from.providerRef);
    const destination = to.kind === 'va' ? this.activeAccount(to.providerRef) : undefined;
    if (source.balance < amount.amountMinor) {
      throw new ProviderError('INSUFFICIENT_FUNDS', 'Insufficient funds in source account');
    }

    source.balance -= amount.amountMinor;
    if (destination) destination.balance += amount.amountMinor;

    const tx = this.record({ reference, amount, from, to });
    const ref: ProviderTxRef = { providerTxId: tx.providerTxId, status: tx.status };
    this.txByIdempotencyKey.set(idempotencyKey, { fingerprint, ref });
    return ref;
  }

  async getTransaction(providerTxId: string): Promise<ProviderTransaction> {
    const failure = this.takeFailure('get', providerTxId);
    if (failure) throw new ProviderError(failure.code, 'Injected failure');
    const tx = this.transactions.find((t) => t.providerTxId === providerTxId);
    if (!tx) throw new ProviderError('NOT_FOUND', 'Transaction not found');
    return tx;
  }

  async listTransactions(account: VaRef, since: Date, cursor?: string): Promise<Page<ProviderTransaction>> {
    this.account(account.providerRef);
    const touches = (t: ProviderTransaction) =>
      (t.from.kind === 'va' && t.from.providerRef === account.providerRef) ||
      (t.to.kind === 'va' && t.to.providerRef === account.providerRef);
    const start = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isInteger(start) || start < 0) throw new ProviderError('INVALID_REQUEST', 'Invalid cursor');

    const matching = this.transactions.filter((t) => touches(t) && t.createdAt >= since);
    const items = matching.slice(start, start + PAGE_SIZE);
    const next = start + items.length;
    return next < matching.length ? { items, nextCursor: String(next) } : { items };
  }

  async getBalance(account?: VaRef): Promise<Money> {
    if (account) return ngn(this.account(account.providerRef).balance);
    let total = 0n;
    for (const a of this.accounts.values()) total += a.balance;
    return ngn(total);
  }

  parseEvent(raw: unknown, _headers: Readonly<Record<string, string | undefined>>): ProviderEvent {
    if (typeof raw !== 'object' || raw === null || typeof (raw as { type?: unknown }).type !== 'string') {
      throw new ProviderError('INVALID_EVENT', 'Event payload is not recognised');
    }
    const { type, providerTxId } = raw as { type: string; providerTxId?: unknown };
    return {
      verified: false,
      type,
      ...(typeof providerTxId === 'string' ? { providerTxId } : {}),
      raw,
    };
  }

  async closeVirtualAccount(providerRef: string): Promise<void> {
    const account = this.account(providerRef);
    account.state = { ...account.state, status: 'closed' };
  }

  // ── Test/dev helpers (not part of PaymentProvider) ────────────────────────────────

  /**
   * The next call of `op` (for this alias, reference or transaction id, if given) fails with `code`; with `afterEffect`,
   * only after it has taken effect (a lost answer).
   */
  failNext(
    op: 'create' | 'transfer' | 'get' | 'find',
    code: ProviderError['code'],
    { afterEffect = false, match }: { afterEffect?: boolean; match?: string } = {},
  ): void {
    this.failures.push({ op, code, afterEffect, match });
  }

  /** The next lookup of this alias answers only after `ms`, with what was true when it was asked. */
  delayNextLookup(alias: string, ms: number): void {
    this.lookupDelays.set(alias, ms);
  }

  /** Move money in a VA behind the books' back: a difference for the reconciler to find. */
  adjustBalance(account: VaRef, deltaMinor: bigint): void {
    this.account(account.providerRef).balance += deltaMinor;
  }

  /** The provider's later word on a transaction: a reversal or a failure. */
  setTransactionStatus(providerTxId: string, status: ProviderTransaction['status']): void {
    const at = this.transactions.findIndex((t) => t.providerTxId === providerTxId);
    if (at < 0) throw new ProviderError('NOT_FOUND', 'Transaction not found');
    this.transactions[at] = { ...this.transactions[at]!, status };
  }

  /** How many transfers were really made: what a test of "never sent twice" counts. */
  get transferCount(): number {
    return this.transactions.filter((t) => t.from.kind === 'va').length;
  }

  /** How many accounts were really created. */
  get accountCount(): number {
    return this.accounts.size;
  }

  /** Simulate money arriving into a VA from outside the provider; returns the webhook payload. */
  simulateInboundTransfer(
    to: VaRef,
    amount: Money,
    reference: string,
  ): { type: string; providerTxId: string } {
    this.validateAmount(amount);
    this.activeAccount(to.providerRef).balance += amount.amountMinor;
    const tx = this.record({ reference, amount, from: { kind: 'external', description: 'inbound' }, to });
    return { type: 'transfer.inbound', providerTxId: tx.providerTxId };
  }

  // ── internals ─────────────────────────────────────────────────────────────────────

  private record(tx: Pick<ProviderTransaction, 'reference' | 'amount' | 'from' | 'to'>): ProviderTransaction {
    const toAccountNumber =
      tx.to.kind === 'va' ? this.accounts.get(tx.to.providerRef)?.state.accountNumber : undefined;
    const full: ProviderTransaction = {
      ...tx,
      ...(toAccountNumber ? { toAccountNumber } : {}),
      providerTxId: `fake-tx-${++this.seq}`,
      status: 'successful',
      createdAt: this.clock(),
    };
    this.transactions.push(full);
    return full;
  }

  private takeFailure(op: 'create' | 'transfer' | 'get' | 'find', key: string) {
    const at = this.failures.findIndex((f) => f.op === op && (f.match === undefined || f.match === key));
    return at < 0 ? undefined : this.failures.splice(at, 1)[0];
  }

  private validateAmount(amount: Money): void {
    try {
      assertPositive(amount);
    } catch (err) {
      throw new ProviderError('INVALID_REQUEST', (err as Error).message);
    }
  }

  private account(providerRef: string): Account {
    const account = this.accounts.get(providerRef);
    if (!account) throw new ProviderError('NOT_FOUND', 'Virtual account not found');
    return account;
  }

  private activeAccount(providerRef: string): Account {
    const account = this.account(providerRef);
    if (account.state.status !== 'active')
      throw new ProviderError('ACCOUNT_CLOSED', 'Virtual account is closed');
    return account;
  }
}
