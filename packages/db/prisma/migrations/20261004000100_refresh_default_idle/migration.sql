-- P3.5b: refresh rotation may omit the idle timeout (NULL) to get the standard one for the session's audience
-- and scope (ADR-14 D5). The API cannot know a session's audience before the refresh token is looked up, and
-- the lifetimes are defined once, here, in identity.session_limits. An explicit value is still capped by it.
--
-- Same signature, so the privileges of 20261003000300 (REVOKE FROM PUBLIC, EXECUTE for alphakolect_app) stay.

CREATE OR REPLACE FUNCTION "identity"."rotate_refresh_token"(p_old_hash text, p_new_hash text, p_idle_seconds integer)
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
  v_idle_max integer;
  v_idle integer;
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
$fn$;
