-- P5.5 step 1: the lock helpers (TARGET_ARCHITECTURE ADR-16 §3.5; P5 plan §7.2 L5, "Categories (global order)").
--
-- Every multi-row acquisition of a category is one call of its helper (L5): the helper takes the rows to lock in
-- FOR SHARE and the rows to lock in FOR NO KEY UPDATE, sorts and de-duplicates their union itself (a row given in both
-- arrays is taken in the stronger mode, FOR NO KEY UPDATE), and issues ONE locking statement per row in ascending id
-- order — so the acquisition order never depends on a caller remembering to sort, nor on a query plan. NULL or empty
-- arrays lock nothing. Each returns how many of the rows exist (and are now held); callers re-read what they check.
-- FOR UPDATE is never used (L1).
--
-- The plan names four working names (platform memberships, memberships, roles, branches); the planned footprints also
-- acquire several merchants and invitations (account setup) and several one-time tokens (re-issuing an invitation),
-- so those categories get a helper too: seven in all. They are not executable by the app — only definer functions
-- call them (no app grant, §9.1). Forward-only; earlier migrations untouched.

-- category 1: identity.platform_memberships
CREATE FUNCTION "identity"."lock_platform_memberships"(p_share uuid[], p_no_key_update uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_row    record;
  v_locked integer := 0;
BEGIN
  FOR v_row IN
    SELECT x.id, bool_or(x.nku) AS nku
      FROM (SELECT unnest(p_share) AS id, false AS nku
            UNION ALL
            SELECT unnest(p_no_key_update), true) x
     WHERE x.id IS NOT NULL
     GROUP BY x.id
     ORDER BY x.id
  LOOP
    IF v_row.nku THEN
      PERFORM 1 FROM "identity"."platform_memberships" t WHERE t."id" = v_row.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM "identity"."platform_memberships" t WHERE t."id" = v_row.id FOR SHARE;
    END IF;
    IF FOUND THEN
      v_locked := v_locked + 1;
    END IF;
  END LOOP;
  RETURN v_locked;
END
$fn$;
REVOKE ALL ON FUNCTION "identity"."lock_platform_memberships"(uuid[], uuid[]) FROM PUBLIC;

-- category 2: tenancy.merchants
CREATE FUNCTION "tenancy"."lock_merchants"(p_share uuid[], p_no_key_update uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_row    record;
  v_locked integer := 0;
BEGIN
  FOR v_row IN
    SELECT x.id, bool_or(x.nku) AS nku
      FROM (SELECT unnest(p_share) AS id, false AS nku
            UNION ALL
            SELECT unnest(p_no_key_update), true) x
     WHERE x.id IS NOT NULL
     GROUP BY x.id
     ORDER BY x.id
  LOOP
    IF v_row.nku THEN
      PERFORM 1 FROM "tenancy"."merchants" t WHERE t."id" = v_row.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM "tenancy"."merchants" t WHERE t."id" = v_row.id FOR SHARE;
    END IF;
    IF FOUND THEN
      v_locked := v_locked + 1;
    END IF;
  END LOOP;
  RETURN v_locked;
END
$fn$;
REVOKE ALL ON FUNCTION "tenancy"."lock_merchants"(uuid[], uuid[]) FROM PUBLIC;

-- category 3: tenancy.merchant_memberships
CREATE FUNCTION "tenancy"."lock_memberships"(p_share uuid[], p_no_key_update uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_row    record;
  v_locked integer := 0;
BEGIN
  FOR v_row IN
    SELECT x.id, bool_or(x.nku) AS nku
      FROM (SELECT unnest(p_share) AS id, false AS nku
            UNION ALL
            SELECT unnest(p_no_key_update), true) x
     WHERE x.id IS NOT NULL
     GROUP BY x.id
     ORDER BY x.id
  LOOP
    IF v_row.nku THEN
      PERFORM 1 FROM "tenancy"."merchant_memberships" t WHERE t."id" = v_row.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM "tenancy"."merchant_memberships" t WHERE t."id" = v_row.id FOR SHARE;
    END IF;
    IF FOUND THEN
      v_locked := v_locked + 1;
    END IF;
  END LOOP;
  RETURN v_locked;
END
$fn$;
REVOKE ALL ON FUNCTION "tenancy"."lock_memberships"(uuid[], uuid[]) FROM PUBLIC;

-- category 4: tenancy.invitations
CREATE FUNCTION "tenancy"."lock_invitations"(p_share uuid[], p_no_key_update uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_row    record;
  v_locked integer := 0;
BEGIN
  FOR v_row IN
    SELECT x.id, bool_or(x.nku) AS nku
      FROM (SELECT unnest(p_share) AS id, false AS nku
            UNION ALL
            SELECT unnest(p_no_key_update), true) x
     WHERE x.id IS NOT NULL
     GROUP BY x.id
     ORDER BY x.id
  LOOP
    IF v_row.nku THEN
      PERFORM 1 FROM "tenancy"."invitations" t WHERE t."id" = v_row.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM "tenancy"."invitations" t WHERE t."id" = v_row.id FOR SHARE;
    END IF;
    IF FOUND THEN
      v_locked := v_locked + 1;
    END IF;
  END LOOP;
  RETURN v_locked;
END
$fn$;
REVOKE ALL ON FUNCTION "tenancy"."lock_invitations"(uuid[], uuid[]) FROM PUBLIC;

-- category 5: identity.one_time_tokens
CREATE FUNCTION "identity"."lock_one_time_tokens"(p_share uuid[], p_no_key_update uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_row    record;
  v_locked integer := 0;
BEGIN
  FOR v_row IN
    SELECT x.id, bool_or(x.nku) AS nku
      FROM (SELECT unnest(p_share) AS id, false AS nku
            UNION ALL
            SELECT unnest(p_no_key_update), true) x
     WHERE x.id IS NOT NULL
     GROUP BY x.id
     ORDER BY x.id
  LOOP
    IF v_row.nku THEN
      PERFORM 1 FROM "identity"."one_time_tokens" t WHERE t."id" = v_row.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM "identity"."one_time_tokens" t WHERE t."id" = v_row.id FOR SHARE;
    END IF;
    IF FOUND THEN
      v_locked := v_locked + 1;
    END IF;
  END LOOP;
  RETURN v_locked;
END
$fn$;
REVOKE ALL ON FUNCTION "identity"."lock_one_time_tokens"(uuid[], uuid[]) FROM PUBLIC;

-- category 7: tenancy.roles
CREATE FUNCTION "tenancy"."lock_roles"(p_share uuid[], p_no_key_update uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_row    record;
  v_locked integer := 0;
BEGIN
  FOR v_row IN
    SELECT x.id, bool_or(x.nku) AS nku
      FROM (SELECT unnest(p_share) AS id, false AS nku
            UNION ALL
            SELECT unnest(p_no_key_update), true) x
     WHERE x.id IS NOT NULL
     GROUP BY x.id
     ORDER BY x.id
  LOOP
    IF v_row.nku THEN
      PERFORM 1 FROM "tenancy"."roles" t WHERE t."id" = v_row.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM "tenancy"."roles" t WHERE t."id" = v_row.id FOR SHARE;
    END IF;
    IF FOUND THEN
      v_locked := v_locked + 1;
    END IF;
  END LOOP;
  RETURN v_locked;
END
$fn$;
REVOKE ALL ON FUNCTION "tenancy"."lock_roles"(uuid[], uuid[]) FROM PUBLIC;

-- category 8: tenancy.branches
CREATE FUNCTION "tenancy"."lock_branches"(p_share uuid[], p_no_key_update uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_row    record;
  v_locked integer := 0;
BEGIN
  FOR v_row IN
    SELECT x.id, bool_or(x.nku) AS nku
      FROM (SELECT unnest(p_share) AS id, false AS nku
            UNION ALL
            SELECT unnest(p_no_key_update), true) x
     WHERE x.id IS NOT NULL
     GROUP BY x.id
     ORDER BY x.id
  LOOP
    IF v_row.nku THEN
      PERFORM 1 FROM "tenancy"."branches" t WHERE t."id" = v_row.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM "tenancy"."branches" t WHERE t."id" = v_row.id FOR SHARE;
    END IF;
    IF FOUND THEN
      v_locked := v_locked + 1;
    END IF;
  END LOOP;
  RETURN v_locked;
END
$fn$;
REVOKE ALL ON FUNCTION "tenancy"."lock_branches"(uuid[], uuid[]) FROM PUBLIC;
