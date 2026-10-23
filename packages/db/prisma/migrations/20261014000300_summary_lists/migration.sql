-- P5.6: a bounded list rule for audit summaries (P5 plan §10 P5.6, finding 1, option (a) — the project lead's decision of
-- 2026-10-14, judged by the reviewer at the P5.6 gate).
--
-- merchant.role_permissions_set (#21) records the role's permission set before and after the change, and P5.7's
-- platform staff deactivation (#31) the identifiers it removed. The event catalog's summary rules (P5.3a) allowed only
-- strings, integers and booleans, so a list was refused at insert. A fourth rule type is added:
--
--   {"type": "string_list", "maxItems": n, "max": m}   a JSON array of at most n strings, each at most m characters
--
-- (and, as for every rule, "nullable": true to allow null). Nothing else changes: an unknown field, a value of the
-- wrong type, a bound exceeded, a nested object — and a list holding anything but strings — are still refused with the
-- field named and its value never printed. No pair uses the rule yet; #21 is added with its writer. Forward-only;
-- earlier migrations untouched.

CREATE OR REPLACE FUNCTION "audit"."validate_event"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_allow  jsonb;
  v_status text;
  v_key    text;
  v_value  jsonb;
  v_rule   jsonb;
  v_ok     boolean;
BEGIN
  SELECT c."summary_allowlist", c."status" INTO v_allow, v_status
    FROM audit.event_catalog c
   WHERE c."identifier" = NEW."action" AND c."outcome" = NEW."outcome";
  IF NOT FOUND OR v_status <> 'active' THEN
    RAISE EXCEPTION 'audit event %/% is not an active pair of the event catalog', NEW."action", NEW."outcome"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'audit_event_catalog';
  END IF;
  IF NEW."summary" IS NULL OR jsonb_typeof(NEW."summary") <> 'object' THEN
    RAISE EXCEPTION 'audit event %/%: the summary must be an object', NEW."action", NEW."outcome"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'audit_event_catalog';
  END IF;

  FOR v_key, v_value IN SELECT s.key, s.value FROM jsonb_each(NEW."summary") s LOOP
    v_rule := v_allow -> v_key;
    IF v_rule IS NULL THEN
      RAISE EXCEPTION 'audit event %/%: summary field % is not allowed', NEW."action", NEW."outcome", v_key
        USING ERRCODE = 'check_violation', CONSTRAINT = 'audit_event_catalog';
    END IF;
    IF jsonb_typeof(v_value) = 'null' THEN
      v_ok := coalesce((v_rule ->> 'nullable')::boolean, false);
    ELSIF v_rule ->> 'type' = 'string' THEN
      v_ok := jsonb_typeof(v_value) = 'string' AND char_length(v_value #>> '{}') <= (v_rule ->> 'max')::integer;
    ELSIF v_rule ->> 'type' = 'integer' THEN
      v_ok := jsonb_typeof(v_value) = 'number'
              AND (v_value #>> '{}')::numeric = trunc((v_value #>> '{}')::numeric)
              AND abs((v_value #>> '{}')::numeric) <= 2147483647;
    ELSIF v_rule ->> 'type' = 'boolean' THEN
      v_ok := jsonb_typeof(v_value) = 'boolean';
    ELSIF v_rule ->> 'type' = 'string_list' THEN
      v_ok := jsonb_typeof(v_value) = 'array'
              AND jsonb_array_length(v_value) <= (v_rule ->> 'maxItems')::integer
              AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(v_value) x
                 WHERE jsonb_typeof(x) <> 'string' OR char_length(x #>> '{}') > (v_rule ->> 'max')::integer);
    ELSE
      v_ok := false;
    END IF;
    IF NOT v_ok THEN
      -- The field is named; its value is never printed (it may be personal data).
      RAISE EXCEPTION 'audit event %/%: summary field % has a disallowed value', NEW."action", NEW."outcome", v_key
        USING ERRCODE = 'check_violation', CONSTRAINT = 'audit_event_catalog';
    END IF;
  END LOOP;
  RETURN NEW;
END
$fn$;
