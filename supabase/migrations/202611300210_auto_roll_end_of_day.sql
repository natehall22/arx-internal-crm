-- Nightly auto-roll + end-of-day nudge (2026-11-23). Additive; apply AFTER 202611300170, BEFORE the code.
--   1. work_order_moves.kind also allows 'auto_roll' (the nightly carry-over of unstarted work). Logged and shown in the move
--      history, but NOT counted as "Rolled N×": that counter (and rpt_visits.rolls) reads kind = 'roll' only.
--   2. One end-of-day bell per person per company day: the app inserts the notification first and the unique index makes a
--      second insert a no-op (same pattern as notifications_reminder_once).
-- Rollback: restore the old CHECK; DROP INDEX notifications_eod_once. (Before applying, the date still moves but the log row
-- is refused and only logged to the server console; the bell cannot be deduplicated, so the nudge stays OFF until applied.)
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.work_order_moves DROP CONSTRAINT IF EXISTS work_order_moves_kind_check;
ALTER TABLE public.work_order_moves ADD CONSTRAINT work_order_moves_kind_check CHECK (kind IN ('roll', 'shift', 'move', 'auto_roll'));

CREATE UNIQUE INDEX IF NOT EXISTS notifications_eod_once
  ON public.notifications (recipient_user_id, (data->>'day'))
  WHERE type = 'eod_open_work';

COMMIT;
