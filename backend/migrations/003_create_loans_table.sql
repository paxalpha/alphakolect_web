-- Migration: Create loans table
-- Date: 2024-01-XX

CREATE TABLE IF NOT EXISTS loans (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(100),
    loan_amount DECIMAL(15,2) NOT NULL,
    interest_rate DECIMAL(5,2) NOT NULL,
    duration INTEGER NOT NULL,
    agent_id INTEGER,
    agent_name VARCHAR(255),
    branch VARCHAR(255),
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Active', 'Completed', 'Defaulted', 'Pending')),
    merchant_id INTEGER NOT NULL,
    date_issued TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    due_date TIMESTAMP NOT NULL,
    notes TEXT,
    approved_by INTEGER,
    approved_at TIMESTAMP,
    total_amount DECIMAL(15,2) NOT NULL,
    amount_paid DECIMAL(15,2) DEFAULT 0,
    remaining_amount DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key constraints
ALTER TABLE loans ADD CONSTRAINT fk_loans_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE loans ADD CONSTRAINT fk_loans_agent_id FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE loans ADD CONSTRAINT fk_loans_merchant_id FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;
ALTER TABLE loans ADD CONSTRAINT fk_loans_approved_by FOREIGN KEY (approved_by) REFERENCES staff(id) ON DELETE SET NULL;

-- Create indexes for better performance
CREATE INDEX idx_loans_merchant_id ON loans(merchant_id);
CREATE INDEX idx_loans_customer_id ON loans(customer_id);
CREATE INDEX idx_loans_status ON loans(status);
CREATE INDEX idx_loans_date_issued ON loans(date_issued);
CREATE INDEX idx_loans_due_date ON loans(due_date);
CREATE INDEX idx_loans_agent_id ON loans(agent_id);



