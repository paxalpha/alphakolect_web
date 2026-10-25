-- P6, after the gate review of 2026-10-25 (docs/architecture/P6_IMPLEMENTATION_PLAN.md revision 3):
--
-- - Posting templates are versioned (§4): a template is (code, version); at most one version of a code is active; a
--   version's lines never change — a new mapping is a new version, and the old one is retired. Every entry posted by
--   a template records the version it was posted with (journal_entries.template_version, a foreign key to it).
-- - The account statement (§3.5) covers a control account's sub-accounts, and has its period's opening and closing
--   balances (ledger.statement_balances).
-- - A business's own account can be renamed and archived, never deleted (§3.1, BR-9.1): ledger.update_account. An
--   account is archived only at a zero balance, never one of the chart's; ledger.post_entry checks the accounts'
--   status again once it holds their projections, so a posting never lands on an account archived meanwhile.
-- - ledger.create_account answers with the account's creation time, as ledger.update_account answers with the account.
-- Forward-only; earlier migrations untouched.

-- ── §4: versioned templates ──
ALTER TABLE ledger.posting_templates ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE ledger.posting_templates
  ADD CONSTRAINT posting_templates_version_valid CHECK (version >= 1),
  DROP CONSTRAINT posting_templates_pkey,
  ADD CONSTRAINT posting_templates_pkey PRIMARY KEY (code, version);
CREATE UNIQUE INDEX posting_templates_one_active ON ledger.posting_templates (code) WHERE status = 'active';

-- A version is fixed once written: only its status changes, from active to retired.
CREATE FUNCTION ledger.protect_posting_template() RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'ledger.posting_templates: % is not allowed (retire the version instead)', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.ledger_kind IS DISTINCT FROM OLD.ledger_kind OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.lines IS DISTINCT FROM OLD.lines THEN
    RAISE EXCEPTION 'posting template % version %: a version never changes (add a new version)', OLD.code, OLD.version
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'posting template % version % is retired and cannot be re-activated', OLD.code, OLD.version
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION ledger.protect_posting_template() FROM PUBLIC;
CREATE TRIGGER posting_templates_protected BEFORE UPDATE OR DELETE ON ledger.posting_templates
  FOR EACH ROW EXECUTE FUNCTION ledger.protect_posting_template();
CREATE TRIGGER posting_templates_no_truncate BEFORE TRUNCATE ON ledger.posting_templates
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.protect_posting_template();

-- The version an entry was posted with: set exactly for template entries (entry_type is then the template's code).
ALTER TABLE ledger.journal_entries ADD COLUMN template_version integer;
ALTER TABLE ledger.journal_entries
  ADD CONSTRAINT journal_entries_template_fkey FOREIGN KEY (entry_type, template_version)
    REFERENCES ledger.posting_templates (code, version) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── the posting function, with the version, and the status checked again under the locks ──
DROP FUNCTION ledger.post_entry(uuid, text, text, date, text, text, text, jsonb, uuid, uuid, uuid);
CREATE FUNCTION ledger.post_entry(p_ledger_id uuid, p_idempotency_key text, p_entry_type text, p_effective_date date, p_narrative text, p_source_type text, p_source_id text, p_lines jsonb, p_actor_identity_id uuid, p_actor_membership_id uuid, p_reverses_entry_id uuid DEFAULT NULL::uuid, p_template_version integer DEFAULT NULL::integer)
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

-- ── §4: a template is posted with its active version, which the entry records ──
CREATE OR REPLACE FUNCTION ledger.post_template(p_ledger_id uuid, p_template text, p_amount_minor bigint, p_subjects jsonb, p_idempotency_key text, p_effective_date date, p_narrative text, p_source_type text, p_source_id text, p_actor_identity_id uuid, p_actor_membership_id uuid)
 RETURNS TABLE(outcome text, entry_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_template ledger.posting_templates%ROWTYPE;
  v_lines jsonb;
  v_missing boolean;
BEGIN
  SELECT t.* INTO v_template
    FROM ledger.posting_templates t JOIN ledger.ledgers l ON l.owner_kind = t.ledger_kind
   WHERE t.code = p_template AND t.status = 'active' AND l.id = p_ledger_id;
  IF v_template.code IS NULL THEN
    RETURN QUERY SELECT 'unknown_template', NULL::uuid;
    RETURN;
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RETURN QUERY SELECT 'invalid_amount', NULL::uuid;
    RETURN;
  END IF;
  SELECT bool_or(a.id IS NULL),
         jsonb_agg(jsonb_build_object('accountId', a.id::text, 'side', t.value ->> 'side',
                                      'amountMinor', p_amount_minor::text) ORDER BY t.ordinality)
    INTO v_missing, v_lines
    FROM jsonb_array_elements(v_template.lines) WITH ORDINALITY AS t
    LEFT JOIN ledger.accounts a
      ON a.ledger_id = p_ledger_id AND a.code = t.value ->> 'code'
     AND a.subject_type IS NOT DISTINCT FROM t.value ->> 'subject'
     AND a.subject_id IS NOT DISTINCT FROM
         CASE WHEN t.value ->> 'subject' IS NULL THEN NULL::uuid
              WHEN coalesce(p_subjects ->> (t.value ->> 'subject'), '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (p_subjects ->> (t.value ->> 'subject'))::uuid END
     -- a line without a subject never matches a sub-account
     AND (t.value ->> 'subject' IS NOT NULL OR a.subject_id IS NULL);
  IF v_missing THEN
    RETURN QUERY SELECT 'subaccount_missing', NULL::uuid;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT r.outcome, r.entry_id
      FROM ledger.post_entry(p_ledger_id, p_idempotency_key, p_template, p_effective_date,
                             coalesce(nullif(btrim(p_narrative), ''), v_template.description), p_source_type,
                             p_source_id, v_lines, p_actor_identity_id, p_actor_membership_id, NULL,
                             v_template.version) r;
END
$function$;

-- ── §3.5: the statement covers a control account's sub-accounts ──
DROP FUNCTION ledger.read_statement(uuid, uuid, date, date, integer, date, uuid);
CREATE FUNCTION ledger.read_statement(p_session_id uuid, p_account_id uuid, p_from date, p_to date, p_limit integer, p_after_date date DEFAULT NULL::date, p_after_line_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(line_id uuid, entry_id uuid, account_id uuid, effective_date date, entry_type text, narrative text, side text, amount_minor text, balance_minor text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  WITH r AS (
    SELECT l.id, l.entry_id, l.account_id, e.effective_date, e.entry_type, e.narrative, l.side, l.amount_minor,
           sum(CASE WHEN l.side = CASE WHEN a.type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END
                    THEN l.amount_minor ELSE -l.amount_minor END)
             OVER (ORDER BY e.effective_date, l.id) AS running
      FROM identity.session_authority(p_session_id) s
      JOIN ledger.accounts a ON a.merchant_id = s.merchant_id
                            AND (a.id = p_account_id OR a.parent_account_id = p_account_id)
      JOIN ledger.journal_lines l ON l.merchant_id = s.merchant_id AND l.account_id = a.id
      JOIN ledger.journal_entries e ON e.merchant_id = s.merchant_id AND e.id = l.entry_id
     WHERE s.audience = 'merchant' AND 'merchant.ledger.read' = ANY (s.permissions) AND e.effective_date <= p_to
  )
  SELECT r.id, r.entry_id, r.account_id, r.effective_date, r.entry_type, r.narrative, r.side, r.amount_minor::text,
         r.running::text
    FROM r
   WHERE r.effective_date >= p_from
     AND (p_after_date IS NULL OR (r.effective_date, r.id) > (p_after_date, p_after_line_id))
   ORDER BY r.effective_date, r.id
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
$function$;

-- A statement's opening balance (the end of the day before the period) and closing balance (the end of its last day),
-- sub-accounts included, in the account's normal direction.
CREATE FUNCTION ledger.statement_balances(p_session_id uuid, p_account_id uuid, p_from date, p_to date)
 RETURNS TABLE(opening_minor text, closing_minor text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT coalesce(sum(d.delta) FILTER (WHERE d.effective_date < p_from), 0)::text,
         coalesce(sum(d.delta) FILTER (WHERE d.effective_date <= p_to), 0)::text
    FROM (SELECT e.effective_date,
                 CASE WHEN l.side = CASE WHEN a.type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END
                      THEN l.amount_minor ELSE -l.amount_minor END AS delta
            FROM identity.session_authority(p_session_id) s
            JOIN ledger.accounts a ON a.merchant_id = s.merchant_id
                                  AND (a.id = p_account_id OR a.parent_account_id = p_account_id)
            JOIN ledger.journal_lines l ON l.merchant_id = s.merchant_id AND l.account_id = a.id
            JOIN ledger.journal_entries e ON e.merchant_id = s.merchant_id AND e.id = l.entry_id
           WHERE s.audience = 'merchant' AND 'merchant.ledger.read' = ANY (s.permissions)) d;
$function$;

-- ── an entry shows the template version it was posted with ──
DROP FUNCTION ledger.read_entry(uuid, uuid);
CREATE FUNCTION ledger.read_entry(p_session_id uuid, p_entry_id uuid)
 RETURNS TABLE(id uuid, effective_date date, entry_type text, template_version integer, narrative text, source_type text, source_id text, reverses_entry_id uuid, reversed_by_entry_id uuid, created_by uuid, created_at timestamp with time zone, line_id uuid, account_id uuid, account_code text, account_name text, side text, amount_minor text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT e.id, e.effective_date, e.entry_type, e.template_version, e.narrative, e.source_type, e.source_id,
         e.reverses_entry_id,
         (SELECT r.id FROM ledger.journal_entries r WHERE r.merchant_id = s.merchant_id AND r.reverses_entry_id = e.id),
         e.created_by, e.created_at, l.id, a.id, a.code, a.name, l.side, l.amount_minor::text
    FROM identity.session_authority(p_session_id) s
    JOIN ledger.journal_entries e ON e.merchant_id = s.merchant_id AND e.id = p_entry_id
    JOIN ledger.journal_lines l ON l.merchant_id = s.merchant_id AND l.entry_id = e.id
    JOIN ledger.accounts a ON a.merchant_id = s.merchant_id AND a.id = l.account_id
   WHERE s.audience = 'merchant' AND 'merchant.ledger.read' = ANY (s.permissions)
   ORDER BY l.id;
$function$;

-- ── §3.1, BR-9.1: a business's own account renamed, archived or restored ──
-- Outcomes: 'ok', 'forbidden', 'not_found', 'invalid', 'system_account' (the chart's accounts and sub-accounts are
-- the system's), 'balance_not_zero' (an account is archived only when empty).
INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('ledger.account_updated', 'success', 'atomic', 'A',
   '{"name": {"type": "string", "max": 120}, "status": {"type": "string", "max": 16}}'),
  ('ledger.account_updated', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}');

CREATE FUNCTION ledger.update_account(p_session_id uuid, p_account_id uuid, p_name text, p_status text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, code text, name text, type text, status text, balance_minor text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_account uuid;
  v_row ledger.accounts%ROWTYPE;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT a.id INTO v_account FROM ledger.accounts a WHERE a.id = p_account_id AND a.merchant_id = v_merchant;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM 1 FROM ledger.accounts a WHERE a.id = v_account FOR NO KEY UPDATE;
  -- Its balance, held against postings while it is archived (a posting waits, then sees the account archived).
  PERFORM ledger.lock_projections(ARRAY[v_account], NULL);
  IF tenancy.assert_authority(p_session_id, 'merchant.ledger.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_account IS NULL THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF (p_name IS NULL AND p_status IS NULL)
     OR (p_name IS NOT NULL AND char_length(btrim(p_name)) NOT BETWEEN 1 AND 120)
     OR (p_status IS NOT NULL AND p_status NOT IN ('active', 'archived')) THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_row FROM ledger.accounts a WHERE a.id = v_account;
  IF v_row.is_system THEN
    RETURN QUERY SELECT 'system_account', NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_status = 'archived' AND v_row.status = 'active'
     AND (SELECT p.balance_minor FROM ledger.balance_projection p WHERE p.account_id = v_account) <> 0 THEN
    RETURN QUERY SELECT 'balance_not_zero', NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  UPDATE ledger.accounts a
     SET name = coalesce(btrim(p_name), a.name),
         status = coalesce(p_status, a.status),
         archived_at = CASE
           WHEN coalesce(p_status, a.status) = 'active' THEN NULL
           WHEN a.status = 'archived' THEN a.archived_at
           ELSE now()
         END
   WHERE a.id = v_account
  RETURNING * INTO v_row;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'ledger.account_updated', 'ledger_account',
          v_row.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('name', v_row.name, 'status', v_row.status));
  -- The account as changed, so the answer never depends on reading the books.
  RETURN QUERY SELECT 'ok', v_row.id, v_row.code, v_row.name, v_row.type, v_row.status,
                      (SELECT p.balance_minor::text FROM ledger.balance_projection p WHERE p.account_id = v_row.id),
                      v_row.created_at;
END
$function$;

-- create_account answers with the account's creation time too (its answer never depends on reading the books).
DROP FUNCTION ledger.create_account(uuid, text, text, text, text, text, text);
CREATE FUNCTION ledger.create_account(p_session_id uuid, p_code text, p_name text, p_type text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_ledger uuid;
  v_id uuid;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  IF tenancy.assert_authority(p_session_id, 'merchant.ledger.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF coalesce(p_code, '') !~ '^[0-9]{4,6}$' OR char_length(coalesce(btrim(p_name), '')) NOT BETWEEN 1 AND 120
     OR coalesce(p_type, '') NOT IN ('asset', 'liability', 'equity', 'revenue', 'expense') THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = v_merchant;

  -- The contested inserts, last (L3): a code is unique in the ledger (TA-5).
  BEGIN
    INSERT INTO ledger.accounts (merchant_id, ledger_id, code, name, type)
    VALUES (v_merchant, v_ledger, p_code, btrim(p_name), p_type)
    RETURNING ledger.accounts.id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'code_taken', NULL::uuid, NULL::timestamptz;
    RETURN;
  END;
  INSERT INTO ledger.balance_projection (account_id, merchant_id) VALUES (v_id, v_merchant);
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'ledger.account_created', 'ledger_account', v_id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('code', p_code, 'name', btrim(p_name), 'type', p_type));
  -- With its creation time, so the answer never depends on reading the books.
  RETURN QUERY SELECT 'ok', v_id, (SELECT a.created_at FROM ledger.accounts a WHERE a.id = v_id);
END
$function$;

REVOKE ALL ON FUNCTION ledger.post_entry(uuid, text, text, date, text, text, text, jsonb, uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.read_statement(uuid, uuid, date, date, integer, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.statement_balances(uuid, uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.read_entry(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.update_account(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.create_account(uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ledger.read_statement(uuid, uuid, date, date, integer, date, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION ledger.statement_balances(uuid, uuid, date, date) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION ledger.read_entry(uuid, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION ledger.update_account(uuid, uuid, text, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION ledger.create_account(uuid, text, text, text, text, text, text) TO alphakolect_app;
