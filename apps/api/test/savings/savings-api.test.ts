import {
  AgentCollection,
  AgentCollectionList,
  Collection,
  CollectionList,
  CustomerCollectionList,
  CustomerSavings,
  Enrolment,
  Remittance,
  RemittanceList,
  SavingsMovement,
  SavingsMovementList,
  SavingsPackage,
  SavingsPackageList,
  TargetGoal,
} from '@alphakolect/contracts';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app.js';
import { uniquePhone } from '../support/customers.js';
import { expectError, tenancyFixtures, uniqueEmail } from '../support/tenancy.js';

// P8 through the real app and database (docs/architecture/P8_IMPLEMENTATION_PLAN.md §4; the owner's answers of
// 2026-10-25): packages, enrolment, an agent's cash collections for their own customers (BR-3, D1), the remittance that
// confirms them and takes the fees (BR-5.6, 6.1, 6.2), cancellation, withdrawals and target savings (BR-7), the branch
// scope (P5 §7.6), and the customer's own view with what awaits confirmation.

const { app, auth } = await createTestApp();
const { owner, token, business, member, call, auditFor } = tenancyFixtures(app, auth);

const key = () => `key-${randomBytes(8).toString('hex')}`;
const bearer = (method: 'get' | 'post', path: string, accessToken: string) =>
  request(app)[method](path).set('Authorization', `Bearer ${accessToken}`);
const record = (agentToken: string, customerId: string, amountMinor: string, k = key()) =>
  bearer('post', '/v1/agent/collections', agentToken)
    .set('Idempotency-Key', k)
    .send({ customerId, amountMinor });
const withKey = (accessToken: string, path: string, body: object, k = key()) =>
  call(accessToken, 'post', path, body).set('Idempotency-Key', k);

/** A business with an agent, a customer of theirs, and a package the customer is on. */
async function saver(pkg: object = {}) {
  const b = await business();
  const agent = await member(b, 'agent');
  const res = await call(b.owner.token, 'post', '/v1/merchant/packages', {
    name: `Alpha ${randomBytes(3).toString('hex')}`,
    kind: 'fixed',
    amountMinor: '100000',
    feeRule: 'first_contribution',
    ...pkg,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const p = SavingsPackage.parse(res.body);
  // Through the API, as a business onboards: the customer's ledger accounts open with them (P7-3).
  const created = await call(b.owner.token, 'post', '/v1/merchant/customers', {
    branchId: b.branchId,
    fullName: 'Ada Obi',
    phone: uniquePhone(),
    agentMembershipId: agent.membershipId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const customerId = created.body.customerId as string;
  const enrolled = await call(b.owner.token, 'put', `/v1/merchant/customers/${customerId}/enrolment`, {
    packageId: p.packageId,
  });
  expect(Enrolment.parse(enrolled.body)).toMatchObject({ packageId: p.packageId, effective: 'now' });
  return { b, agent, packageId: p.packageId, customerId };
}

describe('packages and enrolment (Q1, Q2, Q10; BR-5.1, 6.1)', () => {
  it('creates, lists, renames and archives packages; one fee rule each', async () => {
    const { b, packageId } = await saver();
    expectError(
      await call(b.owner.token, 'post', '/v1/merchant/packages', {
        name: 'Both',
        kind: 'fixed',
        amountMinor: '100000',
        feeRule: 'first_contribution',
        feeRateBp: 200,
      }),
      400,
      'VALIDATION_ERROR',
    );
    const list = SavingsPackageList.parse((await call(b.owner.token, 'get', '/v1/merchant/packages')).body);
    expect(list.items.map((p) => p.packageId)).toEqual([packageId]);
    const archived = await call(b.owner.token, 'patch', `/v1/merchant/packages/${packageId}`, {
      status: 'archived',
    });
    expect(SavingsPackage.parse(archived.body).status).toBe('archived');
    const events = await auditFor(archived);
    expect(events).toEqual([
      expect.objectContaining({ action: 'savings.package_updated', outcome: 'success' }),
    ]);
  });
});

describe('collections and remittances (BR-3, 5.3, 5.6, 6.1, 6.2; D1; TA-13)', () => {
  it('the agent records for their own customer; the customer is credited only when the remittance is approved', async () => {
    const { b, agent, customerId } = await saver();
    const k = key();
    const res = await record(agent.token, customerId, '300000', k);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const c = AgentCollection.parse(res.body);
    expect(c).toMatchObject({
      status: 'recorded',
      days: 3,
      amount: { amountMinor: '300000', currency: 'NGN' },
    });
    // A retry with the key gets the first answer; another body with it is refused.
    expect(
      AgentCollection.parse((await record(agent.token, customerId, '300000', k)).body).collectionId,
    ).toBe(c.collectionId);
    expectError(await record(agent.token, customerId, '100000', k), 409, 'IDEMPOTENCY_KEY_REUSED');
    expectError(await record(agent.token, customerId, '150000'), 422, 'INVALID_AMOUNT');
    const before = CustomerSavings.parse(
      (await call(b.owner.token, 'get', `/v1/merchant/customers/${customerId}/savings`)).body,
    );
    expect(before).toMatchObject({
      savings: { amountMinor: '0' },
      awaitingConfirmation: { amountMinor: '300000' },
    });
    const approved = await call(b.owner.token, 'post', '/v1/merchant/remittances', {
      agentMembershipId: agent.membershipId,
      collectionIds: [c.collectionId],
      cashMinor: '300000',
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect(Remittance.parse(approved.body)).toMatchObject({
      collectionCount: 1,
      feeTotal: { amountMinor: '100000' },
    });
    expect(await auditFor(approved)).toEqual([
      expect.objectContaining({ action: 'savings.remittance_approved', outcome: 'success' }),
    ]);
    const after = CustomerSavings.parse(
      (await call(b.owner.token, 'get', `/v1/merchant/customers/${customerId}/savings`)).body,
    );
    expect(after).toMatchObject({
      savings: { amountMinor: '200000' },
      awaitingConfirmation: { amountMinor: '0' },
      cycle: { number: 1 },
    });
    // No double credit: the collection cannot be approved again.
    expectError(
      await call(b.owner.token, 'post', '/v1/merchant/remittances', {
        agentMembershipId: agent.membershipId,
        collectionIds: [c.collectionId],
        cashMinor: '300000',
      }),
      409,
      'INVALID_LIFECYCLE_TRANSITION',
    );
    const listed = CollectionList.parse(
      (await call(b.owner.token, 'get', `/v1/merchant/collections?customerId=${customerId}`)).body,
    );
    expect(listed.items[0]).toMatchObject({ status: 'approved', fee: { amountMinor: '100000' } });
    const remittances = RemittanceList.parse(
      (await call(b.owner.token, 'get', '/v1/merchant/remittances')).body,
    );
    expect(remittances.items).toHaveLength(1);
    const mine = AgentCollectionList.parse((await bearer('get', '/v1/agent/collections', agent.token)).body);
    expect(mine.items.map((i) => i.status)).toEqual(['approved']);
  });

  it('D1: another agent’s customer is not found; a cash total that differs is refused', async () => {
    const { b, agent, customerId } = await saver();
    const other = await member(b, 'agent');
    expectError(await record(other.token, customerId, '100000'), 404, 'NOT_FOUND');
    const c = AgentCollection.parse((await record(agent.token, customerId, '100000')).body);
    expectError(
      await call(b.owner.token, 'post', '/v1/merchant/remittances', {
        agentMembershipId: agent.membershipId,
        collectionIds: [c.collectionId],
        cashMinor: '90000',
      }),
      422,
      'CASH_MISMATCH',
    );
    // Agents never approve (BR-3): the endpoint is a business's.
    expect(
      (
        await bearer('post', '/v1/merchant/remittances', agent.token).send({
          agentMembershipId: agent.membershipId,
          collectionIds: [c.collectionId],
          cashMinor: '100000',
        })
      ).status,
    ).toBe(401);
  });

  it('Q6: a collection recorded by mistake is cancelled with a reason, before approval only', async () => {
    const { b, agent, customerId } = await saver();
    const c = AgentCollection.parse((await record(agent.token, customerId, '100000')).body);
    const res = await call(b.owner.token, 'post', `/v1/merchant/collections/${c.collectionId}/cancellation`, {
      reason: 'Recorded twice',
    });
    expect(Collection.parse(res.body)).toMatchObject({ status: 'cancelled', cancelReason: 'Recorded twice' });
    expectError(
      await call(b.owner.token, 'post', `/v1/merchant/collections/${c.collectionId}/cancellation`, {
        reason: 'Again',
      }),
      409,
      'INVALID_LIFECYCLE_TRANSITION',
    );
  });
});

describe('withdrawals and target savings (BR-7, Q9)', () => {
  it('pays cash, moves to target savings, never above the balance; a retry pays once', async () => {
    const { b, agent, customerId } = await saver({
      kind: 'flexible',
      amountMinor: '1',
      feeRule: 'percentage',
      feeRateBp: 100,
    });
    const c = AgentCollection.parse((await record(agent.token, customerId, '1000000')).body);
    await call(b.owner.token, 'post', '/v1/merchant/remittances', {
      agentMembershipId: agent.membershipId,
      collectionIds: [c.collectionId],
      cashMinor: '1000000',
    });
    const k = key();
    const paid = await withKey(
      b.owner.token,
      `/v1/merchant/customers/${customerId}/withdrawals`,
      {
        wallet: 'savings',
        amountMinor: '90000',
      },
      k,
    );
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const first = SavingsMovement.parse(paid.body);
    const again = await withKey(
      b.owner.token,
      `/v1/merchant/customers/${customerId}/withdrawals`,
      {
        wallet: 'savings',
        amountMinor: '90000',
      },
      k,
    );
    expect(SavingsMovement.parse(again.body).movementId).toBe(first.movementId);
    expectError(
      await withKey(b.owner.token, `/v1/merchant/customers/${customerId}/withdrawals`, {
        wallet: 'savings',
        amountMinor: '900001',
      }),
      422,
      'INSUFFICIENT_BALANCE',
    );
    const moved = await withKey(b.owner.token, `/v1/merchant/customers/${customerId}/target-transfers`, {
      amountMinor: '400000',
    });
    expect(SavingsMovement.parse(moved.body).kind).toBe('to_target');
    const goal = await call(b.owner.token, 'put', `/v1/merchant/customers/${customerId}/target-goal`, {
      goalAmountMinor: '5000000',
      goalDate: null,
    });
    expect(TargetGoal.parse(goal.body).goalAmount).toEqual({ amountMinor: '5000000', currency: 'NGN' });
    const summary = CustomerSavings.parse(
      (await call(b.owner.token, 'get', `/v1/merchant/customers/${customerId}/savings`)).body,
    );
    expect(summary).toMatchObject({
      savings: { amountMinor: '500000' },
      targetSavings: { amountMinor: '400000' },
      goal: { amount: { amountMinor: '5000000' }, date: null },
    });
    const movements = SavingsMovementList.parse(
      (await call(b.owner.token, 'get', `/v1/merchant/customers/${customerId}/savings/movements`)).body,
    );
    expect(movements.items.map((m) => m.kind)).toEqual(['savings_withdrawal', 'to_target']);
  });

  it('a branch-restricted staff member reaches their branch’s customers only', async () => {
    const { b, customerId } = await saver();
    const other = (
      await owner.query(
        `INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, 'Second') RETURNING id`,
        [b.merchantId],
      )
    ).rows[0].id as string;
    await owner.query(`SELECT tenancy.set_role_permissions($1, $2, $3)`, [
      b.owner.sessionId,
      b.roleId,
      ['merchant.savings.read', 'merchant.withdrawals.create'],
    ]);
    const staff = await member(b, 'staff');
    await owner.query(`UPDATE tenancy.merchant_memberships SET branch_id = $2 WHERE id = $1`, [
      staff.membershipId,
      other,
    ]);
    expectError(
      await call(staff.token, 'get', `/v1/merchant/customers/${customerId}/savings`),
      404,
      'NOT_FOUND',
    );
    expectError(
      await withKey(staff.token, `/v1/merchant/customers/${customerId}/withdrawals`, {
        wallet: 'savings',
        amountMinor: '1',
      }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('the customer’s own savings (BR-5.6)', () => {
  it('shows the balances and the collections awaiting confirmation', async () => {
    const { agent, customerId } = await saver();
    await record(agent.token, customerId, '100000');
    const identityId = (
      await owner.query(`INSERT INTO identity.identities (email) VALUES ($1) RETURNING id`, [
        uniqueEmail('cu'),
      ])
    ).rows[0].id as string;
    await owner.query(`UPDATE customers.customers SET identity_id = $2 WHERE id = $1`, [
      customerId,
      identityId,
    ]);
    const own = await token(identityId, 'customer', customerId);
    const savings = CustomerSavings.parse((await bearer('get', '/v1/customer/savings', own.token)).body);
    expect(savings).toMatchObject({
      awaitingConfirmation: { amountMinor: '100000' },
      savings: { amountMinor: '0' },
    });
    const list = CustomerCollectionList.parse(
      (await bearer('get', '/v1/customer/savings/collections', own.token)).body,
    );
    expect(list.items.map((i) => i.status)).toEqual(['recorded']);
  });
});
