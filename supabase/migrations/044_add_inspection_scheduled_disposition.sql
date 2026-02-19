-- Add 'inspection_scheduled' to canvass_disposition enum
-- This allows the map to show a distinct color for leads that have been scheduled for inspection

ALTER TYPE canvass_disposition ADD VALUE IF NOT EXISTS 'inspection_scheduled';
