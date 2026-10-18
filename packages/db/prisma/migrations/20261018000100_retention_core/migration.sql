-- P5.8 step (a), part 1: the retention core (P5 plan §8.6 "Retention design", Part 2, approved 2026-10-18 at revision
-- 90 by Claude under the project lead's delegation; ADR-16 "Addendum — Part 2").
--
-- The activity record's one controlled exception to append-only. Every entry is kept two years (calendar years,
-- audit.d9_retention()) and then deleted, by identity, page by page from a manifest the database records itself, with
-- a read position the database keeps. Rows a requested copy holds are never deleted until the owner's receipt (O20);
-- every other row on its normal day (O21 S1). This migration creates:
--   - the helpers audit.d9_retention(), audit.purge_lease(), audit.event_canonical_text();
--   - the purge's own tables (the reservation, runs, the manifest, requests, exports, reports, handover attempts);
--   - the table's own guard, audit.audit_events_guard(), replacing util.reject_modification() on audit.audit_events
--     only (the ledger keeps it unchanged), in this one transaction so the table is never unguarded;
--   - the (occurred_at, id) index the purge pages by (the audit reads of P5.8 use it too);
--   - catalog entries #38 and #40-#50;
--   - the run functions: reserve_purge_run, renew_purge_run, release_purge_run, purge_candidates,
--     purge_expired_events, and clear_expired_request_metadata (independent of runs).
-- The report functions (requests, exports, reports, handovers) follow in 20261018000200_retention_reports.
--
-- Every purge function is SECURITY DEFINER, owned by the migrator, with search_path and TimeZone pinned, and has no
-- grant: only the operator command, on the migrator connection, calls it (§9.1). Refusals raise (§8.2a rule 2's
-- exception) with a machine code as the message. Forward-only; earlier migrations untouched.

-- ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- "Two years" in the owner's words: calendar years (R41). STABLE: never folded into a constant when a statement is
-- planned, so a migration that redefines it moves every cutoff (R42).
CREATE FUNCTION audit.d9_retention() RETURNS interval
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT interval '2 years' $fn$;
REVOKE ALL ON FUNCTION audit.d9_retention() FROM PUBLIC;

-- A run's lease: a reservation not renewed within it is no longer live (R43).
CREATE FUNCTION audit.purge_lease() RETURNS interval
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT interval '15 minutes' $fn$;
REVOKE ALL ON FUNCTION audit.purge_lease() FROM PUBLIC;

-- An event's canonical text: the bytes of the owner's copy (§8.6 item 3). UTC whatever the caller's session.
CREATE FUNCTION audit.event_canonical_text(e audit.audit_events) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp SET "TimeZone" = 'UTC'
AS $fn$ SELECT to_jsonb(e)::text $fn$;
REVOKE ALL ON FUNCTION audit.event_canonical_text(audit.audit_events) FROM PUBLIC;

-- ── the purge's own tables (no grants: default-deny; no data of the businesses' people) ─────────────────────────
CREATE TABLE audit.purge_reservation (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  run_id      uuid,
  p_as_of     timestamptz(6),
  reserved_at timestamptz(6),
  renewed_at  timestamptz(6)
);
INSERT INTO audit.purge_reservation (id) VALUES (true);

CREATE TABLE audit.purge_runs (
  run_id                 uuid PRIMARY KEY,
  kind                   text NOT NULL CHECK (kind IN ('plain', 'export')),
  p_as_of                timestamptz(6) NOT NULL,
  reserved_at            timestamptz(6) NOT NULL,
  taken_over_run         uuid,
  scan_after_occurred_at timestamptz(6),
  scan_after_id          uuid,
  exhausted_at           timestamptz(6),
  rows_deleted           integer NOT NULL DEFAULT 0,
  released_at            timestamptz(6),
  completed              boolean
);

-- The manifest: exactly what purge_candidates handed out, page by page. No foreign key links these tables (a run's
-- pages and events are removed together), so L1 holds.
CREATE TABLE audit.purge_run_pages (
  run_id        uuid NOT NULL,
  page_no       integer NOT NULL CHECK (page_no > 0),
  row_count     integer NOT NULL CHECK (row_count > 0),
  digest        text NOT NULL,
  processed_at  timestamptz(6),
  deleted_count integer,
  PRIMARY KEY (run_id, page_no)
);
CREATE TABLE audit.purge_run_events (
  run_id   uuid NOT NULL,
  page_no  integer NOT NULL,
  ordinal  integer NOT NULL,
  event_id uuid NOT NULL,
  PRIMARY KEY (run_id, page_no, ordinal)
);
CREATE INDEX purge_run_events_event_id_idx ON audit.purge_run_events (event_id);

CREATE TABLE audit.purge_report_requests (
  id           uuid PRIMARY KEY DEFAULT util.uuid_v7(),
  requested_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note         text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  state        text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'satisfied', 'cancelled')),
  closed_at    timestamptz(6),
  close_note   text,
  CHECK ((state = 'open') = (closed_at IS NULL))
);
-- At most one open request (R47).
CREATE UNIQUE INDEX purge_report_requests_one_open ON audit.purge_report_requests ((true)) WHERE state = 'open';

CREATE TABLE audit.purge_exports (
  run_id               uuid PRIMARY KEY,
  directory            text NOT NULL,
  writer_host_id       text NOT NULL,
  writer_lock_key      text NOT NULL,
  started_at           timestamptz(6) NOT NULL,
  artifact_recorded_at timestamptz(6),
  outcome              text CHECK (outcome IN ('confirmed', 'discarded')),
  ended_at             timestamptz(6),
  note                 text,
  lost                 boolean NOT NULL DEFAULT false,
  CHECK ((outcome IS NULL) = (ended_at IS NULL))
);

CREATE TABLE audit.purge_reports (
  id                    uuid PRIMARY KEY DEFAULT util.uuid_v7(),
  request_id            uuid NOT NULL REFERENCES audit.purge_report_requests (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  run_id                uuid NOT NULL UNIQUE,
  p_as_of               timestamptz(6) NOT NULL,
  confirmed_at          timestamptz(6) NOT NULL,
  row_count             integer NOT NULL CHECK (row_count > 0),
  page_count            integer NOT NULL CHECK (page_count > 0),
  manifest_digest       text NOT NULL,
  file_sha256           text NOT NULL,
  file_location         text NOT NULL,
  delivered_handover_id uuid,
  delivered_at          timestamptz(6),
  receipt_reference     text,
  delivery_note         text,
  withdrawn_at          timestamptz(6),
  lost_at               timestamptz(6),
  loss_note             text,
  copy_destroyed_at     timestamptz(6),
  destroy_mode          text CHECK (destroy_mode IN ('automatic', 'attested', 'lost')),
  destroy_note          text,
  lost_host             boolean NOT NULL DEFAULT false,
  CHECK ((delivered_at IS NOT NULL)::int + (withdrawn_at IS NOT NULL)::int + (lost_at IS NOT NULL)::int <= 1),
  CHECK ((delivered_at IS NULL) = (delivered_handover_id IS NULL)),
  CHECK ((delivered_at IS NULL) = (receipt_reference IS NULL)),
  CHECK (copy_destroyed_at IS NULL OR delivered_at IS NOT NULL OR withdrawn_at IS NOT NULL),
  CHECK ((copy_destroyed_at IS NULL) = (destroy_mode IS NULL))
);
-- At most one active report per request: confirmed, and neither delivered, withdrawn nor lost.
CREATE UNIQUE INDEX purge_reports_one_active ON audit.purge_reports (request_id)
  WHERE delivered_at IS NULL AND withdrawn_at IS NULL AND lost_at IS NULL;

CREATE TABLE audit.purge_report_handovers (
  id               uuid PRIMARY KEY DEFAULT util.uuid_v7(),
  report_id        uuid NOT NULL REFERENCES audit.purge_reports (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  started_at       timestamptz(6) NOT NULL,
  medium           text NOT NULL,
  written_at       timestamptz(6),
  write_diskseq    text,
  verify_diskseq   text,
  eject_attested   boolean NOT NULL DEFAULT false,
  outcome          text CHECK (outcome IN ('recorded', 'abandoned', 'superseded')),
  ended_at         timestamptz(6),
  medium_sha256    text,
  note             text,
  fate_attested_at timestamptz(6),
  fate_note        text,
  UNIQUE (id, report_id),
  CHECK ((outcome IS NULL) = (ended_at IS NULL)),
  CHECK (outcome IS DISTINCT FROM 'recorded' OR (medium_sha256 IS NOT NULL AND eject_attested AND written_at IS NOT NULL)),
  CHECK ((fate_attested_at IS NULL) = (fate_note IS NULL))
);
-- At most one live attempt per report: unended, or recorded and not superseded.
CREATE UNIQUE INDEX purge_report_handovers_one_live ON audit.purge_report_handovers (report_id)
  WHERE outcome IS NULL OR outcome = 'recorded';
-- The delivery names a recorded attempt of the same report.
ALTER TABLE audit.purge_reports
  ADD CONSTRAINT purge_reports_delivered_handover_fkey FOREIGN KEY (delivered_handover_id, id)
  REFERENCES audit.purge_report_handovers (id, report_id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── the index the purge pages by (and the audit reads of P5.8) ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS audit_events_occurred_at_id_idx ON audit.audit_events (occurred_at, id);

-- ── the table's own guard (§8.6 item 1) ─────────────────────────────────────────────────────────────────────────
-- Runs as the caller. Refuses every UPDATE and TRUNCATE, and a DELETE unless (a) the transaction's audit.purge_run_id
-- names the run holding the live reservation, (b) the row is past its retention as of now(), (c) no active report
-- holds it, and (d) the run is a plain run and no request awaits its copy. Reads without locks; locks nothing.
CREATE FUNCTION audit.audit_events_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp SET "TimeZone" = 'UTC'
AS $fn$
DECLARE
  v_setting text;
  v_run     uuid;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    RAISE EXCEPTION 'audit.audit_events is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  v_setting := nullif(current_setting('audit.purge_run_id', true), '');
  IF v_setting IS NULL THEN
    RAISE EXCEPTION 'audit.audit_events: a DELETE is allowed only inside a purge run' USING ERRCODE = 'restrict_violation';
  END IF;
  v_run := v_setting::uuid;
  -- (a) the live reservation is this run's
  IF NOT EXISTS (SELECT 1 FROM audit.purge_reservation r
                  WHERE r.id AND r.run_id = v_run AND r.renewed_at >= clock_timestamp() - audit.purge_lease()) THEN
    RAISE EXCEPTION 'audit.audit_events: the purge run is not the live one' USING ERRCODE = 'restrict_violation';
  END IF;
  -- (d) a plain run, and no request awaiting its copy
  IF NOT EXISTS (SELECT 1 FROM audit.purge_runs pr WHERE pr.run_id = v_run AND pr.kind = 'plain')
     OR EXISTS (SELECT 1 FROM audit.purge_report_requests q
                 WHERE q.state = 'open'
                   AND NOT EXISTS (SELECT 1 FROM audit.purge_reports p
                                    WHERE p.request_id = q.id AND p.delivered_at IS NULL
                                      AND p.withdrawn_at IS NULL AND p.lost_at IS NULL)) THEN
    RAISE EXCEPTION 'audit.audit_events: no deletion while a copy is awaited, or outside a plain run'
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- (b) past its retention as of now(); an override can only lengthen the two years
  IF OLD.occurred_at >= now() - greatest(
       coalesce((SELECT c.retention_override FROM audit.event_catalog c
                  WHERE c.identifier = OLD.action AND c.outcome = OLD.outcome), audit.d9_retention()),
       audit.d9_retention()) THEN
    RAISE EXCEPTION 'audit.audit_events: the row is younger than its retention' USING ERRCODE = 'restrict_violation';
  END IF;
  -- (c) not held by an active report
  IF EXISTS (SELECT 1 FROM audit.purge_run_events e
               JOIN audit.purge_reports p ON p.run_id = e.run_id
              WHERE e.event_id = OLD.id AND p.delivered_at IS NULL AND p.withdrawn_at IS NULL AND p.lost_at IS NULL) THEN
    RAISE EXCEPTION 'audit.audit_events: the row is held by a report awaiting the owner' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION audit.audit_events_guard() FROM PUBLIC;

DROP TRIGGER "audit_events_immutable" ON audit.audit_events;
DROP TRIGGER "audit_events_no_truncate" ON audit.audit_events;
CREATE TRIGGER "audit_events_guarded"
  BEFORE UPDATE OR DELETE ON audit.audit_events
  FOR EACH ROW EXECUTE FUNCTION audit.audit_events_guard();
CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON audit.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit.audit_events_guard();

-- ── catalog: #38 and #40-#50 (atomic, pattern A, operator actor NULL) ───────────────────────────────────────────
INSERT INTO audit.event_catalog (identifier, outcome, class, writer_pattern, summary_allowlist) VALUES
  ('platform.audit_purged', 'success', 'atomic', 'A',
   '{"asOf": {"type": "string", "max": 40}, "runId": {"type": "string", "max": 36}, "pageNo": {"type": "integer"}, "rowsDeleted": {"type": "integer"}, "pageDigest": {"type": "string", "max": 64}}'),
  ('platform.request_metadata_cleared', 'success', 'atomic', 'A',
   '{"asOf": {"type": "string", "max": 40}, "tokensCleared": {"type": "integer"}, "sessionsCleared": {"type": "integer"}}'),
  ('platform.purge_report_delivered', 'success', 'atomic', 'A',
   '{"reportId": {"type": "string", "max": 36}, "attemptId": {"type": "string", "max": 36}}'),
  ('platform.purge_report_requested', 'success', 'atomic', 'A',
   '{"requestId": {"type": "string", "max": 36}}'),
  ('platform.purge_report_lost', 'success', 'atomic', 'A',
   '{"reportId": {"type": "string", "max": 36}, "mode": {"type": "string", "max": 16}}'),
  ('platform.purge_report_copy_destroyed', 'success', 'atomic', 'A',
   '{"reportId": {"type": "string", "max": 36}, "mode": {"type": "string", "max": 16}}'),
  ('platform.purge_export_discarded', 'success', 'atomic', 'A',
   '{"runId": {"type": "string", "max": 36}, "mode": {"type": "string", "max": 16}}'),
  ('platform.purge_report_confirmed', 'success', 'atomic', 'A',
   '{"reportId": {"type": "string", "max": 36}, "runId": {"type": "string", "max": 36}, "rowCount": {"type": "integer"}, "fileSha256": {"type": "string", "max": 64}}'),
  ('platform.purge_report_handed_over', 'success', 'atomic', 'A',
   '{"reportId": {"type": "string", "max": 36}, "attemptId": {"type": "string", "max": 36}, "diskseqChecked": {"type": "boolean"}}'),
  ('platform.purge_report_request_cancelled', 'success', 'atomic', 'A',
   '{"requestId": {"type": "string", "max": 36}, "withdrawnReportId": {"type": "string", "max": 36, "nullable": true}}'),
  ('platform.purge_report_handover_abandoned', 'success', 'atomic', 'A',
   '{"reportId": {"type": "string", "max": 36}, "attemptId": {"type": "string", "max": 36}, "outcome": {"type": "string", "max": 16}}'),
  ('platform.purge_report_handover_failed', 'success', 'atomic', 'A',
   '{"reportId": {"type": "string", "max": 36}, "attemptId": {"type": "string", "max": 36}}');

-- ── the run functions ───────────────────────────────────────────────────────────────────────────────────────────
-- Every function that takes p_run_id first takes the reservation row FOR NO KEY UPDATE NOWAIT (category 0), judges
-- liveness with clock_timestamp() after taking it, and renews renewed_at when its work is done.

CREATE FUNCTION audit.reserve_purge_run(p_as_of timestamptz)
 RETURNS TABLE(run_id uuid, kind text, as_of text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_res  audit.purge_reservation%ROWTYPE;
  v_kind text;
  v_as_of timestamptz;
  v_run  uuid := util.uuid_v7();
  v_old  uuid;
BEGIN
  IF p_as_of IS NULL OR p_as_of > now() THEN
    RAISE EXCEPTION 'as_of_in_future' USING ERRCODE = 'check_violation', DETAIL = 'p_as_of must not be later than now()';
  END IF;
  SELECT * INTO v_res FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  IF v_res.run_id IS NOT NULL AND v_res.renewed_at >= clock_timestamp() - audit.purge_lease() THEN
    RAISE EXCEPTION 'purge_run_active' USING ERRCODE = 'object_in_use', DETAIL = 'another purge run holds a live reservation';
  END IF;
  IF EXISTS (SELECT 1 FROM audit.purge_exports e WHERE e.outcome IS NULL) THEN
    RAISE EXCEPTION 'export_unresolved' USING ERRCODE = 'object_in_use',
      DETAIL = 'an export is neither confirmed nor discarded; resolve it first';
  END IF;
  -- A run that died (reserved, never released): record what it deleted, then mark it taken over.
  IF v_res.run_id IS NOT NULL THEN
    v_old := v_res.run_id;
    UPDATE audit.purge_runs pr
       SET rows_deleted = coalesce((SELECT sum(pg.deleted_count) FROM audit.purge_run_pages pg
                                     WHERE pg.run_id = pr.run_id), 0)::integer,
           released_at = clock_timestamp(), completed = false
     WHERE pr.run_id = v_old AND pr.released_at IS NULL;
  END IF;
  -- Manifests no active report needs are removed (a dead run's, a discarded export's).
  DELETE FROM audit.purge_run_events e
   WHERE NOT EXISTS (SELECT 1 FROM audit.purge_reports p WHERE p.run_id = e.run_id AND p.delivered_at IS NULL
                       AND p.withdrawn_at IS NULL AND p.lost_at IS NULL);
  DELETE FROM audit.purge_run_pages g
   WHERE NOT EXISTS (SELECT 1 FROM audit.purge_reports p WHERE p.run_id = g.run_id AND p.delivered_at IS NULL
                       AND p.withdrawn_at IS NULL AND p.lost_at IS NULL);
  -- The kind (§8.6 item 4): a request awaiting its copy makes an export run, as of the reservation's now().
  IF EXISTS (SELECT 1 FROM audit.purge_report_requests q
              WHERE q.state = 'open'
                AND NOT EXISTS (SELECT 1 FROM audit.purge_reports p WHERE p.request_id = q.id AND p.delivered_at IS NULL
                                  AND p.withdrawn_at IS NULL AND p.lost_at IS NULL)) THEN
    v_kind := 'export';
    v_as_of := now();
  ELSE
    v_kind := 'plain';
    v_as_of := p_as_of;
  END IF;
  UPDATE audit.purge_reservation r
     SET run_id = v_run, p_as_of = v_as_of, reserved_at = clock_timestamp(), renewed_at = clock_timestamp()
   WHERE r.id;
  INSERT INTO audit.purge_runs (run_id, kind, p_as_of, reserved_at, taken_over_run)
  VALUES (v_run, v_kind, v_as_of, clock_timestamp(), v_old);
  -- Return the exact microsecond value as canonical text; JS Date would truncate it to milliseconds on round-trip.
  RETURN QUERY SELECT v_run, v_kind, to_char(v_as_of, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
END
$function$;
REVOKE ALL ON FUNCTION audit.reserve_purge_run(timestamptz) FROM PUBLIC;

CREATE FUNCTION audit.renew_purge_run(p_run_id uuid, p_as_of timestamptz)
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
    RAISE EXCEPTION 'run_not_live' USING ERRCODE = 'object_not_in_prerequisite_state',
      DETAIL = 'the reservation is no longer this run''s';
  END IF;
  UPDATE audit.purge_reservation r SET renewed_at = clock_timestamp() WHERE r.id;
END
$function$;
REVOKE ALL ON FUNCTION audit.renew_purge_run(uuid, timestamptz) FROM PUBLIC;

CREATE FUNCTION audit.release_purge_run(p_run_id uuid, p_completed boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_res audit.purge_reservation%ROWTYPE;
BEGIN
  SELECT * INTO v_res FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  IF v_res.run_id IS DISTINCT FROM p_run_id THEN
    RETURN false;
  END IF;
  UPDATE audit.purge_runs pr
     SET rows_deleted = coalesce((SELECT sum(pg.deleted_count) FROM audit.purge_run_pages pg
                                   WHERE pg.run_id = pr.run_id), 0)::integer,
         released_at = clock_timestamp(), completed = coalesce(p_completed, false)
   WHERE pr.run_id = p_run_id;
  -- This run's manifest, unless an active report needs it.
  IF NOT EXISTS (SELECT 1 FROM audit.purge_reports p WHERE p.run_id = p_run_id AND p.delivered_at IS NULL
                   AND p.withdrawn_at IS NULL AND p.lost_at IS NULL) THEN
    DELETE FROM audit.purge_run_events e WHERE e.run_id = p_run_id;
    DELETE FROM audit.purge_run_pages g WHERE g.run_id = p_run_id;
  END IF;
  UPDATE audit.purge_reservation r
     SET run_id = NULL, p_as_of = NULL, reserved_at = NULL, renewed_at = NULL
   WHERE r.id;
  RETURN true;
END
$function$;
REVOKE ALL ON FUNCTION audit.release_purge_run(uuid, boolean) FROM PUBLIC;

-- One page of the run's manifest (§8.6 item 5). No cursor: the read position is the run's own.
CREATE FUNCTION audit.purge_candidates(p_run_id uuid, p_as_of timestamptz, p_page_no integer, p_limit integer)
 RETURNS TABLE(page_no integer, row_count integer, page_digest text, exhausted boolean, event_ids uuid[], texts text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_res     audit.purge_reservation%ROWTYPE;
  v_run     audit.purge_runs%ROWTYPE;
  v_page    audit.purge_run_pages%ROWTYPE;
  v_next    integer;
  v_bound   timestamptz;
  v_ids     uuid[];
  v_texts   text[];
  v_last_oc timestamptz;
  v_last_id uuid;
  v_seen    integer;
  v_digest  text;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_res FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  IF v_res.run_id IS DISTINCT FROM p_run_id OR v_res.p_as_of IS DISTINCT FROM p_as_of
     OR v_res.renewed_at < clock_timestamp() - audit.purge_lease() THEN
    RAISE EXCEPTION 'run_not_live' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT * INTO v_run FROM audit.purge_runs pr WHERE pr.run_id = p_run_id FOR NO KEY UPDATE;
  IF v_run.kind = 'export' THEN
    IF NOT EXISTS (SELECT 1 FROM audit.purge_exports e WHERE e.run_id = p_run_id
                     AND e.artifact_recorded_at IS NOT NULL AND e.outcome IS NULL) THEN
      RAISE EXCEPTION 'export_not_ready' USING ERRCODE = 'object_not_in_prerequisite_state',
        DETAIL = 'an export run reads pages only after its file is recorded and before it is confirmed or discarded';
    END IF;
  END IF;

  -- A page already recorded: returned as recorded (a retry), unless processed.
  SELECT * INTO v_page FROM audit.purge_run_pages g WHERE g.run_id = p_run_id AND g.page_no = p_page_no;
  IF FOUND THEN
    IF v_page.processed_at IS NOT NULL THEN
      RAISE EXCEPTION 'page_processed' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    SELECT array_agg(e.event_id ORDER BY e.ordinal),
           array_agg(audit.event_canonical_text(a) ORDER BY e.ordinal)
      INTO v_ids, v_texts
      FROM audit.purge_run_events e JOIN audit.audit_events a ON a.id = e.event_id
     WHERE e.run_id = p_run_id AND e.page_no = p_page_no;
    UPDATE audit.purge_reservation r SET renewed_at = clock_timestamp() WHERE r.id;
    RETURN QUERY SELECT p_page_no, v_page.row_count, v_page.digest, v_run.exhausted_at IS NOT NULL, v_ids, v_texts;
    RETURN;
  END IF;
  SELECT coalesce(max(g.page_no), 0) + 1 INTO v_next FROM audit.purge_run_pages g WHERE g.run_id = p_run_id;
  IF p_page_no <> v_next THEN
    RAISE EXCEPTION 'page_out_of_order' USING ERRCODE = 'check_violation', DETAIL = format('the next page is %s', v_next);
  END IF;
  IF v_run.exhausted_at IS NOT NULL THEN
    UPDATE audit.purge_reservation r SET renewed_at = clock_timestamp() WHERE r.id;
    RETURN QUERY SELECT p_page_no, 0, NULL::text, true, '{}'::uuid[], '{}'::text[];
    RETURN;
  END IF;

  -- Examine at most 20 × p_limit rows after the position, below the sargable bound; take the eligible, unheld ones.
  v_bound := p_as_of - audit.d9_retention();
  WITH examined AS (
    SELECT a.id, a.occurred_at,
           (a.occurred_at < p_as_of - greatest(coalesce(c.retention_override, audit.d9_retention()), audit.d9_retention())
            AND NOT EXISTS (SELECT 1 FROM audit.purge_run_events he
                              JOIN audit.purge_reports hp ON hp.run_id = he.run_id
                             WHERE he.event_id = a.id AND hp.delivered_at IS NULL
                               AND hp.withdrawn_at IS NULL AND hp.lost_at IS NULL)) AS take
      FROM audit.audit_events a
      LEFT JOIN audit.event_catalog c ON c.identifier = a.action AND c.outcome = a.outcome
     WHERE a.occurred_at < v_bound
       AND (v_run.scan_after_id IS NULL OR (a.occurred_at, a.id) > (v_run.scan_after_occurred_at, v_run.scan_after_id))
     ORDER BY a.occurred_at, a.id
     LIMIT 20 * p_limit
  ), numbered AS (
    SELECT x.*, row_number() OVER (ORDER BY x.occurred_at, x.id) AS rn,
           sum(CASE WHEN x.take THEN 1 ELSE 0 END) OVER (ORDER BY x.occurred_at, x.id) AS taken_so_far
      FROM examined x
  ), cut AS (
    -- Stop at the p_limit-th taken row, or at the last examined row.
    SELECT n.* FROM numbered n
     WHERE n.rn <= coalesce((SELECT min(m.rn) FROM numbered m WHERE m.taken_so_far = p_limit AND m.take),
                            (SELECT max(m.rn) FROM numbered m))
  )
  SELECT array_agg(cut.id ORDER BY cut.rn) FILTER (WHERE cut.take),
         (SELECT k.occurred_at FROM cut k ORDER BY k.rn DESC LIMIT 1),
         (SELECT k.id FROM cut k ORDER BY k.rn DESC LIMIT 1),
         (SELECT count(*) FROM numbered)::integer
    INTO v_ids, v_last_oc, v_last_id, v_seen
    FROM cut;

  IF v_last_id IS NOT NULL THEN
    UPDATE audit.purge_runs pr SET scan_after_occurred_at = v_last_oc, scan_after_id = v_last_id
     WHERE pr.run_id = p_run_id;
  END IF;
  -- The bound is reached when fewer rows than the ceiling were examined and the page is not full.
  IF v_seen < 20 * p_limit AND coalesce(cardinality(v_ids), 0) < p_limit THEN
    UPDATE audit.purge_runs pr SET exhausted_at = clock_timestamp() WHERE pr.run_id = p_run_id;
  END IF;

  IF coalesce(cardinality(v_ids), 0) = 0 THEN
    UPDATE audit.purge_reservation r SET renewed_at = clock_timestamp() WHERE r.id;
    RETURN QUERY SELECT p_page_no, 0, NULL::text,
      (SELECT pr.exhausted_at IS NOT NULL FROM audit.purge_runs pr WHERE pr.run_id = p_run_id), '{}'::uuid[], '{}'::text[];
    RETURN;
  END IF;

  SELECT array_agg(audit.event_canonical_text(a) ORDER BY array_position(v_ids, a.id))
    INTO v_texts
    FROM audit.audit_events a WHERE a.id = ANY(v_ids);
  -- A page's bytes: each row's text followed by one newline, in page order.
  v_digest := encode(sha256(convert_to(array_to_string(v_texts, E'\n') || E'\n', 'UTF8')), 'hex');
  INSERT INTO audit.purge_run_pages (run_id, page_no, row_count, digest)
  VALUES (p_run_id, p_page_no, cardinality(v_ids), v_digest);
  INSERT INTO audit.purge_run_events (run_id, page_no, ordinal, event_id)
  SELECT p_run_id, p_page_no, i, v_ids[i] FROM generate_subscripts(v_ids, 1) AS i;
  UPDATE audit.purge_reservation r SET renewed_at = clock_timestamp() WHERE r.id;
  RETURN QUERY SELECT p_page_no, cardinality(v_ids), v_digest,
    (SELECT pr.exhausted_at IS NOT NULL FROM audit.purge_runs pr WHERE pr.run_id = p_run_id), v_ids, v_texts;
END
$function$;
REVOKE ALL ON FUNCTION audit.purge_candidates(uuid, timestamptz, integer, integer) FROM PUBLIC;

-- Deletes one page of this plain run's own manifest, by identity (§8.6 item 5).
CREATE FUNCTION audit.purge_expired_events(p_run_id uuid, p_as_of timestamptz, p_page_no integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_res     audit.purge_reservation%ROWTYPE;
  v_page    audit.purge_run_pages%ROWTYPE;
  v_ids     uuid[];
  v_del     uuid[];
  v_deleted integer;
BEGIN
  SELECT * INTO v_res FROM audit.purge_reservation r WHERE r.id FOR NO KEY UPDATE NOWAIT;
  IF v_res.run_id IS DISTINCT FROM p_run_id OR v_res.p_as_of IS DISTINCT FROM p_as_of
     OR v_res.renewed_at < clock_timestamp() - audit.purge_lease() THEN
    RAISE EXCEPTION 'run_not_live' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit.purge_runs pr WHERE pr.run_id = p_run_id AND pr.kind = 'plain') THEN
    RAISE EXCEPTION 'not_a_plain_run' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM audit.purge_report_requests q
              WHERE q.state = 'open'
                AND NOT EXISTS (SELECT 1 FROM audit.purge_reports p WHERE p.request_id = q.id AND p.delivered_at IS NULL
                                  AND p.withdrawn_at IS NULL AND p.lost_at IS NULL)) THEN
    RAISE EXCEPTION 'copy_awaited' USING ERRCODE = 'object_not_in_prerequisite_state',
      DETAIL = 'a request awaits its copy: nothing is deleted until the copy is made';
  END IF;
  -- Every purge function holds the reservation row, so no other purge transaction touches this page meanwhile.
  SELECT * INTO v_page FROM audit.purge_run_pages g WHERE g.run_id = p_run_id AND g.page_no = p_page_no;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page_unknown' USING ERRCODE = 'check_violation';
  END IF;
  IF v_page.processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'page_processed' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT array_agg(e.event_id ORDER BY e.ordinal) INTO v_ids
    FROM audit.purge_run_events e WHERE e.run_id = p_run_id AND e.page_no = p_page_no;
  IF (SELECT count(*) FROM audit.audit_events a WHERE a.id = ANY(v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'page_rows_missing' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT coalesce(array_agg(a.id), '{}') INTO v_del
    FROM audit.audit_events a
    LEFT JOIN audit.event_catalog c ON c.identifier = a.action AND c.outcome = a.outcome
   WHERE a.id = ANY(v_ids)
     AND a.occurred_at < now() - greatest(coalesce(c.retention_override, audit.d9_retention()), audit.d9_retention())
     AND NOT EXISTS (SELECT 1 FROM audit.purge_run_events he
                       JOIN audit.purge_reports hp ON hp.run_id = he.run_id
                      WHERE he.event_id = a.id AND hp.delivered_at IS NULL
                        AND hp.withdrawn_at IS NULL AND hp.lost_at IS NULL);
  -- The page is marked first (category 0), then its rows deleted (category 11); a mismatch rolls both back.
  UPDATE audit.purge_run_pages g SET processed_at = clock_timestamp(), deleted_count = cardinality(v_del)
   WHERE g.run_id = p_run_id AND g.page_no = p_page_no;
  PERFORM set_config('audit.purge_run_id', p_run_id::text, true);
  DELETE FROM audit.audit_events a WHERE a.id = ANY(v_del);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> cardinality(v_del) THEN
    RAISE EXCEPTION 'page_delete_mismatch' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM set_config('audit.purge_run_id', '', true);
  INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
  VALUES (NULL, NULL, 'platform.audit_purged', 'purge_run', p_run_id::text, 'success',
          jsonb_build_object('asOf', to_char(p_as_of, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'runId', p_run_id::text,
                             'pageNo', p_page_no, 'rowsDeleted', v_deleted, 'pageDigest', v_page.digest));
  UPDATE audit.purge_reservation r SET renewed_at = clock_timestamp() WHERE r.id;
  RETURN v_deleted;
END
$function$;
REVOKE ALL ON FUNCTION audit.purge_expired_events(uuid, timestamptz, integer) FROM PUBLIC;

-- Clears the IP address and user agent kept with sign-ins and links, in bounded batches (§8.6 item 5; CF4).
-- Independent of runs and reservations.
CREATE FUNCTION audit.clear_expired_request_metadata(p_as_of timestamptz, p_limit integer)
 RETURNS TABLE(tokens_cleared integer, sessions_cleared integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_cutoff   timestamptz;
  v_tokens   integer := 0;
  v_sessions integer := 0;
BEGIN
  IF p_as_of IS NULL OR p_as_of > now() THEN
    RAISE EXCEPTION 'as_of_in_future' USING ERRCODE = 'check_violation';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = 'check_violation';
  END IF;
  v_cutoff := p_as_of - audit.d9_retention();
  -- Tokens first (category 5): a link sent before the cutoff that can no longer be used.
  WITH c AS (
    SELECT t.id FROM identity.one_time_tokens t
     WHERE t.requested_ip IS NOT NULL
       AND t.created_at < v_cutoff
       AND (t.consumed_at IS NOT NULL OR t.expires_at <= p_as_of)
     ORDER BY t.id
     LIMIT p_limit
       FOR NO KEY UPDATE SKIP LOCKED
  )
  UPDATE identity.one_time_tokens t SET requested_ip = NULL FROM c WHERE t.id = c.id;
  GET DIAGNOSTICS v_tokens = ROW_COUNT;
  -- Then sessions (category 10): ended — the earliest of revocation, absolute and idle expiry — before the cutoff.
  IF v_tokens < p_limit THEN
    WITH c AS (
      SELECT s.id FROM identity.sessions s
       WHERE (s.created_ip IS NOT NULL OR s.user_agent IS NOT NULL)
         AND least(coalesce(s.revoked_at, 'infinity'::timestamptz), s.absolute_expires_at,
                   coalesce((SELECT max(rt.expires_at) FROM identity.refresh_tokens rt WHERE rt.session_id = s.id),
                            'infinity'::timestamptz)) < v_cutoff
       ORDER BY s.id
       LIMIT p_limit - v_tokens
         FOR NO KEY UPDATE OF s SKIP LOCKED
    )
    UPDATE identity.sessions s SET created_ip = NULL, user_agent = NULL FROM c WHERE s.id = c.id;
    GET DIAGNOSTICS v_sessions = ROW_COUNT;
  END IF;
  IF v_tokens + v_sessions > 0 THEN
    INSERT INTO audit.audit_events (actor_identity_id, actor_audience, action, target_type, target_id, outcome, summary)
    VALUES (NULL, NULL, 'platform.request_metadata_cleared', NULL, NULL, 'success',
            jsonb_build_object('asOf', to_char(p_as_of, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                               'tokensCleared', v_tokens, 'sessionsCleared', v_sessions));
  END IF;
  RETURN QUERY SELECT v_tokens, v_sessions;
END
$function$;
REVOKE ALL ON FUNCTION audit.clear_expired_request_metadata(timestamptz, integer) FROM PUBLIC;
