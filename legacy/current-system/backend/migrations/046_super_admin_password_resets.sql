-- 046: Super Admin password recovery (TARGET_ARCHITECTURE §3.2).
--
-- Adds single-use, hashed, expiring reset tokens for super admins and a password_changed_at
-- timestamp used to invalidate JWTs issued before a password change.
--
-- Idempotent: safe to run more than once. Apply THIS FILE ONLY, e.g.
--   docker exec -i alphakolect-recovery-db psql -U <user> -d alphacollect_db -v ON_ERROR_STOP=1 \
--     < backend/migrations/046_super_admin_password_resets.sql
-- Do NOT use run-all-migrations.js / migrate.js (they replay every migration).
--
-- Must be applied BEFORE deploying the code that reads super_admins.password_changed_at.

BEGIN;

ALTER TABLE super_admins
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS super_admin_password_resets (
  id             SERIAL PRIMARY KEY,
  super_admin_id INTEGER     NOT NULL REFERENCES super_admins(id) ON DELETE CASCADE,
  -- sha256(token) as lowercase hex; the raw token is never stored
  token_hash     CHAR(64)    NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ NULL,
  requested_ip   VARCHAR(64) NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS super_admin_password_resets_token_hash_key
  ON super_admin_password_resets (token_hash);

CREATE INDEX IF NOT EXISTS super_admin_password_resets_super_admin_id_idx
  ON super_admin_password_resets (super_admin_id);

COMMIT;

-- Rollback (manual, only if the feature is removed):
--   BEGIN;
--   DROP TABLE IF EXISTS super_admin_password_resets;
--   ALTER TABLE super_admins DROP COLUMN IF EXISTS password_changed_at;
--   COMMIT;
