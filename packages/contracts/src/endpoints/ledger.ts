import { z } from 'zod';
import {
  AmountMinor,
  ErrorResponse,
  Id,
  IdempotencyKeyHeader,
  Money,
  PageQuery,
  SignedMoney,
} from '../primitives.js';
import { defineEndpoint } from '../registry.js';
import { Timestamp } from './merchant.js';

// /v1/merchant/ledger and /v1/merchant/reports — the business's books (P6; docs/architecture/P6_IMPLEMENTATION_PLAN.md
// §3, §5). The business is the session's. Amounts are kobo strings (ADR-11). A balance is kept in the account's normal
// direction: debits − credits for assets and expenses, credits − debits for liabilities, capital and income. The two
// posting endpoints take an Idempotency-Key (TA-6): a retry with the same key and body gets the first answer; the same
// key with another body is refused.

/** A calendar date, YYYY-MM-DD. */
export const LedgerDate = z.iso
  .date()
  .meta({ id: 'LedgerDate', description: 'A calendar date (YYYY-MM-DD)' });

export const AccountType = z
  .enum(['asset', 'liability', 'equity', 'revenue', 'expense'])
  .meta({ id: 'AccountType', description: 'equity = capital; revenue = income' });
export type AccountType = z.infer<typeof AccountType>;

/** An account code: 4 to 6 digits (1000s assets, 2000s liabilities, 3000s capital, 4000s income, 5000s+ expenses). */
export const AccountCode = z
  .string()
  .regex(/^[0-9]{4,6}$/, 'must be 4 to 6 digits')
  .meta({ id: 'AccountCode', example: '6100' });

export const LedgerAccount = z
  .object({
    accountId: Id,
    code: AccountCode,
    name: z.string(),
    type: AccountType,
    status: z.enum(['active', 'archived']),
    /** A posting may never take this account below zero (customer savings, loans, cash). */
    nonNegative: z.boolean(),
    /** One of the chart's accounts, or a customer's or agent's sub-account of one; false for the business's own. */
    isSystem: z.boolean(),
    /** A sub-account's control account. */
    parentAccountId: Id.nullable(),
    /** Whose sub-account this is. */
    subject: z.object({ type: z.enum(['customer', 'agent']), id: Id }).nullable(),
    /** A control account's balance includes its sub-accounts'. */
    balance: SignedMoney,
    createdAt: Timestamp,
  })
  .meta({ id: 'LedgerAccount', description: 'An account of the business’s chart, with its balance' });
export type LedgerAccount = z.infer<typeof LedgerAccount>;

export const LedgerAccountList = z
  .object({ items: z.array(LedgerAccount) })
  .meta({ id: 'LedgerAccountList', description: 'The chart of accounts, by code' });
export type LedgerAccountList = z.infer<typeof LedgerAccountList>;

export const LedgerAccountsQuery = z.object({
  /** Also list every customer's and agent's sub-account. */
  includeSubaccounts: z.enum(['true', 'false']).default('false'),
});
export type LedgerAccountsQuery = z.infer<typeof LedgerAccountsQuery>;

export const CreateLedgerAccountRequest = z
  .object({ code: AccountCode, name: z.string().trim().min(1).max(120), type: AccountType })
  .meta({ id: 'CreateLedgerAccountRequest', description: 'A business’s own account (BR-9.1)' });
export type CreateLedgerAccountRequest = z.infer<typeof CreateLedgerAccountRequest>;

export const StatementQuery = PageQuery.extend({ from: LedgerDate, to: LedgerDate });
export type StatementQuery = z.infer<typeof StatementQuery>;

const Side = z.enum(['debit', 'credit']).meta({ id: 'Side' });

export const StatementLine = z.object({
  lineId: Id,
  entryId: Id,
  effectiveDate: LedgerDate,
  entryType: z.string(),
  narrative: z.string(),
  side: Side,
  amount: Money,
  /** The account's balance after this line. */
  balance: SignedMoney,
});

export const AccountStatement = z
  .object({
    account: LedgerAccount,
    from: LedgerDate,
    to: LedgerDate,
    items: z.array(StatementLine),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'AccountStatement', description: 'An account’s lines in a period, oldest first' });
export type AccountStatement = z.infer<typeof AccountStatement>;

export const JournalLine = z.object({
  lineId: Id,
  accountId: Id,
  accountCode: AccountCode,
  accountName: z.string(),
  side: Side,
  amount: Money,
});

export const JournalEntry = z
  .object({
    entryId: Id,
    effectiveDate: LedgerDate,
    /** 'manual', 'reversal', or the posting template, e.g. collection.cash_confirmed. */
    entryType: z.string(),
    narrative: z.string(),
    source: z.object({ type: z.string(), id: z.string() }).nullable(),
    reversesEntryId: Id.nullable(),
    reversedByEntryId: Id.nullable(),
    /** The identity that posted it; null for the system. */
    createdBy: Id.nullable(),
    createdAt: Timestamp,
    lines: z.array(JournalLine),
  })
  .meta({ id: 'JournalEntry', description: 'A journal entry and its lines; entries are never changed' });
export type JournalEntry = z.infer<typeof JournalEntry>;

const PositiveAmountMinor = AmountMinor.refine((v) => v !== '0', 'must be more than zero');

export const PostJournalEntryRequest = z
  .object({
    /** Today or earlier. */
    effectiveDate: LedgerDate,
    narrative: z.string().trim().min(1).max(500),
    lines: z
      .array(z.object({ accountId: Id, side: Side, amountMinor: PositiveAmountMinor }))
      .min(2)
      .max(200),
  })
  .meta({
    id: 'PostJournalEntryRequest',
    description: 'A manual journal entry: at least two lines, the debits equal to the credits',
  });
export type PostJournalEntryRequest = z.infer<typeof PostJournalEntryRequest>;

export const ReverseJournalEntryRequest = z
  .object({ narrative: z.string().trim().min(1).max(500).optional() })
  .meta({ id: 'ReverseJournalEntryRequest' });
export type ReverseJournalEntryRequest = z.infer<typeof ReverseJournalEntryRequest>;

export const JournalEntryPosted = z
  .object({ entryId: Id })
  .meta({ id: 'JournalEntryPosted', description: 'The entry posted (GET it for its lines)' });
export type JournalEntryPosted = z.infer<typeof JournalEntryPosted>;

const ReportAccount = z.object({ accountId: Id, code: AccountCode, name: z.string(), type: AccountType });

export const TrialBalance = z
  .object({
    asOf: LedgerDate,
    items: z.array(ReportAccount.extend({ debit: Money, credit: Money })),
    totalDebit: Money,
    totalCredit: Money,
  })
  .meta({
    id: 'TrialBalance',
    description: 'Each account’s balance at the end of a day; the two totals are equal',
  });
export type TrialBalance = z.infer<typeof TrialBalance>;

const ReportSection = z.object({
  items: z.array(ReportAccount.extend({ amount: SignedMoney })),
  total: SignedMoney,
});

export const BalanceSheet = z
  .object({
    asOf: LedgerDate,
    assets: ReportSection,
    liabilities: ReportSection,
    equity: ReportSection,
    /** Income less expenses to date, not yet closed into retained earnings. */
    currentEarnings: SignedMoney,
  })
  .meta({
    id: 'BalanceSheet',
    description: 'At the end of a day: assets = liabilities + equity + current earnings',
  });
export type BalanceSheet = z.infer<typeof BalanceSheet>;

export const ProfitAndLoss = z
  .object({
    from: LedgerDate,
    to: LedgerDate,
    revenue: ReportSection,
    expenses: ReportSection,
    netProfit: SignedMoney,
  })
  .meta({ id: 'ProfitAndLoss', description: 'Income and expenses in a period, both days included' });
export type ProfitAndLoss = z.infer<typeof ProfitAndLoss>;

export const AsOfQuery = z.object({ asOf: LedgerDate });
export type AsOfQuery = z.infer<typeof AsOfQuery>;
export const PeriodQuery = z.object({ from: LedgerDate, to: LedgerDate });
export type PeriodQuery = z.infer<typeof PeriodQuery>;

const error = (description: string) => ({ description, schema: ErrorResponse });
const forbidden = (permission: string) => ({
  403: error(`FORBIDDEN — the caller does not hold ${permission}`),
});
const read = {
  class: 'permission',
  permission: 'merchant.ledger.read',
  branchScope: 'merchant_wide',
} as const;
const post = {
  class: 'permission',
  permission: 'merchant.ledger.post',
  branchScope: 'merchant_wide',
} as const;
const idempotency = {
  409: error(
    'IDEMPOTENCY_KEY_REUSED — the key was used with another request; IDEMPOTENCY_IN_PROGRESS — the same request is still running; ALREADY_REVERSED (reversal)',
  ),
};

export const listLedgerAccounts = defineEndpoint({
  id: 'listLedgerAccounts',
  method: 'get',
  path: '/v1/merchant/ledger/accounts',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'The chart of accounts with balances',
  request: { query: LedgerAccountsQuery },
  responses: {
    200: { description: 'Every account, by code', schema: LedgerAccountList },
    ...forbidden('merchant.ledger.read'),
  },
});

export const createLedgerAccount = defineEndpoint({
  id: 'createLedgerAccount',
  method: 'post',
  path: '/v1/merchant/ledger/accounts',
  authorization: { class: 'permission', permission: 'merchant.ledger.manage', branchScope: 'merchant_wide' },
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Add the business’s own account to its chart (BR-9.1)',
  request: { body: CreateLedgerAccountRequest },
  responses: {
    201: { description: 'The account, with a zero balance', schema: LedgerAccount },
    ...forbidden('merchant.ledger.manage'),
    409: error('CODE_TAKEN — the chart already has an account with this code'),
  },
});

export const getAccountStatement = defineEndpoint({
  id: 'getAccountStatement',
  method: 'get',
  path: '/v1/merchant/ledger/accounts/{accountId}/statement',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'An account’s lines in a period, oldest first, with running balances',
  request: { params: z.object({ accountId: Id }), query: StatementQuery },
  responses: {
    200: { description: 'One page of the statement', schema: AccountStatement },
    400: error('VALIDATION_ERROR — an inverted period; INVALID_CURSOR'),
    ...forbidden('merchant.ledger.read'),
    404: error('NOT_FOUND — no such account in this business'),
  },
});

export const getJournalEntry = defineEndpoint({
  id: 'getJournalEntry',
  method: 'get',
  path: '/v1/merchant/ledger/entries/{entryId}',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'A journal entry and its lines',
  request: { params: z.object({ entryId: Id }) },
  responses: {
    200: { description: 'The entry', schema: JournalEntry },
    ...forbidden('merchant.ledger.read'),
    404: error('NOT_FOUND — no such entry in this business'),
  },
});

export const postJournalEntry = defineEndpoint({
  id: 'postJournalEntry',
  method: 'post',
  path: '/v1/merchant/ledger/entries',
  authorization: post,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Post a manual journal entry (recorded in the activity record)',
  request: { headers: IdempotencyKeyHeader, body: PostJournalEntryRequest },
  responses: {
    201: { description: 'Posted (or, for a retry, the first answer)', schema: JournalEntryPosted },
    400: error('VALIDATION_ERROR — a future date, or a malformed line'),
    ...forbidden('merchant.ledger.post'),
    ...idempotency,
    422: error(
      'UNBALANCED_ENTRY — the debits do not equal the credits; INSUFFICIENT_BALANCE — an account that may not go below zero would; ACCOUNT_NOT_POSTABLE — an unknown or archived account, or a control account (post to its sub-accounts)',
    ),
  },
});

export const reverseJournalEntry = defineEndpoint({
  id: 'reverseJournalEntry',
  method: 'post',
  path: '/v1/merchant/ledger/entries/{entryId}/reversal',
  authorization: post,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Reverse a manual journal entry: a new entry with every line’s side swapped (BR-11.1)',
  request: {
    params: z.object({ entryId: Id }),
    headers: IdempotencyKeyHeader,
    body: ReverseJournalEntryRequest,
  },
  responses: {
    201: { description: 'The reversal (or, for a retry, the first answer)', schema: JournalEntryPosted },
    ...forbidden('merchant.ledger.post'),
    404: error('NOT_FOUND — no such entry in this business'),
    ...idempotency,
    422: error(
      'NOT_REVERSIBLE — a reversal, or an entry posted by the system (reversed where it was made); INSUFFICIENT_BALANCE',
    ),
  },
});

export const getTrialBalance = defineEndpoint({
  id: 'getTrialBalance',
  method: 'get',
  path: '/v1/merchant/reports/trial-balance',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'The trial balance at the end of a day',
  request: { query: AsOfQuery },
  responses: {
    200: { description: 'Each account’s debit or credit balance', schema: TrialBalance },
    ...forbidden('merchant.ledger.read'),
  },
});

export const getBalanceSheet = defineEndpoint({
  id: 'getBalanceSheet',
  method: 'get',
  path: '/v1/merchant/reports/balance-sheet',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'The balance sheet at the end of a day',
  request: { query: AsOfQuery },
  responses: {
    200: { description: 'Assets, liabilities and equity', schema: BalanceSheet },
    ...forbidden('merchant.ledger.read'),
  },
});

export const getProfitAndLoss = defineEndpoint({
  id: 'getProfitAndLoss',
  method: 'get',
  path: '/v1/merchant/reports/profit-and-loss',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Profit and loss for a period, both days included',
  request: { query: PeriodQuery },
  responses: {
    200: { description: 'Income, expenses and the net profit', schema: ProfitAndLoss },
    400: error('VALIDATION_ERROR — an inverted period'),
    ...forbidden('merchant.ledger.read'),
  },
});
