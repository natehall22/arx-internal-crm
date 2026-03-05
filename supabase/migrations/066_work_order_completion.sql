-- Work Order Completion Photos and Sub Portal Enhancements
-- Migration: 066_work_order_completion.sql

-- ============================================
-- PART 1: Work Order Completion Photos Table
-- ============================================

CREATE TABLE IF NOT EXISTS work_order_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  
  -- Photo category
  photo_type TEXT NOT NULL CHECK (photo_type IN ('work_done', 'cleanup')),
  
  -- Storage
  storage_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT DEFAULT 'image/jpeg',
  
  -- Uploaded by (sub contractor)
  uploaded_by_sub_id UUID REFERENCES sub_contractors(id) ON DELETE SET NULL,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_work_order_photos_work_order ON work_order_photos(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_photos_org ON work_order_photos(org_id);
CREATE INDEX IF NOT EXISTS idx_work_order_photos_type ON work_order_photos(work_order_id, photo_type);

-- ============================================
-- PART 2: Add completion fields to work_orders if not exists
-- ============================================

-- Add sub_completion_notes for sub-submitted completion notes
ALTER TABLE work_orders 
ADD COLUMN IF NOT EXISTS sub_completion_notes TEXT;

-- Add completed_by_sub_id to track which sub completed it
ALTER TABLE work_orders 
ADD COLUMN IF NOT EXISTS completed_by_sub_id UUID REFERENCES sub_contractors(id) ON DELETE SET NULL;

-- ============================================
-- PART 3: RLS Policies
-- ============================================

ALTER TABLE work_order_photos ENABLE ROW LEVEL SECURITY;

-- Org users can view all photos for work orders in their org
CREATE POLICY "Users can view work order photos in their org"
  ON work_order_photos FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

-- Org users can insert photos
CREATE POLICY "Users can insert work order photos"
  ON work_order_photos FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- Org users can delete photos
CREATE POLICY "Users can delete work order photos"
  ON work_order_photos FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()));

-- ============================================
-- PART 4: Sub contractor RLS for work order photos
-- ============================================

-- Subs can view photos for their assigned work orders
CREATE POLICY "Subs can view their work order photos"
  ON work_order_photos FOR SELECT
  USING (
    work_order_id IN (
      SELECT id FROM work_orders 
      WHERE assigned_sub_id = get_sub_id_for_user(auth.uid())
    )
  );

-- Subs can insert photos for their assigned work orders
CREATE POLICY "Subs can insert photos for their work orders"
  ON work_order_photos FOR INSERT
  WITH CHECK (
    work_order_id IN (
      SELECT id FROM work_orders 
      WHERE assigned_sub_id = get_sub_id_for_user(auth.uid())
    )
  );

-- ============================================
-- PART 5: Update work_orders RLS for sub completion
-- ============================================

-- Allow subs to update their assigned work orders (for completion)
DROP POLICY IF EXISTS "Subs can update assigned work orders" ON work_orders;

CREATE POLICY "Subs can update assigned work orders"
  ON work_orders FOR UPDATE
  USING (
    assigned_sub_id = get_sub_id_for_user(auth.uid())
  )
  WITH CHECK (
    assigned_sub_id = get_sub_id_for_user(auth.uid())
  );

-- Allow subs to read their assigned work orders
DROP POLICY IF EXISTS "Subs can view assigned work orders" ON work_orders;

CREATE POLICY "Subs can view assigned work orders"
  ON work_orders FOR SELECT
  USING (
    assigned_sub_id = get_sub_id_for_user(auth.uid())
  );

-- ============================================
-- PART 6: Comments
-- ============================================

COMMENT ON TABLE work_order_photos IS 'Photos uploaded by subs when completing work orders';
COMMENT ON COLUMN work_order_photos.photo_type IS 'Category: work_done or cleanup';
COMMENT ON COLUMN work_orders.sub_completion_notes IS 'Completion notes submitted by the sub contractor';
COMMENT ON COLUMN work_orders.completed_by_sub_id IS 'Sub contractor who marked the work order complete';
