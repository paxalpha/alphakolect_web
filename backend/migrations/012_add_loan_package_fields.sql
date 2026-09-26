-- Migration: Add loan package fields to packages table
-- Date: 2024-01-XX

-- Add loan-specific columns to packages table
ALTER TABLE packages 
ADD COLUMN IF NOT EXISTS loan_amount DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS loan_interest_rate DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS loan_period INTEGER,
ADD COLUMN IF NOT EXISTS default_amount DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS grace_period INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS loan_charges DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS package_category VARCHAR(20) DEFAULT 'Investment' CHECK (package_category IN ('Investment', 'Loan', 'Collection'));

-- Update existing records to set package_category
UPDATE packages 
SET package_category = 'Investment' 
WHERE package_category IS NULL;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_packages_category ON packages(package_category);
CREATE INDEX IF NOT EXISTS idx_packages_loan_amount ON packages(loan_amount);
CREATE INDEX IF NOT EXISTS idx_packages_loan_period ON packages(loan_period);

-- Add comments
COMMENT ON COLUMN packages.loan_amount IS 'Loan amount for loan packages';
COMMENT ON COLUMN packages.loan_interest_rate IS 'Interest rate for loan packages';
COMMENT ON COLUMN packages.loan_period IS 'Loan period in days';
COMMENT ON COLUMN packages.default_amount IS 'Default amount for loan packages';
COMMENT ON COLUMN packages.grace_period IS 'Grace period in days for loan packages';
COMMENT ON COLUMN packages.loan_charges IS 'Additional charges for loan packages';
COMMENT ON COLUMN packages.package_category IS 'Package category: Investment, Loan, or Collection';
