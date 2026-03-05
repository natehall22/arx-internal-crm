-- Migration: 068_fix_job_additional_scope_rls.sql
-- Purpose: Fix RLS policies for job_additional_scope using EXISTS with production_jobs

-- Drop existing policies
DROP POLICY IF EXISTS "Users can read job additional scope" ON job_additional_scope;
DROP POLICY IF EXISTS "Users can insert job additional scope" ON job_additional_scope;
DROP POLICY IF EXISTS "Users can update job additional scope" ON job_additional_scope;
DROP POLICY IF EXISTS "Users can delete job additional scope" ON job_additional_scope;

-- Use EXISTS pattern that checks job ownership (more reliable)
CREATE POLICY "Users can read job additional scope"
  ON job_additional_scope FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_additional_scope.job_id
      AND pj.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY "Users can insert job additional scope"
  ON job_additional_scope FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_id
      AND pj.org_id = org_id
      AND pj.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY "Users can update job additional scope"
  ON job_additional_scope FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_additional_scope.job_id
      AND pj.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY "Users can delete job additional scope"
  ON job_additional_scope FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM production_jobs pj
      WHERE pj.id = job_additional_scope.job_id
      AND pj.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
    )
  );
