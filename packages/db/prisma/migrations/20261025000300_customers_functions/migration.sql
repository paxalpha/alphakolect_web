-- P7: customers — the commands, the reads, the permissions and the activity events
-- (docs/architecture/P7_IMPLEMENTATION_PLAN.md §3, §4, §9.1; the owner's answers of 2026-10-25).
--
-- Every command takes the caller's session, takes its footprint (the business, the actor — the authority lock — and the
-- actor's role, then what it changes, in the global order: memberships 3, branches 8, ledger 13–14, customers 16), asks
-- tenancy.assert_authority, writes and records its activity event (pattern A). A staff member restricted to a branch
-- reaches only that branch's customers, and a restriction to an archived branch reaches none (P5 §7.6, P7-2): another
-- branch's customer is "not found". Agents act on their own customers only (P7-6). TA-14: no event carries a customer's
-- personal details — only identifiers, statuses and the names of changed fields.
-- ledger.post_entry refuses a posting to the sub-account of a customer who is not active (Q8, Q9).
-- Forward-only; earlier migrations untouched.

INSERT INTO identity.permission_catalog (identifier, scope, grantable, description) VALUES
  ('merchant.customers.read', 'merchant', true,
   'See the business''s customers, with their phone number, email, address and agent.'),
  ('merchant.customers.manage', 'merchant', true,
   'Add customers, change their details or branch, deactivate or reactivate them, and send them the link to the mobile app.'),
  ('merchant.customers.assign', 'merchant', true,
   'Give a customer to an agent, move them to another agent, or take them off their agent.'),
  ('merchant.customers.anonymise', 'merchant', false,
   'Remove a customer''s personal details at their request, once they have nothing left with the business. Owner only.');

INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('customer.created', 'success', 'atomic', 'A',
   '{"branchId": {"type": "string", "max": 36}, "agentMembershipId": {"type": "string", "max": 36, "nullable": true}, "via": {"type": "string", "max": 16}}'),
  ('customer.created', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('customer.updated', 'success', 'atomic', 'A',
   '{"fields": {"type": "string_list", "maxItems": 6, "max": 16}, "branchId": {"type": "string", "max": 36}}'),
  ('customer.updated', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('customer.deactivated', 'success', 'atomic', 'A', '{}'),
  ('customer.deactivated', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('customer.reactivated', 'success', 'atomic', 'A', '{}'),
  ('customer.reactivated', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('customer.agent_assigned', 'success', 'atomic', 'A',
   '{"agentMembershipId": {"type": "string", "max": 36, "nullable": true}, "previousAgentMembershipId": {"type": "string", "max": 36, "nullable": true}}'),
  ('customer.agent_assigned', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('customer.app_invited', 'success', 'atomic', 'A', '{"delivery": {"type": "string", "max": 16}}'),
  ('customer.app_invited', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('customer.app_access_accepted', 'success', 'atomic', 'A', '{"path": {"type": "string", "max": 16}}'),
  ('customer.app_access_accepted', 'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('customer.anonymised', 'success', 'atomic', 'A', '{}'),
  ('customer.anonymised', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}');

-- ── a command's answer: the customer it wrote (or none, with a refusal) ──
-- So that a session allowed to change customers but not to read them still gets the customer it changed. Called only by
-- the commands below, with the customer they hold.
CREATE FUNCTION customers.customer_result(p_outcome text, p_customer_id uuid)
 RETURNS TABLE(outcome text, id uuid, branch_id uuid, full_name text, phone text, email text, address text, nickname text, status text, agent_membership_id uuid, app_access boolean, created_at timestamp with time zone, updated_at timestamp with time zone, deactivated_at timestamp with time zone, anonymised_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT p_outcome, c.id, c.branch_id, c.full_name, c.phone, c.email, c.address, c.nickname, c.status,
         (SELECT a.agent_membership_id FROM customers.assignments a
           WHERE a.merchant_id = c.merchant_id AND a.customer_id = c.id AND a.ended_at IS NULL),
         c.identity_id IS NOT NULL, c.created_at, c.updated_at, c.deactivated_at, c.anonymised_at
    FROM (SELECT 1) x LEFT JOIN customers.customers c ON c.id = p_customer_id;
$function$;

-- ── onboarding, after the caller's own authority: the customer, the agent's assignment, the ledger sub-accounts ──
-- Called only by customers.create_customer and customers.agent_create_customer, which hold the business, the actor
-- and the branch. Outcomes: 'ok', 'invalid', 'phone_taken'.
CREATE FUNCTION customers.insert_customer_locked(p_merchant_id uuid, p_branch_id uuid, p_full_name text, p_phone text, p_email text, p_address text, p_nickname text, p_agent_membership_id uuid, p_actor_identity_id uuid, p_actor_membership_id uuid, p_actor_audience text, p_ip text, p_user_agent text, p_request_id text)
 RETURNS TABLE(outcome text, id uuid, branch_id uuid, full_name text, phone text, email text, address text, nickname text, status text, agent_membership_id uuid, app_access boolean, created_at timestamp with time zone, updated_at timestamp with time zone, deactivated_at timestamp with time zone, anonymised_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_phone text := customers.normalise_phone(p_phone);
  v_id uuid;
  v_ledger uuid;
  v_code text;
BEGIN
  IF v_phone IS NULL OR char_length(coalesce(btrim(p_full_name), '')) NOT BETWEEN 1 AND 120
     OR (p_email IS NOT NULL AND lower(btrim(p_email)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     OR (p_address IS NOT NULL AND char_length(btrim(p_address)) NOT BETWEEN 1 AND 300)
     OR (p_nickname IS NOT NULL AND char_length(btrim(p_nickname)) NOT BETWEEN 1 AND 60) THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid', NULL);
    RETURN;
  END IF;
  -- The contested inserts last (L3): the phone number is unique among the business's customers (Q2).
  BEGIN
    INSERT INTO customers.customers
      (merchant_id, branch_id, full_name, phone, email, address, nickname, created_by_membership_id)
    VALUES (p_merchant_id, p_branch_id, btrim(p_full_name), v_phone, lower(btrim(p_email)), btrim(p_address),
            btrim(p_nickname), p_actor_membership_id)
    RETURNING customers.customers.id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT * FROM customers.customer_result('phone_taken', NULL);
    RETURN;
  END;
  IF p_agent_membership_id IS NOT NULL THEN
    INSERT INTO customers.assignments (merchant_id, customer_id, agent_membership_id, assigned_by_membership_id)
    VALUES (p_merchant_id, v_id, p_agent_membership_id, p_actor_membership_id);
  END IF;
  -- P7-3: the customer's ledger sub-accounts, from day one.
  SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = p_merchant_id;
  FOREACH v_code IN ARRAY ARRAY['1300', '2100', '2110', '2120'] LOOP
    PERFORM ledger.open_subaccount(v_ledger, v_code, 'customer', v_id);
  END LOOP;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (p_merchant_id, p_actor_identity_id, p_actor_audience, p_actor_membership_id, 'customer.created', 'customer',
          v_id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('branchId', p_branch_id::text, 'agentMembershipId', p_agent_membership_id::text,
                             'via', p_actor_audience));
  RETURN QUERY SELECT * FROM customers.customer_result('ok', v_id);
END
$function$;

-- ── onboarding by the business (Q4): merchant.customers.manage, within the actor's branch ──
-- Outcomes: 'ok', 'forbidden', 'invalid', 'invalid_branch', 'invalid_agent', 'phone_taken'.
CREATE FUNCTION customers.create_customer(p_session_id uuid, p_branch_id uuid, p_full_name text, p_phone text, p_email text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_nickname text DEFAULT NULL::text, p_agent_membership_id uuid DEFAULT NULL::uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id, v.branch_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role, v_actor_branch
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT * FROM customers.customer_result('forbidden', NULL);
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(ARRAY[p_agent_membership_id], ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  -- One array, built first: the branches are taken FOR SHARE in one sorted call.
  v_branches := ARRAY[p_branch_id, v_actor_branch];
  PERFORM tenancy.lock_branches(v_branches, NULL);
  IF tenancy.assert_authority(p_session_id, 'merchant.customers.manage') <> 'ok' THEN
    RETURN QUERY SELECT * FROM customers.customer_result('forbidden', NULL);
    RETURN;
  END IF;
  -- An active branch of the business; the actor's own when the actor is restricted to one (P5 §7.6).
  IF NOT EXISTS (SELECT 1 FROM tenancy.branches b
                  WHERE b.merchant_id = v_merchant AND b.id = p_branch_id AND b.status = 'active')
     OR (v_actor_branch IS NOT NULL AND v_actor_branch <> p_branch_id) THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid_branch', NULL);
    RETURN;
  END IF;
  -- An active agent of the business (Q5). Agents serve every branch (P4: a branch restriction is for staff only).
  IF p_agent_membership_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM tenancy.merchant_memberships mm
        WHERE mm.merchant_id = v_merchant AND mm.id = p_agent_membership_id AND mm.kind = 'agent'
          AND mm.status = 'active') THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid_agent', NULL);
    RETURN;
  END IF;
  RETURN QUERY
    SELECT r.*
      FROM customers.insert_customer_locked(v_merchant, p_branch_id, p_full_name, p_phone, p_email, p_address,
                                            p_nickname, p_agent_membership_id, v_actor_identity, v_actor, 'merchant',
                                            p_ip, p_user_agent, p_request_id) r;
END
$function$;

-- ── onboarding by an agent (Q4, P7-6): the customer is the agent's ──
-- Outcomes: 'ok', 'forbidden', 'invalid', 'invalid_branch', 'phone_taken'.
CREATE FUNCTION customers.agent_create_customer(p_session_id uuid, p_branch_id uuid, p_full_name text, p_phone text, p_email text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_nickname text DEFAULT NULL::text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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
  v_actor_branch uuid;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.branch_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_branch
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'agent' AND v.kind = 'agent';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT * FROM customers.customer_result('forbidden', NULL);
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  -- One array, built first: the branches are taken FOR SHARE in one sorted call.
  v_branches := ARRAY[p_branch_id, v_actor_branch];
  PERFORM tenancy.lock_branches(v_branches, NULL);
  -- The agent, again under its lock: active, of an active business. Agents serve every branch (P4).
  IF identity.active_membership(v_actor_identity, 'agent', v_actor) IS NULL THEN
    RETURN QUERY SELECT * FROM customers.customer_result('forbidden', NULL);
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenancy.branches b
                  WHERE b.merchant_id = v_merchant AND b.id = p_branch_id AND b.status = 'active')
     OR (v_actor_branch IS NOT NULL AND v_actor_branch <> p_branch_id) THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid_branch', NULL);
    RETURN;
  END IF;
  RETURN QUERY
    SELECT r.*
      FROM customers.insert_customer_locked(v_merchant, p_branch_id, p_full_name, p_phone, p_email, p_address,
                                            p_nickname, v_actor, v_actor_identity, v_actor, 'agent', p_ip,
                                            p_user_agent, p_request_id) r;
END
$function$;

-- ── a customer's details and branch ──
-- p_change: an object of the fields to change — fullName, phone, email, address, nickname (null clears the three
-- optional ones), branchId. Outcomes: 'ok', 'forbidden', 'not_found', 'invalid', 'invalid_branch', 'phone_taken',
-- 'invalid_status' (an anonymised customer has no details to change).
CREATE FUNCTION customers.update_customer(p_session_id uuid, p_customer_id uuid, p_change jsonb, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'customer.updated', 'customer', v_customer.id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('fields', to_jsonb(v_fields), 'branchId', v_branch::text));
  RETURN QUERY SELECT * FROM customers.customer_result('ok', v_customer.id);
END
$function$;

-- ── deactivation and reactivation (Q8) ──
-- Outcomes: 'ok', 'forbidden', 'not_found', 'invalid', 'invalid_transition'.
CREATE FUNCTION customers.set_customer_status(p_session_id uuid, p_customer_id uuid, p_status text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id, v.branch_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role, v_actor_branch
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT * FROM customers.customer_result('forbidden', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = p_customer_id AND c.merchant_id = v_merchant;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM tenancy.lock_branches(ARRAY[v_actor_branch], NULL);
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

-- ── agent assignment (D1, Q5): the open period ended, a new one opened; every move recorded ──
-- p_agent_membership_id NULL takes the customer off their agent. Outcomes: 'ok', 'forbidden', 'not_found',
-- 'invalid_agent', 'invalid_status'.
CREATE FUNCTION customers.assign_agent(p_session_id uuid, p_customer_id uuid, p_agent_membership_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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
  v_previous uuid;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id, v.branch_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role, v_actor_branch
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT * FROM customers.customer_result('forbidden', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = p_customer_id AND c.merchant_id = v_merchant;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(ARRAY[p_agent_membership_id], ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM tenancy.lock_branches(ARRAY[v_actor_branch], NULL);
  PERFORM 1 FROM customers.customers c WHERE c.id = v_customer.id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'merchant.customers.assign') <> 'ok' THEN
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
  IF v_customer.status <> 'active' THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid_status', NULL);
    RETURN;
  END IF;
  IF p_agent_membership_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM tenancy.merchant_memberships mm
        WHERE mm.merchant_id = v_merchant AND mm.id = p_agent_membership_id AND mm.kind = 'agent'
          AND mm.status = 'active') THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid_agent', NULL);
    RETURN;
  END IF;
  SELECT a.agent_membership_id INTO v_previous
    FROM customers.assignments a WHERE a.customer_id = v_customer.id AND a.ended_at IS NULL;
  -- The same agent again changes nothing and records nothing.
  IF v_previous IS NOT DISTINCT FROM p_agent_membership_id THEN
    RETURN QUERY SELECT * FROM customers.customer_result('ok', v_customer.id);
    RETURN;
  END IF;
  -- The customer is held (NKU): its assignment rows change only here, under that lock.
  UPDATE customers.assignments a SET ended_at = now(), ended_by_membership_id = v_actor
   WHERE a.customer_id = v_customer.id AND a.ended_at IS NULL;
  IF p_agent_membership_id IS NOT NULL THEN
    INSERT INTO customers.assignments (merchant_id, customer_id, agent_membership_id, assigned_by_membership_id)
    VALUES (v_merchant, v_customer.id, p_agent_membership_id, v_actor);
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'customer.agent_assigned', 'customer',
          v_customer.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('agentMembershipId', p_agent_membership_id::text,
                             'previousAgentMembershipId', v_previous::text));
  RETURN QUERY SELECT * FROM customers.customer_result('ok', v_customer.id);
END
$function$;

-- ── the app link (Q7, P7-9) ──
-- For an active customer with an email and no sign-in yet: the person's identity (created, without a password, for a
-- new email), and the link, replacing an open one. Outcomes: 'ok', 'forbidden', 'not_found', 'no_email',
-- 'invalid_status', 'already_linked', 'email_in_use' (another customer of the business signs in with it). Delivery:
-- 'setup' (a new person sets a password), 'accept' (an existing account confirms with its password), 'none' (a
-- disabled account: nothing is sent, and the issuer is not told why — D12).
CREATE FUNCTION customers.issue_app_invitation(p_session_id uuid, p_customer_id uuid, p_token_hash text, p_ttl_seconds integer, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, delivery text, email text, merchant_name text)
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
  v_identity identity.identities%ROWTYPE;
  v_delivery text;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id, v.branch_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role, v_actor_branch
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = p_customer_id AND c.merchant_id = v_merchant;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM tenancy.lock_branches(ARRAY[v_actor_branch], NULL);
  PERFORM 1 FROM customers.customers c WHERE c.id = v_customer.id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'merchant.customers.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = v_customer.id;
  IF v_customer.id IS NULL
     OR (v_actor_branch IS NOT NULL AND (v_customer.branch_id <> v_actor_branch OR NOT EXISTS (
           SELECT 1 FROM tenancy.branches b WHERE b.id = v_actor_branch AND b.status = 'active'))) THEN
    RETURN QUERY SELECT 'not_found', NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_customer.status <> 'active' THEN
    RETURN QUERY SELECT 'invalid_status', NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_customer.identity_id IS NOT NULL THEN
    RETURN QUERY SELECT 'already_linked', NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_customer.email IS NULL THEN
    RETURN QUERY SELECT 'no_email', NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_identity FROM identity.identities i WHERE i.email = v_customer.email;
  IF v_identity.id IS NOT NULL AND EXISTS (
       SELECT 1 FROM customers.customers c
        WHERE c.merchant_id = v_merchant AND c.identity_id = v_identity.id AND c.id <> v_customer.id) THEN
    RETURN QUERY SELECT 'email_in_use', NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  -- The customer is held (NKU): its invitations change only here and at acceptance, under that lock.
  UPDATE customers.app_invitations a SET revoked_at = now()
   WHERE a.customer_id = v_customer.id AND a.accepted_at IS NULL AND a.revoked_at IS NULL;
  -- The contested inserts last (L3): a new identity, then the link.
  IF v_identity.id IS NULL THEN
    INSERT INTO identity.identities (email) VALUES (v_customer.email) ON CONFLICT DO NOTHING
    RETURNING * INTO v_identity;
    IF v_identity.id IS NULL THEN
      -- Created by another transaction since the lookup: read it (a lock may not follow a contested insert).
      SELECT * INTO v_identity FROM identity.identities i WHERE i.email = v_customer.email;
    END IF;
  END IF;
  v_delivery := CASE WHEN v_identity.status <> 'active' THEN 'none'
                     WHEN v_identity.password_hash IS NULL THEN 'setup'
                     ELSE 'accept' END;
  INSERT INTO customers.app_invitations (merchant_id, customer_id, identity_id, token_hash, expires_at)
  VALUES (v_merchant, v_customer.id, v_identity.id, p_token_hash, now() + make_interval(secs => p_ttl_seconds));
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'customer.app_invited', 'customer', v_customer.id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id, jsonb_build_object('delivery', v_delivery));
  RETURN QUERY SELECT 'ok', v_delivery, v_customer.email,
                      (SELECT m.name FROM tenancy.merchants m WHERE m.id = v_merchant);
END
$function$;

-- ── accepting the app link (Q7) ──
-- By the link's own identity: a new person with the password they choose (p_new_password_hash, the API's argon2id);
-- an existing account with its password, which the API has checked (p_new_password_hash NULL). Outcomes: 'ok',
-- 'invalid' (an unknown, used, revoked or expired link; another identity; the wrong path for the account; a customer
-- no longer active or already signed in).
CREATE FUNCTION customers.accept_app_invitation(p_token_hash text, p_identity_id uuid, p_new_password_hash text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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

-- ── removing a customer's personal details (BR-11.3, Q9): the owner only, once nothing is left ──
-- Holds the customer's sub-accounts' balances (14) before the customer (16, P7-11), so no posting changes them
-- meanwhile. Outcomes: 'ok', 'forbidden', 'not_found', 'invalid_status' (already removed), 'balance_not_zero'.
CREATE FUNCTION customers.anonymise_customer(p_session_id uuid, p_customer_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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
  v_customer customers.customers%ROWTYPE;
  v_accounts uuid[];
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role
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
  PERFORM ledger.lock_projections(v_accounts, NULL);
  PERFORM 1 FROM customers.customers c WHERE c.id = v_customer.id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'merchant.customers.anonymise') <> 'ok' THEN
    RETURN QUERY SELECT * FROM customers.customer_result('forbidden', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = v_customer.id;
  IF v_customer.id IS NULL THEN
    RETURN QUERY SELECT * FROM customers.customer_result('not_found', NULL);
    RETURN;
  END IF;
  IF v_customer.status = 'anonymised' THEN
    RETURN QUERY SELECT * FROM customers.customer_result('invalid_status', NULL);
    RETURN;
  END IF;
  -- Nothing left with the business: no savings to pay out, no loan still owed (Q9).
  IF EXISTS (SELECT 1 FROM ledger.balance_projection p WHERE p.account_id = ANY (v_accounts) AND p.balance_minor <> 0)
  THEN
    RETURN QUERY SELECT * FROM customers.customer_result('balance_not_zero', NULL);
    RETURN;
  END IF;
  -- Irreversible: the details and the sign-in go; the record, its ids and every money row stay (BR-11.1). Its
  -- sessions fail validation from now on (P7-8).
  UPDATE customers.customers c
     SET full_name = 'Removed customer', phone = NULL, email = NULL, address = NULL, nickname = NULL,
         identity_id = NULL, status = 'anonymised', deactivated_at = NULL, anonymised_at = now(), updated_at = now()
   WHERE c.id = v_customer.id;
  UPDATE customers.assignments a SET ended_at = now(), ended_by_membership_id = v_actor
   WHERE a.customer_id = v_customer.id AND a.ended_at IS NULL;
  UPDATE customers.app_invitations a SET revoked_at = now()
   WHERE a.customer_id = v_customer.id AND a.accepted_at IS NULL AND a.revoked_at IS NULL;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'customer.anonymised', 'customer', v_customer.id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id, '{}');
  RETURN QUERY SELECT * FROM customers.customer_result('ok', v_customer.id);
END
$function$;

-- ── reads (B1, R19): the business from the session; a restricted staff member's branch only ──
-- One customer, or a page of them, oldest first by (created_at, id); filtered by a search over the name and the phone
-- number, a branch and a status. One row more than the page tells whether another follows.
CREATE FUNCTION customers.list_customers(p_session_id uuid, p_customer_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, branch_id uuid, full_name text, phone text, email text, address text, nickname text, status text, agent_membership_id uuid, app_access boolean, created_at timestamp with time zone, updated_at timestamp with time zone, deactivated_at timestamp with time zone, anonymised_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_pattern text := CASE WHEN nullif(btrim(p_search), '') IS NULL THEN NULL
                         ELSE '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' END;
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '');
BEGIN
  IF p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100) THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT c.id, c.branch_id, c.full_name, c.phone, c.email, c.address, c.nickname, c.status,
         (SELECT x.agent_membership_id FROM customers.assignments x
           WHERE x.merchant_id = s.merchant_id AND x.customer_id = c.id AND x.ended_at IS NULL),
         c.identity_id IS NOT NULL, c.created_at, c.updated_at, c.deactivated_at, c.anonymised_at
    FROM identity.session_authority(p_session_id) s
    JOIN customers.customers c ON c.merchant_id = s.merchant_id
   WHERE s.audience = 'merchant' AND 'merchant.customers.read' = ANY (s.permissions)
     AND (s.branch_id IS NULL OR (c.branch_id = s.branch_id AND s.branch_status = 'active'))
     AND (p_customer_id IS NULL OR c.id = p_customer_id)
     AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
     AND (p_status IS NULL OR c.status = p_status)
     AND (v_pattern IS NULL OR c.full_name ILIKE v_pattern OR c.nickname ILIKE v_pattern
          OR (v_digits IS NOT NULL AND c.phone LIKE '%' || v_digits || '%'))
     AND (p_after_id IS NULL OR (c.created_at, c.id) > (p_after_created_at, p_after_id))
   ORDER BY c.created_at, c.id
   LIMIT p_limit + 1;
END
$function$;

-- The branch of one of the business's customers, for the API's branch-scope decision before the call (P5 §7.6); the
-- command and read functions decide again. Any member of the business may ask; it reveals nothing else.
CREATE FUNCTION customers.branch_of(p_session_id uuid, p_customer_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT c.branch_id
    FROM identity.session_authority(p_session_id) s
    JOIN customers.customers c ON c.merchant_id = s.merchant_id AND c.id = p_customer_id
   WHERE s.audience = 'merchant';
$function$;

-- A customer's assignment history, newest first (D1).
CREATE FUNCTION customers.list_assignments(p_session_id uuid, p_customer_id uuid)
 RETURNS TABLE(id uuid, agent_membership_id uuid, assigned_at timestamp with time zone, ended_at timestamp with time zone, assigned_by_membership_id uuid, ended_by_membership_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT a.id, a.agent_membership_id, a.assigned_at, a.ended_at, a.assigned_by_membership_id, a.ended_by_membership_id
    FROM identity.session_authority(p_session_id) s
    JOIN customers.customers c ON c.merchant_id = s.merchant_id AND c.id = p_customer_id
    JOIN customers.assignments a ON a.merchant_id = s.merchant_id AND a.customer_id = c.id
   WHERE s.audience = 'merchant' AND 'merchant.customers.read' = ANY (s.permissions)
     AND (s.branch_id IS NULL OR (c.branch_id = s.branch_id AND s.branch_status = 'active'))
   ORDER BY a.assigned_at DESC, a.id DESC;
$function$;

-- An agent's own customers (P7-6): those assigned to them now, active or deactivated, oldest first; or one of them.
CREATE FUNCTION customers.agent_customers(p_session_id uuid, p_customer_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, branch_id uuid, full_name text, phone text, email text, address text, nickname text, status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_pattern text := CASE WHEN nullif(btrim(p_search), '') IS NULL THEN NULL
                         ELSE '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' END;
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '');
BEGIN
  IF p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100) THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT c.id, c.branch_id, c.full_name, c.phone, c.email, c.address, c.nickname, c.status, c.created_at
    FROM identity.session_authority(p_session_id) s
    JOIN customers.assignments a ON a.merchant_id = s.merchant_id AND a.agent_membership_id = s.membership_id
                                AND a.ended_at IS NULL
    JOIN customers.customers c ON c.merchant_id = s.merchant_id AND c.id = a.customer_id
   WHERE s.audience = 'agent' AND s.kind = 'agent'
     AND c.status <> 'anonymised'
     AND (p_customer_id IS NULL OR c.id = p_customer_id)
     AND (v_pattern IS NULL OR c.full_name ILIKE v_pattern OR c.nickname ILIKE v_pattern
          OR (v_digits IS NOT NULL AND c.phone LIKE '%' || v_digits || '%'))
     AND (p_after_id IS NULL OR (c.created_at, c.id) > (p_after_created_at, p_after_id))
   ORDER BY c.created_at, c.id
   LIMIT p_limit + 1;
END
$function$;

-- The signed-in customer's own record and business (the customer audience).
CREATE FUNCTION customers.read_self(p_session_id uuid)
 RETURNS TABLE(customer_id uuid, merchant_id uuid, merchant_name text, branch_id uuid, full_name text, phone text, email text, address text, nickname text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT c.id, c.merchant_id, m.name, c.branch_id, c.full_name, c.phone, c.email, c.address, c.nickname
    FROM identity.validate_session(p_session_id) s
    JOIN customers.customers c ON c.merchant_id = s.merchant_id AND c.id = s.membership_id
    JOIN tenancy.merchants m ON m.id = s.merchant_id
   WHERE s.audience = 'customer';
$function$;

-- The agent a customer has now, for P8's rule that agents record collections only for their own customers (D1).
CREATE FUNCTION customers.current_agent(p_merchant_id uuid, p_customer_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT a.agent_membership_id
    FROM customers.assignments a
   WHERE a.merchant_id = p_merchant_id AND a.customer_id = p_customer_id AND a.ended_at IS NULL;
$function$;

-- ── the posting function: nothing is posted for a customer who is not active (owner Q8, Q9) ──
CREATE OR REPLACE FUNCTION ledger.post_entry(p_ledger_id uuid, p_idempotency_key text, p_entry_type text, p_effective_date date, p_narrative text, p_source_type text, p_source_id text, p_lines jsonb, p_actor_identity_id uuid, p_actor_membership_id uuid, p_reverses_entry_id uuid DEFAULT NULL::uuid, p_template_version integer DEFAULT NULL::integer)
 RETURNS TABLE(outcome text, entry_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_ledger ledger.ledgers%ROWTYPE;
  v_accounts uuid[];
  v_entry uuid;
  v_same boolean;
  v_constraint text;
BEGIN
  SELECT * INTO v_ledger FROM ledger.ledgers l WHERE l.id = p_ledger_id;
  IF v_ledger.id IS NULL THEN
    RETURN QUERY SELECT 'unknown_ledger', NULL::uuid;
    RETURN;
  END IF;

  -- The lines' shape: 2 to 200 objects, each an account id, a side and a positive amount in kobo; debits = credits.
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 2 AND 200
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
                 WHERE jsonb_typeof(x) <> 'object'
                    OR coalesce(x ->> 'accountId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    OR coalesce(x ->> 'side', '') NOT IN ('debit', 'credit')
                    OR coalesce(x ->> 'amountMinor', '') !~ '^[1-9][0-9]{0,17}$')
     OR p_idempotency_key IS NULL OR p_entry_type IS NULL OR p_effective_date IS NULL
     OR coalesce(btrim(p_narrative), '') = '' THEN
    RETURN QUERY SELECT 'invalid_lines', NULL::uuid;
    RETURN;
  END IF;
  IF (SELECT sum((x ->> 'amountMinor')::numeric) FILTER (WHERE x ->> 'side' = 'debit')
        IS DISTINCT FROM sum((x ->> 'amountMinor')::numeric) FILTER (WHERE x ->> 'side' = 'credit')
        FROM jsonb_array_elements(p_lines) x) THEN
    RETURN QUERY SELECT 'unbalanced', NULL::uuid;
    RETURN;
  END IF;

  -- Every account of this ledger, active, and not a control account (whose balance lives in its sub-accounts).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
               LEFT JOIN ledger.accounts a ON a.id = (x ->> 'accountId')::uuid AND a.ledger_id = p_ledger_id
              WHERE a.id IS NULL) THEN
    RETURN QUERY SELECT 'unknown_account', NULL::uuid;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
               JOIN ledger.accounts a ON a.id = (x ->> 'accountId')::uuid
              WHERE a.status <> 'active') THEN
    RETURN QUERY SELECT 'inactive_account', NULL::uuid;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
               JOIN ledger.accounts a ON a.id = (x ->> 'accountId')::uuid
               JOIN ledger.chart_template t ON t.ledger_kind = v_ledger.owner_kind AND t.code = a.code
              WHERE a.is_system AND a.subject_type IS NULL AND t.subject_type IS NOT NULL) THEN
    RETURN QUERY SELECT 'control_account', NULL::uuid;
    RETURN;
  END IF;

  -- TA-7: the lines' projections, in ascending account id.
  SELECT array_agg(DISTINCT (x ->> 'accountId')::uuid ORDER BY (x ->> 'accountId')::uuid) INTO v_accounts
    FROM jsonb_array_elements(p_lines) x;
  PERFORM ledger.lock_projections(NULL, v_accounts);
  -- Again under the locks: an account archived while this posting waited (ledger.update_account holds the
  -- projection while it archives) is refused, not posted to.
  IF EXISTS (SELECT 1 FROM ledger.accounts a WHERE a.id = ANY (v_accounts) AND a.status <> 'active') THEN
    RETURN QUERY SELECT 'inactive_account', NULL::uuid;
    RETURN;
  END IF;
  -- P7 (owner Q8, Q9): nothing new is recorded for a customer who is deactivated or whose details were removed — read
  -- under the same locks, which removing the details also takes.
  IF EXISTS (SELECT 1 FROM ledger.accounts a
               JOIN customers.customers c ON c.merchant_id = a.merchant_id AND c.id = a.subject_id
              WHERE a.id = ANY (v_accounts) AND a.subject_type = 'customer' AND c.status <> 'active') THEN
    RETURN QUERY SELECT 'inactive_account', NULL::uuid;
    RETURN;
  END IF;

  -- A replay: the key was used in this ledger. The same lines (and reversal) return the entry; others are refused.
  SELECT e.id INTO v_entry FROM ledger.journal_entries e
   WHERE e.ledger_id = p_ledger_id AND e.idempotency_key = p_idempotency_key;
  IF v_entry IS NOT NULL THEN
    SELECT (SELECT array_agg(s ORDER BY s) FROM (SELECT l.account_id::text || ':' || l.side || ':' || l.amount_minor::text AS s
                                                   FROM ledger.journal_lines l WHERE l.entry_id = v_entry) a)
           = (SELECT array_agg(s ORDER BY s) FROM (SELECT (x ->> 'accountId') || ':' || (x ->> 'side') || ':' || (x ->> 'amountMinor') AS s
                                                     FROM jsonb_array_elements(p_lines) x) b)
       AND (SELECT e.reverses_entry_id FROM ledger.journal_entries e WHERE e.id = v_entry)
           IS NOT DISTINCT FROM p_reverses_entry_id
      INTO v_same;
    RETURN QUERY SELECT CASE WHEN v_same THEN 'replayed' ELSE 'key_reused' END,
                        CASE WHEN v_same THEN v_entry END;
    RETURN;
  END IF;
  IF p_reverses_entry_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM ledger.journal_entries e WHERE e.reverses_entry_id = p_reverses_entry_id) THEN
    RETURN QUERY SELECT 'already_reversed', NULL::uuid;
    RETURN;
  END IF;

  -- The non-negative rule, on the held projections (a balance is kept in the account's normal direction).
  IF EXISTS (
    SELECT 1
      FROM (SELECT a.non_negative, p.balance_minor
                   + sum(CASE WHEN x ->> 'side' = CASE WHEN a.type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END
                              THEN (x ->> 'amountMinor')::numeric ELSE -(x ->> 'amountMinor')::numeric END) AS after
              FROM jsonb_array_elements(p_lines) x
              JOIN ledger.accounts a ON a.id = (x ->> 'accountId')::uuid
              JOIN ledger.balance_projection p ON p.account_id = a.id
             GROUP BY a.id, a.non_negative, p.balance_minor) s
     WHERE s.non_negative AND s.after < 0) THEN
    RETURN QUERY SELECT 'insufficient_balance', NULL::uuid;
    RETURN;
  END IF;

  -- The contested insert (L3: nothing is waited for after it): the key, and a reversal's original, are unique.
  BEGIN
    INSERT INTO ledger.journal_entries
      (merchant_id, ledger_id, effective_date, entry_type, narrative, source_type, source_id, idempotency_key,
       reverses_entry_id, created_by, template_version)
    VALUES (v_ledger.merchant_id, p_ledger_id, p_effective_date, p_entry_type, btrim(p_narrative), p_source_type,
            p_source_id, p_idempotency_key, p_reverses_entry_id, p_actor_identity_id, p_template_version)
    RETURNING id INTO v_entry;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    RETURN QUERY SELECT CASE WHEN v_constraint = 'journal_entries_reversed_once' THEN 'already_reversed'
                             ELSE 'key_reused' END, NULL::uuid;
    RETURN;
  END;
  INSERT INTO ledger.journal_lines (merchant_id, entry_id, account_id, side, amount_minor, currency)
  SELECT v_ledger.merchant_id, v_entry, (t.value ->> 'accountId')::uuid, t.value ->> 'side',
         (t.value ->> 'amountMinor')::bigint, v_ledger.currency
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t
   ORDER BY t.ordinality;
  UPDATE ledger.balance_projection p
     SET balance_minor = p.balance_minor + d.delta, version = p.version + 1, updated_at = now()
    FROM (SELECT a.id,
                 sum(CASE WHEN x ->> 'side' = CASE WHEN a.type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END
                          THEN (x ->> 'amountMinor')::bigint ELSE -(x ->> 'amountMinor')::bigint END)::bigint AS delta
            FROM jsonb_array_elements(p_lines) x
            JOIN ledger.accounts a ON a.id = (x ->> 'accountId')::uuid
           GROUP BY a.id) d
   WHERE p.account_id = d.id;

  -- Owner Q4: every debit to a capital or an income account, in the activity record (one statement per event, so
  -- each names its own catalog pair).
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     summary)
  SELECT v_ledger.merchant_id, p_actor_identity_id,
         CASE WHEN p_actor_membership_id IS NOT NULL THEN 'merchant' END, p_actor_membership_id,
         'ledger.capital_debited', 'ledger_entry', v_entry::text, 'success',
         jsonb_build_object('entryId', v_entry::text, 'entryType', left(p_entry_type, 100), 'accountId', a.id::text,
                            'accountCode', a.code, 'amountMinor', t.value ->> 'amountMinor')
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t
    JOIN ledger.accounts a ON a.id = (t.value ->> 'accountId')::uuid
   WHERE t.value ->> 'side' = 'debit' AND a.type = 'equity'
   ORDER BY t.ordinality;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     summary)
  SELECT v_ledger.merchant_id, p_actor_identity_id,
         CASE WHEN p_actor_membership_id IS NOT NULL THEN 'merchant' END, p_actor_membership_id,
         'ledger.income_debited', 'ledger_entry', v_entry::text, 'success',
         jsonb_build_object('entryId', v_entry::text, 'entryType', left(p_entry_type, 100), 'accountId', a.id::text,
                            'accountCode', a.code, 'amountMinor', t.value ->> 'amountMinor')
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t
    JOIN ledger.accounts a ON a.id = (t.value ->> 'accountId')::uuid
   WHERE t.value ->> 'side' = 'debit' AND a.type = 'revenue'
   ORDER BY t.ordinality;

  RETURN QUERY SELECT 'ok', v_entry;
END
$function$;

REVOKE ALL ON FUNCTION customers.customer_result(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.insert_customer_locked(uuid, uuid, text, text, text, text, text, uuid, uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.create_customer(uuid, uuid, text, text, text, text, text, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.agent_create_customer(uuid, uuid, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.update_customer(uuid, uuid, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.set_customer_status(uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.assign_agent(uuid, uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.issue_app_invitation(uuid, uuid, text, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.accept_app_invitation(text, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.anonymise_customer(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.list_customers(uuid, uuid, text, uuid, text, integer, timestamp with time zone, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.branch_of(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.list_assignments(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.agent_customers(uuid, uuid, text, integer, timestamp with time zone, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.read_self(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION customers.current_agent(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customers.create_customer(uuid, uuid, text, text, text, text, text, uuid, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.agent_create_customer(uuid, uuid, text, text, text, text, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.update_customer(uuid, uuid, jsonb, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.set_customer_status(uuid, uuid, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.assign_agent(uuid, uuid, uuid, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.issue_app_invitation(uuid, uuid, text, integer, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.accept_app_invitation(text, uuid, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.anonymise_customer(uuid, uuid, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.list_customers(uuid, uuid, text, uuid, text, integer, timestamp with time zone, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.branch_of(uuid, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.list_assignments(uuid, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.agent_customers(uuid, uuid, text, integer, timestamp with time zone, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION customers.read_self(uuid) TO alphakolect_app;
