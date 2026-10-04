-- P3.7: account-setup tokens, and a password reset that no longer verifies an email address (ADR-14 clarifications
-- of 2026-10-04: "password reset ≠ email verification"; D9 bootstrap → a dedicated set-password capability).
--
-- Invariant: an email address becomes verified only through possession of a capability sent to it — the
-- verification link (identity.verify_email) or the first-password setup link (identity.complete_account_setup).
-- A password reset proves nothing about verification and changes no verification or merchant state.
--
-- The earlier functions are replaced here (same signatures, so their privileges stay); the P3 migrations are
-- untouched.

-- ── a third, explicit token purpose ─────────────────────────────────────────────────────────────
ALTER TABLE "identity"."one_time_tokens"
  DROP CONSTRAINT "one_time_tokens_purpose_valid",
  ADD CONSTRAINT "one_time_tokens_purpose_valid"
    CHECK ("purpose" IN ('email_verification', 'password_reset', 'account_setup'));

-- Issuing: account setup is capped at 24 h and exists only for identities that have never had a password
-- (the bootstrap super admin now; invited members in P4). Everything else as before.
CREATE OR REPLACE FUNCTION "identity"."issue_one_time_token"(
  p_identity_id uuid, p_purpose text, p_token_hash text, p_ttl_seconds integer, p_ip text
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_max integer := CASE p_purpose
                     WHEN 'email_verification' THEN 86400
                     WHEN 'password_reset' THEN 1800
                     WHEN 'account_setup' THEN 86400
                   END;
  v_expires timestamptz;
BEGIN
  IF v_max IS NULL THEN
    RAISE EXCEPTION 'unknown token purpose' USING ERRCODE = 'check_violation';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 1 OR p_ttl_seconds > v_max THEN
    RAISE EXCEPTION 'token lifetime out of range for %', p_purpose USING ERRCODE = 'check_violation';
  END IF;
  IF p_purpose = 'account_setup' AND EXISTS (
       SELECT 1 FROM identity.identities i WHERE i.id = p_identity_id AND i.password_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'account setup is only for identities without a password' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE identity.one_time_tokens t SET expires_at = now()
   WHERE t.identity_id = p_identity_id AND t.purpose = p_purpose
     AND t.consumed_at IS NULL AND t.expires_at > now();

  v_expires := now() + make_interval(secs => p_ttl_seconds);
  INSERT INTO identity.one_time_tokens (identity_id, purpose, token_hash, expires_at, requested_ip)
  VALUES (p_identity_id, p_purpose, p_token_hash, v_expires, p_ip);
  RETURN v_expires;
END
$fn$;

-- Reset: sets the password and revokes every session (D5). It no longer marks the email verified.
CREATE OR REPLACE FUNCTION "identity"."reset_password"(p_token_hash text, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_identity uuid := identity.consume_one_time_token('password_reset', p_token_hash);
BEGIN
  IF v_identity IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM identity.apply_new_password(v_identity, p_password_hash, 'password_reset');
  RETURN v_identity;
END
$fn$;

-- First password through the setup link: sets it and marks the email verified (the link was sent to it).
-- Refuses (token spent, NULL returned) if the identity somehow acquired a password since the link was issued.
CREATE FUNCTION "identity"."complete_account_setup"(p_token_hash text, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_identity uuid := identity.consume_one_time_token('account_setup', p_token_hash);
BEGIN
  IF v_identity IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM identity.identities i WHERE i.id = v_identity AND i.password_hash IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  PERFORM identity.apply_new_password(v_identity, p_password_hash, 'account_setup');
  UPDATE identity.identities SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
   WHERE id = v_identity;
  RETURN v_identity;
END
$fn$;

REVOKE ALL ON FUNCTION "identity"."complete_account_setup"(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "identity"."complete_account_setup"(text, text) TO alphakolect_app;
