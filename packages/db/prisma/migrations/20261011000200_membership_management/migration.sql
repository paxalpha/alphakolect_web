-- P4.5: the owner manages their business's memberships (TARGET_ARCHITECTURE ADR-15 T5, T7–T9, T13, T15).
--
-- The app role has SELECT only on tenancy.merchant_memberships and no access to identity data (D4), so both
-- operations are SECURITY DEFINER functions. Authority comes from the caller's session, decided here, not from
-- arguments: identity.validate_session must report a live, full-scope merchant session whose membership is the
-- active OWNER of an active merchant (T9) — and the merchant is that session's, never a parameter (T3). A
-- membership of another merchant is "not found", exactly like one that does not exist (T15).
--
--   tenancy.list_members(session, membership?)  the members, with their email (one, or all)
--   tenancy.update_membership(session, membership, action, role, branch)
--       assign      staff only: an active role of this merchant, and an active branch of it or NULL (= all)
--       deactivate  active → deactivated; the membership's sessions are revoked
--       reactivate  deactivated → active (a new sign-in is needed: the old sessions stay revoked)
--     never the owner's row (ownership changes only by platform transfer, T17); never sets kind.
--
-- Concurrency: the merchant row is locked FOR SHARE and the session re-validated under that lock, so a concurrent
-- ownership transfer (which locks the merchant FOR UPDATE) is either complete — and seen — or not begun. The target
-- membership is locked FOR UPDATE; an assigned role and branch FOR SHARE, so they cannot be archived meanwhile.

CREATE FUNCTION "tenancy"."list_members"(p_session_id uuid, p_membership_id uuid DEFAULT NULL)
RETURNS TABLE (
  membership_id uuid, kind text, status text, role_id uuid, branch_id uuid, email text,
  created_at timestamptz, deactivated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT mm.id, mm.kind, mm.status, mm.role_id, mm.branch_id, i.email, mm.created_at, mm.deactivated_at
    FROM identity.validate_session(p_session_id) v
    JOIN tenancy.merchant_memberships mm ON mm.merchant_id = v.merchant_id
    JOIN identity.identities i ON i.id = mm.identity_id
   WHERE v.audience = 'merchant' AND v.scope = 'full' AND v.kind = 'owner'
     AND (p_membership_id IS NULL OR mm.id = p_membership_id)
   ORDER BY mm.created_at, mm.id;
$fn$;

REVOKE ALL ON FUNCTION "tenancy"."list_members"(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "tenancy"."list_members"(uuid, uuid) TO alphakolect_app;

CREATE FUNCTION "tenancy"."update_membership"(
  p_session_id uuid, p_membership_id uuid, p_action text, p_role_id uuid, p_branch_id uuid
)
RETURNS TABLE (
  outcome text, membership_id uuid, kind text, status text, role_id uuid, branch_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_merchant uuid;
  v_target tenancy.merchant_memberships%ROWTYPE;
BEGIN
  IF p_action NOT IN ('assign', 'deactivate', 'reactivate') THEN
    RAISE EXCEPTION 'unknown membership action' USING ERRCODE = 'check_violation';
  END IF;

  -- Which business: the session's. Whether the caller may act is decided only after locking it (below).
  SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v
   WHERE v.audience = 'merchant';
  IF v_merchant IS NOT NULL THEN
    PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
    -- Authority, under the lock: an ownership transfer that committed meanwhile is visible now.
    SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v
     WHERE v.audience = 'merchant' AND v.scope = 'full' AND v.kind = 'owner' AND v.merchant_id = v_merchant;
  END IF;
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_target FROM tenancy.merchant_memberships mm
   WHERE mm.id = p_membership_id AND mm.merchant_id = v_merchant
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF v_target.kind = 'owner' THEN
    RETURN QUERY SELECT 'owner_protected', v_target.id, v_target.kind, v_target.status, v_target.role_id,
                        v_target.branch_id;
    RETURN;
  END IF;

  IF p_action = 'assign' THEN
    IF v_target.kind <> 'staff' THEN
      RETURN QUERY SELECT 'invalid_target', v_target.id, v_target.kind, v_target.status, v_target.role_id,
                          v_target.branch_id;
      RETURN;
    END IF;
    -- Missing, archived and another merchant's role or branch are one answer: nothing about them is revealed.
    PERFORM 1 FROM tenancy.roles r
      WHERE r.id = p_role_id AND r.merchant_id = v_merchant AND r.status = 'active' FOR SHARE;
    IF NOT FOUND OR (p_branch_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM tenancy.branches b
          WHERE b.id = p_branch_id AND b.merchant_id = v_merchant AND b.status = 'active' FOR SHARE)) THEN
      RETURN QUERY SELECT 'invalid_assignment', v_target.id, v_target.kind, v_target.status, v_target.role_id,
                          v_target.branch_id;
      RETURN;
    END IF;
    UPDATE tenancy.merchant_memberships mm SET role_id = p_role_id, branch_id = p_branch_id
     WHERE mm.id = v_target.id
    RETURNING * INTO v_target;

  ELSIF p_action = 'deactivate' THEN
    IF v_target.status <> 'active' THEN
      RETURN QUERY SELECT 'invalid_transition', v_target.id, v_target.kind, v_target.status, v_target.role_id,
                          v_target.branch_id;
      RETURN;
    END IF;
    UPDATE tenancy.merchant_memberships mm SET status = 'deactivated', deactivated_at = now()
     WHERE mm.id = v_target.id
    RETURNING * INTO v_target;
    UPDATE identity.sessions s SET revoked_at = now(), revoke_reason = 'membership_deactivated'
     WHERE s.merchant_membership_id = v_target.id AND s.revoked_at IS NULL;

  ELSE
    IF v_target.status <> 'deactivated' THEN
      RETURN QUERY SELECT 'invalid_transition', v_target.id, v_target.kind, v_target.status, v_target.role_id,
                          v_target.branch_id;
      RETURN;
    END IF;
    UPDATE tenancy.merchant_memberships mm SET status = 'active', deactivated_at = NULL
     WHERE mm.id = v_target.id
    RETURNING * INTO v_target;
  END IF;

  RETURN QUERY SELECT 'ok', v_target.id, v_target.kind, v_target.status, v_target.role_id, v_target.branch_id;
END
$fn$;

REVOKE ALL ON FUNCTION "tenancy"."update_membership"(uuid, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "tenancy"."update_membership"(uuid, uuid, text, uuid, uuid) TO alphakolect_app;
