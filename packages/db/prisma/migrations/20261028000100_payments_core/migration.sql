-- P9: payments — the tables, the "money received" account and its postings
-- (docs/architecture/P9_IMPLEMENTATION_PLAN.md §3; the owner's answers of 2026-10-26, docs/business/P9_OWNER_PAYMENTS.md;
-- TransactPay's documented answers, docs/business/P9_TRANSACTPAY_QUESTIONS.md).
--
-- - payments.live_wallets (BR-2.3, 4.1–4.3; Q6, Q7): a Live wallet — a business's, the platform's, or a customer's
--   (built behind a switch that is off until OPEN-12) — and its provider account. Requested as a row 'provisioning' and
--   created by the worker under a fixed alias, so a retry after a timeout finds the account by its alias instead of
--   creating a second one (TransactPay B1: creation is not documented as idempotent).
-- - payments.provider_events (TA-8): each notification exactly as received — never trusted; the worker confirms it by
--   fetching the transaction from the provider.
-- - payments.provider_transactions: each provider transaction acted on, once (unique on provider and its id), with
--   what the provider said about it and what we did: credited, held (a customer's wallet), unmatched (Q4), ignored (not
--   successful), or under review (a reversal reported after it was credited).
-- - payments.receipts (Q1): money credited to a business's wallet, recorded "to be classified" until the business says
--   what it was for.
-- - payments.payment_orders (TA-8): money leaving a wallet, with an 'unknown' state a timeout leaves it in. In P9 they are
--   machinery only (Q2): created by tests, first used by billing (P10).
-- - payments.reconciliation_findings (Q5): a difference between the books and the provider, kept for the platform team.
-- - Account 2290 "Money received — to classify" in the business and platform charts, with the postings
--   `wallet.received` and `platform.wallet_received` (Dr 1100 / Cr 2290).
-- Every tenant table has RLS and an app policy; the app holds no privilege (B1). Forward-only; earlier migrations
-- untouched.

GRANT USAGE ON SCHEMA payments TO alphakolect_app, alphakolect_worker, alphakolect_readonly;

-- ── the chart: money received, to be classified (Q1) ──
INSERT INTO ledger.chart_template (ledger_kind, code, name, type, non_negative, subject_type, purpose) VALUES
  ('merchant', '2290', 'Money received — to classify', 'liability', true, NULL,
   'money received in the business''s Live wallet, until the business records what it was for (P9, Q1)'),
  ('platform', '2290', 'Money received — to classify', 'liability', true, NULL,
   'money received in the Platform Live wallet, until it is matched (P9)');
-- The ledgers that exist already get the new account and its projection, as a new ledger does at opening.
WITH added AS (
  INSERT INTO ledger.accounts (merchant_id, ledger_id, code, name, type, is_system, non_negative)
  SELECT l.merchant_id, l.id, t.code, t.name, t.type, true, t.non_negative
    FROM ledger.ledgers l JOIN ledger.chart_template t ON t.ledger_kind = l.owner_kind AND t.code = '2290'
  RETURNING id, merchant_id)
INSERT INTO ledger.balance_projection (account_id, merchant_id) SELECT id, merchant_id FROM added;

INSERT INTO ledger.posting_templates (code, ledger_kind, description, lines) VALUES
  ('wallet.received', 'merchant', 'Money received in the business''s Live wallet, to be classified (P9, Q1)',
   '[{"side":"debit","code":"1100"},{"side":"credit","code":"2290"}]'),
  ('platform.wallet_received', 'platform', 'Money received in the Platform Live wallet, to be matched (P9)',
   '[{"side":"debit","code":"1100"},{"side":"credit","code":"2290"}]');

CREATE TABLE payments.live_wallets (
  id              uuid NOT NULL DEFAULT util.uuid_v7(),
  owner_kind      text NOT NULL,
  merchant_id     uuid,
  customer_id     uuid,
  provider        text NOT NULL,
  alias           text NOT NULL,
  status          text NOT NULL DEFAULT 'provisioning',
  provider_ref    text,
  account_number  text,
  account_name    text,
  bank_name       text,
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_until     timestamptz(6),
  lease_token     uuid,
  last_error      text,
  requested_by    uuid,
  created_at      timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at    timestamptz(6),
  CONSTRAINT live_wallets_pkey PRIMARY KEY (id),
  CONSTRAINT live_wallets_merchant_id_id_key UNIQUE (merchant_id, id),
  -- The alias is ours, fixed per owner: the worker finds the account by it after a timeout.
  CONSTRAINT live_wallets_alias_key UNIQUE (provider, alias),
  CONSTRAINT live_wallets_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT live_wallets_customer_fkey FOREIGN KEY (merchant_id, customer_id)
    REFERENCES customers.customers (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT live_wallets_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES identity.identities (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT live_wallets_owner_valid CHECK (
    (owner_kind = 'merchant' AND merchant_id IS NOT NULL AND customer_id IS NULL)
    OR (owner_kind = 'customer' AND merchant_id IS NOT NULL AND customer_id IS NOT NULL)
    OR (owner_kind = 'platform' AND merchant_id IS NULL AND customer_id IS NULL)),
  CONSTRAINT live_wallets_provider_valid CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT live_wallets_alias_valid CHECK (alias ~ '^[A-Za-z0-9-]{4,64}$'),
  CONSTRAINT live_wallets_status_valid CHECK (status IN ('provisioning', 'active', 'failed', 'closed')),
  CONSTRAINT live_wallets_active_consistent CHECK (
    (status = 'active') = (activated_at IS NOT NULL AND account_number IS NOT NULL AND provider_ref IS NOT NULL)
    OR status = 'closed'),
  CONSTRAINT live_wallets_attempts_valid CHECK (attempts >= 0)
);
-- One wallet per business, per customer, and one for the platform.
CREATE UNIQUE INDEX live_wallets_one_per_merchant ON payments.live_wallets (merchant_id) WHERE owner_kind = 'merchant';
CREATE UNIQUE INDEX live_wallets_one_per_customer ON payments.live_wallets (customer_id) WHERE owner_kind = 'customer';
CREATE UNIQUE INDEX live_wallets_one_platform ON payments.live_wallets (owner_kind) WHERE owner_kind = 'platform';
-- An account number names one wallet of a provider: money arriving is matched by it.
CREATE UNIQUE INDEX live_wallets_account_key ON payments.live_wallets (provider, account_number)
  WHERE account_number IS NOT NULL;
CREATE INDEX live_wallets_due_idx ON payments.live_wallets (next_attempt_at) WHERE status = 'provisioning';
CREATE INDEX live_wallets_created_idx ON payments.live_wallets (created_at, id);

CREATE TABLE payments.provider_events (
  id            uuid NOT NULL DEFAULT util.uuid_v7(),
  provider      text NOT NULL,
  received_at   timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  headers       jsonb NOT NULL,
  body          text NOT NULL,
  -- What the event says the transaction is: a lead only, confirmed with the provider before anything is done.
  reference     text,
  status        text NOT NULL DEFAULT 'received',
  attempts      integer NOT NULL DEFAULT 0,
  next_check_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_until   timestamptz(6),
  lease_token   uuid,
  outcome       text,
  processed_at  timestamptz(6),
  CONSTRAINT provider_events_pkey PRIMARY KEY (id),
  CONSTRAINT provider_events_provider_valid CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT provider_events_body_size CHECK (length(body) <= 65536),
  CONSTRAINT provider_events_headers_object CHECK (jsonb_typeof(headers) = 'object'),
  CONSTRAINT provider_events_reference_valid CHECK (reference IS NULL OR reference ~ '^[\x21-\x7e]{1,128}$'),
  CONSTRAINT provider_events_status_valid CHECK (status IN ('received', 'pending', 'done', 'rejected')),
  CONSTRAINT provider_events_done_consistent CHECK ((status IN ('done', 'rejected')) = (processed_at IS NOT NULL))
);
CREATE INDEX provider_events_due_idx ON payments.provider_events (next_check_at) WHERE status IN ('received', 'pending');

-- No business column: a transaction is the provider's, and may belong to nobody yet (Q4). Its business is its wallet's.
CREATE TABLE payments.provider_transactions (
  id                  uuid NOT NULL DEFAULT util.uuid_v7(),
  provider            text NOT NULL,
  provider_tx_id      text NOT NULL,
  wallet_id           uuid,
  account_number      text,
  amount_minor        bigint NOT NULL,
  currency            text NOT NULL,
  provider_status     text NOT NULL,
  matched             text NOT NULL,
  occurred_at         timestamptz(6),
  confirmed_at        timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  entry_id            uuid,
  resolution          text,
  resolution_note     text,
  resolved_by         uuid,
  resolved_at         timestamptz(6),
  CONSTRAINT provider_transactions_pkey PRIMARY KEY (id),
  -- Each provider transaction is acted on once (TA-8; the exit's replayed event).
  CONSTRAINT provider_transactions_once UNIQUE (provider, provider_tx_id),
  CONSTRAINT provider_transactions_wallet_fkey FOREIGN KEY (wallet_id) REFERENCES payments.live_wallets (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT provider_transactions_entry_fkey FOREIGN KEY (entry_id) REFERENCES ledger.journal_entries (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT provider_transactions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES identity.identities (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT provider_transactions_tx_valid CHECK (provider_tx_id ~ '^[\x21-\x7e]{1,128}$'),
  CONSTRAINT provider_transactions_amount_valid CHECK (amount_minor BETWEEN 1 AND 10000000000000),
  CONSTRAINT provider_transactions_currency_valid CHECK (currency = 'NGN'),
  CONSTRAINT provider_transactions_status_valid CHECK (provider_status IN ('successful', 'failed', 'reversed')),
  CONSTRAINT provider_transactions_matched_valid CHECK (matched IN ('credited', 'held', 'unmatched', 'ignored', 'review', 'resolved')),
  -- A credit has its entry; an entry stays with its transaction under review or resolved.
  CONSTRAINT provider_transactions_credited_consistent CHECK (
    (matched <> 'credited' OR entry_id IS NOT NULL) AND (entry_id IS NULL OR matched IN ('credited', 'review', 'resolved'))),
  CONSTRAINT provider_transactions_resolution_valid CHECK (
    (matched = 'resolved') = (resolved_at IS NOT NULL)
    AND (resolution IS NULL OR resolution IN ('credited', 'returned', 'dismissed'))
    AND (matched = 'resolved') = (resolution IS NOT NULL)),
  CONSTRAINT provider_transactions_note_valid CHECK (resolution_note IS NULL OR char_length(btrim(resolution_note)) BETWEEN 1 AND 500)
);
CREATE INDEX provider_transactions_open_idx ON payments.provider_transactions (confirmed_at, id)
  WHERE matched IN ('unmatched', 'review');

CREATE TABLE payments.receipts (
  id                     uuid NOT NULL DEFAULT util.uuid_v7(),
  merchant_id            uuid NOT NULL,
  wallet_id              uuid NOT NULL,
  transaction_id         uuid NOT NULL,
  amount_minor           bigint NOT NULL,
  received_entry_id      uuid NOT NULL,
  classified_account_id  uuid,
  classified_entry_id    uuid,
  classified_note        text,
  classified_by          uuid,
  classified_at          timestamptz(6),
  created_at             timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT receipts_pkey PRIMARY KEY (id),
  CONSTRAINT receipts_merchant_id_id_key UNIQUE (merchant_id, id),
  CONSTRAINT receipts_transaction_key UNIQUE (transaction_id),
  CONSTRAINT receipts_merchant_fkey FOREIGN KEY (merchant_id) REFERENCES tenancy.merchants (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT receipts_wallet_fkey FOREIGN KEY (merchant_id, wallet_id)
    REFERENCES payments.live_wallets (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT receipts_transaction_fkey FOREIGN KEY (transaction_id) REFERENCES payments.provider_transactions (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT receipts_received_entry_fkey FOREIGN KEY (merchant_id, received_entry_id)
    REFERENCES ledger.journal_entries (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT receipts_classified_entry_fkey FOREIGN KEY (merchant_id, classified_entry_id)
    REFERENCES ledger.journal_entries (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT receipts_classified_by_fkey FOREIGN KEY (merchant_id, classified_by)
    REFERENCES tenancy.merchant_memberships (merchant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT receipts_amount_valid CHECK (amount_minor BETWEEN 1 AND 10000000000000),
  CONSTRAINT receipts_classified_consistent CHECK (
    (classified_at IS NULL) = (classified_entry_id IS NULL)
    AND (classified_at IS NULL) = (classified_account_id IS NULL)
    AND (classified_at IS NULL) = (classified_by IS NULL)),
  CONSTRAINT receipts_note_valid CHECK (classified_note IS NULL OR char_length(btrim(classified_note)) BETWEEN 1 AND 300)
);
CREATE INDEX receipts_merchant_created_idx ON payments.receipts (merchant_id, created_at, id);

-- No business column: an order can cross from a business to the platform (the subscription, P10). Its business is its
-- source wallet's.
CREATE TABLE payments.payment_orders (
  id                 uuid NOT NULL DEFAULT util.uuid_v7(),
  from_wallet_id     uuid NOT NULL,
  to_wallet_id       uuid,
  to_bank            jsonb,
  amount_minor       bigint NOT NULL,
  reference          text NOT NULL,
  purpose            text NOT NULL,
  ledger_id          uuid NOT NULL,
  posting_template   text NOT NULL,
  posting_subjects   jsonb NOT NULL DEFAULT '{}',
  state              text NOT NULL DEFAULT 'created',
  provider_ref       text,
  provider_tx_id     text,
  attempts           integer NOT NULL DEFAULT 0,
  next_check_at      timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_until        timestamptz(6),
  lease_token        uuid,
  last_error         text,
  entry_id           uuid,
  created_at         timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at        timestamptz(6),
  CONSTRAINT payment_orders_pkey PRIMARY KEY (id),
  -- Our reference: the provider's client reference, one per order; the lookup after a timeout uses it (TransactPay D3).
  CONSTRAINT payment_orders_reference_key UNIQUE (reference),
  CONSTRAINT payment_orders_from_fkey FOREIGN KEY (from_wallet_id) REFERENCES payments.live_wallets (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT payment_orders_to_fkey FOREIGN KEY (to_wallet_id) REFERENCES payments.live_wallets (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT payment_orders_ledger_fkey FOREIGN KEY (ledger_id) REFERENCES ledger.ledgers (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT payment_orders_entry_fkey FOREIGN KEY (entry_id) REFERENCES ledger.journal_entries (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT payment_orders_destination CHECK ((to_wallet_id IS NULL) <> (to_bank IS NULL)),
  CONSTRAINT payment_orders_bank_valid CHECK (to_bank IS NULL OR (jsonb_typeof(to_bank) = 'object'
    AND coalesce(to_bank ->> 'accountNumber', '') ~ '^[0-9]{10}$' AND coalesce(to_bank ->> 'bankCode', '') ~ '^[0-9]{3,6}$')),
  CONSTRAINT payment_orders_amount_valid CHECK (amount_minor BETWEEN 1 AND 10000000000000),
  CONSTRAINT payment_orders_reference_valid CHECK (reference ~ '^[A-Za-z0-9-]{8,64}$'),
  CONSTRAINT payment_orders_purpose_valid CHECK (purpose ~ '^[a-z][a-z_]{1,31}$'),
  CONSTRAINT payment_orders_subjects_object CHECK (jsonb_typeof(posting_subjects) = 'object'),
  CONSTRAINT payment_orders_state_valid CHECK (state IN ('created', 'submitted', 'unknown', 'succeeded', 'failed')),
  CONSTRAINT payment_orders_finished_consistent CHECK ((state IN ('succeeded', 'failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT payment_orders_posted_consistent CHECK ((state = 'succeeded') = (entry_id IS NOT NULL))
);
CREATE INDEX payment_orders_due_idx ON payments.payment_orders (next_check_at)
  WHERE state IN ('created', 'submitted', 'unknown');

CREATE TABLE payments.reconciliation_findings (
  id                     uuid NOT NULL DEFAULT util.uuid_v7(),
  scope                  text NOT NULL,
  wallet_id              uuid,
  provider_balance_minor bigint NOT NULL,
  books_balance_minor    bigint NOT NULL,
  status                 text NOT NULL DEFAULT 'open',
  found_at               timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at           timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolution_note        text,
  resolved_by            uuid,
  resolved_at            timestamptz(6),
  CONSTRAINT reconciliation_findings_pkey PRIMARY KEY (id),
  CONSTRAINT reconciliation_findings_wallet_fkey FOREIGN KEY (wallet_id) REFERENCES payments.live_wallets (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT reconciliation_findings_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES identity.identities (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT reconciliation_findings_scope_valid CHECK (
    (scope = 'wallet' AND wallet_id IS NOT NULL) OR (scope IN ('pooled', 'event') AND wallet_id IS NULL)),
  CONSTRAINT reconciliation_findings_differs CHECK (provider_balance_minor <> books_balance_minor),
  CONSTRAINT reconciliation_findings_status_valid CHECK (status IN ('open', 'resolved')),
  CONSTRAINT reconciliation_findings_resolved_consistent CHECK (
    (status = 'resolved') = (resolved_at IS NOT NULL) AND (status = 'resolved') = (resolution_note IS NOT NULL)),
  CONSTRAINT reconciliation_findings_note_valid CHECK (resolution_note IS NULL OR char_length(btrim(resolution_note)) BETWEEN 1 AND 500)
);
-- One open finding per wallet, and one for the pooled balance: a difference seen again updates it.
CREATE UNIQUE INDEX reconciliation_findings_one_open ON payments.reconciliation_findings (scope, coalesce(wallet_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'open';
CREATE INDEX reconciliation_findings_found_idx ON payments.reconciliation_findings (found_at, id);

-- Row-level security on the tenant tables; the app holds no privilege on any payments table (B1).
ALTER TABLE payments.live_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY live_wallets_app_own_tenant ON payments.live_wallets TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY receipts_app_own_tenant ON payments.receipts TO alphakolect_app
  USING (merchant_id = util.current_merchant_id()) WITH CHECK (merchant_id = util.current_merchant_id());
CREATE POLICY live_wallets_readonly_all ON payments.live_wallets FOR SELECT TO alphakolect_readonly USING (true);
CREATE POLICY receipts_readonly_all ON payments.receipts FOR SELECT TO alphakolect_readonly USING (true);
REVOKE ALL ON payments.live_wallets, payments.provider_events, payments.provider_transactions, payments.receipts,
  payments.payment_orders, payments.reconciliation_findings FROM alphakolect_app;
-- Reporting reads the money records; never the raw provider events (they may carry what a provider sends).
GRANT SELECT ON payments.live_wallets, payments.provider_transactions, payments.receipts, payments.payment_orders,
  payments.reconciliation_findings TO alphakolect_readonly;
