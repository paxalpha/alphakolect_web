-- Ensure snake_case columns exist and backfill from camelCase, then drop camelCase

-- Customers: add core columns if missing
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS full_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS account_number VARCHAR(255),
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Customers: backfill from camelCase if columns exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='fullName') THEN
    EXECUTE 'UPDATE customers SET full_name = "fullName" WHERE full_name IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='phoneNumber') THEN
    EXECUTE 'UPDATE customers SET phone_number = "phoneNumber" WHERE phone_number IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='accountNumber') THEN
    EXECUTE 'UPDATE customers SET account_number = "accountNumber" WHERE account_number IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='createdAt') THEN
    EXECUTE 'UPDATE customers SET created_at = "createdAt" WHERE created_at IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='updatedAt') THEN
    EXECUTE 'UPDATE customers SET updated_at = "updatedAt" WHERE updated_at IS NULL';
  END IF;
END $$;

-- Customers: drop camelCase columns if they exist to prevent ORM confusion
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='fullName') THEN
    EXECUTE 'ALTER TABLE customers DROP COLUMN "fullName"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='phoneNumber') THEN
    EXECUTE 'ALTER TABLE customers DROP COLUMN "phoneNumber"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='accountNumber') THEN
    EXECUTE 'ALTER TABLE customers DROP COLUMN "accountNumber"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='createdAt') THEN
    EXECUTE 'ALTER TABLE customers DROP COLUMN "createdAt"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='updatedAt') THEN
    EXECUTE 'ALTER TABLE customers DROP COLUMN "updatedAt"';
  END IF;
END $$;

-- Agents: ensure snake_case timestamps and merchant_id present
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Agents: backfill merchant_id from merchantId if such column exists, then drop camelCase
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agents' AND column_name='merchantId') THEN
    EXECUTE 'UPDATE agents SET merchant_id = "merchantId" WHERE merchant_id IS NULL';
    EXECUTE 'ALTER TABLE agents DROP COLUMN "merchantId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agents' AND column_name='createdAt') THEN
    EXECUTE 'UPDATE agents SET created_at = "createdAt" WHERE created_at IS NULL';
    EXECUTE 'ALTER TABLE agents DROP COLUMN "createdAt"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agents' AND column_name='updatedAt') THEN
    EXECUTE 'UPDATE agents SET updated_at = "updatedAt" WHERE updated_at IS NULL';
    EXECUTE 'ALTER TABLE agents DROP COLUMN "updatedAt"';
  END IF;
END $$;


