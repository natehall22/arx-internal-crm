-- ════════════════════════════════════════════════════════════════════════════════
-- Data fix 2026-10-21 — production statuses backfilled from evidence already in the CRM
-- Branch feat/status-desire-paths. No migration needed (no schema change).
--
-- Going forward these statuses are written where the work happens (lib/job-status-events.ts).
-- This file fixes history ONLY where the CRM already holds proof of the event:
--
--   A. proposals      draft/sent/viewed → accepted   when a COMPLETED sale agreement was signed
--                     from that proposal (accepted_at = the customer's signature time;
--                     project_id filled from the deal's project if blank)          ~31 rows
--   B. jobs           materials not_ordered → received  when the job is in progress, complete
--                     or collected (it was installed, so materials were delivered).
--                     materials_ordered_at stays NULL — the real date is unknown.   ~36 rows
--   C. trades         open crew with all 4 required walk-around photos → completed
--                     (credited to the crew's sub, completed_at = last of the 4)    ~0 rows
--   D. jobs           sold/materials/scheduled with ≥1 completed crew → in_progress
--                     (what deriveJobSchedule writes today)                         ~0 rows
--   E. appointments   past "scheduled" inspection whose lead got an outcome logged after
--                     it → completed (no_show if that outcome was not_home).
--                     A "rescheduled" outcome is skipped (left for a human).        ~9 rows
--   F. appointments   past "scheduled" appointment (any type) whose deal had a sale
--                     agreement signed after it → completed.                        ~12 rows
--
-- NOT touched: permits (no evidence exists anywhere — 42/42 "not needed"), the ~90 past
-- appointments with no evidence (they show in "Needs you" with a Log outcome link).
--
-- Run order: PART A (preview, read-only) → PART B (fix, one transaction, writes a backup)
-- → PART C (verify). PART D is the rollback. Every UPDATE is guarded on the row's current
-- value, so a row someone changed since the preview is left alone.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── PART A: PREVIEW (read-only). One row per change: table, id, label, before → after. ──
WITH
prop AS (
  SELECT p.id, p.org_id, p.proposal_number AS label, p.status AS before_status, p.accepted_at AS before_accepted_at,
         p.project_id AS before_project_id, MIN(c.customer_signed_at) AS signed_at,
         (SELECT pr.id FROM projects pr WHERE pr.org_id = p.org_id AND pr.opportunity_id = p.opportunity_id
           ORDER BY pr.created_at LIMIT 1) AS deal_project_id
  FROM proposals p
  JOIN order_form_contracts c ON c.proposal_id = p.id AND c.org_id = p.org_id
  WHERE c.status = 'completed' AND c.agreement_type IN ('installation', 'repair')
    AND p.status IN ('draft', 'sent', 'viewed')
  GROUP BY p.id
),
mat AS (
  SELECT id, job_number AS label, materials_status AS before_status, status AS job_status
  FROM production_jobs
  WHERE status IN ('in_progress', 'complete', 'collected') AND materials_status = 'not_ordered'
),
trd AS (
  SELECT w.id, w.work_order_number AS label, w.status AS before_status, w.assigned_sub_id,
         (SELECT MAX(ph.created_at) FROM photos ph WHERE ph.work_order_id = w.id AND ph.deleted_at IS NULL
            AND ph.photo_tag IN ('final_front','final_back','final_left','final_right')) AS done_at
  FROM work_orders w
  WHERE w.trade IS NOT NULL AND w.status NOT IN ('completed', 'cancelled') AND w.assigned_sub_id IS NOT NULL
    AND (SELECT COUNT(DISTINCT ph.photo_tag) FROM photos ph WHERE ph.work_order_id = w.id AND ph.deleted_at IS NULL
           AND ph.photo_tag IN ('final_front','final_back','final_left','final_right')) = 4
),
appt_outcome AS (
  SELECT a.id, a.status AS before_status,
         (SELECT u.outcome FROM inspection_status_updates u
           WHERE u.lead_id = a.lead_id AND u.org_id = a.org_id AND u.created_at >= a.scheduled_for - INTERVAL '1 day' AND u.created_at < a.scheduled_for + INTERVAL '7 days'
           ORDER BY u.created_at ASC LIMIT 1) AS outcome
  FROM scheduled_appointments a
  WHERE a.status = 'scheduled' AND COALESCE(a.appointment_type, 'inspection') = 'inspection'
    AND a.scheduled_for < NOW() - INTERVAL '2 hours' AND a.lead_id IS NOT NULL
),
appt_contract AS (
  SELECT a.id, a.status AS before_status, a.appointment_type
  FROM scheduled_appointments a
  WHERE a.status = 'scheduled' AND COALESCE(a.appointment_type, 'inspection') = 'inspection'
    AND a.scheduled_for < NOW() - INTERVAL '2 hours' AND a.opportunity_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM order_form_contracts c
                 WHERE c.opportunity_id = a.opportunity_id AND c.org_id = a.org_id AND c.status = 'completed'
                   AND c.agreement_type IN ('installation', 'repair') AND c.customer_signed_at >= a.scheduled_for)
)
SELECT 'A proposal' AS fix, id::text, label, before_status AS before, 'accepted' AS after,
       'signed ' || signed_at::date || CASE WHEN before_project_id IS NULL AND deal_project_id IS NOT NULL THEN ' +project' ELSE '' END AS note
  FROM prop
UNION ALL SELECT 'B job materials', id::text, label, before_status, 'received', 'job is ' || job_status FROM mat
UNION ALL SELECT 'C trade', id::text, label, before_status, 'completed', '4 photos by ' || done_at::date FROM trd
UNION ALL SELECT 'D job status', j.id::text, j.job_number, j.status, 'in_progress', 'crew done'
  FROM production_jobs j
  WHERE j.status IN ('sold', 'materials', 'scheduled')
    AND (EXISTS (SELECT 1 FROM work_orders w WHERE w.job_id = j.id AND w.trade IS NOT NULL AND w.status = 'completed')
         OR EXISTS (SELECT 1 FROM trd JOIN work_orders w ON w.id = trd.id WHERE w.job_id = j.id))
UNION ALL SELECT 'E appointment', id::text, NULL, before_status,
       CASE WHEN outcome = 'not_home' THEN 'no_show' ELSE 'completed' END, 'outcome ' || outcome
  FROM appt_outcome WHERE outcome IS NOT NULL AND outcome <> 'rescheduled'
UNION ALL SELECT 'F appointment', id::text, NULL, before_status, 'completed', COALESCE(appointment_type, 'inspection') || ' then contract signed'
  FROM appt_contract WHERE id NOT IN (SELECT id FROM appt_outcome WHERE outcome IS NOT NULL AND outcome <> 'rescheduled')
ORDER BY 1, 3;


-- ── PART B: FIX (one transaction). Writes every before-value to a backup table first. ──
BEGIN;

-- Backup for PART D. RLS on with no policies = service role only (the advisor flagged two
-- earlier _backup_ tables for having RLS off). Drop it once the fix is confirmed (PART E).
CREATE TABLE IF NOT EXISTS public._datafix_20261021_status_paths (
  table_name   TEXT        NOT NULL,
  row_id       UUID        NOT NULL,
  org_id       UUID,
  column_name  TEXT        NOT NULL,
  old_value    TEXT,
  new_value    TEXT,
  fixed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (table_name, row_id, column_name)
);
ALTER TABLE public._datafix_20261021_status_paths ENABLE ROW LEVEL SECURITY;

-- A. proposals → accepted
CREATE TEMP TABLE fix_a ON COMMIT DROP AS
SELECT p.id, p.org_id, p.status AS old_status, p.accepted_at AS old_accepted_at, p.project_id AS old_project_id,
       MIN(c.customer_signed_at) AS signed_at,
       (SELECT pr.id FROM projects pr WHERE pr.org_id = p.org_id AND pr.opportunity_id = p.opportunity_id
         ORDER BY pr.created_at LIMIT 1) AS deal_project_id
FROM proposals p
JOIN order_form_contracts c ON c.proposal_id = p.id AND c.org_id = p.org_id
WHERE c.status = 'completed' AND c.agreement_type IN ('installation', 'repair')
  AND p.status IN ('draft', 'sent', 'viewed')
GROUP BY p.id;

INSERT INTO public._datafix_20261021_status_paths (table_name, row_id, org_id, column_name, old_value, new_value)
SELECT 'proposals', id, org_id, 'status', old_status, 'accepted' FROM fix_a
UNION ALL SELECT 'proposals', id, org_id, 'accepted_at', old_accepted_at::text, COALESCE(old_accepted_at, signed_at)::text FROM fix_a
UNION ALL SELECT 'proposals', id, org_id, 'project_id', old_project_id::text, deal_project_id::text
  FROM fix_a WHERE old_project_id IS NULL AND deal_project_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE proposals p
   SET status = 'accepted',
       accepted_at = COALESCE(p.accepted_at, f.signed_at),
       project_id = COALESCE(p.project_id, f.deal_project_id)
  FROM fix_a f
 WHERE p.id = f.id AND p.status = f.old_status;

-- C. trades with all 4 photos → completed (before D, which reads completed trades)
CREATE TEMP TABLE fix_c ON COMMIT DROP AS
SELECT w.id, w.org_id, w.job_id, w.status AS old_status, w.assigned_sub_id,
       (SELECT MAX(ph.created_at) FROM photos ph WHERE ph.work_order_id = w.id AND ph.deleted_at IS NULL
          AND ph.photo_tag IN ('final_front','final_back','final_left','final_right')) AS done_at
FROM work_orders w
WHERE w.trade IS NOT NULL AND w.status NOT IN ('completed', 'cancelled') AND w.assigned_sub_id IS NOT NULL
  AND (SELECT COUNT(DISTINCT ph.photo_tag) FROM photos ph WHERE ph.work_order_id = w.id AND ph.deleted_at IS NULL
         AND ph.photo_tag IN ('final_front','final_back','final_left','final_right')) = 4;

INSERT INTO public._datafix_20261021_status_paths (table_name, row_id, org_id, column_name, old_value, new_value)
SELECT 'work_orders', id, org_id, 'status', old_status, 'completed' FROM fix_c
ON CONFLICT DO NOTHING;

UPDATE work_orders w
   SET status = 'completed', completed_at = f.done_at, completed_by_sub_id = f.assigned_sub_id
  FROM fix_c f
 WHERE w.id = f.id AND w.status = f.old_status;

-- B. installed jobs whose materials still say not_ordered → received
CREATE TEMP TABLE fix_b ON COMMIT DROP AS
SELECT id, org_id, materials_status AS old_materials
FROM production_jobs
WHERE status IN ('in_progress', 'complete', 'collected') AND materials_status = 'not_ordered';

INSERT INTO public._datafix_20261021_status_paths (table_name, row_id, org_id, column_name, old_value, new_value)
SELECT 'production_jobs', id, org_id, 'materials_status', old_materials, 'received' FROM fix_b
ON CONFLICT DO NOTHING;

UPDATE production_jobs j
   SET materials_status = 'received'
  FROM fix_b f
 WHERE j.id = f.id AND j.materials_status = 'not_ordered';

-- D. jobs with a completed crew still before "in progress" → in_progress
CREATE TEMP TABLE fix_d ON COMMIT DROP AS
SELECT j.id, j.org_id, j.status AS old_status, j.started_at AS old_started_at
FROM production_jobs j
WHERE j.status IN ('sold', 'materials', 'scheduled')
  AND EXISTS (SELECT 1 FROM work_orders w WHERE w.job_id = j.id AND w.trade IS NOT NULL AND w.status = 'completed');

INSERT INTO public._datafix_20261021_status_paths (table_name, row_id, org_id, column_name, old_value, new_value)
SELECT 'production_jobs', id, org_id, 'status', old_status, 'in_progress' FROM fix_d
UNION ALL SELECT 'production_jobs', id, org_id, 'started_at', old_started_at::text, COALESCE(old_started_at, (SELECT MIN(w.completed_at) FROM work_orders w WHERE w.job_id = fix_d.id AND w.trade IS NOT NULL AND w.status = 'completed'))::text FROM fix_d
ON CONFLICT DO NOTHING;

UPDATE production_jobs j
   SET status = 'in_progress', started_at = COALESCE(j.started_at, (SELECT MIN(w.completed_at) FROM work_orders w WHERE w.job_id = j.id AND w.trade IS NOT NULL AND w.status = 'completed'))
  FROM fix_d f
 WHERE j.id = f.id AND j.status = f.old_status;
-- (projects.status maps sold/materials/scheduled/in_progress all to in_progress — nothing to sync.)

-- E + F. past appointments with proof of what happened
CREATE TEMP TABLE fix_e ON COMMIT DROP AS
SELECT x.id, x.org_id, CASE WHEN x.outcome = 'not_home' THEN 'no_show' ELSE 'completed' END AS new_status
FROM (
  SELECT a.id, a.org_id,
         (SELECT u.outcome FROM inspection_status_updates u
           WHERE u.lead_id = a.lead_id AND u.org_id = a.org_id AND u.created_at >= a.scheduled_for - INTERVAL '1 day' AND u.created_at < a.scheduled_for + INTERVAL '7 days'
           ORDER BY u.created_at ASC LIMIT 1) AS outcome
  FROM scheduled_appointments a
  WHERE a.status = 'scheduled' AND COALESCE(a.appointment_type, 'inspection') = 'inspection'
    AND a.scheduled_for < NOW() - INTERVAL '2 hours' AND a.lead_id IS NOT NULL
) x
WHERE x.outcome IS NOT NULL AND x.outcome <> 'rescheduled';

INSERT INTO fix_e
SELECT a.id, a.org_id, 'completed'
FROM scheduled_appointments a
WHERE a.status = 'scheduled' AND COALESCE(a.appointment_type, 'inspection') = 'inspection'
    AND a.scheduled_for < NOW() - INTERVAL '2 hours' AND a.opportunity_id IS NOT NULL
  AND a.id NOT IN (SELECT id FROM fix_e)
  AND EXISTS (SELECT 1 FROM order_form_contracts c
               WHERE c.opportunity_id = a.opportunity_id AND c.org_id = a.org_id AND c.status = 'completed'
                 AND c.agreement_type IN ('installation', 'repair') AND c.customer_signed_at >= a.scheduled_for);

INSERT INTO public._datafix_20261021_status_paths (table_name, row_id, org_id, column_name, old_value, new_value)
SELECT 'scheduled_appointments', id, org_id, 'status', 'scheduled', new_status FROM fix_e
ON CONFLICT DO NOTHING;

UPDATE scheduled_appointments a
   SET status = f.new_status
  FROM fix_e f
 WHERE a.id = f.id AND a.status = 'scheduled';

-- Sanity: counts should match the preview (≈31 / 36 / 0 / 0 / 21). If not, ROLLBACK instead.
SELECT table_name, column_name, COUNT(*) FROM public._datafix_20261021_status_paths GROUP BY 1, 2 ORDER BY 1, 2;

COMMIT;


-- ── PART C: VERIFY (read-only) ──
SELECT 'signed proposals not accepted' AS check_name, COUNT(*) FROM proposals p
 WHERE p.status IN ('draft','sent','viewed')
   AND EXISTS (SELECT 1 FROM order_form_contracts c WHERE c.proposal_id = p.id AND c.status = 'completed'
                 AND c.agreement_type IN ('installation','repair'))
UNION ALL
SELECT 'installed jobs with materials not ordered', COUNT(*) FROM production_jobs
 WHERE status IN ('in_progress','complete','collected') AND materials_status = 'not_ordered'
UNION ALL
SELECT 'past appointments still scheduled', COUNT(*) FROM scheduled_appointments
 WHERE status = 'scheduled' AND scheduled_for < NOW() - INTERVAL '2 hours';


-- ── PART D: ROLLBACK (restores every before-value; only rows still holding the fixed value) ──
-- BEGIN;
-- UPDATE proposals p SET status = b.old_value FROM public._datafix_20261021_status_paths b
--  WHERE b.table_name = 'proposals' AND b.column_name = 'status' AND p.id = b.row_id AND p.status = b.new_value;
-- UPDATE proposals p SET accepted_at = b.old_value::timestamptz FROM public._datafix_20261021_status_paths b
--  WHERE b.table_name = 'proposals' AND b.column_name = 'accepted_at' AND p.id = b.row_id;
-- UPDATE proposals p SET project_id = NULL FROM public._datafix_20261021_status_paths b
--  WHERE b.table_name = 'proposals' AND b.column_name = 'project_id' AND p.id = b.row_id AND p.project_id::text = b.new_value;
-- UPDATE work_orders w SET status = b.old_value, completed_at = NULL, completed_by_sub_id = NULL
--   FROM public._datafix_20261021_status_paths b
--  WHERE b.table_name = 'work_orders' AND b.column_name = 'status' AND w.id = b.row_id AND w.status = 'completed';
-- UPDATE production_jobs j SET status = b.old_value FROM public._datafix_20261021_status_paths b
--  WHERE b.table_name = 'production_jobs' AND b.column_name = 'status' AND j.id = b.row_id AND j.status = b.new_value;
-- UPDATE production_jobs j SET started_at = b.old_value::timestamptz FROM public._datafix_20261021_status_paths b
--  WHERE b.table_name = 'production_jobs' AND b.column_name = 'started_at' AND j.id = b.row_id;
-- UPDATE production_jobs j SET materials_status = b.old_value FROM public._datafix_20261021_status_paths b
--  WHERE b.table_name = 'production_jobs' AND b.column_name = 'materials_status' AND j.id = b.row_id AND j.materials_status = b.new_value;
-- UPDATE scheduled_appointments a SET status = b.old_value FROM public._datafix_20261021_status_paths b
--  WHERE b.table_name = 'scheduled_appointments' AND a.id = b.row_id AND a.status = b.new_value;
-- COMMIT;

-- ── PART E: CLEANUP (after the fix has been confirmed for a week) ──
-- DROP TABLE public._datafix_20261021_status_paths;
