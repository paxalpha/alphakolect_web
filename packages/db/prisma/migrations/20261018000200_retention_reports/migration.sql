-- P5.8 step (a), part 2: the owner's copy — requests, exports, reports and their handover (P5 plan §8.6 items 6-10,
-- Part 2, approved 2026-10-18; ADR-16 "Addendum — Part 2"). Builds on 20261018000100_retention_core.
--
-- A request awaiting its copy makes the next run an export run (it deletes nothing). The export is recorded before its
-- file exists, then confirmed against the database's own manifest; from then the report is active and its rows held.
-- The copy reaches the owner on a stick written and then verified in his presence (attempts in
-- audit.purge_report_handovers); his written receipt makes the delivery, which satisfies the request (one copy per
-- request, O21 S2) and releases the rows to the normal purge (O20). The operator's copy is then destroyed (O11). A copy
-- lost before delivery is made again; a request may be cancelled in writing (O21 S3).
--
-- Every function is SECURITY DEFINER, owned by the migrator, with search_path and TimeZone pinned, no grant; each takes
-- the reservation row FOR NO KEY UPDATE NOWAIT first (category 0), so it serializes with runs, and raises on refusal
-- with a machine code as the message. Forward-only.

-- ── requests ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION audit.request_purge_report(p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_res  audit.purge_reservation%ROWTYPE;
  v_open uuid;
  v_id   uuid;
  v_note text := btrim(p_note);
BEGIN
  IF v_note IS NULL OR char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = 'check_violation', DETAIL = 'a note of 1-500 characters is required';
  END IF;
  SELECT * INTO v_res FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  IF v_res.run_id IS NOT NULL AND v_res.renewed_at >= clock_timestamp() - audit.purge_lease() THEN
    RAISE EXCEPTION 'purge_run_active' USING ERRCODE = 'object_in_use';
  END IF;
  SELECT q.id INTO v_open FROM audit.purge_report_requests q WHERE q.state = 'open';
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'report_request_open' USING ERRCODE = 'unique_violation', DETAIL = v_open::text;
  END IF;
  INSERT INTO audit.purge_report_requests (note) VALUES (v_note) RETURNING id INTO v_id;
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.purge_report_requested', 'purge_report_request', v_id::text, 'success',
          jsonb_build_object('requestId', v_id::text));
  RETURN v_id;
END
$function$;
REVOKE ALL ON FUNCTION audit.request_purge_report(text) FROM PUBLIC;

CREATE FUNCTION audit.cancel_purge_report_request(p_request_id uuid, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_res    audit.purge_reservation%ROWTYPE;
  v_req    audit.purge_report_requests%ROWTYPE;
  v_report audit.purge_reports%ROWTYPE;
  v_note   text := btrim(p_note);
BEGIN
  IF v_note IS NULL OR char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_res FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  IF v_res.run_id IS NOT NULL AND v_res.renewed_at >= clock_timestamp() - audit.purge_lease() THEN
    RAISE EXCEPTION 'purge_run_active' USING ERRCODE = 'object_in_use';
  END IF;
  SELECT * INTO v_req FROM audit.purge_report_requests q WHERE q.id = p_request_id;
  IF NOT FOUND OR v_req.state <> 'open' THEN
    RAISE EXCEPTION 'request_not_open' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT * INTO v_report FROM audit.purge_reports p
   WHERE p.request_id = p_request_id AND p.delivered_at IS NULL AND p.withdrawn_at IS NULL AND p.lost_at IS NULL;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM audit.purge_report_handovers h
                WHERE h.report_id = v_report.id AND (h.outcome IS NULL OR h.outcome = 'recorded')) THEN
      RAISE EXCEPTION 'handover_attempt_live' USING ERRCODE = 'object_not_in_prerequisite_state',
        DETAIL = 'end the live handover attempt first (record_handover_abandoned)';
    END IF;
    UPDATE audit.purge_reports p SET withdrawn_at = clock_timestamp() WHERE p.id = v_report.id;
    DELETE FROM audit.purge_run_events e WHERE e.run_id = v_report.run_id;
    DELETE FROM audit.purge_run_pages g WHERE g.run_id = v_report.run_id;
  END IF;
  UPDATE audit.purge_report_requests q
     SET state = 'cancelled', closed_at = clock_timestamp(), close_note = v_note
   WHERE q.id = p_request_id;
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.purge_report_request_cancelled', 'purge_report_request', p_request_id::text, 'success',
          jsonb_build_object('requestId', p_request_id::text, 'withdrawnReportId', v_report.id::text));
  RETURN v_report.id;
END
$function$;
REVOKE ALL ON FUNCTION audit.cancel_purge_report_request(uuid, text) FROM PUBLIC;

-- ── exports ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION audit.begin_purge_export(p_run_id uuid, p_as_of timestamptz, p_directory text, p_writer_host_id text,
                                         p_writer_lock_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_res audit.purge_reservation%ROWTYPE;
BEGIN
  IF coalesce(btrim(p_directory), '') = '' OR coalesce(btrim(p_writer_host_id), '') = ''
     OR coalesce(btrim(p_writer_lock_key), '') = '' THEN
    RAISE EXCEPTION 'invalid_export' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_res FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  IF v_res.run_id IS DISTINCT FROM p_run_id OR v_res.p_as_of IS DISTINCT FROM p_as_of
     OR v_res.renewed_at < clock_timestamp() - audit.purge_lease() THEN
    RAISE EXCEPTION 'run_not_live' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit.purge_runs pr WHERE pr.run_id = p_run_id AND pr.kind = 'export') THEN
    RAISE EXCEPTION 'not_an_export_run' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  INSERT INTO audit.purge_exports (run_id, directory, writer_host_id, writer_lock_key, started_at)
  VALUES (p_run_id, p_directory, p_writer_host_id, p_writer_lock_key, clock_timestamp());
  UPDATE audit.purge_reservation r SET renewed_at = clock_timestamp() WHERE r.id;
END
$function$;
REVOKE ALL ON FUNCTION audit.begin_purge_export(uuid, timestamptz, text, text, text) FROM PUBLIC;

CREATE FUNCTION audit.record_export_artifact(p_run_id uuid, p_as_of timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_res audit.purge_reservation%ROWTYPE;
BEGIN
  SELECT * INTO v_res FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  IF v_res.run_id IS DISTINCT FROM p_run_id OR v_res.p_as_of IS DISTINCT FROM p_as_of
     OR v_res.renewed_at < clock_timestamp() - audit.purge_lease() THEN
    RAISE EXCEPTION 'run_not_live' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE audit.purge_exports e SET artifact_recorded_at = clock_timestamp()
   WHERE e.run_id = p_run_id AND e.outcome IS NULL AND e.artifact_recorded_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'export_not_open' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE audit.purge_reservation r SET renewed_at = clock_timestamp() WHERE r.id;
END
$function$;
REVOKE ALL ON FUNCTION audit.record_export_artifact(uuid, timestamptz) FROM PUBLIC;

-- p_mode: automatic (the command removed its own files) | attested (the operator's note) | lost (machine or volume
-- gone: accepted without the run's reservation; an incident).
CREATE FUNCTION audit.discard_purge_export(p_run_id uuid, p_note text, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_res  audit.purge_reservation%ROWTYPE;
  v_live boolean;
  v_note text := btrim(p_note);
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('automatic', 'attested', 'lost') THEN
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = 'check_violation';
  END IF;
  IF v_note IS NULL OR char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_res FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  v_live := v_res.run_id IS NOT NULL AND v_res.renewed_at >= clock_timestamp() - audit.purge_lease();
  -- The run's own live export, or an export whose run is not live; never under another live run.
  IF v_live AND v_res.run_id IS DISTINCT FROM p_run_id THEN
    RAISE EXCEPTION 'purge_run_active' USING ERRCODE = 'object_in_use';
  END IF;
  IF p_mode = 'lost' AND v_live THEN
    RAISE EXCEPTION 'run_live' USING ERRCODE = 'object_not_in_prerequisite_state',
      DETAIL = 'a lost export is recorded only when its run holds no live reservation';
  END IF;
  UPDATE audit.purge_exports e
     SET outcome = 'discarded', ended_at = clock_timestamp(), note = v_note, lost = (p_mode = 'lost')
   WHERE e.run_id = p_run_id AND e.outcome IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'export_not_open' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  DELETE FROM audit.purge_run_events e WHERE e.run_id = p_run_id;
  DELETE FROM audit.purge_run_pages g WHERE g.run_id = p_run_id;
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.purge_export_discarded', 'purge_run', p_run_id::text, 'success',
          jsonb_build_object('runId', p_run_id::text, 'mode', p_mode));
  IF v_live THEN
    UPDATE audit.purge_reservation r SET renewed_at = clock_timestamp() WHERE r.id;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION audit.discard_purge_export(uuid, text, text) FROM PUBLIC;

CREATE FUNCTION audit.confirm_purge_report(p_run_id uuid, p_as_of timestamptz, p_row_count integer, p_page_count integer,
                                           p_manifest_digest text, p_file_sha256 text, p_file_location text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_res      audit.purge_reservation%ROWTYPE;
  v_export   audit.purge_exports%ROWTYPE;
  v_request  uuid;
  v_rows     integer;
  v_pages    integer;
  v_manifest text;
  v_name     text := 'alphakolect-purge-report-' || p_run_id::text || '.jsonl';
  v_dir      text;
  v_id       uuid;
BEGIN
  SELECT * INTO v_res FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  IF v_res.run_id IS DISTINCT FROM p_run_id OR v_res.p_as_of IS DISTINCT FROM p_as_of
     OR v_res.renewed_at < clock_timestamp() - audit.purge_lease() THEN
    RAISE EXCEPTION 'run_not_live' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT * INTO v_export FROM audit.purge_exports e WHERE e.run_id = p_run_id;
  IF NOT FOUND OR v_export.outcome IS NOT NULL OR v_export.artifact_recorded_at IS NULL THEN
    RAISE EXCEPTION 'export_not_open' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit.purge_runs pr WHERE pr.run_id = p_run_id AND pr.exhausted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'manifest_not_exhausted' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT coalesce(sum(g.row_count), 0)::integer, count(*)::integer,
         encode(sha256(convert_to(string_agg(g.digest || E'\n', '' ORDER BY g.page_no), 'UTF8')), 'hex')
    INTO v_rows, v_pages, v_manifest
    FROM audit.purge_run_pages g WHERE g.run_id = p_run_id;
  IF v_pages = 0 THEN
    RAISE EXCEPTION 'export_empty' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_row_count IS DISTINCT FROM v_rows OR p_page_count IS DISTINCT FROM v_pages
     OR p_manifest_digest IS DISTINCT FROM v_manifest THEN
    RAISE EXCEPTION 'file_does_not_match_manifest' USING ERRCODE = 'check_violation';
  END IF;
  IF p_file_sha256 IS NULL OR p_file_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_sha256' USING ERRCODE = 'check_violation';
  END IF;
  v_dir := rtrim(v_export.directory, '/\');
  IF p_file_location IS DISTINCT FROM v_dir || '/' || v_name AND p_file_location IS DISTINCT FROM v_dir || '\' || v_name THEN
    RAISE EXCEPTION 'location_mismatch' USING ERRCODE = 'check_violation';
  END IF;
  SELECT q.id INTO v_request FROM audit.purge_report_requests q
   WHERE q.state = 'open'
     AND NOT EXISTS (SELECT 1 FROM audit.purge_reports p WHERE p.request_id = q.id AND p.delivered_at IS NULL
                       AND p.withdrawn_at IS NULL AND p.lost_at IS NULL);
  IF v_request IS NULL THEN
    RAISE EXCEPTION 'no_request_awaiting_copy' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  -- Update every category-0 row before the contested active-report insert (L3); a later insert failure rolls this back.
  UPDATE audit.purge_exports e SET outcome = 'confirmed', ended_at = clock_timestamp()
   WHERE e.run_id = p_run_id AND e.outcome IS NULL AND e.artifact_recorded_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'export_not_open' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  INSERT INTO audit.purge_reports (request_id, run_id, p_as_of, confirmed_at, row_count, page_count, manifest_digest,
                                   file_sha256, file_location)
  VALUES (v_request, p_run_id, p_as_of, clock_timestamp(), v_rows, v_pages, v_manifest, p_file_sha256, p_file_location)
  RETURNING id INTO v_id;
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.purge_report_confirmed', 'purge_report', v_id::text, 'success',
          jsonb_build_object('reportId', v_id::text, 'runId', p_run_id::text, 'rowCount', v_rows,
                             'fileSha256', p_file_sha256));
  UPDATE audit.purge_reservation r SET renewed_at = clock_timestamp() WHERE r.id;
  RETURN v_id;
END
$function$;
REVOKE ALL ON FUNCTION audit.confirm_purge_report(uuid, timestamptz, integer, integer, text, text, text) FROM PUBLIC;

-- ── the handover (§8.6 item 9) ──────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION audit.begin_report_handover(p_report_id uuid, p_medium text)
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
  INSERT INTO audit.purge_report_handovers (report_id, started_at, medium)
  VALUES (p_report_id, clock_timestamp(), p_medium) RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;
REVOKE ALL ON FUNCTION audit.begin_report_handover(uuid, text) FROM PUBLIC;

CREATE FUNCTION audit.record_handover_written(p_attempt_id uuid, p_diskseq text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
BEGIN
  PERFORM 1 FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  UPDATE audit.purge_report_handovers h SET written_at = clock_timestamp(), write_diskseq = p_diskseq
   WHERE h.id = p_attempt_id AND h.outcome IS NULL AND h.written_at IS NULL
     AND EXISTS (SELECT 1 FROM audit.purge_reports p WHERE p.id = h.report_id AND p.delivered_at IS NULL
                   AND p.withdrawn_at IS NULL AND p.lost_at IS NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempt_not_open' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION audit.record_handover_written(uuid, text) FROM PUBLIC;

CREATE FUNCTION audit.record_report_handover(p_attempt_id uuid, p_medium_sha256 text, p_eject_attested boolean,
                                             p_diskseq text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_h audit.purge_report_handovers%ROWTYPE;
  v_r audit.purge_reports%ROWTYPE;
BEGIN
  PERFORM 1 FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  SELECT * INTO v_h FROM audit.purge_report_handovers h WHERE h.id = p_attempt_id FOR NO KEY UPDATE;
  IF NOT FOUND OR v_h.outcome IS NOT NULL OR v_h.written_at IS NULL THEN
    RAISE EXCEPTION 'attempt_not_open' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT * INTO v_r FROM audit.purge_reports p WHERE p.id = v_h.report_id;
  IF v_r.delivered_at IS NOT NULL OR v_r.withdrawn_at IS NOT NULL OR v_r.lost_at IS NOT NULL THEN
    RAISE EXCEPTION 'report_not_active' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_eject_attested IS NOT TRUE THEN
    RAISE EXCEPTION 'eject_not_attested' USING ERRCODE = 'check_violation';
  END IF;
  -- Where the write recorded a disk sequence, the verification's must be there and differ: a null never passes.
  IF v_h.write_diskseq IS NOT NULL AND (p_diskseq IS NULL OR p_diskseq = v_h.write_diskseq) THEN
    RAISE EXCEPTION 'diskseq_unchanged' USING ERRCODE = 'check_violation',
      DETAIL = 'unplug the stick and insert it again before the verification';
  END IF;
  IF p_medium_sha256 IS DISTINCT FROM v_r.file_sha256 THEN
    RAISE EXCEPTION 'medium_hash_mismatch' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE audit.purge_report_handovers h
     SET outcome = 'recorded', ended_at = clock_timestamp(), medium_sha256 = p_medium_sha256,
         eject_attested = true, verify_diskseq = p_diskseq
   WHERE h.id = p_attempt_id;
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.purge_report_handed_over', 'purge_report', v_r.id::text, 'success',
          jsonb_build_object('reportId', v_r.id::text, 'attemptId', p_attempt_id::text,
                             'diskseqChecked', v_h.write_diskseq IS NOT NULL));
END
$function$;
REVOKE ALL ON FUNCTION audit.record_report_handover(uuid, text, boolean, text) FROM PUBLIC;

-- The command's own record of a failed verification: the attempt abandoned, its stick's fate not yet attested.
CREATE FUNCTION audit.record_handover_failed(p_attempt_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_h audit.purge_report_handovers%ROWTYPE;
BEGIN
  PERFORM 1 FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  SELECT * INTO v_h FROM audit.purge_report_handovers h WHERE h.id = p_attempt_id FOR NO KEY UPDATE;
  IF NOT FOUND OR v_h.outcome IS NOT NULL OR v_h.written_at IS NULL THEN
    RAISE EXCEPTION 'attempt_not_open' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE audit.purge_report_handovers h
     SET outcome = 'abandoned', ended_at = clock_timestamp(), note = left(coalesce(btrim(p_reason), 'failed'), 500)
   WHERE h.id = p_attempt_id;
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.purge_report_handover_failed', 'purge_report', v_h.report_id::text, 'success',
          jsonb_build_object('reportId', v_h.report_id::text, 'attemptId', p_attempt_id::text));
END
$function$;
REVOKE ALL ON FUNCTION audit.record_handover_failed(uuid, text) FROM PUBLIC;

-- The operator's attestation of a stick's fate: ends an unended attempt (abandoned) or supersedes a recorded one, or
-- attests the fate of one record_handover_failed abandoned. Never the delivered attempt.
CREATE FUNCTION audit.record_handover_abandoned(p_attempt_id uuid, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_h       audit.purge_report_handovers%ROWTYPE;
  v_note    text := btrim(p_note);
  v_outcome text;
BEGIN
  IF v_note IS NULL OR char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  SELECT * INTO v_h FROM audit.purge_report_handovers h WHERE h.id = p_attempt_id FOR NO KEY UPDATE;
  IF NOT FOUND OR v_h.fate_attested_at IS NOT NULL THEN
    RAISE EXCEPTION 'attempt_fate_attested' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM audit.purge_reports p WHERE p.delivered_handover_id = p_attempt_id) THEN
    RAISE EXCEPTION 'attempt_delivered' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  v_outcome := CASE v_h.outcome WHEN 'recorded' THEN 'superseded' ELSE 'abandoned' END;
  UPDATE audit.purge_report_handovers h
     SET outcome = v_outcome,
         ended_at = coalesce(h.ended_at, clock_timestamp()),
         fate_attested_at = clock_timestamp(), fate_note = v_note
   WHERE h.id = p_attempt_id;
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.purge_report_handover_abandoned', 'purge_report', v_h.report_id::text, 'success',
          jsonb_build_object('reportId', v_h.report_id::text, 'attemptId', p_attempt_id::text, 'outcome', v_outcome));
  RETURN v_outcome;
END
$function$;
REVOKE ALL ON FUNCTION audit.record_handover_abandoned(uuid, text) FROM PUBLIC;

-- ── delivery, destruction, loss ─────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION audit.record_report_delivery(p_report_id uuid, p_attempt_id uuid, p_receipt_reference text, p_note text)
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
  UPDATE audit.purge_reports p
     SET delivered_at = clock_timestamp(), delivered_handover_id = p_attempt_id,
         receipt_reference = btrim(p_receipt_reference), delivery_note = left(btrim(p_note), 500)
   WHERE p.id = p_report_id;
  -- One copy per request (O21 S2): the delivery satisfies it; the rows are no longer held (O20).
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

CREATE FUNCTION audit.record_report_copy_destroyed(p_report_id uuid, p_mode text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_r    audit.purge_reports%ROWTYPE;
  v_note text := btrim(p_note);
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('automatic', 'attested', 'lost') THEN
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = 'check_violation';
  END IF;
  IF v_note IS NULL OR char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  SELECT * INTO v_r FROM audit.purge_reports p WHERE p.id = p_report_id FOR NO KEY UPDATE;
  IF NOT FOUND OR (v_r.delivered_at IS NULL AND v_r.withdrawn_at IS NULL) OR v_r.copy_destroyed_at IS NOT NULL THEN
    RAISE EXCEPTION 'copy_not_destroyable' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  -- Every stick but the delivered one accounted for: an unaccounted stick is another copy.
  IF EXISTS (SELECT 1 FROM audit.purge_report_handovers h
              WHERE h.report_id = p_report_id AND h.id IS DISTINCT FROM v_r.delivered_handover_id
                AND h.fate_attested_at IS NULL) THEN
    RAISE EXCEPTION 'stick_unaccounted' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE audit.purge_reports p
     SET copy_destroyed_at = clock_timestamp(), destroy_mode = p_mode, destroy_note = v_note,
         lost_host = p.lost_host OR p_mode = 'lost'
   WHERE p.id = p_report_id;
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.purge_report_copy_destroyed', 'purge_report', p_report_id::text, 'success',
          jsonb_build_object('reportId', p_report_id::text, 'mode', p_mode));
END
$function$;
REVOKE ALL ON FUNCTION audit.record_report_copy_destroyed(uuid, text, text) FROM PUBLIC;

CREATE FUNCTION audit.record_report_lost(p_report_id uuid, p_mode text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_r    audit.purge_reports%ROWTYPE;
  v_note text := btrim(p_note);
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('automatic', 'attested', 'lost') THEN
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = 'check_violation';
  END IF;
  IF v_note IS NULL OR char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  SELECT * INTO v_r FROM audit.purge_reports p WHERE p.id = p_report_id FOR NO KEY UPDATE;
  IF NOT FOUND OR v_r.delivered_at IS NOT NULL OR v_r.withdrawn_at IS NOT NULL OR v_r.lost_at IS NOT NULL THEN
    RAISE EXCEPTION 'report_not_active' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM audit.purge_report_handovers h
              WHERE h.report_id = p_report_id AND (h.outcome IS NULL OR h.outcome = 'recorded' OR h.fate_attested_at IS NULL)) THEN
    RAISE EXCEPTION 'stick_unaccounted' USING ERRCODE = 'object_not_in_prerequisite_state',
      DETAIL = 'end every handover attempt and attest each stick''s fate first';
  END IF;
  UPDATE audit.purge_reports p
     SET lost_at = clock_timestamp(), loss_note = v_note, lost_host = p.lost_host OR p_mode = 'lost'
   WHERE p.id = p_report_id;
  DELETE FROM audit.purge_run_events e WHERE e.run_id = v_r.run_id;
  DELETE FROM audit.purge_run_pages g WHERE g.run_id = v_r.run_id;
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.purge_report_lost', 'purge_report', p_report_id::text, 'success',
          jsonb_build_object('reportId', p_report_id::text, 'mode', p_mode));
END
$function$;
REVOKE ALL ON FUNCTION audit.record_report_lost(uuid, text, text) FROM PUBLIC;
