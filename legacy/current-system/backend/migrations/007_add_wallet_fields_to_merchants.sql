-- Migration: Add wallet fields to merchants table
-- Date: 2024-01-XX

-- Add wallet-related columns to merchants table
ALTER TABLE merchants 
ADD COLUMN IF NOT EXISTS account_number VARCHAR(20) UNIQUE,
ADD COLUMN IF NOT EXISTS account_level VARCHAR(20) DEFAULT 'Tier 1',
ADD COLUMN IF NOT EXISTS wallet_balance DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS wallet_status VARCHAR(20) DEFAULT 'Active';

-- Create index for account number lookups
CREATE INDEX IF NOT EXISTS idx_merchants_account_number ON merchants(account_number);

-- Add comments for documentation
COMMENT ON COLUMN merchants.account_number IS 'Unique wallet account number for the merchant';
COMMENT ON COLUMN merchants.account_level IS 'Account tier level (Tier 1, Tier 2, Tier 3, etc.)';
COMMENT ON COLUMN merchants.wallet_balance IS 'Current wallet balance';
COMMENT ON COLUMN merchants.wallet_status IS 'Wallet status (Active, Suspended, Closed)';
