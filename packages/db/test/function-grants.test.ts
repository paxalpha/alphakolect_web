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
  // audit — P5.3a catalog triggers and P5.8 Part 2 operator-only purge/report functions
  'audit.audit_events_guard()': OWNER_ONLY,
  'audit.begin_purge_export(uuid, timestamp with time zone, text, text, text)': OWNER_ONLY,
  'audit.begin_report_handover(uuid, text)': OWNER_ONLY,
  'audit.cancel_purge_report_request(uuid, text)': OWNER_ONLY,
  'audit.clear_expired_request_metadata(timestamp with time zone, integer)': OWNER_ONLY,
  'audit.confirm_purge_report(uuid, timestamp with time zone, integer, integer, text, text, text)':
    OWNER_ONLY,
  'audit.d9_retention()': OWNER_ONLY,
  'audit.discard_purge_export(uuid, text, text)': OWNER_ONLY,
  'audit.event_canonical_text(audit.audit_events)': OWNER_ONLY,
  'audit.guard_pending_report_copy_destruction()': OWNER_ONLY,
  'audit.purge_candidates(uuid, timestamp with time zone, integer, integer)': OWNER_ONLY,
  'audit.purge_expired_events(uuid, timestamp with time zone, integer)': OWNER_ONLY,
  'audit.purge_lease()': OWNER_ONLY,
  'audit.record_export_artifact(uuid, timestamp with time zone)': OWNER_ONLY,
  'audit.record_handover_abandoned(uuid, text)': OWNER_ONLY,
  'audit.record_handover_failed(uuid, text)': OWNER_ONLY,
  'audit.record_handover_written(uuid, text)': OWNER_ONLY,
  'audit.record_report_copy_destroyed(uuid, text, text)': OWNER_ONLY,
  'audit.record_report_delivery(uuid, uuid, text, text)': OWNER_ONLY,
  'audit.record_report_handover(uuid, text, boolean, text)': OWNER_ONLY,
  'audit.record_report_lost(uuid, text, text)': OWNER_ONLY,
  'audit.protect_event_catalog()': OWNER_ONLY,
  'audit.release_purge_run(uuid, boolean)': OWNER_ONLY,
  'audit.renew_purge_run(uuid, timestamp with time zone)': OWNER_ONLY,
  'audit.request_purge_report(text)': OWNER_ONLY,
  'audit.reserve_purge_run(timestamp with time zone)': OWNER_ONLY,
  'audit.validate_event()': OWNER_ONLY,
  // customers (P7): the commands and reads the app calls, each deciding authority inside; the onboarding core, the
  // phone normalisation and P8's current-agent lookup are called only by definer functions
  'customers.accept_app_invitation(text, uuid, text, text, text, text)': APP,
  'customers.agent_create_customer(uuid, uuid, text, text, text, text, text, text, text, text)': APP,
  'customers.agent_customers(uuid, uuid, text, integer, timestamp with time zone, uuid)': APP,
  'customers.anonymise_customer(uuid, uuid, text, text, text)': APP,
  'customers.assign_agent(uuid, uuid, uuid, text, text, text)': APP,
  'customers.branch_of(uuid, uuid)': APP,
  'customers.create_customer(uuid, uuid, text, text, text, text, text, uuid, text, text, text)': APP,
  'customers.current_agent(uuid, uuid)': OWNER_ONLY,
  'customers.customer_result(text, uuid)': OWNER_ONLY,
  'customers.insert_customer_locked(uuid, uuid, text, text, text, text, text, uuid, uuid, uuid, text, text, text, text)':
    OWNER_ONLY,
  'customers.issue_app_invitation(uuid, uuid, text, integer, text, text, text)': APP,
  'customers.list_assignments(uuid, uuid)': APP,
  'customers.list_customers(uuid, uuid, text, uuid, text, integer, timestamp with time zone, uuid)': APP,
  'customers.normalise_phone(text)': OWNER_ONLY,
  'customers.read_self(uuid)': APP,
  'customers.set_customer_status(uuid, uuid, text, text, text, text)': APP,
  'customers.update_customer(uuid, uuid, jsonb, text, text, text)': APP,
  // payments — P9: the worker's functions (TA-11: it connects as the app), the webhook's store, the session commands and
  // reads; the order's creation and the template lookup are called by definer functions and tests only (Q2)
  'payments.claim_events(integer, integer)': APP,
  'payments.claim_orders(integer, integer)': APP,
  'payments.claim_wallets(integer, integer)': APP,
  'payments.classify_receipt(uuid, uuid, uuid, text, text, text, text)': APP,
  'payments.create_order(uuid, uuid, jsonb, bigint, text, text, uuid, text, jsonb)': OWNER_ONLY,
  'payments.list_receipts(uuid, boolean, integer, timestamp with time zone, uuid)': APP,
  'payments.merchant_wallet(uuid)': APP,
  'payments.platform_list_findings(uuid, integer, boolean, timestamp with time zone, uuid, text, text, text)':
    APP,
  'payments.platform_list_unmatched(uuid, integer, timestamp with time zone, uuid, text, text, text)': APP,
  'payments.platform_list_wallets(uuid, integer, timestamp with time zone, uuid, text, text, text)': APP,
  'payments.reconcile_wallets()': APP,
  'payments.record_event(uuid, boolean, text, text, bigint, text, text, timestamp with time zone, integer)':
    APP,
  'payments.record_finding(text, uuid, bigint, bigint)': APP,
  'payments.record_order(uuid, text, text, text, text)': APP,
  'payments.record_wallet_created(uuid, text, text, text, text)': APP,
  'payments.record_wallet_failed(uuid, text, integer)': APP,
  'payments.request_platform_wallet(uuid, text, text, text, text)': APP,
  'payments.request_wallets(text, boolean)': APP,
  'payments.resolve_finding(uuid, uuid, text, text, text, text)': APP,
  'payments.resolve_unmatched(uuid, uuid, text, uuid, text, text, text, text)': APP,
  'payments.store_event(text, jsonb, text, text)': APP,
  'payments.template_accounts(uuid, text, jsonb)': OWNER_ONLY,
  // savings — P8: the commands and reads the API calls; the commands' answers, the summary and the lock helpers are
  // called by definer functions only
  'savings.agent_collections(uuid, text, integer, timestamp with time zone, uuid)': APP,
  'savings.approve_remittance(uuid, uuid, uuid[], bigint, text, text, text)': APP,
  'savings.cancel_collection(uuid, uuid, text, text, text, text)': APP,
  'savings.collection_branch(uuid, uuid)': APP,
  'savings.collection_result(text, uuid)': OWNER_ONLY,
  'savings.create_package(uuid, text, text, bigint, text, integer, text, text, text)': APP,
  'savings.customer_savings(uuid, uuid)': APP,
  'savings.enrol_customer(uuid, uuid, uuid, text, text, text)': APP,
  'savings.list_collections(uuid, uuid, uuid, text, uuid, integer, timestamp with time zone, uuid)': APP,
  'savings.list_movements(uuid, uuid, integer, timestamp with time zone, uuid)': APP,
  'savings.list_packages(uuid, uuid, text)': APP,
  'savings.list_remittances(uuid, uuid, integer, timestamp with time zone, uuid)': APP,
  'savings.lock_collections(uuid[], uuid[])': OWNER_ONLY,
  'savings.lock_enrolments(uuid[], uuid[])': OWNER_ONLY,
  'savings.move_savings(uuid, uuid, text, bigint, text, text, text, text)': APP,
  'savings.package_result(text, uuid)': OWNER_ONLY,
  'savings.record_collection(uuid, uuid, bigint, text, text, text, text)': APP,
  'savings.self_collections(uuid, integer, timestamp with time zone, uuid)': APP,
  'savings.self_savings(uuid)': APP,
  'savings.set_target_goal(uuid, uuid, bigint, date, text, text, text)': APP,
  'savings.summary_of(uuid, uuid)': OWNER_ONLY,
  'savings.update_package(uuid, uuid, jsonb, text, text, text)': APP,
  // identity — request paths (P3/P4)
  'identity.accept_totp_step(uuid, bigint)': APP,
  'identity.account_for_email(text)': APP,
  'identity.begin_totp_enrollment(uuid, bytea, text)': APP,
  'identity.change_password(uuid, text)': APP,
  'identity.complete_account_setup(text, text, text, text, text)': APP,
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
  'tenancy.accept_invitation(text, uuid, text, text, text)': APP,
  'tenancy.issue_invitation(uuid, text, text, uuid, uuid, text, text, integer, text, text, text)': APP,
  'tenancy.list_members(uuid, uuid, integer, timestamp with time zone, uuid)': APP, // P5.8: paginated (O9)
  'tenancy.revoke_invitation(uuid, uuid, text, text, text)': APP,
  'tenancy.set_merchant_status(uuid, uuid, text, text, text, text, text)': APP,
  'tenancy.transfer_ownership(uuid, uuid, uuid, uuid, boolean, text, text, text)': APP,
  'tenancy.update_membership(uuid, uuid, text, uuid, uuid, text, text, text)': APP,
  // P5.5 step 4, the enforcement boundary: the branch / role / profile writers and the B1 read functions
  'tenancy.create_branch(uuid, text, text, text, text)': APP,
  'tenancy.create_role(uuid, text, text, text, text)': APP,
  'tenancy.list_branches(uuid, uuid)': APP,
  'tenancy.list_invitations(uuid, uuid, text, integer, timestamp with time zone, uuid)': APP, // P5.8: paginated (O9)
  'tenancy.list_permission_catalog(uuid)': APP,
  'tenancy.list_roles(uuid, uuid)': APP,
  'tenancy.read_own_membership(uuid)': APP,
  'tenancy.read_profile(uuid)': APP,
  'tenancy.update_branch(uuid, uuid, text, text, text, text, text)': APP,
  'tenancy.update_profile(uuid, text, text, text, text)': APP,
  'tenancy.update_role(uuid, uuid, text, text, text, text, text)': APP,
  // P5.6: the role grant writer (owner only, decided in the function)
  'tenancy.set_role_permissions(uuid, uuid, text[], text, text, text)': APP,
  // P5.7: platform staff (super admin only, decided in each function) and the team list (B1 reader)
  'identity.create_platform_staff(uuid, text, text, text, integer, text, text, text)': APP,
  'identity.set_platform_staff_status(uuid, uuid, text, text, text, text)': APP,
  'identity.set_platform_grants(uuid, uuid, text[], text, text, text)': APP,
  'identity.list_platform_staff(uuid, uuid, integer, timestamp with time zone, uuid)': APP,
  // P5.7: the platform team's sensitive reads (platform.merchants.read, decided and recorded in each function)
  'tenancy.platform_list_merchants(uuid, integer, timestamp with time zone, uuid, text, text, text)': APP,
  'audit.read_merchant_events(uuid, timestamp with time zone, timestamp with time zone, integer, timestamp with time zone, uuid, uuid, text, text, text)':
    APP,
  'audit.read_platform_events(uuid, timestamp with time zone, timestamp with time zone, integer, timestamp with time zone, uuid, uuid, uuid, text, text, text, text)':
    APP,
  'tenancy.platform_list_merchant_members(uuid, uuid, integer, timestamp with time zone, uuid, text, text, text)':
    APP,
  'tenancy.admit_invitation_locked(uuid, uuid, text, text, text, text)': OWNER_ONLY, // P5.5 step 2: waits for nothing (L6)
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
  // P6: a ledger opened with its system accounts — called by signup and the migration, never by the app
  'ledger.open_ledger(text, uuid)': OWNER_ONLY,
  // P6: the posting core (TA-3, TA-4, TA-5, §4) — called by the commands below and later phases' domain functions,
  // never by the app; the projections' check is the operator's (§3.4)
  'ledger.lock_projections(uuid[], uuid[])': OWNER_ONLY,
  'ledger.post_entry(uuid, text, text, date, text, text, text, jsonb, uuid, uuid, uuid, integer)': OWNER_ONLY,
  // P6 rev 3: a posting template's version never changes (its trigger)
  'ledger.protect_posting_template()': OWNER_ONLY,
  'ledger.post_reversal(uuid, uuid, text, date, text, uuid, uuid)': OWNER_ONLY,
  'ledger.open_subaccount(uuid, text, text, uuid)': OWNER_ONLY,
  'ledger.post_template(uuid, text, bigint, jsonb, text, date, text, text, text, uuid, uuid)': OWNER_ONLY,
  // P8 review (R2): the posting core without its acquisition, for domain commands that hold the projections
  'ledger.post_entry_locked(uuid, text, text, date, text, text, text, jsonb, uuid, uuid, uuid, integer)':
    OWNER_ONLY,
  'ledger.post_reversal_locked(uuid, uuid, text, date, text, uuid, uuid)': OWNER_ONLY,
  'ledger.post_template_locked(uuid, text, bigint, jsonb, text, date, text, text, text, uuid, uuid)':
    OWNER_ONLY,
  'ledger.verify_projections()': OWNER_ONLY,
  // P6: the session commands and the B1 reads
  'ledger.create_account(uuid, text, text, text, text, text, text)': APP,
  'ledger.post_manual_entry(uuid, text, text, date, text, jsonb, text, text, text)': APP,
  'ledger.reverse_entry(uuid, uuid, text, text, text, text, text, text)': APP,
  'ledger.list_accounts(uuid, boolean)': APP,
  'ledger.read_account(uuid, uuid)': APP,
  'ledger.read_statement(uuid, uuid, date, date, integer, date, uuid)': APP,
  'ledger.statement_balances(uuid, uuid, date, date)': APP,
  'ledger.update_account(uuid, uuid, text, text, text, text, text)': APP,
  'ledger.read_entry(uuid, uuid)': APP,
  'ledger.account_movements(uuid, date, date)': APP,
  // util — id default and RLS helper run as the querying role; the rate limiter is a request path
  'util.current_merchant_id()': APP,
  // P6 (TA-6): a command's key is claimed and released in its own transaction
  'util.claim_idempotency(uuid, text, text, text)': APP,
  'util.release_idempotency(uuid, text, text, text)': APP,
  'util.rate_limit_hit(text, integer, integer)': APP,
  'util.uuid_v7()': APP,
  'util.reject_modification()': OWNER_ONLY,
  'util.set_authorization_containment(boolean, boolean, text)': OWNER_ONLY, // P5.5 step 6: operator only (§11.1)
};

/** Functions whose body writes a grant table or the catalog (none in P5.1), in name order. */
const GRANT_TABLE_WRITERS: string[] = [
  // P5.7: a staff member's grants are set, and removed at deactivation
  'identity.set_platform_grants(uuid, uuid, text[], text, text, text)',
  'identity.set_platform_staff_status(uuid, uuid, text, text, text, text)',
  // P5.6: a role's permission set
  'tenancy.set_role_permissions(uuid, uuid, text[], text, text, text)',
];

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

describe('the permission storage of P5.1 has only its planned writers', () => {
  it('no function but the listed ones writes the catalog or a grant table (the writers of P5.6 and P5.7)', async () => {
    const write =
      /\b(insert\s+into|update|delete\s+from|merge\s+into|truncate(\s+table)?)\s+(only\s+)?("?(identity|tenancy)"?\s*\.\s*)?"?(permission_catalog|role_permissions|platform_membership_grants)\b/i;
    const writers = (await moduleFunctions()).filter((f) => write.test(f.src)).map((f) => f.fn);
    expect(writers).toEqual(GRANT_TABLE_WRITERS);
  });
});

describe('every SECURITY DEFINER function pins its search_path (plan §10 P5.5, "grants and pinned search_path")', () => {
  /** Each definer function of a module schema with its search_path setting, normalised (quotes and spaces dropped). */
  async function definers() {
    const { rows } = await owner.query<{ fn: string; search_path: string | null }>(
      `SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fn,
              (SELECT replace(replace(substr(c, length('search_path=') + 1), '"', ''), ' ', '')
                 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%') AS search_path
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname = ANY ($1)
        ORDER BY 1`,
      [MODULE_SCHEMAS],
    );
    return rows;
  }

  it('finds the definer functions (sanity: it is looking at the real catalog)', async () => {
    expect((await definers()).length).toBeGreaterThan(50);
  });

  it('each one runs with search_path = pg_catalog, pg_temp — nothing a caller could shadow', async () => {
    const unpinned = (await definers()).filter((d) => d.search_path !== 'pg_catalog,pg_temp');
    expect(unpinned).toEqual([]);
  });
});
