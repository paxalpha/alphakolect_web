# P5 evidence pack — verbatim source excerpts

Companion to `P5_AUDIT_REPORT.md` and `P5_REVIEW_HANDOFF.md`, for a reviewer without repository access. Every
excerpt below is copied **verbatim from the committed tree at `5d8904b7e19f00091bad6c1ee147734cd7e151f4`** (read with `git show`, not from the
working copy), with its real line numbers. Nothing is paraphrased; nothing was edited. Files contain no secrets
(secret-scanned). `legacy/` and environment files are excluded.


## A. Request pipeline: authentication, tenant context, router, registry

### `apps/api/src/platform/http/authenticate.ts` — lines 1–160

Per-request session validation, audiences, CSRF, the AuthContext (report §5).

```ts
  1  import { timingSafeEqual } from 'node:crypto';
  2  import { AUTH_COOKIES, CSRF_HEADER, type EndpointContract } from '@alphakolect/contracts';
  3  import type { Request, RequestHandler } from 'express';
  4  import type { AccessTokens, SessionAudience } from '../../modules/identity/access-tokens.js';
  5  import type { IdentityRepository } from '../../modules/identity/repository.js';
  6  import { AppError } from '../errors.js';
  7  
  8  // Authentication for secured endpoints (TARGET_ARCHITECTURE §3.2, ADR-14 D6, D7). Mounted automatically by the
  9  // router for every endpoint whose contract declares `security`, so a secured endpoint cannot be reached
 10  // without it.
 11  
 12  export type AuthContext = Readonly<{
 13    identityId: string;
 14    sessionId: string;
 15    audience: SessionAudience;
 16    membershipId: string;
 17    /** Tenant of a merchant/agent session (the source of TenantContext); null for platform. */
 18    merchantId: string | null;
 19    scope: 'full' | 'mfa_enrollment';
 20    /** owner | staff | agent for a merchant membership; the platform role for a platform session. Current (T5). */
 21    kind: string;
 22    /** A staff member's role and branch restriction (null branch = all branches); null for everyone else. */
 23    roleId: string | null;
 24    branchId: string | null;
 25    transport: 'cookie' | 'bearer';
 26  }>;
 27  
 28  // Express's request type merges the global Express.Request interface.
 29  declare global {
 30    // eslint-disable-next-line @typescript-eslint/no-namespace
 31    namespace Express {
 32      interface Request {
 33        auth?: AuthContext;
 34      }
 35    }
 36  }
 37  
 38  export type AuthDeps = {
 39    accessTokens: AccessTokens;
 40    identity: IdentityRepository;
 41    /** Origins allowed to make cookie-authenticated state changes (CSRF defence). Empty = none. */
 42    webOrigins: ReadonlySet<string>;
 43  };
 44  
 45  /** D7: which transport each audience may use. */
 46  const COOKIE_AUDIENCES: ReadonlySet<SessionAudience> = new Set(['platform', 'merchant']);
 47  const BEARER_AUDIENCES: ReadonlySet<SessionAudience> = new Set(['agent']);
 48  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
 49  
 50  export function parseCookies(header: string | undefined): Map<string, string> {
 51    const cookies = new Map<string, string>();
 52    for (const part of (header ?? '').split(';')) {
 53      const eq = part.indexOf('=');
 54      if (eq <= 0) continue;
 55      const name = part.slice(0, eq).trim();
 56      if (!cookies.has(name)) cookies.set(name, part.slice(eq + 1).trim());
 57    }
 58    return cookies;
 59  }
 60  
 61  const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
 62  
 63  function sameSecret(a: string | undefined, b: string | undefined): boolean {
 64    if (!a || !b) return false;
 65    const left = Buffer.from(a);
 66    const right = Buffer.from(b);
 67    return left.length === right.length && timingSafeEqual(left, right);
 68  }
 69  
 70  /**
 71   * D7 CSRF defence for a cookie-carrying state change: an allowed Origin, and the CSRF header equal to the CSRF
 72   * cookie (double-submit). Used here and by the refresh endpoint, which is cookie-driven but not authenticated
 73   * by an access token.
 74   */
 75  export function assertCsrf(
 76    req: Request,
 77    cookies: ReadonlyMap<string, string>,
 78    webOrigins: ReadonlySet<string>,
 79  ): void {
 80    const origin = req.headers.origin;
 81    if (
 82      !origin ||
 83      !webOrigins.has(origin) ||
 84      !sameSecret(req.get(CSRF_HEADER), cookies.get(AUTH_COOKIES.csrf))
 85    ) {
 86      throw new AppError(403, 'CSRF_FAILED', 'Request could not be verified');
 87    }
 88  }
 89  
 90  function presentedCredential(req: Request, endpoint: EndpointContract) {
 91    const allowed = new Set(endpoint.security ?? []);
 92    const authorization = req.headers.authorization;
 93    const bearer = authorization?.startsWith('Bearer ')
 94      ? authorization.slice('Bearer '.length).trim()
 95      : undefined;
 96    const cookies = parseCookies(req.headers.cookie);
 97    const cookie = cookies.get(AUTH_COOKIES.access);
 98  
 99    if (bearer && cookie) return null; // ambiguous: refuse rather than guess
100    if (bearer && allowed.has('bearer')) return { token: bearer, transport: 'bearer' as const, cookies };
101    if (cookie && allowed.has('cookieSession')) return { token: cookie, transport: 'cookie' as const, cookies };
102    return null; // includes tokens sent in the query string or body: never read, never accepted
103  }
104  
105  export function authenticate(endpoint: EndpointContract, deps: AuthDeps): RequestHandler {
106    return async function authenticateRequest(req, _res, next) {
107      try {
108        const credential = presentedCredential(req, endpoint);
109        if (!credential) throw unauthenticated();
110  
111        const claims = await deps.accessTokens.verify(credential.token);
112        if (!claims) throw unauthenticated();
113  
114        const transportAllowed =
115          credential.transport === 'cookie'
116            ? COOKIE_AUDIENCES.has(claims.aud)
117            : BEARER_AUDIENCES.has(claims.aud);
118        if (!transportAllowed) throw unauthenticated();
119  
120        if (endpoint.audience !== 'authenticated' && endpoint.audience !== claims.aud) {
121          throw new AppError(403, 'WRONG_AUDIENCE', 'This endpoint is not available to this session');
122        }
123  
124        // Claims are hints: the session, identity and membership are re-validated on every request (§3.2).
125        const session = await deps.identity.validateSession(claims.sid);
126        if (
127          !session ||
128          session.identity_id !== claims.sub ||
129          session.audience !== claims.aud ||
130          session.membership_id !== claims.mid
131        ) {
132          throw unauthenticated();
133        }
134  
135        if (session.scope === 'mfa_enrollment' && endpoint.sessionScope !== 'mfa_enrollment') {
136          throw new AppError(403, 'MFA_ENROLLMENT_REQUIRED', 'Set up two-factor authentication to continue');
137        }
138  
139        if (credential.transport === 'cookie' && !SAFE_METHODS.has(req.method)) {
140          assertCsrf(req, credential.cookies, deps.webOrigins);
141        }
142  
143        req.auth = Object.freeze({
144          identityId: session.identity_id,
145          sessionId: claims.sid,
146          audience: session.audience,
147          membershipId: session.membership_id,
148          merchantId: session.merchant_id,
149          scope: session.scope,
150          kind: session.kind,
151          roleId: session.role_id,
152          branchId: session.branch_id,
153          transport: credential.transport,
154        });
155        next();
156      } catch (err) {
157        next(err);
158      }
159    };
160  }
```

### `apps/api/src/platform/tenant.ts` — lines 1–82

TenantContext, withTenant/scopeOf, requireOwner — the T9 interim check (report §6, §8).

```ts
 1  import type { Db, Queryable } from './db.js';
 2  import { AppError } from './errors.js';
 3  import type { AuthContext } from './http/authenticate.js';
 4  
 5  // TenantContext and tenant-scoped transactions (TARGET_ARCHITECTURE §4, ADR-15 T3, T5, T14).
 6  //
 7  // A request's tenant comes only from its authenticated session's membership, re-validated on this very request
 8  // (identity.validate_session) — never from a client-supplied merchant id, which no tenant contract accepts.
 9  // Tenant data is reached only through a TenantTx: a transaction that has set app.merchant_id locally (so RLS
10  // applies) and carries the TenantContext it was opened for. Scoped repositories take a TenantTx and call
11  // `scopeOf(tx)`, which refuses anything that `withTenant` did not create — an unscoped query object cannot reach
12  // tenant data through them.
13  
14  export type MembershipKind = 'owner' | 'staff' | 'agent';
15  
16  export type TenantContext = Readonly<{
17    merchantId: string;
18    identityId: string;
19    membershipId: string;
20    sessionId: string;
21    audience: 'merchant' | 'agent';
22    kind: MembershipKind;
23    /** Staff only: their merchant-defined role (data only until P5). */
24    roleId: string | null;
25    /** Staff only: the one branch they are restricted to; null = all branches (ADR-15 T7). */
26    branchId: string | null;
27  }>;
28  
29  export type TenantTx = Queryable & { readonly tenant: TenantContext };
30  
31  const MEMBERSHIP_KINDS: ReadonlySet<string> = new Set(['owner', 'staff', 'agent']);
32  
33  /** The TenantContext of an authenticated merchant or agent session; refuses any other session. */
34  export function tenantContextOf(auth: AuthContext | undefined): TenantContext {
35    if (
36      !auth ||
37      (auth.audience !== 'merchant' && auth.audience !== 'agent') ||
38      !auth.merchantId ||
39      !MEMBERSHIP_KINDS.has(auth.kind)
40    ) {
41      // Unreachable through the router (audience-checked endpoints); a programming error if it ever happens.
42      throw new Error('A tenant endpoint was reached without a merchant or agent session');
43    }
44    return Object.freeze({
45      merchantId: auth.merchantId,
46      identityId: auth.identityId,
47      membershipId: auth.membershipId,
48      sessionId: auth.sessionId,
49      audience: auth.audience,
50      kind: auth.kind as MembershipKind,
51      roleId: auth.roleId,
52      branchId: auth.branchId,
53    });
54  }
55  
56  const opened = new WeakSet<TenantTx>();
57  
58  /** Run `fn` in one transaction scoped to the tenant: app.merchant_id is set locally before anything else. */
59  export function withTenant<T>(db: Db, tenant: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
60    return db.transaction(async (raw) => {
61      await raw.query(`SELECT set_config('app.merchant_id', $1, true)`, [tenant.merchantId]);
62      const tx: TenantTx = Object.freeze({ query: raw.query.bind(raw), tenant });
63      opened.add(tx);
64      return fn(tx);
65    });
66  }
67  
68  /** For scoped repositories: the tenant of a transaction opened by `withTenant` — anything else is refused. */
69  export function scopeOf(tx: TenantTx): TenantContext {
70    if (!opened.has(tx)) throw new Error('Tenant data requires a transaction opened by withTenant');
71    return tx.tenant;
72  }
73  
74  /**
75   * ADR-15 T9, the P4 interim check, kept in this one place: merchant-management endpoints require the owner.
76   * Replaced wholesale by P5 policies — not a permission system.
77   */
78  export function requireOwner(tenant: TenantContext): void {
79    if (tenant.kind !== 'owner') {
80      throw new AppError(403, 'FORBIDDEN', 'Only the business owner can do this');
81    }
82  }
```

### `apps/api/src/platform/http/routes.ts` — lines 1–37

Router built from the contract registry (report §8 G1).

```ts
 1  import { endpoints, type EndpointContract, type EndpointId } from '@alphakolect/contracts';
 2  import { Router, type RequestHandler } from 'express';
 3  import { needsValidation, validateRequest } from './validate.js';
 4  
 5  // Every HTTP route comes from the contract registry (packages/contracts). The Handlers type requires a
 6  // handler for every registered endpoint (a missing one is a compile error), and test/route-parity.test.ts
 7  // fails if any Express route exists that is not in the registry. Every endpoint whose contract declares
 8  // `security` gets the authentication middleware mounted in front of its handler — it cannot be left out — and
 9  // every endpoint with a request body gets that body validated against its contract schema.
10  
11  export type Handlers = { [K in EndpointId]: RequestHandler };
12  
13  export const API_PREFIX = '/v1';
14  
15  /** '/v1/merchant/branches/{branchId}' -> '/merchant/branches/:branchId' (relative to the /v1 mount). */
16  export function toExpressPath(contractPath: string): string {
17    const relative = contractPath.slice(API_PREFIX.length).replace(/\{([A-Za-z]+)\}/g, ':$1');
18    return relative === '' ? '/' : relative;
19  }
20  
21  export function buildV1Router(
22    handlers: Handlers,
23    authenticateFor: (endpoint: EndpointContract) => RequestHandler,
24  ): Router {
25    const router = Router();
26    for (const id of Object.keys(endpoints) as EndpointId[]) {
27      const endpoint: EndpointContract = endpoints[id];
28      // Authentication first: an unauthenticated caller learns nothing from validation errors.
29      const chain = [
30        ...(endpoint.security?.length ? [authenticateFor(endpoint)] : []),
31        ...(needsValidation(endpoint) ? [validateRequest(endpoint)] : []),
32        handlers[id],
33      ];
34      router[endpoint.method](toExpressPath(endpoint.path), ...chain);
35    }
36    return router;
37  }
```

### `packages/contracts/src/registry.ts` — lines 1–59

Endpoint contract shape: no permission metadata (report §8 G1).

```ts
 1  import type { z } from 'zod';
 2  
 3  // The endpoint registry: every API endpoint is described here exactly once (TARGET_ARCHITECTURE §17).
 4  // The OpenAPI document is generated from it, and apps/api mounts its routes from it; a parity test in
 5  // apps/api fails if an Express route has no contract or a contract has no route.
 6  
 7  /**
 8   * Who an endpoint is for (§3.1, §17). `public` = no session (e.g. health); `authenticated` = any signed-in
 9   * audience (e.g. logout, current session). Secured endpoints reject sessions of other audiences.
10   */
11  export type Audience =
12    'public' | 'authenticated' | 'platform' | 'merchant' | 'agent' | 'customer' | 'webhook';
13  
14  export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
15  
16  /**
17   * How a caller authenticates (ADR-14 D7): `cookieSession` for the web audiences (platform, merchant) —
18   * state-changing requests must also send the CSRF header — and `bearer` for the mobile audiences
19   * (agent, customer). An endpoint lists the schemes it accepts; omitting `security` means no authentication.
20   */
21  export type SecurityScheme = 'cookieSession' | 'bearer';
22  
23  export type ResponseContract = {
24    description: string;
25    /** Omitted for responses without a body (e.g. 204). */
26    schema?: z.ZodType;
27    /** Response headers, e.g. Set-Cookie or Retry-After. */
28    headers?: z.ZodObject;
29  };
30  
31  export type ResponseStatus = 200 | 201 | 202 | 204 | 400 | 401 | 403 | 404 | 409 | 422 | 423 | 429;
32  
33  export type EndpointContract = {
34    /** Stable operation id, used by clients and in the OpenAPI document. */
35    id: string;
36    method: HttpMethod;
37    /** OpenAPI path template, always under /v1, e.g. /v1/merchant/branches/{branchId}. */
38    path: `/v1/${string}`;
39    audience: Audience;
40    summary: string;
41    /** Accepted authentication schemes (any one suffices). Omitted = no authentication required. */
42    security?: readonly SecurityScheme[];
43    /**
44     * Secured endpoints accept only full sessions by default. 'mfa_enrollment' also admits the short-lived
45     * enrolment-only platform session (ADR-14 D8) — used solely by the TOTP enrolment endpoints.
46     */
47    sessionScope?: 'mfa_enrollment';
48    request?: {
49      params?: z.ZodObject;
50      query?: z.ZodObject;
51      headers?: z.ZodObject;
52      body?: z.ZodType;
53    };
54    /** Success and endpoint-specific error responses. Every endpoint also gets the standard error envelope. */
55    responses: Partial<Record<ResponseStatus, ResponseContract>>;
56  };
57  
58  /** Identity helper that keeps literal types (paths, methods) for typed consumers. */
59  export const defineEndpoint = <const T extends EndpointContract>(endpoint: T): T => endpoint;
```

## B. Where owner authority is decided in the API (13 requireOwner call sites)

### `apps/api/src/modules/tenancy/merchant-settings.ts` — lines 40–195

Profile, branches, roles: app-only authority (report §6 authority map).

```ts
 40    status: row.status,
 41    createdAt: row.created_at.toISOString(),
 42    archivedAt: row.archived_at?.toISOString() ?? null,
 43  });
 44  export const toBranch = (row: CatalogRow): Branch => ({ branchId: row.id, ...toItem(row) });
 45  export const toRole = (row: CatalogRow): Role => ({ roleId: row.id, ...toItem(row) });
 46  
 47  export class MerchantSettingsService {
 48    constructor(private readonly deps: { db: Db; audit: Pick<AuditLog, 'record' | 'recordWithin'> }) {}
 49  
 50    /** Any member: their own membership and business, as of this request. */
 51    async currentMembership(tenant: TenantContext): Promise<CurrentMembership> {
 52      const { membership, merchant } = await withTenant(this.deps.db, tenant, async (tx) => ({
 53        membership: await repo.membership(tx),
 54        merchant: await repo.merchant(tx),
 55      }));
 56      // validate_session established both on this request; absent only if changed in between.
 57      if (!membership || !merchant) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
 58      return {
 59        membershipId: membership.id,
 60        kind: membership.kind,
 61        roleId: membership.role_id,
 62        branchId: membership.branch_id,
 63        merchant: toProfile(merchant),
 64      };
 65    }
 66  
 67    async profile(tenant: TenantContext): Promise<MerchantProfile> {
 68      requireOwner(tenant);
 69      const merchant = await withTenant(this.deps.db, tenant, (tx) => repo.merchant(tx));
 70      if (!merchant) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
 71      return toProfile(merchant);
 72    }
 73  
 74    async rename(tenant: TenantContext, name: string, ctx: RequestContext): Promise<MerchantProfile> {
 75      await this.ownerOrDenied(tenant, 'merchant.profile_updated', 'merchant', tenant.merchantId, ctx);
 76      const merchant = await withTenant(this.deps.db, tenant, async (tx) => {
 77        const row = await repo.renameMerchant(tx, name);
 78        if (row) {
 79          await this.deps.audit.recordWithin(tx, {
 80            ...this.event(tenant, 'merchant.profile_updated', 'merchant', row.id, ctx),
 81            outcome: 'success',
 82            summary: { name: row.name },
 83          });
 84        }
 85        return row;
 86      });
 87      if (!merchant) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
 88      return toProfile(merchant);
 89    }
 90  
 91    async list(tenant: TenantContext, table: CatalogTable): Promise<CatalogRow[]> {
 92      requireOwner(tenant);
 93      return withTenant(this.deps.db, tenant, (tx) => repo.listCatalog(tx, table));
 94    }
 95  
 96    async get(tenant: TenantContext, table: CatalogTable, id: string): Promise<CatalogRow> {
 97      requireOwner(tenant);
 98      const row = await withTenant(this.deps.db, tenant, (tx) => repo.getCatalogItem(tx, table, id));
 99      if (!row) throw notFound(table);
100      return row;
101    }
102  
103    async create(
104      tenant: TenantContext,
105      table: CatalogTable,
106      name: string,
107      ctx: RequestContext,
108    ): Promise<CatalogRow> {
109      const action = `merchant.${ITEM[table]}_created`;
110      await this.ownerOrDenied(tenant, action, ITEM[table], null, ctx);
111      try {
112        return await withTenant(this.deps.db, tenant, async (tx) => {
113          const row = await repo.createCatalogItem(tx, table, name);
114          await this.deps.audit.recordWithin(tx, {
115            ...this.event(tenant, action, ITEM[table], row.id, ctx),
116            outcome: 'success',
117            summary: { name: row.name },
118          });
119          return row;
120        });
121      } catch (err) {
122        throw err instanceof NameTakenError ? nameTaken(table) : err;
123      }
124    }
125  
126    async update(
127      tenant: TenantContext,
128      table: CatalogTable,
129      id: string,
130      change: UpdateCatalogItemRequest,
131      ctx: RequestContext,
132    ): Promise<CatalogRow> {
133      const action = `merchant.${ITEM[table]}_updated`;
134      await this.ownerOrDenied(tenant, action, ITEM[table], id, ctx);
135      let row: CatalogRow | null;
136      try {
137        row = await withTenant(this.deps.db, tenant, async (tx) => {
138          const updated = await repo.updateCatalogItem(tx, table, id, change);
139          if (updated) {
140            await this.deps.audit.recordWithin(tx, {
141              ...this.event(tenant, action, ITEM[table], updated.id, ctx),
142              outcome: 'success',
143              summary: { name: updated.name, status: updated.status },
144            });
145          }
146          return updated;
147        });
148      } catch (err) {
149        throw err instanceof NameTakenError ? nameTaken(table) : err;
150      }
151      if (!row) throw notFound(table);
152      return row;
153    }
154  
155    /** T9: only the owner changes settings. A refused attempt is audited (in the caller's own tenant). */
156    private async ownerOrDenied(
157      tenant: TenantContext,
158      action: string,
159      targetType: string,
160      targetId: string | null,
161      ctx: RequestContext,
162    ): Promise<void> {
163      try {
164        requireOwner(tenant);
165      } catch (err) {
166        await this.deps.audit.record({
167          ...this.event(tenant, action, targetType, targetId, ctx),
168          outcome: 'denied',
169          summary: { reason: 'not_owner', kind: tenant.kind },
170        });
171        throw err;
172      }
173    }
174  
175    private event(
176      tenant: TenantContext,
177      action: string,
178      targetType: string,
179      targetId: string | null,
180      ctx: RequestContext,
181    ) {
182      return {
183        action,
184        merchantId: tenant.merchantId,
185        actorIdentityId: tenant.identityId,
186        actorAudience: tenant.audience,
187        actorMembershipId: tenant.membershipId,
188        targetType,
189        targetId,
190        ip: ctx.ip,
191        userAgent: ctx.userAgent,
192        requestId: ctx.requestId,
193      };
194    }
195  }
```

### `apps/api/src/modules/tenancy/memberships.ts` — lines 60–136

Members: API check + SQL check.

```ts
 60    }
 61  }
 62  
 63  export class MembershipService {
 64    constructor(private readonly deps: { db: Db; audit: Pick<AuditLog, 'record' | 'recordWithin'> }) {}
 65  
 66    async list(tenant: TenantContext): Promise<MemberRow[]> {
 67      requireOwner(tenant);
 68      return withTenant(this.deps.db, tenant, (tx) => repo.members(tx));
 69    }
 70  
 71    async get(tenant: TenantContext, membershipId: string): Promise<MemberRow> {
 72      requireOwner(tenant);
 73      const [row] = await withTenant(this.deps.db, tenant, (tx) => repo.members(tx, membershipId));
 74      if (!row) throw new AppError(404, 'NOT_FOUND', 'Member not found');
 75      return row;
 76    }
 77  
 78    async change(
 79      tenant: TenantContext,
 80      membershipId: string,
 81      action: MembershipAction,
 82      assignment: AssignMemberRequest | null,
 83      ctx: RequestContext,
 84    ): Promise<MemberRow> {
 85      const event = {
 86        action: AUDIT_ACTION[action],
 87        merchantId: tenant.merchantId,
 88        actorIdentityId: tenant.identityId,
 89        actorAudience: tenant.audience,
 90        actorMembershipId: tenant.membershipId,
 91        targetType: 'membership',
 92        targetId: membershipId,
 93        ip: ctx.ip,
 94        userAgent: ctx.userAgent,
 95        requestId: ctx.requestId,
 96      };
 97      try {
 98        requireOwner(tenant);
 99      } catch (err) {
100        await this.deps.audit.record({
101          ...event,
102          outcome: 'denied',
103          summary: { reason: 'not_owner', kind: tenant.kind },
104        });
105        throw err;
106      }
107  
108      const result = await withTenant(this.deps.db, tenant, async (tx) => {
109        const change = await repo.changeMembership(tx, membershipId, action, assignment);
110        if (change.outcome !== 'ok') return { change, member: null };
111        const [member] = await repo.members(tx, membershipId);
112        await this.deps.audit.recordWithin(tx, {
113          ...event,
114          outcome: 'success',
115          summary: {
116            kind: member!.kind,
117            status: member!.status,
118            roleId: member!.role_id,
119            branchId: member!.branch_id,
120          },
121        });
122        return { change, member: member! };
123      });
124  
125      if (result.change.outcome !== 'ok') {
126        const outcome = result.change.outcome;
127        await this.deps.audit.record({
128          ...event,
129          outcome: outcome === 'forbidden' || outcome === 'owner_protected' ? 'denied' : 'failure',
130          summary: { reason: outcome },
131        });
132        throw refusal(outcome, action);
133      }
134      return result.member!;
135    }
136  }
```

### `apps/api/src/modules/tenancy/invitations.ts` — lines 55–239

Invitations: API check + SQL check; acceptance.

```ts
 55    webAppUrl: string;
 56  };
 57  
 58  export class InvitationService {
 59    constructor(private readonly deps: InvitationDeps) {}
 60  
 61    async list(tenant: TenantContext): Promise<InvitationRow[]> {
 62      requireOwner(tenant);
 63      return withTenant(this.deps.db, tenant, (tx) => repo.invitations(tx));
 64    }
 65  
 66    async create(
 67      tenant: TenantContext,
 68      input: CreateInvitationRequest,
 69      ctx: RequestContext,
 70    ): Promise<InvitationRow> {
 71      const { db, audit, limiter, mailer, webAppUrl } = this.deps;
 72      const event = this.event(tenant, 'merchant.invitation_issued', null, ctx);
 73      await this.ownerOrDenied(tenant, event);
 74      await limiter.enforce('invitation_issue', ctx.ip, tenant.merchantId);
 75  
 76      const token = newOpaqueToken();
 77      const setup = newOpaqueToken();
 78      const result = await withTenant(db, tenant, async (tx) => {
 79        const issued = await repo.issueInvitation(
 80          tx,
 81          {
 82            email: input.email,
 83            kind: input.kind,
 84            roleId: input.roleId ?? null,
 85            branchId: input.branchId ?? null,
 86          },
 87          token.hash,
 88          setup.hash,
 89          INVITATION_TTL_SECONDS,
 90        );
 91        if (issued.outcome !== 'ok') return { issued, row: null, business: null };
 92        const [row] = await repo.invitations(tx, issued.invitation_id);
 93        const business = await repo.merchant(tx);
 94        await audit.recordWithin(tx, {
 95          ...event,
 96          targetId: row!.id,
 97          outcome: 'success',
 98          // Internal record only: which delivery says whether the email had an account (never told to the owner).
 99          summary: {
100            kind: row!.kind,
101            roleId: row!.role_id,
102            branchId: row!.branch_id,
103            delivery: issued.delivery,
104          },
105        });
106        return { issued, row: row!, business: business! };
107      });
108  
109      const { issued, row, business } = result;
110      if (issued.outcome !== 'ok') {
111        await audit.record({
112          ...event,
113          outcome: issued.outcome === 'forbidden' ? 'denied' : 'failure',
114          summary: { reason: issued.outcome },
115        });
116        if (issued.outcome === 'forbidden') {
117          throw new AppError(403, 'FORBIDDEN', 'Only the business owner can do this');
118        }
119        throw issued.outcome === 'already_member'
120          ? new AppError(409, 'ALREADY_MEMBER', 'This person is already a member of the business')
121          : new AppError(409, 'INVALID_ASSIGNMENT', 'The role or branch is not an active one of this business');
122      }
123  
124      // Sent only after the commit: an email never announces an invitation that does not exist.
125      if (issued.delivery === 'setup') {
126        mailer.dispatch(invitationSetupEmail(row!.email, webAppUrl, setup.raw, business!.name));
127      } else if (issued.delivery === 'accept') {
128        mailer.dispatch(invitationAcceptEmail(row!.email, webAppUrl, token.raw, business!.name));
129      }
130      return row!;
131    }
132  
133    async revoke(tenant: TenantContext, invitationId: string, ctx: RequestContext): Promise<InvitationRow> {
134      const { db, audit } = this.deps;
135      const event = this.event(tenant, 'merchant.invitation_revoked', invitationId, ctx);
136      await this.ownerOrDenied(tenant, event);
137  
138      const result = await withTenant(db, tenant, async (tx) => {
139        const outcome = await repo.revokeInvitation(tx, invitationId);
140        if (outcome !== 'ok') return { outcome, row: null };
141        const [row] = await repo.invitations(tx, invitationId);
142        await audit.recordWithin(tx, { ...event, outcome: 'success', summary: { kind: row!.kind } });
143        return { outcome, row: row! };
144      });
145      if (result.outcome !== 'ok') {
146        await audit.record({
147          ...event,
148          outcome: result.outcome === 'forbidden' ? 'denied' : 'failure',
149          summary: { reason: result.outcome },
150        });
151        switch (result.outcome) {
152          case 'forbidden':
153            throw new AppError(403, 'FORBIDDEN', 'Only the business owner can do this');
154          case 'not_found':
155            throw new AppError(404, 'NOT_FOUND', 'Invitation not found');
156          case 'invalid_transition':
157            throw new AppError(409, 'INVALID_LIFECYCLE_TRANSITION', 'The invitation is no longer pending');
158        }
159      }
160      return result.row!;
161    }
162  
163    /** T11: an existing account joins with the invitation link and its password. */
164    async accept(input: AcceptInvitationRequest, ctx: RequestContext): Promise<void> {
165      const { db, identity, audit, limiter } = this.deps;
166      await limiter.enforce('invitation_accept', ctx.ip, input.email);
167  
168      const candidate = await identity.loginIdentity(input.email);
169      // D12: an unknown account costs the same password check as a known one and fails identically.
170      const passwordOk = candidate?.password_hash
171        ? await verifyPassword(input.password, candidate.password_hash)
172        : await burnPasswordCheck(input.password);
173      const tokenHash = hashReceivedToken(input.token);
174  
175      const event = {
176        action: 'auth.invitation_accepted',
177        actorIdentityId: candidate?.identity_id ?? null,
178        ip: ctx.ip,
179        userAgent: ctx.userAgent,
180        requestId: ctx.requestId,
181      };
182      const fail = async (reason: string) => {
183        await audit.record({ ...event, outcome: 'failure', summary: { reason } });
184        return invalidInvitation();
185      };
186  
187      if (!candidate || !passwordOk) throw await fail(candidate ? 'wrong_password' : 'unknown_account');
188      if (!tokenHash) throw await fail('malformed_token');
189  
190      const [result] = await db.query<{
191        outcome: string;
192        membership_id: string | null;
193        merchant_id: string | null;
194        invitation_id: string | null;
195      }>(`SELECT outcome, membership_id, merchant_id, invitation_id FROM tenancy.accept_invitation($1, $2)`, [
196        tokenHash,
197        candidate.identity_id,
198      ]);
199      if (result!.outcome !== 'ok') throw await fail(result!.outcome);
200  
201      await audit.record({
202        ...event,
203        merchantId: result!.merchant_id,
204        actorMembershipId: result!.membership_id,
205        targetType: 'invitation',
206        targetId: result!.invitation_id,
207        outcome: 'success',
208        summary: {},
209      });
210    }
211  
212    private async ownerOrDenied(tenant: TenantContext, event: ReturnType<InvitationService['event']>) {
213      try {
214        requireOwner(tenant);
215      } catch (err) {
216        await this.deps.audit.record({
217          ...event,
218          outcome: 'denied',
219          summary: { reason: 'not_owner', kind: tenant.kind },
220        });
221        throw err;
222      }
223    }
224  
225    private event(tenant: TenantContext, action: string, targetId: string | null, ctx: RequestContext) {
226      return {
227        action,
228        merchantId: tenant.merchantId,
229        actorIdentityId: tenant.identityId,
230        actorAudience: tenant.audience,
231        actorMembershipId: tenant.membershipId,
232        targetType: 'invitation',
233        targetId,
234        ip: ctx.ip,
235        userAgent: ctx.userAgent,
236        requestId: ctx.requestId,
237      };
238    }
239  }
```

### `apps/api/src/modules/tenancy/merchant-lifecycle.ts` — lines 70–194

Platform actions: SQL authority only.

```ts
 70    }
 71  }
 72  
 73  export class MerchantLifecycleService {
 74    constructor(private readonly deps: { db: Db; audit: Pick<AuditLog, 'record' | 'recordWithin'> }) {}
 75  
 76    async change(
 77      auth: AuthContext,
 78      merchantId: string,
 79      action: Action,
 80      reason: string | null,
 81      ctx: RequestContext,
 82    ): Promise<MerchantLifecycle> {
 83      const { db, audit } = this.deps;
 84      const event = {
 85        action: AUDIT_ACTION[action],
 86        actorIdentityId: auth.identityId,
 87        actorAudience: auth.audience,
 88        actorMembershipId: auth.membershipId,
 89        targetType: 'merchant',
 90        targetId: merchantId,
 91        ip: ctx.ip,
 92        userAgent: ctx.userAgent,
 93        requestId: ctx.requestId,
 94      };
 95  
 96      const row = await db.transaction(async (tx) => {
 97        await tx.query(`SELECT set_config('app.merchant_id', $1, true)`, [merchantId]);
 98        const [result] = await tx.query<Row>(
 99          `SELECT outcome, status FROM tenancy.set_merchant_status($1, $2, $3, $4)`,
100          [auth.sessionId, merchantId, action, reason],
101        );
102        if (result!.outcome === 'ok') {
103          // Same transaction: if this insert fails, the status change rolls back with it.
104          await audit.recordWithin(tx, {
105            ...event,
106            merchantId,
107            outcome: 'success',
108            summary: { status: result!.status, ...(action === 'deactivate' ? { reason } : {}) },
109          });
110        }
111        return result!;
112      });
113  
114      if (row.outcome !== 'ok') {
115        // Nothing changed; the refused attempt is recorded on its own (tenant-less: the target may not exist).
116        await audit.record({
117          ...event,
118          outcome: row.outcome === 'forbidden' ? 'denied' : 'failure',
119          summary: { reason: row.outcome },
120        });
121        throw refusal(row.outcome, row.status);
122      }
123      return { merchantId, status: row.status! };
124    }
125  
126    /**
127     * ADR-15 T17: one database transaction — tenancy.transfer_ownership (authority from the session, demote then
128     * promote) and the audit row naming both identities. A refusal changes nothing and is audited on its own.
129     */
130    async transferOwnership(
131      auth: AuthContext,
132      merchantId: string,
133      input: TransferOwnershipRequest,
134      ctx: RequestContext,
135    ): Promise<OwnershipTransferred> {
136      const { db, audit } = this.deps;
137      const event = {
138        action: 'platform.ownership_transferred',
139        actorIdentityId: auth.identityId,
140        actorAudience: auth.audience,
141        actorMembershipId: auth.membershipId,
142        targetType: 'merchant',
143        targetId: merchantId,
144        ip: ctx.ip,
145        userAgent: ctx.userAgent,
146        requestId: ctx.requestId,
147      };
148  
149      const row = await db.transaction(async (tx) => {
150        await tx.query(`SELECT set_config('app.merchant_id', $1, true)`, [merchantId]);
151        const [result] = await tx.query<TransferRow>(
152          `SELECT outcome, former_owner_membership_id, former_owner_identity_id, new_owner_identity_id
153             FROM tenancy.transfer_ownership($1, $2, $3, $4, $5)`,
154          [
155            auth.sessionId,
156            merchantId,
157            input.newOwnerMembershipId,
158            input.formerOwnerRoleId,
159            input.deactivateFormerOwner,
160          ],
161        );
162        if (result!.outcome === 'ok') {
163          await audit.recordWithin(tx, {
164            ...event,
165            merchantId,
166            outcome: 'success',
167            summary: {
168              formerOwnerIdentityId: result!.former_owner_identity_id,
169              formerOwnerMembershipId: result!.former_owner_membership_id,
170              newOwnerIdentityId: result!.new_owner_identity_id,
171              newOwnerMembershipId: input.newOwnerMembershipId,
172              formerOwnerRoleId: input.formerOwnerRoleId,
173              formerOwnerDeactivated: input.deactivateFormerOwner,
174            },
175          });
176        }
177        return result!;
178      });
179  
180      if (row.outcome !== 'ok') {
181        await audit.record({
182          ...event,
183          outcome: row.outcome === 'forbidden' ? 'denied' : 'failure',
184          summary: { reason: row.outcome },
185        });
186        throw transferRefusal(row.outcome);
187      }
188      return {
189        merchantId,
190        ownerMembershipId: input.newOwnerMembershipId,
191        formerOwnerMembershipId: row.former_owner_membership_id!,
192      };
193    }
194  }
```

## C. Where authority is decided in SQL (hard-coded owner / super_admin)

### `packages/db/prisma/migrations/20261010000200_session_context/migration.sql` — lines 1–33

identity.validate_session — the per-request check (report §5).

```sql
 1  -- P4.4: the per-request session check returns the membership's kind, role and branch (TARGET_ARCHITECTURE ADR-15 T5).
 2  --
 3  -- The API builds its TenantContext from this — never from claims or client input — on every request, so a role or
 4  -- branch change, like a deactivation, applies to the very next request. Same checks as before (identity active,
 5  -- session live, membership active, merchant active via identity.active_membership); three more columns.
 6  --
 7  -- A changed result type requires DROP + CREATE; the grant is restored below. tenancy.set_merchant_status (P4.1) reads
 8  -- identity_id, membership_id, audience and scope by name at run time and is unaffected.
 9  
10  DROP FUNCTION "identity"."validate_session"(uuid);
11  
12  CREATE FUNCTION "identity"."validate_session"(p_session_id uuid)
13  RETURNS TABLE (
14    identity_id uuid, audience text, membership_id uuid, merchant_id uuid, scope text,
15    kind text, role_id uuid, branch_id uuid
16  )
17  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
18  AS $fn$
19    SELECT s.identity_id, s.audience, coalesce(s.platform_membership_id, s.merchant_membership_id), mm.merchant_id,
20           s.scope,
21           coalesce(mm.kind, pm.role), mm.role_id, mm.branch_id
22      FROM identity.sessions s
23      JOIN identity.identities i ON i.id = s.identity_id AND i.status = 'active'
24      LEFT JOIN tenancy.merchant_memberships mm ON mm.id = s.merchant_membership_id
25      LEFT JOIN identity.platform_memberships pm ON pm.id = s.platform_membership_id
26     WHERE s.id = p_session_id
27       AND s.revoked_at IS NULL
28       AND s.absolute_expires_at > now()
29       AND identity.active_membership(s.identity_id, s.audience, coalesce(s.platform_membership_id, s.merchant_membership_id)) IS NOT NULL;
30  $fn$;
31  
32  REVOKE ALL ON FUNCTION "identity"."validate_session"(uuid) FROM PUBLIC;
33  GRANT EXECUTE ON FUNCTION "identity"."validate_session"(uuid) TO alphakolect_app;
```

### `packages/db/prisma/migrations/20261011000200_membership_management/migration.sql` — lines 1–130

list_members / update_membership: kind = owner at lines 31, 62.

```sql
  1  -- P4.5: the owner manages their business's memberships (TARGET_ARCHITECTURE ADR-15 T5, T7–T9, T13, T15).
  2  --
  3  -- The app role has SELECT only on tenancy.merchant_memberships and no access to identity data (D4), so both
  4  -- operations are SECURITY DEFINER functions. Authority comes from the caller's session, decided here, not from
  5  -- arguments: identity.validate_session must report a live, full-scope merchant session whose membership is the
  6  -- active OWNER of an active merchant (T9) — and the merchant is that session's, never a parameter (T3). A
  7  -- membership of another merchant is "not found", exactly like one that does not exist (T15).
  8  --
  9  --   tenancy.list_members(session, membership?)  the members, with their email (one, or all)
 10  --   tenancy.update_membership(session, membership, action, role, branch)
 11  --       assign      staff only: an active role of this merchant, and an active branch of it or NULL (= all)
 12  --       deactivate  active → deactivated; the membership's sessions are revoked
 13  --       reactivate  deactivated → active (a new sign-in is needed: the old sessions stay revoked)
 14  --     never the owner's row (ownership changes only by platform transfer, T17); never sets kind.
 15  --
 16  -- Concurrency: the merchant row is locked FOR SHARE and the session re-validated under that lock, so a concurrent
 17  -- ownership transfer (which locks the merchant FOR UPDATE) is either complete — and seen — or not begun. The target
 18  -- membership is locked FOR UPDATE; an assigned role and branch FOR SHARE, so they cannot be archived meanwhile.
 19  
 20  CREATE FUNCTION "tenancy"."list_members"(p_session_id uuid, p_membership_id uuid DEFAULT NULL)
 21  RETURNS TABLE (
 22    membership_id uuid, kind text, status text, role_id uuid, branch_id uuid, email text,
 23    created_at timestamptz, deactivated_at timestamptz
 24  )
 25  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
 26  AS $fn$
 27    SELECT mm.id, mm.kind, mm.status, mm.role_id, mm.branch_id, i.email, mm.created_at, mm.deactivated_at
 28      FROM identity.validate_session(p_session_id) v
 29      JOIN tenancy.merchant_memberships mm ON mm.merchant_id = v.merchant_id
 30      JOIN identity.identities i ON i.id = mm.identity_id
 31     WHERE v.audience = 'merchant' AND v.scope = 'full' AND v.kind = 'owner'
 32       AND (p_membership_id IS NULL OR mm.id = p_membership_id)
 33     ORDER BY mm.created_at, mm.id;
 34  $fn$;
 35  
 36  REVOKE ALL ON FUNCTION "tenancy"."list_members"(uuid, uuid) FROM PUBLIC;
 37  GRANT EXECUTE ON FUNCTION "tenancy"."list_members"(uuid, uuid) TO alphakolect_app;
 38  
 39  CREATE FUNCTION "tenancy"."update_membership"(
 40    p_session_id uuid, p_membership_id uuid, p_action text, p_role_id uuid, p_branch_id uuid
 41  )
 42  RETURNS TABLE (
 43    outcome text, membership_id uuid, kind text, status text, role_id uuid, branch_id uuid
 44  )
 45  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
 46  AS $fn$
 47  DECLARE
 48    v_merchant uuid;
 49    v_target tenancy.merchant_memberships%ROWTYPE;
 50  BEGIN
 51    IF p_action NOT IN ('assign', 'deactivate', 'reactivate') THEN
 52      RAISE EXCEPTION 'unknown membership action' USING ERRCODE = 'check_violation';
 53    END IF;
 54  
 55    -- Which business: the session's. Whether the caller may act is decided only after locking it (below).
 56    SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v
 57     WHERE v.audience = 'merchant';
 58    IF v_merchant IS NOT NULL THEN
 59      PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
 60      -- Authority, under the lock: an ownership transfer that committed meanwhile is visible now.
 61      SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v
 62       WHERE v.audience = 'merchant' AND v.scope = 'full' AND v.kind = 'owner' AND v.merchant_id = v_merchant;
 63    END IF;
 64    IF v_merchant IS NULL THEN
 65      RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
 66      RETURN;
 67    END IF;
 68  
 69    SELECT * INTO v_target FROM tenancy.merchant_memberships mm
 70     WHERE mm.id = p_membership_id AND mm.merchant_id = v_merchant
 71       FOR UPDATE;
 72    IF NOT FOUND THEN
 73      RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
 74      RETURN;
 75    END IF;
 76    IF v_target.kind = 'owner' THEN
 77      RETURN QUERY SELECT 'owner_protected', v_target.id, v_target.kind, v_target.status, v_target.role_id,
 78                          v_target.branch_id;
 79      RETURN;
 80    END IF;
 81  
 82    IF p_action = 'assign' THEN
 83      IF v_target.kind <> 'staff' THEN
 84        RETURN QUERY SELECT 'invalid_target', v_target.id, v_target.kind, v_target.status, v_target.role_id,
 85                            v_target.branch_id;
 86        RETURN;
 87      END IF;
 88      -- Missing, archived and another merchant's role or branch are one answer: nothing about them is revealed.
 89      PERFORM 1 FROM tenancy.roles r
 90        WHERE r.id = p_role_id AND r.merchant_id = v_merchant AND r.status = 'active' FOR SHARE;
 91      IF NOT FOUND OR (p_branch_id IS NOT NULL AND NOT EXISTS (
 92           SELECT 1 FROM tenancy.branches b
 93            WHERE b.id = p_branch_id AND b.merchant_id = v_merchant AND b.status = 'active' FOR SHARE)) THEN
 94        RETURN QUERY SELECT 'invalid_assignment', v_target.id, v_target.kind, v_target.status, v_target.role_id,
 95                            v_target.branch_id;
 96        RETURN;
 97      END IF;
 98      UPDATE tenancy.merchant_memberships mm SET role_id = p_role_id, branch_id = p_branch_id
 99       WHERE mm.id = v_target.id
100      RETURNING * INTO v_target;
101  
102    ELSIF p_action = 'deactivate' THEN
103      IF v_target.status <> 'active' THEN
104        RETURN QUERY SELECT 'invalid_transition', v_target.id, v_target.kind, v_target.status, v_target.role_id,
105                            v_target.branch_id;
106        RETURN;
107      END IF;
108      UPDATE tenancy.merchant_memberships mm SET status = 'deactivated', deactivated_at = now()
109       WHERE mm.id = v_target.id
110      RETURNING * INTO v_target;
111      UPDATE identity.sessions s SET revoked_at = now(), revoke_reason = 'membership_deactivated'
112       WHERE s.merchant_membership_id = v_target.id AND s.revoked_at IS NULL;
113  
114    ELSE
115      IF v_target.status <> 'deactivated' THEN
116        RETURN QUERY SELECT 'invalid_transition', v_target.id, v_target.kind, v_target.status, v_target.role_id,
117                            v_target.branch_id;
118        RETURN;
119      END IF;
120      UPDATE tenancy.merchant_memberships mm SET status = 'active', deactivated_at = NULL
121       WHERE mm.id = v_target.id
122      RETURNING * INTO v_target;
123    END IF;
124  
125    RETURN QUERY SELECT 'ok', v_target.id, v_target.kind, v_target.status, v_target.role_id, v_target.branch_id;
126  END
127  $fn$;
128  
129  REVOKE ALL ON FUNCTION "tenancy"."update_membership"(uuid, uuid, text, uuid, uuid) FROM PUBLIC;
130  GRANT EXECUTE ON FUNCTION "tenancy"."update_membership"(uuid, uuid, text, uuid, uuid) TO alphakolect_app;
```

### `packages/db/prisma/migrations/20261012000100_invitations/migration.sql` — lines 167–307

issue/revoke/accept invitation: kind = owner at lines 195, 262.

```sql
167  CREATE FUNCTION "tenancy"."issue_invitation"(
168    p_session_id uuid, p_email text, p_kind text, p_role_id uuid, p_branch_id uuid,
169    p_token_hash text, p_setup_token_hash text, p_ttl_seconds integer
170  )
171  RETURNS TABLE (outcome text, invitation_id uuid, expires_at timestamptz, delivery text)
172  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
173  AS $fn$
174  DECLARE
175    v_merchant uuid;
176    v_inviter uuid;
177    v_email text := lower(btrim(p_email));
178    v_identity identity.identities%ROWTYPE;
179    v_delivery text;
180    v_expires timestamptz;
181    v_id uuid;
182  BEGIN
183    IF p_kind NOT IN ('staff', 'agent') THEN
184      RAISE EXCEPTION 'invitations are for staff or agents' USING ERRCODE = 'check_violation';
185    END IF;
186    IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
187      RAISE EXCEPTION 'invitation lifetime out of range' USING ERRCODE = 'check_violation';
188    END IF;
189  
190    -- The session's business; authority decided under its lock (as tenancy.update_membership).
191    SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
192    IF v_merchant IS NOT NULL THEN
193      PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
194      SELECT v.merchant_id, v.membership_id INTO v_merchant, v_inviter FROM identity.validate_session(p_session_id) v
195       WHERE v.audience = 'merchant' AND v.scope = 'full' AND v.kind = 'owner' AND v.merchant_id = v_merchant;
196    END IF;
197    IF v_merchant IS NULL THEN
198      RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz, NULL::text;
199      RETURN;
200    END IF;
201  
202    IF (p_kind = 'agent' AND (p_role_id IS NOT NULL OR p_branch_id IS NOT NULL))
203       OR (p_kind = 'staff' AND NOT EXISTS (
204             SELECT 1 FROM tenancy.roles r
205              WHERE r.id = p_role_id AND r.merchant_id = v_merchant AND r.status = 'active' FOR SHARE))
206       OR (p_kind = 'staff' AND p_branch_id IS NOT NULL AND NOT EXISTS (
207             SELECT 1 FROM tenancy.branches b
208              WHERE b.id = p_branch_id AND b.merchant_id = v_merchant AND b.status = 'active' FOR SHARE)) THEN
209      RETURN QUERY SELECT 'invalid_assignment', NULL::uuid, NULL::timestamptz, NULL::text;
210      RETURN;
211    END IF;
212  
213    -- The identity of this email: created (passwordless, unverified) if there is none.
214    INSERT INTO identity.identities (email) VALUES (v_email) ON CONFLICT (email) DO NOTHING;
215    SELECT * INTO v_identity FROM identity.identities i WHERE i.email = v_email FOR SHARE;
216  
217    IF EXISTS (SELECT 1 FROM tenancy.merchant_memberships mm
218                WHERE mm.merchant_id = v_merchant AND mm.identity_id = v_identity.id) THEN
219      RETURN QUERY SELECT 'already_member', NULL::uuid, NULL::timestamptz, NULL::text;
220      RETURN;
221    END IF;
222  
223    v_delivery := CASE
224      WHEN v_identity.status <> 'active' THEN 'none'
225      WHEN v_identity.password_hash IS NULL THEN 'setup'
226      ELSE 'accept'
227    END;
228    IF v_delivery = 'setup' THEN
229      PERFORM identity.issue_one_time_token(v_identity.id, 'account_setup', p_setup_token_hash, p_ttl_seconds, NULL);
230    END IF;
231  
232    UPDATE tenancy.invitations i SET revoked_at = now()
233     WHERE i.merchant_id = v_merchant AND i.email = v_email AND i.accepted_at IS NULL AND i.revoked_at IS NULL;
234  
235    v_expires := now() + make_interval(secs => p_ttl_seconds);
236    INSERT INTO tenancy.invitations
237      (merchant_id, email, kind, role_id, branch_id, identity_id, invited_by_membership_id, token_hash, expires_at)
238    VALUES (v_merchant, v_email, p_kind, p_role_id, p_branch_id, v_identity.id, v_inviter, p_token_hash, v_expires)
239    RETURNING id INTO v_id;
240  
241    RETURN QUERY SELECT 'ok', v_id, v_expires, v_delivery;
242  END
243  $fn$;
244  
245  REVOKE ALL ON FUNCTION "tenancy"."issue_invitation"(uuid, text, text, uuid, uuid, text, text, integer) FROM PUBLIC;
246  GRANT EXECUTE ON FUNCTION "tenancy"."issue_invitation"(uuid, text, text, uuid, uuid, text, text, integer)
247    TO alphakolect_app;
248  
249  -- ── revoke ─────────────────────────────────────────────────────────────────────────────────────
250  CREATE FUNCTION "tenancy"."revoke_invitation"(p_session_id uuid, p_invitation_id uuid)
251  RETURNS TABLE (outcome text, invitation_id uuid)
252  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
253  AS $fn$
254  DECLARE
255    v_merchant uuid;
256    v_inv tenancy.invitations%ROWTYPE;
257  BEGIN
258    SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
259    IF v_merchant IS NOT NULL THEN
260      PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
261      SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v
262       WHERE v.audience = 'merchant' AND v.scope = 'full' AND v.kind = 'owner' AND v.merchant_id = v_merchant;
263    END IF;
264    IF v_merchant IS NULL THEN
265      RETURN QUERY SELECT 'forbidden', NULL::uuid;
266      RETURN;
267    END IF;
268  
269    SELECT * INTO v_inv FROM tenancy.invitations i
270     WHERE i.id = p_invitation_id AND i.merchant_id = v_merchant
271       FOR UPDATE;
272    IF NOT FOUND THEN
273      RETURN QUERY SELECT 'not_found', NULL::uuid;
274      RETURN;
275    END IF;
276    IF v_inv.accepted_at IS NOT NULL OR v_inv.revoked_at IS NOT NULL THEN
277      RETURN QUERY SELECT 'invalid_transition', v_inv.id;
278      RETURN;
279    END IF;
280    UPDATE tenancy.invitations i SET revoked_at = now() WHERE i.id = v_inv.id;
281    RETURN QUERY SELECT 'ok', v_inv.id;
282  END
283  $fn$;
284  
285  REVOKE ALL ON FUNCTION "tenancy"."revoke_invitation"(uuid, uuid) FROM PUBLIC;
286  GRANT EXECUTE ON FUNCTION "tenancy"."revoke_invitation"(uuid, uuid) TO alphakolect_app;
287  
288  -- ── accept (existing account, T11): the API has verified the identity's password ────────────────
289  CREATE FUNCTION "tenancy"."accept_invitation"(p_token_hash text, p_identity_id uuid)
290  RETURNS TABLE (outcome text, membership_id uuid, merchant_id uuid, invitation_id uuid)
291  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
292  AS $fn$
293  DECLARE
294    v_id uuid;
295  BEGIN
296    SELECT i.id INTO v_id FROM tenancy.invitations i WHERE i.token_hash = p_token_hash;
297    IF v_id IS NULL THEN
298      RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid, NULL::uuid;
299      RETURN;
300    END IF;
301    RETURN QUERY SELECT a.outcome, a.membership_id, a.merchant_id, v_id
302                   FROM tenancy.admit_invitation(v_id, p_identity_id) a;
303  END
304  $fn$;
305  
306  REVOKE ALL ON FUNCTION "tenancy"."accept_invitation"(text, uuid) FROM PUBLIC;
307  GRANT EXECUTE ON FUNCTION "tenancy"."accept_invitation"(text, uuid) TO alphakolect_app;
```

### `packages/db/prisma/migrations/20261009000100_merchant_lifecycle/migration.sql` — lines 20–154

merchant status gate; set_merchant_status: super_admin at line 104.

```sql
 20      CHECK ("deactivation_reason" IS NULL OR char_length(btrim("deactivation_reason")) BETWEEN 1 AND 500);
 21  
 22  -- ── no direct status changes or merchant creation by the app ───────────────────────────────────
 23  -- P1 granted these before the trusted functions existed. Merchants are created by identity.signup_merchant_owner
 24  -- and change status only through identity.verify_email and tenancy.set_merchant_status (all SECURITY DEFINER).
 25  -- UPDATE (name, updated_at) stays for the merchant profile (P4.4), under RLS.
 26  REVOKE INSERT ON "tenancy"."merchants" FROM alphakolect_app;
 27  REVOKE UPDATE ("status") ON "tenancy"."merchants" FROM alphakolect_app;
 28  
 29  -- ── a membership is usable only while its merchant is active (T5) ──────────────────────────────
 30  -- Same signature and body as 20261003000300, plus the merchant-status join for merchant/agent memberships.
 31  -- Every caller picks it up: create_session, rotate_refresh_token, validate_session (per request).
 32  CREATE OR REPLACE FUNCTION "identity"."active_membership"(p_identity_id uuid, p_audience text, p_membership_id uuid)
 33  RETURNS uuid
 34  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
 35  AS $fn$
 36    SELECT pm.id FROM identity.platform_memberships pm
 37     WHERE p_audience = 'platform' AND pm.id = p_membership_id AND pm.identity_id = p_identity_id AND pm.status = 'active'
 38    UNION ALL
 39    SELECT mm.id FROM tenancy.merchant_memberships mm
 40      JOIN tenancy.merchants m ON m.id = mm.merchant_id AND m.status = 'active'
 41     WHERE mm.id = p_membership_id AND mm.identity_id = p_identity_id AND mm.status = 'active'
 42       AND ((p_audience = 'merchant' AND mm.kind IN ('owner', 'staff')) OR (p_audience = 'agent' AND mm.kind = 'agent'))
 43    LIMIT 1;
 44  $fn$;
 45  
 46  -- Login must not offer a membership of a non-active merchant: create_session would refuse it and the API would
 47  -- answer 500. Same signature and body as 20261003000200, plus the merchant-status join, so such a login gets the
 48  -- generic INVALID_CREDENTIALS. (P4.2 replaces this function entirely.)
 49  CREATE OR REPLACE FUNCTION "identity"."login_candidate"(p_email text, p_audience text)
 50  RETURNS TABLE (
 51    identity_id uuid, identity_status text, email_verified boolean, password_hash text,
 52    membership_id uuid, membership_kind text, membership_status text, mfa_enrolled boolean
 53  )
 54  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
 55  AS $fn$
 56    SELECT i.id, i.status, i.email_verified_at IS NOT NULL, i.password_hash,
 57           m.id, m.kind, m.status,
 58           EXISTS (SELECT 1 FROM identity.totp_credentials t WHERE t.identity_id = i.id AND t.confirmed_at IS NOT NULL)
 59      FROM identity.identities i
 60      LEFT JOIN LATERAL (
 61        SELECT pm.id, pm.role AS kind, pm.status FROM identity.platform_memberships pm
 62         WHERE p_audience = 'platform' AND pm.identity_id = i.id
 63        UNION ALL
 64        SELECT mm.id, mm.kind, mm.status FROM tenancy.merchant_memberships mm
 65          JOIN tenancy.merchants mr ON mr.id = mm.merchant_id AND mr.status = 'active'
 66         WHERE p_audience = 'merchant' AND mm.identity_id = i.id AND mm.kind IN ('owner', 'staff')
 67        UNION ALL
 68        SELECT mm.id, mm.kind, mm.status FROM tenancy.merchant_memberships mm
 69          JOIN tenancy.merchants mr ON mr.id = mm.merchant_id AND mr.status = 'active'
 70         WHERE p_audience = 'agent' AND mm.identity_id = i.id AND mm.kind = 'agent'
 71        ORDER BY 1
 72        LIMIT 1
 73      ) m ON true
 74     WHERE i.email = lower(btrim(p_email));
 75  $fn$;
 76  
 77  -- ── platform lifecycle action (T6, T9) ─────────────────────────────────────────────────────────
 78  -- Authority comes ONLY from p_session_id: it must be a live, full-scope (MFA-completed) platform session of an
 79  -- active super admin, as identity.validate_session sees it now. app.merchant_id (the tenant context the caller
 80  -- sets for its audit row) is never consulted, so a tenant context can grant nothing here.
 81  --
 82  -- outcome: 'ok' | 'forbidden' | 'not_found' | 'invalid_transition' | 'invalid_reason'.
 83  -- Lock order — the owner's identity row (shared), then the merchant row — matches identity.verify_email
 84  -- (identity, then merchant), so the two cannot deadlock and a reactivation racing an email verification waits for
 85  -- it and sees its result.
 86  CREATE FUNCTION "tenancy"."set_merchant_status"(p_session_id uuid, p_merchant_id uuid, p_action text, p_reason text)
 87  RETURNS TABLE (outcome text, status text, actor_identity_id uuid, actor_membership_id uuid)
 88  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
 89  AS $fn$
 90  DECLARE
 91    v_actor_identity uuid;
 92    v_actor_membership uuid;
 93    v_owner_verified boolean;
 94    v_status text;
 95    v_new text;
 96    v_reason text := btrim(p_reason);
 97  BEGIN
 98    IF p_action NOT IN ('deactivate', 'reactivate') THEN
 99      RAISE EXCEPTION 'unknown lifecycle action' USING ERRCODE = 'check_violation';
100    END IF;
101  
102    SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor_membership
103      FROM identity.validate_session(p_session_id) v
104      JOIN identity.platform_memberships pm ON pm.id = v.membership_id AND pm.role = 'super_admin'
105     WHERE v.audience = 'platform' AND v.scope = 'full';
106    IF v_actor_identity IS NULL THEN
107      RETURN QUERY SELECT 'forbidden', NULL::text, NULL::uuid, NULL::uuid;
108      RETURN;
109    END IF;
110  
111    -- The owner's verification decides where a reactivation lands (BR-2.2); lock it before the merchant row.
112    SELECT i.email_verified_at IS NOT NULL INTO v_owner_verified
113      FROM tenancy.merchant_memberships mm
114      JOIN identity.identities i ON i.id = mm.identity_id
115     WHERE mm.merchant_id = p_merchant_id AND mm.kind = 'owner'
116       FOR SHARE OF i;
117  
118    SELECT m.status INTO v_status FROM tenancy.merchants m WHERE m.id = p_merchant_id FOR UPDATE;
119    IF NOT FOUND THEN
120      RETURN QUERY SELECT 'not_found', NULL::text, v_actor_identity, v_actor_membership;
121      RETURN;
122    END IF;
123  
124    IF p_action = 'deactivate' THEN
125      IF v_status NOT IN ('active', 'pending_verification') THEN
126        RETURN QUERY SELECT 'invalid_transition', v_status, v_actor_identity, v_actor_membership;
127        RETURN;
128      END IF;
129      IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
130        RETURN QUERY SELECT 'invalid_reason', v_status, v_actor_identity, v_actor_membership;
131        RETURN;
132      END IF;
133      v_new := 'deactivated';
134      UPDATE tenancy.merchants
135         SET status = v_new, deactivated_at = now(), deactivation_reason = v_reason, updated_at = now()
136       WHERE id = p_merchant_id;
137    ELSE
138      IF v_status <> 'deactivated' THEN
139        RETURN QUERY SELECT 'invalid_transition', v_status, v_actor_identity, v_actor_membership;
140        RETURN;
141      END IF;
142      -- Never verifies anything: an unverified owner's business goes back to pending_verification (BR-2.2).
143      v_new := CASE WHEN coalesce(v_owner_verified, false) THEN 'active' ELSE 'pending_verification' END;
144      UPDATE tenancy.merchants
145         SET status = v_new, deactivated_at = NULL, deactivation_reason = NULL, updated_at = now()
146       WHERE id = p_merchant_id;
147    END IF;
148  
149    RETURN QUERY SELECT 'ok', v_new, v_actor_identity, v_actor_membership;
150  END
151  $fn$;
152  
153  REVOKE ALL ON FUNCTION "tenancy"."set_merchant_status"(uuid, uuid, text, text) FROM PUBLIC;
154  GRANT EXECUTE ON FUNCTION "tenancy"."set_merchant_status"(uuid, uuid, text, text) TO alphakolect_app;
```

### `packages/db/prisma/migrations/20261011000300_ownership_transfer/migration.sql` — lines 18–107

transfer_ownership: super_admin at line 40.

```sql
 18  CREATE FUNCTION "tenancy"."transfer_ownership"(
 19    p_session_id uuid, p_merchant_id uuid, p_new_owner_membership_id uuid, p_former_owner_role_id uuid,
 20    p_deactivate_former boolean
 21  )
 22  RETURNS TABLE (
 23    outcome text, former_owner_membership_id uuid, former_owner_identity_id uuid, new_owner_identity_id uuid,
 24    actor_identity_id uuid, actor_membership_id uuid
 25  )
 26  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
 27  AS $fn$
 28  DECLARE
 29    v_actor_identity uuid;
 30    v_actor_membership uuid;
 31    v_former tenancy.merchant_memberships%ROWTYPE;
 32    v_new tenancy.merchant_memberships%ROWTYPE;
 33  BEGIN
 34    IF p_deactivate_former IS NULL THEN
 35      RAISE EXCEPTION 'p_deactivate_former is required' USING ERRCODE = 'null_value_not_allowed';
 36    END IF;
 37  
 38    SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor_membership
 39      FROM identity.validate_session(p_session_id) v
 40      JOIN identity.platform_memberships pm ON pm.id = v.membership_id AND pm.role = 'super_admin'
 41     WHERE v.audience = 'platform' AND v.scope = 'full';
 42    IF v_actor_identity IS NULL THEN
 43      RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
 44      RETURN;
 45    END IF;
 46  
 47    PERFORM 1 FROM tenancy.merchants m WHERE m.id = p_merchant_id FOR UPDATE;
 48    IF NOT FOUND THEN
 49      RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid, NULL::uuid, v_actor_identity, v_actor_membership;
 50      RETURN;
 51    END IF;
 52  
 53    PERFORM 1 FROM tenancy.merchant_memberships mm
 54     WHERE mm.merchant_id = p_merchant_id AND (mm.kind = 'owner' OR mm.id = p_new_owner_membership_id)
 55     ORDER BY mm.id
 56       FOR UPDATE;
 57    SELECT * INTO v_former FROM tenancy.merchant_memberships mm
 58     WHERE mm.merchant_id = p_merchant_id AND mm.kind = 'owner';
 59    IF NOT FOUND THEN
 60      RAISE EXCEPTION 'merchant % has no owner', p_merchant_id USING ERRCODE = 'check_violation';
 61    END IF;
 62    SELECT * INTO v_new FROM tenancy.merchant_memberships mm
 63     WHERE mm.id = p_new_owner_membership_id AND mm.merchant_id = p_merchant_id
 64       AND mm.kind = 'staff' AND mm.status = 'active';
 65    IF NOT FOUND THEN
 66      RETURN QUERY SELECT 'invalid_new_owner', v_former.id, v_former.identity_id, NULL::uuid, v_actor_identity,
 67                          v_actor_membership;
 68      RETURN;
 69    END IF;
 70    PERFORM 1 FROM identity.identities i
 71     WHERE i.id = v_new.identity_id AND i.status = 'active' AND i.email_verified_at IS NOT NULL
 72       FOR SHARE;
 73    IF NOT FOUND THEN
 74      RETURN QUERY SELECT 'invalid_new_owner', v_former.id, v_former.identity_id, NULL::uuid, v_actor_identity,
 75                          v_actor_membership;
 76      RETURN;
 77    END IF;
 78    PERFORM 1 FROM tenancy.roles r
 79     WHERE r.id = p_former_owner_role_id AND r.merchant_id = p_merchant_id AND r.status = 'active'
 80       FOR SHARE;
 81    IF NOT FOUND THEN
 82      RETURN QUERY SELECT 'invalid_role', v_former.id, v_former.identity_id, v_new.identity_id, v_actor_identity,
 83                          v_actor_membership;
 84      RETURN;
 85    END IF;
 86  
 87    -- Demote first: never two owners, not even inside this transaction.
 88    UPDATE tenancy.merchant_memberships mm
 89       SET kind = 'staff', role_id = p_former_owner_role_id, branch_id = NULL,
 90           status = CASE WHEN p_deactivate_former THEN 'deactivated' ELSE mm.status END,
 91           deactivated_at = CASE WHEN p_deactivate_former THEN coalesce(mm.deactivated_at, now()) ELSE mm.deactivated_at END
 92     WHERE mm.id = v_former.id;
 93    IF p_deactivate_former THEN
 94      UPDATE identity.sessions s SET revoked_at = now(), revoke_reason = 'ownership_transferred'
 95       WHERE s.merchant_membership_id = v_former.id AND s.revoked_at IS NULL;
 96    END IF;
 97  
 98    UPDATE tenancy.merchant_memberships mm SET kind = 'owner', role_id = NULL, branch_id = NULL
 99     WHERE mm.id = v_new.id;
100  
101    RETURN QUERY SELECT 'ok', v_former.id, v_former.identity_id, v_new.identity_id, v_actor_identity,
102                        v_actor_membership;
103  END
104  $fn$;
105  
106  REVOKE ALL ON FUNCTION "tenancy"."transfer_ownership"(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC;
107  GRANT EXECUTE ON FUNCTION "tenancy"."transfer_ownership"(uuid, uuid, uuid, uuid, boolean) TO alphakolect_app;
```

### `packages/db/prisma/migrations/20261009000200_login_membership_selection/migration.sql` — lines 45–67

eligible_memberships: only super_admin may sign in on the platform (line 57) — report G3.

```sql
45  -- ── eligibility (internal) ─────────────────────────────────────────────────────────────────────
46  -- Memberships an active identity may sign in with for an audience, now: active, of a kind valid for the audience,
47  -- in an active merchant. Platform: the super admin only (platform staff arrive with P5, ADR-15 T2).
48  CREATE FUNCTION "identity"."eligible_memberships"(p_identity_id uuid, p_audience text)
49  RETURNS TABLE (membership_id uuid, merchant_id uuid, merchant_name text, kind text)
50  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
51  AS $fn$
52    SELECT x.membership_id, x.merchant_id, x.merchant_name, x.kind
53      FROM identity.identities i
54      CROSS JOIN LATERAL (
55        SELECT pm.id AS membership_id, NULL::uuid AS merchant_id, NULL::text AS merchant_name, pm.role AS kind
56          FROM identity.platform_memberships pm
57         WHERE p_audience = 'platform' AND pm.identity_id = i.id AND pm.status = 'active' AND pm.role = 'super_admin'
58        UNION ALL
59        SELECT mm.id, m.id, m.name, mm.kind
60          FROM tenancy.merchant_memberships mm
61          JOIN tenancy.merchants m ON m.id = mm.merchant_id AND m.status = 'active'
62         WHERE mm.identity_id = i.id AND mm.status = 'active'
63           AND ((p_audience = 'merchant' AND mm.kind IN ('owner', 'staff')) OR (p_audience = 'agent' AND mm.kind = 'agent'))
64      ) x
65     WHERE i.id = p_identity_id AND i.status = 'active'
66     ORDER BY x.merchant_name NULLS FIRST, x.membership_id;
67  $fn$;
```

## D. Grants and row-level security

### `packages/db/prisma/migrations/20260927000200_privileges/migration.sql` — lines 1–39

App/readonly grants (audit: SELECT, INSERT only).

```sql
 1  -- P1 privileges for alphakolect_app and alphakolect_readonly (TARGET_ARCHITECTURE §19, ADR-5, ADR-6).
 2  --
 3  -- Default-deny: there are deliberately NO "ALTER DEFAULT PRIVILEGES ... ON TABLES". Every table a later
 4  -- migration adds is invisible to app/readonly until that migration grants it explicitly.
 5  -- The migrator owns everything; app and readonly own nothing and can create nothing.
 6  
 7  -- ── schema usage (resolving names only; table access is granted per table below) ──────────────
 8  GRANT USAGE ON SCHEMA "util", "tenancy", "ledger", "audit" TO alphakolect_app, alphakolect_readonly;
 9  
10  -- Id defaults call util.uuid_v7() as the inserting role. PUBLIC has no EXECUTE on migrator-owned
11  -- functions (packages/db/sql/bootstrap/database.sql), so grant it to the app explicitly.
12  GRANT EXECUTE ON FUNCTION "util"."uuid_v7"() TO alphakolect_app;
13  
14  -- ── tenancy ───────────────────────────────────────────────────────────────────────────────────
15  -- Merchants are never deleted (lifecycle is a status); only name/status/updated_at change.
16  GRANT SELECT, INSERT ON "tenancy"."merchants" TO alphakolect_app;
17  GRANT UPDATE ("name", "status", "updated_at") ON "tenancy"."merchants" TO alphakolect_app;
18  
19  -- ── ledger: money records are append-only (ADR-5: no UPDATE balance, no DELETE of money rows) ─
20  GRANT SELECT, INSERT ON "ledger"."ledgers" TO alphakolect_app;
21  
22  -- Accounts may be renamed; code, type, ownership and structure never change.
23  GRANT SELECT, INSERT ON "ledger"."accounts" TO alphakolect_app;
24  GRANT UPDATE ("name") ON "ledger"."accounts" TO alphakolect_app;
25  
26  -- Journal entries and lines: INSERT-only. Corrections are reversing entries (BR-11.1).
27  GRANT SELECT, INSERT ON "ledger"."journal_entries" TO alphakolect_app;
28  GRANT SELECT, INSERT ON "ledger"."journal_lines" TO alphakolect_app;
29  
30  -- The balance projection is the one ledger table updated in place, by the posting service, in the
31  -- same transaction as the lines it summarises (§7). Only its figures may change; rows are not deleted.
32  GRANT SELECT, INSERT ON "ledger"."balance_projection" TO alphakolect_app;
33  GRANT UPDATE ("balance_minor", "version", "updated_at") ON "ledger"."balance_projection" TO alphakolect_app;
34  
35  -- ── audit: append-only (§16) ──────────────────────────────────────────────────────────────────
36  GRANT SELECT, INSERT ON "audit"."audit_events" TO alphakolect_app;
37  
38  -- ── readonly: reporting/support reads, nothing else ───────────────────────────────────────────
39  GRANT SELECT ON ALL TABLES IN SCHEMA "tenancy", "ledger", "audit" TO alphakolect_readonly;
```

### `packages/db/prisma/migrations/20260927000400_row_level_security/migration.sql` — lines 1–78

util.current_merchant_id, tenant policies, audit policies.

```sql
 1  -- P1 row-level security scaffolding (TARGET_ARCHITECTURE ADR-6, §4).
 2  --
 3  -- RLS is the LAST line of defence against bugs in tenant scoping: application authorization decides
 4  -- what an actor may do, scoped repositories address only their tenant's rows, and these policies make
 5  -- a missed filter return nothing instead of another merchant's data. It is never the permission system.
 6  --
 7  -- Tenant context: the API sets it per transaction, from the session's membership (never from input):
 8  --     SELECT set_config('app.merchant_id', '<merchant uuid>', true);   -- i.e. SET LOCAL
 9  -- No context => no rows (fail closed). A malformed value raises an error rather than matching anything.
10  --
11  -- Roles: policies apply to alphakolect_app (tenant-scoped) and alphakolect_readonly (cross-tenant
12  -- reads for reporting/support). The migrator owns the tables and is exempt (no FORCE ROW LEVEL
13  -- SECURITY) so migrations and operations work; it is never used by the application.
14  
15  CREATE FUNCTION "util"."current_merchant_id"() RETURNS uuid
16  LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp
17  AS $fn$
18    -- current_setting(..., true) is NULL if never set and '' after a SET LOCAL transaction ends.
19    SELECT nullif(current_setting('app.merchant_id', true), '')::uuid;
20  $fn$;
21  
22  REVOKE ALL ON FUNCTION "util"."current_merchant_id"() FROM PUBLIC;
23  GRANT EXECUTE ON FUNCTION "util"."current_merchant_id"() TO alphakolect_app;
24  
25  -- ── tenancy.merchants: the tenant row itself ──────────────────────────────────────────────────
26  ALTER TABLE "tenancy"."merchants" ENABLE ROW LEVEL SECURITY;
27  CREATE POLICY "merchants_app_own_tenant" ON "tenancy"."merchants" TO alphakolect_app
28    USING ("id" = "util"."current_merchant_id"())
29    WITH CHECK ("id" = "util"."current_merchant_id"());
30  CREATE POLICY "merchants_readonly_all" ON "tenancy"."merchants" FOR SELECT TO alphakolect_readonly
31    USING (true);
32  
33  -- ── ledger: every table is tenant-owned (merchant_id NOT NULL) ─────────────────────────────────
34  ALTER TABLE "ledger"."ledgers" ENABLE ROW LEVEL SECURITY;
35  CREATE POLICY "ledgers_app_own_tenant" ON "ledger"."ledgers" TO alphakolect_app
36    USING ("merchant_id" = "util"."current_merchant_id"())
37    WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
38  CREATE POLICY "ledgers_readonly_all" ON "ledger"."ledgers" FOR SELECT TO alphakolect_readonly
39    USING (true);
40  
41  ALTER TABLE "ledger"."accounts" ENABLE ROW LEVEL SECURITY;
42  CREATE POLICY "accounts_app_own_tenant" ON "ledger"."accounts" TO alphakolect_app
43    USING ("merchant_id" = "util"."current_merchant_id"())
44    WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
45  CREATE POLICY "accounts_readonly_all" ON "ledger"."accounts" FOR SELECT TO alphakolect_readonly
46    USING (true);
47  
48  ALTER TABLE "ledger"."journal_entries" ENABLE ROW LEVEL SECURITY;
49  CREATE POLICY "journal_entries_app_own_tenant" ON "ledger"."journal_entries" TO alphakolect_app
50    USING ("merchant_id" = "util"."current_merchant_id"())
51    WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
52  CREATE POLICY "journal_entries_readonly_all" ON "ledger"."journal_entries" FOR SELECT TO alphakolect_readonly
53    USING (true);
54  
55  ALTER TABLE "ledger"."journal_lines" ENABLE ROW LEVEL SECURITY;
56  CREATE POLICY "journal_lines_app_own_tenant" ON "ledger"."journal_lines" TO alphakolect_app
57    USING ("merchant_id" = "util"."current_merchant_id"())
58    WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
59  CREATE POLICY "journal_lines_readonly_all" ON "ledger"."journal_lines" FOR SELECT TO alphakolect_readonly
60    USING (true);
61  
62  ALTER TABLE "ledger"."balance_projection" ENABLE ROW LEVEL SECURITY;
63  CREATE POLICY "balance_projection_app_own_tenant" ON "ledger"."balance_projection" TO alphakolect_app
64    USING ("merchant_id" = "util"."current_merchant_id"())
65    WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
66  CREATE POLICY "balance_projection_readonly_all" ON "ledger"."balance_projection" FOR SELECT TO alphakolect_readonly
67    USING (true);
68  
69  -- ── audit.audit_events: tenant events plus tenant-less events (e.g. a failed platform login) ───
70  ALTER TABLE "audit"."audit_events" ENABLE ROW LEVEL SECURITY;
71  -- The app reads only its tenant's events (platform audit views are a later, permission-gated service).
72  CREATE POLICY "audit_events_app_read_own_tenant" ON "audit"."audit_events" FOR SELECT TO alphakolect_app
73    USING ("merchant_id" = "util"."current_merchant_id"());
74  -- The app may record events for its tenant, or events that belong to no tenant.
75  CREATE POLICY "audit_events_app_insert" ON "audit"."audit_events" FOR INSERT TO alphakolect_app
76    WITH CHECK ("merchant_id" IS NULL OR "merchant_id" = "util"."current_merchant_id"());
77  CREATE POLICY "audit_events_readonly_all" ON "audit"."audit_events" FOR SELECT TO alphakolect_readonly
78    USING (true);
```

### `packages/db/prisma/migrations/20261009000300_branches_and_roles/migration.sql` — lines 80–88

Branch/role grants: app writes under RLS, no DB authority check.

```sql
80    USING ("merchant_id" = "util"."current_merchant_id"())
81    WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
82  CREATE POLICY "roles_readonly_all" ON "tenancy"."roles" FOR SELECT TO alphakolect_readonly
83    USING (true);
84  
85  -- ── grants: no DELETE (archive instead); names and archiving only ──────────────────────────────
86  GRANT SELECT, INSERT ON "tenancy"."branches", "tenancy"."roles" TO alphakolect_app;
87  GRANT UPDATE ("name", "status", "archived_at", "updated_at") ON "tenancy"."branches", "tenancy"."roles" TO alphakolect_app;
88  GRANT SELECT ON "tenancy"."branches", "tenancy"."roles" TO alphakolect_readonly;
```

### `packages/db/prisma/migrations/20261003000100_identity_schema/migration.sql` — lines 225–235

Platform roles: super_admin | support | verification | finance (line 230).

```sql
225    ADD CONSTRAINT "identities_email_shape" CHECK (length("email") <= 254 AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
226    ADD CONSTRAINT "identities_status_valid" CHECK ("status" IN ('active', 'disabled')),
227    ADD CONSTRAINT "identities_password_is_argon2id" CHECK ("password_hash" IS NULL OR "password_hash" LIKE '$argon2id$%');
228  
229  ALTER TABLE "identity"."platform_memberships"
230    ADD CONSTRAINT "platform_memberships_role_valid" CHECK ("role" IN ('super_admin', 'support', 'verification', 'finance')),
231    ADD CONSTRAINT "platform_memberships_status_valid" CHECK ("status" IN ('active', 'deactivated')),
232    ADD CONSTRAINT "platform_memberships_deactivation_consistent" CHECK (("status" = 'deactivated') = ("deactivated_at" IS NOT NULL));
233  
234  -- A session belongs to exactly one membership matching its audience. Customers (P7) get their own column then.
235  ALTER TABLE "identity"."sessions"
```

## E. Audit: storage, immutability, code

### `packages/db/prisma/migrations/20260927000100_baseline/migration.sql` — lines 131–148

audit.audit_events columns.

```sql
131  CREATE TABLE "audit"."audit_events" (
132      "id" UUID NOT NULL DEFAULT util.uuid_v7(),
133      "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
134      "merchant_id" UUID,
135      "actor_identity_id" UUID,
136      "actor_audience" TEXT,
137      "actor_membership_id" UUID,
138      "action" TEXT NOT NULL,
139      "target_type" TEXT,
140      "target_id" TEXT,
141      "outcome" TEXT NOT NULL,
142      "ip" TEXT,
143      "user_agent" TEXT,
144      "request_id" TEXT,
145      "summary" JSONB NOT NULL DEFAULT '{}',
146  
147      CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
148  );
```

### `packages/db/prisma/migrations/20260927000100_baseline/migration.sql` — lines 181–185

audit indexes.

```sql
181  CREATE INDEX "audit_events_merchant_id_occurred_at_idx" ON "audit"."audit_events"("merchant_id", "occurred_at");
182  
183  -- CreateIndex
184  CREATE INDEX "audit_events_action_occurred_at_idx" ON "audit"."audit_events"("action", "occurred_at");
185  
```

### `packages/db/prisma/migrations/20260927000300_ledger_invariants/migration.sql` — lines 35–41

audit CHECK constraints.

```sql
35    ADD CONSTRAINT "balance_projection_version_non_negative" CHECK ("version" >= 0);
36  
37  ALTER TABLE "audit"."audit_events"
38    ADD CONSTRAINT "audit_events_action_not_blank" CHECK (length(btrim("action")) > 0),
39    ADD CONSTRAINT "audit_events_outcome_valid" CHECK ("outcome" IN ('success', 'failure', 'denied')),
40    ADD CONSTRAINT "audit_events_summary_is_object" CHECK (jsonb_typeof("summary") = 'object');
41  
```

### `packages/db/prisma/migrations/20260927000300_ledger_invariants/migration.sql` — lines 113–148

append-only triggers (every role).

```sql
113  
114  -- ── immutability (applies to every role, including the owner) ─────────────────────────────────
115  -- The app role already lacks UPDATE/DELETE/TRUNCATE on these tables (privileges migration); these
116  -- triggers also stop the migrator/owner and any future grant mistake. Corrections are new entries.
117  -- (Customer anonymisation, BR-11.3, will need a narrow, audited path for audit summaries; that is
118  -- designed with the customers module, not by relaxing this.)
119  CREATE FUNCTION "util"."reject_modification"() RETURNS trigger
120  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
121  AS $fn$
122  BEGIN
123    RAISE EXCEPTION '%.% is append-only: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
124      USING ERRCODE = 'restrict_violation';
125  END
126  $fn$;
127  
128  CREATE TRIGGER "journal_entries_immutable"
129    BEFORE UPDATE OR DELETE ON "ledger"."journal_entries"
130    FOR EACH ROW EXECUTE FUNCTION "util"."reject_modification"();
131  CREATE TRIGGER "journal_entries_no_truncate"
132    BEFORE TRUNCATE ON "ledger"."journal_entries"
133    FOR EACH STATEMENT EXECUTE FUNCTION "util"."reject_modification"();
134  
135  CREATE TRIGGER "journal_lines_immutable"
136    BEFORE UPDATE OR DELETE ON "ledger"."journal_lines"
137    FOR EACH ROW EXECUTE FUNCTION "util"."reject_modification"();
138  CREATE TRIGGER "journal_lines_no_truncate"
139    BEFORE TRUNCATE ON "ledger"."journal_lines"
140    FOR EACH STATEMENT EXECUTE FUNCTION "util"."reject_modification"();
141  
142  CREATE TRIGGER "audit_events_immutable"
143    BEFORE UPDATE OR DELETE ON "audit"."audit_events"
144    FOR EACH ROW EXECUTE FUNCTION "util"."reject_modification"();
145  CREATE TRIGGER "audit_events_no_truncate"
146    BEFORE TRUNCATE ON "audit"."audit_events"
147    FOR EACH STATEMENT EXECUTE FUNCTION "util"."reject_modification"();
148  
```

### `apps/api/src/modules/audit/audit-log.ts` — lines 1–63

The whole audit module today (report §13).

```ts
 1  import type { Db, Queryable } from '../../platform/db.js';
 2  
 3  // Append-only audit events (TARGET_ARCHITECTURE §16, BR-11.4): who did what, when, with what outcome.
 4  // `summary` must never contain secrets — callers pass identifiers and outcomes only.
 5  //
 6  // audit.audit_events is protected by row-level security (P1): the app may insert tenant-less events, or
 7  // events of the tenant set in the transaction. Tenant events are therefore written inside a transaction that
 8  // sets app.merchant_id to that tenant.
 9  
10  export type AuditEvent = {
11    action: string;
12    outcome: 'success' | 'failure' | 'denied';
13    merchantId?: string | null;
14    actorIdentityId?: string | null;
15    actorAudience?: string | null;
16    actorMembershipId?: string | null;
17    targetType?: string | null;
18    targetId?: string | null;
19    ip?: string | null;
20    userAgent?: string | null;
21    requestId?: string | null;
22    summary?: Record<string, string | number | boolean | null>;
23  };
24  
25  export class AuditLog {
26    constructor(private readonly db: Db) {}
27  
28    /** In its own transaction (setting the tenant for a tenant event). */
29    async record(event: AuditEvent): Promise<void> {
30      const merchantId = event.merchantId ?? null;
31      await this.db.transaction(async (tx) => {
32        if (merchantId) await tx.query(`SELECT set_config('app.merchant_id', $1, true)`, [merchantId]);
33        await this.recordWithin(tx, event);
34      });
35    }
36  
37    /**
38     * Inside the caller's transaction, so the audit row commits or rolls back with the change it describes (ADR-15:
39     * one transaction per command). For a tenant event the caller has already set `app.merchant_id` in `tx`.
40     */
41    async recordWithin(tx: Queryable, event: AuditEvent): Promise<void> {
42      await tx.query(
43        `INSERT INTO audit.audit_events
44           (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id,
45            outcome, ip, user_agent, request_id, summary)
46         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
47        [
48          event.merchantId ?? null,
49          event.actorIdentityId ?? null,
50          event.actorAudience ?? null,
51          event.actorMembershipId ?? null,
52          event.action,
53          event.targetType ?? null,
54          event.targetId ?? null,
55          event.outcome,
56          event.ip ?? null,
57          event.userAgent?.slice(0, 512) ?? null,
58          event.requestId ?? null,
59          JSON.stringify(event.summary ?? {}),
60        ],
61      );
62    }
63  }
```

## F. Existing guards and the isolation matrix P5 would extend

### `apps/api/test/tenancy/isolation-matrix.test.ts` — lines 1–247

Registry-driven tenant-isolation matrix (report §16).

```ts
  1  import { randomBytes } from 'node:crypto';
  2  import { AUTH_COOKIES, CSRF_HEADER, endpoints, type EndpointContract } from '@alphakolect/contracts';
  3  import request from 'supertest';
  4  import { beforeAll, describe, expect, it } from 'vitest';
  5  import { createTestApp, TEST_WEB_ORIGIN } from '../support/app.js';
  6  import { tenancyFixtures, uniqueEmail } from '../support/tenancy.js';
  7  
  8  // The tenant-isolation matrix (P4 exit criterion; ADR-15 T3, T9, T14, T15), driven by the contract registry: every
  9  // merchant- and agent-audience endpoint, as it is registered — not a hand-picked list. A new tenant endpoint is in
 10  // the matrix automatically, and the matrix FAILS (rather than skips it) if it cannot address that endpoint: every
 11  // path parameter needs a resolver below, every request body a valid sample.
 12  //
 13  //   1. another tenant's resource, addressed by its real id → 404 NOT_FOUND, the same answer as for an id that does
 14  //      not exist, and the other tenant's data is unchanged afterwards;
 15  //   2. collection endpoints answer with nothing of the other tenant;
 16  //   3. same tenant, wrong kind: staff get 403 FORBIDDEN wherever the contract documents it (T9), and success
 17  //      elsewhere;
 18  //   4. wrong audience or transport: agent tokens on merchant endpoints, merchant cookies on agent endpoints, and
 19  //      platform sessions are all refused.
 20  
 21  const { app, auth } = await createTestApp();
 22  const { owner, business, member, platformAdmin, call } = tenancyFixtures(app, auth);
 23  
 24  type Tenant = Awaited<ReturnType<typeof setUp>>;
 25  async function setUp(name: string) {
 26    const b = await business(name);
 27    const staff = await member(b, 'staff');
 28    const agent = await member(b, 'agent');
 29    // Addressed by the membership endpoints (which may deactivate it), never a caller.
 30    const target = await member(b, 'staff');
 31    const invited = await call(b.owner.token, 'post', '/v1/merchant/invitations', {
 32      email: uniqueEmail('matrix-invitee'),
 33      kind: 'agent',
 34    });
 35    expect(invited.status).toBe(201);
 36    return { ...b, staff, agent, target, invitationId: invited.body.invitationId as string };
 37  }
 38  
 39  /** How to address each path parameter in a tenant: a real resource of that tenant. */
 40  const RESOLVERS: Record<string, (t: Tenant) => string> = {
 41    branchId: (t) => t.branchId,
 42    roleId: (t) => t.roleId,
 43    membershipId: (t) => t.target.membershipId,
 44    invitationId: (t) => t.invitationId,
 45  };
 46  
 47  /** A valid request body for each tenant endpoint that takes one (`t` is the CALLER's tenant). */
 48  const BODIES: Partial<Record<keyof typeof endpoints, (t: Tenant) => object>> = {
 49    updateMerchantProfile: () => ({ name: `Matrix ${randomBytes(3).toString('hex')}` }),
 50    createBranch: () => ({ name: `Branch ${randomBytes(3).toString('hex')}` }),
 51    updateBranch: () => ({ name: `Branch ${randomBytes(3).toString('hex')}` }),
 52    createRole: () => ({ name: `Role ${randomBytes(3).toString('hex')}` }),
 53    updateRole: () => ({ name: `Role ${randomBytes(3).toString('hex')}` }),
 54    assignMember: (t) => ({ roleId: t.roleId, branchId: null }),
 55    createInvitation: () => ({ email: uniqueEmail('matrix'), kind: 'agent' }),
 56  };
 57  
 58  const TENANT_ENDPOINTS = (
 59    Object.entries(endpoints) as Array<[keyof typeof endpoints, EndpointContract]>
 60  ).filter(([, e]) => e.audience === 'merchant' || e.audience === 'agent');
 61  const paramsOf = (e: EndpointContract) => Object.keys(e.request?.params?.shape ?? {});
 62  const withParams = TENANT_ENDPOINTS.filter(([, e]) => paramsOf(e).length > 0);
 63  const withoutParams = TENANT_ENDPOINTS.filter(([, e]) => paramsOf(e).length === 0);
 64  const MISSING = '01900000-0000-7000-8000-00000000dead';
 65  
 66  type Caller = { kind: 'cookie' | 'bearer'; token: string };
 67  /** Call an endpoint from the registry: path parameters from `ids`, the body sample for the caller's tenant. */
 68  function send(
 69    id: keyof typeof endpoints,
 70    e: EndpointContract,
 71    caller: Caller,
 72    ids: (p: string) => string,
 73    t: Tenant,
 74  ) {
 75    const path = e.path.replace(/\{([A-Za-z]+)\}/g, (_, p: string) => ids(p));
 76    let req = request(app)[e.method](path);
 77    if (caller.kind === 'bearer') {
 78      req = req.set('Authorization', `Bearer ${caller.token}`);
 79    } else {
 80      req = req
 81        .set('Cookie', `${AUTH_COOKIES.access}=${caller.token}; ${AUTH_COOKIES.csrf}=matrix-csrf`)
 82        .set('Origin', TEST_WEB_ORIGIN)
 83        .set(CSRF_HEADER, 'matrix-csrf');
 84    }
 85    const body = BODIES[id]?.(t);
 86    return body ? req.send(body) : req.send();
 87  }
 88  
 89  /** The tenant's own caller for an endpoint's audience: the owner on merchant endpoints, the agent on agent ones. */
 90  const callerFor = (e: EndpointContract, t: Tenant): Caller =>
 91    e.audience === 'agent'
 92      ? { kind: 'bearer', token: t.agent.token }
 93      : { kind: 'cookie', token: t.owner.token };
 94  
 95  /** Everything of tenant B, as the table owner sees it — compared before and after the matrix runs. */
 96  const snapshot = async (merchantId: string) =>
 97    (
 98      await owner.query(
 99        `SELECT json_build_object(
100           'merchant', (SELECT row_to_json(m) FROM tenancy.merchants m WHERE id = $1),
101           'branches', (SELECT json_agg(b ORDER BY b.id) FROM tenancy.branches b WHERE merchant_id = $1),
102           'roles', (SELECT json_agg(r ORDER BY r.id) FROM tenancy.roles r WHERE merchant_id = $1),
103           'memberships', (SELECT json_agg(mm ORDER BY mm.id) FROM tenancy.merchant_memberships mm WHERE merchant_id = $1),
104           'invitations', (SELECT json_agg(i ORDER BY i.id) FROM tenancy.invitations i WHERE merchant_id = $1)
105         )::text AS s`,
106        [merchantId],
107      )
108    ).rows[0].s as string;
109  
110  const answer = (res: request.Response) => ({
111    status: res.status,
112    code: res.body?.error?.code,
113    message: res.body?.error?.message,
114  });
115  
116  let A: Tenant;
117  let B: Tenant;
118  beforeAll(async () => {
119    A = await setUp('Matrix Alpha');
120    B = await setUp('Matrix Beta');
121  });
122  
123  describe('the matrix covers every tenant endpoint in the registry', () => {
124    it('finds the tenant endpoints (control)', () => {
125      expect(TENANT_ENDPOINTS.length).toBeGreaterThanOrEqual(20);
126      expect(withParams.length).toBeGreaterThanOrEqual(8);
127    });
128  
129    it('every path parameter has a resolver — a new one fails here until the matrix can address it', () => {
130      const unresolved = withParams.flatMap(([id, e]) =>
131        paramsOf(e)
132          .filter((p) => !RESOLVERS[p])
133          .map((p) => `${id}: {${p}}`),
134      );
135      expect(unresolved).toEqual([]);
136    });
137  
138    it('every request body has a sample that satisfies its contract', () => {
139      const problems = TENANT_ENDPOINTS.flatMap(([id, e]) => {
140        if (!e.request?.body) return [];
141        const sample = BODIES[id];
142        if (!sample) return [`${id}: no sample body`];
143        return e.request.body.safeParse(sample(A)).success ? [] : [`${id}: sample does not match the contract`];
144      });
145      expect(problems).toEqual([]);
146    });
147  });
148  
149  describe('another tenant’s resources are not found (T15)', () => {
150    it.each(withParams)(
151      '%s: B’s resource → 404, the same answer as a missing one; B unchanged',
152      async (id, e) => {
153        const before = await snapshot(B.merchantId);
154        const foreign = await send(id, e, callerFor(e, A), (p) => RESOLVERS[p]!(B), A);
155        const missing = await send(id, e, callerFor(e, A), () => MISSING, A);
156        expect(answer(foreign), JSON.stringify(foreign.body)).toEqual({
157          status: 404,
158          code: 'NOT_FOUND',
159          message: expect.any(String),
160        });
161        expect(answer(foreign)).toEqual(answer(missing));
162        expect(await snapshot(B.merchantId)).toBe(before);
163      },
164    );
165  
166    it.each(withParams)('%s: control — the same call on A’s own resource is not a 404', async (id, e) => {
167      const own = await send(id, e, callerFor(e, A), (p) => RESOLVERS[p]!(A), A);
168      expect(own.status, JSON.stringify(own.body)).not.toBe(404);
169    });
170  });
171  
172  describe('collections show nothing of another tenant', () => {
173    it.each(withoutParams)('%s: no identifier, email or name of B in A’s answer', async (id, e) => {
174      const res = await send(id, e, callerFor(e, A), () => '', A);
175      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
176      const text = JSON.stringify(res.body);
177      const markers = [
178        B.merchantId,
179        B.owner.membershipId,
180        B.owner.email,
181        B.staff.membershipId,
182        B.staff.email,
183        B.agent.membershipId,
184        B.agent.email,
185        B.target.membershipId,
186        B.target.email,
187        B.roleId,
188        B.branchId,
189        B.invitationId,
190        'Matrix Beta',
191      ];
192      expect(markers.filter((m) => text.includes(m))).toEqual([]);
193    });
194  });
195  
196  describe('same tenant, wrong kind (T9)', () => {
197    const merchantEndpoints = TENANT_ENDPOINTS.filter(([, e]) => e.audience === 'merchant');
198    const forbids = (e: EndpointContract) => /^FORBIDDEN/.test(e.responses[403]?.description ?? '');
199  
200    // ADR-15 T5/T7: a staff branch restriction is stored and re-read per request, but no branch-scoped data exists in
201    // P4, so nothing reads it yet. That is safe only while staff and agents can reach their own membership and nothing
202    // else. Any endpoint that opens to them fails here until its branch scope is decided (and tested) — P5 policies.
203    it('staff and agents reach only their own membership — nothing branch-scoped is open to them yet', () => {
204      expect(merchantEndpoints.filter(([, e]) => !forbids(e)).map(([id]) => id)).toEqual([
205        'getCurrentMembership',
206      ]);
207      expect(TENANT_ENDPOINTS.filter(([, e]) => e.audience === 'agent').map(([id]) => id)).toEqual([
208        'getAgentMembership',
209      ]);
210    });
211  
212    it.each(merchantEndpoints)(
213      '%s: staff get 403 where the contract documents FORBIDDEN, success otherwise',
214      async (id, e) => {
215        const before = await snapshot(A.merchantId);
216        const res = await send(id, e, { kind: 'cookie', token: A.staff.token }, (p) => RESOLVERS[p]!(A), A);
217        if (forbids(e)) {
218          expect(answer(res), JSON.stringify(res.body)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
219          expect(await snapshot(A.merchantId)).toBe(before);
220        } else {
221          expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
222        }
223      },
224    );
225  });
226  
227  describe('wrong audience or transport', () => {
228    let platform: Awaited<ReturnType<typeof platformAdmin>>;
229    beforeAll(async () => {
230      platform = await platformAdmin();
231    });
232  
233    it.each(TENANT_ENDPOINTS)(
234      '%s: refused to the other tenant audience and to a platform session',
235      async (id, e) => {
236        const ids = (p: string) => RESOLVERS[p]!(A);
237        if (e.audience === 'merchant') {
238          expect((await send(id, e, { kind: 'bearer', token: A.agent.token }, ids, A)).status).toBe(401);
239          const asPlatform = await send(id, e, { kind: 'cookie', token: platform.token }, ids, A);
240          expect(answer(asPlatform)).toMatchObject({ status: 403, code: 'WRONG_AUDIENCE' });
241        } else {
242          expect((await send(id, e, { kind: 'cookie', token: A.owner.token }, ids, A)).status).toBe(401);
243          expect((await send(id, e, { kind: 'bearer', token: A.owner.token }, ids, A)).status).toBe(401);
244        }
245      },
246    );
247  });
```

### `apps/api/test/tenancy/tenant-scope-guard.test.ts` — lines 1–103

Source guard: tenant tables only via the scoped repository.

```ts
  1  import fs from 'node:fs';
  2  import path from 'node:path';
  3  import { fileURLToPath } from 'node:url';
  4  import pg from 'pg';
  5  import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
  6  import { tenancyRepository } from '../../src/modules/tenancy/repository.js';
  7  
  8  // ADR-15 T14 — no unscoped repository for tenant data — checked against the source. The tenant tables are read from
  9  // the migrated database (every table under row-level security), so a new tenant table is covered without editing
 10  // this test. In apps/api/src, such a table may be named only in a scoped repository (which reaches it through a
 11  // TenantTx; test/tenancy/repository.test.ts proves each function refuses anything else) or in the audit log (which
 12  // sets the tenant of the event itself). Setting app.merchant_id is equally confined.
 13  
 14  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
 15  
 16  /** Scoped repositories: every function takes a TenantTx and calls scopeOf first. */
 17  const SCOPED_REPOSITORIES: Record<string, object> = { 'modules/tenancy/repository.ts': tenancyRepository };
 18  /** Writes tenant audit events inside a transaction that sets that event's tenant (AuditLog). */
 19  const TENANT_SELF_SCOPING = ['modules/audit/audit-log.ts'];
 20  /** The only places that set app.merchant_id. */
 21  const SETS_TENANT = [
 22    'platform/tenant.ts', // withTenant
 23    'modules/audit/audit-log.ts', // a tenant event recorded on its own
 24    'modules/tenancy/merchant-lifecycle.ts', // platform action: audit row of the target merchant (P4.1)
 25  ];
 26  
 27  const owner = new pg.Client({ connectionString: inject('ownerDatabaseUrl') });
 28  let tenantTables: string[] = [];
 29  beforeAll(async () => {
 30    await owner.connect();
 31    const { rows } = await owner.query<{ name: string }>(`
 32      SELECT n.nspname || '.' || c.relname AS name
 33        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 34       WHERE c.relkind = 'r' AND c.relrowsecurity
 35         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
 36       ORDER BY 1`);
 37    tenantTables = rows.map((r) => r.name);
 38  });
 39  afterAll(() => owner.end());
 40  
 41  function sourceFiles(dir: string): string[] {
 42    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
 43      const full = path.join(dir, e.name);
 44      return e.isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
 45    });
 46  }
 47  const files = sourceFiles(SRC).map((full) => ({
 48    file: path.relative(SRC, full).split(path.sep).join('/'),
 49    text: fs.readFileSync(full, 'utf8'),
 50  }));
 51  
 52  /** `tenancy.branches`, `"tenancy"."branches"`, `tenancy."branches"` … as a whole name. */
 53  const mentions = (text: string, table: string) => {
 54    const [schema, name] = table.split('.');
 55    return new RegExp(`(?<![\\w.])"?${schema}"?\\s*\\.\\s*"?${name}"?(?![\\w])`).test(text);
 56  };
 57  
 58  describe('tenant data only through scoped repositories (T14)', () => {
 59    it('finds the tenant tables (control)', () => {
 60      expect(tenantTables).toEqual(
 61        expect.arrayContaining([
 62          'tenancy.merchants',
 63          'tenancy.branches',
 64          'tenancy.roles',
 65          'tenancy.merchant_memberships',
 66          'ledger.journal_lines',
 67          'audit.audit_events',
 68        ]),
 69      );
 70    });
 71  
 72    it('no other source file names a tenant table', () => {
 73      const allowed = new Set([...Object.keys(SCOPED_REPOSITORIES), ...TENANT_SELF_SCOPING]);
 74      const offenders = files.flatMap(({ file, text }) =>
 75        allowed.has(file) ? [] : tenantTables.filter((t) => mentions(text, t)).map((t) => `${file}: ${t}`),
 76      );
 77      expect(offenders).toEqual([]);
 78    });
 79  
 80    it('a scoped repository reaches tenant tables only through functions that call scopeOf', () => {
 81      for (const [file, repository] of Object.entries(SCOPED_REPOSITORIES)) {
 82        const text = files.find((f) => f.file === file)!.text;
 83        // Each `async name(tx: TenantTx, …) { … }` body starts with scopeOf(tx); no other query handle exists.
 84        const functions = [...text.matchAll(/async (\w+)\(\s*tx: TenantTx[^)]*\)[^{]*\{\n\s*(.*)/g)];
 85        expect(functions.map(([, name]) => name).sort(), file).toEqual(Object.keys(repository).sort());
 86        for (const [, name, firstLine] of functions)
 87          expect(firstLine, `${file}: ${name}`).toMatch(/scopeOf\(tx\)/);
 88        expect(text, file).not.toMatch(/\bdb\.(query|transaction)\b/);
 89      }
 90    });
 91  
 92    it('only withTenant, the audit log and the lifecycle service set app.merchant_id', () => {
 93      const setters = files.filter(({ text }) => text.includes(`'app.merchant_id'`)).map((f) => f.file);
 94      expect(setters.sort()).toEqual([...SETS_TENANT].sort());
 95    });
 96  
 97    it('the matcher recognises quoted and unquoted names, and not prefixes (control)', () => {
 98      expect(mentions('FROM tenancy.roles WHERE', 'tenancy.roles')).toBe(true);
 99      expect(mentions('FROM "tenancy"."roles"', 'tenancy.roles')).toBe(true);
100      expect(mentions('FROM tenancy.roles_archive', 'tenancy.roles')).toBe(false);
101      expect(mentions('identity.validate_session', 'tenancy.roles')).toBe(false);
102    });
103  });
```

### `packages/db/test/tenant-schema-guard.test.ts` — lines 1–101

Catalog guard: RLS, (merchant_id, id), paired FKs.

```ts
  1  import type pg from 'pg';
  2  import { afterAll, beforeAll, describe, expect, it } from 'vitest';
  3  import { connectAs } from './support/db.js';
  4  
  5  // P4 exit criterion 2 (ADR-15 T13), enforced from the catalog — not from hand-kept lists: any table, present or
  6  // future, with a merchant_id column must carry the tenant rules. A new tenant table that forgets one fails here.
  7  //
  8  //   1. RLS is enabled and at least one policy applies to alphakolect_app.
  9  //   2. merchant_id NOT NULL + an id column ⇒ a unique index on exactly (merchant_id, id), so other tenant tables can
 10  //      reference it by composite key; without an id column, the primary key must include merchant_id.
 11  //   3. Every foreign key between two tenant tables pairs merchant_id with merchant_id (a composite key), so a row
 12  //      can never reference another tenant's row. References to tenancy.merchants (the tenant root) are exempt.
 13  
 14  let owner: pg.Client;
 15  beforeAll(async () => {
 16    owner = await connectAs('migrator');
 17  });
 18  afterAll(() => owner.end());
 19  
 20  type Table = { table: string; nullable: boolean; has_id: boolean };
 21  
 22  const tenantTables = async () =>
 23    (
 24      await owner.query<Table>(`
 25        SELECT format('%I.%I', n.nspname, c.relname) AS table,
 26               NOT a.attnotnull AS nullable,
 27               EXISTS (SELECT 1 FROM pg_attribute i WHERE i.attrelid = c.oid AND i.attname = 'id' AND NOT i.attisdropped) AS has_id
 28          FROM pg_class c
 29          JOIN pg_namespace n ON n.oid = c.relnamespace
 30          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'merchant_id' AND NOT a.attisdropped
 31         WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
 32         ORDER BY 1`)
 33    ).rows;
 34  
 35  describe('every tenant table carries the tenant rules (catalog-driven)', () => {
 36    it('finds the tenant tables (sanity: the guard is looking at the real schema)', async () => {
 37      const names = (await tenantTables()).map((t) => t.table);
 38      for (const expected of [
 39        'tenancy.branches',
 40        'tenancy.roles',
 41        'tenancy.merchant_memberships',
 42        'ledger.ledgers',
 43        'ledger.journal_lines',
 44        'audit.audit_events',
 45      ]) {
 46        expect(names).toContain(expected);
 47      }
 48    });
 49  
 50    it('1. RLS is enabled, with a policy for the app', async () => {
 51      const { rows } = await owner.query<{ table: string }>(`
 52        SELECT format('%I.%I', n.nspname, c.relname) AS table
 53          FROM pg_class c
 54          JOIN pg_namespace n ON n.oid = c.relnamespace
 55          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'merchant_id' AND NOT a.attisdropped
 56         WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
 57           AND (NOT c.relrowsecurity OR NOT EXISTS (
 58                 SELECT 1 FROM pg_policy p
 59                  WHERE p.polrelid = c.oid AND 'alphakolect_app'::regrole = ANY (p.polroles)))
 60         ORDER BY 1`);
 61      expect(rows.map((r) => r.table)).toEqual([]);
 62    });
 63  
 64    it('2. a (merchant_id, id) unique key — or merchant_id inside the primary key when there is no id', async () => {
 65      const { rows } = await owner.query<{ table: string }>(`
 66        SELECT format('%I.%I', n.nspname, c.relname) AS table
 67          FROM pg_class c
 68          JOIN pg_namespace n ON n.oid = c.relnamespace
 69          JOIN pg_attribute m ON m.attrelid = c.oid AND m.attname = 'merchant_id' AND NOT m.attisdropped AND m.attnotnull
 70          LEFT JOIN pg_attribute i ON i.attrelid = c.oid AND i.attname = 'id' AND NOT i.attisdropped
 71         WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
 72           AND CASE
 73                 WHEN i.attnum IS NOT NULL THEN NOT EXISTS (
 74                   SELECT 1 FROM pg_index x
 75                    WHERE x.indrelid = c.oid AND x.indisunique AND x.indpred IS NULL AND x.indnkeyatts = 2
 76                      AND x.indkey[0] = m.attnum AND x.indkey[1] = i.attnum)
 77                 ELSE NOT EXISTS (
 78                   SELECT 1 FROM pg_index x
 79                    WHERE x.indrelid = c.oid AND (x.indisprimary OR x.indisunique) AND x.indpred IS NULL
 80                      AND m.attnum = ANY (x.indkey::int2[]))
 81               END
 82         ORDER BY 1`);
 83      expect(rows.map((r) => r.table)).toEqual([]);
 84    });
 85  
 86    it('3. every foreign key between tenant tables pairs merchant_id with merchant_id', async () => {
 87      const { rows } = await owner.query<{ fk: string }>(`
 88        SELECT format('%I.%I.%I', n.nspname, c.relname, k.conname) AS fk
 89          FROM pg_constraint k
 90          JOIN pg_class c ON c.oid = k.conrelid
 91          JOIN pg_namespace n ON n.oid = c.relnamespace
 92          JOIN pg_attribute cm ON cm.attrelid = k.conrelid AND cm.attname = 'merchant_id' AND NOT cm.attisdropped
 93          JOIN pg_attribute rm ON rm.attrelid = k.confrelid AND rm.attname = 'merchant_id' AND NOT rm.attisdropped
 94         WHERE k.contype = 'f'
 95           AND NOT EXISTS (
 96             SELECT 1 FROM generate_subscripts(k.conkey, 1) s
 97              WHERE k.conkey[s] = cm.attnum AND k.confkey[s] = rm.attnum)
 98         ORDER BY 1`);
 99      expect(rows.map((r) => r.fk)).toEqual([]);
100    });
101  });
```

### `packages/contracts/test/tenant-boundary.test.ts` — lines 1–48

No merchantId in any tenant request.

```ts
 1  import { describe, expect, it } from 'vitest';
 2  import { buildDocument } from '../scripts/openapi-document.js';
 3  import { endpoints, type EndpointContract } from '../src/index.js';
 4  
 5  // TARGET_ARCHITECTURE §4, ADR-15 T3: the tenant of a merchant or agent request is its session membership. No
 6  // tenant-audience contract may accept a merchantId — in its path, query, headers or body, at any depth — so a client
 7  // cannot even ask for another tenant. Checked on the generated OpenAPI document (what clients actually see).
 8  
 9  const TENANT_AUDIENCES = new Set(['merchant', 'agent']);
10  const doc = buildDocument();
11  
12  /** Every property name reachable from a JSON schema (following $refs into components). */
13  function propertyNames(schema: unknown, seen = new Set<unknown>()): string[] {
14    if (!schema || typeof schema !== 'object' || seen.has(schema)) return [];
15    seen.add(schema);
16    const s = schema as Record<string, unknown>;
17    if (typeof s.$ref === 'string') {
18      const name = s.$ref.split('/').pop()!;
19      return propertyNames(doc.components?.schemas?.[name], seen);
20    }
21    const own = Object.keys((s.properties as object | undefined) ?? {});
22    return [...own, ...Object.values(s).flatMap((child) => propertyNames(child, seen))];
23  }
24  
25  function requestNames(endpoint: EndpointContract): string[] {
26    type Operation = { parameters?: { name: string }[]; requestBody?: unknown };
27    const operation = (doc.paths?.[endpoint.path] as Record<string, Operation> | undefined)?.[endpoint.method];
28    return [...(operation?.parameters ?? []).map((p) => p.name), ...propertyNames(operation?.requestBody)];
29  }
30  
31  const tenantEndpoints = Object.values(endpoints as Record<string, EndpointContract>).filter((e) =>
32    TENANT_AUDIENCES.has(e.audience),
33  );
34  
35  describe('no client-supplied tenant (§4)', () => {
36    it('there are tenant-audience endpoints to check', () => {
37      expect(tenantEndpoints.length).toBeGreaterThan(0);
38    });
39  
40    it.each(tenantEndpoints.map((e) => [e.id, e] as const))('%s accepts no merchantId', (_id, endpoint) => {
41      expect(requestNames(endpoint).filter((n) => /merchant_?id/i.test(n))).toEqual([]);
42    });
43  
44    it('the check can see request fields at all (control)', () => {
45      const update = endpoints.updateBranch;
46      expect(requestNames(update)).toEqual(expect.arrayContaining(['branchId', 'name', 'status']));
47    });
48  });
```

---

2198 source lines in 27 excerpts.
