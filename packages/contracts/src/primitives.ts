import { z } from 'zod';

// API primitives shared by every endpoint (TARGET_ARCHITECTURE §17, ADR-11). Shapes only.
// `.meta({ id })` makes a schema a named, reusable OpenAPI component.

/** Entity identifiers are UUIDv7 (TARGET_ARCHITECTURE §4): non-enumerable, time-sortable. */
export const Id = z.uuid({ version: 'v7' }).meta({
  id: 'Id',
  description: 'UUIDv7 identifier',
  example: '01900000-0000-7000-8000-00000000000a',
});

/** NGN only for now (ADR-11). The field exists so adding a currency later is a controlled change. */
export const Currency = z.literal('NGN').meta({
  id: 'Currency',
  description: 'ISO 4217 currency code. Only NGN is accepted.',
});

const MAX_BIGINT = 9_223_372_036_854_775_807n; // PostgreSQL bigint upper bound

/**
 * An exact, non-negative amount in minor units (kobo) as a decimal digit string, e.g. "150000" = ₦1,500.00.
 * A string, not a JSON number: exact in every language (JavaScript numbers lose precision above 2^53)
 * and maps directly to bigint. No sign, no leading zeros, no decimal point.
 */
export const AmountMinor = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/, 'must be a whole number of kobo written as digits')
  // zod 4 runs this even when the regex failed, so only bound-check well-formed digit strings
  // (BigInt('1500.00') would throw instead of producing a validation error).
  .refine((v) => !/^[0-9]+$/.test(v) || BigInt(v) <= MAX_BIGINT, 'exceeds the largest storable amount')
  .meta({
    id: 'AmountMinor',
    description: 'Non-negative amount in minor units (kobo) as a decimal digit string',
    example: '150000',
  });

/**
 * A balance in minor units (kobo), which may be negative (an account taken below zero in its normal direction, a loss),
 * as a decimal digit string with an optional leading minus, e.g. "-2500". Exact, like AmountMinor.
 */
export const SignedAmountMinor = z
  .string()
  .regex(
    /^(0|-?[1-9][0-9]{0,18})$/,
    'must be a whole number of kobo written as digits, with an optional minus',
  )
  .meta({
    id: 'SignedAmountMinor',
    description: 'A balance in minor units (kobo) as a decimal digit string; negative with a leading minus',
    example: '-2500',
  });

export const SignedMoney = z
  .object({ amountMinor: SignedAmountMinor, currency: Currency })
  .meta({ id: 'SignedMoney', description: 'A balance, which may be negative' });
export type SignedMoney = z.infer<typeof SignedMoney>;

export const Money = z
  .object({
    amountMinor: AmountMinor,
    currency: Currency,
  })
  .meta({
    id: 'Money',
    description: 'An amount of money',
    example: { amountMinor: '150000', currency: 'NGN' },
  });

export type Money = z.infer<typeof Money>;

/** Stable, machine-readable error codes, e.g. NOT_FOUND, SUBSCRIPTION_SUSPENDED. */
export const ErrorCode = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/)
  .meta({ id: 'ErrorCode', example: 'NOT_FOUND' });

/** The standard error envelope (§17): { error: { code, message, details?, requestId } }. */
export const ErrorResponse = z
  .object({
    error: z.object({
      code: ErrorCode,
      message: z.string().meta({ description: 'Human-readable; never contains secrets' }),
      details: z.unknown().optional(),
      requestId: z.string().meta({ description: 'Echoed in the x-request-id response header' }),
    }),
  })
  .meta({ id: 'ErrorResponse', description: 'Every error response uses this envelope' });

export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Cursor pagination query (§17). The cursor is opaque to clients. */
export const CursorPageQuery = z.object({
  cursor: z.string().max(512).optional().meta({ description: 'Opaque cursor from a previous page' }),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** A page of items with the cursor for the next page (null when there is none). */
export const cursorPage = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

/** Required on money-moving POSTs (§17, §6): retries with the same key return the original result. */
export const IdempotencyKeyHeader = z.object({
  'idempotency-key': z
    .string()
    .min(8)
    .max(200)
    // Printable ASCII, no spaces (P6, TA-6: the key is stored as given).
    .regex(/^[!-~]+$/, 'must be printable ASCII without spaces')
    .meta({ description: 'Client-generated unique key for this operation; reuse it when retrying' }),
});

/** Cursor pagination (ADR-16): `limit` 1–100, default 50; the cursor is opaque, from the previous page's `nextCursor`. */
export const PageQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PageQuery = z.infer<typeof PageQuery>;
