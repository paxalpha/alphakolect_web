-- Drop lingering camelCase columns on customers and create collections table if missing

-- Customers: drop camelCase FKs if present (now that snake_case exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='merchantId') THEN
    EXECUTE 'ALTER TABLE customers DROP COLUMN "merchantId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='agentId') THEN
    EXECUTE 'ALTER TABLE customers DROP COLUMN "agentId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='branchId') THEN
    EXECUTE 'ALTER TABLE customers DROP COLUMN "branchId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='packageId') THEN
    EXECUTE 'ALTER TABLE customers DROP COLUMN "packageId"';
  END IF;
END $$;

-- Create collections table if not exists (aligning with model fields)
CREATE TABLE IF NOT EXISTS collections (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  customer_name VARCHAR(255) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  type VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'Pending',
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  date_created TIMESTAMPTZ DEFAULT NOW(),
  collected_date TIMESTAMPTZ,
  amount_collected DECIMAL(15,2),
  description TEXT,
  collection_notes TEXT,
  priority VARCHAR(20) DEFAULT 'Medium',
  reminder_sent BOOLEAN DEFAULT FALSE,
  reminder_date TIMESTAMPTZ,
  cycle INTEGER NOT NULL DEFAULT 31,
  cycle_counter INTEGER NOT NULL DEFAULT 1,
  package_id INTEGER,
  package_name VARCHAR(255),
  package_amount DECIMAL(15,2),
  is_first_collection BOOLEAN NOT NULL DEFAULT FALSE
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_collections_customer_id ON collections(customer_id);
CREATE INDEX IF NOT EXISTS idx_collections_merchant_id ON collections(merchant_id);
CREATE INDEX IF NOT EXISTS idx_collections_status ON collections(status);
CREATE INDEX IF NOT EXISTS idx_collections_due_date ON collections(due_date);


