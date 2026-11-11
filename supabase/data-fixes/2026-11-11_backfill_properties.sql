-- Backfill properties for existing customers / deals / jobs / crew rows / documents (Phase 2 properties).
--
-- HOW THIS FILE RUNS (nothing is written to any existing table by running it as-is):
--   1. Running the whole file only (re)creates functions + backup tables in the private schema `release_backups` and then
--      calls the PREVIEW, which reads and returns the plan (counts + a sample). Look at it.
--   2. To apply, run only:   SELECT release_backups.backfill_properties('apply');
--   3. One-command undo:     SELECT release_backups.undo_backfill_properties();
-- Run AFTER migration 202611110010_properties.sql. Safe to re-run: apply only touches rows whose property_id is still NULL
-- and reuses properties that already exist (same customer + same address key).
--
-- What it does (one property per distinct customer + address, `public.property_address_key` decides "same address"):
--   a. properties from every deal address (opportunities customer_id + address_text); a job's address only when the job has
--      no deal of the same customer behind it; the customer's own address only when none of their deals has one (so a
--      second spelling of the same street does not become a duplicate). source = 'backfill'. lat/lng from the newest
--      deal/job at that address that has them.
--   b. opportunities.property_id    = the customer's property at the deal's address.
--   c. production_jobs.property_id  = its project's deal's property (same customer), else the customer's property at the job address.
--   d. work_orders.property_id      = its job's property (same customer or no customer on the work order).
--   e. documents.property_id        = its job's property (only when the document's customer, if set, matches the job's).
-- NOT changed: any address column, customers, which address any page or PDF shows. Rows with no customer or a blank address
-- get no property (they are counted in the preview).
--
-- Backup + undo: every property_id written is recorded in release_backups.backfill_properties_rows (table, row, previous
-- value NULL, applied value) and every property created in release_backups.backfill_properties_created. Undo clears a
-- property_id only where it STILL equals the applied value, then deletes a created property only when nothing points at it
-- (all four property_id columns are checked) and nobody has edited it since (updated_at = created_at, no custom field values).

CREATE SCHEMA IF NOT EXISTS release_backups;
REVOKE ALL ON SCHEMA release_backups FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA release_backups FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA release_backups FROM authenticated; END IF;
END $$;

CREATE TABLE IF NOT EXISTS release_backups.backfill_properties_rows (
  run_id      uuid        NOT NULL,
  table_name  text        NOT NULL CHECK (table_name IN ('opportunities', 'production_jobs', 'work_orders', 'documents')),
  row_id      uuid        NOT NULL,
  org_id      uuid        NOT NULL,
  prev_property_id    uuid NULL,
  applied_property_id uuid NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz NULL,
  PRIMARY KEY (run_id, table_name, row_id)
);
CREATE TABLE IF NOT EXISTS release_backups.backfill_properties_created (
  run_id       uuid        NOT NULL,
  property_id  uuid        NOT NULL PRIMARY KEY,
  org_id       uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  undone_at    timestamptz NULL,
  kept_reason  text        NULL
);

-- Every (company, customer, address) that should have a property, with the best coordinates on file.
CREATE OR REPLACE FUNCTION release_backups.property_backfill_sources() RETURNS TABLE (
  org_id uuid, customer_id uuid, address_key text, address_text text, lat numeric, lng numeric, from_tables text[]
) LANGUAGE sql STABLE AS $$
  WITH src AS (
    -- deal addresses: the main source
    SELECT o.org_id, o.customer_id, o.address_text, o.lat, o.lng, 'opportunities' AS t, o.updated_at AS at
      FROM public.opportunities o JOIN public.customers c ON c.id = o.customer_id AND c.org_id = o.org_id
    UNION ALL
    -- a job only when it has no deal of the same customer behind it (otherwise it takes the deal's property, and a second
    -- spelling of the same street would make a duplicate)
    SELECT j.org_id, j.customer_id, j.address_text, j.lat, j.lng, 'production_jobs', j.updated_at
      FROM public.production_jobs j JOIN public.customers c ON c.id = j.customer_id AND c.org_id = j.org_id
     WHERE NOT EXISTS (SELECT 1 FROM public.projects pr JOIN public.opportunities o ON o.id = pr.opportunity_id AND o.org_id = pr.org_id
                        WHERE pr.id = j.project_id AND pr.org_id = j.org_id AND o.customer_id = j.customer_id
                          AND public.property_address_key(o.address_text) <> '')
    UNION ALL
    -- the customer's own address only when no deal of theirs has one (same reason)
    SELECT c.org_id, c.id, c.address_text, NULL::numeric, NULL::numeric, 'customers', c.updated_at
      FROM public.customers c
     WHERE NOT EXISTS (SELECT 1 FROM public.opportunities o WHERE o.customer_id = c.id AND o.org_id = c.org_id
                         AND public.property_address_key(o.address_text) <> '')
  ), keyed AS (
    SELECT src.*, public.property_address_key(src.address_text) AS k FROM src WHERE src.customer_id IS NOT NULL
  )
  SELECT k1.org_id, k1.customer_id, k1.k,
         -- the most recent spelling people used, coordinates from the newest row that has them
         (array_agg(btrim(k1.address_text) ORDER BY k1.at DESC))[1],
         (array_agg(k1.lat ORDER BY k1.at DESC) FILTER (WHERE k1.lat IS NOT NULL AND k1.lng IS NOT NULL))[1],
         (array_agg(k1.lng ORDER BY k1.at DESC) FILTER (WHERE k1.lat IS NOT NULL AND k1.lng IS NOT NULL))[1],
         array_agg(DISTINCT k1.t)
    FROM keyed k1
   WHERE k1.k <> '' AND char_length(btrim(k1.address_text)) <= 500   -- the properties CHECK; a longer one stays unlinked
   GROUP BY k1.org_id, k1.customer_id, k1.k;
$$;

CREATE OR REPLACE FUNCTION release_backups.backfill_properties(p_mode text DEFAULT 'preview') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_plan jsonb;
  v_created int := 0; v_opp int := 0; v_job int := 0; v_wo int := 0; v_docs int := 0;
BEGIN
  IF p_mode NOT IN ('preview', 'apply') THEN RAISE EXCEPTION 'mode must be preview or apply'; END IF;

  SELECT jsonb_build_object(
    'properties_needed', (SELECT count(*) FROM release_backups.property_backfill_sources()),
    'properties_already_there', (SELECT count(*) FROM release_backups.property_backfill_sources() s
                                   JOIN public.properties p ON p.org_id = s.org_id AND p.customer_id = s.customer_id AND p.address_key = s.address_key),
    'customers_with_more_than_one_address', (SELECT count(*) FROM (SELECT 1 FROM release_backups.property_backfill_sources() GROUP BY org_id, customer_id HAVING count(*) > 1) x),
    'opportunities_to_link', (SELECT count(*) FROM public.opportunities WHERE property_id IS NULL AND customer_id IS NOT NULL AND public.property_address_key(address_text) <> ''),
    'opportunities_no_customer_or_address', (SELECT count(*) FROM public.opportunities WHERE property_id IS NULL AND (customer_id IS NULL OR public.property_address_key(address_text) = '')),
    'jobs_to_link', (SELECT count(*) FROM public.production_jobs WHERE property_id IS NULL AND customer_id IS NOT NULL),
    'jobs_no_customer', (SELECT count(*) FROM public.production_jobs WHERE property_id IS NULL AND customer_id IS NULL),
    'work_orders_with_job', (SELECT count(*) FROM public.work_orders WHERE property_id IS NULL AND job_id IS NOT NULL),
    'documents_on_job', (SELECT count(*) FROM public.documents WHERE property_id IS NULL AND job_id IS NOT NULL),
    'sample', (SELECT coalesce(jsonb_agg(to_jsonb(s) - 'org_id'), '[]'::jsonb) FROM (SELECT * FROM release_backups.property_backfill_sources() ORDER BY customer_id LIMIT 15) s)
  ) INTO v_plan;

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('mode', 'preview', 'wrote_nothing', true, 'plan', v_plan);
  END IF;

  -- ---- apply: one function = one transaction ----
  -- a. properties
  WITH ins AS (
    INSERT INTO public.properties (org_id, customer_id, address_text, lat, lng, source)
    SELECT s.org_id, s.customer_id, s.address_text,
           CASE WHEN s.lat BETWEEN -90 AND 90 THEN s.lat END, CASE WHEN s.lng BETWEEN -180 AND 180 THEN s.lng END, 'backfill'
      FROM release_backups.property_backfill_sources() s
    ON CONFLICT (org_id, customer_id, address_key) DO NOTHING
    RETURNING id, org_id
  )
  INSERT INTO release_backups.backfill_properties_created (run_id, property_id, org_id) SELECT v_run, id, org_id FROM ins;
  GET DIAGNOSTICS v_created = ROW_COUNT;

  -- b. opportunities (the fill trigger checks company + customer on this UPDATE OF property_id)
  WITH m AS (
    SELECT o.id, o.org_id, p.id AS pid FROM public.opportunities o
      JOIN public.properties p ON p.org_id = o.org_id AND p.customer_id = o.customer_id AND p.address_key = public.property_address_key(o.address_text)
     WHERE o.property_id IS NULL
  ), u AS (
    UPDATE public.opportunities o SET property_id = m.pid FROM m WHERE o.id = m.id AND o.property_id IS NULL RETURNING o.id, o.org_id, o.property_id
  )
  INSERT INTO release_backups.backfill_properties_rows (run_id, table_name, row_id, org_id, applied_property_id)
  SELECT v_run, 'opportunities', id, org_id, property_id FROM u;
  GET DIAGNOSTICS v_opp = ROW_COUNT;

  -- c. production_jobs: deal's property first, else the job's own customer + address
  WITH m AS (
    SELECT j.id, j.org_id,
           coalesce(
             (SELECT o.property_id FROM public.projects pr JOIN public.opportunities o ON o.id = pr.opportunity_id AND o.org_id = pr.org_id
               WHERE pr.id = j.project_id AND pr.org_id = j.org_id AND o.property_id IS NOT NULL
                 AND o.customer_id IS NOT DISTINCT FROM j.customer_id),
             (SELECT p.id FROM public.properties p WHERE p.org_id = j.org_id AND p.customer_id = j.customer_id
                 AND p.address_key = public.property_address_key(j.address_text))
           ) AS pid
      FROM public.production_jobs j WHERE j.property_id IS NULL AND j.customer_id IS NOT NULL
  ), u AS (
    UPDATE public.production_jobs j SET property_id = m.pid FROM m WHERE j.id = m.id AND m.pid IS NOT NULL AND j.property_id IS NULL
    RETURNING j.id, j.org_id, j.property_id
  )
  INSERT INTO release_backups.backfill_properties_rows (run_id, table_name, row_id, org_id, applied_property_id)
  SELECT v_run, 'production_jobs', id, org_id, property_id FROM u;
  GET DIAGNOSTICS v_job = ROW_COUNT;

  -- d. work_orders: their job's property
  WITH u AS (
    UPDATE public.work_orders w SET property_id = j.property_id
      FROM public.production_jobs j
     WHERE w.property_id IS NULL AND j.id = w.job_id AND j.org_id = w.org_id AND j.property_id IS NOT NULL
       AND (w.customer_id IS NULL OR w.customer_id = j.customer_id)
    RETURNING w.id, w.org_id, w.property_id
  )
  INSERT INTO release_backups.backfill_properties_rows (run_id, table_name, row_id, org_id, applied_property_id)
  SELECT v_run, 'work_orders', id, org_id, property_id FROM u;
  GET DIAGNOSTICS v_wo = ROW_COUNT;

  -- e. documents: their job's property
  WITH u AS (
    UPDATE public.documents d SET property_id = j.property_id
      FROM public.production_jobs j
     WHERE d.property_id IS NULL AND j.id = d.job_id AND j.org_id = d.org_id AND j.property_id IS NOT NULL
       AND (d.customer_id IS NULL OR d.customer_id = j.customer_id)
    RETURNING d.id, d.org_id, d.property_id
  )
  INSERT INTO release_backups.backfill_properties_rows (run_id, table_name, row_id, org_id, applied_property_id)
  SELECT v_run, 'documents', id, org_id, property_id FROM u;
  GET DIAGNOSTICS v_docs = ROW_COUNT;

  RETURN jsonb_build_object('mode', 'apply', 'run_id', v_run, 'plan', v_plan - 'sample',
    'properties_created', v_created, 'opportunities_linked', v_opp, 'jobs_linked', v_job, 'work_orders_linked', v_wo, 'documents_linked', v_docs,
    'undo', 'SELECT release_backups.undo_backfill_properties();');
END;
$$;

CREATE OR REPLACE FUNCTION release_backups.undo_backfill_properties() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_reverted int := 0; v_n int; v_deleted int := 0; v_kept int := 0; v_changed int;
  r record;
BEGIN
  -- 1. clear property_id only where it still holds the applied value
  WITH u AS (UPDATE public.documents t SET property_id = NULL FROM release_backups.backfill_properties_rows b
              WHERE b.undone_at IS NULL AND b.table_name = 'documents' AND t.id = b.row_id AND t.property_id = b.applied_property_id RETURNING b.run_id, b.row_id)
  UPDATE release_backups.backfill_properties_rows b SET undone_at = now() FROM u WHERE b.table_name = 'documents' AND b.run_id = u.run_id AND b.row_id = u.row_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_reverted := v_reverted + v_n;
  WITH u AS (UPDATE public.work_orders t SET property_id = NULL FROM release_backups.backfill_properties_rows b
              WHERE b.undone_at IS NULL AND b.table_name = 'work_orders' AND t.id = b.row_id AND t.property_id = b.applied_property_id RETURNING b.run_id, b.row_id)
  UPDATE release_backups.backfill_properties_rows b SET undone_at = now() FROM u WHERE b.table_name = 'work_orders' AND b.run_id = u.run_id AND b.row_id = u.row_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_reverted := v_reverted + v_n;
  WITH u AS (UPDATE public.production_jobs t SET property_id = NULL FROM release_backups.backfill_properties_rows b
              WHERE b.undone_at IS NULL AND b.table_name = 'production_jobs' AND t.id = b.row_id AND t.property_id = b.applied_property_id RETURNING b.run_id, b.row_id)
  UPDATE release_backups.backfill_properties_rows b SET undone_at = now() FROM u WHERE b.table_name = 'production_jobs' AND b.run_id = u.run_id AND b.row_id = u.row_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_reverted := v_reverted + v_n;
  WITH u AS (UPDATE public.opportunities t SET property_id = NULL FROM release_backups.backfill_properties_rows b
              WHERE b.undone_at IS NULL AND b.table_name = 'opportunities' AND t.id = b.row_id AND t.property_id = b.applied_property_id RETURNING b.run_id, b.row_id)
  UPDATE release_backups.backfill_properties_rows b SET undone_at = now() FROM u WHERE b.table_name = 'opportunities' AND b.run_id = u.run_id AND b.row_id = u.row_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_reverted := v_reverted + v_n;
  SELECT count(*) INTO v_changed FROM release_backups.backfill_properties_rows WHERE undone_at IS NULL;

  -- 2. delete a created property only if nothing points at it and nobody edited it since
  FOR r IN SELECT c.property_id FROM release_backups.backfill_properties_created c WHERE c.undone_at IS NULL LOOP
    IF EXISTS (SELECT 1 FROM public.opportunities WHERE property_id = r.property_id)
       OR EXISTS (SELECT 1 FROM public.production_jobs WHERE property_id = r.property_id)
       OR EXISTS (SELECT 1 FROM public.work_orders WHERE property_id = r.property_id)
       OR EXISTS (SELECT 1 FROM public.documents WHERE property_id = r.property_id) THEN
      v_kept := v_kept + 1;
      UPDATE release_backups.backfill_properties_created SET kept_reason = 'in use' WHERE property_id = r.property_id;
    ELSIF EXISTS (SELECT 1 FROM public.properties p WHERE p.id = r.property_id
                   AND (p.updated_at > p.created_at + interval '1 second' OR p.source <> 'backfill'
                        OR coalesce(to_jsonb(p) -> 'custom_fields', '{}'::jsonb) NOT IN ('{}'::jsonb, 'null'::jsonb))) THEN
      v_kept := v_kept + 1;
      UPDATE release_backups.backfill_properties_created SET kept_reason = 'edited since' WHERE property_id = r.property_id;
    ELSE
      DELETE FROM public.properties WHERE id = r.property_id;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted + v_n;
      UPDATE release_backups.backfill_properties_created SET undone_at = now() WHERE property_id = r.property_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('property_ids_cleared', v_reverted, 'left_alone_changed_since', v_changed,
                            'properties_deleted', v_deleted, 'properties_kept', v_kept);
END;
$$;

SELECT release_backups.backfill_properties('preview');
