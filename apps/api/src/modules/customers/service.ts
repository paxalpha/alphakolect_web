import type {
  AcceptCustomerInvitationRequest,
  AgentCreateCustomerRequest,
  AgentCustomer,
  AgentCustomerList,
  AgentCustomerListQuery,
  CreateCustomerRequest,
  Customer,
  CustomerAssignmentList,
  CustomerList,
  CustomerListQuery,
  CustomerSelf,
  Permission,
  UpdateCustomerRequest,
} from '@alphakolect/contracts';
import type { AuthContext } from '../../platform/http/authenticate.js';
import { refusalMessage, type BranchResolver } from '../../platform/authorization.js';
import type { Db } from '../../platform/db.js';
import type { Mailer } from '../../platform/email.js';
import { AppError } from '../../platform/errors.js';
import { decodeCursor, pageOf } from '../../platform/pagination.js';
import type { RequestContext } from '../../platform/request-context.js';
import { tenantContextOf, withTenant, type TenantContext } from '../../platform/tenant.js';
import type { AuditLog } from '../audit/index.js';
import {
  burnPasswordCheck,
  checkPasswordPolicy,
  customerAppEmail,
  hashPassword,
  hashReceivedToken,
  INVITATION_TTL_SECONDS,
  newOpaqueToken,
  verifyPassword,
  type IdentityRepository,
  type RateLimiter,
} from '../identity/index.js';
import {
  customersRepository as repo,
  type AgentCustomerRow,
  type CustomerFields,
  type CustomerWrite,
} from './repository.js';

/** The customer a successful command returns (every field set by the database). */
const written = (w: CustomerWrite): CustomerFields => w as CustomerFields;

// Customers (P7; docs/architecture/P7_IMPLEMENTATION_PLAN.md; the owner's answers of 2026-10-25). The business is the
// session's. Who may act is decided by the router's policy middleware from the endpoint's permission and — for the
// branch-scoped endpoints — the resource's branch (P5 §7.6), then again by every database function under its locks
// (B1). On success each command's function records its activity event (pattern A); a refusal by the database alone is
// recorded best effort. The app link's email is sent only after the commit, and the issuer is never told whether the
// address already had an account (D12).

export const toCustomer = (row: CustomerFields): Customer => ({
  customerId: row.id,
  branchId: row.branch_id,
  fullName: row.full_name,
  phone: row.phone,
  email: row.email,
  address: row.address,
  nickname: row.nickname,
  status: row.status,
  agentMembershipId: row.agent_membership_id,
  appAccess: row.app_access,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  deactivatedAt: row.deactivated_at?.toISOString() ?? null,
  anonymisedAt: row.anonymised_at?.toISOString() ?? null,
});

const toAgentCustomer = (row: Omit<AgentCustomerRow, 'position_at'>): AgentCustomer => ({
  customerId: row.id,
  branchId: row.branch_id,
  fullName: row.full_name,
  phone: row.phone,
  email: row.email,
  address: row.address,
  nickname: row.nickname,
  status: row.status,
  createdAt: row.created_at.toISOString(),
});

type CustomerAction =
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deactivated'
  | 'customer.reactivated'
  | 'customer.agent_assigned'
  | 'customer.app_invited'
  | 'customer.anonymised';

const PERMISSION: Record<CustomerAction, Permission> = {
  'customer.created': 'merchant.customers.manage',
  'customer.updated': 'merchant.customers.manage',
  'customer.deactivated': 'merchant.customers.manage',
  'customer.reactivated': 'merchant.customers.manage',
  'customer.agent_assigned': 'merchant.customers.assign',
  'customer.app_invited': 'merchant.customers.manage',
  'customer.anonymised': 'merchant.customers.anonymise',
};

const notFound = () => new AppError(404, 'NOT_FOUND', 'Customer not found');
const transition = () =>
  new AppError(409, 'INVALID_LIFECYCLE_TRANSITION', 'The customer’s status does not allow this');

/** The answer for each refusal of a customer command other than 'forbidden'. */
function refusal(outcome: CustomerWrite['outcome']): AppError {
  switch (outcome) {
    case 'not_found':
      return notFound();
    case 'invalid':
      return new AppError(400, 'VALIDATION_ERROR', 'The customer’s details are not valid');
    case 'invalid_branch':
      return new AppError(
        422,
        'INVALID_BRANCH',
        'Choose an active branch of the business that you can reach',
      );
    case 'invalid_agent':
      return new AppError(422, 'INVALID_AGENT', 'Choose an active agent of the business');
    case 'phone_taken':
      return new AppError(409, 'PHONE_TAKEN', 'Another customer of the business has this phone number');
    case 'invalid_status':
    case 'invalid_transition':
      return transition();
    case 'balance_not_zero':
      return new AppError(
        422,
        'BALANCE_NOT_ZERO',
        'The customer still has savings or a loan with the business; settle them first',
      );
    case 'ok':
    case 'forbidden':
      throw new Error(`not a refusal: ${outcome}`);
  }
}

const invalidInvitation = () =>
  new AppError(
    400,
    'INVALID_INVITATION',
    'This link cannot be used. Check the link, your email and your password, or ask the business for a new link.',
  );

export type CustomerDeps = {
  db: Db;
  identity: IdentityRepository;
  audit: Pick<AuditLog, 'recordBestEffort'>;
  limiter: RateLimiter;
  mailer: Pick<Mailer, 'dispatch'>;
  webAppUrl: string;
};

export class CustomerService {
  constructor(private readonly deps: CustomerDeps) {}

  /** The branch resolvers of the branch-scoped customer endpoints (P5 §7.6): read before the policy decision. */
  branchResolvers(): Readonly<Record<string, BranchResolver>> {
    const own: BranchResolver = async (_req, auth) => ({ branchId: auth.branchId });
    const requested: BranchResolver = async (req) => ({
      branchId: (req.body as CreateCustomerRequest).branchId,
    });
    const ofCustomer: BranchResolver = async (req, auth) => ({
      branchId: await withTenant(this.deps.db, tenantContextOf(auth as AuthContext), (tx) =>
        repo.branchOf(tx, String(req.params.customerId)),
      ),
    });
    return {
      listCustomers: own,
      createCustomer: requested,
      getCustomer: ofCustomer,
      updateCustomer: ofCustomer,
      deactivateCustomer: ofCustomer,
      reactivateCustomer: ofCustomer,
      assignCustomerAgent: ofCustomer,
      listCustomerAssignments: ofCustomer,
      inviteCustomerToApp: ofCustomer,
    };
  }

  async list(tenant: TenantContext, query: CustomerListQuery): Promise<CustomerList> {
    const scope = `listCustomers|search=${query.search ?? ''}|branchId=${query.branchId ?? ''}|status=${query.status ?? ''}`;
    const after = decodeCursor(query.cursor, scope);
    const rows = await withTenant(this.deps.db, tenant, (tx) =>
      repo.list(
        tx,
        { search: query.search ?? null, branchId: query.branchId ?? null, status: query.status ?? null },
        { limit: query.limit, after },
      ),
    );
    return pageOf(rows, query.limit, scope, toCustomer);
  }

  async get(tenant: TenantContext, customerId: string): Promise<Customer> {
    const row = await withTenant(this.deps.db, tenant, (tx) => repo.get(tx, customerId));
    if (!row) throw notFound();
    return toCustomer(row);
  }

  async create(tenant: TenantContext, input: CreateCustomerRequest, ctx: RequestContext): Promise<Customer> {
    return this.write(tenant, 'customer.created', null, ctx, (tx) => repo.create(tx, input, ctx));
  }

  async update(
    tenant: TenantContext,
    customerId: string,
    change: UpdateCustomerRequest,
    ctx: RequestContext,
  ): Promise<Customer> {
    return this.write(tenant, 'customer.updated', customerId, ctx, (tx) =>
      repo.update(tx, customerId, change, ctx),
    );
  }

  async setStatus(
    tenant: TenantContext,
    customerId: string,
    status: 'active' | 'deactivated',
    ctx: RequestContext,
  ): Promise<Customer> {
    const action = status === 'deactivated' ? 'customer.deactivated' : 'customer.reactivated';
    return this.write(tenant, action, customerId, ctx, (tx) => repo.setStatus(tx, customerId, status, ctx));
  }

  async assignAgent(
    tenant: TenantContext,
    customerId: string,
    agentMembershipId: string | null,
    ctx: RequestContext,
  ): Promise<Customer> {
    return this.write(tenant, 'customer.agent_assigned', customerId, ctx, (tx) =>
      repo.assignAgent(tx, customerId, agentMembershipId, ctx),
    );
  }

  async assignments(tenant: TenantContext, customerId: string): Promise<CustomerAssignmentList> {
    const { customer, rows } = await withTenant(this.deps.db, tenant, async (tx) => ({
      customer: await repo.get(tx, customerId),
      rows: await repo.assignments(tx, customerId),
    }));
    if (!customer) throw notFound();
    return {
      items: rows.map((r) => ({
        assignmentId: r.id,
        agentMembershipId: r.agent_membership_id,
        assignedAt: r.assigned_at.toISOString(),
        endedAt: r.ended_at?.toISOString() ?? null,
        assignedByMembershipId: r.assigned_by_membership_id,
        endedByMembershipId: r.ended_by_membership_id,
      })),
    };
  }

  async anonymise(tenant: TenantContext, customerId: string, ctx: RequestContext): Promise<Customer> {
    return this.write(tenant, 'customer.anonymised', customerId, ctx, (tx) =>
      repo.anonymise(tx, customerId, ctx),
    );
  }

  /** The app link (Q7): the answer is the same whatever the address belongs to (D12). */
  async inviteToApp(tenant: TenantContext, customerId: string, ctx: RequestContext): Promise<void> {
    const { db, limiter, mailer, webAppUrl } = this.deps;
    await limiter.enforce('customer_app_invite', ctx.ip, tenant.merchantId);
    const token = newOpaqueToken();
    const issued = await withTenant(db, tenant, (tx) =>
      repo.issueAppInvitation(tx, customerId, token.hash, INVITATION_TTL_SECONDS, ctx),
    );
    switch (issued.outcome) {
      case 'ok':
        // Sent only after the commit: an email never announces a link that does not exist.
        if (issued.delivery === 'setup' || issued.delivery === 'accept') {
          mailer.dispatch(
            customerAppEmail(issued.email!, webAppUrl, token.raw, issued.merchant_name!, issued.delivery),
          );
        }
        return;
      case 'forbidden':
        await this.denied(tenant, 'customer.app_invited', customerId, ctx);
        throw new AppError(403, 'FORBIDDEN', refusalMessage('merchant.customers.manage'));
      case 'not_found':
        throw notFound();
      case 'invalid_status':
        throw transition();
      case 'no_email':
        throw new AppError(409, 'NO_EMAIL', 'Add the customer’s email address first');
      case 'already_linked':
        throw new AppError(409, 'ALREADY_LINKED', 'The customer already signs in to the app');
      case 'email_in_use':
        throw new AppError(409, 'EMAIL_IN_USE', 'Another customer of the business signs in with this email');
    }
  }

  /**
   * Accepting the app link (Q7): a new person chooses a password with it; an existing account gives its own (T11). One
   * generic error for every failure; the database re-checks the link, the person and the customer, and links them.
   */
  async acceptAppInvitation(input: AcceptCustomerInvitationRequest, ctx: RequestContext): Promise<void> {
    const { db, identity, audit, limiter } = this.deps;
    await limiter.enforce('customer_app_accept', ctx.ip, input.email);
    // D10, first and for everyone: the answer must not tell an account that has a password from one that has not
    // (D12). An existing account's password was set under the same rules.
    const problem = checkPasswordPolicy(input.password);
    if (problem) {
      throw new AppError(422, 'WEAK_PASSWORD', 'Choose a longer or less common password', { problem });
    }
    const candidate = await identity.loginIdentity(input.email);
    const tokenHash = hashReceivedToken(input.token);
    const fail = async (reason: string) => {
      await audit.recordBestEffort({
        action: 'customer.app_access_accepted',
        outcome: 'failure',
        actorIdentityId: candidate?.identity_id ?? null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        summary: { reason },
      });
      return invalidInvitation();
    };

    let newHash: string | null = null;
    if (candidate?.password_hash) {
      if (!(await verifyPassword(input.password, candidate.password_hash)))
        throw await fail('wrong_password');
    } else if (candidate) {
      newHash = await hashPassword(input.password);
    } else {
      // D12: an unknown account costs the same password check as a known one and fails identically.
      await burnPasswordCheck(input.password);
      throw await fail('unknown_account');
    }
    if (!tokenHash) throw await fail('malformed_token');

    const outcome = await db.transaction(async (tx) => {
      const [row] = await tx.query<{ outcome: string }>(
        `SELECT outcome FROM customers.accept_app_invitation($1, $2, $3, $4, $5, $6)`,
        [tokenHash, candidate.identity_id, newHash, ctx.ip, ctx.userAgent, ctx.requestId],
      );
      return row!.outcome;
    });
    if (outcome !== 'ok') throw await fail(outcome);
  }

  // ── agents (P7-6) ──

  async agentList(tenant: TenantContext, query: AgentCustomerListQuery): Promise<AgentCustomerList> {
    const scope = `listAgentCustomers|search=${query.search ?? ''}`;
    const after = decodeCursor(query.cursor, scope);
    const rows = await withTenant(this.deps.db, tenant, (tx) =>
      repo.agentCustomers(tx, query.search ?? null, { limit: query.limit, after }),
    );
    return pageOf(rows, query.limit, scope, toAgentCustomer);
  }

  async agentCreate(
    tenant: TenantContext,
    input: AgentCreateCustomerRequest,
    ctx: RequestContext,
  ): Promise<AgentCustomer> {
    const result = await withTenant(this.deps.db, tenant, (tx) => repo.agentCreate(tx, input, ctx));
    if (result.outcome === 'ok') return toAgentCustomer(written(result));
    if (result.outcome === 'forbidden') {
      // The session is no longer an active agent's: authentication found it valid moments ago.
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    throw refusal(result.outcome);
  }

  // ── the customer audience ──

  async self(tenant: TenantContext): Promise<CustomerSelf> {
    const row = await withTenant(this.deps.db, tenant, (tx) => repo.self(tx));
    // validate_session established the customer on this request; absent only if it changed in between.
    if (!row) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    return {
      customerId: row.customer_id,
      merchant: { merchantId: row.merchant_id, name: row.merchant_name },
      branchId: row.branch_id,
      fullName: row.full_name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      nickname: row.nickname,
    };
  }

  /**
   * One command: its function decides and records it (pattern A) and returns the customer it wrote, so the answer
   * never depends on a permission to read customers. A refusal by the database alone ('forbidden') is recorded best
   * effort and answered 403; every other refusal has its own answer.
   */
  private async write(
    tenant: TenantContext,
    action: CustomerAction,
    targetId: string | null,
    ctx: RequestContext,
    command: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<CustomerWrite>,
  ): Promise<Customer> {
    const result = await withTenant(this.deps.db, tenant, (tx) => command(tx));
    if (result.outcome === 'ok') return toCustomer(written(result));
    if (result.outcome === 'forbidden') {
      await this.denied(tenant, action, targetId, ctx);
      throw new AppError(403, 'FORBIDDEN', refusalMessage(PERMISSION[action]));
    }
    throw refusal(result.outcome);
  }

  /** A refusal by the database alone (a permission withdrawn between the two checks), recorded best effort. */
  private denied(
    tenant: TenantContext,
    action: CustomerAction,
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
      targetType: 'customer',
      targetId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      summary: { reason: 'forbidden' },
    });
  }
}
