-- P4.3: branches and roles (TARGET_ARCHITECTURE ADR-15 T7, T8, T13; RESTRUCTURING_MAP P4 exit criterion 2).
--
-- Tenant-owned, merchant-defined data: merchant_id NOT NULL, UNIQUE (merchant_id, id), composite foreign keys, RLS on
-- app.merchant_id, default-deny grants, no hard deletes (archive instead). Roles are names only — permissions attach
-- in P5. A staff membership may name one role and be restricted to one branch (NULL = all branches, the default,
-- OPEN-2); nothing enforces branch restrictions until their work package. Forward-only; earlier migrations untouched.

-- ── branches ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "tenancy"."branches" (
    "id" UUID NOT NULL DEFAULT util.uuid_v7(),
    "merchant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "branches_merchant_id_id_key" ON "tenancy"."branches"("merchant_id", "id");
-- One active branch per name per merchant (case-insensitive); an archived name may be reused.
CREATE UNIQUE INDEX "branches_active_name_per_merchant"
  ON "tenancy"."branches" ("merchant_id", lower("name")) WHERE "status" = 'active';
ALTER TABLE "tenancy"."branches"
  ADD CONSTRAINT "branches_merchant_id_fkey" FOREIGN KEY ("merchant_id")
    REFERENCES "tenancy"."merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "branches_name_valid" CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 120),
  ADD CONSTRAINT "branches_status_valid" CHECK ("status" IN ('active', 'archived')),
  ADD CONSTRAINT "branches_archive_consistent" CHECK (("status" = 'archived') = ("archived_at" IS NOT NULL));

-- ── roles (names only; permissions are P5) ─────────────────────────────────────────────────────
CREATE TABLE "tenancy"."roles" (
    "id" UUID NOT NULL DEFAULT util.uuid_v7(),
    "merchant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "roles_merchant_id_id_key" ON "tenancy"."roles"("merchant_id", "id");
CREATE UNIQUE INDEX "roles_active_name_per_merchant"
  ON "tenancy"."roles" ("merchant_id", lower("name")) WHERE "status" = 'active';
ALTER TABLE "tenancy"."roles"
  ADD CONSTRAINT "roles_merchant_id_fkey" FOREIGN KEY ("merchant_id")
    REFERENCES "tenancy"."merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "roles_name_valid" CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 120),
  ADD CONSTRAINT "roles_status_valid" CHECK ("status" IN ('active', 'archived')),
  ADD CONSTRAINT "roles_archive_consistent" CHECK (("status" = 'archived') = ("archived_at" IS NOT NULL));

-- ── a staff membership's role and branch (same-tenant only, by composite FK) ───────────────────
ALTER TABLE "tenancy"."merchant_memberships"
  ADD COLUMN "role_id" UUID,
  ADD COLUMN "branch_id" UUID;
ALTER TABLE "tenancy"."merchant_memberships"
  ADD CONSTRAINT "merchant_memberships_merchant_id_role_id_fkey" FOREIGN KEY ("merchant_id", "role_id")
    REFERENCES "tenancy"."roles"("merchant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "merchant_memberships_merchant_id_branch_id_fkey" FOREIGN KEY ("merchant_id", "branch_id")
    REFERENCES "tenancy"."branches"("merchant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Owners and agents have fixed capability sets (BR-3): no role, no branch restriction.
  ADD CONSTRAINT "merchant_memberships_role_only_for_staff" CHECK ("role_id" IS NULL OR "kind" = 'staff'),
  ADD CONSTRAINT "merchant_memberships_branch_only_for_staff" CHECK ("branch_id" IS NULL OR "kind" = 'staff');
-- No new grants: role/branch assignment arrives as a SECURITY DEFINER function with P4.5.

-- ── journal lines join the uniform (merchant_id, id) key (P4 exit criterion 2) ─────────────────
CREATE UNIQUE INDEX "journal_lines_merchant_id_id_key" ON "ledger"."journal_lines"("merchant_id", "id");

-- ── row-level security (as P1: the app sees and writes only its tenant; readonly reads all) ────
ALTER TABLE "tenancy"."branches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "branches_app_own_tenant" ON "tenancy"."branches" TO alphakolect_app
  USING ("merchant_id" = "util"."current_merchant_id"())
  WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
CREATE POLICY "branches_readonly_all" ON "tenancy"."branches" FOR SELECT TO alphakolect_readonly
  USING (true);

ALTER TABLE "tenancy"."roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles_app_own_tenant" ON "tenancy"."roles" TO alphakolect_app
  USING ("merchant_id" = "util"."current_merchant_id"())
  WITH CHECK ("merchant_id" = "util"."current_merchant_id"());
CREATE POLICY "roles_readonly_all" ON "tenancy"."roles" FOR SELECT TO alphakolect_readonly
  USING (true);

-- ── grants: no DELETE (archive instead); names and archiving only ──────────────────────────────
GRANT SELECT, INSERT ON "tenancy"."branches", "tenancy"."roles" TO alphakolect_app;
GRANT UPDATE ("name", "status", "archived_at", "updated_at") ON "tenancy"."branches", "tenancy"."roles" TO alphakolect_app;
GRANT SELECT ON "tenancy"."branches", "tenancy"."roles" TO alphakolect_readonly;
