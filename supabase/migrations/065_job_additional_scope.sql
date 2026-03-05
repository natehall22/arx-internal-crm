-- Migration: 065_job_additional_scope.sql
-- Purpose: Additional scope items for jobs (separate from proposal line items)

-- ============================================
-- PART 1: Create job_additional_scope table
-- ============================================

CREATE TABLE IF NOT EXISTS job_additional_scope (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  
  description TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'each',
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  
  notes TEXT,
  
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- PART 2: Add linked_proposal_id to production_jobs
-- For manual proposal linking
-- ============================================

ALTER TABLE production_jobs 
  ADD COLUMN IF NOT EXISTS linked_proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL;

-- ============================================
-- PART 3: Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_job_additional_scope_org_id ON job_additional_scope(org_id);
CREATE INDEX IF NOT EXISTS idx_job_additional_scope_job_id ON job_additional_scope(job_id);
CREATE INDEX IF NOT EXISTS idx_production_jobs_linked_proposal ON production_jobs(linked_proposal_id);

-- ============================================
-- PART 4: RLS Policies
-- ============================================

ALTER TABLE job_additional_scope ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read job additional scope" ON job_additional_scope;
CREATE POLICY "Users can read job additional scope"
  ON job_additional_scope FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert job additional scope" ON job_additional_scope;
CREATE POLICY "Users can insert job additional scope"
  ON job_additional_scope FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update job additional scope" ON job_additional_scope;
CREATE POLICY "Users can update job additional scope"
  ON job_additional_scope FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete job additional scope" ON job_additional_scope;
CREATE POLICY "Users can delete job additional scope"
  ON job_additional_scope FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ============================================
-- PART 5: Updated_at trigger
-- ============================================

CREATE OR REPLACE FUNCTION update_job_additional_scope_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_job_additional_scope_updated_at ON job_additional_scope;
CREATE TRIGGER trigger_job_additional_scope_updated_at
  BEFORE UPDATE ON job_additional_scope
  FOR EACH ROW
  EXECUTE FUNCTION update_job_additional_scope_updated_at();

-- ============================================
-- PART 6: Comments
-- ============================================

COMMENT ON TABLE job_additional_scope IS 'Additional scope items added to jobs outside of the original proposal';
COMMENT ON COLUMN job_additional_scope.description IS 'Description of the additional work item';
COMMENT ON COLUMN job_additional_scope.unit IS 'Unit of measure (squares, lf, each, etc.)';
COMMENT ON COLUMN production_jobs.linked_proposal_id IS 'Manually linked proposal when auto-detection fails';
