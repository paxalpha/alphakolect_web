-- P5.5 step 3: authority from the resolver, and the success rows written by the functions themselves (TARGET_ARCHITECTURE
-- ADR-16 §3.5; P5 plan §7.2 planned footprints and the authority rule, §7.3 D5′, §8.1 pattern A, §8.2a, §8.5).
--
-- The five privileged operations no longer decide authority by a literal (the session's kind = 'owner', or a join on
-- platform_memberships.role = 'super_admin'). Each takes its whole footprint first — the actor's row in its
-- authority-bearing category, at that category's turn, in the same sorted acquisition as its targets (merchant
-- operations: category 3; platform operations: category 1, the first acquired) — then asks the resolver, through
-- tenancy.assert_authority, whether the actor holds the operation's permission now:
--   update_membership     merchant.members.manage                  reserved: the owner alone (D5′)
--   issue_invitation      merchant.invitations.manage              reserved: the owner alone (D5′)
--   revoke_invitation     merchant.invitations.manage              reserved: the owner alone (D5′)
--   set_merchant_status   platform.merchants.lifecycle             reserved: the super admin
--   transfer_ownership    platform.merchants.transfer_ownership    reserved: the super admin
-- and only then checks every rule, in P4's order, and writes. A refusal is returned ('forbidden' before any other
-- outcome, as in P4) and writes nothing (§8.2a rules 1, 2).
--
-- Pattern A (§8.1, §8.5): on success each function inserts its atomic audit row in the same transaction, with the
-- actor's identity, audience and membership taken from the session it validated — there is no actor parameter — and
-- the request context (ip, user agent, request id) recorded as given and never used for a decision. If that insert
-- fails, the change rolls back with it. These eight pairs leave the transitional list (P5.3a): the API no longer writes
-- them. The request context parameters default to NULL for direct callers (tests, operators).
--
-- tenancy.list_members (a lock-free reader) checks merchant.members.read in the resolver's permission set instead of
-- the owner's kind.
--
-- Signatures change for the five operations (DROP and CREATE, the app's EXECUTE granted again). Forward-only; earlier
-- migrations untouched.

-- ── tenancy.list_members ──
CREATE OR REPLACE FUNCTION tenancy.list_members(p_session_id uuid, p_membership_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(membership_id uuid, kind text, status text, role_id uuid, branch_id uuid, email text, created_at timestamp with time zone, deactivated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT mm.id, mm.kind, mm.status, mm.role_id, mm.branch_id, i.email, mm.created_at, mm.deactivated_at
    FROM identity.session_authority(p_session_id) a
    JOIN tenancy.merchant_memberships mm ON mm.merchant_id = a.merchant_id
    JOIN identity.identities i ON i.id = mm.identity_id
   WHERE a.audience = 'merchant' AND 'merchant.members.read' = ANY (a.permissions)
     AND (p_membership_id IS NULL OR mm.id = p_membership_id)
   ORDER BY mm.created_at, mm.id;
$function$;

-- ── tenancy.update_membership ──
DROP FUNCTION tenancy.update_membership(uuid, uuid, text, uuid, uuid);
CREATE FUNCTION tenancy.update_membership(p_session_id uuid, p_membership_id uuid, p_action text, p_role_id uuid, p_branch_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, membership_id uuid, kind text, status text, role_id uuid, branch_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_target_id uuid;
  v_target tenancy.merchant_memberships%ROWTYPE;
BEGIN
  IF p_action NOT IN ('assign', 'deactivate', 'reactivate') THEN
    RAISE EXCEPTION 'unknown membership action' USING ERRCODE = 'check_violation';
  END IF;

  -- Unlocked lookups (§7.2): the session's business and membership (the actor), and the target if it is a member of
  -- that business. Then the footprint: the merchant (S), the actor and the target in one sorted acquisition (NKU), the
  -- role and branch to assign (S); then the authority, from the resolver, under those locks.
  SELECT v.merchant_id, v.membership_id, v.identity_id INTO v_merchant, v_actor, v_actor_identity
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  SELECT mm.id INTO v_target_id FROM tenancy.merchant_memberships mm
   WHERE mm.id = p_membership_id AND mm.merchant_id = v_merchant;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor, v_target_id]);
  IF p_action = 'assign' THEN
    PERFORM 1 FROM tenancy.roles r WHERE r.id = p_role_id AND r.merchant_id = v_merchant FOR SHARE;
    IF p_branch_id IS NOT NULL THEN
      PERFORM 1 FROM tenancy.branches b WHERE b.id = p_branch_id AND b.merchant_id = v_merchant FOR SHARE;
    END IF;
  END IF;
  IF tenancy.assert_authority(p_session_id, 'merchant.members.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_target FROM tenancy.merchant_memberships mm
   WHERE mm.id = v_target_id AND mm.merchant_id = v_merchant;
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
    IF NOT EXISTS (SELECT 1 FROM tenancy.roles r
                    WHERE r.id = p_role_id AND r.merchant_id = v_merchant AND r.status = 'active')
       OR (p_branch_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM tenancy.branches b
              WHERE b.id = p_branch_id AND b.merchant_id = v_merchant AND b.status = 'active')) THEN
      RETURN QUERY SELECT 'invalid_assignment', v_target.id, v_target.kind, v_target.status, v_target.role_id,
                          v_target.branch_id;
      RETURN;
    END IF;
    UPDATE tenancy.merchant_memberships mm SET role_id = p_role_id, branch_id = p_branch_id
     WHERE mm.id = v_target.id
    RETURNING * INTO v_target;
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       ip, user_agent, request_id, summary)
    VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'merchant.member_assigned', 'membership',
            v_target.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
            jsonb_build_object('kind', v_target.kind, 'status', v_target.status, 'roleId', v_target.role_id,
                               'branchId', v_target.branch_id));

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
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       ip, user_agent, request_id, summary)
    VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'merchant.member_deactivated', 'membership',
            v_target.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
            jsonb_build_object('kind', v_target.kind, 'status', v_target.status, 'roleId', v_target.role_id,
                               'branchId', v_target.branch_id));

  ELSE
    IF v_target.status <> 'deactivated' THEN
      RETURN QUERY SELECT 'invalid_transition', v_target.id, v_target.kind, v_target.status, v_target.role_id,
                          v_target.branch_id;
      RETURN;
    END IF;
    UPDATE tenancy.merchant_memberships mm SET status = 'active', deactivated_at = NULL
     WHERE mm.id = v_target.id
    RETURNING * INTO v_target;
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       ip, user_agent, request_id, summary)
    VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'merchant.member_reactivated', 'membership',
            v_target.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
            jsonb_build_object('kind', v_target.kind, 'status', v_target.status, 'roleId', v_target.role_id,
                               'branchId', v_target.branch_id));
  END IF;

  RETURN QUERY SELECT 'ok', v_target.id, v_target.kind, v_target.status, v_target.role_id, v_target.branch_id;
END
$function$;
REVOKE ALL ON FUNCTION tenancy.update_membership(uuid, uuid, text, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.update_membership(uuid, uuid, text, uuid, uuid, text, text, text) TO alphakolect_app;

-- ── tenancy.issue_invitation ──
DROP FUNCTION tenancy.issue_invitation(uuid, text, text, uuid, uuid, text, text, integer);
CREATE FUNCTION tenancy.issue_invitation(p_session_id uuid, p_email text, p_kind text, p_role_id uuid, p_branch_id uuid, p_token_hash text, p_setup_token_hash text, p_ttl_seconds integer, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, invitation_id uuid, expires_at timestamp with time zone, delivery text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_inviter uuid;
  v_actor_identity uuid;
  v_email text := lower(btrim(p_email));
  v_identity_id uuid;
  v_identity identity.identities%ROWTYPE;
  v_delivery text;
  v_expires timestamptz;
  v_id uuid;
BEGIN
  IF p_kind NOT IN ('staff', 'agent') THEN
    RAISE EXCEPTION 'invitations are for staff or agents' USING ERRCODE = 'check_violation';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'invitation lifetime out of range' USING ERRCODE = 'check_violation';
  END IF;

  -- Unlocked lookups (§7.2): the session's business and membership (the inviter), and the invitee's identity. Then the
  -- footprint: the merchant (S), the inviter (NKU), the open invitation to this email here, the identity's live setup
  -- tokens, the identity, the role and the branch; then the authority, from the resolver, under those locks.
  SELECT v.merchant_id, v.membership_id, v.identity_id INTO v_merchant, v_inviter, v_actor_identity
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  SELECT i.id INTO v_identity_id FROM identity.identities i WHERE i.email = v_email;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_inviter]);
  PERFORM tenancy.lock_invitations(NULL, ARRAY(
    SELECT i.id FROM tenancy.invitations i
     WHERE i.merchant_id = v_merchant AND i.email = v_email AND i.accepted_at IS NULL AND i.revoked_at IS NULL));
  PERFORM identity.lock_one_time_tokens(NULL, ARRAY(
    SELECT t.id FROM identity.one_time_tokens t
     WHERE t.identity_id = v_identity_id AND t.purpose = 'account_setup'
       AND t.consumed_at IS NULL AND t.expires_at > now()));
  IF v_identity_id IS NOT NULL THEN
    SELECT * INTO v_identity FROM identity.identities i WHERE i.id = v_identity_id FOR SHARE;
  END IF;
  IF p_role_id IS NOT NULL THEN
    PERFORM 1 FROM tenancy.roles r WHERE r.id = p_role_id AND r.merchant_id = v_merchant FOR SHARE;
  END IF;
  IF p_branch_id IS NOT NULL THEN
    PERFORM 1 FROM tenancy.branches b WHERE b.id = p_branch_id AND b.merchant_id = v_merchant FOR SHARE;
  END IF;
  IF tenancy.assert_authority(p_session_id, 'merchant.invitations.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  IF (p_kind = 'agent' AND (p_role_id IS NOT NULL OR p_branch_id IS NOT NULL))
     OR (p_kind = 'staff' AND NOT EXISTS (
           SELECT 1 FROM tenancy.roles r
            WHERE r.id = p_role_id AND r.merchant_id = v_merchant AND r.status = 'active'))
     OR (p_kind = 'staff' AND p_branch_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM tenancy.branches b
            WHERE b.id = p_branch_id AND b.merchant_id = v_merchant AND b.status = 'active')) THEN
    RETURN QUERY SELECT 'invalid_assignment', NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  IF v_identity.id IS NOT NULL AND EXISTS (SELECT 1 FROM tenancy.merchant_memberships mm
                                            WHERE mm.merchant_id = v_merchant AND mm.identity_id = v_identity.id) THEN
    RETURN QUERY SELECT 'already_member', NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  -- Contested inserts last (L3): a new identity, then the invitation. Nothing is waited for after them.
  IF v_identity.id IS NULL THEN
    INSERT INTO identity.identities (email) VALUES (v_email) ON CONFLICT (email) DO NOTHING
    RETURNING * INTO v_identity;
    IF v_identity.id IS NULL THEN
      -- Created by another transaction since the lookup: read it (a lock may not follow a contested insert).
      SELECT * INTO v_identity FROM identity.identities i WHERE i.email = v_email;
      IF EXISTS (SELECT 1 FROM tenancy.merchant_memberships mm
                  WHERE mm.merchant_id = v_merchant AND mm.identity_id = v_identity.id) THEN
        RETURN QUERY SELECT 'already_member', NULL::uuid, NULL::timestamptz, NULL::text;
        RETURN;
      END IF;
    END IF;
  END IF;

  v_delivery := CASE
    WHEN v_identity.status <> 'active' THEN 'none'
    WHEN v_identity.password_hash IS NULL THEN 'setup'
    ELSE 'accept'
  END;
  IF v_delivery = 'setup' THEN
    PERFORM identity.issue_one_time_token(v_identity.id, 'account_setup', p_setup_token_hash, p_ttl_seconds, NULL);
  END IF;

  UPDATE tenancy.invitations i SET revoked_at = now()
   WHERE i.merchant_id = v_merchant AND i.email = v_email AND i.accepted_at IS NULL AND i.revoked_at IS NULL;

  v_expires := now() + make_interval(secs => p_ttl_seconds);
  INSERT INTO tenancy.invitations
    (merchant_id, email, kind, role_id, branch_id, identity_id, invited_by_membership_id, token_hash, expires_at)
  VALUES (v_merchant, v_email, p_kind, p_role_id, p_branch_id, v_identity.id, v_inviter, p_token_hash, v_expires)
  RETURNING id INTO v_id;

  -- Internal record only: which delivery says whether the email had an account (never told to the inviter, D12).
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_inviter, 'merchant.invitation_issued', 'invitation', v_id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('kind', p_kind, 'roleId', p_role_id, 'branchId', p_branch_id, 'delivery', v_delivery));

  RETURN QUERY SELECT 'ok', v_id, v_expires, v_delivery;
END
$function$;
REVOKE ALL ON FUNCTION tenancy.issue_invitation(uuid, text, text, uuid, uuid, text, text, integer, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.issue_invitation(uuid, text, text, uuid, uuid, text, text, integer, text, text, text) TO alphakolect_app;

-- ── tenancy.revoke_invitation ──
DROP FUNCTION tenancy.revoke_invitation(uuid, uuid);
CREATE FUNCTION tenancy.revoke_invitation(p_session_id uuid, p_invitation_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, invitation_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_invitation_id uuid;
  v_inv tenancy.invitations%ROWTYPE;
BEGIN
  -- Unlocked lookups (§7.2): the session's business and membership (the actor), and the invitation if it is this
  -- business's. Then the footprint — the merchant (S), the actor (NKU), the invitation (NKU) — and the authority.
  SELECT v.merchant_id, v.membership_id, v.identity_id INTO v_merchant, v_actor, v_actor_identity
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid;
    RETURN;
  END IF;
  SELECT i.id INTO v_invitation_id FROM tenancy.invitations i
   WHERE i.id = p_invitation_id AND i.merchant_id = v_merchant;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_invitations(NULL, ARRAY[v_invitation_id]);
  IF tenancy.assert_authority(p_session_id, 'merchant.invitations.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_inv FROM tenancy.invitations i WHERE i.id = v_invitation_id AND i.merchant_id = v_merchant;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid;
    RETURN;
  END IF;
  IF v_inv.accepted_at IS NOT NULL OR v_inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'invalid_transition', v_inv.id;
    RETURN;
  END IF;
  UPDATE tenancy.invitations i SET revoked_at = now() WHERE i.id = v_inv.id;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'merchant.invitation_revoked', 'invitation',
          v_inv.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('kind', v_inv.kind));
  RETURN QUERY SELECT 'ok', v_inv.id;
END
$function$;
REVOKE ALL ON FUNCTION tenancy.revoke_invitation(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.revoke_invitation(uuid, uuid, text, text, text) TO alphakolect_app;

-- ── tenancy.set_merchant_status ──
DROP FUNCTION tenancy.set_merchant_status(uuid, uuid, text, text);
CREATE FUNCTION tenancy.set_merchant_status(p_session_id uuid, p_merchant_id uuid, p_action text, p_reason text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, status text, actor_identity_id uuid, actor_membership_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor_identity uuid;
  v_actor_membership uuid;
  v_owner_verified boolean;
  v_owner uuid;
  v_status text;
  v_found boolean;
  v_new text;
  v_reason text := btrim(p_reason);
BEGIN
  IF p_action NOT IN ('deactivate', 'reactivate') THEN
    RAISE EXCEPTION 'unknown lifecycle action' USING ERRCODE = 'check_violation';
  END IF;

  -- Unlocked lookup (§7.2): the session's platform membership (the actor). Then the footprint — the actor (S, category
  -- 1, first), the merchant (NKU), the owner's identity (S) — and the authority, from the resolver, under those locks.
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor_membership
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor_identity IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor_membership], NULL);
  SELECT m.status INTO v_status FROM tenancy.merchants m WHERE m.id = p_merchant_id FOR NO KEY UPDATE;
  v_found := FOUND;
  -- The owner's verification decides where a reactivation lands (BR-2.2). With the merchant held, its owner cannot
  -- change (an ownership transfer locks the merchant first): the owner's identity is locked after it, by id.
  SELECT mm.identity_id INTO v_owner FROM tenancy.merchant_memberships mm
   WHERE mm.merchant_id = p_merchant_id AND mm.kind = 'owner';
  SELECT i.email_verified_at IS NOT NULL INTO v_owner_verified FROM identity.identities i
   WHERE i.id = v_owner FOR SHARE;
  IF tenancy.assert_authority(p_session_id, 'platform.merchants.lifecycle') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF NOT v_found THEN
    RETURN QUERY SELECT 'not_found', NULL::text, v_actor_identity, v_actor_membership;
    RETURN;
  END IF;

  IF p_action = 'deactivate' THEN
    IF v_status NOT IN ('active', 'pending_verification') THEN
      RETURN QUERY SELECT 'invalid_transition', v_status, v_actor_identity, v_actor_membership;
      RETURN;
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
      RETURN QUERY SELECT 'invalid_reason', v_status, v_actor_identity, v_actor_membership;
      RETURN;
    END IF;
    v_new := 'deactivated';
    UPDATE tenancy.merchants
       SET status = v_new, deactivated_at = now(), deactivation_reason = v_reason, updated_at = now()
     WHERE id = p_merchant_id;
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       ip, user_agent, request_id, summary)
    VALUES (p_merchant_id, v_actor_identity, 'platform', v_actor_membership, 'platform.merchant_deactivated',
            'merchant', p_merchant_id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
            jsonb_build_object('status', v_new, 'reason', v_reason));
  ELSE
    IF v_status <> 'deactivated' THEN
      RETURN QUERY SELECT 'invalid_transition', v_status, v_actor_identity, v_actor_membership;
      RETURN;
    END IF;
    -- Never verifies anything: an unverified owner's business goes back to pending_verification (BR-2.2).
    v_new := CASE WHEN coalesce(v_owner_verified, false) THEN 'active' ELSE 'pending_verification' END;
    UPDATE tenancy.merchants
       SET status = v_new, deactivated_at = NULL, deactivation_reason = NULL, updated_at = now()
     WHERE id = p_merchant_id;
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       ip, user_agent, request_id, summary)
    VALUES (p_merchant_id, v_actor_identity, 'platform', v_actor_membership, 'platform.merchant_reactivated',
            'merchant', p_merchant_id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
            jsonb_build_object('status', v_new));
  END IF;

  RETURN QUERY SELECT 'ok', v_new, v_actor_identity, v_actor_membership;
END
$function$;
REVOKE ALL ON FUNCTION tenancy.set_merchant_status(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.set_merchant_status(uuid, uuid, text, text, text, text, text) TO alphakolect_app;

-- ── tenancy.transfer_ownership ──
DROP FUNCTION tenancy.transfer_ownership(uuid, uuid, uuid, uuid, boolean);
CREATE FUNCTION tenancy.transfer_ownership(p_session_id uuid, p_merchant_id uuid, p_new_owner_membership_id uuid, p_former_owner_role_id uuid, p_deactivate_former boolean, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, former_owner_membership_id uuid, former_owner_identity_id uuid, new_owner_identity_id uuid, actor_identity_id uuid, actor_membership_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor_identity uuid;
  v_actor_membership uuid;
  v_found boolean;
  v_new_identity uuid;
  v_former tenancy.merchant_memberships%ROWTYPE;
  v_new tenancy.merchant_memberships%ROWTYPE;
BEGIN
  IF p_deactivate_former IS NULL THEN
    RAISE EXCEPTION 'p_deactivate_former is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Unlocked lookups (§7.2): the session's platform membership (the actor), and the new owner's identity. Then the
  -- footprint — the actor (S, category 1, first), the merchant (NKU), the owner and the new owner in one sorted
  -- acquisition (NKU), the new owner's identity (S), the former owner's new role (S) — and the authority.
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor_membership
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor_identity IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  SELECT mm.identity_id INTO v_new_identity FROM tenancy.merchant_memberships mm
   WHERE mm.id = p_new_owner_membership_id AND mm.merchant_id = p_merchant_id;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor_membership], NULL);
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = p_merchant_id FOR NO KEY UPDATE;
  v_found := FOUND;
  PERFORM tenancy.lock_memberships(NULL, ARRAY(
    SELECT mm.id FROM tenancy.merchant_memberships mm
     WHERE mm.merchant_id = p_merchant_id AND (mm.kind = 'owner' OR mm.id = p_new_owner_membership_id)));
  PERFORM 1 FROM identity.identities i WHERE i.id = v_new_identity FOR SHARE;
  PERFORM 1 FROM tenancy.roles r WHERE r.id = p_former_owner_role_id AND r.merchant_id = p_merchant_id FOR SHARE;
  IF tenancy.assert_authority(p_session_id, 'platform.merchants.transfer_ownership') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF NOT v_found THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid, NULL::uuid, v_actor_identity, v_actor_membership;
    RETURN;
  END IF;

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
  IF NOT EXISTS (SELECT 1 FROM identity.identities i
                  WHERE i.id = v_new.identity_id AND i.status = 'active' AND i.email_verified_at IS NOT NULL) THEN
    RETURN QUERY SELECT 'invalid_new_owner', v_former.id, v_former.identity_id, NULL::uuid, v_actor_identity,
                        v_actor_membership;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenancy.roles r
                  WHERE r.id = p_former_owner_role_id AND r.merchant_id = p_merchant_id AND r.status = 'active') THEN
    RETURN QUERY SELECT 'invalid_role', v_former.id, v_former.identity_id, v_new.identity_id, v_actor_identity,
                        v_actor_membership;
    RETURN;
  END IF;

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

  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (p_merchant_id, v_actor_identity, 'platform', v_actor_membership, 'platform.ownership_transferred',
          'merchant', p_merchant_id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('formerOwnerIdentityId', v_former.identity_id,
                             'formerOwnerMembershipId', v_former.id,
                             'newOwnerIdentityId', v_new.identity_id,
                             'newOwnerMembershipId', v_new.id,
                             'formerOwnerRoleId', p_former_owner_role_id,
                             'formerOwnerDeactivated', p_deactivate_former));

  RETURN QUERY SELECT 'ok', v_former.id, v_former.identity_id, v_new.identity_id, v_actor_identity,
                      v_actor_membership;
END
$function$;
REVOKE ALL ON FUNCTION tenancy.transfer_ownership(uuid, uuid, uuid, uuid, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.transfer_ownership(uuid, uuid, uuid, uuid, boolean, text, text, text) TO alphakolect_app;
