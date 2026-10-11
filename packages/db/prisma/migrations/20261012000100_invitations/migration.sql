-- P4.6: staff and agent invitations (TARGET_ARCHITECTURE ADR-15 T10, T11, T13, T16; D12).
--
-- An invitation lives only in tenancy.invitations until accepted — no membership row exists before (T10). It is
-- tenant-owned (merchant_id NOT NULL, UNIQUE (merchant_id, id), composite FKs, RLS), bound to merchant, email and
-- kind (+ role and optional branch for staff) and to the identity holding that email, single use, expiring, and
-- revocable. Its token is stored only as a SHA-256 hash, and the app cannot even read that column.
--
--   tenancy.issue_invitation(session, email, kind, role, branch, token hash, setup token hash, ttl)
--       The owner (decided from the session, under the merchant lock) invites. The email's identity is created
--       passwordless if it does not exist. `delivery` tells the API which email to send — never the owner, whose
--       answer is the same either way (D12): 'setup' (no password yet: a P3 account-setup link is issued),
--       'accept' (an existing account: the invitation link, accepted with the password, T11), 'none' (a disabled
--       identity: nothing is sent). A pending invitation of the same business to the same email is superseded.
--   tenancy.revoke_invitation(session, invitation)          the owner withdraws a pending invitation
--   tenancy.accept_invitation(token hash, identity)         after the API has checked the identity's password
--   identity.complete_account_setup(token, password)        replaced: as P3, then admits the identity's invitations
--
-- Every admission goes through tenancy.admit_invitation (callable by no role), which re-checks at that moment and
-- under locks (merchant FOR SHARE, then the invitation FOR UPDATE): unused, unrevoked, unexpired; merchant active;
-- the identity the invitation was issued to, active, verified, with a password and the invitation's email; the
-- role and branch still active; not already a member. Then the membership is created and the invitation consumed,
-- together (T16: the capability never bypasses current state).
--
-- Account setup and invitations are linked through the identity, not one particular setup token: P3's
-- forgot-password flow issues a fresh setup link to a passwordless identity (expiring older ones), and that link
-- must still lead to the invitation. Completing setup therefore admits each of the identity's pending, valid
-- invitations — a passwordless identity exists only because it was invited (or bootstrapped), and every pending
-- invitation to it was delivered as a setup link. If none is valid any more, setup completes and no membership is
-- created (T10).

-- ── the table ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "tenancy"."invitations" (
    "id" UUID NOT NULL DEFAULT util.uuid_v7(),
    "merchant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "role_id" UUID,
    "branch_id" UUID,
    "identity_id" UUID NOT NULL,
    "invited_by_membership_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_membership_id" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invitations_merchant_id_id_key" ON "tenancy"."invitations"("merchant_id", "id");
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "tenancy"."invitations"("token_hash");
CREATE INDEX "invitations_identity_id_idx" ON "tenancy"."invitations"("identity_id");
-- At most one open invitation per business and email; issuing a new one supersedes (revokes) the old.
CREATE UNIQUE INDEX "invitations_one_open_per_email"
  ON "tenancy"."invitations" ("merchant_id", "email") WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

ALTER TABLE "tenancy"."invitations"
  ADD CONSTRAINT "invitations_merchant_id_fkey" FOREIGN KEY ("merchant_id")
    REFERENCES "tenancy"."merchants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "invitations_merchant_id_role_id_fkey" FOREIGN KEY ("merchant_id", "role_id")
    REFERENCES "tenancy"."roles"("merchant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "invitations_merchant_id_branch_id_fkey" FOREIGN KEY ("merchant_id", "branch_id")
    REFERENCES "tenancy"."branches"("merchant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "invitations_merchant_id_invited_by_fkey" FOREIGN KEY ("merchant_id", "invited_by_membership_id")
    REFERENCES "tenancy"."merchant_memberships"("merchant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "invitations_merchant_id_accepted_membership_fkey"
    FOREIGN KEY ("merchant_id", "accepted_membership_id")
    REFERENCES "tenancy"."merchant_memberships"("merchant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "invitations_identity_id_fkey" FOREIGN KEY ("identity_id")
    REFERENCES "identity"."identities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "invitations_kind_valid" CHECK ("kind" IN ('staff', 'agent')),
  -- As for memberships (T8): staff ⇔ a role; branch only for staff.
  ADD CONSTRAINT "invitations_staff_has_role" CHECK (("kind" = 'staff') = ("role_id" IS NOT NULL)),
  ADD CONSTRAINT "invitations_branch_only_for_staff" CHECK ("branch_id" IS NULL OR "kind" = 'staff'),
  ADD CONSTRAINT "invitations_email_normalised"
    CHECK ("email" = lower(btrim("email")) AND char_length("email") BETWEEN 3 AND 320),
  ADD CONSTRAINT "invitations_token_hash_hex" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "invitations_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "invitations_accepted_xor_revoked" CHECK ("accepted_at" IS NULL OR "revoked_at" IS NULL),
  ADD CONSTRAINT "invitations_acceptance_consistent"
    CHECK (("accepted_at" IS NULL) = ("accepted_membership_id" IS NULL));

-- ── row-level security and grants: the app reads its own tenant's invitations, never the token hash ──
ALTER TABLE "tenancy"."invitations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invitations_app_own_tenant" ON "tenancy"."invitations" FOR SELECT TO alphakolect_app
  USING ("merchant_id" = "util"."current_merchant_id"());
CREATE POLICY "invitations_readonly_all" ON "tenancy"."invitations" FOR SELECT TO alphakolect_readonly
  USING (true);
GRANT SELECT ("id", "merchant_id", "email", "kind", "role_id", "branch_id", "identity_id", "invited_by_membership_id",
              "expires_at", "accepted_at", "accepted_membership_id", "revoked_at", "created_at")
  ON "tenancy"."invitations" TO alphakolect_app, alphakolect_readonly;

-- ── admission: the one place a membership is created from an invitation (no role may call it) ────
CREATE FUNCTION "tenancy"."admit_invitation"(p_invitation_id uuid, p_identity_id uuid)
RETURNS TABLE (outcome text, membership_id uuid, merchant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_inv tenancy.invitations%ROWTYPE;
  v_membership uuid;
BEGIN
  SELECT * INTO v_inv FROM tenancy.invitations i WHERE i.id = p_invitation_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  -- Lock order as everywhere in tenancy: the merchant first, then rows under it.
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_inv.merchant_id AND m.status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'merchant_inactive', NULL::uuid, v_inv.merchant_id;
    RETURN;
  END IF;
  SELECT * INTO v_inv FROM tenancy.invitations i WHERE i.id = p_invitation_id FOR UPDATE;
  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN QUERY SELECT 'used', NULL::uuid, v_inv.merchant_id;
    RETURN;
  ELSIF v_inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked', NULL::uuid, v_inv.merchant_id;
    RETURN;
  ELSIF v_inv.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired', NULL::uuid, v_inv.merchant_id;
    RETURN;
  ELSIF v_inv.identity_id IS DISTINCT FROM p_identity_id THEN
    RETURN QUERY SELECT 'wrong_identity', NULL::uuid, v_inv.merchant_id;
    RETURN;
  END IF;

  PERFORM 1 FROM identity.identities i
   WHERE i.id = p_identity_id AND i.status = 'active' AND i.email_verified_at IS NOT NULL
     AND i.password_hash IS NOT NULL AND i.email = v_inv.email
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'identity_ineligible', NULL::uuid, v_inv.merchant_id;
    RETURN;
  END IF;

  IF v_inv.kind = 'staff' THEN
    PERFORM 1 FROM tenancy.roles r
     WHERE r.id = v_inv.role_id AND r.merchant_id = v_inv.merchant_id AND r.status = 'active' FOR SHARE;
    IF NOT FOUND OR (v_inv.branch_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM tenancy.branches b
          WHERE b.id = v_inv.branch_id AND b.merchant_id = v_inv.merchant_id AND b.status = 'active' FOR SHARE)) THEN
      RETURN QUERY SELECT 'assignment_inactive', NULL::uuid, v_inv.merchant_id;
      RETURN;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM tenancy.merchant_memberships mm
              WHERE mm.merchant_id = v_inv.merchant_id AND mm.identity_id = p_identity_id) THEN
    RETURN QUERY SELECT 'already_member', NULL::uuid, v_inv.merchant_id;
    RETURN;
  END IF;

  INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id, branch_id)
  VALUES (v_inv.merchant_id, p_identity_id, v_inv.kind, v_inv.role_id, v_inv.branch_id)
  RETURNING id INTO v_membership;
  UPDATE tenancy.invitations i SET accepted_at = now(), accepted_membership_id = v_membership
   WHERE i.id = v_inv.id;

  RETURN QUERY SELECT 'ok', v_membership, v_inv.merchant_id;
END
$fn$;

REVOKE ALL ON FUNCTION "tenancy"."admit_invitation"(uuid, uuid) FROM PUBLIC;

-- ── issue ──────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION "tenancy"."issue_invitation"(
  p_session_id uuid, p_email text, p_kind text, p_role_id uuid, p_branch_id uuid,
  p_token_hash text, p_setup_token_hash text, p_ttl_seconds integer
)
RETURNS TABLE (outcome text, invitation_id uuid, expires_at timestamptz, delivery text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_merchant uuid;
  v_inviter uuid;
  v_email text := lower(btrim(p_email));
  v_identity identity.identities%ROWTYPE;
  v_delivery text;
  v_expires timestamptz;
  v_id uuid;
BEGIN
  IF p_kind NOT IN ('staff', 'agent') THEN
    RAISE EXCEPTION 'invitations are for staff or agents' USING ERRCODE = 'check_violation';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'invitation lifetime out of range' USING ERRCODE = 'check_violation';
  END IF;

  -- The session's business; authority decided under its lock (as tenancy.update_membership).
  SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NOT NULL THEN
    PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
    SELECT v.merchant_id, v.membership_id INTO v_merchant, v_inviter FROM identity.validate_session(p_session_id) v
     WHERE v.audience = 'merchant' AND v.scope = 'full' AND v.kind = 'owner' AND v.merchant_id = v_merchant;
  END IF;
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  IF (p_kind = 'agent' AND (p_role_id IS NOT NULL OR p_branch_id IS NOT NULL))
     OR (p_kind = 'staff' AND NOT EXISTS (
           SELECT 1 FROM tenancy.roles r
            WHERE r.id = p_role_id AND r.merchant_id = v_merchant AND r.status = 'active' FOR SHARE))
     OR (p_kind = 'staff' AND p_branch_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM tenancy.branches b
            WHERE b.id = p_branch_id AND b.merchant_id = v_merchant AND b.status = 'active' FOR SHARE)) THEN
    RETURN QUERY SELECT 'invalid_assignment', NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  -- The identity of this email: created (passwordless, unverified) if there is none.
  INSERT INTO identity.identities (email) VALUES (v_email) ON CONFLICT (email) DO NOTHING;
  SELECT * INTO v_identity FROM identity.identities i WHERE i.email = v_email FOR SHARE;

  IF EXISTS (SELECT 1 FROM tenancy.merchant_memberships mm
              WHERE mm.merchant_id = v_merchant AND mm.identity_id = v_identity.id) THEN
    RETURN QUERY SELECT 'already_member', NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  v_delivery := CASE
    WHEN v_identity.status <> 'active' THEN 'none'
    WHEN v_identity.password_hash IS NULL THEN 'setup'
    ELSE 'accept'
  END;
  IF v_delivery = 'setup' THEN
    PERFORM identity.issue_one_time_token(v_identity.id, 'account_setup', p_setup_token_hash, p_ttl_seconds, NULL);
  END IF;

  UPDATE tenancy.invitations i SET revoked_at = now()
   WHERE i.merchant_id = v_merchant AND i.email = v_email AND i.accepted_at IS NULL AND i.revoked_at IS NULL;

  v_expires := now() + make_interval(secs => p_ttl_seconds);
  INSERT INTO tenancy.invitations
    (merchant_id, email, kind, role_id, branch_id, identity_id, invited_by_membership_id, token_hash, expires_at)
  VALUES (v_merchant, v_email, p_kind, p_role_id, p_branch_id, v_identity.id, v_inviter, p_token_hash, v_expires)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT 'ok', v_id, v_expires, v_delivery;
END
$fn$;

REVOKE ALL ON FUNCTION "tenancy"."issue_invitation"(uuid, text, text, uuid, uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "tenancy"."issue_invitation"(uuid, text, text, uuid, uuid, text, text, integer)
  TO alphakolect_app;

-- ── revoke ─────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION "tenancy"."revoke_invitation"(p_session_id uuid, p_invitation_id uuid)
RETURNS TABLE (outcome text, invitation_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_merchant uuid;
  v_inv tenancy.invitations%ROWTYPE;
BEGIN
  SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NOT NULL THEN
    PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
    SELECT v.merchant_id INTO v_merchant FROM identity.validate_session(p_session_id) v
     WHERE v.audience = 'merchant' AND v.scope = 'full' AND v.kind = 'owner' AND v.merchant_id = v_merchant;
  END IF;
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_inv FROM tenancy.invitations i
   WHERE i.id = p_invitation_id AND i.merchant_id = v_merchant
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid;
    RETURN;
  END IF;
  IF v_inv.accepted_at IS NOT NULL OR v_inv.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'invalid_transition', v_inv.id;
    RETURN;
  END IF;
  UPDATE tenancy.invitations i SET revoked_at = now() WHERE i.id = v_inv.id;
  RETURN QUERY SELECT 'ok', v_inv.id;
END
$fn$;

REVOKE ALL ON FUNCTION "tenancy"."revoke_invitation"(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "tenancy"."revoke_invitation"(uuid, uuid) TO alphakolect_app;

-- ── accept (existing account, T11): the API has verified the identity's password ────────────────
CREATE FUNCTION "tenancy"."accept_invitation"(p_token_hash text, p_identity_id uuid)
RETURNS TABLE (outcome text, membership_id uuid, merchant_id uuid, invitation_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  SELECT i.id INTO v_id FROM tenancy.invitations i WHERE i.token_hash = p_token_hash;
  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  RETURN QUERY SELECT a.outcome, a.membership_id, a.merchant_id, v_id
                 FROM tenancy.admit_invitation(v_id, p_identity_id) a;
END
$fn$;

REVOKE ALL ON FUNCTION "tenancy"."accept_invitation"(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "tenancy"."accept_invitation"(text, uuid) TO alphakolect_app;

-- ── account setup (replaced; same signature, so its grant stays): as P3, then the invitations ────
CREATE OR REPLACE FUNCTION "identity"."complete_account_setup"(p_token_hash text, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_identity uuid := identity.consume_one_time_token('account_setup', p_token_hash);
  v_invitation uuid;
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

  -- ADR-15 T10: the identity's pending invitations become memberships, each re-checked now (an invalid one is
  -- simply not admitted; the setup itself still completes).
  FOR v_invitation IN
    SELECT i.id FROM tenancy.invitations i
     WHERE i.identity_id = v_identity AND i.accepted_at IS NULL AND i.revoked_at IS NULL
     ORDER BY i.created_at, i.id
  LOOP
    PERFORM 1 FROM tenancy.admit_invitation(v_invitation, v_identity);
  END LOOP;
  RETURN v_identity;
END
$fn$;
