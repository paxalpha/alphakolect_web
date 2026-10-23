-- P5.7: the platform merchant lists — sensitive reads (P5 plan §10 P5.7; §7.2 rows "tenancy.platform_list_merchants
-- (#35)" and "tenancy.platform_list_merchant_members (#36)" and the read-consistency guarantees (R25); §8.1 #35, #36;
-- §8.2a rule 7). Closes P4 limitation 1: the platform team had no way to see the businesses or their members.
--
-- Each list is one designated definer function, the only writer of its read event (R16, R18). In one transaction it
-- validates the session, locks the caller's platform membership FOR SHARE — platform authority comes entirely from it
-- and its grants, so a revocation is either seen or waits for the read (§7.5) — checks platform.merchants.read with
-- tenancy.assert_authority under that lock, writes exactly one read event, and only then returns the rows: if the event
-- cannot be written the function raises and nothing is returned. A refusal is returned ('forbidden'), writes nothing,
-- and the API records it best effort; a business that does not exist is 'not_found', with no event.
--
-- Both lists are paginated from the start (at most 100 rows a page) and ordered newest first by (created_at, id), a
-- total order of immutable keys. A page is one SELECT with no row locks — the committed state as of its start, never
-- waiting for or blocking writers of the listed rows; continuation is the strict tuple predicate on the position the
-- API decoded from its cursor. The function returns one row more than the page when another follows (the API sends
-- the page and a cursor, never that row). The rows are cross-tenant by design: these are platform reads, gated by a
-- platform permission and recorded, not filtered by a session merchant.
--
-- The read event: #35 has no business; #36 is recorded against the business whose members were read (merchant_id and
-- target), as the platform team's other actions on a business are (#27–#29), so it belongs to that business's record
-- (O3; shown without the platform actor's IP address and device, CF5). Its summary is the page asked for: its size and
-- whether it continued a list.
--
-- Indexes, chosen from recorded query plans (P5.7 evidence: a throwaway database with 20,000 businesses in groups of
-- seven sharing a timestamp and 110,000 memberships, one business holding 50,000; EXPLAIN ANALYZE of generic plans,
-- which a function reuses): one per list, matching its order, so that a page — first or three quarters down — is a
-- backward index scan reading about one page of rows (merchants: 0.07–0.09 ms; the largest business's members:
-- 0.24 ms), where without them every page sorts the whole table (the largest business: 87–514 ms). The first page and
-- a continuation are separate statements: one statement serving both ("no cursor, or the tuple predicate") cannot use
-- the position as an index condition in a generic plan, and its deep pages filtered out every row before the cursor
-- (15,001 and 37,501 rows; 3.6 and 13 ms) — the work grew with the depth.
-- Forward-only; earlier migrations untouched.

CREATE INDEX "merchants_created_at_id_idx" ON "tenancy"."merchants" ("created_at", "id");
CREATE INDEX "merchant_memberships_merchant_id_created_at_id_idx"
  ON "tenancy"."merchant_memberships" ("merchant_id", "created_at", "id");

INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('platform.merchant_list_read', 'success', 'sensitive_read', NULL,
   '{"limit": {"type": "integer"}, "continued": {"type": "boolean"}}'),
  ('platform.merchant_list_read', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.merchant_members_read', 'success', 'sensitive_read', NULL,
   '{"limit": {"type": "integer"}, "continued": {"type": "boolean"}}'),
  ('platform.merchant_members_read', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}');

-- ── every business, newest first (#35) ──
CREATE FUNCTION tenancy.platform_list_merchants(p_session_id uuid, p_limit integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, name text, status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Unlocked lookup (§7.2): the actor. Then the footprint — the actor's platform membership (S) — and the authority,
  -- under that lock (§7.5).
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], NULL);
  IF tenancy.assert_authority(p_session_id, 'platform.merchants.read') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  -- The read event first (§8.2a rule 7): if it cannot be written, this raises and no row is returned.
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (NULL, v_actor_identity, 'platform', v_actor, 'platform.merchant_list_read', NULL, NULL, 'success',
          p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('limit', p_limit, 'continued', p_after_id IS NOT NULL));
  -- Then the page: one statement, no row locks — the first page, or the rows after the cursor's position.
  IF p_after_id IS NULL THEN
    RETURN QUERY
    SELECT 'ok', m.id, m.name, m.status, m.created_at
      FROM tenancy.merchants m
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT p_limit + 1;
  ELSE
    RETURN QUERY
    SELECT 'ok', m.id, m.name, m.status, m.created_at
      FROM tenancy.merchants m
     WHERE (m.created_at, m.id) < (p_after_created_at, p_after_id)
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT p_limit + 1;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION tenancy.platform_list_merchants(uuid, integer, timestamp with time zone, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.platform_list_merchants(uuid, integer, timestamp with time zone, uuid, text, text, text) TO alphakolect_app;

-- ── one business's memberships, newest first (#36) ──
CREATE FUNCTION tenancy.platform_list_merchant_members(p_session_id uuid, p_merchant_id uuid, p_limit integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, kind text, status text, email text, role_id uuid, branch_id uuid, created_at timestamp with time zone, deactivated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Unlocked lookup (§7.2): the actor. Then the footprint — the actor's platform membership (S) — and the authority,
  -- under that lock (§7.5).
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], NULL);
  IF tenancy.assert_authority(p_session_id, 'platform.merchants.read') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  -- A business that does not exist (none is ever deleted): not found, and nothing was read.
  IF NOT EXISTS (SELECT 1 FROM tenancy.merchants m WHERE m.id = p_merchant_id) THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  -- The read event first (§8.2a rule 7), against the business whose members are read.
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (p_merchant_id, v_actor_identity, 'platform', v_actor, 'platform.merchant_members_read', 'merchant',
          p_merchant_id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('limit', p_limit, 'continued', p_after_id IS NOT NULL));
  -- Then the page: one statement over the memberships and their identities, no row locks — the first page, or the
  -- rows after the cursor's position.
  IF p_after_id IS NULL THEN
    RETURN QUERY
    SELECT 'ok', mm.id, mm.kind, mm.status, i.email, mm.role_id, mm.branch_id, mm.created_at, mm.deactivated_at
      FROM tenancy.merchant_memberships mm
      JOIN identity.identities i ON i.id = mm.identity_id
     WHERE mm.merchant_id = p_merchant_id
     ORDER BY mm.created_at DESC, mm.id DESC
     LIMIT p_limit + 1;
  ELSE
    RETURN QUERY
    SELECT 'ok', mm.id, mm.kind, mm.status, i.email, mm.role_id, mm.branch_id, mm.created_at, mm.deactivated_at
      FROM tenancy.merchant_memberships mm
      JOIN identity.identities i ON i.id = mm.identity_id
     WHERE mm.merchant_id = p_merchant_id AND (mm.created_at, mm.id) < (p_after_created_at, p_after_id)
     ORDER BY mm.created_at DESC, mm.id DESC
     LIMIT p_limit + 1;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION tenancy.platform_list_merchant_members(uuid, uuid, integer, timestamp with time zone, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.platform_list_merchant_members(uuid, uuid, integer, timestamp with time zone, uuid, text, text, text) TO alphakolect_app;
