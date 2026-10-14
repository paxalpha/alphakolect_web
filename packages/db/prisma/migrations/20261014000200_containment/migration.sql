-- P5.5 step 6: the containment switch (P5 plan §11.1, R30; the §7.2 footprint row of
-- util.set_authorization_containment; event #39).
--
-- One row, util.authorization_containment, with two flags. While merchant_grants_suspended is set, the resolver —
-- identity.permissions_of, which the per-request resolver (identity.session_authority) and every write-time re-check
-- (tenancy.assert_authority, called by every definer writer) use — ignores every merchant grant row: staff hold no
-- merchant permission. While platform_grants_suspended is set, it ignores every platform grant row: platform staff
-- hold no platform permission. The fixed sets of the owner and the super admin are unaffected, so each business and
-- the platform stay administrable. The flags are read without a lock (no request path locks the row), so a change
-- takes effect on the next request — nothing caches authority (§4 invariant 2) — and on any write still waiting to
-- reach its re-check.
--
-- util.set_authorization_containment(merchant, platform, reason) is the only way to change them: operator-only (no
-- app grant; the operator command admin:containment uses the migrator connection), it locks the row, sets both flags
-- and records platform.authorization_containment_set (#39, pattern A, operator actor NULL, summary: both flags and the
-- reason) in the same transaction. Fail closed: if the row were missing, the resolver would treat grants as
-- suspended.
--
-- Today no grant row can be written by any app-reachable path (grant writers come in P5.6 and P5.7), so the switch is
-- in place before the first grant can exist. Forward-only; earlier migrations untouched.

CREATE TABLE util.authorization_containment (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  merchant_grants_suspended boolean NOT NULL DEFAULT false,
  platform_grants_suspended boolean NOT NULL DEFAULT false,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO util.authorization_containment (id) VALUES (true);
-- Default-deny (20260927000200): neither the app nor the reporting role is granted anything on it.

-- ── #39 ──
INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('platform.authorization_containment_set', 'success', 'atomic', 'A',
   '{"merchantGrantsSuspended": {"type": "boolean"}, "platformGrantsSuspended": {"type": "boolean"}, "reason": {"type": "string", "max": 500}}');

-- ── the switch ──
CREATE FUNCTION util.set_authorization_containment(p_merchant_grants_suspended boolean, p_platform_grants_suspended boolean, p_reason text)
 RETURNS TABLE(merchant_grants_suspended boolean, platform_grants_suspended boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_reason text := btrim(p_reason);
  v_row util.authorization_containment%ROWTYPE;
BEGIN
  IF p_merchant_grants_suspended IS NULL OR p_platform_grants_suspended IS NULL THEN
    RAISE EXCEPTION 'both flags must be given (true or false)' USING ERRCODE = 'check_violation';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'a reason (1-500 characters) is required' USING ERRCODE = 'check_violation';
  END IF;
  -- The one row (§7.2: its own footprint; no request path locks it).
  PERFORM 1 FROM util.authorization_containment c WHERE c.id = true FOR NO KEY UPDATE;
  UPDATE util.authorization_containment c
     SET merchant_grants_suspended = p_merchant_grants_suspended,
         platform_grants_suspended = p_platform_grants_suspended,
         updated_at = now()
   WHERE c.id = true
  RETURNING * INTO v_row;
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.authorization_containment_set', 'authorization_containment', NULL, 'success',
          jsonb_build_object('merchantGrantsSuspended', v_row.merchant_grants_suspended,
                             'platformGrantsSuspended', v_row.platform_grants_suspended,
                             'reason', v_reason));
  RETURN QUERY SELECT v_row.merchant_grants_suspended, v_row.platform_grants_suspended;
END
$function$;
REVOKE ALL ON FUNCTION util.set_authorization_containment(boolean, boolean, text) FROM PUBLIC;

-- ── the resolver reads the flags (same signature; the one permission rule of P5.2) ──
CREATE OR REPLACE FUNCTION identity.permissions_of(
  p_audience text, p_scope text, p_kind text, p_membership_id uuid, p_merchant_id uuid, p_role_id uuid
)
RETURNS text[]
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT coalesce(array_agg(c."identifier" ORDER BY c."identifier"), '{}'::text[])
    FROM identity.permission_catalog c
    -- The containment switch (§11.1), read without a lock; a missing row counts as suspended (fail closed).
    LEFT JOIN util.authorization_containment s ON s."id"
   WHERE c."status" = 'active'
     AND p_scope = 'full'
     AND (
       (p_audience = 'platform' AND c."scope" = 'platform' AND (
          p_kind = 'super_admin'
          OR (c."grantable" AND NOT coalesce(s."platform_grants_suspended", true) AND EXISTS (
                SELECT 1 FROM identity.platform_membership_grants g
                 WHERE g."platform_membership_id" = p_membership_id AND g."permission" = c."identifier"))))
       OR
       (p_audience = 'merchant' AND c."scope" = 'merchant' AND (
          p_kind = 'owner'
          OR (p_kind = 'staff' AND c."grantable" AND NOT coalesce(s."merchant_grants_suspended", true) AND EXISTS (
                SELECT 1 FROM tenancy.role_permissions rp
                  JOIN tenancy.roles r ON r."merchant_id" = rp."merchant_id" AND r."id" = rp."role_id"
                                      AND r."status" = 'active'
                 WHERE rp."merchant_id" = p_merchant_id AND rp."role_id" = p_role_id
                   AND rp."permission" = c."identifier"))))
     );
$fn$;
