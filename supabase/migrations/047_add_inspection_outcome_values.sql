-- Fix inspection_status_updates table
-- Migration: 047_add_inspection_outcome_values.sql

-- The table uses TEXT for outcome (not enum), so no enum changes needed.
-- This migration ensures the table exists with all required columns.

-- Add missing columns if they don't exist
ALTER TABLE inspection_status_updates 
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure opportunities table has the inspection columns
ALTER TABLE opportunities 
  ADD COLUMN IF NOT EXISTS inspection_outcome TEXT,
  ADD COLUMN IF NOT EXISTS inspection_outcome_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_notes TEXT;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_inspection_status_outcome ON inspection_status_updates(outcome);
CREATE INDEX IF NOT EXISTS idx_inspection_status_created ON inspection_status_updates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_inspection_outcome ON opportunities(inspection_outcome);
