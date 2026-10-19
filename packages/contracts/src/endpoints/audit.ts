import { z } from 'zod';
import { ErrorResponse, Id, PageQuery } from '../primitives.js';
import { defineEndpoint } from '../registry.js';
import { Timestamp } from './merchant.js';

// The activity-record reads (P5.8; TARGET_ARCHITECTURE ADR-16 §3.5, "Addendum — the activity-record reads", confirmed
// by the independent reviewer on 2026-10-19). Two sensitive reads, each page recorded before it is returned:
// GET /v1/merchant/audit-events (#33, the owner only) and GET /v1/platform/audit-events (#34). Both take a required
// window of at most 31 days and at most 100 events a page (O4), newest first by (occurredAt, eventId), with an opaque
// cursor bound to the window and filters it was issued for.

/** The event identifiers of the catalog: lowercase words joined by dots, e.g. merchant.member_deactivated. */
const EventIdentifier = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/)
  .meta({ description: 'An activity-record event identifier, e.g. auth.login' });

const Window = {
  /** The window's start, included: an ISO 8601 timestamp with an offset. */
  from: z.iso
    .datetime({ offset: true })
    .meta({ description: 'Start of the window, included (ISO 8601, with an offset)' }),
  /** The window's end, excluded; at most 31 days after `from`. */
  to: z.iso
    .datetime({ offset: true })
    .meta({
      description: 'End of the window, excluded; at most 31 days after `from` (ISO 8601, with an offset)',
    }),
};

export const MerchantAuditEventsQuery = PageQuery.extend({
  ...Window,
  /** One member of the business, any status: that person's events in this business (O3, O4). */
  membershipId: Id.optional(),
});
export type MerchantAuditEventsQuery = z.infer<typeof MerchantAuditEventsQuery>;

export const PlatformAuditEventsQuery = PageQuery.extend({
  ...Window,
  /** One business. */
  merchantId: Id.optional(),
  /** One person, by any of their memberships: all of that person's events. */
  membershipId: Id.optional(),
  /** One kind of activity: a catalog event identifier. */
  event: EventIdentifier.optional(),
});
export type PlatformAuditEventsQuery = z.infer<typeof PlatformAuditEventsQuery>;

/**
 * Who acted, each field as recorded and each nullable on its own (nothing is inferred): the audience of the session
 * the person acted through, or null when the event records none (an invitation acceptance, for one); the membership
 * the event records; the person's email as it is when read.
 */
export const AuditActor = z
  .object({
    audience: z.enum(['merchant', 'agent', 'platform']).nullable(),
    membershipId: Id.nullable(),
    email: z.string().nullable(),
  })
  .meta({
    id: 'AuditActor',
    description: 'Who acted, as recorded; null fields are not recorded or withheld',
  });
export type AuditActor = z.infer<typeof AuditActor>;

const auditEventFields = {
  eventId: Id,
  occurredAt: Timestamp,
  /** The catalog identifier, e.g. merchant.member_deactivated. */
  event: z.string(),
  outcome: z.enum(['success', 'failure', 'denied']),
  /** Null when the event records no person (a sign-in to an unknown email, an operator's command). */
  actor: AuditActor.nullable(),
  target: z.object({ type: z.string(), id: z.string() }).nullable(),
  /** The catalog's allowlisted fields for this event: never credentials, tokens or request bodies. */
  summary: z.record(z.string(), z.unknown()),
  /** Null where the reader may not see it. */
  ip: z.string().nullable(),
  /** Null where the reader may not see it. */
  userAgent: z.string().nullable(),
};

export const MerchantAuditEvent = z
  .object({
    ...auditEventFields,
    /** 'AlphaKolect team' when the AlphaKolect team acted (its person unnamed, O19); otherwise null. */
    actorLabel: z.literal('AlphaKolect team').nullable(),
  })
  .meta({
    id: 'MerchantAuditEvent',
    description:
      'One event of the business’s record. The AlphaKolect team’s actions show no membership, email, IP address or device',
  });
export type MerchantAuditEvent = z.infer<typeof MerchantAuditEvent>;

export const PlatformAuditEvent = z.object({ ...auditEventFields, merchantId: Id.nullable() }).meta({
  id: 'PlatformAuditEvent',
  description: 'One event of the platform’s record; the IP address and device to the super admin only',
});
export type PlatformAuditEvent = z.infer<typeof PlatformAuditEvent>;

export const MerchantAuditEventList = z
  .object({ items: z.array(MerchantAuditEvent), nextCursor: z.string().nullable() })
  .meta({ id: 'MerchantAuditEventList', description: 'Newest first' });
export type MerchantAuditEventList = z.infer<typeof MerchantAuditEventList>;

export const PlatformAuditEventList = z
  .object({ items: z.array(PlatformAuditEvent), nextCursor: z.string().nullable() })
  .meta({ id: 'PlatformAuditEventList', description: 'Newest first' });
export type PlatformAuditEventList = z.infer<typeof PlatformAuditEventList>;

const error = (description: string) => ({ description, schema: ErrorResponse });
const badRequest = {
  400: error(
    'VALIDATION_ERROR — a missing, inverted or longer than 31 days window, a limit outside 1–100, a malformed identifier or an unknown event; INVALID_CURSOR — not a cursor of this window and these filters',
  ),
};

export const listMerchantAuditEvents = defineEndpoint({
  id: 'listMerchantAuditEvents',
  method: 'get',
  path: '/v1/merchant/audit-events',
  authorization: { class: 'permission', permission: 'merchant.audit.read', branchScope: 'merchant_wide' },
  audience: 'merchant',
  security: ['cookieSession'],
  summary: 'The business’s activity record, newest first (the owner only; each page is itself recorded)',
  request: { query: MerchantAuditEventsQuery },
  responses: {
    200: { description: 'One page of the business’s events', schema: MerchantAuditEventList },
    ...badRequest,
    403: error('FORBIDDEN — only the business owner'),
    404: error('NOT_FOUND — the membership is not one of this business'),
  },
});

export const listPlatformAuditEvents = defineEndpoint({
  id: 'listPlatformAuditEvents',
  method: 'get',
  path: '/v1/platform/audit-events',
  authorization: { class: 'permission', permission: 'platform.audit.read', branchScope: 'merchant_wide' },
  audience: 'platform',
  security: ['cookieSession'],
  summary: 'The platform’s activity record, newest first (each page is itself recorded)',
  request: { query: PlatformAuditEventsQuery },
  responses: {
    200: { description: 'One page of the platform’s events', schema: PlatformAuditEventList },
    ...badRequest,
    403: error('FORBIDDEN — the caller does not hold platform.audit.read; a super admin can give it'),
    404: error('NOT_FOUND — no such business, or no such membership'),
  },
});
