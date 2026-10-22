-- Add the missing `notifications.data` column (2026-10-21). Nullable, additive.
--
-- Migration 015 defined `data JSONB` ("appointment_id, outcome, etc."), but the live
-- table was created by 005 without it. Readers already use it
-- (components/SetterFeedbackPrompt.tsx: data.outcome / setter_feedback / notes;
-- app/notifications/page.tsx), and these writers send it, so every one of their
-- inserts has been rejected ("column not found") and no row was ever created:
--   app/api/inspections/status/route.ts            (inspection_outcome to setter, + 2 more)
--   app/api/inspections/schedule-close/route.ts    (x2)
--   app/api/inspections/reschedule/route.ts        (x3)
--   app/api/admin/inspection-feedback/resend(-all) (status_prompt)
--   app/api/appointments/[id]/route.ts             (x3)
--   app/api/webhooks/leads/route.ts                (new_lead)
-- Adding the column makes them work as designed; dropping `data` from 13 writers
-- would instead lose what the setter results card shows.
-- Recipient-only RLS (202610210040) applies to it like every other column.

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS data jsonb;

-- Rollback: ALTER TABLE public.notifications DROP COLUMN IF EXISTS data;
--   (only safe before any row has data in it)
