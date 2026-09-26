-- Migration: Create packages table
-- Date: 2024-01-XX

-- Create packages table
CREATE TABLE IF NOT EXISTS packages (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'Fixed',
    amount DECIMAL(15,2) NOT NULL,
    seed_amount DECIMAL(15,2),
    seed_type VARCHAR(100),
    period INTEGER NOT NULL DEFAULT 360,
    collection_days VARCHAR(20) NOT NULL DEFAULT 'Daily',
    duration INTEGER NOT NULL,
    benefits JSONB,
    description TEXT,
    status VARCHAR(20) DEFAULT 'Active',
    merchant_id INTEGER NOT NULL,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    max_customers INTEGER,
    current_customers INTEGER DEFAULT 0,
    interest_rate DECIMAL(5,2),
    minimum_savings DECIMAL(15,2),
    savings_frequency VARCHAR(20) DEFAULT 'Daily',
    extra_charges DECIMAL(15,2) DEFAULT 0.00,
    default_penalty DECIMAL(15,2) DEFAULT 0.00,
    default_days INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add comments
COMMENT ON TABLE packages IS 'Investment packages table';
COMMENT ON COLUMN packages.name IS 'Package name (e.g., Alpha 1K, Beta 2K)';
COMMENT ON COLUMN packages.type IS 'Package type: Fixed, Variable, or Flexible';
COMMENT ON COLUMN packages.amount IS 'Package amount/price';
COMMENT ON COLUMN packages.seed_amount IS 'Initial seed amount or percentage for the package';
COMMENT ON COLUMN packages.seed_type IS 'Type of seed (e.g., First saving, Bonus, etc.)';
COMMENT ON COLUMN packages.period IS 'Period in days for the package';
COMMENT ON COLUMN packages.collection_days IS 'How often collections are made';
COMMENT ON COLUMN packages.duration IS 'Duration in days';
COMMENT ON COLUMN packages.benefits IS 'Array of package benefits';
COMMENT ON COLUMN packages.description IS 'Detailed package description';
COMMENT ON COLUMN packages.status IS 'Package status: Active, Inactive, or Deleted';
COMMENT ON COLUMN packages.merchant_id IS 'Reference to merchant who owns this package';
COMMENT ON COLUMN packages.interest_rate IS 'Interest rate for savings in this package';
COMMENT ON COLUMN packages.extra_charges IS 'Additional charges for the package';
COMMENT ON COLUMN packages.default_penalty IS 'Default penalty amount per day';
COMMENT ON COLUMN packages.default_days IS 'Default number of days for penalties';

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_packages_merchant_id ON packages(merchant_id);
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_type ON packages(type);
CREATE INDEX IF NOT EXISTS idx_packages_amount ON packages(amount);

-- Add foreign key constraint
ALTER TABLE packages 
ADD CONSTRAINT fk_packages_merchant 
FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_packages_updated_at 
    BEFORE UPDATE ON packages 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
