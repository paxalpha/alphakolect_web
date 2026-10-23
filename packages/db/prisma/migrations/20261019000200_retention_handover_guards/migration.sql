BEGIN;

-- A replacement medium is allowed only after every earlier attempt's fate is recorded.
CREATE OR REPLACE FUNCTION audit.begin_report_handover(p_report_id uuid, p_medium text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF coalesce(btrim(p_medium), '') = '' OR char_length(p_medium) > 500 THEN
    RAISE EXCEPTION 'invalid_medium' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  PERFORM 1 FROM audit.purge_reports p
    WHERE p.id = p_report_id AND p.delivered_at IS NULL AND p.withdrawn_at IS NULL AND p.lost_at IS NULL
      FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_not_active' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM audit.purge_report_handovers h
              WHERE h.report_id = p_report_id AND (h.outcome IS NULL OR h.outcome = 'recorded')) THEN
    RAISE EXCEPTION 'handover_attempt_live' USING ERRCODE = 'object_not_in_prerequisite_state',
      DETAIL = 'end the live attempt first (record_handover_abandoned)';
  END IF;
  IF EXISTS (SELECT 1 FROM audit.purge_report_handovers h
              WHERE h.report_id = p_report_id AND h.fate_attested_at IS NULL) THEN
    RAISE EXCEPTION 'handover_fate_unaccounted' USING ERRCODE = 'object_not_in_prerequisite_state',
      DETAIL = 'attest the fate of every earlier medium before beginning another attempt';
  END IF;
  INSERT INTO audit.purge_report_handovers (report_id, started_at, medium)
  VALUES (p_report_id, clock_timestamp(), p_medium) RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;
REVOKE ALL ON FUNCTION audit.begin_report_handover(uuid, text) FROM PUBLIC;

-- A receipt cannot release the report's rows while any other medium could still contain a copy.
CREATE OR REPLACE FUNCTION audit.record_report_delivery(
  p_report_id uuid, p_attempt_id uuid, p_receipt_reference text, p_note text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_r audit.purge_reports%ROWTYPE;
BEGIN
  IF coalesce(btrim(p_receipt_reference), '') = '' OR char_length(p_receipt_reference) > 500 THEN
    RAISE EXCEPTION 'receipt_reference_required' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  SELECT * INTO v_r FROM audit.purge_reports p WHERE p.id = p_report_id FOR NO KEY UPDATE;
  IF NOT FOUND OR v_r.delivered_at IS NOT NULL OR v_r.withdrawn_at IS NOT NULL OR v_r.lost_at IS NOT NULL THEN
    RAISE EXCEPTION 'report_not_active' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit.purge_report_handovers h
                  WHERE h.id = p_attempt_id AND h.report_id = p_report_id AND h.outcome = 'recorded') THEN
    RAISE EXCEPTION 'attempt_not_recorded' USING ERRCODE = 'object_not_in_prerequisite_state',
      DETAIL = 'the delivery names the report''s live recorded attempt, the one the receipt quotes';
  END IF;
  IF EXISTS (SELECT 1 FROM audit.purge_report_handovers h WHERE h.report_id = p_report_id AND h.outcome IS NULL) THEN
    RAISE EXCEPTION 'handover_attempt_live' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM audit.purge_report_handovers h
              WHERE h.report_id = p_report_id AND h.id <> p_attempt_id AND h.fate_attested_at IS NULL) THEN
    RAISE EXCEPTION 'handover_fate_unaccounted' USING ERRCODE = 'object_not_in_prerequisite_state',
      DETAIL = 'attest the fate of every other medium before recording delivery';
  END IF;
  UPDATE audit.purge_reports p
     SET delivered_at = clock_timestamp(), delivered_handover_id = p_attempt_id,
         receipt_reference = btrim(p_receipt_reference), delivery_note = left(btrim(p_note), 500)
   WHERE p.id = p_report_id;
  UPDATE audit.purge_report_requests q SET state = 'satisfied', closed_at = clock_timestamp()
   WHERE q.id = v_r.request_id AND q.state = 'open';
  DELETE FROM audit.purge_run_events e WHERE e.run_id = v_r.run_id;
  DELETE FROM audit.purge_run_pages g WHERE g.run_id = v_r.run_id;
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.purge_report_delivered', 'purge_report', p_report_id::text, 'success',
          jsonb_build_object('reportId', p_report_id::text, 'attemptId', p_attempt_id::text));
END
$function$;
REVOKE ALL ON FUNCTION audit.record_report_delivery(uuid, uuid, text, text) FROM PUBLIC;

-- Keep deletion stopped until the delivered/withdrawn operator copy has a terminal destruction record.
CREATE FUNCTION audit.guard_pending_report_copy_destruction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
BEGIN
  IF NEW.run_id IS NOT NULL AND OLD.run_id IS DISTINCT FROM NEW.run_id
     AND EXISTS (SELECT 1 FROM audit.purge_reports p
                  WHERE (p.delivered_at IS NOT NULL OR p.withdrawn_at IS NOT NULL)
                    AND p.copy_destroyed_at IS NULL) THEN
    RAISE EXCEPTION 'report_copy_destruction_pending' USING ERRCODE = 'object_not_in_prerequisite_state',
      DETAIL = 'resolve every delivered or withdrawn report copy before starting another purge run';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION audit.guard_pending_report_copy_destruction() FROM PUBLIC;
CREATE TRIGGER purge_reservation_copy_destruction_guard
  BEFORE UPDATE OF run_id ON audit.purge_reservation
  FOR EACH ROW EXECUTE FUNCTION audit.guard_pending_report_copy_destruction();

COMMIT;