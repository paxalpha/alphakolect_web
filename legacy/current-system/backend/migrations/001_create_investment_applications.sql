-- Migration: Create investment_applications table
-- Date: 2024-01-XX

CREATE TABLE IF NOT EXISTS investment_applications (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(100),
    target_amount DECIMAL(15,2) NOT NULL,
    duration INTEGER NOT NULL,
    agent_id INTEGER,
    agent_name VARCHAR(255),
    branch VARCHAR(255),
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Completed')),
    merchant_id INTEGER NOT NULL,
    date_applied TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    approved_by INTEGER,
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_investment_applications_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    
    CONSTRAINT fk_investment_applications_agent
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
    
    CONSTRAINT fk_investment_applications_merchant
        FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
    
    CONSTRAINT fk_investment_applications_staff
        FOREIGN KEY (approved_by) REFERENCES staff(id) ON DELETE SET NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_investment_applications_merchant_id ON investment_applications(merchant_id);
CREATE INDEX IF NOT EXISTS idx_investment_applications_customer_id ON investment_applications(customer_id);
CREATE INDEX IF NOT EXISTS idx_investment_applications_status ON investment_applications(status);
CREATE INDEX IF NOT EXISTS idx_investment_applications_date_applied ON investment_applications(date_applied);
CREATE INDEX IF NOT EXISTS idx_investment_applications_agent_id ON investment_applications(agent_id);

-- Add comments for documentation
COMMENT ON TABLE investment_applications IS 'Stores investment applications submitted by customers';
COMMENT ON COLUMN investment_applications.customer_id IS 'Reference to the customer who submitted the application';
COMMENT ON COLUMN investment_applications.target_amount IS 'Target investment amount in the base currency';
COMMENT ON COLUMN investment_applications.duration IS 'Investment duration in days';
COMMENT ON COLUMN investment_applications.status IS 'Current status of the application';
COMMENT ON COLUMN investment_applications.merchant_id IS 'Reference to the merchant/business';
COMMENT ON COLUMN investment_applications.approved_by IS 'Reference to the staff member who approved/rejected the application';
