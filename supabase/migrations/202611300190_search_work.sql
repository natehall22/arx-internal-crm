-- Cmd-K keyword search: find a job (or a customer on a plan) by what the WORK is, not just its number / address
-- ("sprinkler" finds every job whose trade, sold line items, work orders or notes mention it). 2026-11-30.
-- Additive: 3 trigram indexes + ONE new function. `search_all` (migration 202610240050) is NOT touched, so the number /
-- address / name results every company already gets are byte-identical; the app merges these extra hits in and says why each one
-- matched ("Line: Sprinkler repair").
--
-- What it reads, per kind the caller may search (the route decides that, exactly as for search_all):
--   job      production_jobs whose  (a) trade label matches (org_trades via job_type or a work order's trade),
--                                    (b) sold proposal line item name / description matches (linked, accepted, or the project's accepted proposal),
--                                    (c) work order title / description matches,
--                                    (d) a human job note matches — ONLY notes the viewer may read (arx_private.message_visible_to, the
--                                        same evaluator as search_messages), never a restricted Production / pricing note.
--   customer customers with a service plan whose name / description matches.
-- Org-scoped on every table; p_owner narrows to a rep's own records like search_all. At most p_limit hits PER KIND.
-- SECURITY DEFINER (like search_messages) because the note rule lives in the private schema; callable by the service role only.
-- Deploy: apply BEFORE the code (the code tolerates the function being absent and just shows the old results).
-- Rollback: DROP FUNCTION public.search_work(uuid, uuid, text, text[], uuid, int);
--           DROP INDEX idx_search_li_text, idx_search_wo_text, idx_search_plan_text;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_search_li_text   ON public.proposal_line_items USING gin (lower(coalesce(name, '') || ' ' || coalesce(description, '')) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_wo_text   ON public.work_orders         USING gin (lower(coalesce(title, '') || ' ' || coalesce(description, '')) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_plan_text ON public.service_plans       USING gin (lower(coalesce(name, '') || ' ' || coalesce(description, '')) extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_work(
  p_org    uuid,
  p_viewer uuid,
  p_q      text,
  p_kinds  text[],
  p_owner  uuid DEFAULT NULL,
  p_limit  int  DEFAULT 5
)
RETURNS TABLE (kind text, id uuid, title text, subtitle text, matched text, score real)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH q AS (
    SELECT lower(btrim(p_q)) AS t,
           '%' || replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
  ),
  trades AS (
    SELECT t.slug, t.label FROM org_trades t, q
    WHERE 'job' = ANY (p_kinds) AND length(q.t) >= 3 AND t.org_id = p_org
      AND (lower(t.label) LIKE q.pat OR lower(t.slug) LIKE q.pat)
  ),
  li AS (
    SELECT l.proposal_id, l.name,
           greatest(word_similarity(q.t, lower(coalesce(l.name, '') || ' ' || coalesce(l.description, ''))),
                    CASE WHEN lower(coalesce(l.name, '') || ' ' || coalesce(l.description, '')) LIKE q.pat THEN 0.9 ELSE 0 END) AS sc
    FROM proposal_line_items l, q
    WHERE 'job' = ANY (p_kinds) AND length(q.t) >= 3 AND l.org_id = p_org
      AND (lower(coalesce(l.name, '') || ' ' || coalesce(l.description, '')) LIKE q.pat
           OR q.t <% lower(coalesce(l.name, '') || ' ' || coalesce(l.description, '')))
  ),
  work_hits AS (
    -- (a) trade label: the job's own type, or a crew (work order) trade on the job
    SELECT j.id AS job_id, 'Trade: ' || tr.label AS why, 0.88::real AS sc
    FROM trades tr JOIN production_jobs j ON j.org_id = p_org AND j.job_type = tr.slug
    UNION ALL
    SELECT w.job_id, 'Trade: ' || tr.label, 0.88::real
    FROM trades tr JOIN work_orders w ON w.org_id = p_org AND w.trade = tr.slug AND w.job_id IS NOT NULL
    UNION ALL
    -- (b) sold line items
    SELECT j.id, 'Line: ' || left(li.name, 60), li.sc::real
    FROM li JOIN proposals p ON p.id = li.proposal_id AND p.org_id = p_org
            JOIN production_jobs j ON j.org_id = p_org
             AND (j.linked_proposal_id = p.id OR j.accepted_proposal_id = p.id
                  OR (j.project_id IS NOT NULL AND j.project_id = p.project_id AND p.accepted_at IS NOT NULL))
    UNION ALL
    -- (c) work orders on a job
    SELECT w.job_id, 'Work order: ' || left(w.title, 60),
           greatest(word_similarity(q.t, lower(coalesce(w.title, '') || ' ' || coalesce(w.description, ''))),
                    CASE WHEN lower(coalesce(w.title, '') || ' ' || coalesce(w.description, '')) LIKE q.pat THEN 0.9 ELSE 0 END)::real
    FROM work_orders w, q
    WHERE 'job' = ANY (p_kinds) AND length(q.t) >= 3 AND w.org_id = p_org AND w.job_id IS NOT NULL
      AND (lower(coalesce(w.title, '') || ' ' || coalesce(w.description, '')) LIKE q.pat
           OR q.t <% lower(coalesce(w.title, '') || ' ' || coalesce(w.description, '')))
    UNION ALL
    -- (d) job notes the viewer may read (same visibility evaluator as search_messages)
    SELECT a.production_job_id, 'Note: ' || left(regexp_replace(a.body, '\s+', ' ', 'g'), 60),
           greatest(word_similarity(q.t, lower(a.body)), CASE WHEN a.body ILIKE q.pat THEN 0.8 ELSE 0 END)::real
    FROM activities a, q
    WHERE 'job' = ANY (p_kinds) AND length(q.t) >= 3 AND a.org_id = p_org
      AND a.production_job_id IS NOT NULL AND a.deleted_at IS NULL AND a.referral_partner_id IS NULL
      AND a.audience IS NOT NULL AND coalesce(a.origin, 'human') = 'human'
      AND (a.body ILIKE q.pat OR q.t <% a.body)
      AND arx_private.message_visible_to(p_viewer, a.audience, a.restricted_pricing, a.org_id, a.opportunity_id)
  ),
  job_best AS (
    SELECT DISTINCT ON (h.job_id) h.job_id, h.why, h.sc
    FROM work_hits h WHERE h.job_id IS NOT NULL
    ORDER BY h.job_id, h.sc DESC
  ),
  job_rows AS (
    SELECT 'job'::text AS kind, j.id, 'Job ' || j.job_number AS title, concat_ws(' · ', j.address_text, j.status) AS subtitle,
           b.why AS matched, b.sc AS score,
           row_number() OVER (ORDER BY b.sc DESC, j.job_number) AS rn
    FROM job_best b JOIN production_jobs j ON j.id = b.job_id
    WHERE j.org_id = p_org AND j.status <> 'cancelled' AND (p_owner IS NULL OR j.salesperson_id = p_owner)
  ),
  plan_best AS (
    SELECT DISTINCT ON (sp.customer_id) sp.customer_id, 'Plan: ' || left(sp.name, 60) AS why,
           greatest(word_similarity(q.t, lower(coalesce(sp.name, '') || ' ' || coalesce(sp.description, ''))),
                    CASE WHEN lower(coalesce(sp.name, '') || ' ' || coalesce(sp.description, '')) LIKE q.pat THEN 0.85 ELSE 0 END)::real AS sc
    FROM service_plans sp, q
    WHERE 'customer' = ANY (p_kinds) AND length(q.t) >= 3 AND sp.org_id = p_org
      AND (lower(coalesce(sp.name, '') || ' ' || coalesce(sp.description, '')) LIKE q.pat
           OR q.t <% lower(coalesce(sp.name, '') || ' ' || coalesce(sp.description, '')))
    ORDER BY sp.customer_id, 3 DESC
  ),
  customer_rows AS (
    SELECT 'customer'::text AS kind, c.id, c.name AS title, concat_ws(' · ', c.address_text, c.phone) AS subtitle,
           b.why AS matched, b.sc AS score,
           row_number() OVER (ORDER BY b.sc DESC, c.name) AS rn
    FROM plan_best b JOIN customers c ON c.id = b.customer_id
    WHERE c.org_id = p_org
      AND (p_owner IS NULL OR c.id IN (SELECT pr.customer_id FROM projects pr WHERE pr.org_id = p_org AND pr.owner_user_id = p_owner AND pr.customer_id IS NOT NULL))
  )
  SELECT r.kind, r.id, r.title, r.subtitle, r.matched, r.score::real FROM job_rows r WHERE r.rn <= greatest(1, least(p_limit, 20))
  UNION ALL
  SELECT r.kind, r.id, r.title, r.subtitle, r.matched, r.score::real FROM customer_rows r WHERE r.rn <= greatest(1, least(p_limit, 20));
$$;

REVOKE ALL ON FUNCTION public.search_work(uuid, uuid, text, text[], uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_work(uuid, uuid, text, text[], uuid, int) TO service_role;
