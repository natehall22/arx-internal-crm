-- Financing programs (admin-managed). Dealer fee % is internal; not exposed to customers/reps in UI.
-- Fee is always a percentage of the financed contract total: fee = total * (percent/100), net = total - fee.

CREATE TABLE IF NOT EXISTS financing_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lender_name TEXT NOT NULL,
  financing_rate NUMERIC(6, 3) NOT NULL DEFAULT 0,
  term_months INTEGER NOT NULL DEFAULT 60,
  dealer_fee_percent NUMERIC(6, 3) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financing_programs_org ON financing_programs(org_id);
CREATE INDEX IF NOT EXISTS idx_financing_programs_active ON financing_programs(org_id, active);

COMMENT ON TABLE financing_programs IS 'Lender financing options; dealer_fee_percent is admin-only in product surfaces.';
COMMENT ON COLUMN financing_programs.dealer_fee_percent IS 'Percent of financed contract total taken as dealer fee (internal).';

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS financing_program_id UUID REFERENCES financing_programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS financing_lender_name TEXT,
  ADD COLUMN IF NOT EXISTS dealer_fee_percent NUMERIC(6, 3),
  ADD COLUMN IF NOT EXISTS dealer_fee_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS financed_contract_total NUMERIC(12, 2);

COMMENT ON COLUMN proposals.financed_contract_total IS 'Total contract/financed amount after gross-up for dealer fee (same as Installation Agreement project cost when financing applies).';
COMMENT ON COLUMN proposals.dealer_fee_percent IS 'Snapshot of program fee; omit from rep-facing API responses.';

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS financing_program_id UUID REFERENCES financing_programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dealer_fee_percent NUMERIC(6, 3),
  ADD COLUMN IF NOT EXISTS dealer_fee_amount NUMERIC(12, 2);

COMMENT ON COLUMN production_jobs.dealer_fee_percent IS 'Internal; omit from rep-facing surfaces.';

ALTER TABLE financing_programs ENABLE ROW LEVEL SECURITY;

-- Only admin / operations / owner can read or manage programs (dealer fee must not leak via client Supabase).
DROP POLICY IF EXISTS "Admins can manage financing programs" ON financing_programs;
CREATE POLICY "Admins can manage financing programs"
  ON financing_programs FOR ALL
  USING (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'operations', 'owner')
  )
  WITH CHECK (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'operations', 'owner')
  );
