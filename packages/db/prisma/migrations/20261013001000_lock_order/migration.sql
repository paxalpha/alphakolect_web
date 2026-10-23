-- P5.5 step 2: the existing functions converted to their lock footprints (TARGET_ARCHITECTURE ADR-16 §3.5; P5 plan
-- §7.2 L1, L3, L5, L6, the category order and the planned footprints; the baseline reconciliation, R34).
--
-- L1: every FOR UPDATE becomes FOR NO KEY UPDATE — consume_one_time_token, rotate_refresh_token, take_selection (the
-- only change to these three), update_membership, revoke_invitation, transfer_ownership. A FOR NO KEY UPDATE does not
-- conflict with a foreign-key check's FOR KEY SHARE, so foreign-key checks never wait (L2).
--
-- The category order (2 merchants → 3 memberships → 4 invitations → 5 tokens → 6 identities → 7 roles → 8 branches →
-- 10 sessions), every row of a category in one sorted acquisition (L5, the helpers of 20261013000900), and contested
-- inserts last (L3):
--   set_merchant_status      the merchant (FOR NO KEY UPDATE) before the owner's identity (FOR SHARE, by id)
--   transfer_ownership       the owner and the new owner in one helper call
--   issue_invitation         unlocked lookups, then the open invitation, the invitee's setup tokens, the identity, the
--                            role and the branch; the identity (if new) and the invitation inserted last
--   verify_email             the businesses the identity owns (FOR NO KEY UPDATE) before the token and the identity —
--                            a finding of the guard at step 1: it updated the merchant after the identity, a deadlock
--                            with the reordered set_merchant_status
--   complete_account_setup   unlocked lookups, then every invitation's merchant, the invitations, the token, the
--                            identity, their roles and branches; then each invitation admitted
--   accept_invitation        the merchant, the invitation, the identity, the role and the branch; then admitted
-- Admission is tenancy.admit_invitation_locked (L6): it re-asserts every row its caller holds with NOWAIT — immediate
-- when held, an error (55P03, never a wait) when a caller forgot — so it cannot take part in a deadlock. It replaces
-- tenancy.admit_invitation, which waited for its locks one invitation at a time (dropped). Neither is executable by
-- the app.
--
-- Authority is unchanged here (the P4 checks); step 3 takes the actor's lock and the resolver's permission set.
-- Every outcome, message and audit row is unchanged. Forward-only; earlier migrations untouched.

CREATE OR REPLACE FUNCTION identity.consume_one_time_token(p_purpose text, p_token_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_token_id uuid;
  v_identity uuid;
BEGIN
  SELECT t.id, t.identity_id INTO v_token_id, v_identity
    FROM identity.one_time_tokens t
    JOIN identity.identities i ON i.id = t.identity_id
   WHERE t.token_hash = p_token_hash AND t.purpose = p_purpose
     AND t.consumed_at IS NULL AND t.expires_at > now() AND i.status = 'active'
   FOR NO KEY UPDATE OF t;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE identity.one_time_tokens SET consumed_at = now() WHERE id = v_token_id;
  RETURN v_identity;
END
$function$;

CREATE OR REPLACE FUNCTION identity.rotate_refresh_token(p_old_hash text, p_new_hash text, p_idle_seconds integer, p_audiences text[])
 RETURNS TABLE(outcome text, session_id uuid, identity_id uuid, audience text, membership_id uuid, scope text, refresh_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_token identity.refresh_tokens%ROWTYPE;
  v_session identity.sessions%ROWTYPE;
  v_membership uuid;
  v_refresh timestamptz;
  v_idle_max integer;
  v_idle integer;
BEGIN
  IF p_audiences IS NULL OR cardinality(p_audiences) = 0
     OR NOT (p_audiences <@ ARRAY['platform', 'merchant', 'agent']) THEN
    RAISE EXCEPTION 'p_audiences must name the session audiences this endpoint serves'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_token FROM identity.refresh_tokens rt WHERE rt.token_hash = p_old_hash FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_session FROM identity.sessions s WHERE s.id = v_token.session_id FOR NO KEY UPDATE;

  -- Another endpoint's token: refused with no side effect at all.
  IF NOT (v_session.audience = ANY (p_audiences)) THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_token.rotated_at IS NOT NULL THEN
    UPDATE identity.sessions SET revoked_at = now(), revoke_reason = 'refresh_token_reuse'
     WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN QUERY SELECT 'reuse_detected', v_session.id, v_session.identity_id, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  v_membership := coalesce(v_session.platform_membership_id, v_session.merchant_membership_id);
  IF v_session.revoked_at IS NOT NULL OR v_session.absolute_expires_at <= now() OR v_token.expires_at <= now()
     OR NOT EXISTS (SELECT 1 FROM identity.identities i WHERE i.id = v_session.identity_id AND i.status = 'active')
     OR identity.active_membership(v_session.identity_id, v_session.audience, v_membership) IS NULL THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  v_idle_max := (identity.session_limits(v_session.audience, v_session.scope)).idle_max;
  v_idle := coalesce(p_idle_seconds, v_idle_max);
  IF v_idle < 1 OR v_idle > v_idle_max THEN
    RAISE EXCEPTION 'session lifetime out of range' USING ERRCODE = 'check_violation';
  END IF;

  v_refresh := least(now() + make_interval(secs => v_idle), v_session.absolute_expires_at);
  UPDATE identity.refresh_tokens SET rotated_at = now() WHERE id = v_token.id;
  INSERT INTO identity.refresh_tokens (session_id, token_hash, expires_at) VALUES (v_session.id, p_new_hash, v_refresh);

  RETURN QUERY SELECT 'rotated', v_session.id, v_session.identity_id, v_session.audience, v_membership, v_session.scope, v_refresh;
END
$function$;

CREATE OR REPLACE FUNCTION identity.take_selection(p_challenge_hash text, p_membership_id uuid)
 RETURNS TABLE(identity_id uuid, audience text, membership_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_challenge identity.membership_selection_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_challenge FROM identity.membership_selection_challenges c
   WHERE c.token_hash = p_challenge_hash
   FOR NO KEY UPDATE;
  IF NOT FOUND OR v_challenge.consumed_at IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE identity.membership_selection_challenges SET consumed_at = now() WHERE id = v_challenge.id;
  IF v_challenge.expires_at <= now() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT v_challenge.identity_id, v_challenge.audience, e.membership_id
      FROM identity.eligible_memberships(v_challenge.identity_id, v_challenge.audience) e
     WHERE e.membership_id = p_membership_id;
END
$function$;

CREATE OR REPLACE FUNCTION tenancy.update_membership(p_session_id uuid, p_membership_id uuid, p_action text, p_role_id uuid, p_branch_id uuid)
 RETURNS TABLE(outcome text, membership_id uuid, kind text, status text, role_id uuid, branch_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
     FOR NO KEY UPDATE;
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
$function$;

CREATE OR REPLACE FUNCTION tenancy.revoke_invitation(p_session_id uuid, p_invitation_id uuid)
 RETURNS TABLE(outcome text, invitation_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_inv tenancy.invitations%ROWTYPE;
BEGIN
  SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NOT NULL THEN
    PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
    SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v
     WHERE v.audience = 'merchant' AND v.scope = 'full' AND v.kind = 'owner' AND v.merchant_id = v_merchant;
  END IF;
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_inv FROM tenancy.invitations i
   WHERE i.id = p_invitation_id AND i.merchant_id = v_merchant
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid;
    RETURN;
  END IF;
  IF v_inv.accepted_at IS NOT NULL OR v_inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'invalid_transition', v_inv.id;
    RETURN;
  END IF;
  UPDATE tenancy.invitations i SET revoked_at = now() WHERE i.id = v_inv.id;
  RETURN QUERY SELECT 'ok', v_inv.id;
END
$function$;

CREATE OR REPLACE FUNCTION tenancy.transfer_ownership(p_session_id uuid, p_merchant_id uuid, p_new_owner_membership_id uuid, p_former_owner_role_id uuid, p_deactivate_former boolean)
 RETURNS TABLE(outcome text, former_owner_membership_id uuid, former_owner_identity_id uuid, new_owner_identity_id uuid, actor_identity_id uuid, actor_membership_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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

  PERFORM 1 FROM tenancy.merchants m WHERE m.id = p_merchant_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid, NULL::uuid, v_actor_identity, v_actor_membership;
    RETURN;
  END IF;

  -- The owner and the new owner: an unlocked lookup, then one sorted acquisition (L5).
  PERFORM tenancy.lock_memberships(NULL, ARRAY(
    SELECT mm.id FROM tenancy.merchant_memberships mm
     WHERE mm.merchant_id = p_merchant_id AND (mm.kind = 'owner' OR mm.id = p_new_owner_membership_id)));
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
$function$;

CREATE OR REPLACE FUNCTION tenancy.set_merchant_status(p_session_id uuid, p_merchant_id uuid, p_action text, p_reason text)
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
  v_new text;
  v_reason text := btrim(p_reason);
BEGIN
  IF p_action NOT IN ('deactivate', 'reactivate') THEN
    RAISE EXCEPTION 'unknown lifecycle action' USING ERRCODE = 'check_violation';
  END IF;

  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor_membership
    FROM identity.validate_session(p_session_id) v
    JOIN identity.platform_memberships pm ON pm.id = v.membership_id AND pm.role = 'super_admin'
   WHERE v.audience = 'platform' AND v.scope = 'full';
  IF v_actor_identity IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT m.status INTO v_status FROM tenancy.merchants m WHERE m.id = p_merchant_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::text, v_actor_identity, v_actor_membership;
    RETURN;
  END IF;
  -- The owner's verification decides where a reactivation lands (BR-2.2). With the merchant held, its owner cannot
  -- change (an ownership transfer locks the merchant first): the owner's identity is locked after it, by id.
  SELECT mm.identity_id INTO v_owner FROM tenancy.merchant_memberships mm
   WHERE mm.merchant_id = p_merchant_id AND mm.kind = 'owner';
  SELECT i.email_verified_at IS NOT NULL INTO v_owner_verified FROM identity.identities i
   WHERE i.id = v_owner FOR SHARE;

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
  END IF;

  RETURN QUERY SELECT 'ok', v_new, v_actor_identity, v_actor_membership;
END
$function$;

CREATE OR REPLACE FUNCTION identity.verify_email(p_token_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_identity uuid;
  v_merchants uuid[];
BEGIN
  -- An unlocked lookup (§7.2): whose token this is, and the businesses that identity owns. They are locked next, in the
  -- global order — the businesses first — and the token is re-checked under its lock.
  SELECT t.identity_id INTO v_identity FROM identity.one_time_tokens t
   WHERE t.token_hash = p_token_hash AND t.purpose = 'email_verification';
  IF v_identity IS NULL THEN
    RETURN NULL;
  END IF;
  v_merchants := ARRAY(SELECT mm.merchant_id FROM tenancy.merchant_memberships mm
                        WHERE mm.identity_id = v_identity AND mm.kind = 'owner');
  PERFORM tenancy.lock_merchants(NULL, v_merchants);
  IF identity.consume_one_time_token('email_verification', p_token_hash) IS DISTINCT FROM v_identity THEN
    RETURN NULL;
  END IF;
  UPDATE identity.identities SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
   WHERE id = v_identity;
  -- BR-2.2: a business is real once its owner confirms the email. Only the businesses held above, still owned by this
  -- identity (re-checked under the lock: an ownership transfer locks the merchant first).
  UPDATE tenancy.merchants m SET status = 'active', updated_at = now()
   WHERE m.id = ANY (v_merchants) AND m.status = 'pending_verification'
     AND EXISTS (SELECT 1 FROM tenancy.merchant_memberships mm
                  WHERE mm.merchant_id = m.id AND mm.identity_id = v_identity AND mm.kind = 'owner');
  RETURN v_identity;
END
$function$;

CREATE OR REPLACE FUNCTION tenancy.issue_invitation(p_session_id uuid, p_email text, p_kind text, p_role_id uuid, p_branch_id uuid, p_token_hash text, p_setup_token_hash text, p_ttl_seconds integer)
 RETURNS TABLE(outcome text, invitation_id uuid, expires_at timestamp with time zone, delivery text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_inviter uuid;
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

  SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NOT NULL THEN
    PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
    SELECT v.merchant_id, v.membership_id INTO v_merchant, v_inviter FROM identity.validate_session(p_session_id) v
     WHERE v.audience = 'merchant' AND v.scope = 'full' AND v.kind = 'owner' AND v.merchant_id = v_merchant;
  END IF;
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  -- Unlocked lookups (§7.2): the invitee's identity, then — in the global order — the open invitation to this email
  -- here (superseded below), the identity's live setup tokens (expired below when a new link is sent), the identity,
  -- the role and the branch.
  SELECT i.id INTO v_identity_id FROM identity.identities i WHERE i.email = v_email;
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

  IF (p_kind = 'agent' AND (p_role_id IS NOT NULL OR p_branch_id IS NOT NULL))
     OR (p_kind = 'staff' AND NOT EXISTS (
           SELECT 1 FROM tenancy.roles r
            WHERE r.id = p_role_id AND r.merchant_id = v_merchant AND r.status = 'active' FOR SHARE))
     OR (p_kind = 'staff' AND p_branch_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM tenancy.branches b
            WHERE b.id = p_branch_id AND b.merchant_id = v_merchant AND b.status = 'active' FOR SHARE)) THEN
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

  RETURN QUERY SELECT 'ok', v_id, v_expires, v_delivery;
END
$function$;

CREATE FUNCTION tenancy.admit_invitation_locked(p_invitation_id uuid, p_identity_id uuid)
 RETURNS TABLE(outcome text, membership_id uuid, merchant_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
-- Precondition (L6): the caller holds the invitation's merchant (FOR SHARE), the invitation (FOR NO KEY UPDATE), the
-- identity (FOR SHARE or stronger) and the invitation's role and branch (FOR SHARE), acquired in the global order.
-- Each is re-asserted here with NOWAIT: immediate when held, an error (55P03, never a wait) when a caller forgot.
-- Then every rule is re-checked and, if all hold, the membership is created and the invitation consumed.
DECLARE
  v_merchant uuid;
  v_inv tenancy.invitations%ROWTYPE;
  v_membership uuid;
BEGIN
  SELECT i.merchant_id INTO v_merchant FROM tenancy.invitations i WHERE i.id = p_invitation_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant AND m.status = 'active' FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'merchant_inactive', NULL::uuid, v_merchant;
    RETURN;
  END IF;
  SELECT * INTO v_inv FROM tenancy.invitations i WHERE i.id = p_invitation_id FOR NO KEY UPDATE NOWAIT;
  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN QUERY SELECT 'used', NULL::uuid, v_inv.merchant_id;
    RETURN;
  ELSIF v_inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked', NULL::uuid, v_inv.merchant_id;
    RETURN;
  ELSIF v_inv.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired', NULL::uuid, v_inv.merchant_id;
    RETURN;
  ELSIF v_inv.identity_id IS DISTINCT FROM p_identity_id THEN
    RETURN QUERY SELECT 'wrong_identity', NULL::uuid, v_inv.merchant_id;
    RETURN;
  END IF;
  PERFORM 1 FROM identity.identities i
   WHERE i.id = p_identity_id AND i.status = 'active' AND i.email_verified_at IS NOT NULL
     AND i.password_hash IS NOT NULL AND i.email = v_inv.email
     FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'identity_ineligible', NULL::uuid, v_inv.merchant_id;
    RETURN;
  END IF;
  IF v_inv.kind = 'staff' THEN
    PERFORM 1 FROM tenancy.roles r
     WHERE r.id = v_inv.role_id AND r.merchant_id = v_inv.merchant_id AND r.status = 'active' FOR SHARE NOWAIT;
    IF NOT FOUND OR (v_inv.branch_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM tenancy.branches b
          WHERE b.id = v_inv.branch_id AND b.merchant_id = v_inv.merchant_id AND b.status = 'active'
            FOR SHARE NOWAIT)) THEN
      RETURN QUERY SELECT 'assignment_inactive', NULL::uuid, v_inv.merchant_id;
      RETURN;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM tenancy.merchant_memberships mm
              WHERE mm.merchant_id = v_inv.merchant_id AND mm.identity_id = p_identity_id) THEN
    RETURN QUERY SELECT 'already_member', NULL::uuid, v_inv.merchant_id;
    RETURN;
  END IF;
  INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id, branch_id)
  VALUES (v_inv.merchant_id, p_identity_id, v_inv.kind, v_inv.role_id, v_inv.branch_id)
  RETURNING id INTO v_membership;
  UPDATE tenancy.invitations i SET accepted_at = now(), accepted_membership_id = v_membership
   WHERE i.id = v_inv.id;
  RETURN QUERY SELECT 'ok', v_membership, v_inv.merchant_id;
END
$function$;
REVOKE ALL ON FUNCTION tenancy.admit_invitation_locked(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION tenancy.accept_invitation(p_token_hash text, p_identity_id uuid)
 RETURNS TABLE(outcome text, membership_id uuid, merchant_id uuid, invitation_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_inv tenancy.invitations%ROWTYPE;
BEGIN
  -- An unlocked lookup (§7.2), then the footprint in the global order: the merchant, the invitation, the identity, the
  -- role and the branch; admission re-checks everything under those locks and waits for nothing (L6).
  SELECT * INTO v_inv FROM tenancy.invitations i WHERE i.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_inv.merchant_id FOR SHARE;
  PERFORM 1 FROM tenancy.invitations i WHERE i.id = v_inv.id FOR NO KEY UPDATE;
  PERFORM 1 FROM identity.identities i WHERE i.id = p_identity_id FOR SHARE;
  IF v_inv.role_id IS NOT NULL THEN
    PERFORM 1 FROM tenancy.roles r WHERE r.id = v_inv.role_id FOR SHARE;
  END IF;
  IF v_inv.branch_id IS NOT NULL THEN
    PERFORM 1 FROM tenancy.branches b WHERE b.id = v_inv.branch_id FOR SHARE;
  END IF;
  RETURN QUERY SELECT a.outcome, a.membership_id, a.merchant_id, v_inv.id
                 FROM tenancy.admit_invitation_locked(v_inv.id, p_identity_id) a;
END
$function$;

CREATE OR REPLACE FUNCTION identity.complete_account_setup(p_token_hash text, p_password_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_identity uuid;
  v_invitations uuid[];
  v_invitation uuid;
BEGIN
  -- An unlocked lookup (§7.2): the token's identity and that identity's pending invitations. Then the whole footprint,
  -- in the global order and all rows of a category at its turn (L5): every invitation's merchant, the invitations, the
  -- token (re-checked under its lock), the identity, the roles and the branches.
  SELECT t.identity_id INTO v_identity FROM identity.one_time_tokens t
   WHERE t.token_hash = p_token_hash AND t.purpose = 'account_setup';
  IF v_identity IS NULL THEN
    RETURN NULL;
  END IF;
  v_invitations := ARRAY(SELECT i.id FROM tenancy.invitations i
                          WHERE i.identity_id = v_identity AND i.accepted_at IS NULL AND i.revoked_at IS NULL
                          ORDER BY i.created_at, i.id);
  PERFORM tenancy.lock_merchants(ARRAY(SELECT i.merchant_id FROM tenancy.invitations i
                                        WHERE i.id = ANY (v_invitations)), NULL);
  PERFORM tenancy.lock_invitations(NULL, v_invitations);
  IF identity.consume_one_time_token('account_setup', p_token_hash) IS DISTINCT FROM v_identity THEN
    RETURN NULL;
  END IF;
  -- Account setup is for an identity without a password (a password set meanwhile refuses it, unchanged).
  PERFORM 1 FROM identity.identities i WHERE i.id = v_identity AND i.password_hash IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  PERFORM tenancy.lock_roles(ARRAY(SELECT i.role_id FROM tenancy.invitations i
                                    WHERE i.id = ANY (v_invitations) AND i.role_id IS NOT NULL), NULL);
  PERFORM tenancy.lock_branches(ARRAY(SELECT i.branch_id FROM tenancy.invitations i
                                       WHERE i.id = ANY (v_invitations) AND i.branch_id IS NOT NULL), NULL);
  PERFORM identity.apply_new_password(v_identity, p_password_hash, 'account_setup');
  UPDATE identity.identities SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
   WHERE id = v_identity;
  -- Each pending invitation, in the order it was issued; each one still valid is admitted (T10).
  FOREACH v_invitation IN ARRAY v_invitations LOOP
    PERFORM 1 FROM tenancy.admit_invitation_locked(v_invitation, v_identity);
  END LOOP;
  RETURN v_identity;
END
$function$;

DROP FUNCTION tenancy.admit_invitation(uuid, uuid);
