-- P7, after the gate review of 2026-10-26 (docs/architecture/P7_IMPLEMENTATION_PLAN.md revision 4, §11):
--
-- - R1: a customer's app link follows their email address. Changing the address revokes an open link
--   (customers.update_customer), and a link is accepted only by the account of the customer's address now
--   (customers.accept_app_invitation).
-- - R2: deactivation holds the customer's ledger balances, as removing the details does (customers.set_customer_status),
--   so a posting to the customer either commits before it or waits and is refused (ledger.post_entry checks the
--   customer's status under the same locks).
-- Forward-only; earlier migrations untouched.

CREATE OR REPLACE FUNCTION customers.update_customer(p_session_id uuid, p_customer_id uuid, p_change jsonb, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, branch_id uuid, full_name text, phone text, email text, address text, nickname text, status text, agent_membership_id uuid, app_access boolean, created_at timestamp with time zone, updated_at timestamp with time zone, deactivated_at timestamp with time zone, anonymised_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_branches uuid[];
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_actor_branch uuid;
  v_customer customers.customers%ROWTYPE;
  v_branch uuid;
  v_phone text;
  v_fields text[];
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id, v.branch_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role, v_actor_branch
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT * FROM customers.customer_result('forbidden', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = p_customer_id AND c.merchant_id = v_merchant;
  v_branch := CASE WHEN p_change ? 'branchId' AND coalesce(p_change ->> 'branchId', '') ~ '^[0-9a-f-]{36}$'
                   THEN (p_change ->> 'branchId')::uuid ELSE v_customer.branch_id END;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  -- One array, built first: the branches are taken FOR SHARE in one sorted call.
  v_branches := ARRAY[v_customer.branch_id, v_branch, v_actor_branch];
  PERFORM tenancy.lock_branches(v_branches, NULL);
  PERFORM 1 FROM customers.customers c WHERE c.id = v_customer.id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'merchant.customers.manage') <> 'ok' THEN
    RETURN QUERY SELECT * FROM customers.customer_result('forbidden', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = v_customer.id;
  -- Another business's customer, or another branch's for a restricted actor: not found (T15, P5 §7.6).
  IF v_customer.id IS NULL
     OR (v_actor_branch IS NOT NULL AND (v_customer.branch_id <> v_actor_branch OR NOT EXISTS (
           SELECT 1 FROM tenancy.branches b WHERE b.id = v_actor_branch AND b.status = 'active'))) THEN
    RETURN QUERY SELECT * FROM customers.customer_result('not_found', NULL);
    RETURN;
  END IF;
  IF v_customer.status = 'anonymised' THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid_status', NULL);
    RETURN;
  END IF;
  IF p_change IS NULL OR jsonb_typeof(p_change) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_change) k
                 WHERE k NOT IN ('fullName', 'phone', 'email', 'address', 'nickname', 'branchId'))
     OR (SELECT count(*) FROM jsonb_object_keys(p_change)) = 0 THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid', NULL);
    RETURN;
  END IF;
  v_phone := CASE WHEN p_change ? 'phone' THEN customers.normalise_phone(p_change ->> 'phone') ELSE v_customer.phone END;
  IF v_phone IS NULL
     OR (p_change ? 'fullName' AND char_length(coalesce(btrim(p_change ->> 'fullName'), '')) NOT BETWEEN 1 AND 120)
     OR (p_change ->> 'email' IS NOT NULL
         AND lower(btrim(p_change ->> 'email')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     OR (p_change ->> 'address' IS NOT NULL AND char_length(btrim(p_change ->> 'address')) NOT BETWEEN 1 AND 300)
     OR (p_change ->> 'nickname' IS NOT NULL AND char_length(btrim(p_change ->> 'nickname')) NOT BETWEEN 1 AND 60)
     OR (p_change ? 'branchId' AND (p_change ->> 'branchId') IS DISTINCT FROM v_branch::text) THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid', NULL);
    RETURN;
  END IF;
  -- A new branch: active, and the actor's own when restricted. The customer's agent serves every branch.
  IF v_branch <> v_customer.branch_id AND (
       NOT EXISTS (SELECT 1 FROM tenancy.branches b
                    WHERE b.merchant_id = v_merchant AND b.id = v_branch AND b.status = 'active')
       OR (v_actor_branch IS NOT NULL AND v_actor_branch <> v_branch)) THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid_branch', NULL);
    RETURN;
  END IF;
  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_fields FROM jsonb_object_keys(p_change) k;
  BEGIN
    UPDATE customers.customers c
       SET full_name = CASE WHEN p_change ? 'fullName' THEN btrim(p_change ->> 'fullName') ELSE c.full_name END,
           phone = v_phone,
           email = CASE WHEN p_change ? 'email' THEN lower(btrim(p_change ->> 'email')) ELSE c.email END,
           address = CASE WHEN p_change ? 'address' THEN btrim(p_change ->> 'address') ELSE c.address END,
           nickname = CASE WHEN p_change ? 'nickname' THEN btrim(p_change ->> 'nickname') ELSE c.nickname END,
           branch_id = v_branch,
           updated_at = now()
     WHERE c.id = v_customer.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT * FROM customers.customer_result('phone_taken', NULL);
    RETURN;
  END;
  -- A link sent to the old address is no longer good once the address changes (the customer is held: its links change
  -- only under that lock).
  IF p_change ? 'email' AND lower(btrim(p_change ->> 'email')) IS DISTINCT FROM v_customer.email THEN
    UPDATE customers.app_invitations a SET revoked_at = now()
     WHERE a.customer_id = v_customer.id AND a.accepted_at IS NULL AND a.revoked_at IS NULL;
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'customer.updated', 'customer', v_customer.id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('fields', to_jsonb(v_fields), 'branchId', v_branch::text));
  RETURN QUERY SELECT * FROM customers.customer_result('ok', v_customer.id);
END
$function$;

CREATE OR REPLACE FUNCTION customers.accept_app_invitation(p_token_hash text, p_identity_id uuid, p_new_password_hash text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, customer_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_identity identity.identities%ROWTYPE;
  v_invitation customers.app_invitations%ROWTYPE;
  v_customer customers.customers%ROWTYPE;
BEGIN
  SELECT * INTO v_identity FROM identity.identities i WHERE i.id = p_identity_id FOR NO KEY UPDATE;
  SELECT * INTO v_invitation FROM customers.app_invitations a WHERE a.token_hash = p_token_hash FOR NO KEY UPDATE;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = v_invitation.customer_id FOR NO KEY UPDATE;
  IF v_identity.id IS NULL OR v_identity.status <> 'active' OR v_invitation.id IS NULL
     OR v_invitation.identity_id <> v_identity.id OR v_invitation.accepted_at IS NOT NULL
     OR v_invitation.revoked_at IS NOT NULL OR v_invitation.expires_at <= now()
     OR v_customer.status <> 'active' OR v_customer.identity_id IS NOT NULL
     -- the link's account is the customer's address now (an address changed since the link was sent is refused)
     OR v_customer.email IS DISTINCT FROM v_identity.email
     OR NOT EXISTS (SELECT 1 FROM tenancy.merchants m WHERE m.id = v_customer.merchant_id AND m.status = 'active')
     OR EXISTS (SELECT 1 FROM customers.customers c
                 WHERE c.merchant_id = v_customer.merchant_id AND c.identity_id = v_identity.id)
     -- A new person sets a password; an existing account brings its own (checked by the API) and keeps it.
     OR ((v_identity.password_hash IS NULL) <> (p_new_password_hash IS NOT NULL)) THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid;
    RETURN;
  END IF;
  IF p_new_password_hash IS NOT NULL THEN
    -- The link reached the person at this address: it verifies the email, as account setup does (T10).
    UPDATE identity.identities i
       SET password_hash = p_new_password_hash, password_changed_at = now(),
           email_verified_at = coalesce(i.email_verified_at, now()), updated_at = now()
     WHERE i.id = v_identity.id;
  END IF;
  UPDATE customers.customers c SET identity_id = v_identity.id, updated_at = now() WHERE c.id = v_customer.id;
  UPDATE customers.app_invitations a SET accepted_at = now() WHERE a.id = v_invitation.id;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_customer.merchant_id, v_identity.id, NULL, NULL, 'customer.app_access_accepted', 'customer',
          v_customer.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('path', CASE WHEN p_new_password_hash IS NULL THEN 'accept' ELSE 'setup' END));
  RETURN QUERY SELECT 'ok', v_customer.id;
END
$function$;

CREATE OR REPLACE FUNCTION customers.set_customer_status(p_session_id uuid, p_customer_id uuid, p_status text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, branch_id uuid, full_name text, phone text, email text, address text, nickname text, status text, agent_membership_id uuid, app_access boolean, created_at timestamp with time zone, updated_at timestamp with time zone, deactivated_at timestamp with time zone, anonymised_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_actor_branch uuid;
  v_customer customers.customers%ROWTYPE;
  v_accounts uuid[];
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id, v.branch_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role, v_actor_branch
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT * FROM customers.customer_result('forbidden', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = p_customer_id AND c.merchant_id = v_merchant;
  SELECT array_agg(a.id ORDER BY a.id) INTO v_accounts
    FROM ledger.accounts a
   WHERE a.merchant_id = v_merchant AND a.subject_type = 'customer' AND a.subject_id = v_customer.id;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM tenancy.lock_branches(ARRAY[v_actor_branch], NULL);
  -- The customer's balances (14), held against postings while the status changes (P7-13): a posting either commits
  -- first or waits and then sees the new status.
  PERFORM ledger.lock_projections(v_accounts, NULL);
  PERFORM 1 FROM customers.customers c WHERE c.id = v_customer.id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'merchant.customers.manage') <> 'ok' THEN
    RETURN QUERY SELECT * FROM customers.customer_result('forbidden', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = v_customer.id;
  IF v_customer.id IS NULL
     OR (v_actor_branch IS NOT NULL AND (v_customer.branch_id <> v_actor_branch OR NOT EXISTS (
           SELECT 1 FROM tenancy.branches b WHERE b.id = v_actor_branch AND b.status = 'active'))) THEN
    RETURN QUERY SELECT * FROM customers.customer_result('not_found', NULL);
    RETURN;
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'deactivated') THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid', NULL);
    RETURN;
  END IF;
  IF v_customer.status = 'anonymised' OR v_customer.status = p_status THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid_transition', NULL);
    RETURN;
  END IF;
  -- A deactivated customer's sessions fail validation from now on (P7-8); every record stays.
  UPDATE customers.customers c
     SET status = p_status, deactivated_at = CASE WHEN p_status = 'deactivated' THEN now() END, updated_at = now()
   WHERE c.id = v_customer.id;
  -- One statement per event, so each names its own catalog pair.
  IF p_status = 'deactivated' THEN
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       ip, user_agent, request_id, summary)
    VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'customer.deactivated', 'customer',
            v_customer.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id, '{}');
  ELSE
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       ip, user_agent, request_id, summary)
    VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'customer.reactivated', 'customer',
            v_customer.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id, '{}');
  END IF;
  RETURN QUERY SELECT * FROM customers.customer_result('ok', v_customer.id);
END
$function$;
