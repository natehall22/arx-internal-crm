-- Mark every never-attempted QuickBooks outbox row as 'skipped', so connecting QuickBooks later never auto-posts history.
--
-- WHY: the CRM has queued `integration_outbox` rows since before anything could send them (no worker exists). As of 2026-11-06
-- prod held 128, all status 'pending', attempt_count 0, never processed: 59 payment.recorded, 41 customer.upserted,
-- 16 invoice.finalized, 12 invoice.voided. Invoices are no longer queued at all (one QuickBooks invoice per job = sale amount),
-- and history is brought in by the link-first backfill (docs/quickbooks-sync.md), never by replaying this queue.
-- 'skipped' is already a value of the `outbox_status` enum — no migration needed.
--
-- HOW THIS FILE RUNS (nothing is written to any existing table by running it as-is):
--   1. Running the whole file only (re)creates a function + backup table in the private schema `release_backups` and calls the
--      PREVIEW, which returns counts per provider/event type. Check them against the numbers above (new signings/payments since
--      2026-11-06 add rows; that is expected — they are history too).
--   2. To apply, run only:   SELECT release_backups.skip_stale_qb_outbox('apply');
--   3. One-command undo:     SELECT release_backups.undo_skip_stale_qb_outbox();
-- Apply BEFORE the QuickBooks connection/worker ships (any order relative to the PR 1 code). Only rows created before the moment
-- of apply are touched (pass a cutoff to narrow: skip_stale_qb_outbox('apply', '2026-11-06')).
--
-- Backup + undo: every changed row is recorded in release_backups.skip_stale_qb_outbox (previous AND applied status/last_error).
-- The skip reason is written into `last_error` (the table has no reason column). Undo only reverts a row that STILL has the applied
-- status and reason, so anything a worker has done since is left alone. Nothing is deleted.

CREATE SCHEMA IF NOT EXISTS release_backups;
REVOKE ALL ON SCHEMA release_backups FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA release_backups FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA release_backups FROM authenticated; END IF;
END $$;

CREATE TABLE IF NOT EXISTS release_backups.skip_stale_qb_outbox (
  run_id              uuid        NOT NULL,
  outbox_id           uuid        NOT NULL,
  org_id              uuid        NOT NULL,
  provider            text        NOT NULL,
  event_type          text        NOT NULL,
  prev_status         text        NOT NULL,
  prev_last_error     text        NULL,
  prev_updated_at     timestamptz NULL,
  applied_status      text        NOT NULL,
  applied_last_error  text        NOT NULL,
  applied_at          timestamptz NOT NULL DEFAULT now(),
  undone_at           timestamptz NULL,
  PRIMARY KEY (run_id, outbox_id)
);

CREATE OR REPLACE FUNCTION release_backups.skip_stale_qb_outbox(p_mode text DEFAULT 'preview', p_before timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_reason constant text := 'skipped: queued before QuickBooks was connected; history comes in by the link-first backfill (data fix 2026-11-06)';
  v_plan jsonb; v_n int; v_done int; v_left int;
BEGIN
  IF p_mode NOT IN ('preview', 'apply') THEN RAISE EXCEPTION 'mode must be preview or apply'; END IF;

  -- The plan: never attempted, never processed, still pending, created before the cutoff.
  SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb), coalesce(sum(n), 0)::int INTO v_plan, v_n
  FROM (SELECT provider || ':' || event_type AS k, count(*) AS n
          FROM integration_outbox
         WHERE status = 'pending' AND coalesce(attempt_count, 0) = 0 AND processed_at IS NULL AND created_at < p_before
         GROUP BY 1) t;

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('mode', 'preview', 'wrote_nothing', true, 'cutoff', p_before, 'rows_to_skip', v_n, 'by_event', v_plan,
                              'already_attempted_or_processed_left_alone',
                              (SELECT count(*) FROM integration_outbox WHERE coalesce(attempt_count, 0) > 0 OR processed_at IS NOT NULL OR status <> 'pending'));
  END IF;

  -- ---- apply: one function = one transaction; any failure rolls all of it back ----
  INSERT INTO release_backups.skip_stale_qb_outbox (run_id, outbox_id, org_id, provider, event_type, prev_status, prev_last_error, prev_updated_at,
                                                    applied_status, applied_last_error)
  SELECT v_run, o.id, o.org_id, o.provider, o.event_type, o.status::text, o.last_error, o.updated_at, 'skipped', v_reason
    FROM integration_outbox o
   WHERE o.status = 'pending' AND coalesce(o.attempt_count, 0) = 0 AND o.processed_at IS NULL AND o.created_at < p_before
     FOR UPDATE;

  UPDATE integration_outbox o SET status = 'skipped', last_error = v_reason, updated_at = now()
    FROM release_backups.skip_stale_qb_outbox b
   WHERE b.run_id = v_run AND o.id = b.outbox_id AND o.status = 'pending';
  GET DIAGNOSTICS v_done = ROW_COUNT;

  IF v_done <> v_n THEN RAISE EXCEPTION 'skip_stale_qb_outbox: skipped % of % planned; rolled back', v_done, v_n; END IF;
  SELECT count(*) INTO v_left FROM integration_outbox
   WHERE status = 'pending' AND coalesce(attempt_count, 0) = 0 AND processed_at IS NULL AND created_at < p_before;
  IF v_left <> 0 THEN RAISE EXCEPTION 'skip_stale_qb_outbox: % stale rows still pending; rolled back', v_left; END IF;

  RETURN jsonb_build_object('mode', 'apply', 'run_id', v_run, 'cutoff', p_before, 'rows_skipped', v_done, 'by_event', v_plan,
                            'undo', 'SELECT release_backups.undo_skip_stale_qb_outbox();');
END;
$$;

CREATE OR REPLACE FUNCTION release_backups.undo_skip_stale_qb_outbox() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_reverted int := 0; v_changed int := 0;
BEGIN
  -- Put back the previous status/last_error ONLY where the row still holds exactly what this fix wrote.
  WITH upd AS (
    UPDATE integration_outbox o
       SET status = b.prev_status::outbox_status, last_error = b.prev_last_error, updated_at = b.prev_updated_at
      FROM release_backups.skip_stale_qb_outbox b
     WHERE b.undone_at IS NULL AND o.id = b.outbox_id
       AND o.status::text = b.applied_status AND o.last_error IS NOT DISTINCT FROM b.applied_last_error
    RETURNING b.run_id, b.outbox_id
  ) UPDATE release_backups.skip_stale_qb_outbox b SET undone_at = now() FROM upd WHERE b.run_id = upd.run_id AND b.outbox_id = upd.outbox_id;
  GET DIAGNOSTICS v_reverted = ROW_COUNT;
  SELECT count(*) INTO v_changed FROM release_backups.skip_stale_qb_outbox WHERE undone_at IS NULL;   -- changed since: left exactly as they are
  RETURN jsonb_build_object('rows_reverted', v_reverted, 'rows_changed_since_left_alone', v_changed);
END;
$$;

-- Default action when this file is run: PREVIEW ONLY (writes nothing to any existing table).
SELECT release_backups.skip_stale_qb_outbox('preview');
-- To apply (after checking the counts above):   SELECT release_backups.skip_stale_qb_outbox('apply');
-- To undo, one command:                          SELECT release_backups.undo_skip_stale_qb_outbox();
