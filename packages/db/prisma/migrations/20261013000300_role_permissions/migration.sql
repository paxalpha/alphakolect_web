-- P5.1: storage for a merchant role's permissions (TARGET_ARCHITECTURE ADR-16 §3.5; P5 plan §4 invariants 4–5, P5.1).
--
-- One row per (role, permission). Same tenant only, by the composite key to tenancy.roles; only active, grantable
-- merchant permissions can be stored (identity.check_grantable_permission) — the owner's reserved permissions and every
-- platform permission are refused by the database, whoever writes. A row whose permission is later retired stays as
-- history and grants nothing (the resolver ignores retired permissions, P5.2).
--
-- Storage only: no privilege for alphakolect_app or alphakolect_readonly, and no function writes this table yet — the
-- owner sets a role's permissions through tenancy.set_role_permissions in P5.6. Row-level security as on every tenant
-- table, so the table is tenant-scoped the moment any read is granted. Forward-only; earlier migrations untouched.

CREATE TABLE "tenancy"."role_permissions" (
    "merchant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("merchant_id", "role_id", "permission")
);
ALTER TABLE "tenancy"."role_permissions"
  ADD CONSTRAINT "role_permissions_merchant_id_role_id_fkey" FOREIGN KEY ("merchant_id", "role_id")
    REFERENCES "tenancy"."roles"("merchant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "role_permissions_permission_fkey" FOREIGN KEY ("permission")
    REFERENCES "identity"."permission_catalog"("identifier") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER "role_permissions_grantable"
  BEFORE INSERT OR UPDATE ON "tenancy"."role_permissions"
  FOR EACH ROW EXECUTE FUNCTION "identity"."check_grantable_permission"('merchant');

-- ── row-level security (the app sees only its tenant; it holds no privilege on the table today) ──
ALTER TABLE "tenancy"."role_permissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_permissions_app_own_tenant" ON "tenancy"."role_permissions" FOR SELECT TO alphakolect_app
  USING ("merchant_id" = "util"."current_merchant_id"());

-- No grants.
