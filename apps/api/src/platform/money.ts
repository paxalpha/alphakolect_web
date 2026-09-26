// Money in minor units (kobo) as bigint, with an ISO-4217 currency (ADR-11).
// NGN is the only accepted currency for now; the field exists so adding one later is a controlled change.

export const SUPPORTED_CURRENCIES = ['NGN'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export type Money = Readonly<{ amountMinor: bigint; currency: Currency }>;

export const ngn = (amountMinor: bigint): Money => ({ amountMinor, currency: 'NGN' });

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

/** Throws unless `money` is a strictly positive amount in a supported currency. */
export function assertPositive(money: Money): void {
  if (!SUPPORTED_CURRENCIES.includes(money.currency)) {
    throw new InvalidMoneyError(`Unsupported currency: ${String(money.currency)}`);
  }
  if (typeof money.amountMinor !== 'bigint' || money.amountMinor <= 0n) {
    throw new InvalidMoneyError('Amount must be a positive number of minor units');
  }
}
