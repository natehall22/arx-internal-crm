-- Simple Job Invoicing System
-- Append-only philosophy: no silent edits, supports partial payments

-- Invoice status enum
DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'partially_paid', 'paid', 'void');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Main invoices table
CREATE TABLE job_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  status invoice_status NOT NULL DEFAULT 'draft',
  issued_at DATE,
  due_at DATE,
  sent_at TIMESTAMPTZ,
  sent_to_email TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  
  CONSTRAINT invoice_void_requires_reason CHECK (
    (status != 'void') OR (void_reason IS NOT NULL)
  )
);

-- Invoice line items
CREATE TABLE job_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES job_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment applications (links job_payments to invoices)
CREATE TABLE invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES job_invoices(id) ON DELETE CASCADE,
  job_payment_id UUID NOT NULL REFERENCES job_payments(id) ON DELETE RESTRICT,
  applied_cents INTEGER NOT NULL CHECK (applied_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  
  CONSTRAINT unique_payment_per_invoice UNIQUE (invoice_id, job_payment_id)
);

-- Indexes
CREATE INDEX idx_job_invoices_job_id ON job_invoices(job_id);
CREATE INDEX idx_job_invoices_status ON job_invoices(status);
CREATE INDEX idx_job_invoices_invoice_number ON job_invoices(invoice_number);
CREATE INDEX idx_job_invoice_items_invoice_id ON job_invoice_items(invoice_id);
CREATE INDEX idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);
CREATE INDEX idx_invoice_payments_job_payment_id ON invoice_payments(job_payment_id);

-- RLS Policies
ALTER TABLE job_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;

-- Invoices: access via job's org
CREATE POLICY "Users can read invoices for their org jobs" ON job_invoices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_invoices.job_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Users can insert invoices for their org jobs" ON job_invoices
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_invoices.job_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

-- Only allow updates to draft invoices (no silent edits to sent invoices)
CREATE POLICY "Users can update draft invoices for their org jobs" ON job_invoices
  FOR UPDATE USING (
    status = 'draft'
    AND EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_invoices.job_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

-- Invoice items: access via invoice's job
CREATE POLICY "Users can read invoice items for their org" ON job_invoice_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM job_invoices ji
      JOIN production_jobs pj ON pj.id = ji.job_id
      WHERE ji.id = job_invoice_items.invoice_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Users can insert invoice items for draft invoices" ON job_invoice_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM job_invoices ji
      JOIN production_jobs pj ON pj.id = ji.job_id
      WHERE ji.id = job_invoice_items.invoice_id
      AND ji.status = 'draft'
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Users can update invoice items for draft invoices" ON job_invoice_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM job_invoices ji
      JOIN production_jobs pj ON pj.id = ji.job_id
      WHERE ji.id = job_invoice_items.invoice_id
      AND ji.status = 'draft'
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Users can delete invoice items for draft invoices" ON job_invoice_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM job_invoices ji
      JOIN production_jobs pj ON pj.id = ji.job_id
      WHERE ji.id = job_invoice_items.invoice_id
      AND ji.status = 'draft'
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

-- Invoice payments: access via invoice's job
CREATE POLICY "Users can read invoice payments for their org" ON invoice_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM job_invoices ji
      JOIN production_jobs pj ON pj.id = ji.job_id
      WHERE ji.id = invoice_payments.invoice_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Users can insert invoice payments for their org" ON invoice_payments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM job_invoices ji
      JOIN production_jobs pj ON pj.id = ji.job_id
      WHERE ji.id = invoice_payments.invoice_id
      AND pj.org_id = get_user_org_id(auth.uid())
    )
  );

-- Function to generate invoice number: INV-YY-JOBNUM-SEQ
CREATE OR REPLACE FUNCTION generate_invoice_number(p_job_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_job_number TEXT;
  v_year TEXT;
  v_seq INTEGER;
  v_invoice_number TEXT;
BEGIN
  -- Get job number
  SELECT job_number INTO v_job_number
  FROM production_jobs
  WHERE id = p_job_id;
  
  -- Get current year (2 digits)
  v_year := TO_CHAR(NOW(), 'YY');
  
  -- Count existing invoices for this job
  SELECT COUNT(*) + 1 INTO v_seq
  FROM job_invoices
  WHERE job_id = p_job_id;
  
  -- Format: INV-26-J0042-001
  v_invoice_number := 'INV-' || v_year || '-' || v_job_number || '-' || LPAD(v_seq::TEXT, 3, '0');
  
  RETURN v_invoice_number;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate invoice number on insert
CREATE OR REPLACE FUNCTION set_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := generate_invoice_number(NEW.job_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_invoice_number
  BEFORE INSERT ON job_invoices
  FOR EACH ROW
  EXECUTE FUNCTION set_invoice_number();
