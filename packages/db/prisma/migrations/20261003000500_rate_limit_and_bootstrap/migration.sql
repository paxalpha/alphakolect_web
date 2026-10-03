-- P3 rate limiting (ADR-14 D13) and first-super-admin bootstrap (ADR-14 D9).

-- ── util.rate_limit_hit: fixed-window counter, atomic under concurrency ────────────────────────
-- Callers pass HASHED keys (e.g. sha256 of "login:email:<email>"), so identifiers and IPs are not stored in clear.
CREATE FUNCTION "util"."rate_limit_hit"(p_key text, p_window_seconds integer, p_max integer)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_window_start timestamptz;
  v_hits integer;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200
     OR p_window_seconds NOT BETWEEN 1 AND 86400 OR p_max NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'invalid rate limit arguments' USING ERRCODE = 'check_violation';
  END IF;

  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO util.rate_limit_counters (key, window_start, hits, expires_at)
  VALUES (p_key, v_window_start, 1, v_window_start + make_interval(secs => p_window_seconds))
  ON CONFLICT (key, window_start) DO UPDATE SET hits = util.rate_limit_counters.hits + 1
  RETURNING hits INTO v_hits;

  -- Bounded housekeeping so the table cannot grow without limit.
  DELETE FROM util.rate_limit_counters
   WHERE ctid = ANY (ARRAY(SELECT ctid FROM util.rate_limit_counters WHERE expires_at < now() LIMIT 100));

  RETURN QUERY SELECT v_hits <= p_max,
                      greatest(1, ceil(extract(epoch FROM (v_window_start + make_interval(secs => p_window_seconds)) - now()))::integer);
END
$fn$;

REVOKE ALL ON FUNCTION "util"."rate_limit_hit"(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "util"."rate_limit_hit"(text, integer, integer) TO alphakolect_app;

-- ── identity.bootstrap_super_admin: operator-only ──────────────────────────────────────────────
-- Creates (or reuses) a passwordless identity with a super-admin membership. The operator CLI then issues a
-- set-password link through the reset flow; the first login forces TOTP enrolment (D8, D9).
-- NOT granted to alphakolect_app: only the migrator (used by the operator CLI) can run it, so even a fully
-- compromised API cannot create a super admin.
CREATE FUNCTION "identity"."bootstrap_super_admin"(p_email text, p_allow_additional boolean)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_email text := lower(btrim(p_email));
  v_identity uuid;
BEGIN
  IF NOT p_allow_additional AND EXISTS (
       SELECT 1 FROM identity.platform_memberships pm WHERE pm.role = 'super_admin' AND pm.status = 'active') THEN
    RAISE EXCEPTION 'a super admin already exists; pass allow_additional to add another' USING ERRCODE = 'check_violation';
  END IF;

  SELECT i.id INTO v_identity FROM identity.identities i WHERE i.email = v_email;
  IF v_identity IS NULL THEN
    INSERT INTO identity.identities (email) VALUES (v_email) RETURNING id INTO v_identity;
  ELSIF EXISTS (SELECT 1 FROM identity.platform_memberships pm WHERE pm.identity_id = v_identity) THEN
    RAISE EXCEPTION 'this identity already has a platform membership' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO identity.platform_memberships (identity_id, role) VALUES (v_identity, 'super_admin');

  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, 'platform', 'platform.super_admin_bootstrapped', 'identity', v_identity::text, 'success',
          jsonb_build_object('additional', p_allow_additional));

  RETURN v_identity;
END
$fn$;

REVOKE ALL ON FUNCTION "identity"."bootstrap_super_admin"(text, boolean) FROM PUBLIC;
