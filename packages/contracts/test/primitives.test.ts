import { describe, expect, it } from 'vitest';
import { AmountMinor, CursorPageQuery, ErrorResponse, Id, Money } from '../src/index.js';

describe('AmountMinor (kobo as an exact digit string)', () => {
  it.each(['0', '1', '150000', '9223372036854775807'])('accepts %s', (v) => {
    expect(AmountMinor.safeParse(v).success).toBe(true);
  });

  it.each([
    ['a negative amount', '-1'],
    ['a leading zero', '0150'],
    ['a decimal point', '1500.00'],
    ['an empty string', ''],
    ['whitespace', ' 1'],
    ['an exponent', '1e5'],
    ['a value above PostgreSQL bigint', '9223372036854775808'],
  ])('rejects %s', (_label, v) => {
    expect(AmountMinor.safeParse(v).success).toBe(false);
  });

  it('rejects JSON numbers (they lose precision above 2^53)', () => {
    expect(AmountMinor.safeParse(150000).success).toBe(false);
  });
});

describe('Money', () => {
  it('accepts NGN only', () => {
    expect(Money.safeParse({ amountMinor: '150000', currency: 'NGN' }).success).toBe(true);
    expect(Money.safeParse({ amountMinor: '150000', currency: 'USD' }).success).toBe(false);
  });
});

describe('Id', () => {
  it('accepts UUIDv7 and rejects other versions', () => {
    expect(Id.safeParse('01900000-0000-7000-8000-00000000000a').success).toBe(true);
    expect(Id.safeParse('3f0b4d2c-8a5e-4c1d-9b2a-1f2e3d4c5b6a').success).toBe(false); // v4
    expect(Id.safeParse('1').success).toBe(false);
  });
});

describe('ErrorResponse', () => {
  it('matches the envelope the API sends', () => {
    const body = { error: { code: 'NOT_FOUND', message: 'Route not found', requestId: 'abc' } };
    expect(ErrorResponse.parse(body)).toEqual(body);
  });

  it('requires an upper-snake-case code and a request id', () => {
    expect(
      ErrorResponse.safeParse({ error: { code: 'not found', message: 'x', requestId: 'a' } }).success,
    ).toBe(false);
    expect(ErrorResponse.safeParse({ error: { code: 'X', message: 'x' } }).success).toBe(false);
  });
});

describe('CursorPageQuery', () => {
  it('defaults and bounds the limit', () => {
    expect(CursorPageQuery.parse({})).toEqual({ limit: 25 });
    expect(CursorPageQuery.parse({ limit: '10' }).limit).toBe(10);
    expect(CursorPageQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(CursorPageQuery.safeParse({ limit: '101' }).success).toBe(false);
  });
});
