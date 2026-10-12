-- P5.1: storage for a platform staff member's own permissions (TARGET_ARCHITECTURE ADR-16 §3.5; P5 plan §4
-- invariants 4–5, §7.4, P5.1; owner decision D4 and A3: permissions are given person by person, never by a label).
--
-- One row per (platform membership, permission). Only active, grantable platform permissions can be stored
-- (identity.check_grantable_permission) — the super admin's reserved permissions and every merchant permission are
-- refused by the database, whoever writes. A row whose permission is later retired stays as history and grants nothing.
--
-- Storage only: no privilege for alphakolect_app or alphakolect_readonly (identity tables are reached only through
-- database functions, ADR-14), and no function writes this table yet — the super admin sets grants through
-- identity.set_platform_grants in P5.7. Forward-only; earlier migrations untouched.

CREATE TABLE "identity"."platform_membership_grants" (
    "platform_membership_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_membership_grants_pkey" PRIMARY KEY ("platform_membership_id", "permission")
);
ALTER TABLE "identity"."platform_membership_grants"
  ADD CONSTRAINT "platform_membership_grants_platform_membership_id_fkey" FOREIGN KEY ("platform_membership_id")
    REFERENCES "identity"."platform_memberships"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "platform_membership_grants_permission_fkey" FOREIGN KEY ("permission")
    REFERENCES "identity"."permission_catalog"("identifier") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER "platform_membership_grants_grantable"
  BEFORE INSERT OR UPDATE ON "identity"."platform_membership_grants"
  FOR EACH ROW EXECUTE FUNCTION "identity"."check_grantable_permission"('platform');

-- No grants.
