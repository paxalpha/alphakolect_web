import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// Savings (P8; docs/architecture/P8_IMPLEMENTATION_PLAN.md; the owner's answers of 2026-10-25,
// docs/business/P8_OWNER_SAVINGS.md): packages with one fee rule, enrolment, cash collections by the customer's agent
// (BR-3, D1), remittances and their fees (BR-5.3, 5.5, 5.6, 6.1, 6.2), 31-day cycles (BR-5.2), cancellation (Q6),
// withdrawals and target savings (BR-7.1–7.4, Q9), the reads and TA-14. Commands and reads are called as the API calls
// them (alphakolect_app); effects are read as the table owner. The races are in savings-races.test.ts.

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [app, owner] = await Promise.all([connectAs('app'), connectAs('migrator')]);
});
afterAll(async () => {
  await Promise.all([app.end(), owner.end()]);
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const email = (tag: string) => `${tag}-${process.pid}-${randomBytes(4).toString('hex')}@example.test`;
const unique = (tag: string) => `${tag} ${randomBytes(3).toString('hex')}`;
const phone = () => `080${String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, '0')}`;
const key = () => `k-${randomBytes(8).toString('hex')}`;
const one = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0];
const call = async (sql: string, params: unknown[]) => (await app.query(sql, params)).rows[0];

async function session(identityId: string, audience: string, membershipId: string) {
  const { rows } = await app.query(
    `SELECT * FROM identity.create_session($1, $2, $3, 'full', $4, 86400, 1209600, NULL, NULL)`,
    [identityId, audience, membershipId, hash()],
  );
  return rows[0].session_id as string;
}

/** An active business with an owner session and two branches. */
async function business() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, $3)`, [
    email('owner'),
    ARGON,
    unique('Savers'),
  ]);
  const verification = hash();
  await app.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    verification,
  ]);
  await app.query(`SELECT identity.verify_email($1)`, [verification]);
  const membershipId = (
    await one(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [s.identity_id])
  ).id as string;
  const branch = async () =>
    (
      await one(`INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
        s.merchant_id,
        unique('Branch'),
      ])
    ).id as string;
  return {
    merchantId: s.merchant_id as string,
    name: (await one(`SELECT name FROM tenancy.merchants WHERE id = $1`, [s.merchant_id])).name as string,
    membershipId,
    branchA: await branch(),
    branchB: await branch(),
    session: await session(s.identity_id, 'merchant', membershipId),
  };
}
type Business = Awaited<ReturnType<typeof business>>;

/** A staff member (a role holding exactly `permissions`, optionally restricted to a branch) or an agent. */
async function member(
  b: Business,
  kind: 'staff' | 'agent',
  opts: { permissions?: string[]; branchId?: string | null } = {},
) {
  let roleId: string | null = null;
  if (kind === 'staff') {
    roleId = (
      await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
        b.merchantId,
        unique('Role'),
      ])
    ).id as string;
    if (opts.permissions?.length) {
      const r = await call(`SELECT outcome FROM tenancy.set_role_permissions($1, $2, $3)`, [
        b.session,
        roleId,
        opts.permissions,
      ]);
      expect(r.outcome).toBe('ok');
    }
  }
  const identityId = (
    await one(
      `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
      [email(kind), ARGON],
    )
  ).id as string;
  const membershipId = (
    await one(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id, branch_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [b.merchantId, identityId, kind, roleId, opts.branchId ?? null],
    )
  ).id as string;
  return {
    identityId,
    membershipId,
    session: await session(identityId, kind === 'agent' ? 'agent' : 'merchant', membershipId),
  };
}

const customer = async (b: Business, agent: string | null, branchId = b.branchA) => {
  const r = await call(
    `SELECT * FROM customers.create_customer($1, $2, 'Ada Obi', $3, NULL, NULL, NULL, $4)`,
    [b.session, branchId, phone(), agent],
  );
  expect(r.outcome).toBe('ok');
  return r.id as string;
};
const createPackage = (
  s: string,
  p: { name?: string; kind?: string; amount?: number; rule?: string; bp?: number | null } = {},
) =>
  call(
    `SELECT * FROM savings.create_package($1, $2, $3, $4, $5, $6, '203.0.113.9', 'savings-test', 'rq-1')`,
    [
      s,
      p.name ?? unique('Alpha 1K'),
      p.kind ?? 'fixed',
      p.amount ?? 100_000,
      p.rule ?? 'first_contribution',
      p.bp === undefined ? null : p.bp,
    ],
  );
const enrol = (s: string, customerId: string, packageId: string) =>
  call(`SELECT * FROM savings.enrol_customer($1, $2, $3)`, [s, customerId, packageId]);
const record = (s: string, customerId: string, amount: number, k = key()) =>
  call(`SELECT * FROM savings.record_collection($1, $2, $3, $4, '203.0.113.9', 'agent-app', 'rq-2')`, [
    s,
    customerId,
    amount,
    k,
  ]);
const approve = (s: string, agent: string, ids: string[], cash: number) =>
  call(`SELECT * FROM savings.approve_remittance($1, $2, $3, $4)`, [s, agent, ids, cash]);
const cancel = (s: string, id: string, reason: string | null = 'Recorded twice') =>
  call(`SELECT * FROM savings.cancel_collection($1, $2, $3)`, [s, id, reason]);
const move = (s: string, customerId: string, kind: string, amount: number, k = key()) =>
  call(`SELECT * FROM savings.move_savings($1, $2, $3, $4, $5)`, [s, customerId, kind, amount, k]);
const balance = async (subject: string, code: string) =>
  Number(
    (
      await one(
        `SELECT p.balance_minor::text AS b FROM ledger.accounts a JOIN ledger.balance_projection p ON p.account_id = a.id
          WHERE a.subject_id = $1 AND a.code = $2`,
        [subject, code],
      )
    ).b,
  );
const systemBalance = async (b: Business, code: string) =>
  Number(
    (
      await one(
        `SELECT p.balance_minor::text AS b FROM ledger.accounts a JOIN ledger.balance_projection p ON p.account_id = a.id
          WHERE a.merchant_id = $1 AND a.code = $2 AND a.subject_id IS NULL`,
        [b.merchantId, code],
      )
    ).b,
  );

/** A business with an agent, an enrolled customer of theirs, and a package (fixed ₦1,000, first contribution). */
async function saver(pkg: Parameters<typeof createPackage>[1] = {}) {
  const b = await business();
  const agent = await member(b, 'agent');
  const p = await createPackage(b.session, pkg);
  expect(p.outcome).toBe('ok');
  const c = await customer(b, agent.membershipId);
  expect((await enrol(b.session, c, p.id)).outcome).toBe('ok');
  return { b, agent, packageId: p.id as string, customerId: c };
}

describe('packages (Q1, Q2; BR-6.1)', () => {
  it('a fixed or a flexible package, with exactly one fee rule', async () => {
    const b = await business();
    const fixed = await createPackage(b.session, { name: 'Alpha 1K' });
    expect(fixed).toMatchObject({
      outcome: 'ok',
      kind: 'fixed',
      fee_rule: 'first_contribution',
      fee_rate_bp: null,
    });
    const flex = await createPackage(b.session, {
      kind: 'flexible',
      amount: 50_000,
      rule: 'percentage',
      bp: 200,
    });
    expect(flex).toMatchObject({ outcome: 'ok', kind: 'flexible', fee_rule: 'percentage', fee_rate_bp: 200 });
    // A rate with the first-contribution rule, a percentage without one, an unknown kind: refused.
    expect((await createPackage(b.session, { bp: 200 })).outcome).toBe('invalid');
    expect((await createPackage(b.session, { rule: 'percentage', bp: null })).outcome).toBe('invalid');
    expect((await createPackage(b.session, { kind: 'variable' })).outcome).toBe('invalid');
    expect((await createPackage(b.session, { amount: 0 })).outcome).toBe('invalid');
    expect((await createPackage(b.session, { name: 'alpha 1k' })).outcome).toBe('name_taken');
  });

  it('BR-6.1 in the schema: a package never holds both fee rules', async () => {
    const b = await business();
    await expectSqlState(
      owner.query(
        `INSERT INTO savings.packages (merchant_id, name, kind, amount_minor, fee_rule, fee_rate_bp)
         VALUES ($1, 'Both', 'fixed', 100000, 'first_contribution', 200)`,
        [b.merchantId],
      ),
      SQLSTATE.checkViolation,
    );
  });

  it('is renamed or archived, never re-termed (P8-7); an archived package takes no new enrolment', async () => {
    const { b, packageId } = await saver();
    const renamed = await call(`SELECT * FROM savings.update_package($1, $2, $3)`, [
      b.session,
      packageId,
      JSON.stringify({ name: 'Alpha Daily' }),
    ]);
    expect(renamed).toMatchObject({ outcome: 'ok', name: 'Alpha Daily' });
    expect(
      (
        await call(`SELECT * FROM savings.update_package($1, $2, $3)`, [
          b.session,
          packageId,
          JSON.stringify({ amountMinor: '5' }),
        ])
      ).outcome,
    ).toBe('invalid');
    const archived = await call(`SELECT * FROM savings.update_package($1, $2, $3)`, [
      b.session,
      packageId,
      JSON.stringify({ status: 'archived' }),
    ]);
    expect(archived.status).toBe('archived');
    expect(archived.archived_at).not.toBeNull();
    expect((await enrol(b.session, await customer(b, null), packageId)).outcome).toBe('invalid_package');
  });

  it('needs merchant.packages.manage; agents and other permissions are refused', async () => {
    const b = await business();
    const reader = await member(b, 'staff', { permissions: ['merchant.savings.read'] });
    const agent = await member(b, 'agent');
    expect((await createPackage(reader.session)).outcome).toBe('forbidden');
    expect((await createPackage(agent.session)).outcome).toBe('forbidden');
    const manager = await member(b, 'staff', { permissions: ['merchant.packages.manage'] });
    expect((await createPackage(manager.session)).outcome).toBe('ok');
  });
});

describe('enrolment (BR-5.1, Q10)', () => {
  it('one package at a time; a change with no cycle running takes effect now', async () => {
    const { b, customerId, packageId } = await saver();
    const other = (await createPackage(b.session)).id;
    const changed = await enrol(b.session, customerId, other);
    expect(changed).toMatchObject({
      outcome: 'ok',
      package_id: other,
      next_package_id: null,
      effective: 'now',
    });
    expect(
      (await one(`SELECT count(*)::int AS n FROM savings.enrolments WHERE customer_id = $1`, [customerId])).n,
    ).toBe(1);
    await expectSqlState(
      owner.query(
        `INSERT INTO savings.enrolments (merchant_id, customer_id, package_id) VALUES ($1, $2, $3)`,
        [b.merchantId, customerId, packageId],
      ),
      SQLSTATE.uniqueViolation,
    );
  });

  it('Q10: during a cycle the change waits for the next one, and takes effect with it', async () => {
    const { b, agent, customerId } = await saver();
    const first = await record(agent.session, customerId, 100_000);
    expect((await approve(b.session, agent.membershipId, [first.id], 100_000)).outcome).toBe('ok');
    const next = (await createPackage(b.session, { amount: 200_000 })).id;
    const waiting = await enrol(b.session, customerId, next);
    expect(waiting).toMatchObject({ outcome: 'ok', next_package_id: next, effective: 'next_cycle' });
    // A contribution after the cycle's 31 days opens the next cycle, on the new package (one day's ₦2,000 as its fee).
    // (The cycle moved into the past: its 31 days have ended.)
    await owner.query(
      `UPDATE savings.cycles SET starts_on = current_date - 40, ends_on = current_date - 10 WHERE customer_id = $1`,
      [customerId],
    );
    const later = await record(agent.session, customerId, 200_000);
    expect((await approve(b.session, agent.membershipId, [later.id], 200_000)).outcome).toBe('ok');
    expect(
      await one(`SELECT package_id, next_package_id FROM savings.enrolments WHERE customer_id = $1`, [
        customerId,
      ]),
    ).toEqual({
      package_id: next,
      next_package_id: null,
    });
    expect(
      await one(
        `SELECT number, package_id FROM savings.cycles WHERE customer_id = $1 ORDER BY number DESC LIMIT 1`,
        [customerId],
      ),
    ).toEqual({ number: 2, package_id: next });
  });

  it('refuses a deactivated customer, and another branch’s customer to a restricted staff member', async () => {
    const b = await business();
    const p = (await createPackage(b.session)).id;
    const c = await customer(b, null, b.branchB);
    const restricted = await member(b, 'staff', {
      permissions: ['merchant.packages.manage'],
      branchId: b.branchA,
    });
    expect((await enrol(restricted.session, c, p)).outcome).toBe('not_found');
    await call(`SELECT * FROM customers.set_customer_status($1, $2, 'deactivated')`, [b.session, c]);
    expect((await enrol(b.session, c, p)).outcome).toBe('invalid_status');
  });
});

describe('cash collections (BR-3, 5.3, 5.6; D1)', () => {
  it('the customer’s agent records: cash with the agent and awaiting confirmation; savings do not move (BR-5.6)', async () => {
    const { b, agent, customerId, packageId } = await saver();
    const r = await record(agent.session, customerId, 300_000);
    expect(r).toMatchObject({
      outcome: 'ok',
      customer_id: customerId,
      package_id: packageId,
      days: 3,
      status: 'recorded',
    });
    expect(await balance(agent.membershipId, '1210')).toBe(300_000);
    expect(await systemBalance(b, '2190')).toBe(300_000);
    expect(await balance(customerId, '2100')).toBe(0);
  });

  it('D1: an agent records only for their own customers now — a moved customer is refused at once', async () => {
    const { b, agent, customerId } = await saver();
    const other = await member(b, 'agent');
    expect((await record(other.session, customerId, 100_000)).outcome).toBe('not_found');
    expect(
      (
        await call(`SELECT * FROM customers.assign_agent($1, $2, $3)`, [
          b.session,
          customerId,
          other.membershipId,
        ])
      ).outcome,
    ).toBe('ok');
    expect((await record(agent.session, customerId, 100_000)).outcome).toBe('not_found');
    expect((await record(other.session, customerId, 100_000)).outcome).toBe('ok');
    // P8-4: the new agent's cash account was opened when the customer was given to them.
    expect(await balance(other.membershipId, '1210')).toBe(100_000);
  });

  it('Q1: a fixed package takes multiples of its amount (up to 31 days); a flexible one anything from its minimum', async () => {
    const fixed = await saver();
    for (const bad of [0, 50_000, 150_000, 3_200_000])
      expect((await record(fixed.agent.session, fixed.customerId, bad)).outcome).toBe('invalid_amount');
    expect((await record(fixed.agent.session, fixed.customerId, 3_100_000)).days).toBe(31);
    const flexible = await saver({ kind: 'flexible', amount: 50_000, rule: 'percentage', bp: 200 });
    expect((await record(flexible.agent.session, flexible.customerId, 49_999)).outcome).toBe(
      'invalid_amount',
    );
    expect(await record(flexible.agent.session, flexible.customerId, 73_350)).toMatchObject({
      outcome: 'ok',
      days: null,
    });
  });

  it('a retried recording records once; the key with another request is refused', async () => {
    const { agent, customerId } = await saver();
    const k = key();
    const first = await record(agent.session, customerId, 100_000, k);
    const again = await record(agent.session, customerId, 100_000, k);
    expect(again).toMatchObject({ outcome: 'replayed', id: first.id });
    expect((await record(agent.session, customerId, 200_000, k)).outcome).toBe('key_reused');
    expect(await balance(agent.membershipId, '1210')).toBe(100_000);
  });

  it('refuses a customer not enrolled or not active, and a staff session', async () => {
    const b = await business();
    const agent = await member(b, 'agent');
    const c = await customer(b, agent.membershipId);
    expect((await record(agent.session, c, 100_000)).outcome).toBe('not_enrolled');
    await enrol(b.session, c, (await createPackage(b.session)).id);
    await call(`SELECT * FROM customers.set_customer_status($1, $2, 'deactivated')`, [b.session, c]);
    expect((await record(agent.session, c, 100_000)).outcome).toBe('invalid_status');
    expect((await record(b.session, c, 100_000)).outcome).toBe('forbidden');
  });
});

describe('remittances and fees (Q2, Q4, Q5; BR-5.5, 5.6, 6.1, 6.2; TA-13)', () => {
  it('approves the collections the cash covers; the rest stay recorded; savings grow only on approval', async () => {
    const { b, agent, customerId } = await saver();
    const one1 = await record(agent.session, customerId, 500_000);
    const two = await record(agent.session, customerId, 100_000);
    const r = await approve(b.session, agent.membershipId, [one1.id], 500_000);
    expect(r).toMatchObject({
      outcome: 'ok',
      collection_count: 1,
      cash_minor: '500000',
      fee_total_minor: '100000',
    });
    // Q4: five days at once on a fixed ₦1,000 package — one day's ₦1,000 is the fee, ₦4,000 is savings.
    expect(await balance(customerId, '2100')).toBe(400_000);
    expect(await systemBalance(b, '4100')).toBe(100_000);
    expect(await systemBalance(b, '1200')).toBe(500_000);
    expect(await balance(agent.membershipId, '1210')).toBe(100_000);
    expect(await systemBalance(b, '2190')).toBe(100_000);
    expect((await one(`SELECT status FROM savings.collections WHERE id = $1`, [two.id])).status).toBe(
      'recorded',
    );
    // In the same cycle, no second first-contribution fee.
    expect((await approve(b.session, agent.membershipId, [two.id], 100_000)).fee_total_minor).toBe('0');
    expect(await balance(customerId, '2100')).toBe(500_000);
  });

  it('Q4: on a flexible package the whole first contribution of a cycle is the fee', async () => {
    const { b, agent, customerId } = await saver({ kind: 'flexible', amount: 50_000 });
    const c = await record(agent.session, customerId, 70_000);
    expect((await approve(b.session, agent.membershipId, [c.id], 70_000)).fee_total_minor).toBe('70000');
    expect(await balance(customerId, '2100')).toBe(0);
  });

  it('Q2, BR-6.2: the percentage, rounded down to the kobo, as its own entry with its narrative', async () => {
    const { b, agent, customerId } = await saver({
      kind: 'flexible',
      amount: 10_000,
      rule: 'percentage',
      bp: 200,
    });
    const c = await record(agent.session, customerId, 107_575); // 2% is 2,151.5 kobo
    expect((await approve(b.session, agent.membershipId, [c.id], 107_575)).fee_total_minor).toBe('2151');
    expect(await balance(customerId, '2100')).toBe(105_424);
    const row = await one(
      `SELECT c.fee_minor::text AS fee, c.confirmed_entry_id <> c.fee_entry_id AS own_entry, e.narrative, e.entry_type
         FROM savings.collections c JOIN ledger.journal_entries e ON e.id = c.fee_entry_id WHERE c.id = $1`,
      [c.id],
    );
    expect(row).toMatchObject({ fee: '2151', own_entry: true, entry_type: 'fee.percentage' });
    expect(row.narrative).toMatch(
      new RegExp(`^2% deducted for ${b.name} on \\d{2} \\w{3} \\d{4} \\d{2}:\\d{2}$`),
    );
    // A fraction of a percent, and a fee that rounds to nothing: no entry at all.
    const half = await saver({ kind: 'flexible', amount: 1, rule: 'percentage', bp: 250 });
    const tiny = await record(half.agent.session, half.customerId, 39);
    expect((await approve(half.b.session, half.agent.membershipId, [tiny.id], 39)).fee_total_minor).toBe('0');
    expect(
      (await one(`SELECT fee_entry_id FROM savings.collections WHERE id = $1`, [tiny.id])).fee_entry_id,
    ).toBeNull();
    const big = await record(half.agent.session, half.customerId, 100_000);
    await approve(half.b.session, half.agent.membershipId, [big.id], 100_000);
    expect(
      (
        await one(
          `SELECT e.narrative FROM savings.collections c JOIN ledger.journal_entries e ON e.id = c.fee_entry_id
            WHERE c.id = $1`,
          [big.id],
        )
      ).narrative,
    ).toMatch(/^2\.5% deducted for /);
  });

  it('BR-5.2, Q3: a cycle is 31 days from the first contribution; the next starts with the first after them', async () => {
    const { b, agent, customerId } = await saver();
    const at = async (offset: number) => {
      const c = await record(agent.session, customerId, 100_000);
      await owner.query(
        `UPDATE savings.collections SET collected_on = current_date + $2::int WHERE id = $1`,
        [c.id, offset],
      );
      return (await approve(b.session, agent.membershipId, [c.id], 100_000)).fee_total_minor as string;
    };
    expect(await at(0)).toBe('100000'); // cycle 1 opens: days 0–30
    expect(await at(30)).toBe('0'); // its last day
    expect(await at(40)).toBe('100000'); // a break, then cycle 2 opens on day 40
    expect(
      (
        await owner.query(
          `SELECT number, ends_on - starts_on AS span FROM savings.cycles WHERE customer_id = $1 ORDER BY number`,
          [customerId],
        )
      ).rows,
    ).toEqual([
      { number: 1, span: 30 },
      { number: 2, span: 30 },
    ]);
  });

  it('refuses a cash total that differs, another agent’s collections, and a collection already approved', async () => {
    const { b, agent, customerId } = await saver();
    const c = await record(agent.session, customerId, 100_000);
    const other = await member(b, 'agent');
    expect((await approve(b.session, agent.membershipId, [c.id], 90_000)).outcome).toBe('cash_mismatch');
    expect((await approve(b.session, other.membershipId, [c.id], 100_000)).outcome).toBe('not_found');
    expect((await approve(b.session, agent.membershipId, [c.id, c.id], 200_000)).outcome).toBe('invalid');
    expect((await approve(b.session, agent.membershipId, [], 1)).outcome).toBe('invalid');
    expect((await approve(b.session, agent.membershipId, [c.id], 100_000)).outcome).toBe('ok');
    // No double credit: a second remittance naming it is refused.
    expect((await approve(b.session, agent.membershipId, [c.id], 100_000)).outcome).toBe('invalid_status');
    expect(await balance(customerId, '2100')).toBe(0); // the first contribution was the fee
    expect(await systemBalance(b, '4100')).toBe(100_000);
  });

  it('BR-3: agents never approve; P8-5: a deactivated customer’s collection is refused, then cancelled', async () => {
    const { b, agent, customerId } = await saver();
    const c = await record(agent.session, customerId, 100_000);
    expect((await approve(agent.session, agent.membershipId, [c.id], 100_000)).outcome).toBe('forbidden');
    await call(`SELECT * FROM customers.set_customer_status($1, $2, 'deactivated')`, [b.session, customerId]);
    expect((await approve(b.session, agent.membershipId, [c.id], 100_000)).outcome).toBe('inactive_customer');
    expect((await cancel(b.session, c.id)).outcome).toBe('ok');
    expect(await balance(agent.membershipId, '1210')).toBe(0);
  });
});

describe('R1 (the gate review): the package that governs a collection', () => {
  /** The customer's only cycle, moved into the past so that it has ended. */
  const endCycle = (customerId: string) =>
    owner.query(
      `UPDATE savings.cycles SET starts_on = current_date - 40, ends_on = current_date - 10 WHERE customer_id = $1`,
      [customerId],
    );

  it('a change waiting for the next cycle governs a recording once the current cycle has ended', async () => {
    const { b, agent, customerId, packageId } = await saver();
    const first = await record(agent.session, customerId, 100_000);
    await approve(b.session, agent.membershipId, [first.id], 100_000);
    const next = (await createPackage(b.session, { amount: 200_000 })).id as string;
    expect((await enrol(b.session, customerId, next)).effective).toBe('next_cycle');
    // While the cycle runs, the current package governs.
    expect(await record(agent.session, customerId, 100_000)).toMatchObject({
      outcome: 'ok',
      package_id: packageId,
    });
    await endCycle(customerId);
    // After it: the next cycle's (₦2,000 a day): ₦1,000 is refused, ₦2,000 recorded under the new package.
    expect((await record(agent.session, customerId, 100_000)).outcome).toBe('invalid_amount');
    const opening = await record(agent.session, customerId, 200_000);
    expect(opening).toMatchObject({ outcome: 'ok', package_id: next, days: 1 });
    expect((await approve(b.session, agent.membershipId, [opening.id], 200_000)).fee_total_minor).toBe(
      '200000',
    );
    expect(
      await one(
        `SELECT number, package_id FROM savings.cycles WHERE customer_id = $1 ORDER BY number DESC LIMIT 1`,
        [customerId],
      ),
    ).toEqual({ number: 2, package_id: next });
  });

  it('a collection recorded under another package than its cycle’s is refused, nothing written; cancelled, then recorded again', async () => {
    const { b, agent, customerId } = await saver();
    const old = await record(agent.session, customerId, 100_000);
    // No cycle runs: the change takes effect at once, and the recorded collection's package is no longer the customer's.
    const next = (await createPackage(b.session, { amount: 200_000 })).id as string;
    expect((await enrol(b.session, customerId, next)).effective).toBe('now');
    const entries = async () =>
      (
        await one(`SELECT count(*)::int AS n FROM ledger.journal_entries WHERE merchant_id = $1`, [
          b.merchantId,
        ])
      ).n;
    const before = await entries();
    expect((await approve(b.session, agent.membershipId, [old.id], 100_000)).outcome).toBe('package_changed');
    expect(await entries()).toBe(before);
    expect(
      (await one(`SELECT count(*)::int AS n FROM savings.cycles WHERE customer_id = $1`, [customerId])).n,
    ).toBe(0);
    expect((await one(`SELECT status FROM savings.collections WHERE id = $1`, [old.id])).status).toBe(
      'recorded',
    );
    expect((await cancel(b.session, old.id)).outcome).toBe('ok');
    const again = await record(agent.session, customerId, 200_000);
    expect((await approve(b.session, agent.membershipId, [again.id], 200_000)).outcome).toBe('ok');
  });

  it('a collection approved late joins the cycle that holds its day, without a second fee', async () => {
    const { b, agent, customerId } = await saver();
    const early = await record(agent.session, customerId, 100_000);
    const later = await record(agent.session, customerId, 100_000);
    await owner.query(`UPDATE savings.collections SET collected_on = current_date - 40 WHERE id = $1`, [
      early.id,
    ]);
    await owner.query(`UPDATE savings.collections SET collected_on = current_date - 30 WHERE id = $1`, [
      later.id,
    ]);
    expect((await approve(b.session, agent.membershipId, [early.id], 100_000)).fee_total_minor).toBe(
      '100000',
    );
    const third = await record(agent.session, customerId, 100_000); // today: after cycle 1's 31 days — cycle 2
    expect((await approve(b.session, agent.membershipId, [third.id], 100_000)).fee_total_minor).toBe(
      '100000',
    );
    // The one left out, collected on day 10 of cycle 1, joins cycle 1 when its cash comes in.
    expect((await approve(b.session, agent.membershipId, [later.id], 100_000)).fee_total_minor).toBe('0');
    expect(
      await one(
        `SELECT y.number FROM savings.collections c JOIN savings.cycles y ON y.id = c.cycle_id WHERE c.id = $1`,
        [later.id],
      ),
    ).toEqual({ number: 1 });
  });
});

describe('R2 (the gate review): the …_locked posting core never waits', () => {
  it('a projection held elsewhere fails the posting at once (lock_not_available), it is not waited for', async () => {
    const { b, customerId } = await saver();
    const ledgerId = (await one(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [b.merchantId])).id;
    const [office, savings] = [
      (
        await one(
          `SELECT id FROM ledger.accounts WHERE ledger_id = $1 AND code = '1200' AND subject_id IS NULL`,
          [ledgerId],
        )
      ).id,
      (await one(`SELECT id FROM ledger.accounts WHERE subject_id = $1 AND code = '2100'`, [customerId])).id,
    ];
    const holder = await connectAs('migrator');
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM ledger.balance_projection WHERE account_id = $1 FOR NO KEY UPDATE`, [
        savings,
      ]);
      const started = Date.now();
      await expectSqlState(
        owner.query(
          `SELECT * FROM ledger.post_entry_locked($1, $2, 'test', current_date, 'R2', NULL, NULL, $3, NULL, NULL)`,
          [
            ledgerId,
            key(),
            JSON.stringify([
              { accountId: office, side: 'debit', amountMinor: '1' },
              { accountId: savings, side: 'credit', amountMinor: '1' },
            ]),
          ],
        ),
        '55P03',
      );
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
    }
  });
});

describe('cancelling a collection recorded by mistake (Q6)', () => {
  it('before approval, with a reason: reversed in the books; after approval, refused', async () => {
    const { b, agent, customerId } = await saver();
    const c = await record(agent.session, customerId, 200_000);
    expect((await cancel(b.session, c.id, '  ')).outcome).toBe('invalid');
    const done = await cancel(b.session, c.id, 'Recorded for the wrong customer');
    expect(done).toMatchObject({
      outcome: 'ok',
      status: 'cancelled',
      cancel_reason: 'Recorded for the wrong customer',
    });
    expect(await balance(agent.membershipId, '1210')).toBe(0);
    expect(await systemBalance(b, '2190')).toBe(0);
    const reversal = await one(
      `SELECT e.reverses_entry_id FROM savings.collections c JOIN ledger.journal_entries e ON e.id = c.cancel_entry_id
        WHERE c.id = $1`,
      [c.id],
    );
    expect(reversal.reverses_entry_id).toBe(
      (await one(`SELECT recorded_entry_id FROM savings.collections WHERE id = $1`, [c.id]))
        .recorded_entry_id,
    );
    expect((await cancel(b.session, c.id)).outcome).toBe('invalid_status');
    const approved = await record(agent.session, customerId, 100_000);
    await approve(b.session, agent.membershipId, [approved.id], 100_000);
    expect((await cancel(b.session, approved.id)).outcome).toBe('invalid_status');
    const reader = await member(b, 'staff', { permissions: ['merchant.savings.read'] });
    expect((await cancel(reader.session, approved.id)).outcome).toBe('forbidden');
  });
});

describe('withdrawals and target savings (BR-7.1–7.4; Q7, Q8, Q9)', () => {
  async function funded() {
    const s = await saver({ kind: 'flexible', amount: 1, rule: 'percentage', bp: 100 });
    const c = await record(s.agent.session, s.customerId, 1_000_000);
    await approve(s.b.session, s.agent.membershipId, [c.id], 1_000_000);
    expect(await balance(s.customerId, '2100')).toBe(990_000);
    return s;
  }

  it('cash from savings: the balance down at once, never above it (BR-7.3, 7.4)', async () => {
    const { b, customerId } = await funded();
    const w = await move(b.session, customerId, 'savings_withdrawal', 400_000);
    expect(w).toMatchObject({ outcome: 'ok', kind: 'savings_withdrawal', amount_minor: '400000' });
    expect(await balance(customerId, '2100')).toBe(590_000);
    expect((await move(b.session, customerId, 'savings_withdrawal', 590_001)).outcome).toBe(
      'insufficient_balance',
    );
    expect(await balance(customerId, '2100')).toBe(590_000);
    expect(
      (await one(`SELECT count(*)::int AS n FROM savings.movements WHERE customer_id = $1`, [customerId])).n,
    ).toBe(1);
  });

  it('Q9: savings moved into target savings, and withdrawn from there at any time; a goal set and cleared', async () => {
    const { b, customerId } = await funded();
    expect((await move(b.session, customerId, 'to_target', 300_000)).outcome).toBe('ok');
    expect(await balance(customerId, '2110')).toBe(300_000);
    expect((await move(b.session, customerId, 'target_withdrawal', 300_001)).outcome).toBe(
      'insufficient_balance',
    );
    expect((await move(b.session, customerId, 'target_withdrawal', 100_000)).outcome).toBe('ok');
    expect(await balance(customerId, '2110')).toBe(200_000);
    const goal = await call(`SELECT * FROM savings.set_target_goal($1, $2, $3, current_date + 90)`, [
      b.session,
      customerId,
      5_000_000,
    ]);
    expect(goal).toMatchObject({ outcome: 'ok', goal_amount_minor: '5000000' });
    const cleared = await call(`SELECT * FROM savings.set_target_goal($1, $2, NULL, NULL)`, [
      b.session,
      customerId,
    ]);
    expect(cleared).toMatchObject({ outcome: 'ok', goal_amount_minor: null, goal_date: null });
    expect(
      (
        await call(`SELECT * FROM savings.set_target_goal($1, $2, NULL, current_date - 1)`, [
          b.session,
          customerId,
        ])
      ).outcome,
    ).toBe('invalid');
  });

  it('a retried request moves money once; the key with another request is refused', async () => {
    const { b, customerId } = await funded();
    const k = key();
    const first = await move(b.session, customerId, 'savings_withdrawal', 10_000, k);
    expect(await move(b.session, customerId, 'savings_withdrawal', 10_000, k)).toMatchObject({
      outcome: 'replayed',
      id: first.id,
    });
    expect((await move(b.session, customerId, 'savings_withdrawal', 20_000, k)).outcome).toBe('key_reused');
    expect(await balance(customerId, '2100')).toBe(980_000);
  });

  it('needs merchant.withdrawals.create, within the actor’s branch; never for a deactivated customer', async () => {
    const { b, customerId } = await funded();
    const reader = await member(b, 'staff', { permissions: ['merchant.savings.read'] });
    expect((await move(reader.session, customerId, 'savings_withdrawal', 1)).outcome).toBe('forbidden');
    const elsewhere = await member(b, 'staff', {
      permissions: ['merchant.withdrawals.create'],
      branchId: b.branchB,
    });
    expect((await move(elsewhere.session, customerId, 'savings_withdrawal', 1)).outcome).toBe('not_found');
    expect((await move(b.session, customerId, 'to_loan', 1)).outcome).toBe('invalid');
    await call(`SELECT * FROM customers.set_customer_status($1, $2, 'deactivated')`, [b.session, customerId]);
    expect((await move(b.session, customerId, 'savings_withdrawal', 1)).outcome).toBe('invalid_status');
  });
});

describe('reads (B1, R19, BR-5.6)', () => {
  it('the business sees a customer’s savings with what awaits confirmation; restricted staff their branch only', async () => {
    const { b, agent, customerId, packageId } = await saver();
    const c1 = await record(agent.session, customerId, 200_000);
    await approve(b.session, agent.membershipId, [c1.id], 200_000);
    await record(agent.session, customerId, 300_000);
    const reader = await member(b, 'staff', { permissions: ['merchant.savings.read'] });
    const summary = await call(`SELECT * FROM savings.customer_savings($1, $2)`, [
      reader.session,
      customerId,
    ]);
    expect(summary).toMatchObject({
      package_id: packageId,
      cycle_number: 1,
      savings_minor: '100000',
      target_minor: '0',
      pending_minor: '300000',
    });
    const elsewhere = await member(b, 'staff', {
      permissions: ['merchant.savings.read'],
      branchId: b.branchB,
    });
    expect(
      (await app.query(`SELECT * FROM savings.customer_savings($1, $2)`, [elsewhere.session, customerId]))
        .rowCount,
    ).toBe(0);
    expect(
      (await app.query(`SELECT * FROM savings.list_collections($1, $2)`, [elsewhere.session, customerId]))
        .rowCount,
    ).toBe(0);
    const page = await app.query(
      `SELECT * FROM savings.list_collections($1, $2, NULL, 'recorded', NULL, 10)`,
      [reader.session, customerId],
    );
    expect(page.rows.map((r) => r.amount_minor)).toEqual(['300000']);
    const remittances = await app.query(`SELECT * FROM savings.list_remittances($1, $2, 10)`, [
      reader.session,
      agent.membershipId,
    ]);
    expect(remittances.rows).toHaveLength(1);
    expect(
      (await app.query(`SELECT * FROM savings.list_remittances($1, NULL, 10)`, [elsewhere.session])).rowCount,
    ).toBe(0);
    // Without merchant.savings.read: nothing.
    expect((await app.query(`SELECT * FROM savings.list_packages($1)`, [agent.session])).rowCount).toBe(0);
    expect((await app.query(`SELECT * FROM savings.list_packages($1)`, [reader.session])).rowCount).toBe(1);
  });

  it('the agent sees what they recorded; the customer their own savings and collections, pending included', async () => {
    const { b, agent, customerId } = await saver();
    await record(agent.session, customerId, 100_000);
    const mine = await app.query(`SELECT * FROM savings.agent_collections($1, NULL, 10)`, [agent.session]);
    expect(mine.rows).toHaveLength(1);
    const other = await member(b, 'agent');
    expect(
      (await app.query(`SELECT * FROM savings.agent_collections($1, NULL, 10)`, [other.session])).rowCount,
    ).toBe(0);
    const identityId = (
      await one(`INSERT INTO identity.identities (email, password_hash) VALUES ($1, $2) RETURNING id`, [
        email('cu'),
        ARGON,
      ])
    ).id as string;
    await owner.query(`UPDATE customers.customers SET identity_id = $2 WHERE id = $1`, [
      customerId,
      identityId,
    ]);
    const own = await session(identityId, 'customer', customerId);
    expect(await call(`SELECT * FROM savings.self_savings($1)`, [own])).toMatchObject({
      customer_id: customerId,
      pending_minor: '100000',
      savings_minor: '0',
    });
    const collections = await app.query(`SELECT * FROM savings.self_collections($1, 10)`, [own]);
    expect(collections.rows.map((r) => r.status)).toEqual(['recorded']);
    expect(collections.rows[0]).not.toHaveProperty('cancel_reason');
  });
});

describe('the books and the activity record', () => {
  it('every projection equals its lines, and no event carries a customer’s details (TA-14)', async () => {
    const { b, agent, customerId } = await saver();
    const c = await record(agent.session, customerId, 300_000);
    await approve(b.session, agent.membershipId, [c.id], 300_000);
    await move(b.session, customerId, 'to_target', 100_000);
    expect((await owner.query(`SELECT * FROM ledger.verify_projections()`)).rows).toEqual([]);
    const { rows } = await owner.query(
      `SELECT action, summary::text AS summary FROM audit.audit_events WHERE merchant_id = $1 AND action LIKE 'savings.%'
        ORDER BY occurred_at, id`,
      [b.merchantId],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'savings.package_created',
      'savings.customer_enrolled',
      'savings.collection_recorded',
      'savings.remittance_approved',
      'savings.money_moved',
    ]);
    for (const r of rows) expect(r.summary).not.toMatch(/Ada|Obi|\+234/);
  });
});
