-- P1 privileges for alphakolect_app and alphakolect_readonly (TARGET_ARCHITECTURE §19, ADR-5, ADR-6).
--
-- Default-deny: there are deliberately NO "ALTER DEFAULT PRIVILEGES ... ON TABLES". Every table a later
-- migration adds is invisible to app/readonly until that migration grants it explicitly.
-- The migrator owns everything; app and readonly own nothing and can create nothing.

-- ── schema usage (resolving names only; table access is granted per table below) ──────────────
GRANT USAGE ON SCHEMA "util", "tenancy", "ledger", "audit" TO alphakolect_app, alphakolect_readonly;

-- Id defaults call util.uuid_v7() as the inserting role. PUBLIC has no EXECUTE on migrator-owned
-- functions (packages/db/sql/bootstrap/database.sql), so grant it to the app explicitly.
GRANT EXECUTE ON FUNCTION "util"."uuid_v7"() TO alphakolect_app;

-- ── tenancy ───────────────────────────────────────────────────────────────────────────────────
-- Merchants are never deleted (lifecycle is a status); only name/status/updated_at change.
GRANT SELECT, INSERT ON "tenancy"."merchants" TO alphakolect_app;
GRANT UPDATE ("name", "status", "updated_at") ON "tenancy"."merchants" TO alphakolect_app;

-- ── ledger: money records are append-only (ADR-5: no UPDATE balance, no DELETE of money rows) ─
GRANT SELECT, INSERT ON "ledger"."ledgers" TO alphakolect_app;

-- Accounts may be renamed; code, type, ownership and structure never change.
GRANT SELECT, INSERT ON "ledger"."accounts" TO alphakolect_app;
GRANT UPDATE ("name") ON "ledger"."accounts" TO alphakolect_app;

-- Journal entries and lines: INSERT-only. Corrections are reversing entries (BR-11.1).
GRANT SELECT, INSERT ON "ledger"."journal_entries" TO alphakolect_app;
GRANT SELECT, INSERT ON "ledger"."journal_lines" TO alphakolect_app;

-- The balance projection is the one ledger table updated in place, by the posting service, in the
-- same transaction as the lines it summarises (§7). Only its figures may change; rows are not deleted.
GRANT SELECT, INSERT ON "ledger"."balance_projection" TO alphakolect_app;
GRANT UPDATE ("balance_minor", "version", "updated_at") ON "ledger"."balance_projection" TO alphakolect_app;

-- ── audit: append-only (§16) ──────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON "audit"."audit_events" TO alphakolect_app;

-- ── readonly: reporting/support reads, nothing else ───────────────────────────────────────────
GRANT SELECT ON ALL TABLES IN SCHEMA "tenancy", "ledger", "audit" TO alphakolect_readonly;
