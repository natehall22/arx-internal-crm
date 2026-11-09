-- Customer checkups + one-tap contact outcomes (Nathan, 2026-11-09). Additive / nullable only.
--
-- 1. job_checkups: one row per post-install touchpoint on an installed job. `month_offset` is months after the
--    install (completed_at): 6 and 12 are inspections, every 12 months after that is a call/text touch (the schedule
--    lives in orgs.settings, read by lib/checkups.ts — rows are created lazily as each one comes within reach).
--    Never hard-deleted: declined / can't-reach are statuses, so the history stays honest.
-- 2. activities.contact_outcome: the result of a logged call/text/email/visit (reached, voicemail, ...). Written only
--    by lib/threads/post-message.ts when a contact is logged; NULL on every existing row.
--
-- Deploy: apply BEFORE the code (the code reads both). Nothing existing changes.
-- Rollback: DROP TABLE public.job_checkups; ALTER TABLE public.activities DROP COLUMN contact_outcome;

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_checkups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  production_job_id uuid NOT NULL REFERENCES public.production_jobs(id) ON DELETE CASCADE,
  customer_id uuid NULL REFERENCES public.customers(id) ON DELETE SET NULL,
  opportunity_id uuid NULL REFERENCES public.opportunities(id) ON DELETE SET NULL,
  month_offset integer NOT NULL CHECK (month_offset BETWEEN 1 AND 600),
  kind text NOT NULL CHECK (kind IN ('inspection', 'touch')),
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'booked', 'done', 'declined', 'unreachable')),
  booked_for date NULL,
  result text NULL CHECK (result IN ('green', 'yellow', 'red')),
  notes text NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz NULL,
  last_activity_id uuid NULL REFERENCES public.activities(id) ON DELETE SET NULL,
  assigned_user_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  done_at timestamptz NULL,
  done_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT job_checkups_job_offset_key UNIQUE (production_job_id, month_offset),
  -- An inspection is only "done" with a result; a touch never carries one.
  CONSTRAINT job_checkups_result_shape CHECK (
    (kind = 'touch' AND result IS NULL) OR (kind = 'inspection' AND (status <> 'done' OR result IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS job_checkups_org_due_idx ON public.job_checkups (org_id, status, due_on);
CREATE INDEX IF NOT EXISTS job_checkups_customer_idx ON public.job_checkups (customer_id);

-- RLS on with NO policies: only the service role reads or writes (lib/checkups.ts, behind the job-board check).
-- Results and notes are job-side; field roles must not read them with their own token.
ALTER TABLE public.job_checkups ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS contact_outcome text NULL
    CHECK (contact_outcome IN ('reached', 'voicemail', 'no_answer', 'sent', 'replied'));

COMMIT;
