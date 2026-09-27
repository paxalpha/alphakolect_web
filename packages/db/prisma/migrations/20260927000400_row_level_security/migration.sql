-- P1 row-level security scaffolding (TARGET_ARCHITECTURE ADR-6, §4).
--
-- RLS is the LAST line of defence against bugs in tenant scoping: application authorization decides
-- what an actor may do, scoped repositories address only their tenant's rows, and these policies make
-- a missed filter return nothing instead of another merchant's data. It is never the permission system.
--
-- Tenant context: the API sets it per transaction, from the session's membership (never from input):
--     SELECT set_config('app.merchant_id', '<merchant uuid>', true);   -- i.e. SET LOCAL
-- No context => no rows (fail closed). A malformed value raises an error rather than matching anything.
--
-- Roles: policies apply to alphakolect_app (tenant-scoped) and alphakolect_readonly (cross-tenant
-- reads for reporting/support). The migrator owns the tables and is exempt (no FORCE ROW LEVEL
-- SECURITY) so migrations and operations work; it is never used by the application.

CREATE FUNCTION "util"."current_merchant_id"() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp
AS $fn$
  -- current_setting(..., true) is NULL if never set and '' after a SET LOCAL transaction ends.
  SELECT nullif(current_setting('app.merchant_id', true), '')::uuid;
$fn$;

REVOKE ALL ON FUNCTION "util"."current_merchant_id"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "util"."current_merchant_id"() TO alphakolect_app;

-- ── tenancy.merchants: the tenant row itself ──────────────────────────────────────────────────
ALTER TABLE "tenancy"."merchants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "merchants_app_own_tenant" ON "tenancy"."merchants" TO alphakolect_app
  USING ("id" = "util"."current_merchant_id"())
  WITH CHECK ("id" = "util"."current_merchant_id"());
CREATE POLICY "merchants_readonly_all" ON "tenancy"."merchants" FOR SELECT TO alphakolect_readonly
  USING (true);

-- ── ledger: every table is tenant-owned (merchant_id NOT NULL) ─────────────────────────────────
ALTER TABLE "ledger"."ledgers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ledgers_app_own_tenant" ON "ledger"."ledgers" TO alphakolect_app
  USING ("merchant_id" = "util"."current_merchant_id"())
  WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
CREATE POLICY "ledgers_readonly_all" ON "ledger"."ledgers" FOR SELECT TO alphakolect_readonly
  USING (true);

ALTER TABLE "ledger"."accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "accounts_app_own_tenant" ON "ledger"."accounts" TO alphakolect_app
  USING ("merchant_id" = "util"."current_merchant_id"())
  WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
CREATE POLICY "accounts_readonly_all" ON "ledger"."accounts" FOR SELECT TO alphakolect_readonly
  USING (true);

ALTER TABLE "ledger"."journal_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "journal_entries_app_own_tenant" ON "ledger"."journal_entries" TO alphakolect_app
  USING ("merchant_id" = "util"."current_merchant_id"())
  WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
CREATE POLICY "journal_entries_readonly_all" ON "ledger"."journal_entries" FOR SELECT TO alphakolect_readonly
  USING (true);

ALTER TABLE "ledger"."journal_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "journal_lines_app_own_tenant" ON "ledger"."journal_lines" TO alphakolect_app
  USING ("merchant_id" = "util"."current_merchant_id"())
  WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
CREATE POLICY "journal_lines_readonly_all" ON "ledger"."journal_lines" FOR SELECT TO alphakolect_readonly
  USING (true);

ALTER TABLE "ledger"."balance_projection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "balance_projection_app_own_tenant" ON "ledger"."balance_projection" TO alphakolect_app
  USING ("merchant_id" = "util"."current_merchant_id"())
  WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
CREATE POLICY "balance_projection_readonly_all" ON "ledger"."balance_projection" FOR SELECT TO alphakolect_readonly
  USING (true);

-- ── audit.audit_events: tenant events plus tenant-less events (e.g. a failed platform login) ───
ALTER TABLE "audit"."audit_events" ENABLE ROW LEVEL SECURITY;
-- The app reads only its tenant's events (platform audit views are a later, permission-gated service).
CREATE POLICY "audit_events_app_read_own_tenant" ON "audit"."audit_events" FOR SELECT TO alphakolect_app
  USING ("merchant_id" = "util"."current_merchant_id"());
-- The app may record events for its tenant, or events that belong to no tenant.
CREATE POLICY "audit_events_app_insert" ON "audit"."audit_events" FOR INSERT TO alphakolect_app
  WITH CHECK ("merchant_id" IS NULL OR "merchant_id" = "util"."current_merchant_id"());
CREATE POLICY "audit_events_readonly_all" ON "audit"."audit_events" FOR SELECT TO alphakolect_readonly
  USING (true);
