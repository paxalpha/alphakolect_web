-- Migration: Create loan_applications table
-- Date: 2024-01-XX

CREATE TABLE IF NOT EXISTS loan_applications (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(100),
    requested_amount DECIMAL(15,2) NOT NULL,
    interest_rate DECIMAL(5,2) NOT NULL,
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
    purpose VARCHAR(255),
    collateral TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_loan_applications_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    
    CONSTRAINT fk_loan_applications_agent
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
    
    CONSTRAINT fk_loan_applications_merchant
        FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
    
    CONSTRAINT fk_loan_applications_staff
        FOREIGN KEY (approved_by) REFERENCES staff(id) ON DELETE SET NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_loan_applications_merchant_id ON loan_applications(merchant_id);
CREATE INDEX IF NOT EXISTS idx_loan_applications_customer_id ON loan_applications(customer_id);
CREATE INDEX IF NOT EXISTS idx_loan_applications_status ON loan_applications(status);
CREATE INDEX IF NOT EXISTS idx_loan_applications_date_applied ON loan_applications(date_applied);
CREATE INDEX IF NOT EXISTS idx_loan_applications_agent_id ON loan_applications(agent_id);

-- Add comments for documentation
COMMENT ON TABLE loan_applications IS 'Stores loan applications submitted by customers';
COMMENT ON COLUMN loan_applications.customer_id IS 'Reference to the customer who submitted the application';
COMMENT ON COLUMN loan_applications.requested_amount IS 'Requested loan amount in the base currency';
COMMENT ON COLUMN loan_applications.interest_rate IS 'Interest rate percentage for the loan';
COMMENT ON COLUMN loan_applications.duration IS 'Loan duration in days';
COMMENT ON COLUMN loan_applications.status IS 'Current status of the application';
COMMENT ON COLUMN loan_applications.merchant_id IS 'Reference to the merchant/business';
COMMENT ON COLUMN loan_applications.approved_by IS 'Reference to the staff member who approved/rejected the application';
COMMENT ON COLUMN loan_applications.purpose IS 'Purpose of the loan';
COMMENT ON COLUMN loan_applications.collateral IS 'Collateral information if any';
