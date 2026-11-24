-- Private notes on a deal / job thread (owner decision, Nathan 2026-11-23). 2026-12-01.
-- A company can keep a note from everyone except its owners, the writer and the people the owner lists on that note.
-- Additive: ONE nullable column, the audience check widened by one value, the visibility evaluator gains a 7-argument form, and the
-- four places that call it with a row (the activities read policy, search_messages, search_work) pass the two new columns. Nothing
-- else changes: every existing audience branch of the evaluator is copied unchanged from 202611120060, and a row with any other
-- audience reads exactly as before. No private row exists until an owner writes one, so a company that never does is unchanged.
-- Deploy: apply BEFORE the code (the thread reader selects visible_user_ids). Safe to apply with the old code running.
-- Not touched on purpose: customer_last_contact (only call / text / email / visit rows; postMessage refuses a private contact) and the
-- 5-argument evaluator callers elsewhere (the old form now answers a private row for owners only, i.e. fails closed).
-- Rollback: delete the private rows (or re-audience them), then re-create the audience check without 'private', drop the column,
--   restore the 5-argument evaluator body from 202611120060, the read policy from 202610270010, search_messages from 202610280010,
--   search_work from 202611300190, and DROP FUNCTION the two 7-argument functions.

alter table public.activities add column if not exists visible_user_ids uuid[] null;

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.activities'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%audience = any%' and pg_get_constraintdef(oid) not ilike '%origin%'
  loop
    execute format('alter table public.activities drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.activities add constraint activities_audience_check check (audience is null or audience in ('team', 'sales', 'production', 'crew', 'customer', 'private'));
-- The list only means something on a private message.
alter table public.activities add constraint activities_visible_user_ids_private check (visible_user_ids is null or audience = 'private');

-- The evaluator with the message's own people list + writer. Same rule as 202611120060 plus the private branch.
create or replace function arx_private.message_visible_to(
  p_viewer uuid, p_audience text, p_restricted boolean, p_org uuid, p_opportunity uuid, p_allowed uuid[], p_author uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  with v as (
    select u.id, u.org_id, lower(trim(u.role::text)) as role, u.custom_role_id, coalesce(u.is_super_admin, false) as sa, u.active,
           lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')) as crname
    from users u left join custom_roles cr on cr.id = u.custom_role_id
    where u.id = p_viewer
  ),
  d as (select o.owner_user_id, o.setter_user_id from opportunities o where o.id = p_opportunity),
  f as (
    select
      v.org_id = p_org and coalesce(v.active, true) as in_org,
      (v.sa or v.role in ('owner','admin')) as owner_like,
      arx_private.can_view_job_board(v.id) as job_board,
      v.role in ('manager','sales_manager','regional_manager','operations') as manager_like,
      (v.role in ('setter','canvasser')) as base_setter,
      (v.role in ('rep','sales_rep','closer')) as closer_role,
      (v.role in ('rep','sales_rep','closer') and (exists (select 1 from d where d.owner_user_id = v.id)
        or exists (select 1 from scheduled_appointments sa where sa.opportunity_id = p_opportunity and sa.closer_user_id = v.id))) as own_closer,
      (v.role in ('inside_sales','inside sales','call_center')
        or v.crname like '%inside sales%' or v.crname like '%inside_sales%' or v.crname like '%call center%' or v.crname like '%call_center%') as inside_like,
      v.role in ('admin','owner','operations','manager','sales_manager','regional_manager','rep','sales_rep','closer') or v.sa as pricing_role,
      arx_private.is_field_role(v.role, v.crname) as field_role,
      (exists (select 1 from d where d.owner_user_id = v.id or d.setter_user_id = v.id)
        or exists (select 1 from scheduled_appointments sa where sa.opportunity_id = p_opportunity and (sa.closer_user_id = v.id or sa.canvasser_user_id = v.id))) as own_deal
    from v
  ),
  g as (select f.*, (f.owner_like or f.job_board or f.manager_like or f.closer_role or f.base_setter or f.inside_like) as recognized,
        (f.base_setter and not f.inside_like) as setter_like, (f.pricing_role and not f.field_role) as pricing_ok from f)
  select case
    when p_audience is null then true                       -- legacy rows: unchanged behaviour
    when not coalesce((select in_org from g), false) then false
    when coalesce((select owner_like from g), false) then true
    -- private (2026-12-01): owners (above), the people the owner listed on the message and its writer. Before the role checks, so a
    -- listed field role / custom role reads it; never scoped to the deal and never pricing-gated. No list passed = owners only.
    when p_audience = 'private' then coalesce(p_viewer = p_author or p_viewer = any(coalesce(p_allowed, '{}'::uuid[])), false)
    when not coalesce((select recognized from g), false) then false     -- unknown roles (sub, custom-only) see nothing
    when p_restricted is true and not coalesce((select pricing_ok from g), false) then false
    when p_audience in ('production','crew') then
      coalesce((select not field_role and (job_board or manager_like or own_closer) from g), false)
    when p_audience in ('team','sales','customer') then
      case when coalesce((select setter_like or closer_role from g), false) then (p_opportunity is not null and coalesce((select own_deal from g), false))   -- no deal = not theirs (same as canReadRowOnDeal 'none')
           else true end
    else false
  end;
$$;

-- The old 5-argument form keeps its signature (other callers) and now delegates: no list = only owners read a private row.
create or replace function arx_private.message_visible_to(
  p_viewer uuid, p_audience text, p_restricted boolean, p_org uuid, p_opportunity uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select arx_private.message_visible_to(p_viewer, p_audience, p_restricted, p_org, p_opportunity, null::uuid[], null::uuid);
$$;

revoke all on function arx_private.message_visible_to(uuid, text, boolean, uuid, uuid, uuid[], uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function arx_private.message_visible_to(uuid, text, boolean, uuid, uuid, uuid[], uuid) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function arx_private.message_visible_to(uuid, text, boolean, uuid, uuid, uuid[], uuid) to service_role;
  end if;
end $$;

-- Browser (RLS) form: same guard as the 5-argument public function (the caller, the server or a direct session only).
create or replace function public.message_visible_to(
  p_viewer uuid, p_audience text, p_restricted boolean, p_org uuid, p_opportunity uuid, p_allowed uuid[], p_author uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when p_viewer is not null and (p_viewer = auth.uid() or auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin'))
    then arx_private.message_visible_to(p_viewer, p_audience, p_restricted, p_org, p_opportunity, p_allowed, p_author)
    else false
  end;
$$;
revoke all on function public.message_visible_to(uuid, text, boolean, uuid, uuid, uuid[], uuid) from public, anon;
grant execute on function public.message_visible_to(uuid, text, boolean, uuid, uuid, uuid[], uuid) to authenticated, service_role;

drop policy if exists "Users can read activities" on public.activities;
create policy "Users can read activities" on public.activities
  for select to authenticated
  using (
    org_id = get_user_org_id(auth.uid())
    and referral_partner_id is null
    and (audience is null or public.message_visible_to((select auth.uid()), audience, restricted_pricing, org_id, opportunity_id, visible_user_ids, user_id))
  );

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
    AND a.opportunity_id IS NOT NULL
    AND coalesce(a.origin, 'human') = 'human'
    AND length(q.t) >= 2
    AND (lower(a.body) LIKE q.pat OR q.t <% lower(a.body))
    AND arx_private.message_visible_to(p_viewer, a.audience, a.restricted_pricing, a.org_id, a.opportunity_id, a.visible_user_ids, a.user_id)
  ORDER BY score DESC, a.created_at DESC
  LIMIT greatest(1, least(p_limit, 50));
$$;
revoke all on function public.search_messages(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.search_messages(uuid, uuid, text, int) to service_role;

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
    -- (a) trade label: the job's own type, or a crew (work order) trade on the job. Scored BELOW every text match (a trade is a
    -- weak signal: it is every job of that type), so a job whose line items / notes really mention the word ranks above it.
    SELECT j.id AS job_id, 'Trade: ' || tr.label AS why, 0.55::real AS sc
    FROM trades tr JOIN production_jobs j ON j.org_id = p_org AND j.job_type = tr.slug
    UNION ALL
    SELECT w.job_id, 'Trade: ' || tr.label, 0.55::real
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
    -- the snippet is the text AROUND the matched word (the start of the note when only a fuzzy match), with … where it is cut
    SELECT a.production_job_id,
           'Note: ' || CASE WHEN strpos(lower(regexp_replace(a.body, '\s+', ' ', 'g')), q.t) > 30 THEN '…' ELSE '' END
                    || substr(regexp_replace(a.body, '\s+', ' ', 'g'), greatest(1, strpos(lower(regexp_replace(a.body, '\s+', ' ', 'g')), q.t) - 30), 70)
                    || CASE WHEN length(regexp_replace(a.body, '\s+', ' ', 'g')) > greatest(1, strpos(lower(regexp_replace(a.body, '\s+', ' ', 'g')), q.t) - 30) + 69 THEN '…' ELSE '' END,
           greatest(word_similarity(q.t, lower(a.body)), CASE WHEN a.body ILIKE q.pat THEN 0.8 ELSE 0 END)::real
    FROM activities a, q
    WHERE 'job' = ANY (p_kinds) AND length(q.t) >= 3 AND a.org_id = p_org
      AND a.production_job_id IS NOT NULL AND a.deleted_at IS NULL AND a.referral_partner_id IS NULL
      AND a.audience IS NOT NULL AND coalesce(a.origin, 'human') = 'human'
      AND (a.body ILIKE q.pat OR q.t <% a.body)
      AND arx_private.message_visible_to(p_viewer, a.audience, a.restricted_pricing, a.org_id, a.opportunity_id, a.visible_user_ids, a.user_id)
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
revoke all on function public.search_work(uuid, uuid, text, text[], uuid, int) from public, anon, authenticated;
grant execute on function public.search_work(uuid, uuid, text, text[], uuid, int) to service_role;
