-- P5.5 step 4: the enforcement boundary (TARGET_ARCHITECTURE ADR-16 §3.5 "Direct writes move behind functions" and
-- "Read authorization — both layers for every permission-gated read" (owner decision B1); P5 plan §7.2 "Enforcement
-- boundary = one migration", the branch / role / profile writers' footprint, §8.1 pattern A, §8.5 R19).
--
-- One migration, one transaction: the functions below are created AND the app loses its direct access to the tables
-- they guard, so there is no state in which the functions exist and the direct path is still open. An application
-- version from before this migration that still reads or writes those tables directly gets insufficient_privilege —
-- over-denial, never a bypass (tested: the mixed-version test runs that version's statements against this database).
--
-- Writers (merchant permission; footprint: merchant → the actor's membership → the actor's role (a staff actor) and
-- the edited role → the edited branch, in the global order; contested inserts last, L3), each writing its atomic
-- audit row (pattern A) with the actor from the session and the request context recorded as given:
--   update_profile(session, name)                    merchant.profile.update  merchant (NKU) → actor (NKU) → role (S)
--   create_branch(session, name)                     merchant.branches.manage merchant (S) → actor → role → insert
--   update_branch(session, branch, name, status)     merchant.branches.manage … → the branch (NKU)
--   create_role(session, name)                       merchant.roles.manage    merchant (S) → actor → role → insert
--   update_role(session, role, name, status)         merchant.roles.manage    … → {actor's role S, the role NKU}
-- A refusal is returned ('forbidden'; 'not_found' for an id that is not this business's) and writes nothing. A name
-- already used by an active item raises unique_violation as before (the API answers 409 NAME_TAKEN).
--
-- Readers (B1; lock-free: session in, merchant from the session, the permission from the resolver, an explicit
-- merchant predicate on every query, nothing written):
--   read_profile(session)                   merchant.profile.read
--   list_branches(session, branch?)         merchant.branches.read
--   list_roles(session, role?)              merchant.roles.read
--   list_permission_catalog(session)        merchant.roles.read      (the merchant catalog, for role editing)
--   list_invitations(session, invitation?)  merchant.invitations.read
--   read_own_membership(session)            none — the caller's own membership and business (the `self` endpoint
--                                           GET /v1/merchant/membership and its agent twin; any member may read
--                                           their own business's name and status, as in P4)
--
-- Then the app's direct access is revoked: SELECT, INSERT and UPDATE on tenancy.merchants, tenancy.branches,
-- tenancy.roles and tenancy.invitations (column privileges included). The permission catalog has had no app grant since
-- P5.1. The reporting role is unchanged. Forward-only; earlier migrations untouched.

-- ── readers ──
CREATE FUNCTION tenancy.read_profile(p_session_id uuid)
 RETURNS TABLE(id uuid, name text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT m.id, m.name, m.status
    FROM identity.session_authority(p_session_id) a
    JOIN tenancy.merchants m ON m.id = a.merchant_id
   WHERE a.audience = 'merchant' AND 'merchant.profile.read' = ANY (a.permissions);
$function$;

CREATE FUNCTION tenancy.list_branches(p_session_id uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, status text, created_at timestamp with time zone, archived_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT b.id, b.name, b.status, b.created_at, b.archived_at
    FROM identity.session_authority(p_session_id) a
    JOIN tenancy.branches b ON b.merchant_id = a.merchant_id
   WHERE a.audience = 'merchant' AND 'merchant.branches.read' = ANY (a.permissions)
     AND (p_branch_id IS NULL OR b.id = p_branch_id)
   ORDER BY b.created_at, b.id;
$function$;

CREATE FUNCTION tenancy.list_roles(p_session_id uuid, p_role_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, status text, created_at timestamp with time zone, archived_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT r.id, r.name, r.status, r.created_at, r.archived_at
    FROM identity.session_authority(p_session_id) a
    JOIN tenancy.roles r ON r.merchant_id = a.merchant_id
   WHERE a.audience = 'merchant' AND 'merchant.roles.read' = ANY (a.permissions)
     AND (p_role_id IS NULL OR r.id = p_role_id)
   ORDER BY r.created_at, r.id;
$function$;

CREATE FUNCTION tenancy.list_permission_catalog(p_session_id uuid)
 RETURNS TABLE(identifier text, grantable boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT c.identifier, c.grantable
    FROM identity.session_authority(p_session_id) a
    JOIN identity.permission_catalog c ON c.scope = 'merchant' AND c.status = 'active'
   WHERE a.audience = 'merchant' AND 'merchant.roles.read' = ANY (a.permissions)
   ORDER BY c.identifier;
$function$;

CREATE FUNCTION tenancy.list_invitations(p_session_id uuid, p_invitation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, email text, kind text, role_id uuid, branch_id uuid, expires_at timestamp with time zone, accepted_at timestamp with time zone, revoked_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT i.id, i.email, i.kind, i.role_id, i.branch_id, i.expires_at, i.accepted_at, i.revoked_at, i.created_at
    FROM identity.session_authority(p_session_id) a
    JOIN tenancy.invitations i ON i.merchant_id = a.merchant_id
   WHERE a.audience = 'merchant' AND 'merchant.invitations.read' = ANY (a.permissions)
     AND (p_invitation_id IS NULL OR i.id = p_invitation_id)
   ORDER BY i.created_at DESC, i.id DESC;
$function$;

CREATE FUNCTION tenancy.read_own_membership(p_session_id uuid)
 RETURNS TABLE(membership_id uuid, kind text, role_id uuid, branch_id uuid, merchant_id uuid, merchant_name text, merchant_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT mm.id, mm.kind, mm.role_id, mm.branch_id, m.id, m.name, m.status
    FROM identity.validate_session(p_session_id) v
    JOIN tenancy.merchant_memberships mm ON mm.id = v.membership_id AND mm.merchant_id = v.merchant_id
    JOIN tenancy.merchants m ON m.id = v.merchant_id
   WHERE v.audience IN ('merchant', 'agent');
$function$;

-- ── writers ──
CREATE FUNCTION tenancy.update_profile(p_session_id uuid, p_name text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, name text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_row tenancy.merchants%ROWTYPE;
BEGIN
  -- Unlocked lookup (§7.2): the session's business, membership (the actor) and role. Then the footprint — the merchant
  -- (NKU: it is the row changed), the actor (NKU), a staff actor's role (S) — and the authority.
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR NO KEY UPDATE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  IF tenancy.assert_authority(p_session_id, 'merchant.profile.update') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  UPDATE tenancy.merchants m SET name = p_name, updated_at = now() WHERE m.id = v_merchant
  RETURNING * INTO v_row;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'merchant.profile_updated', 'merchant', v_merchant::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id, jsonb_build_object('name', v_row.name));
  RETURN QUERY SELECT 'ok', v_row.id, v_row.name, v_row.status;
END
$function$;

CREATE FUNCTION tenancy.create_branch(p_session_id uuid, p_name text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, name text, status text, created_at timestamp with time zone, archived_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_row tenancy.branches%ROWTYPE;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  IF tenancy.assert_authority(p_session_id, 'merchant.branches.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  -- The contested insert last (L3): an active name is unique within the business.
  INSERT INTO tenancy.branches (merchant_id, name) VALUES (v_merchant, p_name) RETURNING * INTO v_row;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'merchant.branch_created', 'branch', v_row.id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id, jsonb_build_object('name', v_row.name));
  RETURN QUERY SELECT 'ok', v_row.id, v_row.name, v_row.status, v_row.created_at, v_row.archived_at;
END
$function$;

CREATE FUNCTION tenancy.update_branch(p_session_id uuid, p_branch_id uuid, p_name text, p_status text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, name text, status text, created_at timestamp with time zone, archived_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_branch uuid;
  v_row tenancy.branches%ROWTYPE;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT b.id INTO v_branch FROM tenancy.branches b WHERE b.id = p_branch_id AND b.merchant_id = v_merchant;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM 1 FROM tenancy.branches b WHERE b.id = v_branch FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'merchant.branches.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  -- Rename and/or archive or restore; archiving sets archived_at, restoring clears it (the table's CHECK keeps the two
  -- consistent).
  UPDATE tenancy.branches b
     SET name = coalesce(p_name, b.name),
         status = coalesce(p_status, b.status),
         archived_at = CASE
           WHEN coalesce(p_status, b.status) = 'active' THEN NULL
           WHEN b.status = 'archived' THEN b.archived_at
           ELSE now()
         END,
         updated_at = now()
   WHERE b.id = v_branch AND b.merchant_id = v_merchant
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'merchant.branch_updated', 'branch', v_row.id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('name', v_row.name, 'status', v_row.status));
  RETURN QUERY SELECT 'ok', v_row.id, v_row.name, v_row.status, v_row.created_at, v_row.archived_at;
END
$function$;

CREATE FUNCTION tenancy.create_role(p_session_id uuid, p_name text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, name text, status text, created_at timestamp with time zone, archived_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_row tenancy.roles%ROWTYPE;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  IF tenancy.assert_authority(p_session_id, 'merchant.roles.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  -- The contested insert last (L3): an active name is unique within the business.
  INSERT INTO tenancy.roles (merchant_id, name) VALUES (v_merchant, p_name) RETURNING * INTO v_row;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'merchant.role_created', 'role', v_row.id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id, jsonb_build_object('name', v_row.name));
  RETURN QUERY SELECT 'ok', v_row.id, v_row.name, v_row.status, v_row.created_at, v_row.archived_at;
END
$function$;

CREATE FUNCTION tenancy.update_role(p_session_id uuid, p_role_id uuid, p_name text, p_status text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, name text, status text, created_at timestamp with time zone, archived_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_role uuid;
  v_row tenancy.roles%ROWTYPE;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT r.id INTO v_role FROM tenancy.roles r WHERE r.id = p_role_id AND r.merchant_id = v_merchant;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  -- The actor's role (S) and the edited role (NKU) in one sorted acquisition (L5).
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], ARRAY[v_role]);
  IF tenancy.assert_authority(p_session_id, 'merchant.roles.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  UPDATE tenancy.roles r
     SET name = coalesce(p_name, r.name),
         status = coalesce(p_status, r.status),
         archived_at = CASE
           WHEN coalesce(p_status, r.status) = 'active' THEN NULL
           WHEN r.status = 'archived' THEN r.archived_at
           ELSE now()
         END,
         updated_at = now()
   WHERE r.id = v_role AND r.merchant_id = v_merchant
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'merchant.role_updated', 'role', v_row.id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('name', v_row.name, 'status', v_row.status));
  RETURN QUERY SELECT 'ok', v_row.id, v_row.name, v_row.status, v_row.created_at, v_row.archived_at;
END
$function$;

-- ── grants: the app calls the readers and writers, nothing else ──
REVOKE ALL ON FUNCTION tenancy.read_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.list_branches(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.list_roles(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.list_permission_catalog(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.list_invitations(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.read_own_membership(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.update_profile(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.create_branch(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.update_branch(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.create_role(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.update_role(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.read_profile(uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION tenancy.list_branches(uuid, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION tenancy.list_roles(uuid, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION tenancy.list_permission_catalog(uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION tenancy.list_invitations(uuid, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION tenancy.read_own_membership(uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION tenancy.update_profile(uuid, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION tenancy.create_branch(uuid, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION tenancy.update_branch(uuid, uuid, text, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION tenancy.create_role(uuid, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION tenancy.update_role(uuid, uuid, text, text, text, text, text) TO alphakolect_app;

-- ── the boundary: the app's direct access to these tables ends here (column privileges included) ──
REVOKE ALL ON tenancy.merchants, tenancy.branches, tenancy.roles, tenancy.invitations FROM alphakolect_app;
