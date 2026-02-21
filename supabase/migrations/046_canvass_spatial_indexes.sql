-- Migration: Spatial indexes for canvassing at scale
-- Purpose: Support 100k+ pins with viewport-based loading (Spotio/Terros style)
-- 
-- CRITICAL FOR PERFORMANCE: These indexes enable fast bounding box queries
-- Without these, viewport queries will do full table scans

-- Composite index for bounding box queries on leads
-- This is the primary index used by viewport loading
CREATE INDEX IF NOT EXISTS idx_leads_lat_lng_org 
ON leads (org_id, lat, lng) 
WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Separate indexes for range queries (Postgres can combine these)
CREATE INDEX IF NOT EXISTS idx_leads_lat ON leads (lat) WHERE lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lng ON leads (lng) WHERE lng IS NOT NULL;

-- Index for filtering by org + status (common query pattern)
CREATE INDEX IF NOT EXISTS idx_leads_org_status_geo 
ON leads (org_id, status, lat, lng) 
WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Index for canvass disposition filtering
CREATE INDEX IF NOT EXISTS idx_leads_org_disposition_geo 
ON leads (org_id, canvass_disposition, lat, lng) 
WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Index for owner-based visibility filtering
CREATE INDEX IF NOT EXISTS idx_leads_owner_geo 
ON leads (owner_user_id, lat, lng) 
WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Add comment explaining the indexes
COMMENT ON INDEX idx_leads_lat_lng_org IS 'Primary index for viewport-based map loading. Supports bounding box queries with org scoping.';
