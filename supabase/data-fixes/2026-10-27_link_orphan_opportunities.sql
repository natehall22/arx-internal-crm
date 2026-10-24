-- Link every opportunity that has no customer to one (Customer File needs a customer to key on).
--
-- HOW THIS FILE RUNS (nothing is written to any existing table by running it as-is):
--   1. Running the whole file only (re)creates functions + backup tables in the private schema `release_backups` (not exposed to the
--      API; no anon/authenticated access) and then calls the PREVIEW, which reads and returns the plan. Look at the match list.
--   2. To apply, run only:   SELECT release_backups.link_orphan_opportunities('apply');
--   3. One-command undo:     SELECT release_backups.undo_link_orphan_opportunities();
--
-- Matching (same identity rules as lib/customers.ts findExistingCustomer, with one stricter rule for this bulk run):
--   * real email (placeholder emails ignored) -> that customer, any name;
--   * else EXACT phone: customers.phone_normalized = the lead's last-10 digits (or 1 + those digits), filler numbers excluded —
--     and ONLY when the lead's name and the customer's name agree (see release_backups.names_compatible). A phone match with
--     disagreeing (or missing) names is NOT merged: it becomes a new customer and is listed in the preview as `phone_name_disagrees`;
--   * else one NEW customer per distinct person (email, else phone, else name+address, else the opportunity itself).
-- leads.customer_id is NOT written (canvass reads it as "existing customer"); no QuickBooks event is queued (QuickBooks only hears
-- about a customer at signing). Nothing is deleted. Run AFTER migration 202610270010.
--
-- Backup + undo: every change is recorded in release_backups.link_orphan_opps (previous AND applied customer_id) and
-- release_backups.link_orphan_customers (customers this run created). Undo only reverts an opportunity that STILL has the applied
-- customer, and only deletes a created customer that nothing else references (opportunities, leads, proposals, activities, ... —
-- every foreign key to customers is checked), so work done since is never lost. If the notes fix (2026-10-27_merge_notes_into_threads)
-- was also applied, undo THAT first (its imported notes reference these customers).

CREATE SCHEMA IF NOT EXISTS release_backups;
REVOKE ALL ON SCHEMA release_backups FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA release_backups FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA release_backups FROM authenticated; END IF;
END $$;

CREATE TABLE IF NOT EXISTS release_backups.link_orphan_opps (
  run_id               uuid        NOT NULL,
  opportunity_id       uuid        NOT NULL,
  org_id               uuid        NOT NULL,
  decision             text        NOT NULL,            -- link_email | link_phone | new_customer
  prev_customer_id     uuid        NULL,                -- always NULL for this fix (they were orphans)
  applied_customer_id  uuid        NOT NULL,
  applied_at           timestamptz NOT NULL DEFAULT now(),
  undone_at            timestamptz NULL,
  PRIMARY KEY (run_id, opportunity_id)
);
CREATE TABLE IF NOT EXISTS release_backups.link_orphan_customers (
  run_id       uuid        NOT NULL,
  customer_id  uuid        NOT NULL PRIMARY KEY,
  org_id       uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  undone_at    timestamptz NULL,
  kept_reason  text        NULL
);

-- Names agree when their meaningful word sets (letters only, 2+ letters, titles/suffixes dropped) are equal or one contains the
-- other AND the smaller has at least two words: "Ashley Gaines" = "ASHLEY P GAINES" = "Ashley & John Gaines"; "Bill Cox" <> "William Cox";
-- one-word names never agree (never merge two people on a phone number plus "Smith").
CREATE OR REPLACE FUNCTION release_backups.name_tokens(p text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(DISTINCT t ORDER BY t), ARRAY[]::text[])
  FROM unnest(regexp_split_to_array(lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z]+', ' ', 'g')), '\s+')) AS t
  WHERE length(t) >= 2 AND t NOT IN ('and', 'jr', 'sr', 'ii', 'iii', 'mr', 'mrs', 'ms', 'dr', 'the');
$$;
CREATE OR REPLACE FUNCTION release_backups.names_compatible(a text, b text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (cardinality(release_backups.name_tokens(a)) >= 2 AND release_backups.name_tokens(a) <@ release_backups.name_tokens(b))
      OR (cardinality(release_backups.name_tokens(b)) >= 2 AND release_backups.name_tokens(b) <@ release_backups.name_tokens(a));
$$;

-- The plan: one row per orphan opportunity with what will happen to it.
CREATE OR REPLACE FUNCTION release_backups.orphan_plan() RETURNS TABLE (
  opp_id uuid, org_id uuid, status text, lead_id uuid, lead_name text, lead_phone text, lead_email text, lead_address text, opp_address text,
  p10 text, em text, by_email uuid, by_phone uuid, phone_candidate uuid, person_key text, decision text, note text
) LANGUAGE sql STABLE AS $$
  WITH o AS (
    SELECT op.id AS opp_id, op.org_id, op.status::text AS status, op.lead_id, op.address_text AS opp_addr,
           l.homeowner_name, l.phone, l.email, l.address_text AS lead_addr,
           CASE WHEN right(regexp_replace(coalesce(l.phone,''),'\D','','g'),10) ~ '^(\d)\1{9}$'
                  OR right(regexp_replace(coalesce(l.phone,''),'\D','','g'),10) IN ('1234567890','0123456789') THEN ''
                ELSE right(regexp_replace(coalesce(l.phone,''),'\D','','g'),10) END AS p10,
           CASE WHEN lower(btrim(coalesce(l.email,''))) IN ('','none@none.com','noemail@noemail.com','noemail@example.com') THEN NULL ELSE lower(btrim(l.email)) END AS em
    FROM opportunities op LEFT JOIN leads l ON l.id = op.lead_id AND l.org_id = op.org_id
    WHERE op.customer_id IS NULL
  ), c AS (
    SELECT o.*,
      (SELECT c.id FROM customers c WHERE c.org_id = o.org_id AND o.em IS NOT NULL AND c.email_lower = o.em ORDER BY c.created_at, c.id LIMIT 1) AS by_email,
      -- oldest customer that shares the EXACT normalized phone ...
      (SELECT c.id FROM customers c WHERE c.org_id = o.org_id AND length(o.p10) = 10 AND c.phone_normalized IN (o.p10, '1' || o.p10) ORDER BY c.created_at, c.id LIMIT 1) AS phone_candidate,
      -- ... and the oldest one whose NAME also agrees with the lead's: the only phone match we accept
      (SELECT c.id FROM customers c WHERE c.org_id = o.org_id AND length(o.p10) = 10 AND c.phone_normalized IN (o.p10, '1' || o.p10)
          AND release_backups.names_compatible(o.homeowner_name, c.name) ORDER BY c.created_at, c.id LIMIT 1) AS by_phone
    FROM o
  )
  SELECT c.opp_id, c.org_id, c.status, c.lead_id, c.homeowner_name, c.phone, c.email, c.lead_addr, c.opp_addr, c.p10, c.em, c.by_email, c.by_phone, c.phone_candidate,
         coalesce(c.em, CASE WHEN length(c.p10) = 10 THEN c.p10 END,
                  nullif(lower(btrim(coalesce(c.homeowner_name,'') || '|' || coalesce(c.lead_addr, c.opp_addr, ''))), '|'), c.opp_id::text) AS person_key,
         CASE WHEN c.by_email IS NOT NULL THEN 'link_email' WHEN c.by_phone IS NOT NULL THEN 'link_phone' ELSE 'new_customer' END AS decision,
         CASE WHEN c.by_email IS NULL AND c.by_phone IS NULL AND c.phone_candidate IS NOT NULL THEN 'phone_name_disagrees' END AS note
  FROM c;
$$;

CREATE OR REPLACE FUNCTION release_backups.link_orphan_opportunities(p_mode text DEFAULT 'preview') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_summary jsonb;
  v_matches jsonb;
  v_new_n int; v_linked_n int; v_orphans int; v_after int;
BEGIN
  IF p_mode NOT IN ('preview', 'apply') THEN RAISE EXCEPTION 'mode must be preview or apply'; END IF;

  SELECT jsonb_build_object(
           'orphans', count(*),
           'link_existing_by_email', count(*) FILTER (WHERE decision = 'link_email'),
           'link_existing_by_phone_names_agree', count(*) FILTER (WHERE decision = 'link_phone'),
           'phone_match_refused_names_disagree', count(*) FILTER (WHERE note = 'phone_name_disagrees'),
           'need_new_customer', count(*) FILTER (WHERE decision = 'new_customer'),
           'distinct_new_customers', count(DISTINCT (org_id, person_key)) FILTER (WHERE decision = 'new_customer'),
           'no_lead_at_all', count(*) FILTER (WHERE lead_id IS NULL)),
         count(*)
    INTO v_summary, v_orphans
  FROM release_backups.orphan_plan();

  -- The final match list: every orphan that joins an EXISTING customer, and every phone match that was refused.
  SELECT coalesce(jsonb_agg(jsonb_build_object('opportunity', p.opp_id, 'status', p.status, 'lead_name', p.lead_name, 'lead_phone', p.lead_phone,
           'decision', p.decision, 'matched_customer', c.name, 'matched_customer_phone', c.phone, 'refused_phone_match_with', rc.name) ORDER BY p.decision, p.lead_name), '[]'::jsonb)
    INTO v_matches
  FROM release_backups.orphan_plan() p
  LEFT JOIN customers c ON c.id = coalesce(p.by_email, p.by_phone)
  LEFT JOIN customers rc ON rc.id = p.phone_candidate AND p.note = 'phone_name_disagrees'
  WHERE p.decision <> 'new_customer' OR p.note IS NOT NULL;

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('mode', 'preview', 'wrote_nothing', true, 'summary', v_summary, 'matches_and_refusals', v_matches);
  END IF;

  -- ---- apply: one function = one transaction; any failure rolls all of it back ----
  DROP TABLE IF EXISTS _plan; DROP TABLE IF EXISTS _new;   -- (a second call in the same transaction)
  CREATE TEMP TABLE _plan ON COMMIT DROP AS SELECT * FROM release_backups.orphan_plan();
  CREATE TEMP TABLE _new ON COMMIT DROP AS
    SELECT DISTINCT ON (p.org_id, p.person_key) p.org_id, p.person_key, gen_random_uuid() AS customer_id,
           coalesce(nullif(btrim(p.lead_name),''), nullif(btrim(split_part(coalesce(p.lead_address, p.opp_address, ''), ',', 1)),''),
                    CASE WHEN length(p.p10) >= 4 THEN 'Customer (' || right(p.p10, 4) || ')' END, 'Customer') AS name,
           p.lead_phone AS phone, p.em AS email, coalesce(p.lead_address, p.opp_address) AS address_text
    FROM _plan p WHERE p.decision = 'new_customer'
    ORDER BY p.org_id, p.person_key, p.opp_id;

  INSERT INTO customers (id, org_id, name, phone, email, address_text) SELECT customer_id, org_id, name, phone, email, address_text FROM _new;
  INSERT INTO release_backups.link_orphan_customers (run_id, customer_id, org_id) SELECT v_run, customer_id, org_id FROM _new;

  INSERT INTO release_backups.link_orphan_opps (run_id, opportunity_id, org_id, decision, prev_customer_id, applied_customer_id)
  SELECT v_run, p.opp_id, p.org_id, p.decision, NULL, coalesce(p.by_email, p.by_phone, n.customer_id)
  FROM _plan p LEFT JOIN _new n ON n.org_id = p.org_id AND n.person_key = p.person_key AND p.decision = 'new_customer';

  UPDATE opportunities op SET customer_id = b.applied_customer_id
    FROM release_backups.link_orphan_opps b
   WHERE b.run_id = v_run AND op.id = b.opportunity_id AND op.customer_id IS NULL;

  SELECT count(*) INTO v_new_n FROM _new;
  SELECT count(*) INTO v_linked_n FROM release_backups.link_orphan_opps b JOIN opportunities op ON op.id = b.opportunity_id AND op.customer_id = b.applied_customer_id WHERE b.run_id = v_run;
  SELECT count(*) INTO v_after FROM opportunities WHERE customer_id IS NULL;
  IF v_linked_n <> v_orphans THEN RAISE EXCEPTION 'link_orphan_opportunities: linked % of % planned; rolled back', v_linked_n, v_orphans; END IF;
  IF v_after <> 0 THEN RAISE EXCEPTION 'link_orphan_opportunities: % opportunities still without a customer; rolled back', v_after; END IF;

  RETURN jsonb_build_object('mode', 'apply', 'run_id', v_run, 'summary', v_summary, 'opportunities_linked', v_linked_n, 'customers_created', v_new_n,
                            'orphans_remaining', v_after, 'undo', 'SELECT release_backups.undo_link_orphan_opportunities();');
END;
$$;

CREATE OR REPLACE FUNCTION release_backups.undo_link_orphan_opportunities() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_reverted int := 0; v_changed int := 0; v_deleted int := 0; v_kept int := 0;
  r record; fk record; used boolean; n int;
BEGIN
  -- 1. opportunities: put back the previous customer ONLY where the applied one is still there
  WITH upd AS (
    UPDATE opportunities op SET customer_id = b.prev_customer_id
      FROM release_backups.link_orphan_opps b
     WHERE b.undone_at IS NULL AND op.id = b.opportunity_id AND op.customer_id IS NOT DISTINCT FROM b.applied_customer_id
    RETURNING b.run_id, b.opportunity_id
  ) UPDATE release_backups.link_orphan_opps b SET undone_at = now() FROM upd WHERE b.run_id = upd.run_id AND b.opportunity_id = upd.opportunity_id;
  GET DIAGNOSTICS v_reverted = ROW_COUNT;
  SELECT count(*) INTO v_changed FROM release_backups.link_orphan_opps WHERE undone_at IS NULL;   -- changed since: left exactly as they are

  -- 2. customers this run created: delete only those NOTHING references (every foreign key to customers is checked)
  FOR r IN SELECT customer_id FROM release_backups.link_orphan_customers WHERE undone_at IS NULL LOOP
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
      UPDATE release_backups.link_orphan_customers SET kept_reason = 'referenced by other records' WHERE customer_id = r.customer_id;
    ELSE
      DELETE FROM customers WHERE id = r.customer_id;
      GET DIAGNOSTICS n = ROW_COUNT;
      v_deleted := v_deleted + n;
      UPDATE release_backups.link_orphan_customers SET undone_at = now() WHERE customer_id = r.customer_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('opportunities_reverted', v_reverted, 'opportunities_changed_since_left_alone', v_changed,
                            'customers_deleted', v_deleted, 'customers_kept_because_in_use', v_kept);
END;
$$;

-- Default action when this file is run: PREVIEW ONLY (writes nothing to any existing table).
SELECT release_backups.link_orphan_opportunities('preview');
-- To apply (after looking at the match list above):   SELECT release_backups.link_orphan_opportunities('apply');
-- To undo, one command:                               SELECT release_backups.undo_link_orphan_opportunities();
