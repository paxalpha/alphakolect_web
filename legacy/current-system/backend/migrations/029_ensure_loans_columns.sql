-- Ensure required snake_case columns exist on loans (idempotent)

ALTER TABLE loans
ADD COLUMN IF NOT EXISTS customer_id INTEGER,
ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS account_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS loan_amount DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS interest_rate DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS duration INTEGER,
ADD COLUMN IF NOT EXISTS agent_id INTEGER,
ADD COLUMN IF NOT EXISTS agent_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS branch VARCHAR(255),
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Pending',
ADD COLUMN IF NOT EXISTS merchant_id INTEGER,
ADD COLUMN IF NOT EXISTS date_issued TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS due_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS approved_by INTEGER,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS total_amount DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS remaining_amount DECIMAL(15,2);

-- Add indexes if missing
CREATE INDEX IF NOT EXISTS idx_loans_merchant_id ON loans(merchant_id);
CREATE INDEX IF NOT EXISTS idx_loans_customer_id ON loans(customer_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_date_issued ON loans(date_issued);
CREATE INDEX IF NOT EXISTS idx_loans_due_date ON loans(due_date);
CREATE INDEX IF NOT EXISTS idx_loans_agent_id ON loans(agent_id);


