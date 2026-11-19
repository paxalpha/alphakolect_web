import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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

// The Paystack adapter (P9 revision 8; docs/architecture/P9_IMPLEMENTATION_PLAN.md §16). It uses only what Paystack's
// published documentation establishes, read on 2026-11-19:
//
//  - a wallet is a Dedicated Virtual Account (DVA) tied to a Paystack customer. The customer is the wallet's alias, as an
//    email address on our own domain, so the alias finds the customer (`GET /customer/{email}`) and the customer's
//    `dedicated_account` is the wallet. The account is made in two steps (customer, then `POST /dedicated_account`), which
//    answer at once; the single-step flow answers by notification and is not used.
//  - money arriving is a `charge.success` notification, confirmed with `GET /transaction/verify/{reference}`.
//  - there is ONE balance per integration (`GET /balance`), no balance per account, and no transfer between accounts
//    inside Paystack: a wallet's balance exists only in our books, and the reconciler compares the sum (capabilities).
//  - a payout needs a recipient made from a name enquiry, then `POST /transfer` with our reference (16 to 50 of a-z, 0-9,
//    - and _; the documentation does not say that a repeated reference is done once, so it is only ever looked up again).
//
// What the documentation leaves open is not assumed (the lesson of P9-R2, plan §14): "it does not exist" is only the
// answer the documentation shows (HTTP 404, `status: false`, a "not found" message), and creating an account, or
// rejecting an event, acts on it. Every other answer (a timeout, an authentication failure, a rate limit, a body we cannot
// read) is UNKNOWN_OUTCOME, never a failure (TA-8). None of these shapes has been seen against Paystack's test mode yet:
// plan §16.4 lists them as release conditions. The secret key and the signing secret come from the configuration and are
// never logged; errors carry no response bodies.

export type PaystackConfig = Readonly<{
  baseUrl?: string;
  /** `sk_test_…` or `sk_live_…`: it authorises every call, and signs notifications that carry no signing secret. */
  secretKey: string;
  /** `whsec_…`: Paystack's signing secret for `Paystack-Signature`, when the integration has one. */
  webhookSigningSecret?: string;
  /** The bank a DVA is made with: `test-bank` in test mode, a live provider's slug (`GET /dedicated_account/available_providers`). */
  preferredBank: string;
  /**
   * Whether wallets are made. Off by default: Paystack requires a customer's phone for a dedicated account, and, for some
   * business categories, a validated identity (BVN and bank account) first. AlphaKolect holds neither, and its category is
   * not known (plan §16.4 condition 3, owner Q4). It is switched on only when that is settled.
   */
  walletsEnabled?: boolean;
  /**
   * Whether payouts are sent. Off by default: Paystack takes a transfer fee, and a ₦50 stamp duty from ₦10,000, out of the
   * one balance on top of the amount, and the books post the amount alone, so a payout would leave a difference nobody
   * explains. They are switched on when the posting carries both charges (P10, plan §16.5 P9-22).
   */
  payoutsEnabled?: boolean;
  /** The domain of the email address given to each wallet's customer: ours, so no payer's or owner's mailbox is used. */
  walletEmailDomain: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  /** Unix seconds; a test sets it. */
  now?: () => number;
}>;

type Json = Record<string, unknown>;

const DEFAULT_BASE_URL = 'https://api.paystack.co';
/** Paystack's own tolerance for the age of a signed notification. */
const SIGNATURE_TOLERANCE_SECONDS = 300;
const REFERENCE_FORM = /^[a-z0-9_-]{16,50}$/;
const LAST_NAME = { merchant: 'Business', platform: 'Platform', customer: 'Customer' } as const;

/**
 * Our order reference as Paystack accepts it. One that already fits is sent as it is, so a person can match it; any other
 * is a fixed digest of it. The same function names the transfer and looks it up, so the two always agree.
 */
export function paystackReference(reference: string): string {
  return REFERENCE_FORM.test(reference)
    ? reference
    : `ak-${createHash('sha256').update(reference).digest('hex').slice(0, 40)}`;
}

/** Kobo as Paystack writes them (an integer, or digits in a string). Anything else is no amount we can record. */
function kobo(value: unknown, what: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d{1,18}$/.test(value)) return BigInt(value);
  throw new ProviderError('INVALID_EVENT', `${what} is not an amount in kobo`);
}

const asJson = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};

const text = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.length > 0) || typeof value === 'number' ? String(value) : undefined;

/** A transaction's status. Anything unrecognised is not final: it is looked at again, and never credited. */
function transactionStatus(value: unknown): ProviderTxStatus {
  switch (String(value ?? '').toLowerCase()) {
    case 'success':
      return 'successful';
    case 'failed':
    case 'abandoned':
      return 'failed';
    case 'reversed':
      return 'reversed';
    default:
      return 'pending';
  }
}

/**
 * A transfer's status, as Paystack's "How transfers work" table gives it. Conclusive: success; reversed (the amount is
 * returned); failed; abandoned (no OTP within 30 minutes); blocked (our approval server did not answer); rejected (it
 * declined). Not conclusive: pending, received (waiting for an approval), and otp, which waits for a code nobody will
 * enter and is told apart for the caller. A status not in the table is not final either: it is looked at again.
 */
function transferStatus(value: unknown): ProviderTxStatus | 'otp' {
  switch (String(value ?? '').toLowerCase()) {
    case 'success':
      return 'successful';
    case 'failed':
    case 'abandoned':
    case 'blocked':
    case 'rejected':
      return 'failed';
    case 'reversed':
      return 'reversed';
    case 'otp':
      return 'otp';
    default:
      return 'pending';
  }
}

type Answer = Readonly<{ status: number; body: Json }>;

export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack';
  /** One pooled balance, no transfer between accounts, and no listing built (P9-3, plan §16). */
  readonly capabilities: PaymentProvider['capabilities'];
  readonly requestTimeoutMs: number;

  private readonly fetch: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(private readonly config: PaystackConfig) {
    this.fetch = config.fetch ?? globalThis.fetch;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.requestTimeoutMs = config.timeoutMs ?? 20_000;
    this.capabilities = {
      listTransactions: false,
      perAccountBalance: false,
      vaTransfer: false,
      createWallets: config.walletsEnabled === true,
      payouts: config.payoutsEnabled === true,
    };
  }

  // ── wallets ───────────────────────────────────────────────────────────────────────

  async findVirtualAccountByAlias(alias: string): Promise<VirtualAccountRef | null> {
    const customer = await this.fetchCustomer(alias);
    const account = customer?.dedicated_account;
    return typeof account === 'object' && account !== null ? this.provisioned(alias, asJson(account)) : null;
  }

  /** The alias is the customer's identity, so a repeat finds what the first made (TA-8); a duplicate is refused by Paystack, not made. */
  async createVirtualAccount(owner: VaOwner, alias: string): Promise<VirtualAccountRef> {
    let customer = await this.fetchCustomer(alias);
    if (!customer) {
      const made = await this.call('POST', '/customer', {
        email: this.emailOf(alias),
        first_name: owner.name.slice(0, 60),
        last_name: LAST_NAME[owner.kind],
      });
      this.refuseOrUnknown(made, 'The customer');
      customer = asJson(made.body.data);
    }
    const existing = customer.dedicated_account;
    if (typeof existing === 'object' && existing !== null) return this.provisioned(alias, asJson(existing));
    const code = text(customer.customer_code);
    if (!code) throw new ProviderError('UNKNOWN_OUTCOME', 'No customer code in the answer');
    const res = await this.call('POST', '/dedicated_account', {
      customer: code,
      preferred_bank: this.config.preferredBank,
    });
    this.refuseOrUnknown(res, 'The virtual account');
    const made = asJson(res.body.data);
    // The answer to a creation names its customer: it must be the one asked for. One that does not is not ours to use.
    if (text(asJson(made.customer).customer_code) !== code)
      throw new ProviderError('UNKNOWN_OUTCOME', 'The account made names another customer, or none');
    return this.provisioned(alias, made);
  }

  async getVirtualAccount(providerRef: string): Promise<VirtualAccountState> {
    const customer = await this.fetchCustomer(providerRef);
    const account = asJson(customer?.dedicated_account);
    if (!customer || Object.keys(account).length === 0)
      throw new ProviderError('NOT_FOUND', 'Virtual account not found');
    return {
      ...this.accountRef(providerRef, account),
      status: account.active === true && account.assigned === true ? 'active' : 'closed',
    };
  }

  // ── payouts ───────────────────────────────────────────────────────────────────────

  async transfer(
    _from: VaRef,
    to: VaRef | BankAccount,
    amount: Money,
    reference: string,
    _idempotencyKey: string,
  ): Promise<ProviderTxRef> {
    // Paystack has one balance and no way to move money between two accounts inside it: such a payment is a book entry
    // between two wallets (P10), never a call here.
    if (to.kind !== 'bank')
      throw new ProviderError('UNSUPPORTED', 'Paystack has no transfer between virtual accounts');
    if (!this.capabilities.payouts)
      throw new ProviderError('UNSUPPORTED', 'Payouts are switched off: their fees are not in the books yet');
    if (amount.currency !== 'NGN' || !Number.isSafeInteger(Number(amount.amountMinor)))
      throw new ProviderError('INVALID_REQUEST', 'Only whole kobo in naira can be paid out');
    const ours = paystackReference(reference);

    // The two steps before the transfer move no money: if either fails, nothing was sent (NOT_SENT).
    let recipient: string;
    try {
      recipient = await this.recipientFor(to);
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'NOT_SENT') throw err;
      throw new ProviderError('NOT_SENT', 'The recipient could not be made: nothing was sent');
    }

    const { status, body } = await this.call('POST', '/transfer', {
      source: 'balance',
      amount: Number(amount.amountMinor),
      recipient,
      reference: ours,
    });
    if (status === 400 || status === 422) {
      const message = String(body.message ?? '');
      // A repeated reference means the first attempt reached Paystack: it is looked up, never read as a failure.
      if (/reference/i.test(message))
        throw new ProviderError('UNKNOWN_OUTCOME', 'Paystack says this reference was used already');
      if (/balance|insufficient|not enough/i.test(message))
        throw new ProviderError('INSUFFICIENT_FUNDS', 'The balance does not cover the payout');
      throw new ProviderError('INVALID_REQUEST', `Payout refused (HTTP ${status})`);
    }
    if (status >= 400 || body.status !== true)
      throw new ProviderError('UNKNOWN_OUTCOME', `No stated result for the payout (HTTP ${status})`);
    const data = asJson(body.data);
    const state = transferStatus(data.status);
    if (state === 'otp')
      throw new ProviderError('UNKNOWN_OUTCOME', 'The payout waits for an OTP: turn the OTP requirement off');
    return { providerTxId: text(data.transfer_code) ?? ours, status: state };
  }

  async findTransferByReference(reference: string): Promise<ProviderTxRef | null> {
    const ours = paystackReference(reference);
    const res = await this.call('GET', `/transfer/verify/${encodeURIComponent(ours)}`);
    if (this.statesNotFound(res, [404], /not found/i)) return null;
    if (res.status !== 200 || res.body.status !== true)
      throw new ProviderError('UNKNOWN_OUTCOME', `The lookup did not answer (HTTP ${res.status})`);
    const data = asJson(res.body.data);
    if (text(data.reference) !== ours)
      throw new ProviderError('UNKNOWN_OUTCOME', 'The lookup named another payout');
    const state = transferStatus(data.status);
    return { providerTxId: text(data.transfer_code) ?? ours, status: state === 'otp' ? 'pending' : state };
  }

  // ── money arriving ────────────────────────────────────────────────────────────────

  /** The transaction by its reference, as Paystack names it: what the worker confirms an event with (P9-2). */
  async getTransaction(providerTxId: string): Promise<ProviderTransaction> {
    const res = await this.call('GET', `/transaction/verify/${encodeURIComponent(providerTxId)}`);
    // Not found rejects an event in the end: an outage, an expired key or a rate limit must not reject real money.
    if (this.statesNotFound(res, [400, 404], /not found/i))
      throw new ProviderError('NOT_FOUND', 'Transaction not found');
    if (res.status !== 200 || res.body.status !== true)
      throw new ProviderError(
        'UNKNOWN_OUTCOME',
        `The transaction lookup did not answer (HTTP ${res.status})`,
      );
    const data = asJson(res.body.data);
    const reference = text(data.reference);
    if (reference !== providerTxId)
      throw new ProviderError('UNKNOWN_OUTCOME', 'The lookup named another transaction');
    if (data.currency !== 'NGN') throw new ProviderError('INVALID_EVENT', 'Not a payment in naira');
    const amount = kobo(data.amount, 'The amount');
    const fee = data.fees === null || data.fees === undefined ? 0n : kobo(data.fees, 'The fee');
    if (fee > amount) throw new ProviderError('INVALID_EVENT', 'The fee is more than the payment');
    const received = new Date(text(data.paid_at) ?? text(data.created_at) ?? Date.now());
    const createdAt = Number.isNaN(received.getTime()) ? new Date() : received;
    const authorization = asJson(data.authorization);
    // Only a payment into a dedicated account is money arriving in a wallet. Any other (a card, a checkout) is not ours to
    // credit: the worker reads it as not found (plan §16.3).
    const toAccountNumber =
      data.channel === 'dedicated_nuban' ? text(authorization.receiver_bank_account_number) : undefined;
    return {
      providerTxId,
      reference,
      status: transactionStatus(data.status),
      amount: ngn(amount),
      ...(fee > 0n ? { feeMinor: fee } : {}),
      from: { kind: 'external', description: 'inbound' },
      to:
        data.channel === 'dedicated_nuban'
          ? { kind: 'va', providerRef: toAccountNumber ?? '' }
          : { kind: 'bank', bankCode: '', accountNumber: '' },
      // Absent when Paystack does not name the account: such money is unmatched, never credited.
      ...(toAccountNumber ? { toAccountNumber } : {}),
      createdAt,
    };
  }

  async listTransactions(
    _account: VaRef,
    _since: Date,
    _cursor?: string,
  ): Promise<Page<ProviderTransaction>> {
    // `GET /transaction` and `POST /dedicated_account/requery` exist; nothing in P9 uses them (plan §16.5), so a listing is
    // not offered until its missed-notification path is built.
    throw new ProviderError('UNSUPPORTED', 'A transaction listing is not built');
  }

  async getBalance(account?: VaRef): Promise<Money> {
    if (account) throw new ProviderError('UNSUPPORTED', 'Paystack has one balance, not one per account');
    const res = await this.call('GET', '/balance');
    if (res.status !== 200 || res.body.status !== true || !Array.isArray(res.body.data))
      throw new ProviderError('UNKNOWN_OUTCOME', `Balance unavailable (HTTP ${res.status})`);
    const naira = (res.body.data as unknown[]).map(asJson).find((b) => b.currency === 'NGN');
    // No naira balance named is no answer, not a balance of nothing.
    if (!naira) throw new ProviderError('UNKNOWN_OUTCOME', 'No naira balance in the answer');
    return ngn(kobo(naira.balance, 'The balance'));
  }

  // ── notifications ─────────────────────────────────────────────────────────────────

  /**
   * Paystack's two signatures over the exact bytes received. `Paystack-Signature` (`t=…,v1=<key id>:<hex>`) is an HMAC
   * SHA512 of `t.` and the body with the signing secret, no older than five minutes. `x-paystack-signature` is one of
   * the body with the secret key, and has no time. Either one is enough; neither is checked against a body that was
   * parsed and written out again.
   */
  verifyNotification(
    body: string,
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): boolean {
    const first = (name: string) => {
      const v = headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const bytes = Buffer.from(body, 'utf8');
    const signing = this.config.webhookSigningSecret;
    const signed = first('paystack-signature');
    if (signing && signed && this.signedWithTime(bytes, signed, signing)) return true;
    const plain = first('x-paystack-signature');
    if (plain && /^[0-9a-f]{128}$/.test(plain)) {
      const expected = createHmac('sha512', this.config.secretKey).update(bytes).digest();
      if (timingSafeEqual(expected, Buffer.from(plain, 'hex'))) return true;
    }
    return false;
  }

  private signedWithTime(bytes: Buffer, header: string, secret: string): boolean {
    let t: number | null = null;
    const signatures: string[] = [];
    for (const part of header.split(',')) {
      const i = part.indexOf('=');
      if (i === -1) continue;
      const key = part.slice(0, i).trim();
      const value = part.slice(i + 1).trim();
      if (key === 't') {
        if (t !== null || !/^[0-9]+$/.test(value)) return false;
        t = Number(value);
      } else if (key === 'v1') {
        const j = value.indexOf(':');
        if (j !== -1) signatures.push(value.slice(j + 1));
      }
    }
    const now = this.config.now?.() ?? Math.floor(Date.now() / 1000);
    if (t === null || signatures.length === 0 || Math.abs(now - t) > SIGNATURE_TOLERANCE_SECONDS)
      return false;
    const expected = createHmac('sha512', secret).update(`${t}.`).update(bytes).digest();
    return signatures.some(
      (hex) => /^[0-9a-f]{128}$/.test(hex) && timingSafeEqual(expected, Buffer.from(hex, 'hex')),
    );
  }

  /** The event is a lead only (P9-2): only a payment (`charge.success`) names a reference to confirm. */
  parseEvent(raw: unknown, _headers: Readonly<Record<string, string | undefined>>): ProviderEvent {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      throw new ProviderError('INVALID_EVENT', 'Not a recognised event');
    const outer = raw as Json;
    const type = text(outer.event) ?? 'unknown';
    const providerTxId = type === 'charge.success' ? text(asJson(outer.data).reference) : undefined;
    return { verified: false, type, ...(providerTxId ? { providerTxId } : {}), raw };
  }

  // ── internals ─────────────────────────────────────────────────────────────────────

  private emailOf(alias: string): string {
    return `${alias.toLowerCase()}@${this.config.walletEmailDomain}`;
  }

  /** The customer behind an alias: null only when Paystack says there is none. */
  private async fetchCustomer(alias: string): Promise<Json | null> {
    const res = await this.call('GET', `/customer/${encodeURIComponent(this.emailOf(alias))}`);
    if (this.statesNotFound(res, [404], /not found/i)) return null;
    if (res.status !== 200 || res.body.status !== true)
      throw new ProviderError('UNKNOWN_OUTCOME', `The customer lookup did not answer (HTTP ${res.status})`);
    const customer = asJson(res.body.data);
    if (text(customer.email)?.toLowerCase() !== this.emailOf(alias))
      throw new ProviderError('UNKNOWN_OUTCOME', 'The lookup named another customer');
    return customer;
  }

  /** The recipient a payout goes to, from a name enquiry. Nothing is sent by either step. */
  private async recipientFor(to: BankAccount): Promise<string> {
    const notSent = (why: string) => new ProviderError('NOT_SENT', `${why}: nothing was sent`);
    const resolved = await this.call(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(to.accountNumber)}&bank_code=${encodeURIComponent(to.bankCode)}`,
    );
    const name = text(asJson(resolved.body.data).account_name);
    if (resolved.status !== 200 || resolved.body.status !== true || !name)
      throw notSent('The account could not be named');
    const made = await this.call('POST', '/transferrecipient', {
      type: 'nuban',
      name,
      account_number: to.accountNumber,
      bank_code: to.bankCode,
      currency: 'NGN',
    });
    const code = text(asJson(made.body.data).recipient_code);
    if (made.status !== 200 || made.body.status !== true || !code)
      throw notSent('The recipient could not be made');
    return code;
  }

  /** A stated refusal (400, 422) is one; everything else about a step that may have had an effect is not an answer. */
  private refuseOrUnknown(res: Answer, what: string): void {
    if (res.status === 400 || res.status === 422)
      throw new ProviderError('INVALID_REQUEST', `${what} was refused (HTTP ${res.status})`);
    if (res.status !== 200 && res.status !== 201)
      throw new ProviderError('UNKNOWN_OUTCOME', `No stated result for ${what} (HTTP ${res.status})`);
    if (res.body.status !== true) throw new ProviderError('UNKNOWN_OUTCOME', `No stated result for ${what}`);
  }

  /** The documented not-found: one of these statuses, a JSON body saying `status: false`, and its own message. */
  private statesNotFound(res: Answer, statuses: readonly number[], message: RegExp): boolean {
    return (
      statuses.includes(res.status) &&
      res.body.status === false &&
      typeof res.body.message === 'string' &&
      message.test(res.body.message)
    );
  }

  /**
   * An account that may hold a wallet: assigned, active and in naira, all stated. One that lacks any of them, or says it is
   * not, is not a wallet, and is not guessed to be one: an unclear answer, for the platform team to see.
   */
  private provisioned(alias: string, data: Json): VirtualAccountRef {
    const ref = this.accountRef(alias, data);
    if (data.assigned !== true || data.active !== true)
      throw new ProviderError('UNKNOWN_OUTCOME', 'The account is not stated to be assigned and active');
    if (data.currency !== 'NGN') throw new ProviderError('UNKNOWN_OUTCOME', 'The account is not in naira');
    return ref;
  }

  private accountRef(alias: string, data: Json): VirtualAccountRef {
    const accountNumber = text(data.account_number);
    if (!accountNumber) throw new ProviderError('UNKNOWN_OUTCOME', 'No account number in the answer');
    return {
      providerRef: alias,
      accountNumber,
      accountName: text(data.account_name) ?? alias,
      bankName: text(asJson(data.bank).name) ?? 'Unknown',
    };
  }

  /** One call. No answer, or a server error: UNKNOWN_OUTCOME — the request may or may not have taken effect (TA-8). */
  private async call(method: 'GET' | 'POST', path: string, body?: object): Promise<Answer> {
    let response: Response;
    let payload: string;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      payload = await response.text();
    } catch {
      throw new ProviderError('UNKNOWN_OUTCOME', `No answer from Paystack (${method} ${path.split('?')[0]})`);
    }
    if (response.status >= 500)
      throw new ProviderError('UNKNOWN_OUTCOME', `Paystack answered HTTP ${response.status}`);
    try {
      return { status: response.status, body: asJson(JSON.parse(payload)) };
    } catch {
      if (response.status >= 400) return { status: response.status, body: {} };
      throw new ProviderError('UNKNOWN_OUTCOME', 'Paystack answered with something unreadable');
    }
  }
}
