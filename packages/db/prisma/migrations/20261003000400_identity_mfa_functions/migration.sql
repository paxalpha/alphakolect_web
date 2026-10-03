-- P3 MFA functions (ADR-14 D8). TOTP codes are computed and checked by the API (the secret is decrypted
-- there); the database provides the parts that must be atomic: replay protection of time steps, single-use
-- recovery codes, and the challenge lifetime (5 minutes) and attempt limit (5), which are fixed here.

-- The encrypted TOTP secret and its state, for the API to verify a code. Ciphertext only, never plaintext.
CREATE FUNCTION "identity"."mfa_credential"(p_identity_id uuid)
RETURNS TABLE (secret_ciphertext bytea, secret_key_id text, confirmed boolean, last_used_step bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.secret_ciphertext, t.secret_key_id, t.confirmed_at IS NOT NULL, t.last_used_step
    FROM identity.totp_credentials t WHERE t.identity_id = p_identity_id;
$fn$;

-- Start (or restart) enrolment. Refused once a factor is confirmed: replacing a confirmed factor is a later,
-- audited admin action, not something a session can do.
CREATE FUNCTION "identity"."begin_totp_enrollment"(p_identity_id uuid, p_secret_ciphertext bytea, p_secret_key_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM identity.totp_credentials t WHERE t.identity_id = p_identity_id AND t.confirmed_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  INSERT INTO identity.totp_credentials (identity_id, secret_ciphertext, secret_key_id)
  VALUES (p_identity_id, p_secret_ciphertext, p_secret_key_id)
  ON CONFLICT (identity_id) DO UPDATE
    SET secret_ciphertext = EXCLUDED.secret_ciphertext, secret_key_id = EXCLUDED.secret_key_id,
        last_used_step = NULL, created_at = now();
  RETURN true;
END
$fn$;

-- Confirm enrolment with the first valid code's time step, storing exactly 10 hashed recovery codes.
CREATE FUNCTION "identity"."confirm_totp_enrollment"(p_identity_id uuid, p_step bigint, p_recovery_code_hashes text[])
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF coalesce(array_length(p_recovery_code_hashes, 1), 0) <> 10 THEN
    RAISE EXCEPTION 'exactly 10 recovery codes are required' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE identity.totp_credentials SET confirmed_at = now(), last_used_step = p_step
   WHERE identity_id = p_identity_id AND confirmed_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM identity.recovery_codes WHERE identity_id = p_identity_id;
  INSERT INTO identity.recovery_codes (identity_id, code_hash)
  SELECT p_identity_id, h FROM unnest(p_recovery_code_hashes) AS h;
  RETURN true;
END
$fn$;

-- Accept a verified TOTP time step only if it is newer than the last one used (RFC 6238 replay protection).
CREATE FUNCTION "identity"."accept_totp_step"(p_identity_id uuid, p_step bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE identity.totp_credentials SET last_used_step = p_step
   WHERE identity_id = p_identity_id AND confirmed_at IS NOT NULL
     AND (last_used_step IS NULL OR last_used_step < p_step);
  RETURN FOUND;
END
$fn$;

CREATE FUNCTION "identity"."consume_recovery_code"(p_identity_id uuid, p_code_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE identity.recovery_codes SET used_at = now()
   WHERE identity_id = p_identity_id AND code_hash = p_code_hash AND used_at IS NULL;
  RETURN FOUND;
END
$fn$;

-- ── login challenge: password accepted, second factor pending ───────────────────────────────────
CREATE FUNCTION "identity"."create_mfa_challenge"(p_identity_id uuid, p_platform_membership_id uuid, p_token_hash text)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_expires timestamptz := now() + interval '5 minutes';
BEGIN
  IF identity.active_membership(p_identity_id, 'platform', p_platform_membership_id) IS NULL THEN
    RAISE EXCEPTION 'no active platform membership' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO identity.mfa_challenges (identity_id, platform_membership_id, token_hash, expires_at)
  VALUES (p_identity_id, p_platform_membership_id, p_token_hash, v_expires);
  RETURN v_expires;
END
$fn$;

-- Count an attempt BEFORE the code is checked. Returns the challenge's identity and membership only while it
-- is unexpired, unconsumed, within 5 attempts, and both identity and membership are still active.
CREATE FUNCTION "identity"."take_mfa_challenge_attempt"(p_token_hash text)
RETURNS TABLE (identity_id uuid, platform_membership_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_challenge identity.mfa_challenges%ROWTYPE;
BEGIN
  UPDATE identity.mfa_challenges c SET attempts = c.attempts + 1
   WHERE c.token_hash = p_token_hash AND c.consumed_at IS NULL AND c.expires_at > now() AND c.attempts < 5
  RETURNING * INTO v_challenge;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF identity.active_membership(v_challenge.identity_id, 'platform', v_challenge.platform_membership_id) IS NULL
     OR NOT EXISTS (SELECT 1 FROM identity.identities i WHERE i.id = v_challenge.identity_id AND i.status = 'active') THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT v_challenge.identity_id, v_challenge.platform_membership_id;
END
$fn$;

CREATE FUNCTION "identity"."consume_mfa_challenge"(p_token_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE identity.mfa_challenges SET consumed_at = now()
   WHERE token_hash = p_token_hash AND consumed_at IS NULL AND expires_at > now();
  RETURN FOUND;
END
$fn$;

REVOKE ALL ON FUNCTION
  "identity"."mfa_credential"(uuid),
  "identity"."begin_totp_enrollment"(uuid, bytea, text),
  "identity"."confirm_totp_enrollment"(uuid, bigint, text[]),
  "identity"."accept_totp_step"(uuid, bigint),
  "identity"."consume_recovery_code"(uuid, text),
  "identity"."create_mfa_challenge"(uuid, uuid, text),
  "identity"."take_mfa_challenge_attempt"(text),
  "identity"."consume_mfa_challenge"(text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  "identity"."mfa_credential"(uuid),
  "identity"."begin_totp_enrollment"(uuid, bytea, text),
  "identity"."confirm_totp_enrollment"(uuid, bigint, text[]),
  "identity"."accept_totp_step"(uuid, bigint),
  "identity"."consume_recovery_code"(uuid, text),
  "identity"."create_mfa_challenge"(uuid, uuid, text),
  "identity"."take_mfa_challenge_attempt"(text),
  "identity"."consume_mfa_challenge"(text)
TO alphakolect_app;
