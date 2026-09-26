-- Ensure customers has foreign key columns and constraints (idempotent)

-- Add columns if missing
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS merchant_id INTEGER,
ADD COLUMN IF NOT EXISTS agent_id INTEGER,
ADD COLUMN IF NOT EXISTS branch_id INTEGER;

-- Add FK for merchant_id if merchants table exists and constraint missing
DO $$
BEGIN
  IF to_regclass('public.merchants') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'customers_merchant_id_fkey'
        AND table_name = 'customers'
    ) THEN
      ALTER TABLE customers
      ADD CONSTRAINT customers_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- Add FK for agent_id if agents table exists and constraint missing
DO $$
BEGIN
  IF to_regclass('public.agents') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'customers_agent_id_fkey'
        AND table_name = 'customers'
    ) THEN
      ALTER TABLE customers
      ADD CONSTRAINT customers_agent_id_fkey
      FOREIGN KEY (agent_id) REFERENCES agents(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- Add FK for branch_id if branches table exists and constraint missing
DO $$
BEGIN
  IF to_regclass('public.branches') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'customers_branch_id_fkey'
        AND table_name = 'customers'
    ) THEN
      ALTER TABLE customers
      ADD CONSTRAINT customers_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES branches(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
  END IF;
END $$;


