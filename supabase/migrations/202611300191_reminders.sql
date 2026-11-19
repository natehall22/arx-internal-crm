-- Assignable reminders (2026-11-30): "Remind <person> on <day> about <this job / customer / partner>". One table, service role only
-- (RLS on, no policies, no grants — like job_checkups): every read and write goes through lib/reminders.ts, which decides who may see
-- what. Additive; nothing reads it unless the company turns the `reminders` switch on.
--   due_on   = a calendar day on the COMPANY's clock (orgs.timezone), not a timestamp.
--   done_at  = set when done (kept, never deleted); a reminder can be reopened.
--   assigned_notified_at / due_notified_at = the bell on assign and on the due morning, each sent once (claimed with a conditional
--   update, so a re-run of the morning job never rings twice).
-- Rollback: DROP TABLE public.reminders;
CREATE TABLE IF NOT EXISTS public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  assignee_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  due_on date NOT NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  done_at timestamptz NULL,
  done_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  job_id uuid NULL REFERENCES public.production_jobs(id) ON DELETE SET NULL,
  customer_id uuid NULL REFERENCES public.customers(id) ON DELETE SET NULL,
  partner_id uuid NULL REFERENCES public.referral_partners(id) ON DELETE SET NULL,
  property_id uuid NULL REFERENCES public.properties(id) ON DELETE SET NULL,
  assigned_notified_at timestamptz NULL,
  due_notified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminders_open_by_person ON public.reminders (org_id, assignee_user_id, due_on) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS reminders_open_by_day ON public.reminders (org_id, due_on) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS reminders_by_customer ON public.reminders (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reminders_by_job ON public.reminders (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reminders_by_partner ON public.reminders (partner_id) WHERE partner_id IS NOT NULL;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reminders FROM anon, authenticated;
