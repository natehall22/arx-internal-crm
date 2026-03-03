-- Migration: 063_job_packet_file_type.sql
-- Purpose: Add share_with_sub support for job files
-- NOTE: We use file_type='other' for job packets to avoid enum issues

-- ============================================
-- PART 1: Add share_with_sub to job_files
-- ============================================

ALTER TABLE job_files 
ADD COLUMN IF NOT EXISTS share_with_sub BOOLEAN NOT NULL DEFAULT false;

-- ============================================
-- PART 2: Index for job file lookups
-- ============================================

CREATE INDEX IF NOT EXISTS idx_job_files_job_file_type 
ON job_files(job_id, file_type);

CREATE INDEX IF NOT EXISTS idx_job_files_share_with_sub
ON job_files(job_id) WHERE share_with_sub = true;

-- ============================================
-- PART 3: RLS policy for subs to view shared job files
-- ============================================

DROP POLICY IF EXISTS "Subs can view shared job files" ON job_files;
CREATE POLICY "Subs can view shared job files"
  ON job_files FOR SELECT
  USING (
    share_with_sub = true
    AND job_id IN (
      SELECT id FROM production_jobs 
      WHERE assigned_sub_id = get_sub_id_for_user(auth.uid())
    )
  );

-- ============================================
-- PART 4: Comments
-- ============================================

COMMENT ON COLUMN job_files.share_with_sub IS 'If true, file is visible to assigned subcontractors';
