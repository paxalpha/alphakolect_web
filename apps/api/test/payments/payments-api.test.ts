import {
  LiveWallet,
  PlatformWalletList,
  ReconciliationFindingList,
  UnmatchedTransactionList,
  WalletReceipt,
  WalletReceiptList,
} from '@alphakolect/contracts';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app.js';
import { paymentResources } from '../support/payments.js';
import { expectError, tenancyFixtures } from '../support/tenancy.js';

// P9 through the real app and database (docs/architecture/P9_IMPLEMENTATION_PLAN.md §4; the owner's answers of
// 2026-10-26): the business's Live wallet and the money received (Q1), the platform team's lists and resolutions (Q4,
// Q5), and the webhook, which stores and believes nothing.

const { app, auth } = await createTestApp();
const { owner, business, member, platformAdmin, call, auditFor } = tenancyFixtures(app, auth);

describe('the business’s Live wallet (Q1)', () => {
  it('its account, balance and the money to classify', async () => {
    const b = await business();
    // 'none' until requested, though the worker's sweep in a file running beside this one may already have asked.
    const before = LiveWallet.parse((await call(b.owner.token, 'get', '/v1/merchant/wallet')).body);
    expect(['none', 'provisioning', 'active']).toContain(before.status);
    expect(before.balance.amountMinor).toBe('0');
    const p = await paymentResources(owner, b.merchantId);
    expect(LiveWallet.parse((await call(b.owner.token, 'get', '/v1/merchant/wallet')).body)).toMatchObject({
      status: 'active',
      accountNumber: p.accountNumber,
      balance: { amountMinor: '30000' },
      toClassify: { amountMinor: '30000' },
    });
  });

  it('lists the money received and records what it was for, once, in one of the business’s own accounts', async () => {
    const b = await business();
    const p = await paymentResources(owner, b.merchantId);
    const open = WalletReceiptList.parse(
      (await call(b.owner.token, 'get', '/v1/merchant/wallet/receipts?classified=false')).body,
    );
    expect(open.items).toHaveLength(3);
    const path = `/v1/merchant/wallet/receipts/${p.receiptId}/classification`;
    const res = await call(b.owner.token, 'post', path, {
      accountId: p.capitalId,
      note: 'The owner’s deposit',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(WalletReceipt.parse(res.body)).toMatchObject({
      receiptId: p.receiptId,
      classifiedAccountId: p.capitalId,
      classifiedNote: 'The owner’s deposit',
    });
    expect(WalletReceipt.parse(res.body).receivedAt).not.toBeNull();
    expect(await auditFor(res)).toEqual([
      expect.objectContaining({
        action: 'payments.receipt_classified',
        outcome: 'success',
        target_id: p.receiptId,
      }),
    ]);
    expectError(
      await call(b.owner.token, 'post', path, { accountId: p.capitalId }),
      409,
      'ALREADY_CLASSIFIED',
    );
    const wallet = (
      await owner.query(`SELECT id FROM ledger.accounts WHERE merchant_id = $1 AND code = '1100'`, [
        b.merchantId,
      ])
    ).rows[0].id as string;
    expectError(
      await call(b.owner.token, 'post', `/v1/merchant/wallet/receipts/${p.openReceiptId}/classification`, {
        accountId: wallet,
      }),
      422,
      'INVALID_ACCOUNT',
    );
  });

  it('staff need their grants; another business’s receipt is not found', async () => {
    const b = await business();
    const p = await paymentResources(owner, b.merchantId);
    const staff = await member(b, 'staff');
    expectError(await call(staff.token, 'get', '/v1/merchant/wallet'), 403, 'FORBIDDEN');
    const other = await business();
    const mine = await paymentResources(owner, other.merchantId);
    expectError(
      await call(other.owner.token, 'post', `/v1/merchant/wallet/receipts/${p.receiptId}/classification`, {
        accountId: mine.capitalId,
      }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('the platform team (Q4, Q5)', () => {
  it('each list is recorded; a transaction under review and a finding are resolved with a note', async () => {
    const b = await business();
    const p = await paymentResources(owner, b.merchantId);
    const admin = await platformAdmin();
    const wallets = await call(admin.token, 'get', '/v1/platform/payments/wallets?limit=100');
    expect(wallets.status, JSON.stringify(wallets.body)).toBe(200);
    expect(PlatformWalletList.parse(wallets.body).items.map((i) => i.walletId)).toContain(p.walletId);
    expect(await auditFor(wallets)).toEqual([
      expect.objectContaining({ action: 'platform.wallets_read', outcome: 'success' }),
    ]);
    const unmatched = await call(admin.token, 'get', '/v1/platform/payments/unmatched?limit=100');
    expect(UnmatchedTransactionList.parse(unmatched.body).items.map((i) => i.transactionId)).toContain(
      p.transactionId,
    );
    const findings = await call(admin.token, 'get', '/v1/platform/payments/findings?limit=100');
    expect(ReconciliationFindingList.parse(findings.body).items.map((i) => i.findingId)).toContain(
      p.findingId,
    );
    const resolved = await call(
      admin.token,
      'post',
      `/v1/platform/payments/unmatched/${p.transactionId}/resolution`,
      {
        resolution: 'dismissed',
        note: 'The bank says it stands',
      },
    );
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expectError(
      await call(admin.token, 'post', `/v1/platform/payments/unmatched/${p.transactionId}/resolution`, {
        resolution: 'dismissed',
        note: 'Again',
      }),
      409,
      'INVALID_LIFECYCLE_TRANSITION',
    );
    const closed = await call(
      admin.token,
      'post',
      `/v1/platform/payments/findings/${p.findingId}/resolution`,
      {
        note: 'Understood',
      },
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const open = ReconciliationFindingList.parse(
      (await call(admin.token, 'get', '/v1/platform/payments/findings?limit=100')).body,
    );
    expect(open.items.map((i) => i.findingId)).not.toContain(p.findingId);
    const all = ReconciliationFindingList.parse(
      (await call(admin.token, 'get', '/v1/platform/payments/findings?limit=100&status=all')).body,
    );
    expect(all.items.map((i) => i.findingId)).toContain(p.findingId);
  });

  it('a credit needs a wallet; platform staff need their grant; the wallet’s creation is the super admin’s (Q6)', async () => {
    const admin = await platformAdmin();
    expectError(
      await call(
        admin.token,
        'post',
        `/v1/platform/payments/unmatched/01900000-0000-7000-8000-00000000dead/resolution`,
        {
          resolution: 'credited',
          note: 'No wallet named',
        },
      ),
      400,
      'VALIDATION_ERROR',
    );
    const support = await platformAdmin('support');
    expectError(await call(support.token, 'get', '/v1/platform/payments/wallets'), 403, 'FORBIDDEN');
    expectError(await call(support.token, 'post', '/v1/platform/wallet'), 403, 'FORBIDDEN');
    const created = await call(admin.token, 'post', '/v1/platform/wallet');
    expect([201, 409], JSON.stringify(created.body)).toContain(created.status);
    expectError(await call(admin.token, 'post', '/v1/platform/wallet'), 409, 'ALREADY_EXISTS');
  });
});

describe('the webhook (TA-8)', () => {
  const stored = (reference: string) =>
    owner.query(`SELECT headers, body, status FROM payments.provider_events WHERE reference = $1`, [
      reference,
    ]);

  it('needs no session, stores the event as it arrived, keeps no cookie or authorization, and credits nothing', async () => {
    const id = `tx-${randomBytes(8).toString('hex')}`;
    const payload = `{"type":"transfer.inbound", "providerTxId":"${id}",  "amount":"999"}`;
    const res = await request(app)
      .post('/v1/webhooks/transactpay')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer not-for-keeping')
      .set('Cookie', 'session=not-for-keeping')
      .set('X-Signature', 'kept')
      .send(payload);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ received: true });
    const { rows } = await stored(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe(payload);
    expect(rows[0].status).toBe('received');
    expect(rows[0].headers).toMatchObject({ 'x-signature': 'kept', 'content-type': 'application/json' });
    expect(JSON.stringify(rows[0].headers)).not.toContain('not-for-keeping');
  });

  it('an unrecognised body is stored with no lead; too large, or not JSON, is refused', async () => {
    const res = await request(app).post('/v1/webhooks/transactpay').send({ hello: 'world' });
    expect(res.status).toBe(200);
    const big = await request(app)
      .post('/v1/webhooks/transactpay')
      .send({ pad: 'x'.repeat(70_000) });
    expectError(big, 413, 'PAYLOAD_TOO_LARGE');
    const bad = await request(app)
      .post('/v1/webhooks/transactpay')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(bad.status).toBe(400);
  });
});
