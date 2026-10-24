-- Merge the old note locations into the one timeline (activities). COPY, never move: old columns/tables are untouched;
-- every copied row carries legacy_ref so it is traceable and the run is idempotent (re-running adds nothing).
-- Run AFTER migration 202610270010 and 2026-10-27_link_orphan_opportunities.sql.
--
-- HOW THIS FILE RUNS (nothing is written to any existing table by running it as-is):
--   1. Running the whole file only (re)creates functions + backup tables in the private schema `release_backups` and then calls the
--      PREVIEW, which reads and returns the numbers.
--   2. To apply, run only:   SELECT release_backups.merge_notes_into_threads('apply');
--   3. One-command undo:     SELECT release_backups.undo_merge_notes_into_threads();
--
--  A. existing activities  -> classify: origin human|system, audience (setter/canvasser-written -> sales, else team)
--  B. production_job_notes -> audience production (crew if shared with the sub), exact full-name @mentions parsed
--  C. opportunities.inspection_notes / .notes, leads.notes (those with a deal)   -> one message each
--  D. projects.notes / ops_notes, production_jobs.internal_notes                 -> production messages
--  E. production_jobs.special_instructions                                       -> pinned production message
--  leads.canvass_notes is NOT copied: it is a pin attribute and is read live into the deal's timeline.
--  Notes that were already shared with the subcontractor (audience crew) are NEVER price-flagged: the crew link hides price-flagged
--  messages, so flagging them would silently take working crew instructions away from the crew.
--
-- Backup + undo: release_backups.merge_notes_classified stores each classified activity's PREVIOUS and APPLIED (origin, audience,
-- restricted_pricing); release_backups.merge_notes_imported stores each copied note (md5 of the body, audience, pin) . Undo restores
-- a classified row from its previous values ONLY while it still equals the applied values, and deletes an imported note ONLY while it
-- is untouched (not edited, not removed, not re-audienced, pin unchanged, no replies) — so nothing a person did afterwards is lost.

CREATE SCHEMA IF NOT EXISTS release_backups;
REVOKE ALL ON SCHEMA release_backups FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA release_backups FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA release_backups FROM authenticated; END IF;
END $$;

CREATE TABLE IF NOT EXISTS release_backups.merge_notes_classified (
  activity_id uuid PRIMARY KEY, run_id uuid NOT NULL,
  prev_origin text NULL, prev_audience text NULL, prev_restricted_pricing boolean NULL,
  applied_origin text NULL, applied_audience text NULL, applied_restricted_pricing boolean NULL,
  applied_at timestamptz NOT NULL DEFAULT now(), undone_at timestamptz NULL, kept_reason text NULL
);
CREATE TABLE IF NOT EXISTS release_backups.merge_notes_imported (
  activity_id uuid PRIMARY KEY, run_id uuid NOT NULL,
  legacy_ref jsonb NOT NULL, applied_body_md5 text NOT NULL, applied_audience text NOT NULL, applied_pinned boolean NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(), undone_at timestamptz NULL, kept_reason text NULL
);

CREATE OR REPLACE FUNCTION release_backups.merge_notes_into_threads(p_mode text DEFAULT 'preview') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_preview jsonb; v_classified int; v_src int; v_imported int; v_crew_kept int;
BEGIN
  IF p_mode NOT IN ('preview', 'apply') THEN RAISE EXCEPTION 'mode must be preview or apply'; END IF;

  SELECT jsonb_object_agg(step, rows) INTO v_preview FROM (
    SELECT 'A classify existing activities' AS step, count(*) AS rows FROM activities WHERE origin IS NULL AND referral_partner_id IS NULL AND legacy_ref IS NULL
    UNION ALL SELECT 'B production_job_notes', count(*) FROM production_job_notes n WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.legacy_ref->>'table' = 'production_job_notes' AND a.legacy_ref->>'id' = n.id::text)
    UNION ALL SELECT 'B of which shared with the sub (audience crew, never price-flagged)', count(*) FROM production_job_notes n WHERE n.share_with_sub AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.legacy_ref->>'table' = 'production_job_notes' AND a.legacy_ref->>'id' = n.id::text)
    UNION ALL SELECT 'C opportunities.inspection_notes', count(*) FROM opportunities o WHERE btrim(coalesce(o.inspection_notes,'')) <> ''
    UNION ALL SELECT 'C opportunities.notes', count(*) FROM opportunities o WHERE btrim(coalesce(o.notes,'')) <> ''
    UNION ALL SELECT 'C leads.notes with a deal', count(*) FROM leads l WHERE btrim(coalesce(l.notes,'')) <> '' AND EXISTS (SELECT 1 FROM opportunities o WHERE o.lead_id = l.id)
    UNION ALL SELECT 'C leads.notes with NO deal (stay on the lead)', count(*) FROM leads l WHERE btrim(coalesce(l.notes,'')) <> '' AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.lead_id = l.id)
    UNION ALL SELECT 'D projects.notes', count(*) FROM projects p WHERE btrim(coalesce(p.notes,'')) <> '' AND p.opportunity_id IS NOT NULL
    UNION ALL SELECT 'D projects.ops_notes', count(*) FROM projects p WHERE btrim(coalesce(p.ops_notes,'')) <> '' AND p.opportunity_id IS NOT NULL
    UNION ALL SELECT 'D production_jobs.internal_notes', count(*) FROM production_jobs j JOIN projects p ON p.id = j.project_id WHERE btrim(coalesce(j.internal_notes,'')) <> '' AND p.opportunity_id IS NOT NULL
    UNION ALL SELECT 'E production_jobs.special_instructions', count(*) FROM production_jobs j JOIN projects p ON p.id = j.project_id WHERE btrim(coalesce(j.special_instructions,'')) <> '' AND p.opportunity_id IS NOT NULL
  ) s;

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('mode', 'preview', 'wrote_nothing', true, 'steps', v_preview);
  END IF;

  -- ---- apply: one function = one transaction; any failure rolls all of it back ----
  DROP TABLE IF EXISTS _classify; DROP TABLE IF EXISTS _src; DROP TABLE IF EXISTS _mentions;

  -- A. classify existing activities: compute the applied values first, back up previous + applied, then write
  CREATE TEMP TABLE _classify ON COMMIT DROP AS
  SELECT a.id,
         x.new_origin,
         CASE WHEN x.new_origin = 'human' THEN CASE WHEN u.role::text IN ('setter','canvasser') THEN 'sales' ELSE 'team' END
              WHEN a.body ~* '^(payroll attribution|installation agreement|contract created|repair agreement|insurance contingency|instant website estimate)' THEN 'production' END AS new_audience,
         CASE WHEN x.new_origin = 'human' AND (a.body ~* '[$]\s?[0-9]|\m(price|pricing|priced|quotes?|quoted|bid|discount|commission|override|payout|margin|profit|deposit|financ(e|ing|ed))\M|[0-9]+\s?%\s?off|dealer fee|per square') THEN true END AS new_restricted,
         a.origin AS prev_origin, a.audience AS prev_audience, a.restricted_pricing AS prev_restricted
  FROM activities a LEFT JOIN users u ON u.id = a.user_id
  CROSS JOIN LATERAL (SELECT CASE WHEN (a.type = 'note' AND a.user_id IS NOT NULL AND a.body !~* '^(lead contact information upd|installation agreement creat|contract created and sent|payroll attribution updated|lead attribution updated|instant website estimate|repair agreement created|insurance contingency agreem|inspection report emailed|new web lead received|project job site address|design pdf uploaded)' AND a.body !~* 'created and sent to')
                                    OR (a.type IN ('text','email') AND a.body IS NOT NULL) THEN 'human' ELSE 'system' END AS new_origin) x
  WHERE a.origin IS NULL AND a.referral_partner_id IS NULL AND a.legacy_ref IS NULL;

  INSERT INTO release_backups.merge_notes_classified (activity_id, run_id, prev_origin, prev_audience, prev_restricted_pricing, applied_origin, applied_audience, applied_restricted_pricing)
  SELECT id, v_run, prev_origin, prev_audience, prev_restricted, new_origin, new_audience, new_restricted FROM _classify
  ON CONFLICT (activity_id) DO NOTHING;
  UPDATE activities a SET origin = c.new_origin, audience = c.new_audience, restricted_pricing = c.new_restricted FROM _classify c WHERE c.id = a.id;
  SELECT count(*) INTO v_classified FROM _classify;

  -- B-E: sources as one set of rows to copy
  CREATE TEMP TABLE _src ON COMMIT DROP AS
SELECT j.org_id, p.opportunity_id, o.customer_id, o.lead_id, j.id AS production_job_id, n.user_id, n.note AS body, n.created_at,
       CASE WHEN n.share_with_sub THEN 'crew' ELSE 'production' END AS audience,
       'production_job_notes'::text AS ref_table, 'note'::text AS ref_col, n.id::text AS ref_id, false AS pin, true AS parse_mentions
FROM production_job_notes n JOIN production_jobs j ON j.id = n.job_id JOIN projects p ON p.id = j.project_id JOIN opportunities o ON o.id = p.opportunity_id
UNION ALL
SELECT o.org_id, o.id, o.customer_id, o.lead_id, NULL, NULL, '📋 Inspection notes (from the old opportunity page): ' || btrim(o.inspection_notes), o.updated_at, 'sales', 'opportunities', 'inspection_notes', o.id::text, false, false
FROM opportunities o WHERE btrim(coalesce(o.inspection_notes,'')) <> ''
UNION ALL
SELECT o.org_id, o.id, o.customer_id, o.lead_id, NULL, NULL, '📋 Note (from the old opportunity page): ' || btrim(o.notes), o.updated_at, 'sales', 'opportunities', 'notes', o.id::text, false, false
FROM opportunities o WHERE btrim(coalesce(o.notes,'')) <> '' AND o.notes NOT LIKE 'Add-on opportunity created%'
UNION ALL
SELECT o.org_id, o.id, o.customer_id, o.lead_id, NULL, NULL, '📋 Note (from the old lead page): ' || btrim(l.notes), l.updated_at, 'team', 'leads', 'notes', l.id::text, false, false
FROM leads l JOIN LATERAL (SELECT * FROM opportunities o2 WHERE o2.lead_id = l.id ORDER BY o2.created_at DESC LIMIT 1) o ON true
WHERE btrim(coalesce(l.notes,'')) <> ''
UNION ALL
SELECT pr.org_id, pr.opportunity_id, o.customer_id, o.lead_id, NULL, NULL, '📋 Project note (from the old project page): ' || btrim(pr.notes), pr.updated_at, 'production', 'projects', 'notes', pr.id::text, false, false
FROM projects pr JOIN opportunities o ON o.id = pr.opportunity_id WHERE btrim(coalesce(pr.notes,'')) <> ''
UNION ALL
SELECT pr.org_id, pr.opportunity_id, o.customer_id, o.lead_id, NULL, NULL, '📋 Ops note (from the old project page): ' || btrim(pr.ops_notes), pr.updated_at, 'production', 'projects', 'ops_notes', pr.id::text, false, false
FROM projects pr JOIN opportunities o ON o.id = pr.opportunity_id WHERE btrim(coalesce(pr.ops_notes,'')) <> ''
UNION ALL
SELECT j.org_id, pr.opportunity_id, o.customer_id, o.lead_id, j.id, NULL, '📋 Internal note (from the old job page): ' || btrim(j.internal_notes), j.updated_at, 'production', 'production_jobs', 'internal_notes', j.id::text, false, false
FROM production_jobs j JOIN projects pr ON pr.id = j.project_id JOIN opportunities o ON o.id = pr.opportunity_id WHERE btrim(coalesce(j.internal_notes,'')) <> ''
UNION ALL
SELECT j.org_id, pr.opportunity_id, o.customer_id, o.lead_id, j.id, NULL, btrim(j.special_instructions), j.updated_at, 'production', 'production_jobs', 'special_instructions', j.id::text, true, false
FROM production_jobs j JOIN projects pr ON pr.id = j.project_id JOIN opportunities o ON o.id = pr.opportunity_id WHERE btrim(coalesce(j.special_instructions,'')) <> '';


  DELETE FROM _src s WHERE EXISTS (SELECT 1 FROM activities a WHERE a.legacy_ref->>'table' = s.ref_table AND a.legacy_ref->>'col' = s.ref_col AND a.legacy_ref->>'id' = s.ref_id);
  SELECT count(*) INTO v_src FROM _src;

  -- Exact "@Full Name" mentions only (next char not a letter/digit); the LONGEST matching name at a position wins.
  CREATE TEMP TABLE _mentions ON COMMIT DROP AS
  SELECT s.ref_id, array_agg(DISTINCT m.user_id) AS ids
  FROM _src s
  JOIN LATERAL (
    SELECT u.id AS user_id
    FROM users u
    WHERE u.org_id = s.org_id AND u.active AND btrim(coalesce(u.full_name,'')) <> ''
      AND s.parse_mentions
      AND position(lower('@' || btrim(u.full_name)) IN lower(s.body)) > 0
      AND substr(lower(s.body), position(lower('@' || btrim(u.full_name)) IN lower(s.body)) + length('@' || btrim(u.full_name)), 1) !~ '[[:alnum:]_]'
      AND NOT EXISTS (
        SELECT 1 FROM users u2
        WHERE u2.org_id = s.org_id AND u2.active AND length(btrim(u2.full_name)) > length(btrim(u.full_name))
          AND lower(btrim(u2.full_name)) LIKE lower(btrim(u.full_name)) || '%'
          AND position(lower('@' || btrim(u2.full_name)) IN lower(s.body)) = position(lower('@' || btrim(u.full_name)) IN lower(s.body))
      )
  ) m ON true
  GROUP BY s.ref_id;
  
  
  INSERT INTO activities (org_id, opportunity_id, customer_id, lead_id, production_job_id, user_id, type, body, created_at, updated_at, origin, audience, source, mentioned_user_ids, legacy_ref, pinned_at, pin_scope, restricted_pricing)
  SELECT s.org_id, s.opportunity_id, s.customer_id, s.lead_id, s.production_job_id, s.user_id, 'note', s.body, s.created_at, s.created_at, 'human', s.audience, 'import',
         m.ids, jsonb_build_object('table', s.ref_table, 'col', s.ref_col, 'id', s.ref_id),
         CASE WHEN s.pin THEN now() END, CASE WHEN s.pin THEN 'deal' END,
         -- Price-flag everything that reads like pricing EXCEPT notes already shared with the sub (audience crew): the crew link hides flagged notes.
         CASE WHEN s.audience <> 'crew' AND (s.body ~* '[$]\s?[0-9]|\m(price|pricing|priced|quotes?|quoted|bid|discount|commission|override|payout|margin|profit|deposit|financ(e|ing|ed))\M|[0-9]+\s?%\s?off|dealer fee|per square') THEN true END
  FROM _src s LEFT JOIN _mentions m ON m.ref_id = s.ref_id;

  INSERT INTO release_backups.merge_notes_imported (activity_id, run_id, legacy_ref, applied_body_md5, applied_audience, applied_pinned)
  SELECT a.id, v_run, a.legacy_ref, md5(a.body), a.audience, a.pinned_at IS NOT NULL
  FROM activities a
  WHERE a.source = 'import' AND a.legacy_ref IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM release_backups.merge_notes_imported i WHERE i.activity_id = a.id);
  GET DIAGNOSTICS v_imported = ROW_COUNT;
  IF v_imported <> v_src THEN RAISE EXCEPTION 'merge_notes_into_threads: copied % of % planned; rolled back', v_imported, v_src; END IF;
  SELECT count(*) INTO v_crew_kept FROM activities a JOIN release_backups.merge_notes_imported i ON i.activity_id = a.id WHERE i.run_id = v_run AND a.audience = 'crew' AND a.restricted_pricing IS TRUE;
  IF v_crew_kept <> 0 THEN RAISE EXCEPTION 'merge_notes_into_threads: % crew-shared notes were price-flagged; rolled back', v_crew_kept; END IF;

  RETURN jsonb_build_object('mode', 'apply', 'run_id', v_run, 'steps', v_preview, 'activities_classified', v_classified, 'notes_copied', v_imported,
                            'undo', 'SELECT release_backups.undo_merge_notes_into_threads();');
END;
$$;

CREATE OR REPLACE FUNCTION release_backups.undo_merge_notes_into_threads() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_restored int := 0; v_class_kept int := 0; v_deleted int := 0; v_import_kept int := 0; n int;
BEGIN
  -- 1. imported notes: delete only the untouched ones
  WITH untouched AS (
    SELECT i.activity_id FROM release_backups.merge_notes_imported i
    JOIN activities a ON a.id = i.activity_id
    WHERE i.undone_at IS NULL
      AND a.edited_at IS NULL AND a.deleted_at IS NULL
      AND md5(a.body) = i.applied_body_md5 AND a.audience = i.applied_audience
      AND (a.pinned_at IS NOT NULL) = i.applied_pinned
      AND NOT EXISTS (SELECT 1 FROM activities r WHERE r.reply_to_id = a.id)
  ), gone AS (
    DELETE FROM activities a USING untouched u WHERE a.id = u.activity_id RETURNING a.id
  ) UPDATE release_backups.merge_notes_imported i SET undone_at = now() FROM gone g WHERE i.activity_id = g.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  UPDATE release_backups.merge_notes_imported i SET kept_reason = 'changed since the merge (edited, removed, re-audienced, re-pinned or replied to)' WHERE i.undone_at IS NULL;
  SELECT count(*) INTO v_import_kept FROM release_backups.merge_notes_imported WHERE undone_at IS NULL;

  -- 2. classified activities: restore the previous values only where the applied ones are still there
  WITH upd AS (
    UPDATE activities a SET origin = c.prev_origin, audience = c.prev_audience, restricted_pricing = c.prev_restricted_pricing
      FROM release_backups.merge_notes_classified c
     WHERE c.undone_at IS NULL AND a.id = c.activity_id
       AND a.origin IS NOT DISTINCT FROM c.applied_origin AND a.audience IS NOT DISTINCT FROM c.applied_audience
       AND a.restricted_pricing IS NOT DISTINCT FROM c.applied_restricted_pricing
    RETURNING c.activity_id
  ) UPDATE release_backups.merge_notes_classified c SET undone_at = now() FROM upd WHERE c.activity_id = upd.activity_id;
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  -- a classified activity that was deleted since has nothing to restore
  UPDATE release_backups.merge_notes_classified c SET undone_at = now(), kept_reason = 'activity no longer exists' WHERE c.undone_at IS NULL AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.id = c.activity_id);
  UPDATE release_backups.merge_notes_classified c SET kept_reason = 'changed since the merge' WHERE c.undone_at IS NULL;
  SELECT count(*) INTO v_class_kept FROM release_backups.merge_notes_classified WHERE undone_at IS NULL;

  RETURN jsonb_build_object('imported_notes_deleted', v_deleted, 'imported_notes_kept_because_changed', v_import_kept,
                            'activities_restored', v_restored, 'activities_left_because_changed', v_class_kept);
END;
$$;

-- Default action when this file is run: PREVIEW ONLY (writes nothing to any existing table).
SELECT release_backups.merge_notes_into_threads('preview');
-- To apply:   SELECT release_backups.merge_notes_into_threads('apply');
-- To undo, one command (do this BEFORE undoing link_orphan_opportunities):   SELECT release_backups.undo_merge_notes_into_threads();
