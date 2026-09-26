-- Migration: Create wallet_transactions table
-- Date: 2024-01-XX

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id SERIAL PRIMARY KEY,
    merchant_id INTEGER NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('credit', 'debit', 'transfer')),
    amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    reference VARCHAR(255),
    status VARCHAR(20) DEFAULT 'Completed' CHECK (status IN ('Pending', 'Completed', 'Failed')),
    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    balance_before DECIMAL(15,2),
    balance_after DECIMAL(15,2),
    category VARCHAR(100),
    related_id INTEGER,
    related_type VARCHAR(100),
    payment_method VARCHAR(100),
    notes TEXT,
    processed_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_wallet_transactions_merchant
        FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
    
    CONSTRAINT fk_wallet_transactions_processed_by
        FOREIGN KEY (processed_by) REFERENCES staff(id) ON DELETE SET NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_merchant_id ON wallet_transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON wallet_transactions(type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status ON wallet_transactions(status);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_date ON wallet_transactions(date);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reference ON wallet_transactions(reference);

-- Add comments for documentation
COMMENT ON TABLE wallet_transactions IS 'Stores wallet transaction history for merchants';
COMMENT ON COLUMN wallet_transactions.merchant_id IS 'Reference to the merchant/business';
COMMENT ON COLUMN wallet_transactions.type IS 'Type of transaction (credit, debit, transfer)';
COMMENT ON COLUMN wallet_transactions.amount IS 'Transaction amount in the base currency';
COMMENT ON COLUMN wallet_transactions.status IS 'Current status of the transaction';
COMMENT ON COLUMN wallet_transactions.balance_before IS 'Wallet balance before transaction';
COMMENT ON COLUMN wallet_transactions.balance_after IS 'Wallet balance after transaction';



