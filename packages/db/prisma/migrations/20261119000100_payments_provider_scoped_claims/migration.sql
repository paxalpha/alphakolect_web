-- P9 revision 8 (the provider is now Paystack; docs/architecture/P9_IMPLEMENTATION_PLAN.md §16):
--
-- A worker claims only the rows of the provider it is configured for. The three claims took any due row, whatever its
-- provider, so a worker with the Paystack adapter could have claimed a wallet, an event or an order that belongs to
-- another provider (a deployment whose provider was changed, or two environments sharing a database) and sent it to the
-- wrong one: an event confirmed against the wrong API ends rejected, an order is sent to the wrong provider. An order's
-- provider is its source wallet's. The claim functions take the provider as a third argument; everything else about them
-- (the lease, the token, the order of rows, what they return) is as it was.
-- Forward-only; earlier migrations untouched.

DROP FUNCTION payments.claim_wallets(integer, integer);
DROP FUNCTION payments.claim_events(integer, integer);
DROP FUNCTION payments.claim_orders(integer, integer);

CREATE FUNCTION payments.claim_wallets(p_limit integer, p_lease_seconds integer, p_provider text)
 RETURNS TABLE(id uuid, lease_token uuid, owner_kind text, merchant_id uuid, customer_id uuid, provider text, alias text, display_name text, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT w.id FROM payments.live_wallets w
     WHERE w.status = 'provisioning' AND w.next_attempt_at <= now() AND w.provider = p_provider
       AND (w.lease_until IS NULL OR w.lease_until < now())
     ORDER BY w.next_attempt_at, w.id
     LIMIT p_limit
       FOR NO KEY UPDATE SKIP LOCKED)
  UPDATE payments.live_wallets w
     SET lease_until = now() + make_interval(secs => p_lease_seconds), lease_token = util.uuid_v7(),
         attempts = w.attempts + 1
    FROM due
   WHERE w.id = due.id
  RETURNING w.id, w.lease_token, w.owner_kind, w.merchant_id, w.customer_id, w.provider, w.alias,
            coalesce((SELECT c.full_name FROM customers.customers c WHERE c.id = w.customer_id),
                     (SELECT m.name FROM tenancy.merchants m WHERE m.id = w.merchant_id), 'AlphaKolect'),
            w.attempts;
END
$function$;

CREATE FUNCTION payments.claim_events(p_limit integer, p_lease_seconds integer, p_provider text)
 RETURNS TABLE(id uuid, lease_token uuid, provider text, reference text, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT e.id FROM payments.provider_events e
     WHERE e.status IN ('received', 'pending') AND e.next_check_at <= now() AND e.provider = p_provider
       AND (e.lease_until IS NULL OR e.lease_until < now())
     ORDER BY e.next_check_at, e.id
     LIMIT p_limit
       FOR NO KEY UPDATE SKIP LOCKED)
  UPDATE payments.provider_events e
     SET lease_until = now() + make_interval(secs => p_lease_seconds), lease_token = util.uuid_v7(),
         attempts = e.attempts + 1
    FROM due
   WHERE e.id = due.id
  RETURNING e.id, e.lease_token, e.provider, e.reference, e.attempts;
END
$function$;

CREATE FUNCTION payments.claim_orders(p_limit integer, p_lease_seconds integer, p_provider text)
 RETURNS TABLE(id uuid, lease_token uuid, prior_state text, reference text, amount_minor bigint, from_provider_ref text, to_provider_ref text, to_bank jsonb, attempts integer)
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
       AND EXISTS (SELECT 1 FROM payments.live_wallets w WHERE w.id = o.from_wallet_id AND w.provider = p_provider)
     ORDER BY o.next_check_at, o.id
     LIMIT p_limit
       FOR NO KEY UPDATE SKIP LOCKED)
  UPDATE payments.payment_orders o
     SET state = CASE WHEN due.prior_state = 'created' THEN 'unknown' ELSE o.state END,
         lease_until = now() + make_interval(secs => p_lease_seconds), lease_token = util.uuid_v7(),
         attempts = o.attempts + 1
    FROM due
   WHERE o.id = due.id
  RETURNING o.id, o.lease_token, due.prior_state, o.reference, o.amount_minor,
            (SELECT w.provider_ref FROM payments.live_wallets w WHERE w.id = o.from_wallet_id),
            (SELECT w.provider_ref FROM payments.live_wallets w WHERE w.id = o.to_wallet_id),
            o.to_bank, o.attempts;
END
$function$;

REVOKE ALL ON FUNCTION payments.claim_wallets(integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.claim_events(integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.claim_orders(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payments.claim_wallets(integer, integer, text) TO alphakolect_worker;
GRANT EXECUTE ON FUNCTION payments.claim_events(integer, integer, text) TO alphakolect_worker;
GRANT EXECUTE ON FUNCTION payments.claim_orders(integer, integer, text) TO alphakolect_worker;
