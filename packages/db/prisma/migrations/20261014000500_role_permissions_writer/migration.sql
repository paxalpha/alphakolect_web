-- P5.6: role permission management (P5 plan §10 P5.6; §7.2 footprint row "set_role_permissions"; §8.1 #21; D5′, D6).
--
-- tenancy.set_role_permissions(session, role, permissions[]) replaces a role's permission set. It is the first function
-- an app path can reach that writes a grant table (P5.1 storage, A). Its footprint is the plan's row: the merchant (S)
-- → the acting member (NKU) → the role (NKU) → the role's grant rows (rewritten while the role is held; the contested
-- inserts last, L3). Under those locks it asks tenancy.assert_authority for merchant.roles.manage — reserved, so only
-- the owner ever holds it (D5′) — then checks the set: every identifier an active, grantable merchant permission,
-- none twice. A refusal is returned, not raised, and writes nothing (§8.2a): 'forbidden' first, then 'not_found' for
-- a role that is not this business's, then 'invalid_permissions'. The grant table's own trigger still refuses a
-- reserved permission, whatever the caller. A success writes #21 merchant.role_permissions_set in the same transaction
-- (pattern A): the actor from the session, the role as target, the set before and after (the list rule of
-- 20261014000300), the request context as given. An archived role may have its set changed: it stays inert until the
-- role is restored, and then applies at once (D6; the owner's answer O14).
--
-- tenancy.list_roles (the B1 reader, P5.5 step 4) returns each role's permissions, sorted — the frozen Role.permissions
-- — under the same read permission (merchant.roles.read): the owner-approved description of that permission says it
-- shows the roles "and the permissions each role has" (O13). Replaced: same signature and grant, one more column.
--
-- The catalog gains #21 (atomic, pattern A) and its best-effort refusals (denied, failure) — the plan's inventory.
-- Forward-only; earlier migrations untouched.

INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('merchant.role_permissions_set', 'success', 'atomic', 'A',
   '{"before": {"type": "string_list", "maxItems": 32, "max": 100}, "after": {"type": "string_list", "maxItems": 32, "max": 100}}'),
  ('merchant.role_permissions_set', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('merchant.role_permissions_set', 'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}');

CREATE FUNCTION tenancy.set_role_permissions(p_session_id uuid, p_role_id uuid, p_permissions text[], p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, permissions text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_role uuid;
  v_before text[];
  v_after text[];
BEGIN
  -- Unlocked lookup (§7.2): the session's business and acting member, and the role if it is this business's.
  SELECT v.merchant_id, v.membership_id, v.identity_id INTO v_merchant, v_actor, v_actor_identity
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::text[];
    RETURN;
  END IF;
  SELECT r.id INTO v_role FROM tenancy.roles r WHERE r.id = p_role_id AND r.merchant_id = v_merchant;
  -- The footprint: the merchant (S), the acting member (NKU), the edited role (NKU). An owner-only operation: the
  -- actor's own role is not part of it (a staff caller's role is re-asserted by assert_authority, NOWAIT).
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(NULL, ARRAY[v_role]);
  IF tenancy.assert_authority(p_session_id, 'merchant.roles.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::text[];
    RETURN;
  END IF;
  IF v_role IS NULL THEN
    RETURN QUERY SELECT 'not_found', NULL::text[];
    RETURN;
  END IF;
  -- Every identifier an active, grantable merchant permission, none twice (a null is neither).
  IF p_permissions IS NULL
     OR cardinality(p_permissions) <> (SELECT count(DISTINCT x) FROM unnest(p_permissions) x)
     OR EXISTS (SELECT 1 FROM unnest(p_permissions) x
                 WHERE NOT EXISTS (SELECT 1 FROM identity.permission_catalog c
                                    WHERE c.identifier = x AND c.scope = 'merchant' AND c.grantable
                                      AND c.status = 'active')) THEN
    RETURN QUERY SELECT 'invalid_permissions', NULL::text[];
    RETURN;
  END IF;

  v_before := ARRAY(SELECT rp.permission FROM tenancy.role_permissions rp
                     WHERE rp.merchant_id = v_merchant AND rp.role_id = v_role ORDER BY rp.permission);
  v_after := ARRAY(SELECT x FROM unnest(p_permissions) x ORDER BY x);
  -- The grant rows, rewritten while the role is held: removals, then the contested inserts last (L3).
  DELETE FROM tenancy.role_permissions rp
   WHERE rp.merchant_id = v_merchant AND rp.role_id = v_role AND rp.permission <> ALL (v_after);
  INSERT INTO tenancy.role_permissions (merchant_id, role_id, permission)
  SELECT v_merchant, v_role, x FROM unnest(v_after) x WHERE x <> ALL (v_before);
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'merchant.role_permissions_set', 'role', v_role::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  RETURN QUERY SELECT 'ok', v_after;
END
$function$;
REVOKE ALL ON FUNCTION tenancy.set_role_permissions(uuid, uuid, text[], text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.set_role_permissions(uuid, uuid, text[], text, text, text) TO alphakolect_app;

-- ── the role reader returns each role's permissions ──
DROP FUNCTION tenancy.list_roles(uuid, uuid);
CREATE FUNCTION tenancy.list_roles(p_session_id uuid, p_role_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, status text, created_at timestamp with time zone, archived_at timestamp with time zone, permissions text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT r.id, r.name, r.status, r.created_at, r.archived_at,
         ARRAY(SELECT rp.permission FROM tenancy.role_permissions rp
                WHERE rp.merchant_id = r.merchant_id AND rp.role_id = r.id ORDER BY rp.permission)
    FROM identity.session_authority(p_session_id) a
    JOIN tenancy.roles r ON r.merchant_id = a.merchant_id
   WHERE a.audience = 'merchant' AND 'merchant.roles.read' = ANY (a.permissions)
     AND (p_role_id IS NULL OR r.id = p_role_id)
   ORDER BY r.created_at, r.id;
$function$;
REVOKE ALL ON FUNCTION tenancy.list_roles(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.list_roles(uuid, uuid) TO alphakolect_app;
