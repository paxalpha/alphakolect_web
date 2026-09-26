import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../../src/integrations/payments/fake-provider.js';
import { ngn } from '../../src/platform/money.js';
import { describeProviderContract } from './provider-contract.js';

describeProviderContract(
  'FakeProvider',
  () => new FakeProvider(),
  async (provider, va, amountMinor) => {
    (provider as FakeProvider).simulateInboundTransfer(va, ngn(amountMinor), 'funding');
  },
);

describe('FakeProvider specifics', () => {
  it('is deterministic', async () => {
    const owner = { kind: 'merchant', ownerId: 'm', name: 'M' } as const;
    const a = await new FakeProvider().createVirtualAccount(owner, 'k');
    const b = await new FakeProvider().createVirtualAccount(owner, 'k');
    expect(a).toEqual(b);
  });

  it('blocks transfers involving a closed account', async () => {
    const provider = new FakeProvider();
    const va = await provider.createVirtualAccount({ kind: 'customer', ownerId: 'c', name: 'C' }, 'k');
    const ref = { kind: 'va', providerRef: va.providerRef } as const;
    provider.simulateInboundTransfer(ref, ngn(500n), 'funding');
    await provider.closeVirtualAccount(va.providerRef);
    await expect(
      provider.transfer(
        ref,
        { kind: 'bank', bankCode: '000', accountNumber: '0000000000' },
        ngn(100n),
        'r',
        'i',
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_CLOSED' });
  });

  it('reports the pooled balance across all accounts when no account is given', async () => {
    const provider = new FakeProvider();
    for (const id of ['a', 'b']) {
      const va = await provider.createVirtualAccount({ kind: 'customer', ownerId: id, name: id }, id);
      provider.simulateInboundTransfer({ kind: 'va', providerRef: va.providerRef }, ngn(250n), 'funding');
    }
    expect(await provider.getBalance()).toEqual(ngn(500n));
  });
});
