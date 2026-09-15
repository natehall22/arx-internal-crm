-- Which calendar install events are written to.
--
-- Paired with `orgs.install_scheduling_user_id` (202609080002): that column says
-- WHICH ACCOUNT installs act as, this one says WHICH OF ITS CALENDARS the events
-- land on. They are always needed together and are resolved together.
--
-- Without this, installs go to the nominated account's `primary` — i.e. someone's
-- personal calendar, mixed in with everything else they do. A dedicated calendar
-- keeps the install schedule separate and shareable with the rest of ops.
--
-- A column rather than the previous `GOOGLE_INSTALL_CALENDAR_ID` env var so it
-- can be set without a deploy, alongside the account it belongs with. The env
-- var is still honoured as a fallback so nothing breaks mid-rollout.
--
-- NOT to be confused with `production_jobs.install_calendar_id`, which records
-- where an individual job's event actually went so a later update or delete can
-- find it again even if this setting changes.

ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS install_scheduling_calendar_id TEXT;

COMMENT ON COLUMN orgs.install_scheduling_calendar_id IS
  'Google calendar ID install events are written to (e.g. c_xxx@group.calendar.google.com), owned by orgs.install_scheduling_user_id. NULL falls back to GOOGLE_INSTALL_CALENDAR_ID, then that account''s primary calendar.';
