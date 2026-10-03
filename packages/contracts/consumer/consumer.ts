// Independent typecheck consumer (P2 exit criterion, amended 2026-10-03: apps/web is deferred to P13).
// It imports the package by its published name, so it resolves the BUILT output (dist/) through
// package.json "exports" — exactly what an external consumer gets. It is type-checked, never run.
//
// Each @ts-expect-error asserts that misuse is a compile error. If the client lost its types (e.g. became
// `any`), these directives would be unused and the typecheck would fail.

import { AmountMinor, type Money } from '@alphakolect/contracts';
import { createApiClient, type ApiSchemas } from '@alphakolect/contracts/client';

const client = createApiClient({ baseUrl: 'https://api.example.test' });

export async function consume(): Promise<void> {
  const { data, error } = await client.GET('/v1/health');
  if (data) {
    const status: 'ok' = data.status;
    void status;
  }
  if (error) {
    const code: string = error.error.code;
    const requestId: string = error.error.requestId;
    void code;
    void requestId;
  }

  // @ts-expect-error unknown paths are rejected
  await client.GET('/v1/does-not-exist');

  // @ts-expect-error /v1/health has no POST
  await client.POST('/v1/health');
}

// Money from the zod contract and from the generated OpenAPI types agree.
export const fromContract: Money = { amountMinor: '150000', currency: 'NGN' };
export const fromSpec: ApiSchemas['Money'] = fromContract;
export const parsedAmount: string = AmountMinor.parse('150000');

// @ts-expect-error amounts are digit strings, never JSON numbers
export const numericAmount: Money = { amountMinor: 150000, currency: 'NGN' };

// @ts-expect-error only NGN is accepted
export const otherCurrency: ApiSchemas['Money'] = { amountMinor: '1', currency: 'USD' };
