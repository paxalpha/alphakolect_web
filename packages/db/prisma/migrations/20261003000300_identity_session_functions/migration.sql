-- P3 session functions (TARGET_ARCHITECTURE §3.2, ADR-14 D3, D5, D6, D8). SECURITY DEFINER like the account
-- functions: the app creates, rotates, validates and revokes sessions only through these.
--
-- The database itself enforces the session rules, so an API bug cannot weaken them:
--   - lifetimes are capped per audience (D5); an MFA-enrolment session is capped at 15 minutes (D8)
--   - the membership must belong to the identity, match the audience and be active; the identity active
--   - a FULL platform session requires a confirmed TOTP credential (D8, P3 exit criterion 7)
--   - presenting an already-rotated refresh token revokes the whole session (reuse detection, §3.2)

-- Maximum lifetimes in seconds per audience: (idle, absolute). ADR-14 D5.
CREATE FUNCTION "identity"."session_limits"(p_audience text, p_scope text, OUT idle_max integer, OUT absolute_max integer)
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN p_scope = 'mfa_enrollment' THEN 900
           WHEN p_audience = 'platform' THEN 3600
           WHEN p_audience = 'merchant' THEN 86400
           WHEN p_audience = 'agent' THEN 2592000
         END,
         CASE
           WHEN p_scope = 'mfa_enrollment' THEN 900
           WHEN p_audience = 'platform' THEN 43200
           WHEN p_audience = 'merchant' THEN 1209600
           WHEN p_audience = 'agent' THEN 7776000
         END;
$fn$;

-- The active membership of an identity for an audience, or NULL.
CREATE FUNCTION "identity"."active_membership"(p_identity_id uuid, p_audience text, p_membership_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pm.id FROM identity.platform_memberships pm
   WHERE p_audience = 'platform' AND pm.id = p_membership_id AND pm.identity_id = p_identity_id AND pm.status = 'active'
  UNION ALL
  SELECT mm.id FROM tenancy.merchant_memberships mm
   WHERE mm.id = p_membership_id AND mm.identity_id = p_identity_id AND mm.status = 'active'
     AND ((p_audience = 'merchant' AND mm.kind IN ('owner', 'staff')) OR (p_audience = 'agent' AND mm.kind = 'agent'))
  LIMIT 1;
$fn$;

CREATE FUNCTION "identity"."create_session"(
  p_identity_id uuid, p_audience text, p_membership_id uuid, p_scope text, p_refresh_hash text,
  p_idle_seconds integer, p_absolute_seconds integer, p_ip text, p_user_agent text
) RETURNS TABLE (session_id uuid, refresh_expires_at timestamptz, absolute_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_limits record;
  v_session uuid;
  v_absolute timestamptz;
  v_refresh timestamptz;
BEGIN
  SELECT * INTO v_limits FROM identity.session_limits(p_audience, p_scope);
  IF v_limits.idle_max IS NULL THEN
    RAISE EXCEPTION 'unsupported audience' USING ERRCODE = 'check_violation';
  END IF;
  IF p_idle_seconds < 1 OR p_idle_seconds > v_limits.idle_max
     OR p_absolute_seconds < p_idle_seconds OR p_absolute_seconds > v_limits.absolute_max THEN
    RAISE EXCEPTION 'session lifetime out of range for %', p_audience USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.identities i WHERE i.id = p_identity_id AND i.status = 'active') THEN
    RAISE EXCEPTION 'identity is not active' USING ERRCODE = 'check_violation';
  END IF;
  IF identity.active_membership(p_identity_id, p_audience, p_membership_id) IS NULL THEN
    RAISE EXCEPTION 'no active membership for this audience' USING ERRCODE = 'check_violation';
  END IF;
  IF p_audience = 'platform' AND p_scope = 'full' AND NOT EXISTS (
       SELECT 1 FROM identity.totp_credentials t WHERE t.identity_id = p_identity_id AND t.confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'platform sessions require a confirmed second factor' USING ERRCODE = 'check_violation';
  END IF;

  v_absolute := now() + make_interval(secs => p_absolute_seconds);
  v_refresh := least(now() + make_interval(secs => p_idle_seconds), v_absolute);

  INSERT INTO identity.sessions
    (identity_id, audience, platform_membership_id, merchant_membership_id, scope, absolute_expires_at, created_ip, user_agent)
  VALUES
    (p_identity_id, p_audience,
     CASE WHEN p_audience = 'platform' THEN p_membership_id END,
     CASE WHEN p_audience <> 'platform' THEN p_membership_id END,
     p_scope, v_absolute, p_ip, left(p_user_agent, 512))
  RETURNING id INTO v_session;

  INSERT INTO identity.refresh_tokens (session_id, token_hash, expires_at) VALUES (v_session, p_refresh_hash, v_refresh);

  RETURN QUERY SELECT v_session, v_refresh, v_absolute;
END
$fn$;

-- Rotate a refresh token. outcome: 'rotated' | 'invalid' | 'reuse_detected'.
-- Reuse of an already-rotated token revokes the session: both the thief's and the owner's tokens die.
CREATE FUNCTION "identity"."rotate_refresh_token"(p_old_hash text, p_new_hash text, p_idle_seconds integer)
RETURNS TABLE (
  outcome text, session_id uuid, identity_id uuid, audience text, membership_id uuid, scope text,
  refresh_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_token identity.refresh_tokens%ROWTYPE;
  v_session identity.sessions%ROWTYPE;
  v_membership uuid;
  v_refresh timestamptz;
BEGIN
  SELECT * INTO v_token FROM identity.refresh_tokens rt WHERE rt.token_hash = p_old_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_session FROM identity.sessions s WHERE s.id = v_token.session_id FOR UPDATE;

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
  IF p_idle_seconds < 1 OR p_idle_seconds > (identity.session_limits(v_session.audience, v_session.scope)).idle_max THEN
    RAISE EXCEPTION 'session lifetime out of range' USING ERRCODE = 'check_violation';
  END IF;

  v_refresh := least(now() + make_interval(secs => p_idle_seconds), v_session.absolute_expires_at);
  UPDATE identity.refresh_tokens SET rotated_at = now() WHERE id = v_token.id;
  INSERT INTO identity.refresh_tokens (session_id, token_hash, expires_at) VALUES (v_session.id, p_new_hash, v_refresh);

  RETURN QUERY SELECT 'rotated', v_session.id, v_session.identity_id, v_session.audience, v_membership, v_session.scope, v_refresh;
END
$fn$;

-- Per-request check (§3.2: token claims are hints). Returns a row only if the session is usable now.
-- merchant_id is the tenant of a merchant/agent session (for TenantContext in P4); NULL for platform.
CREATE FUNCTION "identity"."validate_session"(p_session_id uuid)
RETURNS TABLE (identity_id uuid, audience text, membership_id uuid, merchant_id uuid, scope text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.identity_id, s.audience, coalesce(s.platform_membership_id, s.merchant_membership_id), mm.merchant_id, s.scope
    FROM identity.sessions s
    JOIN identity.identities i ON i.id = s.identity_id AND i.status = 'active'
    LEFT JOIN tenancy.merchant_memberships mm ON mm.id = s.merchant_membership_id
   WHERE s.id = p_session_id
     AND s.revoked_at IS NULL
     AND s.absolute_expires_at > now()
     AND identity.active_membership(s.identity_id, s.audience, coalesce(s.platform_membership_id, s.merchant_membership_id)) IS NOT NULL;
$fn$;

CREATE FUNCTION "identity"."revoke_session"(p_session_id uuid, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE identity.sessions SET revoked_at = now(), revoke_reason = p_reason
   WHERE id = p_session_id AND revoked_at IS NULL;
  RETURN FOUND;
END
$fn$;

CREATE FUNCTION "identity"."revoke_all_sessions"(p_identity_id uuid, p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  UPDATE identity.sessions SET revoked_at = now(), revoke_reason = p_reason
   WHERE identity_id = p_identity_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION
  "identity"."session_limits"(text, text),
  "identity"."active_membership"(uuid, text, uuid),
  "identity"."create_session"(uuid, text, uuid, text, text, integer, integer, text, text),
  "identity"."rotate_refresh_token"(text, text, integer),
  "identity"."validate_session"(uuid),
  "identity"."revoke_session"(uuid, text),
  "identity"."revoke_all_sessions"(uuid, text)
FROM PUBLIC;

-- session_limits and active_membership are internal building blocks: not granted.
GRANT EXECUTE ON FUNCTION
  "identity"."create_session"(uuid, text, uuid, text, text, integer, integer, text, text),
  "identity"."rotate_refresh_token"(text, text, integer),
  "identity"."validate_session"(uuid),
  "identity"."revoke_session"(uuid, text),
  "identity"."revoke_all_sessions"(uuid, text)
TO alphakolect_app;
