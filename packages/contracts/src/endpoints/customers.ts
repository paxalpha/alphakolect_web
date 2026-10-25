import { z } from 'zod';
import { ErrorResponse, Id, PageQuery } from '../primitives.js';
import { defineEndpoint } from '../registry.js';
import { Email, NewPassword } from './auth.js';
import {
  AgentLoginRequest,
  AgentLoginResponse,
  AgentRefreshRequest,
  AgentSelectRequest,
  AgentTokens,
} from './agent.js';
import { Timestamp } from './merchant.js';

// Customers (P7; docs/architecture/P7_IMPLEMENTATION_PLAN.md; the owner's answers of 2026-10-25). Three audiences:
//   /v1/merchant/customers — the business: onboard, change, deactivate, assign an agent, send the app link, remove a
//     customer's personal details. A staff member restricted to a branch reaches that branch's customers only;
//     another branch's customer is "not found" (P5 §7.6).
//   /v1/agent/customers — an agent: their own customers, and onboarding (a customer an agent adds is theirs).
//   /v1/auth/customer/*, /v1/customer/* — the customer's mobile app: bearer tokens, like agents (ADR-14 D7).

const error = (description: string) => ({ description, schema: ErrorResponse });
const rateLimited = {
  ...error('RATE_LIMITED'),
  headers: z.object({ 'retry-after': z.string().meta({ description: 'Seconds to wait' }) }),
};
const NoStore = z.object({
  'Cache-Control': z.literal('no-store').meta({ description: 'Tokens are never cached' }),
});

/** A phone number as written: spaces, dashes and brackets allowed; stored normalised (0803… → +234803…). */
const PhoneInput = z.string().trim().min(7).max(24).meta({
  description: 'A phone number; 0XXXXXXXXXX is read as a Nigerian number (+234)',
  example: '0803 123 4567',
});
const FullName = z.string().trim().min(1).max(120);
const Address = z.string().trim().min(1).max(300);
const Nickname = z.string().trim().min(1).max(60);

export const CustomerStatus = z.enum(['active', 'deactivated', 'anonymised']).meta({ id: 'CustomerStatus' });

export const Customer = z
  .object({
    customerId: Id,
    branchId: Id,
    /** 'Removed customer' once the customer's details are removed (BR-11.3). */
    fullName: z.string(),
    /** Normalised, e.g. +2348031234567; null once the details are removed. */
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    nickname: z.string().nullable(),
    status: CustomerStatus,
    /** The agent the customer has now; null for none (a customer may pay at the office). */
    agentMembershipId: Id.nullable(),
    /** Whether the customer has accepted the app link and can sign in. */
    appAccess: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    deactivatedAt: Timestamp.nullable(),
    anonymisedAt: Timestamp.nullable(),
  })
  .meta({ id: 'Customer', description: 'One of the business’s customers' });
export type Customer = z.infer<typeof Customer>;

export const CustomerList = z
  .object({ items: z.array(Customer), nextCursor: z.string().nullable() })
  .meta({ id: 'CustomerList', description: 'Oldest first' });
export type CustomerList = z.infer<typeof CustomerList>;

export const CustomerListQuery = PageQuery.extend({
  /** Part of a name or nickname, or digits of a phone number. */
  search: z.string().trim().min(1).max(100).optional(),
  branchId: Id.optional(),
  status: CustomerStatus.optional(),
});
export type CustomerListQuery = z.infer<typeof CustomerListQuery>;

export const CreateCustomerRequest = z
  .object({
    branchId: Id,
    fullName: FullName,
    phone: PhoneInput,
    email: Email.optional(),
    address: Address.optional(),
    nickname: Nickname.optional(),
    /** The customer's agent, if any. */
    agentMembershipId: Id.optional(),
  })
  .meta({ id: 'CreateCustomerRequest' });
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequest>;

export const AgentCreateCustomerRequest = CreateCustomerRequest.omit({ agentMembershipId: true }).meta({
  id: 'AgentCreateCustomerRequest',
  description: 'A customer an agent adds is the agent’s',
});
export type AgentCreateCustomerRequest = z.infer<typeof AgentCreateCustomerRequest>;

export const UpdateCustomerRequest = z
  .object({
    fullName: FullName.optional(),
    phone: PhoneInput.optional(),
    /** null removes it. */
    email: Email.nullable().optional(),
    address: Address.nullable().optional(),
    nickname: Nickname.nullable().optional(),
    branchId: Id.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'at least one field to change')
  .meta({ id: 'UpdateCustomerRequest' });
export type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequest>;

export const AssignAgentRequest = z
  .object({ /** null takes the customer off their agent. */ agentMembershipId: Id.nullable() })
  .meta({ id: 'AssignAgentRequest' });
export type AssignAgentRequest = z.infer<typeof AssignAgentRequest>;

export const CustomerAssignment = z
  .object({
    assignmentId: Id,
    agentMembershipId: Id,
    assignedAt: Timestamp,
    endedAt: Timestamp.nullable(),
    assignedByMembershipId: Id.nullable(),
    endedByMembershipId: Id.nullable(),
  })
  .meta({ id: 'CustomerAssignment' });
export const CustomerAssignmentList = z
  .object({ items: z.array(CustomerAssignment) })
  .meta({ id: 'CustomerAssignmentList', description: 'Every agent the customer has had, newest first' });
export type CustomerAssignmentList = z.infer<typeof CustomerAssignmentList>;

const customerParams = z.object({ customerId: Id });
const read = { class: 'permission', permission: 'merchant.customers.read', branchScope: 'branch' } as const;
const manage = {
  class: 'permission',
  permission: 'merchant.customers.manage',
  branchScope: 'branch',
} as const;
const notFound = { 404: error('NOT_FOUND — no such customer in this business (or in your branch)') };
const forbidden = (permission: string) => ({
  403: error(`FORBIDDEN — the caller does not hold ${permission}`),
});

export const listCustomers = defineEndpoint({
  id: 'listCustomers',
  method: 'get',
  path: '/v1/merchant/customers',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary:
    'The business’s customers (a branch-restricted staff member’s branch only), searchable, a page at a time',
  request: { query: CustomerListQuery },
  responses: {
    200: { description: 'One page of customers', schema: CustomerList },
    400: error('VALIDATION_ERROR; INVALID_CURSOR'),
    ...forbidden('merchant.customers.read'),
  },
});

export const createCustomer = defineEndpoint({
  id: 'createCustomer',
  method: 'post',
  path: '/v1/merchant/customers',
  authorization: manage,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Add a customer, with their agent if any (their ledger accounts open with them)',
  request: { body: CreateCustomerRequest },
  responses: {
    201: { description: 'The customer', schema: Customer },
    400: error('VALIDATION_ERROR'),
    ...forbidden('merchant.customers.manage'),
    404: error('NOT_FOUND — the branch is not one you can reach'),
    409: error('PHONE_TAKEN — another customer of the business has this phone number'),
    422: error(
      'INVALID_BRANCH — not an active branch of yours; INVALID_AGENT — not an active agent of the business',
    ),
  },
});

export const getCustomer = defineEndpoint({
  id: 'getCustomer',
  method: 'get',
  path: '/v1/merchant/customers/{customerId}',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'One customer',
  request: { params: customerParams },
  responses: {
    200: { description: 'The customer', schema: Customer },
    ...forbidden('merchant.customers.read'),
    ...notFound,
  },
});

export const updateCustomer = defineEndpoint({
  id: 'updateCustomer',
  method: 'patch',
  path: '/v1/merchant/customers/{customerId}',
  authorization: manage,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Change a customer’s details or branch',
  request: { params: customerParams, body: UpdateCustomerRequest },
  responses: {
    200: { description: 'The customer', schema: Customer },
    400: error('VALIDATION_ERROR'),
    ...forbidden('merchant.customers.manage'),
    ...notFound,
    409: error('PHONE_TAKEN; INVALID_LIFECYCLE_TRANSITION — the customer’s details were removed'),
    422: error('INVALID_BRANCH — not an active branch of yours'),
  },
});

const statusChange = (id: 'deactivateCustomer' | 'reactivateCustomer', action: 'deactivate' | 'reactivate') =>
  ({
    id,
    method: 'post',
    path: `/v1/merchant/customers/{customerId}/${action}`,
    authorization: manage,
    audience: 'merchant',
    security: ['cookieSession'],
    summary:
      action === 'deactivate'
        ? 'Deactivate a customer: no sign-in, nothing new recorded; every record stays'
        : 'Reactivate a deactivated customer',
    request: { params: customerParams },
    responses: {
      200: { description: 'The customer', schema: Customer },
      ...forbidden('merchant.customers.manage'),
      ...notFound,
      409: error('INVALID_LIFECYCLE_TRANSITION — already so, or the customer’s details were removed'),
    },
  }) as const;

export const deactivateCustomer = defineEndpoint(statusChange('deactivateCustomer', 'deactivate'));
export const reactivateCustomer = defineEndpoint(statusChange('reactivateCustomer', 'reactivate'));

export const assignCustomerAgent = defineEndpoint({
  id: 'assignCustomerAgent',
  method: 'put',
  path: '/v1/merchant/customers/{customerId}/agent',
  authorization: { class: 'permission', permission: 'merchant.customers.assign', branchScope: 'branch' },
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Give a customer to an agent, move them, or take them off their agent (every move recorded)',
  request: { params: customerParams, body: AssignAgentRequest },
  responses: {
    200: { description: 'The customer', schema: Customer },
    ...forbidden('merchant.customers.assign'),
    ...notFound,
    409: error('INVALID_LIFECYCLE_TRANSITION — the customer is not active'),
    422: error('INVALID_AGENT — not an active agent of the business'),
  },
});

export const listCustomerAssignments = defineEndpoint({
  id: 'listCustomerAssignments',
  method: 'get',
  path: '/v1/merchant/customers/{customerId}/assignments',
  authorization: read,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Every agent the customer has had',
  request: { params: customerParams },
  responses: {
    200: { description: 'The history, newest first', schema: CustomerAssignmentList },
    ...forbidden('merchant.customers.read'),
    ...notFound,
  },
});

export const inviteCustomerToApp = defineEndpoint({
  id: 'inviteCustomerToApp',
  method: 'post',
  path: '/v1/merchant/customers/{customerId}/app-invitation',
  authorization: manage,
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'Email the customer the link to the mobile app (a new link replaces an unused one)',
  request: { params: customerParams },
  responses: {
    202: { description: 'Sent — the answer is the same whatever the email address belongs to' },
    ...forbidden('merchant.customers.manage'),
    ...notFound,
    409: error(
      'NO_EMAIL — the customer has no email address; ALREADY_LINKED — the customer already signs in; EMAIL_IN_USE — another customer signs in with this email; INVALID_LIFECYCLE_TRANSITION — the customer is not active',
    ),
    429: rateLimited,
  },
});

export const anonymiseCustomer = defineEndpoint({
  id: 'anonymiseCustomer',
  method: 'post',
  path: '/v1/merchant/customers/{customerId}/anonymisation',
  authorization: {
    class: 'permission',
    permission: 'merchant.customers.anonymise',
    branchScope: 'merchant_wide',
  },
  audience: 'merchant',
  security: ['cookieSession'],
  summary:
    'Remove a customer’s personal details at their request, once nothing is left with the business (BR-11.3; cannot be undone; the owner only)',
  request: { params: customerParams },
  responses: {
    200: { description: 'The customer, without their details', schema: Customer },
    ...forbidden('merchant.customers.anonymise'),
    ...notFound,
    409: error('INVALID_LIFECYCLE_TRANSITION — already removed'),
    422: error('BALANCE_NOT_ZERO — the customer still has savings or a loan with the business'),
  },
});

// ── agents (P7-6: their own customers; the database decides) ──

export const AgentCustomer = Customer.pick({
  customerId: true,
  branchId: true,
  fullName: true,
  phone: true,
  email: true,
  address: true,
  nickname: true,
  status: true,
  createdAt: true,
}).meta({ id: 'AgentCustomer', description: 'One of the agent’s own customers' });
export const AgentCustomerList = z
  .object({ items: z.array(AgentCustomer), nextCursor: z.string().nullable() })
  .meta({ id: 'AgentCustomerList', description: 'The agent’s customers now, oldest first' });
export type AgentCustomerList = z.infer<typeof AgentCustomerList>;
export type AgentCustomer = z.infer<typeof AgentCustomer>;
export const AgentCustomerListQuery = PageQuery.extend({
  search: z.string().trim().min(1).max(100).optional(),
});
export type AgentCustomerListQuery = z.infer<typeof AgentCustomerListQuery>;

export const listAgentCustomers = defineEndpoint({
  id: 'listAgentCustomers',
  method: 'get',
  path: '/v1/agent/customers',
  authorization: { class: 'self' },
  audience: 'agent',
  security: ['bearer'],
  summary: 'The signed-in agent’s own customers',
  request: { query: AgentCustomerListQuery },
  responses: {
    200: { description: 'One page of the agent’s customers', schema: AgentCustomerList },
    400: error('VALIDATION_ERROR; INVALID_CURSOR'),
  },
});

export const createAgentCustomer = defineEndpoint({
  id: 'createAgentCustomer',
  method: 'post',
  path: '/v1/agent/customers',
  authorization: { class: 'self' },
  audience: 'agent',
  security: ['bearer'],
  summary: 'Add a customer in the field; the customer is the agent’s',
  request: { body: AgentCreateCustomerRequest },
  responses: {
    201: { description: 'The customer', schema: AgentCustomer },
    400: error('VALIDATION_ERROR'),
    409: error('PHONE_TAKEN — another customer of the business has this phone number'),
    422: error('INVALID_BRANCH — not an active branch of the business'),
  },
});

// ── the customer audience (owner Q7: email and password, from the business's link) ──

export const CustomerLoginRequest = AgentLoginRequest.meta({ id: 'CustomerLoginRequest' });
export type CustomerLoginRequest = z.infer<typeof CustomerLoginRequest>;
export const CustomerTokens = AgentTokens.meta({
  id: 'CustomerTokens',
  description: 'A signed-in customer session',
});
export type CustomerTokens = z.infer<typeof CustomerTokens>;
/** Saving with several businesses: no session yet — choose one, within 5 minutes, once. */
export const CustomerLoginResponse = AgentLoginResponse.meta({ id: 'CustomerLoginResponse' });
export type CustomerLoginResponse = z.infer<typeof CustomerLoginResponse>;
export const CustomerSelectRequest = AgentSelectRequest.meta({ id: 'CustomerSelectRequest' });
export type CustomerSelectRequest = z.infer<typeof CustomerSelectRequest>;
export const CustomerRefreshRequest = AgentRefreshRequest.meta({ id: 'CustomerRefreshRequest' });
export type CustomerRefreshRequest = z.infer<typeof CustomerRefreshRequest>;

export const CustomerSelf = z
  .object({
    customerId: Id,
    merchant: z.object({ merchantId: Id, name: z.string() }),
    branchId: Id,
    fullName: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    nickname: z.string().nullable(),
  })
  .meta({ id: 'CustomerSelf', description: 'The signed-in customer’s own record and business' });
export type CustomerSelf = z.infer<typeof CustomerSelf>;

export const AcceptCustomerInvitationRequest = z
  .object({
    token: z.string().min(1).max(256),
    email: Email,
    /** A new person chooses their password here; an existing account gives its own. */
    password: NewPassword,
  })
  .meta({ id: 'AcceptCustomerInvitationRequest' });
export type AcceptCustomerInvitationRequest = z.infer<typeof AcceptCustomerInvitationRequest>;

export const customerLogin = defineEndpoint({
  id: 'customerLogin',
  method: 'post',
  path: '/v1/auth/customer/login',
  authorization: { class: 'capability', capability: 'credentials' },
  audience: 'public',
  summary: 'Customer sign-in (mobile): tokens in the body, or the businesses to choose from',
  request: { body: CustomerLoginRequest },
  responses: {
    200: { description: 'Signed in, or a choice is needed', schema: CustomerLoginResponse, headers: NoStore },
    400: error('VALIDATION_ERROR'),
    401: error('INVALID_CREDENTIALS — identical for every reason, including "not a customer"'),
    403: error('EMAIL_VERIFICATION_REQUIRED — only after correct credentials'),
    429: rateLimited,
  },
});

export const customerSelectMembership = defineEndpoint({
  id: 'customerSelectMembership',
  method: 'post',
  path: '/v1/auth/customer/login/select',
  authorization: { class: 'capability', capability: 'selection_challenge' },
  audience: 'public',
  summary: 'Finish customer sign-in by choosing a business (the selection token is used up either way)',
  request: { body: CustomerSelectRequest },
  responses: {
    200: { description: 'Signed in', schema: CustomerTokens, headers: NoStore },
    400: error('VALIDATION_ERROR'),
    401: error('INVALID_OR_EXPIRED_TOKEN — the same for every reason'),
    429: rateLimited,
  },
});

export const customerRefresh = defineEndpoint({
  id: 'customerRefresh',
  method: 'post',
  path: '/v1/auth/customer/refresh',
  authorization: { class: 'capability', capability: 'refresh_token' },
  audience: 'public',
  summary: 'Rotate a customer refresh token: new tokens; the old one is spent (reuse ends the session)',
  request: { body: CustomerRefreshRequest },
  responses: {
    200: { description: 'New tokens', schema: CustomerTokens, headers: NoStore },
    400: error('VALIDATION_ERROR'),
    401: error('INVALID_OR_EXPIRED_TOKEN — the same for every reason (also for another audience’s token)'),
    429: rateLimited,
  },
});

export const acceptCustomerInvitation = defineEndpoint({
  id: 'acceptCustomerInvitation',
  method: 'post',
  path: '/v1/auth/customer/invitation/accept',
  authorization: { class: 'capability', capability: 'invitation_token' },
  audience: 'public',
  summary:
    'Accept a business’s app link: a new person sets their password; an existing account confirms with its own (then sign in)',
  request: { body: AcceptCustomerInvitationRequest },
  responses: {
    204: { description: 'Accepted: the customer can sign in from now on' },
    400: error('INVALID_INVITATION — the same for every reason; or VALIDATION_ERROR'),
    422: error('WEAK_PASSWORD — a new password that is too short or too common'),
    429: rateLimited,
  },
});

export const getCustomerSelf = defineEndpoint({
  id: 'getCustomerSelf',
  method: 'get',
  path: '/v1/customer/me',
  authorization: { class: 'self' },
  audience: 'customer',
  security: ['bearer'],
  summary: 'The signed-in customer’s own record and business, as of this request',
  responses: { 200: { description: 'The customer', schema: CustomerSelf } },
});
