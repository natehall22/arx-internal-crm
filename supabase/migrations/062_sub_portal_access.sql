-- Migration: 062_sub_portal_access.sql
-- Purpose: Enable sub-contractor portal access with secure token-based auth

-- ============================================
-- PART 1: Add user_id to sub_contractors for auth
-- Subs can optionally have a linked user account for full auth
-- ============================================

ALTER TABLE sub_contractors 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_contractors_user_id 
ON sub_contractors(user_id) WHERE user_id IS NOT NULL;

-- ============================================
-- PART 2: Add 'sub' role to user_role enum
-- ============================================

DO $$
BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'sub';
EXCEPTION WHEN others THEN NULL;
END $$;

-- ============================================
-- PART 3: Add share_with_sub flag to files table
-- ============================================

ALTER TABLE files 
ADD COLUMN IF NOT EXISTS share_with_sub BOOLEAN NOT NULL DEFAULT false;

-- ============================================
-- PART 4: Helper function to get sub_id from user
-- ============================================

CREATE OR REPLACE FUNCTION get_sub_id_for_user(user_uuid UUID)
RETURNS UUID AS $$
  SELECT id FROM sub_contractors WHERE user_id = user_uuid LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================
-- PART 5: RLS Policies for sub access to production_jobs
-- ============================================

-- Subs can view jobs assigned to them
DROP POLICY IF EXISTS "Subs can view assigned jobs" ON production_jobs;
CREATE POLICY "Subs can view assigned jobs"
  ON production_jobs FOR SELECT
  USING (
    assigned_sub_id = get_sub_id_for_user(auth.uid())
    AND assigned_sub_id IS NOT NULL
  );

-- ============================================
-- PART 6: RLS Policies for sub access to files
-- ============================================

-- Subs can view files shared with them or final photos
DROP POLICY IF EXISTS "Subs can view shared files" ON files;
CREATE POLICY "Subs can view shared files"
  ON files FOR SELECT
  USING (
    (share_with_sub = true OR photo_tag LIKE 'final_%')
    AND (
      job_id IN (
        SELECT id FROM production_jobs 
        WHERE assigned_sub_id = get_sub_id_for_user(auth.uid())
      )
      OR project_id IN (
        SELECT project_id FROM production_jobs 
        WHERE assigned_sub_id = get_sub_id_for_user(auth.uid())
      )
    )
  );

-- ============================================
-- PART 7: RLS Policies for sub access to notes
-- ============================================

-- Subs can view notes shared with them
DROP POLICY IF EXISTS "Subs can view shared notes" ON production_job_notes;
CREATE POLICY "Subs can view shared notes"
  ON production_job_notes FOR SELECT
  USING (
    share_with_sub = true
    AND job_id IN (
      SELECT id FROM production_jobs 
      WHERE assigned_sub_id = get_sub_id_for_user(auth.uid())
    )
  );

-- ============================================
-- PART 8: RLS Policies for sub access to proposals (read-only line items)
-- ============================================

DROP POLICY IF EXISTS "Subs can view accepted proposals for assigned jobs" ON proposals;
CREATE POLICY "Subs can view accepted proposals for assigned jobs"
  ON proposals FOR SELECT
  USING (
    accepted_at IS NOT NULL
    AND project_id IN (
      SELECT project_id FROM production_jobs 
      WHERE assigned_sub_id = get_sub_id_for_user(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Subs can view proposal line items for assigned jobs" ON proposal_line_items;
CREATE POLICY "Subs can view proposal line items for assigned jobs"
  ON proposal_line_items FOR SELECT
  USING (
    proposal_id IN (
      SELECT p.id FROM proposals p
      JOIN production_jobs pj ON pj.project_id = p.project_id
      WHERE p.accepted_at IS NOT NULL
      AND pj.assigned_sub_id = get_sub_id_for_user(auth.uid())
    )
  );

-- ============================================
-- PART 9: RLS Policies for sub access to projects (limited fields)
-- ============================================

DROP POLICY IF EXISTS "Subs can view projects for assigned jobs" ON projects;
CREATE POLICY "Subs can view projects for assigned jobs"
  ON projects FOR SELECT
  USING (
    id IN (
      SELECT project_id FROM production_jobs 
      WHERE assigned_sub_id = get_sub_id_for_user(auth.uid())
    )
  );

-- ============================================
-- PART 10: RLS Policies for sub access to customers (limited)
-- ============================================

DROP POLICY IF EXISTS "Subs can view customers for assigned jobs" ON customers;
CREATE POLICY "Subs can view customers for assigned jobs"
  ON customers FOR SELECT
  USING (
    id IN (
      SELECT customer_id FROM production_jobs 
      WHERE assigned_sub_id = get_sub_id_for_user(auth.uid())
      AND customer_id IS NOT NULL
    )
  );

-- ============================================
-- PART 11: Comments
-- ============================================

COMMENT ON COLUMN sub_contractors.user_id IS 'Links sub to a Supabase auth user for portal access';
COMMENT ON COLUMN files.share_with_sub IS 'If true, file is visible to assigned subcontractors';
COMMENT ON FUNCTION get_sub_id_for_user IS 'Returns sub_contractor ID for a given auth user';
