-- P5.8: the activity-record reads (P5 plan §8.5, §10 P5.8; ADR-16 §3.5 "Addendum — the activity-record reads",
-- confirmed by the independent reviewer on 2026-10-19 for the design of #33 and #34; O3, O4, O19, D8′, D9, CF5).
--
-- Two designated definer functions, each the only writer of its read event (sensitive reads, §8.2a rule 7; R16, R18):
--   audit.read_merchant_events (#33) — a business's own record, the owner only (merchant.audit.read, D8′);
--   audit.read_platform_events (#34) — the platform's record (platform.audit.read; the super admin holds every platform
--   permission).
-- In one transaction each validates the session, locks the reader's membership FOR SHARE (§7.2: #33 the owner's merchant
-- membership, #34 the reader's platform membership), checks the permission with tenancy.assert_authority under that
-- lock, writes exactly one read event, and only then returns the page: if the event cannot be written the function
-- raises and nothing is returned. A refusal is returned ('forbidden'), writes nothing, and the API records it best
-- effort; a filter naming a person or business that does not exist for the reader is 'not_found', with no event, as the
-- other lists answer; an unknown event identifier is 'invalid_event'.
--
-- The page (O4): a window from ≤ occurred_at < to of at most 31 days (744 hours), at most 100 events, newest first by
-- (occurred_at, id) — events of one transaction share a timestamp and the identifier breaks the tie. Continuation is the
-- strict tuple predicate on the position the API decoded from its cursor, with the window and filters always from the
-- request; a position outside the window is refused. One row more than the page tells the caller another follows. A
-- page is one SELECT with no row locks: the committed state as of its start (R25), never waiting for or blocking the
-- writers of the record, nor the purge.
--
-- Planned per call (plan_cache_mode = force_custom_plan): each optional filter is a `parameter IS NULL OR …` predicate
-- that the planner folds away with the call's values, so every shape uses the index measured for it, without SQL built
-- at run time (T-9).
--
-- What each reader sees (the addendum's table): the owner, every event of the business only — the business from the
-- session, never a parameter or a cursor (R19) — refused attempts included (O3), with each actor's membership and email
-- as recorded and read, and the IP address and device (D9); the platform team's actions (an actor whose identity holds
-- a platform membership, CF3) without the person's membership, email, IP address or device, labelled 'AlphaKolect team'
-- (O19, CF5) — the recorded audience is returned as recorded, the label never replaces it. The platform reader, every
-- event, each actor with membership and email; the IP address and device to the super admin only (D9, F3).
--
-- The record of a read: #33 against the business (the owner's own look is in its record); #34 against the filtered
-- business when one is given (that business's record shows the AlphaKolect team looked at it, as #36), else none.
--
-- Database access (§8.6; the addendum): the app loses SELECT on audit.audit_events, and the reporting role its ip and
-- user_agent columns — every read goes through these functions. A recorded audience is one of the three the addendum
-- names, or none: a CHECK refuses any other from any writer.
-- Forward-only; earlier migrations untouched.

-- ── the recorded audience: merchant, agent, platform, or none ──
ALTER TABLE audit.audit_events
  ADD CONSTRAINT audit_events_actor_audience_valid
  CHECK (actor_audience IS NULL OR actor_audience IN ('merchant', 'agent', 'platform'));

-- ── indexes, from recorded plans (docs/architecture/evidence/p5-audit-read-indexes; the reviewer's condition) ──
-- Two million events over two years across 3,000 skewed businesses, and one platform team member busy across 2,000 of
-- them; every shape of both reads as the functions run it, planned per call: each page is a backward index scan of
-- about one page of rows (at most 1.2 ms). The addendum's set — (occurred_at, id) (already there from Part 2),
-- (merchant_id, occurred_at, id) replacing P1's (merchant_id, occurred_at), (actor_identity_id, occurred_at, id) —
-- left the shape the reviewer named, one business's events by a team member busy elsewhere, walking that person's whole
-- window (2,466 rows filtered, 7.6 ms, growing with the person's activity); (merchant_id, actor_identity_id,
-- occurred_at, id) reads about one page for it (0.19 ms). The event filter keeps P1's (action, occurred_at).
CREATE INDEX audit_events_merchant_id_occurred_at_id_idx ON audit.audit_events (merchant_id, occurred_at, id);
DROP INDEX audit.audit_events_merchant_id_occurred_at_idx;
CREATE INDEX audit_events_actor_identity_id_occurred_at_id_idx ON audit.audit_events (actor_identity_id, occurred_at, id);
CREATE INDEX audit_events_merchant_id_actor_identity_id_occurred_at_id_idx
  ON audit.audit_events (merchant_id, actor_identity_id, occurred_at, id);

-- ── the read events ──
INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('merchant.audit_read', 'success', 'sensitive_read', NULL,
   '{"from": {"type": "string", "max": 40}, "to": {"type": "string", "max": 40}, "limit": {"type": "integer"}, "continued": {"type": "boolean"}, "membershipId": {"type": "string", "max": 36, "nullable": true}}'),
  ('merchant.audit_read', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.audit_read', 'success', 'sensitive_read', NULL,
   '{"from": {"type": "string", "max": 40}, "to": {"type": "string", "max": 40}, "limit": {"type": "integer"}, "continued": {"type": "boolean"}, "merchantId": {"type": "string", "max": 36, "nullable": true}, "membershipId": {"type": "string", "max": 36, "nullable": true}, "event": {"type": "string", "max": 100, "nullable": true}}'),
  ('platform.audit_read', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}');

-- ── a business's record, the owner only (#33) ──
CREATE FUNCTION audit.read_merchant_events(p_session_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer, p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_membership_id uuid DEFAULT NULL::uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, occurred_at timestamp with time zone, position_at text, action text, event_outcome text, has_actor boolean, actor_audience text, actor_membership_id uuid, actor_email text, actor_label text, target_type text, target_id text, summary jsonb, ip text, user_agent text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_person uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '744 hours' THEN
    RAISE EXCEPTION 'the window is from before to, at most 31 days' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_after_at IS NOT NULL AND (p_after_at < p_from OR p_after_at >= p_to) THEN
    RAISE EXCEPTION 'a cursor position lies inside the window' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Unlocked lookup (§7.2): the session's business and acting member. Then the footprint — the actor's membership
  -- (S) — and the authority, under that lock.
  SELECT v.merchant_id, v.membership_id, v.identity_id INTO v_merchant, v_actor, v_actor_identity
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz, NULL::text, NULL::text, NULL::text, NULL::boolean,
                        NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
                        NULL::text;
    RETURN;
  END IF;
  PERFORM tenancy.lock_memberships(ARRAY[v_actor], NULL);
  IF tenancy.assert_authority(p_session_id, 'merchant.audit.read') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz, NULL::text, NULL::text, NULL::text, NULL::boolean,
                        NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
                        NULL::text;
    RETURN;
  END IF;
  -- The person filter: a member of this business, any status (O3, O4 Q3) — the person behind the membership.
  IF p_membership_id IS NOT NULL THEN
    SELECT mm.identity_id INTO v_person
      FROM tenancy.merchant_memberships mm WHERE mm.id = p_membership_id AND mm.merchant_id = v_merchant;
    IF v_person IS NULL THEN
      RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::timestamptz, NULL::text, NULL::text, NULL::text,
                          NULL::boolean, NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text,
                          NULL::jsonb, NULL::text, NULL::text;
      RETURN;
    END IF;
  END IF;

  -- The read event first (§8.2a rule 7), in the business's own record: if it cannot be written, nothing is returned.
  INSERT INTO audit.audit_events (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome, ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'merchant.audit_read', NULL, NULL, 'success', p_ip, left(p_user_agent, 512), p_request_id, jsonb_build_object('from', to_char(p_from, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'to', to_char(p_to, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'limit', p_limit, 'continued', p_after_id IS NOT NULL, 'membershipId', p_membership_id::text));

  -- Then the page: one statement, no row locks. The platform team (an identity with a platform membership) is shown
  -- unnamed and without its address and device; everyone else as recorded.
  RETURN QUERY
  SELECT 'ok', e.id, e.occurred_at, to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), e.action, e.outcome,
         e.actor_identity_id IS NOT NULL, e.actor_audience,
         CASE WHEN t.team THEN NULL ELSE e.actor_membership_id END,
         CASE WHEN t.team THEN NULL ELSE i.email END,
         CASE WHEN t.team THEN 'AlphaKolect team' END,
         e.target_type, e.target_id, e.summary,
         CASE WHEN t.team THEN NULL ELSE e.ip END,
         CASE WHEN t.team THEN NULL ELSE e.user_agent END
    FROM audit.audit_events e
    LEFT JOIN identity.identities i ON i.id = e.actor_identity_id
    CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM identity.platform_memberships pm
                                        WHERE pm.identity_id = e.actor_identity_id) AS team) t
   WHERE e.merchant_id = v_merchant
     AND e.occurred_at >= p_from AND e.occurred_at < p_to
     AND (v_person IS NULL OR e.actor_identity_id = v_person)
     AND (p_after_id IS NULL OR (e.occurred_at, e.id) < (p_after_at, p_after_id))
   ORDER BY e.occurred_at DESC, e.id DESC
   LIMIT p_limit + 1;
END
$function$;
REVOKE ALL ON FUNCTION audit.read_merchant_events(uuid, timestamp with time zone, timestamp with time zone, integer, timestamp with time zone, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.read_merchant_events(uuid, timestamp with time zone, timestamp with time zone, integer, timestamp with time zone, uuid, uuid, text, text, text) TO alphakolect_app;

-- ── the platform's record (#34) ──
CREATE FUNCTION audit.read_platform_events(p_session_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer, p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_merchant_id uuid DEFAULT NULL::uuid, p_membership_id uuid DEFAULT NULL::uuid, p_event text DEFAULT NULL::text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, occurred_at timestamp with time zone, position_at text, merchant_id uuid, action text, event_outcome text, has_actor boolean, actor_audience text, actor_membership_id uuid, actor_email text, target_type text, target_id text, summary jsonb, ip text, user_agent text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
  v_super boolean;
  v_person uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '744 hours' THEN
    RAISE EXCEPTION 'the window is from before to, at most 31 days' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_after_at IS NOT NULL AND (p_after_at < p_from OR p_after_at >= p_to) THEN
    RAISE EXCEPTION 'a cursor position lies inside the window' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Unlocked lookup (§7.2): the actor. Then the footprint — the actor's platform membership (S) — and the authority,
  -- under that lock (§7.5). Whether the reader is the super admin is read from the locked row.
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz, NULL::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::boolean, NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::jsonb,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], NULL);
  IF tenancy.assert_authority(p_session_id, 'platform.audit.read') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz, NULL::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::boolean, NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::jsonb,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT pm.role = 'super_admin' INTO v_super FROM identity.platform_memberships pm WHERE pm.id = v_actor;

  -- The filters: a business that exists; a person by any of their memberships; an event in the catalog.
  IF p_event IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audit.event_catalog c WHERE c.identifier = p_event) THEN
    RETURN QUERY SELECT 'invalid_event', NULL::uuid, NULL::timestamptz, NULL::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::boolean, NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::jsonb,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  IF p_merchant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenancy.merchants m WHERE m.id = p_merchant_id) THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::timestamptz, NULL::text, NULL::uuid, NULL::text, NULL::text,
                        NULL::boolean, NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::jsonb,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  IF p_membership_id IS NOT NULL THEN
    SELECT coalesce((SELECT mm.identity_id FROM tenancy.merchant_memberships mm WHERE mm.id = p_membership_id),
                    (SELECT pm.identity_id FROM identity.platform_memberships pm WHERE pm.id = p_membership_id))
      INTO v_person;
    IF v_person IS NULL THEN
      RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::timestamptz, NULL::text, NULL::uuid, NULL::text, NULL::text,
                          NULL::boolean, NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::jsonb,
                          NULL::text, NULL::text;
      RETURN;
    END IF;
  END IF;

  -- The read event first (§8.2a rule 7): against the filtered business, if any.
  INSERT INTO audit.audit_events (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome, ip, user_agent, request_id, summary)
  VALUES (p_merchant_id, v_actor_identity, 'platform', v_actor, 'platform.audit_read', CASE WHEN p_merchant_id IS NOT NULL THEN 'merchant' END, p_merchant_id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id, jsonb_build_object('from', to_char(p_from, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'to', to_char(p_to, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'limit', p_limit, 'continued', p_after_id IS NOT NULL, 'merchantId', p_merchant_id::text, 'membershipId', p_membership_id::text, 'event', p_event));

  -- Then the page: one statement, no row locks. The address and device to the super admin only.
  RETURN QUERY
  SELECT 'ok', e.id, e.occurred_at, to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), e.merchant_id, e.action,
         e.outcome, e.actor_identity_id IS NOT NULL, e.actor_audience, e.actor_membership_id, i.email,
         e.target_type, e.target_id, e.summary,
         CASE WHEN v_super THEN e.ip END,
         CASE WHEN v_super THEN e.user_agent END
    FROM audit.audit_events e
    LEFT JOIN identity.identities i ON i.id = e.actor_identity_id
   WHERE e.occurred_at >= p_from AND e.occurred_at < p_to
     AND (p_merchant_id IS NULL OR e.merchant_id = p_merchant_id)
     AND (v_person IS NULL OR e.actor_identity_id = v_person)
     AND (p_event IS NULL OR e.action = p_event)
     AND (p_after_id IS NULL OR (e.occurred_at, e.id) < (p_after_at, p_after_id))
   ORDER BY e.occurred_at DESC, e.id DESC
   LIMIT p_limit + 1;
END
$function$;
REVOKE ALL ON FUNCTION audit.read_platform_events(uuid, timestamp with time zone, timestamp with time zone, integer, timestamp with time zone, uuid, uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.read_platform_events(uuid, timestamp with time zone, timestamp with time zone, integer, timestamp with time zone, uuid, uuid, uuid, text, text, text, text) TO alphakolect_app;

-- ── every read through the functions (the addendum; §8.6) ──
REVOKE SELECT ON audit.audit_events FROM alphakolect_app;
REVOKE SELECT ON audit.audit_events FROM alphakolect_readonly;
GRANT SELECT (id, occurred_at, merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type,
              target_id, outcome, request_id, summary)
  ON audit.audit_events TO alphakolect_readonly;
