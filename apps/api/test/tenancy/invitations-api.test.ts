import { randomBytes } from 'node:crypto';
import { AUTH_COOKIES, Invitation, InvitationList } from '@alphakolect/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTestApp, TEST_WEB_APP_URL } from '../support/app.js';
import { expectError, TEST_PASSWORD, tenancyFixtures, uniqueEmail } from '../support/tenancy.js';

// P4.6 through the real app and database (ADR-15 T10, T11, T16; D12): an owner invites; a new person joins by
// setting their password through the emailed link; an existing account joins with the invitation link and its
// password. Replay, expiry, revocation, a deactivated business and the wrong person never create a membership, and
// every failed acceptance gets the same answer.

const { app, auth, email } = await createTestApp();
const { owner, business, member, call, auditFor } = tenancyFixtures(app, auth);

const NEW_PASSWORD = 'another long passphrase';
const clientIp = () => `10.${randomBytes(3).join('.')}`;

async function linkToken(address: string, template: string, path: string): Promise<string> {
  const of = () => email.to(address).filter((m) => m.template === template);
  await vi.waitFor(() => expect(of().length).toBeGreaterThanOrEqual(1));
  const match = new RegExp(`^${TEST_WEB_APP_URL}/${path}#token=([A-Za-z0-9_-]{43})$`, 'm').exec(
    of().at(-1)!.text,
  );
  expect(match).not.toBeNull();
  return match![1]!;
}
const setupLink = (address: string) => linkToken(address, 'invitation_setup', 'set-password');
const acceptLink = (address: string) => linkToken(address, 'invitation_accept', 'accept-invitation');

const login = (address: string, password: string) =>
  request(app)
    .post('/v1/auth/login')
    .set('X-Forwarded-For', clientIp())
    .send({ email: address, password, audience: 'merchant' });
const accessOf = (res: request.Response) =>
  Object.fromEntries(
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).map((c) => c.split(';')[0]!.split('=')),
  )[AUTH_COOKIES.access] as string;
const acceptRequest = (body: object) =>
  request(app).post('/v1/auth/invitations/accept').set('X-Forwarded-For', clientIp()).send(body);
const invite = (token: string, body: object) => call(token, 'post', '/v1/merchant/invitations', body);

/** An existing account with a password: the owner of another business. */
const existingAccount = async () => (await business('Elsewhere Ltd')).owner;

describe('a new person (T10)', () => {
  it('is invited, sets a password through the emailed link, and is a member from then on', async () => {
    const b = await business();
    const address = uniqueEmail('newcomer');
    const res = await invite(b.owner.token, {
      email: address,
      kind: 'staff',
      roleId: b.roleId,
      branchId: b.branchId,
    });
    expect(res.status).toBe(201);
    expect(Invitation.parse(res.body)).toMatchObject({
      email: address,
      kind: 'staff',
      roleId: b.roleId,
      branchId: b.branchId,
      status: 'pending',
    });
    expect(await auditFor(res)).toMatchObject([
      {
        action: 'merchant.invitation_issued',
        outcome: 'success',
        merchant_id: b.merchantId,
        target_id: res.body.invitationId,
        summary: { kind: 'staff', delivery: 'setup' },
      },
    ]);

    const setup = await request(app)
      .post('/v1/auth/password/setup')
      .set('X-Forwarded-For', clientIp())
      .send({ token: await setupLink(address), password: NEW_PASSWORD });
    expect(setup.status).toBe(204);

    const signin = await login(address, NEW_PASSWORD);
    expect(signin.status).toBe(200);
    const me = await call(accessOf(signin), 'get', '/v1/merchant/membership');
    expect(me.body).toMatchObject({ kind: 'staff', roleId: b.roleId, branchId: b.branchId });
    expect(me.body.merchant.merchantId).toBe(b.merchantId);
  });

  it('withdrawn before setup: setup completes, but no membership — signing in finds nothing', async () => {
    const b = await business();
    const address = uniqueEmail('withdrawn');
    const res = await invite(b.owner.token, { email: address, kind: 'agent' });
    await call(b.owner.token, 'post', `/v1/merchant/invitations/${res.body.invitationId}/revoke`);
    const setup = await request(app)
      .post('/v1/auth/password/setup')
      .set('X-Forwarded-For', clientIp())
      .send({ token: await setupLink(address), password: NEW_PASSWORD });
    expect(setup.status).toBe(204);
    expectError(await login(address, NEW_PASSWORD), 401, 'INVALID_CREDENTIALS');
  });
});

describe('an existing account (T11)', () => {
  it('accepts with the invitation link and its password — once', async () => {
    const b = await business();
    const person = await existingAccount();
    expect(
      (await invite(b.owner.token, { email: person.email, kind: 'staff', roleId: b.roleId })).status,
    ).toBe(201);
    const token = await acceptLink(person.email);

    const res = await acceptRequest({ token, email: person.email, password: TEST_PASSWORD });
    expect(res.status).toBe(204);
    expect(await auditFor(res)).toMatchObject([
      { action: 'auth.invitation_accepted', outcome: 'success', merchant_id: b.merchantId },
    ]);
    // Two businesses now: sign-in asks which one (ADR-15 T4).
    expectError(await login(person.email, TEST_PASSWORD), 409, 'MEMBERSHIP_SELECTION_REQUIRED');

    expectError(
      await acceptRequest({ token, email: person.email, password: TEST_PASSWORD }),
      400,
      'INVALID_INVITATION',
    );
  });

  it('every failure gets the same answer, and none creates a membership', async () => {
    const b = await business();
    const person = await existingAccount();
    const stranger = await existingAccount();
    const res = await invite(b.owner.token, { email: person.email, kind: 'agent' });
    const token = await acceptLink(person.email);

    const attempts = [
      { token, email: person.email, password: 'not the password' }, // wrong password
      { token, email: stranger.email, password: TEST_PASSWORD }, // someone else's account
      { token, email: uniqueEmail('nobody'), password: TEST_PASSWORD }, // no account
      { token: 'x'.repeat(43), email: person.email, password: TEST_PASSWORD }, // unknown token
      { token: 'short', email: person.email, password: TEST_PASSWORD }, // malformed token
    ];
    const bodies = [];
    for (const body of attempts) {
      const r = await acceptRequest(body);
      expectError(r, 400, 'INVALID_INVITATION');
      bodies.push(r.body.error.message);
    }
    expect(new Set(bodies).size).toBe(1);
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM tenancy.merchant_memberships WHERE merchant_id = $1 AND identity_id IN ($2, $3)`,
      [b.merchantId, person.identityId, stranger.identityId],
    );
    expect(rows[0].n).toBe(0);
    expect((await call(b.owner.token, 'get', '/v1/merchant/invitations')).body.items[0]).toMatchObject({
      invitationId: res.body.invitationId,
      status: 'pending', // failed attempts do not use it up
    });
  });

  it('revoked, expired, or while the business is deactivated: refused at the moment of acceptance (T16)', async () => {
    const b = await business();
    const person = await existingAccount();
    const accept = async () =>
      acceptRequest({ token: await acceptLink(person.email), email: person.email, password: TEST_PASSWORD });

    const revoked = await invite(b.owner.token, { email: person.email, kind: 'agent' });
    await call(b.owner.token, 'post', `/v1/merchant/invitations/${revoked.body.invitationId}/revoke`);
    expectError(await accept(), 400, 'INVALID_INVITATION');

    const expired = await invite(b.owner.token, { email: person.email, kind: 'agent' });
    await owner.query(
      `UPDATE tenancy.invitations SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second' WHERE id = $1`,
      [expired.body.invitationId],
    );
    const r2 = await accept();
    expectError(r2, 400, 'INVALID_INVITATION');
    expect(await auditFor(r2)).toMatchObject([{ outcome: 'failure', summary: { reason: 'expired' } }]);

    await invite(b.owner.token, { email: person.email, kind: 'agent' });
    await owner.query(
      `UPDATE tenancy.merchants SET status = 'deactivated', deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`,
      [b.merchantId],
    );
    const r3 = await accept();
    expectError(r3, 400, 'INVALID_INVITATION');
    expect(await auditFor(r3)).toMatchObject([{ summary: { reason: 'merchant_inactive' } }]);
  });
});

describe('a password reset is not an acceptance (T11)', () => {
  it('an invited account that resets its password has not joined — it still accepts explicitly', async () => {
    const b = await business('Inviting Ltd');
    const person = await existingAccount();
    expect((await invite(b.owner.token, { email: person.email, kind: 'agent' })).status).toBe(201);

    await request(app)
      .post('/v1/auth/password/forgot')
      .set('X-Forwarded-For', clientIp())
      .send({ email: person.email });
    const reset = await request(app)
      .post('/v1/auth/password/reset')
      .set('X-Forwarded-For', clientIp())
      .send({
        token: await linkToken(person.email, 'password_reset', 'reset-password'),
        password: NEW_PASSWORD,
      });
    expect(reset.status).toBe(204);

    // One membership only (the account's own business): no selection step, and not a member of the inviter.
    const signin = await login(person.email, NEW_PASSWORD);
    expect(signin.status).toBe(200);
    expect(signin.body.session.merchantId).not.toBe(b.merchantId);

    const accepted = await acceptRequest({
      token: await acceptLink(person.email),
      email: person.email,
      password: NEW_PASSWORD,
    });
    expect(accepted.status).toBe(204);
  });
});

describe('the owner’s side', () => {
  it('the answer is the same whether or not the email has an account (D12)', async () => {
    const b = await business();
    const person = await existingAccount();
    const fresh = await invite(b.owner.token, { email: uniqueEmail('fresh'), kind: 'agent' });
    const known = await invite(b.owner.token, { email: person.email, kind: 'agent' });
    expect(fresh.status).toBe(known.status);
    expect(Object.keys(fresh.body).sort()).toEqual(Object.keys(known.body).sort());
    expect(JSON.stringify(known.body)).not.toMatch(/delivery|accept|setup/);
  });

  it('lists its own invitations only, newest first, with their status', async () => {
    const a = await business();
    const b = await business();
    const first = await invite(a.owner.token, { email: uniqueEmail('one'), kind: 'agent' });
    const second = await invite(a.owner.token, { email: uniqueEmail('two'), kind: 'agent' });
    await call(a.owner.token, 'post', `/v1/merchant/invitations/${first.body.invitationId}/revoke`);
    const third = await invite(a.owner.token, { email: uniqueEmail('four'), kind: 'agent' });
    await owner.query(
      `UPDATE tenancy.invitations SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second' WHERE id = $1`,
      [third.body.invitationId],
    );
    const theirs = await invite(b.owner.token, { email: uniqueEmail('three'), kind: 'agent' });

    const list = InvitationList.parse((await call(a.owner.token, 'get', '/v1/merchant/invitations')).body);
    expect(list.items.map((i) => [i.invitationId, i.status])).toEqual([
      [second.body.invitationId, 'pending'],
      [first.body.invitationId, 'revoked'],
      [third.body.invitationId, 'expired'], // backdated, so now the oldest
    ]);
    expect(list.items.map((i) => i.invitationId)).not.toContain(theirs.body.invitationId);
  });

  it('revoking: once; another business’s invitation is 404', async () => {
    const a = await business();
    const b = await business();
    const mine = await invite(a.owner.token, { email: uniqueEmail('m'), kind: 'agent' });
    const theirs = await invite(b.owner.token, { email: uniqueEmail('t'), kind: 'agent' });
    const revoke = (id: string) => call(a.owner.token, 'post', `/v1/merchant/invitations/${id}/revoke`);

    expectError(await revoke(theirs.body.invitationId), 404, 'NOT_FOUND');
    const ok = await revoke(mine.body.invitationId);
    expect(ok.body).toMatchObject({ status: 'revoked' });
    expect(await auditFor(ok)).toMatchObject([{ action: 'merchant.invitation_revoked', outcome: 'success' }]);
    expectError(await revoke(mine.body.invitationId), 409, 'INVALID_LIFECYCLE_TRANSITION');
  });

  it('refuses a bad assignment, an existing member, and staff (403, audited as denied)', async () => {
    const a = await business();
    const b = await business();
    const staff = await member(a, 'staff');
    expectError(
      await invite(a.owner.token, { email: uniqueEmail('r'), kind: 'staff', roleId: b.roleId }),
      409,
      'INVALID_ASSIGNMENT',
    );
    expectError(
      await invite(a.owner.token, { email: uniqueEmail('r'), kind: 'staff' }),
      409,
      'INVALID_ASSIGNMENT',
    );
    expectError(await invite(a.owner.token, { email: staff.email, kind: 'agent' }), 409, 'ALREADY_MEMBER');

    const denied = await invite(staff.token, { email: uniqueEmail('s'), kind: 'agent' });
    expectError(denied, 403, 'FORBIDDEN');
    expect(await auditFor(denied)).toMatchObject([{ outcome: 'denied', summary: { reason: 'not_owner' } }]);
    expectError(await call(staff.token, 'get', '/v1/merchant/invitations'), 403, 'FORBIDDEN');
  });
});
