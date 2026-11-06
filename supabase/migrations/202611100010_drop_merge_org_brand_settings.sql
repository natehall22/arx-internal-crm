-- Drop the brand-only settings merge. Its job is done by the generic merge_org_settings (202611060010) with
-- p_path '{brand}'.
--
-- APPLY ONLY AFTER the code using merge_org_settings is deployed (lib/org-brand.ts saveBrandSettings). Applying it
-- earlier makes brand saves fall back to the slower read → merge → write path until that code ships (they still work).
--
-- NOT APPLIED.

drop function if exists public.merge_org_brand_settings(uuid, jsonb, text[]);
