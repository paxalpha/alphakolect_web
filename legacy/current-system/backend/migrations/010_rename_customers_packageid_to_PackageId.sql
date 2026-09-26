DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='customers' AND column_name='packageid'
  ) THEN
    ALTER TABLE customers RENAME COLUMN packageid TO "packageId";
  END IF;
END $$;


