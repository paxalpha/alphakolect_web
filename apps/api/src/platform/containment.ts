import type { Queryable } from './db.js';

// The containment switch of the over-authorization incident procedure (P5 plan §11.1, R30; P5.5). Run by an operator
// through the CLI (scripts/containment.ts, `admin:containment`) with the MIGRATOR connection:
// util.set_authorization_containment is not granted to the API's role, so a compromised API can neither set nor lift
// it. While a flag is set, every grant row of that kind counts for nothing — staff hold no merchant permission,
// platform staff no platform permission — and the owner's and the super admin's fixed sets are unaffected. Each change
// is recorded in the database in the same transaction (platform.authorization_containment_set, #39).

export type ContainmentState = { merchantGrantsSuspended: boolean; platformGrantsSuspended: boolean };

/** The current flags and when they last changed. */
export async function readContainment(migrator: Queryable): Promise<ContainmentState & { updatedAt: Date }> {
  const [row] = await migrator.query<{
    merchant_grants_suspended: boolean;
    platform_grants_suspended: boolean;
    updated_at: Date;
  }>(
    `SELECT merchant_grants_suspended, platform_grants_suspended, updated_at FROM util.authorization_containment`,
    [],
  );
  if (!row) throw new Error('util.authorization_containment has no row');
  return {
    merchantGrantsSuspended: row.merchant_grants_suspended,
    platformGrantsSuspended: row.platform_grants_suspended,
    updatedAt: row.updated_at,
  };
}

/**
 * Sets both flags (each given explicitly, so lifting one never lifts the other by accident) with the operator's reason,
 * which is recorded in #39. The database refuses a missing reason or flag (SQLSTATE 23514, a safe message).
 */
export async function setContainment(args: {
  migrator: Queryable;
  merchantGrantsSuspended: boolean;
  platformGrantsSuspended: boolean;
  reason: string;
}): Promise<ContainmentState> {
  const [row] = await args.migrator.query<{
    merchant_grants_suspended: boolean;
    platform_grants_suspended: boolean;
  }>(
    `SELECT merchant_grants_suspended, platform_grants_suspended FROM util.set_authorization_containment($1, $2, $3)`,
    [args.merchantGrantsSuspended, args.platformGrantsSuspended, args.reason],
  );
  return {
    merchantGrantsSuspended: row!.merchant_grants_suspended,
    platformGrantsSuspended: row!.platform_grants_suspended,
  };
}
