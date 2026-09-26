-- Migration: Create agents table
-- Date: 2024-01-XX

CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    branch VARCHAR(100) NOT NULL,
    merchant_id INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'Active',
    customers_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_agents_email ON agents(email);
CREATE INDEX IF NOT EXISTS idx_agents_merchant_id ON agents(merchant_id);
CREATE INDEX IF NOT EXISTS idx_agents_branch ON agents(branch);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

-- Add foreign key constraint
ALTER TABLE agents 
ADD CONSTRAINT fk_agents_merchant_id 
FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;

-- Add comments
COMMENT ON TABLE agents IS 'Stores agent information and credentials';
COMMENT ON COLUMN agents.full_name IS 'Full name of the agent';
COMMENT ON COLUMN agents.phone_number IS 'Phone number of the agent';
COMMENT ON COLUMN agents.email IS 'Unique email address of the agent';
COMMENT ON COLUMN agents.password IS 'Hashed password for authentication';
COMMENT ON COLUMN agents.branch IS 'Branch where the agent works';
COMMENT ON COLUMN agents.merchant_id IS 'Reference to the merchant who owns this agent';
COMMENT ON COLUMN agents.status IS 'Agent status: Active, Inactive, Suspended';
COMMENT ON COLUMN agents.customers_count IS 'Number of customers assigned to this agent';
COMMENT ON COLUMN agents.created_at IS 'Timestamp when the agent was created';
COMMENT ON COLUMN agents.updated_at IS 'Timestamp when the agent was last updated';
