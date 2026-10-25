import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// Customers (P7; docs/architecture/P7_IMPLEMENTATION_PLAN.md; the owner's answers of 2026-10-25): onboarding by the
// business and by agents, details and branch, deactivation, agent assignment with its history (D1), the branch scope
// (P5 §7.6), the app link and the customer audience, anonymisation (BR-11.3) and TA-14. Commands and reads are called
// as the API calls them (alphakolect_app); effects are read as the table owner. The races are in
// customers-races.test.ts.

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
const rid = () => `cu-${randomBytes(6).toString('hex')}`;
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
    identityId: s.identity_id as string,
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

type Created = { outcome: string; id: string | null };
const create = (
  s: string,
  branchId: string,
  fields: {
    name?: string;
    phone?: string;
    email?: string | null;
    address?: string | null;
    nickname?: string | null;
    agent?: string | null;
  } = {},
) =>
  call(
    `SELECT * FROM customers.create_customer($1, $2, $3, $4, $5, $6, $7, $8, '203.0.113.9', 'customers-test', $9)`,
    [
      s,
      branchId,
      fields.name ?? 'Ada Obi',
      fields.phone ?? phone(),
      fields.email ?? null,
      fields.address ?? null,
      fields.nickname ?? null,
      fields.agent ?? null,
      rid(),
    ],
  ) as Promise<Created>;
const update = (s: string, customerId: string, change: object) =>
  call(`SELECT * FROM customers.update_customer($1, $2, $3, NULL, NULL, $4)`, [
    s,
    customerId,
    JSON.stringify(change),
    rid(),
  ]) as Promise<Created>;
const setStatus = (s: string, customerId: string, status: string) =>
  call(`SELECT * FROM customers.set_customer_status($1, $2, $3, NULL, NULL, $4)`, [
    s,
    customerId,
    status,
    rid(),
  ]) as Promise<Created>;
const assign = (s: string, customerId: string, agent: string | null) =>
  call(`SELECT * FROM customers.assign_agent($1, $2, $3, NULL, NULL, $4)`, [
    s,
    customerId,
    agent,
    rid(),
  ]) as Promise<Created>;
const list = async (s: string, opts: { search?: string; branch?: string; customer?: string } = {}) =>
  (
    await app.query(`SELECT * FROM customers.list_customers($1, $2, $3, $4, NULL, NULL, NULL, NULL)`, [
      s,
      opts.customer ?? null,
      opts.search ?? null,
      opts.branch ?? null,
    ])
  ).rows;
const eventsOf = async (customerId: string) =>
  (
    await owner.query(
      `SELECT action, outcome, actor_audience, summary FROM audit.audit_events WHERE target_id = $1 ORDER BY occurred_at, id`,
      [customerId],
    )
  ).rows;

describe('onboarding (Q1–Q4)', () => {
  it('by the owner: the customer, normalised, in a branch, with their agent, four sub-accounts, and an event without details', async () => {
    const b = await business();
    const agent = await member(b, 'agent');
    const r = await create(b.session, b.branchA, {
      name: '  Ada Obi ',
      phone: '0803 123 4567',
      email: ' Ada@Example.TEST ',
      address: '1 Market Road',
      nickname: 'Mama Ada',
      agent: agent.membershipId,
    });
    expect(r.outcome).toBe('ok');
    expect(
      await one(
        `SELECT full_name, phone, email, address, nickname, status, branch_id FROM customers.customers WHERE id = $1`,
        [r.id],
      ),
    ).toEqual({
      full_name: 'Ada Obi',
      phone: '+2348031234567',
      email: 'ada@example.test',
      address: '1 Market Road',
      nickname: 'Mama Ada',
      status: 'active',
      branch_id: b.branchA,
    });
    expect((await one(`SELECT customers.current_agent($1, $2) AS a`, [b.merchantId, r.id])).a).toBe(
      agent.membershipId,
    );
    const { rows } = await owner.query(
      `SELECT code FROM ledger.accounts WHERE subject_type = 'customer' AND subject_id = $1 ORDER BY code`,
      [r.id],
    );
    expect(rows.map((x) => x.code)).toEqual(['1300', '2100', '2110', '2120']);
    expect(await eventsOf(r.id!)).toEqual([
      {
        action: 'customer.created',
        outcome: 'success',
        actor_audience: 'merchant',
        summary: { branchId: b.branchA, agentMembershipId: agent.membershipId, via: 'merchant' },
      },
    ]);
  });

  it('one customer per phone number within a business (Q2), however it is written; other businesses are separate (Q3)', async () => {
    const b = await business();
    expect((await create(b.session, b.branchA, { phone: '+234 803 999 0000' })).outcome).toBe('ok');
    expect((await create(b.session, b.branchB, { phone: '08039990000' })).outcome).toBe('phone_taken');
    const other = await business();
    expect((await create(other.session, other.branchA, { phone: '08039990000' })).outcome).toBe('ok');
  });

  it.each([
    ['a blank name', { name: '   ' }],
    ['a phone number too short', { phone: '12345' }],
    ['letters in the phone number', { phone: '0803ABC4567' }],
    ['a malformed email', { email: 'not-an-email' }],
    ['a nickname too long', { nickname: 'x'.repeat(61) }],
  ])('refuses %s', async (_label, fields) => {
    const b = await business();
    expect((await create(b.session, b.branchA, fields)).outcome).toBe('invalid');
  });

  it('refuses an archived or another business’s branch, and an agent who is not an active agent of the business', async () => {
    const b = await business();
    await owner.query(`UPDATE tenancy.branches SET status = 'archived', archived_at = now() WHERE id = $1`, [
      b.branchB,
    ]);
    expect((await create(b.session, b.branchB)).outcome).toBe('invalid_branch');
    const other = await business();
    expect((await create(b.session, other.branchA)).outcome).toBe('invalid_branch');
    const staff = await member(b, 'staff');
    expect((await create(b.session, b.branchA, { agent: staff.membershipId })).outcome).toBe('invalid_agent');
    const otherAgent = await member(other, 'agent');
    expect((await create(b.session, b.branchA, { agent: otherAgent.membershipId })).outcome).toBe(
      'invalid_agent',
    );
  });

  it('staff need merchant.customers.manage, and a restricted staff member adds only to their own branch', async () => {
    const b = await business();
    const none = await member(b, 'staff', { permissions: ['merchant.customers.read'] });
    expect((await create(none.session, b.branchA)).outcome).toBe('forbidden');
    const restricted = await member(b, 'staff', {
      permissions: ['merchant.customers.manage'],
      branchId: b.branchA,
    });
    expect((await create(restricted.session, b.branchA)).outcome).toBe('ok');
    expect((await create(restricted.session, b.branchB)).outcome).toBe('invalid_branch');
  });

  it('by an agent: the customer is theirs, in any active branch — agents serve every branch (Q4, P7-6)', async () => {
    const b = await business();
    const agent = await member(b, 'agent');
    const added = (await call(
      `SELECT * FROM customers.agent_create_customer($1, $2, 'Bola Ade', $3, NULL, NULL, NULL, NULL, NULL, $4)`,
      [agent.session, b.branchA, phone(), rid()],
    )) as Created;
    expect(added.outcome).toBe('ok');
    expect((await one(`SELECT customers.current_agent($1, $2) AS a`, [b.merchantId, added.id])).a).toBe(
      agent.membershipId,
    );
    expect((await eventsOf(added.id!))[0]).toMatchObject({
      action: 'customer.created',
      actor_audience: 'agent',
      summary: { via: 'agent', agentMembershipId: agent.membershipId },
    });
    expect(
      (
        await call(
          `SELECT * FROM customers.agent_create_customer($1, $2, 'Bola Ade', $3, NULL, NULL, NULL, NULL, NULL, NULL)`,
          [agent.session, b.branchB, phone()],
        )
      ).outcome,
    ).toBe('ok');
    await owner.query(`UPDATE tenancy.branches SET status = 'archived', archived_at = now() WHERE id = $1`, [
      b.branchB,
    ]);
    expect(
      (
        await call(
          `SELECT * FROM customers.agent_create_customer($1, $2, 'Bola Ade', $3, NULL, NULL, NULL, NULL, NULL, NULL)`,
          [agent.session, b.branchB, phone()],
        )
      ).outcome,
    ).toBe('invalid_branch');
    // A merchant session is not an agent's.
    expect(
      (
        await call(
          `SELECT * FROM customers.agent_create_customer($1, $2, 'X', $3, NULL, NULL, NULL, NULL, NULL, NULL)`,
          [b.session, b.branchA, phone()],
        )
      ).outcome,
    ).toBe('forbidden');
  });
});

describe('details, branch and status (Q6, Q8)', () => {
  it('changes details and branch, recording only the names of the fields changed (TA-14)', async () => {
    const b = await business();
    const c = await create(b.session, b.branchA, { email: 'old@example.test' });
    const r = await update(b.session, c.id!, {
      fullName: 'Ada N. Obi',
      email: null,
      nickname: 'Ada',
      branchId: b.branchB,
    });
    expect(r.outcome).toBe('ok');
    expect(
      await one(`SELECT full_name, email, nickname, branch_id FROM customers.customers WHERE id = $1`, [
        c.id,
      ]),
    ).toEqual({
      full_name: 'Ada N. Obi',
      email: null,
      nickname: 'Ada',
      branch_id: b.branchB,
    });
    expect((await eventsOf(c.id!)).at(-1)).toEqual({
      action: 'customer.updated',
      outcome: 'success',
      actor_audience: 'merchant',
      summary: { fields: ['branchId', 'email', 'fullName', 'nickname'], branchId: b.branchB },
    });
  });

  it('refuses another customer’s phone, unknown fields, an empty change, and an archived branch', async () => {
    const b = await business();
    const taken = phone();
    await create(b.session, b.branchA, { phone: taken });
    const c = await create(b.session, b.branchA);
    await owner.query(`UPDATE tenancy.branches SET status = 'archived', archived_at = now() WHERE id = $1`, [
      b.branchB,
    ]);
    expect((await update(b.session, c.id!, { phone: taken })).outcome).toBe('phone_taken');
    expect((await update(b.session, c.id!, { status: 'active' })).outcome).toBe('invalid');
    expect((await update(b.session, c.id!, {})).outcome).toBe('invalid');
    expect((await update(b.session, c.id!, { branchId: b.branchB })).outcome).toBe('invalid_branch');
  });

  it('deactivated and reactivated, recorded; nothing changes an anonymised customer', async () => {
    const b = await business();
    const c = await create(b.session, b.branchA);
    expect((await setStatus(b.session, c.id!, 'deactivated')).outcome).toBe('ok');
    expect((await setStatus(b.session, c.id!, 'deactivated')).outcome).toBe('invalid_transition');
    expect((await setStatus(b.session, c.id!, 'active')).outcome).toBe('ok');
    expect((await eventsOf(c.id!)).map((e) => e.action)).toEqual([
      'customer.created',
      'customer.deactivated',
      'customer.reactivated',
    ]);
    await call(`SELECT * FROM customers.anonymise_customer($1, $2, NULL, NULL, NULL)`, [b.session, c.id]);
    expect((await setStatus(b.session, c.id!, 'deactivated')).outcome).toBe('invalid_transition');
    expect((await update(b.session, c.id!, { nickname: 'x' })).outcome).toBe('invalid_status');
  });
});

describe('nothing new is recorded for a customer who is not active (Q8, Q9)', () => {
  it('a posting to a deactivated customer’s sub-account is refused; reactivated, it is accepted', async () => {
    const b = await business();
    const c = await create(b.session, b.branchA);
    const savings = (
      await one(`SELECT id FROM ledger.accounts WHERE subject_id = $1 AND code = '2100'`, [c.id])
    ).id;
    const office = (
      await one(
        `SELECT a.id FROM ledger.accounts a JOIN ledger.ledgers l ON l.id = a.ledger_id
          WHERE l.merchant_id = $1 AND a.code = '1200'`,
        [b.merchantId],
      )
    ).id;
    const { id: ledgerId } = await one(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [
      b.merchantId,
    ]);
    const deposit = async () =>
      (
        await one(
          `SELECT * FROM ledger.post_entry($1, $2, 'test', CURRENT_DATE, 'Test', NULL, NULL, $3, NULL, NULL)`,
          [
            ledgerId,
            `k-${randomBytes(6).toString('hex')}`,
            JSON.stringify([
              { accountId: office, side: 'debit', amountMinor: '100' },
              { accountId: savings, side: 'credit', amountMinor: '100' },
            ]),
          ],
        )
      ).outcome as string;
    await setStatus(b.session, c.id!, 'deactivated');
    expect(await deposit()).toBe('inactive_account');
    await setStatus(b.session, c.id!, 'active');
    expect(await deposit()).toBe('ok');
  });
});

describe('agent assignment (D1, Q5)', () => {
  it('every move is recorded; one agent at most; the same agent again changes nothing; unassigning leaves none', async () => {
    const b = await business();
    const [a1, a2] = [await member(b, 'agent'), await member(b, 'agent')];
    const c = await create(b.session, b.branchA, { agent: a1.membershipId });
    expect((await assign(b.session, c.id!, a2.membershipId)).outcome).toBe('ok');
    expect((await assign(b.session, c.id!, a2.membershipId)).outcome).toBe('ok');
    expect((await assign(b.session, c.id!, null)).outcome).toBe('ok');
    const history = (await app.query(`SELECT * FROM customers.list_assignments($1, $2)`, [b.session, c.id]))
      .rows;
    expect(history.map((h) => [h.agent_membership_id, h.ended_at !== null])).toEqual([
      [a2.membershipId, true],
      [a1.membershipId, true],
    ]);
    expect((await one(`SELECT customers.current_agent($1, $2) AS a`, [b.merchantId, c.id])).a).toBeNull();
    expect(
      (await eventsOf(c.id!)).filter((e) => e.action === 'customer.agent_assigned').map((e) => e.summary),
    ).toEqual([
      { agentMembershipId: a2.membershipId, previousAgentMembershipId: a1.membershipId },
      { agentMembershipId: null, previousAgentMembershipId: a2.membershipId },
    ]);
  });

  it('needs merchant.customers.assign; refuses another business’s agent, a deactivated one, a deactivated customer', async () => {
    const b = await business();
    const agent = await member(b, 'agent');
    const c = await create(b.session, b.branchA);
    const manager = await member(b, 'staff', { permissions: ['merchant.customers.manage'] });
    expect((await assign(manager.session, c.id!, agent.membershipId)).outcome).toBe('forbidden');
    const elsewhere = await member(await business(), 'agent');
    expect((await assign(b.session, c.id!, elsewhere.membershipId)).outcome).toBe('invalid_agent');
    await owner.query(
      `UPDATE tenancy.merchant_memberships SET status = 'deactivated', deactivated_at = now() WHERE id = $1`,
      [agent.membershipId],
    );
    expect((await assign(b.session, c.id!, agent.membershipId)).outcome).toBe('invalid_agent');
    await setStatus(b.session, c.id!, 'deactivated');
    expect((await assign(b.session, c.id!, null)).outcome).toBe('invalid_status');
  });
});

describe('reads and the branch scope (B1, R19, P5 §7.6, P7-2)', () => {
  it('a search by name, nickname or phone digits; a branch filter; one page at a time', async () => {
    const b = await business();
    await create(b.session, b.branchA, { name: 'Chinedu Eze', phone: '08011112222' });
    await create(b.session, b.branchB, { name: 'Funke Ola', phone: '08033334444', nickname: 'Iya Basira' });
    expect((await list(b.session, { search: 'chined' })).map((r) => r.full_name)).toEqual(['Chinedu Eze']);
    expect((await list(b.session, { search: 'basira' })).map((r) => r.full_name)).toEqual(['Funke Ola']);
    expect((await list(b.session, { search: '3333444' })).map((r) => r.full_name)).toEqual(['Funke Ola']);
    expect((await list(b.session, { search: '%' })).length).toBe(0);
    expect((await list(b.session, { branch: b.branchB })).map((r) => r.full_name)).toEqual(['Funke Ola']);
    const first = (
      await app.query(`SELECT * FROM customers.list_customers($1, NULL, NULL, NULL, NULL, 1, NULL, NULL)`, [
        b.session,
      ])
    ).rows;
    expect(first).toHaveLength(2); // one row more than the page: another follows
    const next = (
      await app.query(`SELECT * FROM customers.list_customers($1, NULL, NULL, NULL, NULL, 1, $2, $3)`, [
        b.session,
        // The position in microseconds, as the API's cursor carries it (a JavaScript Date keeps milliseconds).
        (await one(`SELECT created_at::text AS at FROM customers.customers WHERE id = $1`, [first[0].id])).at,
        first[0].id,
      ])
    ).rows;
    expect(next.map((r) => r.full_name)).toEqual(['Funke Ola']);
  });

  it('a restricted staff member sees their branch only; a restriction to an archived branch sees none; no permission, none', async () => {
    const b = await business();
    const inA = await create(b.session, b.branchA);
    const inB = await create(b.session, b.branchB);
    const restricted = await member(b, 'staff', {
      permissions: ['merchant.customers.read', 'merchant.customers.manage'],
      branchId: b.branchA,
    });
    expect((await list(restricted.session)).map((r) => r.id)).toEqual([inA.id]);
    expect(await list(restricted.session, { customer: inB.id! })).toEqual([]);
    expect((await update(restricted.session, inB.id!, { nickname: 'x' })).outcome).toBe('not_found');
    expect((await setStatus(restricted.session, inB.id!, 'deactivated')).outcome).toBe('not_found');
    expect((await one(`SELECT customers.branch_of($1, $2) AS b`, [restricted.session, inB.id])).b).toBe(
      b.branchB,
    );
    await owner.query(`UPDATE tenancy.branches SET status = 'archived', archived_at = now() WHERE id = $1`, [
      b.branchA,
    ]);
    expect(await list(restricted.session)).toEqual([]);
    expect((await update(restricted.session, inA.id!, { nickname: 'x' })).outcome).toBe('not_found');
    const none = await member(b, 'staff');
    expect(await list(none.session)).toEqual([]);
    const other = await business();
    expect(await list(other.session, { customer: inA.id! })).toEqual([]);
    expect((await update(other.session, inA.id!, { nickname: 'x' })).outcome).toBe('not_found');
    expect((await one(`SELECT customers.branch_of($1, $2) AS b`, [other.session, inA.id])).b).toBeNull();
  });

  it('an agent sees only their own customers, now (P7-6)', async () => {
    const b = await business();
    const [a1, a2] = [await member(b, 'agent'), await member(b, 'agent')];
    const mine = await create(b.session, b.branchA, { agent: a1.membershipId });
    await create(b.session, b.branchA, { agent: a2.membershipId });
    const agentList = async (s: string) =>
      (await app.query(`SELECT * FROM customers.agent_customers($1, NULL, NULL, NULL, NULL, NULL)`, [s]))
        .rows;
    expect((await agentList(a1.session)).map((r) => r.id)).toEqual([mine.id]);
    await assign(b.session, mine.id!, a2.membershipId);
    expect(await agentList(a1.session)).toEqual([]);
    expect(await agentList(b.session)).toEqual([]);
  });
});

describe('the app link and the customer audience (Q7, P7-7 to P7-9)', () => {
  const issue = (s: string, customerId: string, token = hash()) =>
    call(`SELECT * FROM customers.issue_app_invitation($1, $2, $3, 3600, NULL, NULL, $4)`, [
      s,
      customerId,
      token,
      rid(),
    ]);
  const accept = (token: string, identityId: string | null, newHash: string | null) =>
    call(`SELECT * FROM customers.accept_app_invitation($1, $2, $3, NULL, NULL, $4)`, [
      token,
      identityId,
      newHash,
      rid(),
    ]);

  it('a new person: the link sets their password and verifies the email; they sign in as the customer', async () => {
    const b = await business();
    const address = email('saver');
    const c = await create(b.session, b.branchA, { email: address });
    const token = hash();
    const issued = await issue(b.session, c.id!, token);
    expect(issued).toMatchObject({ outcome: 'ok', delivery: 'setup', email: address });
    const identityId = (
      await one(`SELECT id, password_hash FROM identity.identities WHERE email = $1`, [address])
    ).id as string;
    expect((await accept(token, identityId, null)).outcome).toBe('invalid'); // a new person must set a password
    expect(await accept(token, identityId, ARGON)).toEqual({ outcome: 'ok', customer_id: c.id });
    expect(
      await one(
        `SELECT password_hash IS NOT NULL AS p, email_verified_at IS NOT NULL AS v FROM identity.identities WHERE id = $1`,
        [identityId],
      ),
    ).toEqual({
      p: true,
      v: true,
    });
    expect((await accept(token, identityId, ARGON)).outcome).toBe('invalid'); // used once
    expect(
      (await owner.query(`SELECT * FROM identity.eligible_memberships($1, 'customer')`, [identityId])).rows,
    ).toEqual([
      { membership_id: c.id, merchant_id: b.merchantId, merchant_name: expect.any(String), kind: 'customer' },
    ]);
    const s = await session(identityId, 'customer', c.id!);
    expect(
      await call(`SELECT audience, merchant_id, kind, branch_id FROM identity.validate_session($1)`, [s]),
    ).toEqual({
      audience: 'customer',
      merchant_id: b.merchantId,
      kind: 'customer',
      branch_id: b.branchA,
    });
    expect(await call(`SELECT customer_id, full_name, email FROM customers.read_self($1)`, [s])).toEqual({
      customer_id: c.id,
      full_name: 'Ada Obi',
      email: address,
    });
    // A customer session holds no permission and reads no business data.
    expect((await call(`SELECT permissions FROM identity.session_authority($1)`, [s])).permissions).toEqual(
      [],
    );
    expect(await list(s)).toEqual([]);
    expect(
      (await eventsOf(c.id!))
        .filter((e) => e.action.startsWith('customer.app'))
        .map((e) => [e.action, e.summary]),
    ).toEqual([
      ['customer.app_invited', { delivery: 'setup' }],
      ['customer.app_access_accepted', { path: 'setup' }],
    ]);
  });

  it('an existing account (a customer of another business) confirms with its password; one sign-in, two businesses', async () => {
    const [b1, b2] = [await business(), await business()];
    const address = email('twice');
    const c1 = await create(b1.session, b1.branchA, { email: address });
    const t1 = hash();
    await issue(b1.session, c1.id!, t1);
    const identityId = (await one(`SELECT id FROM identity.identities WHERE email = $1`, [address]))
      .id as string;
    await accept(t1, identityId, ARGON);
    const c2 = await create(b2.session, b2.branchA, { email: address });
    const t2 = hash();
    expect(await issue(b2.session, c2.id!, t2)).toMatchObject({ outcome: 'ok', delivery: 'accept' });
    expect((await accept(t2, identityId, ARGON)).outcome).toBe('invalid'); // an account keeps its password
    expect((await accept(t2, identityId, null)).outcome).toBe('ok');
    expect(
      (
        await owner.query(
          `SELECT membership_id FROM identity.eligible_memberships($1, 'customer') ORDER BY membership_id`,
          [identityId],
        )
      ).rows,
    ).toHaveLength(2);
  });

  it('R1: a link follows the address — changing the email revokes it, and a link is accepted only by the current address', async () => {
    const b = await business();
    const oldAddress = email('old');
    const c = await create(b.session, b.branchA, { email: oldAddress });
    const token = hash();
    await issue(b.session, c.id!, token);
    const oldIdentity = (await one(`SELECT id FROM identity.identities WHERE email = $1`, [oldAddress]))
      .id as string;
    expect((await update(b.session, c.id!, { email: email('new') })).outcome).toBe('ok');
    expect(
      (
        await one(
          `SELECT revoked_at IS NOT NULL AS revoked FROM customers.app_invitations WHERE token_hash = $1`,
          [token],
        )
      ).revoked,
    ).toBe(true);
    expect((await accept(token, oldIdentity, ARGON)).outcome).toBe('invalid');
    expect(
      (await one(`SELECT identity_id FROM customers.customers WHERE id = $1`, [c.id])).identity_id,
    ).toBeNull();
    // Changing something else leaves the link alone.
    const d = await create(b.session, b.branchA, { email: email('keep') });
    const kept = hash();
    await issue(b.session, d.id!, kept);
    await update(b.session, d.id!, { nickname: 'Kept' });
    expect(
      (
        await one(`SELECT revoked_at IS NULL AS open FROM customers.app_invitations WHERE token_hash = $1`, [
          kept,
        ])
      ).open,
    ).toBe(true);
  });

  it('R1: even were a link not revoked, it is accepted only by the account of the customer’s address now', async () => {
    const b = await business();
    const oldAddress = email('was');
    const c = await create(b.session, b.branchA, { email: oldAddress });
    const token = hash();
    await issue(b.session, c.id!, token);
    const oldIdentity = (await one(`SELECT id FROM identity.identities WHERE email = $1`, [oldAddress]))
      .id as string;
    // The address changed without the command (as the table owner): the second layer still refuses the old account.
    await owner.query(`UPDATE customers.customers SET email = $2 WHERE id = $1`, [c.id, email('is')]);
    expect((await accept(token, oldIdentity, ARGON)).outcome).toBe('invalid');
  });

  it('refuses a customer without an email, one already signed in, a deactivated one; a re-issued link replaces the old', async () => {
    const b = await business();
    const noEmail = await create(b.session, b.branchA);
    expect((await issue(b.session, noEmail.id!)).outcome).toBe('no_email');
    const c = await create(b.session, b.branchA, { email: email('re') });
    const [old, fresh] = [hash(), hash()];
    await issue(b.session, c.id!, old);
    await issue(b.session, c.id!, fresh);
    const identityId = (
      await one(`SELECT identity_id FROM customers.app_invitations WHERE token_hash = $1`, [fresh])
    ).identity_id;
    expect((await accept(old, identityId, ARGON)).outcome).toBe('invalid');
    expect((await accept(fresh, randomUUID(), ARGON)).outcome).toBe('invalid');
    expect((await accept(fresh, identityId, ARGON)).outcome).toBe('ok');
    expect((await issue(b.session, c.id!)).outcome).toBe('already_linked');
    const d = await create(b.session, b.branchA, { email: email('off') });
    await setStatus(b.session, d.id!, 'deactivated');
    expect((await issue(b.session, d.id!)).outcome).toBe('invalid_status');
  });

  it('a deactivated customer cannot sign in or keep a session (Q8, P7-8); reactivated, they can again', async () => {
    const b = await business();
    const address = email('pause');
    const c = await create(b.session, b.branchA, { email: address });
    const token = hash();
    await issue(b.session, c.id!, token);
    const identityId = (await one(`SELECT id FROM identity.identities WHERE email = $1`, [address]))
      .id as string;
    await accept(token, identityId, ARGON);
    const s = await session(identityId, 'customer', c.id!);
    await setStatus(b.session, c.id!, 'deactivated');
    expect((await app.query(`SELECT * FROM identity.validate_session($1)`, [s])).rows).toEqual([]);
    await expectSqlState(session(identityId, 'customer', c.id!), SQLSTATE.checkViolation);
    await setStatus(b.session, c.id!, 'active');
    expect((await app.query(`SELECT * FROM identity.validate_session($1)`, [s])).rows).toHaveLength(1);
  });
});

describe('removing a customer’s personal details (BR-11.3, Q9)', () => {
  const anonymise = (s: string, customerId: string) =>
    call(`SELECT * FROM customers.anonymise_customer($1, $2, NULL, NULL, $3)`, [
      s,
      customerId,
      rid(),
    ]) as Promise<Created>;

  it('the owner only; refused while anything is left with the business', async () => {
    const b = await business();
    const c = await create(b.session, b.branchA, { email: email('bal') });
    const staff = await member(b, 'staff', {
      permissions: ['merchant.customers.read', 'merchant.customers.manage', 'merchant.customers.assign'],
    });
    expect((await anonymise(staff.session, c.id!)).outcome).toBe('forbidden');
    const savings = (
      await one(`SELECT id FROM ledger.accounts WHERE subject_id = $1 AND code = '2100'`, [c.id])
    ).id;
    const office = (
      await one(
        `SELECT a.id FROM ledger.accounts a JOIN ledger.ledgers l ON l.id = a.ledger_id WHERE l.merchant_id = $1 AND a.code = '1200'`,
        [b.merchantId],
      )
    ).id;
    const { id: ledgerId } = await one(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [
      b.merchantId,
    ]);
    const post = (debit: string, credit: string) =>
      one(
        `SELECT * FROM ledger.post_entry($1, $2, 'test', CURRENT_DATE, 'Test', NULL, NULL, $3, NULL, NULL)`,
        [
          ledgerId,
          `k-${randomBytes(6).toString('hex')}`,
          JSON.stringify([
            { accountId: debit, side: 'debit', amountMinor: '500' },
            { accountId: credit, side: 'credit', amountMinor: '500' },
          ]),
        ],
      );
    await post(office, savings);
    expect((await anonymise(b.session, c.id!)).outcome).toBe('balance_not_zero');
    await post(savings, office);
    expect((await anonymise(b.session, c.id!)).outcome).toBe('ok');
    expect((await anonymise(b.session, c.id!)).outcome).toBe('invalid_status');
  });

  it('every personal detail and the sign-in go; the money records stay; the phone number is free again; recorded without details', async () => {
    const b = await business();
    const agent = await member(b, 'agent');
    const address = email('gone');
    const number = phone();
    const c = await create(b.session, b.branchA, {
      email: address,
      phone: number,
      address: '9 Lagos Rd',
      nickname: 'Ade',
      agent: agent.membershipId,
    });
    const token = hash();
    await issue(b.session, c.id!, token);
    const identityId = (await one(`SELECT id FROM identity.identities WHERE email = $1`, [address]))
      .id as string;
    await call(`SELECT * FROM customers.accept_app_invitation($1, $2, $3, NULL, NULL, NULL)`, [
      token,
      identityId,
      ARGON,
    ]);
    const s = await session(identityId, 'customer', c.id!);
    const accounts = (
      await owner.query(`SELECT count(*)::int AS n FROM ledger.accounts WHERE subject_id = $1`, [c.id])
    ).rows[0].n;
    expect(
      (await call(`SELECT * FROM customers.anonymise_customer($1, $2, NULL, NULL, NULL)`, [b.session, c.id]))
        .outcome,
    ).toBe('ok');
    expect(
      await one(
        `SELECT full_name, phone, email, address, nickname, identity_id, status FROM customers.customers WHERE id = $1`,
        [c.id],
      ),
    ).toEqual({
      full_name: 'Removed customer',
      phone: null,
      email: null,
      address: null,
      nickname: null,
      identity_id: null,
      status: 'anonymised',
    });
    expect((await app.query(`SELECT * FROM identity.validate_session($1)`, [s])).rows).toEqual([]);
    expect((await one(`SELECT customers.current_agent($1, $2) AS a`, [b.merchantId, c.id])).a).toBeNull();
    expect(
      (await owner.query(`SELECT count(*)::int AS n FROM ledger.accounts WHERE subject_id = $1`, [c.id]))
        .rows[0].n,
    ).toBe(accounts);
    expect((await create(b.session, b.branchA, { phone: number })).outcome).toBe('ok');
    const events = await owner.query(
      `SELECT summary::text AS s FROM audit.audit_events WHERE merchant_id = $1`,
      [b.merchantId],
    );
    for (const e of events.rows) {
      for (const detail of [address, number, '9 Lagos Rd', 'Ade', 'Ada Obi', '+234'])
        expect(e.s, detail).not.toContain(detail);
    }
    expect((await eventsOf(c.id!)).at(-1)).toMatchObject({ action: 'customer.anonymised', summary: {} });
  });

  const issue = (s: string, customerId: string, token: string) =>
    call(`SELECT * FROM customers.issue_app_invitation($1, $2, $3, 3600, NULL, NULL, NULL)`, [
      s,
      customerId,
      token,
    ]);
});

describe('TA-14: the activity record never holds a customer’s personal details', () => {
  const PERSONAL =
    /^(full_?name|name|phone(_?number)?|email|address|nickname|alias|date_?of_?birth|bvn|nin)$/i;

  it('no customer event may record a name, phone number, email, address or nickname', async () => {
    const { rows } = await owner.query(
      `SELECT c.identifier, k AS field FROM audit.event_catalog c CROSS JOIN LATERAL jsonb_object_keys(c.summary_allowlist) k
        WHERE c.identifier LIKE 'customer.%'`,
    );
    expect(rows.filter((r) => PERSONAL.test(r.field))).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('no event of any kind may record a phone number, email, address or nickname field', async () => {
    const { rows } = await owner.query(
      `SELECT c.identifier, k AS field FROM audit.event_catalog c CROSS JOIN LATERAL jsonb_object_keys(c.summary_allowlist) k`,
    );
    expect(
      rows.filter((r) => /^(phone(_?number)?|email|address|nickname|full_?name)$/i.test(r.field)),
    ).toEqual([]);
  });

  it('the guard is real: an event allowing a personal field would fail it (mutation, rolled back)', async () => {
    await owner.query('BEGIN');
    try {
      await owner.query(
        `INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist)
         VALUES ('customer.probe', 'success', 'atomic', 'A', '{"phone": {"type": "string", "max": 20}}')`,
      );
      const { rows } = await owner.query(
        `SELECT k AS field FROM audit.event_catalog c CROSS JOIN LATERAL jsonb_object_keys(c.summary_allowlist) k
          WHERE c.identifier LIKE 'customer.%'`,
      );
      expect(rows.filter((r) => PERSONAL.test(r.field))).toEqual([{ field: 'phone' }]);
    } finally {
      await owner.query('ROLLBACK');
    }
  });
});
