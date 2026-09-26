-- Migration: Ensure customer_wallets table has all required columns
-- Date: 2024-01-XX

-- Add missing columns if they don't exist
ALTER TABLE customer_wallets 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Update existing records to have timestamps if they don't
UPDATE customer_wallets 
SET 
  created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
  updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
WHERE created_at IS NULL OR updated_at IS NULL;

-- Ensure the columns are NOT NULL
ALTER TABLE customer_wallets 
ALTER COLUMN created_at SET NOT NULL,
ALTER COLUMN updated_at SET NOT NULL;

-- Add comments
COMMENT ON COLUMN customer_wallets.created_at IS 'Record creation timestamp';
COMMENT ON COLUMN customer_wallets.updated_at IS 'Record last update timestamp';
