import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

// Cursor pagination (TARGET_ARCHITECTURE ADR-16, frozen contracts; P5 plan §8.5, and the read-consistency rules of
// §7.2). A list is ordered newest first by (created_at, id); a page is one statement in its database function, which
// returns one row more than the page when another follows. The cursor is opaque to clients and carries only a
// position — the (created_at, id) of the last row returned, the timestamp in microseconds as the database stores it
// (a JavaScript Date keeps milliseconds, which would lose or repeat rows created in the same millisecond) — and a
// digest of the list and filters it was issued for. A cursor presented to another list, or with other filters, is
// refused (400 INVALID_CURSOR); continuation is the strict tuple predicate in the database function, so a tampered
// position can only move within the list the request itself names.

export type Position = { at: string; id: string };

/** A row as a list function returns it, with its position in microseconds (`to_char(…, '…US"Z"')`). */
export type Positioned = { id: string; position_at: string };

/** The SQL that turns a list function's `created_at` into the position a cursor carries. */
export const POSITION_AT = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS position_at`;

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The list and its normalised filters, e.g. `listPlatformMerchantMembers|merchantId=…`. */
const digest = (scope: string) => createHash('sha256').update(scope).digest('base64url').slice(0, 22);
const invalid = () => new AppError(400, 'INVALID_CURSOR', 'This cursor does not belong to this list');

export function encodeCursor(position: Position, scope: string): string {
  return Buffer.from(JSON.stringify({ at: position.at, id: position.id, d: digest(scope) })).toString(
    'base64url',
  );
}

/** The position a request continues from (null for a first page), or 400 INVALID_CURSOR. */
export function decodeCursor(raw: string | undefined, scope: string): Position | null {
  if (raw === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof value !== 'object' || value === null) throw invalid();
  const { at, id, d } = value as Record<string, unknown>;
  if (typeof at !== 'string' || !AT.test(at) || typeof id !== 'string' || !UUID.test(id)) throw invalid();
  if (d !== digest(scope)) throw invalid();
  return { at, id };
}

/** One page from a list function's rows: at most `limit` items, and a cursor when the function found one more. */
export function pageOf<R extends Positioned, T>(
  rows: readonly R[],
  limit: number,
  scope: string,
  map: (row: R) => T,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(map),
    nextCursor:
      rows.length > limit && last ? encodeCursor({ at: last.position_at, id: last.id }, scope) : null,
  };
}
