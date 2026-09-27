-- P1 ledger and audit invariants enforced by PostgreSQL (TARGET_ARCHITECTURE ADR-5, ADR-11, §7, §16).
-- These hold no matter which code (or person) writes to the database.
--
-- Error codes, for callers and tests:
--   23514 check_violation     a CHECK failed, or an entry is unbalanced / malformed (constraint name in message)
--   23001 restrict_violation  an UPDATE/DELETE/TRUNCATE on an immutable table (even by the owner)

-- ── CHECK constraints ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "tenancy"."merchants"
  ADD CONSTRAINT "merchants_name_not_blank" CHECK (length(btrim("name")) > 0);
-- merchants.status values are the P4 lifecycle decision; not constrained yet.

ALTER TABLE "ledger"."ledgers"
  ADD CONSTRAINT "ledgers_currency_ngn" CHECK ("currency" = 'NGN');  -- ADR-11: NGN only for now

ALTER TABLE "ledger"."accounts"
  ADD CONSTRAINT "accounts_type_valid" CHECK ("type" IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  ADD CONSTRAINT "accounts_code_not_blank" CHECK (length(btrim("code")) > 0),
  ADD CONSTRAINT "accounts_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "accounts_subject_complete" CHECK (("subject_type" IS NULL) = ("subject_id" IS NULL)),
  ADD CONSTRAINT "accounts_not_own_parent" CHECK ("parent_account_id" IS DISTINCT FROM "id");

ALTER TABLE "ledger"."journal_entries"
  ADD CONSTRAINT "journal_entries_entry_type_not_blank" CHECK (length(btrim("entry_type")) > 0),
  ADD CONSTRAINT "journal_entries_narrative_not_blank" CHECK (length(btrim("narrative")) > 0),
  ADD CONSTRAINT "journal_entries_idempotency_key_valid" CHECK (length(btrim("idempotency_key")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "journal_entries_not_self_reversal" CHECK ("reverses_entry_id" IS DISTINCT FROM "id");

ALTER TABLE "ledger"."journal_lines"
  ADD CONSTRAINT "journal_lines_side_valid" CHECK ("side" IN ('debit', 'credit')),
  ADD CONSTRAINT "journal_lines_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "journal_lines_currency_ngn" CHECK ("currency" = 'NGN');

ALTER TABLE "ledger"."balance_projection"
  ADD CONSTRAINT "balance_projection_version_non_negative" CHECK ("version" >= 0);

ALTER TABLE "audit"."audit_events"
  ADD CONSTRAINT "audit_events_action_not_blank" CHECK (length(btrim("action")) > 0),
  ADD CONSTRAINT "audit_events_outcome_valid" CHECK ("outcome" IN ('success', 'failure', 'denied')),
  ADD CONSTRAINT "audit_events_summary_is_object" CHECK (jsonb_typeof("summary") = 'object');

-- ── balanced entries (checked at COMMIT) ──────────────────────────────────────────────────────
-- Every journal entry must, by the end of its transaction, have >= 2 lines, equal debits and credits,
-- and only lines whose account belongs to the entry's ledger and whose currency is the ledger's.
-- SECURITY DEFINER (owned by the migrator, which is not subject to RLS on its own tables) so row-level
-- security can never hide rows from the check. search_path is pinned.
CREATE FUNCTION "ledger"."assert_entry_balanced"(p_entry_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ledger_id uuid;
  v_currency  char(3);
  v_lines     integer;
  v_debits    numeric;
  v_credits   numeric;
  v_foreign   integer;
BEGIN
  SELECT e.ledger_id, l.currency INTO v_ledger_id, v_currency
  FROM ledger.journal_entries e JOIN ledger.ledgers l ON l.id = e.ledger_id
  WHERE e.id = p_entry_id;

  IF NOT FOUND THEN
    RETURN; -- the entry itself was never committed (e.g. its insert failed); nothing to check
  END IF;

  SELECT count(*),
         coalesce(sum(jl.amount_minor) FILTER (WHERE jl.side = 'debit'), 0),
         coalesce(sum(jl.amount_minor) FILTER (WHERE jl.side = 'credit'), 0),
         count(*) FILTER (WHERE a.ledger_id IS DISTINCT FROM v_ledger_id OR jl.currency IS DISTINCT FROM v_currency)
    INTO v_lines, v_debits, v_credits, v_foreign
  FROM ledger.journal_lines jl
  LEFT JOIN ledger.accounts a ON a.id = jl.account_id
  WHERE jl.entry_id = p_entry_id;

  IF v_lines < 2 THEN
    RAISE EXCEPTION 'journal entry % has % line(s); at least 2 are required', p_entry_id, v_lines
      USING ERRCODE = 'check_violation', CONSTRAINT = 'journal_entry_min_two_lines';
  END IF;
  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'journal entry % is unbalanced: debits % <> credits %', p_entry_id, v_debits, v_credits
      USING ERRCODE = 'check_violation', CONSTRAINT = 'journal_entry_balanced';
  END IF;
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'journal entry % has % line(s) outside its ledger or currency', p_entry_id, v_foreign
      USING ERRCODE = 'check_violation', CONSTRAINT = 'journal_entry_single_ledger';
  END IF;
END
$fn$;

CREATE FUNCTION "ledger"."check_entry_balanced_trigger"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    PERFORM ledger.assert_entry_balanced(NEW.id);
  ELSE
    PERFORM ledger.assert_entry_balanced(NEW.entry_id);
  END IF;
  RETURN NULL;
END
$fn$;

-- Deferred to COMMIT so an entry and its lines can be inserted in any order within one transaction.
CREATE CONSTRAINT TRIGGER "journal_entries_balanced"
  AFTER INSERT ON "ledger"."journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger"."check_entry_balanced_trigger"();

CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
  AFTER INSERT ON "ledger"."journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger"."check_entry_balanced_trigger"();

-- ── immutability (applies to every role, including the owner) ─────────────────────────────────
-- The app role already lacks UPDATE/DELETE/TRUNCATE on these tables (privileges migration); these
-- triggers also stop the migrator/owner and any future grant mistake. Corrections are new entries.
-- (Customer anonymisation, BR-11.3, will need a narrow, audited path for audit summaries; that is
-- designed with the customers module, not by relaxing this.)
CREATE FUNCTION "util"."reject_modification"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION '%.% is append-only: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$fn$;

CREATE TRIGGER "journal_entries_immutable"
  BEFORE UPDATE OR DELETE ON "ledger"."journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "util"."reject_modification"();
CREATE TRIGGER "journal_entries_no_truncate"
  BEFORE TRUNCATE ON "ledger"."journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "util"."reject_modification"();

CREATE TRIGGER "journal_lines_immutable"
  BEFORE UPDATE OR DELETE ON "ledger"."journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "util"."reject_modification"();
CREATE TRIGGER "journal_lines_no_truncate"
  BEFORE TRUNCATE ON "ledger"."journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "util"."reject_modification"();

CREATE TRIGGER "audit_events_immutable"
  BEFORE UPDATE OR DELETE ON "audit"."audit_events"
  FOR EACH ROW EXECUTE FUNCTION "util"."reject_modification"();
CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON "audit"."audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "util"."reject_modification"();

-- Trigger functions are never called directly; nobody needs EXECUTE on them.
REVOKE ALL ON FUNCTION "ledger"."assert_entry_balanced"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "ledger"."check_entry_balanced_trigger"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "util"."reject_modification"() FROM PUBLIC;
