-- Verifies the background worker's role in the database it is run against (P9 plan §16.4 conditions 9 and 10). Read-only: it changes
-- nothing, and stops with an error naming what is wrong. Run it after the role bootstrap and the migrations, in each environment, as a
-- superuser or the migrator:
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f packages/db/sql/checks/worker-role.sql
--
-- It prints no password or connection detail. What it checks, for alphakolect_worker:
--   1. the role exists, can log in, and is not a superuser, cannot create roles or databases, does not bypass row security, no replication;
--   2. it belongs to no role and no role belongs to it;
--   3. it has no privilege on any table, view or sequence outside the system schemas (it acts only through its functions);
--   4. it cannot create objects in any schema, nor in the database;
--   5. it CAN connect to this database (a database made before the worker's role existed lacks the grant, and the worker then fails to
--      start with a permission error: apply packages/db/sql/bootstrap/database.sql to it, which is safe to repeat).
DO $$
DECLARE
  bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alphakolect_worker') THEN
    RAISE EXCEPTION 'alphakolect_worker does not exist: run the role bootstrap first';
  END IF;

  SELECT string_agg(a, ', ') INTO bad FROM (
    SELECT unnest(ARRAY[
      CASE WHEN NOT r.rolcanlogin THEN 'cannot log in' END,
      CASE WHEN r.rolsuper THEN 'is a superuser' END,
      CASE WHEN r.rolcreaterole THEN 'can create roles' END,
      CASE WHEN r.rolcreatedb THEN 'can create databases' END,
      CASE WHEN r.rolbypassrls THEN 'bypasses row security' END,
      CASE WHEN r.rolreplication THEN 'can replicate' END
    ]) AS a FROM pg_roles r WHERE r.rolname = 'alphakolect_worker') x WHERE a IS NOT NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'alphakolect_worker has the wrong attributes: %', bad;
  END IF;

  SELECT string_agg(format('%s is a member of %s', member.rolname, granted.rolname), '; ') INTO bad
    FROM pg_auth_members am
    JOIN pg_roles granted ON granted.oid = am.roleid
    JOIN pg_roles member ON member.oid = am.member
   WHERE granted.rolname = 'alphakolect_worker' OR member.rolname = 'alphakolect_worker';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'alphakolect_worker has role memberships: %', bad;
  END IF;

  SELECT string_agg(c.oid::regclass::text, ', ') INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
     AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
     AND (has_table_privilege('alphakolect_worker', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
          OR (c.relkind = 'S' AND has_sequence_privilege('alphakolect_worker', c.oid, 'USAGE, SELECT, UPDATE')));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'alphakolect_worker has privileges on: %', bad;
  END IF;

  SELECT string_agg(n.nspname, ', ') INTO bad
    FROM pg_namespace n
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
     AND n.nspname NOT LIKE 'pg\_temp\_%' AND n.nspname NOT LIKE 'pg\_toast\_temp\_%'
     AND has_schema_privilege('alphakolect_worker', n.oid, 'CREATE');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'alphakolect_worker can create objects in schemas: %', bad;
  END IF;

  IF has_database_privilege('alphakolect_worker', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'alphakolect_worker can create schemas in this database';
  END IF;

  IF NOT has_database_privilege('alphakolect_worker', current_database(), 'CONNECT') THEN
    RAISE EXCEPTION 'alphakolect_worker cannot connect to this database: apply packages/db/sql/bootstrap/database.sql to it';
  END IF;

  RAISE NOTICE 'alphakolect_worker: attributes, memberships and privileges are as required';
END
$$;
