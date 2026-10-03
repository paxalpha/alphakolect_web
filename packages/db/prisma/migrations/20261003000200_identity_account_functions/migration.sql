-- P3 account functions (ADR-14 D2, D4, D11, D12, D15). The ONLY way alphakolect_app reaches identity data:
-- SECURITY DEFINER functions owned by the migrator, with a pinned search_path, EXECUTE revoked from PUBLIC
-- and granted to the app only. Multi-step flows are single functions so the app cannot misuse the pieces.
-- Raw tokens never reach the database: callers pass SHA-256 hex hashes. Passwords arrive as argon2id hashes.

-- Resolving function names needs USAGE on the schema; table privileges stay at none (D4).
GRANT USAGE ON SCHEMA "identity" TO alphakolect_app;

-- ── signup (D2): identity + merchant + owner membership, nothing else ──────────────────────────
CREATE FUNCTION "identity"."signup_merchant_owner"(p_email text, p_password_hash text, p_merchant_name text)
RETURNS TABLE (created boolean, identity_id uuid, merchant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_email text := lower(btrim(p_email));
  v_identity uuid;
  v_merchant uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM identity.identities i WHERE i.email = v_email) THEN
    -- Not an error: the API answers exactly as for a new signup (anti-enumeration, D12).
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO identity.identities (email, password_hash) VALUES (v_email, p_password_hash)
      RETURNING id INTO v_identity;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent signup won the race for this email.
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid;
    RETURN;
  END;

  INSERT INTO tenancy.merchants (name, status) VALUES (p_merchant_name, 'pending_verification')
    RETURNING id INTO v_merchant;
  INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES (v_merchant, v_identity, 'owner');

  RETURN QUERY SELECT true, v_identity, v_merchant;
END
$fn$;

-- ── one-time tokens (email verification, password reset) ───────────────────────────────────────
-- Issuing a token supersedes earlier unused tokens of the same purpose. Lifetimes are capped here, so no
-- caller can mint a long-lived token: verification <= 24 h (D12), reset <= 30 min (§3.2).
CREATE FUNCTION "identity"."issue_one_time_token"(
  p_identity_id uuid, p_purpose text, p_token_hash text, p_ttl_seconds integer, p_ip text
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_max integer := CASE p_purpose WHEN 'email_verification' THEN 86400 WHEN 'password_reset' THEN 1800 END;
  v_expires timestamptz;
BEGIN
  IF v_max IS NULL THEN
    RAISE EXCEPTION 'unknown token purpose' USING ERRCODE = 'check_violation';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 1 OR p_ttl_seconds > v_max THEN
    RAISE EXCEPTION 'token lifetime out of range for %', p_purpose USING ERRCODE = 'check_violation';
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

-- Internal helper: consume a valid token of a purpose for an active identity; NULL if unusable for any reason.
CREATE FUNCTION "identity"."consume_one_time_token"(p_purpose text, p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_token_id uuid;
  v_identity uuid;
BEGIN
  SELECT t.id, t.identity_id INTO v_token_id, v_identity
    FROM identity.one_time_tokens t
    JOIN identity.identities i ON i.id = t.identity_id
   WHERE t.token_hash = p_token_hash AND t.purpose = p_purpose
     AND t.consumed_at IS NULL AND t.expires_at > now() AND i.status = 'active'
   FOR UPDATE OF t;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE identity.one_time_tokens SET consumed_at = now() WHERE id = v_token_id;
  RETURN v_identity;
END
$fn$;

-- ── email verification (D2, D12): token consumed, email verified, owner's merchant activated ───
CREATE FUNCTION "identity"."verify_email"(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_identity uuid := identity.consume_one_time_token('email_verification', p_token_hash);
BEGIN
  IF v_identity IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE identity.identities SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
   WHERE id = v_identity;
  -- BR-2.2: a business is real once its owner confirms the email.
  UPDATE tenancy.merchants m SET status = 'active', updated_at = now()
   WHERE m.status = 'pending_verification'
     AND m.id IN (SELECT mm.merchant_id FROM tenancy.merchant_memberships mm
                   WHERE mm.identity_id = v_identity AND mm.kind = 'owner');
  RETURN v_identity;
END
$fn$;

-- ── passwords (§3.2, D5, D15) ───────────────────────────────────────────────────────────────────
-- Setting a password (reset or change) revokes every session of the identity (ADR-14 D5).
CREATE FUNCTION "identity"."apply_new_password"(p_identity_id uuid, p_password_hash text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE identity.identities
     SET password_hash = p_password_hash, password_changed_at = now(), updated_at = now()
   WHERE id = p_identity_id;
  UPDATE identity.sessions SET revoked_at = now(), revoke_reason = p_reason
   WHERE identity_id = p_identity_id AND revoked_at IS NULL;
END
$fn$;

CREATE FUNCTION "identity"."reset_password"(p_token_hash text, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_identity uuid := identity.consume_one_time_token('password_reset', p_token_hash);
BEGIN
  IF v_identity IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM identity.apply_new_password(v_identity, p_password_hash, 'password_reset');
  -- Completing a reset proves control of the mailbox.
  UPDATE identity.identities SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = v_identity;
  RETURN v_identity;
END
$fn$;

CREATE FUNCTION "identity"."change_password"(p_identity_id uuid, p_password_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM identity.apply_new_password(p_identity_id, p_password_hash, 'password_changed');
END
$fn$;

-- Upgrade a hash after argon2 parameters change (D15): compare-and-set, no session revocation.
CREATE FUNCTION "identity"."rehash_password"(p_identity_id uuid, p_expected_hash text, p_new_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE identity.identities SET password_hash = p_new_hash, updated_at = now()
   WHERE id = p_identity_id AND password_hash = p_expected_hash;
  RETURN FOUND;
END
$fn$;

-- ── narrow reads ────────────────────────────────────────────────────────────────────────────────
-- Everything login needs for one email and audience, and nothing more. No row = unknown email.
-- membership_* are NULL when the identity has no membership for that audience.
CREATE FUNCTION "identity"."login_candidate"(p_email text, p_audience text)
RETURNS TABLE (
  identity_id uuid, identity_status text, email_verified boolean, password_hash text,
  membership_id uuid, membership_kind text, membership_status text, mfa_enrolled boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.id, i.status, i.email_verified_at IS NOT NULL, i.password_hash,
         m.id, m.kind, m.status,
         EXISTS (SELECT 1 FROM identity.totp_credentials t WHERE t.identity_id = i.id AND t.confirmed_at IS NOT NULL)
    FROM identity.identities i
    LEFT JOIN LATERAL (
      SELECT pm.id, pm.role AS kind, pm.status FROM identity.platform_memberships pm
       WHERE p_audience = 'platform' AND pm.identity_id = i.id
      UNION ALL
      SELECT mm.id, mm.kind, mm.status FROM tenancy.merchant_memberships mm
       WHERE p_audience = 'merchant' AND mm.identity_id = i.id AND mm.kind IN ('owner', 'staff')
      UNION ALL
      SELECT mm.id, mm.kind, mm.status FROM tenancy.merchant_memberships mm
       WHERE p_audience = 'agent' AND mm.identity_id = i.id AND mm.kind = 'agent'
      ORDER BY 1
      LIMIT 1
    ) m ON true
   WHERE i.email = lower(btrim(p_email));
$fn$;

-- For forgot-password and resend-verification: whether an account exists and its state. No secrets.
CREATE FUNCTION "identity"."account_for_email"(p_email text)
RETURNS TABLE (identity_id uuid, identity_status text, email_verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.id, i.status, i.email_verified_at IS NOT NULL
    FROM identity.identities i WHERE i.email = lower(btrim(p_email));
$fn$;

-- For change-password: the current hash of an identity the caller is already authenticated as.
CREATE FUNCTION "identity"."credentials_for"(p_identity_id uuid)
RETURNS TABLE (identity_status text, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.status, i.password_hash FROM identity.identities i WHERE i.id = p_identity_id;
$fn$;

-- ── privileges: nobody by default; the app may call the public entry points only ──────────────
REVOKE ALL ON FUNCTION
  "identity"."signup_merchant_owner"(text, text, text),
  "identity"."issue_one_time_token"(uuid, text, text, integer, text),
  "identity"."consume_one_time_token"(text, text),
  "identity"."verify_email"(text),
  "identity"."apply_new_password"(uuid, text, text),
  "identity"."reset_password"(text, text),
  "identity"."change_password"(uuid, text),
  "identity"."rehash_password"(uuid, text, text),
  "identity"."login_candidate"(text, text),
  "identity"."account_for_email"(text),
  "identity"."credentials_for"(uuid)
FROM PUBLIC;

-- consume_one_time_token and apply_new_password are internal building blocks: not granted.
GRANT EXECUTE ON FUNCTION
  "identity"."signup_merchant_owner"(text, text, text),
  "identity"."issue_one_time_token"(uuid, text, text, integer, text),
  "identity"."verify_email"(text),
  "identity"."reset_password"(text, text),
  "identity"."change_password"(uuid, text),
  "identity"."rehash_password"(uuid, text, text),
  "identity"."login_candidate"(text, text),
  "identity"."account_for_email"(text),
  "identity"."credentials_for"(uuid)
TO alphakolect_app;
