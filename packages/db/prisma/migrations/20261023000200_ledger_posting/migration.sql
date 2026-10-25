-- P6: posting, reversal, sub-accounts, templates and idempotency records (docs/architecture/P6_IMPLEMENTATION_PLAN.md
-- §2 TA-3–TA-7, §3.3, §3.4, §4).
--
-- - util.idempotency_records (TA-6): a command claims its key in its own transaction (util.claim_idempotency); the
--   command's function locks the claim first, posts, and completes the held claim with its response in the same
--   transaction; a refused command releases it (util.release_idempotency). A stale claim (a command that died) is
--   taken over after two minutes, by the same request only.
-- - ledger.post_entry (TA-3): the one writer of entries, lines and projections. It locks the lines' projections in
--   ascending account id (FOR NO KEY UPDATE, ledger.lock_projections), returns the existing entry on a replay, checks
--   every line, refuses a non-negative account going below zero, inserts the entry (the contested insert, last of the
--   waits: L3) and its lines, updates the held projections, and records debits to capital and income accounts (owner
--   Q4). Executable by no application role: the session commands (migration 3) and later phases' domain functions
--   call it.
-- - ledger.post_reversal (TA-4): the mirror of an entry; a reversal is never reversed, and an entry is reversed once
--   (the partial unique index of migration 1 decides under concurrency).
-- - ledger.open_subaccount (TA-5): a customer's or agent's sub-account of a control account, idempotent; opened
--   before any posting uses it, so posting never inserts an account.
-- - ledger.post_template: a transaction mapping of ledger.posting_templates, resolved to accounts and posted.
-- - ledger.verify_projections (§3.4): every projection that differs from the sum of its lines (operator; P12 alerts).
-- Forward-only; earlier migrations untouched.

-- ── TA-6: idempotency records ──
CREATE TABLE util.idempotency_records (
  id           uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id  uuid NOT NULL,
  identity_id  uuid NOT NULL,
  operation    text NOT NULL,
  idem_key     text NOT NULL,
  fingerprint  text NOT NULL,
  state        text NOT NULL DEFAULT 'in_progress',
  response     jsonb,
  claimed_at   timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz(6),
  CONSTRAINT idempotency_records_pkey PRIMARY KEY (id),
  CONSTRAINT idempotency_records_merchant_id_id_key UNIQUE (merchant_id, id),
  CONSTRAINT idempotency_records_scope_key UNIQUE (merchant_id, identity_id, operation, idem_key),
  CONSTRAINT idempotency_records_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT idempotency_records_identity_fkey FOREIGN KEY (identity_id) REFERENCES identity.identities (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT idempotency_records_operation_valid CHECK (operation ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  -- A client's key: printable ASCII, 1 to 255 characters (the API checks it before the database does).
  CONSTRAINT idempotency_records_key_valid CHECK (idem_key ~ '^[\x21-\x7e]{1,255}$'),
  -- The request's fingerprint: the hex SHA-256 the API computes over the canonical request.
  CONSTRAINT idempotency_records_fingerprint_valid CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT idempotency_records_state_valid CHECK (state IN ('in_progress', 'completed')),
  CONSTRAINT idempotency_records_completed_consistent
    CHECK ((state = 'completed') = (completed_at IS NOT NULL) AND (state = 'completed') = (response IS NOT NULL)),
  CONSTRAINT idempotency_records_response_is_object CHECK (response IS NULL OR jsonb_typeof(response) = 'object')
);
ALTER TABLE util.idempotency_records ENABLE ROW LEVEL SECURITY;
-- The app holds no privilege on the table (the functions below are its only way in); the policy makes any later grant
-- tenant-scoped from the start (the RLS catalog guard).
CREATE POLICY idempotency_records_app_own_tenant ON util.idempotency_records TO alphakolect_app
  USING (merchant_id = util.current_merchant_id())
  WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY idempotency_records_readonly_all ON util.idempotency_records FOR SELECT TO alphakolect_readonly
  USING (true);
REVOKE ALL ON util.idempotency_records FROM alphakolect_app;
GRANT SELECT ON util.idempotency_records TO alphakolect_readonly;

-- Claim a command's key, in its own transaction. Outcomes: 'claimed' (run the command), 'completed' (a replay: the
-- stored response), 'in_progress' (a concurrent duplicate), 'key_reused' (the key with a different request),
-- 'forbidden' (no merchant session).
CREATE FUNCTION util.claim_idempotency(p_session_id uuid, p_operation text, p_key text, p_fingerprint text)
 RETURNS TABLE(outcome text, response jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_identity uuid;
  v_id uuid;
  v_record util.idempotency_records%ROWTYPE;
BEGIN
  SELECT v.merchant_id, v.identity_id INTO v_merchant, v_identity
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::jsonb;
    RETURN;
  END IF;
  -- The contested insert, alone: a stale claim of the same request is taken over.
  INSERT INTO util.idempotency_records (merchant_id, identity_id, operation, idem_key, fingerprint)
  VALUES (v_merchant, v_identity, p_operation, p_key, p_fingerprint)
  ON CONFLICT (merchant_id, identity_id, operation, idem_key) DO UPDATE SET claimed_at = now()
   WHERE idempotency_records.state = 'in_progress' AND idempotency_records.fingerprint = EXCLUDED.fingerprint
     AND idempotency_records.claimed_at < now() - interval '2 minutes'
  RETURNING idempotency_records.id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT 'claimed', NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_record FROM util.idempotency_records r
   WHERE r.merchant_id = v_merchant AND r.identity_id = v_identity AND r.operation = p_operation
     AND r.idem_key = p_key;
  IF v_record.fingerprint <> p_fingerprint THEN
    RETURN QUERY SELECT 'key_reused', NULL::jsonb;
  ELSIF v_record.state = 'completed' THEN
    RETURN QUERY SELECT 'completed', v_record.response;
  ELSE
    RETURN QUERY SELECT 'in_progress', NULL::jsonb;
  END IF;
END
$function$;

-- Release a claim whose command was refused or failed, in its own transaction: the key may be used again.
CREATE FUNCTION util.release_idempotency(p_session_id uuid, p_operation text, p_key text, p_fingerprint text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_identity uuid;
BEGIN
  SELECT v.merchant_id, v.identity_id INTO v_merchant, v_identity
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN false;
  END IF;
  DELETE FROM util.idempotency_records r
   WHERE r.merchant_id = v_merchant AND r.identity_id = v_identity AND r.operation = p_operation
     AND r.idem_key = p_key AND r.fingerprint = p_fingerprint AND r.state = 'in_progress';
  RETURN FOUND;
END
$function$;

-- ── category 14: the projections, one sorted acquisition (L5) ──
CREATE FUNCTION ledger.lock_projections(p_share uuid[], p_no_key_update uuid[])
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
      PERFORM 1 FROM ledger.balance_projection t WHERE t.account_id = v_row.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM ledger.balance_projection t WHERE t.account_id = v_row.id FOR SHARE;
    END IF;
    IF FOUND THEN
      v_locked := v_locked + 1;
    END IF;
  END LOOP;
  RETURN v_locked;
END
$function$;

-- ── TA-3: the one posting function ──
-- p_lines: a JSON array of {"accountId": uuid, "side": "debit" | "credit", "amountMinor": "<positive kobo>"}.
-- Outcomes: 'ok', 'replayed' (the key was used in this ledger, with the same lines), 'key_reused', 'unknown_ledger',
-- 'invalid_lines', 'unbalanced', 'unknown_account', 'inactive_account', 'control_account', 'insufficient_balance',
-- 'already_reversed'. Nothing is written unless the outcome is 'ok'.
CREATE FUNCTION ledger.post_entry(p_ledger_id uuid, p_idempotency_key text, p_entry_type text, p_effective_date date, p_narrative text, p_source_type text, p_source_id text, p_lines jsonb, p_actor_identity_id uuid, p_actor_membership_id uuid, p_reverses_entry_id uuid DEFAULT NULL::uuid)
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
       reverses_entry_id, created_by)
    VALUES (v_ledger.merchant_id, p_ledger_id, p_effective_date, p_entry_type, btrim(p_narrative), p_source_type,
            p_source_id, p_idempotency_key, p_reverses_entry_id, p_actor_identity_id)
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

-- ── TA-4: a reversal, the mirror of an entry ──
-- Outcomes: those of ledger.post_entry, and 'not_found', 'is_reversal'.
CREATE FUNCTION ledger.post_reversal(p_ledger_id uuid, p_entry_id uuid, p_idempotency_key text, p_effective_date date, p_narrative text, p_actor_identity_id uuid, p_actor_membership_id uuid)
 RETURNS TABLE(outcome text, entry_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_original ledger.journal_entries%ROWTYPE;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_original FROM ledger.journal_entries e WHERE e.id = p_entry_id AND e.ledger_id = p_ledger_id;
  IF v_original.id IS NULL THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid;
    RETURN;
  END IF;
  IF v_original.reverses_entry_id IS NOT NULL THEN
    RETURN QUERY SELECT 'is_reversal', NULL::uuid;
    RETURN;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('accountId', l.account_id::text,
                                      'side', CASE l.side WHEN 'debit' THEN 'credit' ELSE 'debit' END,
                                      'amountMinor', l.amount_minor::text) ORDER BY l.id)
    INTO v_lines
    FROM ledger.journal_lines l WHERE l.entry_id = p_entry_id;
  RETURN QUERY
    SELECT r.outcome, r.entry_id
      FROM ledger.post_entry(p_ledger_id, p_idempotency_key, 'reversal', coalesce(p_effective_date, current_date),
                             coalesce(nullif(btrim(p_narrative), ''), 'Reversal: ' || v_original.narrative),
                             'journal_entry', p_entry_id::text, v_lines, p_actor_identity_id, p_actor_membership_id,
                             p_entry_id) r;
END
$function$;

-- ── TA-5: a sub-account of a control account, idempotent ──
-- Outcomes: 'ok' (opened or already open), 'not_a_control_account', 'unknown_subject'. A customer subject is checked
-- when customers exist (P7); an agent subject is an agent membership of the business.
CREATE FUNCTION ledger.open_subaccount(p_ledger_id uuid, p_code text, p_subject_type text, p_subject_id uuid)
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

-- ── §4: a transaction mapping, resolved and posted ──
-- p_subjects: {"customer": uuid, "agent": uuid}, as the template's lines need. Outcomes: those of ledger.post_entry,
-- and 'unknown_template', 'invalid_amount', 'subaccount_missing' (open it first: ledger.open_subaccount).
CREATE FUNCTION ledger.post_template(p_ledger_id uuid, p_template text, p_amount_minor bigint, p_subjects jsonb, p_idempotency_key text, p_effective_date date, p_narrative text, p_source_type text, p_source_id text, p_actor_identity_id uuid, p_actor_membership_id uuid)
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
                             p_source_id, v_lines, p_actor_identity_id, p_actor_membership_id) r;
END
$function$;

-- ── §3.4: the projections' check (operator; P12 runs it nightly and alerts) ──
CREATE FUNCTION ledger.verify_projections()
 RETURNS TABLE(account_id uuid, merchant_id uuid, projected_minor bigint, computed_minor numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT a.id, a.merchant_id, p.balance_minor, coalesce(s.total, 0)
    FROM ledger.accounts a
    JOIN ledger.balance_projection p ON p.account_id = a.id
    LEFT JOIN (SELECT l.account_id,
                      sum(CASE WHEN l.side = CASE WHEN a2.type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END
                               THEN l.amount_minor ELSE -l.amount_minor END) AS total
                 FROM ledger.journal_lines l JOIN ledger.accounts a2 ON a2.id = l.account_id
                GROUP BY l.account_id) s ON s.account_id = a.id
   WHERE p.balance_minor <> coalesce(s.total, 0)
   ORDER BY a.id;
$function$;

-- ── who may execute what: the app claims and releases keys; everything else is called by definer functions or
-- the operator ──
REVOKE ALL ON FUNCTION util.claim_idempotency(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION util.release_idempotency(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.lock_projections(uuid[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.post_entry(uuid, text, text, date, text, text, text, jsonb, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.post_reversal(uuid, uuid, text, date, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.open_subaccount(uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.post_template(uuid, text, bigint, jsonb, text, date, text, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.verify_projections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION util.claim_idempotency(uuid, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION util.release_idempotency(uuid, text, text, text) TO alphakolect_app;

-- Owner Q4: the activity record's pairs for debits to capital and income (pattern A: written by ledger.post_entry).
INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('ledger.capital_debited', 'success', 'atomic', 'A',
   '{"entryId": {"type": "string", "max": 36}, "entryType": {"type": "string", "max": 100}, "accountId": {"type": "string", "max": 36}, "accountCode": {"type": "string", "max": 6}, "amountMinor": {"type": "string", "max": 20}}'),
  ('ledger.income_debited', 'success', 'atomic', 'A',
   '{"entryId": {"type": "string", "max": 36}, "entryType": {"type": "string", "max": 100}, "accountId": {"type": "string", "max": 36}, "accountCode": {"type": "string", "max": 6}, "amountMinor": {"type": "string", "max": 20}}');
