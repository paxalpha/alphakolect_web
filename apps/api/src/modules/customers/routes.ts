import type {
  AcceptCustomerInvitationRequest,
  AgentCreateCustomerRequest,
  AgentCustomer,
  AgentCustomerList,
  AgentCustomerListQuery,
  AssignAgentRequest,
  CreateCustomerRequest,
  Customer,
  CustomerAssignmentList,
  CustomerList,
  CustomerListQuery,
  CustomerSelf,
  UpdateCustomerRequest,
} from '@alphakolect/contracts';
import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../platform/request-context.js';
import { tenantContextOf } from '../../platform/tenant.js';
import type { CustomerService } from './service.js';

// /v1/merchant/customers, /v1/agent/customers, /v1/customer/me and the app link's acceptance (contracts:
// packages/contracts/src/endpoints/customers.ts). The session is already authenticated and re-validated, its
// permission and — for the branch-scoped endpoints — the customer's branch checked by the policy middleware; path
// parameters, queries and bodies are already validated against the contract.

const contextOf = (req: Request): RequestContext => ({
  ip: req.ip ?? 'unknown',
  userAgent: req.get('user-agent') ?? null,
  requestId: String(req.id),
});

export function customerHandlers({ customers: service }: { customers: CustomerService }) {
  const tenant = (req: Request) => tenantContextOf(req.auth);
  const customerId = (req: Request) => String(req.params.customerId);

  const listCustomers: RequestHandler = async (req, res) => {
    const body: CustomerList = await service.list(tenant(req), req.query as unknown as CustomerListQuery);
    res.json(body);
  };

  const createCustomer: RequestHandler = async (req, res) => {
    const body: Customer = await service.create(
      tenant(req),
      req.body as CreateCustomerRequest,
      contextOf(req),
    );
    res.status(201).json(body);
  };

  const getCustomer: RequestHandler = async (req, res) => {
    const body: Customer = await service.get(tenant(req), customerId(req));
    res.json(body);
  };

  const updateCustomer: RequestHandler = async (req, res) => {
    const body: Customer = await service.update(
      tenant(req),
      customerId(req),
      req.body as UpdateCustomerRequest,
      contextOf(req),
    );
    res.json(body);
  };

  const deactivateCustomer: RequestHandler = async (req, res) => {
    const body: Customer = await service.setStatus(
      tenant(req),
      customerId(req),
      'deactivated',
      contextOf(req),
    );
    res.json(body);
  };

  const reactivateCustomer: RequestHandler = async (req, res) => {
    const body: Customer = await service.setStatus(tenant(req), customerId(req), 'active', contextOf(req));
    res.json(body);
  };

  const assignCustomerAgent: RequestHandler = async (req, res) => {
    const { agentMembershipId } = req.body as AssignAgentRequest;
    const body: Customer = await service.assignAgent(
      tenant(req),
      customerId(req),
      agentMembershipId,
      contextOf(req),
    );
    res.json(body);
  };

  const listCustomerAssignments: RequestHandler = async (req, res) => {
    const body: CustomerAssignmentList = await service.assignments(tenant(req), customerId(req));
    res.json(body);
  };

  const inviteCustomerToApp: RequestHandler = async (req, res) => {
    await service.inviteToApp(tenant(req), customerId(req), contextOf(req));
    res.status(202).send();
  };

  const anonymiseCustomer: RequestHandler = async (req, res) => {
    const body: Customer = await service.anonymise(tenant(req), customerId(req), contextOf(req));
    res.json(body);
  };

  const listAgentCustomers: RequestHandler = async (req, res) => {
    const body: AgentCustomerList = await service.agentList(
      tenant(req),
      req.query as unknown as AgentCustomerListQuery,
    );
    res.json(body);
  };

  const createAgentCustomer: RequestHandler = async (req, res) => {
    const body: AgentCustomer = await service.agentCreate(
      tenant(req),
      req.body as AgentCreateCustomerRequest,
      contextOf(req),
    );
    res.status(201).json(body);
  };

  const acceptCustomerInvitation: RequestHandler = async (req, res) => {
    await service.acceptAppInvitation(req.body as AcceptCustomerInvitationRequest, contextOf(req));
    res.status(204).send();
  };

  const getCustomerSelf: RequestHandler = async (req, res) => {
    const body: CustomerSelf = await service.self(tenant(req));
    res.json(body);
  };

  return {
    listCustomers,
    createCustomer,
    getCustomer,
    updateCustomer,
    deactivateCustomer,
    reactivateCustomer,
    assignCustomerAgent,
    listCustomerAssignments,
    inviteCustomerToApp,
    anonymiseCustomer,
    listAgentCustomers,
    createAgentCustomer,
    acceptCustomerInvitation,
    getCustomerSelf,
  };
}
