-- P5.3a: the audit event catalog and its validation trigger (TARGET_ARCHITECTURE ADR-16 §3.5 "Audit (Part 1)"; P5 plan
-- §8.1, §8.2, P5.3a).
--
-- audit.event_catalog lists every (identifier, outcome) pair that may be stored, with its class — atomic (written with
-- the change it describes; pattern A: a definer function's own insert, pattern B: mutateAudited inside the change's
-- transaction), best effort (recordBestEffort, its own transaction) or sensitive read — and its summary allowlist:
-- field → { "type": "string" | "integer" | "boolean", "max": <characters, strings only>, "nullable": true }. Seeded
-- with exactly the pairs the code writes at this point and the summary fields each writes today; later packages add
-- theirs together with their writer and tests (§8.1). Every P5 pair has no retention override (NULL = the D9 rule).
-- Entries are never deleted: a pair no longer written is retired, so every stored event keeps its entry.
--
-- The BEFORE INSERT trigger on audit.audit_events validates every row against the catalog, for every writer and every
-- role — the table owner included: an unknown or retired pair, a summary that is not an object, a field outside the
-- allowlist, a value of the wrong type, a null where none is allowed, or a string over its bound is refused with
-- check_violation under the name audit_event_catalog. Fields are rejected, never dropped: an event is never silently
-- repaired. The trigger reads the catalog without locks (ADR-16: triggers lock nothing) and never prints a value.
--
-- Grants: the app may read the catalog (SELECT only); the reporting role gets nothing on a table P5 adds (§8.6). The
-- trigger function is SECURITY DEFINER with a pinned search_path and no grant, so no writer needs access to the
-- catalog. Forward-only; earlier migrations untouched.

CREATE TABLE "audit"."event_catalog" (
    "identifier" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "writer_pattern" TEXT,
    "summary_allowlist" JSONB NOT NULL DEFAULT '{}',
    "retention_override" INTERVAL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_catalog_pkey" PRIMARY KEY ("identifier", "outcome")
);
ALTER TABLE "audit"."event_catalog"
  ADD CONSTRAINT "event_catalog_identifier_valid"
    CHECK ("identifier" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$' AND char_length("identifier") <= 100),
  ADD CONSTRAINT "event_catalog_outcome_valid" CHECK ("outcome" IN ('success', 'failure', 'denied')),
  ADD CONSTRAINT "event_catalog_class_valid" CHECK ("class" IN ('atomic', 'best_effort', 'sensitive_read')),
  -- A writer pattern exactly for atomic pairs (§8.1: each atomic pair has exactly one of the two patterns).
  ADD CONSTRAINT "event_catalog_pattern_valid"
    CHECK (("class" = 'atomic') = ("writer_pattern" IS NOT NULL) AND ("writer_pattern" IS NULL OR "writer_pattern" IN ('A', 'B'))),
  ADD CONSTRAINT "event_catalog_allowlist_is_object" CHECK (jsonb_typeof("summary_allowlist") = 'object'),
  ADD CONSTRAINT "event_catalog_status_valid" CHECK ("status" IN ('active', 'retired'));

-- ── entries are never deleted (§8.1, rev 20) ────────────────────────────────────────────────────
CREATE FUNCTION "audit"."protect_event_catalog"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'audit.event_catalog: % is not allowed (retire the pair instead)', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$fn$;
REVOKE ALL ON FUNCTION "audit"."protect_event_catalog"() FROM PUBLIC;
CREATE TRIGGER "event_catalog_no_delete"
  BEFORE DELETE ON "audit"."event_catalog"
  FOR EACH ROW EXECUTE FUNCTION "audit"."protect_event_catalog"();
CREATE TRIGGER "event_catalog_no_truncate"
  BEFORE TRUNCATE ON "audit"."event_catalog"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit"."protect_event_catalog"();

-- ── the validation trigger on audit.audit_events ───────────────────────────────────────────────
CREATE FUNCTION "audit"."validate_event"() RETURNS trigger
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
REVOKE ALL ON FUNCTION "audit"."validate_event"() FROM PUBLIC;

CREATE TRIGGER "audit_events_validate"
  BEFORE INSERT ON "audit"."audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit"."validate_event"();

-- ── seed: every pair written at this point (plan §8.1 inventory; [Fact] from the code at this commit) ─────
-- Summary field rules, reused below.
--   reason: a short machine reason code; name: a business, branch or role name (1–120); id: a UUID or null.
INSERT INTO "audit"."event_catalog" ("identifier", "outcome", "class", "writer_pattern", "summary_allowlist") VALUES
  -- identity flows: atomic successes, pattern B (§8.4)
  ('auth.signup',                  'success', 'atomic', 'B', '{}'),
  ('auth.email_verify',            'success', 'atomic', 'B', '{}'),
  ('auth.login',                   'success', 'atomic', 'B', '{"stage": {"type": "string", "max": 64}, "choices": {"type": "integer"}}'),
  ('auth.login_select',            'success', 'atomic', 'B', '{}'),
  ('auth.refresh',                 'success', 'atomic', 'B', '{}'),
  ('auth.refresh_token_reuse',     'denied',  'atomic', 'B', '{"severity": {"type": "string", "max": 16}, "sessionRevoked": {"type": "boolean"}}'),
  ('auth.logout',                  'success', 'atomic', 'B', '{}'),
  ('auth.password_change',         'success', 'atomic', 'B', '{"sessionsRevoked": {"type": "boolean"}}'),
  ('auth.password_reset',          'success', 'atomic', 'B', '{"sessionsRevoked": {"type": "boolean"}}'),
  ('auth.account_setup',           'success', 'atomic', 'B', '{"sessionsRevoked": {"type": "boolean"}}'),
  ('auth.mfa_enrollment_started',  'success', 'atomic', 'B', '{}'),
  ('auth.mfa_enrollment_confirmed','success', 'atomic', 'B', '{}'),
  ('auth.mfa_verify',              'success', 'atomic', 'B', '{"method": {"type": "string", "max": 32}}'),
  -- atomic successes, pattern A (database-owned; the tenancy and platform ones are on P5.3a's transitional list until P5.5)
  ('auth.invitation_accepted',     'success', 'atomic', 'A', '{}'),
  ('platform.super_admin_bootstrapped', 'success', 'atomic', 'A', '{"additional": {"type": "boolean"}}'),
  ('merchant.profile_updated',     'success', 'atomic', 'A', '{"name": {"type": "string", "max": 120}}'),
  ('merchant.branch_created',      'success', 'atomic', 'A', '{"name": {"type": "string", "max": 120}}'),
  ('merchant.branch_updated',      'success', 'atomic', 'A', '{"name": {"type": "string", "max": 120}, "status": {"type": "string", "max": 16}}'),
  ('merchant.role_created',        'success', 'atomic', 'A', '{"name": {"type": "string", "max": 120}}'),
  ('merchant.role_updated',        'success', 'atomic', 'A', '{"name": {"type": "string", "max": 120}, "status": {"type": "string", "max": 16}}'),
  ('merchant.member_assigned',     'success', 'atomic', 'A', '{"kind": {"type": "string", "max": 16}, "status": {"type": "string", "max": 16}, "roleId": {"type": "string", "max": 36, "nullable": true}, "branchId": {"type": "string", "max": 36, "nullable": true}}'),
  ('merchant.member_deactivated',  'success', 'atomic', 'A', '{"kind": {"type": "string", "max": 16}, "status": {"type": "string", "max": 16}, "roleId": {"type": "string", "max": 36, "nullable": true}, "branchId": {"type": "string", "max": 36, "nullable": true}}'),
  ('merchant.member_reactivated',  'success', 'atomic', 'A', '{"kind": {"type": "string", "max": 16}, "status": {"type": "string", "max": 16}, "roleId": {"type": "string", "max": 36, "nullable": true}, "branchId": {"type": "string", "max": 36, "nullable": true}}'),
  ('merchant.invitation_issued',   'success', 'atomic', 'A', '{"kind": {"type": "string", "max": 16}, "roleId": {"type": "string", "max": 36, "nullable": true}, "branchId": {"type": "string", "max": 36, "nullable": true}, "delivery": {"type": "string", "max": 16}}'),
  ('merchant.invitation_revoked',  'success', 'atomic', 'A', '{"kind": {"type": "string", "max": 16}}'),
  ('platform.merchant_deactivated','success', 'atomic', 'A', '{"status": {"type": "string", "max": 32}, "reason": {"type": "string", "max": 500}}'),
  ('platform.merchant_reactivated','success', 'atomic', 'A', '{"status": {"type": "string", "max": 32}}'),
  ('platform.ownership_transferred','success','atomic', 'A', '{"formerOwnerIdentityId": {"type": "string", "max": 36}, "formerOwnerMembershipId": {"type": "string", "max": 36}, "newOwnerIdentityId": {"type": "string", "max": 36}, "newOwnerMembershipId": {"type": "string", "max": 36}, "formerOwnerRoleId": {"type": "string", "max": 36}, "formerOwnerDeactivated": {"type": "boolean"}}'),
  -- best effort: identity failures, and the link-issuing successes of O6
  ('auth.signup',                  'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('auth.email_verify',            'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('auth.verification_resend',     'success', 'best_effort', NULL, '{}'),
  ('auth.verification_resend',     'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('auth.login',                   'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('auth.login_select',            'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('auth.refresh',                 'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('auth.password_forgot',         'success', 'best_effort', NULL, '{"link": {"type": "string", "max": 32}}'),
  ('auth.password_forgot',         'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('auth.password_change',         'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('auth.password_reset',          'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('auth.account_setup',           'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('auth.mfa_enrollment_confirmed','failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('auth.mfa_verify',              'failure', 'best_effort', NULL, '{"method": {"type": "string", "max": 32}, "reason": {"type": "string", "max": 64}}'),
  ('auth.invitation_accepted',     'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  -- best effort: tenancy and platform refusals (denied) and failures, as written today
  ('merchant.profile_updated',     'denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('merchant.branch_created',      'denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('merchant.branch_updated',      'denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('merchant.role_created',        'denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('merchant.role_updated',        'denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('merchant.member_assigned',     'denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('merchant.member_assigned',     'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('merchant.member_deactivated',  'denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('merchant.member_deactivated',  'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('merchant.member_reactivated',  'denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('merchant.member_reactivated',  'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('merchant.invitation_issued',   'denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('merchant.invitation_issued',   'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('merchant.invitation_revoked',  'denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}, "kind": {"type": "string", "max": 16}}'),
  ('merchant.invitation_revoked',  'failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.merchant_deactivated','denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.merchant_deactivated','failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.merchant_reactivated','denied',  'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.merchant_reactivated','failure', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.ownership_transferred','denied', 'best_effort', NULL, '{"reason": {"type": "string", "max": 64}}'),
  ('platform.ownership_transferred','failure','best_effort', NULL, '{"reason": {"type": "string", "max": 64}}');

GRANT SELECT ON "audit"."event_catalog" TO alphakolect_app;
