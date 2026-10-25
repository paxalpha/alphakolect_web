import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';
import { FIXTURE } from './support/fixtures.js';

// The ledger (P6; docs/architecture/P6_IMPLEMENTATION_PLAN.md §2–§6): ledgers opened with the owner's chart (TA-1,
// owner Q1), the one posting function (TA-3), reversal (TA-4), sub-accounts (TA-5), idempotency records (TA-6), every
// posting template (§4), the non-negative rule, the activity record of capital and income debits (owner Q4), the
// session commands and reads (§3.5, §5) and the properties of §6 over a random sequence of postings. The
// two-connection races are in ledger-races.test.ts. Commands and reads are called as the API calls them
// (alphakolect_app); the posting core, which no application role may execute, as the table owner.

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
const key = (tag = 'k') => `${tag}-${randomBytes(8).toString('hex')}`;
const today = () => new Date().toISOString().slice(0, 10);
const one = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0];

async function session(identityId: string, audience: string, membershipId: string) {
  const { rows } = await app.query(
    `SELECT * FROM identity.create_session($1, $2, $3, 'full', $4, 86400, 1209600, NULL, NULL)`,
    [identityId, audience, membershipId, hash()],
  );
  return rows[0].session_id as string;
}

/** An active business opened by signup, with its owner's session and its ledger. */
async function business() {
  const {
    rows: [s],
  } = await app.query(`SELECT * FROM identity.signup_merchant_owner($1, $2, $3)`, [
    email('owner'),
    ARGON,
    unique('Books'),
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
  const ledgerId = (await one(`SELECT id FROM ledger.ledgers WHERE merchant_id = $1`, [s.merchant_id]))
    .id as string;
  return {
    merchantId: s.merchant_id as string,
    identityId: s.identity_id as string,
    membershipId,
    ledgerId,
    session: await session(s.identity_id, 'merchant', membershipId),
  };
}
type Business = Awaited<ReturnType<typeof business>>;

/** A member of `b`: staff with a role holding exactly `permissions`, or an agent. */
async function member(b: Business, kind: 'staff' | 'agent', permissions: string[] = []) {
  const roleId =
    kind === 'staff'
      ? ((await one(`INSERT INTO tenancy.roles (merchant_id, name) VALUES ($1, $2) RETURNING id`, [
          b.merchantId,
          unique('Role'),
        ]).then((r) => r.id)) as string)
      : null;
  if (roleId && permissions.length) {
    const { rows } = await app.query(`SELECT outcome FROM tenancy.set_role_permissions($1, $2, $3)`, [
      b.session,
      roleId,
      permissions,
    ]);
    expect(rows[0].outcome).toBe('ok');
  }
  const identityId = (
    await one(
      `INSERT INTO identity.identities (email, email_verified_at, password_hash) VALUES ($1, now(), $2) RETURNING id`,
      [email(kind), ARGON],
    )
  ).id as string;
  const membershipId = (
    await one(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [b.merchantId, identityId, kind, roleId],
    )
  ).id as string;
  return {
    identityId,
    membershipId,
    session: kind === 'staff' ? await session(identityId, 'merchant', membershipId) : '',
  };
}

const account = async (ledgerId: string, code: string, subjectId: string | null = null) =>
  (
    await one(
      `SELECT id FROM ledger.accounts WHERE ledger_id = $1 AND code = $2 AND subject_id IS NOT DISTINCT FROM $3::uuid`,
      [ledgerId, code, subjectId],
    )
  )?.id as string;
const balance = async (accountId: string) =>
  BigInt(
    (
      await one(`SELECT balance_minor::text AS b FROM ledger.balance_projection WHERE account_id = $1`, [
        accountId,
      ])
    ).b,
  );
const subaccount = async (ledgerId: string, code: string, type: string, subjectId: string) => {
  const r = await one(`SELECT * FROM ledger.open_subaccount($1, $2, $3, $4)`, [
    ledgerId,
    code,
    type,
    subjectId,
  ]);
  return r as { outcome: string; account_id: string };
};

type Line = { accountId: string; side: 'debit' | 'credit'; amountMinor: string };
const post = async (
  ledgerId: string,
  lines: Line[],
  opts: { key?: string; reverses?: string; type?: string } = {},
) =>
  (await one(
    `SELECT * FROM ledger.post_entry($1, $2, $3, CURRENT_DATE, 'Test posting', NULL, NULL, $4, NULL, NULL, $5)`,
    [ledgerId, opts.key ?? key(), opts.type ?? 'test', JSON.stringify(lines), opts.reverses ?? null],
  )) as { outcome: string; entry_id: string | null };
const reverse = async (ledgerId: string, entryId: string, k = key()) =>
  (await one(`SELECT * FROM ledger.post_reversal($1, $2, $3, CURRENT_DATE, NULL, NULL, NULL)`, [
    ledgerId,
    entryId,
    k,
  ])) as { outcome: string; entry_id: string | null };
const template = async (ledgerId: string, code: string, amount: bigint, subjects: object, k = key()) =>
  (await one(
    `SELECT * FROM ledger.post_template($1, $2, $3, $4, $5, CURRENT_DATE, NULL, 'test', NULL, NULL, NULL)`,
    [ledgerId, code, amount.toString(), JSON.stringify(subjects), k],
  )) as { outcome: string; entry_id: string | null };

const NORMAL_DEBIT = new Set(['asset', 'expense']);
/** Give an account `amount` more balance in its normal direction, against share capital (3000). */
async function seed(ledgerId: string, accountId: string, amount: bigint) {
  const { type } = await one(`SELECT type FROM ledger.accounts WHERE id = $1`, [accountId]);
  const capital = await account(ledgerId, '3000');
  const debitNormal = NORMAL_DEBIT.has(type);
  const r = await post(ledgerId, [
    { accountId, side: debitNormal ? 'debit' : 'credit', amountMinor: amount.toString() },
    { accountId: capital, side: debitNormal ? 'credit' : 'debit', amountMinor: amount.toString() },
  ]);
  expect(r.outcome).toBe('ok');
}

describe('ledgers and the chart (TA-1, owner Q1)', () => {
  it('every business has one ledger with the 23 system accounts of the chart, each with its projection', async () => {
    const b = await business();
    const { rows } = await owner.query(
      `SELECT a.code, a.name, a.type, a.non_negative, a.is_system, p.balance_minor::text AS balance
         FROM ledger.accounts a JOIN ledger.balance_projection p ON p.account_id = a.id
        WHERE a.ledger_id = $1 ORDER BY a.code`,
      [b.ledgerId],
    );
    const chart = (
      await owner.query(
        `SELECT code, name, type, non_negative FROM ledger.chart_template WHERE ledger_kind = 'merchant' ORDER BY code`,
      )
    ).rows;
    expect(rows).toHaveLength(23);
    expect(rows.map(({ code, name, type, non_negative }) => ({ code, name, type, non_negative }))).toEqual(
      chart,
    );
    expect(rows.every((r) => r.is_system && r.balance === '0')).toBe(true);
  });

  it('a business is created only by signup, which opens its ledger', async () => {
    const { rows } = await owner.query(
      `SELECT n.nspname || '.' || p.proname AS fn, p.prosrc ~* 'ledger[.]open_ledger' AS opens
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+"?tenancy"?[[:space:]]*[.][[:space:]]*"?merchants'`,
    );
    expect(rows).toEqual([{ fn: 'identity.signup_merchant_owner', opens: true }]);
  });

  it('a business without a ledger — as every business before P6 — is given one by the migration’s backfill', async () => {
    await owner.query('BEGIN');
    try {
      const { id } = await one(`INSERT INTO tenancy.merchants (name) VALUES ('Before P6') RETURNING id`);
      // The migration's statement, as written in 20261023000100_ledger_core.
      await owner.query(`SELECT ledger.open_ledger('merchant', m.id) FROM tenancy.merchants m ORDER BY m.id`);
      const { n } = await one(
        `SELECT count(*)::int AS n FROM ledger.accounts a JOIN ledger.ledgers l ON l.id = a.ledger_id
          WHERE l.merchant_id = $1`,
        [id],
      );
      expect(n).toBe(23);
    } finally {
      await owner.query('ROLLBACK');
    }
  });

  it('there is exactly one platform ledger, with no business, and its own chart', async () => {
    const { rows } = await owner.query(
      `SELECT l.id, l.merchant_id, count(a.id)::int AS accounts
         FROM ledger.ledgers l LEFT JOIN ledger.accounts a ON a.ledger_id = l.id
        WHERE l.owner_kind = 'platform' GROUP BY l.id`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ merchant_id: null, accounts: 6 });
    await expectSqlState(
      owner.query(`INSERT INTO ledger.ledgers (owner_kind, merchant_id) VALUES ('platform', NULL)`),
      SQLSTATE.uniqueViolation,
    );
    await expectSqlState(
      owner.query(`INSERT INTO ledger.ledgers (owner_kind, merchant_id) VALUES ('merchant', NULL)`),
      SQLSTATE.checkViolation,
    );
  });

  it('opening a ledger again returns it unchanged (idempotent)', async () => {
    const b = await business();
    const again = await one(`SELECT ledger.open_ledger('merchant', $1) AS id`, [b.merchantId]);
    expect(again.id).toBe(b.ledgerId);
    const { n } = await one(`SELECT count(*)::int AS n FROM ledger.accounts WHERE ledger_id = $1`, [
      b.ledgerId,
    ]);
    expect(n).toBe(23);
  });

  it('every template names accounts of its own chart, with the right subject (checked at migration, here again)', async () => {
    const { rows } = await owner.query(`
      SELECT t.code FROM ledger.posting_templates t CROSS JOIN LATERAL jsonb_array_elements(t.lines) l
       WHERE NOT EXISTS (SELECT 1 FROM ledger.chart_template c
                          WHERE c.ledger_kind = t.ledger_kind AND c.code = l->>'code'
                            AND c.subject_type IS NOT DISTINCT FROM l->>'subject')`);
    expect(rows).toEqual([]);
  });
});

describe('sub-accounts (TA-5)', () => {
  it('a customer sub-account opens once: a second opening returns the same account', async () => {
    const b = await business();
    const customer = randomUUID();
    const first = await subaccount(b.ledgerId, '2100', 'customer', customer);
    const second = await subaccount(b.ledgerId, '2100', 'customer', customer);
    expect(first.outcome).toBe('ok');
    expect(second).toEqual(first);
    const row = await one(`SELECT * FROM ledger.accounts WHERE id = $1`, [first.account_id]);
    expect(row).toMatchObject({
      code: '2100',
      name: 'Customer savings',
      type: 'liability',
      non_negative: true,
    });
    expect(row.parent_account_id).toBe(await account(b.ledgerId, '2100'));
    expect(await balance(first.account_id)).toBe(0n);
  });

  it('only a control account has sub-accounts, of its own subject; an agent must be an agent of the business', async () => {
    const b = await business();
    expect((await subaccount(b.ledgerId, '1200', 'customer', randomUUID())).outcome).toBe(
      'not_a_control_account',
    );
    expect((await subaccount(b.ledgerId, '2100', 'agent', randomUUID())).outcome).toBe(
      'not_a_control_account',
    );
    expect((await subaccount(b.ledgerId, '1210', 'agent', randomUUID())).outcome).toBe('unknown_subject');
    const agent = await member(b, 'agent');
    expect((await subaccount(b.ledgerId, '1210', 'agent', agent.membershipId)).outcome).toBe('ok');
  });

  it('the unique key refuses a duplicate even when written directly (NULLS NOT DISTINCT)', async () => {
    const b = await business();
    await expectSqlState(
      owner.query(
        `INSERT INTO ledger.accounts (merchant_id, ledger_id, code, name, type) VALUES ($1, $2, '1000', 'Again', 'asset')`,
        [b.merchantId, b.ledgerId],
      ),
      SQLSTATE.uniqueViolation,
    );
  });
});

describe('the posting function (TA-3)', () => {
  let b: Business;
  let cash: string;
  let capital: string;
  let savings: string;
  beforeAll(async () => {
    b = await business();
    cash = await account(b.ledgerId, '1000');
    capital = await account(b.ledgerId, '3000');
    savings = (await subaccount(b.ledgerId, '2100', 'customer', randomUUID())).account_id;
  });

  it('posts a balanced entry and moves each projection in its normal direction', async () => {
    const before = [await balance(cash), await balance(capital)];
    const r = await post(b.ledgerId, [
      { accountId: cash, side: 'debit', amountMinor: '500000' },
      { accountId: capital, side: 'credit', amountMinor: '500000' },
    ]);
    expect(r.outcome).toBe('ok');
    expect(await balance(cash)).toBe(before[0]! + 500000n);
    expect(await balance(capital)).toBe(before[1]! + 500000n);
  });

  it('a replay returns the same entry and writes nothing; the key with other lines is refused', async () => {
    const k = key();
    const lines: Line[] = [
      { accountId: cash, side: 'debit', amountMinor: '100' },
      { accountId: capital, side: 'credit', amountMinor: '100' },
    ];
    const first = await post(b.ledgerId, lines, { key: k });
    const cashAfter = await balance(cash);
    const again = await post(b.ledgerId, [...lines].reverse(), { key: k });
    expect(again).toEqual({ outcome: 'replayed', entry_id: first.entry_id });
    expect(await balance(cash)).toBe(cashAfter);
    const other = await post(
      b.ledgerId,
      [
        { accountId: cash, side: 'debit', amountMinor: '101' },
        { accountId: capital, side: 'credit', amountMinor: '101' },
      ],
      { key: k },
    );
    expect(other).toEqual({ outcome: 'key_reused', entry_id: null });
  });

  it.each([
    ['one line', [{ side: 'debit', amountMinor: '5' }], 'invalid_lines'],
    [
      'a zero amount',
      [
        { side: 'debit', amountMinor: '0' },
        { side: 'credit', amountMinor: '0' },
      ],
      'invalid_lines',
    ],
    [
      'a negative amount',
      [
        { side: 'debit', amountMinor: '-5' },
        { side: 'credit', amountMinor: '-5' },
      ],
      'invalid_lines',
    ],
    [
      'an unknown side',
      [
        { side: 'up', amountMinor: '5' },
        { side: 'credit', amountMinor: '5' },
      ],
      'invalid_lines',
    ],
    [
      'a decimal amount',
      [
        { side: 'debit', amountMinor: '5.5' },
        { side: 'credit', amountMinor: '5.5' },
      ],
      'invalid_lines',
    ],
    [
      'unequal sides',
      [
        { side: 'debit', amountMinor: '5' },
        { side: 'credit', amountMinor: '4' },
      ],
      'unbalanced',
    ],
  ])('refuses %s, writing nothing', async (_label, shape, outcome) => {
    const accounts = [cash, capital];
    const lines = (shape as Array<{ side: string; amountMinor: string }>).map((l, i) => ({
      accountId: accounts[i]!,
      ...l,
    }));
    const { n: before } = await one(
      `SELECT count(*)::int AS n FROM ledger.journal_entries WHERE ledger_id = $1`,
      [b.ledgerId],
    );
    expect((await post(b.ledgerId, lines as Line[])).outcome).toBe(outcome);
    const { n: after } = await one(
      `SELECT count(*)::int AS n FROM ledger.journal_entries WHERE ledger_id = $1`,
      [b.ledgerId],
    );
    expect(after).toBe(before);
  });

  it("refuses another business's account, and a control account (its balance lives in its sub-accounts)", async () => {
    const elsewhere = await account((await business()).ledgerId, '1000');
    expect(
      (
        await post(b.ledgerId, [
          { accountId: elsewhere, side: 'debit', amountMinor: '5' },
          { accountId: capital, side: 'credit', amountMinor: '5' },
        ])
      ).outcome,
    ).toBe('unknown_account');
    expect(
      (
        await post(b.ledgerId, [
          { accountId: capital, side: 'debit', amountMinor: '5' },
          { accountId: await account(b.ledgerId, '2100'), side: 'credit', amountMinor: '5' },
        ])
      ).outcome,
    ).toBe('control_account');
  });

  it('refuses an archived account', async () => {
    const id = (
      await one(
        `INSERT INTO ledger.accounts (merchant_id, ledger_id, code, name, type, status, archived_at)
         VALUES ($1, $2, '6100', 'Old', 'expense', 'archived', now()) RETURNING id`,
        [b.merchantId, b.ledgerId],
      )
    ).id;
    await owner.query(`INSERT INTO ledger.balance_projection (account_id, merchant_id) VALUES ($1, $2)`, [
      id,
      b.merchantId,
    ]);
    expect(
      (
        await post(b.ledgerId, [
          { accountId: id, side: 'debit', amountMinor: '5' },
          { accountId: capital, side: 'credit', amountMinor: '5' },
        ])
      ).outcome,
    ).toBe('inactive_account');
  });

  it('the non-negative rule: a customer’s savings never go below zero (BR-7.4)', async () => {
    await seed(b.ledgerId, savings, 1000n);
    const office = await account(b.ledgerId, '1200');
    await seed(b.ledgerId, office, 5000n);
    const before = await balance(savings);
    const r = await post(b.ledgerId, [
      { accountId: savings, side: 'debit', amountMinor: (before + 1n).toString() },
      { accountId: office, side: 'credit', amountMinor: (before + 1n).toString() },
    ]);
    expect(r.outcome).toBe('insufficient_balance');
    expect(await balance(savings)).toBe(before);
    const exact = await post(b.ledgerId, [
      { accountId: savings, side: 'debit', amountMinor: before.toString() },
      { accountId: office, side: 'credit', amountMinor: before.toString() },
    ]);
    expect(exact.outcome).toBe('ok');
    expect(await balance(savings)).toBe(0n);
  });

  it('records every debit to a capital or an income account in the activity record (owner Q4)', async () => {
    const income = await account(b.ledgerId, '4400');
    await seed(b.ledgerId, income, 300n);
    const r = await post(b.ledgerId, [
      { accountId: capital, side: 'debit', amountMinor: '70' },
      { accountId: income, side: 'debit', amountMinor: '30' },
      { accountId: cash, side: 'credit', amountMinor: '100' },
    ]);
    expect(r.outcome).toBe('ok');
    const { rows } = await owner.query(
      `SELECT merchant_id, action, target_type, target_id, outcome, summary FROM audit.audit_events
        WHERE target_id = $1 ORDER BY action`,
      [r.entry_id],
    );
    expect(rows).toEqual([
      {
        merchant_id: b.merchantId,
        action: 'ledger.capital_debited',
        target_type: 'ledger_entry',
        target_id: r.entry_id,
        outcome: 'success',
        summary: {
          entryId: r.entry_id,
          entryType: 'test',
          accountId: capital,
          accountCode: '3000',
          amountMinor: '70',
        },
      },
      {
        merchant_id: b.merchantId,
        action: 'ledger.income_debited',
        target_type: 'ledger_entry',
        target_id: r.entry_id,
        outcome: 'success',
        summary: {
          entryId: r.entry_id,
          entryType: 'test',
          accountId: income,
          accountCode: '4400',
          amountMinor: '30',
        },
      },
    ]);
  });

  it('a credit to capital or income records nothing', async () => {
    const r = await post(b.ledgerId, [
      { accountId: cash, side: 'debit', amountMinor: '9' },
      { accountId: capital, side: 'credit', amountMinor: '9' },
    ]);
    const { n } = await one(`SELECT count(*)::int AS n FROM audit.audit_events WHERE target_id = $1`, [
      r.entry_id,
    ]);
    expect(n).toBe(0);
  });
});

// The coverage guard's tests of the two pairs the posting function writes (apps/api test/audit/coverage.test.ts lists
// them as covered here): each commits with its posting, and with its insert failing the posting fails and is absent.
// [coverage ledger.capital_debited/success] the row commits with the posting (the first test below, for 3000).
// [coverage ledger.capital_debited/success] the row's insert failing, the posting fails (the second, for 3000).
// [coverage ledger.income_debited/success] the row commits with the posting (the first test below, for 4400).
// [coverage ledger.income_debited/success] the row's insert failing, the posting fails (the second, for 4400).
describe.each([
  ['ledger.capital_debited', '3000'],
  ['ledger.income_debited', '4400'],
])('%s (owner Q4)', (action, code) => {
  const debit = async (b: Business) => {
    const debited = await account(b.ledgerId, code);
    await seed(b.ledgerId, debited, 100n);
    return post(b.ledgerId, [
      { accountId: debited, side: 'debit', amountMinor: '40' },
      { accountId: await account(b.ledgerId, '1000'), side: 'credit', amountMinor: '40' },
    ]);
  };
  const entriesOf = async (b: Business) =>
    (await one(`SELECT count(*)::int AS n FROM ledger.journal_entries WHERE ledger_id = $1`, [b.ledgerId]))
      .n as number;

  it(`${action}: one row, with its business, entry and account, commits with the posting`, async () => {
    const b = await business();
    await seed(b.ledgerId, await account(b.ledgerId, '1000'), 100n);
    const r = await debit(b);
    expect(r.outcome).toBe('ok');
    const { rows } = await owner.query(
      `SELECT merchant_id, target_id FROM audit.audit_events WHERE action = $1 AND target_id = $2`,
      [action, r.entry_id],
    );
    expect(rows).toEqual([{ merchant_id: b.merchantId, target_id: r.entry_id }]);
    expect(
      (await one(`SELECT count(*)::int AS n FROM ledger.journal_entries WHERE id = $1`, [r.entry_id])).n,
    ).toBe(1);
  });

  it(`${action}: with that pair's insert failing, the posting fails and is absent`, async () => {
    const b = await business();
    await seed(b.ledgerId, await account(b.ledgerId, '1000'), 100n);
    await seed(b.ledgerId, await account(b.ledgerId, code), 100n);
    const before = await entriesOf(b);
    const name = `test_fail_${randomBytes(6).toString('hex')}`;
    await owner.query(
      `CREATE FUNCTION audit.${name}() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN
         IF NEW.action = '${action}' AND NEW.merchant_id = '${b.merchantId}' THEN
           RAISE EXCEPTION 'injected audit storage failure' USING ERRCODE = 'XX000';
         END IF;
         RETURN NEW;
       END $fn$`,
    );
    await owner.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.${name}()`,
    );
    try {
      const debited = await account(b.ledgerId, code);
      await expectSqlState(
        post(b.ledgerId, [
          { accountId: debited, side: 'debit', amountMinor: '40' },
          { accountId: await account(b.ledgerId, '1000'), side: 'credit', amountMinor: '40' },
        ]),
        'XX000',
      );
    } finally {
      await owner.query(`DROP TRIGGER ${name} ON audit.audit_events`);
      await owner.query(`DROP FUNCTION audit.${name}()`);
    }
    expect(await entriesOf(b)).toBe(before);
  });
});

describe('reversal (TA-4, BR-11.1)', () => {
  let b: Business;
  let cash: string;
  let capital: string;
  beforeAll(async () => {
    b = await business();
    cash = await account(b.ledgerId, '1000');
    capital = await account(b.ledgerId, '3000');
  });
  const original = () =>
    post(b.ledgerId, [
      { accountId: cash, side: 'debit', amountMinor: '2500' },
      { accountId: capital, side: 'credit', amountMinor: '2500' },
    ]);

  it('mirrors the entry: every line, sides swapped, referencing it; the two net to zero', async () => {
    const before = [await balance(cash), await balance(capital)];
    const o = await original();
    const r = await reverse(b.ledgerId, o.entry_id!);
    expect(r.outcome).toBe('ok');
    expect([await balance(cash), await balance(capital)]).toEqual(before);
    const { rows } = await owner.query(
      `SELECT e.reverses_entry_id, e.entry_type, l.account_id, l.side, l.amount_minor::text AS amount
         FROM ledger.journal_entries e JOIN ledger.journal_lines l ON l.entry_id = e.id
        WHERE e.id = $1 ORDER BY l.side DESC`,
      [r.entry_id],
    );
    expect(rows).toEqual([
      {
        reverses_entry_id: o.entry_id,
        entry_type: 'reversal',
        account_id: capital,
        side: 'debit',
        amount: '2500',
      },
      {
        reverses_entry_id: o.entry_id,
        entry_type: 'reversal',
        account_id: cash,
        side: 'credit',
        amount: '2500',
      },
    ]);
  });

  it('an entry is reversed once; a reversal is never reversed; a replayed reversal returns the first', async () => {
    const o = await original();
    const k = key();
    const r = await reverse(b.ledgerId, o.entry_id!, k);
    expect(await reverse(b.ledgerId, o.entry_id!, k)).toEqual({ outcome: 'replayed', entry_id: r.entry_id });
    expect((await reverse(b.ledgerId, o.entry_id!)).outcome).toBe('already_reversed');
    expect((await reverse(b.ledgerId, r.entry_id!)).outcome).toBe('is_reversal');
    expect((await reverse(b.ledgerId, randomUUID())).outcome).toBe('not_found');
  });

  it('a reversal that would take a non-negative account below zero is refused', async () => {
    const savings = (await subaccount(b.ledgerId, '2100', 'customer', randomUUID())).account_id;
    const office = await account(b.ledgerId, '1200');
    const deposit = await post(b.ledgerId, [
      { accountId: office, side: 'debit', amountMinor: '400' },
      { accountId: savings, side: 'credit', amountMinor: '400' },
    ]);
    await post(b.ledgerId, [
      { accountId: savings, side: 'debit', amountMinor: '400' },
      { accountId: office, side: 'credit', amountMinor: '400' },
    ]);
    expect((await reverse(b.ledgerId, deposit.entry_id!)).outcome).toBe('insufficient_balance');
  });

  it('nothing is ever updated or deleted: the original stays, the correction is a reversal plus a new entry', async () => {
    const o = await original();
    await reverse(b.ledgerId, o.entry_id!);
    const { n } = await one(
      `SELECT count(*)::int AS n FROM ledger.journal_entries WHERE id = $1 OR reverses_entry_id = $1`,
      [o.entry_id],
    );
    expect(n).toBe(2);
    await expectSqlState(
      owner.query(`DELETE FROM ledger.journal_entries WHERE id = $1`, [o.entry_id]),
      SQLSTATE.restrictViolation,
    );
  });
});

describe('every posting template (§4) balances and moves the accounts it names', () => {
  it('each merchant template', async () => {
    const b = await business();
    const agent = await member(b, 'agent');
    const subjects = { customer: randomUUID(), agent: agent.membershipId };
    const templates = (
      await owner.query(
        `SELECT code, lines FROM ledger.posting_templates WHERE ledger_kind = 'merchant' AND status = 'active' ORDER BY code`,
      )
    ).rows as Array<{
      code: string;
      lines: Array<{ side: string; code: string; subject?: 'customer' | 'agent' }>;
    }>;
    expect(templates.length).toBe(28);
    for (const t of templates) {
      const amount = 12345n;
      // The accounts, opened (sub-accounts) and seeded where the template takes from them.
      const resolved: Array<{ id: string; side: string; type: string; nonNegative: boolean }> = [];
      for (const l of t.lines) {
        const id = l.subject
          ? (await subaccount(b.ledgerId, l.code, l.subject, subjects[l.subject])).account_id
          : await account(b.ledgerId, l.code);
        const a = await one(`SELECT type, non_negative FROM ledger.accounts WHERE id = $1`, [id]);
        resolved.push({ id, side: l.side, type: a.type, nonNegative: a.non_negative });
      }
      for (const r of resolved)
        if (r.nonNegative && (r.side === 'debit') !== NORMAL_DEBIT.has(r.type))
          await seed(b.ledgerId, r.id, amount);
      const before = new Map<string, bigint>();
      for (const r of resolved) before.set(r.id, await balance(r.id));
      const posted = await template(b.ledgerId, t.code, amount, subjects);
      expect(posted.outcome, t.code).toBe('ok');
      const expected = new Map<string, bigint>(before);
      for (const r of resolved)
        expected.set(
          r.id,
          expected.get(r.id)! + ((r.side === 'debit') === NORMAL_DEBIT.has(r.type) ? amount : -amount),
        );
      for (const [id, value] of expected) expect(await balance(id), `${t.code} ${id}`).toBe(value);
      const { d, c, n, type } = await one(
        `SELECT sum(l.amount_minor) FILTER (WHERE l.side = 'debit')::text AS d,
                sum(l.amount_minor) FILTER (WHERE l.side = 'credit')::text AS c, count(*)::int AS n,
                min(e.entry_type) AS type
           FROM ledger.journal_lines l JOIN ledger.journal_entries e ON e.id = l.entry_id WHERE e.id = $1`,
        [posted.entry_id],
      );
      expect({ d, c, n, type }, t.code).toEqual({
        d: (amount * BigInt(t.lines.filter((l) => l.side === 'debit').length)).toString(),
        c: (amount * BigInt(t.lines.filter((l) => l.side === 'credit').length)).toString(),
        n: t.lines.length,
        type: t.code,
      });
    }
  });

  it('the platform template posts to the platform ledger, whose rows carry no business', async () => {
    const { id: ledgerId } = await one(`SELECT id FROM ledger.ledgers WHERE owner_kind = 'platform'`);
    const r = await template(ledgerId, 'platform.subscription_received', 500000n, {});
    expect(r.outcome).toBe('ok');
    const { rows } = await owner.query(
      `SELECT DISTINCT merchant_id FROM ledger.journal_lines WHERE entry_id = $1
        UNION SELECT merchant_id FROM ledger.journal_entries WHERE id = $1`,
      [r.entry_id],
    );
    expect(rows).toEqual([{ merchant_id: null }]);
    // A business's template is not the platform's, and the reverse.
    expect((await template(ledgerId, 'collection.live', 1n, { customer: randomUUID() })).outcome).toBe(
      'unknown_template',
    );
  });

  it('refuses a missing sub-account, an unknown template and a non-positive amount', async () => {
    const b = await business();
    expect((await template(b.ledgerId, 'collection.live', 100n, { customer: randomUUID() })).outcome).toBe(
      'subaccount_missing',
    );
    expect((await template(b.ledgerId, 'collection.live', 100n, {})).outcome).toBe('subaccount_missing');
    expect((await template(b.ledgerId, 'no.such', 100n, {})).outcome).toBe('unknown_template');
    expect((await template(b.ledgerId, 'wallet.loaded', 0n, {})).outcome).toBe('invalid_amount');
  });
});

/** The reports a business sees, computed from ledger.account_movements as the API computes them. */
async function reports(s: string, from: string | null, to: string) {
  const { rows } = await app.query(`SELECT * FROM ledger.account_movements($1, $2, $3)`, [s, from, to]);
  const net = (r: { type: string; debit_minor: string; credit_minor: string }) =>
    NORMAL_DEBIT.has(r.type)
      ? BigInt(r.debit_minor) - BigInt(r.credit_minor)
      : BigInt(r.credit_minor) - BigInt(r.debit_minor);
  const sum = (type: string) => rows.filter((r) => r.type === type).reduce((acc, r) => acc + net(r), 0n);
  return {
    rows,
    debits: rows.reduce((acc, r) => acc + BigInt(r.debit_minor), 0n),
    credits: rows.reduce((acc, r) => acc + BigInt(r.credit_minor), 0n),
    assets: sum('asset'),
    liabilities: sum('liability'),
    equity: sum('equity'),
    profit: sum('revenue') - sum('expense'),
  };
}

describe('the properties (§6): many random runs of postings and reversals', () => {
  // Five seeded runs of 80 operations each (every template, at random, with random amounts, customers and reversals).
  // After every operation: the trial balance's columns are equal and the balance sheet balances. After every reversal:
  // the original and its reversal net to zero on every account. After each run: every entry balances, every projection
  // equals the sum of its lines, and no non-negative account is below zero.
  it.each([0x5eed, 0xbeef, 0xc0ffee, 0x1d1e, 0xfade])('seed %i', async (seedValue) => {
    const b = await business();
    const agent = await member(b, 'agent');
    let state = seedValue;
    const rand = (n: number) => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state % n;
    };
    const customers = [randomUUID(), randomUUID(), randomUUID()];
    for (const c of customers)
      for (const code of ['1300', '2100', '2110', '2120']) await subaccount(b.ledgerId, code, 'customer', c);
    await subaccount(b.ledgerId, '1210', 'agent', agent.membershipId);
    const codes = (
      await owner.query(
        `SELECT code FROM ledger.posting_templates WHERE ledger_kind = 'merchant' AND status = 'active' ORDER BY code`,
      )
    ).rows.map((r) => r.code as string);
    await seed(b.ledgerId, await account(b.ledgerId, '1000'), 10_000_000n);
    const posted: string[] = [];
    const outcomes = new Set<string>();
    for (let i = 0; i < 80; i++) {
      if (posted.length > 0 && rand(5) === 0) {
        const original = posted[rand(posted.length)]!;
        const r = await reverse(b.ledgerId, original);
        outcomes.add(r.outcome);
        expect(['ok', 'already_reversed', 'insufficient_balance']).toContain(r.outcome);
        if (r.outcome === 'ok') {
          const { rows: net } = await owner.query(
            `SELECT l.account_id FROM ledger.journal_lines l WHERE l.entry_id IN ($1, $2)
              GROUP BY l.account_id
             HAVING sum(CASE l.side WHEN 'debit' THEN l.amount_minor ELSE -l.amount_minor END) <> 0`,
            [original, r.entry_id],
          );
          expect(net, 'a reversal nets its original to zero').toEqual([]);
        }
      } else {
        const code = codes[rand(codes.length)]!;
        const r = await template(b.ledgerId, code, BigInt(1 + rand(50_000)), {
          customer: customers[rand(customers.length)],
          agent: agent.membershipId,
        });
        outcomes.add(r.outcome);
        expect(['ok', 'insufficient_balance']).toContain(r.outcome);
        if (r.outcome === 'ok') posted.push(r.entry_id!);
      }
      const r = await reports(b.session, null, today());
      expect(r.debits, `the trial balance after operation ${i}`).toBe(r.credits);
      expect(r.assets, `the balance sheet after operation ${i}`).toBe(r.liabilities + r.equity + r.profit);
    }
    expect(outcomes.has('ok')).toBe(true);

    const { rows: differences } = await owner.query(
      `SELECT * FROM ledger.verify_projections() WHERE merchant_id = $1`,
      [b.merchantId],
    );
    expect(differences).toEqual([]);
    const { rows: unbalanced } = await owner.query(
      `SELECT e.id FROM ledger.journal_entries e JOIN ledger.journal_lines l ON l.entry_id = e.id
        WHERE e.ledger_id = $1 GROUP BY e.id
       HAVING sum(l.amount_minor) FILTER (WHERE l.side = 'debit') <> sum(l.amount_minor) FILTER (WHERE l.side = 'credit')`,
      [b.ledgerId],
    );
    expect(unbalanced).toEqual([]);
    const { rows: negative } = await owner.query(
      `SELECT a.code FROM ledger.accounts a JOIN ledger.balance_projection p ON p.account_id = a.id
        WHERE a.ledger_id = $1 AND a.non_negative AND p.balance_minor < 0`,
      [b.ledgerId],
    );
    expect(negative).toEqual([]);
  });
});

describe('versioned posting templates (§4, revision 3)', () => {
  const inRollback = async (fn: () => Promise<void>) => {
    await owner.query('BEGIN');
    try {
      await fn();
    } finally {
      await owner.query('ROLLBACK');
    }
  };

  it('every template starts at version 1, active; an entry records the version it was posted with', async () => {
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n, min(version) AS lo, max(version) AS hi FROM ledger.posting_templates WHERE status = 'active'`,
    );
    expect(rows[0]).toEqual({ n: 29, lo: 1, hi: 1 });
    const b = await business();
    const r = await template(b.ledgerId, 'directors.funding', 500n, {});
    expect(
      await one(`SELECT entry_type, template_version FROM ledger.journal_entries WHERE id = $1`, [
        r.entry_id,
      ]),
    ).toEqual({ entry_type: 'directors.funding', template_version: 1 });
    const manual = await post(b.ledgerId, [
      { accountId: await account(b.ledgerId, '1000'), side: 'debit', amountMinor: '1' },
      { accountId: await account(b.ledgerId, '3000'), side: 'credit', amountMinor: '1' },
    ]);
    expect(
      (await one(`SELECT template_version FROM ledger.journal_entries WHERE id = $1`, [manual.entry_id]))
        .template_version,
    ).toBeNull();
  });

  it('a new mapping is a new version: the old one retired, later postings use the new one, earlier entries keep theirs', async () => {
    const b = await business();
    await template(b.ledgerId, 'directors.funding', 1000n, {});
    const v1 = await template(b.ledgerId, 'wallet.loaded', 100n, {});
    expect(v1.outcome).toBe('ok');
    await inRollback(async () => {
      await owner.query(
        `UPDATE ledger.posting_templates SET status = 'retired' WHERE code = 'wallet.loaded' AND version = 1`,
      );
      await owner.query(
        `INSERT INTO ledger.posting_templates (code, version, ledger_kind, description, lines)
         SELECT code, 2, ledger_kind, description || ' (v2)', lines FROM ledger.posting_templates
          WHERE code = 'wallet.loaded' AND version = 1`,
      );
      const v2 = await one(
        `SELECT * FROM ledger.post_template($1, 'wallet.loaded', 100, '{}', $2, CURRENT_DATE, NULL, 'test', NULL, NULL, NULL)`,
        [b.ledgerId, key()],
      );
      expect(v2.outcome).toBe('ok');
      expect(
        (await one(`SELECT template_version FROM ledger.journal_entries WHERE id = $1`, [v2.entry_id]))
          .template_version,
      ).toBe(2);
      expect(
        (await one(`SELECT template_version FROM ledger.journal_entries WHERE id = $1`, [v1.entry_id]))
          .template_version,
      ).toBe(1);
    });
  });

  it('a version never changes, is never deleted or re-activated, and one version of a code is active at a time', async () => {
    await inRollback(() =>
      expectSqlState(
        owner.query(
          `UPDATE ledger.posting_templates SET lines = '[]' WHERE code = 'wallet.loaded' AND version = 1`,
        ),
        SQLSTATE.restrictViolation,
      ).then(() => undefined),
    );
    await inRollback(() =>
      expectSqlState(
        owner.query(`DELETE FROM ledger.posting_templates WHERE code = 'wallet.loaded'`),
        SQLSTATE.restrictViolation,
      ).then(() => undefined),
    );
    await inRollback(() =>
      expectSqlState(
        owner.query(
          `INSERT INTO ledger.posting_templates (code, version, ledger_kind, description, lines)
           SELECT code, 2, ledger_kind, description, lines FROM ledger.posting_templates WHERE code = 'wallet.loaded'`,
        ),
        SQLSTATE.uniqueViolation,
      ).then(() => undefined),
    );
    await inRollback(async () => {
      await owner.query(
        `UPDATE ledger.posting_templates SET status = 'retired' WHERE code = 'wallet.loaded'`,
      );
      await expectSqlState(
        owner.query(`UPDATE ledger.posting_templates SET status = 'active' WHERE code = 'wallet.loaded'`),
        SQLSTATE.restrictViolation,
      );
    });
  });

  it('an entry can name only a version that exists', async () => {
    const b = await business();
    await inRollback(() =>
      expectSqlState(
        owner.query(
          `INSERT INTO ledger.journal_entries (merchant_id, ledger_id, effective_date, entry_type, narrative, idempotency_key, template_version)
           VALUES ($1, $2, CURRENT_DATE, 'wallet.loaded', 'x', $3, 7)`,
          [b.merchantId, b.ledgerId, key()],
        ),
        SQLSTATE.foreignKeyViolation,
      ).then(() => undefined),
    );
  });
});

describe('a business’s own account: renamed, archived, restored, never deleted (§3.1, BR-9.1)', () => {
  const update = (s: string, accountId: string, name: string | null, status: string | null) =>
    app
      .query(`SELECT * FROM ledger.update_account($1, $2, $3, $4, NULL, NULL, $5)`, [
        s,
        accountId,
        name,
        status,
        `lg-${randomBytes(6).toString('hex')}`,
      ])
      .then((r) => r.rows[0] as { outcome: string; id: string | null });
  const create = async (b: Business, code: string) =>
    (await app.query(`SELECT * FROM ledger.create_account($1, $2, 'Rent', 'expense')`, [b.session, code]))
      .rows[0].id as string;

  it('renamed and archived at a zero balance, recorded; then refused to postings; restored', async () => {
    const b = await business();
    const rent = await create(b, '6100');
    expect(await update(b.session, rent, 'Office rent', null)).toMatchObject({
      outcome: 'ok',
      id: rent,
      name: 'Office rent',
    });
    expect(await update(b.session, rent, null, 'archived')).toMatchObject({
      outcome: 'ok',
      id: rent,
      status: 'archived',
      balance_minor: '0',
    });
    expect(
      await one(
        `SELECT name, status, archived_at IS NOT NULL AS archived FROM ledger.accounts WHERE id = $1`,
        [rent],
      ),
    ).toEqual({
      name: 'Office rent',
      status: 'archived',
      archived: true,
    });
    const { rows } = await owner.query(
      `SELECT summary FROM audit.audit_events WHERE action = 'ledger.account_updated' AND target_id = $1 ORDER BY occurred_at, id`,
      [rent],
    );
    expect(rows.map((r) => r.summary)).toEqual([
      { name: 'Office rent', status: 'active' },
      { name: 'Office rent', status: 'archived' },
    ]);
    expect(
      (
        await post(b.ledgerId, [
          { accountId: rent, side: 'debit', amountMinor: '1' },
          { accountId: await account(b.ledgerId, '3000'), side: 'credit', amountMinor: '1' },
        ])
      ).outcome,
    ).toBe('inactive_account');
    expect(await update(b.session, rent, null, 'active')).toMatchObject({
      outcome: 'ok',
      id: rent,
      status: 'active',
    });
    expect(await one(`SELECT status, archived_at FROM ledger.accounts WHERE id = $1`, [rent])).toEqual({
      status: 'active',
      archived_at: null,
    });
  });

  it('refuses archiving an account with a balance, the chart’s accounts, another business’s, and an empty change', async () => {
    const b = await business();
    const rent = await create(b, '6100');
    await post(b.ledgerId, [
      { accountId: rent, side: 'debit', amountMinor: '5' },
      { accountId: await account(b.ledgerId, '3000'), side: 'credit', amountMinor: '5' },
    ]);
    expect((await update(b.session, rent, null, 'archived')).outcome).toBe('balance_not_zero');
    expect((await update(b.session, await account(b.ledgerId, '1000'), 'Bank', null)).outcome).toBe(
      'system_account',
    );
    const other = await business();
    expect((await update(other.session, rent, 'Mine', null)).outcome).toBe('not_found');
    expect((await update(b.session, rent, null, null)).outcome).toBe('invalid');
    expect((await update(b.session, rent, null, 'deleted')).outcome).toBe('invalid');
    const staff = await member(b, 'staff', ['merchant.ledger.read']);
    expect((await update(staff.session, rent, 'Nope', null)).outcome).toBe('forbidden');
  });
});

// ── the session commands and reads (§3.5, §5) ──

const claim = async (s: string, operation: string, k: string, fingerprint: string) =>
  (await app.query(`SELECT * FROM util.claim_idempotency($1, $2, $3, $4)`, [s, operation, k, fingerprint]))
    .rows[0] as { outcome: string; response: unknown };
const manual = async (s: string, k: string, fingerprint: string, lines: Line[], date = today()) =>
  (
    await app.query(
      `SELECT * FROM ledger.post_manual_entry($1, $2, $3, $4, 'Owner''s correction', $5, '203.0.113.8', 'ledger-test', $6)`,
      [s, k, fingerprint, date, JSON.stringify(lines), `lg-${randomBytes(6).toString('hex')}`],
    )
  ).rows[0] as { outcome: string; entry_id: string | null };

describe('idempotency records (TA-6)', () => {
  it('claimed, then a concurrent duplicate is in progress, another request is refused, a replay gets the response', async () => {
    const b = await business();
    const k = key();
    const fp = hash();
    expect(await claim(b.session, 'ledger.manual_entry', k, fp)).toEqual({
      outcome: 'claimed',
      response: null,
    });
    expect(await claim(b.session, 'ledger.manual_entry', k, fp)).toEqual({
      outcome: 'in_progress',
      response: null,
    });
    expect(await claim(b.session, 'ledger.manual_entry', k, hash())).toEqual({
      outcome: 'key_reused',
      response: null,
    });
    const cash = await account(b.ledgerId, '1000');
    const capital = await account(b.ledgerId, '3000');
    const r = await manual(b.session, k, fp, [
      { accountId: cash, side: 'debit', amountMinor: '100' },
      { accountId: capital, side: 'credit', amountMinor: '100' },
    ]);
    expect(r.outcome).toBe('ok');
    expect(await claim(b.session, 'ledger.manual_entry', k, fp)).toEqual({
      outcome: 'completed',
      response: { entryId: r.entry_id },
    });
    // The same key is the actor's own: another operation, or another member, claims it afresh.
    expect((await claim(b.session, 'ledger.entry_reversal', k, fp)).outcome).toBe('claimed');
  });

  it('a released claim may be claimed again; a completed one is never released', async () => {
    const b = await business();
    const k = key();
    const fp = hash();
    await claim(b.session, 'ledger.manual_entry', k, fp);
    const released = await app.query(`SELECT util.release_idempotency($1, $2, $3, $4) AS ok`, [
      b.session,
      'ledger.manual_entry',
      k,
      fp,
    ]);
    expect(released.rows[0].ok).toBe(true);
    expect((await claim(b.session, 'ledger.manual_entry', k, hash())).outcome).toBe('claimed');
  });

  it('a stale claim (a command that died) is taken over by the same request only', async () => {
    const b = await business();
    const k = key();
    const fp = hash();
    await claim(b.session, 'ledger.manual_entry', k, fp);
    await owner.query(
      `UPDATE util.idempotency_records SET claimed_at = now() - interval '3 minutes' WHERE idem_key = $1`,
      [k],
    );
    expect((await claim(b.session, 'ledger.manual_entry', k, hash())).outcome).toBe('key_reused');
    expect((await claim(b.session, 'ledger.manual_entry', k, fp)).outcome).toBe('claimed');
  });

  it('a command without its claim is refused, and writes nothing', async () => {
    const b = await business();
    const r = await manual(b.session, key(), hash(), [
      { accountId: await account(b.ledgerId, '1000'), side: 'debit', amountMinor: '1' },
      { accountId: await account(b.ledgerId, '3000'), side: 'credit', amountMinor: '1' },
    ]);
    expect(r).toEqual({ outcome: 'not_claimed', entry_id: null });
  });
});

describe('the session commands (§5; P6-3)', () => {
  it('a manual entry: posted under the derived key, recorded (#manual_entry_posted), the claim completed', async () => {
    const b = await business();
    const k = key();
    const fp = hash();
    await claim(b.session, 'ledger.manual_entry', k, fp);
    const cash = await account(b.ledgerId, '1000');
    const directors = await account(b.ledgerId, '2400');
    const r = await manual(b.session, k, fp, [
      { accountId: cash, side: 'debit', amountMinor: '250000' },
      { accountId: directors, side: 'credit', amountMinor: '250000' },
    ]);
    expect(r.outcome).toBe('ok');
    const entry = await one(`SELECT * FROM ledger.journal_entries WHERE id = $1`, [r.entry_id]);
    expect(entry).toMatchObject({
      entry_type: 'manual',
      idempotency_key: `manual:${b.identityId}:${k}`,
      created_by: b.identityId,
      narrative: "Owner's correction",
    });
    const event = await one(
      `SELECT actor_membership_id, action, summary FROM audit.audit_events WHERE action = 'ledger.manual_entry_posted' AND target_id = $1`,
      [r.entry_id],
    );
    expect(event).toEqual({
      actor_membership_id: b.membershipId,
      action: 'ledger.manual_entry_posted',
      summary: { entryId: r.entry_id, lineCount: 2, totalMinor: '250000', effectiveDate: today() },
    });
  });

  it('a refused posting writes nothing and leaves the claim in progress (the API releases it)', async () => {
    const b = await business();
    const k = key();
    const fp = hash();
    await claim(b.session, 'ledger.manual_entry', k, fp);
    const savings = (await subaccount(b.ledgerId, '2100', 'customer', randomUUID())).account_id;
    const r = await manual(b.session, k, fp, [
      { accountId: savings, side: 'debit', amountMinor: '1' },
      { accountId: await account(b.ledgerId, '1200'), side: 'credit', amountMinor: '1' },
    ]);
    expect(r).toEqual({ outcome: 'insufficient_balance', entry_id: null });
    expect((await one(`SELECT state FROM util.idempotency_records WHERE idem_key = $1`, [k])).state).toBe(
      'in_progress',
    );
    expect(
      (
        await manual(
          b.session,
          k,
          fp,
          [
            { accountId: savings, side: 'debit', amountMinor: '1' },
            { accountId: savings, side: 'credit', amountMinor: '1' },
          ],
          '2999-01-01',
        )
      ).outcome,
    ).toBe('invalid');
  });

  it('a reversal of a manual entry; an entry posted by a template is not reversed by hand', async () => {
    const b = await business();
    const k1 = key();
    const fp1 = hash();
    await claim(b.session, 'ledger.manual_entry', k1, fp1);
    const posted = await manual(b.session, k1, fp1, [
      { accountId: await account(b.ledgerId, '1000'), side: 'debit', amountMinor: '700' },
      { accountId: await account(b.ledgerId, '3000'), side: 'credit', amountMinor: '700' },
    ]);
    const reverseBy = async (entryId: string) => {
      const k = key();
      const fp = hash();
      await claim(b.session, 'ledger.entry_reversal', k, fp);
      return (
        await app.query(`SELECT * FROM ledger.reverse_entry($1, $2, $3, $4, NULL, NULL, NULL, $5)`, [
          b.session,
          entryId,
          k,
          fp,
          `lg-${randomBytes(6).toString('hex')}`,
        ])
      ).rows[0] as { outcome: string; entry_id: string | null };
    };
    const r = await reverseBy(posted.entry_id!);
    expect(r.outcome).toBe('ok');
    const event = await one(
      `SELECT summary FROM audit.audit_events WHERE action = 'ledger.entry_reversed' AND target_id = $1`,
      [posted.entry_id],
    );
    expect(event.summary).toEqual({ entryId: posted.entry_id, reversalId: r.entry_id });
    // TA-4 here too: once only, and never a reversal (it is not a manual entry).
    expect((await reverseBy(posted.entry_id!)).outcome).toBe('already_reversed');
    expect((await reverseBy(r.entry_id!)).outcome).toBe('not_reversible');
    const byTemplate = await template(b.ledgerId, 'directors.funding', 10n, {});
    expect((await reverseBy(byTemplate.entry_id!)).outcome).toBe('not_reversible');
    // Another business's entry does not exist here.
    expect((await reverseBy(FIXTURE.B.entryId)).outcome).toBe('not_found');
  });

  it('a merchant-defined account (BR-9.1): created, recorded, its code unique in the ledger', async () => {
    const b = await business();
    const create = (code: string, name = 'Rent', type = 'expense') =>
      app
        .query(`SELECT * FROM ledger.create_account($1, $2, $3, $4, NULL, NULL, $5)`, [
          b.session,
          code,
          name,
          type,
          `lg-${randomBytes(6).toString('hex')}`,
        ])
        .then((r) => r.rows[0] as { outcome: string; id: string | null });
    const r = await create('6100');
    expect(r.outcome).toBe('ok');
    expect(
      await one(`SELECT code, name, type, is_system, non_negative FROM ledger.accounts WHERE id = $1`, [
        r.id,
      ]),
    ).toEqual({
      code: '6100',
      name: 'Rent',
      type: 'expense',
      is_system: false,
      non_negative: false,
    });
    expect(await balance(r.id!)).toBe(0n);
    expect(
      (
        await one(
          `SELECT summary FROM audit.audit_events WHERE action = 'ledger.account_created' AND target_id = $1`,
          [r.id],
        )
      ).summary,
    ).toEqual({
      code: '6100',
      name: 'Rent',
      type: 'expense',
    });
    expect((await create('6100')).outcome).toBe('code_taken');
    expect((await create('1000')).outcome).toBe('code_taken');
    expect((await create('61')).outcome).toBe('invalid');
    expect((await create('6200', ' ')).outcome).toBe('invalid');
    expect((await create('6200', 'Thing', 'cash')).outcome).toBe('invalid');
  });

  it('each command and read requires its permission; a staff member holds only what the role grants', async () => {
    const b = await business();
    const reader = await member(b, 'staff', ['merchant.ledger.read']);
    const nobody = await member(b, 'staff', []);
    const poster = await member(b, 'staff', ['merchant.ledger.post', 'merchant.ledger.manage']);
    const create = async (s: string) =>
      (
        await app.query(`SELECT outcome FROM ledger.create_account($1, $2, 'Fuel', 'expense')`, [
          s,
          String(6000 + Math.floor(Math.random() * 999)),
        ])
      ).rows[0].outcome;
    expect(await create(reader.session)).toBe('forbidden');
    expect(await create(nobody.session)).toBe('forbidden');
    expect(await create(poster.session)).toBe('ok');
    const k = key();
    const fp = hash();
    await claim(reader.session, 'ledger.manual_entry', k, fp);
    expect(
      (
        await manual(reader.session, k, fp, [
          { accountId: await account(b.ledgerId, '1000'), side: 'debit', amountMinor: '1' },
          { accountId: await account(b.ledgerId, '3000'), side: 'credit', amountMinor: '1' },
        ])
      ).outcome,
    ).toBe('forbidden');
    const list = async (s: string) =>
      (await app.query(`SELECT * FROM ledger.list_accounts($1)`, [s])).rows.length;
    expect(await list(reader.session)).toBeGreaterThan(20);
    expect(await list(nobody.session)).toBe(0);
    expect(await list(poster.session)).toBe(0);
    expect(
      (await app.query(`SELECT * FROM ledger.account_movements($1, NULL, CURRENT_DATE)`, [nobody.session]))
        .rows,
    ).toEqual([]);
  });
});

describe('the reads (§3.5): the business from the session', () => {
  let b: Business;
  let customerSavings: string;
  let entryId: string;
  beforeAll(async () => {
    b = await business();
    const c1 = (await subaccount(b.ledgerId, '2100', 'customer', randomUUID())).account_id;
    const c2 = (await subaccount(b.ledgerId, '2100', 'customer', randomUUID())).account_id;
    customerSavings = c1;
    const office = await account(b.ledgerId, '1200');
    const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    for (const [acct, amount, date] of [
      [c1, '1000', day(10)],
      [c2, '500', day(9)],
      [c1, '250', day(5)],
    ] as const) {
      const r = await one(
        `SELECT * FROM ledger.post_entry($1, $2, 'test', $3::date, 'Deposit', NULL, NULL, $4, NULL, NULL)`,
        [
          b.ledgerId,
          key(),
          date,
          JSON.stringify([
            { accountId: office, side: 'debit', amountMinor: amount },
            { accountId: acct, side: 'credit', amountMinor: amount },
          ]),
        ],
      );
      entryId = r.entry_id;
    }
    await post(b.ledgerId, [
      { accountId: c1, side: 'debit', amountMinor: '100' },
      { accountId: await account(b.ledgerId, '4400'), side: 'credit', amountMinor: '100' },
    ]);
  });

  it('the chart with balances: a control account includes its sub-accounts; sub-accounts on request', async () => {
    const { rows } = await app.query(`SELECT * FROM ledger.list_accounts($1)`, [b.session]);
    expect(rows).toHaveLength(23);
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r.balance_minor]));
    expect(byCode).toMatchObject({ '1200': '1750', '2100': '1650', '4400': '100' });
    const all = (await app.query(`SELECT * FROM ledger.list_accounts($1, true)`, [b.session])).rows;
    expect(all).toHaveLength(25);
    expect(all.find((r) => r.id === customerSavings)).toMatchObject({
      subject_type: 'customer',
      balance_minor: '1150',
    });
    expect(
      (await app.query(`SELECT * FROM ledger.read_account($1, $2)`, [b.session, customerSavings])).rows[0],
    ).toMatchObject({ balance_minor: '1150' });
  });

  it('a control account’s statement covers its sub-accounts, with the period’s opening and closing balances', async () => {
    const control = await account(b.ledgerId, '2100');
    const { rows } = await app.query(
      `SELECT * FROM ledger.read_statement($1, $2, '2000-01-01', CURRENT_DATE, 10)`,
      [b.session, control],
    );
    expect(rows.map((r) => [r.side, r.amount_minor, r.balance_minor])).toEqual([
      ['credit', '1000', '1000'],
      ['credit', '500', '1500'],
      ['credit', '250', '1750'],
      ['debit', '100', '1650'],
    ]);
    expect(rows.every((r) => r.account_id !== control)).toBe(true);
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const period = (
      await app.query(`SELECT * FROM ledger.read_statement($1, $2, $3, CURRENT_DATE, 10)`, [
        b.session,
        control,
        from,
      ])
    ).rows;
    expect(period.map((r) => r.balance_minor)).toEqual(['1750', '1650']);
    const balances = async (accountId: string, f: string, t: string) =>
      (
        await app.query(`SELECT * FROM ledger.statement_balances($1, $2, $3, $4)`, [
          b.session,
          accountId,
          f,
          t,
        ])
      ).rows[0];
    expect(await balances(control, from, today())).toEqual({ opening_minor: '1500', closing_minor: '1650' });
    expect(await balances(customerSavings, from, today())).toEqual({
      opening_minor: '1000',
      closing_minor: '1150',
    });
    expect(await balances(customerSavings, '2000-01-01', '2000-12-31')).toEqual({
      opening_minor: '0',
      closing_minor: '0',
    });
  });

  it('a statement: the lines in date order with running balances, paginated', async () => {
    const all = (
      await app.query(`SELECT * FROM ledger.read_statement($1, $2, '2000-01-01', CURRENT_DATE, 10)`, [
        b.session,
        customerSavings,
      ])
    ).rows;
    expect(all.map((r) => [r.side, r.amount_minor, r.balance_minor])).toEqual([
      ['credit', '1000', '1000'],
      ['credit', '250', '1250'],
      ['debit', '100', '1150'],
    ]);
    const first = (
      await app.query(`SELECT * FROM ledger.read_statement($1, $2, '2000-01-01', CURRENT_DATE, 1)`, [
        b.session,
        customerSavings,
      ])
    ).rows;
    const next = (
      await app.query(`SELECT * FROM ledger.read_statement($1, $2, '2000-01-01', CURRENT_DATE, 5, $3, $4)`, [
        b.session,
        customerSavings,
        first[0].effective_date,
        first[0].line_id,
      ])
    ).rows;
    expect(next.map((r) => r.balance_minor)).toEqual(['1250', '1150']);
  });

  it('an entry with its lines; another business’s entry and account are not visible', async () => {
    const { rows } = await app.query(`SELECT * FROM ledger.read_entry($1, $2)`, [b.session, entryId]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: entryId, narrative: 'Deposit', reversed_by_entry_id: null });
    expect(
      (await app.query(`SELECT * FROM ledger.read_entry($1, $2)`, [b.session, FIXTURE.A.entryId])).rows,
    ).toEqual([]);
    expect(
      (await app.query(`SELECT * FROM ledger.read_account($1, $2)`, [b.session, FIXTURE.A.cashAccountId]))
        .rows,
    ).toEqual([]);
    expect(
      (
        await app.query(`SELECT * FROM ledger.read_statement($1, $2, '2000-01-01', CURRENT_DATE, 10)`, [
          b.session,
          FIXTURE.A.cashAccountId,
        ])
      ).rows,
    ).toEqual([]);
  });

  it('the trial balance, the balance sheet and the profit and loss balance', async () => {
    const r = await reports(b.session, null, today());
    expect(r.debits).toBe(r.credits);
    expect(r.assets).toBe(1750n);
    expect(r.liabilities).toBe(1650n);
    expect(r.profit).toBe(100n);
    expect(r.assets).toBe(r.liabilities + r.equity + r.profit);
    const period = await reports(b.session, today(), today());
    expect(period.profit).toBe(100n);
    const before = await reports(
      b.session,
      null,
      new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    );
    expect(before.assets).toBe(1500n);
  });
});
