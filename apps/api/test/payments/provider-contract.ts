import { beforeEach, describe, expect, it } from 'vitest';
import { ngn } from '../../src/platform/money.js';
import {
  ProviderError,
  type PaymentProvider,
  type VaOwner,
  type VaRef,
} from '../../src/integrations/payments/provider.js';

/**
 * Behaviour every PaymentProvider adapter must satisfy (TARGET_ARCHITECTURE §12, §24).
 * FakeProvider runs it now; the TransactPay adapter runs it against the sandbox in P9.
 * `fund` puts money into a VA from outside the provider, which each adapter does differently.
 */
export function describeProviderContract(
  name: string,
  make: () => PaymentProvider,
  fund: (provider: PaymentProvider, va: VaRef, amountMinor: bigint) => Promise<void>,
): void {
  describe(`PaymentProvider contract: ${name}`, () => {
    let provider: PaymentProvider;
    const merchant: VaOwner = { kind: 'merchant', ownerId: 'm-1', name: 'Test Merchant' };
    const customer: VaOwner = { kind: 'customer', ownerId: 'c-1', name: 'Test Customer' };
    const vaRef = (providerRef: string): VaRef => ({ kind: 'va', providerRef });

    beforeEach(() => {
      provider = make();
    });

    it('creates virtual accounts idempotently', async () => {
      const a = await provider.createVirtualAccount(merchant, 'idem-va-1');
      const again = await provider.createVirtualAccount(merchant, 'idem-va-1');
      expect(again).toEqual(a);
      expect((await provider.getVirtualAccount(a.providerRef)).status).toBe('active');
    });

    it('rejects an idempotency key reused for a different owner', async () => {
      await provider.createVirtualAccount(merchant, 'idem-va-2');
      await expect(provider.createVirtualAccount(customer, 'idem-va-2')).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
      });
    });

    it('moves money between VAs, idempotently, and exposes it for verification', async () => {
      const from = await provider.createVirtualAccount(customer, 'idem-va-3');
      const to = await provider.createVirtualAccount(merchant, 'idem-va-4');
      await fund(provider, vaRef(from.providerRef), 10_000n);

      const tx = await provider.transfer(
        vaRef(from.providerRef),
        vaRef(to.providerRef),
        ngn(2_500n),
        'ref-1',
        'idem-tx-1',
      );
      const replay = await provider.transfer(
        vaRef(from.providerRef),
        vaRef(to.providerRef),
        ngn(2_500n),
        'ref-1',
        'idem-tx-1',
      );
      expect(replay).toEqual(tx);

      expect(await provider.getBalance(vaRef(from.providerRef))).toEqual(ngn(7_500n));
      expect(await provider.getBalance(vaRef(to.providerRef))).toEqual(ngn(2_500n));

      const verified = await provider.getTransaction(tx.providerTxId);
      expect(verified).toMatchObject({ reference: 'ref-1', status: 'successful', amount: ngn(2_500n) });
    });

    it('rejects a transfer idempotency key reused with different details', async () => {
      const from = await provider.createVirtualAccount(customer, 'idem-va-5');
      const to = await provider.createVirtualAccount(merchant, 'idem-va-6');
      await fund(provider, vaRef(from.providerRef), 10_000n);
      await provider.transfer(
        vaRef(from.providerRef),
        vaRef(to.providerRef),
        ngn(100n),
        'ref-2',
        'idem-tx-2',
      );
      await expect(
        provider.transfer(vaRef(from.providerRef), vaRef(to.providerRef), ngn(999n), 'ref-2', 'idem-tx-2'),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    });

    it('refuses overdrafts and non-positive or non-NGN amounts', async () => {
      const from = await provider.createVirtualAccount(customer, 'idem-va-7');
      const to = await provider.createVirtualAccount(merchant, 'idem-va-8');
      await fund(provider, vaRef(from.providerRef), 100n);
      const send = (amountMinor: bigint, key: string, currency = 'NGN') =>
        provider.transfer(
          vaRef(from.providerRef),
          vaRef(to.providerRef),
          { amountMinor, currency } as never,
          `ref-${key}`,
          key,
        );

      await expect(send(101n, 'k1')).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
      await expect(send(0n, 'k2')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      await expect(send(-5n, 'k3')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      await expect(send(10n, 'k4', 'USD')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(await provider.getBalance(vaRef(from.providerRef))).toEqual(ngn(100n));
    });

    it('lists transactions touching an account for reconciliation', async () => {
      const from = await provider.createVirtualAccount(customer, 'idem-va-9');
      const to = await provider.createVirtualAccount(merchant, 'idem-va-10');
      await fund(provider, vaRef(from.providerRef), 1_000n);
      await provider.transfer(
        vaRef(from.providerRef),
        vaRef(to.providerRef),
        ngn(400n),
        'ref-3',
        'idem-tx-3',
      );

      const page = await provider.listTransactions(vaRef(to.providerRef), new Date(0));
      expect(page.items.map((t) => t.reference)).toEqual(['ref-3']);
    });

    it('reports unknown transactions and accounts as NOT_FOUND', async () => {
      await expect(provider.getTransaction('does-not-exist')).rejects.toBeInstanceOf(ProviderError);
      await expect(provider.getVirtualAccount('does-not-exist')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('never treats a parsed event as verified', () => {
      const event = provider.parseEvent({ type: 'transfer.inbound', providerTxId: 'x' }, {});
      expect(event.verified).toBe(false);
      expect(() => provider.parseEvent('not an event', {})).toThrowError(ProviderError);
    });
  });
}
