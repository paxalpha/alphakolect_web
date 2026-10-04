import type { Queryable } from '../../platform/db.js';
import type { EmailSender } from '../../platform/email.js';
import { ACCOUNT_SETUP_TTL_SECONDS, accountSetupEmail } from './emails.js';
import { newOpaqueToken } from './tokens.js';

// First super admin (ADR-14 D9, option A of 2026-10-04). Run by an operator through the CLI
// (scripts/bootstrap-super-admin.ts) with the MIGRATOR connection: identity.bootstrap_super_admin is not
// granted to the API's role, so even a compromised API cannot create a super admin.
//
// The identity is created without a password and is emailed a dedicated account-setup link. Completing it sets
// the first password and verifies the email; the first login then forces TOTP enrolment (D8). The CLI never marks
// an email verified itself, and never prints or logs the link.

export type BootstrapResult =
  | { outcome: 'setup_link_sent'; identityId: string }
  /** Created, but the email did not leave. Forgot-password on that email sends a fresh setup link. */
  | { outcome: 'setup_link_not_sent'; identityId: string; error: string }
  /** The email already belonged to an identity with a password: no link is needed; it signs in as usual. */
  | { outcome: 'existing_password'; identityId: string };

export async function bootstrapSuperAdmin(args: {
  migrator: Queryable;
  sender: EmailSender;
  webAppUrl: string;
  email: string;
  /** D9: refuse if a super admin already exists, unless explicitly adding another (audited in the database). */
  allowAdditional: boolean;
}): Promise<BootstrapResult> {
  const { migrator } = args;
  const [created] = await migrator.query<{ id: string }>(
    `SELECT identity.bootstrap_super_admin($1, $2) AS id`,
    [args.email, args.allowAdditional],
  );
  const identityId = created!.id;

  const [state] = await migrator.query<{ has_password: boolean; email: string }>(
    `SELECT password_hash IS NOT NULL AS has_password, email FROM identity.identities WHERE id = $1`,
    [identityId],
  );
  if (state!.has_password) return { outcome: 'existing_password', identityId };

  const token = newOpaqueToken();
  await migrator.query(`SELECT identity.issue_one_time_token($1, 'account_setup', $2, $3, NULL)`, [
    identityId,
    token.hash,
    ACCOUNT_SETUP_TTL_SECONDS,
  ]);
  // Awaited (not dispatched): the operator must learn whether the link left. The super admin now exists, so a
  // rerun would be refused; the way forward is forgot-password, which sends a fresh setup link.
  try {
    await args.sender.send(accountSetupEmail(state!.email, args.webAppUrl, token.raw));
  } catch (err) {
    return { outcome: 'setup_link_not_sent', identityId, error: err instanceof Error ? err.name : 'unknown' };
  }
  return { outcome: 'setup_link_sent', identityId };
}
