-- Atomic merge of brand fields into orgs.settings.brand (multi-company slice 1, lib/org-brand.ts saveBrandSettings).
--
-- Admin → Settings → General used to read the whole settings object, merge in JS and write it back, so a
-- concurrent save of another settings key (logo, pricing, dispositions…) could be lost. This merges ONLY the
-- given brand keys inside one UPDATE: settings.brand = (settings.brand - p_remove) || p_set; every other
-- settings key and brand key is left as the row holds it at that moment.
--
-- Additive and safe to apply any time: until it exists, the app falls back to read → merge → write.
-- Service role only (the settings API checks the caller is a super admin before calling it).

create or replace function public.merge_org_brand_settings(p_org_id uuid, p_set jsonb, p_remove text[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.orgs
     set settings = jsonb_set(
           case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end,
           '{brand}',
           (case when jsonb_typeof(settings -> 'brand') = 'object' then settings -> 'brand' else '{}'::jsonb end
              - coalesce(p_remove, '{}'::text[]))
             || case when jsonb_typeof(p_set) = 'object' then p_set else '{}'::jsonb end,
           true
         )
   where id = p_org_id;
$$;

revoke all on function public.merge_org_brand_settings(uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.merge_org_brand_settings(uuid, jsonb, text[]) to service_role;
