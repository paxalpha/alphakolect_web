-- P5.7: platform staff (P5 plan §7.4, §7.5, §10 P5.7; §7.2 rows "create_platform_staff", "staff deactivate /
-- reactivate" and "set_platform_grants"; §8.1 #30, #31, #32, #37; owner decisions D4, O8(a), O8(b), CF3).
--
-- Sign-in eligibility admits every active platform membership, whatever its role: identity.eligible_memberships loses
-- its `super_admin` condition (the SQL authority guard's temporary allowance, which ends here). A staff member's role is
-- a label that grants nothing (D4): what they may do comes only from their own grants, which identity.permissions_of
-- already resolves (P5.2). MFA stays mandatory for every platform identity (the login and enrolment flow, unchanged).
--
-- The super admin manages the platform team (platform.staff.manage, reserved, D4), through four functions, each
-- checking that permission with tenancy.assert_authority under its locks (§7.5: the actor's platform membership FOR
-- SHARE, first; a target FOR NO KEY UPDATE, in the same sorted helper call). Refusals are returned, never raised, and
-- write nothing (§8.2a); the API records them best effort.
--
--   identity.create_platform_staff — a new, passwordless identity, its platform membership with no grants, and an
--     account-setup token (the onboarding of T10): the API sends the setup link. An email that already has an
--     identity is refused (O8(a): platform and business accounts stay separate people), checked before the inserts and
--     again by the identity insert itself, so two concurrent creations of one email end with exactly one. #30.
--   identity.set_platform_staff_status — deactivate (the membership deactivated, its grants removed, its sessions
--     revoked: #31, listing the grants removed) or reactivate (active again with no grants, O8(b): #37). Only staff
--     are managed here: the super admin's membership is "not found", as one that does not exist.
--   identity.set_platform_grants — replaces an active staff member's grants: every identifier an active, grantable
--     platform permission, none twice (the grant table's trigger refuses the reserved ones in any case). #32, with the
--     set before and after.
--   identity.list_platform_staff — the team, newest first, each with its grants; a lock-free reader (B1), cursor
--     position and page size from the API (one row more than the page, so the API knows whether another page exists);
--     with a membership id, that one member (the writers' answer, read back in their transaction).
--
-- The catalog gains #30, #31, #32 and #37 (atomic, pattern A) and their best-effort refusals (denied, failure).
-- Forward-only; earlier migrations untouched.

-- ── sign-in eligibility: every active platform membership (§7.4) ──
CREATE OR REPLACE FUNCTION identity.eligible_memberships(p_identity_id uuid, p_audience text)
 RETURNS TABLE(membership_id uuid, merchant_id uuid, merchant_name text, kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT x.membership_id, x.merchant_id, x.merchant_name, x.kind
    FROM identity.identities i
    CROSS JOIN LATERAL (
      SELECT pm.id AS membership_id, NULL::uuid AS merchant_id, NULL::text AS merchant_name, pm.role AS kind
        FROM identity.platform_memberships pm
       WHERE p_audience = 'platform' AND pm.identity_id = i.id AND pm.status = 'active'
      UNION ALL
      SELECT mm.id, m.id, m.name, mm.kind
        FROM tenancy.merchant_memberships mm
        JOIN tenancy.merchants m ON m.id = mm.merchant_id AND m.status = 'active'
       WHERE mm.identity_id = i.id AND mm.status = 'active'
         AND ((p_audience = 'merchant' AND mm.kind IN ('owner', 'staff')) OR (p_audience = 'agent' AND mm.kind = 'agent'))
    ) x
   WHERE i.id = p_identity_id AND i.status = 'active'
   ORDER BY x.merchant_name NULLS FIRST, x.membership_id;
$function$;

-- ── the catalog: #30, #31, #32, #37 and their refusals ──
INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('platform.staff_created', 'success', 'atomic', 'A', '{"role": {"type": "string", "max": 16}}'),
  ('platform.staff_created', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.staff_created', 'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.staff_deactivated', 'success', 'atomic', 'A',
   '{"grantsRemoved": {"type": "string_list", "maxItems": 32, "max": 100}, "sessionsRevoked": {"type": "integer"}}'),
  ('platform.staff_deactivated', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.staff_deactivated', 'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.staff_reactivated', 'success', 'atomic', 'A', '{}'),
  ('platform.staff_reactivated', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.staff_reactivated', 'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.grants_set', 'success', 'atomic', 'A',
   '{"before": {"type": "string_list", "maxItems": 32, "max": 100}, "after": {"type": "string_list", "maxItems": 32, "max": 100}}'),
  ('platform.grants_set', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.grants_set', 'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}');

-- ── create ──
CREATE FUNCTION identity.create_platform_staff(p_session_id uuid, p_email text, p_role text, p_setup_token_hash text, p_ttl_seconds integer, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, membership_id uuid, membership_created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
  v_email text := lower(btrim(p_email));
  v_existing uuid;
  v_identity uuid;
  v_membership uuid;
  v_created timestamptz;
BEGIN
  -- A staff member's role is a label, never super_admin (only the operator bootstrap creates a super admin, §7.4).
  IF p_role IS NULL OR p_role NOT IN ('support', 'verification', 'finance') THEN
    RAISE EXCEPTION 'platform staff are support, verification or finance' USING ERRCODE = 'check_violation';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'account setup lifetime out of range' USING ERRCODE = 'check_violation';
  END IF;

  -- Unlocked lookups (§7.2): the session's platform membership (the actor), and the email (O8(a)). Then the footprint —
  -- the actor (S) — and the authority, from the resolver, under that lock.
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT i.id INTO v_existing FROM identity.identities i WHERE i.email = v_email;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], NULL);
  IF tenancy.assert_authority(p_session_id, 'platform.staff.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- O8(a): an email that already has an identity is refused — no password, MFA state or business membership is ever
  -- carried into the platform audience.
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT 'email_in_use', NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- Contested inserts last (L3): the identity (email), then its platform membership (identity_id); the setup token's
  -- key is a fresh random value. Nothing is waited for after them.
  INSERT INTO identity.identities (email) VALUES (v_email) ON CONFLICT (email) DO NOTHING RETURNING id INTO v_identity;
  IF v_identity IS NULL THEN
    -- Created by another transaction since the lookup: refused like any existing identity.
    RETURN QUERY SELECT 'email_in_use', NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  INSERT INTO identity.platform_memberships (identity_id, role) VALUES (v_identity, p_role)
  RETURNING id, created_at INTO v_membership, v_created;
  INSERT INTO identity.one_time_tokens (identity_id, purpose, token_hash, expires_at)
  VALUES (v_identity, 'account_setup', p_setup_token_hash, now() + make_interval(secs => p_ttl_seconds));

  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (NULL, v_actor_identity, 'platform', v_actor, 'platform.staff_created', 'platform_membership',
          v_membership::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('role', p_role));
  RETURN QUERY SELECT 'ok', v_membership, v_created;
END
$function$;
REVOKE ALL ON FUNCTION identity.create_platform_staff(uuid, text, text, text, integer, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.create_platform_staff(uuid, text, text, text, integer, text, text, text) TO alphakolect_app;

-- ── deactivate and reactivate ──
CREATE FUNCTION identity.set_platform_staff_status(p_session_id uuid, p_membership_id uuid, p_action text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, new_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
  v_target identity.platform_memberships%ROWTYPE;
  v_removed text[];
  v_revoked integer;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('deactivate', 'reactivate') THEN
    RAISE EXCEPTION 'unknown staff lifecycle action' USING ERRCODE = 'check_violation';
  END IF;

  -- Unlocked lookup (§7.2): the actor. Then the footprint (§7.5) — the actor (S) and the target (NKU), one sorted call —
  -- and the authority, under those locks.
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::text;
    RETURN;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], ARRAY[p_membership_id]);
  IF tenancy.assert_authority(p_session_id, 'platform.staff.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_target FROM identity.platform_memberships pm WHERE pm.id = p_membership_id;
  -- Only staff are managed here; the super admin's membership is not found, like one that does not exist.
  IF v_target.id IS NULL OR v_target.role = 'super_admin' THEN
    RETURN QUERY SELECT 'not_found', NULL::text;
    RETURN;
  END IF;

  IF p_action = 'deactivate' THEN
    IF v_target.status <> 'active' THEN
      RETURN QUERY SELECT 'invalid_transition', v_target.status;
      RETURN;
    END IF;
    v_removed := ARRAY(SELECT g.permission FROM identity.platform_membership_grants g
                        WHERE g.platform_membership_id = v_target.id ORDER BY g.permission);
    UPDATE identity.platform_memberships pm SET status = 'deactivated', deactivated_at = now()
     WHERE pm.id = v_target.id;
    -- Its grants go with it (§7.4), and its sessions end now.
    DELETE FROM identity.platform_membership_grants g WHERE g.platform_membership_id = v_target.id;
    UPDATE identity.sessions s SET revoked_at = now(), revoke_reason = 'membership_deactivated'
     WHERE s.platform_membership_id = v_target.id AND s.revoked_at IS NULL;
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       ip, user_agent, request_id, summary)
    VALUES (NULL, v_actor_identity, 'platform', v_actor, 'platform.staff_deactivated', 'platform_membership',
            v_target.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
            jsonb_build_object('grantsRemoved', to_jsonb(v_removed), 'sessionsRevoked', v_revoked));
    RETURN QUERY SELECT 'ok', 'deactivated';
  ELSE
    IF v_target.status <> 'deactivated' THEN
      RETURN QUERY SELECT 'invalid_transition', v_target.status;
      RETURN;
    END IF;
    -- O8(b): active again with no grants (they were removed at deactivation); access is given again explicitly.
    UPDATE identity.platform_memberships pm SET status = 'active', deactivated_at = NULL WHERE pm.id = v_target.id;
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       ip, user_agent, request_id, summary)
    VALUES (NULL, v_actor_identity, 'platform', v_actor, 'platform.staff_reactivated', 'platform_membership',
            v_target.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id, '{}'::jsonb);
    RETURN QUERY SELECT 'ok', 'active';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION identity.set_platform_staff_status(uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.set_platform_staff_status(uuid, uuid, text, text, text, text) TO alphakolect_app;

-- ── a staff member's grants ──
CREATE FUNCTION identity.set_platform_grants(p_session_id uuid, p_membership_id uuid, p_permissions text[], p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, permissions text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
  v_target identity.platform_memberships%ROWTYPE;
  v_before text[];
  v_after text[];
BEGIN
  -- Unlocked lookup (§7.2): the actor. Then the footprint (§7.5) — the actor (S) and the target (NKU), one sorted call —
  -- and the authority, under those locks; the target's grant rows are rewritten while it is held.
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::text[];
    RETURN;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], ARRAY[p_membership_id]);
  IF tenancy.assert_authority(p_session_id, 'platform.staff.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::text[];
    RETURN;
  END IF;
  SELECT * INTO v_target FROM identity.platform_memberships pm WHERE pm.id = p_membership_id;
  IF v_target.id IS NULL OR v_target.role = 'super_admin' THEN
    RETURN QUERY SELECT 'not_found', NULL::text[];
    RETURN;
  END IF;
  -- A deactivated member has no grants and gets none until reactivated (O8(b)).
  IF v_target.status <> 'active' THEN
    RETURN QUERY SELECT 'invalid_transition', NULL::text[];
    RETURN;
  END IF;
  -- Every identifier an active, grantable platform permission, none twice (a null is neither).
  IF p_permissions IS NULL
     OR cardinality(p_permissions) <> (SELECT count(DISTINCT x) FROM unnest(p_permissions) x)
     OR EXISTS (SELECT 1 FROM unnest(p_permissions) x
                 WHERE NOT EXISTS (SELECT 1 FROM identity.permission_catalog c
                                    WHERE c.identifier = x AND c.scope = 'platform' AND c.grantable
                                      AND c.status = 'active')) THEN
    RETURN QUERY SELECT 'invalid_permissions', NULL::text[];
    RETURN;
  END IF;

  v_before := ARRAY(SELECT g.permission FROM identity.platform_membership_grants g
                     WHERE g.platform_membership_id = v_target.id ORDER BY g.permission);
  v_after := ARRAY(SELECT x FROM unnest(p_permissions) x ORDER BY x);
  -- Removals, then the contested inserts last (L3).
  DELETE FROM identity.platform_membership_grants g
   WHERE g.platform_membership_id = v_target.id AND g.permission <> ALL (v_after);
  INSERT INTO identity.platform_membership_grants (platform_membership_id, permission)
  SELECT v_target.id, x FROM unnest(v_after) x WHERE x <> ALL (v_before);
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (NULL, v_actor_identity, 'platform', v_actor, 'platform.grants_set', 'platform_membership',
          v_target.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  RETURN QUERY SELECT 'ok', v_after;
END
$function$;
REVOKE ALL ON FUNCTION identity.set_platform_grants(uuid, uuid, text[], text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.set_platform_grants(uuid, uuid, text[], text, text, text) TO alphakolect_app;

-- ── the team, newest first, or one member (a lock-free reader, B1) ──
CREATE FUNCTION identity.list_platform_staff(p_session_id uuid, p_membership_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, email text, role text, status text, permissions text[], created_at timestamp with time zone, deactivated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- One statement: the page as of its start. One row more than the page tells the caller whether another follows.
  RETURN QUERY
  SELECT pm.id, i.email, pm.role, pm.status,
         ARRAY(SELECT g.permission FROM identity.platform_membership_grants g
                WHERE g.platform_membership_id = pm.id ORDER BY g.permission),
         pm.created_at, pm.deactivated_at
    FROM identity.session_authority(p_session_id) a
    JOIN identity.platform_memberships pm ON pm.role <> 'super_admin'
    JOIN identity.identities i ON i.id = pm.identity_id
   WHERE a.audience = 'platform' AND 'platform.staff.manage' = ANY (a.permissions)
     AND (p_membership_id IS NULL OR pm.id = p_membership_id)
     AND (p_after_id IS NULL OR (pm.created_at, pm.id) < (p_after_created_at, p_after_id))
   ORDER BY pm.created_at DESC, pm.id DESC
   LIMIT p_limit + 1;
END
$function$;
REVOKE ALL ON FUNCTION identity.list_platform_staff(uuid, uuid, integer, timestamp with time zone, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.list_platform_staff(uuid, uuid, integer, timestamp with time zone, uuid) TO alphakolect_app;
