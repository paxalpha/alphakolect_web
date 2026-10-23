import type { PageQuery, PlatformMemberList, PlatformMerchantList } from '@alphakolect/contracts';
import { refusalMessage } from '../../platform/authorization.js';
import type { Db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { AuthContext } from '../../platform/http/authenticate.js';
import { decodeCursor, pageOf, POSITION_AT, type Positioned } from '../../platform/pagination.js';
import type { AuditLog } from '../audit/index.js';
import type { RequestContext } from '../../platform/request-context.js';
import type { MemberRow } from '../tenancy/index.js';
import { toMember } from '../tenancy/index.js';

// The platform team's view of the businesses (P5.7; closes P4 limitation 1): every business, and one business's
// members. Both are sensitive reads (§8.1 #35, #36; §8.2a rule 7): each page is one call of its designated database
// function, which checks platform.merchants.read under the caller's own platform-membership lock, records the read
// and returns the rows in one transaction — this service writes no read event itself and never could (the writer
// guard). A refusal by the database is recorded best effort, as P4 records its refusals.

type MerchantRow = Positioned & {
  outcome: string;
  name: string;
  status: PlatformMerchantList['items'][number]['status'];
  created_at: Date;
};
type MembershipRow = Positioned & MemberRow & { outcome: string };

const MERCHANTS_SCOPE = 'listPlatformMerchants';
/** A members cursor is bound to its business: presented for another one, it is refused. */
const membersScope = (merchantId: string) => `listPlatformMerchantMembers|merchantId=${merchantId}`;

const forbidden = () => new AppError(403, 'FORBIDDEN', refusalMessage('platform.merchants.read'));

export class PlatformMerchantListService {
  constructor(private readonly deps: { db: Db; audit: Pick<AuditLog, 'recordBestEffort'> }) {}

  async merchants(auth: AuthContext, query: PageQuery, ctx: RequestContext): Promise<PlatformMerchantList> {
    const after = decodeCursor(query.cursor, MERCHANTS_SCOPE);
    // One transaction, one call: the function records #35 and returns the page (one row more when another follows).
    const rows = await this.deps.db.transaction((tx) =>
      tx.query<MerchantRow>(
        `SELECT outcome, id, name, status, created_at, ${POSITION_AT}
           FROM tenancy.platform_list_merchants($1, $2, $3::timestamptz, $4, $5, $6, $7)`,
        [
          auth.sessionId,
          query.limit,
          after?.at ?? null,
          after?.id ?? null,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      ),
    );
    if (rows[0]?.outcome === 'forbidden') {
      await this.refused(auth, 'platform.merchant_list_read', null, ctx);
      throw forbidden();
    }
    return pageOf(rows, query.limit, MERCHANTS_SCOPE, (r) => ({
      merchantId: r.id,
      name: r.name,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async members(
    auth: AuthContext,
    merchantId: string,
    query: PageQuery,
    ctx: RequestContext,
  ): Promise<PlatformMemberList> {
    const scope = membersScope(merchantId);
    const after = decodeCursor(query.cursor, scope);
    // One transaction, one call: the function records #36 against the business and returns the page.
    const rows = await this.deps.db.transaction((tx) =>
      tx.query<MembershipRow>(
        `SELECT outcome, id, id AS membership_id, kind, status, email, role_id, branch_id, created_at, deactivated_at,
                ${POSITION_AT}
           FROM tenancy.platform_list_merchant_members($1, $2, $3, $4::timestamptz, $5, $6, $7, $8)`,
        [
          auth.sessionId,
          merchantId,
          query.limit,
          after?.at ?? null,
          after?.id ?? null,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      ),
    );
    switch (rows[0]?.outcome) {
      case 'forbidden':
        await this.refused(auth, 'platform.merchant_members_read', merchantId, ctx);
        throw forbidden();
      case 'not_found':
        // Nothing was read: no event (P4 records none for a business that does not exist).
        throw new AppError(404, 'NOT_FOUND', 'Merchant not found');
    }
    return pageOf(rows, query.limit, scope, toMember);
  }

  /** A refusal by the database: recorded best effort, with the actor from the validated session (§8.2a rule 5). */
  private async refused(
    auth: AuthContext,
    action: 'platform.merchant_list_read' | 'platform.merchant_members_read',
    merchantId: string | null,
    ctx: RequestContext,
  ) {
    await this.deps.audit.recordBestEffort({
      action,
      outcome: 'denied',
      actorIdentityId: auth.identityId,
      actorAudience: auth.audience,
      actorMembershipId: auth.membershipId,
      targetType: merchantId ? 'merchant' : null,
      targetId: merchantId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      summary: { reason: 'forbidden' },
    });
  }
}
