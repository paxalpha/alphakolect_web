import express from 'express';
import pg from 'pg';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AuditLog, AuditUsageError, type AuditContext } from '../../src/modules/audit/audit-log.js';
import { AUDIT_CATALOG } from '../../src/modules/audit/catalog.js';
import { createDb } from '../../src/platform/db.js';
import { errorHandler } from '../../src/platform/http/error-handler.js';
import { resolveRequestId } from '../../src/platform/http/request-id.js';
import { auditRows, failAuditInsert, markerRequestId } from '../support/audit.js';

// P5.3a (ADR-16 §3.5; P5 plan §8.1, §8.2, §9.4): the three audit entry points against the real database, each row of
// the §8.1 behaviour table, the §9.4 signal lines, and the TypeScript mirror of the catalog.

const db = createDb(inject('apiDatabaseUrl'));
const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
beforeAll(() => owner.connect());
afterAll(async () => {
  await owner.end();
  await db.close();
});

type Line = Record<string, unknown>;
const lines: Line[] = [];
const audit = new AuditLog(db, { error: (obj: Line) => void lines.push(obj) } as never);
const signalsOf = (requestId: string) => lines.filter((l) => l.requestId === requestId);

/** Cast events the types would refuse: these tests prove the run-time checks behind the types. */
const loose = (event: AuditContext & { action: string; outcome: string }) => event as never;

const SECRET = 'correct-horse-battery-staple';

describe('the TypeScript mirror', () => {
  it('equals audit.event_catalog — every pair, class, writer pattern and summary rule', async () => {
    const { rows } = await owner.query(
      `SELECT identifier, outcome, class, writer_pattern AS pattern, summary_allowlist AS summary
         FROM audit.event_catalog WHERE status = 'active'`,
    );
    const key = (e: { identifier: string; outcome: string }) => `${e.identifier}/${e.outcome}`;
    const table = Object.fromEntries(rows.map((r) => [key(r), r]));
    const mirror = Object.fromEntries(
      AUDIT_CATALOG.map((e) => [key(e), { ...e, summary: { ...e.summary } }]),
    );
    expect(mirror).toEqual(table);
  });
});

describe('mutateAudited — atomic, pattern B: every problem rolls the change back', () => {
  /** A change (an unrelated valid event) and then the audited event, in one transaction. */
  async function changeThenAudit(requestId: string, event: Parameters<AuditLog['mutateAudited']>[1]) {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO audit.audit_events (action, outcome, request_id, summary) VALUES ('auth.login', 'failure', $1, '{"reason": "probe"}')`,
        [requestId],
      );
      await audit.mutateAudited(tx, event);
    });
  }

  it('stores the event with its change', async () => {
    const requestId = markerRequestId('mut-ok');
    await changeThenAudit(requestId, { action: 'auth.logout', outcome: 'success', requestId });
    expect((await auditRows(owner, requestId)).map((r) => `${r.action}/${r.outcome}`)).toEqual([
      'auth.login/failure',
      'auth.logout/success',
    ]);
  });

  it.each([
    ['an unknown identifier', { action: 'auth.teleport', outcome: 'success' }, AuditUsageError],
    ['a best-effort event (another class)', { action: 'auth.login', outcome: 'failure' }, AuditUsageError],
    [
      'a pattern-A event (another pattern)',
      { action: 'merchant.profile_updated', outcome: 'success' },
      AuditUsageError,
    ],
  ])('refuses %s before writing anything', async (_label, pair, error) => {
    const requestId = markerRequestId('mut-usage');
    await expect(changeThenAudit(requestId, loose({ ...pair, requestId }))).rejects.toBeInstanceOf(error);
    expect(await auditRows(owner, requestId)).toEqual([]);
  });

  it.each([
    ['a summary field outside the allowlist', { sessionsRevoked: true, secret: SECRET }],
    ['an over-long value', { sessionsRevoked: 'x'.repeat(10) }],
  ])('rolls back on %s (refused by the catalog)', async (_label, summary) => {
    const requestId = markerRequestId('mut-invalid');
    await expect(
      changeThenAudit(
        requestId,
        loose({ action: 'auth.password_change', outcome: 'success', requestId, summary }),
      ),
    ).rejects.toMatchObject({ constraint: 'audit_event_catalog' });
    expect(await auditRows(owner, requestId)).toEqual([]);
  });

  it('rolls back on a storage failure', async () => {
    const requestId = markerRequestId('mut-storage');
    const restore = await failAuditInsert(owner, 'auth.logout', 'success', requestId);
    try {
      await expect(
        changeThenAudit(requestId, { action: 'auth.logout', outcome: 'success', requestId }),
      ).rejects.toThrow(/injected audit storage failure/);
    } finally {
      await restore();
    }
    expect(await auditRows(owner, requestId)).toEqual([]);
  });
});

describe('recordBestEffort — best effort: programming errors throw, data and storage problems become signals', () => {
  it('stores a best-effort event in its own transaction', async () => {
    const requestId = markerRequestId('be-ok');
    await audit.recordBestEffort({
      action: 'auth.login',
      outcome: 'failure',
      requestId,
      summary: { reason: 'probe' },
    });
    expect(await auditRows(owner, requestId)).toMatchObject([{ action: 'auth.login', outcome: 'failure' }]);
    expect(signalsOf(requestId)).toEqual([]);
  });

  it.each([
    ['an unknown identifier', { action: 'auth.teleport', outcome: 'failure' }],
    ['an atomic event (a downgrade)', { action: 'auth.signup', outcome: 'success' }],
    [
      'the atomic outcome of an identifier whose failures are best effort',
      { action: 'auth.password_change', outcome: 'success' },
    ],
    ['an identifier with no best-effort pair', { action: 'auth.logout', outcome: 'failure' }],
  ])('throws on %s — never stored, never downgraded', async (_label, pair) => {
    const requestId = markerRequestId('be-usage');
    await expect(audit.recordBestEffort(loose({ ...pair, requestId }))).rejects.toBeInstanceOf(
      AuditUsageError,
    );
    expect(await auditRows(owner, requestId)).toEqual([]);
    expect(signalsOf(requestId)).toEqual([]);
  });

  it('does not store a disallowed outcome of a best-effort identifier, and signals it', async () => {
    const requestId = markerRequestId('be-outcome');
    await audit.recordBestEffort(loose({ action: 'auth.login', outcome: 'denied', requestId }));
    expect(await auditRows(owner, requestId)).toEqual([]);
    expect(signalsOf(requestId)).toEqual([
      {
        signal: 'audit_validation_failure',
        event: 'auth.login/denied',
        requestId,
        reason: 'outcome_not_in_catalog',
      },
    ]);
  });

  it.each([
    ['a summary field outside the allowlist', { reason: 'probe', password: SECRET }],
    ['an over-long value', { reason: 'r'.repeat(65) }],
  ])(
    'does not store %s, and signals audit_validation_failure without the values',
    async (_label, summary) => {
      const requestId = markerRequestId('be-invalid');
      await audit.recordBestEffort(loose({ action: 'auth.login', outcome: 'failure', requestId, summary }));
      expect(await auditRows(owner, requestId)).toEqual([]);
      expect(signalsOf(requestId)).toEqual([
        { signal: 'audit_validation_failure', event: 'auth.login/failure', requestId, reason: '23514' },
      ]);
      expect(JSON.stringify(signalsOf(requestId))).not.toContain(SECRET);
    },
  );

  it.each([
    ['a failure event', 'auth.login', 'failure', { reason: 'probe' }, 'audit_write_failure'],
    [
      'a denial',
      'merchant.profile_updated',
      'denied',
      { reason: 'not_owner', kind: 'staff' },
      'audit_denial_write_failure',
    ],
  ])(
    'on a storage failure of %s: not stored, no error, the signal %s',
    async (_label, action, outcome, summary, signal) => {
      const requestId = markerRequestId('be-storage');
      const restore = await failAuditInsert(owner, action, outcome, requestId);
      try {
        await audit.recordBestEffort(loose({ action, outcome, requestId, summary }));
      } finally {
        await restore();
      }
      expect(await auditRows(owner, requestId)).toEqual([]);
      expect(signalsOf(requestId)).toEqual([
        { signal, event: `${action}/${outcome}`, requestId, reason: 'XX000' },
      ]);
    },
  );
});

describe('the HTTP status of the request in hand', () => {
  // A synthetic endpoint: a programming error in an audit call fails the request (500), whatever the entry point.
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }), genReqId: resolveRequestId }));
  app.get('/probe/:which', async (req, res, next) => {
    try {
      const requestId = String(req.id);
      if (req.params.which === 'downgrade')
        await audit.recordBestEffort(loose({ action: 'auth.signup', outcome: 'success', requestId }));
      if (req.params.which === 'unknown')
        await audit.recordBestEffort(loose({ action: 'auth.teleport', outcome: 'failure', requestId }));
      if (req.params.which === 'storage') {
        const restore = await failAuditInsert(owner, 'auth.login', 'failure', requestId);
        try {
          await audit.recordBestEffort({
            action: 'auth.login',
            outcome: 'failure',
            requestId,
            summary: { reason: 'probe' },
          });
        } finally {
          await restore();
        }
      }
      res.status(401).json({ ok: false });
    } catch (err) {
      next(err);
    }
  });
  app.use(errorHandler);

  it.each([
    ['a downgrade', 'downgrade', 500],
    ['an unknown identifier', 'unknown', 500],
    ['a best-effort storage failure (the response is unchanged)', 'storage', 401],
  ])('%s → %i', async (_label, which, status) => {
    const requestId = markerRequestId(`http-${which}`);
    const res = await request(app).get(`/probe/${which}`).set('X-Request-ID', requestId);
    expect(res.status).toBe(status);
  });
});
