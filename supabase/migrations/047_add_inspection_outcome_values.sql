-- Add new inspection outcome values to the enum
-- Migration: 047_add_inspection_outcome_values.sql

-- Add new values to the inspection_outcome enum
-- PostgreSQL requires ALTER TYPE to add values to an enum
ALTER TYPE inspection_outcome ADD VALUE IF NOT EXISTS 'moving_to_close';
ALTER TYPE inspection_outcome ADD VALUE IF NOT EXISTS 'no_problems_found';
ALTER TYPE inspection_outcome ADD VALUE IF NOT EXISTS 'insurance_follow_up';

-- Note: If the enum doesn't exist or needs to be recreated, run this:
-- DO $$
-- BEGIN
--   IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inspection_outcome') THEN
--     CREATE TYPE inspection_outcome AS ENUM (
--       'not_home',
--       'said_no',
--       'failed_credit',
--       'rescheduled',
--       'sale',
--       'moving_to_close',
--       'no_problems_found',
--       'insurance_follow_up'
--     );
--   END IF;
-- END $$;
