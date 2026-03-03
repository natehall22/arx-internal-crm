-- Migration: 060_job_centric_ops.sql
-- Purpose: Move Work Orders to correct parent entity (Job instead of Project)
-- This is backwards compatible - old columns remain, new columns added

-- ============================================
-- PART 1: Add job_id to work_orders
-- ============================================

-- Add job_id column to work_orders (nullable initially for backfill)
ALTER TABLE work_orders 
ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL;

-- Create index for job_id lookups
CREATE INDEX IF NOT EXISTS idx_work_orders_job ON work_orders(job_id) WHERE job_id IS NOT NULL;

-- ============================================
-- PART 2: Backfill work_orders.job_id from project_id
-- ============================================

-- Backfill job_id for work_orders that have a project_id
-- Find the production_job that references the same project
UPDATE work_orders wo
SET job_id = pj.id
FROM production_jobs pj
WHERE wo.project_id = pj.project_id
  AND wo.job_id IS NULL
  AND wo.project_id IS NOT NULL;

-- ============================================
-- PART 3: Comments for documentation
-- ============================================

COMMENT ON COLUMN work_orders.job_id IS 'Primary parent - the production job this work order belongs to';
COMMENT ON COLUMN work_orders.project_id IS 'Legacy/secondary - kept for backwards compatibility, prefer job_id';

-- ============================================
-- NOTE: Referrals table
-- ============================================
-- The referrals table (028_referrals.sql) already uses referrer_customer_id as the primary parent.
-- If you need referrals functionality, run migration 028_referrals.sql first.
-- The UI changes in this release move referrals display from Project page to Customer page.
