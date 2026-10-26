import { randomBytes } from 'node:crypto';
import type pg from 'pg';

// The ledger's resources for tests that call every endpoint of the registry (the authorization matrix, the policy
// test, the isolation matrix; P6): a business's cash and capital accounts and one entry, made as the table owner (the
// posting core, which no application role may execute), sample bodies for the ledger's commands, and the
// Idempotency-Key each posting command requires (TA-6).

export type LedgerResources = { accountId: string; capitalId: string; entryId: string };

export async function ledgerResources(owner: pg.Client, merchantId: string): Promise<LedgerResources> {
  const account = async (code: string) =>
    (
      await owner.query(
        `SELECT a.id FROM ledger.accounts a JOIN ledger.ledgers l ON l.id = a.ledger_id
          WHERE l.merchant_id = $1 AND a.code = $2 AND a.subject_id IS NULL`,
        [merchantId, code],
      )
    ).rows[0].id as string;
  const accountId = await account('1000');
  const capitalId = await account('3000');
  const { rows } = await owner.query(
    `SELECT p.outcome, p.entry_id
       FROM ledger.ledgers l,
            ledger.post_entry(l.id, $2, 'test', CURRENT_DATE, 'Fixture', NULL, NULL, $3::jsonb, NULL, NULL) p
      WHERE l.merchant_id = $1`,
    [
      merchantId,
      `fixture-${randomBytes(8).toString('hex')}`,
      JSON.stringify([
        { accountId, side: 'debit', amountMinor: '100000' },
        { accountId: capitalId, side: 'credit', amountMinor: '100000' },
      ]),
    ],
  );
  if (rows[0]?.outcome !== 'ok') throw new Error(`ledger fixture: ${String(rows[0]?.outcome)}`);
  return { accountId, capitalId, entryId: rows[0].entry_id as string };
}

/** Valid request bodies of the ledger's commands, addressed to the caller's own accounts. */
export const ledgerBodies = {
  createLedgerAccount: () => ({
    code: `9${String(randomBytes(3).readUIntBE(0, 3) % 100000).padStart(5, '0')}`,
    name: `Account ${randomBytes(3).toString('hex')}`,
    type: 'expense',
  }),
  postJournalEntry: (l: LedgerResources) => ({
    effectiveDate: new Date().toISOString().slice(0, 10),
    narrative: 'Matrix entry',
    lines: [
      { accountId: l.accountId, side: 'debit', amountMinor: '1' },
      { accountId: l.capitalId, side: 'credit', amountMinor: '1' },
    ],
  }),
  reverseJournalEntry: () => ({}),
  updateLedgerAccount: () => ({ name: `Account ${randomBytes(3).toString('hex')}` }),
};

/** The commands that take an Idempotency-Key: the ledger's postings (P6) and the savings' money moves (P8). */
const KEYED = new Set([
  'postJournalEntry',
  'reverseJournalEntry',
  'createWithdrawal',
  'createTargetTransfer',
  'recordCollection',
]);

/** The headers an endpoint requires before any check can answer it: a fresh Idempotency-Key on a posting command. */
export function requiredHeaders(id: string): Record<string, string> {
  return KEYED.has(id) ? { 'Idempotency-Key': `matrix-${randomBytes(8).toString('hex')}` } : {};
}

/** The business's ledger rows, for the snapshots that prove a refused call changed nothing. */
export const LEDGER_SNAPSHOT_SQL = `
  'accounts', (SELECT json_agg(a ORDER BY a.id) FROM ledger.accounts a WHERE a.merchant_id = $1),
  'entries', (SELECT count(*) FROM ledger.journal_entries e WHERE e.merchant_id = $1)`;
