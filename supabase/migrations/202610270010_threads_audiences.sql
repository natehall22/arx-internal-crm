-- Phase C: Job Threads + note audiences (all additive / nullable; nothing existing is rewritten).
--
-- One message store: `activities` (the customer-file spec's hub table) gets an audience, a
-- pricing flag, priority, mentions, pins and soft-delete. A "thread" is one deal (opportunity)
-- or one prospect (lead); it only exists to carry membership + read pointers.
--
-- Legacy rows keep audience NULL = today's behaviour (org-wide read). Only rows that carry an
-- audience are filtered, so applying this changes nothing until new messages are written.
--
-- Rollback: drop the policy "Users can read activities" and recreate it as
--   (org_id = get_user_org_id(auth.uid()) AND referral_partner_id IS NULL);
--   and recreate the three old write policies (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid());
--   DROP FUNCTION message_visible_to, search_messages; DROP TABLE thread_members, threads;
--   ALTER TABLE activities DROP COLUMN <added columns>; (no data outside the new columns is touched)

BEGIN;

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS audience text NULL CHECK (audience IN ('team','sales','production','crew')),
  ADD COLUMN IF NOT EXISTS origin text NULL CHECK (origin IN ('human','system')),
  ADD COLUMN IF NOT EXISTS restricted_pricing boolean NULL,
  ADD COLUMN IF NOT EXISTS priority text NULL CHECK (priority IN ('fyi','needs_reply','urgent')),
  ADD COLUMN IF NOT EXISTS reply_to_id uuid NULL REFERENCES public.activities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_id uuid NULL,
  ADD COLUMN IF NOT EXISTS source text NULL,
  ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[] NULL,
  ADD COLUMN IF NOT EXISTS production_job_id uuid NULL REFERENCES public.production_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_order_id uuid NULL REFERENCES public.work_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thread_id uuid NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_by uuid NULL,
  ADD COLUMN IF NOT EXISTS legacy_ref jsonb NULL,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pinned_by uuid NULL,
  ADD COLUMN IF NOT EXISTS pin_scope text NULL CHECK (pin_scope IN ('customer','deal')),
  ADD COLUMN IF NOT EXISTS pin_expires_at timestamptz NULL;

CREATE UNIQUE INDEX IF NOT EXISTS activities_client_id_uq ON public.activities (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activities_opp_created_idx ON public.activities (opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activities_customer_created_idx ON public.activities (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activities_thread_created_idx ON public.activities (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activities_body_trgm ON public.activities USING gin (body extensions.gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id),
  kind text NOT NULL CHECK (kind IN ('deal','prospect')),
  -- Deleting a deal/lead removes its thread (the old delete routes already remove the deal's activities).
  opportunity_id uuid NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  lead_id uuid NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid NULL REFERENCES public.customers(id) ON DELETE SET NULL,
  last_message_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS threads_deal_uq ON public.threads (opportunity_id) WHERE kind = 'deal';
CREATE UNIQUE INDEX IF NOT EXISTS threads_prospect_uq ON public.threads (lead_id) WHERE kind = 'prospect';

CREATE TABLE IF NOT EXISTS public.thread_members (
  thread_id uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  reason text NULL,
  muted_until timestamptz NULL,
  last_read_at timestamptz NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS thread_members_user_idx ON public.thread_members (user_id);

-- Service-role only (no policies): every read/write goes through lib/threads.
ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS thread_id uuid NULL REFERENCES public.threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activity_id uuid NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS priority text NULL CHECK (priority IN ('fyi','needs_reply','urgent')),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS resolution text NULL,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz NULL;
CREATE INDEX IF NOT EXISTS notifications_waiting_idx ON public.notifications (recipient_user_id, resolved_at, priority);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ui_prefs jsonb NULL;

-- Who may read a message. Mirrors lib/threads/visibility.ts (canReadMessage); the TS side is the
-- one the app uses (service client), this one backs browser-client reads (RLS) and search.
-- Fails CLOSED: a role it does not positively recognise (sub, custom-only) reads nothing with an audience. Mirrors `recognized`
-- in lib/threads/viewer.ts.
CREATE OR REPLACE FUNCTION public.message_visible_to(
  p_viewer uuid, p_audience text, p_restricted boolean, p_org uuid, p_opportunity uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH v AS (
    SELECT u.id, u.org_id, lower(trim(u.role::text)) AS role, u.custom_role_id, coalesce(u.is_super_admin, false) AS sa, u.active,
           lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')) AS crname
    FROM users u LEFT JOIN custom_roles cr ON cr.id = u.custom_role_id
    WHERE u.id = p_viewer
  ),
  d AS (SELECT o.owner_user_id, o.setter_user_id FROM opportunities o WHERE o.id = p_opportunity),
  f AS (
    SELECT
      v.org_id = p_org AND coalesce(v.active, true) AS in_org,
      (v.sa OR v.role IN ('owner','admin')) AS owner_like,
      public.can_view_job_board(v.id) AS job_board,
      v.role IN ('manager','sales_manager','regional_manager','operations') AS manager_like,
      (v.role IN ('setter','canvasser')) AS base_setter,
      (v.role IN ('rep','sales_rep','closer')) AS closer_role,
      (v.role IN ('rep','sales_rep','closer') AND (EXISTS (SELECT 1 FROM d WHERE d.owner_user_id = v.id)
        OR EXISTS (SELECT 1 FROM scheduled_appointments sa WHERE sa.opportunity_id = p_opportunity AND sa.closer_user_id = v.id))) AS own_closer,
      (v.role IN ('inside_sales','inside sales','call_center')
        OR v.crname LIKE '%inside sales%' OR v.crname LIKE '%inside_sales%' OR v.crname LIKE '%call center%' OR v.crname LIKE '%call_center%') AS inside_like,
      v.role IN ('admin','owner','operations','manager','sales_manager','regional_manager','rep','sales_rep','closer') OR v.sa AS pricing_role,
      (EXISTS (SELECT 1 FROM d WHERE d.owner_user_id = v.id OR d.setter_user_id = v.id)
        OR EXISTS (SELECT 1 FROM scheduled_appointments sa WHERE sa.opportunity_id = p_opportunity AND (sa.closer_user_id = v.id OR sa.canvasser_user_id = v.id))) AS own_deal
    FROM v
  ),
  g AS (SELECT f.*, (f.owner_like OR f.job_board OR f.manager_like OR f.closer_role OR f.base_setter OR f.inside_like) AS recognized,
        (f.base_setter AND NOT f.inside_like) AS setter_like, (f.pricing_role AND NOT f.base_setter AND NOT f.inside_like) AS pricing_ok,
        -- Field roles (setters, canvassers, inside sales / call center): NEVER Production/Crew, whatever job-board grant they were given.
        (f.base_setter OR f.inside_like) AS field_role FROM f)
  SELECT CASE
    WHEN p_audience IS NULL THEN true                       -- legacy rows: unchanged behaviour
    WHEN NOT coalesce((SELECT in_org FROM g), false) THEN false
    WHEN coalesce((SELECT owner_like FROM g), false) THEN true
    WHEN NOT coalesce((SELECT recognized FROM g), false) THEN false     -- unknown roles (sub, custom-only) see nothing
    WHEN p_restricted IS TRUE AND NOT coalesce((SELECT pricing_ok FROM g), false) THEN false
    WHEN p_audience IN ('production','crew') THEN
      coalesce((SELECT NOT field_role AND (job_board OR manager_like OR own_closer) FROM g), false)
    ELSE  -- team | sales
      CASE WHEN coalesce((SELECT setter_like OR closer_role FROM g), false) THEN (p_opportunity IS NOT NULL AND coalesce((SELECT own_deal FROM g), false))   -- no deal = not theirs (same as canReadRowOnDeal 'none')
           ELSE true END
  END;
$$;
REVOKE ALL ON FUNCTION public.message_visible_to(uuid, text, boolean, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_visible_to(uuid, text, boolean, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can read activities" ON public.activities;
CREATE POLICY "Users can read activities" ON public.activities
  FOR SELECT TO authenticated
  USING (
    org_id = get_user_org_id(auth.uid())
    AND referral_partner_id IS NULL
    AND (audience IS NULL OR public.message_visible_to((SELECT auth.uid()), audience, restricted_pricing, org_id, opportunity_id))
  );

-- Browser (PostgREST) writes must not be able to forge audiences, pin, flag or soft-delete: those only go through
-- lib/threads (service role). A user's own legacy-style rows (audience NULL) still work exactly as before.
DROP POLICY IF EXISTS "Users can insert activities" ON public.activities;
CREATE POLICY "Users can insert activities" ON public.activities
  FOR INSERT
  WITH CHECK (
    org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid()
    AND audience IS NULL AND restricted_pricing IS NULL AND priority IS NULL AND origin IS NULL
    AND pinned_at IS NULL AND deleted_at IS NULL AND mentioned_user_ids IS NULL AND legacy_ref IS NULL
  );
DROP POLICY IF EXISTS "Users can update own activities" ON public.activities;
CREATE POLICY "Users can update own activities" ON public.activities
  FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid() AND audience IS NULL)
  WITH CHECK (
    org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid()
    AND audience IS NULL AND restricted_pricing IS NULL AND priority IS NULL AND origin IS NULL
    AND pinned_at IS NULL AND deleted_at IS NULL AND mentioned_user_ids IS NULL AND legacy_ref IS NULL
  );
DROP POLICY IF EXISTS "Users can delete own activities" ON public.activities;
CREATE POLICY "Users can delete own activities" ON public.activities
  FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND user_id = auth.uid() AND audience IS NULL);

-- Typo-tolerant message search that applies the SAME visibility function. Service role only:
-- the caller passes the viewer, so a leaked key cannot search as someone else from the browser.
CREATE OR REPLACE FUNCTION public.search_messages(p_org uuid, p_viewer uuid, p_q text, p_limit int DEFAULT 20)
RETURNS TABLE (id uuid, opportunity_id uuid, lead_id uuid, customer_id uuid, body text, created_at timestamptz, score real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
  WITH q AS (
    SELECT lower(btrim(p_q)) AS t,
           '%' || replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
  )
  SELECT a.id, a.opportunity_id, a.lead_id, a.customer_id, a.body, a.created_at,
         greatest(word_similarity(q.t, lower(a.body)), CASE WHEN lower(a.body) LIKE q.pat THEN 1 ELSE 0 END)::real AS score
  FROM activities a, q
  WHERE a.org_id = p_org
    AND a.deleted_at IS NULL
    AND a.referral_partner_id IS NULL
    AND a.audience IS NOT NULL
    AND a.opportunity_id IS NOT NULL            -- lead/customer-only notes have no deal to check ownership against
    AND coalesce(a.origin, 'human') = 'human'
    AND length(q.t) >= 2
    AND (lower(a.body) LIKE q.pat OR q.t <% lower(a.body))
    AND public.message_visible_to(p_viewer, a.audience, a.restricted_pricing, a.org_id, a.opportunity_id)
  ORDER BY score DESC, a.created_at DESC
  LIMIT greatest(1, least(p_limit, 50));
$$;
REVOKE ALL ON FUNCTION public.search_messages(uuid, uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_messages(uuid, uuid, text, int) TO service_role;

COMMIT;
