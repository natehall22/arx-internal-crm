-- DB test for 202611240040 / 0045 / 0050 (RLS lockdown). Runs on the money-suite database (prod baseline schema + every
-- pending migration, supabase/tests/money/build_db.sh) — i.e. against prod's real policy set. See run-rls-lockdown.sh.
-- Everything happens in one transaction that is rolled back.
\set ON_ERROR_STOP 1
BEGIN;

-- build_db.sh grants EXECUTE on every function to anon/authenticated AFTER the migrations (Supabase's default grants), which
-- re-opens what 0040 section 3 closed.
-- Baseline drift: the dump's get_user_role is declared to return the retired enum user_role_old while users.role is now
-- user_role (prod's returns text: `SELECT role::TEXT ...`). Keep the dump's signature, make the body work like prod's.
DO $d$ BEGIN
  IF (SELECT prorettype::regtype::text FROM pg_proc WHERE proname = 'get_user_role' AND pronamespace = 'public'::regnamespace) = 'user_role_old' THEN
    EXECUTE $f$CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid uuid) RETURNS public.user_role_old LANGUAGE sql SECURITY DEFINER AS $b$
      SELECT CASE WHEN role::text = ANY (enum_range(NULL::public.user_role_old)::text[]) THEN role::text::public.user_role_old END FROM users WHERE id = user_uuid $b$$f$;
  END IF;
END $d$;
-- Re-apply 0040 (also proves it is re-runnable) and 0045.
\i supabase/migrations/202611240040_rls_lockdown_money_and_roles.sql
\i supabase/migrations/202611240045_rls_lockdown_change_order_insert.sql

-- As whom a statement runs. 'server' = no JWT (SQL editor / migrations).
CREATE OR REPLACE FUNCTION pg_temp.act(p_uid uuid, p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act(uuid, text) TO PUBLIC;

-- ── Seed (as the table owner, no JWT) ──
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-00000000a0a0'), ('00000000-0000-0000-0000-00000000a0b0'), ('00000000-0000-0000-0000-00000000a0c0'),
  ('00000000-0000-0000-0000-00000000a0d0'), ('00000000-0000-0000-0000-00000000b0a0');
INSERT INTO orgs (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'A Co'), ('00000000-0000-0000-0000-0000000000b1', 'B Co');
INSERT INTO users (id, org_id, role, full_name) VALUES
  ('00000000-0000-0000-0000-00000000a0a0', '00000000-0000-0000-0000-0000000000a1', 'admin', 'Admin A'),
  ('00000000-0000-0000-0000-00000000a0b0', '00000000-0000-0000-0000-0000000000a1', 'regional_manager', 'Manager A'),
  ('00000000-0000-0000-0000-00000000a0c0', '00000000-0000-0000-0000-0000000000a1', 'closer', 'Closer A'),
  ('00000000-0000-0000-0000-00000000a0d0', '00000000-0000-0000-0000-0000000000a1', 'setter', 'Setter A'),
  ('00000000-0000-0000-0000-00000000b0a0', '00000000-0000-0000-0000-0000000000b1', 'admin', 'Admin B');
INSERT INTO projects (id, org_id) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1');
INSERT INTO production_jobs (id, org_id, created_by, address_text, job_number, project_id)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a0a0', '1 Main', '26-9001', '00000000-0000-0000-0000-0000000000c1');
INSERT INTO opportunities (id, org_id, owner_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a0c0');
INSERT INTO order_form_contracts (id, org_id, customer_name, project_address, opportunity_id, created_by)
  VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Pat', '1 Main', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000a0c0');
INSERT INTO proposals (id, org_id, created_by, customer_name, customer_address, proposal_number, opportunity_id)
  VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a0c0', 'Pat', '1 Main', 'P-9001', '00000000-0000-0000-0000-0000000000e1');
INSERT INTO proposal_line_items (id, org_id, proposal_id, name, category, unit, unit_price, line_total)
  VALUES ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'Shingles', 'roof', 'sq', 450, 450);
-- The job is the closer's own sale (so before 0040 the closer could see it and pay it off through the API).
UPDATE production_jobs SET accepted_proposal_id = '00000000-0000-0000-0000-0000000000a2' WHERE id = '00000000-0000-0000-0000-0000000000d1';

-- ── Helpers: did a statement as <user> get refused / change rows? ──
CREATE OR REPLACE FUNCTION pg_temp.refused(p_uid uuid, p_role text, p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.act(p_uid, p_role);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN   -- 42501: RLS WITH CHECK, guard trigger, function EXECUTE
    RESET ROLE; RETURN true;
  END;
  RESET ROLE; RETURN false;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.rows_changed(p_uid uuid, p_role text, p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_temp.act(p_uid, p_role);
  EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE; RETURN n;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.count_as(p_uid uuid, p_role text, p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM pg_temp.act(p_uid, p_role);
  EXECUTE p_sql INTO n;
  RESET ROLE; RETURN n;
END $$;

DO $t$
DECLARE
  admin_a constant uuid := '00000000-0000-0000-0000-00000000a0a0';
  mgr_a constant uuid := '00000000-0000-0000-0000-00000000a0b0';
  closer_a constant uuid := '00000000-0000-0000-0000-00000000a0c0';
  setter_a constant uuid := '00000000-0000-0000-0000-00000000a0d0';
  admin_b constant uuid := '00000000-0000-0000-0000-00000000b0a0';
  org_a constant text := '00000000-0000-0000-0000-0000000000a1';
  job constant text := '00000000-0000-0000-0000-0000000000d1';
  n int;
BEGIN
  ASSERT pg_temp.count_as(closer_a, 'authenticated', 'SELECT count(*) FROM production_jobs') = 1, 'T0 the closer sees their own job';
  -- T1 money writes straight through the API are refused for every member, admins included (the app uses the service key)
  ASSERT pg_temp.refused(closer_a, 'authenticated', format($$INSERT INTO job_payments (job_id, amount_cents, payer, method, payment_type, paid_at) VALUES (%L, 1632500, 'homeowner', 'check', 'final', current_date)$$, job)),
    'T1 closer cannot insert a job payment';
  ASSERT pg_temp.refused(setter_a, 'authenticated', format($$INSERT INTO job_payments (job_id, amount_cents, payer, method, payment_type, paid_at) VALUES (%L, 1, 'homeowner', 'check', 'final', current_date)$$, job)),
    'T1 setter cannot insert a job payment';
  ASSERT pg_temp.refused(admin_a, 'authenticated', format($$INSERT INTO job_payments (job_id, amount_cents, payer, method, payment_type, paid_at) VALUES (%L, 1, 'homeowner', 'check', 'final', current_date)$$, job)),
    'T1 admin JWT cannot insert a job payment either';
  ASSERT pg_temp.refused(closer_a, 'authenticated', format($$INSERT INTO job_cost_lines (org_id, job_id, description) VALUES (%L, %L, 'x')$$, org_a, job)),
    'T1 closer cannot insert a cost line';
  ASSERT pg_temp.refused(closer_a, 'authenticated', format($$INSERT INTO job_change_orders (org_id, project_id, co_number, description, customer_print_name, customer_signature_data, rep_name, rep_signature_data, status) VALUES (%L, '00000000-0000-0000-0000-0000000000c1', 'CO-9', 'x', 'Pat', 'x', 'r', 'x', 'completed')$$, org_a)),
    'T1 closer cannot insert a signed change order (0045)';
  ASSERT pg_temp.refused(closer_a, 'authenticated', format($$INSERT INTO opportunities (org_id, owner_user_id) VALUES (%L, %L)$$, org_a, closer_a)),
    'T1 closer cannot create an opportunity';
  ASSERT pg_temp.refused(closer_a, 'authenticated', format($$INSERT INTO integration_outbox (org_id, provider, event_type, entity_table, entity_id, payload, idempotency_key) VALUES (%L, 'quickbooks', 'x', 'x', gen_random_uuid(), '{}', 'k')$$, org_a)),
    'T1 closer cannot enqueue an outbox event';

  -- T2 updates / deletes match nothing
  ASSERT pg_temp.rows_changed(closer_a, 'authenticated', format($$UPDATE opportunities SET owner_user_id = %L, setter_user_id = %L WHERE org_id = %L$$, closer_a, closer_a, org_a)) = 0, 'T2 sale credit cannot be rewritten';
  ASSERT pg_temp.rows_changed(mgr_a, 'authenticated', format($$DELETE FROM opportunities WHERE org_id = %L$$, org_a)) = 0, 'T2 manager cannot delete opportunities';
  ASSERT pg_temp.rows_changed(closer_a, 'authenticated', $$UPDATE order_form_contracts SET customer_name = 'changed'$$) = 0, 'T2 signed contract cannot be edited';
  ASSERT pg_temp.rows_changed(closer_a, 'authenticated', $$UPDATE proposals SET customer_name = 'changed'$$) = 0, 'T2 proposal cannot be edited';
  ASSERT pg_temp.rows_changed(closer_a, 'authenticated', $$UPDATE proposal_line_items SET unit_price = 1$$) = 0, 'T2 proposal lines cannot be edited';
  ASSERT pg_temp.rows_changed(admin_a, 'authenticated', $$DELETE FROM proposal_line_items$$) = 0, 'T2 proposal lines cannot be deleted';

  -- T3 reads are unchanged (the ALL policies' read survives, restrictive deny policies still apply)
  ASSERT pg_temp.count_as(closer_a, 'authenticated', 'SELECT count(*) FROM opportunities') = 1, 'T3 closer still reads their deal';
  ASSERT pg_temp.count_as(closer_a, 'authenticated', 'SELECT count(*) FROM proposal_line_items') = 1, 'T3 closer still reads their proposal lines (read copy)';
  ASSERT pg_temp.count_as(setter_a, 'authenticated', 'SELECT count(*) FROM proposal_line_items') = 0, 'T3 field roles still see no proposal lines';
  ASSERT pg_temp.count_as(admin_b, 'authenticated', 'SELECT count(*) FROM opportunities') = 0, 'T3 other company still sees nothing';
  ASSERT pg_temp.count_as(closer_a, 'authenticated', 'SELECT count(*) FROM users') = 4, 'T3 users list in own company unchanged';

  -- T4 nobody but the server changes role / custom role / company / active / super admin
  ASSERT pg_temp.rows_changed(mgr_a, 'authenticated', format($$UPDATE users SET role = 'admin' WHERE id = %L$$, mgr_a)) = 0, 'T4 manager cannot make themselves admin';
  ASSERT pg_temp.rows_changed(mgr_a, 'authenticated', format($$UPDATE users SET full_name = 'x' WHERE id = %L$$, closer_a)) = 0, 'T4 manager cannot edit users at all';
  ASSERT pg_temp.refused(admin_a, 'authenticated', format($$UPDATE users SET role = 'admin' WHERE id = %L$$, mgr_a)), 'T4 admin JWT cannot change a role (server only)';
  ASSERT pg_temp.refused(admin_a, 'authenticated', format($$UPDATE users SET active = false WHERE id = %L$$, closer_a)), 'T4 admin JWT cannot switch someone off';
  ASSERT pg_temp.refused(admin_a, 'authenticated', format($$UPDATE users SET is_super_admin = true WHERE id = %L$$, admin_a)), 'T4 super admin still server only';
  ASSERT pg_temp.rows_changed(admin_a, 'authenticated', format($$UPDATE users SET full_name = 'Closer A2' WHERE id = %L$$, closer_a)) = 1, 'T4 admin may still edit a name';
  ASSERT pg_temp.rows_changed(admin_a, 'authenticated', format($$UPDATE users SET full_name = 'x' WHERE id = %L$$, admin_b)) = 0, 'T4 admin cannot touch another company';
  ASSERT pg_temp.refused(mgr_a, 'authenticated', format($$INSERT INTO users (id, org_id, role) VALUES (gen_random_uuid(), %L, 'admin')$$, org_a)), 'T4 manager cannot insert users';
  ASSERT pg_temp.refused(mgr_a, 'authenticated', format($$INSERT INTO custom_roles (org_id, name, display_name) VALUES (%L, 'boss', 'Boss')$$, org_a)), 'T4 manager cannot create roles';
  ASSERT NOT pg_temp.refused(admin_a, 'authenticated', format($$INSERT INTO custom_roles (org_id, name, display_name) VALUES (%L, 'crew_lead', 'Crew lead')$$, org_a)), 'T4 admin can still create roles directly';
  ASSERT pg_temp.rows_changed(NULL, 'service_role', format($$UPDATE users SET role = 'sales_manager', active = false WHERE id = %L$$, mgr_a)) = 1, 'T4 the server can';
  RESET ROLE;
  UPDATE users SET role = 'regional_manager', active = true WHERE id = mgr_a;   -- no JWT (SQL editor / migration): allowed
  ASSERT (SELECT role::text FROM users WHERE id = mgr_a) = 'regional_manager', 'T4 no-JWT session can';

  -- T5 functions that trust a passed org id: server only; RLS helpers: no anon
  ASSERT pg_temp.refused(closer_a, 'authenticated', format($$SELECT * FROM get_unpaid_referrals(%L, 0)$$, '00000000-0000-0000-0000-0000000000b1')), 'T5 get_unpaid_referrals refused';
  ASSERT pg_temp.refused(closer_a, 'authenticated', format($$SELECT dashboard_count_door_leads_scoped(%L, now() - interval '1 day', now(), NULL)$$, '00000000-0000-0000-0000-0000000000b1')), 'T5 dashboard_count_door_leads_scoped refused';
  ASSERT NOT pg_temp.refused(NULL, 'service_role', format($$SELECT * FROM get_unpaid_referrals(%L, 0)$$, org_a)), 'T5 server still calls get_unpaid_referrals';
  ASSERT pg_temp.refused(NULL, 'anon', format($$SELECT get_user_org_id(%L)$$, admin_a)), 'T5 anon cannot call get_user_org_id';
  ASSERT pg_temp.refused(NULL, 'anon', format($$SELECT get_user_role(%L)$$, admin_a)), 'T5 anon cannot call get_user_role';
  ASSERT pg_temp.refused(NULL, 'anon', format($$SELECT is_admin_or_manager(%L)$$, admin_a)), 'T5 anon cannot call is_admin_or_manager';
  ASSERT pg_temp.refused(NULL, 'anon', format($$SELECT get_sub_id_for_user(%L)$$, admin_a)), 'T5 anon cannot call get_sub_id_for_user';
  ASSERT NOT pg_temp.refused(closer_a, 'authenticated', format($$SELECT get_sub_id_for_user(%L)$$, closer_a)), 'T5 signed-in users keep get_sub_id_for_user (subs pages)';
  ASSERT pg_temp.refused(NULL, 'anon', 'SELECT count(*) FROM opportunities'), 'T5 a request with no JWT now errors on a policy helper instead of reading';
  RESET ROLE;
  RAISE NOTICE 'tables + functions: all assertions passed';
END $t$;

-- ── Storage (0050): prod's member policies on the four buckets go; other buckets keep theirs ──
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('project-files', '00000000-0000-0000-0000-0000000000a1/jobs/x.jpg'),
  ('inspection-reports', '00000000-0000-0000-0000-0000000000a1/r/x.pdf'),
  ('job-files', 'orgs/00000000-0000-0000-0000-0000000000a1/jobs/j/contract.pdf');
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, anon;
CREATE POLICY "Users can read project-files in their org" ON storage.objects FOR SELECT USING ((bucket_id = 'project-files'::text) AND ((storage.foldername(name))[1] = (get_user_org_id(auth.uid()))::text));
CREATE POLICY "Users can upload project-files in their org" ON storage.objects FOR INSERT WITH CHECK ((bucket_id = 'project-files'::text) AND ((storage.foldername(name))[1] = (get_user_org_id(auth.uid()))::text));
CREATE POLICY "Users can read job files storage" ON storage.objects FOR SELECT USING ((bucket_id = 'job-files'::text) AND ((storage.foldername(name))[1] = 'orgs'::text) AND ((storage.foldername(name))[2] = (get_user_org_id(auth.uid()))::text));
CREATE POLICY "Org members can delete inspection report files" ON storage.objects FOR DELETE USING ((bucket_id = 'inspection-reports'::text) AND ((storage.foldername(name))[1] = (get_user_org_id(auth.uid()))::text));
CREATE POLICY "Org members can read inspection photos" ON storage.objects FOR SELECT USING ((bucket_id = 'inspection-photos'::text) AND ((storage.foldername(name))[1] = (get_user_org_id(auth.uid()))::text));
CREATE POLICY "badge_images_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'badge-images'::text);

DO $s$ BEGIN
  ASSERT pg_temp.count_as('00000000-0000-0000-0000-00000000a0d0', 'authenticated', 'SELECT count(*) FROM storage.objects') = 2, 'S0 before: a setter lists project + job files';
END $s$;

\i supabase/migrations/202611240050_storage_lockdown_member_buckets.sql

DO $s$ BEGIN
  ASSERT (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
          AND (qual ~ '(job-files|project-files|inspection-photos|inspection-reports)' OR with_check ~ '(job-files|project-files|inspection-photos|inspection-reports)')) = 0, 'S1 no member policy left on the four buckets';
  ASSERT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'badge_images_public_read'), 'S1 other buckets untouched';
  ASSERT pg_temp.count_as('00000000-0000-0000-0000-00000000a0d0', 'authenticated', 'SELECT count(*) FROM storage.objects') = 0, 'S2 a setter lists nothing';
  ASSERT pg_temp.rows_changed('00000000-0000-0000-0000-00000000a0a0', 'authenticated', $$DELETE FROM storage.objects WHERE bucket_id = 'inspection-reports'$$) = 0, 'S2 nobody deletes report files with their own JWT';
  RESET ROLE;
  ASSERT pg_temp.refused('00000000-0000-0000-0000-00000000a0a0', 'authenticated', $$INSERT INTO storage.objects (bucket_id, name) VALUES ('project-files', '00000000-0000-0000-0000-0000000000a1/x')$$), 'S2 nobody uploads with their own JWT (signed upload tokens need no policy)';
  RESET ROLE;
  RAISE NOTICE 'storage: all assertions passed';
END $s$;

\echo 'REPORT (rolled back by design): all assertions passed'
ROLLBACK;
