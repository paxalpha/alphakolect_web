import { scopeOf, type TenantTx } from '../../platform/tenant.js';
import type { RequestContext } from '../../platform/request-context.js';

// The ledger module's scoped repository (P6; ADR-15 T13–T15, B1). The app holds no privilege on the ledger's tables
// (TA-3): every read and write here is a database function called with the caller's session, which takes the business
// from the session and decides the permission itself. Refusals are returned as outcomes, not raised (§8.2a).

export type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  status: 'active' | 'archived';
  non_negative: boolean;
  is_system: boolean;
  parent_account_id: string | null;
  subject_type: 'customer' | 'agent' | null;
  subject_id: string | null;
  balance_minor: string;
  created_at: Date;
};

export type StatementRow = {
  line_id: string;
  entry_id: string;
  effective_date: string;
  entry_type: string;
  narrative: string;
  side: 'debit' | 'credit';
  amount_minor: string;
  balance_minor: string;
};

export type EntryLineRow = {
  id: string;
  effective_date: string;
  entry_type: string;
  narrative: string;
  source_type: string | null;
  source_id: string | null;
  reverses_entry_id: string | null;
  reversed_by_entry_id: string | null;
  created_by: string | null;
  created_at: Date;
  line_id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  side: 'debit' | 'credit';
  amount_minor: string;
};

export type MovementRow = {
  account_id: string;
  code: string;
  name: string;
  type: AccountRow['type'];
  debit_minor: string;
  credit_minor: string;
};

export type CreateAccountOutcome = 'ok' | 'forbidden' | 'invalid' | 'code_taken';
export type CreatedAccount = { outcome: CreateAccountOutcome; id: string | null };
/** ledger.post_manual_entry / ledger.reverse_entry: their own refusals and ledger.post_entry's. */
export type PostingOutcome =
  | 'ok'
  | 'forbidden'
  | 'not_claimed'
  | 'invalid'
  | 'invalid_lines'
  | 'unbalanced'
  | 'unknown_account'
  | 'inactive_account'
  | 'control_account'
  | 'insufficient_balance'
  | 'already_reversed'
  | 'key_reused'
  | 'not_found'
  | 'not_reversible'
  | 'is_reversal';
export type Posting = { outcome: PostingOutcome; entry_id: string | null };

const ACCOUNT_COLUMNS = `id, code, name, type, status, non_negative, is_system, parent_account_id, subject_type,
              subject_id, balance_minor, created_at`;
// Dates as the database holds them (YYYY-MM-DD): pg would turn a date into a local-midnight Date.
const ENTRY_COLUMNS = `id, effective_date::text AS effective_date, entry_type, narrative, source_type, source_id,
              reverses_entry_id, reversed_by_entry_id, created_by, created_at, line_id, account_id, account_code,
              account_name, side, amount_minor`;

export const ledgerRepository = {
  /** ledger.list_accounts: the chart with balances; empty unless the session holds merchant.ledger.read. */
  async accounts(tx: TenantTx, includeSubaccounts: boolean): Promise<AccountRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM ledger.list_accounts($1, $2)`, [
      sessionId,
      includeSubaccounts,
    ]);
  },

  /** ledger.read_account: one account of the business, with its balance. */
  async account(tx: TenantTx, accountId: string): Promise<AccountRow | null> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM ledger.read_account($1, $2)`, [
      sessionId,
      accountId,
    ]);
    return row ?? null;
  },

  /** ledger.read_statement: up to `limit` lines of the period, after the position given (date, line). */
  async statement(
    tx: TenantTx,
    accountId: string,
    period: { from: string; to: string },
    limit: number,
    after: { date: string; lineId: string } | null,
  ): Promise<StatementRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<StatementRow>(
      `SELECT line_id, entry_id, effective_date::text AS effective_date, entry_type, narrative, side, amount_minor,
              balance_minor
         FROM ledger.read_statement($1, $2, $3::date, $4::date, $5, $6::date, $7)`,
      [sessionId, accountId, period.from, period.to, limit, after?.date ?? null, after?.lineId ?? null],
    );
  },

  /** ledger.read_entry: an entry of the business, one row per line. */
  async entry(tx: TenantTx, entryId: string): Promise<EntryLineRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<EntryLineRow>(`SELECT ${ENTRY_COLUMNS} FROM ledger.read_entry($1, $2)`, [
      sessionId,
      entryId,
    ]);
  },

  /** ledger.account_movements: each account's debits and credits in a period (from null: from the beginning). */
  async movements(tx: TenantTx, from: string | null, to: string): Promise<MovementRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<MovementRow>(
      `SELECT account_id, code, name, type, debit_minor, credit_minor
         FROM ledger.account_movements($1, $2::date, $3::date)`,
      [sessionId, from, to],
    );
  },

  /** ledger.create_account (BR-9.1): decided and recorded (pattern A) in the database. */
  async createAccount(
    tx: TenantTx,
    account: { code: string; name: string; type: string },
    ctx: RequestContext,
  ): Promise<CreatedAccount> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<CreatedAccount>(
      `SELECT outcome, id FROM ledger.create_account($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, account.code, account.name, account.type, ctx.ip, ctx.userAgent, ctx.requestId],
    );
    return row!;
  },

  /** ledger.post_manual_entry: the claim locked, the entry posted and recorded, the claim completed — or refused. */
  async postManualEntry(
    tx: TenantTx,
    claim: { key: string; fingerprint: string },
    entry: { effectiveDate: string; narrative: string; lines: unknown[] },
    ctx: RequestContext,
  ): Promise<Posting> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<Posting>(
      `SELECT outcome, entry_id FROM ledger.post_manual_entry($1, $2, $3, $4::date, $5, $6::jsonb, $7, $8, $9)`,
      [
        sessionId,
        claim.key,
        claim.fingerprint,
        entry.effectiveDate,
        entry.narrative,
        JSON.stringify(entry.lines),
        ctx.ip,
        ctx.userAgent,
        ctx.requestId,
      ],
    );
    return row!;
  },

  /** ledger.reverse_entry: a manual entry's reversal, under the same claim discipline. */
  async reverseEntry(
    tx: TenantTx,
    entryId: string,
    claim: { key: string; fingerprint: string },
    narrative: string | null,
    ctx: RequestContext,
  ): Promise<Posting> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<Posting>(
      `SELECT outcome, entry_id FROM ledger.reverse_entry($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sessionId, entryId, claim.key, claim.fingerprint, narrative, ctx.ip, ctx.userAgent, ctx.requestId],
    );
    return row!;
  },
} satisfies Record<string, (tx: TenantTx, ...args: never[]) => Promise<unknown>>;
