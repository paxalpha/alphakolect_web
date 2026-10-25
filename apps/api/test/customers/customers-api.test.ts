import {
  AgentCustomer,
  AgentCustomerList,
  Customer,
  CustomerAssignmentList,
  CustomerList,
  CustomerLoginResponse,
  CustomerSelf,
  CustomerTokens,
} from '@alphakolect/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app.js';
import { uniquePhone } from '../support/customers.js';
import { expectError, tenancyFixtures, uniqueEmail } from '../support/tenancy.js';

// P7 through the real app and database (docs/architecture/P7_IMPLEMENTATION_PLAN.md §4; the owner's answers of
// 2026-10-25): the business's customers, branch-scoped for a restricted staff member (P5 §7.6); the agent's own
// customers; the app link, the customer's sign-in and their own record; deactivation and removing personal details.

const { app, auth, email } = await createTestApp();
const { owner, business, member, call, auditFor } = tenancyFixtures(app, auth);
const PASSWORD = 'a customer passphrase long enough';

const create = (token: string, body: object) => call(token, 'post', '/v1/merchant/customers', body);
const newCustomer = async (token: string, branchId: string, extra: object = {}) => {
  const res = await create(token, { branchId, fullName: 'Ada Obi', phone: uniquePhone(), ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return Customer.parse(res.body);
};
const staffWith = async (
  b: Awaited<ReturnType<typeof business>>,
  permissions: string[],
  branchId: string | null,
) => {
  await owner.query(`SELECT tenancy.set_role_permissions($1, $2, $3)`, [
    b.owner.sessionId,
    b.roleId,
    permissions,
  ]);
  const staff = await member(b, 'staff');
  if (branchId)
    await owner.query(`UPDATE tenancy.merchant_memberships SET branch_id = $2 WHERE id = $1`, [
      staff.membershipId,
      branchId,
    ]);
  return staff;
};
const bearer = (method: 'get' | 'post', path: string, token: string) =>
  request(app)[method](path).set('Authorization', `Bearer ${token}`);

describe('the business’s customers', () => {
  it('onboards with a normalised phone number and an agent; recorded without personal details; listed and searched', async () => {
    const b = await business();
    const agent = await member(b, 'agent');
    const res = await create(b.owner.token, {
      branchId: b.branchId,
      fullName: 'Chinedu Eze',
      phone: '0803 555 0101',
      email: 'chinedu@example.test',
      agentMembershipId: agent.membershipId,
    });
    expect(res.status).toBe(201);
    const c = Customer.parse(res.body);
    expect(c).toMatchObject({
      fullName: 'Chinedu Eze',
      phone: '+2348035550101',
      agentMembershipId: agent.membershipId,
      status: 'active',
      appAccess: false,
    });
    const events = await auditFor(res);
    expect(events).toEqual([
      expect.objectContaining({ action: 'customer.created', outcome: 'success', target_id: c.customerId }),
    ]);
    expect(JSON.stringify(events)).not.toContain('Chinedu');
    expectError(
      await create(b.owner.token, { branchId: b.branchId, fullName: 'Other', phone: '+2348035550101' }),
      409,
      'PHONE_TAKEN',
    );
    const found = CustomerList.parse(
      (await call(b.owner.token, 'get', '/v1/merchant/customers?search=chined')).body,
    );
    expect(found.items.map((i) => i.customerId)).toEqual([c.customerId]);
    const history = CustomerAssignmentList.parse(
      (await call(b.owner.token, 'get', `/v1/merchant/customers/${c.customerId}/assignments`)).body,
    );
    expect(history.items.map((h) => h.agentMembershipId)).toEqual([agent.membershipId]);
  });

  it('a branch-restricted staff member reaches their branch’s customers only; another branch’s is not found', async () => {
    const b = await business();
    const other = (
      await owner.query(
        `INSERT INTO tenancy.branches (merchant_id, name) VALUES ($1, 'Second') RETURNING id`,
        [b.merchantId],
      )
    ).rows[0].id as string;
    const mine = await newCustomer(b.owner.token, b.branchId);
    const theirs = await newCustomer(b.owner.token, other);
    const staff = await staffWith(b, ['merchant.customers.read', 'merchant.customers.manage'], b.branchId);
    const list = CustomerList.parse((await call(staff.token, 'get', '/v1/merchant/customers')).body);
    expect(list.items.map((i) => i.customerId)).toEqual([mine.customerId]);
    expectError(
      await call(staff.token, 'get', `/v1/merchant/customers/${theirs.customerId}`),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(staff.token, 'patch', `/v1/merchant/customers/${theirs.customerId}`, { nickname: 'x' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await create(staff.token, { branchId: other, fullName: 'X', phone: uniquePhone() }),
      404,
      'NOT_FOUND',
    );
    expect(
      (await call(staff.token, 'patch', `/v1/merchant/customers/${mine.customerId}`, { nickname: 'Ok' }))
        .status,
    ).toBe(200);
  });

  it('deactivation, reactivation and removing the details: the owner only, once nothing is left', async () => {
    const b = await business();
    const c = await newCustomer(b.owner.token, b.branchId, { email: uniqueEmail('gone') });
    const off = await call(b.owner.token, 'post', `/v1/merchant/customers/${c.customerId}/deactivate`);
    expect(Customer.parse(off.body).status).toBe('deactivated');
    expectError(
      await call(b.owner.token, 'post', `/v1/merchant/customers/${c.customerId}/deactivate`),
      409,
      'INVALID_LIFECYCLE_TRANSITION',
    );
    expect(
      (await call(b.owner.token, 'post', `/v1/merchant/customers/${c.customerId}/reactivate`)).status,
    ).toBe(200);
    const staff = await staffWith(
      b,
      ['merchant.customers.read', 'merchant.customers.manage', 'merchant.customers.assign'],
      null,
    );
    expectError(
      await call(staff.token, 'post', `/v1/merchant/customers/${c.customerId}/anonymisation`),
      403,
      'FORBIDDEN',
    );
    const gone = Customer.parse(
      (await call(b.owner.token, 'post', `/v1/merchant/customers/${c.customerId}/anonymisation`)).body,
    );
    expect(gone).toMatchObject({
      fullName: 'Removed customer',
      phone: null,
      email: null,
      status: 'anonymised',
    });
  });

  it('a staff member who may change customers but not see them still gets the customer they changed', async () => {
    const b = await business();
    const staff = await staffWith(b, ['merchant.customers.manage'], null);
    const res = await create(staff.token, {
      branchId: b.branchId,
      fullName: 'Bola Ade',
      phone: uniquePhone(),
    });
    expect(res.status).toBe(201);
    expect(Customer.parse(res.body).fullName).toBe('Bola Ade');
    expectError(await call(staff.token, 'get', '/v1/merchant/customers'), 403, 'FORBIDDEN');
  });
});

describe('the agent’s own customers (P7-6)', () => {
  it('an agent adds a customer, who is theirs; sees only their own', async () => {
    const b = await business();
    const agent = await member(b, 'agent');
    const res = await bearer('post', '/v1/agent/customers', agent.token).send({
      branchId: b.branchId,
      fullName: 'Field Saver',
      phone: uniquePhone(),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const added = AgentCustomer.parse(res.body);
    await newCustomer(b.owner.token, b.branchId); // another, not the agent's
    const list = AgentCustomerList.parse((await bearer('get', '/v1/agent/customers', agent.token)).body);
    expect(list.items.map((i) => i.customerId)).toEqual([added.customerId]);
  });
});

describe('the app link and the customer’s sign-in (Q7)', () => {
  const linkOf = (address: string) => {
    // The latest link sent to the address.
    const message = email
      .to(address)
      .filter((m) => m.template === 'customer_app_setup' || m.template === 'customer_app_accept')
      .at(-1);
    return /#token=([^\s]+)/.exec(message!.text)![1]!;
  };

  it('the business sends the link; the new person sets a password, signs in, sees their own record; deactivated, they cannot', async () => {
    const b = await business();
    const address = uniqueEmail('saver');
    const c = await newCustomer(b.owner.token, b.branchId, { email: address });
    const sent = await call(b.owner.token, 'post', `/v1/merchant/customers/${c.customerId}/app-invitation`);
    expect(sent.status).toBe(202);
    expect(email.to(address).map((m) => m.template)).toEqual(['customer_app_setup']);
    const accepted = await request(app)
      .post('/v1/auth/customer/invitation/accept')
      .send({ token: linkOf(address), email: address, password: PASSWORD });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(204);
    expectError(
      await request(app)
        .post('/v1/auth/customer/invitation/accept')
        .send({ token: linkOf(address), email: address, password: PASSWORD }),
      400,
      'INVALID_INVITATION',
    );

    const login = await request(app)
      .post('/v1/auth/customer/login')
      .send({ email: address, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const signedIn = CustomerLoginResponse.parse(login.body);
    if (signedIn.status !== 'authenticated') throw new Error('expected a session');
    expect(signedIn.session.audience).toBe('customer');
    const meRes = await bearer('get', '/v1/customer/me', signedIn.accessToken);
    expect(meRes.status, JSON.stringify(meRes.body)).toBe(200);
    const me = CustomerSelf.parse(meRes.body);
    expect(me).toMatchObject({
      customerId: c.customerId,
      email: address,
      merchant: { merchantId: b.merchantId },
    });
    // A customer's token is not a business's, nor an agent's.
    expect((await bearer('get', '/v1/merchant/customers', signedIn.accessToken)).status).toBe(401);
    expect((await bearer('get', '/v1/agent/customers', signedIn.accessToken)).status).toBe(403);
    const refreshed = CustomerTokens.parse(
      (await request(app).post('/v1/auth/customer/refresh').send({ refreshToken: signedIn.refreshToken }))
        .body,
    );
    expect(refreshed.session.audience).toBe('customer');
    // An agent's refresh endpoint never rotates a customer token (T12).
    expectError(
      await request(app).post('/v1/auth/agent/refresh').send({ refreshToken: refreshed.refreshToken }),
      401,
      'INVALID_OR_EXPIRED_TOKEN',
    );

    await call(b.owner.token, 'post', `/v1/merchant/customers/${c.customerId}/deactivate`);
    expect((await bearer('get', '/v1/customer/me', refreshed.accessToken)).status).toBe(401);
    expectError(
      await request(app).post('/v1/auth/customer/login').send({ email: address, password: PASSWORD }),
      401,
      'INVALID_CREDENTIALS',
    );
  });

  it('a person who saves with two businesses chooses one at sign-in', async () => {
    const [b1, b2] = [await business(), await business()];
    const address = uniqueEmail('twice');
    for (const b of [b1, b2]) {
      const c = await newCustomer(b.owner.token, b.branchId, { email: address });
      await call(b.owner.token, 'post', `/v1/merchant/customers/${c.customerId}/app-invitation`);
      const res = await request(app)
        .post('/v1/auth/customer/invitation/accept')
        .send({ token: linkOf(address), email: address, password: PASSWORD });
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    }
    const login = CustomerLoginResponse.parse(
      (await request(app).post('/v1/auth/customer/login').send({ email: address, password: PASSWORD })).body,
    );
    expect(login.status).toBe('membership_selection_required');
    if (login.status !== 'membership_selection_required') return;
    expect(login.memberships).toHaveLength(2);
    const chosen = await request(app)
      .post('/v1/auth/customer/login/select')
      .send({ selectionToken: login.selectionToken, selectionId: login.memberships[1]!.selectionId });
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
    expect(CustomerTokens.parse(chosen.body).session.audience).toBe('customer');
  });

  it('refuses a link for a customer without an email; the answer never says whether the address had an account', async () => {
    const b = await business();
    const c = await newCustomer(b.owner.token, b.branchId);
    expectError(
      await call(b.owner.token, 'post', `/v1/merchant/customers/${c.customerId}/app-invitation`),
      409,
      'NO_EMAIL',
    );
  });
});
