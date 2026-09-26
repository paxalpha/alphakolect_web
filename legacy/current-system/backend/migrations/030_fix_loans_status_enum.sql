-- Convert loans.status from enum to VARCHAR and drop enum type if unused

DO $$
BEGIN
  -- If status column is of enum type, convert to VARCHAR(20)
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns c
    JOIN pg_type t ON t.oid = (SELECT atttypid FROM pg_attribute WHERE attrelid = (SELECT oid FROM pg_class WHERE relname = 'loans') AND attname = 'status' LIMIT 1)
    WHERE c.table_name = 'loans' AND c.column_name = 'status' AND t.typcategory = 'E'
  ) THEN
    ALTER TABLE loans
    ALTER COLUMN status TYPE VARCHAR(20) USING status::text;
  END IF;
END $$;

-- Drop enum type if it exists and no columns depend on it
DO $$
DECLARE
  dep_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_loans_status') THEN
    SELECT COUNT(*) INTO dep_count
    FROM pg_depend d
    JOIN pg_type t ON t.oid = d.refobjid
    WHERE t.typname = 'enum_loans_status';

    IF dep_count = 0 THEN
      DROP TYPE IF EXISTS enum_loans_status;
    END IF;
  END IF;
END $$;


