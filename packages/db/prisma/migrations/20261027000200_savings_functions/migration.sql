-- P8: savings — the commands, the reads, the permissions and the activity events
-- (docs/architecture/P8_IMPLEMENTATION_PLAN.md §3, §4; the owner's answers of 2026-10-25).
--
-- Every merchant command takes the caller's session and its footprint in the global order — the business, the actor
-- (the authority lock), the actor's role and branch, then every projection it will post to (14, one sorted acquisition,
-- P8-3), the customer (16), then its own rows (17) — asks tenancy.assert_authority, writes, posts (each posting
-- re-takes projections already held) and records its activity event (pattern A). A staff member restricted to a branch
-- reaches only that branch's customers (P5 §7.6). An agent records collections for their own customers only (BR-3,
-- D1): the customer's current agent is read under the customer's lock, which reassignment takes.
-- TA-13: a remittance locks its collections FOR NO KEY UPDATE in one sorted call and approves only those still
-- recorded, so no collection is approved twice and no customer credited twice.
-- TA-14: no event carries a customer's personal details — identifiers, kinds and amounts only.
-- Forward-only; earlier migrations untouched.

INSERT INTO identity.permission_catalog (identifier, scope, grantable, description) VALUES
  ('merchant.savings.read', 'merchant', true,
   'See packages, enrolments, collections, remittances and withdrawals.'),
  ('merchant.packages.manage', 'merchant', true,
   'Create and change packages, and enrol customers in them.'),
  ('merchant.remittances.approve', 'merchant', true,
   'Check an agent''s cash and approve or leave out the collections it covers, or cancel a collection recorded by mistake.'),
  ('merchant.withdrawals.create', 'merchant', true,
   'Record a customer''s withdrawal and pay it out, and move savings into target savings.');

INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('savings.package_created', 'success', 'atomic', 'A',
   '{"kind": {"type": "string", "max": 16}, "feeRule": {"type": "string", "max": 32}}'),
  ('savings.package_updated', 'success', 'atomic', 'A',
   '{"fields": {"type": "string_list", "maxItems": 2, "max": 16}, "status": {"type": "string", "max": 16}}'),
  ('savings.customer_enrolled', 'success', 'atomic', 'A',
   '{"packageId": {"type": "string", "max": 36}, "effective": {"type": "string", "max": 16}}'),
  ('savings.collection_recorded', 'success', 'atomic', 'A',
   '{"customerId": {"type": "string", "max": 36}, "amountMinor": {"type": "string", "max": 20}}'),
  ('savings.collection_cancelled', 'success', 'atomic', 'A',
   '{"customerId": {"type": "string", "max": 36}, "amountMinor": {"type": "string", "max": 20}}'),
  ('savings.remittance_approved', 'success', 'atomic', 'A',
   '{"agentMembershipId": {"type": "string", "max": 36}, "collectionCount": {"type": "string", "max": 4}, "cashMinor": {"type": "string", "max": 20}, "feeTotalMinor": {"type": "string", "max": 20}}'),
  ('savings.money_moved', 'success', 'atomic', 'A',
   '{"kind": {"type": "string", "max": 32}, "amountMinor": {"type": "string", "max": 20}}'),
  ('savings.target_goal_set', 'success', 'atomic', 'A',
   '{"goalAmountMinor": {"type": "string", "max": 20, "nullable": true}, "goalDate": {"type": "string", "max": 10, "nullable": true}}'),
  -- A refusal by the database alone (a permission withdrawn between the API's check and the command's), best effort.
  ('savings.package_created', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('savings.package_updated', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('savings.customer_enrolled', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('savings.collection_cancelled', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('savings.remittance_approved', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('savings.money_moved', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('savings.target_goal_set', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}');

-- ── a command's answer: the row it wrote (or none, with a refusal) ──
-- So that a session allowed to change savings but not to read them still gets what it changed. Called only by the
-- commands below, with the rows they hold.
CREATE FUNCTION savings.package_result(p_outcome text, p_package_id uuid)
 RETURNS TABLE(outcome text, id uuid, name text, kind text, amount_minor bigint, fee_rule text, fee_rate_bp integer, status text, created_at timestamp with time zone, updated_at timestamp with time zone, archived_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT p_outcome, p.id, p.name, p.kind, p.amount_minor, p.fee_rule, p.fee_rate_bp, p.status, p.created_at,
         p.updated_at, p.archived_at
    FROM (SELECT 1) x LEFT JOIN savings.packages p ON p.id = p_package_id;
$function$;

CREATE FUNCTION savings.collection_result(p_outcome text, p_collection_id uuid)
 RETURNS TABLE(outcome text, id uuid, customer_id uuid, agent_membership_id uuid, package_id uuid, amount_minor bigint, days integer, collected_on date, status text, remittance_id uuid, cycle_id uuid, fee_minor bigint, created_at timestamp with time zone, approved_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT p_outcome, c.id, c.customer_id, c.agent_membership_id, c.package_id, c.amount_minor, c.days, c.collected_on,
         c.status, c.remittance_id, c.cycle_id, c.fee_minor, c.created_at, c.approved_at, c.cancelled_at,
         c.cancel_reason
    FROM (SELECT 1) x LEFT JOIN savings.collections c ON c.id = p_collection_id;
$function$;

-- ── packages (Q1, Q2; BR-6.1): merchant.packages.manage ──
-- Outcomes: 'ok', 'forbidden', 'invalid', 'name_taken'.
CREATE FUNCTION savings.create_package(p_session_id uuid, p_name text, p_kind text, p_amount_minor bigint, p_fee_rule text, p_fee_rate_bp integer DEFAULT NULL::integer, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, name text, kind text, amount_minor bigint, fee_rule text, fee_rate_bp integer, status text, created_at timestamp with time zone, updated_at timestamp with time zone, archived_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_id uuid;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT * FROM savings.package_result('forbidden', NULL);
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  IF tenancy.assert_authority(p_session_id, 'merchant.packages.manage') <> 'ok' THEN
    RETURN QUERY SELECT * FROM savings.package_result('forbidden', NULL);
    RETURN;
  END IF;
  IF char_length(coalesce(btrim(p_name), '')) NOT BETWEEN 1 AND 80
     OR p_kind IS NULL OR p_kind NOT IN ('fixed', 'flexible')
     OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 10000000000000
     OR p_fee_rule IS NULL OR p_fee_rule NOT IN ('first_contribution', 'percentage')
     OR (p_fee_rule = 'percentage' AND (p_fee_rate_bp IS NULL OR p_fee_rate_bp NOT BETWEEN 1 AND 10000))
     OR (p_fee_rule = 'first_contribution' AND p_fee_rate_bp IS NOT NULL) THEN
    RETURN QUERY SELECT * FROM savings.package_result('invalid', NULL);
    RETURN;
  END IF;
  -- The contested insert last (L3): one active package per name.
  BEGIN
    INSERT INTO savings.packages
      (merchant_id, name, kind, amount_minor, fee_rule, fee_rate_bp, created_by_membership_id)
    VALUES (v_merchant, btrim(p_name), p_kind, p_amount_minor, p_fee_rule, p_fee_rate_bp, v_actor)
    RETURNING savings.packages.id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT * FROM savings.package_result('name_taken', NULL);
    RETURN;
  END;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'savings.package_created', 'savings_package', v_id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('kind', p_kind, 'feeRule', p_fee_rule));
  RETURN QUERY SELECT * FROM savings.package_result('ok', v_id);
END
$function$;

-- A package's name and status (P8-7: its terms never change). p_change: {"name": text, "status": "active" |
-- "archived"}. An archived package takes no new enrolment; its customers stay on it. Outcomes: 'ok', 'forbidden',
-- 'not_found', 'invalid', 'name_taken'.
CREATE FUNCTION savings.update_package(p_session_id uuid, p_package_id uuid, p_change jsonb, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, name text, kind text, amount_minor bigint, fee_rule text, fee_rate_bp integer, status text, created_at timestamp with time zone, updated_at timestamp with time zone, archived_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_package savings.packages%ROWTYPE;
  v_fields text[];
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT * FROM savings.package_result('forbidden', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_package FROM savings.packages p WHERE p.id = p_package_id AND p.merchant_id = v_merchant;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM 1 FROM savings.packages p WHERE p.id = v_package.id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'merchant.packages.manage') <> 'ok' THEN
    RETURN QUERY SELECT * FROM savings.package_result('forbidden', NULL);
    RETURN;
  END IF;
  IF v_package.id IS NULL THEN
    RETURN QUERY SELECT * FROM savings.package_result('not_found', NULL);
    RETURN;
  END IF;
  IF p_change IS NULL OR jsonb_typeof(p_change) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_change) k WHERE k NOT IN ('name', 'status'))
     OR (SELECT count(*) FROM jsonb_object_keys(p_change)) = 0
     OR (p_change ? 'name' AND char_length(coalesce(btrim(p_change ->> 'name'), '')) NOT BETWEEN 1 AND 80)
     OR (p_change ? 'status' AND coalesce(p_change ->> 'status', '') NOT IN ('active', 'archived')) THEN
    RETURN QUERY SELECT * FROM savings.package_result('invalid', NULL);
    RETURN;
  END IF;
  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_fields FROM jsonb_object_keys(p_change) k;
  BEGIN
    UPDATE savings.packages p
       SET name = CASE WHEN p_change ? 'name' THEN btrim(p_change ->> 'name') ELSE p.name END,
           status = coalesce(p_change ->> 'status', p.status),
           archived_at = CASE WHEN coalesce(p_change ->> 'status', p.status) = 'archived'
                              THEN coalesce(p.archived_at, now()) END,
           updated_at = now()
     WHERE p.id = v_package.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT * FROM savings.package_result('name_taken', NULL);
    RETURN;
  END;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'savings.package_updated', 'savings_package',
          v_package.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('fields', to_jsonb(v_fields),
                             'status', coalesce(p_change ->> 'status', v_package.status)));
  RETURN QUERY SELECT * FROM savings.package_result('ok', v_package.id);
END
$function$;

-- ── enrolment (BR-5.1, Q10): merchant.packages.manage, within the actor's branch ──
-- A customer's first package takes effect now. A change takes effect when the current cycle ends (Q10): until then it
-- is the next cycle's package; with no cycle running it takes effect now. Choosing the current package again cancels a
-- waiting change. Outcomes: 'ok', 'forbidden', 'not_found', 'invalid_status', 'invalid_package'. Effective: 'now',
-- 'next_cycle'.
CREATE FUNCTION savings.enrol_customer(p_session_id uuid, p_customer_id uuid, p_package_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, customer_id uuid, package_id uuid, next_package_id uuid, effective text, enrolled_at timestamp with time zone, updated_at timestamp with time zone)
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
  v_enrolment savings.enrolments%ROWTYPE;
  v_cycle_end date;
  v_effective text;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id, v.branch_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role, v_actor_branch
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = p_customer_id AND c.merchant_id = v_merchant;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM tenancy.lock_branches(ARRAY[v_actor_branch], NULL);
  -- The customer (NKU): its enrolment changes only here, under that lock.
  PERFORM 1 FROM customers.customers c WHERE c.id = v_customer.id FOR NO KEY UPDATE;
  PERFORM 1 FROM savings.packages p WHERE p.id = p_package_id FOR SHARE;
  PERFORM 1 FROM savings.enrolments e WHERE e.customer_id = v_customer.id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'merchant.packages.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = v_customer.id;
  IF v_customer.id IS NULL
     OR (v_actor_branch IS NOT NULL AND (v_customer.branch_id <> v_actor_branch OR NOT EXISTS (
           SELECT 1 FROM tenancy.branches b WHERE b.id = v_actor_branch AND b.status = 'active'))) THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_customer.status <> 'active' THEN
    RETURN QUERY SELECT 'invalid_status', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM savings.packages p
                  WHERE p.id = p_package_id AND p.merchant_id = v_merchant AND p.status = 'active') THEN
    RETURN QUERY SELECT 'invalid_package', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_enrolment FROM savings.enrolments e WHERE e.customer_id = v_customer.id;
  SELECT y.ends_on INTO v_cycle_end FROM savings.cycles y
   WHERE y.merchant_id = v_merchant AND y.customer_id = v_customer.id ORDER BY y.number DESC LIMIT 1;
  IF v_enrolment.id IS NOT NULL AND v_enrolment.package_id = p_package_id AND v_enrolment.next_package_id IS NULL THEN
    -- Nothing changes and nothing is recorded.
    RETURN QUERY SELECT 'ok', e.customer_id, e.package_id, e.next_package_id, 'now', e.enrolled_at, e.updated_at
                   FROM savings.enrolments e WHERE e.id = v_enrolment.id;
    RETURN;
  END IF;
  IF v_enrolment.id IS NOT NULL THEN
    IF v_enrolment.package_id <> p_package_id AND v_cycle_end IS NOT NULL AND v_cycle_end >= current_date THEN
      v_effective := 'next_cycle';
      UPDATE savings.enrolments e SET next_package_id = p_package_id, updated_at = now() WHERE e.id = v_enrolment.id;
    ELSE
      v_effective := 'now';
      UPDATE savings.enrolments e SET package_id = p_package_id, next_package_id = NULL, updated_at = now()
       WHERE e.id = v_enrolment.id;
    END IF;
  ELSE
    v_effective := 'now';
    -- The contested insert last (L3): one enrolment per customer (BR-5.1).
    INSERT INTO savings.enrolments (merchant_id, customer_id, package_id, enrolled_by_membership_id)
    VALUES (v_merchant, v_customer.id, p_package_id, v_actor);
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'savings.customer_enrolled', 'customer',
          v_customer.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('packageId', p_package_id::text, 'effective', v_effective));
  RETURN QUERY SELECT 'ok', e.customer_id, e.package_id, e.next_package_id, v_effective, e.enrolled_at, e.updated_at
                 FROM savings.enrolments e WHERE e.customer_id = v_customer.id;
END
$function$;

-- ── a cash collection, recorded by the customer's agent (BR-3, 5.3, 5.6; D1) ──
-- The ledger: Dr 1210 (the agent) / Cr 2190 — the customer's savings do not move until approval (BR-5.6). The agent's
-- key makes a retry record once. Outcomes: 'ok', 'replayed', 'key_reused', 'forbidden', 'invalid', 'not_found'
-- (unknown, or not the agent's customer now: D1), 'invalid_status', 'not_enrolled', 'invalid_amount'.
CREATE FUNCTION savings.record_collection(p_session_id uuid, p_customer_id uuid, p_amount_minor bigint, p_idem_key text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, customer_id uuid, agent_membership_id uuid, package_id uuid, amount_minor bigint, days integer, collected_on date, status text, remittance_id uuid, cycle_id uuid, fee_minor bigint, created_at timestamp with time zone, approved_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_ledger uuid;
  v_cash uuid;
  v_suspense uuid;
  v_accounts uuid[];
  v_customer customers.customers%ROWTYPE;
  v_enrolment savings.enrolments%ROWTYPE;
  v_package savings.packages%ROWTYPE;
  v_existing savings.collections%ROWTYPE;
  v_days integer;
  v_id uuid;
  v_post record;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id INTO v_merchant, v_actor, v_actor_identity
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'agent';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT * FROM savings.collection_result('forbidden', NULL);
    RETURN;
  END IF;
  SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = v_merchant;
  SELECT a.id INTO v_cash FROM ledger.accounts a
   WHERE a.ledger_id = v_ledger AND a.code = '1210' AND a.subject_type = 'agent' AND a.subject_id = v_actor;
  SELECT a.id INTO v_suspense FROM ledger.accounts a
   WHERE a.ledger_id = v_ledger AND a.code = '2190' AND a.subject_type IS NULL;
  v_accounts := ARRAY[v_cash, v_suspense];
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  -- P8-3: the projections the recording posts to, before the customer and the enrolment.
  PERFORM ledger.lock_projections(NULL, v_accounts);
  -- The customer (S): its agent changes only under its NKU lock (customers.assign_agent), its status too.
  PERFORM 1 FROM customers.customers c WHERE c.id = p_customer_id FOR SHARE;
  PERFORM 1 FROM savings.enrolments e WHERE e.customer_id = p_customer_id FOR SHARE;
  -- The agent, again under its lock: active, of an active business.
  IF identity.active_membership(v_actor_identity, 'agent', v_actor) IS NULL THEN
    RETURN QUERY SELECT * FROM savings.collection_result('forbidden', NULL);
    RETURN;
  END IF;
  -- A retry: the same request returns its collection; another request with the key is refused.
  SELECT * INTO v_existing FROM savings.collections c
   WHERE c.merchant_id = v_merchant AND c.agent_membership_id = v_actor AND c.idem_key = p_idem_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.customer_id = p_customer_id AND v_existing.amount_minor = p_amount_minor THEN
      RETURN QUERY SELECT * FROM savings.collection_result('replayed', v_existing.id);
    ELSE
      RETURN QUERY SELECT * FROM savings.collection_result('key_reused', NULL);
    END IF;
    RETURN;
  END IF;
  IF coalesce(p_idem_key, '') !~ '^[\x21-\x7e]{1,255}$' THEN
    RETURN QUERY SELECT * FROM savings.collection_result('invalid', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = p_customer_id AND c.merchant_id = v_merchant;
  -- D1: only the customer's agent now; another agent's customer is not found to this one.
  IF v_customer.id IS NULL OR customers.current_agent(v_merchant, v_customer.id) IS DISTINCT FROM v_actor THEN
    RETURN QUERY SELECT * FROM savings.collection_result('not_found', NULL);
    RETURN;
  END IF;
  IF v_customer.status <> 'active' THEN
    RETURN QUERY SELECT * FROM savings.collection_result('invalid_status', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_enrolment FROM savings.enrolments e WHERE e.customer_id = v_customer.id;
  IF v_enrolment.id IS NULL THEN
    RETURN QUERY SELECT * FROM savings.collection_result('not_enrolled', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_package FROM savings.packages p WHERE p.id = v_enrolment.package_id;
  -- Q1: a fixed package takes the amount or a multiple of it (up to a cycle's 31 days); a flexible one any amount from
  -- its minimum.
  IF p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 10000000000000
     OR (v_package.kind = 'fixed' AND (p_amount_minor % v_package.amount_minor <> 0
                                       OR p_amount_minor / v_package.amount_minor > 31))
     OR (v_package.kind = 'flexible' AND p_amount_minor < v_package.amount_minor) THEN
    RETURN QUERY SELECT * FROM savings.collection_result('invalid_amount', NULL);
    RETURN;
  END IF;
  v_days := CASE WHEN v_package.kind = 'fixed' THEN (p_amount_minor / v_package.amount_minor)::integer END;
  v_id := util.uuid_v7();
  SELECT * INTO v_post
    FROM ledger.post_template(v_ledger, 'collection.cash_recorded', p_amount_minor, jsonb_build_object('agent', v_actor),
                              'savings.collection.' || v_id::text || '.recorded', current_date,
                              'Cash collection recorded by agent', 'savings_collection', v_id::text,
                              v_actor_identity, v_actor);
  IF v_post.outcome IS DISTINCT FROM 'ok' THEN
    RAISE EXCEPTION 'savings: collection % was not posted (%)', v_id, v_post.outcome;
  END IF;
  INSERT INTO savings.collections
    (id, merchant_id, customer_id, agent_membership_id, package_id, amount_minor, days, collected_on, idem_key,
     recorded_entry_id)
  VALUES (v_id, v_merchant, v_customer.id, v_actor, v_package.id, p_amount_minor, v_days, current_date, p_idem_key,
          v_post.entry_id);
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'agent', v_actor, 'savings.collection_recorded', 'savings_collection',
          v_id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('customerId', v_customer.id::text, 'amountMinor', p_amount_minor::text));
  RETURN QUERY SELECT * FROM savings.collection_result('ok', v_id);
END
$function$;

-- ── a collection recorded by mistake, cancelled before approval (Q6): merchant.remittances.approve ──
-- The recording's entry is reversed (BR-11.1). Outcomes: 'ok', 'forbidden', 'not_found', 'invalid', 'invalid_status'.
CREATE FUNCTION savings.cancel_collection(p_session_id uuid, p_collection_id uuid, p_reason text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, customer_id uuid, agent_membership_id uuid, package_id uuid, amount_minor bigint, days integer, collected_on date, status text, remittance_id uuid, cycle_id uuid, fee_minor bigint, created_at timestamp with time zone, approved_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text)
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
  v_ledger uuid;
  v_accounts uuid[];
  v_collection savings.collections%ROWTYPE;
  v_post record;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id, v.branch_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role, v_actor_branch
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT * FROM savings.collection_result('forbidden', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_collection FROM savings.collections c WHERE c.id = p_collection_id AND c.merchant_id = v_merchant;
  SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = v_merchant;
  SELECT array_agg(a.id ORDER BY a.id) INTO v_accounts
    FROM ledger.accounts a
   WHERE a.ledger_id = v_ledger
     AND ((a.code = '1210' AND a.subject_type = 'agent' AND a.subject_id = v_collection.agent_membership_id)
          OR (a.code = '2190' AND a.subject_type IS NULL));
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM tenancy.lock_branches(ARRAY[v_actor_branch], NULL);
  PERFORM ledger.lock_projections(NULL, v_accounts);
  PERFORM 1 FROM savings.collections c WHERE c.id = v_collection.id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'merchant.remittances.approve') <> 'ok' THEN
    RETURN QUERY SELECT * FROM savings.collection_result('forbidden', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_collection FROM savings.collections c WHERE c.id = v_collection.id;
  IF v_collection.id IS NULL
     OR (v_actor_branch IS NOT NULL AND (NOT EXISTS (
           SELECT 1 FROM customers.customers c
            WHERE c.merchant_id = v_merchant AND c.id = v_collection.customer_id AND c.branch_id = v_actor_branch)
         OR NOT EXISTS (SELECT 1 FROM tenancy.branches b WHERE b.id = v_actor_branch AND b.status = 'active'))) THEN
    RETURN QUERY SELECT * FROM savings.collection_result('not_found', NULL);
    RETURN;
  END IF;
  IF char_length(coalesce(btrim(p_reason), '')) NOT BETWEEN 1 AND 300 THEN
    RETURN QUERY SELECT * FROM savings.collection_result('invalid', NULL);
    RETURN;
  END IF;
  IF v_collection.status <> 'recorded' THEN
    RETURN QUERY SELECT * FROM savings.collection_result('invalid_status', NULL);
    RETURN;
  END IF;
  SELECT * INTO v_post
    FROM ledger.post_reversal(v_ledger, v_collection.recorded_entry_id,
                              'savings.collection.' || v_collection.id::text || '.cancelled', current_date,
                              'Collection cancelled: ' || btrim(p_reason), v_actor_identity, v_actor);
  IF v_post.outcome IS DISTINCT FROM 'ok' THEN
    RAISE EXCEPTION 'savings: the cancellation of % was not posted (%)', v_collection.id, v_post.outcome;
  END IF;
  UPDATE savings.collections c
     SET status = 'cancelled', cancelled_at = now(), cancelled_by_membership_id = v_actor,
         cancel_reason = btrim(p_reason), cancel_entry_id = v_post.entry_id
   WHERE c.id = v_collection.id;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'savings.collection_cancelled', 'savings_collection',
          v_collection.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('customerId', v_collection.customer_id::text,
                             'amountMinor', v_collection.amount_minor::text));
  RETURN QUERY SELECT * FROM savings.collection_result('ok', v_collection.id);
END
$function$;

-- ── a remittance (Q5; BR-5.3, 5.5, 5.6, 6.1, 6.2; TA-13): merchant.remittances.approve ──
-- The business approves the collections an agent's cash covers; the cash counted equals their total (P8-8). The rest
-- stay recorded. Per collection, in ascending id: its cycle (a new one when it falls after the last cycle's 31 days,
-- Q3 — the waiting package change taking effect, Q10), the confirmation (Dr 1200 / Cr 1210 agent; Dr 2190 / Cr 2100
-- customer), then the fee as its own entry with its narrative (BR-6.2): the first contribution of a cycle (one day's
-- amount on a fixed package, the whole collection on a flexible one — Q4), or the percentage rounded down to the kobo
-- (Q2). Outcomes: 'ok', 'forbidden', 'invalid', 'invalid_agent', 'not_found', 'invalid_status', 'cash_mismatch',
-- 'inactive_customer' (P8-5: the business cancels such a collection).
CREATE FUNCTION savings.approve_remittance(p_session_id uuid, p_agent_membership_id uuid, p_collection_ids uuid[], p_cash_minor bigint, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, agent_membership_id uuid, cash_minor bigint, collection_count integer, fee_total_minor bigint, created_at timestamp with time zone)
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
  v_ledger uuid;
  v_merchant_name text;
  v_ids uuid[];
  v_mine uuid[];
  v_customers uuid[];
  v_enrolments uuid[];
  v_accounts uuid[];
  v_collection savings.collections%ROWTYPE;
  v_cycle savings.cycles%ROWTYPE;
  v_enrolment savings.enrolments%ROWTYPE;
  v_package savings.packages%ROWTYPE;
  v_first boolean;
  v_fee bigint;
  v_template text;
  v_narrative text;
  v_when text;
  v_post record;
  v_remittance uuid;
  v_done_ids uuid[] := '{}';
  v_done_cycles uuid[] := '{}';
  v_done_confirmed uuid[] := '{}';
  v_done_fee_entries uuid[] := '{}';
  v_done_fees bigint[] := '{}';
  v_fee_total bigint := 0;
  v_fee_entry uuid;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id, v.branch_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role, v_actor_branch
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::uuid, NULL::bigint, NULL::integer, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = v_merchant;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_collection_ids) x WHERE x IS NOT NULL;
  -- The business's collections among them, their customers, enrolments and every projection the approval posts to
  -- (a collection's customer and agent never change).
  SELECT array_agg(c.id ORDER BY c.id), array_agg(DISTINCT c.customer_id ORDER BY c.customer_id)
    INTO v_mine, v_customers
    FROM savings.collections c WHERE c.merchant_id = v_merchant AND c.id = ANY (v_ids);
  SELECT array_agg(e.id ORDER BY e.id) INTO v_enrolments
    FROM savings.enrolments e WHERE e.merchant_id = v_merchant AND e.customer_id = ANY (v_customers);
  SELECT array_agg(a.id ORDER BY a.id) INTO v_accounts
    FROM ledger.accounts a
   WHERE a.ledger_id = v_ledger
     AND ((a.subject_type IS NULL AND a.code IN ('1200', '2190', '4100', '4110'))
          OR (a.code = '1210' AND a.subject_type = 'agent' AND a.subject_id = p_agent_membership_id)
          OR (a.code = '2100' AND a.subject_type = 'customer' AND a.subject_id = ANY (v_customers)));
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM tenancy.lock_branches(ARRAY[v_actor_branch], NULL);
  -- P8-3: every projection posted to, in one sorted acquisition, before the rows of category 17.
  PERFORM ledger.lock_projections(NULL, v_accounts);
  PERFORM savings.lock_enrolments(NULL, v_enrolments);
  -- TA-13: the collections FOR NO KEY UPDATE, in ascending id, in one call.
  PERFORM savings.lock_collections(NULL, v_mine);
  IF tenancy.assert_authority(p_session_id, 'merchant.remittances.approve') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::uuid, NULL::bigint, NULL::integer, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_ids IS NULL OR cardinality(v_ids) NOT BETWEEN 1 AND 200
     OR cardinality(v_ids) <> cardinality(p_collection_ids) OR p_cash_minor IS NULL OR p_cash_minor <= 0 THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::uuid, NULL::bigint, NULL::integer, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenancy.merchant_memberships mm
                  WHERE mm.merchant_id = v_merchant AND mm.id = p_agent_membership_id AND mm.kind = 'agent') THEN
    RETURN QUERY SELECT 'invalid_agent', NULL::uuid, NULL::uuid, NULL::bigint, NULL::integer, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  -- Every collection the agent's, of the business, and in the actor's branch when restricted (P5 §7.6).
  IF (SELECT count(*) FROM savings.collections c
       WHERE c.merchant_id = v_merchant AND c.id = ANY (v_ids) AND c.agent_membership_id = p_agent_membership_id)
       <> cardinality(v_ids)
     OR (v_actor_branch IS NOT NULL AND (
           NOT EXISTS (SELECT 1 FROM tenancy.branches b WHERE b.id = v_actor_branch AND b.status = 'active')
           OR EXISTS (SELECT 1 FROM savings.collections c
                        JOIN customers.customers cu ON cu.merchant_id = c.merchant_id AND cu.id = c.customer_id
                       WHERE c.merchant_id = v_merchant AND c.id = ANY (v_ids) AND cu.branch_id <> v_actor_branch))) THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid, NULL::bigint, NULL::integer, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  -- TA-13: still recorded, read under the locks — a collection approved or cancelled meanwhile is refused.
  IF EXISTS (SELECT 1 FROM savings.collections c WHERE c.id = ANY (v_ids) AND c.status <> 'recorded') THEN
    RETURN QUERY SELECT 'invalid_status', NULL::uuid, NULL::uuid, NULL::bigint, NULL::integer, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  IF (SELECT sum(c.amount_minor) FROM savings.collections c WHERE c.id = ANY (v_ids)) <> p_cash_minor THEN
    RETURN QUERY SELECT 'cash_mismatch', NULL::uuid, NULL::uuid, NULL::bigint, NULL::integer, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  -- P8-5: a customer no longer active is credited nothing (the status read under the customer's balances, which a
  -- status change holds).
  IF EXISTS (SELECT 1 FROM savings.collections c
               JOIN customers.customers cu ON cu.merchant_id = c.merchant_id AND cu.id = c.customer_id
              WHERE c.id = ANY (v_ids) AND cu.status <> 'active') THEN
    RETURN QUERY SELECT 'inactive_customer', NULL::uuid, NULL::uuid, NULL::bigint, NULL::integer, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT m.name INTO v_merchant_name FROM tenancy.merchants m WHERE m.id = v_merchant;
  v_when := to_char(now() AT TIME ZONE 'Africa/Lagos', 'DD Mon YYYY HH24:MI');
  v_remittance := util.uuid_v7();
  FOR v_collection IN SELECT * FROM savings.collections c WHERE c.id = ANY (v_ids) ORDER BY c.id LOOP
    -- The customer's cycle (Q3): the last one, or a new one when this contribution falls after its 31 days.
    v_cycle := NULL;
    SELECT * INTO v_cycle FROM savings.cycles y
     WHERE y.merchant_id = v_merchant AND y.customer_id = v_collection.customer_id ORDER BY y.number DESC LIMIT 1;
    v_first := v_cycle.id IS NULL OR v_collection.collected_on > v_cycle.ends_on;
    IF v_first THEN
      SELECT * INTO v_enrolment FROM savings.enrolments e WHERE e.customer_id = v_collection.customer_id;
      -- Q10: a waiting change of package takes effect with the new cycle.
      IF v_enrolment.next_package_id IS NOT NULL THEN
        UPDATE savings.enrolments e SET package_id = e.next_package_id, next_package_id = NULL, updated_at = now()
         WHERE e.id = v_enrolment.id;
      END IF;
      INSERT INTO savings.cycles (merchant_id, customer_id, package_id, number, starts_on, ends_on)
      VALUES (v_merchant, v_collection.customer_id, coalesce(v_enrolment.next_package_id, v_enrolment.package_id),
              coalesce(v_cycle.number, 0) + 1, v_collection.collected_on, v_collection.collected_on + 30)
      RETURNING * INTO v_cycle;
    END IF;
    SELECT * INTO v_package FROM savings.packages p WHERE p.id = v_cycle.package_id;
    v_fee := 0;
    v_template := NULL;
    IF v_package.fee_rule = 'first_contribution' AND v_first THEN
      v_fee := CASE WHEN v_package.kind = 'fixed' THEN least(v_package.amount_minor, v_collection.amount_minor)
                    ELSE v_collection.amount_minor END;
      v_template := 'fee.first_contribution';
      v_narrative := format('First contribution of cycle %s taken as fee for %s on %s', v_cycle.number,
                            v_merchant_name, v_when);
    ELSIF v_package.fee_rule = 'percentage' THEN
      v_fee := (v_collection.amount_minor * v_package.fee_rate_bp) / 10000;
      v_template := 'fee.percentage';
      v_narrative := format('%s%% deducted for %s on %s', trim_scale(v_package.fee_rate_bp::numeric / 100),
                            v_merchant_name, v_when);
    END IF;
    SELECT * INTO v_post
      FROM ledger.post_template(v_ledger, 'collection.cash_confirmed', v_collection.amount_minor,
                                jsonb_build_object('agent', v_collection.agent_membership_id,
                                                   'customer', v_collection.customer_id),
                                'savings.collection.' || v_collection.id::text || '.confirmed', current_date,
                                'Cash collection confirmed', 'savings_collection', v_collection.id::text,
                                v_actor_identity, v_actor);
    IF v_post.outcome IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'savings: collection % was not confirmed (%)', v_collection.id, v_post.outcome;
    END IF;
    v_done_confirmed := v_done_confirmed || v_post.entry_id;
    v_fee_entry := NULL;
    IF v_fee > 0 THEN
      SELECT * INTO v_post
        FROM ledger.post_template(v_ledger, v_template, v_fee, jsonb_build_object('customer', v_collection.customer_id),
                                  'savings.collection.' || v_collection.id::text || '.fee', current_date, v_narrative,
                                  'savings_collection', v_collection.id::text, v_actor_identity, v_actor);
      IF v_post.outcome IS DISTINCT FROM 'ok' THEN
        RAISE EXCEPTION 'savings: the fee on collection % was not posted (%)', v_collection.id, v_post.outcome;
      END IF;
      v_fee_entry := v_post.entry_id;
    END IF;
    v_done_ids := v_done_ids || v_collection.id;
    v_done_cycles := v_done_cycles || v_cycle.id;
    v_done_fee_entries := v_done_fee_entries || v_fee_entry;
    v_done_fees := v_done_fees || v_fee;
    v_fee_total := v_fee_total + v_fee;
  END LOOP;
  INSERT INTO savings.remittances
    (id, merchant_id, agent_membership_id, cash_minor, collection_count, fee_total_minor, approved_by_membership_id)
  VALUES (v_remittance, v_merchant, p_agent_membership_id, p_cash_minor, cardinality(v_ids), v_fee_total, v_actor);
  -- The collections are held (NKU): approved here, under those locks.
  UPDATE savings.collections c
     SET status = 'approved', remittance_id = v_remittance, cycle_id = d.cycle_id, confirmed_entry_id = d.confirmed,
         fee_entry_id = d.fee_entry, fee_minor = d.fee, approved_at = now()
    FROM (SELECT unnest(v_done_ids) AS id, unnest(v_done_cycles) AS cycle_id, unnest(v_done_confirmed) AS confirmed,
                 unnest(v_done_fee_entries) AS fee_entry, unnest(v_done_fees) AS fee) d
   WHERE c.id = d.id;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'savings.remittance_approved', 'savings_remittance',
          v_remittance::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('agentMembershipId', p_agent_membership_id::text,
                             'collectionCount', cardinality(v_ids)::text, 'cashMinor', p_cash_minor::text,
                             'feeTotalMinor', v_fee_total::text));
  RETURN QUERY SELECT 'ok', r.id, r.agent_membership_id, r.cash_minor, r.collection_count, r.fee_total_minor,
                      r.created_at
                 FROM savings.remittances r WHERE r.id = v_remittance;
END
$function$;

-- ── withdrawals and moves into target savings (BR-7.1–7.4; Q7, Q8, Q9): merchant.withdrawals.create ──
-- p_kind: 'savings_withdrawal' (Dr 2100 / Cr 1200), 'target_withdrawal' (Dr 2110 / Cr 1200), 'to_target' (Dr 2100 /
-- Cr 2110). Never above the balance (BR-7.4: the ledger's non-negative rule on the locked projection); the balance goes
-- down at once (BR-7.3). The staff member's key makes a retry move money once (P8-9). Outcomes: 'ok', 'replayed',
-- 'key_reused', 'forbidden', 'invalid', 'not_found', 'invalid_status', 'insufficient_balance'.
CREATE FUNCTION savings.move_savings(p_session_id uuid, p_customer_id uuid, p_kind text, p_amount_minor bigint, p_idem_key text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, customer_id uuid, kind text, amount_minor bigint, entry_id uuid, created_at timestamp with time zone)
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
  v_ledger uuid;
  v_accounts uuid[];
  v_customer customers.customers%ROWTYPE;
  v_existing savings.movements%ROWTYPE;
  v_id uuid;
  v_post record;
  v_outcome text;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id, v.branch_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role, v_actor_branch
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::uuid, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = p_customer_id AND c.merchant_id = v_merchant;
  SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = v_merchant;
  SELECT array_agg(a.id ORDER BY a.id) INTO v_accounts
    FROM ledger.accounts a
   WHERE a.ledger_id = v_ledger
     AND ((a.code = '2100' AND a.subject_type = 'customer' AND a.subject_id = v_customer.id
           AND p_kind IN ('savings_withdrawal', 'to_target'))
          OR (a.code = '2110' AND a.subject_type = 'customer' AND a.subject_id = v_customer.id
              AND p_kind IN ('target_withdrawal', 'to_target'))
          OR (a.code = '1200' AND a.subject_type IS NULL AND p_kind IN ('savings_withdrawal', 'target_withdrawal')));
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM tenancy.lock_branches(ARRAY[v_actor_branch], NULL);
  -- P8-3: the projections the move posts to; a status change holds the customer's (P7-13).
  PERFORM ledger.lock_projections(NULL, v_accounts);
  IF tenancy.assert_authority(p_session_id, 'merchant.withdrawals.create') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::uuid, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_existing FROM savings.movements x
   WHERE x.merchant_id = v_merchant AND x.made_by_membership_id = v_actor AND x.idem_key = p_idem_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.customer_id = p_customer_id AND v_existing.kind = p_kind
       AND v_existing.amount_minor = p_amount_minor THEN
      RETURN QUERY SELECT 'replayed', v_existing.id, v_existing.customer_id, v_existing.kind, v_existing.amount_minor,
                          v_existing.entry_id, v_existing.created_at;
    ELSE
      RETURN QUERY SELECT 'key_reused', NULL::uuid, NULL::uuid, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz;
    END IF;
    RETURN;
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('savings_withdrawal', 'target_withdrawal', 'to_target')
     OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 10000000000000
     OR coalesce(p_idem_key, '') !~ '^[\x21-\x7e]{1,255}$' THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::uuid, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = v_customer.id;
  IF v_customer.id IS NULL
     OR (v_actor_branch IS NOT NULL AND (v_customer.branch_id <> v_actor_branch OR NOT EXISTS (
           SELECT 1 FROM tenancy.branches b WHERE b.id = v_actor_branch AND b.status = 'active'))) THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::uuid, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_customer.status <> 'active' THEN
    RETURN QUERY SELECT 'invalid_status', NULL::uuid, NULL::uuid, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  v_id := util.uuid_v7();
  -- The posting and the movement together: a key taken meanwhile for another request undoes both.
  BEGIN
    SELECT * INTO v_post
      FROM ledger.post_template(v_ledger,
                                CASE p_kind WHEN 'savings_withdrawal' THEN 'withdrawal.savings_cash'
                                            WHEN 'target_withdrawal' THEN 'withdrawal.target_cash'
                                            ELSE 'savings.to_target' END,
                                p_amount_minor, jsonb_build_object('customer', v_customer.id),
                                'savings.movement.' || v_id::text, current_date,
                                CASE p_kind WHEN 'savings_withdrawal' THEN 'Cash withdrawal from savings'
                                            WHEN 'target_withdrawal' THEN 'Cash withdrawal from target savings'
                                            ELSE 'Savings moved to target savings' END,
                                'savings_movement', v_id::text, v_actor_identity, v_actor);
    IF v_post.outcome = 'insufficient_balance' THEN
      v_outcome := 'insufficient_balance';
    ELSIF v_post.outcome IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'savings: movement % was not posted (%)', v_id, v_post.outcome;
    ELSE
      INSERT INTO savings.movements
        (id, merchant_id, customer_id, kind, amount_minor, entry_id, made_by_membership_id, idem_key)
      VALUES (v_id, v_merchant, v_customer.id, p_kind, p_amount_minor, v_post.entry_id, v_actor, p_idem_key);
      v_outcome := 'ok';
    END IF;
  EXCEPTION WHEN unique_violation THEN
    v_outcome := 'key_reused';
  END;
  IF v_outcome <> 'ok' THEN
    RETURN QUERY SELECT v_outcome, NULL::uuid, NULL::uuid, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'savings.money_moved', 'customer', v_customer.id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('kind', p_kind, 'amountMinor', p_amount_minor::text));
  RETURN QUERY SELECT 'ok', x.id, x.customer_id, x.kind, x.amount_minor, x.entry_id, x.created_at
                 FROM savings.movements x WHERE x.id = v_id;
END
$function$;

-- ── a customer's target-savings goal (Q9): merchant.withdrawals.create ──
-- An amount and/or a date; both empty clears the goal. Outcomes: 'ok', 'forbidden', 'not_found', 'invalid',
-- 'invalid_status'.
CREATE FUNCTION savings.set_target_goal(p_session_id uuid, p_customer_id uuid, p_goal_amount_minor bigint, p_goal_date date, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, customer_id uuid, goal_amount_minor bigint, goal_date date, updated_at timestamp with time zone)
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
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::bigint, NULL::date, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = p_customer_id AND c.merchant_id = v_merchant;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM tenancy.lock_branches(ARRAY[v_actor_branch], NULL);
  -- The customer (NKU): its goal changes only here, under that lock.
  PERFORM 1 FROM customers.customers c WHERE c.id = v_customer.id FOR NO KEY UPDATE;
  PERFORM 1 FROM savings.target_goals g WHERE g.customer_id = v_customer.id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'merchant.withdrawals.create') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::bigint, NULL::date, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_customer FROM customers.customers c WHERE c.id = v_customer.id;
  IF v_customer.id IS NULL
     OR (v_actor_branch IS NOT NULL AND (v_customer.branch_id <> v_actor_branch OR NOT EXISTS (
           SELECT 1 FROM tenancy.branches b WHERE b.id = v_actor_branch AND b.status = 'active'))) THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::bigint, NULL::date, NULL::timestamptz;
    RETURN;
  END IF;
  IF (p_goal_amount_minor IS NOT NULL AND p_goal_amount_minor NOT BETWEEN 1 AND 10000000000000)
     OR (p_goal_date IS NOT NULL AND p_goal_date < current_date) THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::bigint, NULL::date, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_customer.status <> 'active' THEN
    RETURN QUERY SELECT 'invalid_status', NULL::uuid, NULL::bigint, NULL::date, NULL::timestamptz;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM savings.target_goals g WHERE g.customer_id = v_customer.id) THEN
    UPDATE savings.target_goals g
       SET goal_amount_minor = p_goal_amount_minor, goal_date = p_goal_date, set_by_membership_id = v_actor,
           updated_at = now()
     WHERE g.customer_id = v_customer.id;
  ELSE
    -- The contested insert last (L3): one goal per customer.
    INSERT INTO savings.target_goals (merchant_id, customer_id, goal_amount_minor, goal_date, set_by_membership_id)
    VALUES (v_merchant, v_customer.id, p_goal_amount_minor, p_goal_date, v_actor);
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'savings.target_goal_set', 'customer', v_customer.id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('goalAmountMinor', p_goal_amount_minor::text, 'goalDate', p_goal_date::text));
  RETURN QUERY SELECT 'ok', g.customer_id, g.goal_amount_minor, g.goal_date, g.updated_at
                 FROM savings.target_goals g WHERE g.customer_id = v_customer.id;
END
$function$;

-- ── reads (B1, R19): the business from the session; a restricted staff member's branch only ──

-- A customer's savings at a glance — their enrolment, current cycle, balances, the collections awaiting confirmation
-- (BR-5.6) and their goal. Called only by the reads below, once they have resolved the customer from the session.
CREATE FUNCTION savings.summary_of(p_merchant_id uuid, p_customer_id uuid)
 RETURNS TABLE(customer_id uuid, package_id uuid, next_package_id uuid, enrolled_at timestamp with time zone, cycle_number integer, cycle_starts_on date, cycle_ends_on date, savings_minor bigint, target_minor bigint, pending_minor bigint, goal_amount_minor bigint, goal_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT p_customer_id, e.package_id, e.next_package_id, e.enrolled_at, y.number, y.starts_on, y.ends_on,
         coalesce((SELECT p.balance_minor FROM ledger.accounts a
                     JOIN ledger.balance_projection p ON p.merchant_id = a.merchant_id AND p.account_id = a.id
                    WHERE a.merchant_id = p_merchant_id AND a.code = '2100' AND a.subject_type = 'customer'
                      AND a.subject_id = p_customer_id), 0),
         coalesce((SELECT p.balance_minor FROM ledger.accounts a
                     JOIN ledger.balance_projection p ON p.merchant_id = a.merchant_id AND p.account_id = a.id
                    WHERE a.merchant_id = p_merchant_id AND a.code = '2110' AND a.subject_type = 'customer'
                      AND a.subject_id = p_customer_id), 0),
         (SELECT coalesce(sum(x.amount_minor), 0)::bigint FROM savings.collections x
           WHERE x.merchant_id = p_merchant_id AND x.customer_id = p_customer_id AND x.status = 'recorded'),
         g.goal_amount_minor, g.goal_date
    FROM (SELECT 1) one
    LEFT JOIN savings.enrolments e ON e.merchant_id = p_merchant_id AND e.customer_id = p_customer_id
    LEFT JOIN LATERAL (SELECT c.number, c.starts_on, c.ends_on FROM savings.cycles c
                        WHERE c.merchant_id = p_merchant_id AND c.customer_id = p_customer_id
                        ORDER BY c.number DESC LIMIT 1) y ON true
    LEFT JOIN savings.target_goals g ON g.merchant_id = p_merchant_id AND g.customer_id = p_customer_id;
$function$;

-- One of the business's customers' savings: merchant.savings.read, within the actor's branch.
CREATE FUNCTION savings.customer_savings(p_session_id uuid, p_customer_id uuid)
 RETURNS TABLE(customer_id uuid, package_id uuid, next_package_id uuid, enrolled_at timestamp with time zone, cycle_number integer, cycle_starts_on date, cycle_ends_on date, savings_minor bigint, target_minor bigint, pending_minor bigint, goal_amount_minor bigint, goal_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT x.*
    FROM identity.session_authority(p_session_id) s
    JOIN customers.customers c ON c.merchant_id = s.merchant_id AND c.id = p_customer_id
    CROSS JOIN LATERAL savings.summary_of(s.merchant_id, c.id) x
   WHERE s.audience = 'merchant' AND 'merchant.savings.read' = ANY (s.permissions)
     AND (s.branch_id IS NULL OR (c.branch_id = s.branch_id AND s.branch_status = 'active'));
$function$;

-- The signed-in customer's own savings (the customer audience).
CREATE FUNCTION savings.self_savings(p_session_id uuid)
 RETURNS TABLE(customer_id uuid, package_id uuid, next_package_id uuid, enrolled_at timestamp with time zone, cycle_number integer, cycle_starts_on date, cycle_ends_on date, savings_minor bigint, target_minor bigint, pending_minor bigint, goal_amount_minor bigint, goal_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT x.*
    FROM identity.validate_session(p_session_id) s
    JOIN customers.customers c ON c.merchant_id = s.merchant_id AND c.id = s.membership_id
    CROSS JOIN LATERAL savings.summary_of(s.merchant_id, c.id) x
   WHERE s.audience = 'customer';
$function$;

-- The business's packages, oldest first; or one of them; filtered by status.
CREATE FUNCTION savings.list_packages(p_session_id uuid, p_package_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, name text, kind text, amount_minor bigint, fee_rule text, fee_rate_bp integer, status text, created_at timestamp with time zone, updated_at timestamp with time zone, archived_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT p.id, p.name, p.kind, p.amount_minor, p.fee_rule, p.fee_rate_bp, p.status, p.created_at, p.updated_at,
         p.archived_at
    FROM identity.session_authority(p_session_id) s
    JOIN savings.packages p ON p.merchant_id = s.merchant_id
   WHERE s.audience = 'merchant' AND 'merchant.savings.read' = ANY (s.permissions)
     AND (p_package_id IS NULL OR p.id = p_package_id)
     AND (p_status IS NULL OR p.status = p_status)
   ORDER BY p.created_at, p.id
   LIMIT 500;
$function$;

-- A page of the business's collections, oldest first by (created_at, id), filtered by customer, agent, status and
-- remittance; a restricted staff member sees their branch's customers' only. One row more tells whether another follows.
CREATE FUNCTION savings.list_collections(p_session_id uuid, p_customer_id uuid DEFAULT NULL::uuid, p_agent_membership_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_remittance_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT NULL::integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, customer_id uuid, agent_membership_id uuid, package_id uuid, amount_minor bigint, days integer, collected_on date, status text, remittance_id uuid, cycle_id uuid, fee_minor bigint, created_at timestamp with time zone, approved_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100) THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT x.id, x.customer_id, x.agent_membership_id, x.package_id, x.amount_minor, x.days, x.collected_on, x.status,
         x.remittance_id, x.cycle_id, x.fee_minor, x.created_at, x.approved_at, x.cancelled_at, x.cancel_reason
    FROM identity.session_authority(p_session_id) s
    JOIN savings.collections x ON x.merchant_id = s.merchant_id
    JOIN customers.customers c ON c.merchant_id = s.merchant_id AND c.id = x.customer_id
   WHERE s.audience = 'merchant' AND 'merchant.savings.read' = ANY (s.permissions)
     AND (s.branch_id IS NULL OR (c.branch_id = s.branch_id AND s.branch_status = 'active'))
     AND (p_customer_id IS NULL OR x.customer_id = p_customer_id)
     AND (p_agent_membership_id IS NULL OR x.agent_membership_id = p_agent_membership_id)
     AND (p_status IS NULL OR x.status = p_status)
     AND (p_remittance_id IS NULL OR x.remittance_id = p_remittance_id)
     AND (p_after_id IS NULL OR (x.created_at, x.id) > (p_after_created_at, p_after_id))
   ORDER BY x.created_at, x.id
   LIMIT p_limit + 1;
END
$function$;

-- A page of the business's remittances, oldest first; a restricted staff member sees those of their branch's
-- customers only.
CREATE FUNCTION savings.list_remittances(p_session_id uuid, p_agent_membership_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT NULL::integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, agent_membership_id uuid, cash_minor bigint, collection_count integer, fee_total_minor bigint, approved_by_membership_id uuid, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100) THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT r.id, r.agent_membership_id, r.cash_minor, r.collection_count, r.fee_total_minor, r.approved_by_membership_id,
         r.created_at
    FROM identity.session_authority(p_session_id) s
    JOIN savings.remittances r ON r.merchant_id = s.merchant_id
   WHERE s.audience = 'merchant' AND 'merchant.savings.read' = ANY (s.permissions)
     AND (s.branch_id IS NULL OR (s.branch_status = 'active' AND NOT EXISTS (
           SELECT 1 FROM savings.collections x
             JOIN customers.customers c ON c.merchant_id = s.merchant_id AND c.id = x.customer_id
            WHERE x.merchant_id = s.merchant_id AND x.remittance_id = r.id AND c.branch_id <> s.branch_id)))
     AND (p_agent_membership_id IS NULL OR r.agent_membership_id = p_agent_membership_id)
     AND (p_after_id IS NULL OR (r.created_at, r.id) > (p_after_created_at, p_after_id))
   ORDER BY r.created_at, r.id
   LIMIT p_limit + 1;
END
$function$;

-- A page of a customer's withdrawals and moves, oldest first.
CREATE FUNCTION savings.list_movements(p_session_id uuid, p_customer_id uuid, p_limit integer DEFAULT NULL::integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, customer_id uuid, kind text, amount_minor bigint, entry_id uuid, made_by_membership_id uuid, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100) THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT x.id, x.customer_id, x.kind, x.amount_minor, x.entry_id, x.made_by_membership_id, x.created_at
    FROM identity.session_authority(p_session_id) s
    JOIN customers.customers c ON c.merchant_id = s.merchant_id AND c.id = p_customer_id
    JOIN savings.movements x ON x.merchant_id = s.merchant_id AND x.customer_id = c.id
   WHERE s.audience = 'merchant' AND 'merchant.savings.read' = ANY (s.permissions)
     AND (s.branch_id IS NULL OR (c.branch_id = s.branch_id AND s.branch_status = 'active'))
     AND (p_after_id IS NULL OR (x.created_at, x.id) > (p_after_created_at, p_after_id))
   ORDER BY x.created_at, x.id
   LIMIT p_limit + 1;
END
$function$;

-- The collections the signed-in agent recorded, oldest first, filtered by status.
CREATE FUNCTION savings.agent_collections(p_session_id uuid, p_status text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, customer_id uuid, package_id uuid, amount_minor bigint, days integer, collected_on date, status text, created_at timestamp with time zone, approved_at timestamp with time zone, cancelled_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100) THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT x.id, x.customer_id, x.package_id, x.amount_minor, x.days, x.collected_on, x.status, x.created_at,
         x.approved_at, x.cancelled_at
    FROM identity.session_authority(p_session_id) s
    JOIN savings.collections x ON x.merchant_id = s.merchant_id AND x.agent_membership_id = s.membership_id
   WHERE s.audience = 'agent'
     AND (p_status IS NULL OR x.status = p_status)
     AND (p_after_id IS NULL OR (x.created_at, x.id) > (p_after_created_at, p_after_id))
   ORDER BY x.created_at, x.id
   LIMIT p_limit + 1;
END
$function$;

-- The signed-in customer's collections, oldest first — pending ones included, "recorded by agent — awaiting
-- confirmation" (BR-5.6).
CREATE FUNCTION savings.self_collections(p_session_id uuid, p_limit integer DEFAULT NULL::integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, amount_minor bigint, days integer, collected_on date, status text, fee_minor bigint, created_at timestamp with time zone, approved_at timestamp with time zone, cancelled_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100) THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT x.id, x.amount_minor, x.days, x.collected_on, x.status, x.fee_minor, x.created_at, x.approved_at,
         x.cancelled_at
    FROM identity.validate_session(p_session_id) s
    JOIN savings.collections x ON x.merchant_id = s.merchant_id AND x.customer_id = s.membership_id
   WHERE s.audience = 'customer'
     AND (p_after_id IS NULL OR (x.created_at, x.id) > (p_after_created_at, p_after_id))
   ORDER BY x.created_at, x.id
   LIMIT p_limit + 1;
END
$function$;

-- The branch of one of the business's collections (its customer's), for the API's branch-scope decision before the
-- call (P5 §7.6); the command decides again. Any member of the business may ask; it reveals nothing else.
CREATE FUNCTION savings.collection_branch(p_session_id uuid, p_collection_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT c.branch_id
    FROM identity.session_authority(p_session_id) s
    JOIN savings.collections x ON x.merchant_id = s.merchant_id AND x.id = p_collection_id
    JOIN customers.customers c ON c.merchant_id = s.merchant_id AND c.id = x.customer_id
   WHERE s.audience = 'merchant';
$function$;

REVOKE ALL ON FUNCTION savings.package_result(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.collection_result(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.create_package(uuid, text, text, bigint, text, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.update_package(uuid, uuid, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.enrol_customer(uuid, uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.record_collection(uuid, uuid, bigint, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.cancel_collection(uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.approve_remittance(uuid, uuid, uuid[], bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.move_savings(uuid, uuid, text, bigint, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.set_target_goal(uuid, uuid, bigint, date, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.summary_of(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.customer_savings(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.self_savings(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.list_packages(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.list_collections(uuid, uuid, uuid, text, uuid, integer, timestamp with time zone, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.list_remittances(uuid, uuid, integer, timestamp with time zone, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.list_movements(uuid, uuid, integer, timestamp with time zone, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.agent_collections(uuid, text, integer, timestamp with time zone, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.self_collections(uuid, integer, timestamp with time zone, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.collection_branch(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION savings.create_package(uuid, text, text, bigint, text, integer, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.update_package(uuid, uuid, jsonb, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.enrol_customer(uuid, uuid, uuid, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.record_collection(uuid, uuid, bigint, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.cancel_collection(uuid, uuid, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.approve_remittance(uuid, uuid, uuid[], bigint, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.move_savings(uuid, uuid, text, bigint, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.set_target_goal(uuid, uuid, bigint, date, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.customer_savings(uuid, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.self_savings(uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.list_packages(uuid, uuid, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.list_collections(uuid, uuid, uuid, text, uuid, integer, timestamp with time zone, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.list_remittances(uuid, uuid, integer, timestamp with time zone, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.list_movements(uuid, uuid, integer, timestamp with time zone, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.agent_collections(uuid, text, integer, timestamp with time zone, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.self_collections(uuid, integer, timestamp with time zone, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION savings.collection_branch(uuid, uuid) TO alphakolect_app;
