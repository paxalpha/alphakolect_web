-- Normalize customers columns to snake_case and backfill from camelCase if present

-- Ensure columns exist
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS merchant_id INTEGER,
ADD COLUMN IF NOT EXISTS agent_id INTEGER,
ADD COLUMN IF NOT EXISTS branch_id INTEGER,
ADD COLUMN IF NOT EXISTS package_id INTEGER;

-- Backfill from camelCase columns if they exist
DO $$
BEGIN
  -- merchant_id from "merchantId"
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='merchantId'
  ) THEN
    EXECUTE 'UPDATE customers SET merchant_id = "merchantId" WHERE merchant_id IS NULL';
  END IF;

  -- agent_id from "agentId"
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='agentId'
  ) THEN
    EXECUTE 'UPDATE customers SET agent_id = "agentId" WHERE agent_id IS NULL';
  END IF;

  -- branch_id from "branchId"
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='branchId'
  ) THEN
    EXECUTE 'UPDATE customers SET branch_id = "branchId" WHERE branch_id IS NULL';
  END IF;

  -- package_id from "packageId"
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='packageId'
  ) THEN
    EXECUTE 'UPDATE customers SET package_id = "packageId" WHERE package_id IS NULL';
  END IF;
END $$;

-- Add FKs where possible
DO $$
BEGIN
  -- merchant_id FK
  IF to_regclass('public.merchants') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='customers' AND constraint_name='customers_merchant_id_fkey'
  ) THEN
    ALTER TABLE customers
    ADD CONSTRAINT customers_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  -- agent_id FK
  IF to_regclass('public.agents') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='customers' AND constraint_name='customers_agent_id_fkey'
  ) THEN
    ALTER TABLE customers
    ADD CONSTRAINT customers_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;

  -- branch_id FK
  IF to_regclass('public.branches') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='customers' AND constraint_name='customers_branch_id_fkey'
  ) THEN
    ALTER TABLE customers
    ADD CONSTRAINT customers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;


