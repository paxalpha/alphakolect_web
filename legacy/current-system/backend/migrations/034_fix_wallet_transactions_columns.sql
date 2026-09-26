-- Normalize wallet_transactions columns and constraints

-- Step 1: Add missing columns (idempotent)
ALTER TABLE wallet_transactions
ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS merchant_id INTEGER,
ADD COLUMN IF NOT EXISTS type VARCHAR(20),
ADD COLUMN IF NOT EXISTS amount DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS reference VARCHAR(255),
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Pending',
ADD COLUMN IF NOT EXISTS date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS balance_before DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS balance_after DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS category VARCHAR(100),
ADD COLUMN IF NOT EXISTS related_id INTEGER,
ADD COLUMN IF NOT EXISTS related_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100),
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS processed_by INTEGER;

-- Step 2: Backfill from camelCase if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='wallet_transactions' AND column_name='merchantId') THEN
    EXECUTE 'UPDATE wallet_transactions SET merchant_id = "merchantId" WHERE merchant_id IS NULL';
  END IF;
END $$;

-- Step 3: Indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_merchant_id ON wallet_transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_date ON wallet_transactions(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_reference ON wallet_transactions(reference);

-- Step 4: Foreign keys (best-effort)
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE wallet_transactions ADD CONSTRAINT fk_wallet_transactions_merchant_id FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER TABLE wallet_transactions ADD CONSTRAINT fk_wallet_transactions_processed_by FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL';
  EXCEPTION WHEN others THEN NULL; END;
END $$;

-- Step 5: Drop camelCase columns if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='wallet_transactions' AND column_name='merchantId') THEN
    EXECUTE 'ALTER TABLE wallet_transactions DROP COLUMN "merchantId"';
  END IF;
END $$;


