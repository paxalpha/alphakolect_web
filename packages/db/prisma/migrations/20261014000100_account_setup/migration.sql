-- P5.5 step 5: account setup re-specified (P5 plan §7.2 R27, §7.4 CF3, §8.1 pattern A, §8.4).
--
-- 1. Admission writes its own audit row. tenancy.admit_invitation_locked — reached by tenancy.accept_invitation (the
--    invitation link, T11) and identity.complete_account_setup (the setup link, T10) — inserts one
--    auth.invitation_accepted (#14) per membership it creates, in the same transaction, with the capability-based
--    actor of §8.1: the locked invitation's identity (on the setup path also the consumed setup token's identity:
--    setup admits only that identity's invitations and admission refuses any other), no audience (no session exists),
--    the membership just created, the invitation's business, the invitation as target, summary {path, kind}. The
--    request context is recorded as given and never decides anything. The setup path wrote no #14 before (the gap of
--    §8.1 #14); the link path's row moves here from the API (P5.3a's transitional writer). Account setup's own event
--    (#10, pattern B) stays in the API around the call: the one nested pattern-A writer of the nested-writer table (R27).
-- 2. Platform and business accounts stay apart both ways (CF3, §7.4). Admission refuses an identity holding any
--    platform membership (any role, any status) on both paths, with the generic refusal of every refused acceptance;
--    the bootstrap locks an existing identity (category 6, FOR NO KEY UPDATE) and refuses one holding any merchant
--    membership. The two serialize on the identity row: admission holds it (FOR SHARE on the link path, FOR NO KEY
--    UPDATE at setup) when it checks; the bootstrap holds it FOR NO KEY UPDATE when it checks.
-- 3. The bootstrap's planned footprint: the existing identity (NKU), or a new one (a contested insert), then the
--    platform membership (a contested insert) — L3: nothing waited for after a contested insert.
--
-- Signatures: the request context is added as trailing parameters, NULL by default (direct callers need not pass it);
-- admission gains the path. Which invitations are admitted, and when, is unchanged (the P4.6 tests stay).

-- ── data guard: no identity may start out in both audiences ──
DO $guard$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM identity.platform_memberships pm
   WHERE EXISTS (SELECT 1 FROM tenancy.merchant_memberships mm WHERE mm.identity_id = pm.identity_id);
  IF v_count > 0 THEN
    RAISE EXCEPTION '% identit(y/ies) hold both a platform and a merchant membership. Platform and business accounts are kept apart (P5 plan §7.4, CF3): move one of the two memberships to a separate account before migrating.', v_count
      USING ERRCODE = 'check_violation';
  END IF;
END
$guard$;

-- ── #14's summary: the path and the invited kind (§8.1) ──
UPDATE audit.event_catalog
   SET summary_allowlist = '{"path": {"type": "string", "max": 32}, "kind": {"type": "string", "max": 16}}'
 WHERE identifier = 'auth.invitation_accepted' AND outcome = 'success';

DROP FUNCTION tenancy.accept_invitation(text, uuid);
DROP FUNCTION identity.complete_account_setup(text, text);
DROP FUNCTION tenancy.admit_invitation_locked(uuid, uuid);

-- ── admission ──
CREATE FUNCTION tenancy.admit_invitation_locked(p_invitation_id uuid, p_identity_id uuid, p_path text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, membership_id uuid, merchant_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
-- Precondition (L6): the caller holds the invitation's merchant (FOR SHARE), the invitation (FOR NO KEY UPDATE), the
-- identity (FOR SHARE or stronger) and the invitation's role and branch (FOR SHARE), acquired in the global order.
-- Each is re-asserted here with NOWAIT: immediate when held, an error (55P03, never a wait) when a caller forgot.
-- Then every rule is re-checked and, if all hold, the membership is created, the invitation consumed and the
-- acceptance recorded (pattern A, the capability-based actor of §8.1).
DECLARE
  v_merchant uuid;
  v_inv tenancy.invitations%ROWTYPE;
  v_membership uuid;
BEGIN
  SELECT i.merchant_id INTO v_merchant FROM tenancy.invitations i WHERE i.id = p_invitation_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant AND m.status = 'active' FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'merchant_inactive', NULL::uuid, v_merchant;
    RETURN;
  END IF;
  SELECT * INTO v_inv FROM tenancy.invitations i WHERE i.id = p_invitation_id FOR NO KEY UPDATE NOWAIT;
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
     FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'identity_ineligible', NULL::uuid, v_inv.merchant_id;
    RETURN;
  END IF;
  -- A platform account never joins a business (CF3): read under the identity's lock, which the bootstrap also takes.
  IF EXISTS (SELECT 1 FROM identity.platform_memberships pm WHERE pm.identity_id = p_identity_id) THEN
    RETURN QUERY SELECT 'identity_ineligible', NULL::uuid, v_inv.merchant_id;
    RETURN;
  END IF;
  IF v_inv.kind = 'staff' THEN
    PERFORM 1 FROM tenancy.roles r
     WHERE r.id = v_inv.role_id AND r.merchant_id = v_inv.merchant_id AND r.status = 'active' FOR SHARE NOWAIT;
    IF NOT FOUND OR (v_inv.branch_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM tenancy.branches b
          WHERE b.id = v_inv.branch_id AND b.merchant_id = v_inv.merchant_id AND b.status = 'active'
            FOR SHARE NOWAIT)) THEN
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
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_inv.merchant_id, v_inv.identity_id, NULL, v_membership, 'auth.invitation_accepted', 'invitation',
          v_inv.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('path', p_path, 'kind', v_inv.kind));
  RETURN QUERY SELECT 'ok', v_membership, v_inv.merchant_id;
END
$function$;

-- ── the invitation link (T11; the password is checked by the API) ──
CREATE FUNCTION tenancy.accept_invitation(p_token_hash text, p_identity_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, membership_id uuid, merchant_id uuid, invitation_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_inv tenancy.invitations%ROWTYPE;
BEGIN
  -- An unlocked lookup (§7.2), then the footprint in the global order: the merchant, the invitation, the identity, the
  -- role and the branch; admission re-checks everything under those locks, waits for nothing (L6) and records the
  -- acceptance. p_identity_id is only compared with the invitation, never recorded as the actor (§8.1).
  SELECT * INTO v_inv FROM tenancy.invitations i WHERE i.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_inv.merchant_id FOR SHARE;
  PERFORM 1 FROM tenancy.invitations i WHERE i.id = v_inv.id FOR NO KEY UPDATE;
  PERFORM 1 FROM identity.identities i WHERE i.id = p_identity_id FOR SHARE;
  IF v_inv.role_id IS NOT NULL THEN
    PERFORM 1 FROM tenancy.roles r WHERE r.id = v_inv.role_id FOR SHARE;
  END IF;
  IF v_inv.branch_id IS NOT NULL THEN
    PERFORM 1 FROM tenancy.branches b WHERE b.id = v_inv.branch_id FOR SHARE;
  END IF;
  RETURN QUERY SELECT a.outcome, a.membership_id, a.merchant_id, v_inv.id
                 FROM tenancy.admit_invitation_locked(v_inv.id, p_identity_id, 'invitation_link', p_ip, p_user_agent,
                                                      p_request_id) a;
END
$function$;

-- ── the setup link (T10) ──
CREATE FUNCTION identity.complete_account_setup(p_token_hash text, p_password_hash text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_identity uuid;
  v_invitations uuid[];
  v_invitation uuid;
BEGIN
  -- An unlocked lookup (§7.2): the token's identity and that identity's pending invitations. Then the whole footprint,
  -- in the global order and all rows of a category at its turn (L5): every invitation's merchant, the invitations, the
  -- token (re-checked under its lock), the identity, the roles and the branches.
  SELECT t.identity_id INTO v_identity FROM identity.one_time_tokens t
   WHERE t.token_hash = p_token_hash AND t.purpose = 'account_setup';
  IF v_identity IS NULL THEN
    RETURN NULL;
  END IF;
  v_invitations := ARRAY(SELECT i.id FROM tenancy.invitations i
                          WHERE i.identity_id = v_identity AND i.accepted_at IS NULL AND i.revoked_at IS NULL
                          ORDER BY i.created_at, i.id);
  PERFORM tenancy.lock_merchants(ARRAY(SELECT i.merchant_id FROM tenancy.invitations i
                                        WHERE i.id = ANY (v_invitations)), NULL);
  PERFORM tenancy.lock_invitations(NULL, v_invitations);
  -- The consumed token's identity is the actor of every admission below (§8.1): admission refuses any invitation of
  -- another identity.
  IF identity.consume_one_time_token('account_setup', p_token_hash) IS DISTINCT FROM v_identity THEN
    RETURN NULL;
  END IF;
  -- Account setup is for an identity without a password (a password set meanwhile refuses it, unchanged).
  PERFORM 1 FROM identity.identities i WHERE i.id = v_identity AND i.password_hash IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  PERFORM tenancy.lock_roles(ARRAY(SELECT i.role_id FROM tenancy.invitations i
                                    WHERE i.id = ANY (v_invitations) AND i.role_id IS NOT NULL), NULL);
  PERFORM tenancy.lock_branches(ARRAY(SELECT i.branch_id FROM tenancy.invitations i
                                       WHERE i.id = ANY (v_invitations) AND i.branch_id IS NOT NULL), NULL);
  PERFORM identity.apply_new_password(v_identity, p_password_hash, 'account_setup');
  UPDATE identity.identities SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
   WHERE id = v_identity;
  -- Each pending invitation, in the order it was issued; each one still valid is admitted (T10) and recorded (#14).
  FOREACH v_invitation IN ARRAY v_invitations LOOP
    PERFORM 1 FROM tenancy.admit_invitation_locked(v_invitation, v_identity, 'account_setup', p_ip, p_user_agent,
                                                   p_request_id);
  END LOOP;
  RETURN v_identity;
END
$function$;

-- ── the operator bootstrap, keeping the accounts apart (§7.4, rev 14) ──
CREATE OR REPLACE FUNCTION identity.bootstrap_super_admin(p_email text, p_allow_additional boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
-- Creates a passwordless identity with a super-admin membership, or gives one to an existing identity that is in no
-- audience yet. The operator CLI then issues the set-password link; the first login forces TOTP enrolment (D8, D9).
-- Not granted to alphakolect_app: only the migrator (the operator CLI) can run it.
DECLARE
  v_email text := lower(btrim(p_email));
  v_identity uuid;
BEGIN
  IF NOT p_allow_additional AND EXISTS (
       SELECT 1 FROM identity.platform_memberships pm WHERE pm.role = 'super_admin' AND pm.status = 'active') THEN
    RAISE EXCEPTION 'a super admin already exists; pass allow_additional to add another' USING ERRCODE = 'check_violation';
  END IF;

  -- An unlocked lookup; an existing identity is then locked before it is checked, so an admission of the same identity
  -- (which holds it while it checks for a platform membership) and this check serialize (§7.4).
  SELECT i.id INTO v_identity FROM identity.identities i WHERE i.email = v_email;
  IF v_identity IS NOT NULL THEN
    PERFORM 1 FROM identity.identities i WHERE i.id = v_identity FOR NO KEY UPDATE;
    IF EXISTS (SELECT 1 FROM identity.platform_memberships pm WHERE pm.identity_id = v_identity) THEN
      RAISE EXCEPTION 'this identity already has a platform membership' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM tenancy.merchant_memberships mm WHERE mm.identity_id = v_identity) THEN
      RAISE EXCEPTION 'this identity is a business account (it holds a merchant membership); platform and business accounts are kept apart — use another email'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    INSERT INTO identity.identities (email) VALUES (v_email) RETURNING id INTO v_identity;
  END IF;

  INSERT INTO identity.platform_memberships (identity_id, role) VALUES (v_identity, 'super_admin');

  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, 'platform', 'platform.super_admin_bootstrapped', 'identity', v_identity::text, 'success',
          jsonb_build_object('additional', p_allow_additional));

  RETURN v_identity;
END
$function$;

-- ── grants: the app calls the two entry points; admission and the bootstrap stay owner-only ──
REVOKE ALL ON FUNCTION tenancy.admit_invitation_locked(uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tenancy.accept_invitation(text, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.complete_account_setup(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.accept_invitation(text, uuid, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION identity.complete_account_setup(text, text, text, text, text) TO alphakolect_app;
