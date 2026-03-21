-- Add inspection_notes column to proposals for persisting inspection findings
-- Stored as JSONB array of strings for flexibility
ALTER TABLE proposals
ADD COLUMN IF NOT EXISTS inspection_notes JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN proposals.inspection_notes IS 'Array of inspection finding notes, shown in PDF Inspection Findings section';
