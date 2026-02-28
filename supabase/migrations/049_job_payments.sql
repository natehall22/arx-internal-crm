-- Job Payments tracking
-- Simple payment tracking for production jobs
-- Append-only: no updates allowed, refunds entered as negative amounts

CREATE TABLE job_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  paid_at DATE NOT NULL,
  amount_cents INTEGER NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('deposit', 'insurance_acv', 'insurance_supplement', 'deductible', 'final', 'other')),
  method TEXT NOT NULL CHECK (method IN ('check', 'cash', 'ach', 'card', 'financing', 'insurance', 'other')),
  payer TEXT NOT NULL CHECK (payer IN ('homeowner', 'insurance', 'financing', 'other')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Indexes
CREATE INDEX idx_job_payments_job_id ON job_payments(job_id);
CREATE INDEX idx_job_payments_paid_at ON job_payments(paid_at);

-- RLS
ALTER TABLE job_payments ENABLE ROW LEVEL SECURITY;

-- Read: users can read payments for jobs in their org
CREATE POLICY "Users can read job payments for their org" ON job_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_payments.job_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

-- Insert: users can add payments for jobs in their org
CREATE POLICY "Users can insert job payments for their org" ON job_payments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_payments.job_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

-- NO UPDATE POLICY: Payments are append-only
-- Corrections should be made by adding a new entry (negative for refunds)

-- Delete: only admins can delete payments
CREATE POLICY "Admins can delete job payments" ON job_payments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_payments.job_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
    AND is_admin_or_manager(auth.uid())
  );
