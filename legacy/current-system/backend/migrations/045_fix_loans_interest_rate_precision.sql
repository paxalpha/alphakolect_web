-- Widen interest_rate columns so flat-rate interest amounts (in Naira) do not overflow
-- DECIMAL(5,2) only allows values up to 999.99; flat-rate packages store the full interest
-- amount (e.g. 5000.00) in this column.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = 'interest_rate'
  ) THEN
    ALTER TABLE loans ALTER COLUMN interest_rate TYPE DECIMAL(15,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'loan_applications' AND column_name = 'interest_rate'
  ) THEN
    ALTER TABLE loan_applications ALTER COLUMN interest_rate TYPE DECIMAL(15,2);
  END IF;
END $$;
