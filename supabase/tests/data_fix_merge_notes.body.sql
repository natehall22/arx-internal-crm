-- DB test for supabase/data-fixes/2026-10-27_merge_notes_into_threads.sql (body of ONE DO block that always ends in RAISE EXCEPTION,
-- so it can only be rolled back). Needs migration 202610270010 + the data fix's functions. Uses an org with >=2 active users.
DECLARE
  v_org uuid; v_admin uuid; v_setter uuid; v_res jsonb; v_undo jsonb; v_n int; v_report text := '';
  v_opp uuid := gen_random_uuid(); v_lead uuid := gen_random_uuid(); v_proj uuid := gen_random_uuid(); v_job uuid := gen_random_uuid();
  n_crew uuid := gen_random_uuid(); n_prod uuid := gen_random_uuid(); n_plain uuid := gen_random_uuid();
  a_human uuid := gen_random_uuid(); a_sys uuid := gen_random_uuid(); a_changed uuid := gen_random_uuid();
  v_before_imported int; v_act uuid; v_edit uuid; v_reply_to uuid;
BEGIN
  SELECT org_id, id INTO v_org, v_admin FROM users WHERE active ORDER BY created_at LIMIT 1;
  SELECT id INTO v_setter FROM users WHERE org_id = v_org AND id <> v_admin AND active ORDER BY created_at LIMIT 1;
  IF v_setter IS NULL THEN RAISE EXCEPTION 'TEST SETUP: need 2 users'; END IF;
  UPDATE users SET role = 'setter' WHERE id = v_setter;   -- (rolled back)
  SELECT count(*) INTO v_before_imported FROM activities WHERE source = 'import';

  INSERT INTO leads (id, org_id, homeowner_name, notes) VALUES (v_lead, v_org, 'Test Homeowner', 'Lead says call after 2pm');
  INSERT INTO opportunities (id, org_id, lead_id, address_text, inspection_notes) VALUES (v_opp, v_org, v_lead, '9 Test Rd', 'Roof is 2 layers');
  INSERT INTO projects (id, org_id, opportunity_id, notes, ops_notes) VALUES (v_proj, v_org, v_opp, 'Project note', NULL);
  INSERT INTO production_jobs (id, org_id, project_id, job_number, address_text, created_by, status, internal_notes, special_instructions)
    VALUES (v_job, v_org, v_proj, 'TESTJ-NOTES', '9 Test Rd', v_admin, 'sold', 'Dumpster on the street', 'Gate code 4471');
  INSERT INTO production_job_notes (id, job_id, user_id, note, share_with_sub, is_internal) VALUES
    (n_crew,  v_job, v_admin, 'Crew: install is $145/sq labor, ridge vent on the back slope', true, false),   -- shared with the sub AND price-looking
    (n_prod,  v_job, v_admin, 'We paid the supplier a $500 deposit and 10% off', false, true),                  -- production-only AND price-looking
    (n_plain, v_job, v_admin, 'Customer asked for the crew to park on the street', false, true);
  INSERT INTO activities (id, org_id, opportunity_id, user_id, type, body) VALUES
    (a_human,   v_org, v_opp, v_setter, 'note', 'Homeowner works nights, call after 2pm'),
    (a_sys,     v_org, v_opp, NULL,     'status_change', 'Status → Scheduled'),
    (a_changed, v_org, v_opp, v_admin,  'note', 'Another human note');

  v_res := release_backups.merge_notes_into_threads('preview');
  IF (v_res->>'wrote_nothing')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'preview flag'; END IF;
  SELECT count(*) INTO v_n FROM activities WHERE id IN (a_human, a_sys, a_changed) AND origin IS NOT NULL; IF v_n <> 0 THEN RAISE EXCEPTION 'preview wrote classification'; END IF;
  SELECT count(*) INTO v_n FROM activities WHERE source = 'import'; IF v_n <> v_before_imported THEN RAISE EXCEPTION 'preview wrote notes'; END IF;

  v_res := release_backups.merge_notes_into_threads('apply');
  -- classification
  IF (SELECT origin FROM activities WHERE id = a_human) <> 'human' OR (SELECT audience FROM activities WHERE id = a_human) <> 'sales' THEN RAISE EXCEPTION 'setter note should be human/sales'; END IF;
  IF (SELECT origin FROM activities WHERE id = a_sys) <> 'system' THEN RAISE EXCEPTION 'status row should be system'; END IF;
  -- copies
  SELECT id INTO v_act FROM activities WHERE legacy_ref->>'id' = n_crew::text;
  IF (SELECT audience FROM activities WHERE id = v_act) <> 'crew' THEN RAISE EXCEPTION 'shared-with-sub note must be audience crew'; END IF;
  IF (SELECT restricted_pricing FROM activities WHERE id = v_act) IS NOT NULL THEN RAISE EXCEPTION 'a note ALREADY shared with the sub must NOT be price-flagged (crew link would hide it)'; END IF;
  SELECT id INTO v_act FROM activities WHERE legacy_ref->>'id' = n_prod::text;
  IF (SELECT restricted_pricing FROM activities WHERE id = v_act) IS NOT TRUE THEN RAISE EXCEPTION 'a production-only price-looking note should still be flagged'; END IF;
  SELECT id INTO v_act FROM activities WHERE legacy_ref->>'id' = n_plain::text;
  IF (SELECT restricted_pricing FROM activities WHERE id = v_act) IS NOT NULL THEN RAISE EXCEPTION 'plain note must not be flagged'; END IF;
  SELECT count(*) INTO v_n FROM activities WHERE source = 'import' AND opportunity_id = v_opp;
  IF v_n <> 3 + 5 THEN RAISE EXCEPTION 'expected 8 copied notes (3 job notes + inspection + lead + project + internal + special), got %', v_n; END IF;
  IF (SELECT count(*) FROM activities WHERE source = 'import' AND opportunity_id = v_opp AND pinned_at IS NOT NULL) <> 1 THEN RAISE EXCEPTION 'special instructions should be pinned'; END IF;
  v_report := v_report || E'\napply OK: ' || (v_res->>'activities_classified') || ' classified, ' || (v_res->>'notes_copied') || ' copied (' || v_n || ' on the test deal); crew-shared note NOT price-flagged; production price note flagged';

  -- idempotent
  v_res := release_backups.merge_notes_into_threads('apply');
  IF (v_res->>'notes_copied')::int <> 0 THEN RAISE EXCEPTION 'second apply copied %', v_res->>'notes_copied'; END IF;

  -- people act on the merged notes: one imported note is edited, one is replied to, one classified row is changed
  SELECT id INTO v_edit FROM activities WHERE legacy_ref->>'id' = n_plain::text;
  UPDATE activities SET body = body || ' (edited)', edited_at = now() WHERE id = v_edit;
  SELECT id INTO v_reply_to FROM activities WHERE legacy_ref->>'id' = n_prod::text;
  INSERT INTO activities (org_id, opportunity_id, user_id, type, body, origin, audience, reply_to_id) VALUES (v_org, v_opp, v_admin, 'note', 'Got it', 'human', 'team', v_reply_to);
  UPDATE activities SET audience = 'production' WHERE id = a_changed;     -- reclassified since the merge

  v_undo := release_backups.undo_merge_notes_into_threads();
  IF NOT EXISTS (SELECT 1 FROM activities WHERE id = v_edit) THEN RAISE EXCEPTION 'undo deleted an EDITED note'; END IF;
  IF NOT EXISTS (SELECT 1 FROM activities WHERE id = v_reply_to) THEN RAISE EXCEPTION 'undo deleted a note that has a reply'; END IF;
  SELECT count(*) INTO v_n FROM activities WHERE source = 'import' AND opportunity_id = v_opp; IF v_n <> 2 THEN RAISE EXCEPTION 'undo should keep exactly the 2 touched notes, kept %', v_n; END IF;
  IF (SELECT audience FROM activities WHERE id = a_changed) <> 'production' THEN RAISE EXCEPTION 'undo overwrote a reclassification made since'; END IF;
  IF (SELECT origin FROM activities WHERE id = a_human) IS NOT NULL OR (SELECT audience FROM activities WHERE id = a_human) IS NOT NULL THEN RAISE EXCEPTION 'undo did not restore an untouched classified row from backup'; END IF;
  IF (SELECT origin FROM activities WHERE id = a_sys) IS NOT NULL THEN RAISE EXCEPTION 'undo did not restore the system row'; END IF;
  v_report := v_report || E'\nundo OK: ' || v_undo::text;

  -- apply AGAIN after an undo, then undo AGAIN: the second undo must still restore (a stale backup row must not block it)
  v_res := release_backups.merge_notes_into_threads('apply');
  IF (SELECT origin FROM activities WHERE id = a_human) IS NULL THEN RAISE EXCEPTION 're-apply did not reclassify the setter note'; END IF;
  v_undo := release_backups.undo_merge_notes_into_threads();
  IF (SELECT origin FROM activities WHERE id = a_human) IS NOT NULL THEN RAISE EXCEPTION 'second undo restored nothing (stale backup row): %', v_undo; END IF;
  v_report := v_report || E'\napply -> undo -> apply -> undo OK: ' || v_undo::text;

  RAISE EXCEPTION E'REPORT (rolled back by design):%', v_report;
END
