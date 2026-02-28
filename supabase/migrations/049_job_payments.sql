-- Job Payments tracking
-- Simple payment tracking for production jobs

CREATE TABLE job_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  paid_at DATE NOT NULL,
  amount_cents INTEGER NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('deposit', 'insurance_acv', 'insurance_supplement', 'deductible', 'final', 'other')),
  method TEXT NOT NULL CHECK (method IN ('check', 'cash', 'ach', 'card', 'financing', 'insurance', 'other')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_job_payments_job_id ON job_payments(job_id);
CREATE INDEX idx_job_payments_paid_at ON job_payments(paid_at);

-- RLS
ALTER TABLE job_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read job payments for their org" ON job_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_payments.job_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Users can insert job payments for their org" ON job_payments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_payments.job_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Users can update job payments for their org" ON job_payments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_payments.job_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Admins can delete job payments" ON job_payments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_payments.job_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
    AND is_admin_or_manager(auth.uid())
  );
