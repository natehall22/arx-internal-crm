-- Migration: 068_fix_job_additional_scope_rls.sql
-- Purpose: Fix RLS policies for job_additional_scope to use get_user_org_id function

-- Drop existing policies
DROP POLICY IF EXISTS "Users can read job additional scope" ON job_additional_scope;
DROP POLICY IF EXISTS "Users can insert job additional scope" ON job_additional_scope;
DROP POLICY IF EXISTS "Users can update job additional scope" ON job_additional_scope;
DROP POLICY IF EXISTS "Users can delete job additional scope" ON job_additional_scope;

-- Recreate with get_user_org_id function (consistent with other tables)
CREATE POLICY "Users can read job additional scope"
  ON job_additional_scope FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can insert job additional scope"
  ON job_additional_scope FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update job additional scope"
  ON job_additional_scope FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can delete job additional scope"
  ON job_additional_scope FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()));
