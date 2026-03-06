-- Migration: 070_dashboard_view.sql
-- Purpose: Add dashboard_view column to users table for controlling which dashboard they see

-- Create enum for dashboard view types
DO $$ BEGIN
  CREATE TYPE dashboard_view_type AS ENUM ('sales', 'ops');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add dashboard_view column to users table
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS dashboard_view dashboard_view_type NOT NULL DEFAULT 'sales';

-- Create index for filtering by dashboard view
CREATE INDEX IF NOT EXISTS idx_users_dashboard_view ON users(dashboard_view);

-- Comment
COMMENT ON COLUMN users.dashboard_view IS 'Controls which dashboard the user sees: sales or ops';
