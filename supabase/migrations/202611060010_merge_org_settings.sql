-- Atomic per-key merge of top-level orgs.settings keys (Known Redundancy #25, lib/org-settings.ts mergeOrgSettings).
--
-- Settings writers used to read the whole settings object, change one key in JS and write the whole object back, so a
-- concurrent save of another key could be lost. This sets ONLY the given top-level keys inside one UPDATE:
-- settings = settings || p_set. Every other key is left as the row holds it at that moment. First user: the job
-- catch-up switch and stuck-days (`job_catch_up_enabled`, `job_catch_up_stuck_days`). Brand keeps its own nested merge
-- (merge_org_brand_settings); other writers move onto this one when they are next touched.
--
-- NOT APPLIED. Additive and safe to apply any time: until it exists, the app falls back to read -> merge -> write.
-- Service role only (each API route checks the caller before calling it).

create or replace function public.merge_org_settings(p_org_id uuid, p_set jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orgs
     set settings = (case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end)
                    || (case when jsonb_typeof(p_set) = 'object' then p_set else '{}'::jsonb end)
   where id = p_org_id;
$$;

revoke all on function public.merge_org_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.merge_org_settings(uuid, jsonb) to service_role;
