-- P4.2: login never guesses a membership (TARGET_ARCHITECTURE ADR-15 T3, T4, T16; P4 exit criterion 4).
--
-- One coherent transition: the selection-challenge table and the new login functions are introduced, and
-- identity.login_candidate — which picked the oldest membership with ORDER BY 1 LIMIT 1 — is dropped.
--
-- Exposure: identity.eligible_memberships (the list, with merchant names) is INTERNAL — not executable by the app.
-- The app gets only (a) resolve_login_membership, which returns a count, the one membership when there is exactly
-- one, and creates a selection challenge when there are several; and (b) selection_choices / take_selection, which
-- require that challenge. The app therefore cannot read anyone's merchant names without a challenge, and creates
-- challenges only after the password check (the login service; argon2 runs in the API, so that ordering is the
-- service's, tested end to end).

-- ── selection challenges ───────────────────────────────────────────────────────────────────────
CREATE TABLE "identity"."membership_selection_challenges" (
    "id" UUID NOT NULL DEFAULT util.uuid_v7(),
    "identity_id" UUID NOT NULL,
    "audience" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_selection_challenges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "membership_selection_challenges_token_hash_key"
  ON "identity"."membership_selection_challenges"("token_hash");
ALTER TABLE "identity"."membership_selection_challenges"
  ADD CONSTRAINT "membership_selection_challenges_identity_id_fkey" FOREIGN KEY ("identity_id")
    REFERENCES "identity"."identities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "membership_selection_challenges_hash_is_sha256_hex" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "membership_selection_challenges_audience_valid" CHECK ("audience" IN ('platform', 'merchant', 'agent'));
-- No grants: the app reaches this table only through the functions below (ADR-14 D4).

-- ── credentials only ───────────────────────────────────────────────────────────────────────────
CREATE FUNCTION "identity"."login_identity"(p_email text)
RETURNS TABLE (identity_id uuid, identity_status text, email_verified boolean, password_hash text, mfa_enrolled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.id, i.status, i.email_verified_at IS NOT NULL, i.password_hash,
         EXISTS (SELECT 1 FROM identity.totp_credentials t WHERE t.identity_id = i.id AND t.confirmed_at IS NOT NULL)
    FROM identity.identities i
   WHERE i.email = lower(btrim(p_email));
$fn$;

-- ── eligibility (internal) ─────────────────────────────────────────────────────────────────────
-- Memberships an active identity may sign in with for an audience, now: active, of a kind valid for the audience,
-- in an active merchant. Platform: the super admin only (platform staff arrive with P5, ADR-15 T2).
CREATE FUNCTION "identity"."eligible_memberships"(p_identity_id uuid, p_audience text)
RETURNS TABLE (membership_id uuid, merchant_id uuid, merchant_name text, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT x.membership_id, x.merchant_id, x.merchant_name, x.kind
    FROM identity.identities i
    CROSS JOIN LATERAL (
      SELECT pm.id AS membership_id, NULL::uuid AS merchant_id, NULL::text AS merchant_name, pm.role AS kind
        FROM identity.platform_memberships pm
       WHERE p_audience = 'platform' AND pm.identity_id = i.id AND pm.status = 'active' AND pm.role = 'super_admin'
      UNION ALL
      SELECT mm.id, m.id, m.name, mm.kind
        FROM tenancy.merchant_memberships mm
        JOIN tenancy.merchants m ON m.id = mm.merchant_id AND m.status = 'active'
       WHERE mm.identity_id = i.id AND mm.status = 'active'
         AND ((p_audience = 'merchant' AND mm.kind IN ('owner', 'staff')) OR (p_audience = 'agent' AND mm.kind = 'agent'))
    ) x
   WHERE i.id = p_identity_id AND i.status = 'active'
   ORDER BY x.merchant_name NULLS FIRST, x.membership_id;
$fn$;

-- ── login: how many memberships, and which one when there is exactly one ───────────────────────
-- Called by the login service only after a successful password check. Several eligible ⇒ a selection challenge
-- (5 minutes, single use) is created from p_challenge_hash and no membership is returned (T4: no guessing, no
-- session before the selection is validated).
CREATE FUNCTION "identity"."resolve_login_membership"(p_identity_id uuid, p_audience text, p_challenge_hash text)
RETURNS TABLE (eligible_count integer, membership_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_count integer;
  v_only uuid;
BEGIN
  SELECT count(*)::integer, (array_agg(e.membership_id))[1] INTO v_count, v_only
    FROM identity.eligible_memberships(p_identity_id, p_audience) e;
  IF v_count > 1 THEN
    INSERT INTO identity.membership_selection_challenges (identity_id, audience, token_hash, expires_at)
    VALUES (p_identity_id, p_audience, p_challenge_hash, now() + interval '5 minutes');
    RETURN QUERY SELECT v_count, NULL::uuid;
  ELSE
    RETURN QUERY SELECT v_count, CASE WHEN v_count = 1 THEN v_only END;
  END IF;
END
$fn$;

-- ── the choices, only to a challenge holder; does NOT consume the challenge ─────────────────────
CREATE FUNCTION "identity"."selection_choices"(p_challenge_hash text)
RETURNS TABLE (membership_id uuid, merchant_name text, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.membership_id, e.merchant_name, e.kind
    FROM identity.membership_selection_challenges c
    CROSS JOIN LATERAL identity.eligible_memberships(c.identity_id, c.audience) e
   WHERE c.token_hash = p_challenge_hash AND c.consumed_at IS NULL AND c.expires_at > now();
$fn$;

-- ── the selection: consume exactly once, then re-check (T16) ───────────────────────────────────
-- The challenge row is locked and consumed whatever the outcome (decision 2026-10-09 (b)): a choice that is no
-- longer eligible still uses it up, so the client signs in again. Concurrent takes serialise on the row lock; only
-- the first sees it unconsumed.
CREATE FUNCTION "identity"."take_selection"(p_challenge_hash text, p_membership_id uuid)
RETURNS TABLE (identity_id uuid, audience text, membership_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_challenge identity.membership_selection_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_challenge FROM identity.membership_selection_challenges c
   WHERE c.token_hash = p_challenge_hash
   FOR UPDATE;
  IF NOT FOUND OR v_challenge.consumed_at IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE identity.membership_selection_challenges SET consumed_at = now() WHERE id = v_challenge.id;
  IF v_challenge.expires_at <= now() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT v_challenge.identity_id, v_challenge.audience, e.membership_id
      FROM identity.eligible_memberships(v_challenge.identity_id, v_challenge.audience) e
     WHERE e.membership_id = p_membership_id;
END
$fn$;

-- ── the guessing function is gone ──────────────────────────────────────────────────────────────
DROP FUNCTION "identity"."login_candidate"(text, text);

-- ── privileges ─────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  "identity"."login_identity"(text),
  "identity"."eligible_memberships"(uuid, text),
  "identity"."resolve_login_membership"(uuid, text, text),
  "identity"."selection_choices"(text),
  "identity"."take_selection"(text, uuid)
FROM PUBLIC;

-- eligible_memberships is an internal building block: not granted.
GRANT EXECUTE ON FUNCTION
  "identity"."login_identity"(text),
  "identity"."resolve_login_membership"(uuid, text, text),
  "identity"."selection_choices"(text),
  "identity"."take_selection"(text, uuid)
TO alphakolect_app;
