-- Add branchId to staff table if missing and create FK to branches

ALTER TABLE staff
ADD COLUMN IF NOT EXISTS "branchId" INTEGER;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE staff ADD CONSTRAINT fk_staff_branchid FOREIGN KEY ("branchId") REFERENCES branches(id) ON DELETE SET NULL';
  EXCEPTION WHEN others THEN NULL; END;
END $$;

-- Optional index for branchId
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_staff_branchid ON staff("branchId")';
  EXCEPTION WHEN others THEN NULL; END;
END $$;


