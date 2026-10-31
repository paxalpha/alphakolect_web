import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs } from './support/db.js';

// The payments races (P9 plan §5; TA-8), staged and repeated 50 times each, as lock-races.test.ts stages P5's: the first
// transaction holds its footprint, the second is shown to wait for it (pg_locks) before the first commits, and the
// second's outcome is then the one the plan requires. A deadlock (40P01) or any other error fails.

const RUNS = 50;

let a1: pg.Client;
let a2: pg.Client;
let w1: pg.Client;
let w2: pg.Client;
let watcher: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [a1, a2, w1, w2, watcher, owner] = await Promise.all([
    connectAs('app'),
    connectAs('app'),
    connectAs('worker'),
    connectAs('worker'),
    connectAs('migrator'),
    connectAs('migrator'),
  ]);
});
afterAll(async () => {
  await Promise.all([a1, a2, w1, w2, watcher, owner].map((c) => c.end()));
});

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ARGON = `$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$x`;
const txId = () => `tx-${randomBytes(8).toString('hex')}`;
const account = () =>
  Array.from(randomBytes(10))
    .map((b) => String(b % 10))
    .join('');

async function waitsForALock(backend: number) {
  for (let i = 0; i < 400; i++) {
    const { rowCount } = await watcher.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [
      backend,
    ]);
    if (rowCount) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`backend ${backend} never waited for a lock`);
}

/** One staged race: `first` holds its footprint on c1; `second` starts on c2 and waits; c1 commits; c2's result. */
async function race<T>(
  first: (c: pg.Client) => Promise<unknown>,
  second: (c: pg.Client) => Promise<T>,
  [c1, c2]: [pg.Client, pg.Client] = [a1, a2],
): Promise<T> {
  const backend = (await c2.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
  await c1.query('BEGIN');
  await first(c1);
  await c2.query('BEGIN');
  const pending = second(c2).then(
    async (r) => {
      await c2.query('COMMIT');
      return r;
    },
    async (e) => {
      await c2.query('ROLLBACK');
      throw e;
    },
  );
  await waitsForALock(backend);
  await c1.query('COMMIT');
  return pending;
}

const session = async (identityId: string, audience: string, membershipId: string) =>
  (
    await a1.query(`SELECT * FROM identity.create_session($1, $2, $3, 'full', $4, $5, $6, NULL, NULL)`, [
      identityId,
      audience,
      membershipId,
      hash(),
      audience === 'platform' ? 3600 : 86400,
      audience === 'platform' ? 43200 : 1209600,
    ])
  ).rows[0].session_id as string;

/** A verified business with its owner's session and an active wallet. */
async function business() {
  const {
    rows: [s],
  } = await a1.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, 'Races')`, [
    `race-${randomBytes(6).toString('hex')}@example.test`,
    ARGON,
  ]);
  const verification = hash();
  await a1.query(`SELECT identity.issue_one_time_token($1, 'email_verification', $2, 3600, NULL)`, [
    s.identity_id,
    verification,
  ]);
  await a1.query(`SELECT identity.verify_email($1)`, [verification]);
  const membership = (
    await owner.query(`SELECT id FROM tenancy.merchant_memberships WHERE identity_id = $1`, [s.identity_id])
  ).rows[0].id as string;
  await w1.query(`SELECT payments.request_wallets('fake')`);
  const walletId = (
    await owner.query(
      `SELECT id FROM payments.live_wallets WHERE merchant_id = $1 AND owner_kind = 'merchant'`,
      [s.merchant_id],
    )
  ).rows[0].id as string;
  const accountNumber = account();
  await w1.query(`SELECT payments.record_wallet_created($1, $2, $3, $4, 'Races', 'Test Bank')`, [
    walletId,
    await tokenOf('live_wallets', walletId),
    `ref-${randomBytes(6).toString('hex')}`,
    accountNumber,
  ]);
  return {
    merchantId: s.merchant_id as string,
    walletId,
    accountNumber,
    session: await session(s.identity_id, 'merchant', membership),
  };
}

async function superAdmin() {
  const identityId = (
    await owner.query(
      `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
      [`race-admin-${randomBytes(6).toString('hex')}@example.test`],
    )
  ).rows[0].id as string;
  const membershipId = (
    await owner.query(
      `INSERT INTO identity.platform_memberships (identity_id, role) VALUES ($1, 'super_admin') RETURNING id`,
      [identityId],
    )
  ).rows[0].id as string;
  await owner.query(
    `INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id, confirmed_at)
     VALUES ($1, '\\x00', 'k1', now())`,
    [identityId],
  );
  return session(identityId, 'platform', membershipId);
}

/** A claim's token, staged here: the claims themselves are tested in payments.test.ts. */
const tokenOf = async (table: 'live_wallets' | 'provider_events', id: string) =>
  (
    await owner.query(
      `UPDATE payments.${table} SET lease_token = gen_random_uuid() WHERE id = $1 RETURNING lease_token`,
      [id],
    )
  ).rows[0].lease_token as string;
const store = async (c: pg.Client = a1) =>
  (await c.query(`SELECT payments.store_event('fake', '{}', '{}', NULL) AS id`)).rows[0].id as string;
const confirm =
  (eventId: string, tx: string, acct: string, amount = 10_000) =>
  async (c: pg.Client) =>
    c
      .query(
        `SELECT payments.record_event($1, $2, true, $3, $4, $5, 'NGN', 'successful', now(), 5) AS outcome`,
        [eventId, await tokenOf('provider_events', eventId), tx, acct, amount],
      )
      .then((r) => r.rows[0].outcome as string);
const balance = async (merchantId: string, code: string) =>
  Number(
    (
      await owner.query(
        `SELECT p.balance_minor::text AS b FROM ledger.accounts a JOIN ledger.balance_projection p ON p.account_id = a.id
          WHERE a.merchant_id = $1 AND a.code = $2 AND a.subject_id IS NULL`,
        [merchantId, code],
      )
    ).rows[0].b,
  );

describe('the payments races, staged (P9 §5; TA-8)', { timeout: 180_000 }, () => {
  it(`one provider transaction, two events at once — credited once (${RUNS} runs)`, async () => {
    const b = await business();
    for (let i = 0; i < RUNS; i++) {
      const tx = txId();
      const [e1, e2] = [await store(), await store()];
      const second = await race(confirm(e1, tx, b.accountNumber), confirm(e2, tx, b.accountNumber), [w1, w2]);
      expect(second).toBe('duplicate');
      expect(await balance(b.merchantId, '1100')).toBe((i + 1) * 10_000);
    }
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM payments.receipts WHERE merchant_id = $1`,
      [b.merchantId],
    );
    expect(rows[0].n).toBe(RUNS);
  });

  it(`one unmatched transaction, two events at once — recorded once (${RUNS} runs)`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const tx = txId();
      const acct = account();
      const [e1, e2] = [await store(), await store()];
      // The loser has not been compared with the winner: it is looked at again, and is a duplicate then.
      expect(await race(confirm(e1, tx, acct), confirm(e2, tx, acct), [w1, w2])).toBe('pending');
      expect(await confirm(e2, tx, acct)(w1)).toBe('duplicate');
      const { rows } = await owner.query(
        `SELECT count(*)::int AS n FROM payments.provider_transactions WHERE provider_tx_id = $1`,
        [tx],
      );
      expect(rows[0].n).toBe(1);
    }
  });

  it(`one unmatched transaction, two different answers at once — the contradiction is not lost (${RUNS} runs)`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const tx = txId();
      const acct = account();
      const [e1, e2] = [await store(), await store()];
      expect(await race(confirm(e1, tx, acct), confirm(e2, tx, acct, 20_000), [w1, w2])).toBe('pending');
      expect(await confirm(e2, tx, acct, 20_000)(w1)).toBe('review');
    }
  });

  it(`one receipt, classified twice at once — posted once (${RUNS} runs)`, async () => {
    const b = await business();
    const capital = (
      await owner.query(`SELECT id FROM ledger.accounts WHERE merchant_id = $1 AND code = '3000'`, [
        b.merchantId,
      ])
    ).rows[0].id as string;
    for (let i = 0; i < RUNS; i++) {
      await confirm(await store(), txId(), b.accountNumber)(w1);
      const receipt = (
        await owner.query(
          `SELECT id FROM payments.receipts WHERE merchant_id = $1 AND classified_at IS NULL LIMIT 1`,
          [b.merchantId],
        )
      ).rows[0].id as string;
      const classify = (c: pg.Client) =>
        c
          .query(`SELECT * FROM payments.classify_receipt($1, $2, $3)`, [b.session, receipt, capital])
          .then((r) => r.rows[0].outcome as string);
      expect(await race(classify, classify)).toBe('invalid_status');
      expect(await balance(b.merchantId, '3000')).toBe((i + 1) * 10_000);
    }
  });

  it(`one unmatched transaction, credited twice at once — posted once (${RUNS} runs)`, async () => {
    const b = await business();
    const admin = await superAdmin();
    for (let i = 0; i < RUNS; i++) {
      const tx = txId();
      await confirm(await store(), tx, account())(w1);
      const id = (
        await owner.query(`SELECT id FROM payments.provider_transactions WHERE provider_tx_id = $1`, [tx])
      ).rows[0].id as string;
      const resolve = (c: pg.Client) =>
        c
          .query(`SELECT * FROM payments.resolve_unmatched($1, $2, 'credited', $3, 'Traced')`, [
            admin,
            id,
            b.walletId,
          ])
          .then((r) => r.rows[0].outcome as string);
      expect(await race(resolve, resolve)).toBe('invalid_status');
      expect(await balance(b.merchantId, '1100')).toBe((i + 1) * 10_000);
    }
  });

  it(`one difference, found twice at once — one open finding (${RUNS} runs)`, async () => {
    const b = await business();
    const admin = await superAdmin();
    for (let i = 0; i < RUNS; i++) {
      const find = (c: pg.Client) =>
        c
          .query(`SELECT payments.record_finding('wallet', $1, 5, 0) AS o`, [b.walletId])
          .then((r) => r.rows[0].o as string);
      expect(await race(find, find, [w1, w2])).toBe('seen_again');
      const { rows } = await owner.query(
        `SELECT id FROM payments.reconciliation_findings WHERE wallet_id = $1 AND status = 'open'`,
        [b.walletId],
      );
      expect(rows).toHaveLength(1);
      await a1.query(`SELECT * FROM payments.resolve_finding($1, $2, 'Understood')`, [admin, rows[0].id]);
    }
  });
});
