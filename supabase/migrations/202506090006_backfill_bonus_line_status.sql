-- Migration 202506090006: backfill pre-workflow bonus lines to 'approved'
--
-- Migration 202506090005 added the status column with DEFAULT 'pending_approval',
-- which set all pre-existing bonus lines (created before the approval workflow) to
-- 'pending_approval'. Those lines were implicitly approved under the old system and
-- would otherwise block payroll exports until manually approved.
--
-- This migration sets all bonus lines created before the workflow migration ran
-- (i.e., lines with no reviewed_at set by a human) to 'approved' so they flow
-- through payroll unblocked. Lines created after this migration will require
-- normal approval.

UPDATE payroll_bonus_lines
SET    status = 'approved'
WHERE  reviewed_at IS NULL
  AND  status = 'pending_approval';
