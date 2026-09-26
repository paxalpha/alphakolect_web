-- Backfill merchants.name from businessName if available, then relax NOT NULL

-- Backfill where name is NULL and businessName has a value
UPDATE merchants
SET name = "businessName"
WHERE name IS NULL AND "businessName" IS NOT NULL;

-- Drop NOT NULL constraint on name to align with current model usage
ALTER TABLE merchants
ALTER COLUMN name DROP NOT NULL;


