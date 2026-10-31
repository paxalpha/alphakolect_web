-- P9: payments — the worker's functions, the business's and the platform team's commands and reads, the permissions
-- and the activity events (docs/architecture/P9_IMPLEMENTATION_PLAN.md §3, §4; the owner's answers of 2026-10-26).
--
-- The worker (TA-11) connects as alphakolect_app and calls the functions without a session: it requests the wallets
-- the rules allow (BR-2.3: a business only once its email is confirmed), claims due work with a lease (no row is
-- waited for: SKIP LOCKED), calls the provider outside any transaction (P9-4), and records what the provider said. It
-- never decides an amount or an account itself: payments.record_event takes only what the provider confirmed for a
-- transaction (TA-8, P9-2), so a forged event — which the provider does not confirm — credits nothing, and a replayed one
-- finds its transaction already acted on (unique on the provider and its id).
-- The business's commands and reads take its session; the platform team's take theirs, and every platform read of the
-- businesses' payments is a sensitive read, recorded before its rows are returned (P5 §8.2a rule 7).
-- Lock order: the projections posted to (14), then the payments rows (18); postings go through the …_locked core (P8).
-- TA-14: events carry identifiers, kinds and amounts only. Forward-only; earlier migrations untouched.

INSERT INTO identity.permission_catalog (identifier, scope, grantable, description) VALUES
  ('merchant.wallet.read', 'merchant', true,
   'See the business''s Live wallet: its account number, balance and the money received.'),
  ('merchant.wallet.classify', 'merchant', true, 'Record what money received in the Live wallet was for.'),
  ('platform.payments.read', 'platform', true,
   'See the Live wallets, payments and reconciliation results of every business.'),
  ('platform.payments.resolve', 'platform', true,
   'Resolve money we have no record of, and differences found by reconciliation.'),
  ('platform.wallet.create', 'platform', false,
   'Create AlphaKolect''s Platform Live wallet, once. Super admin only.');

INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('payments.wallet_provisioned', 'success', 'atomic', 'A', '{"ownerKind": {"type": "string", "max": 16}}'),
  ('payments.money_received', 'success', 'atomic', 'A',
   '{"amountMinor": {"type": "string", "max": 20}, "receiptId": {"type": "string", "max": 36}}'),
  ('payments.receipt_classified', 'success', 'atomic', 'A',
   '{"accountId": {"type": "string", "max": 36}, "amountMinor": {"type": "string", "max": 20}}'),
  ('payments.receipt_classified', 'denied', 'best_effort', NULL,
   '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('payments.finding_recorded', 'success', 'atomic', 'A',
   '{"scope": {"type": "string", "max": 16}, "providerMinor": {"type": "string", "max": 20}, "booksMinor": {"type": "string", "max": 20}}'),
  ('payments.unmatched_resolved', 'success', 'atomic', 'A',
   '{"resolution": {"type": "string", "max": 16}, "merchantId": {"type": "string", "max": 36, "nullable": true}}'),
  ('payments.unmatched_resolved', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('payments.finding_resolved', 'success', 'atomic', 'A', '{}'),
  ('payments.finding_resolved', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('payments.platform_wallet_requested', 'success', 'atomic', 'A', '{}'),
  ('payments.platform_wallet_requested', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.wallets_read', 'success', 'sensitive_read', NULL,
   '{"limit": {"type": "integer"}, "continued": {"type": "boolean"}}'),
  ('platform.wallets_read', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.unmatched_read', 'success', 'sensitive_read', NULL,
   '{"limit": {"type": "integer"}, "continued": {"type": "boolean"}}'),
  ('platform.unmatched_read', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.findings_read', 'success', 'sensitive_read', NULL,
   '{"limit": {"type": "integer"}, "continued": {"type": "boolean"}}'),
  ('platform.findings_read', 'denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}');

-- ── the worker: wallets (BR-2.3, Q7) ──

-- Request a wallet for every business whose email is confirmed (an active business) and that has none; and, when the
-- switch is on (never in production, OPEN-12), for every active customer of such a business. The alias is fixed per
-- owner. Returns how many were requested.
CREATE FUNCTION payments.request_wallets(p_provider text, p_customer_wallets boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchants integer;
  v_customers integer := 0;
BEGIN
  INSERT INTO payments.live_wallets (owner_kind, merchant_id, provider, alias)
  SELECT 'merchant', m.id, p_provider, 'AKM-' || replace(m.id::text, '-', '')
    FROM tenancy.merchants m
   WHERE m.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM payments.live_wallets w WHERE w.owner_kind = 'merchant' AND w.merchant_id = m.id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_merchants = ROW_COUNT;
  IF p_customer_wallets THEN
    INSERT INTO payments.live_wallets (owner_kind, merchant_id, customer_id, provider, alias)
    SELECT 'customer', c.merchant_id, c.id, p_provider, 'AKC-' || replace(c.id::text, '-', '')
      FROM customers.customers c JOIN tenancy.merchants m ON m.id = c.merchant_id AND m.status = 'active'
     WHERE c.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM payments.live_wallets w WHERE w.owner_kind = 'customer' AND w.customer_id = c.id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_customers = ROW_COUNT;
  END IF;
  RETURN v_merchants + v_customers;
END
$function$;

-- The wallets due for creation, leased to this worker for p_lease_seconds (a row another worker holds is skipped).
CREATE FUNCTION payments.claim_wallets(p_limit integer, p_lease_seconds integer)
 RETURNS TABLE(id uuid, owner_kind text, merchant_id uuid, customer_id uuid, provider text, alias text, display_name text, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT w.id FROM payments.live_wallets w
     WHERE w.status = 'provisioning' AND w.next_attempt_at <= now()
       AND (w.lease_until IS NULL OR w.lease_until < now())
     ORDER BY w.next_attempt_at, w.id
     LIMIT p_limit
       FOR NO KEY UPDATE SKIP LOCKED)
  UPDATE payments.live_wallets w
     SET lease_until = now() + make_interval(secs => p_lease_seconds), attempts = w.attempts + 1
    FROM due
   WHERE w.id = due.id
  RETURNING w.id, w.owner_kind, w.merchant_id, w.customer_id, w.provider, w.alias,
            coalesce((SELECT c.full_name FROM customers.customers c WHERE c.id = w.customer_id),
                     (SELECT m.name FROM tenancy.merchants m WHERE m.id = w.merchant_id), 'AlphaKolect'),
            w.attempts;
END
$function$;

-- The provider created (or, after a timeout, already had) the account. Outcomes: 'ok', 'not_found', 'invalid_status'.
CREATE FUNCTION payments.record_wallet_created(p_wallet_id uuid, p_provider_ref text, p_account_number text, p_account_name text, p_bank_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_wallet payments.live_wallets%ROWTYPE;
BEGIN
  SELECT * INTO v_wallet FROM payments.live_wallets w WHERE w.id = p_wallet_id FOR NO KEY UPDATE;
  IF v_wallet.id IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF v_wallet.status <> 'provisioning' THEN
    RETURN 'invalid_status';
  END IF;
  UPDATE payments.live_wallets w
     SET status = 'active', provider_ref = p_provider_ref, account_number = p_account_number,
         account_name = p_account_name, bank_name = p_bank_name, activated_at = now(), lease_until = NULL,
         last_error = NULL
   WHERE w.id = v_wallet.id;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     summary)
  VALUES (v_wallet.merchant_id, NULL, NULL, NULL, 'payments.wallet_provisioned', 'live_wallet', v_wallet.id::text,
          'success', jsonb_build_object('ownerKind', v_wallet.owner_kind));
  RETURN 'ok';
END
$function$;

-- The provider refused, or the outcome is unknown and the alias lookup found nothing yet: try again later, with a
-- growing delay; after p_max_attempts, 'failed' for the platform team. Outcomes: 'retry', 'failed', 'not_found'.
CREATE FUNCTION payments.record_wallet_failed(p_wallet_id uuid, p_error text, p_max_attempts integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_wallet payments.live_wallets%ROWTYPE;
BEGIN
  SELECT * INTO v_wallet FROM payments.live_wallets w WHERE w.id = p_wallet_id FOR NO KEY UPDATE;
  IF v_wallet.id IS NULL OR v_wallet.status <> 'provisioning' THEN
    RETURN 'not_found';
  END IF;
  UPDATE payments.live_wallets w
     SET status = CASE WHEN w.attempts >= p_max_attempts THEN 'failed' ELSE 'provisioning' END,
         next_attempt_at = now() + make_interval(mins => least(60, power(2, least(w.attempts, 6))::integer)),
         lease_until = NULL, last_error = left(p_error, 500)
   WHERE w.id = v_wallet.id;
  RETURN CASE WHEN v_wallet.attempts >= p_max_attempts THEN 'failed' ELSE 'retry' END;
END
$function$;

-- ── the worker: events (TA-8) ──

-- A notification as received, stored before it is acknowledged. The reference is what the event claims, a lead only.
CREATE FUNCTION payments.store_event(p_provider text, p_headers jsonb, p_body text, p_reference text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  INSERT INTO payments.provider_events (provider, headers, body, reference)
  VALUES (p_provider, coalesce(p_headers, '{}'::jsonb), p_body,
          CASE WHEN p_reference ~ '^[\x21-\x7e]{1,128}$' THEN p_reference END)
  RETURNING id;
$function$;

CREATE FUNCTION payments.claim_events(p_limit integer, p_lease_seconds integer)
 RETURNS TABLE(id uuid, provider text, reference text, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT e.id FROM payments.provider_events e
     WHERE e.status IN ('received', 'pending') AND e.next_check_at <= now()
       AND (e.lease_until IS NULL OR e.lease_until < now())
     ORDER BY e.next_check_at, e.id
     LIMIT p_limit
       FOR NO KEY UPDATE SKIP LOCKED)
  UPDATE payments.provider_events e
     SET lease_until = now() + make_interval(secs => p_lease_seconds), attempts = e.attempts + 1
    FROM due
   WHERE e.id = due.id
  RETURNING e.id, e.provider, e.reference, e.attempts;
END
$function$;

-- What the provider confirmed for an event's transaction (P9-2): never the event's own claims.
-- p_found false: the provider has no such transaction — a forged event, or one not visible yet; after p_max_attempts it
-- is rejected and nothing is credited. p_status: the provider's 'pending' (checked again later), or a final
-- 'successful', 'failed' or 'reversed'. Outcomes: 'credited', 'held', 'unmatched', 'ignored', 'review', 'duplicate',
-- 'pending', 'rejected', 'not_found'.
CREATE FUNCTION payments.record_event(p_event_id uuid, p_found boolean, p_provider_tx_id text, p_account_number text, p_amount_minor bigint, p_currency text, p_status text, p_occurred_at timestamp with time zone, p_max_attempts integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_event payments.provider_events%ROWTYPE;
  v_wallet payments.live_wallets%ROWTYPE;
  v_existing payments.provider_transactions%ROWTYPE;
  v_ledger uuid;
  v_accounts uuid[];
  v_matched text;
  v_tx uuid := util.uuid_v7();
  v_receipt uuid := util.uuid_v7();
  v_inserted uuid;
  v_post record;
  v_entry uuid;
  v_outcome text;
BEGIN
  SELECT * INTO v_event FROM payments.provider_events e WHERE e.id = p_event_id;
  IF v_event.id IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF p_found AND p_status IN ('successful', 'failed', 'reversed') THEN
    SELECT * INTO v_wallet FROM payments.live_wallets w
     WHERE w.provider = v_event.provider AND w.account_number = p_account_number;
    IF v_wallet.owner_kind IN ('merchant', 'platform') AND v_wallet.status = 'active' THEN
      SELECT l.id INTO v_ledger FROM ledger.ledgers l
       WHERE (v_wallet.owner_kind = 'merchant' AND l.merchant_id = v_wallet.merchant_id)
          OR (v_wallet.owner_kind = 'platform' AND l.owner_kind = 'platform');
      SELECT array_agg(a.id ORDER BY a.id) INTO v_accounts
        FROM ledger.accounts a WHERE a.ledger_id = v_ledger AND a.code IN ('1100', '2290') AND a.subject_type IS NULL;
    END IF;
  END IF;
  -- The footprint: the projections a credit posts to (14), then the event (18).
  PERFORM ledger.lock_projections(NULL, v_accounts);
  PERFORM 1 FROM payments.provider_events e WHERE e.id = v_event.id FOR NO KEY UPDATE;
  SELECT * INTO v_event FROM payments.provider_events e WHERE e.id = v_event.id;
  IF v_event.status IN ('done', 'rejected') THEN
    RETURN 'duplicate';
  END IF;
  IF NOT p_found OR p_status = 'pending' THEN
    v_outcome := CASE WHEN NOT p_found AND v_event.attempts >= p_max_attempts THEN 'rejected' ELSE 'pending' END;
    UPDATE payments.provider_events e
       SET status = v_outcome, outcome = CASE WHEN v_outcome = 'rejected' THEN 'not_confirmed' END,
           processed_at = CASE WHEN v_outcome = 'rejected' THEN now() END, lease_until = NULL,
           next_check_at = now() + make_interval(mins => least(60, power(2, least(e.attempts, 6))::integer))
     WHERE e.id = v_event.id;
    RETURN v_outcome;
  END IF;
  IF p_status NOT IN ('successful', 'failed', 'reversed') OR p_amount_minor IS NULL OR p_amount_minor < 1
     OR p_currency IS DISTINCT FROM 'NGN' OR coalesce(p_provider_tx_id, '') !~ '^[\x21-\x7e]{1,128}$' THEN
    RAISE EXCEPTION 'payments: an unusable confirmation for event %', v_event.id USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Acted on before: the same answer again is a duplicate. An answer that contradicts what was recorded (another status
  -- or amount) goes to the platform team for review, whatever had been done with it — nothing is credited or debited
  -- automatically (TA-8, E1).
  SELECT * INTO v_existing FROM payments.provider_transactions t
   WHERE t.provider = v_event.provider AND t.provider_tx_id = p_provider_tx_id;
  IF v_existing.id IS NOT NULL THEN
    v_outcome := 'duplicate';
    IF p_status <> v_existing.provider_status OR p_amount_minor <> v_existing.amount_minor THEN
      UPDATE payments.provider_transactions t
         SET provider_status = p_status, amount_minor = p_amount_minor, matched = 'review', resolution = NULL,
             resolution_note = NULL, resolved_by = NULL, resolved_at = NULL
       WHERE t.id = v_existing.id;
      v_outcome := 'review';
    END IF;
    UPDATE payments.provider_events e
       SET status = 'done', outcome = v_outcome, processed_at = now(), lease_until = NULL WHERE e.id = v_event.id;
    RETURN v_outcome;
  END IF;
  v_matched := CASE WHEN p_status <> 'successful' THEN 'ignored'
                    WHEN v_wallet.id IS NULL OR v_wallet.status <> 'active' THEN 'unmatched'
                    WHEN v_wallet.owner_kind = 'customer' THEN 'held'
                    ELSE 'credited' END;
  IF v_matched = 'credited' THEN
    SELECT * INTO v_post
      FROM ledger.post_template_locked(v_ledger,
                                       CASE v_wallet.owner_kind WHEN 'merchant' THEN 'wallet.received'
                                                                ELSE 'platform.wallet_received' END,
                                       p_amount_minor, '{}'::jsonb,
                                       'payments.tx.' || v_event.provider || '.' || p_provider_tx_id, current_date,
                                       'Money received in the Live wallet', 'provider_transaction', v_tx::text,
                                       NULL, NULL);
    IF v_post.outcome IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'payments: transaction % was not posted (%)', p_provider_tx_id, v_post.outcome;
    END IF;
    v_entry := v_post.entry_id;
  END IF;
  -- The contested inserts last (L3): the transaction, once, and the business's receipt. A credit's concurrent duplicate
  -- waits on the projections above and finds it; one with no projections to wait on ends here as a duplicate.
  INSERT INTO payments.provider_transactions
    (id, provider, provider_tx_id, wallet_id, account_number, amount_minor, currency, provider_status, matched,
     occurred_at, entry_id)
  VALUES (v_tx, v_event.provider, p_provider_tx_id, CASE WHEN v_matched <> 'unmatched' THEN v_wallet.id END,
          p_account_number, p_amount_minor, p_currency, p_status,
          v_matched, p_occurred_at, v_entry)
  ON CONFLICT DO NOTHING
  RETURNING payments.provider_transactions.id INTO v_inserted;
  IF v_inserted IS NULL THEN
    IF v_matched = 'credited' THEN
      RAISE EXCEPTION 'payments: transaction % was credited concurrently', p_provider_tx_id;
    END IF;
    UPDATE payments.provider_events e
       SET status = 'done', outcome = 'duplicate', processed_at = now(), lease_until = NULL WHERE e.id = v_event.id;
    RETURN 'duplicate';
  END IF;
  IF v_matched = 'credited' AND v_wallet.owner_kind = 'merchant' THEN
    INSERT INTO payments.receipts (id, merchant_id, wallet_id, transaction_id, amount_minor, received_entry_id)
    VALUES (v_receipt, v_wallet.merchant_id, v_wallet.id, v_tx, p_amount_minor, v_entry);
    INSERT INTO audit.audit_events
      (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
       summary)
    VALUES (v_wallet.merchant_id, NULL, NULL, NULL, 'payments.money_received', 'live_wallet', v_wallet.id::text,
            'success', jsonb_build_object('amountMinor', p_amount_minor::text, 'receiptId', v_receipt::text));
  END IF;
  UPDATE payments.provider_events e
     SET status = 'done', outcome = v_matched, processed_at = now(), lease_until = NULL WHERE e.id = v_event.id;
  RETURN v_matched;
END
$function$;

-- ── the worker: payment orders (TA-8) ──

-- The accounts a template posts to in a ledger, for a command to lock before it posts (P8-3).
CREATE FUNCTION payments.template_accounts(p_ledger_id uuid, p_template text, p_subjects jsonb)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT array_agg(DISTINCT a.id ORDER BY a.id)
    FROM ledger.posting_templates t
    CROSS JOIN LATERAL jsonb_array_elements(t.lines) l
    JOIN ledger.accounts a
      ON a.ledger_id = p_ledger_id AND a.code = l ->> 'code'
     AND a.subject_type IS NOT DISTINCT FROM l ->> 'subject'
     AND a.subject_id IS NOT DISTINCT FROM CASE WHEN l ->> 'subject' IS NULL THEN NULL::uuid
                                                ELSE (p_subjects ->> (l ->> 'subject'))::uuid END
   WHERE t.code = p_template AND t.status = 'active';
$function$;

-- An order to pay out of a wallet (Q2: created by billing from P10 and by tests; never by the app in P9).
CREATE FUNCTION payments.create_order(p_from_wallet_id uuid, p_to_wallet_id uuid, p_to_bank jsonb, p_amount_minor bigint, p_reference text, p_purpose text, p_ledger_id uuid, p_posting_template text, p_posting_subjects jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  INSERT INTO payments.payment_orders
    (from_wallet_id, to_wallet_id, to_bank, amount_minor, reference, purpose, ledger_id, posting_template,
     posting_subjects)
  SELECT w.id, p_to_wallet_id, p_to_bank, p_amount_minor, p_reference, p_purpose, p_ledger_id,
         p_posting_template, coalesce(p_posting_subjects, '{}'::jsonb)
    FROM payments.live_wallets w WHERE w.id = p_from_wallet_id AND w.status = 'active'
  RETURNING id;
$function$;

-- The orders due: 'created' ones to send; 'submitted' and 'unknown' ones to look up by our reference — never to send
-- again (TA-8: TransactPay does not document that a repeated reference is done once, D2). A 'created' order becomes
-- 'unknown' as it is claimed, before anything is sent: a worker that dies after sending leaves it to be looked up, not
-- sent twice. prior_state says which: 'created' is the one and only licence to send.
CREATE FUNCTION payments.claim_orders(p_limit integer, p_lease_seconds integer)
 RETURNS TABLE(id uuid, prior_state text, reference text, amount_minor bigint, from_provider_ref text, to_provider_ref text, to_bank jsonb, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT o.id, o.state AS prior_state FROM payments.payment_orders o
     WHERE o.state IN ('created', 'submitted', 'unknown') AND o.next_check_at <= now()
       AND (o.lease_until IS NULL OR o.lease_until < now())
     ORDER BY o.next_check_at, o.id
     LIMIT p_limit
       FOR NO KEY UPDATE SKIP LOCKED)
  UPDATE payments.payment_orders o
     SET state = CASE WHEN due.prior_state = 'created' THEN 'unknown' ELSE o.state END,
         lease_until = now() + make_interval(secs => p_lease_seconds), attempts = o.attempts + 1
    FROM due
   WHERE o.id = due.id
  RETURNING o.id, due.prior_state, o.reference, o.amount_minor,
            (SELECT w.provider_ref FROM payments.live_wallets w WHERE w.id = o.from_wallet_id),
            (SELECT w.provider_ref FROM payments.live_wallets w WHERE w.id = o.to_wallet_id),
            o.to_bank, o.attempts;
END
$function$;

-- What the provider said about an order that is not finished: 'submitted', 'unknown' (a timeout, or a lookup that found
-- nothing: the outcome is not known, TA-8), 'failed' or 'succeeded'. Success posts the order's template once, keyed by
-- the order. Outcomes: 'ok', 'not_found', 'invalid_transition'.
CREATE FUNCTION payments.record_order(p_order_id uuid, p_state text, p_provider_ref text, p_provider_tx_id text, p_error text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_order payments.payment_orders%ROWTYPE;
  v_accounts uuid[];
  v_post record;
  v_entry uuid;
BEGIN
  SELECT * INTO v_order FROM payments.payment_orders o WHERE o.id = p_order_id;
  IF v_order.id IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF p_state = 'succeeded' THEN
    v_accounts := payments.template_accounts(v_order.ledger_id, v_order.posting_template, v_order.posting_subjects);
  END IF;
  PERFORM ledger.lock_projections(NULL, v_accounts);
  PERFORM 1 FROM payments.payment_orders o WHERE o.id = v_order.id FOR NO KEY UPDATE;
  SELECT * INTO v_order FROM payments.payment_orders o WHERE o.id = v_order.id;
  IF p_state IS NULL OR p_state NOT IN ('submitted', 'unknown', 'failed', 'succeeded')
     OR v_order.state NOT IN ('submitted', 'unknown') THEN
    RETURN 'invalid_transition';
  END IF;
  IF p_state = 'succeeded' THEN
    SELECT * INTO v_post
      FROM ledger.post_template_locked(v_order.ledger_id, v_order.posting_template, v_order.amount_minor,
                                       v_order.posting_subjects, 'payments.order.' || v_order.id::text, current_date,
                                       'Payment ' || v_order.reference, 'payment_order', v_order.id::text, NULL, NULL);
    IF v_post.outcome IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'payments: order % was not posted (%)', v_order.id, v_post.outcome;
    END IF;
    v_entry := v_post.entry_id;
  END IF;
  UPDATE payments.payment_orders o
     SET state = p_state, provider_ref = coalesce(p_provider_ref, o.provider_ref),
         provider_tx_id = coalesce(p_provider_tx_id, o.provider_tx_id), last_error = left(p_error, 500),
         entry_id = v_entry, lease_until = NULL,
         finished_at = CASE WHEN p_state IN ('succeeded', 'failed') THEN now() END,
         next_check_at = now() + make_interval(mins => least(60, power(2, least(o.attempts, 6))::integer))
   WHERE o.id = v_order.id;
  RETURN 'ok';
END
$function$;

-- ── the worker: reconciliation (Q5) ──

-- Every active business and platform wallet with the balance of the account it mirrors (1100), for the reconciler.
CREATE FUNCTION payments.reconcile_wallets()
 RETURNS TABLE(wallet_id uuid, owner_kind text, provider text, provider_ref text, account_number text, books_minor bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT w.id, w.owner_kind, w.provider, w.provider_ref, w.account_number, p.balance_minor
    FROM payments.live_wallets w
    JOIN ledger.ledgers l ON (w.owner_kind = 'merchant' AND l.merchant_id = w.merchant_id)
                          OR (w.owner_kind = 'platform' AND l.owner_kind = 'platform')
    JOIN ledger.accounts a ON a.ledger_id = l.id AND a.code = '1100' AND a.subject_type IS NULL
    JOIN ledger.balance_projection p ON p.account_id = a.id
   WHERE w.status = 'active' AND w.owner_kind IN ('merchant', 'platform')
   ORDER BY w.id;
$function$;

-- A difference between the provider and the books, kept open for the platform team until a person resolves it (Q5);
-- seen again, the open finding is updated. Outcomes: 'match' (no difference), 'recorded', 'seen_again'.
CREATE FUNCTION payments.record_finding(p_scope text, p_wallet_id uuid, p_provider_minor bigint, p_books_minor bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_provider_minor = p_books_minor THEN
    RETURN 'match';
  END IF;
  UPDATE payments.reconciliation_findings f
     SET last_seen_at = now(), provider_balance_minor = p_provider_minor, books_balance_minor = p_books_minor
   WHERE f.status = 'open' AND f.scope = p_scope AND f.wallet_id IS NOT DISTINCT FROM p_wallet_id
  RETURNING f.id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN 'seen_again';
  END IF;
  INSERT INTO payments.reconciliation_findings (scope, wallet_id, provider_balance_minor, books_balance_minor)
  VALUES (p_scope, p_wallet_id, p_provider_minor, p_books_minor)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN 'seen_again';
  END IF;
  -- The platform's record (Q5: the business is not told until it is understood).
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     summary)
  VALUES (NULL, NULL, NULL, NULL, 'payments.finding_recorded', 'reconciliation_finding', v_id::text, 'success',
          jsonb_build_object('scope', p_scope, 'providerMinor', p_provider_minor::text,
                             'booksMinor', p_books_minor::text));
  RETURN 'recorded';
END
$function$;

-- ── the business: its Live wallet and the money received (Q1) ──

CREATE FUNCTION payments.merchant_wallet(p_session_id uuid)
 RETURNS TABLE(id uuid, status text, account_number text, account_name text, bank_name text, balance_minor bigint, to_classify_minor bigint, activated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT w.id, w.status, w.account_number, w.account_name, w.bank_name,
         (SELECT p.balance_minor FROM ledger.accounts a
            JOIN ledger.balance_projection p ON p.merchant_id = a.merchant_id AND p.account_id = a.id
           WHERE a.merchant_id = s.merchant_id AND a.code = '1100' AND a.subject_type IS NULL),
         (SELECT p.balance_minor FROM ledger.accounts a
            JOIN ledger.balance_projection p ON p.merchant_id = a.merchant_id AND p.account_id = a.id
           WHERE a.merchant_id = s.merchant_id AND a.code = '2290' AND a.subject_type IS NULL),
         w.activated_at
    FROM identity.session_authority(p_session_id) s
    JOIN payments.live_wallets w ON w.merchant_id = s.merchant_id AND w.owner_kind = 'merchant'
   WHERE s.audience = 'merchant' AND 'merchant.wallet.read' = ANY (s.permissions);
$function$;

-- A page of the money received, oldest first; filtered by whether it is classified.
CREATE FUNCTION payments.list_receipts(p_session_id uuid, p_classified boolean DEFAULT NULL::boolean, p_limit integer DEFAULT NULL::integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, amount_minor bigint, received_at timestamp with time zone, classified_account_id uuid, classified_note text, classified_at timestamp with time zone, created_at timestamp with time zone)
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
  SELECT r.id, r.amount_minor, t.occurred_at, r.classified_account_id, r.classified_note, r.classified_at, r.created_at
    FROM identity.session_authority(p_session_id) s
    JOIN payments.receipts r ON r.merchant_id = s.merchant_id
    JOIN payments.provider_transactions t ON t.id = r.transaction_id
   WHERE s.audience = 'merchant' AND 'merchant.wallet.read' = ANY (s.permissions)
     AND (p_classified IS NULL OR (r.classified_at IS NOT NULL) = p_classified)
     AND (p_after_id IS NULL OR (r.created_at, r.id) > (p_after_created_at, p_after_id))
   ORDER BY r.created_at, r.id
   LIMIT p_limit + 1;
END
$function$;

-- Record what money received was for (Q1): Dr 2290 / Cr the account chosen — one of the business's own accounts, not a
-- customer's or an agent's (their money comes through collections, BR-4.5). Outcomes: 'ok', 'forbidden', 'not_found',
-- 'invalid', 'invalid_status' (already classified), 'invalid_account'.
CREATE FUNCTION payments.classify_receipt(p_session_id uuid, p_receipt_id uuid, p_account_id uuid, p_note text DEFAULT NULL::text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, amount_minor bigint, classified_account_id uuid, classified_note text, classified_at timestamp with time zone, received_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_merchant uuid;
  v_actor uuid;
  v_actor_identity uuid;
  v_actor_role uuid;
  v_receipt payments.receipts%ROWTYPE;
  v_ledger uuid;
  v_holding uuid;
  v_account ledger.accounts%ROWTYPE;
  v_accounts uuid[];
  v_post record;
BEGIN
  SELECT v.merchant_id, v.membership_id, v.identity_id, v.role_id
    INTO v_merchant, v_actor, v_actor_identity, v_actor_role
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'merchant';
  IF v_merchant IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::bigint, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_receipt FROM payments.receipts r WHERE r.id = p_receipt_id AND r.merchant_id = v_merchant;
  SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = v_merchant;
  SELECT a.id INTO v_holding FROM ledger.accounts a
   WHERE a.ledger_id = v_ledger AND a.code = '2290' AND a.subject_type IS NULL;
  SELECT * INTO v_account FROM ledger.accounts a WHERE a.id = p_account_id AND a.ledger_id = v_ledger;
  v_accounts := ARRAY[v_holding, v_account.id];
  PERFORM 1 FROM tenancy.merchants m WHERE m.id = v_merchant FOR SHARE;
  PERFORM tenancy.lock_memberships(NULL, ARRAY[v_actor]);
  PERFORM tenancy.lock_roles(ARRAY[v_actor_role], NULL);
  PERFORM ledger.lock_projections(NULL, v_accounts);
  PERFORM 1 FROM payments.receipts r WHERE r.id = v_receipt.id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'merchant.wallet.classify') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::bigint, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_receipt FROM payments.receipts r WHERE r.id = v_receipt.id;
  IF v_receipt.id IS NULL THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::bigint, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_note IS NOT NULL AND char_length(btrim(p_note)) NOT BETWEEN 1 AND 300 THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::bigint, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_receipt.classified_at IS NOT NULL THEN
    RETURN QUERY SELECT 'invalid_status', NULL::uuid, NULL::bigint, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  -- The business's own account, active: not the wallet or the holding account, not a sub-account of a customer or an
  -- agent, not a control account whose balance lives in sub-accounts.
  IF v_account.id IS NULL OR v_account.status <> 'active' OR v_account.code IN ('1100', '2290')
     OR v_account.subject_type IS NOT NULL
     OR EXISTS (SELECT 1 FROM ledger.chart_template t
                 WHERE t.ledger_kind = 'merchant' AND t.code = v_account.code AND t.subject_type IS NOT NULL) THEN
    RETURN QUERY SELECT 'invalid_account', NULL::uuid, NULL::bigint, NULL::uuid, NULL::text, NULL::timestamptz,
                        NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_post
    FROM ledger.post_entry_locked(v_ledger, 'payments.receipt.' || v_receipt.id::text || '.classified',
                                  'payments.receipt_classified', current_date,
                                  coalesce(btrim(p_note), 'Money received, classified'), 'payments_receipt',
                                  v_receipt.id::text,
                                  jsonb_build_array(
                                    jsonb_build_object('accountId', v_holding::text, 'side', 'debit',
                                                       'amountMinor', v_receipt.amount_minor::text),
                                    jsonb_build_object('accountId', v_account.id::text, 'side', 'credit',
                                                       'amountMinor', v_receipt.amount_minor::text)),
                                  v_actor_identity, v_actor);
  IF v_post.outcome IS DISTINCT FROM 'ok' THEN
    RAISE EXCEPTION 'payments: receipt % was not classified (%)', v_receipt.id, v_post.outcome;
  END IF;
  UPDATE payments.receipts r
     SET classified_account_id = v_account.id, classified_entry_id = v_post.entry_id, classified_note = btrim(p_note),
         classified_by = v_actor, classified_at = now()
   WHERE r.id = v_receipt.id;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (v_merchant, v_actor_identity, 'merchant', v_actor, 'payments.receipt_classified', 'payments_receipt',
          v_receipt.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('accountId', v_account.id::text, 'amountMinor', v_receipt.amount_minor::text));
  RETURN QUERY SELECT 'ok', r.id, r.amount_minor, r.classified_account_id, r.classified_note, r.classified_at,
                      t.occurred_at, r.created_at
                 FROM payments.receipts r
                 JOIN payments.provider_transactions t ON t.id = r.transaction_id
                WHERE r.id = v_receipt.id;
END
$function$;

-- ── the platform team: sensitive reads (P5 §8.2a rule 7) ──

-- Every Live wallet, newest first, with the balance of the account it mirrors.
CREATE FUNCTION payments.platform_list_wallets(p_session_id uuid, p_limit integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, owner_kind text, merchant_id uuid, merchant_name text, status text, account_number text, bank_name text, attempts integer, last_error text, books_minor bigint, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::text, NULL::integer, NULL::text, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], NULL);
  IF tenancy.assert_authority(p_session_id, 'platform.payments.read') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::text, NULL::integer, NULL::text, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (NULL, v_actor_identity, 'platform', v_actor, 'platform.wallets_read', NULL, NULL, 'success',
          p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('limit', p_limit, 'continued', p_after_id IS NOT NULL));
  RETURN QUERY
  SELECT 'ok', w.id, w.owner_kind, w.merchant_id, m.name, w.status, w.account_number, w.bank_name, w.attempts,
         w.last_error,
         (SELECT p.balance_minor FROM ledger.ledgers l
            JOIN ledger.accounts a ON a.ledger_id = l.id AND a.code = '1100' AND a.subject_type IS NULL
            JOIN ledger.balance_projection p ON p.account_id = a.id
           WHERE (w.owner_kind = 'merchant' AND l.merchant_id = w.merchant_id)
              OR (w.owner_kind = 'platform' AND l.owner_kind = 'platform')),
         w.created_at
    FROM payments.live_wallets w
    LEFT JOIN tenancy.merchants m ON m.id = w.merchant_id
   WHERE p_after_id IS NULL OR (w.created_at, w.id) < (p_after_created_at, p_after_id)
   ORDER BY w.created_at DESC, w.id DESC
   LIMIT p_limit + 1;
END
$function$;

-- The provider transactions nobody's books hold yet (Q4), and those under review, newest first.
CREATE FUNCTION payments.platform_list_unmatched(p_session_id uuid, p_limit integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, provider text, provider_tx_id text, account_number text, amount_minor bigint, provider_status text, matched text, merchant_id uuid, occurred_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text,
                        NULL::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], NULL);
  IF tenancy.assert_authority(p_session_id, 'platform.payments.read') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text,
                        NULL::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (NULL, v_actor_identity, 'platform', v_actor, 'platform.unmatched_read', NULL, NULL, 'success',
          p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('limit', p_limit, 'continued', p_after_id IS NOT NULL));
  RETURN QUERY
  SELECT 'ok', t.id, t.provider, t.provider_tx_id, t.account_number, t.amount_minor, t.provider_status, t.matched,
         (SELECT w.merchant_id FROM payments.live_wallets w WHERE w.id = t.wallet_id), t.occurred_at, t.confirmed_at
    FROM payments.provider_transactions t
   WHERE t.matched IN ('unmatched', 'review')
     AND (p_after_id IS NULL OR (t.confirmed_at, t.id) < (p_after_created_at, p_after_id))
   ORDER BY t.confirmed_at DESC, t.id DESC
   LIMIT p_limit + 1;
END
$function$;

-- The reconciliation differences, newest first; open ones only unless asked.
CREATE FUNCTION payments.platform_list_findings(p_session_id uuid, p_limit integer, p_open_only boolean DEFAULT true, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, scope text, wallet_id uuid, merchant_id uuid, provider_minor bigint, books_minor bigint, status text, found_at timestamp with time zone, last_seen_at timestamp with time zone, resolution_note text, resolved_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint,
                        NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], NULL);
  IF tenancy.assert_authority(p_session_id, 'platform.payments.read') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint,
                        NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (NULL, v_actor_identity, 'platform', v_actor, 'platform.findings_read', NULL, NULL, 'success',
          p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('limit', p_limit, 'continued', p_after_id IS NOT NULL));
  RETURN QUERY
  SELECT 'ok', f.id, f.scope, f.wallet_id, w.merchant_id, f.provider_balance_minor, f.books_balance_minor, f.status,
         f.found_at, f.last_seen_at, f.resolution_note, f.resolved_at
    FROM payments.reconciliation_findings f
    LEFT JOIN payments.live_wallets w ON w.id = f.wallet_id
   WHERE (NOT p_open_only OR f.status = 'open')
     AND (p_after_id IS NULL OR (f.found_at, f.id) < (p_after_created_at, p_after_id))
   ORDER BY f.found_at DESC, f.id DESC
   LIMIT p_limit + 1;
END
$function$;

-- ── the platform team: resolutions (Q4, Q5) and the Platform Live wallet (Q6) ──

-- Money we had no record of (Q4), or a transaction under review: 'credited' to a business's active wallet (as
-- if it had arrived there: Dr 1100 / Cr 2290, and a receipt to classify); 'returned' (sent back outside AlphaKolect) or
-- 'dismissed', with a note. Outcomes: 'ok', 'forbidden', 'not_found', 'invalid', 'invalid_status', 'invalid_wallet'.
CREATE FUNCTION payments.resolve_unmatched(p_session_id uuid, p_transaction_id uuid, p_resolution text, p_wallet_id uuid, p_note text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, matched text, resolution text, merchant_id uuid, resolved_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
  v_tx payments.provider_transactions%ROWTYPE;
  v_wallet payments.live_wallets%ROWTYPE;
  v_ledger uuid;
  v_accounts uuid[];
  v_post record;
  v_entry uuid;
  v_receipt uuid := util.uuid_v7();
BEGIN
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_tx FROM payments.provider_transactions t WHERE t.id = p_transaction_id;
  IF p_resolution = 'credited' THEN
    SELECT * INTO v_wallet FROM payments.live_wallets w
     WHERE w.id = p_wallet_id AND w.owner_kind = 'merchant' AND w.status = 'active';
    SELECT l.id INTO v_ledger FROM ledger.ledgers l WHERE l.merchant_id = v_wallet.merchant_id;
    SELECT array_agg(a.id ORDER BY a.id) INTO v_accounts
      FROM ledger.accounts a WHERE a.ledger_id = v_ledger AND a.code IN ('1100', '2290') AND a.subject_type IS NULL;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], NULL);
  PERFORM ledger.lock_projections(NULL, v_accounts);
  PERFORM 1 FROM payments.provider_transactions t WHERE t.id = v_tx.id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'platform.payments.resolve') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_tx FROM payments.provider_transactions t WHERE t.id = v_tx.id;
  IF v_tx.id IS NULL THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_resolution IS NULL OR p_resolution NOT IN ('credited', 'returned', 'dismissed')
     OR char_length(coalesce(btrim(p_note), '')) NOT BETWEEN 1 AND 500 THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- Only a successful transaction that has no entry may be credited; one under review that has an entry is closed with
  -- a note (its credit stands, and a correction is a person's manual entry).
  IF v_tx.matched NOT IN ('unmatched', 'review')
     OR (p_resolution = 'credited' AND (v_tx.provider_status <> 'successful' OR v_tx.entry_id IS NOT NULL)) THEN
    RETURN QUERY SELECT 'invalid_status', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_resolution = 'credited' AND v_wallet.id IS NULL THEN
    RETURN QUERY SELECT 'invalid_wallet', NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_resolution = 'credited' THEN
    SELECT * INTO v_post
      FROM ledger.post_template_locked(v_ledger, 'wallet.received', v_tx.amount_minor, '{}'::jsonb,
                                       'payments.tx.' || v_tx.provider || '.' || v_tx.provider_tx_id, current_date,
                                       'Money received in the Live wallet (resolved)', 'provider_transaction',
                                       v_tx.id::text, v_actor_identity, NULL);
    IF v_post.outcome IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'payments: transaction % was not posted (%)', v_tx.id, v_post.outcome;
    END IF;
    v_entry := v_post.entry_id;
  END IF;
  UPDATE payments.provider_transactions t
     SET matched = 'resolved', resolution = p_resolution, resolution_note = btrim(p_note),
         resolved_by = v_actor_identity, resolved_at = now(),
         wallet_id = coalesce(v_wallet.id, t.wallet_id),
         entry_id = coalesce(v_entry, t.entry_id)
   WHERE t.id = v_tx.id;
  IF p_resolution = 'credited' THEN
    INSERT INTO payments.receipts (id, merchant_id, wallet_id, transaction_id, amount_minor, received_entry_id)
    VALUES (v_receipt, v_wallet.merchant_id, v_wallet.id, v_tx.id, v_tx.amount_minor, v_entry);
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (NULL, v_actor_identity, 'platform', v_actor, 'payments.unmatched_resolved', 'provider_transaction',
          v_tx.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id,
          jsonb_build_object('resolution', p_resolution, 'merchantId', v_wallet.merchant_id::text));
  RETURN QUERY SELECT 'ok', t.id, t.matched, t.resolution,
                      (SELECT w.merchant_id FROM payments.live_wallets w WHERE w.id = t.wallet_id), t.resolved_at
                 FROM payments.provider_transactions t WHERE t.id = v_tx.id;
END
$function$;

-- A reconciliation difference understood (Q5), with a note. Outcomes: 'ok', 'forbidden', 'not_found', 'invalid',
-- 'invalid_status'.
CREATE FUNCTION payments.resolve_finding(p_session_id uuid, p_finding_id uuid, p_note text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, status text, resolution_note text, resolved_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
  v_finding payments.reconciliation_findings%ROWTYPE;
BEGIN
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], NULL);
  SELECT * INTO v_finding FROM payments.reconciliation_findings f WHERE f.id = p_finding_id FOR NO KEY UPDATE;
  IF tenancy.assert_authority(p_session_id, 'platform.payments.resolve') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_finding.id IS NULL THEN
    RETURN QUERY SELECT 'not_found', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF char_length(coalesce(btrim(p_note), '')) NOT BETWEEN 1 AND 500 THEN
    RETURN QUERY SELECT 'invalid', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_finding.status <> 'open' THEN
    RETURN QUERY SELECT 'invalid_status', NULL::uuid, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  UPDATE payments.reconciliation_findings f
     SET status = 'resolved', resolution_note = btrim(p_note), resolved_by = v_actor_identity, resolved_at = now()
   WHERE f.id = v_finding.id;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (NULL, v_actor_identity, 'platform', v_actor, 'payments.finding_resolved', 'reconciliation_finding',
          v_finding.id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id, '{}');
  RETURN QUERY SELECT 'ok', f.id, f.status, f.resolution_note, f.resolved_at
                 FROM payments.reconciliation_findings f WHERE f.id = v_finding.id;
END
$function$;

-- AlphaKolect's Platform Live wallet (Q6, BR-4.3), requested once by the super admin; the worker creates it. Outcomes:
-- 'ok', 'forbidden', 'exists'.
CREATE FUNCTION payments.request_platform_wallet(p_session_id uuid, p_provider text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, id uuid, status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_actor_identity uuid;
  v_id uuid;
BEGIN
  SELECT v.identity_id, v.membership_id INTO v_actor_identity, v_actor
    FROM identity.validate_session(p_session_id) v WHERE v.audience = 'platform';
  IF v_actor IS NULL THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM identity.lock_platform_memberships(ARRAY[v_actor], NULL);
  IF tenancy.assert_authority(p_session_id, 'platform.wallet.create') <> 'ok' THEN
    RETURN QUERY SELECT 'forbidden', NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  -- The contested insert last (L3): one Platform Live wallet.
  INSERT INTO payments.live_wallets (owner_kind, provider, alias, requested_by)
  VALUES ('platform', p_provider, 'AKP-PLATFORM', v_actor_identity)
  ON CONFLICT DO NOTHING
  RETURNING payments.live_wallets.id INTO v_id;
  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'exists', w.id, w.status, w.created_at
                   FROM payments.live_wallets w WHERE w.owner_kind = 'platform';
    RETURN;
  END IF;
  INSERT INTO audit.audit_events
    (merchant_id, actor_identity_id, actor_audience, actor_membership_id, action, target_type, target_id, outcome,
     ip, user_agent, request_id, summary)
  VALUES (NULL, v_actor_identity, 'platform', v_actor, 'payments.platform_wallet_requested', 'live_wallet',
          v_id::text, 'success', p_ip, left(p_user_agent, 512), p_request_id, '{}');
  RETURN QUERY SELECT 'ok', w.id, w.status, w.created_at FROM payments.live_wallets w WHERE w.id = v_id;
END
$function$;

REVOKE ALL ON FUNCTION payments.request_wallets(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.claim_wallets(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.record_wallet_created(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.record_wallet_failed(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.store_event(text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.claim_events(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.record_event(uuid, boolean, text, text, bigint, text, text, timestamp with time zone, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.template_accounts(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.create_order(uuid, uuid, jsonb, bigint, text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.claim_orders(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.record_order(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.reconcile_wallets() FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.record_finding(text, uuid, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.merchant_wallet(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.list_receipts(uuid, boolean, integer, timestamp with time zone, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.classify_receipt(uuid, uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.platform_list_wallets(uuid, integer, timestamp with time zone, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.platform_list_unmatched(uuid, integer, timestamp with time zone, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.platform_list_findings(uuid, integer, boolean, timestamp with time zone, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.resolve_unmatched(uuid, uuid, text, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.resolve_finding(uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.request_platform_wallet(uuid, text, text, text, text) FROM PUBLIC;
-- The worker's functions (TA-11: it connects as the app), the webhook's store, and the session commands and reads.
-- payments.create_order and payments.template_accounts are called by definer functions and tests only (Q2).
GRANT EXECUTE ON FUNCTION payments.request_wallets(text, boolean) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.claim_wallets(integer, integer) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.record_wallet_created(uuid, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.record_wallet_failed(uuid, text, integer) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.store_event(text, jsonb, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.claim_events(integer, integer) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.record_event(uuid, boolean, text, text, bigint, text, text, timestamp with time zone, integer) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.claim_orders(integer, integer) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.record_order(uuid, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.reconcile_wallets() TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.record_finding(text, uuid, bigint, bigint) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.merchant_wallet(uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.list_receipts(uuid, boolean, integer, timestamp with time zone, uuid) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.classify_receipt(uuid, uuid, uuid, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.platform_list_wallets(uuid, integer, timestamp with time zone, uuid, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.platform_list_unmatched(uuid, integer, timestamp with time zone, uuid, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.platform_list_findings(uuid, integer, boolean, timestamp with time zone, uuid, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.resolve_unmatched(uuid, uuid, text, uuid, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.resolve_finding(uuid, uuid, text, text, text, text) TO alphakolect_app;
GRANT EXECUTE ON FUNCTION payments.request_platform_wallet(uuid, text, text, text, text) TO alphakolect_app;
