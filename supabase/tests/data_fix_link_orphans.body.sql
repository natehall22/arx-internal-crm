-- DB test for supabase/data-fixes/2026-10-27_link_orphan_opportunities.sql. Body of ONE DO block that always ends in
-- RAISE EXCEPTION (the report), so it can only ever be rolled back. Needs migration 202610270010 applied and the data fix's
-- functions created (the file creates them; run it first, which only previews).
DECLARE
  v_org uuid := gen_random_uuid(); v_u uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  l record; v_sum jsonb; v_res jsonb; v_undo jsonb; v_n int; v_report text := '';
  O1 uuid := gen_random_uuid(); O2 uuid := gen_random_uuid(); O3 uuid := gen_random_uuid(); O4 uuid := gen_random_uuid();
  O5 uuid := gen_random_uuid(); O6 uuid := gen_random_uuid(); O7 uuid := gen_random_uuid(); O8 uuid := gen_random_uuid();
  L1 uuid := gen_random_uuid(); L2 uuid := gen_random_uuid(); L3 uuid := gen_random_uuid(); L4 uuid := gen_random_uuid();
  L5 uuid := gen_random_uuid(); L6 uuid := gen_random_uuid(); L7 uuid := gen_random_uuid();
  v_new uuid; v_other uuid := gen_random_uuid();
BEGIN
  INSERT INTO orgs (id, name) VALUES (v_org, 'FixTest Org');
  INSERT INTO customers (id, org_id, name, phone, email, created_at) VALUES
    (c1, v_org, 'ASHLEY P GAINES', '(704) 555-0142', NULL, '2026-01-01'),
    (c2, v_org, 'Bill Cox', '7045550199', NULL, '2026-01-02'),
    (c3, v_org, 'Dana Whitfield', NULL, 'dana@x.com', '2026-01-03');
  INSERT INTO leads (id, org_id, homeowner_name, phone, email, address_text) VALUES
    (L1, v_org, 'Ashley Gaines', '704-555-0142', NULL, '1 Maple Ln'),          -- O1: phone match, names agree
    (L2, v_org, 'Mary Smith',   '(704) 555-0199', NULL, '2 Oak Ln'),           -- O2: phone matches Bill Cox, names disagree
    (L3, v_org, 'Dana W',       NULL, 'DANA@x.com', '3 Pine Ln'),              -- O3: email match (any name)
    (L4, v_org, 'Tom Hale',     '555-555-5555', NULL, '4 Elm Ln'),             -- O4: filler phone: never an identity
    (L5, v_org, 'Pat Rowe',     NULL, 'pat@x.com', '5 Birch Ln'),              -- O5 + O6: same person, two deals -> ONE new customer
    (L6, v_org, NULL,           '704 555 0142', NULL, '6 Cedar Ln'),           -- O7: phone matches Ashley but the lead has no name
    (L7, v_org, 'Lee Park',     NULL, NULL, '7 Ash Ln');
  INSERT INTO opportunities (id, org_id, lead_id, address_text) VALUES
    (O1, v_org, L1, '1 Maple Ln'), (O2, v_org, L2, '2 Oak Ln'), (O3, v_org, L3, '3 Pine Ln'), (O4, v_org, L4, '4 Elm Ln'),
    (O5, v_org, L5, '5 Birch Ln'), (O6, v_org, L5, '5 Birch Ln (add-on)'), (O7, v_org, L6, '6 Cedar Ln'), (O8, v_org, NULL, '8 Fir Ln');

  -- name rule unit checks
  IF NOT release_backups.names_compatible('Ashley Gaines', 'ASHLEY P GAINES') THEN RAISE EXCEPTION 'names: middle initial should agree'; END IF;
  IF NOT release_backups.names_compatible('Mary Smith', 'John & Mary Smith') THEN RAISE EXCEPTION 'names: couple should agree'; END IF;
  IF release_backups.names_compatible('Bill Cox', 'William Cox') THEN RAISE EXCEPTION 'names: Bill vs William must NOT agree'; END IF;
  IF release_backups.names_compatible('Smith', 'Mary Smith') THEN RAISE EXCEPTION 'names: one-word name must NOT agree'; END IF;
  IF release_backups.names_compatible(NULL, 'Mary Smith') THEN RAISE EXCEPTION 'names: missing name must NOT agree'; END IF;

  -- PREVIEW writes nothing
  v_res := release_backups.link_orphan_opportunities('preview');
  IF (v_res->>'wrote_nothing')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'preview flag'; END IF;
  SELECT count(*) INTO v_n FROM opportunities WHERE org_id = v_org AND customer_id IS NULL; IF v_n <> 8 THEN RAISE EXCEPTION 'preview wrote: % orphans left', v_n; END IF;
  SELECT count(*) INTO v_n FROM customers WHERE org_id = v_org; IF v_n <> 3 THEN RAISE EXCEPTION 'preview created customers'; END IF;
  v_sum := v_res->'summary';
  -- (the plan sees ONLY this test org's orphans if the database has none of its own; otherwise compare deltas)
  v_report := v_report || E'\npreview: ' || v_sum::text;

  -- APPLY
  v_res := release_backups.link_orphan_opportunities('apply');
  v_sum := v_res->'summary';
  IF (v_res->>'orphans_remaining')::int <> 0 THEN RAISE EXCEPTION 'apply left orphans'; END IF;
  SELECT customer_id INTO v_new FROM opportunities WHERE id = O1; IF v_new <> c1 THEN RAISE EXCEPTION 'O1 should link to Ashley (phone + agreeing name)'; END IF;
  SELECT customer_id INTO v_new FROM opportunities WHERE id = O3; IF v_new <> c3 THEN RAISE EXCEPTION 'O3 should link to Dana by email'; END IF;
  SELECT customer_id INTO v_new FROM opportunities WHERE id = O2; IF v_new IN (c1, c2, c3) THEN RAISE EXCEPTION 'O2 (Mary Smith / Bill Cox phone) must NOT merge'; END IF;
  SELECT customer_id INTO v_new FROM opportunities WHERE id = O7; IF v_new IN (c1, c2, c3) THEN RAISE EXCEPTION 'O7 (no name) must NOT merge on phone'; END IF;
  IF (SELECT customer_id FROM opportunities WHERE id = O5) <> (SELECT customer_id FROM opportunities WHERE id = O6) THEN RAISE EXCEPTION 'O5/O6 are one person: one customer'; END IF;
  IF (SELECT customer_id FROM opportunities WHERE id = O4) IN (c1, c2, c3) THEN RAISE EXCEPTION 'O4 filler phone merged'; END IF;
  SELECT count(*) INTO v_n FROM customers WHERE org_id = v_org; IF v_n <> 3 + 5 THEN RAISE EXCEPTION 'expected 5 new customers, total %', v_n; END IF;
  SELECT count(*) INTO v_n FROM leads WHERE org_id = v_org AND customer_id IS NOT NULL; IF v_n <> 0 THEN RAISE EXCEPTION 'leads.customer_id must not be written'; END IF;
  v_report := v_report || E'\napply OK: 8 opportunities linked, 5 customers created, phone merges only where names agree, leads untouched';

  -- IDEMPOTENT: a second apply finds nothing to do
  v_res := release_backups.link_orphan_opportunities('apply');
  IF (v_res->>'opportunities_linked')::int <> 0 AND (v_res->>'orphans_remaining')::int <> 0 THEN RAISE EXCEPTION 'second apply not a no-op'; END IF;

  -- UNDO is guarded: something has since been linked to a created customer, and one deal was re-pointed by a person
  SELECT customer_id INTO v_new FROM opportunities WHERE id = O4;                 -- a created customer…
  UPDATE leads SET customer_id = v_new WHERE id = L4;                            -- …that now has another record (a lead points at it)
  UPDATE opportunities SET customer_id = c2 WHERE id = O8;                       -- a person moved this deal to another customer since
  v_undo := release_backups.undo_link_orphan_opportunities();
  IF (v_undo->>'opportunities_reverted')::int <> 7 THEN RAISE EXCEPTION 'undo should revert 7 (not the one moved): %', v_undo; END IF;
  IF (SELECT customer_id FROM opportunities WHERE id = O8) <> c2 THEN RAISE EXCEPTION 'undo overwrote a deal a person re-pointed'; END IF;
  SELECT count(*) INTO v_n FROM opportunities WHERE id IN (O1,O2,O3,O4,O5,O6,O7) AND customer_id IS NULL; IF v_n <> 7 THEN RAISE EXCEPTION 'undo did not restore NULL'; END IF;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = v_new) THEN RAISE EXCEPTION 'undo deleted a customer another record points at'; END IF;
  IF (v_undo->>'customers_kept_because_in_use')::int < 1 THEN RAISE EXCEPTION 'undo should report the kept customer: %', v_undo; END IF;
  SELECT count(*) INTO v_n FROM customers WHERE org_id = v_org; IF v_n < 4 THEN RAISE EXCEPTION 'undo removed too many customers'; END IF;
  v_report := v_report || E'\nundo OK: ' || v_undo::text;

  RAISE EXCEPTION E'REPORT (rolled back by design):%', v_report;
END
