-- Cluster-level database roles (TARGET_ARCHITECTURE §19, ADR-6).
--
-- Run ONCE per PostgreSQL cluster (and again to rotate passwords), as a superuser, BEFORE migrations.
-- Idempotent: creates the roles if missing, otherwise re-applies attributes and passwords.
--
-- Passwords are read from session settings so they never appear in this file:
--   alphakolect.migrator_password, alphakolect.app_password, alphakolect.worker_password,
--   alphakolect.readonly_password
-- (bootstrap.psql sets them from psql variables; the test harness sets them with set_config()).
--
--   alphakolect_migrator  owns every schema/table/function; applies migrations. Not a superuser.
--   alphakolect_app       the API's role: data access only, row-level security always applies
--                         (NOBYPASSRLS, never a table owner). Per-table grants come from migrations.
--   alphakolect_worker    the background worker's role (P9-R1): only the worker's functions, which act on what
--                         a provider confirmed. The API cannot call them; the worker cannot call the API's.
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
      ('alphakolect_worker',   current_setting('alphakolect.worker_password', true)),
      ('alphakolect_readonly', current_setting('alphakolect.readonly_password', true))
    ) AS t(role_name, role_password)
  LOOP
    IF coalesce(length(r.role_password), 0) < 16 THEN
      RAISE EXCEPTION 'A password of at least 16 characters is required for role %', r.role_name;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role_name) THEN
      EXECUTE format('CREATE ROLE %I', r.role_name);
    END IF;

    -- Same attributes for all four: can log in, nothing else.
    EXECUTE format(
      'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
      r.role_name, r.role_password
    );
  END LOOP;
END
$$;

-- The worker's role belongs to no role, and no role belongs to it (P9 §16.4 condition 9). The block above re-applies attributes and
-- passwords but removes no membership that already exists, and a membership (pg_read_all_data, a login role granted to it, anything)
-- would give it more than its functions. Each is revoked, by the grantor that made it, so a re-run of this file restores the
-- state a fresh cluster has. The other roles are not touched here.
DO $$
DECLARE
  m record;
BEGIN
  FOR m IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role, grantor.rolname AS grantor_role
      FROM pg_auth_members am
      JOIN pg_roles granted ON granted.oid = am.roleid
      JOIN pg_roles member ON member.oid = am.member
      JOIN pg_roles grantor ON grantor.oid = am.grantor
     WHERE granted.rolname = 'alphakolect_worker' OR member.rolname = 'alphakolect_worker'
  LOOP
    EXECUTE format('REVOKE %I FROM %I GRANTED BY %I', m.granted_role, m.member_role, m.grantor_role);
    RAISE NOTICE 'Revoked a membership of alphakolect_worker (role %, member %)', m.granted_role, m.member_role;
  END LOOP;
END
$$;
