-- P7: customers — the tables, the customer audience, and the ledger's customer check
-- (docs/architecture/P7_IMPLEMENTATION_PLAN.md §3, §9.1; the owner's answers of 2026-10-25,
-- docs/business/P7_OWNER_CUSTOMERS.md).
--
-- - customers.customers: a business's customers (Q1–Q3, Q6, Q8): name and phone required, email, address and nickname
--   optional; one branch each; one customer per phone number within a business (normalised, P7-10); one record per
--   person per business; active, deactivated or anonymised (BR-11.3, Q9).
-- - customers.assignments (D1, Q5): every period an agent holds a customer; at most one open.
-- - customers.app_invitations (Q7, P7-9): the link a business sends a customer for the mobile app.
-- - The customer audience (P7-7): a session names the customer record; the identity functions learn the audience; a
--   deactivated or anonymised customer's sessions fail validation at once (P7-8).
-- - ledger.open_subaccount checks a customer subject (closes P6-11).
-- Every table is reached only through definer functions (B1): RLS and an app policy, no app privilege.
-- Forward-only; earlier migrations untouched.

GRANT USAGE ON SCHEMA customers TO alphakolect_app, alphakolect_readonly;

-- ── phone numbers, normalised one way for every writer (P7-10) ──
-- Spaces, dashes, dots and brackets removed; a Nigerian number written 0XXXXXXXXXX becomes +234XXXXXXXXXX. NULL when
-- what is left is not 7 to 15 digits with an optional leading +.
CREATE FUNCTION customers.normalise_phone(p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT CASE
           WHEN v ~ '^0[0-9]{10}$' THEN '+234' || substr(v, 2)
           WHEN v ~ '^\+?[0-9]{7,15}$' THEN v
         END
    FROM (SELECT regexp_replace(coalesce(p_phone, ''), '[[:space:]().-]', '', 'g') AS v) x;
$function$;
REVOKE ALL ON FUNCTION customers.normalise_phone(text) FROM PUBLIC;

CREATE TABLE customers.customers (
  id                       uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id              uuid NOT NULL,
  branch_id                uuid NOT NULL,
  full_name                text NOT NULL,
  phone                    text,
  email                    text,
  address                  text,
  nickname                 text,
  status                   text NOT NULL DEFAULT 'active',
  identity_id              uuid,
  created_by_membership_id uuid,
  created_at               timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deactivated_at           timestamptz(6),
  anonymised_at            timestamptz(6),
  CONSTRAINT customers_pkey PRIMARY KEY (id),
  CONSTRAINT customers_merchant_id_id_key UNIQUE (merchant_id, id),
  CONSTRAINT customers_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT customers_branch_fkey FOREIGN KEY (merchant_id, branch_id) REFERENCES tenancy.branches (merchant_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT customers_identity_fkey FOREIGN KEY (identity_id) REFERENCES identity.identities (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT customers_created_by_fkey FOREIGN KEY (merchant_id, created_by_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT customers_status_valid CHECK (status IN ('active', 'deactivated', 'anonymised')),
  CONSTRAINT customers_deactivation_consistent CHECK ((status = 'deactivated') = (deactivated_at IS NOT NULL)),
  CONSTRAINT customers_anonymisation_consistent CHECK ((status = 'anonymised') = (anonymised_at IS NOT NULL)),
  -- An anonymised customer keeps no personal detail and no sign-in (BR-11.3).
  CONSTRAINT customers_anonymised_has_no_details CHECK (
    status <> 'anonymised'
    OR (full_name = 'Removed customer' AND phone IS NULL AND email IS NULL AND address IS NULL AND nickname IS NULL
        AND identity_id IS NULL)),
  CONSTRAINT customers_details_present CHECK (status = 'anonymised' OR phone IS NOT NULL),
  CONSTRAINT customers_name_valid CHECK (full_name = btrim(full_name) AND char_length(full_name) BETWEEN 1 AND 120),
  CONSTRAINT customers_phone_normalised CHECK (phone IS NULL OR phone = customers.normalise_phone(phone)),
  CONSTRAINT customers_email_shape CHECK (
    email IS NULL OR (email = lower(btrim(email)) AND length(email) <= 254
                      AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  CONSTRAINT customers_address_valid CHECK (address IS NULL OR char_length(btrim(address)) BETWEEN 1 AND 300),
  CONSTRAINT customers_nickname_valid CHECK (nickname IS NULL OR char_length(btrim(nickname)) BETWEEN 1 AND 60)
);
-- One customer per phone number within a business, among customers not anonymised (Q2).
CREATE UNIQUE INDEX customers_one_per_phone ON customers.customers (merchant_id, phone) WHERE status <> 'anonymised';
-- One customer record per person per business (Q3).
CREATE UNIQUE INDEX customers_one_per_identity ON customers.customers (merchant_id, identity_id)
  WHERE identity_id IS NOT NULL;
CREATE INDEX customers_merchant_branch_idx ON customers.customers (merchant_id, branch_id, created_at, id);
CREATE INDEX customers_identity_idx ON customers.customers (identity_id) WHERE identity_id IS NOT NULL;

CREATE TABLE customers.assignments (
  id                        uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id               uuid NOT NULL,
  customer_id               uuid NOT NULL,
  agent_membership_id       uuid NOT NULL,
  assigned_at               timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at                  timestamptz(6),
  assigned_by_membership_id uuid,
  ended_by_membership_id    uuid,
  CONSTRAINT assignments_pkey PRIMARY KEY (id),
  CONSTRAINT assignments_merchant_id_id_key UNIQUE (merchant_id, id),
  CONSTRAINT assignments_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assignments_customer_fkey FOREIGN KEY (merchant_id, customer_id)
    REFERENCES customers.customers (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assignments_agent_fkey FOREIGN KEY (merchant_id, agent_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assignments_assigned_by_fkey FOREIGN KEY (merchant_id, assigned_by_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assignments_ended_by_fkey FOREIGN KEY (merchant_id, ended_by_membership_id)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT assignments_period_valid CHECK (ended_at IS NULL OR ended_at >= assigned_at)
);
-- At most one agent at a time (Q5).
CREATE UNIQUE INDEX assignments_one_open ON customers.assignments (customer_id) WHERE ended_at IS NULL;
CREATE INDEX assignments_agent_open_idx ON customers.assignments (merchant_id, agent_membership_id)
  WHERE ended_at IS NULL;
CREATE INDEX assignments_customer_idx ON customers.assignments (customer_id, assigned_at, id);

CREATE TABLE customers.app_invitations (
  id          uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  token_hash  char(64) NOT NULL,
  expires_at  timestamptz(6) NOT NULL,
  accepted_at timestamptz(6),
  revoked_at  timestamptz(6),
  created_at  timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT app_invitations_pkey PRIMARY KEY (id),
  CONSTRAINT app_invitations_merchant_id_id_key UNIQUE (merchant_id, id),
  CONSTRAINT app_invitations_token_hash_key UNIQUE (token_hash),
  CONSTRAINT app_invitations_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT app_invitations_customer_fkey FOREIGN KEY (merchant_id, customer_id)
    REFERENCES customers.customers (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT app_invitations_identity_fkey FOREIGN KEY (identity_id) REFERENCES identity.identities (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT app_invitations_token_hash_hex CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT app_invitations_one_end CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT app_invitations_expiry_after_creation CHECK (expires_at > created_at)
);
-- One open link per customer: a new one replaces the old.
CREATE UNIQUE INDEX app_invitations_one_open ON customers.app_invitations (customer_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Row-level security on every tenant table; the app holds no privilege (B1): the functions are its only way in.
ALTER TABLE customers.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers.app_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_app_own_tenant ON customers.customers TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY assignments_app_own_tenant ON customers.assignments TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY app_invitations_app_own_tenant ON customers.app_invitations TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY customers_readonly_all ON customers.customers FOR SELECT TO alphakolect_readonly USING (true);
CREATE POLICY assignments_readonly_all ON customers.assignments FOR SELECT TO alphakolect_readonly USING (true);
REVOKE ALL ON customers.customers, customers.assignments, customers.app_invitations FROM alphakolect_app;
-- Reporting reads customers and their agents; never the invitation tokens.
GRANT SELECT ON customers.customers, customers.assignments TO alphakolect_readonly;

-- ── the customer audience (P7-7) ──
ALTER TABLE identity.sessions ADD COLUMN customer_id uuid;
ALTER TABLE identity.sessions
  ADD CONSTRAINT sessions_customer_fkey FOREIGN KEY (customer_id) REFERENCES customers.customers (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  DROP CONSTRAINT sessions_audience_valid,
  ADD CONSTRAINT sessions_audience_valid CHECK (audience IN ('platform', 'merchant', 'agent', 'customer')),
  DROP CONSTRAINT sessions_membership_matches_audience,
  ADD CONSTRAINT sessions_membership_matches_audience CHECK (
    (audience = 'platform' AND platform_membership_id IS NOT NULL AND merchant_membership_id IS NULL
     AND customer_id IS NULL)
    OR (audience IN ('merchant', 'agent') AND merchant_membership_id IS NOT NULL AND platform_membership_id IS NULL
        AND customer_id IS NULL)
    OR (audience = 'customer' AND customer_id IS NOT NULL AND platform_membership_id IS NULL
        AND merchant_membership_id IS NULL));
CREATE INDEX sessions_customer_idx ON identity.sessions (customer_id) WHERE customer_id IS NOT NULL;
ALTER TABLE identity.membership_selection_challenges
  DROP CONSTRAINT membership_selection_challenges_audience_valid,
  ADD CONSTRAINT membership_selection_challenges_audience_valid
    CHECK (audience IN ('platform', 'merchant', 'agent', 'customer'));
ALTER TABLE audit.audit_events
  DROP CONSTRAINT audit_events_actor_audience_valid,
  ADD CONSTRAINT audit_events_actor_audience_valid
    CHECK (actor_audience IS NULL OR actor_audience IN ('merchant', 'agent', 'platform', 'customer'));

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
  UNION ALL
  -- P7: a customer signs in as their customer record of one business: active, with this sign-in, the business active.
  SELECT c.id FROM customers.customers c
    JOIN tenancy.merchants m ON m.id = c.merchant_id AND m.status = 'active'
   WHERE p_audience = 'customer' AND c.id = p_membership_id AND c.identity_id = p_identity_id AND c.status = 'active'
  LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION identity.eligible_memberships(p_identity_id uuid, p_audience text)
 RETURNS TABLE(membership_id uuid, merchant_id uuid, merchant_name text, kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT x.membership_id, x.merchant_id, x.merchant_name, x.kind
    FROM identity.identities i
    CROSS JOIN LATERAL (
      SELECT pm.id AS membership_id, NULL::uuid AS merchant_id, NULL::text AS merchant_name, pm.role AS kind
        FROM identity.platform_memberships pm
       WHERE p_audience = 'platform' AND pm.identity_id = i.id AND pm.status = 'active'
      UNION ALL
      SELECT mm.id, m.id, m.name, mm.kind
        FROM tenancy.merchant_memberships mm
        JOIN tenancy.merchants m ON m.id = mm.merchant_id AND m.status = 'active'
       WHERE mm.identity_id = i.id AND mm.status = 'active'
         AND ((p_audience = 'merchant' AND mm.kind IN ('owner', 'staff')) OR (p_audience = 'agent' AND mm.kind = 'agent'))
      UNION ALL
      -- P7: each business the person saves with, by their customer record there
      SELECT c.id, m.id, m.name, 'customer'
        FROM customers.customers c
        JOIN tenancy.merchants m ON m.id = c.merchant_id AND m.status = 'active'
       WHERE p_audience = 'customer' AND c.identity_id = i.id AND c.status = 'active'
    ) x
   WHERE i.id = p_identity_id AND i.status = 'active'
   ORDER BY x.merchant_name NULLS FIRST, x.membership_id;
$function$;

CREATE OR REPLACE FUNCTION "identity"."session_limits"(p_audience text, p_scope text, OUT idle_max integer, OUT absolute_max integer)
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN p_scope = 'mfa_enrollment' THEN 900
           WHEN p_audience = 'platform' THEN 3600
           WHEN p_audience = 'merchant' THEN 86400
           WHEN p_audience = 'agent' THEN 2592000
           WHEN p_audience = 'customer' THEN 2592000
         END,
         CASE
           WHEN p_scope = 'mfa_enrollment' THEN 900
           WHEN p_audience = 'platform' THEN 43200
           WHEN p_audience = 'merchant' THEN 1209600
           WHEN p_audience = 'agent' THEN 7776000
           WHEN p_audience = 'customer' THEN 7776000
         END;
$fn$;

CREATE OR REPLACE FUNCTION "identity"."create_session"(
  p_identity_id uuid, p_audience text, p_membership_id uuid, p_scope text, p_refresh_hash text,
  p_idle_seconds integer, p_absolute_seconds integer, p_ip text, p_user_agent text
) RETURNS TABLE (session_id uuid, refresh_expires_at timestamptz, absolute_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_limits record;
  v_session uuid;
  v_absolute timestamptz;
  v_refresh timestamptz;
BEGIN
  SELECT * INTO v_limits FROM identity.session_limits(p_audience, p_scope);
  IF v_limits.idle_max IS NULL THEN
    RAISE EXCEPTION 'unsupported audience' USING ERRCODE = 'check_violation';
  END IF;
  IF p_idle_seconds < 1 OR p_idle_seconds > v_limits.idle_max
     OR p_absolute_seconds < p_idle_seconds OR p_absolute_seconds > v_limits.absolute_max THEN
    RAISE EXCEPTION 'session lifetime out of range for %', p_audience USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.identities i WHERE i.id = p_identity_id AND i.status = 'active') THEN
    RAISE EXCEPTION 'identity is not active' USING ERRCODE = 'check_violation';
  END IF;
  IF identity.active_membership(p_identity_id, p_audience, p_membership_id) IS NULL THEN
    RAISE EXCEPTION 'no active membership for this audience' USING ERRCODE = 'check_violation';
  END IF;
  IF p_audience = 'platform' AND p_scope = 'full' AND NOT EXISTS (
       SELECT 1 FROM identity.totp_credentials t WHERE t.identity_id = p_identity_id AND t.confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'platform sessions require a confirmed second factor' USING ERRCODE = 'check_violation';
  END IF;

  v_absolute := now() + make_interval(secs => p_absolute_seconds);
  v_refresh := least(now() + make_interval(secs => p_idle_seconds), v_absolute);

  INSERT INTO identity.sessions
    (identity_id, audience, platform_membership_id, merchant_membership_id, customer_id, scope, absolute_expires_at,
     created_ip, user_agent)
  VALUES
    (p_identity_id, p_audience,
     CASE WHEN p_audience = 'platform' THEN p_membership_id END,
     CASE WHEN p_audience IN ('merchant', 'agent') THEN p_membership_id END,
     CASE WHEN p_audience = 'customer' THEN p_membership_id END,
     p_scope, v_absolute, p_ip, left(p_user_agent, 512))
  RETURNING id INTO v_session;

  INSERT INTO identity.refresh_tokens (session_id, token_hash, expires_at) VALUES (v_session, p_refresh_hash, v_refresh);

  RETURN QUERY SELECT v_session, v_refresh, v_absolute;
END
$fn$;

CREATE OR REPLACE FUNCTION "identity"."validate_session"(p_session_id uuid)
RETURNS TABLE (
  identity_id uuid, audience text, membership_id uuid, merchant_id uuid, scope text,
  kind text, role_id uuid, branch_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.identity_id, s.audience, coalesce(s.platform_membership_id, s.merchant_membership_id, s.customer_id),
         coalesce(mm.merchant_id, c.merchant_id),
         s.scope,
         coalesce(mm.kind, pm.role, CASE WHEN c.id IS NOT NULL THEN 'customer' END), mm.role_id,
         coalesce(mm.branch_id, c.branch_id)
    FROM identity.sessions s
    JOIN identity.identities i ON i.id = s.identity_id AND i.status = 'active'
    LEFT JOIN tenancy.merchant_memberships mm ON mm.id = s.merchant_membership_id
    LEFT JOIN identity.platform_memberships pm ON pm.id = s.platform_membership_id
    LEFT JOIN customers.customers c ON c.id = s.customer_id
   WHERE s.id = p_session_id
     AND s.revoked_at IS NULL
     AND s.absolute_expires_at > now()
     AND identity.active_membership(s.identity_id, s.audience,
                                    coalesce(s.platform_membership_id, s.merchant_membership_id, s.customer_id)) IS NOT NULL;
$fn$;

CREATE OR REPLACE FUNCTION identity.rotate_refresh_token(p_old_hash text, p_new_hash text, p_idle_seconds integer, p_audiences text[])
 RETURNS TABLE(outcome text, session_id uuid, identity_id uuid, audience text, membership_id uuid, scope text, refresh_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_token identity.refresh_tokens%ROWTYPE;
  v_session identity.sessions%ROWTYPE;
  v_membership uuid;
  v_refresh timestamptz;
  v_idle_max integer;
  v_idle integer;
BEGIN
  IF p_audiences IS NULL OR cardinality(p_audiences) = 0
     OR NOT (p_audiences <@ ARRAY['platform', 'merchant', 'agent', 'customer']) THEN
    RAISE EXCEPTION 'p_audiences must name the session audiences this endpoint serves'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_token FROM identity.refresh_tokens rt WHERE rt.token_hash = p_old_hash FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_session FROM identity.sessions s WHERE s.id = v_token.session_id FOR NO KEY UPDATE;

  -- Another endpoint's token: refused with no side effect at all.
  IF NOT (v_session.audience = ANY (p_audiences)) THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_token.rotated_at IS NOT NULL THEN
    UPDATE identity.sessions SET revoked_at = now(), revoke_reason = 'refresh_token_reuse'
     WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN QUERY SELECT 'reuse_detected', v_session.id, v_session.identity_id, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  v_membership := coalesce(v_session.platform_membership_id, v_session.merchant_membership_id, v_session.customer_id);
  IF v_session.revoked_at IS NOT NULL OR v_session.absolute_expires_at <= now() OR v_token.expires_at <= now()
     OR NOT EXISTS (SELECT 1 FROM identity.identities i WHERE i.id = v_session.identity_id AND i.status = 'active')
     OR identity.active_membership(v_session.identity_id, v_session.audience, v_membership) IS NULL THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  v_idle_max := (identity.session_limits(v_session.audience, v_session.scope)).idle_max;
  v_idle := coalesce(p_idle_seconds, v_idle_max);
  IF v_idle < 1 OR v_idle > v_idle_max THEN
    RAISE EXCEPTION 'session lifetime out of range' USING ERRCODE = 'check_violation';
  END IF;

  v_refresh := least(now() + make_interval(secs => v_idle), v_session.absolute_expires_at);
  UPDATE identity.refresh_tokens SET rotated_at = now() WHERE id = v_token.id;
  INSERT INTO identity.refresh_tokens (session_id, token_hash, expires_at) VALUES (v_session.id, p_new_hash, v_refresh);

  RETURN QUERY SELECT 'rotated', v_session.id, v_session.identity_id, v_session.audience, v_membership, v_session.scope, v_refresh;
END
$function$;

-- ── the ledger: a customer's sub-account is opened only for an active customer of the business (closes P6-11) ──
CREATE OR REPLACE FUNCTION ledger.open_subaccount(p_ledger_id uuid, p_code text, p_subject_type text, p_subject_id uuid)
 RETURNS TABLE(outcome text, account_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_control ledger.accounts%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT a.* INTO v_control
    FROM ledger.ledgers l
    JOIN ledger.chart_template t ON t.ledger_kind = l.owner_kind AND t.code = p_code AND t.subject_type = p_subject_type
    JOIN ledger.accounts a ON a.ledger_id = l.id AND a.code = p_code AND a.subject_type IS NULL AND a.is_system
   WHERE l.id = p_ledger_id;
  IF v_control.id IS NULL OR p_subject_id IS NULL THEN
    RETURN QUERY SELECT 'not_a_control_account', NULL::uuid;
    RETURN;
  END IF;
  IF p_subject_type = 'agent' AND NOT EXISTS (
       SELECT 1 FROM tenancy.merchant_memberships m
        WHERE m.merchant_id = v_control.merchant_id AND m.id = p_subject_id AND m.kind = 'agent') THEN
    RETURN QUERY SELECT 'unknown_subject', NULL::uuid;
    RETURN;
  END IF;
  -- P7 (closes P6-11): a customer subject is an active customer of the business.
  IF p_subject_type = 'customer' AND NOT EXISTS (
       SELECT 1 FROM customers.customers c
        WHERE c.merchant_id = v_control.merchant_id AND c.id = p_subject_id AND c.status = 'active') THEN
    RETURN QUERY SELECT 'unknown_subject', NULL::uuid;
    RETURN;
  END IF;
  -- The contested inserts, last (L3).
  INSERT INTO ledger.accounts
    (merchant_id, ledger_id, code, name, type, parent_account_id, subject_type, subject_id, is_system, non_negative)
  VALUES (v_control.merchant_id, p_ledger_id, p_code, v_control.name, v_control.type, v_control.id, p_subject_type,
          p_subject_id, true, v_control.non_negative)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT a.id INTO v_id FROM ledger.accounts a
     WHERE a.ledger_id = p_ledger_id AND a.code = p_code AND a.subject_type = p_subject_type
       AND a.subject_id = p_subject_id;
    RETURN QUERY SELECT 'ok', v_id;
    RETURN;
  END IF;
  INSERT INTO ledger.balance_projection (account_id, merchant_id) VALUES (v_id, v_control.merchant_id);
  RETURN QUERY SELECT 'ok', v_id;
END
$function$;
