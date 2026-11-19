import type { Config } from '../../platform/config.js';
import { FakeProvider } from './fake-provider.js';
import type { PaymentProvider } from './provider.js';
import { PaystackProvider } from './paystack-provider.js';

/** The provider the configuration names (production refuses the fake at startup). */
export function createPaymentProvider(config: Pick<Config, 'payments'>): PaymentProvider {
  return config.payments.paystack ? new PaystackProvider(config.payments.paystack) : new FakeProvider();
}
