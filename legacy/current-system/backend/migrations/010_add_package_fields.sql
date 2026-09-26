-- Migration: Add missing fields to packages table
-- Date: 2024-01-XX

DO $$
BEGIN
  IF to_regclass('public.packages') IS NOT NULL THEN
    -- Add new columns to packages table
    ALTER TABLE packages 
    ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'Fixed',
    ADD COLUMN IF NOT EXISTS seed_amount DECIMAL(15,2),
    ADD COLUMN IF NOT EXISTS seed_type VARCHAR(100),
    ADD COLUMN IF NOT EXISTS period INTEGER DEFAULT 360,
    ADD COLUMN IF NOT EXISTS collection_days VARCHAR(20) DEFAULT 'Daily';

    -- Update existing records with default values
    UPDATE packages 
    SET 
      type = 'Fixed',
      seed_amount = amount,
      seed_type = 'First saving',
      period = duration,
      collection_days = 'Daily'
    WHERE type IS NULL OR seed_amount IS NULL OR seed_type IS NULL OR period IS NULL OR collection_days IS NULL;

    -- Make new columns NOT NULL after setting defaults
    ALTER TABLE packages 
    ALTER COLUMN type SET NOT NULL,
    ALTER COLUMN period SET NOT NULL,
    ALTER COLUMN collection_days SET NOT NULL;

    -- Add indexes for better performance
    CREATE INDEX IF NOT EXISTS idx_packages_type ON packages(type);
    CREATE INDEX IF NOT EXISTS idx_packages_collection_days ON packages(collection_days);

    -- Add comments
    COMMENT ON COLUMN packages.type IS 'Package type: Fixed, Variable, or Flexible';
    COMMENT ON COLUMN packages.seed_amount IS 'Initial seed amount or percentage for the package';
    COMMENT ON COLUMN packages.seed_type IS 'Type of seed (e.g., First saving, Bonus, etc.)';
    COMMENT ON COLUMN packages.period IS 'Period in days for the package';
    COMMENT ON COLUMN packages.collection_days IS 'How often collections are made';
  ELSE
    RAISE NOTICE 'Skipping 010_add_package_fields.sql: packages table does not exist yet';
  END IF;
END $$;
