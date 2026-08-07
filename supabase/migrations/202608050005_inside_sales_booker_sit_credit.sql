-- Inside-sales booker sit credit.
--
-- Problem this solves: a deal can involve four people in four roles. The setter
-- knocks the door, a closer runs the inspection, and — when the deal stalls into
-- the insurance pipeline — an inside-sales rep calls the customer and gets an
-- insurance appointment back onto the calendar. Today "who set the original
-- appointment" and "who got it re-booked" are the same field
-- (opportunities.setter_user_id), so the inside-sales rep earns nothing for the
-- re-booking while the setter keeps setter credit.
--
-- These columns split those two facts apart WITHOUT touching setter attribution.
-- opportunities.setter_user_id is deliberately left alone: the setter keeps
-- setter credit and setter commission exactly as before.
--
-- All additive and nullable — payroll is live and in daily use.

-- Who, in inside sales, put this appointment on the calendar. NULL for every
-- existing row and for appointments booked by the closer at the inspection
-- (those are not an inside-sales re-book and must not be credited).
ALTER TABLE scheduled_appointments
  ADD COLUMN IF NOT EXISTS inside_sales_booked_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

-- Admin escape hatch: suppress the sit credit for one appointment without
-- erasing the audit trail of who actually booked it.
ALTER TABLE scheduled_appointments
  ADD COLUMN IF NOT EXISTS inside_sales_sit_credit_excluded BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN scheduled_appointments.inside_sales_booked_by_user_id IS
  'Inside-sales rep who booked or re-booked this insurance appointment. Distinct '
  'from canvasser_user_id (the setter who booked the ORIGINAL inspection) and from '
  'closer_user_id (who runs it). Drives the inside-sales sit credit; never changes '
  'setter attribution or setter commission.';

COMMENT ON COLUMN scheduled_appointments.inside_sales_sit_credit_excluded IS
  'When true, this appointment never produces an inside-sales sit credit, even '
  'though inside_sales_booked_by_user_id is set. Admin override for a bad or '
  'duplicate booking.';

CREATE INDEX IF NOT EXISTS scheduled_appointments_inside_sales_booked_by_idx
  ON scheduled_appointments (org_id, inside_sales_booked_by_user_id, scheduled_for)
  WHERE inside_sales_booked_by_user_id IS NOT NULL;

-- One live adjuster meeting per opportunity and exact slot. This is the database
-- idempotency boundary for ambiguous HTTP insert failures and concurrent booking
-- requests. A cancelled meeting is excluded so the same slot can be re-booked.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_appointments_adjuster_meeting_slot_unique_idx
  ON scheduled_appointments (org_id, opportunity_id, scheduled_for)
  WHERE appointment_type = 'adjuster_meeting' AND status <> 'cancelled';

-- Org gate. Defaults to OFF on purpose: payroll is live, and period unit (sit/sale)
-- pay is recomputed from the live database every time a statement is rendered
-- rather than snapshotted into payout lines. A default-on flag would therefore
-- change ALREADY-PAID periods' statements retroactively.
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS inside_sales_sit_credit_enabled BOOLEAN NOT NULL DEFAULT false;

-- Deliberate cutoff. The credit only applies to appointments scheduled on or after
-- this date. Both columns are required for any credit to be paid: enabling without
-- a date pays nothing (fail closed), which forces a human to choose the date rather
-- than inheriting an accidental retroactive backfill across locked periods.
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS inside_sales_sit_credit_effective_from DATE NULL;

COMMENT ON COLUMN orgs.inside_sales_sit_credit_enabled IS
  'Master switch for the inside-sales booker sit credit. 0/false disables it '
  'entirely. Requires inside_sales_sit_credit_effective_from to also be set.';

COMMENT ON COLUMN orgs.inside_sales_sit_credit_effective_from IS
  'Earliest appointment date eligible for the inside-sales sit credit. NULL means '
  'no credit is paid even when inside_sales_sit_credit_enabled is true — this '
  'protects already-locked and already-paid payroll periods from a retroactive '
  'recompute.';

SELECT pg_notify('pgrst', 'reload schema');
