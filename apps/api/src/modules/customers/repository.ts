import { POSITION_AT, type Position, type Positioned } from '../../platform/pagination.js';
import type { RequestContext } from '../../platform/request-context.js';
import { scopeOf, type TenantTx } from '../../platform/tenant.js';

// The customers module's scoped repository (P7; ADR-15 T13–T15, B1). The app holds no privilege on the customers'
// tables: every read and write here is a customers.* database function called with the caller's session, which takes
// the business from the session, decides the permission and the branch scope itself, and records its activity event
// (pattern A). Refusals are returned as outcomes, not raised (§8.2a).

/** A customer as the commands and reads return it. */
export type CustomerFields = {
  id: string;
  branch_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  nickname: string | null;
  status: 'active' | 'deactivated' | 'anonymised';
  agent_membership_id: string | null;
  app_access: boolean;
  created_at: Date;
  updated_at: Date;
  deactivated_at: Date | null;
  anonymised_at: Date | null;
};
export type CustomerRow = CustomerFields & Positioned;

export type AgentCustomerRow = Positioned & {
  branch_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  nickname: string | null;
  status: 'active' | 'deactivated' | 'anonymised';
  created_at: Date;
};

export type AssignmentRow = {
  id: string;
  agent_membership_id: string;
  assigned_at: Date;
  ended_at: Date | null;
  assigned_by_membership_id: string | null;
  ended_by_membership_id: string | null;
};

export type SelfRow = {
  customer_id: string;
  merchant_id: string;
  merchant_name: string;
  branch_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  nickname: string | null;
};

export type CustomerOutcome =
  | 'ok'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'invalid_branch'
  | 'invalid_agent'
  | 'invalid_status'
  | 'invalid_transition'
  | 'phone_taken'
  | 'balance_not_zero';
/** A command's answer: the customer it wrote with 'ok' (every field set), nothing with a refusal. */
export type CustomerWrite = { outcome: CustomerOutcome } & {
  [K in keyof CustomerFields]: CustomerFields[K] | null;
};

export type AppInvitationOutcome =
  'ok' | 'forbidden' | 'not_found' | 'no_email' | 'invalid_status' | 'already_linked' | 'email_in_use';
export type IssuedAppInvitation = {
  outcome: AppInvitationOutcome;
  delivery: 'setup' | 'accept' | 'none' | null;
  email: string | null;
  merchant_name: string | null;
};

/** A page of a list: its size, and the position a cursor gave (null for the first page). */
export type Page = { limit: number; after: Position | null };

export type NewCustomer = {
  branchId: string;
  fullName: string;
  phone: string;
  email?: string | undefined;
  address?: string | undefined;
  nickname?: string | undefined;
};

const FIELDS = `id, branch_id, full_name, phone, email, address, nickname, status, agent_membership_id, app_access,
              created_at, updated_at, deactivated_at, anonymised_at`;
const CUSTOMER_COLUMNS = `${FIELDS}, ${POSITION_AT}`;
const WRITE_COLUMNS = `outcome, ${FIELDS}`;

export const customersRepository = {
  /** customers.list_customers: a page of the business's customers (a restricted staff member's branch only). */
  async list(
    tx: TenantTx,
    filter: { search: string | null; branchId: string | null; status: string | null },
    page: Page,
  ): Promise<CustomerRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS}
         FROM customers.list_customers($1, NULL, $2, $3, $4, $5, $6::timestamptz, $7)`,
      [
        sessionId,
        filter.search,
        filter.branchId,
        filter.status,
        page.limit,
        page.after?.at ?? null,
        page.after?.id ?? null,
      ],
    );
  },

  /** customers.list_customers for one customer: null when it is not one the caller may read. */
  async get(tx: TenantTx, customerId: string): Promise<CustomerRow | null> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} FROM customers.list_customers($1, $2)`,
      [sessionId, customerId],
    );
    return row ?? null;
  },

  /** customers.branch_of: the branch of one of the business's customers, for the branch-scope decision (§7.6). */
  async branchOf(tx: TenantTx, customerId: string): Promise<string | null> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<{ branch_id: string | null }>(
      `SELECT customers.branch_of($1, $2) AS branch_id`,
      [sessionId, customerId],
    );
    return row?.branch_id ?? null;
  },

  /** customers.create_customer (Q4): the business adds a customer, with their agent if any. */
  async create(
    tx: TenantTx,
    input: NewCustomer & { agentMembershipId?: string | undefined },
    ctx: RequestContext,
  ): Promise<CustomerWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<CustomerWrite>(
      `SELECT ${WRITE_COLUMNS} FROM customers.create_customer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        sessionId,
        input.branchId,
        input.fullName,
        input.phone,
        input.email ?? null,
        input.address ?? null,
        input.nickname ?? null,
        input.agentMembershipId ?? null,
        ctx.ip,
        ctx.userAgent,
        ctx.requestId,
      ],
    );
    return row!;
  },

  /** customers.agent_create_customer (Q4, P7-6): an agent adds a customer, who is theirs. */
  async agentCreate(tx: TenantTx, input: NewCustomer, ctx: RequestContext): Promise<CustomerWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<CustomerWrite>(
      `SELECT ${WRITE_COLUMNS} FROM customers.agent_create_customer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        sessionId,
        input.branchId,
        input.fullName,
        input.phone,
        input.email ?? null,
        input.address ?? null,
        input.nickname ?? null,
        ctx.ip,
        ctx.userAgent,
        ctx.requestId,
      ],
    );
    return row!;
  },

  /** customers.update_customer: the fields to change, by their contract names (null clears an optional one). */
  async update(
    tx: TenantTx,
    customerId: string,
    change: object,
    ctx: RequestContext,
  ): Promise<CustomerWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<CustomerWrite>(
      `SELECT ${WRITE_COLUMNS} FROM customers.update_customer($1, $2, $3::jsonb, $4, $5, $6)`,
      [sessionId, customerId, JSON.stringify(change), ctx.ip, ctx.userAgent, ctx.requestId],
    );
    return row!;
  },

  /** customers.set_customer_status (Q8): deactivate or reactivate. */
  async setStatus(
    tx: TenantTx,
    customerId: string,
    status: 'active' | 'deactivated',
    ctx: RequestContext,
  ): Promise<CustomerWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<CustomerWrite>(
      `SELECT ${WRITE_COLUMNS} FROM customers.set_customer_status($1, $2, $3, $4, $5, $6)`,
      [sessionId, customerId, status, ctx.ip, ctx.userAgent, ctx.requestId],
    );
    return row!;
  },

  /** customers.assign_agent (D1, Q5): give, move or take away the customer's agent. */
  async assignAgent(
    tx: TenantTx,
    customerId: string,
    agentMembershipId: string | null,
    ctx: RequestContext,
  ): Promise<CustomerWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<CustomerWrite>(
      `SELECT ${WRITE_COLUMNS} FROM customers.assign_agent($1, $2, $3, $4, $5, $6)`,
      [sessionId, customerId, agentMembershipId, ctx.ip, ctx.userAgent, ctx.requestId],
    );
    return row!;
  },

  /** customers.list_assignments: every agent the customer has had, newest first. */
  async assignments(tx: TenantTx, customerId: string): Promise<AssignmentRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<AssignmentRow>(
      `SELECT id, agent_membership_id, assigned_at, ended_at, assigned_by_membership_id, ended_by_membership_id
         FROM customers.list_assignments($1, $2)`,
      [sessionId, customerId],
    );
  },

  /** customers.issue_app_invitation (Q7): the link; the database says which email to send, if any. */
  async issueAppInvitation(
    tx: TenantTx,
    customerId: string,
    tokenHash: string,
    ttlSeconds: number,
    ctx: RequestContext,
  ): Promise<IssuedAppInvitation> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<IssuedAppInvitation>(
      `SELECT outcome, delivery, email, merchant_name
         FROM customers.issue_app_invitation($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, customerId, tokenHash, ttlSeconds, ctx.ip, ctx.userAgent, ctx.requestId],
    );
    return row!;
  },

  /** customers.anonymise_customer (BR-11.3, Q9): the owner only, once nothing is left with the business. */
  async anonymise(tx: TenantTx, customerId: string, ctx: RequestContext): Promise<CustomerWrite> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<CustomerWrite>(
      `SELECT ${WRITE_COLUMNS} FROM customers.anonymise_customer($1, $2, $3, $4, $5)`,
      [sessionId, customerId, ctx.ip, ctx.userAgent, ctx.requestId],
    );
    return row!;
  },

  /** customers.agent_customers (P7-6): a page of the agent's own customers. */
  async agentCustomers(tx: TenantTx, search: string | null, page: Page): Promise<AgentCustomerRow[]> {
    const { sessionId } = scopeOf(tx);
    return tx.query<AgentCustomerRow>(
      `SELECT id, branch_id, full_name, phone, email, address, nickname, status, created_at, ${POSITION_AT}
         FROM customers.agent_customers($1, NULL, $2, $3, $4::timestamptz, $5)`,
      [sessionId, search, page.limit, page.after?.at ?? null, page.after?.id ?? null],
    );
  },

  /** customers.read_self: the signed-in customer's own record and business. */
  async self(tx: TenantTx): Promise<SelfRow | null> {
    const { sessionId } = scopeOf(tx);
    const [row] = await tx.query<SelfRow>(
      `SELECT customer_id, merchant_id, merchant_name, branch_id, full_name, phone, email, address, nickname
         FROM customers.read_self($1)`,
      [sessionId],
    );
    return row ?? null;
  },
} satisfies Record<string, (tx: TenantTx, ...args: never[]) => Promise<unknown>>;
