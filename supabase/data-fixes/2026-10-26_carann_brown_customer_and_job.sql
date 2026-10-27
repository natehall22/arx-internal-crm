-- Carann Brown (contract 087dfaa0-0bc6-4c67-9885-70cd36297c78, gutters only, cash, signed 2026-10-23):
--   (a) her opportunity/project/lead hang off the TEST customer b502bb02 ("testing", phone 2222222222) because both used a filler phone;
--   (b) the signing never created her production job (job_type 'gutters' failed the CHECK; fixed in code + migration 202610290130).
--
-- HOW THIS FILE RUNS (release_backups preview / apply / undo, same pattern as 2026-10-27_link_orphan_opportunities.sql):
--   1. Running the whole file only (re)creates functions + backup tables in the private schema `release_backups` and then calls the
--      PREVIEW, which reads and returns the plan. Nothing in any existing table changes.
--   2. Apply (one function = one transaction; any failed check rolls everything back):  SELECT release_backups.fix_carann_brown('apply');
--   3. One-command undo:                                                                SELECT release_backups.undo_fix_carann_brown();
--   4. Her JOB is created through the app's own code path (NOT SQL), AFTER step 2 so the job gets her real customer:
--        npx tsx --env-file=.env.local scripts/fix-contract-job.ts 087dfaa0-0bc6-4c67-9885-70cd36297c78 --apply
--      (without --apply it only prints what it would do; it prints its own undo).
--
-- Backup + undo: every changed row is recorded with its PREVIOUS and APPLIED customer_id. Undo only reverts a row that STILL has the applied
-- customer, and only deletes the customer this run created if nothing references it (every foreign key to customers is checked).
-- The OTHER opportunity on the test customer (8ecb0f87, "testing tester", Kannapolis) is a test deal and is left alone.

CREATE SCHEMA IF NOT EXISTS release_backups;
REVOKE ALL ON SCHEMA release_backups FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA release_backups FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA release_backups FROM authenticated; END IF;
END $$;

CREATE TABLE IF NOT EXISTS release_backups.carann_fix_rows (
  run_id               uuid        NOT NULL,
  table_name           text        NOT NULL,            -- opportunities | projects | leads
  row_id               uuid        NOT NULL,
  prev_customer_id     uuid        NOT NULL,
  applied_customer_id  uuid        NOT NULL,
  applied_at           timestamptz NOT NULL DEFAULT now(),
  undone_at            timestamptz NULL,
  PRIMARY KEY (run_id, table_name, row_id)
);
CREATE TABLE IF NOT EXISTS release_backups.carann_fix_customers (
  run_id       uuid        NOT NULL,
  customer_id  uuid        NOT NULL PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  undone_at    timestamptz NULL,
  kept_reason  text        NULL
);

CREATE OR REPLACE FUNCTION release_backups.fix_carann_brown(p_mode text DEFAULT 'preview') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  c_contract CONSTANT uuid := '087dfaa0-0bc6-4c67-9885-70cd36297c78';
  c_opp      CONSTANT uuid := '0b1ef2ac-9740-4551-bd84-aef8409d5fff';
  c_project  CONSTANT uuid := 'b2385a2c-89f6-4f16-abb9-b93e02fbff76';
  c_lead     CONSTANT uuid := 'a4a3cd8a-d8f3-418d-a6de-04fec68ea34a';
  c_test     CONSTANT uuid := 'b502bb02-080f-497d-9c7b-0299629fe40b';
  v_run uuid := gen_random_uuid();
  v_k record; v_existing uuid; v_new uuid; v_target uuid;
  v_rows jsonb; v_left jsonb; v_moved int;
BEGIN
  IF p_mode NOT IN ('preview', 'apply') THEN RAISE EXCEPTION 'mode must be preview or apply'; END IF;

  SELECT * INTO v_k FROM order_form_contracts WHERE id = c_contract;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract % not found', c_contract; END IF;
  IF v_k.status <> 'completed' THEN RAISE EXCEPTION 'contract is %, expected completed', v_k.status; END IF;

  SELECT id INTO v_existing FROM customers
   WHERE org_id = v_k.org_id AND email_lower = lower(btrim(v_k.customer_email)) AND id <> c_test ORDER BY created_at, id LIMIT 1;

  -- What moves: only her three rows, and only while they still point at the test customer.
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
    SELECT 'opportunities' AS tbl, o.id, l.homeowner_name AS name, l.address_text AS address FROM opportunities o LEFT JOIN leads l ON l.id = o.lead_id WHERE o.id = c_opp AND o.customer_id = c_test
    UNION ALL SELECT 'projects', p.id, NULL, p.address_text FROM projects p WHERE p.id = c_project AND p.customer_id = c_test
    UNION ALL SELECT 'leads', l.id, l.homeowner_name, l.address_text FROM leads l WHERE l.id = c_lead AND l.customer_id = c_test) x;
  -- What stays: everything else on the test customer.
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_left FROM (
    SELECT 'opportunities' AS tbl, o.id, l.homeowner_name AS name, l.address_text AS address FROM opportunities o LEFT JOIN leads l ON l.id = o.lead_id WHERE o.customer_id = c_test AND o.id <> c_opp
    UNION ALL SELECT 'projects', p.id, NULL, p.address_text FROM projects p WHERE p.customer_id = c_test AND p.id <> c_project
    UNION ALL SELECT 'leads', l.id, l.homeowner_name, l.address_text FROM leads l WHERE l.customer_id = c_test AND l.id <> c_lead) x;

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('mode', 'preview', 'wrote_nothing', true,
      'contract', jsonb_build_object('customer', v_k.customer_name, 'email', v_k.customer_email, 'phone_on_contract', v_k.customer_phone, 'address', v_k.project_address),
      'rows_to_repoint', v_rows, 'left_on_test_customer', v_left,
      'customer', CASE WHEN v_existing IS NOT NULL THEN jsonb_build_object('action', 'reuse', 'id', v_existing)
                       ELSE jsonb_build_object('action', 'create', 'name', v_k.customer_name, 'email', lower(btrim(v_k.customer_email)), 'phone', NULL, 'note', 'phone left empty on purpose: 2222222222 is a filler number') END,
      'production_jobs_for_her_project', (SELECT count(*) FROM production_jobs WHERE project_id = c_project));
  END IF;

  -- ---- apply: one function = one transaction; any failure rolls all of it back ----
  IF jsonb_array_length(v_rows) = 0 THEN RAISE EXCEPTION 'nothing to repoint (already applied?)'; END IF;
  IF v_existing IS NOT NULL THEN
    v_target := v_existing;
  ELSE
    INSERT INTO customers (org_id, name, email, address_text)
    VALUES (v_k.org_id, v_k.customer_name, lower(btrim(v_k.customer_email)), v_k.project_address) RETURNING id INTO v_new;
    INSERT INTO release_backups.carann_fix_customers (run_id, customer_id) VALUES (v_run, v_new);
    v_target := v_new;
  END IF;

  INSERT INTO release_backups.carann_fix_rows (run_id, table_name, row_id, prev_customer_id, applied_customer_id)
  SELECT v_run, 'opportunities', id, c_test, v_target FROM opportunities WHERE id = c_opp AND customer_id = c_test
  UNION ALL SELECT v_run, 'projects', id, c_test, v_target FROM projects WHERE id = c_project AND customer_id = c_test
  UNION ALL SELECT v_run, 'leads', id, c_test, v_target FROM leads WHERE id = c_lead AND customer_id = c_test;

  UPDATE opportunities SET customer_id = v_target WHERE id = c_opp AND customer_id = c_test;
  UPDATE projects      SET customer_id = v_target WHERE id = c_project AND customer_id = c_test;
  UPDATE leads         SET customer_id = v_target WHERE id = c_lead AND customer_id = c_test;

  SELECT (SELECT count(*) FROM opportunities WHERE id = c_opp AND customer_id = v_target)
       + (SELECT count(*) FROM projects WHERE id = c_project AND customer_id = v_target)
       + (SELECT count(*) FROM leads WHERE id = c_lead AND customer_id = v_target) INTO v_moved;
  IF v_moved <> jsonb_array_length(v_rows) THEN RAISE EXCEPTION 'fix_carann_brown: moved % of % rows; rolled back', v_moved, jsonb_array_length(v_rows); END IF;
  IF EXISTS (SELECT 1 FROM opportunities WHERE id <> c_opp AND customer_id = c_test AND id NOT IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(v_left) e)) THEN
    RAISE EXCEPTION 'fix_carann_brown: the test customer gained or lost an unexpected row; rolled back';
  END IF;

  RETURN jsonb_build_object('mode', 'apply', 'run_id', v_run, 'customer_id', v_target, 'customer_created', v_existing IS NULL, 'rows_repointed', v_moved,
                            'next', 'create her job: npx tsx --env-file=.env.local scripts/fix-contract-job.ts 087dfaa0-0bc6-4c67-9885-70cd36297c78 --apply',
                            'undo', 'SELECT release_backups.undo_fix_carann_brown();');
END;
$$;

CREATE OR REPLACE FUNCTION release_backups.undo_fix_carann_brown() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_reverted int := 0; v_changed int := 0; v_deleted int := 0; v_kept int := 0; n int;
  r record; fk record; used boolean;
BEGIN
  -- put each row back ONLY where the applied customer is still there
  FOR r IN SELECT * FROM release_backups.carann_fix_rows WHERE undone_at IS NULL LOOP
    EXECUTE format('UPDATE %I SET customer_id = $1 WHERE id = $2 AND customer_id IS NOT DISTINCT FROM $3', r.table_name)
      USING r.prev_customer_id, r.row_id, r.applied_customer_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      v_reverted := v_reverted + n;
      UPDATE release_backups.carann_fix_rows SET undone_at = now() WHERE run_id = r.run_id AND table_name = r.table_name AND row_id = r.row_id;
    ELSE
      v_changed := v_changed + 1;   -- changed since: left exactly as it is
    END IF;
  END LOOP;

  -- the customer this run created: delete only if NOTHING references it
  FOR r IN SELECT customer_id FROM release_backups.carann_fix_customers WHERE undone_at IS NULL LOOP
    used := false;
    FOR fk IN
      SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'public.customers'::regclass AND cardinality(c.conkey) = 1
    LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', fk.tbl, fk.col) INTO used USING r.customer_id;
      EXIT WHEN used;
    END LOOP;
    IF used THEN
      v_kept := v_kept + 1;
      UPDATE release_backups.carann_fix_customers SET kept_reason = 'referenced by other records' WHERE customer_id = r.customer_id;
    ELSE
      DELETE FROM customers WHERE id = r.customer_id;
      v_deleted := v_deleted + 1;
      UPDATE release_backups.carann_fix_customers SET undone_at = now() WHERE customer_id = r.customer_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('rows_reverted', v_reverted, 'rows_changed_since_left_alone', v_changed, 'customers_deleted', v_deleted, 'customers_kept_because_in_use', v_kept);
END;
$$;

-- Default action when this file is run: PREVIEW ONLY (writes nothing to any existing table).
SELECT release_backups.fix_carann_brown('preview');
-- To apply (after looking at the plan above):   SELECT release_backups.fix_carann_brown('apply');
-- To undo, one command:                         SELECT release_backups.undo_fix_carann_brown();
