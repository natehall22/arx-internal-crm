-- Data fix: remove the cross-period duplicate payroll snapshots/payout lines created by
-- the 2026-08-20 back-to-back locks (see migration 202610210002).
--
-- Owner sign-off (Nathan, 2026-10-21): the CRM has NEVER been used for real pay, so these
-- rows are paper only and safe to remove. For each duplicated job the EARLIEST period's
-- copy (by cutoff_at, then created_at, then id) is kept; every later-period snapshot is
-- deleted and its payout lines go with it (FK ON DELETE CASCADE).
--
-- Prod, read-only 2026-10-21: 15 jobs (26-0014, 0017, 0020-0032), 37 snapshots / 45 lines
-- across 4 locked periods (2026-30, 2026-W31, 2026-w32, 2026-W33; none paid). This removes
-- 22 snapshots / 26 lines = $18,901.41 net, keeps 15 snapshots / 19 lines, and repoints
-- 13 job_payroll_state rows from the deleted period to the kept one. Every removed line
-- has an identical (job, user, role, gross, net) twin in the kept snapshot.
--
-- ORDER: migration 202610210002 -> THIS FILE -> migration 202610210003 -> deploy app.
--   * 0002's triggers fire only on INSERT and on UPDATE of key columns, so they do NOT
--     block this DELETE (verified by supabase/tests). 0002 must be applied first anyway,
--     so no new duplicate can appear between this fix and 0003's unique indexes; the
--     transaction below refuses to run without it.
--   * 0003 (unique indexes) fails to build until this has run.
--
-- Step 1 is a read-only preview. Step 2 is one transaction: it backs up every row it will
-- change into schema payroll_backup (NOT exposed via the API; no anon/authenticated
-- access), deletes, and raises (rolling everything back) unless zero cross-period
-- duplicates remain. Step 3 (commented out) restores from the backup.
-- In the Supabase SQL editor (which shows only the last result) run step 1 on its own
-- first and review it, then run step 2 on its own. psql -f runs both in order.
-- After the fix, 2026-W33 is a locked period with no job snapshots (all three were
-- later copies); cancel/reopen would now be allowed on it, which is harmless.

-- ---- 1. PREVIEW (read-only) ----------------------------------------------------------
WITH ranked AS (
  SELECT s.id, s.org_id, s.job_id, s.payroll_period_id,
         row_number() OVER (PARTITION BY s.org_id, s.job_id ORDER BY p.cutoff_at, p.created_at, p.id) AS rn,
         count(*)     OVER (PARTITION BY s.org_id, s.job_id) AS copies
  FROM public.payroll_job_snapshots s
  JOIN public.payroll_periods p ON p.id = s.payroll_period_id
)
SELECT j.job_number,
       l.participant_role,
       p.period_label,
       p.status AS period_status,
       CASE WHEN r.rn = 1 THEN 'KEEP' ELSE 'DELETE' END AS action,
       l.gross_amount,
       l.net_amount
FROM ranked r
JOIN public.payroll_payout_lines l ON l.payroll_job_snapshot_id = r.id
JOIN public.payroll_periods p ON p.id = r.payroll_period_id
LEFT JOIN public.production_jobs j ON j.id = r.job_id
WHERE r.copies > 1
ORDER BY j.job_number, l.participant_role, p.cutoff_at;

-- ---- 2. FIX (one transaction) --------------------------------------------------------
BEGIN;

-- No payroll write can interleave with the fix (lock/materialize waits until COMMIT).
LOCK TABLE public.payroll_periods, public.payroll_job_snapshots, public.payroll_payout_lines,
           public.payroll_chargeback_applications, public.job_payroll_state
  IN SHARE ROW EXCLUSIVE MODE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payroll_job_snapshots_single_period_ins')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payroll_payout_lines_single_period_ins') THEN
    RAISE EXCEPTION 'dupfix: apply migration 202610210002 first (single-period triggers missing)';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS payroll_backup;
REVOKE ALL ON SCHEMA payroll_backup FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA payroll_backup FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Exact column copies (LIKE) so the rollback can INSERT ... SELECT * back.
-- Plain CREATE TABLE: a second run fails here instead of overwriting the first backup.
CREATE TABLE payroll_backup.dupfix_20261021_job_snapshots (LIKE public.payroll_job_snapshots);
CREATE TABLE payroll_backup.dupfix_20261021_payout_lines  (LIKE public.payroll_payout_lines);
CREATE TABLE payroll_backup.dupfix_20261021_job_payroll_state (LIKE public.job_payroll_state);
CREATE TABLE payroll_backup.dupfix_20261021_map (
  removed_snapshot_id uuid PRIMARY KEY,
  kept_snapshot_id    uuid NOT NULL,
  org_id              uuid NOT NULL,
  job_id              uuid NOT NULL,
  removed_period_id   uuid NOT NULL,
  kept_period_id      uuid NOT NULL,
  backed_up_at        timestamptz NOT NULL DEFAULT now()
);
DO $$
DECLARE r text; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dupfix_20261021_job_snapshots', 'dupfix_20261021_payout_lines',
                           'dupfix_20261021_job_payroll_state', 'dupfix_20261021_map'] LOOP
    EXECUTE format('ALTER TABLE payroll_backup.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON payroll_backup.%I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON payroll_backup.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

INSERT INTO payroll_backup.dupfix_20261021_map
  (removed_snapshot_id, kept_snapshot_id, org_id, job_id, removed_period_id, kept_period_id)
SELECT r.id, k.id, r.org_id, r.job_id, r.payroll_period_id, k.payroll_period_id
FROM (
  SELECT s.id, s.org_id, s.job_id, s.payroll_period_id,
         row_number() OVER (PARTITION BY s.org_id, s.job_id ORDER BY p.cutoff_at, p.created_at, p.id) AS rn
  FROM public.payroll_job_snapshots s
  JOIN public.payroll_periods p ON p.id = s.payroll_period_id
) r
JOIN LATERAL (
  SELECT s2.id, s2.payroll_period_id
  FROM public.payroll_job_snapshots s2
  JOIN public.payroll_periods p2 ON p2.id = s2.payroll_period_id
  WHERE s2.org_id = r.org_id AND s2.job_id = r.job_id
  ORDER BY p2.cutoff_at, p2.created_at, p2.id
  LIMIT 1
) k ON true
WHERE r.rn > 1;

-- Refuse anything outside the reviewed shape, rather than guess.
DO $$
DECLARE n bigint;
BEGIN
  -- a removed line must have an identical twin in the kept snapshot (else pay would change)
  SELECT count(*) INTO n
  FROM payroll_backup.dupfix_20261021_map m
  JOIN public.payroll_payout_lines l ON l.payroll_job_snapshot_id = m.removed_snapshot_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.payroll_payout_lines k
    WHERE k.payroll_job_snapshot_id = m.kept_snapshot_id
      AND k.user_id = l.user_id AND k.participant_role = l.participant_role
      AND k.gross_amount = l.gross_amount AND k.net_amount = l.net_amount);
  IF n > 0 THEN
    RAISE EXCEPTION 'dupfix: % line(s) to remove have no identical twin in the kept period; resolve by hand', n;
  END IF;
  -- cascade would silently delete chargeback applications
  SELECT count(*) INTO n
  FROM payroll_backup.dupfix_20261021_map m
  JOIN public.payroll_payout_lines l ON l.payroll_job_snapshot_id = m.removed_snapshot_id
  JOIN public.payroll_chargeback_applications a ON a.payout_line_id = l.id;
  IF n > 0 THEN
    RAISE EXCEPTION 'dupfix: % chargeback application(s) reference lines to remove', n;
  END IF;
  -- the reviewed duplicates are all in LOCKED periods; a paid one was not reviewed
  SELECT count(*) INTO n
  FROM payroll_backup.dupfix_20261021_map m
  JOIN public.payroll_periods p ON p.id = m.removed_period_id
  WHERE p.status = 'paid';
  IF n > 0 THEN
    RAISE EXCEPTION 'dupfix: % duplicate(s) sit in a PAID period; not part of the reviewed set', n;
  END IF;
END $$;

INSERT INTO payroll_backup.dupfix_20261021_job_snapshots
SELECT s.* FROM public.payroll_job_snapshots s
JOIN payroll_backup.dupfix_20261021_map m ON m.removed_snapshot_id = s.id;

INSERT INTO payroll_backup.dupfix_20261021_payout_lines
SELECT l.* FROM public.payroll_payout_lines l
JOIN payroll_backup.dupfix_20261021_map m ON m.removed_snapshot_id = l.payroll_job_snapshot_id;

INSERT INTO payroll_backup.dupfix_20261021_job_payroll_state
SELECT j.* FROM public.job_payroll_state j
WHERE EXISTS (SELECT 1 FROM payroll_backup.dupfix_20261021_map m
              WHERE m.job_id = j.job_id AND m.removed_period_id = j.current_payroll_period_id);

-- job_payroll_state points at the LAST period that paid the job; move it to the kept one.
UPDATE public.job_payroll_state j
SET current_payroll_period_id = k.id,
    payroll_cutoff_at         = k.cutoff_at,
    scheduled_pay_date        = k.scheduled_pay_date,
    updated_at                = now()
FROM payroll_backup.dupfix_20261021_map m
JOIN public.payroll_periods k ON k.id = m.kept_period_id
WHERE m.job_id = j.job_id AND m.removed_period_id = j.current_payroll_period_id;

DELETE FROM public.payroll_job_snapshots s
USING payroll_backup.dupfix_20261021_map m
WHERE s.id = m.removed_snapshot_id;  -- payout lines cascade

DO $$
DECLARE snap_dups bigint; line_dups bigint; left_snaps bigint; left_lines bigint; bad_state bigint;
BEGIN
  SELECT count(*) INTO snap_dups FROM (
    SELECT 1 FROM public.payroll_job_snapshots GROUP BY org_id, job_id HAVING count(*) > 1) x;
  SELECT count(*) INTO line_dups FROM (
    SELECT 1 FROM public.payroll_payout_lines GROUP BY job_id, user_id, participant_role HAVING count(*) > 1) x;
  SELECT count(*) INTO left_snaps FROM public.payroll_job_snapshots s
    JOIN payroll_backup.dupfix_20261021_map m ON m.removed_snapshot_id = s.id;
  SELECT count(*) INTO left_lines FROM public.payroll_payout_lines l
    JOIN payroll_backup.dupfix_20261021_payout_lines b ON b.id = l.id;
  SELECT count(*) INTO bad_state FROM public.job_payroll_state j
    JOIN payroll_backup.dupfix_20261021_map m ON m.job_id = j.job_id AND m.removed_period_id = j.current_payroll_period_id;
  IF snap_dups <> 0 OR line_dups <> 0 OR left_snaps <> 0 OR left_lines <> 0 OR bad_state <> 0 THEN
    RAISE EXCEPTION 'dupfix: post-check failed (snapshot dups %, line dups %, undeleted snapshots %, undeleted lines %, stale state pointers %)',
      snap_dups, line_dups, left_snaps, left_lines, bad_state;
  END IF;
  RAISE NOTICE 'dupfix: removed % snapshot(s) / % line(s) (net %), repointed % job_payroll_state row(s); 0 cross-period duplicates remain',
    (SELECT count(*) FROM payroll_backup.dupfix_20261021_job_snapshots),
    (SELECT count(*) FROM payroll_backup.dupfix_20261021_payout_lines),
    (SELECT coalesce(sum(net_amount), 0) FROM payroll_backup.dupfix_20261021_payout_lines),
    (SELECT count(*) FROM payroll_backup.dupfix_20261021_job_payroll_state);
END $$;

COMMIT;

-- ---- 3. ROLLBACK (manual; run only to undo step 2) -----------------------------------
-- Drops 0003's unique indexes if present (they reject the restored duplicates) and
-- briefly disables 0002's insert triggers (they reject rows in locked/other periods).
-- Re-apply migration 202610210003 only after deciding again how to resolve the duplicates.
-- ROLLBACK-BEGIN
-- BEGIN;
-- DROP INDEX IF EXISTS public.payroll_job_snapshots_one_period_per_job;
-- DROP INDEX IF EXISTS public.payroll_payout_lines_one_period_per_job_user_role;
-- ALTER TABLE public.payroll_job_snapshots DISABLE TRIGGER trg_payroll_job_snapshots_single_period_ins;
-- ALTER TABLE public.payroll_payout_lines  DISABLE TRIGGER trg_payroll_payout_lines_single_period_ins;
-- INSERT INTO public.payroll_job_snapshots SELECT * FROM payroll_backup.dupfix_20261021_job_snapshots;
-- INSERT INTO public.payroll_payout_lines  SELECT * FROM payroll_backup.dupfix_20261021_payout_lines;
-- UPDATE public.job_payroll_state j
--   SET current_payroll_period_id = b.current_payroll_period_id, payroll_cutoff_at = b.payroll_cutoff_at,
--       scheduled_pay_date = b.scheduled_pay_date, updated_at = b.updated_at
--   FROM payroll_backup.dupfix_20261021_job_payroll_state b WHERE b.job_id = j.job_id;
-- ALTER TABLE public.payroll_job_snapshots ENABLE TRIGGER trg_payroll_job_snapshots_single_period_ins;
-- ALTER TABLE public.payroll_payout_lines  ENABLE TRIGGER trg_payroll_payout_lines_single_period_ins;
-- COMMIT;
-- ROLLBACK-END
-- After a successful rollback (or once the fix is confirmed), the backup can be removed with:
--   DROP SCHEMA payroll_backup CASCADE;
