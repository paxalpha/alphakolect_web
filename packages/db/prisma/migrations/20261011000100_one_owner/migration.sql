-- P4.5: a business keeps exactly one owner (TARGET_ARCHITECTURE ADR-15 T17).
--
-- The unique index merchant_memberships_one_owner_per_merchant (P3) already allows at most one owner per merchant,
-- whatever its status. This deferred constraint trigger adds "at least one": a transaction that demotes or removes
-- an owner must have promoted another by COMMIT — the ownership transfer demotes first (the index forbids two owners
-- even briefly) and promotes second, and either both commit or neither does.
--
-- Scope: it fires when an owner row changes. Every merchant gets its owner in the transaction that creates it
-- (identity.signup_merchant_owner; the app cannot insert merchants since P4.1), so guarding the owner row is what
-- keeps that true afterwards. Forward-only; nothing earlier is modified.

CREATE FUNCTION "tenancy"."merchant_keeps_one_owner"()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenancy.merchant_memberships WHERE merchant_id = OLD.merchant_id AND kind = 'owner'
  ) THEN
    RAISE EXCEPTION 'merchant % would have no owner (ADR-15 T17: transfer ownership instead)', OLD.merchant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION "tenancy"."merchant_keeps_one_owner"() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER "merchant_memberships_one_owner_at_commit"
  AFTER UPDATE OR DELETE ON "tenancy"."merchant_memberships"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD."kind" = 'owner')
  EXECUTE FUNCTION "tenancy"."merchant_keeps_one_owner"();
