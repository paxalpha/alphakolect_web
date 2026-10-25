import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// Permission descriptions (P5.6; O13). The catalog holds the wording the owner approved word for word on 2026-10-14
// (docs/business/P5_OWNER_REMAINING_QUESTIONS.md, A1): it is what business owners read when they choose what a role may
// do. A change to any line is a change to an owner decision, so this test pins every one.

let owner: pg.Client;
beforeAll(async () => {
  owner = await connectAs('migrator');
});
afterAll(() => owner.end());

const APPROVED: Record<string, string> = {
  'merchant.profile.read': "See the business's name and whether it is active.",
  'merchant.profile.update': "Change the business's name.",
  'merchant.branches.read': 'See the list of branches, including archived ones.',
  'merchant.branches.manage': 'Add branches, rename them, and archive or restore them.',
  'merchant.roles.read': 'See the roles and the permissions each role has.',
  'merchant.members.read':
    "See the business's members, with their email address, type (owner, staff or agent), role, branch and whether they are active.",
  'merchant.invitations.read':
    'See the invitations sent, with the invited email address and whether each is pending, accepted, cancelled or expired.',
  'merchant.roles.manage':
    "Create, rename, archive and restore roles, and choose each role's permissions. Owner only.",
  'merchant.members.manage':
    "Change a member's role or branch, and deactivate or reactivate members. Owner only.",
  'merchant.invitations.manage': 'Invite new staff and agents, and cancel invitations. Owner only.',
  'merchant.audit.read':
    'See everything that happened in the business, including refused attempts. Owner only.',
  // P6: the books' permissions — approved by the owner as written on 2026-10-23
  // (docs/business/P6_OWNER_LEDGER_PERMISSIONS.md, Q1; Q2: all three grantable to staff)
  'merchant.ledger.read':
    'See the accounts and their balances, account statements, journal entries and the financial reports.',
  'merchant.ledger.manage': "Add the business's own accounts to its chart of accounts.",
  'merchant.ledger.post': 'Post manual journal entries, and reverse them.',
  // P7: the customers' permissions — approved by the owner as written on 2026-10-25
  // (docs/business/P7_OWNER_CUSTOMER_PERMISSIONS.md)
  'merchant.customers.read':
    "See the business's customers, with their phone number, email, address and agent.",
  'merchant.customers.manage':
    'Add customers, change their details or branch, deactivate or reactivate them, and send them the link to the mobile app.',
  'merchant.customers.assign':
    'Give a customer to an agent, move them to another agent, or take them off their agent.',
  'merchant.customers.anonymise':
    "Remove a customer's personal details at their request, once they have nothing left with the business. Owner only.",
};

describe('the merchant permission descriptions (O13)', () => {
  it('are exactly the wording the owner approved, for every merchant permission', async () => {
    const { rows } = await owner.query(
      `SELECT identifier, description FROM identity.permission_catalog WHERE scope = 'merchant' ORDER BY identifier`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.identifier, r.description]))).toEqual(APPROVED);
  });

  it('every owner-only permission says so, and no grantable one does', async () => {
    const { rows } = await owner.query(
      `SELECT identifier, grantable, description FROM identity.permission_catalog WHERE scope = 'merchant'`,
    );
    for (const r of rows) expect(r.description.endsWith('Owner only.'), r.identifier).toBe(!r.grantable);
  });

  it('a merchant permission cannot be added without one, and the platform ones have none yet', async () => {
    await owner.query('BEGIN');
    try {
      await expectSqlState(
        owner.query(
          `INSERT INTO identity.permission_catalog (identifier, scope, grantable) VALUES ('merchant.test.undescribed', 'merchant', true)`,
        ),
        SQLSTATE.checkViolation,
      );
    } finally {
      await owner.query('ROLLBACK');
    }
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM identity.permission_catalog WHERE scope = 'platform' AND description IS NOT NULL`,
    );
    expect(rows[0].n).toBe(0);
  });
});
