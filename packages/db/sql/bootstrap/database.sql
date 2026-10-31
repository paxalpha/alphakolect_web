-- Per-database setup (TARGET_ARCHITECTURE §19). Run as a superuser while connected to the target
-- database, after roles.sql and before migrations. Idempotent.
--
-- Default-deny: PUBLIC gets nothing; each role gets only what it needs at database level.
-- Schema/table/function privileges are granted by migrations, per object.

DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  -- The migrator creates the module schemas.
  EXECUTE format('GRANT CONNECT, CREATE, TEMPORARY ON DATABASE %I TO alphakolect_migrator', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO alphakolect_app, alphakolect_worker, alphakolect_readonly', current_database());
END
$$;

-- public holds only Prisma's _prisma_migrations bookkeeping table, owned by the migrator.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO alphakolect_migrator;

-- Functions are executable by PUBLIC by default; make that opt-in for functions the migrator creates.
ALTER DEFAULT PRIVILEGES FOR ROLE alphakolect_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
