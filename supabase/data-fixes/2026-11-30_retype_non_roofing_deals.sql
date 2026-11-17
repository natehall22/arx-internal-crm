-- Retype 'roofing' deals and projects of NON-roofing companies to 'other'.
--
-- WHY: every opportunity was created with project_type = 'roofing' (the column default), so a lawn company's deals read as
-- "Roofing". New deals now get 'other' (lib/new-deal.ts). As of 2026-11-17: the non-roofing company's deals (preview shows real counts) and 5 demo-company
-- deals (counts will have moved; the preview gives today's). Only companies whose stored industry profile
-- (orgs.settings.profile.id) is set and is not 'roofing' are touched; a company with no stored profile is roofing and is skipped.
--
-- !! Needs migration 202611300060_project_type_other.sql applied first (the function refuses otherwise).
--
-- HOW THIS FILE RUNS (nothing is written to any existing table by running it as-is):
--   1. Running the whole file (re)creates a function + backup table in the private schema `release_backups` and calls the PREVIEW.
--   2. Apply, ONE company per run (required):   SELECT release_backups.retype_non_roofing_deals('<org id>', 'apply');
--   3. Undo, one command:                       SELECT release_backups.undo_retype_non_roofing_deals('<org id>');
--      (or  (NULL, '<run id>')  for one run — never all companies at once).
-- Backup + undo: every changed row is recorded (previous AND applied type). Undo only reverts a row that STILL holds the applied
-- value, so a type someone changed since is left alone. Nothing is deleted. production_jobs.job_type is not touched.

CREATE SCHEMA IF NOT EXISTS release_backups;
REVOKE ALL ON SCHEMA release_backups FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA release_backups FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA release_backups FROM authenticated; END IF;
END $$;

CREATE TABLE IF NOT EXISTS release_backups.retype_non_roofing_deals (
  run_id        uuid        NOT NULL,
  table_name    text        NOT NULL CHECK (table_name IN ('opportunities', 'projects')),
  row_id        uuid        NOT NULL,
  org_id        uuid        NOT NULL,
  prev_type     text        NOT NULL,
  applied_type  text        NOT NULL,
  applied_at    timestamptz NOT NULL DEFAULT now(),
  undone_at     timestamptz NULL,
  PRIMARY KEY (run_id, table_name, row_id)
);

CREATE OR REPLACE FUNCTION release_backups.retype_non_roofing_deals(p_org uuid, p_mode text DEFAULT 'preview')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_profile text; v_opps int; v_projects int; v_done_o int; v_done_p int;
BEGIN
  IF p_org IS NULL THEN RAISE EXCEPTION 'one company per run: pass the org id'; END IF;
  IF p_mode NOT IN ('preview', 'apply') THEN RAISE EXCEPTION 'mode must be preview or apply'; END IF;
  SELECT settings #>> '{profile,id}' INTO v_profile FROM orgs WHERE id = p_org;
  IF v_profile IS NULL OR v_profile = 'roofing' THEN
    RAISE EXCEPTION 'org % has no non-roofing industry profile (profile=%): nothing to retype', p_org, coalesce(v_profile, 'none');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'project_type' AND e.enumlabel = 'other') THEN
    RAISE EXCEPTION 'apply migration 202611300060_project_type_other.sql first';
  END IF;

  SELECT count(*) INTO v_opps     FROM opportunities WHERE org_id = p_org AND project_type::text = 'roofing';
  SELECT count(*) INTO v_projects FROM projects      WHERE org_id = p_org AND project_type::text = 'roofing';

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('mode', 'preview', 'wrote_nothing', true, 'org', p_org, 'profile', v_profile, 'opportunities_to_retype', v_opps, 'projects_to_retype', v_projects);
  END IF;

  -- ---- apply: one function = one transaction; any failure rolls all of it back ----
  INSERT INTO release_backups.retype_non_roofing_deals (run_id, table_name, row_id, org_id, prev_type, applied_type)
  SELECT v_run, 'opportunities', id, org_id, project_type::text, 'other' FROM opportunities WHERE org_id = p_org AND project_type::text = 'roofing' FOR UPDATE;
  INSERT INTO release_backups.retype_non_roofing_deals (run_id, table_name, row_id, org_id, prev_type, applied_type)
  SELECT v_run, 'projects', id, org_id, project_type::text, 'other' FROM projects WHERE org_id = p_org AND project_type::text = 'roofing' FOR UPDATE;

  UPDATE opportunities o SET project_type = 'other'::project_type
    FROM release_backups.retype_non_roofing_deals b
   WHERE b.run_id = v_run AND b.table_name = 'opportunities' AND o.id = b.row_id AND o.org_id = p_org AND o.project_type::text = 'roofing';
  GET DIAGNOSTICS v_done_o = ROW_COUNT;
  UPDATE projects p SET project_type = 'other'::project_type
    FROM release_backups.retype_non_roofing_deals b
   WHERE b.run_id = v_run AND b.table_name = 'projects' AND p.id = b.row_id AND p.org_id = p_org AND p.project_type::text = 'roofing';
  GET DIAGNOSTICS v_done_p = ROW_COUNT;

  IF v_done_o <> v_opps OR v_done_p <> v_projects THEN
    RAISE EXCEPTION 'retype: changed %/% opportunities and %/% projects; rolled back', v_done_o, v_opps, v_done_p, v_projects;
  END IF;
  RETURN jsonb_build_object('mode', 'apply', 'run_id', v_run, 'org', p_org, 'opportunities_retyped', v_done_o, 'projects_retyped', v_done_p,
                            'undo', format('SELECT release_backups.undo_retype_non_roofing_deals(%L);', p_org));
END;
$$;

CREATE OR REPLACE FUNCTION release_backups.undo_retype_non_roofing_deals(p_org uuid DEFAULT NULL, p_run uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_o int := 0; v_p int := 0; v_left int := 0;
BEGIN
  IF p_org IS NULL AND p_run IS NULL THEN RAISE EXCEPTION 'pass one org id or one run id — never all companies'; END IF;
  WITH upd AS (
    UPDATE opportunities o SET project_type = b.prev_type::project_type
      FROM release_backups.retype_non_roofing_deals b
     WHERE b.undone_at IS NULL AND b.table_name = 'opportunities' AND o.id = b.row_id
       AND (p_org IS NULL OR b.org_id = p_org) AND (p_run IS NULL OR b.run_id = p_run) AND o.project_type::text = b.applied_type
    RETURNING b.run_id, b.row_id
  ) UPDATE release_backups.retype_non_roofing_deals b SET undone_at = now() FROM upd WHERE b.run_id = upd.run_id AND b.table_name = 'opportunities' AND b.row_id = upd.row_id;
  GET DIAGNOSTICS v_o = ROW_COUNT;
  WITH upd AS (
    UPDATE projects p SET project_type = b.prev_type::project_type
      FROM release_backups.retype_non_roofing_deals b
     WHERE b.undone_at IS NULL AND b.table_name = 'projects' AND p.id = b.row_id
       AND (p_org IS NULL OR b.org_id = p_org) AND (p_run IS NULL OR b.run_id = p_run) AND p.project_type::text = b.applied_type
    RETURNING b.run_id, b.row_id
  ) UPDATE release_backups.retype_non_roofing_deals b SET undone_at = now() FROM upd WHERE b.run_id = upd.run_id AND b.table_name = 'projects' AND b.row_id = upd.row_id;
  GET DIAGNOSTICS v_p = ROW_COUNT;
  SELECT count(*) INTO v_left FROM release_backups.retype_non_roofing_deals b
   WHERE b.undone_at IS NULL AND (p_org IS NULL OR b.org_id = p_org) AND (p_run IS NULL OR b.run_id = p_run);
  RETURN jsonb_build_object('opportunities_reverted', v_o, 'projects_reverted', v_p, 'rows_changed_since_left_alone', v_left);
END;
$$;

-- Default action when this file is run: nothing is written. Preview one company:
--   SELECT release_backups.retype_non_roofing_deals('<org id>');
-- To apply:  SELECT release_backups.retype_non_roofing_deals('<org id>', 'apply');
-- To undo:   SELECT release_backups.undo_retype_non_roofing_deals('<org id>');
