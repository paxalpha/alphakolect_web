-- Add missing merchant columns expected by the Sequelize model
-- Safe to run multiple times

ALTER TABLE merchants
ADD COLUMN IF NOT EXISTS "businessName" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "businessAlias" VARCHAR(255),
ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'NGN',
ADD COLUMN IF NOT EXISTS password VARCHAR(255),
ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS otp VARCHAR(20),
ADD COLUMN IF NOT EXISTS "otpExpires" TIMESTAMP;

-- Backfill businessName from existing name column if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'merchants' AND column_name = 'name'
  ) THEN
    UPDATE merchants 
    SET "businessName" = COALESCE("businessName", name);
  END IF;
END $$;

-- Ensure timestamps
ALTER TABLE merchants
ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP DEFAULT NOW();


