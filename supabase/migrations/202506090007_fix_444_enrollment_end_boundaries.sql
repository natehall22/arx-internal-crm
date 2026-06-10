-- Migration 202506090007: convert 444 enrollment week end timestamps to exclusive boundaries
--
-- compute444WeekWindows previously stored inclusive ends (Saturday 23:59:59 ET).
-- The sync and accountability code has been updated to use exclusive end boundaries
-- (Sunday 00:00:00 ET = start of next period) so that sub-second timestamps at the
-- tail of Saturday are never silently dropped.
--
-- This migration advances all existing week1_ends_at and week2_ends_at by +1 second,
-- converting '...T03:59:59Z' → '...T04:00:00Z' (equivalent to midnight ET on Sunday).
-- New enrollments created after this migration will already have correct values from
-- the updated compute444WeekWindows utility.

UPDATE program_444_enrollments
SET
  week1_ends_at = week1_ends_at + INTERVAL '1 second',
  week2_ends_at = week2_ends_at + INTERVAL '1 second';
