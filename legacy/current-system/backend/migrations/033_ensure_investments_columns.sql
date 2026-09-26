-- Ensure investments table columns match model expectations and snake_case naming

-- Step 1: Add missing snake_case columns (idempotent)
ALTER TABLE investments
ADD COLUMN IF NOT EXISTS customer_id INTEGER,
ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS account_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS amount DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS plan VARCHAR(255),
ADD COLUMN IF NOT EXISTS duration INTEGER,
ADD COLUMN IF NOT EXISTS interest_rate DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
ADD COLUMN IF NOT EXISTS merchant_id INTEGER,
ADD COLUMN IF NOT EXISTS date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS maturity_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS expected_returns DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS current_value DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Step 2: Backfill from camelCase if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='customerId') THEN
    EXECUTE 'UPDATE investments SET customer_id = "customerId" WHERE customer_id IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='customerName') THEN
    EXECUTE 'UPDATE investments SET customer_name = "customerName" WHERE customer_name IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='accountNumber') THEN
    EXECUTE 'UPDATE investments SET account_number = "accountNumber" WHERE account_number IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='interestRate') THEN
    EXECUTE 'UPDATE investments SET interest_rate = "interestRate" WHERE interest_rate IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='dateCreated') THEN
    EXECUTE 'UPDATE investments SET date_created = "dateCreated" WHERE date_created IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='maturityDate') THEN
    EXECUTE 'UPDATE investments SET maturity_date = "maturityDate" WHERE maturity_date IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='expectedReturns') THEN
    EXECUTE 'UPDATE investments SET expected_returns = "expectedReturns" WHERE expected_returns IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='currentValue') THEN
    EXECUTE 'UPDATE investments SET current_value = "currentValue" WHERE current_value IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='merchantId') THEN
    EXECUTE 'UPDATE investments SET merchant_id = "merchantId" WHERE merchant_id IS NULL';
  END IF;
END $$;

-- Step 3: Indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_investments_merchant_id ON investments(merchant_id);
CREATE INDEX IF NOT EXISTS idx_investments_customer_id ON investments(customer_id);
CREATE INDEX IF NOT EXISTS idx_investments_status ON investments(status);
CREATE INDEX IF NOT EXISTS idx_investments_date_created ON investments(date_created);
CREATE INDEX IF NOT EXISTS idx_investments_maturity_date ON investments(maturity_date);

-- Step 4: Drop camelCase columns if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='customerId') THEN
    EXECUTE 'ALTER TABLE investments DROP COLUMN "customerId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='customerName') THEN
    EXECUTE 'ALTER TABLE investments DROP COLUMN "customerName"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='accountNumber') THEN
    EXECUTE 'ALTER TABLE investments DROP COLUMN "accountNumber"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='interestRate') THEN
    EXECUTE 'ALTER TABLE investments DROP COLUMN "interestRate"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='dateCreated') THEN
    EXECUTE 'ALTER TABLE investments DROP COLUMN "dateCreated"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='maturityDate') THEN
    EXECUTE 'ALTER TABLE investments DROP COLUMN "maturityDate"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='expectedReturns') THEN
    EXECUTE 'ALTER TABLE investments DROP COLUMN "expectedReturns"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='currentValue') THEN
    EXECUTE 'ALTER TABLE investments DROP COLUMN "currentValue"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='investments' AND column_name='merchantId') THEN
    EXECUTE 'ALTER TABLE investments DROP COLUMN "merchantId"';
  END IF;
END $$;


