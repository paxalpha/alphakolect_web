-- P4.5: ownership transfer (TARGET_ARCHITECTURE ADR-15 T17; OPEN-1: platform admin only).
--
-- tenancy.transfer_ownership(session, merchant, new owner membership, former owner's role, deactivate former?)
--
-- Authority as for tenancy.set_merchant_status (P4.1): a live, full-scope super-admin platform session, decided
-- here from the session. The new owner must already be an ACTIVE STAFF member of this merchant whose identity is
-- active and email-verified — T17 says "an active member"; agents are excluded because an agent has a fixed
-- capability set (BR-3) and signs in on another audience, so making one the web owner is not a transfer but a
-- different person's onboarding. The former owner becomes staff with a role the admin chooses (T8: staff always
-- hold a role) and no branch restriction, and is optionally deactivated (sessions revoked). The order is fixed —
-- demote, then promote — because the unique index never allows two owners; the deferred trigger of
-- 20261011000100 refuses a commit that leaves none. Both changes or neither.
--
-- Locks: the merchant FOR UPDATE first (tenancy.update_membership waits on it FOR SHARE, so an owner's command is
-- decided either before or after the transfer, never across it), then the two memberships in id order, then the new
-- owner's identity and the role FOR SHARE.

CREATE FUNCTION "tenancy"."transfer_ownership"(
  p_session_id uuid, p_merchant_id uuid, p_new_owner_membership_id uuid, p_former_owner_role_id uuid,
  p_deactivate_former boolean
)
RETURNS TABLE (
  outcome text, former_owner_membership_id uuid, former_owner_identity_id uuid, new_owner_identity_id uuid,
  actor_identity_id uuid, actor_membership_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_actor_identity uuid;
  v_actor_membership uuid;
  v_former tenancy.merchant_memberships%ROWTYPE;
  v_new tenancy.merchant_memberships%ROWTYPE;
BEGIN
  IF p_deactivate_former IS NULL THEN
    RAISE EXCEPTION 'p_deactivate_former is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor_membership
    FROM identity.validate_session(p_session_id) v
    JOIN identity.platform_memberships pm ON pm.id = v.membership_id AND pm.role = 'super_admin'
   WHERE v.audience = 'platform' AND v.scope = 'full';
  IF v_actor_identity IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  PERFORM 1 FROM tenancy.merchants m WHERE m.id = p_merchant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid, NULL::uuid, v_actor_identity, v_actor_membership;
    RETURN;
  END IF;

  PERFORM 1 FROM tenancy.merchant_memberships mm
   WHERE mm.merchant_id = p_merchant_id AND (mm.kind = 'owner' OR mm.id = p_new_owner_membership_id)
   ORDER BY mm.id
     FOR UPDATE;
  SELECT * INTO v_former FROM tenancy.merchant_memberships mm
   WHERE mm.merchant_id = p_merchant_id AND mm.kind = 'owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merchant % has no owner', p_merchant_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_new FROM tenancy.merchant_memberships mm
   WHERE mm.id = p_new_owner_membership_id AND mm.merchant_id = p_merchant_id
     AND mm.kind = 'staff' AND mm.status = 'active';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_new_owner', v_former.id, v_former.identity_id, NULL::uuid, v_actor_identity,
                        v_actor_membership;
    RETURN;
  END IF;
  PERFORM 1 FROM identity.identities i
   WHERE i.id = v_new.identity_id AND i.status = 'active' AND i.email_verified_at IS NOT NULL
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_new_owner', v_former.id, v_former.identity_id, NULL::uuid, v_actor_identity,
                        v_actor_membership;
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.roles r
   WHERE r.id = p_former_owner_role_id AND r.merchant_id = p_merchant_id AND r.status = 'active'
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_role', v_former.id, v_former.identity_id, v_new.identity_id, v_actor_identity,
                        v_actor_membership;
    RETURN;
  END IF;

  -- Demote first: never two owners, not even inside this transaction.
  UPDATE tenancy.merchant_memberships mm
     SET kind = 'staff', role_id = p_former_owner_role_id, branch_id = NULL,
         status = CASE WHEN p_deactivate_former THEN 'deactivated' ELSE mm.status END,
         deactivated_at = CASE WHEN p_deactivate_former THEN coalesce(mm.deactivated_at, now()) ELSE mm.deactivated_at END
   WHERE mm.id = v_former.id;
  IF p_deactivate_former THEN
    UPDATE identity.sessions s SET revoked_at = now(), revoke_reason = 'ownership_transferred'
     WHERE s.merchant_membership_id = v_former.id AND s.revoked_at IS NULL;
  END IF;

  UPDATE tenancy.merchant_memberships mm SET kind = 'owner', role_id = NULL, branch_id = NULL
   WHERE mm.id = v_new.id;

  RETURN QUERY SELECT 'ok', v_former.id, v_former.identity_id, v_new.identity_id, v_actor_identity,
                      v_actor_membership;
END
$fn$;

REVOKE ALL ON FUNCTION "tenancy"."transfer_ownership"(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "tenancy"."transfer_ownership"(uuid, uuid, uuid, uuid, boolean) TO alphakolect_app;
