-- ============================================
-- INSTALL SCHEDULING — which Google account installs act as
--
-- Sales appointments already sync per-user: each closer connects their own
-- Google account on /admin/scheduling and their inspections land on their own
-- calendar. That model is right for appointments, where a rep owns the booking.
--
-- Installs are different. They are a company resource handed to a subcontractor,
-- not to a staff member, so "whoever clicked schedule" is the wrong owner:
--   * the event lands on that person's personal calendar
--   * crews share their free/busy with ONE address, which then would not match
--   * an ops user who never connected Google books a job that notifies nobody
--
-- So one staff account is nominated per org, and install writes AND free/busy
-- reads both act as it. This is a column rather than an env var so it can be
-- changed without a deploy, alongside `default_scheduling_gap_minutes` which
-- already lives here.
--
-- Nullable and additive: unset, the code falls back to the acting user's own
-- token exactly as before.
-- ============================================

ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS install_scheduling_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN orgs.install_scheduling_user_id IS
  'Staff user whose connected Google account install events are written from and whose token reads subcontractor free/busy. Subcontractors share their calendar with this user''s email. NULL falls back to the acting user.';
