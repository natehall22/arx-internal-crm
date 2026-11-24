-- Job change history: who changed what on a production job, and when.
-- Same shape as service_plan_changes / supplier_audit_log: changes = [{ field, label, old, new }].
-- Service role only (RLS on, no member policies); read through GET /api/ops/jobs/[id]/history, written only by
-- lib/job-changes.ts (recordJobChanges). Additive: nothing reads it until the code ships; history starts when it is applied.
-- Rollback (no other table depends on it): DROP TABLE public.production_job_changes;

BEGIN;

CREATE TABLE IF NOT EXISTS public.production_job_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.production_jobs(id) ON DELETE CASCADE,
  changed_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('job_edit', 'status', 'schedule', 'cancel', 'uncancel', 'billing', 'owner', 'category')),
  changes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changes) = 'array'),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS production_job_changes_job_idx ON public.production_job_changes (org_id, job_id, changed_at DESC);

ALTER TABLE public.production_job_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_job_changes FROM anon, authenticated;

COMMIT;
