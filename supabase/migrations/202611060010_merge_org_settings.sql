-- ONE atomic per-key merge for orgs.settings (Known Redundancy #25; lib/org-settings.ts mergeOrgSettings).
--
-- Settings writers used to read the whole settings object, change one key in JS and write it all back, so a concurrent
-- save of another key could be lost. This changes ONLY the given keys inside one UPDATE, at one place in settings:
--   p_path '{}'      → the top level            (job catch-up switch + stuck days)
--   p_path '{brand}' → settings.brand            (company brand fields, lib/org-brand.ts saveBrandSettings)
-- target = (target - p_remove) || p_set; every other key is left as the row holds it at that moment. A missing or
-- non-object target (null settings, no brand yet) starts from {}. Paths deeper than one key are refused.
-- Raises if no org row matched, so a typo'd org id is an error, not a silent no-op.
--
-- Replaces merge_org_brand_settings (202611050010); that one is dropped by a LATER migration
-- (202611100010_drop_merge_org_brand_settings.sql) once the code calling this is deployed.
--
-- NOT APPLIED. Additive and safe to apply any time: until it exists, the app falls back to read → merge → write.
-- Service role only (each API route checks the caller before calling it).

create or replace function public.merge_org_settings(p_org_id uuid, p_path text[], p_set jsonb, p_remove text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text[] := coalesce(p_path, '{}'::text[]);
  v_set jsonb := case when jsonb_typeof(p_set) = 'object' then p_set else '{}'::jsonb end;
  v_remove text[] := coalesce(p_remove, '{}'::text[]);
begin
  if coalesce(array_length(v_path, 1), 0) > 1 then
    raise exception 'merge_org_settings: path % is deeper than one key', v_path using errcode = '22023';
  end if;

  if coalesce(array_length(v_path, 1), 0) = 0 then
    update public.orgs
       set settings = ((case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end) - v_remove) || v_set
     where id = p_org_id;
  else
    update public.orgs
       set settings = jsonb_set(
             case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end,
             v_path,
             ((case when jsonb_typeof(settings #> v_path) = 'object' then settings #> v_path else '{}'::jsonb end) - v_remove) || v_set,
             true
           )
     where id = p_org_id;
  end if;

  if not found then
    raise exception 'merge_org_settings: no organization %', p_org_id using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.merge_org_settings(uuid, text[], jsonb, text[]) from public, anon, authenticated;
grant execute on function public.merge_org_settings(uuid, text[], jsonb, text[]) to service_role;
