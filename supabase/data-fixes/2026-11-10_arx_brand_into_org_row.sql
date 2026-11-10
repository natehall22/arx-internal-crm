-- Store ARX's company identity on ARX's own org row, so the code fallback (lib/org-brand.ts) can be neutral.
--
-- WHY: until now every missing brand field fell back to ARX's strings in code (DEFAULT_ORG_BRAND), so another company's
-- copy could print ARX. The code now falls back to ARX's strings ONLY on a deployment without DEPLOYMENT_ORG_ID (= ARX
-- prod today). This fix writes those same strings into ARX's row, so ARX's output stays byte-identical once ARX's
-- deployment sets DEPLOYMENT_ORG_ID too and the legacy fallback is deleted.
--
-- WHAT (ARX's org 9089d4ad-f46c-405b-9798-6751d45a7051 only; nothing else is read or written):
--   - orgs.name / phone / email / address: filled ONLY where blank (today they are all set — expect no column change).
--   - orgs.settings.brand: legalName, shortName, website, serviceArea added ONLY where missing/blank (an owner's edit wins),
--     plus the contract spellings, each only while the value it replaces is still the original:
--       documentLegalName 'ARX Roofing & Exteriors LLC'   (only if legalName is 'ARX Roofing & Exteriors, LLC')
--       documentAddress   '4101 Woodbury Terrace NW\nConcord, NC 28027' (only if address is '4101 Woodbury Ter NW\nConcord, NC 28027')
--       serviceRegion     'Charlotte metro'               (only if serviceArea is 'Charlotte / Kannapolis, NC'; website-estimate
--                                                        out-of-area message, which said "Charlotte metro" in code before)
--     — exactly the rule brandDocument() applied in code before.
--   Every other settings key is untouched (jsonb merge of settings.brand only).
--
-- HOW THIS FILE RUNS (running it as-is writes nothing to any existing table):
--   1. Running the whole file (re)creates the functions + backup table in `release_backups` and calls the PREVIEW.
--   2. To apply, run only:   SELECT release_backups.arx_brand_into_org_row('apply');
--   3. One-command undo:     SELECT release_backups.undo_arx_brand_into_org_row();
-- ORDER: any time after the neutral-brand code is deployed (the code reads these keys either way). Must be applied BEFORE
-- ARX's deployment sets DEPLOYMENT_ORG_ID, and before SMTP_FROM is relied on (set SMTP_FROM='ARX Roofing <info@arxroofing.com>').
-- Re-running apply is a no-op once everything is stored.
--
-- Backup + undo: the previous AND applied values of the four columns and of settings.brand are recorded. Undo restores a
-- value only where the row still holds exactly what this fix wrote; anything edited since is left alone.

CREATE SCHEMA IF NOT EXISTS release_backups;
REVOKE ALL ON SCHEMA release_backups FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA release_backups FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA release_backups FROM authenticated; END IF;
END $$;

CREATE TABLE IF NOT EXISTS release_backups.arx_brand_into_org_row (
  run_id          uuid        NOT NULL PRIMARY KEY,
  org_id          uuid        NOT NULL,
  prev_name       text        NULL,
  prev_phone      text        NULL,
  prev_email      text        NULL,
  prev_address    text        NULL,
  prev_brand      jsonb       NULL,     -- settings->'brand' before (NULL = key absent)
  applied_name    text        NULL,
  applied_phone   text        NULL,
  applied_email   text        NULL,
  applied_address text        NULL,
  applied_brand   jsonb       NOT NULL,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  undone_at       timestamptz NULL
);

CREATE OR REPLACE FUNCTION release_backups.arx_brand_into_org_row(p_mode text DEFAULT 'preview')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  c_org      constant uuid := '9089d4ad-f46c-405b-9798-6751d45a7051';
  c_name     constant text := 'ARX Roofing & Exteriors';
  c_legal    constant text := 'ARX Roofing & Exteriors, LLC';
  c_phone    constant text := '(704) 313-8834';
  c_email    constant text := 'info@arxroofing.com';
  c_address  constant text := E'4101 Woodbury Ter NW\nConcord, NC 28027';
  c_doc_addr constant text := E'4101 Woodbury Terrace NW\nConcord, NC 28027';
  o record; v_brand jsonb; v_new_brand jsonb; v_add jsonb := '{}'::jsonb;
  v_name text; v_phone text; v_email text; v_address text; v_legal text;
  v_run uuid := gen_random_uuid();
  blank constant text := '^\s*$';
BEGIN
  IF p_mode NOT IN ('preview', 'apply') THEN RAISE EXCEPTION 'mode must be preview or apply'; END IF;

  SELECT id, name, phone, email, address, settings INTO o FROM orgs WHERE id = c_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ARX org % not found; nothing written', c_org; END IF;

  v_name    := CASE WHEN coalesce(o.name, '')    ~ blank THEN c_name    ELSE o.name    END;
  v_phone   := CASE WHEN coalesce(o.phone, '')   ~ blank THEN c_phone   ELSE o.phone   END;
  v_email   := CASE WHEN coalesce(o.email, '')   ~ blank THEN c_email   ELSE o.email   END;
  v_address := CASE WHEN coalesce(o.address, '') ~ blank THEN c_address ELSE o.address END;

  v_brand := CASE WHEN jsonb_typeof(o.settings -> 'brand') = 'object' THEN o.settings -> 'brand' ELSE '{}'::jsonb END;

  -- a key counts as stored only when it is a non-blank string (lib/org-brand.ts `present`)
  IF coalesce(v_brand ->> 'legalName', '') ~ blank THEN v_add := v_add || jsonb_build_object('legalName', c_legal); END IF;
  IF coalesce(v_brand ->> 'shortName', '') ~ blank THEN v_add := v_add || jsonb_build_object('shortName', 'ARX'); END IF;
  IF coalesce(v_brand ->> 'website', '') ~ blank THEN v_add := v_add || jsonb_build_object('website', 'arxroofing.com'); END IF;
  IF coalesce(v_brand ->> 'serviceArea', '') ~ blank THEN v_add := v_add || jsonb_build_object('serviceArea', 'Charlotte / Kannapolis, NC'); END IF;
  IF coalesce(v_brand ->> 'serviceRegion', '') ~ blank
     AND coalesce(NULLIF(btrim(v_brand ->> 'serviceArea'), ''), 'Charlotte / Kannapolis, NC') = 'Charlotte / Kannapolis, NC' THEN
    v_add := v_add || jsonb_build_object('serviceRegion', 'Charlotte metro');
  END IF;

  v_legal := btrim(coalesce(NULLIF(btrim(v_brand ->> 'legalName'), ''), c_legal));
  IF coalesce(v_brand ->> 'documentLegalName', '') ~ blank AND v_legal = c_legal THEN
    v_add := v_add || jsonb_build_object('documentLegalName', 'ARX Roofing & Exteriors LLC');
  END IF;
  IF coalesce(v_brand ->> 'documentAddress', '') ~ blank AND regexp_replace(v_address, '^\s+|\s+$', '', 'g') = c_address THEN
    v_add := v_add || jsonb_build_object('documentAddress', c_doc_addr);
  END IF;

  v_new_brand := v_brand || v_add;

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('mode', 'preview', 'wrote_nothing', true, 'org_id', c_org,
      'columns_to_fill', to_jsonb(array_remove(ARRAY[
          CASE WHEN v_name    IS DISTINCT FROM o.name    THEN 'name'    END,
          CASE WHEN v_phone   IS DISTINCT FROM o.phone   THEN 'phone'   END,
          CASE WHEN v_email   IS DISTINCT FROM o.email   THEN 'email'   END,
          CASE WHEN v_address IS DISTINCT FROM o.address THEN 'address' END], NULL)),
      'brand_keys_to_add', v_add, 'brand_now', o.settings -> 'brand');
  END IF;

  IF v_add = '{}'::jsonb AND v_name IS NOT DISTINCT FROM o.name AND v_phone IS NOT DISTINCT FROM o.phone
     AND v_email IS NOT DISTINCT FROM o.email AND v_address IS NOT DISTINCT FROM o.address THEN
    RETURN jsonb_build_object('mode', 'apply', 'nothing_to_do', true, 'org_id', c_org);
  END IF;

  INSERT INTO release_backups.arx_brand_into_org_row (run_id, org_id, prev_name, prev_phone, prev_email, prev_address, prev_brand,
                                                      applied_name, applied_phone, applied_email, applied_address, applied_brand)
  VALUES (v_run, c_org, o.name, o.phone, o.email, o.address, o.settings -> 'brand', v_name, v_phone, v_email, v_address, v_new_brand);

  UPDATE orgs
     SET name = v_name, phone = v_phone, email = v_email, address = v_address,
         settings = jsonb_set(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END, '{brand}', v_new_brand, true),
         updated_at = now()
   WHERE id = c_org;

  RETURN jsonb_build_object('mode', 'apply', 'run_id', v_run, 'org_id', c_org, 'brand_keys_added', v_add,
                            'undo', 'SELECT release_backups.undo_arx_brand_into_org_row();');
END;
$$;

CREATE OR REPLACE FUNCTION release_backups.undo_arx_brand_into_org_row() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE b record; o record; v_cols int := 0; v_brand int := 0; v_left int := 0; v_settings jsonb;
BEGIN
  FOR b IN SELECT * FROM release_backups.arx_brand_into_org_row WHERE undone_at IS NULL ORDER BY applied_at DESC LOOP
    SELECT id, name, phone, email, address, settings INTO o FROM orgs WHERE id = b.org_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    -- each column back only if it still holds what this fix wrote
    UPDATE orgs SET
      name    = CASE WHEN o.name    IS NOT DISTINCT FROM b.applied_name    THEN b.prev_name    ELSE name    END,
      phone   = CASE WHEN o.phone   IS NOT DISTINCT FROM b.applied_phone   THEN b.prev_phone   ELSE phone   END,
      email   = CASE WHEN o.email   IS NOT DISTINCT FROM b.applied_email   THEN b.prev_email   ELSE email   END,
      address = CASE WHEN o.address IS NOT DISTINCT FROM b.applied_address THEN b.prev_address ELSE address END
    WHERE id = b.org_id;
    v_cols := v_cols + 1;
    -- settings.brand back only if it is still exactly what this fix wrote
    IF (o.settings -> 'brand') IS NOT DISTINCT FROM b.applied_brand THEN
      v_settings := CASE WHEN jsonb_typeof(o.settings) = 'object' THEN o.settings ELSE '{}'::jsonb END;
      UPDATE orgs SET settings = CASE WHEN b.prev_brand IS NULL THEN v_settings - 'brand'
                                      ELSE jsonb_set(v_settings, '{brand}', b.prev_brand, true) END
       WHERE id = b.org_id;
      v_brand := v_brand + 1;
    ELSE
      v_left := v_left + 1;
    END IF;
    UPDATE release_backups.arx_brand_into_org_row SET undone_at = now() WHERE run_id = b.run_id;
  END LOOP;
  RETURN jsonb_build_object('runs_undone', v_cols, 'brand_restored', v_brand, 'brand_changed_since_left_alone', v_left);
END;
$$;

-- Default action when this file is run: PREVIEW ONLY (writes nothing to any existing table).
SELECT release_backups.arx_brand_into_org_row('preview');
-- To apply (after checking the preview):   SELECT release_backups.arx_brand_into_org_row('apply');
-- To undo, one command:                     SELECT release_backups.undo_arx_brand_into_org_row();
