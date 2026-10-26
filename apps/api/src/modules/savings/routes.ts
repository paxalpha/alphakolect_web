import type {
  AgentCollection,
  AgentCollectionList,
  AgentCollectionListQuery,
  CancelCollectionRequest,
  Collection,
  CollectionList,
  CollectionListQuery,
  CreatePackageRequest,
  CreateRemittanceRequest,
  CustomerCollectionList,
  CustomerSavings,
  EnrolRequest,
  Enrolment,
  PageQuery,
  RecordCollectionRequest,
  Remittance,
  RemittanceList,
  RemittanceListQuery,
  SavingsMovement,
  SavingsMovementList,
  SavingsPackage,
  SavingsPackageList,
  SavingsPackageQuery,
  TargetGoal,
  TargetGoalRequest,
  TargetTransferRequest,
  UpdatePackageRequest,
  WithdrawalRequest,
} from '@alphakolect/contracts';
import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../platform/request-context.js';
import { tenantContextOf } from '../../platform/tenant.js';
import type { SavingsService } from './service.js';

// /v1/merchant/packages, …/customers/{customerId}/(enrolment|savings|withdrawals|target-transfers|target-goal),
// /v1/merchant/collections, /v1/merchant/remittances, /v1/agent/collections and /v1/customer/savings (contracts:
// packages/contracts/src/endpoints/savings.ts). The session is already authenticated and re-validated, its permission
// and — for the branch-scoped endpoints — the customer's branch checked by the policy middleware; path parameters,
// headers, queries and bodies are already validated against the contract.

const contextOf = (req: Request): RequestContext => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
  requestId: String(req.id),
});

export function savingsHandlers({ savings: service }: { savings: SavingsService }) {
  const tenant = (req: Request) => tenantContextOf(req.auth);
  const customerId = (req: Request) => String(req.params.customerId);
  const idempotencyKey = (req: Request) => req.get('idempotency-key')!;

  const listSavingsPackages: RequestHandler = async (req, res) => {
    const { status } = req.query as unknown as SavingsPackageQuery;
    const body: SavingsPackageList = await service.packages(tenant(req), status ?? null);
    res.json(body);
  };

  const createSavingsPackage: RequestHandler = async (req, res) => {
    const body: SavingsPackage = await service.createPackage(
      tenant(req),
      req.body as CreatePackageRequest,
      contextOf(req),
    );
    res.status(201).json(body);
  };

  const updateSavingsPackage: RequestHandler = async (req, res) => {
    const body: SavingsPackage = await service.updatePackage(
      tenant(req),
      String(req.params.packageId),
      req.body as UpdatePackageRequest,
      contextOf(req),
    );
    res.json(body);
  };

  const enrolCustomer: RequestHandler = async (req, res) => {
    const { packageId } = req.body as EnrolRequest;
    const body: Enrolment = await service.enrol(tenant(req), customerId(req), packageId, contextOf(req));
    res.json(body);
  };

  const getCustomerSavings: RequestHandler = async (req, res) => {
    const body: CustomerSavings = await service.customerSavings(tenant(req), customerId(req));
    res.json(body);
  };

  const listSavingsMovements: RequestHandler = async (req, res) => {
    const body: SavingsMovementList = await service.movements(
      tenant(req),
      customerId(req),
      req.query as unknown as PageQuery,
    );
    res.json(body);
  };

  const listCollections: RequestHandler = async (req, res) => {
    const body: CollectionList = await service.collections(
      tenant(req),
      req.query as unknown as CollectionListQuery,
    );
    res.json(body);
  };

  const cancelCollection: RequestHandler = async (req, res) => {
    const { reason } = req.body as CancelCollectionRequest;
    const body: Collection = await service.cancelCollection(
      tenant(req),
      String(req.params.collectionId),
      reason,
      contextOf(req),
    );
    res.json(body);
  };

  const listRemittances: RequestHandler = async (req, res) => {
    const body: RemittanceList = await service.remittances(
      tenant(req),
      req.query as unknown as RemittanceListQuery,
    );
    res.json(body);
  };

  const createRemittance: RequestHandler = async (req, res) => {
    const body: Remittance = await service.approveRemittance(
      tenant(req),
      req.body as CreateRemittanceRequest,
      contextOf(req),
    );
    res.status(201).json(body);
  };

  const createWithdrawal: RequestHandler = async (req, res) => {
    const { wallet, amountMinor } = req.body as WithdrawalRequest;
    const body: SavingsMovement = await service.move(
      tenant(req),
      customerId(req),
      wallet === 'savings' ? 'savings_withdrawal' : 'target_withdrawal',
      amountMinor,
      idempotencyKey(req),
      contextOf(req),
    );
    res.status(201).json(body);
  };

  const createTargetTransfer: RequestHandler = async (req, res) => {
    const { amountMinor } = req.body as TargetTransferRequest;
    const body: SavingsMovement = await service.move(
      tenant(req),
      customerId(req),
      'to_target',
      amountMinor,
      idempotencyKey(req),
      contextOf(req),
    );
    res.status(201).json(body);
  };

  const setTargetGoal: RequestHandler = async (req, res) => {
    const body: TargetGoal = await service.setGoal(
      tenant(req),
      customerId(req),
      req.body as TargetGoalRequest,
      contextOf(req),
    );
    res.json(body);
  };

  const recordCollection: RequestHandler = async (req, res) => {
    const { customerId: id, amountMinor } = req.body as RecordCollectionRequest;
    const body: AgentCollection = await service.record(
      tenant(req),
      id,
      amountMinor,
      idempotencyKey(req),
      contextOf(req),
    );
    res.status(201).json(body);
  };

  const listAgentCollections: RequestHandler = async (req, res) => {
    const body: AgentCollectionList = await service.agentCollections(
      tenant(req),
      req.query as unknown as AgentCollectionListQuery,
    );
    res.json(body);
  };

  const getCustomerSelfSavings: RequestHandler = async (req, res) => {
    const body: CustomerSavings = await service.selfSavings(tenant(req));
    res.json(body);
  };

  const listCustomerSelfCollections: RequestHandler = async (req, res) => {
    const body: CustomerCollectionList = await service.selfCollections(
      tenant(req),
      req.query as unknown as PageQuery,
    );
    res.json(body);
  };

  return {
    listSavingsPackages,
    createSavingsPackage,
    updateSavingsPackage,
    enrolCustomer,
    getCustomerSavings,
    listSavingsMovements,
    listCollections,
    cancelCollection,
    listRemittances,
    createRemittance,
    createWithdrawal,
    createTargetTransfer,
    setTargetGoal,
    recordCollection,
    listAgentCollections,
    getCustomerSelfSavings,
    listCustomerSelfCollections,
  };
}
