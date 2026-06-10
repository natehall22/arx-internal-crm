CREATE TYPE bonus_status AS ENUM ('pending_approval', 'approved', 'rejected', 'paid');

ALTER TABLE payroll_bonus_lines
  ADD COLUMN IF NOT EXISTS status bonus_status NOT NULL DEFAULT 'pending_approval',
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

CREATE INDEX idx_payroll_bonus_lines_status ON payroll_bonus_lines(status);
