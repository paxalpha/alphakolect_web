-- P5.1: the permission catalog (TARGET_ARCHITECTURE ADR-16 §3.5 "Permission catalog"; P5 plan §4 invariants 1, 3, 4,
-- §6, P5.1).
--
-- The catalog is the only authority for permission identifiers, their scope and whether they can be granted. It lives
-- in identity because both grant tables reference it — tenancy.role_permissions (tenancy already depends on identity)
-- and identity.platform_membership_grants — so neither creates a dependency of identity on tenancy. Seeded with the 16
-- permissions frozen in P5.0 (plan §6); no grant rows anywhere.
--
-- Default-deny: no privilege for alphakolect_app or alphakolect_readonly. The app reads the catalog only through
-- database functions (the resolver, P5.2; tenancy.list_permission_catalog, P5.5 — owner decision B1).
--
-- Protection, for every role including the owner: identifier, scope and grantable never change, and rows are never
-- deleted or truncated — a permission is retired instead, and a retired permission is never re-activated, so grant rows
-- kept as history can never come back to life. Changing the catalog is a reviewed migration, never a request.
--
-- The name sorts after 20261013000100_audience_checked_refresh on purpose (plan P5.1, critic review TA-26).
-- Forward-only; earlier migrations untouched.

CREATE TABLE "identity"."permission_catalog" (
    "identifier" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "grantable" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_catalog_pkey" PRIMARY KEY ("identifier")
);
ALTER TABLE "identity"."permission_catalog"
  -- Lower-case, dot-separated segments (plan §6 catalog rules); the first segment names the scope.
  ADD CONSTRAINT "permission_catalog_identifier_valid"
    CHECK ("identifier" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$' AND char_length("identifier") <= 100),
  ADD CONSTRAINT "permission_catalog_scope_valid" CHECK ("scope" IN ('merchant', 'platform')),
  ADD CONSTRAINT "permission_catalog_scope_matches_identifier" CHECK (split_part("identifier", '.', 1) = "scope"),
  ADD CONSTRAINT "permission_catalog_status_valid" CHECK ("status" IN ('active', 'retired'));

-- ── protection: only status may change, and only from active to retired ─────────────────────────
CREATE FUNCTION "identity"."protect_permission_catalog"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'identity.permission_catalog: % is not allowed (retire the permission instead)', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."identifier" IS DISTINCT FROM OLD."identifier" OR NEW."scope" IS DISTINCT FROM OLD."scope"
     OR NEW."grantable" IS DISTINCT FROM OLD."grantable" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'permission %: identifier, scope and grantable never change', OLD."identifier"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'retired' AND NEW."status" <> 'retired' THEN
    RAISE EXCEPTION 'permission % is retired and cannot be re-activated', OLD."identifier"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION "identity"."protect_permission_catalog"() FROM PUBLIC;

CREATE TRIGGER "permission_catalog_protected"
  BEFORE UPDATE OR DELETE ON "identity"."permission_catalog"
  FOR EACH ROW EXECUTE FUNCTION "identity"."protect_permission_catalog"();
CREATE TRIGGER "permission_catalog_no_truncate"
  BEFORE TRUNCATE ON "identity"."permission_catalog"
  FOR EACH STATEMENT EXECUTE FUNCTION "identity"."protect_permission_catalog"();

-- ── the rule every grant table applies (used by the two grant tables of P5.1) ────────────────────
-- Before every insert or update of a grant row: the permission must be active, grantable and of the table's scope
-- (the trigger argument, 'merchant' or 'platform'), so a reserved permission (grantable = false) can never be stored
-- (plan §4 invariant 4). An unknown identifier is left to the foreign key, which reports it. The catalog is read
-- without a lock (ADR-16 lock model: triggers lock nothing; the catalog changes only through migrations). Runs as the
-- writer: a writer that cannot read the catalog is refused, never let through.
CREATE FUNCTION "identity"."check_grantable_permission"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_scope     text;
  v_grantable boolean;
  v_status    text;
BEGIN
  SELECT c."scope", c."grantable", c."status" INTO v_scope, v_grantable, v_status
    FROM identity.permission_catalog c
   WHERE c."identifier" = NEW."permission";
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF v_scope <> TG_ARGV[0] OR NOT v_grantable OR v_status <> 'active' THEN
    RAISE EXCEPTION '%.%: permission % cannot be granted here (scope %, grantable %, status %)',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, NEW."permission", v_scope, v_grantable, v_status
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_permission_grantable';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION "identity"."check_grantable_permission"() FROM PUBLIC;

-- ── seed: the catalog frozen in P5.0 (plan §6; ADR-16 §3.5) ──────────────────────────────────────
INSERT INTO "identity"."permission_catalog" ("identifier", "scope", "grantable") VALUES
  ('merchant.profile.read',                 'merchant', true),
  ('merchant.profile.update',               'merchant', true),
  ('merchant.branches.read',                'merchant', true),
  ('merchant.branches.manage',              'merchant', true),
  ('merchant.roles.read',                   'merchant', true),
  ('merchant.roles.manage',                 'merchant', false),
  ('merchant.members.read',                 'merchant', true),
  ('merchant.members.manage',               'merchant', false),
  ('merchant.invitations.read',             'merchant', true),
  ('merchant.invitations.manage',           'merchant', false),
  ('merchant.audit.read',                   'merchant', false),
  ('platform.merchants.read',               'platform', true),
  ('platform.audit.read',                   'platform', true),
  ('platform.merchants.lifecycle',          'platform', false),
  ('platform.merchants.transfer_ownership', 'platform', false),
  ('platform.staff.manage',                 'platform', false);

-- No grants: the table, its protection trigger and the grant rule are reachable by no application role.
