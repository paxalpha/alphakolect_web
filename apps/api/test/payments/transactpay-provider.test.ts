import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TransactPayProvider,
  type TransactPayConfig,
} from '../../src/integrations/payments/transactpay-provider.js';
import { ngn } from '../../src/platform/money.js';

// The TransactPay adapter against a stubbed server (P9; docs/business/P9_TRANSACTPAY_QUESTIONS.md): the requests the old
// system's client and TransactPay's documentation establish, and — the point of TA-8 — what it does when it gets no clear
// answer. The sandbox itself needs keys: the last block runs only when TRANSACTPAY_SANDBOX_* are set, never in CI.

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
const b64 = (url: string) => Buffer.from(url, 'base64url').toString('base64');
const encryptionKey = Buffer.from(
  `4096!<RSAKeyValue><Modulus>${b64(jwk.n)}</Modulus><Exponent>${b64(jwk.e)}</Exponent></RSAKeyValue>`,
).toString('base64');

type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };
function provider(answer: (url: string) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const p = new TransactPayProvider({
    baseUrl: 'https://tp.test',
    publicKey: 'public-test-key',
    secretKey: 'secret-test-key',
    encryptionKey,
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        method: init.method!,
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      return answer(url);
    }) as typeof fetch,
  });
  return { p, seen };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const va = { kind: 'va', providerRef: 'AKM-1' } as const;
const owner = { kind: 'merchant', ownerId: 'm', name: 'M' } as const;

describe('virtual accounts', () => {
  it('creates one under its alias, with the alias RSA-encrypted', async () => {
    const { p, seen } = provider(() =>
      json({ status: true, data: { accountNumber: '0123456789', bank: 'Wema', accountName: 'AK/M' } }),
    );
    await expect(p.createVirtualAccount(owner, 'AKM-1')).resolves.toEqual({
      providerRef: 'AKM-1',
      accountNumber: '0123456789',
      accountName: 'AK/M',
      bankName: 'Wema',
    });
    const [call] = seen;
    expect(call!.url).toBe('https://tp.test/payment/virtual-account/generate');
    expect(call!.headers).toMatchObject({ 'api-key': 'public-test-key', encryption: 'RSA' });
    const clear = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from((call!.body as { data: string }).data, 'base64'),
    );
    expect(JSON.parse(clear.toString('utf8'))).toEqual({ Alias: 'AKM-1' });
  });

  it('finds one by its alias, with the secret key', async () => {
    const { p, seen } = provider(() => json({ status: true, data: { accountNumber: '0123456789' } }));
    expect((await p.findVirtualAccountByAlias('AKM 1'))?.accountNumber).toBe('0123456789');
    expect(seen[0]!.url).toBe('https://tp.test/payment/account-details?alias=AKM%201');
    expect(seen[0]!.headers['api-key']).toBe('secret-test-key');
  });

  it('P9-R2: only a JSON 404 says there is no such account; anything else is not an answer', async () => {
    const { p: none } = provider(() => json({ status: false, message: 'Not found' }, 404));
    await expect(none.findVirtualAccountByAlias('a')).resolves.toBeNull();
    for (const answer of [
      () => json({ status: false }, 400),
      () => json({ status: false }, 401),
      () => json({ status: false }, 403),
      () => json({ status: false }, 429),
      () => json({}, 503),
      () => json({ status: false }),
      () => json({ status: true, data: {} }), // success, and no account in it
      () => new Response('<html>Not Found</html>', { status: 404 }), // a proxy's or a wrong address's, not theirs
      () => new Response('<html>', { status: 200 }),
      () => json('nope', 404),
      () => Promise.reject(new Error('timeout')),
    ]) {
      const { p } = provider(answer);
      await expect(p.findVirtualAccountByAlias('a')).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    }
  });

  it('a refusal is a refusal; a timeout, a dropped connection or a server error is UNKNOWN_OUTCOME (TA-8)', async () => {
    const { p: refuses } = provider(() => json({ status: false }, 400));
    await expect(refuses.createVirtualAccount(owner, 'a')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    for (const answer of [
      () => json({}, 503),
      () => json({}, 401),
      () => json({}, 429),
      () => json({ status: false }),
      () => Promise.reject(new Error('timeout')),
      () => new Response('<html>', { status: 200 }),
    ]) {
      const { p } = provider(answer);
      await expect(p.createVirtualAccount(owner, 'a')).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    }
  });
});

describe('confirming a transaction', () => {
  it('reads the status table, the amount in naira as kobo, and the account', async () => {
    const { p, seen } = provider(() =>
      json({
        status: true,
        data: {
          sessionId: 'S1',
          amount: '1,500.50',
          statusId: 5,
          accountNumber: '0123456789',
          paymentReference: 'R',
        },
      }),
    );
    const tx = await p.getTransaction('S1');
    expect(seen[0]!.url).toBe('https://tp.test/payment/transaction-details/S1');
    expect(tx).toMatchObject({
      providerTxId: 'S1',
      reference: 'R',
      status: 'successful',
      amount: ngn(150_050n),
      toAccountNumber: '0123456789',
    });
  });

  it.each([
    [1, 'pending'],
    [2, 'pending'],
    [3, 'pending'],
    [4, 'failed'],
    [5, 'successful'],
    [6, 'reversed'],
    [7, 'pending'],
    [99, 'pending'],
  ])('status %i is %s (anything unrecognised is not final)', async (statusId, status) => {
    const { p } = provider(() => json({ status: true, data: { amount: 1, statusId } }));
    expect((await p.getTransaction('S')).status).toBe(status);
  });

  it('without an account named, there is nothing to match it by (C5); only a JSON 404 is NOT_FOUND', async () => {
    const { p } = provider(() => json({ status: true, data: { amount: 10, statusId: 5 } }));
    expect((await p.getTransaction('S')).toAccountNumber).toBeUndefined();
    const { p: gone } = provider(() => json({}, 404));
    await expect(gone.getTransaction('S')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A real deposit's event must not end rejected because of an outage or our own expired key.
    for (const answer of [
      () => json({}, 500),
      () => json({}, 401),
      () => json({}, 403),
      () => json({}, 429),
      () => json({ status: false }),
      () => new Response('<html>', { status: 404 }),
    ]) {
      const { p } = provider(answer);
      await expect(p.getTransaction('S')).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    }
  });

  it('P9-R4: an amount below a kobo is refused, never cut; zeros past the kobo are only zeros', async () => {
    const tx = (amount: unknown) => provider(() => json({ status: true, data: { amount, statusId: 5 } })).p;
    for (const amount of ['1500.999', 1500.999, '1500.001', '0.009'])
      await expect(tx(amount).getTransaction('S')).rejects.toMatchObject({ code: 'INVALID_EVENT' });
    for (const [amount, kobo] of [
      ['1500.990', 150_099n],
      ['1500.50', 150_050n],
      ['1,500.00', 150_000n],
      [1500, 150_000n],
    ] as const)
      expect((await tx(amount).getTransaction('S')).amount).toEqual(ngn(kobo));
  });

  it('takes the session id from a notification, in the casings the documentation shows; believes nothing else', () => {
    const { p } = provider(() => json({}));
    expect(p.parseEvent({ event: 'x', data: { sessionId: 'A' } }, {})).toMatchObject({
      verified: false,
      providerTxId: 'A',
    });
    expect(p.parseEvent({ SessionId: 'B' }, {})).toMatchObject({ providerTxId: 'B' });
    expect(p.parseEvent({ amount: 1 }, {}).providerTxId).toBeUndefined();
    expect(() => p.parseEvent('nope', {})).toThrow();
  });
});

describe('money and what is not offered', () => {
  it('a bank payout sends our reference and the amount in naira; the lookup uses the reference', async () => {
    const { p, seen } = provider(() =>
      json({ status: 'success', data: { reference: 'P1', status: 'pending' } }),
    );
    await expect(
      p.transfer(
        va,
        { kind: 'bank', bankCode: '058', accountNumber: '0123456789' },
        ngn(150_050n),
        'AKO-1',
        'AKO-1',
      ),
    ).resolves.toEqual({ providerTxId: 'P1', status: 'pending' });
    expect(seen[0]!.url).toBe('https://tp.test/payout/initiate');
    expect(seen[0]!.body).toMatchObject({ clientReference: 'AKO-1', amount: '1500.50', bankCode: '058' });
    await p.findTransferByReference('AKO-1');
    expect(seen[1]!.url).toBe('https://tp.test/payout/requery?clientReference=AKO-1');
  });

  it('a lookup that finds nothing is null, and a server error is not an answer', async () => {
    const { p } = provider(() => json({}, 404));
    await expect(p.findTransferByReference('x')).resolves.toBeNull();
    for (const status of [401, 429, 502]) {
      const { p: down } = provider(() => json({}, status));
      await expect(down.findTransferByReference('x')).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    }
  });

  it('a payout: only a 400 or 422 is a refusal; anything else may have taken effect (TA-8)', async () => {
    const to = { kind: 'bank', bankCode: '058', accountNumber: '0123456789' } as const;
    const from = { kind: 'va', providerRef: 'a' } as const;
    const send = (status: number) =>
      provider(() => json({}, status)).p.transfer(from, to, ngn(100n), 'r', 'r');
    await expect(send(400)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(send(422)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    for (const status of [401, 403, 408, 429])
      await expect(send(status)).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
  });

  it('reads the pooled balance, rounding down what is below a kobo (P9-R4: a balance only)', async () => {
    const { p, seen } = provider(() => json({ currency: 'NGN', availableBalance: 2463.085 }));
    await expect(p.getBalance()).resolves.toEqual(ngn(246_308n));
    expect(seen[0]!.url).toBe('https://tp.test/payout/balance-enquiry?currency=NGN');
  });

  it('declares and refuses what TransactPay does not document', async () => {
    const { p, seen } = provider(() => json({}));
    expect(p.capabilities).toEqual({ listTransactions: false, perAccountBalance: false, vaTransfer: false });
    await expect(p.transfer(va, va, ngn(1n), 'r', 'r')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(p.getBalance(va)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(p.listTransactions(va, new Date())).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(seen).toEqual([]);
  });
});

const sandbox = {
  baseUrl: process.env.TRANSACTPAY_SANDBOX_BASE_URL,
  publicKey: process.env.TRANSACTPAY_SANDBOX_PUBLIC_KEY,
  secretKey: process.env.TRANSACTPAY_SANDBOX_SECRET_KEY,
  encryptionKey: process.env.TRANSACTPAY_SANDBOX_ENCRYPTION_KEY_BASE64,
};
describe.runIf(sandbox.baseUrl && sandbox.publicKey && sandbox.secretKey && sandbox.encryptionKey)(
  'the sandbox, on demand (P9-6)',
  () => {
    const p = () => new TransactPayProvider(sandbox as unknown as TransactPayConfig);
    it('creates a virtual account and finds it by its alias', async () => {
      const alias = `AKT-${Date.now()}`;
      const created = await p().createVirtualAccount(owner, alias);
      expect((await p().findVirtualAccountByAlias(alias))?.accountNumber).toBe(created.accountNumber);
    });
    it('reads the balance', async () => {
      expect((await p().getBalance()).currency).toBe('NGN');
    });
  },
);
