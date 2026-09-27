-- Cluster-level database roles (TARGET_ARCHITECTURE §19, ADR-6).
--
-- Run ONCE per PostgreSQL cluster (and again to rotate passwords), as a superuser, BEFORE migrations.
-- Idempotent: creates the roles if missing, otherwise re-applies attributes and passwords.
--
-- Passwords are read from session settings so they never appear in this file:
--   alphakolect.migrator_password, alphakolect.app_password, alphakolect.readonly_password
-- (bootstrap.psql sets them from psql variables; the test harness sets them with set_config()).
--
--   alphakolect_migrator  owns every schema/table/function; applies migrations. Not a superuser.
--   alphakolect_app       the API/worker role: data access only, row-level security always applies
--                         (NOBYPASSRLS, never a table owner). Per-table grants come from migrations.
--   alphakolect_readonly  reporting/support: SELECT only (grants and policies come from migrations).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT *
    FROM (VALUES
      ('alphakolect_migrator', current_setting('alphakolect.migrator_password', true)),
      ('alphakolect_app',      current_setting('alphakolect.app_password', true)),
      ('alphakolect_readonly', current_setting('alphakolect.readonly_password', true))
    ) AS t(role_name, role_password)
  LOOP
    IF coalesce(length(r.role_password), 0) < 16 THEN
      RAISE EXCEPTION 'A password of at least 16 characters is required for role %', r.role_name;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role_name) THEN
      EXECUTE format('CREATE ROLE %I', r.role_name);
    END IF;

    -- Same attributes for all three: can log in, nothing else.
    EXECUTE format(
      'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
      r.role_name, r.role_password
    );
  END LOOP;
END
$$;
