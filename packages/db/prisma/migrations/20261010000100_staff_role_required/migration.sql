-- P4.3 follow-up: a staff membership references a role (TARGET_ARCHITECTURE ADR-15 T8), enforced by the database.
--
-- 20261009000300 allowed role_id for staff only and tied it to the same merchant (composite FK), but left it optional.
-- ADR-15 T8 says a staff membership references one merchant-defined role; owners and agents have fixed capability
-- sets. Together the constraints now say: staff ⇔ a role of the same merchant; owners and agents: never a role.
--
-- No backfill: the new system holds no legitimate data before this migration (TARGET_ARCHITECTURE §25; the local
-- development database had no migrations applied when this was written). Rather than inventing a role for anyone,
-- the migration refuses to run, with an explanation, if a role-less staff membership exists.

DO $guard$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM tenancy.merchant_memberships WHERE kind = 'staff' AND role_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION
      '% staff membership(s) without a role. ADR-15 T8 requires one: assign each a role of its merchant, then re-run.',
      v_count
      USING ERRCODE = 'check_violation';
  END IF;
END
$guard$;

ALTER TABLE "tenancy"."merchant_memberships"
  ADD CONSTRAINT "merchant_memberships_staff_has_role" CHECK ("kind" <> 'staff' OR "role_id" IS NOT NULL);
