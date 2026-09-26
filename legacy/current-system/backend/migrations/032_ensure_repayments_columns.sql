-- Ensure repayments table has all required snake_case columns, backfill from camelCase, add indexes/FKs, drop camelCase

-- Step 1: Add missing columns (idempotent)
ALTER TABLE repayments
ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS loan_id INTEGER,
ADD COLUMN IF NOT EXISTS customer_id INTEGER,
ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS account_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS package VARCHAR(255),
ADD COLUMN IF NOT EXISTS amount DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS branch VARCHAR(255),
ADD COLUMN IF NOT EXISTS agent_id INTEGER,
ADD COLUMN IF NOT EXISTS agent_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS merchant_id INTEGER,
ADD COLUMN IF NOT EXISTS date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Pending',
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100),
ADD COLUMN IF NOT EXISTS reference VARCHAR(255),
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Step 2: Backfill from camelCase if such columns exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='transactionId') THEN
    EXECUTE 'UPDATE repayments SET transaction_id = "transactionId" WHERE transaction_id IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='loanId') THEN
    EXECUTE 'UPDATE repayments SET loan_id = "loanId" WHERE loan_id IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='customerId') THEN
    EXECUTE 'UPDATE repayments SET customer_id = "customerId" WHERE customer_id IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='customerName') THEN
    EXECUTE 'UPDATE repayments SET customer_name = "customerName" WHERE customer_name IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='accountNumber') THEN
    EXECUTE 'UPDATE repayments SET account_number = "accountNumber" WHERE account_number IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='amount') THEN
    EXECUTE 'UPDATE repayments SET amount = amount WHERE amount IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='branch') THEN
    EXECUTE 'UPDATE repayments SET branch = branch WHERE branch IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='agentId') THEN
    EXECUTE 'UPDATE repayments SET agent_id = "agentId" WHERE agent_id IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='agentName') THEN
    EXECUTE 'UPDATE repayments SET agent_name = "agentName" WHERE agent_name IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='merchantId') THEN
    EXECUTE 'UPDATE repayments SET merchant_id = "merchantId" WHERE merchant_id IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='paymentMethod') THEN
    EXECUTE 'UPDATE repayments SET payment_method = "paymentMethod" WHERE payment_method IS NULL';
  END IF;
END $$;

-- Step 3: Enforce constraints where appropriate
DO $$
BEGIN
  -- Make transaction_id NOT NULL and UNIQUE if possible
  IF EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='transaction_id'
  ) THEN
    BEGIN
      EXECUTE 'ALTER TABLE repayments ALTER COLUMN transaction_id SET NOT NULL';
    EXCEPTION WHEN others THEN
      -- Ignore if existing NULLs; user can clean data before re-running if needed
      NULL;
    END;
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_repayments_transaction_id_unique ON repayments(transaction_id)';
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- Step 4: Add helpful indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_repayments_merchant_id ON repayments(merchant_id);
CREATE INDEX IF NOT EXISTS idx_repayments_loan_id ON repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_repayments_customer_id ON repayments(customer_id);
CREATE INDEX IF NOT EXISTS idx_repayments_date ON repayments(date);
CREATE INDEX IF NOT EXISTS idx_repayments_status ON repayments(status);
CREATE INDEX IF NOT EXISTS idx_repayments_agent_id ON repayments(agent_id);

-- Step 5: Add foreign keys (best-effort)
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE repayments ADD CONSTRAINT fk_repayments_loan_id FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER TABLE repayments ADD CONSTRAINT fk_repayments_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER TABLE repayments ADD CONSTRAINT fk_repayments_agent_id FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER TABLE repayments ADD CONSTRAINT fk_repayments_merchant_id FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE';
  EXCEPTION WHEN others THEN NULL; END;
END $$;

-- Step 6: Drop lingering camelCase columns if present to avoid ORM confusion
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='transactionId') THEN
    EXECUTE 'ALTER TABLE repayments DROP COLUMN "transactionId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='loanId') THEN
    EXECUTE 'ALTER TABLE repayments DROP COLUMN "loanId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='customerId') THEN
    EXECUTE 'ALTER TABLE repayments DROP COLUMN "customerId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='customerName') THEN
    EXECUTE 'ALTER TABLE repayments DROP COLUMN "customerName"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='accountNumber') THEN
    EXECUTE 'ALTER TABLE repayments DROP COLUMN "accountNumber"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='agentId') THEN
    EXECUTE 'ALTER TABLE repayments DROP COLUMN "agentId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='agentName') THEN
    EXECUTE 'ALTER TABLE repayments DROP COLUMN "agentName"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='merchantId') THEN
    EXECUTE 'ALTER TABLE repayments DROP COLUMN "merchantId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='repayments' AND column_name='paymentMethod') THEN
    EXECUTE 'ALTER TABLE repayments DROP COLUMN "paymentMethod"';
  END IF;
END $$;


