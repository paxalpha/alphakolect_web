-- Migration: Add defaultPercentageRate and interestAmount to packages table
-- Date: 2024-12-XX

DO $$
BEGIN
  IF to_regclass('public.packages') IS NOT NULL THEN
    -- Add defaultPercentageRate column for investment packages
    ALTER TABLE packages 
    ADD COLUMN IF NOT EXISTS "defaultPercentageRate" DECIMAL(5,2);

    -- Add interestAmount column for flat rate loan packages
    ALTER TABLE packages 
    ADD COLUMN IF NOT EXISTS "interestAmount" DECIMAL(15,2);

    -- Add comments
    COMMENT ON COLUMN packages."defaultPercentageRate" IS 'Default percentage rate for missed day penalty calculation';
    COMMENT ON COLUMN packages."interestAmount" IS 'Fixed interest amount in Naira for flat rate loan packages';
  ELSE
    RAISE NOTICE 'Skipping 038_add_package_new_fields.sql: packages table does not exist yet';
  END IF;
END $$;

