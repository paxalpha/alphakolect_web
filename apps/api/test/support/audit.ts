import { randomBytes } from 'node:crypto';
import type pg from 'pg';

// Test-only audit helpers (P5.3a; P5 plan §8.1 "Failure is injected by a test-only BEFORE INSERT trigger on
// audit.audit_events, created by the table owner in the throwaway test database, that raises for one named
// (action, outcome)"). The trigger also matches one request id, so test files running at the same time on the same
// database are never affected.

/**
 * The pairs of P5.3a's transitional list (§10 P5.3a, `3add9ea`), written then by P4's code through recordWithin. P5.5
 * moved each into its database function (steps 3–5) and deleted the list and the method; the transitional-writer gate
 * (R32) keeps proving that with this record of what the list held.
 */
export const FORMER_TRANSITIONAL_PAIRS = [
  'auth.invitation_accepted/success',
  'merchant.profile_updated/success',
  'merchant.branch_created/success',
  'merchant.branch_updated/success',
  'merchant.role_created/success',
  'merchant.role_updated/success',
  'merchant.member_assigned/success',
  'merchant.member_deactivated/success',
  'merchant.member_reactivated/success',
  'merchant.invitation_issued/success',
  'merchant.invitation_revoked/success',
  'platform.merchant_deactivated/success',
  'platform.merchant_reactivated/success',
  'platform.ownership_transferred/success',
] as const;

/** A request id no other test uses (the API accepts a well-formed X-Request-ID until P5.8). */
export const markerRequestId = (tag: string) => `t-${tag}-${randomBytes(6).toString('hex')}`;

/**
 * Make every insert of (action, outcome) with this request id — and, if given, this target id — fail like a storage
 * error (SQLSTATE XX000 — not the catalog's refusal). Returns the cleanup, which drops the trigger and its function.
 *
 * Test files run in parallel, and two of them adding or dropping their triggers at once deadlocked on the table
 * (P8 gate, 2026-10-26: two DROP TRIGGERs, each holding what the other's lock upgrade needed). Each change is one
 * transaction that first takes this helper's advisory lock, then the table's lock, so they take turns.
 */
export async function failAuditInsert(
  owner: pg.Client,
  action: string,
  outcome: string,
  requestId: string,
  targetId?: string,
): Promise<() => Promise<void>> {
  const name = `test_fail_${randomBytes(6).toString('hex')}`;
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const target = targetId === undefined ? '' : ` AND NEW.target_id = ${quote(targetId)}`;
  await serialized(owner, [
    `CREATE FUNCTION audit.${name}() RETURNS trigger LANGUAGE plpgsql AS $fn$
     BEGIN
       IF NEW.action = ${quote(action)} AND NEW.outcome = ${quote(outcome)} AND NEW.request_id = ${quote(requestId)}${target} THEN
         RAISE EXCEPTION 'injected audit storage failure' USING ERRCODE = 'XX000';
       END IF;
       RETURN NEW;
     END $fn$`,
    `CREATE TRIGGER ${name} BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.${name}()`,
  ]);
  return () =>
    serialized(owner, [`DROP TRIGGER ${name} ON audit.audit_events`, `DROP FUNCTION audit.${name}()`]);
}

/** The injector's advisory lock: one trigger change at a time across the run's test files. */
const INJECTOR_LOCK = 0x7e57_a0d1;

/** Run DDL on audit.audit_events's triggers in turn with every other test file's (see failAuditInsert). */
export async function serialized(owner: pg.Client, statements: string[]): Promise<void> {
  await owner.query('BEGIN');
  try {
    await owner.query(`SELECT pg_advisory_xact_lock(${INJECTOR_LOCK})`);
    await owner.query('LOCK TABLE audit.audit_events IN ACCESS EXCLUSIVE MODE');
    for (const sql of statements) await owner.query(sql);
    await owner.query('COMMIT');
  } catch (err) {
    await owner.query('ROLLBACK');
    throw err;
  }
}

/** The stored audit rows of one request id (read as the table owner). */
export async function auditRows(owner: pg.Client, requestId: string) {
  const { rows } = await owner.query(
    `SELECT action, outcome, merchant_id, actor_identity_id, actor_audience, actor_membership_id, target_type, target_id,
            request_id, summary
       FROM audit.audit_events WHERE request_id = $1 ORDER BY occurred_at, id`,
    [requestId],
  );
  return rows;
}
