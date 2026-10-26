-- P8: savings — the tables, their lock helpers, and the agent's cash account
-- (docs/architecture/P8_IMPLEMENTATION_PLAN.md §3; the owner's answers of 2026-10-25, docs/business/P8_OWNER_SAVINGS.md).
--
-- - savings.packages (Q1, Q2; BR-6.1): a name, a kind (fixed: each collection the amount or a multiple of it; flexible:
--   any amount from a minimum), the amount, and exactly one fee rule — the first contribution of a cycle, or a
--   percentage in basis points. The terms never change once written (P8-7): a business that wants other terms creates a
--   package; a package is renamed or archived only.
-- - savings.enrolments (BR-5.1, Q10): one per customer — the package now, and the package of the next cycle when a
--   change waits for the current cycle to end.
-- - savings.cycles (BR-5.2, Q3): 31 days from the first contribution; the next starts with the first contribution after
--   them. Opened when that contribution is approved (BR-5.6).
-- - savings.collections (BR-3, 5.3, 5.6): a cash collection an agent records — recorded, then approved in a remittance
--   or cancelled (Q6). A collection names at most one remittance (TA-13). The agent's key makes a retried recording
--   record once.
-- - savings.remittances (Q5): an agent's cash, approved for the collections it covers.
-- - savings.movements (BR-7, Q8, Q9): withdrawals to cash from savings or target savings, and moves into target savings;
--   the staff member's key makes a retried request move money once.
-- - savings.target_goals (Q9): a customer's optional goal.
-- - The lock helpers savings.lock_enrolments and savings.lock_collections (L5: one sorted acquisition per call; TA-13).
-- - P8-4: an agent's cash account (1210) is opened when the agent is first given a customer — the only customers they
--   record for (D1) — and for every agent who has customers now.
-- Every table is reached only through definer functions (B1): RLS and an app policy, no app privilege.
-- Forward-only; earlier migrations untouched.

GRANT USAGE ON SCHEMA savings TO alphakolect_app, alphakolect_readonly;

CREATE TABLE savings.packages (
  id                       uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id              uuid NOT NULL,
  name                     text NOT NULL,
  kind                     text NOT NULL,
  amount_minor             bigint NOT NULL,
  fee_rule                 text NOT NULL,
  fee_rate_bp              integer,
  status                   text NOT NULL DEFAULT 'active',
  created_by_membership_id uuid,
  created_at               timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at              timestamptz(6),
  CONSTRAINT packages_pkey PRIMARY KEY (id),
  CONSTRAINT packages_merchant_id_id_key UNIQUE (merchant_id, id),
  CONSTRAINT packages_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT packages_created_by_fkey FOREIGN KEY (merchant_id, created_by_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT packages_name_valid CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT packages_kind_valid CHECK (kind IN ('fixed', 'flexible')),
  CONSTRAINT packages_amount_valid CHECK (amount_minor BETWEEN 1 AND 10000000000000),
  -- BR-6.1: exactly one fee rule; a percentage has its rate, the first contribution none.
  CONSTRAINT packages_fee_rule_valid CHECK (fee_rule IN ('first_contribution', 'percentage')),
  CONSTRAINT packages_fee_rate_valid CHECK (
    (fee_rule = 'percentage' AND fee_rate_bp BETWEEN 1 AND 10000) OR (fee_rule = 'first_contribution' AND fee_rate_bp IS NULL)),
  CONSTRAINT packages_status_valid CHECK (status IN ('active', 'archived')),
  CONSTRAINT packages_archived_consistent CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
-- One active package per name within a business.
CREATE UNIQUE INDEX packages_one_active_name ON savings.packages (merchant_id, lower(name)) WHERE status = 'active';
CREATE INDEX packages_merchant_created_idx ON savings.packages (merchant_id, created_at, id);

CREATE TABLE savings.enrolments (
  id                       uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id              uuid NOT NULL,
  customer_id              uuid NOT NULL,
  package_id               uuid NOT NULL,
  next_package_id          uuid,
  enrolled_by_membership_id uuid,
  enrolled_at              timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT enrolments_pkey PRIMARY KEY (id),
  CONSTRAINT enrolments_merchant_id_id_key UNIQUE (merchant_id, id),
  -- BR-5.1: one package at a time — one enrolment per customer.
  CONSTRAINT enrolments_customer_id_key UNIQUE (customer_id),
  CONSTRAINT enrolments_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT enrolments_customer_fkey FOREIGN KEY (merchant_id, customer_id)
    REFERENCES customers.customers (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT enrolments_package_fkey FOREIGN KEY (merchant_id, package_id)
    REFERENCES savings.packages (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT enrolments_next_package_fkey FOREIGN KEY (merchant_id, next_package_id)
    REFERENCES savings.packages (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT enrolments_enrolled_by_fkey FOREIGN KEY (merchant_id, enrolled_by_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT enrolments_next_differs CHECK (next_package_id IS NULL OR next_package_id <> package_id)
);

CREATE TABLE savings.cycles (
  id          uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  package_id  uuid NOT NULL,
  number      integer NOT NULL,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  created_at  timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT cycles_pkey PRIMARY KEY (id),
  CONSTRAINT cycles_merchant_id_id_key UNIQUE (merchant_id, id),
  CONSTRAINT cycles_customer_number_key UNIQUE (customer_id, number),
  CONSTRAINT cycles_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT cycles_customer_fkey FOREIGN KEY (merchant_id, customer_id)
    REFERENCES customers.customers (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT cycles_package_fkey FOREIGN KEY (merchant_id, package_id)
    REFERENCES savings.packages (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT cycles_number_valid CHECK (number >= 1),
  -- BR-5.2: 31 days, the first day included.
  CONSTRAINT cycles_length_valid CHECK (ends_on = starts_on + 30)
);

CREATE TABLE savings.remittances (
  id                        uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id               uuid NOT NULL,
  agent_membership_id       uuid NOT NULL,
  cash_minor                bigint NOT NULL,
  collection_count          integer NOT NULL,
  fee_total_minor           bigint NOT NULL,
  approved_by_membership_id uuid NOT NULL,
  created_at                timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT remittances_pkey PRIMARY KEY (id),
  CONSTRAINT remittances_merchant_id_id_key UNIQUE (merchant_id, id),
  CONSTRAINT remittances_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT remittances_agent_fkey FOREIGN KEY (merchant_id, agent_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT remittances_approved_by_fkey FOREIGN KEY (merchant_id, approved_by_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT remittances_cash_valid CHECK (cash_minor > 0),
  CONSTRAINT remittances_count_valid CHECK (collection_count BETWEEN 1 AND 200),
  CONSTRAINT remittances_fee_valid CHECK (fee_total_minor BETWEEN 0 AND cash_minor)
);
CREATE INDEX remittances_merchant_created_idx ON savings.remittances (merchant_id, created_at, id);

CREATE TABLE savings.collections (
  id                         uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id                uuid NOT NULL,
  customer_id                uuid NOT NULL,
  agent_membership_id        uuid NOT NULL,
  package_id                 uuid NOT NULL,
  amount_minor               bigint NOT NULL,
  days                       integer,
  collected_on               date NOT NULL,
  status                     text NOT NULL DEFAULT 'recorded',
  idem_key                   text NOT NULL,
  recorded_entry_id          uuid NOT NULL,
  remittance_id              uuid,
  cycle_id                   uuid,
  confirmed_entry_id         uuid,
  fee_entry_id               uuid,
  fee_minor                  bigint,
  approved_at                timestamptz(6),
  cancelled_at               timestamptz(6),
  cancelled_by_membership_id uuid,
  cancel_reason              text,
  cancel_entry_id            uuid,
  created_at                 timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT collections_pkey PRIMARY KEY (id),
  CONSTRAINT collections_merchant_id_id_key UNIQUE (merchant_id, id),
  -- A retried recording records once: the agent's key is unique per agent.
  CONSTRAINT collections_agent_key UNIQUE (merchant_id, agent_membership_id, idem_key),
  CONSTRAINT collections_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT collections_customer_fkey FOREIGN KEY (merchant_id, customer_id)
    REFERENCES customers.customers (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT collections_agent_fkey FOREIGN KEY (merchant_id, agent_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT collections_package_fkey FOREIGN KEY (merchant_id, package_id)
    REFERENCES savings.packages (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- TA-13: one column, so a collection belongs to at most one remittance.
  CONSTRAINT collections_remittance_fkey FOREIGN KEY (merchant_id, remittance_id)
    REFERENCES savings.remittances (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT collections_cycle_fkey FOREIGN KEY (merchant_id, cycle_id)
    REFERENCES savings.cycles (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT collections_cancelled_by_fkey FOREIGN KEY (merchant_id, cancelled_by_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT collections_recorded_entry_fkey FOREIGN KEY (merchant_id, recorded_entry_id)
    REFERENCES ledger.journal_entries (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT collections_confirmed_entry_fkey FOREIGN KEY (merchant_id, confirmed_entry_id)
    REFERENCES ledger.journal_entries (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT collections_fee_entry_fkey FOREIGN KEY (merchant_id, fee_entry_id)
    REFERENCES ledger.journal_entries (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT collections_cancel_entry_fkey FOREIGN KEY (merchant_id, cancel_entry_id)
    REFERENCES ledger.journal_entries (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT collections_amount_valid CHECK (amount_minor BETWEEN 1 AND 10000000000000),
  CONSTRAINT collections_days_valid CHECK (days IS NULL OR days BETWEEN 1 AND 31),
  CONSTRAINT collections_key_valid CHECK (idem_key ~ '^[\x21-\x7e]{1,255}$'),
  CONSTRAINT collections_status_valid CHECK (status IN ('recorded', 'approved', 'cancelled')),
  CONSTRAINT collections_approval_consistent CHECK (
    (status = 'approved') = (remittance_id IS NOT NULL)
    AND (status = 'approved') = (cycle_id IS NOT NULL)
    AND (status = 'approved') = (confirmed_entry_id IS NOT NULL)
    AND (status = 'approved') = (approved_at IS NOT NULL)
    AND (status = 'approved') = (fee_minor IS NOT NULL)
    AND (fee_entry_id IS NULL OR status = 'approved')),
  CONSTRAINT collections_fee_valid CHECK (fee_minor IS NULL OR fee_minor BETWEEN 0 AND amount_minor),
  CONSTRAINT collections_cancellation_consistent CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL)
    AND (status = 'cancelled') = (cancel_entry_id IS NOT NULL)
    AND (status = 'cancelled') = (cancel_reason IS NOT NULL)),
  CONSTRAINT collections_reason_valid CHECK (cancel_reason IS NULL OR char_length(btrim(cancel_reason)) BETWEEN 1 AND 300)
);
CREATE INDEX collections_merchant_created_idx ON savings.collections (merchant_id, created_at, id);
CREATE INDEX collections_customer_idx ON savings.collections (customer_id, created_at, id);
CREATE INDEX collections_agent_status_idx ON savings.collections (merchant_id, agent_membership_id, status, created_at, id);
CREATE INDEX collections_remittance_idx ON savings.collections (remittance_id) WHERE remittance_id IS NOT NULL;

CREATE TABLE savings.movements (
  id                    uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id           uuid NOT NULL,
  customer_id           uuid NOT NULL,
  kind                  text NOT NULL,
  amount_minor          bigint NOT NULL,
  entry_id              uuid NOT NULL,
  made_by_membership_id uuid NOT NULL,
  idem_key              text NOT NULL,
  created_at            timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT movements_pkey PRIMARY KEY (id),
  CONSTRAINT movements_merchant_id_id_key UNIQUE (merchant_id, id),
  -- A retried request moves money once: the staff member's key is unique per staff member.
  CONSTRAINT movements_actor_key UNIQUE (merchant_id, made_by_membership_id, idem_key),
  CONSTRAINT movements_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movements_customer_fkey FOREIGN KEY (merchant_id, customer_id)
    REFERENCES customers.customers (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movements_made_by_fkey FOREIGN KEY (merchant_id, made_by_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movements_entry_fkey FOREIGN KEY (merchant_id, entry_id)
    REFERENCES ledger.journal_entries (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movements_kind_valid CHECK (kind IN ('savings_withdrawal', 'target_withdrawal', 'to_target')),
  CONSTRAINT movements_amount_valid CHECK (amount_minor BETWEEN 1 AND 10000000000000),
  CONSTRAINT movements_key_valid CHECK (idem_key ~ '^[\x21-\x7e]{1,255}$')
);
CREATE INDEX movements_customer_idx ON savings.movements (customer_id, created_at, id);

CREATE TABLE savings.target_goals (
  id                     uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id            uuid NOT NULL,
  customer_id            uuid NOT NULL,
  goal_amount_minor      bigint,
  goal_date              date,
  set_by_membership_id   uuid NOT NULL,
  updated_at             timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT target_goals_pkey PRIMARY KEY (id),
  CONSTRAINT target_goals_merchant_id_id_key UNIQUE (merchant_id, id),
  CONSTRAINT target_goals_customer_id_key UNIQUE (customer_id),
  CONSTRAINT target_goals_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT target_goals_customer_fkey FOREIGN KEY (merchant_id, customer_id)
    REFERENCES customers.customers (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT target_goals_set_by_fkey FOREIGN KEY (merchant_id, set_by_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT target_goals_amount_valid CHECK (goal_amount_minor IS NULL OR goal_amount_minor BETWEEN 1 AND 10000000000000)
);

-- Row-level security on every tenant table; the app holds no privilege (B1): the functions are its only way in.
ALTER TABLE savings.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings.enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings.cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings.remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings.movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings.target_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY packages_app_own_tenant ON savings.packages TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY enrolments_app_own_tenant ON savings.enrolments TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY cycles_app_own_tenant ON savings.cycles TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY remittances_app_own_tenant ON savings.remittances TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY collections_app_own_tenant ON savings.collections TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY movements_app_own_tenant ON savings.movements TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY target_goals_app_own_tenant ON savings.target_goals TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY packages_readonly_all ON savings.packages FOR SELECT TO alphakolect_readonly USING (true);
CREATE POLICY enrolments_readonly_all ON savings.enrolments FOR SELECT TO alphakolect_readonly USING (true);
CREATE POLICY cycles_readonly_all ON savings.cycles FOR SELECT TO alphakolect_readonly USING (true);
CREATE POLICY remittances_readonly_all ON savings.remittances FOR SELECT TO alphakolect_readonly USING (true);
CREATE POLICY collections_readonly_all ON savings.collections FOR SELECT TO alphakolect_readonly USING (true);
CREATE POLICY movements_readonly_all ON savings.movements FOR SELECT TO alphakolect_readonly USING (true);
CREATE POLICY target_goals_readonly_all ON savings.target_goals FOR SELECT TO alphakolect_readonly USING (true);
REVOKE ALL ON savings.packages, savings.enrolments, savings.cycles, savings.remittances, savings.collections,
  savings.movements, savings.target_goals FROM alphakolect_app;
GRANT SELECT ON savings.packages, savings.enrolments, savings.cycles, savings.remittances, savings.collections,
  savings.movements, savings.target_goals TO alphakolect_readonly;

-- ── category 17: the enrolments and the collections, one sorted acquisition each (L5; TA-13) ──
CREATE FUNCTION savings.lock_enrolments(p_share uuid[], p_no_key_update uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_row    record;
  v_locked integer := 0;
BEGIN
  FOR v_row IN
    SELECT x.id, bool_or(x.nku) AS nku
      FROM (SELECT unnest(p_share) AS id, false AS nku
            UNION ALL
            SELECT unnest(p_no_key_update), true) x
     WHERE x.id IS NOT NULL
     GROUP BY x.id
     ORDER BY x.id
  LOOP
    IF v_row.nku THEN
      PERFORM 1 FROM savings.enrolments t WHERE t.id = v_row.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM savings.enrolments t WHERE t.id = v_row.id FOR SHARE;
    END IF;
    IF FOUND THEN
      v_locked := v_locked + 1;
    END IF;
  END LOOP;
  RETURN v_locked;
END
$function$;

CREATE FUNCTION savings.lock_collections(p_share uuid[], p_no_key_update uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_row    record;
  v_locked integer := 0;
BEGIN
  FOR v_row IN
    SELECT x.id, bool_or(x.nku) AS nku
      FROM (SELECT unnest(p_share) AS id, false AS nku
            UNION ALL
            SELECT unnest(p_no_key_update), true) x
     WHERE x.id IS NOT NULL
     GROUP BY x.id
     ORDER BY x.id
  LOOP
    IF v_row.nku THEN
      PERFORM 1 FROM savings.collections t WHERE t.id = v_row.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM savings.collections t WHERE t.id = v_row.id FOR SHARE;
    END IF;
    IF FOUND THEN
      v_locked := v_locked + 1;
    END IF;
  END LOOP;
  RETURN v_locked;
END
$function$;
REVOKE ALL ON FUNCTION savings.lock_enrolments(uuid[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION savings.lock_collections(uuid[], uuid[]) FROM PUBLIC;

-- ── P8-4: an agent's cash account, opened when the agent is first given a customer ──
CREATE OR REPLACE FUNCTION customers.insert_customer_locked(p_merchant_id uuid, p_branch_id uuid, p_full_name text, p_phone text, p_email text, p_address text, p_nickname text, p_agent_membership_id uuid, p_actor_identity_id uuid, p_actor_membership_id uuid, p_actor_audience text, p_ip text, p_user_agent text, p_request_id text)
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
  -- P8-4: the agent's cash account (1210), opened when the agent is first given a customer.
  IF p_agent_membership_id IS NOT NULL THEN
    PERFORM ledger.open_subaccount(v_ledger, '1210', 'agent', p_agent_membership_id);
  END IF;
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

CREATE OR REPLACE FUNCTION customers.assign_agent(p_session_id uuid, p_customer_id uuid, p_agent_membership_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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
  v_ledger uuid;
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
    -- P8-4: the agent's cash account (1210), opened when the agent is first given a customer.
    SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = v_merchant;
    PERFORM ledger.open_subaccount(v_ledger, '1210', 'agent', p_agent_membership_id);
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

-- Every agent who has customers now.
SELECT ledger.open_subaccount(l.id, '1210', 'agent', a.agent_membership_id)
  FROM (SELECT DISTINCT x.merchant_id, x.agent_membership_id FROM customers.assignments x WHERE x.ended_at IS NULL) a
  JOIN ledger.ledgers l ON l.merchant_id = a.merchant_id;
