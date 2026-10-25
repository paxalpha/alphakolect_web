import { createHash } from 'node:crypto';
import type { Db } from './db.js';
import { AppError } from './errors.js';

// Idempotency records (P6, TA-6; TARGET_ARCHITECTURE §17 "Idempotency-Key on money-moving POSTs"). A command claims
// its key in a statement of its own, before its transaction: util.claim_idempotency stores the key, scoped to the
// business, the person and the operation, with the request's fingerprint. The command's database function then locks
// the claim, does its work and completes the claim with its response in the same transaction; a command that is
// refused releases the claim so the key can be used again. A retry with the same key and request gets the stored
// response; the key with another request is refused (409 IDEMPOTENCY_KEY_REUSED); the same request while the first is
// still running is refused too (409 IDEMPOTENCY_IN_PROGRESS) — the client retries later and then gets the answer.

export type IdempotentOperation = 'ledger.manual_entry' | 'ledger.entry_reversal';

export type Claim = { key: string; fingerprint: string; operation: IdempotentOperation };

/** The request's fingerprint: SHA-256 over the operation, its target and its parsed body, keys sorted. */
export function fingerprintOf(operation: IdempotentOperation, target: string | null, body: unknown): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value as object)
              .sort()
              .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
          )
        : value;
  return createHash('sha256')
    .update(JSON.stringify([operation, target, canonical(body)]))
    .digest('hex');
}

export class IdempotencyStore {
  constructor(private readonly db: Db) {}

  /**
   * Claim the key for this request: null when the command should run; the stored response for a retry of a completed
   * command. @throws AppError 409 for a key reused with another request, or a request still running.
   */
  async claim(sessionId: string, claim: Claim): Promise<Record<string, unknown> | null> {
    const [row] = await this.db.query<{ outcome: string; response: Record<string, unknown> | null }>(
      `SELECT outcome, response FROM util.claim_idempotency($1, $2, $3, $4)`,
      [sessionId, claim.operation, claim.key, claim.fingerprint],
    );
    switch (row?.outcome) {
      case 'claimed':
        return null;
      case 'completed':
        return row.response!;
      case 'key_reused':
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used with a different request',
        );
      case 'in_progress':
        throw inProgress();
      default:
        // The session was validated on this request; absent only if it ended in between.
        throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
  }

  /** Release a claim whose command was refused or failed; best effort (an unreleased claim expires in minutes). */
  async release(sessionId: string, claim: Claim): Promise<void> {
    await this.db
      .query(`SELECT util.release_idempotency($1, $2, $3, $4)`, [
        sessionId,
        claim.operation,
        claim.key,
        claim.fingerprint,
      ])
      .catch(() => undefined);
  }
}

export const inProgress = () =>
  new AppError(
    409,
    'IDEMPOTENCY_IN_PROGRESS',
    'A request with this Idempotency-Key is still being processed',
  );
