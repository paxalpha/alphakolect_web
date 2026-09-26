-- Backfill snake_case columns from any lingering camelCase columns on loans, then drop camelCase

-- Step 1: Backfill snake_case from camelCase where snake_case is NULL
DO $$
BEGIN
  -- customer_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='customerId') THEN
    EXECUTE 'UPDATE loans SET customer_id = "customerId" WHERE customer_id IS NULL';
  END IF;
  -- customer_name
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='customerName') THEN
    EXECUTE 'UPDATE loans SET customer_name = "customerName" WHERE customer_name IS NULL';
  END IF;
  -- account_number
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='accountNumber') THEN
    EXECUTE 'UPDATE loans SET account_number = "accountNumber" WHERE account_number IS NULL';
  END IF;
  -- loan_amount
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='loanAmount') THEN
    EXECUTE 'UPDATE loans SET loan_amount = "loanAmount" WHERE loan_amount IS NULL';
  END IF;
  -- interest_rate
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='interestRate') THEN
    EXECUTE 'UPDATE loans SET interest_rate = "interestRate" WHERE interest_rate IS NULL';
  END IF;
  -- duration
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='duration') THEN
    -- same name but ensure value is kept if snake_case is NULL
    EXECUTE 'UPDATE loans SET duration = duration WHERE duration IS NULL';
  END IF;
  -- agent_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='agentId') THEN
    EXECUTE 'UPDATE loans SET agent_id = "agentId" WHERE agent_id IS NULL';
  END IF;
  -- agent_name
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='agentName') THEN
    EXECUTE 'UPDATE loans SET agent_name = "agentName" WHERE agent_name IS NULL';
  END IF;
  -- branch
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='branch') THEN
    EXECUTE 'UPDATE loans SET branch = branch WHERE branch IS NULL';
  END IF;
  -- status
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='status') THEN
    EXECUTE 'UPDATE loans SET status = status WHERE status IS NULL';
  END IF;
  -- merchant_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='merchantId') THEN
    EXECUTE 'UPDATE loans SET merchant_id = "merchantId" WHERE merchant_id IS NULL';
  END IF;
  -- date_issued
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='dateIssued') THEN
    EXECUTE 'UPDATE loans SET date_issued = "dateIssued" WHERE date_issued IS NULL';
  END IF;
  -- due_date
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='dueDate') THEN
    EXECUTE 'UPDATE loans SET due_date = "dueDate" WHERE due_date IS NULL';
  END IF;
  -- notes
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='notes') THEN
    EXECUTE 'UPDATE loans SET notes = notes WHERE notes IS NULL';
  END IF;
  -- approved_by
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='approvedBy') THEN
    EXECUTE 'UPDATE loans SET approved_by = "approvedBy" WHERE approved_by IS NULL';
  END IF;
  -- approved_at
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='approvedAt') THEN
    EXECUTE 'UPDATE loans SET approved_at = "approvedAt" WHERE approved_at IS NULL';
  END IF;
  -- total_amount
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='totalAmount') THEN
    EXECUTE 'UPDATE loans SET total_amount = "totalAmount" WHERE total_amount IS NULL';
  END IF;
  -- amount_paid
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='amountPaid') THEN
    EXECUTE 'UPDATE loans SET amount_paid = "amountPaid" WHERE amount_paid IS NULL';
  END IF;
  -- remaining_amount
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='remainingAmount') THEN
    EXECUTE 'UPDATE loans SET remaining_amount = "remainingAmount" WHERE remaining_amount IS NULL';
  END IF;
END $$;

-- Step 2: Drop camelCase columns if they exist to prevent NOT NULL constraint conflicts
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='customerId') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "customerId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='customerName') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "customerName"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='accountNumber') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "accountNumber"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='loanAmount') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "loanAmount"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='interestRate') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "interestRate"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='agentId') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "agentId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='agentName') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "agentName"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='merchantId') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "merchantId"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='dateIssued') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "dateIssued"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='dueDate') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "dueDate"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='approvedBy') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "approvedBy"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='approvedAt') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "approvedAt"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='totalAmount') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "totalAmount"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='amountPaid') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "amountPaid"';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='loans' AND column_name='remainingAmount') THEN
    EXECUTE 'ALTER TABLE loans DROP COLUMN "remainingAmount"';
  END IF;
  -- Columns with same names (duration, branch, status, notes) do not need dropping as snake_case uses same identifier
END $$;


