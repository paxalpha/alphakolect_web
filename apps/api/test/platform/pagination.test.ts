import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AppError } from '../../src/platform/errors.js';
import { decodeCursor, encodeCursor } from '../../src/platform/pagination.js';

// The cursor decoder (P5.7; ADR-16 frozen contracts; P5 plan §8.5): a cursor is opaque, carries only a position and a
// digest of its list, and anything else — another list's cursor, a forged shape, or a timestamp that is not a real
// instant — is 400 INVALID_CURSOR before any query runs. The last was the reviewer's finding at the P5.7 gate: an
// impossible date with its list's digest kept reached the database's timestamptz cast and answered 500.

const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
beforeAll(() => owner.connect());
afterAll(() => owner.end());

const SCOPE = 'listPlatformMerchants';
const ID = '01900000-0000-7000-8000-0000000000d0';
/** A cursor of this list (its digest kept) whose position carries the given timestamp. */
const cursorAt = (at: string) => encodeCursor({ at, id: ID }, SCOPE);
const refused = (raw: string) => {
  try {
    decodeCursor(raw, SCOPE);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return (err as AppError).code === 'INVALID_CURSOR' && (err as AppError).status === 400;
  }
  return false;
};

const REAL = [
  '2026-10-16T21:08:55.123456Z',
  '2024-02-29T23:59:59.999999Z', // a leap day
  '0001-01-01T00:00:00.000000Z',
  '9999-12-31T23:59:59.999999Z',
];
/** Right shape, not a real instant: the reviewer's month 99 and its kin. */
const IMPOSSIBLE = [
  '2026-99-01T00:00:00.000000Z',
  '2026-00-10T00:00:00.000000Z',
  '2026-02-30T00:00:00.000000Z',
  '2025-02-29T00:00:00.000000Z', // not a leap year
  '2026-04-31T00:00:00.000000Z',
  '2026-01-00T00:00:00.000000Z',
  '2026-01-01T24:00:00.000000Z',
  '2026-01-01T23:60:00.000000Z',
  '2026-12-31T23:59:60.000000Z', // a leap second
  '0000-01-01T00:00:00.000000Z',
];

describe('decodeCursor', () => {
  it('returns the position of a cursor of this list, unchanged to the microsecond', () => {
    for (const at of REAL) expect(decodeCursor(cursorAt(at), SCOPE)).toEqual({ at, id: ID });
    expect(decodeCursor(undefined, SCOPE)).toBeNull();
  });

  it.each(IMPOSSIBLE)(
    'a timestamp that is not a real instant (%s), its digest kept: 400 INVALID_CURSOR',
    (at) => {
      expect(refused(cursorAt(at))).toBe(true);
    },
  );

  it('another list’s cursor, a forged shape or garbage: 400 INVALID_CURSOR', () => {
    for (const raw of [
      encodeCursor({ at: REAL[0]!, id: ID }, 'listPlatformStaff'),
      Buffer.from(JSON.stringify({ at: '2026-10-16T21:08:55Z', id: ID, d: 'x' })).toString('base64url'),
      Buffer.from(JSON.stringify({ at: REAL[0], id: 'not-a-uuid' })).toString('base64url'),
      Buffer.from('[]').toString('base64url'),
      'not a cursor',
    ])
      expect(refused(raw), raw).toBe(true);
  });

  it('what it accepts the database reads; what it refused the database could not have read (month, day, year 0)', async () => {
    for (const at of REAL) await expect(owner.query(`SELECT $1::timestamptz`, [at])).resolves.toBeTruthy();
    for (const at of IMPOSSIBLE.slice(0, 6).concat(IMPOSSIBLE.slice(-1)))
      await expect(owner.query(`SELECT $1::timestamptz`, [at]), at).rejects.toMatchObject({
        code: expect.stringMatching(/^22/),
      });
  });
});
