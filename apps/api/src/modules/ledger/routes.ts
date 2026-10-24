import type {
  AccountStatement,
  AsOfQuery,
  BalanceSheet,
  CreateLedgerAccountRequest,
  JournalEntry,
  JournalEntryPosted,
  LedgerAccount,
  LedgerAccountList,
  LedgerAccountsQuery,
  PeriodQuery,
  PostJournalEntryRequest,
  ProfitAndLoss,
  ReverseJournalEntryRequest,
  StatementQuery,
  TrialBalance,
} from '@alphakolect/contracts';
import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../platform/request-context.js';
import { tenantContextOf } from '../../platform/tenant.js';
import type { LedgerService } from './service.js';

// /v1/merchant/ledger and /v1/merchant/reports (contracts: packages/contracts/src/endpoints/ledger.ts). The merchant
// session is already authenticated and re-validated, its permission checked by the policy middleware; path
// parameters, queries, headers and bodies are already validated against the contract.

const contextOf = (req: Request): RequestContext => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
  requestId: String(req.id),
});

export function ledgerHandlers({ books }: { books: LedgerService }) {
  const tenant = (req: Request) => tenantContextOf(req.auth);
  // The validator checked the header against the contract.
  const idempotencyKey = (req: Request) => req.get('idempotency-key')!;

  const listLedgerAccounts: RequestHandler = async (req, res) => {
    const { includeSubaccounts } = req.query as unknown as LedgerAccountsQuery;
    const body: LedgerAccountList = {
      items: await books.accounts(tenant(req), includeSubaccounts === 'true'),
    };
    res.json(body);
  };

  const createLedgerAccount: RequestHandler = async (req, res) => {
    const body: LedgerAccount = await books.createAccount(
      tenant(req),
      req.body as CreateLedgerAccountRequest,
      contextOf(req),
    );
    res.status(201).json(body);
  };

  const getAccountStatement: RequestHandler = async (req, res) => {
    const body: AccountStatement = await books.statement(
      tenant(req),
      String(req.params.accountId),
      req.query as unknown as StatementQuery,
    );
    res.json(body);
  };

  const getJournalEntry: RequestHandler = async (req, res) => {
    const body: JournalEntry = await books.entry(tenant(req), String(req.params.entryId));
    res.json(body);
  };

  const postJournalEntry: RequestHandler = async (req, res) => {
    const body: JournalEntryPosted = await books.postEntry(
      tenant(req),
      idempotencyKey(req),
      req.body as PostJournalEntryRequest,
      contextOf(req),
    );
    res.status(201).json(body);
  };

  const reverseJournalEntry: RequestHandler = async (req, res) => {
    const { narrative } = req.body as ReverseJournalEntryRequest;
    const body: JournalEntryPosted = await books.reverseEntry(
      tenant(req),
      idempotencyKey(req),
      String(req.params.entryId),
      narrative ?? null,
      contextOf(req),
    );
    res.status(201).json(body);
  };

  const getTrialBalance: RequestHandler = async (req, res) => {
    const { asOf } = req.query as unknown as AsOfQuery;
    const body: TrialBalance = await books.trialBalance(tenant(req), asOf);
    res.json(body);
  };

  const getBalanceSheet: RequestHandler = async (req, res) => {
    const { asOf } = req.query as unknown as AsOfQuery;
    const body: BalanceSheet = await books.balanceSheet(tenant(req), asOf);
    res.json(body);
  };

  const getProfitAndLoss: RequestHandler = async (req, res) => {
    const { from, to } = req.query as unknown as PeriodQuery;
    const body: ProfitAndLoss = await books.profitAndLoss(tenant(req), from, to);
    res.json(body);
  };

  return {
    listLedgerAccounts,
    createLedgerAccount,
    getAccountStatement,
    getJournalEntry,
    postJournalEntry,
    reverseJournalEntry,
    getTrialBalance,
    getBalanceSheet,
    getProfitAndLoss,
  };
}
