-- DB test for supabase/data-fixes/2026-11-06_skip_stale_qb_outbox.sql. Body of ONE DO block that always ends in
-- RAISE EXCEPTION (the report), so it can only ever be rolled back. Run the data fix file first (it only previews).
DECLARE
  v_org uuid := gen_random_uuid(); v_res jsonb; v_undo jsonb; v_n int; v_report text := '';
  P1 uuid := gen_random_uuid(); C1 uuid := gen_random_uuid(); I1 uuid := gen_random_uuid(); V1 uuid := gen_random_uuid();
  TRIED uuid := gen_random_uuid(); DONE uuid := gen_random_uuid(); LATE uuid := gen_random_uuid();
  v_base int;
BEGIN
  SELECT count(*) INTO v_base FROM integration_outbox WHERE status = 'pending' AND attempt_count = 0 AND processed_at IS NULL;
  INSERT INTO integration_outbox (id, org_id, provider, event_type, entity_table, entity_id, idempotency_key, status, attempt_count, last_error, processed_at, created_at) VALUES
    (P1,    v_org, 'quickbooks', 'payment.recorded',  'job_payments', gen_random_uuid(), 't-p1',   'pending',   0, NULL,   NULL,  '2026-10-01'),
    (C1,    v_org, 'quickbooks', 'customer.upserted', 'customers',    gen_random_uuid(), 't-c1',   'pending',   0, NULL,   NULL,  '2026-10-02'),
    (I1,    v_org, 'quickbooks', 'invoice.finalized', 'job_invoices', gen_random_uuid(), 't-i1',   'pending',   0, NULL,   NULL,  '2026-10-03'),
    (V1,    v_org, 'quickbooks', 'invoice.voided',    'job_invoices', gen_random_uuid(), 't-v1',   'pending',   0, NULL,   NULL,  '2026-10-04'),
    (TRIED, v_org, 'quickbooks', 'payment.recorded',  'job_payments', gen_random_uuid(), 't-try',  'failed',    2, 'boom', NULL,  '2026-10-05'),
    (DONE,  v_org, 'quickbooks', 'payment.recorded',  'job_payments', gen_random_uuid(), 't-done', 'completed', 1, NULL,   now(), '2026-10-06'),
    (LATE,  v_org, 'quickbooks', 'payment.recorded',  'job_payments', gen_random_uuid(), 't-late', 'pending',   0, NULL,   NULL,  '2026-12-01');

  -- PREVIEW writes nothing
  v_res := release_backups.skip_stale_qb_outbox('preview', '2026-11-06');
  IF (v_res->>'wrote_nothing')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'preview flag'; END IF;
  SELECT count(*) INTO v_n FROM integration_outbox WHERE org_id = v_org AND status = 'skipped'; IF v_n <> 0 THEN RAISE EXCEPTION 'preview wrote'; END IF;
  v_report := v_report || E'\npreview: ' || v_res::text;

  -- APPLY with a cutoff: the 4 stale rows only; attempted, completed and post-cutoff rows untouched
  v_res := release_backups.skip_stale_qb_outbox('apply', '2026-11-06');
  SELECT count(*) INTO v_n FROM integration_outbox WHERE id IN (P1, C1, I1, V1) AND status = 'skipped' AND last_error LIKE 'skipped:%';
  IF v_n <> 4 THEN RAISE EXCEPTION 'expected 4 skipped, got %', v_n; END IF;
  IF (SELECT status::text || coalesce(last_error, '') FROM integration_outbox WHERE id = TRIED) <> 'failedboom' THEN RAISE EXCEPTION 'attempted row touched'; END IF;
  IF (SELECT status::text FROM integration_outbox WHERE id = DONE) <> 'completed' THEN RAISE EXCEPTION 'completed row touched'; END IF;
  IF (SELECT status::text FROM integration_outbox WHERE id = LATE) <> 'pending' THEN RAISE EXCEPTION 'post-cutoff row touched'; END IF;
  IF (v_res->>'rows_skipped')::int < 4 OR (v_base = 0 AND (v_res->>'rows_skipped')::int <> 4) THEN RAISE EXCEPTION 'rows_skipped: %', v_res; END IF;
  SELECT count(*) INTO v_n FROM release_backups.skip_stale_qb_outbox b WHERE b.outbox_id IN (P1, C1, I1, V1) AND b.prev_status = 'pending' AND b.applied_status = 'skipped';
  IF v_n <> 4 THEN RAISE EXCEPTION 'backup rows: %', v_n; END IF;
  v_report := v_report || E'\napply OK: ' || v_res::text;

  -- a worker touched C1 since (re-enqueued at signing): undo must leave it alone
  UPDATE integration_outbox SET status = 'pending', last_error = NULL WHERE id = C1;
  v_undo := release_backups.undo_skip_stale_qb_outbox();
  SELECT count(*) INTO v_n FROM integration_outbox WHERE id IN (P1, I1, V1) AND status = 'pending' AND last_error IS NULL; IF v_n <> 3 THEN RAISE EXCEPTION 'undo reverted % of 3', v_n; END IF;
  IF (SELECT count(*) FROM release_backups.skip_stale_qb_outbox WHERE outbox_id = C1 AND undone_at IS NULL) <> 1 THEN RAISE EXCEPTION 'C1 should stay un-undone'; END IF;
  v_report := v_report || E'\nundo OK: ' || v_undo::text;

  RAISE EXCEPTION 'REPORT (rolled back by design):%', v_report;
END
