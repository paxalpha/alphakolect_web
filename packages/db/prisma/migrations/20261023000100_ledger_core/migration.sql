-- P6: the ledger's core (docs/architecture/P6_IMPLEMENTATION_PLAN.md §2, §3.1, §3.2, §4; the owner's answers of
-- 2026-10-23 in docs/business/P6_OWNER_ACCOUNTS_AND_MAPPINGS.md).
--
-- - TA-1: a ledger belongs to a business or to the platform (owner_kind); a business's ledger names it, the platform's
--   names none, and there is one platform ledger. Rows of the platform ledger carry no business: under row-level
--   security the app never sees them; they are reached only through definer functions.
-- - TA-5: an account is unique by (ledger, code, subject), a missing subject counting as equal (NULLS NOT DISTINCT).
-- - TA-4: an entry is reversed at most once (a partial unique index); an entry's idempotency key is unique per ledger.
-- - Accounts gain a status (active / archived) and a non-negative rule: a posting may not take such an account below
--   zero (BR-7.4 rests on it).
-- - The chart (ledger.chart_template) and the posting templates (ledger.posting_templates) are data: the owner chose
--   the short AlphaKolect chart (Q1), the corrections to the "Map" sheet (Q2), unearned loan interest (Q3), a clearing
--   account kept for transfers (Q5) and a Directors' current account (Q6).
-- - A business's ledger and its system accounts are opened at signup (identity.signup_merchant_owner) and, here, for
--   every existing business; the platform ledger here.
-- - TA-3: the app loses every write on the ledger tables, and its direct reads: the ledger is reached only through
--   definer functions (the posting function, P6 migration 2; the reads, migration 3), as B1 did for tenancy.
-- Forward-only; earlier migrations untouched.

-- ── TA-1: who owns a ledger ──
ALTER TABLE ledger.ledgers ADD COLUMN owner_kind text NOT NULL DEFAULT 'merchant';
ALTER TABLE ledger.ledgers ALTER COLUMN merchant_id DROP NOT NULL;
ALTER TABLE ledger.ledgers
  ADD CONSTRAINT ledgers_owner_kind_valid CHECK (owner_kind IN ('merchant', 'platform')),
  ADD CONSTRAINT ledgers_owner_has_business CHECK ((owner_kind = 'merchant') = (merchant_id IS NOT NULL));
CREATE UNIQUE INDEX ledgers_one_platform ON ledger.ledgers (owner_kind) WHERE owner_kind = 'platform';
ALTER TABLE ledger.accounts ALTER COLUMN merchant_id DROP NOT NULL;
ALTER TABLE ledger.journal_entries ALTER COLUMN merchant_id DROP NOT NULL;
ALTER TABLE ledger.journal_lines ALTER COLUMN merchant_id DROP NOT NULL;
ALTER TABLE ledger.balance_projection ALTER COLUMN merchant_id DROP NOT NULL;

-- ── accounts: status, the non-negative rule, a code's shape, TA-5 ──
ALTER TABLE ledger.accounts
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN non_negative boolean NOT NULL DEFAULT false,
  ADD COLUMN archived_at timestamptz(6);
ALTER TABLE ledger.accounts
  ADD CONSTRAINT accounts_status_valid CHECK (status IN ('active', 'archived')),
  ADD CONSTRAINT accounts_archived_consistent CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  ADD CONSTRAINT accounts_code_shape CHECK (code ~ '^[0-9]{4,6}$'),
  ADD CONSTRAINT accounts_subject_type_valid CHECK (subject_type IS NULL OR subject_type IN ('customer', 'agent'));
DROP INDEX ledger.accounts_ledger_id_code_idx;
CREATE UNIQUE INDEX accounts_ledger_id_code_subject_key
  ON ledger.accounts (ledger_id, code, subject_type, subject_id) NULLS NOT DISTINCT;

-- ── journal entries: TA-4, and an idempotency key per ledger ──
CREATE UNIQUE INDEX journal_entries_reversed_once ON ledger.journal_entries (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;
CREATE UNIQUE INDEX journal_entries_ledger_id_idempotency_key_key ON ledger.journal_entries (ledger_id, idempotency_key);

-- ── the chart, as data (owner Q1) ──
CREATE TABLE ledger.chart_template (
  ledger_kind  text NOT NULL CHECK (ledger_kind IN ('merchant', 'platform')),
  code         text NOT NULL CHECK (code ~ '^[0-9]{4,6}$'),
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  type         text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  non_negative boolean NOT NULL,
  -- A control account whose balance lives in one sub-account per customer or per agent; postings go to those.
  subject_type text CHECK (subject_type IN ('customer', 'agent')),
  purpose      text NOT NULL,
  PRIMARY KEY (ledger_kind, code)
);
INSERT INTO ledger.chart_template (ledger_kind, code, name, type, non_negative, subject_type, purpose) VALUES
  ('merchant', '1000', 'Cash at bank', 'asset', true, NULL, 'the business''s bank account'),
  ('merchant', '1100', 'Business wallet', 'asset', true, NULL, 'the business''s AlphaKolect wallet at the payment provider'),
  ('merchant', '1200', 'Cash at office', 'asset', true, NULL, 'cash the business holds after agents hand it in'),
  ('merchant', '1210', 'Cash with agents', 'asset', true, 'agent', 'cash an agent collected and has not handed in'),
  ('merchant', '1300', 'Customer loans', 'asset', true, 'customer', 'what a customer still owes on loans'),
  ('merchant', '2100', 'Customer savings', 'liability', true, 'customer', 'a customer''s collection savings'),
  ('merchant', '2110', 'Customer target savings', 'liability', true, 'customer', 'a customer''s target savings'),
  ('merchant', '2120', 'Customer investments', 'liability', true, 'customer', 'a customer''s fixed deposits and investments'),
  ('merchant', '2190', 'Collections awaiting confirmation', 'liability', true, NULL, 'cash recorded by agents, until the business confirms it'),
  ('merchant', '2200', 'Transfers in progress', 'liability', true, NULL, 'money being sent on a customer''s behalf (kept ready, owner Q5)'),
  ('merchant', '2300', 'Unearned loan interest', 'liability', true, NULL, 'interest charged on loans and not yet earned (owner Q3)'),
  ('merchant', '2400', 'Directors'' current account', 'liability', true, NULL, 'money directors put into the business (owner Q6)'),
  ('merchant', '3000', 'Share capital', 'equity', false, NULL, 'the owners'' capital'),
  ('merchant', '3100', 'Retained earnings', 'equity', false, NULL, 'profit kept in the business'),
  ('merchant', '4100', 'Collection fees — first contribution', 'revenue', false, NULL, 'the first contribution of a savings cycle'),
  ('merchant', '4110', 'Collection commission', 'revenue', false, NULL, 'the percentage taken from collections'),
  ('merchant', '4200', 'Loan interest income', 'revenue', false, NULL, 'interest earned on loans'),
  ('merchant', '4300', 'Loan application charges', 'revenue', false, NULL, 'charges for loan applications'),
  ('merchant', '4400', 'General charges', 'revenue', false, NULL, 'SMS, card and other charges'),
  ('merchant', '4500', 'Target savings charges', 'revenue', false, NULL, 'charges on target savings'),
  ('merchant', '5100', 'Platform subscription', 'expense', false, NULL, 'the AlphaKolect subscription'),
  ('merchant', '5200', 'Interest on target savings', 'expense', false, NULL, 'interest paid to customers on target savings'),
  ('merchant', '5300', 'Interest on investments', 'expense', false, NULL, 'interest paid to customers on investments'),
  ('platform', '1000', 'Cash at bank', 'asset', true, NULL, 'AlphaKolect''s bank account'),
  ('platform', '1100', 'Platform wallet', 'asset', true, NULL, 'AlphaKolect''s wallet at the payment provider'),
  ('platform', '3000', 'Share capital', 'equity', false, NULL, 'the owners'' capital'),
  ('platform', '3100', 'Retained earnings', 'equity', false, NULL, 'profit kept in the business'),
  ('platform', '4100', 'Subscription income', 'revenue', false, NULL, 'businesses'' subscriptions'),
  ('platform', '5100', 'Provider charges', 'expense', false, NULL, 'the payment provider''s charges');

-- ── the posting templates: the transaction mappings (plan §4; owner Q2, Q3, Q5, Q6) ──
-- Each line names a chart code, its side, and — for a control account — the subject whose sub-account it posts to.
-- Every line takes the posting's one amount.
CREATE TABLE ledger.posting_templates (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  ledger_kind text NOT NULL CHECK (ledger_kind IN ('merchant', 'platform')),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  lines       jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) >= 2),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired'))
);
INSERT INTO ledger.posting_templates (code, ledger_kind, description, lines) VALUES
  ('collection.cash_recorded', 'merchant', 'An agent records a cash collection, before the business confirms it',
   '[{"side":"debit","code":"1210","subject":"agent"},{"side":"credit","code":"2190"}]'),
  ('collection.cash_confirmed', 'merchant', 'The business confirms an agent''s cash collection: the cash is handed in and the customer credited',
   '[{"side":"debit","code":"1200"},{"side":"credit","code":"1210","subject":"agent"},{"side":"debit","code":"2190"},{"side":"credit","code":"2100","subject":"customer"}]'),
  ('collection.live', 'merchant', 'A collection paid from the customer''s wallet, confirmed by the provider',
   '[{"side":"debit","code":"1100"},{"side":"credit","code":"2100","subject":"customer"}]'),
  ('fee.first_contribution', 'merchant', 'The first contribution of a cycle taken as the fee',
   '[{"side":"debit","code":"2100","subject":"customer"},{"side":"credit","code":"4100"}]'),
  ('fee.percentage', 'merchant', 'The percentage commission on a collection',
   '[{"side":"debit","code":"2100","subject":"customer"},{"side":"credit","code":"4110"}]'),
  ('charge.general', 'merchant', 'A general charge (SMS, card) taken from the customer''s savings',
   '[{"side":"debit","code":"2100","subject":"customer"},{"side":"credit","code":"4400"}]'),
  ('charge.target_savings', 'merchant', 'A charge taken from the customer''s target savings',
   '[{"side":"debit","code":"2110","subject":"customer"},{"side":"credit","code":"4500"}]'),
  ('charge.loan_application', 'merchant', 'A loan application charge taken from the customer''s savings',
   '[{"side":"debit","code":"2100","subject":"customer"},{"side":"credit","code":"4300"}]'),
  ('withdrawal.savings_cash', 'merchant', 'A cash withdrawal from the customer''s savings',
   '[{"side":"debit","code":"2100","subject":"customer"},{"side":"credit","code":"1200"}]'),
  ('withdrawal.target_cash', 'merchant', 'A cash withdrawal from the customer''s target savings',
   '[{"side":"debit","code":"2110","subject":"customer"},{"side":"credit","code":"1200"}]'),
  ('withdrawal.savings_to_loan', 'merchant', 'Savings moved to repay the customer''s loan',
   '[{"side":"debit","code":"2100","subject":"customer"},{"side":"credit","code":"1300","subject":"customer"}]'),
  ('withdrawal.target_to_loan', 'merchant', 'Target savings moved to repay the customer''s loan',
   '[{"side":"debit","code":"2110","subject":"customer"},{"side":"credit","code":"1300","subject":"customer"}]'),
  ('savings.to_target', 'merchant', 'Savings moved to the customer''s target savings',
   '[{"side":"debit","code":"2100","subject":"customer"},{"side":"credit","code":"2110","subject":"customer"}]'),
  ('loan.disbursed_cash', 'merchant', 'A loan paid out in cash',
   '[{"side":"debit","code":"1300","subject":"customer"},{"side":"credit","code":"1200"}]'),
  ('loan.disbursed_wallet', 'merchant', 'A loan paid out from the business wallet',
   '[{"side":"debit","code":"1300","subject":"customer"},{"side":"credit","code":"1100"}]'),
  ('loan.interest_charged', 'merchant', 'A loan''s interest, owed by the customer and not yet earned (owner Q3)',
   '[{"side":"debit","code":"1300","subject":"customer"},{"side":"credit","code":"2300"}]'),
  ('loan.interest_earned', 'merchant', 'Loan interest earned as the customer repays (owner Q3)',
   '[{"side":"debit","code":"2300"},{"side":"credit","code":"4200"}]'),
  ('loan.repaid_cash', 'merchant', 'A loan repaid in cash',
   '[{"side":"debit","code":"1200"},{"side":"credit","code":"1300","subject":"customer"}]'),
  ('loan.repaid_wallet', 'merchant', 'A loan repaid from the customer''s wallet, confirmed by the provider',
   '[{"side":"debit","code":"1100"},{"side":"credit","code":"1300","subject":"customer"}]'),
  ('investment.created', 'merchant', 'Savings placed in an investment',
   '[{"side":"debit","code":"2100","subject":"customer"},{"side":"credit","code":"2120","subject":"customer"}]'),
  ('investment.interest', 'merchant', 'Interest paid on a customer''s investment',
   '[{"side":"debit","code":"5300"},{"side":"credit","code":"2120","subject":"customer"}]'),
  ('investment.withdrawn', 'merchant', 'An investment returned to the customer''s savings',
   '[{"side":"debit","code":"2120","subject":"customer"},{"side":"credit","code":"2100","subject":"customer"}]'),
  ('target_savings.interest', 'merchant', 'Interest paid on a customer''s target savings',
   '[{"side":"debit","code":"5200"},{"side":"credit","code":"2110","subject":"customer"}]'),
  ('transfer.sent', 'merchant', 'Money a customer sends, held until paid out (kept ready, owner Q5)',
   '[{"side":"debit","code":"2100","subject":"customer"},{"side":"credit","code":"2200"}]'),
  ('transfer.paid', 'merchant', 'A transfer paid out (kept ready, owner Q5)',
   '[{"side":"debit","code":"2200"},{"side":"credit","code":"1000"}]'),
  ('subscription.paid', 'merchant', 'The AlphaKolect subscription paid from the business wallet',
   '[{"side":"debit","code":"5100"},{"side":"credit","code":"1100"}]'),
  ('directors.funding', 'merchant', 'Money the directors put into the business, owed back to them (owner Q6)',
   '[{"side":"debit","code":"1000"},{"side":"credit","code":"2400"}]'),
  ('wallet.loaded', 'merchant', 'The business wallet loaded from the bank',
   '[{"side":"debit","code":"1100"},{"side":"credit","code":"1000"}]'),
  ('platform.subscription_received', 'platform', 'A business''s subscription received into the platform wallet',
   '[{"side":"debit","code":"1100"},{"side":"credit","code":"4100"}]');

-- Every template names chart codes of its own kind of ledger.
DO $check$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(t.code || ':' || (l->>'code'), ', ') INTO v_bad
    FROM ledger.posting_templates t CROSS JOIN LATERAL jsonb_array_elements(t.lines) l
   WHERE NOT EXISTS (SELECT 1 FROM ledger.chart_template c WHERE c.ledger_kind = t.ledger_kind AND c.code = l->>'code')
      OR (l->>'side') NOT IN ('debit', 'credit')
      OR (l->>'subject') IS DISTINCT FROM (SELECT c.subject_type FROM ledger.chart_template c
                                              WHERE c.ledger_kind = t.ledger_kind AND c.code = l->>'code');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'posting templates naming an unknown or mis-subjected account: %', v_bad;
  END IF;
END
$check$;

-- ── opening a ledger: its system accounts and their projections, from the chart ──
CREATE FUNCTION ledger.open_ledger(p_owner_kind text, p_merchant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_ledger uuid;
BEGIN
  INSERT INTO ledger.ledgers (merchant_id, owner_kind) VALUES (p_merchant_id, p_owner_kind)
    ON CONFLICT DO NOTHING RETURNING id INTO v_ledger;
  IF v_ledger IS NULL THEN
    -- Already open (with its accounts).
    SELECT l.id INTO v_ledger FROM ledger.ledgers l
     WHERE l.owner_kind = p_owner_kind AND l.merchant_id IS NOT DISTINCT FROM p_merchant_id;
    RETURN v_ledger;
  END IF;
  INSERT INTO ledger.accounts (merchant_id, ledger_id, code, name, type, is_system, non_negative)
  SELECT p_merchant_id, v_ledger, t.code, t.name, t.type, true, t.non_negative
    FROM ledger.chart_template t WHERE t.ledger_kind = p_owner_kind ORDER BY t.code;
  INSERT INTO ledger.balance_projection (account_id, merchant_id)
  SELECT a.id, a.merchant_id FROM ledger.accounts a WHERE a.ledger_id = v_ledger ORDER BY a.id;
  RETURN v_ledger;
END
$function$;
REVOKE ALL ON FUNCTION ledger.open_ledger(text, uuid) FROM PUBLIC;

-- The platform ledger, and every existing business's.
SELECT ledger.open_ledger('platform', NULL);
SELECT ledger.open_ledger('merchant', m.id) FROM tenancy.merchants m ORDER BY m.id;

-- A new business's ledger opens with it: signup, as before, then the ledger.
CREATE OR REPLACE FUNCTION "identity"."signup_merchant_owner"(p_email text, p_password_hash text, p_merchant_name text)
RETURNS TABLE (created boolean, identity_id uuid, merchant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_email text := lower(btrim(p_email));
  v_identity uuid;
  v_merchant uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM identity.identities i WHERE i.email = v_email) THEN
    -- Not an error: the API answers exactly as for a new signup (anti-enumeration, D12).
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO identity.identities (email, password_hash) VALUES (v_email, p_password_hash)
      RETURNING id INTO v_identity;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent signup won the race for this email.
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid;
    RETURN;
  END;

  INSERT INTO tenancy.merchants (name, status) VALUES (p_merchant_name, 'pending_verification')
    RETURNING id INTO v_merchant;
  INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES (v_merchant, v_identity, 'owner');
  -- P6: the business's books, with their system accounts.
  PERFORM ledger.open_ledger('merchant', v_merchant);

  RETURN QUERY SELECT true, v_identity, v_merchant;
END
$fn$;

-- ── TA-3: the ledger only through definer functions ──
REVOKE ALL ON ledger.ledgers, ledger.accounts, ledger.journal_entries, ledger.journal_lines, ledger.balance_projection
  FROM alphakolect_app;
GRANT SELECT ON ledger.chart_template, ledger.posting_templates TO alphakolect_readonly;
