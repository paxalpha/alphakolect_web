-- Ensure column exists first
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS packageId INTEGER NULL;

-- Add FK only if packages table exists and constraint is missing
DO $$
BEGIN
  IF to_regclass('public.packages') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      WHERE tc.constraint_name = 'customers_packageId_fkey'
        AND tc.table_name = 'customers'
        AND tc.constraint_type = 'FOREIGN KEY'
    ) THEN
      ALTER TABLE customers
      ADD CONSTRAINT customers_packageId_fkey FOREIGN KEY (packageId)
      REFERENCES packages(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

