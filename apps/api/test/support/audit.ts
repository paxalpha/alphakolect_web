import { randomBytes } from 'node:crypto';
import type pg from 'pg';

// Test-only audit helpers (P5.3a; P5 plan §8.1 "Failure is injected by a test-only BEFORE INSERT trigger on
// audit.audit_events, created by the table owner in the throwaway test database, that raises for one named
// (action, outcome)"). The trigger also matches one request id, so test files running at the same time on the same
// database are never affected.

/** A request id no other test uses (the API accepts a well-formed X-Request-ID until P5.8). */
export const markerRequestId = (tag: string) => `t-${tag}-${randomBytes(6).toString('hex')}`;

/**
 * Make every insert of (action, outcome) with this request id — and, if given, this target id — fail like a storage
 * error (SQLSTATE XX000 — not the catalog's refusal). Returns the cleanup, which drops the trigger and its function.
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
  await owner.query(
    `CREATE FUNCTION audit.${name}() RETURNS trigger LANGUAGE plpgsql AS $fn$
     BEGIN
       IF NEW.action = ${quote(action)} AND NEW.outcome = ${quote(outcome)} AND NEW.request_id = ${quote(requestId)}${target} THEN
         RAISE EXCEPTION 'injected audit storage failure' USING ERRCODE = 'XX000';
       END IF;
       RETURN NEW;
     END $fn$`,
  );
  await owner.query(
    `CREATE TRIGGER ${name} BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.${name}()`,
  );
  return async () => {
    await owner.query(`DROP TRIGGER ${name} ON audit.audit_events`);
    await owner.query(`DROP FUNCTION audit.${name}()`);
  };
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
