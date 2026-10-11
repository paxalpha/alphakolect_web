-- P4.1: merchant lifecycle (TARGET_ARCHITECTURE ADR-15 T5, T6, T9; RESTRUCTURING_MAP P4 exit criteria 5, 10).
--
-- States: pending_verification → active (email verification, P3) ⇄ deactivated (platform super admin only).
-- A deactivated merchant is a separate gate: identities, memberships and sessions are left untouched, but no
-- member of the merchant can sign in, refresh or use an existing session (checked per request). Billing suspension
-- (P10) adds its own state then. Forward-only; P1–P3 migrations untouched.

-- ── status integrity ───────────────────────────────────────────────────────────────────────────
ALTER TABLE "tenancy"."merchants"
  ADD COLUMN "deactivated_at" TIMESTAMPTZ(6),
  ADD COLUMN "deactivation_reason" TEXT;

ALTER TABLE "tenancy"."merchants"
  ADD CONSTRAINT "merchants_status_valid"
    CHECK ("status" IN ('pending_verification', 'active', 'deactivated')),
  ADD CONSTRAINT "merchants_deactivation_consistent"
    CHECK ((("status" = 'deactivated') = ("deactivated_at" IS NOT NULL))
       AND (("status" = 'deactivated') = ("deactivation_reason" IS NOT NULL))),
  ADD CONSTRAINT "merchants_deactivation_reason_length"
    CHECK ("deactivation_reason" IS NULL OR char_length(btrim("deactivation_reason")) BETWEEN 1 AND 500);

-- ── no direct status changes or merchant creation by the app ───────────────────────────────────
-- P1 granted these before the trusted functions existed. Merchants are created by identity.signup_merchant_owner
-- and change status only through identity.verify_email and tenancy.set_merchant_status (all SECURITY DEFINER).
-- UPDATE (name, updated_at) stays for the merchant profile (P4.4), under RLS.
REVOKE INSERT ON "tenancy"."merchants" FROM alphakolect_app;
REVOKE UPDATE ("status") ON "tenancy"."merchants" FROM alphakolect_app;

-- ── a membership is usable only while its merchant is active (T5) ──────────────────────────────
-- Same signature and body as 20261003000300, plus the merchant-status join for merchant/agent memberships.
-- Every caller picks it up: create_session, rotate_refresh_token, validate_session (per request).
CREATE OR REPLACE FUNCTION "identity"."active_membership"(p_identity_id uuid, p_audience text, p_membership_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pm.id FROM identity.platform_memberships pm
   WHERE p_audience = 'platform' AND pm.id = p_membership_id AND pm.identity_id = p_identity_id AND pm.status = 'active'
  UNION ALL
  SELECT mm.id FROM tenancy.merchant_memberships mm
    JOIN tenancy.merchants m ON m.id = mm.merchant_id AND m.status = 'active'
   WHERE mm.id = p_membership_id AND mm.identity_id = p_identity_id AND mm.status = 'active'
     AND ((p_audience = 'merchant' AND mm.kind IN ('owner', 'staff')) OR (p_audience = 'agent' AND mm.kind = 'agent'))
  LIMIT 1;
$fn$;

-- Login must not offer a membership of a non-active merchant: create_session would refuse it and the API would
-- answer 500. Same signature and body as 20261003000200, plus the merchant-status join, so such a login gets the
-- generic INVALID_CREDENTIALS. (P4.2 replaces this function entirely.)
CREATE OR REPLACE FUNCTION "identity"."login_candidate"(p_email text, p_audience text)
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
        JOIN tenancy.merchants mr ON mr.id = mm.merchant_id AND mr.status = 'active'
       WHERE p_audience = 'merchant' AND mm.identity_id = i.id AND mm.kind IN ('owner', 'staff')
      UNION ALL
      SELECT mm.id, mm.kind, mm.status FROM tenancy.merchant_memberships mm
        JOIN tenancy.merchants mr ON mr.id = mm.merchant_id AND mr.status = 'active'
       WHERE p_audience = 'agent' AND mm.identity_id = i.id AND mm.kind = 'agent'
      ORDER BY 1
      LIMIT 1
    ) m ON true
   WHERE i.email = lower(btrim(p_email));
$fn$;

-- ── platform lifecycle action (T6, T9) ─────────────────────────────────────────────────────────
-- Authority comes ONLY from p_session_id: it must be a live, full-scope (MFA-completed) platform session of an
-- active super admin, as identity.validate_session sees it now. app.merchant_id (the tenant context the caller
-- sets for its audit row) is never consulted, so a tenant context can grant nothing here.
--
-- outcome: 'ok' | 'forbidden' | 'not_found' | 'invalid_transition' | 'invalid_reason'.
-- Lock order — the owner's identity row (shared), then the merchant row — matches identity.verify_email
-- (identity, then merchant), so the two cannot deadlock and a reactivation racing an email verification waits for
-- it and sees its result.
CREATE FUNCTION "tenancy"."set_merchant_status"(p_session_id uuid, p_merchant_id uuid, p_action text, p_reason text)
RETURNS TABLE (outcome text, status text, actor_identity_id uuid, actor_membership_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_actor_identity uuid;
  v_actor_membership uuid;
  v_owner_verified boolean;
  v_status text;
  v_new text;
  v_reason text := btrim(p_reason);
BEGIN
  IF p_action NOT IN ('deactivate', 'reactivate') THEN
    RAISE EXCEPTION 'unknown lifecycle action' USING ERRCODE = 'check_violation';
  END IF;

  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor_membership
    FROM identity.validate_session(p_session_id) v
    JOIN identity.platform_memberships pm ON pm.id = v.membership_id AND pm.role = 'super_admin'
   WHERE v.audience = 'platform' AND v.scope = 'full';
  IF v_actor_identity IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- The owner's verification decides where a reactivation lands (BR-2.2); lock it before the merchant row.
  SELECT i.email_verified_at IS NOT NULL INTO v_owner_verified
    FROM tenancy.merchant_memberships mm
    JOIN identity.identities i ON i.id = mm.identity_id
   WHERE mm.merchant_id = p_merchant_id AND mm.kind = 'owner'
     FOR SHARE OF i;

  SELECT m.status INTO v_status FROM tenancy.merchants m WHERE m.id = p_merchant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::text, v_actor_identity, v_actor_membership;
    RETURN;
  END IF;

  IF p_action = 'deactivate' THEN
    IF v_status NOT IN ('active', 'pending_verification') THEN
      RETURN QUERY SELECT 'invalid_transition', v_status, v_actor_identity, v_actor_membership;
      RETURN;
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
      RETURN QUERY SELECT 'invalid_reason', v_status, v_actor_identity, v_actor_membership;
      RETURN;
    END IF;
    v_new := 'deactivated';
    UPDATE tenancy.merchants
       SET status = v_new, deactivated_at = now(), deactivation_reason = v_reason, updated_at = now()
     WHERE id = p_merchant_id;
  ELSE
    IF v_status <> 'deactivated' THEN
      RETURN QUERY SELECT 'invalid_transition', v_status, v_actor_identity, v_actor_membership;
      RETURN;
    END IF;
    -- Never verifies anything: an unverified owner's business goes back to pending_verification (BR-2.2).
    v_new := CASE WHEN coalesce(v_owner_verified, false) THEN 'active' ELSE 'pending_verification' END;
    UPDATE tenancy.merchants
       SET status = v_new, deactivated_at = NULL, deactivation_reason = NULL, updated_at = now()
     WHERE id = p_merchant_id;
  END IF;

  RETURN QUERY SELECT 'ok', v_new, v_actor_identity, v_actor_membership;
END
$fn$;

REVOKE ALL ON FUNCTION "tenancy"."set_merchant_status"(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "tenancy"."set_merchant_status"(uuid, uuid, text, text) TO alphakolect_app;
