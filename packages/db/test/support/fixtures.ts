// TEST-ONLY fixtures. Deterministic ids so failures are reproducible; loaded into a throwaway
// database by global-setup.ts. This is not seed data and must never be loaded into a real environment.

import type { Client } from 'pg';

// Fixed UUIDv7-shaped ids (version 7, variant 10), readable by their last digits.
export const MERCHANT_A = '01900000-0000-7000-8000-00000000000a';
export const MERCHANT_B = '01900000-0000-7000-8000-00000000000b';

export const FIXTURE = {
  A: {
    merchantId: MERCHANT_A,
    ledgerId: '01900000-0000-7000-8000-0000000000a1',
    cashAccountId: '01900000-0000-7000-8000-0000000000a2',
    savingsAccountId: '01900000-0000-7000-8000-0000000000a3',
    entryId: '01900000-0000-7000-8000-0000000000a4',
    auditEventId: '01900000-0000-7000-8000-0000000000a5',
    ownerIdentityId: '01900000-0000-7000-8000-0000000000a6',
    ownerMembershipId: '01900000-0000-7000-8000-0000000000a7',
    branchId: '01900000-0000-7000-8000-0000000000a8',
    roleId: '01900000-0000-7000-8000-0000000000a9',
  },
  B: {
    merchantId: MERCHANT_B,
    ledgerId: '01900000-0000-7000-8000-0000000000b1',
    cashAccountId: '01900000-0000-7000-8000-0000000000b2',
    savingsAccountId: '01900000-0000-7000-8000-0000000000b3',
    entryId: '01900000-0000-7000-8000-0000000000b4',
    auditEventId: '01900000-0000-7000-8000-0000000000b5',
    ownerIdentityId: '01900000-0000-7000-8000-0000000000b6',
    ownerMembershipId: '01900000-0000-7000-8000-0000000000b7',
    branchId: '01900000-0000-7000-8000-0000000000b8',
    roleId: '01900000-0000-7000-8000-0000000000b9',
  },
} as const;

/**
 * Insert two merchants, each with a ledger, two accounts, their balance projections, one balanced
 * journal entry (debit cash / credit customer savings, ₦500.00), one audit event, and an owner identity
 * with its owner membership (no password).
 * Runs in one transaction on the given connection (the table owner, so it works before and after RLS).
 */
export async function loadFixtures(db: Client): Promise<void> {
  await db.query('BEGIN');
  try {
    for (const [label, f] of Object.entries(FIXTURE)) {
      await db.query(`INSERT INTO tenancy.merchants (id, name, status) VALUES ($1, $2, 'active')`, [
        f.merchantId,
        `Fixture Merchant ${label}`,
      ]);
      await db.query(`INSERT INTO ledger.ledgers (id, merchant_id, currency) VALUES ($1, $2, 'NGN')`, [
        f.ledgerId,
        f.merchantId,
      ]);
      await db.query(
        `INSERT INTO ledger.accounts (id, merchant_id, ledger_id, code, name, type, is_system) VALUES
           ($1, $3, $4, '1200', 'Cash at business', 'asset', true),
           ($2, $3, $4, '2100', 'Customer collection savings', 'liability', true)`,
        [f.cashAccountId, f.savingsAccountId, f.merchantId, f.ledgerId],
      );
      await db.query(
        `INSERT INTO ledger.journal_entries (id, merchant_id, ledger_id, effective_date, entry_type, narrative, idempotency_key)
         VALUES ($1, $2, $3, DATE '2026-09-01', 'fixture', 'Fixture: cash collected into savings', $4)`,
        [f.entryId, f.merchantId, f.ledgerId, `fixture-${label}`],
      );
      await db.query(
        `INSERT INTO ledger.journal_lines (merchant_id, entry_id, account_id, side, amount_minor, currency) VALUES
           ($1, $2, $3, 'debit', 50000, 'NGN'),
           ($1, $2, $4, 'credit', 50000, 'NGN')`,
        [f.merchantId, f.entryId, f.cashAccountId, f.savingsAccountId],
      );
      await db.query(
        `INSERT INTO ledger.balance_projection (merchant_id, account_id, balance_minor, version) VALUES
           ($1, $2, 50000, 1), ($1, $3, 50000, 1)`,
        [f.merchantId, f.cashAccountId, f.savingsAccountId],
      );
      await db.query(
        `INSERT INTO audit.audit_events (id, merchant_id, action, outcome, summary)
         VALUES ($1, $2, 'fixture.loaded', 'success', '{"fixture": true}')`,
        [f.auditEventId, f.merchantId],
      );
      await db.query(
        `INSERT INTO identity.identities (id, email, status, email_verified_at) VALUES ($1, $2, 'active', now())`,
        [f.ownerIdentityId, `owner-${label.toLowerCase()}@example.test`],
      );
      await db.query(
        `INSERT INTO tenancy.merchant_memberships (id, merchant_id, identity_id, kind) VALUES ($1, $2, $3, 'owner')`,
        [f.ownerMembershipId, f.merchantId, f.ownerIdentityId],
      );
      await db.query(`INSERT INTO tenancy.branches (id, merchant_id, name) VALUES ($1, $2, 'Head office')`, [
        f.branchId,
        f.merchantId,
      ]);
      await db.query(`INSERT INTO tenancy.roles (id, merchant_id, name) VALUES ($1, $2, 'Cashier')`, [
        f.roleId,
        f.merchantId,
      ]);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}
