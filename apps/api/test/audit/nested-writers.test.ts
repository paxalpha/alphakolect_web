import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTestApp, TEST_WEB_APP_URL } from '../support/app.js';
import { auditRows, failAuditInsert, markerRequestId } from '../support/audit.js';
import { tenancyFixtures, uniqueEmail } from '../support/tenancy.js';

// The nested-writer table (P5 plan §7.2 R27), through the real app and database. Account setup is a pattern-B flow:
// identity.complete_account_setup and one mutateAudited for auth.account_setup (#10). Inside the definer call, each
// admission records its own auth.invitation_accepted (#14, pattern A) — the one nested pattern-A writer the table
// allows. Zero, one or two admissions; every row commits with the setup or none does.

const { app, auth, email } = await createTestApp();
const { owner, business, call } = tenancyFixtures(app, auth);

const PASSWORD = 'a long enough passphrase';
const clientIp = () => `10.${randomBytes(3).join('.')}`;

/** The newest account-setup link sent to `address` (each issue supersedes the earlier link). */
async function setupLink(address: string): Promise<string> {
  const of = () => email.to(address).filter((m) => m.template === 'invitation_setup');
  await vi.waitFor(() => expect(of().length).toBeGreaterThanOrEqual(1));
  return new RegExp(`^${TEST_WEB_APP_URL}/set-password#token=([A-Za-z0-9_-]{43})$`, 'm').exec(
    of().at(-1)!.text,
  )![1]!;
}

type Business = Awaited<ReturnType<typeof business>>;
/** A staff invitation of `b` to `address` (a new person): the id. */
async function invite(b: Business, address: string): Promise<string> {
  const res = await call(b.owner.token, 'post', '/v1/merchant/invitations', {
    email: address,
    kind: 'staff',
    roleId: b.roleId,
    branchId: b.branchId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.invitationId as string;
}

const setup = (token: string, rid: string) =>
  request(app)
    .post('/v1/auth/password/setup')
    .set('X-Request-ID', rid)
    .set('X-Forwarded-For', clientIp())
    .send({ token, password: PASSWORD });

const person = async (address: string) =>
  (
    await owner.query(
      `SELECT id, password_hash, email_verified_at FROM identity.identities WHERE email = $1`,
      [address],
    )
  ).rows[0] as { id: string; password_hash: string | null; email_verified_at: Date | null };
const memberships = async (identityId: string) =>
  (
    await owner.query(
      `SELECT id, merchant_id FROM tenancy.merchant_memberships WHERE identity_id = $1 ORDER BY merchant_id`,
      [identityId],
    )
  ).rows as { id: string; merchant_id: string }[];
const rowsOf = async (rid: string, action: string) =>
  (await auditRows(owner, rid)).filter((r) => r.action === action && r.outcome === 'success');

/** #14 as §8.1 records it: the invitation's identity, no audience, the membership just created, the invitation. */
const acceptance = (
  identityId: string,
  membership: { id: string; merchant_id: string },
  invitationId: string,
) => ({
  action: 'auth.invitation_accepted',
  outcome: 'success',
  merchant_id: membership.merchant_id,
  actor_identity_id: identityId,
  actor_audience: null,
  actor_membership_id: membership.id,
  target_type: 'invitation',
  target_id: invitationId,
  summary: { path: 'account_setup', kind: 'staff' },
});

describe('account setup and its nested acceptances (R27)', () => {
  it('no invitation pending (withdrawn first): the setup commits with #10 alone', async () => {
    const b = await business();
    const address = uniqueEmail('r27-none');
    const invitationId = await invite(b, address);
    const revoked = await call(b.owner.token, 'post', `/v1/merchant/invitations/${invitationId}/revoke`);
    expect(revoked.status).toBe(200);
    const rid = markerRequestId('r27-0');
    expect((await setup(await setupLink(address), rid)).status).toBe(204);
    const p = await person(address);
    expect(await memberships(p.id)).toEqual([]);
    expect(await rowsOf(rid, 'auth.invitation_accepted')).toEqual([]);
    expect(await rowsOf(rid, 'auth.account_setup')).toHaveLength(1);
  });

  it('one invitation: one #10 and one #14, with the actor of §8.1', async () => {
    const b = await business();
    const address = uniqueEmail('r27-one');
    const invitationId = await invite(b, address);
    const rid = markerRequestId('r27-1');
    expect((await setup(await setupLink(address), rid)).status).toBe(204);
    const p = await person(address);
    const [m] = await memberships(p.id);
    expect(await rowsOf(rid, 'auth.invitation_accepted')).toEqual([
      expect.objectContaining({ ...acceptance(p.id, m!, invitationId), request_id: rid }),
    ]);
    expect(await rowsOf(rid, 'auth.account_setup')).toEqual([
      expect.objectContaining({ actor_identity_id: p.id, merchant_id: null }),
    ]);
  });

  it('two invitations of two businesses: one #10 and one #14 per membership, each in its own business', async () => {
    const [b1, b2] = [await business(), await business()];
    const address = uniqueEmail('r27-two');
    const first = await invite(b1, address);
    const second = await invite(b2, address);
    const rid = markerRequestId('r27-2');
    expect((await setup(await setupLink(address), rid)).status).toBe(204);
    const p = await person(address);
    const joined = await memberships(p.id);
    expect(joined.map((m) => m.merchant_id).sort()).toEqual([b1.merchantId, b2.merchantId].sort());
    const byMerchant = (id: string) => joined.find((m) => m.merchant_id === id)!;
    const rows = await rowsOf(rid, 'auth.invitation_accepted');
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining(acceptance(p.id, byMerchant(b1.merchantId), first)),
        expect.objectContaining(acceptance(p.id, byMerchant(b2.merchantId), second)),
      ]),
    );
    expect(await rowsOf(rid, 'auth.account_setup')).toHaveLength(1);
  });

  it('the second #14 failing rolls back everything: password, verification, both memberships, the first #14 and #10', async () => {
    const [b1, b2] = [await business(), await business()];
    const address = uniqueEmail('r27-fail14');
    await invite(b1, address);
    const second = await invite(b2, address);
    const rid = markerRequestId('r27-f14');
    const token = await setupLink(address);
    const restore = await failAuditInsert(owner, 'auth.invitation_accepted', 'success', rid, second);
    try {
      expect((await setup(token, rid)).status).toBe(500);
    } finally {
      await restore();
    }
    const p = await person(address);
    expect(p).toMatchObject({ password_hash: null, email_verified_at: null });
    expect(await memberships(p.id)).toEqual([]);
    expect(await auditRows(owner, rid)).toEqual([]);
    // Nothing was used up: the same link still completes the setup, with both admissions.
    const retry = markerRequestId('r27-f14-retry');
    expect((await setup(token, retry)).status).toBe(204);
    expect(await memberships(p.id)).toHaveLength(2);
    expect(await rowsOf(retry, 'auth.invitation_accepted')).toHaveLength(2);
  });

  it('#10 failing rolls back both #14 rows and both memberships', async () => {
    const [b1, b2] = [await business(), await business()];
    const address = uniqueEmail('r27-fail10');
    await invite(b1, address);
    await invite(b2, address);
    const rid = markerRequestId('r27-f10');
    const token = await setupLink(address);
    const restore = await failAuditInsert(owner, 'auth.account_setup', 'success', rid);
    try {
      expect((await setup(token, rid)).status).toBe(500);
    } finally {
      await restore();
    }
    const p = await person(address);
    expect(p).toMatchObject({ password_hash: null, email_verified_at: null });
    expect(await memberships(p.id)).toEqual([]);
    expect(await auditRows(owner, rid)).toEqual([]);
  });
});
