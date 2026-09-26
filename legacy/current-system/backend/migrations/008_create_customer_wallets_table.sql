-- Migration: Create customer_wallets table
-- Date: 2024-01-XX

CREATE TABLE IF NOT EXISTS customer_wallets (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    merchant_id INTEGER NOT NULL,
    account_number VARCHAR(20) UNIQUE NOT NULL,
    account_level VARCHAR(20) DEFAULT 'Tier 1',
    balance DECIMAL(15,2) DEFAULT 0.00,
    status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended', 'Closed')),
    last_transaction_date TIMESTAMP,
    activation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    daily_limit DECIMAL(15,2) DEFAULT 1000000.00,
    monthly_limit DECIMAL(15,2) DEFAULT 10000000.00,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_customer_wallets_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    
    CONSTRAINT fk_customer_wallets_merchant
        FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_customer_wallets_customer_id ON customer_wallets(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_wallets_merchant_id ON customer_wallets(merchant_id);
CREATE INDEX IF NOT EXISTS idx_customer_wallets_account_number ON customer_wallets(account_number);
CREATE INDEX IF NOT EXISTS idx_customer_wallets_status ON customer_wallets(status);

-- Add comments for documentation
COMMENT ON TABLE customer_wallets IS 'Stores individual customer wallet information';
COMMENT ON COLUMN customer_wallets.customer_id IS 'Reference to the customer';
COMMENT ON COLUMN customer_wallets.merchant_id IS 'Reference to the merchant/business';
COMMENT ON COLUMN customer_wallets.account_number IS 'Unique wallet account number for the customer';
COMMENT ON COLUMN customer_wallets.account_level IS 'Account tier level (Tier 1, Tier 2, Tier 3, etc.)';
COMMENT ON COLUMN customer_wallets.balance IS 'Current wallet balance';
COMMENT ON COLUMN customer_wallets.status IS 'Wallet status (Active, Suspended, Closed)';
COMMENT ON COLUMN customer_wallets.last_transaction_date IS 'Date of last transaction';
COMMENT ON COLUMN customer_wallets.activation_date IS 'Date when wallet was activated';
COMMENT ON COLUMN customer_wallets.daily_limit IS 'Daily transaction limit';
COMMENT ON COLUMN customer_wallets.monthly_limit IS 'Monthly transaction limit';
