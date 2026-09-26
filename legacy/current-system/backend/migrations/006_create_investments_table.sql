-- Migration: Create investments table
-- Date: 2024-01-XX

CREATE TABLE IF NOT EXISTS investments (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(100),
    amount DECIMAL(15,2) NOT NULL,
    interest_rate DECIMAL(5,2) NOT NULL,
    duration INTEGER NOT NULL,
    agent_id INTEGER,
    agent_name VARCHAR(255),
    branch VARCHAR(255),
    status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'Matured', 'Cancelled')),
    merchant_id INTEGER NOT NULL,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    maturity_date TIMESTAMP NOT NULL,
    notes TEXT,
    approved_by INTEGER,
    approved_at TIMESTAMP,
    total_return DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_investments_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    
    CONSTRAINT fk_investments_agent
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
    
    CONSTRAINT fk_investments_merchant
        FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
    
    CONSTRAINT fk_investments_approved_by
        FOREIGN KEY (approved_by) REFERENCES staff(id) ON DELETE SET NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_investments_merchant_id ON investments(merchant_id);
CREATE INDEX IF NOT EXISTS idx_investments_customer_id ON investments(customer_id);
CREATE INDEX IF NOT EXISTS idx_investments_status ON investments(status);
CREATE INDEX IF NOT EXISTS idx_investments_date_created ON investments(date_created);
CREATE INDEX IF NOT EXISTS idx_investments_maturity_date ON investments(maturity_date);
CREATE INDEX IF NOT EXISTS idx_investments_agent_id ON investments(agent_id);

-- Add comments for documentation
COMMENT ON TABLE investments IS 'Stores investment records for customers';
COMMENT ON COLUMN investments.customer_id IS 'Reference to the customer who made the investment';
COMMENT ON COLUMN investments.amount IS 'Investment amount in the base currency';
COMMENT ON COLUMN investments.interest_rate IS 'Interest rate percentage for the investment';
COMMENT ON COLUMN investments.duration IS 'Investment duration in days';
COMMENT ON COLUMN investments.status IS 'Current status of the investment';
COMMENT ON COLUMN investments.merchant_id IS 'Reference to the merchant/business';
COMMENT ON COLUMN investments.total_return IS 'Total return amount including principal and interest';
COMMENT ON COLUMN investments.maturity_date IS 'Date when the investment matures';



