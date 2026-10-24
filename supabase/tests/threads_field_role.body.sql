-- DB test: the SQL side of the field-role hard deny (can_view_job_board, message_visible_to) and the "no deal = not theirs" rule.
-- Body of ONE DO block that always ends in RAISE EXCEPTION. Needs migrations 202610270010 and 202610280010.
DECLARE
  v_org uuid := gen_random_uuid(); v_report text := '';
  u_admin uuid := gen_random_uuid(); u_ops uuid := gen_random_uuid(); u_closer uuid := gen_random_uuid(); u_other_closer uuid := gen_random_uuid();
  u_setter uuid := gen_random_uuid(); u_setter_granted uuid := gen_random_uuid(); u_inside_granted uuid := gen_random_uuid(); u_ops_custom uuid := gen_random_uuid();
  cr_inside uuid := gen_random_uuid(); cr_opsrole uuid := gen_random_uuid(); cr_setter uuid := gen_random_uuid(); cr_canv uuid := gen_random_uuid(); cr_setmgr uuid := gen_random_uuid(); p_view uuid; p_fin uuid;
  u_cset uuid := gen_random_uuid(); u_ccanv uuid := gen_random_uuid(); u_csmgr uuid := gen_random_uuid();
  v_opp uuid := gen_random_uuid();
BEGIN
  INSERT INTO orgs (id, name) VALUES (v_org, 'ThreadTest');
  INSERT INTO auth.users (id, email) SELECT x, x::text || '@t.test' FROM unnest(ARRAY[u_admin,u_ops,u_closer,u_other_closer,u_setter,u_setter_granted,u_inside_granted,u_ops_custom,u_cset,u_ccanv,u_csmgr]) x;
  INSERT INTO permissions (id, name, display_name, category) VALUES (gen_random_uuid(), 'jobs:view', 'jobs:view', 'jobs') ON CONFLICT (name) DO NOTHING;
  INSERT INTO permissions (id, name, display_name, category) VALUES (gen_random_uuid(), 'jobs:financials:view', 'jobs:financials:view', 'jobs') ON CONFLICT (name) DO NOTHING;
  SELECT id INTO p_view FROM permissions WHERE name = 'jobs:view'; SELECT id INTO p_fin FROM permissions WHERE name = 'jobs:financials:view';
  INSERT INTO custom_roles (id, org_id, name, display_name) VALUES (cr_inside, v_org, 'inside_sales_plus', 'Inside Sales Plus'), (cr_opsrole, v_org, 'ops_lead', 'Ops Lead'),
    (cr_setter, v_org, 'Setter', 'Setter'), (cr_canv, v_org, 'canvasser_lead', 'Canvasser Lead'), (cr_setmgr, v_org, 'setter_manager', 'Setter Manager');
  INSERT INTO role_permissions (role_id, permission_id) VALUES (cr_inside, p_view), (cr_inside, p_fin), (cr_opsrole, p_view), (cr_opsrole, p_fin),
    (cr_setter, p_view), (cr_setter, p_fin), (cr_canv, p_view), (cr_canv, p_fin), (cr_setmgr, p_view), (cr_setmgr, p_fin);
  INSERT INTO users (id, org_id, email, full_name, role, active, custom_role_id) VALUES
    (u_admin, v_org, 'a@t', 'Admin', 'admin', true, NULL), (u_ops, v_org, 'o@t', 'Ops', 'operations', true, NULL),
    (u_closer, v_org, 'c@t', 'Closer', 'sales_rep', true, NULL), (u_other_closer, v_org, 'c2@t', 'Closer2', 'sales_rep', true, NULL),
    (u_setter, v_org, 's@t', 'Setter', 'setter', true, NULL), (u_setter_granted, v_org, 's2@t', 'Setter2', 'setter', true, NULL),
    (u_inside_granted, v_org, 'i@t', 'Inside', 'custom', true, cr_inside), (u_ops_custom, v_org, 'oc@t', 'OpsCustom', 'custom', true, cr_opsrole),
    (u_cset, v_org, 'cs@t', 'CustomSetter', 'custom', true, cr_setter), (u_ccanv, v_org, 'cc@t', 'CustomCanvasser', 'custom', true, cr_canv), (u_csmgr, v_org, 'sm@t', 'SetterMgr', 'custom', true, cr_setmgr);
  INSERT INTO opportunities (id, org_id, owner_user_id, setter_user_id, address_text) VALUES (v_opp, v_org, u_closer, u_setter, '1 Test');
  -- per-user grants: the setter is handed the whole job board
  INSERT INTO user_permissions (org_id, user_id, permission_id) VALUES (v_org, u_setter_granted, p_view), (v_org, u_setter_granted, p_fin);

  -- can_view_job_board: deny comes before grants
  IF can_view_job_board(u_setter_granted) THEN RAISE EXCEPTION 'setter with jobs:view must NOT reach the job board'; END IF;
  IF can_view_job_board(u_inside_granted) THEN RAISE EXCEPTION 'inside-sales custom role with jobs:view must NOT reach the job board'; END IF;
  IF NOT can_view_job_board(u_ops_custom) THEN RAISE EXCEPTION 'an ops-style custom role with jobs:view still reaches the job board'; END IF;
  IF NOT can_view_job_board(u_admin) OR NOT can_view_job_board(u_ops) THEN RAISE EXCEPTION 'admin / operations lost the job board'; END IF;
  -- custom roles NAMED setter / canvasser hold every job grant: still nothing (one shared classification); a "Setter Manager" is a manager, not a field role
  IF can_view_job_board(u_cset) THEN RAISE EXCEPTION 'custom role "Setter" with job grants reached the job board'; END IF;
  IF can_view_job_board(u_ccanv) THEN RAISE EXCEPTION 'custom role "Canvasser Lead" with job grants reached the job board'; END IF;
  IF NOT can_view_job_board(u_csmgr) THEN RAISE EXCEPTION 'Setter Manager lost the job board it was granted'; END IF;
  IF message_visible_to(u_cset, 'production', false, v_org, v_opp) OR message_visible_to(u_ccanv, 'crew', false, v_org, v_opp) THEN RAISE EXCEPTION 'custom Setter/Canvasser read Production or Crew'; END IF;
  IF NOT arx_private.is_field_role('custom', 'setter setter') OR NOT arx_private.is_field_role('custom', 'canvasser_lead canvasser lead') OR NOT arx_private.is_field_role('inside_sales', '') OR arx_private.is_field_role('custom', 'setter_manager setter manager') OR arx_private.is_field_role('custom', 'ops_lead ops lead') OR arx_private.is_field_role('admin', '') THEN RAISE EXCEPTION 'is_field_role classification wrong'; END IF;
  v_report := v_report || E'\ncustom Setter / Canvasser roles with every job grant: no job board, no Production/Crew; Setter Manager keeps its grant';
  v_report := v_report || E'\ncan_view_job_board: setter+grants=false, inside-sales+grants=false, ops custom=true, admin/operations=true';

  -- message_visible_to(viewer, audience, restricted_pricing, org, opportunity)
  IF message_visible_to(u_setter_granted, 'production', false, v_org, v_opp) THEN RAISE EXCEPTION 'granted setter read Production'; END IF;
  IF message_visible_to(u_setter_granted, 'crew', false, v_org, v_opp) THEN RAISE EXCEPTION 'granted setter read Crew'; END IF;
  IF message_visible_to(u_inside_granted, 'production', false, v_org, v_opp) THEN RAISE EXCEPTION 'granted inside sales read Production'; END IF;
  IF NOT message_visible_to(u_admin, 'production', false, v_org, v_opp) THEN RAISE EXCEPTION 'admin cannot read Production'; END IF;
  IF NOT message_visible_to(u_ops, 'production', false, v_org, v_opp) THEN RAISE EXCEPTION 'ops cannot read Production'; END IF;
  IF NOT message_visible_to(u_ops_custom, 'production', false, v_org, v_opp) THEN RAISE EXCEPTION 'ops-style custom role cannot read Production'; END IF;
  IF NOT message_visible_to(u_closer, 'production', false, v_org, v_opp) THEN RAISE EXCEPTION 'the deal''s closer cannot read Production'; END IF;
  IF message_visible_to(u_other_closer, 'production', false, v_org, v_opp) THEN RAISE EXCEPTION 'another closer read Production on a deal that is not theirs'; END IF;
  IF message_visible_to(u_setter, 'team', true, v_org, v_opp) THEN RAISE EXCEPTION 'setter read a pricing-flagged Team message'; END IF;
  IF NOT message_visible_to(u_setter, 'team', false, v_org, v_opp) THEN RAISE EXCEPTION 'the deal''s setter cannot read a Team message'; END IF;
  IF message_visible_to(u_setter_granted, 'team', false, v_org, v_opp) THEN RAISE EXCEPTION 'a setter who is NOT on the deal read it'; END IF;
  v_report := v_report || E'\nmessage_visible_to: granted setter/inside sales never Production or Crew; admin/ops/custom-ops/closer-on-deal do; other closer and off-deal setter do not';

  -- item 15: a message with NO deal is "not theirs" for setters and closers (same as the app's canReadRowOnDeal 'none')
  IF message_visible_to(u_setter, 'team', false, v_org, NULL) THEN RAISE EXCEPTION 'setter read a deal-less Team message'; END IF;
  IF message_visible_to(u_closer, 'sales', false, v_org, NULL) THEN RAISE EXCEPTION 'closer read a deal-less Sales message'; END IF;
  IF NOT message_visible_to(u_ops, 'team', false, v_org, NULL) OR NOT message_visible_to(u_admin, 'team', false, v_org, NULL) THEN RAISE EXCEPTION 'ops/admin lost deal-less messages'; END IF;
  v_report := v_report || E'\nno-deal rule: setter/closer cannot read deal-less messages; ops/admin can';

  RAISE EXCEPTION E'REPORT (rolled back by design):%', v_report;
END
