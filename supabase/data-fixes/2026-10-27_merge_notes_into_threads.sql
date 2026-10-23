-- Merge the old note locations into the one timeline (activities). COPY, never move: old columns/tables are untouched;
-- every copied row carries legacy_ref so it is traceable and the run is idempotent (re-running adds nothing).
-- Run AFTER migration 202610270010 and 2026-10-27_link_orphan_opportunities.sql.
--
--  A. existing activities  -> classify: origin human|system, audience (setter/canvasser-written -> sales, else team)
--  B. production_job_notes -> audience production (crew if shared with the sub), exact full-name @mentions parsed
--  C. opportunities.inspection_notes / .notes, leads.notes (those with a deal)   -> one message each
--  D. projects.notes / ops_notes, production_jobs.internal_notes                 -> production messages
--  E. production_jobs.special_instructions                                       -> pinned production message
--  leads.canvass_notes is NOT copied: it is a pin attribute and is read live into the deal's timeline.
-- To PREVIEW only: replace the final COMMIT with ROLLBACK; the SELECTs below are the preview.

BEGIN;

-- PREVIEW: what each step will touch.
SELECT 'A classify existing activities' AS step, count(*) AS rows FROM activities WHERE origin IS NULL AND referral_partner_id IS NULL AND legacy_ref IS NULL
UNION ALL SELECT 'B production_job_notes', count(*) FROM production_job_notes n WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.legacy_ref->>'table' = 'production_job_notes' AND a.legacy_ref->>'id' = n.id::text)
UNION ALL SELECT 'C opportunities.inspection_notes', count(*) FROM opportunities o WHERE btrim(coalesce(o.inspection_notes,'')) <> ''
UNION ALL SELECT 'C opportunities.notes', count(*) FROM opportunities o WHERE btrim(coalesce(o.notes,'')) <> ''
UNION ALL SELECT 'C leads.notes with a deal', count(*) FROM leads l WHERE btrim(coalesce(l.notes,'')) <> '' AND EXISTS (SELECT 1 FROM opportunities o WHERE o.lead_id = l.id)
UNION ALL SELECT 'C leads.notes with NO deal (stay on the lead)', count(*) FROM leads l WHERE btrim(coalesce(l.notes,'')) <> '' AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.lead_id = l.id)
UNION ALL SELECT 'D projects.notes', count(*) FROM projects p WHERE btrim(coalesce(p.notes,'')) <> '' AND p.opportunity_id IS NOT NULL
UNION ALL SELECT 'D projects.ops_notes', count(*) FROM projects p WHERE btrim(coalesce(p.ops_notes,'')) <> '' AND p.opportunity_id IS NOT NULL
UNION ALL SELECT 'D production_jobs.internal_notes', count(*) FROM production_jobs j JOIN projects p ON p.id = j.project_id WHERE btrim(coalesce(j.internal_notes,'')) <> '' AND p.opportunity_id IS NOT NULL
UNION ALL SELECT 'E production_jobs.special_instructions', count(*) FROM production_jobs j JOIN projects p ON p.id = j.project_id WHERE btrim(coalesce(j.special_instructions,'')) <> '' AND p.opportunity_id IS NOT NULL;

-- ---- A. classify existing activities (backup first) ----
CREATE TEMP TABLE _classify ON COMMIT DROP AS
SELECT a.id,
       CASE WHEN (a.type = 'note' AND a.user_id IS NOT NULL AND a.body !~* '^(lead contact information upd|installation agreement creat|contract created and sent|payroll attribution updated|lead attribution updated|instant website estimate|repair agreement created|insurance contingency agreem|inspection report emailed|new web lead received|project job site address|design pdf uploaded)' AND a.body !~* 'created and sent to')
                 OR (a.type IN ('text','email') AND a.body IS NOT NULL) THEN 'human' ELSE 'system' END AS origin,
       u.role::text AS author_role
FROM activities a LEFT JOIN users u ON u.id = a.user_id
WHERE a.origin IS NULL AND a.referral_partner_id IS NULL AND a.legacy_ref IS NULL;

INSERT INTO data_fix_backups (fix, table_name, row_data)
SELECT '2026-10-27_merge_notes_into_threads', 'activities', jsonb_build_object('id', a.id, 'origin', a.origin, 'audience', a.audience, 'restricted_pricing', a.restricted_pricing)
FROM activities a JOIN _classify c ON c.id = a.id;

-- Pricing screen: anything that reads like pricing is flagged (hidden from setters / inside sales and the crew link), as
-- postMessage does for new messages. System rows that carry money or commission info are Production-only; other system rows
-- (status, calls) stay audience-less = visible to everyone on the deal, as today.
UPDATE activities a
   SET origin = c.origin,
       audience = CASE WHEN c.origin = 'human' THEN CASE WHEN c.author_role IN ('setter','canvasser') THEN 'sales' ELSE 'team' END
                       WHEN a.body ~* '^(payroll attribution|installation agreement|contract created|repair agreement|insurance contingency|instant website estimate)' THEN 'production' END,
       restricted_pricing = CASE WHEN c.origin = 'human' AND (a.body ~* '[$]\s?[0-9]|\m(price|pricing|priced|quotes?|quoted|bid|discount|commission|override|payout|margin|profit|deposit|financ(e|ing|ed))\M|[0-9]+\s?%\s?off|dealer fee|per square') THEN true END
  FROM _classify c WHERE c.id = a.id;

-- ---- B-E: sources as one set of rows to copy ----
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
       CASE WHEN (s.body ~* '[$]\s?[0-9]|\m(price|pricing|priced|quotes?|quoted|bid|discount|commission|override|payout|margin|profit|deposit|financ(e|ing|ed))\M|[0-9]+\s?%\s?off|dealer fee|per square') THEN true END
FROM _src s LEFT JOIN _mentions m ON m.ref_id = s.ref_id;

COMMIT;

-- Verify: SELECT origin, count(*) FROM activities GROUP BY 1;   SELECT count(*) FROM activities WHERE source = 'import';
-- Rollback (exact):
--   (first clear anything pointing at imported rows: DELETE FROM notifications WHERE activity_id IN (SELECT id FROM activities WHERE source = 'import'); UPDATE activities SET reply_to_id = NULL WHERE reply_to_id IN (SELECT id FROM activities WHERE source = 'import');)
--   DELETE FROM activities WHERE source = 'import' AND legacy_ref IS NOT NULL;
--   UPDATE activities a SET origin = NULL, audience = NULL, restricted_pricing = NULL FROM data_fix_backups b
--    WHERE b.fix = '2026-10-27_merge_notes_into_threads' AND b.table_name = 'activities' AND a.id = (b.row_data->>'id')::uuid;
