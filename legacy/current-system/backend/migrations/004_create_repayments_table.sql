-- Migration: Create repayments table
-- Date: 2024-01-XX

CREATE TABLE IF NOT EXISTS repayments (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(100) UNIQUE NOT NULL,
    loan_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(100),
    package VARCHAR(255),
    amount DECIMAL(15,2) NOT NULL,
    branch VARCHAR(255),
    agent_id INTEGER,
    agent_name VARCHAR(255),
    merchant_id INTEGER NOT NULL,
    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Failed')),
    payment_method VARCHAR(100),
    reference VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key constraints
ALTER TABLE repayments ADD CONSTRAINT fk_repayments_loan_id FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE;
ALTER TABLE repayments ADD CONSTRAINT fk_repayments_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE repayments ADD CONSTRAINT fk_repayments_agent_id FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE repayments ADD CONSTRAINT fk_repayments_merchant_id FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;

-- Create indexes for better performance
CREATE INDEX idx_repayments_merchant_id ON repayments(merchant_id);
CREATE INDEX idx_repayments_loan_id ON repayments(loan_id);
CREATE INDEX idx_repayments_customer_id ON repayments(customer_id);
CREATE INDEX idx_repayments_date ON repayments(date);
CREATE INDEX idx_repayments_status ON repayments(status);
CREATE INDEX idx_repayments_transaction_id ON repayments(transaction_id);
CREATE INDEX idx_repayments_agent_id ON repayments(agent_id);



