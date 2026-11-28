import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PaystackProvider,
  paystackReference,
  type PaystackConfig,
} from '../../src/integrations/payments/paystack-provider.js';
import { ngn } from '../../src/platform/money.js';

// The Paystack adapter against a stubbed server (P9 revision 8; plan §16): the requests Paystack's documentation shows, and
// — the point of TA-8 — what it does when it gets no clear answer. Nothing here has been seen against Paystack itself: the
// last block runs only with PAYSTACK_SANDBOX=run and test keys, never in CI (plan §16.4).

type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };
const SECRET = 'sk_test_0123456789abcdef'; // gitleaks:allow
const SIGNING = 'whsec_0123456789abcdef'; // gitleaks:allow
const NOW = 1_800_000_000;

function provider(answer: (seen: Seen) => Response | Promise<Response>, extra: Partial<PaystackConfig> = {}) {
  const seen: Seen[] = [];
  const p = new PaystackProvider({
    secretKey: SECRET,
    webhookSigningSecret: SIGNING,
    preferredBank: 'test-bank',
    walletEmailDomain: 'wallets.example.test',
    walletsEnabled: true,
    payoutsEnabled: true,
    now: () => NOW,
    fetch: (async (url: string, init: RequestInit) => {
      const call: Seen = {
        url,
        method: init.method!,
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      };
      seen.push(call);
      return answer(call);
    }) as typeof fetch,
    ...extra,
  });
  return { p, seen };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const va = { kind: 'va', providerRef: 'AKM-1' } as const;
const owner = { kind: 'merchant', ownerId: 'm', name: 'Ade Stores' } as const;
const ALIAS = 'AKM-0123456789abcdef';
const EMAIL = 'akm-0123456789abcdef@wallets.example.test';
const account = {
  account_number: '9930000737',
  account_name: 'ALPHAKOLECT / ADE STORES BUSINESS',
  bank: { name: 'Paystack-Titan', slug: 'titan-paystack' },
  currency: 'NGN',
  active: true,
  assigned: true,
};
/** What POST /dedicated_account answers: the account, and the customer it was made for. */
const madeFor = (code: string, extra: object = {}) => ({
  status: true,
  data: { ...account, customer: { customer_code: code }, ...extra },
});
const customer = (extra: object = {}) => ({
  status: true,
  data: { email: EMAIL, customer_code: 'CUS_abc', dedicated_account: null, ...extra },
});
const notFound = (message = 'Customer not found') => json({ status: false, message }, 404);

describe('wallets', () => {
  it('finds one by its alias: the customer on our domain, and the account it holds', async () => {
    const { p, seen } = provider(() => json(customer({ dedicated_account: account })));
    await expect(p.findVirtualAccountByAlias(ALIAS)).resolves.toEqual({
      providerRef: ALIAS,
      accountNumber: '9930000737',
      accountName: 'ALPHAKOLECT / ADE STORES BUSINESS',
      bankName: 'Paystack-Titan',
    });
    expect(seen[0]!.method).toBe('GET');
    expect(seen[0]!.url).toBe(`https://api.paystack.co/customer/${encodeURIComponent(EMAIL)}`);
    expect(seen[0]!.headers.Authorization).toBe(`Bearer ${SECRET}`);
  });

  it('a customer with no account is "no account"; no customer is too, but only as Paystack says it', async () => {
    const { p: none } = provider(() => json(customer()));
    await expect(none.findVirtualAccountByAlias(ALIAS)).resolves.toBeNull();
    const { p: gone } = provider(() => notFound());
    await expect(gone.findVirtualAccountByAlias(ALIAS)).resolves.toBeNull();
  });

  it('P9-R2: anything but the documented not-found is not an answer, so nothing is created on it', async () => {
    for (const answer of [
      () => json({ status: false, message: 'Invalid key' }, 401),
      () => json({ status: false, message: 'Forbidden' }, 403),
      () => json({ status: false, message: 'Too many requests' }, 429),
      () => json({ status: false, message: 'Customer not found' }, 400),
      () => json({ status: false, message: 'Something else' }, 404),
      () => json({ message: 'Customer not found' }, 404), // no status: false
      () => json({ status: true, message: 'Customer not found' }, 404),
      () => json({}, 503),
      () => json({ status: false }),
      () => new Response('<html>Not Found</html>', { status: 404 }), // a proxy's, not Paystack's
      () => new Response('<html>', { status: 200 }),
      () => json('nope', 404),
      () => json({ status: true, data: { email: 'someone@else.test', customer_code: 'CUS_x' } }), // another customer
      () => Promise.reject(new Error('timeout')),
    ]) {
      const { p } = provider(answer);
      await expect(p.findVirtualAccountByAlias(ALIAS)).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    }
  });

  it('creates one for a customer who has none: the account, with our preferred bank, and nothing else made', async () => {
    const { p, seen } = provider((s) => (s.method === 'GET' ? json(customer()) : json(madeFor('CUS_abc'))));
    await expect(p.createVirtualAccount(owner, ALIAS)).resolves.toMatchObject({
      providerRef: ALIAS,
      accountNumber: '9930000737',
    });
    expect(seen.map((s) => `${s.method} ${s.url.replace('https://api.paystack.co', '')}`)).toEqual([
      `GET /customer/${encodeURIComponent(EMAIL)}`,
      'POST /dedicated_account',
    ]);
    expect(seen[1]!.body).toEqual({ customer: 'CUS_abc', preferred_bank: 'test-bank' });
  });

  it('makes the customer first when there is none, named for the owner, with our email address', async () => {
    const { p, seen } = provider((s) => {
      if (s.method === 'GET') return notFound();
      return s.url.endsWith('/customer')
        ? json({ status: true, data: { email: EMAIL, customer_code: 'CUS_new' } })
        : json(madeFor('CUS_new'));
    });
    await p.createVirtualAccount(owner, ALIAS);
    expect(seen[1]!.url).toBe('https://api.paystack.co/customer');
    expect(seen[1]!.body).toEqual({ email: EMAIL, first_name: 'Ade Stores', last_name: 'Business' });
    expect(seen[2]!.body).toEqual({ customer: 'CUS_new', preferred_bank: 'test-bank' });
  });

  it('a customer who has an account already is not given another', async () => {
    const { p, seen } = provider(() => json(customer({ dedicated_account: account })));
    await expect(p.createVirtualAccount(owner, ALIAS)).resolves.toMatchObject({
      accountNumber: '9930000737',
    });
    expect(seen).toHaveLength(1);
  });

  it('a refusal is a refusal; a timeout, a dropped connection or a server error is UNKNOWN_OUTCOME (TA-8)', async () => {
    const make = (answer: Response | (() => Promise<Response>)) =>
      provider((s) =>
        s.method === 'GET' ? json(customer()) : typeof answer === 'function' ? answer() : answer,
      ).p.createVirtualAccount(owner, ALIAS);
    await expect(make(json({ status: false, message: 'Not allowed' }, 400))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(make(json({ status: false }, 422))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    for (const answer of [
      json({}, 503),
      json({}, 401),
      json({}, 429),
      json({ status: false }),
      new Response('<html>', { status: 200 }),
      () => Promise.reject(new Error('timeout')),
    ])
      await expect(make(answer)).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
  });

  it('reads an account as closed when Paystack says it is not active; an absent one is NOT_FOUND', async () => {
    const { p } = provider(() => json(customer({ dedicated_account: { ...account, active: false } })));
    expect((await p.getVirtualAccount(ALIAS)).status).toBe('closed');
    const { p: open } = provider(() => json(customer({ dedicated_account: account })));
    expect((await open.getVirtualAccount(ALIAS)).status).toBe('active');
    const { p: none } = provider(() => json(customer()));
    await expect(none.getVirtualAccount(ALIAS)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('confirming a transaction', () => {
  const paid = (extra: object = {}, authorization: object = {}) =>
    json({
      status: true,
      data: {
        id: 4099260516,
        reference: 'R1',
        status: 'success',
        amount: 150_050,
        fees: 1_500,
        currency: 'NGN',
        channel: 'dedicated_nuban',
        paid_at: '2026-11-19T09:15:02.000Z',
        authorization: { receiver_bank_account_number: '9930000737', ...authorization },
        ...extra,
      },
    });

  it('reads the reference, the amount and fee in kobo, the account it landed in, and when', async () => {
    const { p, seen } = provider(() => paid());
    const tx = await p.getTransaction('R1');
    expect(seen[0]!.url).toBe('https://api.paystack.co/transaction/verify/R1');
    expect(tx).toMatchObject({
      providerTxId: 'R1',
      reference: 'R1',
      status: 'successful',
      amount: ngn(150_050n),
      feeMinor: 1_500n,
      toAccountNumber: '9930000737',
      to: { kind: 'va' },
    });
    expect(tx.createdAt.toISOString()).toBe('2026-11-19T09:15:02.000Z');
  });

  it.each([
    ['success', 'successful'],
    ['failed', 'failed'],
    ['abandoned', 'failed'],
    ['reversed', 'reversed'],
    ['pending', 'pending'],
    ['ongoing', 'pending'],
    ['queued', 'pending'],
    ['something new', 'pending'],
  ])('status %s is %s (anything unrecognised is not final)', async (status, expected) => {
    const { p } = provider(() => paid({ status }));
    expect((await p.getTransaction('R1')).status).toBe(expected);
  });

  it('no fee is no fee; a fee beyond the payment, or one that is not an amount, is no event', async () => {
    expect((await provider(() => paid({ fees: null })).p.getTransaction('R1')).feeMinor).toBeUndefined();
    expect((await provider(() => paid({ fees: 0 })).p.getTransaction('R1')).feeMinor).toBeUndefined();
    for (const fees of [150_051, -1, 1.5, 'abc'])
      await expect(provider(() => paid({ fees })).p.getTransaction('R1')).rejects.toMatchObject({
        code: 'INVALID_EVENT',
      });
  });

  it('P9-R4: an amount that is not whole kobo in naira is refused, never cut', async () => {
    for (const amount of [1500.5, -5, '12.5', 'abc', null, undefined, 2 ** 60])
      await expect(provider(() => paid({ amount })).p.getTransaction('R1')).rejects.toMatchObject({
        code: 'INVALID_EVENT',
      });
    await expect(provider(() => paid({ currency: 'USD' })).p.getTransaction('R1')).rejects.toMatchObject({
      code: 'INVALID_EVENT',
    });
    expect((await provider(() => paid({ amount: '150050' })).p.getTransaction('R1')).amount).toEqual(
      ngn(150_050n),
    );
  });

  it('without an account named there is nothing to match it by; any channel but a dedicated account is no wallet money', async () => {
    const { p } = provider(() => paid({}, { receiver_bank_account_number: undefined }));
    expect((await p.getTransaction('R1')).toAccountNumber).toBeUndefined();
    const { p: card } = provider(() => paid({ channel: 'card' }));
    const tx = await card.getTransaction('R1');
    expect(tx.to.kind).toBe('bank');
    expect(tx.toAccountNumber).toBeUndefined();
  });

  it('only the documented not-found is NOT_FOUND; an outage, our own expired key or a rate limit must not reject real money', async () => {
    for (const status of [400, 404])
      await expect(
        provider(() =>
          json({ status: false, message: 'Transaction reference not found' }, status),
        ).p.getTransaction('R1'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const answer of [
      () => json({}, 500),
      () => json({ status: false, message: 'Invalid key' }, 401),
      () => json({ status: false, message: 'Forbidden' }, 403),
      () => json({ status: false, message: 'Rate limited' }, 429),
      () => json({ status: false, message: 'Invalid reference format' }, 400),
      () => json({ status: false, message: 'Transaction reference not found' }, 200),
      () => json({ message: 'Transaction reference not found' }, 404),
      () => json({ status: false }, 404),
      () => new Response('<html>', { status: 404 }),
      () => json({ status: true, data: { reference: 'ANOTHER', amount: 1, currency: 'NGN' } }),
    ]) {
      await expect(provider(answer).p.getTransaction('R1')).rejects.toMatchObject({
        code: 'UNKNOWN_OUTCOME',
      });
    }
  });

  it('takes the reference from a payment notification, and from nothing else; believes nothing it says', () => {
    const { p } = provider(() => json({}));
    expect(p.parseEvent({ event: 'charge.success', data: { reference: 'A' } }, {})).toMatchObject({
      verified: false,
      type: 'charge.success',
      providerTxId: 'A',
    });
    // Transfer events carry our payout's reference, and assignment events none: only a payment is looked up.
    expect(
      p.parseEvent({ event: 'transfer.success', data: { reference: 'A' } }, {}).providerTxId,
    ).toBeUndefined();
    expect(
      p.parseEvent({ event: 'dedicatedaccount.assign.success', data: {} }, {}).providerTxId,
    ).toBeUndefined();
    expect(p.parseEvent({ data: { reference: 'A' } }, {}).providerTxId).toBeUndefined();
    expect(
      p.parseEvent({ event: 'charge.success', data: { reference: '' } }, {}).providerTxId,
    ).toBeUndefined();
    expect(() => p.parseEvent('nope', {})).toThrow();
    expect(() => p.parseEvent([], {})).toThrow();
    expect(() => p.parseEvent(null, {})).toThrow();
  });
});

describe('notifications are signed', () => {
  const body = '{"event":"charge.success", "data":{"reference":"R1",  "amount":150050}}';
  const hmac = (secret: string, data: string) =>
    createHmac('sha512', secret).update(data, 'utf8').digest('hex');
  const stamped = (t: number, text = body, secret = SIGNING, kid = 'whk_1') =>
    `t=${t},v1=${kid}:${hmac(secret, `${t}.${text}`)}`;
  const { p } = provider(() => json({}));

  it('accepts the signature with a time, on the exact bytes, up to five minutes old', () => {
    expect(p.verifyNotification(body, { 'paystack-signature': stamped(NOW) })).toBe(true);
    expect(p.verifyNotification(body, { 'paystack-signature': stamped(NOW - 300) })).toBe(true);
    expect(p.verifyNotification(body, { 'paystack-signature': stamped(NOW + 300) })).toBe(true);
    // One of two signatures during a rotation is enough, whatever its position.
    const OTHER = 'whsec_other0000000000'; // gitleaks:allow
    const other = `v1=whk_2:${hmac(OTHER, `${NOW}.${body}`)}`;
    expect(p.verifyNotification(body, { 'paystack-signature': `${other},${stamped(NOW)}` })).toBe(true);
  });

  it('refuses a stale or future one, another body, another secret, and anything malformed', () => {
    const refused = (header: string | undefined, text = body) =>
      p.verifyNotification(text, header === undefined ? {} : { 'paystack-signature': header });
    expect(refused(stamped(NOW - 301))).toBe(false);
    expect(refused(stamped(NOW + 301))).toBe(false);
    expect(refused(stamped(NOW), body.replace('150050', '999999'))).toBe(false);
    expect(refused(stamped(NOW), body.replace(', ', ','))).toBe(false); // the bytes, not the JSON
    expect(refused(stamped(NOW, body, 'whsec_other0000000000'))).toBe(false); // gitleaks:allow
    expect(refused(stamped(NOW).replace('t=', 'x='))).toBe(false);
    expect(refused(`t=${NOW},v1=whk_1:abc`)).toBe(false);
    expect(refused(`t=${NOW}`)).toBe(false);
    expect(refused(`t=${NOW},t=${NOW},v1=whk_1:${hmac(SIGNING, `${NOW}.${body}`)}`)).toBe(false);
    expect(refused('')).toBe(false);
    expect(refused(undefined)).toBe(false);
  });

  it('accepts the older signature, of the body with the secret key, and only that', () => {
    expect(p.verifyNotification(body, { 'x-paystack-signature': hmac(SECRET, body) })).toBe(true);
    expect(p.verifyNotification(body, { 'x-paystack-signature': hmac(SIGNING, body) })).toBe(false);
    expect(p.verifyNotification(body, { 'x-paystack-signature': hmac(SECRET, body).toUpperCase() })).toBe(
      false,
    );
    expect(p.verifyNotification(body, { 'x-paystack-signature': hmac(SECRET, `${body} `) })).toBe(false);
    expect(p.verifyNotification(body, { 'x-paystack-signature': ['not-a-signature'] })).toBe(false);
  });

  it('without a signing secret the signature with a time counts for nothing', () => {
    const { p: bare } = provider(() => json({}), { webhookSigningSecret: undefined });
    expect(bare.verifyNotification(body, { 'paystack-signature': stamped(NOW) })).toBe(false);
    expect(bare.verifyNotification(body, { 'x-paystack-signature': hmac(SECRET, body) })).toBe(true);
  });

  it('a notification with no signature at all is refused', () => {
    expect(p.verifyNotification(body, {})).toBe(false);
    expect(p.verifyNotification('', {})).toBe(false);
  });
});

describe('payouts', () => {
  const bank = { kind: 'bank', bankCode: '058', accountNumber: '0123456789' } as const;
  const ref = 'ak-order-0123456789';
  /** The three calls of a payout, each answered by `steps`; anything not listed is the documented success. */
  const payout = (steps: { resolve?: Response; recipient?: Response; transfer?: Response } = {}) =>
    provider((s) => {
      if (s.url.includes('/bank/resolve'))
        return steps.resolve ?? json({ status: true, data: { account_name: 'Tolu Robert' } });
      if (s.url.endsWith('/transferrecipient'))
        return steps.recipient ?? json({ status: true, data: { recipient_code: 'RCP_1' } });
      return (
        steps.transfer ??
        json({ status: true, data: { status: 'pending', transfer_code: 'TRF_1', reference: ref } })
      );
    });

  it('names the account, makes the recipient, then sends our reference and the amount in kobo', async () => {
    const { p, seen } = payout();
    await expect(p.transfer(va, bank, ngn(150_050n), ref, ref)).resolves.toEqual({
      providerTxId: 'TRF_1',
      status: 'pending',
    });
    expect(seen.map((s) => `${s.method} ${s.url.replace('https://api.paystack.co', '')}`)).toEqual([
      'GET /bank/resolve?account_number=0123456789&bank_code=058',
      'POST /transferrecipient',
      'POST /transfer',
    ]);
    expect(seen[1]!.body).toEqual({
      type: 'nuban',
      name: 'Tolu Robert',
      account_number: '0123456789',
      bank_code: '058',
      currency: 'NGN',
    });
    expect(seen[2]!.body).toEqual({ source: 'balance', amount: 150_050, recipient: 'RCP_1', reference: ref });
  });

  it('a step before the transfer that fails, of any kind, means nothing was sent', async () => {
    for (const steps of [
      { resolve: json({ status: false, message: 'Could not resolve' }, 422) },
      { resolve: json({}, 503) },
      { resolve: json({ status: true, data: {} }) },
      { recipient: json({ status: false }, 400) },
      { recipient: json({}, 502) },
      { recipient: json({ status: true, data: {} }) },
    ])
      await expect(payout(steps).p.transfer(va, bank, ngn(100n), ref, ref)).rejects.toMatchObject({
        code: 'NOT_SENT',
      });
    const { p, seen } = provider(() => Promise.reject(new Error('timeout')));
    await expect(p.transfer(va, bank, ngn(100n), ref, ref)).rejects.toMatchObject({ code: 'NOT_SENT' });
    expect(seen).toHaveLength(1);
  });

  it('only a 400 or 422 is a refusal; a reference used already, the balance and a code to enter are told apart', async () => {
    const send = (transfer: Response) => payout({ transfer }).p.transfer(va, bank, ngn(100n), ref, ref);
    await expect(send(json({ status: false, message: 'Invalid recipient' }, 400))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(send(json({ status: false, message: 'Invalid' }, 422))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(
      send(json({ status: false, message: 'Your balance is not enough to fulfil this request' }, 400)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    // The first attempt reached Paystack: never a failure, only looked up.
    await expect(
      send(json({ status: false, message: 'Transfer reference already exists' }, 400)),
    ).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    await expect(
      send(json({ status: true, data: { status: 'otp', transfer_code: 'TRF_1' } })),
    ).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    for (const status of [401, 403, 408, 429])
      await expect(send(json({ status: false }, status))).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    await expect(send(json({}, 503))).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    await expect(send(json({ status: false }))).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
  });

  it('reads every status Paystack documents: six conclusive, three not, and an unknown one is not final', async () => {
    for (const [status, expected] of [
      ['success', 'successful'],
      ['failed', 'failed'],
      ['abandoned', 'failed'],
      ['blocked', 'failed'],
      ['rejected', 'failed'],
      ['reversed', 'reversed'],
      ['pending', 'pending'],
      ['received', 'pending'],
      ['queued', 'pending'],
      ['something new', 'pending'],
    ] as const) {
      await expect(
        payout({ transfer: json({ status: true, data: { status, transfer_code: 'TRF_1' } }) }).p.transfer(
          va,
          bank,
          ngn(100n),
          ref,
          ref,
        ),
      ).resolves.toMatchObject({ status: expected });
      // The lookup reads the same table.
      const { p } = provider(() =>
        json({ status: true, data: { reference: ref, status, transfer_code: 'TRF_1' } }),
      );
      await expect(p.findTransferByReference(ref)).resolves.toMatchObject({ status: expected });
    }
    // Waiting for a code is not final, and a payout in that state is not sent: it is unknown to the caller, pending to a lookup.
    await expect(
      payout({
        transfer: json({ status: true, data: { status: 'otp', transfer_code: 'TRF_1' } }),
      }).p.transfer(va, bank, ngn(100n), ref, ref),
    ).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    const { p: waiting } = provider(() =>
      json({ status: true, data: { reference: ref, status: 'otp', transfer_code: 'TRF_1' } }),
    );
    await expect(waiting.findTransferByReference(ref)).resolves.toMatchObject({ status: 'pending' });
  });

  it('refuses what it cannot send: a transfer between accounts, another currency, an amount past a safe integer', async () => {
    const { p, seen } = provider(() => json({}));
    await expect(p.transfer(va, va, ngn(1n), ref, ref)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(
      p.transfer(
        va,
        bank,
        { amountMinor: 1n, currency: 'USD' } as unknown as ReturnType<typeof ngn>,
        ref,
        ref,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(p.transfer(va, bank, ngn(2n ** 60n), ref, ref)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(seen).toEqual([]);
  });

  it('our reference is sent as it is when Paystack takes it, and as a fixed digest when it does not', () => {
    expect(paystackReference('ak-order-0123456789')).toBe('ak-order-0123456789');
    const long = 'AKO-0190a000-0000-7000-8000-000000000001'; // capitals: Paystack takes lowercase only
    expect(paystackReference(long)).toMatch(/^ak-[0-9a-f]{40}$/);
    expect(paystackReference(long)).toBe(paystackReference(long));
    expect(paystackReference('AKO-00000000')).not.toBe(paystackReference('AKO-00000001'));
    expect(paystackReference('short')).toMatch(/^ak-[0-9a-f]{40}$/);
    expect(paystackReference('x'.repeat(51))).toMatch(/^ak-[0-9a-f]{40}$/);
  });

  it('looks a payout up by the same reference it was sent with; none found is null only as documented', async () => {
    const lower = 'ak-order-0123456789';
    const { p, seen } = provider(() =>
      json({ status: true, data: { reference: lower, status: 'success', transfer_code: 'TRF_9' } }),
    );
    await expect(p.findTransferByReference(lower)).resolves.toEqual({
      providerTxId: 'TRF_9',
      status: 'successful',
    });
    expect(seen[0]!.url).toBe(`https://api.paystack.co/transfer/verify/${lower}`);

    const upper = 'AKO-00000001';
    const sent = paystackReference(upper);
    const { p: other, seen: seenOther } = provider(() =>
      json({ status: true, data: { reference: sent, status: 'pending', transfer_code: 'TRF_8' } }),
    );
    await expect(other.findTransferByReference(upper)).resolves.toMatchObject({ providerTxId: 'TRF_8' });
    expect(seenOther[0]!.url).toBe(`https://api.paystack.co/transfer/verify/${sent}`);

    await expect(
      provider(() => json({ status: false, message: 'Transfer not found' }, 404)).p.findTransferByReference(
        lower,
      ),
    ).resolves.toBeNull();
    for (const answer of [
      () => json({ status: false }),
      () => json({ status: false, message: 'Transfer not found' }), // not a 404
      () => json({ status: false, message: 'Transfer not found' }, 400),
      () => json({}, 401),
      () => json({}, 429),
      () => json({}, 502),
      () => new Response('<html>', { status: 404 }),
      () => json({ status: true, data: { reference: 'another-payout-reference', status: 'success' } }),
    ])
      await expect(provider(answer).p.findTransferByReference(lower)).rejects.toMatchObject({
        code: 'UNKNOWN_OUTCOME',
      });
  });
});

describe('the balance and what is not offered', () => {
  it('reads the one balance, in kobo, of the naira entry', async () => {
    const { p, seen } = provider(() =>
      json({
        status: true,
        data: [
          { currency: 'USD', balance: 5 },
          { currency: 'NGN', balance: 1_700_000 },
        ],
      }),
    );
    await expect(p.getBalance()).resolves.toEqual(ngn(1_700_000n));
    expect(seen[0]!.url).toBe('https://api.paystack.co/balance');
  });

  it('no naira balance, or no answer, is no balance: never a balance of nothing', async () => {
    for (const answer of [
      () => json({ status: true, data: [] }),
      () => json({ status: true, data: [{ currency: 'USD', balance: 1 }] }),
      () => json({ status: true, data: [{ currency: 'NGN', balance: 'lots' }] }),
      () => json({ status: true }),
      () => json({ status: false }, 401),
      () => json({}, 500),
    ])
      await expect(provider(answer).p.getBalance()).rejects.toMatchObject({
        code: expect.stringMatching(/^(UNKNOWN_OUTCOME|INVALID_EVENT)$/),
      });
  });

  it('declares and refuses what Paystack does not give: a balance per account, a transfer between accounts', async () => {
    const { p, seen } = provider(() => json({}));
    expect(p.capabilities).toEqual({
      listTransactions: false,
      perAccountBalance: false,
      vaTransfer: false,
      createWallets: true,
      payouts: true,
    });
    await expect(p.getBalance(va)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(p.listTransactions(va, new Date())).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(seen).toEqual([]);
  });
});

describe('an account that is not stated to be a wallet is not one (P9 rev 8, the reviewer\u2019s P1)', () => {
  it('assigned, active and in naira, all stated, or the lookup and the creation say nothing is certain', async () => {
    for (const bad of [
      { active: false },
      { assigned: false },
      { active: undefined },
      { assigned: undefined },
      { active: 'true' },
      { currency: 'GHS' },
      { currency: undefined },
      { account_number: undefined },
    ]) {
      const { p } = provider(() => json(customer({ dedicated_account: { ...account, ...bad } })));
      await expect(p.findVirtualAccountByAlias(ALIAS)).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
      await expect(p.createVirtualAccount(owner, ALIAS)).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    }
    for (const bad of [
      { active: false },
      { assigned: false },
      { currency: 'GHS' },
      { currency: undefined },
    ]) {
      const { p } = provider((s) => (s.method === 'GET' ? json(customer()) : json(madeFor('CUS_abc', bad))));
      await expect(p.createVirtualAccount(owner, ALIAS)).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    }
  });

  it('an account made names the customer it was made for, or it is not used', async () => {
    const answer = (data: unknown) => provider((s) => (s.method === 'GET' ? json(customer()) : json(data))).p;
    await expect(
      answer({
        status: true,
        data: { ...account, customer: { customer_code: 'CUS_other' } },
      }).createVirtualAccount(owner, ALIAS),
    ).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    await expect(
      answer({ status: true, data: { ...account, customer: {} } }).createVirtualAccount(owner, ALIAS),
    ).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    await expect(
      answer({ status: true, data: account }).createVirtualAccount(owner, ALIAS),
    ).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
  });

  it('a closed account is reported closed, never active, and one that does not say so is not active either', async () => {
    for (const [extra, status] of [
      [{}, 'active'],
      [{ active: false }, 'closed'],
      [{ assigned: false }, 'closed'],
      [{ active: undefined }, 'closed'],
    ] as const) {
      const { p } = provider(() => json(customer({ dedicated_account: { ...account, ...extra } })));
      expect((await p.getVirtualAccount(ALIAS)).status).toBe(status);
    }
  });
});

describe('what is switched off (P9 rev 8, P9-22 and P9-23)', () => {
  it('wallets and payouts are off unless said, and nothing is sent to Paystack when they are', async () => {
    const { p, seen } = provider(() => json({}), { walletsEnabled: undefined, payoutsEnabled: undefined });
    expect(p.capabilities).toMatchObject({ createWallets: false, payouts: false });
    await expect(
      p.transfer(
        va,
        { kind: 'bank', bankCode: '058', accountNumber: '0123456789' },
        ngn(100n),
        'ak-order-0123456789',
        'x',
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(seen).toEqual([]);
    // Looking things up is not switched off: a payout already sent must still be found.
    await expect(
      provider(
        () => json({ status: false, message: 'Transfer not found' }, 404),
        {},
      ).p.findTransferByReference('ak-order-0123456789'),
    ).resolves.toBeNull();
  });
});

// On demand only: PAYSTACK_SANDBOX=run vitest run test/payments/paystack-provider.test.ts. It reads the test keys alone from
// apps/api/.env.test, or the environment (PAYSTACK_TEST_*), and refuses any key that is not marked as a test key: it can
// never use a live one. A deposit cannot be made from here: Paystack's demo bank app does it by hand (plan §16.4, condition 1).
function sandboxConfig(): PaystackConfig | null {
  if (process.env.PAYSTACK_SANDBOX !== 'run') return null;
  const env: Record<string, string | undefined> = { ...process.env };
  const file = new URL('../../.env.test', import.meta.url);
  if (existsSync(file))
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^(PAYSTACK_TEST_[A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  const secretKey = env.PAYSTACK_TEST_SECRET_KEY ?? '';
  if (!/^sk_test_/.test(secretKey)) throw new Error('PAYSTACK_SANDBOX=run needs a test key (sk_test_…)');
  // No default: the domain of a customer's email must end in a real top-level domain, or Paystack refuses it (the sandbox
  // diagnostic of 24 November), so the run says which one it uses.
  const walletEmailDomain = env.PAYSTACK_TEST_WALLET_EMAIL_DOMAIN ?? '';
  if (
    !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(walletEmailDomain) ||
    /\.(test|invalid|example|localhost|local)$/.test(walletEmailDomain)
  )
    throw new Error(
      'PAYSTACK_SANDBOX=run needs PAYSTACK_TEST_WALLET_EMAIL_DOMAIN: a domain with a real ending, not .test',
    );
  return {
    secretKey,
    preferredBank: env.PAYSTACK_TEST_PREFERRED_BANK ?? 'test-bank',
    walletEmailDomain,
  };
}
const sandbox = sandboxConfig();
describe.runIf(sandbox)('the sandbox, on demand (P9-6; plan §16.4)', { timeout: 60_000 }, () => {
  const p = () => new PaystackProvider(sandbox!);
  const alias = () => `AKT-${randomBytes(16).toString('hex')}`;

  it('what it does not know: an alias is null, a transaction NOT_FOUND, a payout null (P9-R2)', async () => {
    await expect(p().findVirtualAccountByAlias(alias())).resolves.toBeNull();
    await expect(p().getTransaction(`akt${randomBytes(16).toString('hex')}`)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(p().findTransferByReference(`akt-${randomBytes(16).toString('hex')}`)).resolves.toBeNull();
  });

  it('an account: made under its alias, found by it, and a repeat makes no second one (B1)', async () => {
    const a = alias();
    const created = await p().createVirtualAccount(
      { kind: 'merchant', ownerId: 'm', name: 'Sandbox Stores' },
      a,
    );
    expect((await p().findVirtualAccountByAlias(a))?.accountNumber).toBe(created.accountNumber);
    const again = await p().createVirtualAccount(
      { kind: 'merchant', ownerId: 'm', name: 'Sandbox Stores' },
      a,
    );
    expect(again.accountNumber).toBe(created.accountNumber);
  });

  it('reads the balance', async () => {
    expect((await p().getBalance()).currency).toBe('NGN');
  });
});
