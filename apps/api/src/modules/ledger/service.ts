import type {
  AccountStatement,
  BalanceSheet,
  CreateLedgerAccountRequest,
  JournalEntry,
  JournalEntryPosted,
  LedgerAccount,
  PostJournalEntryRequest,
  ProfitAndLoss,
  TrialBalance,
} from '@alphakolect/contracts';
import { refusalMessage } from '../../platform/authorization.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { fingerprintOf, inProgress, type Claim, type IdempotencyStore } from '../../platform/idempotency.js';
import { decodeCursor, encodeCursor } from '../../platform/pagination.js';
import type { RequestContext } from '../../platform/request-context.js';
import { withTenant, type TenantContext } from '../../platform/tenant.js';
import type { AuditLog } from '../audit/index.js';
import {
  ledgerRepository as repo,
  type AccountRow,
  type MovementRow,
  type Posting,
  type PostingOutcome,
} from './repository.js';

// The business's books (P6; docs/architecture/P6_IMPLEMENTATION_PLAN.md §3, §5). The business is the session's; who
// may read or post is decided by the router's policy middleware from the endpoint's permission, then again by each
// database function (B1). A posting command claims its Idempotency-Key first (TA-6, platform/idempotency.ts); the
// database function locks the claim, posts, records the entry in the activity record and completes the claim in one
// transaction (pattern A). A refused command releases its claim. The reports are computed here from each account's
// movements, read in one statement.

const NGN = 'NGN' as const;
const money = (amountMinor: string | bigint) => ({ amountMinor: amountMinor.toString(), currency: NGN });
const DEBIT_NORMAL: ReadonlySet<string> = new Set(['asset', 'expense']);

export const toAccount = (row: AccountRow): LedgerAccount => ({
  accountId: row.id,
  code: row.code,
  name: row.name,
  type: row.type,
  status: row.status,
  nonNegative: row.non_negative,
  isSystem: row.is_system,
  parentAccountId: row.parent_account_id,
  subject: row.subject_type && row.subject_id ? { type: row.subject_type, id: row.subject_id } : null,
  balance: money(row.balance_minor),
  createdAt: row.created_at.toISOString(),
});

/** An account's balance in its normal direction, from its period's debits and credits. */
const net = (m: MovementRow) =>
  DEBIT_NORMAL.has(m.type)
    ? BigInt(m.debit_minor) - BigInt(m.credit_minor)
    : BigInt(m.credit_minor) - BigInt(m.debit_minor);

function section(rows: MovementRow[], type: MovementRow['type']) {
  const items = rows
    .filter((r) => r.type === type)
    .map((r) => ({
      accountId: r.account_id,
      code: r.code,
      name: r.name,
      type: r.type,
      amount: money(net(r)),
    }));
  return { items, total: money(rows.filter((r) => r.type === type).reduce((sum, r) => sum + net(r), 0n)) };
}

const STATEMENT_DAY = /^(\d{4}-\d{2}-\d{2})T00:00:00\.000000Z$/;

/** The answer for each refusal of a posting command. */
function refusal(outcome: Exclude<PostingOutcome, 'ok' | 'forbidden'>): AppError {
  switch (outcome) {
    case 'not_claimed':
      return inProgress();
    case 'not_found':
      return new AppError(404, 'NOT_FOUND', 'Journal entry not found');
    case 'invalid':
    case 'invalid_lines':
      return new AppError(
        400,
        'VALIDATION_ERROR',
        'The entry is not valid: a future date, or a malformed line',
      );
    case 'unbalanced':
      return new AppError(422, 'UNBALANCED_ENTRY', 'The debits must equal the credits');
    case 'insufficient_balance':
      return new AppError(422, 'INSUFFICIENT_BALANCE', 'An account that may not go below zero would');
    case 'unknown_account':
    case 'inactive_account':
    case 'control_account':
      return new AppError(
        422,
        'ACCOUNT_NOT_POSTABLE',
        'Each line must name an active account of this business that is not a control account',
      );
    case 'already_reversed':
      return new AppError(409, 'ALREADY_REVERSED', 'This entry has already been reversed');
    case 'not_reversible':
    case 'is_reversal':
      return new AppError(
        422,
        'NOT_REVERSIBLE',
        'Only a manual entry can be reversed here; a reversal is never reversed',
      );
    case 'key_reused':
      return new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used');
  }
}

export class LedgerService {
  constructor(
    private readonly deps: {
      db: Db;
      audit: Pick<AuditLog, 'recordBestEffort'>;
      idempotency: IdempotencyStore;
    },
  ) {}

  async accounts(tenant: TenantContext, includeSubaccounts: boolean): Promise<LedgerAccount[]> {
    const rows = await withTenant(this.deps.db, tenant, (tx) => repo.accounts(tx, includeSubaccounts));
    return rows.map(toAccount);
  }

  async createAccount(
    tenant: TenantContext,
    account: CreateLedgerAccountRequest,
    ctx: RequestContext,
  ): Promise<LedgerAccount> {
    const result = await withTenant(this.deps.db, tenant, async (tx) => {
      const created = await repo.createAccount(tx, account, ctx);
      return { ...created, row: created.outcome === 'ok' ? await repo.account(tx, created.id!) : null };
    });
    switch (result.outcome) {
      case 'ok':
        // Read back in the same transaction; a session that may add accounts but not read the books gets the
        // account as created: the business's own, active, with a zero balance.
        return toAccount(
          result.row ?? {
            id: result.id!,
            code: account.code,
            name: account.name,
            type: account.type,
            status: 'active',
            non_negative: false,
            is_system: false,
            parent_account_id: null,
            subject_type: null,
            subject_id: null,
            balance_minor: '0',
            created_at: new Date(),
          },
        );
      case 'code_taken':
        throw new AppError(409, 'CODE_TAKEN', 'The chart already has an account with this code');
      case 'invalid':
        throw new AppError(400, 'VALIDATION_ERROR', 'The account is not valid');
      case 'forbidden':
        await this.denied(tenant, 'ledger.account_created', 'ledger_account', null, ctx);
        throw new AppError(403, 'FORBIDDEN', refusalMessage('merchant.ledger.manage'));
    }
  }

  async statement(
    tenant: TenantContext,
    accountId: string,
    query: { from: string; to: string; limit: number; cursor?: string | undefined },
  ): Promise<AccountStatement> {
    if (query.from > query.to)
      throw new AppError(400, 'VALIDATION_ERROR', 'The period ends before it starts', {
        issues: [{ path: 'query.to', message: 'must not be before from' }],
      });
    const scope = `getAccountStatement|${accountId}|${query.from}|${query.to}`;
    const position = decodeCursor(query.cursor, scope);
    const after = position ? { date: STATEMENT_DAY.exec(position.at)?.[1] ?? '', lineId: position.id } : null;
    if (after && !after.date)
      throw new AppError(400, 'INVALID_CURSOR', 'This cursor does not belong to this list');
    const { account, rows } = await withTenant(this.deps.db, tenant, async (tx) => ({
      account: await repo.account(tx, accountId),
      rows: await repo.statement(tx, accountId, query, query.limit + 1, after),
    }));
    if (!account) throw new AppError(404, 'NOT_FOUND', 'Account not found');
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      account: toAccount(account),
      from: query.from,
      to: query.to,
      items: items.map((r) => ({
        lineId: r.line_id,
        entryId: r.entry_id,
        effectiveDate: r.effective_date,
        entryType: r.entry_type,
        narrative: r.narrative,
        side: r.side,
        amount: money(r.amount_minor),
        balance: money(r.balance_minor),
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ at: `${last.effective_date}T00:00:00.000000Z`, id: last.line_id }, scope)
          : null,
    };
  }

  async entry(tenant: TenantContext, entryId: string): Promise<JournalEntry> {
    const rows = await withTenant(this.deps.db, tenant, (tx) => repo.entry(tx, entryId));
    const first = rows[0];
    if (!first) throw new AppError(404, 'NOT_FOUND', 'Journal entry not found');
    return {
      entryId: first.id,
      effectiveDate: first.effective_date,
      entryType: first.entry_type,
      narrative: first.narrative,
      source: first.source_type && first.source_id ? { type: first.source_type, id: first.source_id } : null,
      reversesEntryId: first.reverses_entry_id,
      reversedByEntryId: first.reversed_by_entry_id,
      createdBy: first.created_by,
      createdAt: first.created_at.toISOString(),
      lines: rows.map((r) => ({
        lineId: r.line_id,
        accountId: r.account_id,
        accountCode: r.account_code,
        accountName: r.account_name,
        side: r.side,
        amount: money(r.amount_minor),
      })),
    };
  }

  async trialBalance(tenant: TenantContext, asOf: string): Promise<TrialBalance> {
    const rows = await withTenant(this.deps.db, tenant, (tx) => repo.movements(tx, null, asOf));
    const items = rows.map((r) => {
      // A debit balance in the debit column, a credit balance in the credit column, whatever the account's type.
      const debitBalance = BigInt(r.debit_minor) - BigInt(r.credit_minor);
      return {
        accountId: r.account_id,
        code: r.code,
        name: r.name,
        type: r.type,
        debit: money(debitBalance > 0n ? debitBalance : 0n),
        credit: money(debitBalance < 0n ? -debitBalance : 0n),
      };
    });
    const total = (side: 'debit' | 'credit') =>
      money(items.reduce((sum, i) => sum + BigInt(i[side].amountMinor), 0n));
    return { asOf, items, totalDebit: total('debit'), totalCredit: total('credit') };
  }

  async balanceSheet(tenant: TenantContext, asOf: string): Promise<BalanceSheet> {
    const rows = await withTenant(this.deps.db, tenant, (tx) => repo.movements(tx, null, asOf));
    const earnings =
      BigInt(section(rows, 'revenue').total.amountMinor) - BigInt(section(rows, 'expense').total.amountMinor);
    return {
      asOf,
      assets: section(rows, 'asset'),
      liabilities: section(rows, 'liability'),
      equity: section(rows, 'equity'),
      currentEarnings: money(earnings),
    };
  }

  async profitAndLoss(tenant: TenantContext, from: string, to: string): Promise<ProfitAndLoss> {
    if (from > to)
      throw new AppError(400, 'VALIDATION_ERROR', 'The period ends before it starts', {
        issues: [{ path: 'query.to', message: 'must not be before from' }],
      });
    const rows = await withTenant(this.deps.db, tenant, (tx) => repo.movements(tx, from, to));
    const revenue = section(rows, 'revenue');
    const expenses = section(rows, 'expense');
    return {
      from,
      to,
      revenue,
      expenses,
      netProfit: money(BigInt(revenue.total.amountMinor) - BigInt(expenses.total.amountMinor)),
    };
  }

  /** A manual journal entry, idempotent by its key (TA-6). */
  async postEntry(
    tenant: TenantContext,
    key: string,
    entry: PostJournalEntryRequest,
    ctx: RequestContext,
  ): Promise<JournalEntryPosted> {
    const claim: Claim = {
      operation: 'ledger.manual_entry',
      key,
      fingerprint: fingerprintOf('ledger.manual_entry', null, entry),
    };
    return this.idempotent(tenant, claim, 'ledger.manual_entry_posted', null, ctx, () =>
      withTenant(this.deps.db, tenant, (tx) => repo.postManualEntry(tx, claim, entry, ctx)),
    );
  }

  /** A manual entry's reversal, idempotent by its key (TA-4, TA-6, BR-11.1). */
  async reverseEntry(
    tenant: TenantContext,
    key: string,
    entryId: string,
    narrative: string | null,
    ctx: RequestContext,
  ): Promise<JournalEntryPosted> {
    const claim: Claim = {
      operation: 'ledger.entry_reversal',
      key,
      fingerprint: fingerprintOf('ledger.entry_reversal', entryId, { narrative }),
    };
    return this.idempotent(tenant, claim, 'ledger.entry_reversed', entryId, ctx, () =>
      withTenant(this.deps.db, tenant, (tx) => repo.reverseEntry(tx, entryId, claim, narrative, ctx)),
    );
  }

  private async idempotent(
    tenant: TenantContext,
    claim: Claim,
    action: 'ledger.manual_entry_posted' | 'ledger.entry_reversed',
    targetId: string | null,
    ctx: RequestContext,
    command: () => Promise<Posting>,
  ): Promise<JournalEntryPosted> {
    const stored = await this.deps.idempotency.claim(tenant.sessionId, claim);
    if (stored) return { entryId: String(stored.entryId) };
    let result: Posting;
    try {
      result = await command();
    } catch (err) {
      await this.deps.idempotency.release(tenant.sessionId, claim);
      throw err;
    }
    if (result.outcome === 'ok') return { entryId: result.entry_id! };
    await this.deps.idempotency.release(tenant.sessionId, claim);
    if (result.outcome === 'forbidden') {
      await this.denied(tenant, action, 'ledger_entry', targetId, ctx);
      throw new AppError(403, 'FORBIDDEN', refusalMessage('merchant.ledger.post'));
    }
    throw refusal(result.outcome);
  }

  /** A refusal by the database alone (a permission withdrawn between the two checks), recorded best effort. */
  private denied(
    tenant: TenantContext,
    action: 'ledger.account_created' | 'ledger.manual_entry_posted' | 'ledger.entry_reversed',
    targetType: string,
    targetId: string | null,
    ctx: RequestContext,
  ) {
    return this.deps.audit.recordBestEffort({
      action,
      outcome: 'denied',
      merchantId: tenant.merchantId,
      actorIdentityId: tenant.identityId,
      actorAudience: tenant.audience,
      actorMembershipId: tenant.membershipId,
      targetType,
      targetId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      summary: { reason: 'forbidden' },
    });
  }
}
