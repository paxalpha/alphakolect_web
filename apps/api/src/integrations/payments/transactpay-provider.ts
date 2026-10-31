import { constants, createPublicKey, publicEncrypt } from 'node:crypto';
import { ngn, type Money } from '../../platform/money.js';
import {
  ProviderError,
  type BankAccount,
  type Page,
  type PaymentProvider,
  type ProviderEvent,
  type ProviderTransaction,
  type ProviderTxRef,
  type ProviderTxStatus,
  type VaOwner,
  type VaRef,
  type VirtualAccountRef,
  type VirtualAccountState,
} from './provider.js';

// The TransactPay adapter (P9; docs/business/P9_TRANSACTPAY_QUESTIONS.md). It uses only what the old system's client or
// TransactPay's published documentation establish: virtual accounts by alias (RSA-encrypted creation), a session's
// funding details, the payout balance, bank payouts and their requery by our reference. What neither establishes it
// declares unsupported (VA-to-VA transfers D1, listing C4, a per-account balance B4, closing B3), and relies on no
// provider guarantee that is unconfirmed (idempotency B1, D2): the worker looks an alias or a reference up instead of
// repeating a request. A timeout, a network failure or a server error is UNKNOWN_OUTCOME, never a failure (TA-8).
// Secrets come from the configuration and are never logged; errors carry no response bodies.

export type TransactPayConfig = Readonly<{
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  /** The account's RSA key as TransactPay issues it: base64 of an optional "4096!" prefix and <RSAKeyValue> XML. */
  encryptionKey: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}>;

type Json = Record<string, unknown>;

/** Naira as the API writes them ("1500", 1500.5, "1,500.00") to kobo; more than two decimals are cut (a balance). */
function nairaToKobo(value: unknown, what: string): bigint {
  const text = String(value ?? '')
    .replace(/,/g, '')
    .trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new ProviderError('INVALID_EVENT', `${what} is not an amount`);
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0').slice(0, 2));
}
const koboToNaira = (minor: bigint) => `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;

/** The published status table: 1 Initiated, 2 Pending, 3 Awaiting-Confirmation, 4 Failed, 5 Successful, 6 Reversed, 7 Processing. */
function statusOf(data: Json): ProviderTxStatus {
  const id = Number(data.statusId ?? data.status_id ?? data.StatusId);
  if (id === 5) return 'successful';
  if (id === 4) return 'failed';
  if (id === 6) return 'reversed';
  if ([1, 2, 3, 7].includes(id)) return 'pending';
  const text = String(data.status ?? data.Status ?? '').toLowerCase();
  if (['successful', 'success', 'completed'].includes(text)) return 'successful';
  if (['failed', 'failure', 'declined'].includes(text)) return 'failed';
  if (text === 'reversed') return 'reversed';
  // Anything unrecognised is not final: it is looked at again, and never credited.
  return 'pending';
}

const firstString = (data: Json, ...names: string[]): string | undefined => {
  for (const name of names) {
    const v = data[name];
    if ((typeof v === 'string' && v.length > 0) || typeof v === 'number') return String(v);
  }
  return undefined;
};

export class TransactPayProvider implements PaymentProvider {
  readonly name = 'transactpay';
  readonly capabilities = { listTransactions: false, perAccountBalance: false, vaTransfer: false } as const;

  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: TransactPayConfig) {
    this.fetch = config.fetch ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? 20_000;
  }

  /** The idempotency key is the wallet's alias: the account is tied to it, and found by it after a timeout. */
  async createVirtualAccount(_owner: VaOwner, idempotencyKey: string): Promise<VirtualAccountRef> {
    const { status, body } = await this.call(
      'POST',
      '/payment/virtual-account/generate',
      this.config.publicKey,
      {
        encryption: 'RSA',
        body: { data: this.encrypt({ Alias: idempotencyKey }) },
      },
    );
    if (status >= 400 || !this.succeeded(body)) {
      throw new ProviderError('INVALID_REQUEST', `Virtual account refused (HTTP ${status})`);
    }
    return this.accountRef(idempotencyKey, (body.data as Json | undefined) ?? body);
  }

  async findVirtualAccountByAlias(alias: string): Promise<VirtualAccountRef | null> {
    const { status, body } = await this.call(
      'GET',
      `/payment/account-details?alias=${encodeURIComponent(alias)}`,
      this.config.secretKey,
    );
    if (status === 404 || !this.succeeded(body)) return null;
    const data = (body.data as Json | undefined) ?? body;
    return firstString(data, 'accountNumber', 'account_number') ? this.accountRef(alias, data) : null;
  }

  async getVirtualAccount(providerRef: string): Promise<VirtualAccountState> {
    const ref = await this.findVirtualAccountByAlias(providerRef);
    if (!ref) throw new ProviderError('NOT_FOUND', 'Virtual account not found');
    return { ...ref, status: 'active' };
  }

  async transfer(
    _from: VaRef,
    to: VaRef | BankAccount,
    amount: Money,
    reference: string,
    _idempotencyKey: string,
  ): Promise<ProviderTxRef> {
    if (to.kind !== 'bank') throw new ProviderError('UNSUPPORTED', 'No documented VA-to-VA transfer');
    const { status, body } = await this.call('POST', '/payout/initiate', this.config.secretKey, {
      body: {
        clientReference: reference,
        accountNumber: to.accountNumber,
        bankCode: to.bankCode,
        amount: koboToNaira(amount.amountMinor),
        creditCurrency: amount.currency,
        debitCurrency: amount.currency,
      },
    });
    if (status >= 400) throw new ProviderError('INVALID_REQUEST', `Payout refused (HTTP ${status})`);
    const data = (body.data as Json | undefined) ?? body;
    return {
      providerTxId: firstString(data, 'reference', 'providerReference') ?? reference,
      status: statusOf(data),
    };
  }

  async findTransferByReference(reference: string): Promise<ProviderTxRef | null> {
    const { status, body } = await this.call(
      'GET',
      `/payout/requery?clientReference=${encodeURIComponent(reference)}`,
      this.config.secretKey,
    );
    if (status === 404) return null;
    const data = (body.data as Json | undefined) ?? body;
    if (!firstString(data, 'clientReference', 'reference', 'providerReference')) return null;
    return {
      providerTxId: firstString(data, 'reference', 'providerReference') ?? reference,
      status: statusOf(data),
    };
  }

  /** A session's funding details: what the worker confirms an event with (P9-2). */
  async getTransaction(providerTxId: string): Promise<ProviderTransaction> {
    const { status, body } = await this.call(
      'GET',
      `/payment/transaction-details/${encodeURIComponent(providerTxId)}`,
      this.config.publicKey,
    );
    if (status === 404 || !this.succeeded(body))
      throw new ProviderError('NOT_FOUND', 'Transaction not found');
    const data = (body.data as Json | undefined) ?? body;
    const toAccountNumber = firstString(data, 'accountNumber', 'account_number', 'destinationAccountNumber');
    const createdAt = new Date(
      firstString(data, 'createdAt', 'dateCreated', 'transactionDate') ?? Date.now(),
    );
    return {
      providerTxId,
      reference: firstString(data, 'paymentReference', 'reference') ?? providerTxId,
      status: statusOf(data),
      amount: ngn(nairaToKobo(data.amount, 'The amount')),
      from: { kind: 'external', description: 'inbound' },
      to: { kind: 'va', providerRef: toAccountNumber ?? '' },
      // Absent when TransactPay does not name the account (C5): such money is unmatched, never credited.
      ...(toAccountNumber ? { toAccountNumber } : {}),
      createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    };
  }

  async listTransactions(
    _account: VaRef,
    _since: Date,
    _cursor?: string,
  ): Promise<Page<ProviderTransaction>> {
    throw new ProviderError('UNSUPPORTED', 'No documented transaction listing');
  }

  async getBalance(account?: VaRef): Promise<Money> {
    if (account) throw new ProviderError('UNSUPPORTED', 'No documented per-account balance');
    const { status, body } = await this.call(
      'GET',
      '/payout/balance-enquiry?currency=NGN',
      this.config.secretKey,
    );
    if (status >= 400) throw new ProviderError('UNKNOWN_OUTCOME', `Balance unavailable (HTTP ${status})`);
    const data = (body.data as Json | undefined) ?? body;
    return ngn(nairaToKobo(data.availableBalance, 'The balance'));
  }

  /** The event is a lead only (P9-2): TransactPay documents no signature (C2), and sample payloads differ in casing. */
  parseEvent(raw: unknown, _headers: Readonly<Record<string, string | undefined>>): ProviderEvent {
    if (typeof raw !== 'object' || raw === null)
      throw new ProviderError('INVALID_EVENT', 'Not a recognised event');
    const outer = raw as Json;
    const data = (typeof outer.data === 'object' && outer.data !== null ? outer.data : outer) as Json;
    const providerTxId = firstString(data, 'sessionId', 'SessionId', 'session_id');
    return {
      verified: false,
      type: firstString(outer, 'event', 'Event', 'type') ?? 'unknown',
      ...(providerTxId ? { providerTxId } : {}),
      raw,
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────────────

  private succeeded(body: Json): boolean {
    return body.status === true || body.status === 'success' || body.availableBalance !== undefined;
  }

  private accountRef(alias: string, data: Json): VirtualAccountRef {
    const accountNumber = firstString(data, 'accountNumber', 'account_number');
    if (!accountNumber) throw new ProviderError('UNKNOWN_OUTCOME', 'No account number in the answer');
    return {
      providerRef: alias,
      accountNumber,
      accountName: firstString(data, 'accountName', 'account_name') ?? alias,
      bankName: firstString(data, 'bank', 'bankName', 'bank_name') ?? 'Unknown',
    };
  }

  private encrypt(payload: object): string {
    let xml = Buffer.from(this.config.encryptionKey, 'base64').toString('utf8');
    if (xml.startsWith('4096!')) xml = xml.slice(5);
    const modulus = /<Modulus>(.*?)<\/Modulus>/.exec(xml)?.[1];
    const exponent = /<Exponent>(.*?)<\/Exponent>/.exec(xml)?.[1];
    if (!modulus || !exponent) throw new ProviderError('INVALID_REQUEST', 'The encryption key is not usable');
    const url = (b64: string) => Buffer.from(b64, 'base64').toString('base64url');
    const key = createPublicKey({ key: { kty: 'RSA', n: url(modulus), e: url(exponent) }, format: 'jwk' });
    return publicEncrypt(
      { key, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(JSON.stringify(payload), 'utf8'),
    ).toString('base64');
  }

  /** One call. No answer, or a server error: UNKNOWN_OUTCOME — the request may or may not have taken effect (TA-8). */
  private async call(
    method: 'GET' | 'POST',
    path: string,
    apiKey: string,
    options: { encryption?: string; body?: object } = {},
  ): Promise<{ status: number; body: Json }> {
    let response: Response;
    let text: string;
    try {
      response = await this.fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          'api-key': apiKey,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.encryption ? { encryption: options.encryption } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await response.text();
    } catch {
      throw new ProviderError(
        'UNKNOWN_OUTCOME',
        `No answer from TransactPay (${method} ${path.split('?')[0]})`,
      );
    }
    if (response.status >= 500) {
      throw new ProviderError('UNKNOWN_OUTCOME', `TransactPay answered HTTP ${response.status}`);
    }
    try {
      const parsed: unknown = JSON.parse(text);
      return {
        status: response.status,
        body: (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Json,
      };
    } catch {
      if (response.status >= 400) return { status: response.status, body: {} };
      throw new ProviderError('UNKNOWN_OUTCOME', 'TransactPay answered with something unreadable');
    }
  }
}
