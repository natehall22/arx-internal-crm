-- Migration: 061_job_sold_scope_photos.sql
-- Purpose: Add support for sold scope tracking, final photos, and sub-sharing

-- ============================================
-- PART 1: Add accepted_proposal_id to production_jobs
-- Links job to the accepted proposal for "what was sold"
-- ============================================

ALTER TABLE production_jobs 
ADD COLUMN IF NOT EXISTS accepted_proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL;

ALTER TABLE production_jobs 
ADD COLUMN IF NOT EXISTS accepted_estimate_id UUID REFERENCES estimates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_production_jobs_accepted_proposal ON production_jobs(accepted_proposal_id) WHERE accepted_proposal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_production_jobs_accepted_estimate ON production_jobs(accepted_estimate_id) WHERE accepted_estimate_id IS NOT NULL;

-- ============================================
-- PART 2: Add share_with_sub flag to production_job_notes
-- Allows marking notes as visible to subcontractors
-- ============================================

ALTER TABLE production_job_notes 
ADD COLUMN IF NOT EXISTS share_with_sub BOOLEAN NOT NULL DEFAULT false;

-- ============================================
-- PART 3: Add photo_tag to files table for final photo categorization
-- ============================================

-- Add photo_tag column if it doesn't exist
ALTER TABLE files 
ADD COLUMN IF NOT EXISTS photo_tag TEXT;

-- Add job_id to files for direct job association
ALTER TABLE files 
ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_files_job_id ON files(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_photo_tag ON files(photo_tag) WHERE photo_tag IS NOT NULL;

-- ============================================
-- PART 4: Add job_packet fields to production_jobs
-- ============================================

ALTER TABLE production_jobs 
ADD COLUMN IF NOT EXISTS job_packet_pdf_path TEXT;

ALTER TABLE production_jobs 
ADD COLUMN IF NOT EXISTS job_packet_generated_at TIMESTAMPTZ;

ALTER TABLE production_jobs 
ADD COLUMN IF NOT EXISTS special_instructions TEXT;

-- ============================================
-- PART 5: Comments for documentation
-- ============================================

COMMENT ON COLUMN production_jobs.accepted_proposal_id IS 'Link to the accepted proposal showing what was sold';
COMMENT ON COLUMN production_jobs.accepted_estimate_id IS 'Link to the accepted estimate showing what was sold';
COMMENT ON COLUMN production_job_notes.share_with_sub IS 'If true, this note is visible to assigned subcontractors';
COMMENT ON COLUMN files.photo_tag IS 'Category tag for photos: final_front, final_back, final_left, final_right, final_slope_1, final_slope_2, flashing_detail, pipe_boots, cleanup, before, progress, after';
COMMENT ON COLUMN files.job_id IS 'Direct link to production job for job-specific files';
COMMENT ON COLUMN production_jobs.job_packet_pdf_path IS 'Storage path to generated job packet PDF for subs';
COMMENT ON COLUMN production_jobs.special_instructions IS 'Special instructions to include in job packet for crews/subs';
