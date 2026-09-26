-- Ensure all camelCase columns exist in merchants table for Sequelize
ALTER TABLE merchants
ADD COLUMN IF NOT EXISTS "accountLevel" VARCHAR(255) DEFAULT 'Tier 0',
ADD COLUMN IF NOT EXISTS "accountNumber" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "bankName" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "accountName" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "bankCode" VARCHAR(255);

-- Map existing data if columns were previously created in snake_case
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchants' AND column_name = 'account_level') THEN
        UPDATE merchants SET "accountLevel" = account_level WHERE "accountLevel" IS NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchants' AND column_name = 'account_number') THEN
        UPDATE merchants SET "accountNumber" = account_number WHERE "accountNumber" IS NULL;
    END IF;
END $$;
