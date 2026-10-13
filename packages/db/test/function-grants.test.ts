import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, expectSqlState, SQLSTATE } from './support/db.js';

// Execute-grant inventory (P5 plan §9.1, R31): started in P5.1 and extended by every later package. Every function in
// a module schema is listed below with who may execute it besides its owner. A function missing from the list, an
// extra one, or a grant that differs from the list fails here — so a new function is a deliberate, reviewed decision,
// and a forgotten REVOKE (PUBLIC can execute a new function unless it is revoked) cannot slip through. For each
// function the app may not execute, a call as alphakolect_app is refused before the function runs.
//
// The grant tables of P5.1 are written by no function yet; the writers arrive with their authorization foundation
// (tenancy.set_role_permissions in P5.6, identity.set_platform_grants in P5.7) and are added to GRANT_TABLE_WRITERS then.

const MODULE_SCHEMAS = [
  'audit',
  'billing',
  'customers',
  'documents',
  'identity',
  'investments',
  'jobs',
  'kyc',
  'ledger',
  'loans',
  'notifications',
  'payments',
  'savings',
  'support',
  'tenancy',
  'util',
];

type Grantee = 'alphakolect_app' | 'alphakolect_readonly' | 'PUBLIC';
const APP: Grantee[] = ['alphakolect_app'];
const OWNER_ONLY: Grantee[] = [];

/** Every function in a module schema → who may execute it besides its owner, alphakolect_migrator. */
const EXPECTED: Record<string, Grantee[]> = {
  // audit — P5.3a: the catalog's protection and the validation trigger on audit.audit_events (trigger functions)
  'audit.protect_event_catalog()': OWNER_ONLY,
  'audit.validate_event()': OWNER_ONLY,
  // identity — request paths (P3/P4)
  'identity.accept_totp_step(uuid, bigint)': APP,
  'identity.account_for_email(text)': APP,
  'identity.begin_totp_enrollment(uuid, bytea, text)': APP,
  'identity.change_password(uuid, text)': APP,
  'identity.complete_account_setup(text, text)': APP,
  'identity.confirm_totp_enrollment(uuid, bigint, text[])': APP,
  'identity.consume_mfa_challenge(text)': APP,
  'identity.consume_recovery_code(uuid, text)': APP,
  'identity.create_mfa_challenge(uuid, uuid, text)': APP,
  'identity.create_session(uuid, text, uuid, text, text, integer, integer, text, text)': APP,
  'identity.credentials_for(uuid)': APP,
  'identity.issue_one_time_token(uuid, text, text, integer, text)': APP,
  'identity.login_identity(text)': APP,
  'identity.mfa_credential(uuid)': APP,
  'identity.rehash_password(uuid, text, text)': APP,
  'identity.reset_password(text, text)': APP,
  'identity.resolve_login_membership(uuid, text, text)': APP,
  'identity.revoke_all_sessions(uuid, text)': APP,
  'identity.revoke_session(uuid, text)': APP,
  'identity.rotate_refresh_token(text, text, integer, text[])': APP,
  'identity.selection_choices(text)': APP,
  'identity.session_authority(uuid)': APP, // P5.2: the per-request resolver
  'identity.signup_merchant_owner(text, text, text)': APP,
  'identity.take_mfa_challenge_attempt(text)': APP,
  'identity.take_selection(text, uuid)': APP,
  'identity.validate_session(uuid)': APP,
  'identity.verify_email(text)': APP,
  // identity — inner helpers called only by other definer functions, the operator CLI, and trigger functions
  'identity.active_membership(uuid, text, uuid)': OWNER_ONLY,
  'identity.apply_new_password(uuid, text, text)': OWNER_ONLY,
  'identity.bootstrap_super_admin(text, boolean)': OWNER_ONLY,
  'identity.check_grantable_permission()': OWNER_ONLY,
  'identity.consume_one_time_token(text, text)': OWNER_ONLY,
  'identity.eligible_memberships(uuid, text)': OWNER_ONLY,
  'identity.protect_permission_catalog()': OWNER_ONLY,
  'identity.session_limits(text, text)': OWNER_ONLY,
  'identity.permissions_of(text, text, text, uuid, uuid, uuid)': OWNER_ONLY, // P5.2: inner, the one permission rule
  // P5.5 step 1: the lock helpers (§7.2 L5) — called only by definer functions
  'identity.lock_one_time_tokens(uuid[], uuid[])': OWNER_ONLY,
  'identity.lock_platform_memberships(uuid[], uuid[])': OWNER_ONLY,
  // tenancy
  'tenancy.accept_invitation(text, uuid)': APP,
  'tenancy.issue_invitation(uuid, text, text, uuid, uuid, text, text, integer)': APP,
  'tenancy.list_members(uuid, uuid)': APP,
  'tenancy.revoke_invitation(uuid, uuid)': APP,
  'tenancy.set_merchant_status(uuid, uuid, text, text)': APP,
  'tenancy.transfer_ownership(uuid, uuid, uuid, uuid, boolean)': APP,
  'tenancy.update_membership(uuid, uuid, text, uuid, uuid)': APP,
  'tenancy.admit_invitation_locked(uuid, uuid)': OWNER_ONLY, // P5.5 step 2: admission waits for nothing (L6)
  'tenancy.assert_authority(uuid, text)': OWNER_ONLY, // P5.2: nested write-time re-check (L6), definer callers only
  'tenancy.merchant_keeps_one_owner()': OWNER_ONLY,
  'tenancy.lock_branches(uuid[], uuid[])': OWNER_ONLY,
  'tenancy.lock_invitations(uuid[], uuid[])': OWNER_ONLY,
  'tenancy.lock_memberships(uuid[], uuid[])': OWNER_ONLY,
  'tenancy.lock_merchants(uuid[], uuid[])': OWNER_ONLY,
  'tenancy.lock_roles(uuid[], uuid[])': OWNER_ONLY,
  // ledger (P1 invariants: trigger and its check, never called by the app)
  'ledger.assert_entry_balanced(uuid)': OWNER_ONLY,
  'ledger.check_entry_balanced_trigger()': OWNER_ONLY,
  // util — id default and RLS helper run as the querying role; the rate limiter is a request path
  'util.current_merchant_id()': APP,
  'util.rate_limit_hit(text, integer, integer)': APP,
  'util.uuid_v7()': APP,
  'util.reject_modification()': OWNER_ONLY,
};

/** Functions whose body writes a grant table or the catalog. None in P5.1. */
const GRANT_TABLE_WRITERS: string[] = [];

let owner: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  owner = await connectAs('migrator');
  app = await connectAs('app');
});
afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

type Fn = {
  fn: string;
  schema: string;
  name: string;
  args: string;
  owner: string;
  grantees: Grantee[];
  src: string;
};

async function moduleFunctions(): Promise<Fn[]> {
  const { rows } = await owner.query<Fn>(
    `SELECT n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS fn,
            n.nspname AS schema, p.proname AS name, oidvectortypes(p.proargtypes) AS args,
            pg_get_userbyid(p.proowner) AS owner, coalesce(p.prosrc, '') AS src,
            -- A NULL ACL means the default one, which lets PUBLIC execute: acldefault makes that visible.
            coalesce((SELECT array_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
                                       ORDER BY 1)
                        FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner), '{}'::text[]) AS grantees
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = ANY ($1)
      ORDER BY 1`,
    [MODULE_SCHEMAS],
  );
  return rows;
}

describe('execute-grant inventory (plan §9.1, R31)', () => {
  it('every function in a module schema is listed, with exactly its listed grantees', async () => {
    const actual = Object.fromEntries((await moduleFunctions()).map((f) => [f.fn, f.grantees]));
    expect(actual).toEqual(EXPECTED);
  });

  it('effective EXECUTE (has_function_privilege: role membership and PUBLIC included) matches the list', async () => {
    const { rows } = await owner.query<{ fn: string; app: boolean; readonly: boolean }>(
      `SELECT n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS fn,
              has_function_privilege('alphakolect_app', p.oid, 'EXECUTE') AS app,
              has_function_privilege('alphakolect_readonly', p.oid, 'EXECUTE') AS readonly
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ANY ($1)`,
      [MODULE_SCHEMAS],
    );
    const effective = Object.fromEntries(rows.map((r) => [r.fn, { app: r.app, readonly: r.readonly }]));
    const expected = Object.fromEntries(
      Object.entries(EXPECTED).map(([fn, g]) => [
        fn,
        {
          app: g.includes('alphakolect_app') || g.includes('PUBLIC'),
          readonly: g.includes('alphakolect_readonly') || g.includes('PUBLIC'),
        },
      ]),
    );
    expect(effective).toEqual(expected);
  });

  it('every function is owned by the migrator', async () => {
    const owners = new Set((await moduleFunctions()).map((f) => f.owner));
    expect(owners).toEqual(new Set(['alphakolect_migrator']));
  });

  it('the app is refused every function it may not execute, before the function runs', async () => {
    const refused = (await moduleFunctions()).filter((f) => !f.grantees.includes('alphakolect_app'));
    expect(refused.map((f) => f.fn).sort()).toEqual(
      Object.entries(EXPECTED)
        .filter(([, g]) => !g.includes('alphakolect_app'))
        .map(([fn]) => fn)
        .sort(),
    );
    for (const f of refused) {
      const args = f.args === '' ? [] : f.args.split(', ');
      const call = `SELECT ${f.schema}.${f.name}(${args.map((t) => `NULL::${t}`).join(', ')})`;
      await expectSqlState(app.query(call), SQLSTATE.insufficientPrivilege);
    }
  });
});

describe('the permission storage of P5.1 has no writer yet', () => {
  it('no function writes the catalog or a grant table (writers arrive in P5.6 and P5.7)', async () => {
    const write =
      /\b(insert\s+into|update|delete\s+from|merge\s+into|truncate(\s+table)?)\s+(only\s+)?("?(identity|tenancy)"?\s*\.\s*)?"?(permission_catalog|role_permissions|platform_membership_grants)\b/i;
    const writers = (await moduleFunctions()).filter((f) => write.test(f.src)).map((f) => f.fn);
    expect(writers).toEqual(GRANT_TABLE_WRITERS);
  });
});
