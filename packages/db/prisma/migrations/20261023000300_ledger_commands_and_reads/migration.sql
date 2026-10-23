-- P6: the ledger's session commands and reads (docs/architecture/P6_IMPLEMENTATION_PLAN.md §3.5, §5; decision P6-3).
--
-- - Three merchant permissions, grantable by the owner: merchant.ledger.read, .manage and .post.
-- - Commands (pattern A, the business from the session, authority re-checked under the actor's lock — as the P5.5
--   writers): ledger.create_account (BR-9.1), ledger.post_manual_entry and ledger.reverse_entry. The two posting
--   commands lock their idempotency claim first (category 12), post through ledger.post_entry, and complete the held
--   claim in the same transaction (TA-6).
-- - Reads (B1, R19: the business from the session, the permission checked in the database): the accounts with their
--   balances, one account, an account's statement with running balances, an entry with its lines, and each account's
--   movements in a period — the trial balance, the balance sheet and the profit and loss are computed from them.
-- Forward-only; earlier migrations untouched.

INSERT INTO identity.permission_catalog (identifier, scope, grantable, description) VALUES
  ('merchant.ledger.read', 'merchant', true,
   'See the accounts and their balances, account statements, journal entries and the financial reports.'),
  ('merchant.ledger.manage', 'merchant', true, 'Add the business''s own accounts to its chart of accounts.'),
  ('merchant.ledger.post', 'merchant', true, 'Post manual journal entries, and reverse them.');

INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('ledger.account_created', 'success', 'atomic', 'A',
   '{"code": {"type": "string", "max": 6}, "name": {"type": "string", "max": 120}, "type": {"type": "string", "max": 16}}'),
  ('ledger.account_created', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('ledger.manual_entry_posted', 'success', 'atomic', 'A',
   '{"entryId": {"type": "string", "max": 36}, "lineCount": {"type": "integer"}, "totalMinor": {"type": "string", "max": 20}, "effectiveDate": {"type": "string", "max": 10}}'),
  ('ledger.manual_entry_posted', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('ledger.entry_reversed', 'success', 'atomic', 'A',
   '{"entryId": {"type": "string", "max": 36}, "reversalId": {"type": "string", "max": 36}}'),
  ('ledger.entry_reversed', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}');

-- ── BR-9.1: a merchant-defined account ──
-- Outcomes: 'ok', 'forbidden', 'invalid', 'code_taken'.
CREATE FUNCTION ledger.create_account(p_session_id uuid, p_code text, p_name text, p_type text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid)
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
    RETURN QUERY SELECT 'forbidden', NULL::uuid;
    RETURN;
  END IF;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  IF tenancy.assert_authority(p_session_id, 'merchant.ledger.manage') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid;
    RETURN;
  END IF;
  IF coalesce(p_code, '') !~ '^[0-9]{4,6}$' OR char_length(coalesce(btrim(p_name), '')) NOT BETWEEN 1 AND 120
     OR coalesce(p_type, '') NOT IN ('asset', 'liability', 'equity', 'revenue', 'expense') THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid;
    RETURN;
  END IF;
  SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = v_merchant;

  -- The contested inserts, last (L3): a code is unique in the ledger (TA-5).
  BEGIN
    INSERT INTO ledger.accounts (merchant_id, ledger_id, code, name, type)
    VALUES (v_merchant, v_ledger, p_code, btrim(p_name), p_type)
    RETURNING ledger.accounts.id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'code_taken', NULL::uuid;
    RETURN;
  END;
  INSERT INTO ledger.balance_projection (account_id, merchant_id) VALUES (v_id, v_merchant);
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'ledger.account_created', 'ledger_account', v_id::text,
          'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('code', p_code, 'name', btrim(p_name), 'type', p_type));
  RETURN QUERY SELECT 'ok', v_id;
END
$function$;

-- ── a manual journal entry (TA-6: the claim locked first, completed held) ──
-- Outcomes: 'ok', 'forbidden', 'not_claimed', 'invalid', and the refusals of ledger.post_entry.
CREATE FUNCTION ledger.post_manual_entry(p_session_id uuid, p_idempotency_key text, p_fingerprint text, p_effective_date date, p_narrative text, p_lines jsonb, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, entry_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_claim uuid;
  v_ledger uuid;
  v_outcome text;
  v_entry uuid;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid;
    RETURN;
  END IF;
  SELECT r.id INTO v_claim FROM util.idempotency_records r
   WHERE r.merchant_id = v_merchant AND r.identity_id = v_actor_identity AND r.operation = 'ledger.manual_entry'
     AND r.idem_key = p_idempotency_key;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  IF tenancy.assert_authority(p_session_id, 'merchant.ledger.post') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid;
    RETURN;
  END IF;
  PERFORM 1 FROM util.idempotency_records r WHERE r.id = v_claim FOR NO KEY UPDATE;
  IF NOT EXISTS (SELECT 1 FROM util.idempotency_records r
                  WHERE r.id = v_claim AND r.fingerprint = p_fingerprint AND r.state = 'in_progress') THEN
    RETURN QUERY SELECT 'not_claimed', NULL::uuid;
    RETURN;
  END IF;
  IF p_effective_date IS NULL OR p_effective_date > current_date
     OR char_length(coalesce(btrim(p_narrative), '')) NOT BETWEEN 1 AND 500 THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid;
    RETURN;
  END IF;
  SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = v_merchant;

  -- The entry's key derives from the command's (TA-6): the actor's own key space.
  SELECT r.outcome, r.entry_id INTO v_outcome, v_entry
    FROM ledger.post_entry(v_ledger, 'manual:' || v_actor_identity::text || ':' || p_idempotency_key, 'manual',
                           p_effective_date, p_narrative, NULL, NULL, p_lines, v_actor_identity, v_actor) r;
  IF v_outcome NOT IN ('ok', 'replayed') THEN
    RETURN QUERY SELECT v_outcome, NULL::uuid;
    RETURN;
  END IF;
  IF v_outcome = 'ok' THEN
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       ip, user_agent, request_id, summary)
    VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'ledger.manual_entry_posted', 'ledger_entry',
            v_entry::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
            jsonb_build_object('entryId', v_entry::text, 'lineCount', jsonb_array_length(p_lines),
                               'totalMinor', (SELECT sum((x ->> 'amountMinor')::numeric)::text
                                                FROM jsonb_array_elements(p_lines) x WHERE x ->> 'side' = 'debit'),
                               'effectiveDate', p_effective_date::text));
  END IF;
  UPDATE util.idempotency_records r
     SET state = 'completed', completed_at = now(), response = jsonb_build_object('entryId', v_entry::text)
   WHERE r.id = v_claim;
  RETURN QUERY SELECT 'ok', v_entry;
END
$function$;

-- ── a reversal of a manual entry (BR-11.1; entries posted by a domain are reversed by that domain) ──
-- Outcomes: 'ok', 'forbidden', 'not_claimed', 'not_found', 'not_reversible', 'invalid', and the refusals of
-- ledger.post_reversal.
CREATE FUNCTION ledger.reverse_entry(p_session_id uuid, p_entry_id uuid, p_idempotency_key text, p_fingerprint text, p_narrative text DEFAULT NULL::text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, entry_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_claim uuid;
  v_ledger uuid;
  v_type text;
  v_outcome text;
  v_entry uuid;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid;
    RETURN;
  END IF;
  SELECT r.id INTO v_claim FROM util.idempotency_records r
   WHERE r.merchant_id = v_merchant AND r.identity_id = v_actor_identity AND r.operation = 'ledger.entry_reversal'
     AND r.idem_key = p_idempotency_key;
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  IF tenancy.assert_authority(p_session_id, 'merchant.ledger.post') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid;
    RETURN;
  END IF;
  PERFORM 1 FROM util.idempotency_records r WHERE r.id = v_claim FOR NO KEY UPDATE;
  IF NOT EXISTS (SELECT 1 FROM util.idempotency_records r
                  WHERE r.id = v_claim AND r.fingerprint = p_fingerprint AND r.state = 'in_progress') THEN
    RETURN QUERY SELECT 'not_claimed', NULL::uuid;
    RETURN;
  END IF;
  IF p_narrative IS NOT NULL AND char_length(btrim(p_narrative)) NOT BETWEEN 1 AND 500 THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid;
    RETURN;
  END IF;
  SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = v_merchant;
  SELECT e.entry_type INTO v_type FROM ledger.journal_entries e
   WHERE e.id = p_entry_id AND e.ledger_id = v_ledger AND e.merchant_id = v_merchant;
  IF v_type IS NULL THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid;
    RETURN;
  END IF;
  IF v_type <> 'manual' THEN
    RETURN QUERY SELECT 'not_reversible', NULL::uuid;
    RETURN;
  END IF;

  SELECT r.outcome, r.entry_id INTO v_outcome, v_entry
    FROM ledger.post_reversal(v_ledger, p_entry_id, 'reversal:' || v_actor_identity::text || ':' || p_idempotency_key,
                              current_date, p_narrative, v_actor_identity, v_actor) r;
  IF v_outcome NOT IN ('ok', 'replayed') THEN
    RETURN QUERY SELECT v_outcome, NULL::uuid;
    RETURN;
  END IF;
  IF v_outcome = 'ok' THEN
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       ip, user_agent, request_id, summary)
    VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'ledger.entry_reversed', 'ledger_entry',
            p_entry_id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
            jsonb_build_object('entryId', p_entry_id::text, 'reversalId', v_entry::text));
  END IF;
  UPDATE util.idempotency_records r
     SET state = 'completed', completed_at = now(), response = jsonb_build_object('entryId', v_entry::text)
   WHERE r.id = v_claim;
  RETURN QUERY SELECT 'ok', v_entry;
END
$function$;

-- ── reads (B1, R19) ──
-- The accounts and their balances. A control account's balance includes its sub-accounts'; the sub-accounts
-- themselves are listed on request.
CREATE FUNCTION ledger.list_accounts(p_session_id uuid, p_include_subaccounts boolean DEFAULT false)
 RETURNS TABLE(id uuid, code text, name text, type text, status text, non_negative boolean, is_system boolean, parent_account_id uuid, subject_type text, subject_id uuid, balance_minor text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT a.id, a.code, a.name, a.type, a.status, a.non_negative, a.is_system, a.parent_account_id, a.subject_type,
         a.subject_id,
         (p.balance_minor + coalesce((SELECT sum(cp.balance_minor)
                                        FROM ledger.accounts c
                                        JOIN ledger.balance_projection cp
                                          ON cp.merchant_id = s.merchant_id AND cp.account_id = c.id
                                       WHERE c.merchant_id = s.merchant_id AND c.parent_account_id = a.id), 0))::text,
         a.created_at
    FROM identity.session_authority(p_session_id) s
    JOIN ledger.accounts a ON a.merchant_id = s.merchant_id
    JOIN ledger.balance_projection p ON p.merchant_id = s.merchant_id AND p.account_id = a.id
   WHERE s.audience = 'merchant' AND 'merchant.ledger.read' = ANY (s.permissions)
     AND (p_include_subaccounts OR a.subject_type IS NULL)
   ORDER BY a.code, a.subject_type NULLS FIRST, a.subject_id NULLS FIRST;
$function$;

-- One account, with its balance (the statement's header).
CREATE FUNCTION ledger.read_account(p_session_id uuid, p_account_id uuid)
 RETURNS TABLE(id uuid, code text, name text, type text, status text, non_negative boolean, is_system boolean, parent_account_id uuid, subject_type text, subject_id uuid, balance_minor text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT a.id, a.code, a.name, a.type, a.status, a.non_negative, a.is_system, a.parent_account_id, a.subject_type,
         a.subject_id,
         (p.balance_minor + coalesce((SELECT sum(cp.balance_minor)
                                        FROM ledger.accounts c
                                        JOIN ledger.balance_projection cp
                                          ON cp.merchant_id = s.merchant_id AND cp.account_id = c.id
                                       WHERE c.merchant_id = s.merchant_id AND c.parent_account_id = a.id), 0))::text,
         a.created_at
    FROM identity.session_authority(p_session_id) s
    JOIN ledger.accounts a ON a.merchant_id = s.merchant_id
    JOIN ledger.balance_projection p ON p.merchant_id = s.merchant_id AND p.account_id = a.id
   WHERE s.audience = 'merchant' AND 'merchant.ledger.read' = ANY (s.permissions) AND a.id = p_account_id;
$function$;

-- An account's lines in a period, oldest first (effective date, then line), each with the account's running balance
-- in its normal direction; paginated after (date, line).
CREATE FUNCTION ledger.read_statement(p_session_id uuid, p_account_id uuid, p_from date, p_to date, p_limit integer, p_after_date date DEFAULT NULL::date, p_after_line_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(line_id uuid, entry_id uuid, effective_date date, entry_type text, narrative text, side text, amount_minor text, balance_minor text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  WITH r AS (
    SELECT l.id, l.entry_id, e.effective_date, e.entry_type, e.narrative, l.side, l.amount_minor,
           sum(CASE WHEN l.side = CASE WHEN a.type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END
                    THEN l.amount_minor ELSE -l.amount_minor END)
             OVER (ORDER BY e.effective_date, l.id) AS running
      FROM identity.session_authority(p_session_id) s
      JOIN ledger.accounts a ON a.merchant_id = s.merchant_id AND a.id = p_account_id
      JOIN ledger.journal_lines l ON l.merchant_id = s.merchant_id AND l.account_id = a.id
      JOIN ledger.journal_entries e ON e.merchant_id = s.merchant_id AND e.id = l.entry_id
     WHERE s.audience = 'merchant' AND 'merchant.ledger.read' = ANY (s.permissions) AND e.effective_date <= p_to
  )
  SELECT r.id, r.entry_id, r.effective_date, r.entry_type, r.narrative, r.side, r.amount_minor::text, r.running::text
    FROM r
   WHERE r.effective_date >= p_from
     AND (p_after_date IS NULL OR (r.effective_date, r.id) > (p_after_date, p_after_line_id))
   ORDER BY r.effective_date, r.id
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
$function$;

-- An entry with its lines (one row per line), and the entry that reversed it, if any.
CREATE FUNCTION ledger.read_entry(p_session_id uuid, p_entry_id uuid)
 RETURNS TABLE(id uuid, effective_date date, entry_type text, narrative text, source_type text, source_id text, reverses_entry_id uuid, reversed_by_entry_id uuid, created_by uuid, created_at timestamp with time zone, line_id uuid, account_id uuid, account_code text, account_name text, side text, amount_minor text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT e.id, e.effective_date, e.entry_type, e.narrative, e.source_type, e.source_id, e.reverses_entry_id,
         (SELECT r.id FROM ledger.journal_entries r WHERE r.merchant_id = s.merchant_id AND r.reverses_entry_id = e.id),
         e.created_by, e.created_at, l.id, a.id, a.code, a.name, l.side, l.amount_minor::text
    FROM identity.session_authority(p_session_id) s
    JOIN ledger.journal_entries e ON e.merchant_id = s.merchant_id AND e.id = p_entry_id
    JOIN ledger.journal_lines l ON l.merchant_id = s.merchant_id AND l.entry_id = e.id
    JOIN ledger.accounts a ON a.merchant_id = s.merchant_id AND a.id = l.account_id
   WHERE s.audience = 'merchant' AND 'merchant.ledger.read' = ANY (s.permissions)
   ORDER BY l.id;
$function$;

-- Each account's debits and credits in a period (p_from NULL: from the beginning), sub-accounts rolled into their
-- control account. The trial balance (to a date), the balance sheet (to a date) and the profit and loss (a period)
-- are computed from these.
CREATE FUNCTION ledger.account_movements(p_session_id uuid, p_from date, p_to date)
 RETURNS TABLE(account_id uuid, code text, name text, type text, debit_minor text, credit_minor text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT t.id, t.code, t.name, t.type, coalesce(m.debits, 0)::text, coalesce(m.credits, 0)::text
    FROM identity.session_authority(p_session_id) s
    JOIN ledger.accounts t ON t.merchant_id = s.merchant_id AND t.subject_type IS NULL
    LEFT JOIN (
      SELECT coalesce(a.parent_account_id, a.id) AS top_id,
             sum(l.amount_minor) FILTER (WHERE l.side = 'debit') AS debits,
             sum(l.amount_minor) FILTER (WHERE l.side = 'credit') AS credits
        FROM identity.session_authority(p_session_id) s2
        JOIN ledger.journal_entries e ON e.merchant_id = s2.merchant_id AND e.effective_date <= p_to
                                     AND (p_from IS NULL OR e.effective_date >= p_from)
        JOIN ledger.journal_lines l ON l.merchant_id = s2.merchant_id AND l.entry_id = e.id
        JOIN ledger.accounts a ON a.merchant_id = s2.merchant_id AND a.id = l.account_id
       GROUP BY 1
    ) m ON m.top_id = t.id
   WHERE s.audience = 'merchant' AND 'merchant.ledger.read' = ANY (s.permissions)
   ORDER BY t.code;
$function$;

REVOKE ALL ON FUNCTION ledger.create_account(uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.post_manual_entry(uuid, text, text, date, text, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.reverse_entry(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.list_accounts(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.read_account(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.read_statement(uuid, uuid, date, date, integer, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.read_entry(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger.account_movements(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ledger.create_account(uuid, text, text, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION ledger.post_manual_entry(uuid, text, text, date, text, jsonb, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION ledger.reverse_entry(uuid, uuid, text, text, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION ledger.list_accounts(uuid, boolean) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION ledger.read_account(uuid, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION ledger.read_statement(uuid, uuid, date, date, integer, date, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION ledger.read_entry(uuid, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION ledger.account_movements(uuid, date, date) TO alphakolect_app;
