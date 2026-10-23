-- P5.2: the write-time re-check (TARGET_ARCHITECTURE ADR-16 §3.5; P5 plan §4 invariant 6, §7.2, §7.5, §8.2a rules 1–2,
-- 4; D12).
--
-- tenancy.assert_authority(session, permission) answers, inside the caller's transaction and under the caller's locks,
-- whether the session's actor holds the permission now:
--   'ok'               the session is live and its membership holds the permission
--   'unauthenticated'  the session is no longer valid (ended, expired, or its membership or merchant deactivated)
--   'forbidden'        the session is valid but does not hold the permission (a permission of the other scope included)
-- A refusal is returned, never raised (§8.2a rule 2): the caller returns its own refusal outcome, having written
-- nothing. An identifier that is not in the catalog raises (rule 4), so a misspelled permission can never be read as
-- "not held" and skipped.
--
-- Lock contract (§7.2 L5–L6). The caller acquires its whole footprint first — in the global category order, ascending
-- id within a category, the actor's row in its category's one sorted acquisition — and calls this function after
-- that, before its first write. This is a nested function, so it waits for nothing: it re-asserts the rows that carry
-- the actor's authority with FOR SHARE NOWAIT — immediate when the caller already holds them (in any mode), an
-- immediate error (55P03), never a wait, when another transaction holds a conflicting lock on a row the caller did not
-- lock — and then re-reads:
--   platform permission   category 1: the actor's platform membership
--   merchant permission   category 2: the merchant; category 3: the actor's membership; category 7: a staff actor's role
-- The membership is locked before its role is read, so the role cannot change in between. Holding those rows, a
-- concurrent revocation — membership deactivation, role change, archive or permission edit, merchant deactivation,
-- platform grant change — either committed before this re-check, and is seen (the write is refused), or waits until
-- the caller commits (§7.2, §7.5). The decision is identity.permissions_of, the same as the API's resolver.
--
-- Not executable by the app (L6): only definer functions call it (from P5.5). Forward-only; earlier migrations
-- untouched.

CREATE FUNCTION "tenancy"."assert_authority"(p_session_id uuid, p_permission text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_scope    text;
  v_audience text;
  v_merchant uuid;
  v_member   uuid;
  v_role     uuid;
  v_session  record;
BEGIN
  SELECT c."scope" INTO v_scope FROM identity.permission_catalog c WHERE c."identifier" = p_permission;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assert_authority: % is not a catalog permission', p_permission
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Unlocked lookup: which rows carry the actor's authority.
  SELECT v.audience, v.merchant_id, v.membership_id INTO v_audience, v_merchant, v_member
    FROM identity.validate_session(p_session_id) v;
  IF NOT FOUND THEN
    RETURN 'unauthenticated';
  END IF;
  -- A permission of the other scope is never held; no lock is needed to know it.
  IF (v_scope = 'platform') <> (v_audience = 'platform') THEN
    RETURN 'forbidden';
  END IF;

  -- Re-assert the caller's authority locks, in category order, never waiting.
  IF v_audience = 'platform' THEN
    PERFORM 1 FROM identity.platform_memberships pm WHERE pm."id" = v_member FOR SHARE NOWAIT;
  ELSE
    PERFORM 1 FROM tenancy.merchants m WHERE m."id" = v_merchant FOR SHARE NOWAIT;
    SELECT mm."role_id" INTO v_role FROM tenancy.merchant_memberships mm WHERE mm."id" = v_member FOR SHARE NOWAIT;
    IF v_role IS NOT NULL THEN
      PERFORM 1 FROM tenancy.roles r WHERE r."merchant_id" = v_merchant AND r."id" = v_role FOR SHARE NOWAIT;
    END IF;
  END IF;

  -- Re-read under the locks: at READ COMMITTED this statement sees every revocation committed before they were held.
  SELECT v.* INTO v_session FROM identity.validate_session(p_session_id) v;
  IF NOT FOUND THEN
    RETURN 'unauthenticated';
  END IF;
  IF p_permission = ANY (identity.permissions_of(v_session.audience, v_session.scope, v_session.kind,
                                                v_session.membership_id, v_session.merchant_id, v_session.role_id)) THEN
    RETURN 'ok';
  END IF;
  RETURN 'forbidden';
END
$fn$;

REVOKE ALL ON FUNCTION "tenancy"."assert_authority"(uuid, text) FROM PUBLIC;
