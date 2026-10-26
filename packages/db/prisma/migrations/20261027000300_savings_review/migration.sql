-- P8, after the gate review of 2026-10-26 (docs/architecture/P8_IMPLEMENTATION_PLAN.md revision 3, §10):
--
-- - R1: the package that governs a collection. A recording is checked against the next cycle's package when a change
--   is waiting and the current cycle has ended (the contribution opens the next cycle); an approval puts a collection in
--   the cycle whose days hold the day it was collected (a new one after the last), and refuses one recorded under
--   another package than that cycle's ('package_changed': the business cancels it, the agent records it again).
-- - R2: the posting core is split. ledger.post_entry takes the lines' projections in one sorted acquisition and calls
--   ledger.post_entry_locked, which re-asserts them NOWAIT and waits for nothing (L6). ledger.post_template_locked and
--   ledger.post_reversal_locked post through it; the savings commands, which take every projection they post to in
--   their own footprint before the customer and their rows, use them. The lock-order guard needs no exception: an
--   unheld projection is taken at once or the command fails, and is never waited for.
-- Forward-only; earlier migrations untouched.

CREATE FUNCTION ledger.post_entry_locked(p_ledger_id uuid, p_idempotency_key text, p_entry_type text, p_effective_date date, p_narrative text, p_source_type text, p_source_id text, p_lines jsonb, p_actor_identity_id uuid, p_actor_membership_id uuid, p_reverses_entry_id uuid DEFAULT NULL::uuid, p_template_version integer DEFAULT NULL::integer)
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
  v_account uuid;
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

  -- TA-7, P8 review (R2): the lines' projections, in ascending account id, re-asserted NOWAIT — the caller holds them
  -- (ledger.post_entry, or a domain command that took them in its own footprint). A projection the caller does not
  -- hold is taken at once if it is free, or the command fails (lock_not_available); it is never waited for.
  SELECT array_agg(DISTINCT (x ->> 'accountId')::uuid ORDER BY (x ->> 'accountId')::uuid) INTO v_accounts
    FROM jsonb_array_elements(p_lines) x;
  FOREACH v_account IN ARRAY v_accounts LOOP
    PERFORM 1 FROM ledger.balance_projection p WHERE p.account_id = v_account FOR NO KEY UPDATE NOWAIT;
  END LOOP;
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

CREATE OR REPLACE FUNCTION ledger.post_entry(p_ledger_id uuid, p_idempotency_key text, p_entry_type text, p_effective_date date, p_narrative text, p_source_type text, p_source_id text, p_lines jsonb, p_actor_identity_id uuid, p_actor_membership_id uuid, p_reverses_entry_id uuid DEFAULT NULL::uuid, p_template_version integer DEFAULT NULL::integer)
 RETURNS TABLE(outcome text, entry_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_accounts uuid[];
BEGIN
  -- TA-7: the projections of the lines' accounts of this ledger, in one sorted acquisition; the core checks everything
  -- else under them (a malformed line is refused there).
  IF jsonb_typeof(p_lines) = 'array' THEN
    SELECT array_agg(a.id ORDER BY a.id) INTO v_accounts
      FROM ledger.accounts a
     WHERE a.ledger_id = p_ledger_id
       AND a.id IN (SELECT (x ->> 'accountId')::uuid FROM jsonb_array_elements(p_lines) x
                     WHERE jsonb_typeof(x) = 'object' AND coalesce(x ->> 'accountId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  END IF;
  PERFORM ledger.lock_projections(NULL, v_accounts);
  RETURN QUERY
    SELECT r.outcome, r.entry_id
      FROM ledger.post_entry_locked(p_ledger_id, p_idempotency_key, p_entry_type, p_effective_date, p_narrative,
                                    p_source_type, p_source_id, p_lines, p_actor_identity_id, p_actor_membership_id,
                                    p_reverses_entry_id, p_template_version) r;
END
$function$;

CREATE FUNCTION ledger.post_template_locked(p_ledger_id uuid, p_template text, p_amount_minor bigint, p_subjects jsonb, p_idempotency_key text, p_effective_date date, p_narrative text, p_source_type text, p_source_id text, p_actor_identity_id uuid, p_actor_membership_id uuid)
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
      FROM ledger.post_entry_locked(p_ledger_id, p_idempotency_key, p_template, p_effective_date,
                             coalesce(nullif(btrim(p_narrative), ''), v_template.description), p_source_type,
                             p_source_id, v_lines, p_actor_identity_id, p_actor_membership_id, NULL,
                             v_template.version) r;
END
$function$;

CREATE FUNCTION ledger.post_reversal_locked(p_ledger_id uuid, p_entry_id uuid, p_idempotency_key text, p_effective_date date, p_narrative text, p_actor_identity_id uuid, p_actor_membership_id uuid)
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
      FROM ledger.post_entry_locked(p_ledger_id, p_idempotency_key, 'reversal', coalesce(p_effective_date, current_date),
                             coalesce(nullif(btrim(p_narrative), ''), 'Reversal: ' || v_original.narrative),
                             'journal_entry', p_entry_id::text, v_lines, p_actor_identity_id, p_actor_membership_id,
                             p_entry_id) r;
END
$function$;

CREATE OR REPLACE FUNCTION savings.record_collection(p_session_id uuid, p_customer_id uuid, p_amount_minor bigint, p_idem_key text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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
  v_cycle_end date;
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
  -- R1 (P8 review): the package that will govern this collection — the next cycle's when a change is waiting and the
  -- current cycle has ended (this contribution opens the next one, Q3, Q10); otherwise the enrolment's.
  SELECT y.ends_on INTO v_cycle_end FROM savings.cycles y
   WHERE y.merchant_id = v_merchant AND y.customer_id = v_customer.id ORDER BY y.number DESC LIMIT 1;
  SELECT * INTO v_package FROM savings.packages p
   WHERE p.id = CASE WHEN v_enrolment.next_package_id IS NOT NULL
                          AND (v_cycle_end IS NULL OR current_date > v_cycle_end)
                     THEN v_enrolment.next_package_id ELSE v_enrolment.package_id END;
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
    FROM ledger.post_template_locked(v_ledger, 'collection.cash_recorded', p_amount_minor, jsonb_build_object('agent', v_actor),
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

CREATE OR REPLACE FUNCTION savings.cancel_collection(p_session_id uuid, p_collection_id uuid, p_reason text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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
    FROM ledger.post_reversal_locked(v_ledger, v_collection.recorded_entry_id,
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

CREATE OR REPLACE FUNCTION savings.move_savings(p_session_id uuid, p_customer_id uuid, p_kind text, p_amount_minor bigint, p_idem_key text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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
      FROM ledger.post_template_locked(v_ledger,
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

CREATE OR REPLACE FUNCTION savings.approve_remittance(p_session_id uuid, p_agent_membership_id uuid, p_collection_ids uuid[], p_cash_minor bigint, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
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
  BEGIN
  FOR v_collection IN SELECT * FROM savings.collections c WHERE c.id = ANY (v_ids) ORDER BY c.id LOOP
    -- The customer's cycle (Q3, P8-12 as revised): the one whose 31 days hold the day the contribution was collected;
    -- a new one when it falls after the last cycle; otherwise (a day in no cycle, before a later one was opened) the
    -- last one.
    v_cycle := NULL;
    SELECT * INTO v_cycle FROM savings.cycles y
     WHERE y.merchant_id = v_merchant AND y.customer_id = v_collection.customer_id
       AND v_collection.collected_on BETWEEN y.starts_on AND y.ends_on;
    IF v_cycle.id IS NULL THEN
      SELECT * INTO v_cycle FROM savings.cycles y
       WHERE y.merchant_id = v_merchant AND y.customer_id = v_collection.customer_id ORDER BY y.number DESC LIMIT 1;
    END IF;
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
    -- R1: a collection is approved only under the package it was recorded and checked against (Q1's amounts).
    IF v_collection.package_id <> v_package.id THEN
      RAISE EXCEPTION 'package_changed' USING ERRCODE = 'SV001';
    END IF;
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
      FROM ledger.post_template_locked(v_ledger, 'collection.cash_confirmed', v_collection.amount_minor,
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
        FROM ledger.post_template_locked(v_ledger, v_template, v_fee, jsonb_build_object('customer', v_collection.customer_id),
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
  EXCEPTION WHEN SQLSTATE 'SV001' THEN
    RETURN QUERY SELECT 'package_changed', NULL::uuid, NULL::uuid, NULL::bigint, NULL::integer, NULL::bigint,
                        NULL::timestamptz;
    RETURN;
  END;
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

REVOKE ALL ON FUNCTION ledger.post_entry_locked(uuid, text, text, date, text, text, text, jsonb, uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.post_template_locked(uuid, text, bigint, jsonb, text, date, text, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.post_reversal_locked(uuid, uuid, text, date, text, uuid, uuid) FROM PUBLIC;
