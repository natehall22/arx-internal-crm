--
-- PostgreSQL database dump
--

\restrict xiEwH0JOe0nrBLSaUbYW2N05BK9AbPldyIb5YNzfRwjO2l1JO4Bs6QdMqBiImBI

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: arx_private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA arx_private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: activity_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.activity_type AS ENUM (
    'note',
    'call',
    'text',
    'email',
    'visit',
    'status_change'
);


--
-- Name: badge_criteria_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.badge_criteria_type AS ENUM (
    'first_inspection_set',
    'first_closed_sale',
    'inspections_set_milestone',
    'closed_sales_milestone',
    'streak_weekly_inspections',
    'streak_weekly_sales',
    'close_rate_threshold',
    'spiff_winner',
    'top_leaderboard',
    'program_444_qualified',
    'doors_knocked_milestone'
);


--
-- Name: bonus_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bonus_status AS ENUM (
    'pending_approval',
    'approved',
    'rejected',
    'paid'
);


--
-- Name: canvass_disposition; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.canvass_disposition AS ENUM (
    'not_home',
    'bad_roof',
    'renter',
    'go_back',
    'hot_lead',
    'not_interested',
    'inspection_scheduled'
);


--
-- Name: commission_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.commission_status AS ENUM (
    'pending',
    'approved',
    'paid',
    'disputed'
);


--
-- Name: comp_plan_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.comp_plan_type AS ENUM (
    'flat_rate',
    'percentage',
    'tiered',
    'hybrid'
);


--
-- Name: contract_payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.contract_payment_method AS ENUM (
    'finance',
    'cash',
    'insurance',
    'other'
);


--
-- Name: contract_signing_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.contract_signing_status AS ENUM (
    'draft',
    'pending_customer',
    'completed',
    'voided'
);


--
-- Name: dashboard_view_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.dashboard_view_type AS ENUM (
    'sales',
    'ops'
);


--
-- Name: estimate_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.estimate_status AS ENUM (
    'draft',
    'sent',
    'approved',
    'declined'
);


--
-- Name: file_tag; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.file_tag AS ENUM (
    'photo',
    'document',
    'proposal',
    'other',
    'contract'
);


--
-- Name: incentive_cycle_cadence; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.incentive_cycle_cadence AS ENUM (
    'weekly',
    'monthly'
);


--
-- Name: inspection_outcome; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.inspection_outcome AS ENUM (
    'not_home',
    'said_no',
    'failed_credit',
    'rescheduled',
    'sale'
);


--
-- Name: integration_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.integration_provider AS ENUM (
    'eagleview',
    'roofr',
    'solo',
    'aurora',
    'gaf_quickmeasure',
    'hover',
    'nearmap',
    'google_solar'
);


--
-- Name: invoice_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invoice_status AS ENUM (
    'draft',
    'sent',
    'partially_paid',
    'paid',
    'void'
);


--
-- Name: job_cost_line_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.job_cost_line_source AS ENUM (
    'manual',
    'product_order_mirror',
    'legacy_column_import',
    'dealer_fee_sync'
);


--
-- Name: job_file_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.job_file_type AS ENUM (
    'contract',
    'change_order',
    'proposal',
    'invoice',
    'permit',
    'inspection_report',
    'warranty',
    'other'
);


--
-- Name: job_product_order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.job_product_order_status AS ENUM (
    'ordered',
    'received',
    'paid',
    'returned'
);


--
-- Name: job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.job_status AS ENUM (
    'open',
    'in_progress',
    'on_hold',
    'complete',
    'collected'
);


--
-- Name: job_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.job_type AS ENUM (
    'roofing',
    'siding',
    'windows',
    'mixed'
);


--
-- Name: lead_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lead_channel AS ENUM (
    'inbound',
    'outbound'
);


--
-- Name: lead_source_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lead_source_type AS ENUM (
    'website',
    'google_ads',
    'facebook',
    'instagram',
    'tiktok',
    'youtube',
    'bing_ads',
    'referral',
    'canvass',
    'door_knock',
    'phone_call',
    'walk_in',
    'home_show',
    'partner',
    'other'
);


--
-- Name: lead_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lead_status AS ENUM (
    'new',
    'contacted',
    'appointment',
    'inspection',
    'estimate_sent',
    'won',
    'lost'
);


--
-- Name: material_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.material_source AS ENUM (
    'supplier',
    'installer',
    'customer',
    'stock'
);


--
-- Name: measurement_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.measurement_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
);


--
-- Name: opportunity_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.opportunity_status AS ENUM (
    'open',
    'in_progress',
    'won',
    'lost'
);


--
-- Name: order_line_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_line_status AS ENUM (
    'ready',
    'confirm',
    'manual'
);


--
-- Name: outbox_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.outbox_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'skipped'
);


--
-- Name: pricebook_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pricebook_category AS ENUM (
    'roofing',
    'siding',
    'windows',
    'addons'
);


--
-- Name: pricebook_item_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pricebook_item_type AS ENUM (
    'install',
    'tearoff',
    'material',
    'addon',
    'disposal',
    'cleanup',
    'dumpster',
    'decking',
    'flashing'
);


--
-- Name: pricing_visibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pricing_visibility AS ENUM (
    'admin_only',
    'managers',
    'sales_reps',
    'all'
);


--
-- Name: project_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.project_status AS ENUM (
    'open',
    'in_progress',
    'on_hold',
    'complete',
    'collected',
    'cancelled'
);


--
-- Name: project_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.project_type AS ENUM (
    'roofing',
    'siding',
    'windows',
    'mixed'
);


--
-- Name: proposal_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.proposal_status AS ENUM (
    'draft',
    'sent',
    'viewed',
    'accepted',
    'declined',
    'expired'
);


--
-- Name: referral_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.referral_status AS ENUM (
    'pending',
    'qualified',
    'installed',
    'paid',
    'cancelled'
);


--
-- Name: report_data_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_data_source AS ENUM (
    'leads',
    'opportunities',
    'projects',
    'appointments',
    'users',
    'activities',
    'inspection_outcomes'
);


--
-- Name: report_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_type AS ENUM (
    'table',
    'bar_chart',
    'line_chart',
    'pie_chart',
    'metric_card',
    'funnel'
);


--
-- Name: roof_material; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.roof_material AS ENUM (
    'asphalt_shingle',
    'metal',
    'tile',
    'slate',
    'wood_shake',
    'flat_membrane',
    'other'
);


--
-- Name: spiff_reward_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.spiff_reward_type AS ENUM (
    'cash',
    'gift_card',
    'recognition'
);


--
-- Name: spiff_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.spiff_status AS ENUM (
    'draft',
    'active',
    'completed',
    'cancelled'
);


--
-- Name: spiff_trigger_metric; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.spiff_trigger_metric AS ENUM (
    'inspections_set',
    'inspections_sat',
    'closed_sales',
    'closed_revenue',
    'doors_knocked',
    'close_rate',
    'upgrade_attached'
);


--
-- Name: supplier_connection_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.supplier_connection_type AS ENUM (
    'email',
    'api'
);


--
-- Name: supplier_order_send_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.supplier_order_send_kind AS ENUM (
    'order',
    'revision',
    'resend',
    'cancellation'
);


--
-- Name: supplier_order_send_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.supplier_order_send_status AS ENUM (
    'sending',
    'sent',
    'failed',
    'unknown'
);


--
-- Name: supplier_order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.supplier_order_status AS ENUM (
    'draft',
    'sent',
    'cancelled'
);


--
-- Name: sync_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sync_status AS ENUM (
    'pending',
    'synced',
    'failed',
    'skipped'
);


--
-- Name: unit; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.unit AS ENUM (
    'square',
    'each',
    'lf',
    'sheet',
    'job',
    'per_sqft',
    'sqft'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'regional_manager',
    'sales_manager',
    'sales_rep',
    'canvasser',
    'operations',
    'sub',
    'closer',
    'owner',
    'regional_setter_manager',
    'setter_manager',
    'setter',
    'custom'
);


--
-- Name: user_role_old; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role_old AS ENUM (
    'admin',
    'regional_manager',
    'sales_manager',
    'sales_rep',
    'canvasser',
    'operations',
    'sub',
    'closer',
    'owner',
    'regional_setter_manager',
    'setter_manager',
    'setter',
    'custom'
);


--
-- Name: work_order_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.work_order_priority AS ENUM (
    'low',
    'normal',
    'high',
    'urgent'
);


--
-- Name: work_order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.work_order_status AS ENUM (
    'pending',
    'assigned',
    'scheduled',
    'in_progress',
    'completed',
    'cancelled',
    'on_hold'
);


--
-- Name: work_order_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.work_order_type AS ENUM (
    'go_back',
    'repair',
    'warranty',
    'punch_list',
    'inspection',
    'install',
    'service_call'
);


--
-- Name: can_view_job_board(uuid); Type: FUNCTION; Schema: arx_private; Owner: -
--

CREATE FUNCTION arx_private.can_view_job_board(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH u AS (
    SELECT lower(trim(us.role::text)) AS role, us.custom_role_id,
           lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')) AS crname
    FROM public.users us LEFT JOIN public.custom_roles cr ON cr.id = us.custom_role_id
    WHERE us.id = p_user
  ),
  field AS (
    SELECT EXISTS (SELECT 1 FROM u WHERE arx_private.is_field_role(u.role, u.crname)) AS denied
  ),
  names AS (
    SELECT p.name
    FROM u
    JOIN public.role_permissions rp ON rp.role_id = u.custom_role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    UNION ALL
    SELECT p.name
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
    WHERE up.user_id = p_user
  )
  SELECT EXISTS (SELECT 1 FROM u)
    AND (
      EXISTS (SELECT 1 FROM u WHERE u.role IN ('admin', 'owner'))
      OR (
        NOT (SELECT denied FROM field)
        AND (
          EXISTS (SELECT 1 FROM u WHERE u.custom_role_id IS NULL AND u.role = ANY (ARRAY['operations']::text[])) -- JOB_BOARD_LEGACY_ROLES
          OR EXISTS (SELECT 1 FROM names WHERE name IN ('admin:full', 'jobs:view', 'jobs:edit'))
        )
      )
    );
$$;


--
-- Name: invoice_mine(uuid, uuid); Type: FUNCTION; Schema: arx_private; Owner: -
--

CREATE FUNCTION arx_private.invoice_mine(p_user uuid, p_invoice uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select p_invoice is not null and exists (select 1 from public.job_invoices i where i.id = p_invoice and (i.created_by = p_user or arx_private.job_mine(p_user, i.job_id)));
$$;


--
-- Name: is_field_role(text, text); Type: FUNCTION; Schema: arx_private; Owner: -
--

CREATE FUNCTION arx_private.is_field_role(p_role text, p_crname text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT lower(btrim(coalesce(p_role, ''))) IN ('setter', 'canvasser', 'inside_sales', 'inside sales', 'call_center', 'call center')
      OR (lower(coalesce(p_crname, '')) !~ 'manager'
          AND lower(coalesce(p_crname, '')) ~ '(^|[^a-z])(setter|canvasser|inside[ _-]?sales|call[ _-]?cent(er|re))s?([^a-z]|$)');
$_$;


--
-- Name: job_mine(uuid, uuid); Type: FUNCTION; Schema: arx_private; Owner: -
--

CREATE FUNCTION arx_private.job_mine(p_user uuid, p_job uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select p_job is not null and exists (
    select 1 from public.production_jobs j
     where j.id = p_job and (j.created_by = p_user or arx_private.project_mine(p_user, j.project_id)
                              or arx_private.proposal_mine(p_user, j.accepted_proposal_id) or arx_private.proposal_mine(p_user, j.linked_proposal_id))
  );
$$;


--
-- Name: lead_mine(uuid, uuid); Type: FUNCTION; Schema: arx_private; Owner: -
--

CREATE FUNCTION arx_private.lead_mine(p_user uuid, p_lead uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select p_lead is not null and (
       exists (select 1 from public.leads l where l.id = p_lead and (l.owner_user_id = p_user or l.pin_attributed_user_id = p_user or l.closer_user_id = p_user))
    or exists (select 1 from public.canvass_knocks k where k.lead_id = p_lead and k.user_id = p_user)
    or exists (select 1 from public.scheduled_appointments a where a.lead_id = p_lead and (a.canvasser_user_id = p_user or a.closer_user_id = p_user or a.inside_sales_booked_by_user_id = p_user))
    or exists (select 1 from public.opportunities o where o.lead_id = p_lead and (o.setter_user_id = p_user or o.owner_user_id = p_user or o.assigned_user_id = p_user))
  );
$$;


--
-- Name: message_visible_to(uuid, text, boolean, uuid, uuid); Type: FUNCTION; Schema: arx_private; Owner: -
--

CREATE FUNCTION arx_private.message_visible_to(p_viewer uuid, p_audience text, p_restricted boolean, p_org uuid, p_opportunity uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH v AS (
    SELECT u.id, u.org_id, lower(trim(u.role::text)) AS role, u.custom_role_id, coalesce(u.is_super_admin, false) AS sa, u.active,
           lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')) AS crname
    FROM users u LEFT JOIN custom_roles cr ON cr.id = u.custom_role_id
    WHERE u.id = p_viewer
  ),
  d AS (SELECT o.owner_user_id, o.setter_user_id FROM opportunities o WHERE o.id = p_opportunity),
  f AS (
    SELECT
      v.org_id = p_org AND coalesce(v.active, true) AS in_org,
      (v.sa OR v.role IN ('owner','admin')) AS owner_like,
      arx_private.can_view_job_board(v.id) AS job_board,
      v.role IN ('manager','sales_manager','regional_manager','operations') AS manager_like,
      (v.role IN ('setter','canvasser')) AS base_setter,
      (v.role IN ('rep','sales_rep','closer')) AS closer_role,
      (v.role IN ('rep','sales_rep','closer') AND (EXISTS (SELECT 1 FROM d WHERE d.owner_user_id = v.id)
        OR EXISTS (SELECT 1 FROM scheduled_appointments sa WHERE sa.opportunity_id = p_opportunity AND sa.closer_user_id = v.id))) AS own_closer,
      (v.role IN ('inside_sales','inside sales','call_center')
        OR v.crname LIKE '%inside sales%' OR v.crname LIKE '%inside_sales%' OR v.crname LIKE '%call center%' OR v.crname LIKE '%call_center%') AS inside_like,
      v.role IN ('admin','owner','operations','manager','sales_manager','regional_manager','rep','sales_rep','closer') OR v.sa AS pricing_role,
      arx_private.is_field_role(v.role, v.crname) AS field_role,
      (EXISTS (SELECT 1 FROM d WHERE d.owner_user_id = v.id OR d.setter_user_id = v.id)
        OR EXISTS (SELECT 1 FROM scheduled_appointments sa WHERE sa.opportunity_id = p_opportunity AND (sa.closer_user_id = v.id OR sa.canvasser_user_id = v.id))) AS own_deal
    FROM v
  ),
  g AS (SELECT f.*, (f.owner_like OR f.job_board OR f.manager_like OR f.closer_role OR f.base_setter OR f.inside_like) AS recognized,
        (f.base_setter AND NOT f.inside_like) AS setter_like, (f.pricing_role AND NOT f.field_role) AS pricing_ok FROM f)
  SELECT CASE
    WHEN p_audience IS NULL THEN true                       -- legacy rows: unchanged behaviour
    WHEN NOT coalesce((SELECT in_org FROM g), false) THEN false
    WHEN coalesce((SELECT owner_like FROM g), false) THEN true
    WHEN NOT coalesce((SELECT recognized FROM g), false) THEN false     -- unknown roles (sub, custom-only) see nothing
    WHEN p_restricted IS TRUE AND NOT coalesce((SELECT pricing_ok FROM g), false) THEN false
    WHEN p_audience IN ('production','crew') THEN
      coalesce((SELECT NOT field_role AND (job_board OR manager_like OR own_closer) FROM g), false)
    ELSE  -- team | sales
      CASE WHEN coalesce((SELECT setter_like OR closer_role FROM g), false) THEN (p_opportunity IS NOT NULL AND coalesce((SELECT own_deal FROM g), false))   -- no deal = not theirs (same as canReadRowOnDeal 'none')
           ELSE true END
  END;
$$;


--
-- Name: opp_mine(uuid, uuid); Type: FUNCTION; Schema: arx_private; Owner: -
--

CREATE FUNCTION arx_private.opp_mine(p_user uuid, p_opp uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select p_opp is not null and (
       exists (select 1 from public.opportunities o where o.id = p_opp and (o.owner_user_id = p_user or o.setter_user_id = p_user or o.assigned_user_id = p_user))
    or exists (select 1 from public.opportunities o join public.leads l on l.id = o.lead_id where o.id = p_opp and l.closer_user_id = p_user)
    or exists (select 1 from public.scheduled_appointments a where a.opportunity_id = p_opp and a.closer_user_id = p_user)
  );
$$;


--
-- Name: project_mine(uuid, uuid); Type: FUNCTION; Schema: arx_private; Owner: -
--

CREATE FUNCTION arx_private.project_mine(p_user uuid, p_project uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select p_project is not null and exists (
    select 1 from public.projects pr
     where pr.id = p_project and (pr.owner_user_id = p_user or arx_private.opp_mine(p_user, pr.opportunity_id))
  );
$$;


--
-- Name: proposal_mine(uuid, uuid); Type: FUNCTION; Schema: arx_private; Owner: -
--

CREATE FUNCTION arx_private.proposal_mine(p_user uuid, p_proposal uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select p_proposal is not null and exists (
    select 1 from public.proposals p
     where p.id = p_proposal and (p.created_by = p_user or arx_private.opp_mine(p_user, p.opportunity_id) or arx_private.project_mine(p_user, p.project_id))
  );
$$;


--
-- Name: amend_comp_plan_version(uuid, uuid, date, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.amend_comp_plan_version(p_org_id uuid, p_comp_plan_id uuid, p_effective_from date, p_body jsonb, p_created_by_user_id uuid, p_change_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_version_id UUID;
BEGIN
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'change reason is required';
  END IF;

  PERFORM 1
  FROM users
  WHERE id = p_created_by_user_id
    AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations')
    AND active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll administrator not found';
  END IF;

  PERFORM 1 FROM comp_plans WHERE id = p_comp_plan_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'comp plan not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM comp_plan_versions
    WHERE org_id = p_org_id
      AND comp_plan_id = p_comp_plan_id
      AND effective_from = p_effective_from
  ) THEN
    RAISE EXCEPTION 'a version of this plan already starts on %; versions are append-only, choose another date', p_effective_from;
  END IF;

  INSERT INTO comp_plan_versions (
    org_id, comp_plan_id, effective_from,
    plan_type, base_percentage, flat_amount, hourly_rate, unit_rate, unit_type,
    hybrid_components, tiers, volume_bonuses, team_overrides,
    is_manager_plan, personal_sales_enabled, team_override_enabled,
    created_by_user_id, change_reason
  ) VALUES (
    p_org_id, p_comp_plan_id, p_effective_from,
    (p_body ->> 'plan_type')::comp_plan_type,
    NULLIF(p_body ->> 'base_percentage', '')::NUMERIC,
    NULLIF(p_body ->> 'flat_amount', '')::NUMERIC,
    NULLIF(p_body ->> 'hourly_rate', '')::NUMERIC,
    NULLIF(p_body ->> 'unit_rate', '')::NUMERIC,
    NULLIF(p_body ->> 'unit_type', ''),
    CASE WHEN jsonb_typeof(p_body -> 'hybrid_components') = 'array' THEN p_body -> 'hybrid_components' END,
    CASE WHEN jsonb_typeof(p_body -> 'tiers') = 'array' THEN p_body -> 'tiers' END,
    CASE WHEN jsonb_typeof(p_body -> 'volume_bonuses') = 'array' THEN p_body -> 'volume_bonuses' END,
    CASE WHEN jsonb_typeof(p_body -> 'team_overrides') IN ('array', 'object') THEN p_body -> 'team_overrides' END,
    (p_body ->> 'is_manager_plan')::BOOLEAN,
    (p_body ->> 'personal_sales_enabled')::BOOLEAN,
    (p_body ->> 'team_override_enabled')::BOOLEAN,
    p_created_by_user_id,
    btrim(p_change_reason)
  )
  RETURNING id INTO v_version_id;

  IF p_effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date THEN
    UPDATE comp_plans SET
      plan_type = (p_body ->> 'plan_type')::comp_plan_type,
      base_percentage = NULLIF(p_body ->> 'base_percentage', '')::NUMERIC,
      flat_amount = NULLIF(p_body ->> 'flat_amount', '')::NUMERIC,
      hourly_rate = NULLIF(p_body ->> 'hourly_rate', '')::NUMERIC,
      unit_rate = NULLIF(p_body ->> 'unit_rate', '')::NUMERIC,
      unit_type = NULLIF(p_body ->> 'unit_type', ''),
      hybrid_components = CASE WHEN jsonb_typeof(p_body -> 'hybrid_components') = 'array' THEN p_body -> 'hybrid_components' END,
      tiers = CASE WHEN jsonb_typeof(p_body -> 'tiers') = 'array' THEN p_body -> 'tiers' END,
      volume_bonuses = CASE WHEN jsonb_typeof(p_body -> 'volume_bonuses') = 'array' THEN p_body -> 'volume_bonuses' END,
      team_overrides = CASE WHEN jsonb_typeof(p_body -> 'team_overrides') IN ('array', 'object') THEN p_body -> 'team_overrides' END,
      is_manager_plan = (p_body ->> 'is_manager_plan')::BOOLEAN,
      personal_sales_enabled = (p_body ->> 'personal_sales_enabled')::BOOLEAN,
      team_override_enabled = (p_body ->> 'team_override_enabled')::BOOLEAN,
      updated_at = NOW()
    WHERE id = p_comp_plan_id AND org_id = p_org_id;
  END IF;

  RETURN v_version_id;
END;
$$;


--
-- Name: assign_management_comp_overlay(uuid, uuid, uuid, text, numeric, date, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_management_comp_overlay(p_org_id uuid, p_user_id uuid, p_comp_plan_id uuid, p_lane text, p_override_percent numeric, p_effective_from date, p_created_by_user_id uuid, p_change_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
  v_assignment_id UUID;
  v_replaced_assignment_id UUID;
  v_existing_rate NUMERIC(5, 2);
BEGIN
  IF p_lane NOT IN ('setter', 'closer') THEN
    RAISE EXCEPTION 'invalid management overlay lane';
  END IF;
  IF p_override_percent < 0 OR p_override_percent > 100 THEN
    RAISE EXCEPTION 'management overlay rate must be between 0 and 100';
  END IF;
  IF p_effective_from <= v_today THEN
    RAISE EXCEPTION 'management overlay changes must start after today';
  END IF;
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'change reason is required';
  END IF;

  PERFORM 1
  FROM users
  WHERE id = p_created_by_user_id
    AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations')
    AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll administrator not found';
  END IF;

  PERFORM 1
  FROM users AS manager
  WHERE manager.id = p_user_id
    AND manager.org_id = p_org_id
    AND manager.active = true
    AND EXISTS (
      SELECT 1
      FROM user_manager_assignments AS reporting
      JOIN users AS report
        ON report.id = reporting.user_id
       AND report.org_id = reporting.org_id
       AND report.active = true
      WHERE reporting.org_id = p_org_id
        AND reporting.manager_user_id = manager.id
        AND reporting.effective_from <= p_effective_from
        AND (reporting.effective_to IS NULL OR reporting.effective_to >= p_effective_from)
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'overlay recipient has no direct reports on the effective date';
  END IF;

  PERFORM 1 FROM comp_plans
  WHERE id = p_comp_plan_id
    AND org_id = p_org_id
    AND plan_purpose = 'management_overlay'
    AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active management overlay plan not found';
  END IF;

  -- Keep one manageable future change per lane. A scheduled row must be cancelled
  -- before another is added, so cancellation can restore its exact predecessor
  -- without having to rewire a hidden chain of later assignments.
  PERFORM 1
  FROM user_management_comp_overlay_assignments
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND lane = p_lane
    AND effective_from > v_today
    AND cancelled_at IS NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'a management overlay is already scheduled on or after this date';
  END IF;

  SELECT override_percent
  INTO v_existing_rate
  FROM management_comp_overlay_plan_versions
  WHERE org_id = p_org_id
    AND comp_plan_id = p_comp_plan_id
    AND lane = p_lane
    AND effective_from <= p_effective_from
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_existing_rate IS NULL OR v_existing_rate IS DISTINCT FROM p_override_percent THEN
    INSERT INTO management_comp_overlay_plan_versions (
      org_id,
      comp_plan_id,
      lane,
      override_percent,
      effective_from,
      created_by_user_id,
      change_reason
    ) VALUES (
      p_org_id,
      p_comp_plan_id,
      p_lane,
      p_override_percent,
      p_effective_from,
      p_created_by_user_id,
      p_change_reason
    )
    ON CONFLICT (org_id, comp_plan_id, lane, effective_from) DO NOTHING;

    SELECT override_percent
    INTO v_existing_rate
    FROM management_comp_overlay_plan_versions
    WHERE org_id = p_org_id
      AND comp_plan_id = p_comp_plan_id
      AND lane = p_lane
      AND effective_from = p_effective_from;
    IF v_existing_rate IS DISTINCT FROM p_override_percent THEN
      RAISE EXCEPTION 'a different management overlay rate already exists on this effective date';
    END IF;
  END IF;

  UPDATE user_management_comp_overlay_assignments
  SET effective_to = p_effective_from - 1,
      ended_at = NOW(),
      ended_by_user_id = p_created_by_user_id,
      end_reason = 'Replaced by scheduled overlay: ' || p_change_reason
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND lane = p_lane
    AND effective_from < p_effective_from
    AND cancelled_at IS NULL
    AND (effective_to IS NULL OR effective_to >= p_effective_from)
  RETURNING id INTO v_replaced_assignment_id;

  INSERT INTO user_management_comp_overlay_assignments (
    org_id,
    user_id,
    comp_plan_id,
    replaced_assignment_id,
    lane,
    effective_from,
    created_by_user_id,
    change_reason
  ) VALUES (
    p_org_id,
    p_user_id,
    p_comp_plan_id,
    v_replaced_assignment_id,
    p_lane,
    p_effective_from,
    p_created_by_user_id,
    p_change_reason
  )
  RETURNING id INTO v_assignment_id;

  RETURN v_assignment_id;
END;
$$;


--
-- Name: assign_primary_comp_plan(uuid, uuid, uuid, date, numeric, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_primary_comp_plan(p_org_id uuid, p_user_id uuid, p_comp_plan_id uuid, p_effective_from date, p_override_percentage numeric, p_created_by_user_id uuid, p_change_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
  v_assignment_id UUID;
  v_replaced_assignment_id UUID;
BEGIN
  IF p_effective_from <= v_today THEN
    RAISE EXCEPTION 'primary comp-plan changes must start after today';
  END IF;
  IF p_override_percentage IS NOT NULL
    AND (p_override_percentage < 0 OR p_override_percentage > 100) THEN
    RAISE EXCEPTION 'personal plan rate override must be between 0 and 100';
  END IF;
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'change reason is required';
  END IF;

  PERFORM 1 FROM users
  WHERE id = p_created_by_user_id
    AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations')
    AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll administrator not found'; END IF;

  PERFORM 1
  FROM users target
  JOIN comp_plans plan
    ON plan.id = p_comp_plan_id
   AND plan.org_id = p_org_id
  WHERE target.id = p_user_id
    AND target.org_id = p_org_id
    AND target.active = true
    AND plan.plan_purpose = 'primary'
    AND plan.is_active = true
    AND target.role = ANY(COALESCE(plan.applicable_roles, ARRAY[]::TEXT[]));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active primary plan is not compatible with the recipient role';
  END IF;

  PERFORM 1 FROM user_comp_plans
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND effective_from > v_today;
  IF FOUND THEN RAISE EXCEPTION 'a primary comp plan is already scheduled on or after this date'; END IF;

  UPDATE user_comp_plans
  SET effective_to = p_effective_from - 1
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND effective_from < p_effective_from
    AND (effective_to IS NULL OR effective_to >= p_effective_from)
  RETURNING id INTO v_replaced_assignment_id;

  INSERT INTO user_comp_plans (
    org_id,
    user_id,
    comp_plan_id,
    replaced_assignment_id,
    effective_from,
    override_percentage,
    created_by_user_id,
    change_reason
  ) VALUES (
    p_org_id,
    p_user_id,
    p_comp_plan_id,
    v_replaced_assignment_id,
    p_effective_from,
    p_override_percentage,
    p_created_by_user_id,
    p_change_reason
  )
  RETURNING id INTO v_assignment_id;

  RETURN v_assignment_id;
END;
$$;


--
-- Name: calculate_commission(uuid, numeric, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_commission(p_user_id uuid, p_sale_amount numeric, p_sale_date date DEFAULT CURRENT_DATE) RETURNS TABLE(comp_plan_id uuid, commission_rate numeric, commission_amount numeric, bonus_amount numeric, total_amount numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_plan RECORD;
  v_rate NUMERIC;
  v_commission NUMERIC;
  v_bonus NUMERIC := 0;
BEGIN
  -- Get user's active comp plan
  SELECT cp.* INTO v_plan
  FROM user_comp_plans ucp
  JOIN comp_plans cp ON cp.id = ucp.comp_plan_id
  WHERE ucp.user_id = p_user_id
    AND ucp.effective_from <= p_sale_date
    AND (ucp.effective_to IS NULL OR ucp.effective_to >= p_sale_date)
    AND cp.is_active = true
  ORDER BY ucp.effective_from DESC
  LIMIT 1;
  
  IF v_plan IS NULL THEN
    -- Fall back to default plan
    SELECT * INTO v_plan
    FROM comp_plans
    WHERE org_id = get_user_org_id(p_user_id)
      AND is_default = true
      AND is_active = true
    LIMIT 1;
  END IF;
  
  IF v_plan IS NULL THEN
    RETURN;
  END IF;
  
  -- Calculate rate based on plan type
  CASE v_plan.plan_type
    WHEN 'flat_rate' THEN
      v_rate := 0;
      v_commission := COALESCE(v_plan.flat_amount, 0);
    WHEN 'percentage' THEN
      v_rate := COALESCE(v_plan.base_percentage, 0);
      v_commission := p_sale_amount * (v_rate / 100);
    WHEN 'tiered' THEN
      -- Find applicable tier
      SELECT (tier->>'rate')::NUMERIC INTO v_rate
      FROM jsonb_array_elements(v_plan.tiers) AS tier
      WHERE (tier->>'min')::NUMERIC <= p_sale_amount
        AND ((tier->>'max')::NUMERIC >= p_sale_amount OR tier->>'max' IS NULL)
      LIMIT 1;
      v_rate := COALESCE(v_rate, v_plan.base_percentage, 0);
      v_commission := p_sale_amount * (v_rate / 100);
    ELSE
      v_rate := COALESCE(v_plan.base_percentage, 0);
      v_commission := p_sale_amount * (v_rate / 100);
  END CASE;
  
  RETURN QUERY SELECT 
    v_plan.id,
    v_rate,
    v_commission,
    v_bonus,
    v_commission + v_bonus;
END;
$$;


--
-- Name: calculate_commission_with_volume(uuid, numeric, numeric, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_commission_with_volume(p_user_id uuid, p_sale_amount numeric, p_period_volume numeric DEFAULT 0, p_sale_date date DEFAULT CURRENT_DATE) RETURNS TABLE(comp_plan_id uuid, base_rate numeric, volume_bonus_rate numeric, volume_bonus_flat numeric, effective_rate numeric, commission_amount numeric, bonus_amount numeric, total_amount numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_plan RECORD;
  v_base_rate NUMERIC;
  v_commission NUMERIC;
  v_volume_bonus_rate NUMERIC := 0;
  v_volume_bonus_flat NUMERIC := 0;
  v_effective_rate NUMERIC;
  v_bonus NUMERIC := 0;
  v_volume_tier RECORD;
BEGIN
  -- Get user's active comp plan
  SELECT cp.* INTO v_plan
  FROM user_comp_plans ucp
  JOIN comp_plans cp ON cp.id = ucp.comp_plan_id
  WHERE ucp.user_id = p_user_id
    AND ucp.effective_from <= p_sale_date
    AND (ucp.effective_to IS NULL OR ucp.effective_to >= p_sale_date)
    AND cp.is_active = true
  ORDER BY ucp.effective_from DESC
  LIMIT 1;
  
  IF v_plan IS NULL THEN
    -- Fall back to default plan
    SELECT * INTO v_plan
    FROM comp_plans
    WHERE org_id = (SELECT org_id FROM users WHERE id = p_user_id)
      AND is_default = true
      AND is_active = true
    LIMIT 1;
  END IF;
  
  IF v_plan IS NULL THEN
    RETURN;
  END IF;
  
  -- Calculate base rate based on plan type
  CASE v_plan.plan_type
    WHEN 'flat_rate' THEN
      v_base_rate := 0;
      v_commission := COALESCE(v_plan.flat_amount, 0);
    WHEN 'percentage' THEN
      v_base_rate := COALESCE(v_plan.base_percentage, 0);
    WHEN 'tiered' THEN
      -- Find applicable tier based on sale amount
      SELECT (tier->>'rate')::NUMERIC INTO v_base_rate
      FROM jsonb_array_elements(v_plan.tiers) AS tier
      WHERE (tier->>'min')::NUMERIC <= p_sale_amount
        AND ((tier->>'max')::NUMERIC >= p_sale_amount OR tier->>'max' IS NULL)
      LIMIT 1;
      v_base_rate := COALESCE(v_base_rate, v_plan.base_percentage, 0);
    ELSE
      v_base_rate := COALESCE(v_plan.base_percentage, 0);
  END CASE;
  
  -- Calculate volume bonus if applicable
  IF v_plan.volume_bonuses IS NOT NULL AND p_period_volume > 0 THEN
    SELECT 
      CASE WHEN (vb->>'bonus_type') = 'percentage' THEN (vb->>'bonus_value')::NUMERIC ELSE 0 END,
      CASE WHEN (vb->>'bonus_type') = 'flat' THEN (vb->>'bonus_value')::NUMERIC ELSE 0 END
    INTO v_volume_bonus_rate, v_volume_bonus_flat
    FROM jsonb_array_elements(v_plan.volume_bonuses) AS vb
    WHERE (vb->>'min_volume')::NUMERIC <= p_period_volume
      AND ((vb->>'max_volume')::NUMERIC >= p_period_volume OR vb->>'max_volume' IS NULL)
    LIMIT 1;
  END IF;
  
  v_volume_bonus_rate := COALESCE(v_volume_bonus_rate, 0);
  v_volume_bonus_flat := COALESCE(v_volume_bonus_flat, 0);
  
  -- Calculate effective rate and commission
  v_effective_rate := v_base_rate + v_volume_bonus_rate;
  
  IF v_plan.plan_type = 'flat_rate' THEN
    v_commission := COALESCE(v_plan.flat_amount, 0) + v_volume_bonus_flat;
  ELSE
    v_commission := p_sale_amount * (v_effective_rate / 100) + v_volume_bonus_flat;
  END IF;
  
  RETURN QUERY SELECT 
    v_plan.id,
    v_base_rate,
    v_volume_bonus_rate,
    v_volume_bonus_flat,
    v_effective_rate,
    v_commission,
    v_bonus,
    v_commission + v_bonus;
END;
$$;


--
-- Name: calculate_commission_with_volume(uuid, numeric, numeric, numeric, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_commission_with_volume(p_user_id uuid, p_sale_amount numeric, p_commissionable_amount numeric DEFAULT NULL::numeric, p_period_volume numeric DEFAULT 0, p_sale_date date DEFAULT CURRENT_DATE) RETURNS TABLE(comp_plan_id uuid, base_rate numeric, volume_bonus_rate numeric, volume_bonus_flat numeric, effective_rate numeric, commission_amount numeric, bonus_amount numeric, total_amount numeric, commissionable_amount numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_plan RECORD;
  v_base_rate NUMERIC;
  v_commission NUMERIC;
  v_volume_bonus_rate NUMERIC := 0;
  v_volume_bonus_flat NUMERIC := 0;
  v_effective_rate NUMERIC;
  v_bonus NUMERIC := 0;
  v_commissionable NUMERIC;
BEGIN
  -- Use commissionable amount if provided, otherwise use full sale amount
  v_commissionable := COALESCE(p_commissionable_amount, p_sale_amount);

  -- Get user's active comp plan
  SELECT cp.* INTO v_plan
  FROM user_comp_plans ucp
  JOIN comp_plans cp ON cp.id = ucp.comp_plan_id
  WHERE ucp.user_id = p_user_id
    AND ucp.effective_from <= p_sale_date
    AND (ucp.effective_to IS NULL OR ucp.effective_to >= p_sale_date)
    AND cp.is_active = true
  ORDER BY ucp.effective_from DESC
  LIMIT 1;
  
  IF v_plan IS NULL THEN
    -- Fall back to default plan
    SELECT * INTO v_plan
    FROM comp_plans
    WHERE org_id = (SELECT org_id FROM users WHERE id = p_user_id)
      AND is_default = true
      AND is_active = true
    LIMIT 1;
  END IF;
  
  IF v_plan IS NULL THEN
    RETURN;
  END IF;
  
  -- Calculate base rate based on plan type using COMMISSIONABLE amount
  CASE v_plan.plan_type
    WHEN 'flat_rate' THEN
      v_base_rate := 0;
      v_commission := COALESCE(v_plan.flat_amount, 0);
    WHEN 'percentage' THEN
      v_base_rate := COALESCE(v_plan.base_percentage, 0);
    WHEN 'tiered' THEN
      -- Find applicable tier based on commissionable amount
      SELECT (tier->>'rate')::NUMERIC INTO v_base_rate
      FROM jsonb_array_elements(v_plan.tiers) AS tier
      WHERE (tier->>'min')::NUMERIC <= v_commissionable
        AND ((tier->>'max')::NUMERIC >= v_commissionable OR tier->>'max' IS NULL)
      LIMIT 1;
      v_base_rate := COALESCE(v_base_rate, v_plan.base_percentage, 0);
    ELSE
      v_base_rate := COALESCE(v_plan.base_percentage, 0);
  END CASE;
  
  -- Calculate volume bonus if applicable (based on period volume)
  IF v_plan.volume_bonuses IS NOT NULL AND p_period_volume > 0 THEN
    SELECT 
      CASE WHEN (vb->>'bonus_type') = 'percentage' THEN (vb->>'bonus_value')::NUMERIC ELSE 0 END,
      CASE WHEN (vb->>'bonus_type') = 'flat' THEN (vb->>'bonus_value')::NUMERIC ELSE 0 END
    INTO v_volume_bonus_rate, v_volume_bonus_flat
    FROM jsonb_array_elements(v_plan.volume_bonuses) AS vb
    WHERE (vb->>'min_volume')::NUMERIC <= p_period_volume
      AND ((vb->>'max_volume')::NUMERIC >= p_period_volume OR vb->>'max_volume' IS NULL)
    LIMIT 1;
  END IF;
  
  v_volume_bonus_rate := COALESCE(v_volume_bonus_rate, 0);
  v_volume_bonus_flat := COALESCE(v_volume_bonus_flat, 0);
  
  -- Calculate effective rate and commission on COMMISSIONABLE amount
  v_effective_rate := v_base_rate + v_volume_bonus_rate;
  
  IF v_plan.plan_type = 'flat_rate' THEN
    v_commission := COALESCE(v_plan.flat_amount, 0) + v_volume_bonus_flat;
  ELSE
    v_commission := v_commissionable * (v_effective_rate / 100) + v_volume_bonus_flat;
  END IF;
  
  RETURN QUERY SELECT 
    v_plan.id,
    v_base_rate,
    v_volume_bonus_rate,
    v_volume_bonus_flat,
    v_effective_rate,
    v_commission,
    v_bonus,
    v_commission + v_bonus,
    v_commissionable;
END;
$$;


--
-- Name: can_access_report(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_report(report_uuid uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_user_id UUID;
  v_user_role TEXT;
  v_custom_role_id UUID;
  v_report RECORD;
BEGIN
  v_user_id := auth.uid();
  
  SELECT role, custom_role_id INTO v_user_role, v_custom_role_id
  FROM users WHERE id = v_user_id;
  
  SELECT * INTO v_report FROM custom_reports WHERE id = report_uuid;
  
  IF v_report IS NULL THEN
    RETURN false;
  END IF;
  
  -- Creator always has access
  IF v_report.created_by = v_user_id THEN
    RETURN true;
  END IF;
  
  -- Public reports are accessible
  IF v_report.is_public THEN
    RETURN true;
  END IF;
  
  -- Check role-based access
  RETURN EXISTS (
    SELECT 1 FROM report_role_access ra
    WHERE ra.report_id = report_uuid
    AND ra.can_view = true
    AND (ra.role = v_user_role OR ra.custom_role_id = v_custom_role_id)
  );
END;
$$;


--
-- Name: can_edit_opportunities(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_opportunities(user_uuid uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT role IN ('admin', 'regional_manager', 'sales_manager', 'sales_rep', 'operations') 
  FROM users WHERE id = user_uuid;
$$;


--
-- Name: can_edit_projects(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_projects(user_uuid uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT role IN ('admin', 'regional_manager', 'sales_manager', 'operations') 
  FROM users WHERE id = user_uuid;
$$;


--
-- Name: can_manage_regions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_regions(user_uuid uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT role IN ('admin', 'regional_manager', 'sales_manager') 
  FROM users WHERE id = user_uuid;
$$;


--
-- Name: can_manage_teams(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_teams(user_uuid uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT role IN ('admin', 'regional_manager', 'sales_manager') 
  FROM users WHERE id = user_uuid;
$$;


--
-- Name: can_manage_user(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_user(manager_uuid uuid, target_uuid uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN get_user_hierarchy_level(manager_uuid) > get_user_hierarchy_level(target_uuid);
END;
$$;


--
-- Name: can_view_job_board(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_job_board(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN p_user IS NOT NULL AND (p_user = auth.uid() OR auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin'))
    THEN arx_private.can_view_job_board(p_user)
    ELSE false
  END;
$$;


--
-- Name: can_view_job_board_self(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_job_board_self() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select arx_private.can_view_job_board(auth.uid()) or public.is_payroll_admin();
$$;


--
-- Name: can_view_pricing_item(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_pricing_item(p_item_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_visibility pricing_visibility;
  v_role TEXT;
BEGIN
  SELECT visibility INTO v_visibility
  FROM pricebook_items
  WHERE id = p_item_id;
  
  IF v_visibility IS NULL THEN
    RETURN true;
  END IF;
  
  v_role := get_user_role(auth.uid());
  
  CASE v_visibility
    WHEN 'admin_only' THEN
      RETURN v_role IN ('admin');
    WHEN 'managers' THEN
      RETURN v_role IN ('admin', 'regional_manager', 'sales_manager', 'manager');
    WHEN 'sales_reps' THEN
      RETURN v_role IN ('admin', 'regional_manager', 'sales_manager', 'manager', 'sales_rep', 'rep');
    WHEN 'all' THEN
      RETURN true;
    ELSE
      RETURN true;
  END CASE;
END;
$$;


--
-- Name: cancel_management_comp_overlay(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_management_comp_overlay(p_org_id uuid, p_assignment_id uuid, p_created_by_user_id uuid, p_change_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
  v_replaced_assignment_id UUID;
  v_effective_from DATE;
BEGIN
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'cancellation reason is required';
  END IF;
  PERFORM 1 FROM users
  WHERE id = p_created_by_user_id AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations') AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll administrator not found'; END IF;

  UPDATE user_management_comp_overlay_assignments
  SET cancelled_at = NOW(),
      cancelled_by_user_id = p_created_by_user_id,
      cancellation_reason = p_change_reason
  WHERE id = p_assignment_id
    AND org_id = p_org_id
    AND effective_from > v_today
    AND cancelled_at IS NULL
  RETURNING replaced_assignment_id, effective_from
    INTO v_replaced_assignment_id, v_effective_from;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'future management overlay assignment not found';
  END IF;

  IF v_replaced_assignment_id IS NOT NULL THEN
    UPDATE user_management_comp_overlay_assignments
    SET effective_to = NULL,
        ended_at = NULL,
        ended_by_user_id = NULL,
        end_reason = NULL
    WHERE id = v_replaced_assignment_id
      AND org_id = p_org_id
      AND effective_to = v_effective_from - 1
      AND cancelled_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'the replaced overlay could not be restored safely';
    END IF;
  END IF;
END;
$$;


--
-- Name: cancel_production_job(uuid, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_production_job(p_org_id uuid, p_job_id uuid, p_user_id uuid, p_reason text, p_notes text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_job production_jobs%ROWTYPE;
  v_notes TEXT := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_opportunity_id UUID;
  v_contracts_voided INT := 0;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('credit_fail', 'customer_backed_out', 'insurance_denied', 'other') THEN
    RAISE EXCEPTION 'Pick a cancellation reason';
  END IF;
  IF p_reason = 'other' AND v_notes IS NULL THEN
    RAISE EXCEPTION 'Describe the reason when it is "Other"';
  END IF;

  SELECT * INTO v_job
  FROM production_jobs
  WHERE id = p_job_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status = 'cancelled' THEN
    RAISE EXCEPTION 'This job is already cancelled';
  END IF;
  IF v_job.status IN ('complete', 'collected') THEN
    RAISE EXCEPTION 'This job has been installed and cannot be cancelled';
  END IF;
  -- Money already went out: that is a chargeback, not a status change.
  IF v_job.payroll_sent_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM payroll_payout_lines WHERE job_id = p_job_id)
    OR EXISTS (
      SELECT 1 FROM job_payroll_state
      WHERE job_id = p_job_id AND (locked_at IS NOT NULL OR paid_at IS NOT NULL)
    )
  THEN
    RAISE EXCEPTION 'Commission on this job has already gone to payroll — handle it as a chargeback';
  END IF;

  -- Pull it off the install schedule too; the caller removes the Google event
  -- using the ids returned below.
  UPDATE production_jobs
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by_user_id = p_user_id,
      cancellation_reason = p_reason,
      cancellation_notes = v_notes,
      scheduled_date = NULL,
      install_days = NULL,
      assigned_sub_id = NULL,
      assigned_crew_id = NULL
  WHERE id = p_job_id AND org_id = p_org_id;

  IF v_job.project_id IS NOT NULL THEN
    UPDATE projects
    SET status = 'cancelled'
    WHERE id = v_job.project_id AND org_id = p_org_id
    RETURNING opportunity_id INTO v_opportunity_id;
  END IF;

  -- Sale agreements only — an insurance contingency is not the sale.
  UPDATE order_form_contracts
  SET status = 'voided'
  WHERE org_id = p_org_id
    AND agreement_type IN ('installation', 'repair')
    AND status <> 'voided'
    AND (
      (v_opportunity_id IS NOT NULL AND opportunity_id = v_opportunity_id)
      OR (v_job.accepted_proposal_id IS NOT NULL AND proposal_id = v_job.accepted_proposal_id)
    );
  GET DIAGNOSTICS v_contracts_voided = ROW_COUNT;

  INSERT INTO production_job_notes (job_id, user_id, note, is_internal)
  VALUES (
    p_job_id,
    p_user_id,
    'Job cancelled (was ' || v_job.status || '): ' || p_reason || COALESCE(' — ' || v_notes, ''),
    true
  );

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'job_number', v_job.job_number,
    'previous_status', v_job.status,
    'contracts_voided', v_contracts_voided,
    -- Pre-cancel install fields, for removing the sub's calendar invite.
    'address_text', v_job.address_text,
    'scheduled_date', v_job.scheduled_date,
    'install_days', v_job.install_days,
    'install_google_event_id', v_job.install_google_event_id,
    'install_calendar_id', v_job.install_calendar_id
  );
END;
$$;


--
-- Name: cancel_scheduled_primary_comp_plan(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_scheduled_primary_comp_plan(p_org_id uuid, p_assignment_id uuid, p_created_by_user_id uuid, p_change_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
  v_assignment user_comp_plans%ROWTYPE;
BEGIN
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'cancellation reason is required';
  END IF;
  PERFORM 1 FROM users
  WHERE id = p_created_by_user_id AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations') AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll administrator not found'; END IF;

  SELECT * INTO v_assignment
  FROM user_comp_plans
  WHERE id = p_assignment_id
    AND org_id = p_org_id
    AND effective_from > v_today
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'future primary comp-plan assignment not found'; END IF;

  INSERT INTO primary_comp_plan_assignment_cancellations (
    org_id, assignment_id, assignment_snapshot, cancelled_by_user_id, cancellation_reason
  ) VALUES (
    p_org_id, v_assignment.id, to_jsonb(v_assignment), p_created_by_user_id, p_change_reason
  );

  DELETE FROM user_comp_plans
  WHERE id = v_assignment.id AND org_id = p_org_id;

  UPDATE user_comp_plans
  SET effective_to = NULL
  WHERE org_id = p_org_id
    AND user_id = v_assignment.user_id
    AND id = v_assignment.replaced_assignment_id
    AND effective_to = v_assignment.effective_from - 1;
END;
$$;


--
-- Name: canvass_knock_is_door_eligible(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canvass_knock_is_door_eligible(p_source text, p_disposition text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT
    lower(trim(COALESCE(p_source, ''))) IN ('door_to_door', 'canvass', 'door_knock', 'csv_import')
    OR (
      p_disposition IS NOT NULL
      AND lower(trim(COALESCE(p_source, ''))) NOT IN ('web', 'inbound')
    );
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: employee_comp_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_comp_agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    agreement_key text NOT NULL,
    agreement_version text NOT NULL,
    agreement_snapshot jsonb NOT NULL,
    agreement_content_hash text NOT NULL,
    request_key uuid NOT NULL,
    effective_date date NOT NULL,
    status text DEFAULT 'manager_signed'::text NOT NULL,
    manager_user_id uuid NOT NULL,
    manager_signed_name text NOT NULL,
    manager_signed_email text,
    manager_signed_at timestamp with time zone DEFAULT now() NOT NULL,
    manager_signed_ip text,
    manager_signed_user_agent text,
    signing_token_hash text,
    token_expires_at timestamp with time zone,
    receipt_token_hash text,
    receipt_expires_at timestamp with time zone,
    sent_to_email text,
    sent_at timestamp with time zone,
    delivery_error text,
    send_attempt_id uuid,
    send_claimed_at timestamp with time zone,
    rep_signed_name text,
    rep_signed_at timestamp with time zone,
    rep_signed_ip text,
    rep_signed_user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_comp_agreements_agreement_key_check CHECK ((agreement_key = ANY (ARRAY['field_marketer'::text, 'senior_field_marketer'::text, 'closer'::text, 'setter_manager'::text, 'sales_manager'::text]))),
    CONSTRAINT employee_comp_agreements_status_check CHECK ((status = ANY (ARRAY['manager_signed'::text, 'sending'::text, 'sent'::text, 'rep_signed'::text, 'declined'::text, 'voided'::text, 'delivery_failed'::text])))
);


--
-- Name: TABLE employee_comp_agreements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employee_comp_agreements IS 'Immutable compensation agreement snapshots. Separate from payroll calculations and comp-plan assignments.';


--
-- Name: claim_employee_agreement_send(uuid, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_employee_agreement_send(p_agreement_id uuid, p_attempt_id uuid, p_token_hash text, p_token_expires_at timestamp with time zone) RETURNS public.employee_comp_agreements
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_row employee_comp_agreements%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM employee_comp_agreements WHERE id = p_agreement_id FOR UPDATE;
  IF v_row.id IS NULL OR NOT (v_row.status IN ('manager_signed', 'delivery_failed', 'sent') OR (v_row.status = 'sending' AND v_row.send_claimed_at < NOW() - INTERVAL '5 minutes')) THEN RETURN NULL; END IF;
  UPDATE employee_comp_agreements SET status = 'sending', send_attempt_id = p_attempt_id, send_claimed_at = NOW(),
    signing_token_hash = p_token_hash, token_expires_at = p_token_expires_at, delivery_error = NULL, updated_at = NOW()
    WHERE id = p_agreement_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;


--
-- Name: claim_public_estimate_unlock_delivery(uuid, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_public_estimate_unlock_delivery(p_org_id uuid, p_lead_id uuid, p_delivery_key text, p_claim_timeout_seconds integer DEFAULT 300) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_attempt_id UUID;
BEGIN
  INSERT INTO public_estimate_unlock_deliveries (org_id, lead_id, delivery_key)
  SELECT p_org_id, p_lead_id, p_delivery_key
  WHERE EXISTS (
    SELECT 1
    FROM leads
    WHERE id = p_lead_id
      AND org_id = p_org_id
  )
  ON CONFLICT (lead_id, delivery_key) DO UPDATE
    SET state = 'claimed',
        attempt_id = gen_random_uuid(),
        claimed_at = NOW(),
        failed_at = NULL,
        updated_at = NOW()
    WHERE public_estimate_unlock_deliveries.state = 'failed'
       OR (
         public_estimate_unlock_deliveries.state = 'claimed'
         AND public_estimate_unlock_deliveries.claimed_at < NOW() - make_interval(secs => GREATEST(p_claim_timeout_seconds, 1))
       )
  RETURNING attempt_id INTO v_attempt_id;

  RETURN v_attempt_id;
END;
$$;


--
-- Name: clear_closeout_mark_on_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clear_closeout_mark_on_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.outcome_not_recorded_at IS NOT NULL
     AND OLD.outcome_not_recorded_at IS NOT DISTINCT FROM NEW.outcome_not_recorded_at
     AND (NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for OR NEW.status IS DISTINCT FROM OLD.status) THEN
    NEW.outcome_not_recorded_at := NULL;
    NEW.outcome_not_recorded_by := NULL;
    NEW.outcome_not_recorded_batch := NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: comp_plan_is_mine_self(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.comp_plan_is_mine_self(p_plan uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (select 1 from public.user_comp_plans a where a.user_id = auth.uid() and a.comp_plan_id = p_plan)
      or (exists (select 1 from public.comp_plans p where p.id = p_plan and p.is_default and p.is_active)
          -- the default plan is the plan that applies to me when I have no CURRENT assignment to an active plan
          and not exists (select 1 from public.user_comp_plans a join public.comp_plans cp on cp.id = a.comp_plan_id
                           where a.user_id = auth.uid() and cp.is_active
                             and a.effective_from <= current_date and (a.effective_to is null or a.effective_to >= current_date)));
$$;


--
-- Name: complete_employee_comp_agreement(text, text, text, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_employee_comp_agreement(p_signing_token_hash text, p_signed_name text, p_signed_ip text, p_signed_user_agent text, p_receipt_token_hash text, p_receipt_expires_at timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_row employee_comp_agreements%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM employee_comp_agreements WHERE signing_token_hash = p_signing_token_hash AND status = 'sent' AND token_expires_at > NOW() FOR UPDATE;
  IF v_row.id IS NULL THEN RETURN NULL; END IF;
  UPDATE employee_comp_agreements SET status = 'rep_signed', rep_signed_name = p_signed_name, rep_signed_at = NOW(), rep_signed_ip = p_signed_ip,
    rep_signed_user_agent = p_signed_user_agent, signing_token_hash = NULL, token_expires_at = NULL,
    receipt_token_hash = p_receipt_token_hash, receipt_expires_at = p_receipt_expires_at, updated_at = NOW() WHERE id = v_row.id;
  INSERT INTO employee_comp_agreement_events (agreement_id, org_id, event_type, actor_name, event_ip, event_user_agent, metadata)
  VALUES (v_row.id, v_row.org_id, 'rep_signed', p_signed_name, p_signed_ip, p_signed_user_agent, jsonb_build_object('content_hash', v_row.agreement_content_hash));
  RETURN v_row.id;
END;
$$;


--
-- Name: complete_public_estimate_unlock_delivery(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_public_estimate_unlock_delivery(p_lead_id uuid, p_delivery_key text, p_attempt_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  UPDATE public_estimate_unlock_deliveries
  SET state = 'sent', sent_at = NOW(), updated_at = NOW()
  WHERE lead_id = p_lead_id
    AND delivery_key = p_delivery_key
    AND attempt_id = p_attempt_id
    AND state = 'claimed';
$$;


--
-- Name: confirm_opportunity_self_generated(uuid, uuid, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_opportunity_self_generated(p_org_id uuid, p_opportunity_id uuid, p_is_self_generated boolean, p_confirmed_by uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE opportunities
  SET
    is_self_generated = p_is_self_generated,
    self_generated_source = 'manual',
    updated_at = NOW()
  WHERE id = p_opportunity_id
    AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'opportunity not found in organization';
  END IF;

  INSERT INTO activities (
    org_id, opportunity_id, user_id, type, body
  ) VALUES (
    p_org_id,
    p_opportunity_id,
    p_confirmed_by,
    'status_change',
    CASE WHEN p_is_self_generated
      THEN 'Payroll attribution confirmed: self-generated.'
      ELSE 'Payroll attribution confirmed: not self-generated.'
    END
  );
END;
$$;


--
-- Name: create_default_hierarchy_roles(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_default_hierarchy_roles(p_org_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_existing_count INT;
BEGIN
  -- Check if roles already exist for this org
  SELECT COUNT(*) INTO v_existing_count
  FROM custom_roles
  WHERE org_id = p_org_id;
  
  -- Only create if no roles exist
  IF v_existing_count = 0 THEN
    INSERT INTO custom_roles (org_id, name, display_name, description, hierarchy_level, is_system_role)
    VALUES
      (p_org_id, 'admin_owner', 'Admin/Owner', 'Full system access and ownership', 100, true),
      (p_org_id, 'regional_operations', 'Regional Operations', 'Regional operations oversight and management', 90, true),
      (p_org_id, 'operations_manager', 'Operations Manager', 'Operations team management', 85, true),
      (p_org_id, 'regional_sales_manager', 'Regional Sales Manager', 'Regional sales oversight and strategy', 80, true),
      (p_org_id, 'operations', 'Operations', 'Day-to-day operations and coordination', 75, true),
      (p_org_id, 'sales_manager', 'Sales Manager', 'Sales team management and coaching', 70, true),
      (p_org_id, 'regional_setter_manager', 'Regional Setter Manager', 'Regional setter team oversight', 65, true),
      (p_org_id, 'setter_manager', 'Setter Manager', 'Setter team management and training', 60, true),
      (p_org_id, 'field_operations', 'Field Operations', 'Field work coordination and quality control', 55, true),
      (p_org_id, 'sales_rep', 'Sales Rep', 'Sales activities and customer relationships', 50, true),
      (p_org_id, 'setter', 'Setter', 'Appointment setting and lead qualification', 40, true),
      (p_org_id, 'sub_contractor', 'Sub Contractor', 'External contractor with limited access', 30, true);
  END IF;
END;
$$;


--
-- Name: FUNCTION create_default_hierarchy_roles(p_org_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_default_hierarchy_roles(p_org_id uuid) IS 'Creates default hierarchy roles for a new organization';


--
-- Name: create_default_permission_presets(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_default_permission_presets(p_org_id uuid, p_created_by uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_preset_id UUID;
  v_perm_id UUID;
BEGIN
  -- Setter / Canvasser preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Setter / Canvasser', 'Door-to-door canvassing, lead creation, basic scheduling', 'canvasser', 'green', true, 1, p_created_by)
  RETURNING id INTO v_preset_id;
  
  INSERT INTO preset_permissions (preset_id, permission_id)
  SELECT v_preset_id, id FROM permissions WHERE name IN (
    'canvass:view', 'canvass:create', 'canvass:edit',
    'leads:view', 'leads:create', 'leads:edit',
    'scheduling:view',
    'reports:view_own',
    'teams:view',
    'users:view'
  );

  -- Sales Representative preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Sales Representative', 'Full sales cycle - leads, opportunities, proposals, contracts', 'sales_rep', 'blue', true, 2, p_created_by)
  RETURNING id INTO v_preset_id;
  
  INSERT INTO preset_permissions (preset_id, permission_id)
  SELECT v_preset_id, id FROM permissions WHERE name IN (
    'canvass:view',
    'leads:view', 'leads:create', 'leads:edit',
    'opportunities:view', 'opportunities:edit',
    'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
    'contracts:view', 'contracts:create', 'contracts:send',
    'projects:view',
    'scheduling:view', 'scheduling:create', 'scheduling:edit',
    'reports:view_own',
    'teams:view',
    'users:view'
  );

  -- Sales Manager preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Sales Manager', 'Team management, reporting, full sales access', 'sales_manager', 'purple', true, 3, p_created_by)
  RETURNING id INTO v_preset_id;
  
  INSERT INTO preset_permissions (preset_id, permission_id)
  SELECT v_preset_id, id FROM permissions WHERE name IN (
    'canvass:view', 'canvass:create', 'canvass:edit', 'canvass:import', 'canvass:export',
    'leads:view', 'leads:create', 'leads:edit', 'leads:assign',
    'opportunities:view', 'opportunities:edit',
    'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
    'contracts:view', 'contracts:create', 'contracts:send',
    'projects:view', 'projects:edit',
    'teams:view', 'teams:edit', 'teams:manage_members',
    'users:view', 'users:manage_team',
    'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_team',
    'reports:view_own', 'reports:view_team', 'reports:export',
    'pricebook:view'
  );

  -- Regional Manager preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Regional Manager', 'Regional oversight, all team management, admin access', 'regional_manager', 'indigo', true, 4, p_created_by)
  RETURNING id INTO v_preset_id;
  
  INSERT INTO preset_permissions (preset_id, permission_id)
  SELECT v_preset_id, id FROM permissions WHERE name IN (
    'canvass:view', 'canvass:create', 'canvass:edit', 'canvass:delete', 'canvass:import', 'canvass:export',
    'leads:view', 'leads:create', 'leads:edit', 'leads:delete', 'leads:assign',
    'opportunities:view', 'opportunities:edit', 'opportunities:delete',
    'proposals:view', 'proposals:create', 'proposals:edit', 'proposals:send',
    'contracts:view', 'contracts:create', 'contracts:send',
    'projects:view', 'projects:edit', 'projects:complete',
    'teams:view', 'teams:create', 'teams:edit', 'teams:delete', 'teams:manage_members',
    'regions:view', 'regions:edit',
    'users:view', 'users:edit', 'users:manage_team', 'users:manage_region',
    'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_team', 'scheduling:manage_region',
    'reports:view_own', 'reports:view_team', 'reports:view_region', 'reports:export',
    'pricebook:view', 'pricebook:edit',
    'admin:access'
  );

  -- Operations preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Operations', 'Project management, scheduling, reporting - no sales', 'operations', 'orange', true, 5, p_created_by)
  RETURNING id INTO v_preset_id;
  
  INSERT INTO preset_permissions (preset_id, permission_id)
  SELECT v_preset_id, id FROM permissions WHERE name IN (
    'leads:view',
    'opportunities:view',
    'proposals:view',
    'contracts:view',
    'projects:view', 'projects:edit', 'projects:complete',
    'teams:view',
    'users:view',
    'scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_queue',
    'reports:view_own', 'reports:view_all', 'reports:export',
    'pricebook:view'
  );

  -- Administrator preset
  INSERT INTO permission_presets (org_id, name, description, base_role, color, is_system, sort_order, created_by)
  VALUES (p_org_id, 'Administrator', 'Full system access - all permissions', 'admin', 'red', true, 6, p_created_by)
  RETURNING id INTO v_preset_id;
  
  INSERT INTO preset_permissions (preset_id, permission_id)
  SELECT v_preset_id, id FROM permissions WHERE name = 'admin:full';

END;
$$;


--
-- Name: FUNCTION create_default_permission_presets(p_org_id uuid, p_created_by uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_default_permission_presets(p_org_id uuid, p_created_by uuid) IS 'Creates default permission presets for a new organization';


--
-- Name: create_employee_comp_agreement(uuid, uuid, text, text, jsonb, text, uuid, date, uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_employee_comp_agreement(p_org_id uuid, p_user_id uuid, p_agreement_key text, p_agreement_version text, p_agreement_snapshot jsonb, p_content_hash text, p_request_key uuid, p_effective_date date, p_manager_user_id uuid, p_manager_signed_name text, p_manager_signed_email text, p_manager_signed_ip text, p_manager_signed_user_agent text, p_sent_to_email text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM employee_comp_agreements
    WHERE org_id = p_org_id AND manager_user_id = p_manager_user_id AND request_key = p_request_key
      AND user_id = p_user_id AND agreement_key = p_agreement_key AND agreement_version = p_agreement_version
      AND agreement_snapshot = p_agreement_snapshot AND agreement_content_hash = p_content_hash
      AND effective_date = p_effective_date AND manager_signed_name = p_manager_signed_name
      AND manager_signed_email IS NOT DISTINCT FROM p_manager_signed_email AND sent_to_email = p_sent_to_email;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF EXISTS (SELECT 1 FROM employee_comp_agreements WHERE org_id = p_org_id AND manager_user_id = p_manager_user_id AND request_key = p_request_key)
    THEN RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023'; END IF;
  INSERT INTO employee_comp_agreements (
    org_id, user_id, agreement_key, agreement_version, agreement_snapshot, agreement_content_hash,
    request_key, effective_date, manager_user_id, manager_signed_name, manager_signed_email,
    manager_signed_ip, manager_signed_user_agent, sent_to_email
  ) VALUES (
    p_org_id, p_user_id, p_agreement_key, p_agreement_version, p_agreement_snapshot, p_content_hash,
    p_request_key, p_effective_date, p_manager_user_id, p_manager_signed_name, p_manager_signed_email,
    p_manager_signed_ip, p_manager_signed_user_agent, p_sent_to_email
  ) RETURNING id INTO v_id;
  INSERT INTO employee_comp_agreement_events (agreement_id, org_id, event_type, actor_user_id, actor_name, actor_email, event_ip, event_user_agent, metadata)
  VALUES (v_id, p_org_id, 'manager_signed', p_manager_user_id, p_manager_signed_name, p_manager_signed_email, p_manager_signed_ip, p_manager_signed_user_agent, jsonb_build_object('agreement_version', p_agreement_version, 'content_hash', p_content_hash));
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_id FROM employee_comp_agreements
    WHERE org_id = p_org_id AND manager_user_id = p_manager_user_id AND request_key = p_request_key
      AND user_id = p_user_id AND agreement_key = p_agreement_key AND agreement_version = p_agreement_version
      AND agreement_snapshot = p_agreement_snapshot AND agreement_content_hash = p_content_hash
      AND effective_date = p_effective_date AND manager_signed_name = p_manager_signed_name
      AND manager_signed_email IS NOT DISTINCT FROM p_manager_signed_email AND sent_to_email = p_sent_to_email;
  IF v_id IS NULL THEN RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023'; END IF;
  RETURN v_id;
END;
$$;


--
-- Name: create_inspection_status_prompt(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_inspection_status_prompt() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.closer_user_id IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO pending_status_prompts (
      org_id,
      appointment_id,
      closer_user_id,
      prompt_at
    ) VALUES (
      NEW.org_id,
      NEW.id,
      NEW.closer_user_id,
      NEW.scheduled_for
    )
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION create_inspection_status_prompt(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_inspection_status_prompt() IS 'Queues pending_status_prompts.prompt_at at appointment start (scheduled_for).';


--
-- Name: create_production_job_from_project(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_production_job_from_project() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only create if status changed to 'complete' (meaning contract signed/sold)
  -- and no production job exists yet
  IF NEW.status = 'complete' AND OLD.status != 'complete' THEN
    IF NOT EXISTS (SELECT 1 FROM production_jobs WHERE project_id = NEW.id) THEN
      INSERT INTO production_jobs (
        org_id,
        project_id,
        customer_id,
        job_type,
        address_text,
        lat,
        lng,
        salesperson_id,
        sale_date,
        created_by
      ) VALUES (
        NEW.org_id,
        NEW.id,
        NEW.customer_id,
        NEW.project_type,
        COALESCE(NEW.address_text, ''),
        NEW.lat,
        NEW.lng,
        NEW.owner_user_id,
        CURRENT_DATE,
        COALESCE(NEW.owner_user_id, (SELECT id FROM users WHERE org_id = NEW.org_id AND role = 'admin' LIMIT 1))
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: dashboard_count_door_leads_scoped(uuid, timestamp with time zone, timestamp with time zone, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_count_door_leads_scoped(p_org_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_scope_user_ids uuid[]) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COUNT(*)::bigint
  FROM canvass_knocks k
  WHERE k.org_id = p_org_id
    AND k.created_at >= p_start
    AND k.created_at < p_end
    AND (
      cardinality(p_scope_user_ids) = 0
      OR k.user_id = ANY(p_scope_user_ids)
    )
    AND public.canvass_knock_is_door_eligible(k.source, k.disposition);
$$;


--
-- Name: end_management_comp_overlay(uuid, uuid, date, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.end_management_comp_overlay(p_org_id uuid, p_assignment_id uuid, p_effective_to date, p_created_by_user_id uuid, p_change_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF p_effective_to < v_today THEN
    RAISE EXCEPTION 'management overlay end date cannot be in the past';
  END IF;
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'end reason is required';
  END IF;
  PERFORM 1 FROM users
  WHERE id = p_created_by_user_id AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations') AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll administrator not found'; END IF;

  UPDATE user_management_comp_overlay_assignments
  SET effective_to = p_effective_to,
      ended_at = NOW(),
      ended_by_user_id = p_created_by_user_id,
      end_reason = p_change_reason
  WHERE id = p_assignment_id
    AND org_id = p_org_id
    AND effective_from <= p_effective_to
    AND effective_from <= v_today
    AND cancelled_at IS NULL
    AND ended_at IS NULL
    AND (effective_to IS NULL OR effective_to > p_effective_to);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'current management overlay assignment not found';
  END IF;
END;
$$;


--
-- Name: enforce_documents_mvp_rules(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_documents_mvp_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- storage_path is immutable
  IF TG_OP = 'UPDATE' AND NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    RAISE EXCEPTION 'documents.storage_path is immutable';
  END IF;

  -- signed/executed docs are always protected
  IF NEW.document_role = 'signed_executed' THEN
    NEW.is_protected := true;
  END IF;

  -- signed/executed role cannot be downgraded once set
  IF TG_OP = 'UPDATE' AND OLD.document_role = 'signed_executed' AND NEW.document_role IS DISTINCT FROM OLD.document_role THEN
    RAISE EXCEPTION 'signed_executed document role cannot be changed';
  END IF;

  -- role transition rules
  IF TG_OP = 'UPDATE' AND NEW.document_role IS DISTINCT FROM OLD.document_role THEN
    IF OLD.document_role = 'draft' AND NEW.document_role NOT IN ('signed_executed', 'supporting_attachment') THEN
      RAISE EXCEPTION 'invalid document role transition from draft';
    END IF;
    IF OLD.document_role = 'supporting_attachment' AND NEW.document_role NOT IN ('draft', 'supporting_attachment') THEN
      RAISE EXCEPTION 'invalid document role transition from supporting_attachment';
    END IF;
    IF OLD.document_role = 'customer_copy' AND NEW.document_role = 'signed_executed' THEN
      RAISE EXCEPTION 'invalid document role transition from customer_copy';
    END IF;
    IF OLD.document_role = 'internal_copy' AND NEW.document_role = 'signed_executed' THEN
      RAISE EXCEPTION 'invalid document role transition from internal_copy';
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


--
-- Name: enforce_employee_agreement_lifecycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_employee_agreement_lifecycle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.rep_signed_at IS NOT NULL AND (
    NEW.rep_signed_name IS DISTINCT FROM OLD.rep_signed_name OR
    NEW.rep_signed_at IS DISTINCT FROM OLD.rep_signed_at OR
    NEW.rep_signed_ip IS DISTINCT FROM OLD.rep_signed_ip OR
    NEW.rep_signed_user_agent IS DISTINCT FROM OLD.rep_signed_user_agent
  ) THEN RAISE EXCEPTION 'Rep signature is immutable'; END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'manager_signed' AND NEW.status IN ('sending', 'voided')) OR
    (OLD.status = 'sending' AND NEW.status IN ('sent', 'delivery_failed')) OR
    (OLD.status = 'sent' AND NEW.status IN ('sending', 'rep_signed', 'declined', 'voided')) OR
    (OLD.status = 'delivery_failed' AND NEW.status IN ('sending', 'voided'))
  ) THEN RAISE EXCEPTION 'Invalid employee agreement status transition: % to %', OLD.status, NEW.status; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_photos_storage_path_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_photos_storage_path_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    RAISE EXCEPTION 'photos.storage_path is immutable';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


--
-- Name: enforce_user_comp_plan_org_scope(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_user_comp_plan_org_scope() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.user_id AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'user comp-plan recipient belongs to another organization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM comp_plans WHERE id = NEW.comp_plan_id AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'user comp plan belongs to another organization';
  END IF;
  IF NEW.created_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.created_by_user_id AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'user comp-plan actor belongs to another organization';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enqueue_integration_event(uuid, text, text, text, uuid, jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_integration_event(p_org_id uuid, p_provider text, p_event_type text, p_entity_table text, p_entity_id uuid, p_payload jsonb, p_version integer DEFAULT 1) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_idempotency_key TEXT;
  v_event_id UUID;
BEGIN
  v_idempotency_key := generate_idempotency_key(p_org_id, p_entity_table, p_entity_id, p_event_type, p_version);
  
  INSERT INTO integration_outbox (
    org_id, provider, event_type, entity_table, entity_id, 
    idempotency_key, payload, status
  ) VALUES (
    p_org_id, p_provider, p_event_type, p_entity_table, p_entity_id,
    v_idempotency_key, p_payload, 'pending'
  )
  ON CONFLICT (idempotency_key) DO UPDATE SET
    payload = EXCLUDED.payload,
    updated_at = NOW(),
    status = CASE 
      WHEN integration_outbox.status = 'failed' THEN 'pending'::outbox_status
      ELSE integration_outbox.status
    END
  RETURNING id INTO v_event_id;
  
  RETURN v_event_id;
END;
$$;


--
-- Name: fail_employee_agreement_send(uuid, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_employee_agreement_send(p_agreement_id uuid, p_attempt_id uuid, p_actor_user_id uuid, p_actor_name text, p_actor_email text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_row employee_comp_agreements%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM employee_comp_agreements WHERE id = p_agreement_id AND status = 'sending' AND send_attempt_id = p_attempt_id FOR UPDATE;
  IF v_row.id IS NULL THEN RETURN FALSE; END IF;
  UPDATE employee_comp_agreements SET status = 'delivery_failed', delivery_error = 'Email could not be sent. Retry from the user profile.',
    signing_token_hash = NULL, token_expires_at = NULL, send_attempt_id = NULL, send_claimed_at = NULL, updated_at = NOW() WHERE id = v_row.id;
  INSERT INTO employee_comp_agreement_events (agreement_id, org_id, event_type, actor_user_id, actor_name, actor_email, metadata)
  VALUES (v_row.id, v_row.org_id, 'delivery_failed', p_actor_user_id, p_actor_name, p_actor_email, jsonb_build_object('code', 'smtp_send_failed'));
  RETURN TRUE;
END;
$$;


--
-- Name: fail_public_estimate_unlock_delivery(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_public_estimate_unlock_delivery(p_lead_id uuid, p_delivery_key text, p_attempt_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  UPDATE public_estimate_unlock_deliveries
  SET state = 'failed', failed_at = NOW(), updated_at = NOW()
  WHERE lead_id = p_lead_id
    AND delivery_key = p_delivery_key
    AND attempt_id = p_attempt_id
    AND state = 'claimed';
$$;


--
-- Name: finalize_employee_agreement_send(uuid, uuid, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_employee_agreement_send(p_agreement_id uuid, p_attempt_id uuid, p_event_type text, p_actor_user_id uuid, p_actor_name text, p_actor_email text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_row employee_comp_agreements%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM employee_comp_agreements WHERE id = p_agreement_id AND status = 'sending' AND send_attempt_id = p_attempt_id FOR UPDATE;
  IF v_row.id IS NULL THEN RETURN FALSE; END IF;
  IF p_event_type NOT IN ('send_accepted', 'resent') THEN RAISE EXCEPTION 'invalid_send_event'; END IF;
  UPDATE employee_comp_agreements SET status = 'sent', sent_at = NOW(), delivery_error = NULL, send_attempt_id = NULL, send_claimed_at = NULL, updated_at = NOW() WHERE id = v_row.id;
  INSERT INTO employee_comp_agreement_events (agreement_id, org_id, event_type, actor_user_id, actor_name, actor_email, metadata)
  VALUES (v_row.id, v_row.org_id, p_event_type, p_actor_user_id, p_actor_name, p_actor_email, jsonb_build_object('recipient', v_row.sent_to_email));
  RETURN TRUE;
END;
$$;


--
-- Name: find_similar_referral_partners(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_similar_referral_partners(p_org uuid, p_name text, p_company text DEFAULT NULL::text) RETURNS TABLE(id uuid, name text, company text, status text, assigned_user_id uuid, score real)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  SELECT p.id, p.name, p.company, p.status, p.assigned_user_id,
         GREATEST(similarity(lower(p.name), lower(p_name)),
                  CASE WHEN p_company IS NOT NULL AND p_company <> ''
                       THEN similarity(lower(coalesce(p.company, '')), lower(p_company)) ELSE 0 END)::REAL AS score
    FROM referral_partners p
   WHERE p.org_id = p_org
     AND (lower(p.name) % lower(p_name)
          OR (p_company IS NOT NULL AND p_company <> '' AND lower(coalesce(p.company, '')) % lower(p_company)))
   ORDER BY score DESC LIMIT 5
$$;


--
-- Name: generate_idempotency_key(uuid, text, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_idempotency_key(p_org_id uuid, p_entity_table text, p_entity_id uuid, p_event_type text, p_version integer DEFAULT 1) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  RETURN p_org_id::TEXT || ':' || p_entity_table || ':' || p_entity_id::TEXT || ':' || p_event_type || ':v' || p_version;
END;
$$;


--
-- Name: generate_invoice_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_invoice_number(p_job_id uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_job_number TEXT;
  v_year TEXT;
  v_seq INTEGER;
  v_invoice_number TEXT;
BEGIN
  SELECT job_number INTO v_job_number
  FROM production_jobs
  WHERE id = p_job_id;
  
  v_year := TO_CHAR(NOW(), 'YY');
  
  SELECT COUNT(*) + 1 INTO v_seq
  FROM job_invoices
  WHERE job_id = p_job_id;
  
  v_invoice_number := 'INV-' || v_year || '-' || v_job_number || '-' || LPAD(v_seq::TEXT, 3, '0');
  
  RETURN v_invoice_number;
END;
$$;


--
-- Name: generate_job_file_storage_key(uuid, uuid, public.job_file_type, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_job_file_storage_key(p_org_id uuid, p_job_id uuid, p_file_type public.job_file_type, p_version integer DEFAULT 1) RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF p_version = 1 THEN
    RETURN 'orgs/' || p_org_id::text || '/jobs/' || p_job_id::text || '/' || p_file_type::text || '.pdf';
  ELSE
    RETURN 'orgs/' || p_org_id::text || '/jobs/' || p_job_id::text || '/' || p_file_type::text || '_v' || p_version::text || '.pdf';
  END IF;
END;
$$;


--
-- Name: generate_job_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_job_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  next_num INTEGER;
  year_prefix TEXT;
BEGIN
  year_prefix := to_char(CURRENT_DATE, 'YY');
  
  SELECT COALESCE(MAX(CAST(SUBSTRING(job_number FROM 4) AS INTEGER)), 0) + 1
  INTO next_num
  FROM production_jobs
  WHERE org_id = NEW.org_id
  AND job_number LIKE year_prefix || '-%';
  
  NEW.job_number := year_prefix || '-' || LPAD(next_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$;


--
-- Name: generate_proposal_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_proposal_number(p_org_id uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_count INTEGER;
  v_year TEXT;
BEGIN
  v_year := to_char(NOW(), 'YY');
  
  SELECT COUNT(*) + 1 INTO v_count
  FROM proposals
  WHERE org_id = p_org_id
    AND created_at >= date_trunc('year', NOW());
  
  RETURN 'P' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');
END;
$$;


--
-- Name: generate_work_order_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_work_order_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  next_num INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('work_order_number:' || NEW.org_id::text));
  SELECT COALESCE(MAX(CAST(SUBSTRING(work_order_number FROM 4) AS INTEGER)), 0) + 1
  INTO next_num
  FROM work_orders
  WHERE org_id = NEW.org_id;

  NEW.work_order_number := 'WO-' || LPAD(next_num::TEXT, 5, '0');
  RETURN NEW;
END;
$$;


--
-- Name: generate_work_order_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_work_order_number(p_org_id uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_count INTEGER;
  v_year TEXT;
BEGIN
  v_year := TO_CHAR(NOW(), 'YY');
  
  SELECT COUNT(*) + 1 INTO v_count
  FROM work_orders
  WHERE org_id = p_org_id
  AND created_at >= DATE_TRUNC('year', NOW());
  
  RETURN 'WO-' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');
END;
$$;


--
-- Name: get_canvass_visible_user_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_canvass_visible_user_ids(user_uuid uuid) RETURNS SETOF uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  user_record RECORD;
BEGIN
  SELECT
    u.id,
    u.org_id,
    u.team_id,
    u.region_id,
    u.canvass_pin_visibility,
    u.role
  INTO user_record
  FROM users u
  WHERE u.id = user_uuid;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF user_record.role IN ('owner', 'admin', 'regional_manager', 'sales_manager', 'operations') THEN
    RETURN QUERY
    SELECT id FROM users WHERE org_id = user_record.org_id;
    RETURN;
  END IF;

  CASE user_record.canvass_pin_visibility
    WHEN 'own' THEN
      RETURN NEXT user_uuid;

    WHEN 'team' THEN
      IF user_record.team_id IS NOT NULL THEN
        RETURN QUERY
        SELECT id FROM users
        WHERE org_id = user_record.org_id AND team_id = user_record.team_id;
      ELSE
        RETURN NEXT user_uuid;
      END IF;

    WHEN 'region' THEN
      IF user_record.region_id IS NOT NULL THEN
        RETURN QUERY
        SELECT id FROM users
        WHERE org_id = user_record.org_id AND region_id = user_record.region_id;
      ELSIF user_record.team_id IS NOT NULL THEN
        RETURN QUERY
        SELECT u.id FROM users u
        JOIN teams t ON u.team_id = t.id
        WHERE u.org_id = user_record.org_id
          AND t.region_id = (SELECT region_id FROM teams WHERE id = user_record.team_id);
      ELSE
        RETURN NEXT user_uuid;
      END IF;

    WHEN 'org' THEN
      RETURN QUERY
      SELECT id FROM users WHERE org_id = user_record.org_id;

    WHEN 'territory' THEN
      RETURN QUERY
      SELECT id FROM users WHERE org_id = user_record.org_id;

    ELSE
      RETURN NEXT user_uuid;
  END CASE;

  RETURN;
END;
$$;


--
-- Name: FUNCTION get_canvass_visible_user_ids(user_uuid uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_canvass_visible_user_ids(user_uuid uuid) IS 'User IDs whose canvass pins may be visible; territory mode still requires lat/lng in assigned polygons (enforced in API).';


--
-- Name: get_next_co_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_next_co_number(p_project_id uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(co_number FROM 4) AS INTEGER)), 0) + 1
  INTO next_num
  FROM job_change_orders
  WHERE project_id = p_project_id;
  
  RETURN 'CO-' || LPAD(next_num::TEXT, 3, '0');
END;
$$;


--
-- Name: get_next_job_file_version(uuid, public.job_file_type); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_next_job_file_version(p_job_id uuid, p_file_type public.job_file_type) RETURNS integer
    LANGUAGE sql
    AS $$
  SELECT COALESCE(MAX(version), 0) + 1
  FROM job_files
  WHERE job_id = p_job_id AND file_type = p_file_type;
$$;


--
-- Name: get_sub_id_for_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_sub_id_for_user(user_uuid uuid) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT id FROM sub_contractors WHERE user_id = user_uuid LIMIT 1;
$$;


--
-- Name: FUNCTION get_sub_id_for_user(user_uuid uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_sub_id_for_user(user_uuid uuid) IS 'Returns sub_contractor ID for a given auth user';


--
-- Name: get_unpaid_referrals(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_unpaid_referrals(p_org_id uuid, p_days_threshold integer DEFAULT 7) RETURNS TABLE(referral_id uuid, referrer_name text, referred_name text, bonus_amount numeric, install_date date, days_since_install integer, referrer_customer_id uuid, referred_project_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.referrer_name,
    r.referred_name,
    r.bonus_amount,
    r.install_date,
    (CURRENT_DATE - r.install_date)::INTEGER as days_since_install,
    r.referrer_customer_id,
    r.referred_project_id
  FROM referrals r
  WHERE r.org_id = p_org_id
    AND r.status = 'installed'
    AND r.paid_at IS NULL
    AND (CURRENT_DATE - r.install_date) >= p_days_threshold
  ORDER BY (CURRENT_DATE - r.install_date) DESC;
END;
$$;


--
-- Name: get_user_hierarchy_level(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_hierarchy_level(user_uuid uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  user_record RECORD;
  hierarchy INTEGER;
BEGIN
  SELECT role, custom_role_id INTO user_record
  FROM users WHERE id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  
  -- Check custom role hierarchy
  IF user_record.custom_role_id IS NOT NULL THEN
    SELECT hierarchy_level INTO hierarchy
    FROM custom_roles WHERE id = user_record.custom_role_id;
    RETURN COALESCE(hierarchy, 0);
  END IF;
  
  -- Legacy role hierarchy
  RETURN CASE user_record.role
    WHEN 'admin' THEN 100
    WHEN 'regional_manager' THEN 80
    WHEN 'sales_manager' THEN 60
    WHEN 'operations' THEN 50
    WHEN 'sales_rep' THEN 40
    WHEN 'canvasser' THEN 20
    ELSE 0
  END;
END;
$$;


--
-- Name: get_user_org_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_org_id(user_uuid uuid) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT org_id FROM users WHERE id = user_uuid;
$$;


--
-- Name: get_user_permissions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_permissions(user_uuid uuid) RETURNS TABLE(permission_name text, display_name text, category text, source text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  user_record RECORD;
BEGIN
  SELECT role, custom_role_id INTO user_record
  FROM users WHERE id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Return user-specific grants
  RETURN QUERY
  SELECT p.name, p.display_name, p.category, 'user_grant'::TEXT
  FROM user_permissions up
  JOIN permissions p ON p.id = up.permission_id
  WHERE up.user_id = user_uuid
  AND (up.expires_at IS NULL OR up.expires_at > NOW());
  
  -- Return custom role permissions
  IF user_record.custom_role_id IS NOT NULL THEN
    RETURN QUERY
    SELECT p.name, p.display_name, p.category, 'custom_role'::TEXT
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = user_record.custom_role_id;
  END IF;
END;
$$;


--
-- Name: get_user_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_role(user_uuid uuid) RETURNS public.user_role_old
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT role FROM users WHERE id = user_uuid;
$$;


--
-- Name: guard_users_is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_users_is_super_admin() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role TEXT := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                          (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
                          '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.is_super_admin, FALSE) AND v_role NOT IN ('service_role', '') THEN
      RAISE EXCEPTION 'is_super_admin can only be set by the server' USING ERRCODE = '42501';
    END IF;
    NEW.super_admin_granted_at := CASE WHEN COALESCE(NEW.is_super_admin, FALSE) THEN NOW() ELSE NULL END;
    RETURN NEW;
  END IF;

  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    IF v_role NOT IN ('service_role', '') THEN
      RAISE EXCEPTION 'is_super_admin can only be changed by the server' USING ERRCODE = '42501';
    END IF;
    NEW.super_admin_granted_at := CASE WHEN COALESCE(NEW.is_super_admin, FALSE) THEN NOW() ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: invoice_is_mine_self(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoice_is_mine_self(p uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ select arx_private.invoice_mine(auth.uid(), p); $$;


--
-- Name: is_admin_or_manager(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin_or_manager(user_uuid uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT COALESCE(role::text, '') IN (
    'admin',
    'owner',
    'regional_manager',
    'sales_manager',
    'regional_setter_manager',
    'setter_manager',
    'manager' -- legacy value in older environments
  )
  FROM users
  WHERE id = user_uuid;
$$;


--
-- Name: is_closer_self(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_closer_self() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select coalesce((select lower(btrim(u.role::text)) in ('rep', 'sales_rep', 'closer') and not coalesce(u.is_super_admin, false)
                     from public.users u where u.id = auth.uid()), false);
$$;


--
-- Name: is_field_role_self(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_field_role_self() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    (select arx_private.is_field_role(lower(btrim(u.role::text)), lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')))
            and not coalesce(u.is_super_admin, false)
       from public.users u left join public.custom_roles cr on cr.id = u.custom_role_id
      where u.id = auth.uid()),
    false);
$$;


--
-- Name: is_payroll_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_payroll_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    (select coalesce(u.active, true)
            and (lower(btrim(u.role::text)) in ('admin', 'owner', 'operations') or coalesce(u.is_super_admin, false))
       from public.users u
      where u.id = auth.uid()),
    false);
$$;


--
-- Name: is_setter_canvasser_self(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_setter_canvasser_self() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    (select arx_private.is_field_role(lower(btrim(u.role::text)), lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')))
            and not (lower(btrim(u.role::text)) in ('inside_sales', 'inside sales', 'call_center', 'call center')
                     or lower(coalesce(cr.name, '') || ' ' || coalesce(cr.display_name, '')) ~ '(inside[ _-]?sales|call[ _-]?cent(er|re))')
            and not coalesce(u.is_super_admin, false)
       from public.users u left join public.custom_roles cr on cr.id = u.custom_role_id
      where u.id = auth.uid()),
    false);
$$;


--
-- Name: job_is_mine_self(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.job_is_mine_self(p uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ select arx_private.job_mine(auth.uid(), p); $$;


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    owner_user_id uuid,
    status public.lead_status DEFAULT 'new'::public.lead_status NOT NULL,
    source text,
    address_text text,
    lat numeric(10,8),
    lng numeric(11,8),
    homeowner_name text,
    phone text,
    email text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    inspection_scheduled_at timestamp with time zone,
    canvass_disposition text,
    canvass_notes text,
    closer_user_id uuid,
    inspection_scheduled_for timestamp with time zone,
    campaign_id uuid,
    lead_source_id uuid,
    source_type public.lead_source_type,
    channel public.lead_channel DEFAULT 'outbound'::public.lead_channel,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    external_lead_id text,
    landing_page text,
    referrer_url text,
    ip_address inet,
    user_agent text,
    raw_payload jsonb,
    owner_display_name text,
    closer_display_name text,
    pin_attributed_user_id uuid,
    installation_agreement_signed_at timestamp with time zone,
    rep_lat double precision,
    rep_lng double precision,
    rep_geo_accuracy real,
    rep_geo_captured_at timestamp with time zone,
    ownership_reassigned_at timestamp with time zone,
    ownership_history jsonb,
    client_lead_id text,
    customer_id uuid
);


--
-- Name: COLUMN leads.channel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.channel IS 'Whether lead came from inbound (website/ads) or outbound (canvassing) efforts';


--
-- Name: COLUMN leads.pin_attributed_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.pin_attributed_user_id IS 'Original canvass setter (first owner_user_id). Not a FK — survives user delete for map filters.';


--
-- Name: COLUMN leads.installation_agreement_signed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.installation_agreement_signed_at IS 'Set when the Installation Agreement (non-contingency order form) is signed; used for canvass sold ($) pin styling.';


--
-- Name: COLUMN leads.rep_lat; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.rep_lat IS 'Rep physical latitude at moment of door disposition — for accountability/fraud detection';


--
-- Name: COLUMN leads.rep_lng; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.rep_lng IS 'Rep physical longitude at moment of door disposition';


--
-- Name: COLUMN leads.rep_geo_accuracy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.rep_geo_accuracy IS 'GPS accuracy in metres at time of capture (from browser Geolocation API)';


--
-- Name: COLUMN leads.rep_geo_captured_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.rep_geo_captured_at IS 'UTC timestamp when rep GPS was snapshotted';


--
-- Name: COLUMN leads.ownership_reassigned_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.ownership_reassigned_at IS 'When owner_user_id was last reassigned to a different rep (stale pin re-knock).';


--
-- Name: COLUMN leads.ownership_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.ownership_history IS 'Append-only audit: { from_user_id, from_pin_attributed_user_id, to_user_id, reassigned_at, prior_knock_at }[].';


--
-- Name: COLUMN leads.client_lead_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.client_lead_id IS 'Client-generated UUID from canvass offline queue; dedupes retries within 24h per org/owner.';


--
-- Name: lead_in_pipeline(public.leads); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lead_in_pipeline(l public.leads) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select coalesce(
       (nullif(btrim(coalesce(l.homeowner_name, '')), '') is not null
          and (nullif(btrim(coalesce(l.phone, '')), '') is not null or nullif(btrim(coalesce(l.email, '')), '') is not null))
    or l.inspection_scheduled_at is not null
    or l.inspection_scheduled_for is not null
    or l.status::text in ('appointment', 'inspection', 'estimate_sent', 'won', 'lost')
    or exists (select 1 from public.scheduled_appointments a where a.lead_id = l.id and coalesce(a.status::text, '') <> 'cancelled')
    or exists (select 1 from public.opportunities o where o.lead_id = l.id)
    or l.channel::text = 'inbound'
    or lower(coalesce(l.source, '')) in ('web', 'yelp', 'referral', 'call_in', 'facebook-ad', 'ad_campaign')
    or lower(coalesce(l.source, '')) like 'website%'
    or l.source_type::text in ('website', 'google_ads', 'facebook', 'instagram', 'tiktok', 'youtube', 'bing_ads', 'referral', 'phone_call', 'partner', 'home_show', 'walk_in'),
    false);
$$;


--
-- Name: lead_is_mine_self(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lead_is_mine_self(p_lead uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ select arx_private.lead_mine(auth.uid(), p_lead); $$;


--
-- Name: leads_set_assignee_display_names(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leads_set_assignee_display_names() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id) THEN
    IF NEW.owner_user_id IS NOT NULL THEN
      SELECT full_name INTO NEW.owner_display_name FROM users WHERE id = NEW.owner_user_id;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.closer_user_id IS DISTINCT FROM OLD.closer_user_id) THEN
    IF NEW.closer_user_id IS NOT NULL THEN
      SELECT full_name INTO NEW.closer_display_name FROM users WHERE id = NEW.closer_user_id;
    END IF;
  END IF;

  IF NEW.owner_user_id IS NOT NULL THEN
    NEW.pin_attributed_user_id := COALESCE(NEW.pin_attributed_user_id, NEW.owner_user_id);
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: log_canvass_knock(uuid, uuid, uuid, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_canvass_knock(p_org_id uuid, p_lead_id uuid, p_user_id uuid, p_disposition text, p_source text, p_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id UUID;
  v_now CONSTANT TIMESTAMPTZ := NOW();
  v_effective_created_at TIMESTAMPTZ;
  SAME_VISIT_WINDOW CONSTANT INTERVAL := INTERVAL '30 minutes';
  MAX_FUTURE_SKEW CONSTANT INTERVAL := INTERVAL '5 minutes';
  MAX_PAST_AGE CONSTANT INTERVAL := INTERVAL '30 days';
BEGIN
  v_effective_created_at := COALESCE(p_created_at, v_now);
  IF v_effective_created_at > v_now + MAX_FUTURE_SKEW OR v_effective_created_at < v_now - MAX_PAST_AGE THEN
    v_effective_created_at := v_now;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_lead_id::text));

  -- Scoped to (lead, rep) rather than the lead alone: the case this dedupe exists to
  -- collapse is ONE rep submitting the same visit twice (double-tap, retry, an offline
  -- entry replaying after it already synced). A DIFFERENT rep knocking the same pin is a
  -- real, separate door and must still be recorded — keying on lead_id alone silently
  -- swallowed it and cost that rep the credit.
  IF EXISTS (
    SELECT 1 FROM canvass_knocks
    WHERE lead_id = p_lead_id
      AND user_id = p_user_id
      AND created_at BETWEEN v_effective_created_at - SAME_VISIT_WINDOW
                          AND v_effective_created_at + SAME_VISIT_WINDOW
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO canvass_knocks (org_id, lead_id, user_id, disposition, source, created_at)
  VALUES (p_org_id, p_lead_id, p_user_id, p_disposition, p_source, v_effective_created_at)
  ON CONFLICT (lead_id, user_id, created_at) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


--
-- Name: merge_org_brand_settings(uuid, jsonb, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_org_brand_settings(p_org_id uuid, p_set jsonb, p_remove text[]) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.orgs
     set settings = jsonb_set(
           case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end,
           '{brand}',
           (case when jsonb_typeof(settings -> 'brand') = 'object' then settings -> 'brand' else '{}'::jsonb end
              - coalesce(p_remove, '{}'::text[]))
             || case when jsonb_typeof(p_set) = 'object' then p_set else '{}'::jsonb end,
           true
         )
   where id = p_org_id;
$$;


--
-- Name: merge_org_settings(uuid, text[], jsonb, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_org_settings(p_org_id uuid, p_path text[], p_set jsonb, p_remove text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_path text[] := coalesce(p_path, '{}'::text[]);
  v_set jsonb := case when jsonb_typeof(p_set) = 'object' then p_set else '{}'::jsonb end;
  v_remove text[] := coalesce(p_remove, '{}'::text[]);
begin
  if coalesce(array_length(v_path, 1), 0) > 1 then
    raise exception 'merge_org_settings: path % is deeper than one key', v_path using errcode = '22023';
  end if;

  if coalesce(array_length(v_path, 1), 0) = 0 then
    update public.orgs
       set settings = ((case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end) - v_remove) || v_set
     where id = p_org_id;
  else
    update public.orgs
       set settings = jsonb_set(
             case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end,
             v_path,
             ((case when jsonb_typeof(settings #> v_path) = 'object' then settings #> v_path else '{}'::jsonb end) - v_remove) || v_set,
             true
           )
     where id = p_org_id;
  end if;

  if not found then
    raise exception 'merge_org_settings: no organization %', p_org_id using errcode = 'P0002';
  end if;
end;
$$;


--
-- Name: message_visible_to(uuid, text, boolean, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.message_visible_to(p_viewer uuid, p_audience text, p_restricted boolean, p_org uuid, p_opportunity uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN p_viewer IS NOT NULL AND (p_viewer = auth.uid() OR auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin'))
    THEN arx_private.message_visible_to(p_viewer, p_audience, p_restricted, p_org, p_opportunity)
    ELSE false
  END;
$$;


--
-- Name: my_lead_ids(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_lead_ids(p_user uuid, p_ids uuid[]) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ select i from unnest(p_ids) as i where arx_private.lead_mine(p_user, i); $$;


--
-- Name: my_opportunity_ids(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_opportunity_ids(p_user uuid, p_ids uuid[]) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ select i from unnest(p_ids) as i where arx_private.opp_mine(p_user, i); $$;


--
-- Name: opp_is_mine_self(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.opp_is_mine_self(p_opp uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ select arx_private.opp_mine(auth.uid(), p_opp); $$;


--
-- Name: opportunity_referral_partner_source(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.opportunity_referral_partner_source() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.referral_partner_id IS NOT NULL AND NEW.lead_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.referral_partner_id IS DISTINCT FROM OLD.referral_partner_id) THEN
    UPDATE leads SET source_type = 'partner'
     WHERE id = NEW.lead_id AND source_type IS DISTINCT FROM 'partner';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: org_trades_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.org_trades_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'org_trades.slug and org_id cannot change (deactivate the trade instead)';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


--
-- Name: orgs_seed_trades(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orgs_seed_trades() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.seed_default_org_trades(NEW.id);
  RETURN NEW;
END;
$$;


--
-- Name: payroll_cancel_or_reopen_period(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payroll_cancel_or_reopen_period(p_org_id uuid, p_period_id uuid, p_action text, p_actor_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_period payroll_periods%ROWTYPE;
  v_snapshots integer;
  v_applications integer;
  v_cleared jsonb;
  v_state_cleared integer := 0;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('cancel', 'reopen') THEN
    RAISE EXCEPTION 'payroll_cancel_or_reopen_period: invalid action %', p_action USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Row lock: a lock claim, a final lock flip, or another cancel/reopen waits for us.
  SELECT * INTO v_period FROM payroll_periods
  WHERE id = p_period_id AND org_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- 15 minutes: same window as payroll_claim_period_lock() above and LOCK_CLAIM_STALE_MS
  -- in app/api/admin/payroll/periods/[periodId]/route.ts. Change all three together.
  IF v_period.lock_claimed_at IS NOT NULL AND v_period.lock_claimed_at >= now() - interval '15 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'lock_in_progress');
  END IF;

  SELECT count(*) INTO v_snapshots FROM payroll_job_snapshots WHERE payroll_period_id = p_period_id;
  IF v_snapshots > 0 AND v_period.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'period_has_payout_lines', 'snapshot_count', v_snapshots);
  END IF;

  -- Deleting lines would cascade-delete chargeback applications and leave the
  -- chargeback's remaining_amount wrong. There is no writer for these yet; refuse.
  SELECT count(*) INTO v_applications FROM payroll_chargeback_applications WHERE payroll_period_id = p_period_id;
  IF v_applications > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'period_has_chargeback_applications', 'application_count', v_applications);
  END IF;

  IF v_snapshots > 0 THEN
    -- Only reachable for an OPEN period: rows left by a lock that never finished.
    -- Ids and counts only, NO amounts or payees: payroll_override_audit is readable
    -- org-wide (payroll_override_audit_org_select), so pay must not be copied into it.
    SELECT jsonb_agg(jsonb_build_object(
             'snapshot_id', s.id,
             'job_id', s.job_id,
             'line_ids', (SELECT coalesce(jsonb_agg(l.id), '[]'::jsonb)
                          FROM payroll_payout_lines l WHERE l.payroll_job_snapshot_id = s.id),
             'line_count', (SELECT count(*) FROM payroll_payout_lines l WHERE l.payroll_job_snapshot_id = s.id)))
      INTO v_cleared
    FROM payroll_job_snapshots s
    WHERE s.payroll_period_id = p_period_id;

    UPDATE job_payroll_state
    SET current_payroll_period_id = NULL, payroll_cutoff_at = NULL, scheduled_pay_date = NULL, updated_at = now()
    WHERE current_payroll_period_id = p_period_id
      AND job_id IN (SELECT job_id FROM payroll_job_snapshots WHERE payroll_period_id = p_period_id);
    GET DIAGNOSTICS v_state_cleared = ROW_COUNT;

    DELETE FROM payroll_job_snapshots WHERE payroll_period_id = p_period_id;  -- lines cascade

    -- Reuses the existing payroll audit table. job_id is NULL and after_value has no
    -- role, so the per-job override register never matches this row.
    INSERT INTO payroll_override_audit
      (org_id, override_type, job_id, payroll_period_id, actor_user_id, reason, before_value, after_value)
    VALUES (
      p_org_id, 'manual_adjustment', NULL, p_period_id, p_actor_user_id,
      format('Period %s cleared %s job snapshot(s) left by a lock that never completed', p_action, v_snapshots),
      jsonb_build_object('period_id', p_period_id, 'period_status', v_period.status, 'snapshots', v_cleared),
      jsonb_build_object('action', 'period_' || p_action || '_cleared_partial_lock',
                         'snapshots_deleted', v_snapshots, 'job_payroll_state_cleared', v_state_cleared)
    );
  END IF;

  IF p_action = 'cancel' THEN
    UPDATE payroll_periods
    SET status = 'cancelled', lock_claimed_at = NULL, lock_claim_token = NULL
    WHERE id = p_period_id;
  ELSE
    UPDATE payroll_periods
    SET status = 'open', locked_at = NULL, paid_at = NULL, lock_claimed_at = NULL, lock_claim_token = NULL
    WHERE id = p_period_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'snapshots_deleted', v_snapshots, 'job_payroll_state_cleared', v_state_cleared);
END;
$$;


--
-- Name: payroll_claim_period_lock(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payroll_claim_period_lock(p_org_id uuid, p_period_id uuid, p_token uuid) RETURNS boolean
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  WITH claimed AS (
    UPDATE payroll_periods
    SET lock_claimed_at = now(), lock_claim_token = p_token
    WHERE id = p_period_id
      AND org_id = p_org_id
      AND status = 'open'
      -- 15 minutes: keep in sync with the cancel/reopen check below and with
      -- LOCK_CLAIM_STALE_MS in app/api/admin/payroll/periods/[periodId]/route.ts.
      AND (lock_claimed_at IS NULL OR lock_claimed_at < now() - interval '15 minutes')
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;


--
-- Name: payroll_commit_week(uuid, uuid, uuid, uuid, numeric, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payroll_commit_week(p_org_id uuid, p_period_id uuid, p_token uuid, p_actor_user_id uuid, p_expected_total numeric, p_plan jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_period payroll_periods%ROWTYPE;
  v_next payroll_periods%ROWTYPE;
  v_psnap uuid;
  v_job jsonb;
  v_snap_id uuid;
  v_live record;
  v_n integer;
  v_lines integer := 0;
  v_snapshots integer := 0;
  v_total numeric;
  v_people integer;
  v_carried integer := 0;
  v_negative integer;
  v_date date;
  v_k integer;
  v_tc timestamptz;
  v_cand uuid;
  v_target uuid;
BEGIN
  PERFORM set_config('arx.payroll_commit', 'on', true);

  SELECT * INTO v_period FROM payroll_periods WHERE id = p_period_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payroll_commit:not_found'; END IF;
  IF v_period.status <> 'open' OR v_period.lock_claim_token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'payroll_commit:claim_lost';
  END IF;

  -- Fixes for a paid week land on the next OPEN week: approving a later week first would strand them.
  IF EXISTS (
    SELECT 1 FROM payroll_adjustments a
    JOIN payroll_periods pp ON pp.id = a.payroll_period_id
    WHERE a.org_id = p_org_id AND a.status = 'pending' AND pp.status = 'open' AND pp.id <> p_period_id AND pp.cutoff_at < v_period.cutoff_at
  ) THEN
    RAISE EXCEPTION 'payroll_commit:earlier_week_open';
  END IF;

  IF jsonb_array_length(COALESCE(p_plan->'jobs', '[]'::jsonb)) > 0 THEN
    INSERT INTO payroll_period_snapshots (org_id, payroll_period_id, locked_at, locked_by)
    VALUES (p_org_id, p_period_id, now(), p_actor_user_id)
    ON CONFLICT (payroll_period_id) DO UPDATE SET locked_at = EXCLUDED.locked_at, locked_by = EXCLUDED.locked_by
    RETURNING id INTO v_psnap;
  END IF;

  FOR v_job IN SELECT * FROM jsonb_array_elements(COALESCE(p_plan->'jobs', '[]'::jsonb)) LOOP
    -- The inputs the plan was computed from must still be what is in the database.
    SELECT status, sale_amount, commission_comp_base, payroll_settled_externally_at INTO v_live
    FROM production_jobs WHERE id = (v_job->>'job_id')::uuid AND org_id = p_org_id FOR SHARE;
    IF NOT FOUND
       OR v_live.status NOT IN ('complete', 'collected')
       OR v_live.payroll_settled_externally_at IS NOT NULL
       OR v_live.sale_amount IS DISTINCT FROM NULLIF(v_job->>'sale_amount', '')::numeric
       OR v_live.commission_comp_base IS DISTINCT FROM NULLIF(v_job->>'commission_comp_base', '')::numeric THEN
      RAISE EXCEPTION 'payroll_commit:job_changed:%', v_job->>'job_id';
    END IF;

    INSERT INTO payroll_job_snapshots (
      org_id, payroll_period_snapshot_id, payroll_period_id, job_id, contract_total, signed_change_orders_total,
      commissionable_change_orders_total, dealer_fee, deductible_costs_total, commission_base, comp_plan_version,
      participants, gross_payout_total, net_payout_total, pay_date, payload
    )
    SELECT p_org_id, v_psnap, p_period_id, s.job_id, s.contract_total, s.signed_change_orders_total,
           s.commissionable_change_orders_total, s.dealer_fee, s.deductible_costs_total, s.commission_base, s.comp_plan_version,
           COALESCE(s.participants, '[]'::jsonb), s.gross_payout_total, s.net_payout_total, s.pay_date, s.payload
    FROM jsonb_populate_record(NULL::payroll_job_snapshots, v_job->'snapshot') s
    ON CONFLICT (payroll_period_id, job_id) DO UPDATE SET
      payroll_period_snapshot_id = EXCLUDED.payroll_period_snapshot_id, contract_total = EXCLUDED.contract_total,
      signed_change_orders_total = EXCLUDED.signed_change_orders_total,
      commissionable_change_orders_total = EXCLUDED.commissionable_change_orders_total, dealer_fee = EXCLUDED.dealer_fee,
      deductible_costs_total = EXCLUDED.deductible_costs_total, commission_base = EXCLUDED.commission_base,
      comp_plan_version = EXCLUDED.comp_plan_version, participants = EXCLUDED.participants,
      gross_payout_total = EXCLUDED.gross_payout_total, net_payout_total = EXCLUDED.net_payout_total,
      pay_date = EXCLUDED.pay_date, payload = EXCLUDED.payload
    RETURNING id INTO v_snap_id;
    v_snapshots := v_snapshots + 1;

    INSERT INTO payroll_payout_lines (
      org_id, payroll_period_id, payroll_job_snapshot_id, job_id, user_id, participant_role, gross_amount, net_amount,
      chargeback_applied_amount, comp_plan_snapshot
    )
    SELECT p_org_id, p_period_id, v_snap_id, l.job_id, l.user_id, l.participant_role, COALESCE(l.gross_amount, 0),
           COALESCE(l.net_amount, 0), COALESCE(l.chargeback_applied_amount, 0), l.comp_plan_snapshot
    FROM jsonb_populate_recordset(NULL::payroll_payout_lines, COALESCE(v_job->'lines', '[]'::jsonb)) l
    WHERE NOT EXISTS (
      SELECT 1 FROM payroll_payout_lines e
      WHERE e.payroll_period_id = p_period_id AND e.job_id = l.job_id AND e.user_id = l.user_id AND e.participant_role = l.participant_role
    );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_lines := v_lines + v_n;

    INSERT INTO job_payroll_state (
      job_id, org_id, install_completed_at, fully_funded_at, costs_ready_at, payroll_eligible_at, payroll_cutoff_at,
      scheduled_pay_date, current_payroll_period_id, updated_at
    )
    SELECT st.job_id, p_org_id, st.install_completed_at, st.fully_funded_at, st.costs_ready_at, st.payroll_eligible_at,
           st.payroll_cutoff_at, st.scheduled_pay_date, p_period_id, now()
    FROM jsonb_populate_record(NULL::job_payroll_state, v_job->'state') st
    ON CONFLICT (job_id) DO UPDATE SET
      install_completed_at = EXCLUDED.install_completed_at, fully_funded_at = EXCLUDED.fully_funded_at,
      costs_ready_at = EXCLUDED.costs_ready_at, payroll_eligible_at = EXCLUDED.payroll_eligible_at,
      payroll_cutoff_at = EXCLUDED.payroll_cutoff_at, scheduled_pay_date = EXCLUDED.scheduled_pay_date,
      current_payroll_period_id = EXCLUDED.current_payroll_period_id, updated_at = EXCLUDED.updated_at;
  END LOOP;

  -- Freeze per-unit pay (replace, so a re-approved reopened week never keeps a stale person).
  DELETE FROM payroll_unit_earnings WHERE org_id = p_org_id AND payroll_period_id = p_period_id;
  INSERT INTO payroll_unit_earnings (org_id, payroll_period_id, user_id, amount, detail)
  SELECT p_org_id, p_period_id, (u->>'user_id')::uuid, round((u->>'amount')::numeric, 2), u->'detail'
  FROM jsonb_array_elements(COALESCE(p_plan->'units', '[]'::jsonb)) u
  WHERE (u->>'amount')::numeric > 0;

  -- What the tables now say must equal what the admin approved, to the cent.
  SELECT COALESCE(sum(GREATEST(0, raw)), 0), count(*) FILTER (WHERE raw > 0), count(*) FILTER (WHERE raw < 0)
    INTO v_total, v_people, v_negative
  FROM payroll_week_person_totals(p_org_id, p_period_id);
  IF round(v_total, 2) <> round(p_expected_total, 2) THEN
    RAISE EXCEPTION 'payroll_commit:total_mismatch:%:%', round(v_total, 2), round(p_expected_total, 2);
  END IF;

  -- A check cannot go below $0: what is owed back is carried into the next OPEN week, once per person per source week.
  -- The target is found (or created) HERE, locked, and verified in this same transaction — never trusted from the caller.
  IF v_negative > 0 THEN
    v_date := (v_period.cutoff_at AT TIME ZONE 'America/New_York')::date;
    v_target := NULL;
    FOR v_k IN 1..8 LOOP
      -- Eastern calendar weeks rebuilt with the timezone database (never fixed 24 h days).
      v_tc := ((v_date + 7 * v_k) + time '23:59:59.999') AT TIME ZONE 'America/New_York';
      SELECT id INTO v_cand FROM payroll_periods
        WHERE org_id = p_org_id AND status <> 'cancelled' AND cutoff_at BETWEEN v_tc - interval '36 hours' AND v_tc + interval '36 hours'
        ORDER BY created_at, id LIMIT 1;
      IF v_cand IS NULL THEN
        INSERT INTO payroll_periods (org_id, period_label, cutoff_at, lock_at, scheduled_pay_date, status)
        VALUES (p_org_id, 'Week ending ' || to_char(v_date + 7 * v_k, 'YYYY-MM-DD'), v_tc, v_tc, (v_date + 7 * v_k + 2), 'open')
        ON CONFLICT DO NOTHING;
        SELECT id INTO v_cand FROM payroll_periods
          WHERE org_id = p_org_id AND status <> 'cancelled' AND cutoff_at BETWEEN v_tc - interval '36 hours' AND v_tc + interval '36 hours'
          ORDER BY created_at, id LIMIT 1;
      END IF;
      CONTINUE WHEN v_cand IS NULL;
      SELECT * INTO v_next FROM payroll_periods WHERE id = v_cand AND org_id = p_org_id FOR UPDATE;
      CONTINUE WHEN NOT FOUND;
      IF v_next.status = 'open' THEN
        IF v_next.lock_claim_token IS NOT NULL AND v_next.lock_claimed_at IS NOT NULL AND v_next.lock_claimed_at > now() - interval '15 minutes' THEN
          RAISE EXCEPTION 'payroll_commit:next_week_busy';
        END IF;
        v_target := v_next.id;
        EXIT;
      END IF;
    END LOOP;
    IF v_target IS NULL THEN RAISE EXCEPTION 'payroll_commit:no_next_period'; END IF;
    INSERT INTO payroll_adjustments (org_id, payroll_period_id, user_id, amount, reason, kind, status, source_period_id, created_by)
    SELECT p_org_id, v_target, t.user_id, t.raw,
           'Carried over from the week ending ' || to_char(v_date, 'YYYY-MM-DD'),
           'balance', 'pending', p_period_id, p_actor_user_id
    FROM payroll_week_person_totals(p_org_id, p_period_id) t
    WHERE t.raw < 0
    ON CONFLICT (source_period_id, user_id) WHERE kind = 'balance' AND status <> 'void' DO NOTHING;
    GET DIAGNOSTICS v_carried = ROW_COUNT;
  END IF;

  -- The week's fixes are now part of an approved check.
  UPDATE payroll_adjustments SET status = 'applied', applied_at = now()
  WHERE org_id = p_org_id AND payroll_period_id = p_period_id AND status = 'pending';

  UPDATE payroll_periods
  SET status = 'locked', locked_at = now(), units_frozen_at = now(), lock_claimed_at = NULL, lock_claim_token = NULL
  WHERE id = p_period_id AND org_id = p_org_id;

  RETURN jsonb_build_object('ok', true, 'total', round(v_total, 2), 'people', v_people, 'snapshots', v_snapshots, 'lines', v_lines, 'carried', v_carried);
END;
$_$;


--
-- Name: payroll_discard_lineless_job_snapshot(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payroll_discard_lineless_job_snapshot(p_org_id uuid, p_snapshot_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_job uuid;
  v_deleted integer;
BEGIN
  SELECT job_id INTO v_job FROM payroll_job_snapshots WHERE id = p_snapshot_id AND org_id = p_org_id;
  IF v_job IS NULL THEN
    RETURN false;
  END IF;
  -- Same lock the line-insert trigger takes: an in-flight line insert for this job
  -- commits first, and the DELETE below (a new statement) then sees its lines.
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll_job:' || v_job::text, 0));
  DELETE FROM payroll_job_snapshots s
  WHERE s.id = p_snapshot_id
    AND s.org_id = p_org_id
    AND NOT EXISTS (SELECT 1 FROM payroll_payout_lines l WHERE l.payroll_job_snapshot_id = s.id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;


--
-- Name: payroll_guard_claimed_period(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payroll_guard_claimed_period() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_period uuid;
  v_status text;
  v_live boolean;
  v_is_bonus boolean := (TG_TABLE_NAME = 'payroll_bonus_lines');
  v_old_p uuid;
  v_new_p uuid;
  v_old_money boolean := false;   -- the row counted toward a check before this write (approved / paid bonus)
  v_new_money boolean := false;   -- ... and after it
  v_paid_only boolean := false;   -- an approved bonus being marked paid, nothing else changed
BEGIN
  -- payroll_commit_week writes under the claim it holds.
  IF current_setting('arx.payroll_commit', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old_p := OLD.payroll_period_id; END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_p := NEW.payroll_period_id; END IF;
  IF v_is_bonus THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old_money := OLD.status::text IN ('approved', 'paid'); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_money := NEW.status::text IN ('approved', 'paid'); END IF;
    IF TG_OP = 'UPDATE' THEN
      v_paid_only := OLD.status::text = 'approved' AND NEW.status::text = 'paid' AND OLD.amount = NEW.amount AND OLD.user_id = NEW.user_id;
    END IF;
  END IF;

  FOR v_period IN SELECT DISTINCT x FROM unnest(ARRAY[v_old_p, v_new_p]) AS x WHERE x IS NOT NULL LOOP
    -- FOR SHARE: a claim / commit (an UPDATE of this row) waits for a writer already in flight, and a writer that waited for a
    -- claim re-reads the COMMITTED row (now 'locked') here.
    SELECT status, (lock_claim_token IS NOT NULL AND lock_claimed_at IS NOT NULL AND lock_claimed_at > now() - interval '15 minutes')
      INTO v_status, v_live FROM payroll_periods WHERE id = v_period FOR SHARE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF COALESCE(v_live, false) THEN
      RAISE EXCEPTION 'payroll_period_claimed: this week is being approved right now; try again in a minute' USING ERRCODE = '55006';
    END IF;
    IF v_status <> 'open' THEN
      -- Only writes that cannot change what a check is made of may touch a closed week (bonuses only).
      IF v_is_bonus AND (
           (v_period = v_old_p AND v_period = v_new_p
              AND ((NOT v_old_money AND NOT v_new_money)
                   OR v_paid_only))
        OR (v_period = v_old_p AND v_period IS DISTINCT FROM v_new_p AND NOT v_old_money)    -- a pending line moved out onto an open week
        OR (v_period = v_new_p AND v_period IS DISTINCT FROM v_old_p AND NOT v_new_money)    -- a pending/rejected line landing on a closed week
      ) THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'payroll_period_not_open: this week is already approved; its hours, bonuses and fixes can no longer change' USING ERRCODE = '55006';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: payroll_guard_frozen_period_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payroll_guard_frozen_period_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF current_setting('arx.payroll_commit', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.status IN ('locked', 'paid') AND NEW.status IN ('open', 'cancelled') AND (
       OLD.units_frozen_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM payroll_adjustments a WHERE a.payroll_period_id = OLD.id AND a.status = 'applied')
    OR EXISTS (SELECT 1 FROM payroll_adjustments c WHERE c.source_period_id = OLD.id AND c.kind = 'balance' AND c.status <> 'void')
  ) THEN
    RAISE EXCEPTION 'payroll_period_frozen: an approved week with frozen pay, applied fixes or carried balances cannot be reopened or cancelled; correct it with a fix on the next open week' USING ERRCODE = '55006';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: payroll_guard_job_snapshot_single_period(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payroll_guard_job_snapshot_single_period() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_other_period uuid;
  v_status text;
BEGIN
  -- Serialize every payroll write for this job until the writing transaction ends.
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll_job:' || NEW.job_id::text, 0));

  -- This period already has this job's snapshot: the write is a retry/upsert that
  -- ON CONFLICT turns into an update, not new pay. Let it through (this also keeps
  -- retries working on the pre-existing multi-period duplicates).
  IF EXISTS (
    SELECT 1 FROM payroll_job_snapshots s
    WHERE s.payroll_period_id = NEW.payroll_period_id AND s.job_id = NEW.job_id
  ) THEN
    RETURN NEW;
  END IF;

  -- New pay only lands in an open period. FOR SHARE holds the status steady until
  -- this write commits (a concurrent cancel/lock flip waits for it).
  SELECT p.status INTO v_status FROM payroll_periods p WHERE p.id = NEW.payroll_period_id FOR SHARE;
  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'payroll_period_not_open: payroll period % is %', NEW.payroll_period_id, coalesce(v_status, 'missing')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.payroll_period_id INTO v_other_period
  FROM payroll_job_snapshots s
  WHERE s.job_id = NEW.job_id
    AND s.payroll_period_id <> NEW.payroll_period_id
  LIMIT 1;

  IF v_other_period IS NOT NULL THEN
    RAISE EXCEPTION 'payroll_already_paid: job % is already snapshotted in payroll period %',
      NEW.job_id, v_other_period
      USING ERRCODE = 'unique_violation',
            HINT = 'A job can only be paid in one payroll period. Use an adjustment instead.';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: payroll_guard_payout_line_single_period(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payroll_guard_payout_line_single_period() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_other_period uuid;
  v_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll_job:' || NEW.job_id::text, 0));

  -- Same key already in this period: the per-period unique index (or ON CONFLICT)
  -- decides; it can never become a second payment.
  IF EXISTS (
    SELECT 1 FROM payroll_payout_lines l
    WHERE l.payroll_period_id = NEW.payroll_period_id
      AND l.job_id = NEW.job_id
      AND l.user_id = NEW.user_id
      AND l.participant_role = NEW.participant_role
  ) THEN
    RETURN NEW;
  END IF;

  SELECT p.status INTO v_status FROM payroll_periods p WHERE p.id = NEW.payroll_period_id FOR SHARE;
  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'payroll_period_not_open: payroll period % is %', NEW.payroll_period_id, coalesce(v_status, 'missing')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT l.payroll_period_id INTO v_other_period
  FROM payroll_payout_lines l
  WHERE l.job_id = NEW.job_id
    AND l.user_id = NEW.user_id
    AND l.participant_role = NEW.participant_role
    AND l.payroll_period_id <> NEW.payroll_period_id
  LIMIT 1;

  IF v_other_period IS NOT NULL THEN
    RAISE EXCEPTION 'payroll_already_paid: job % / user % / role % already has a payout line in payroll period %',
      NEW.job_id, NEW.user_id, NEW.participant_role, v_other_period
      USING ERRCODE = 'unique_violation',
            HINT = 'A job/rep/role can only be paid in one payroll period. Use an adjustment instead.';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: payroll_week_person_totals(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payroll_week_person_totals(p_org_id uuid, p_period_id uuid) RETURNS TABLE(user_id uuid, raw numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT x.user_id, round(sum(x.amt), 2) AS raw FROM (
    SELECT l.user_id, round(l.net_amount, 2) AS amt FROM payroll_payout_lines l WHERE l.org_id = p_org_id AND l.payroll_period_id = p_period_id
    UNION ALL
    SELECT h.user_id, round(h.hourly_earnings, 2) FROM payroll_rep_hours h WHERE h.org_id = p_org_id AND h.payroll_period_id = p_period_id AND COALESCE(h.hourly_earnings, 0) > 0
    UNION ALL
    SELECT u.user_id, round(u.amount, 2) FROM payroll_unit_earnings u WHERE u.org_id = p_org_id AND u.payroll_period_id = p_period_id AND u.amount > 0
    UNION ALL
    SELECT b.user_id, round(b.amount, 2) FROM payroll_bonus_lines b WHERE b.org_id = p_org_id AND b.payroll_period_id = p_period_id AND b.status IN ('approved', 'paid')
    UNION ALL
    SELECT a.user_id, round(a.amount, 2) FROM payroll_adjustments a WHERE a.org_id = p_org_id AND a.payroll_period_id = p_period_id AND a.status <> 'void'
  ) x GROUP BY x.user_id;
$$;


--
-- Name: pitch_to_degrees(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pitch_to_degrees(rise integer, run integer DEFAULT 12) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  RETURN ROUND(DEGREES(ATAN(rise::NUMERIC / run::NUMERIC)), 2);
END;
$$;


--
-- Name: preserve_user_name_on_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preserve_user_name_on_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  user_name TEXT;
BEGIN
  user_name := OLD.full_name;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_appointments') THEN
    UPDATE scheduled_appointments
    SET deleted_user_name = user_name
    WHERE closer_user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activities') THEN
    UPDATE activities
    SET deleted_user_name = user_name
    WHERE user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'commissions') THEN
    UPDATE commissions
    SET deleted_user_name = user_name
    WHERE user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inspection_status_updates') THEN
    UPDATE inspection_status_updates
    SET deleted_user_name = user_name
    WHERE closer_user_id = OLD.id AND deleted_user_name IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') THEN
    UPDATE leads
    SET owner_display_name = COALESCE(owner_display_name, user_name)
    WHERE owner_user_id = OLD.id;

    UPDATE leads
    SET closer_display_name = COALESCE(closer_display_name, user_name)
    WHERE closer_user_id = OLD.id;

    UPDATE leads
    SET pin_attributed_user_id = COALESCE(pin_attributed_user_id, owner_user_id)
    WHERE owner_user_id = OLD.id;
  END IF;

  RETURN OLD;
END;
$$;


--
-- Name: prevent_documents_hard_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_documents_hard_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Hard delete is not allowed on documents; use archive/soft-delete fields';
END;
$$;


--
-- Name: prevent_employee_agreement_content_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_employee_agreement_content_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.agreement_key IS DISTINCT FROM OLD.agreement_key
    OR NEW.agreement_version IS DISTINCT FROM OLD.agreement_version
    OR NEW.agreement_snapshot IS DISTINCT FROM OLD.agreement_snapshot
    OR NEW.agreement_content_hash IS DISTINCT FROM OLD.agreement_content_hash
    OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
    OR NEW.manager_user_id IS DISTINCT FROM OLD.manager_user_id
    OR NEW.manager_signed_name IS DISTINCT FROM OLD.manager_signed_name
    OR NEW.manager_signed_email IS DISTINCT FROM OLD.manager_signed_email
    OR NEW.manager_signed_at IS DISTINCT FROM OLD.manager_signed_at
    OR NEW.manager_signed_ip IS DISTINCT FROM OLD.manager_signed_ip
    OR NEW.manager_signed_user_agent IS DISTINCT FROM OLD.manager_signed_user_agent
  THEN RAISE EXCEPTION 'Signed agreement content and manager signature are immutable';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: prevent_employee_agreement_event_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_employee_agreement_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'Employee agreement audit events are append-only'; END; $$;


--
-- Name: prevent_overlapping_scheduled_appointments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_overlapping_scheduled_appointments() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  new_start TIMESTAMPTZ;
  new_end TIMESTAMPTZ;
  conflict_exists BOOLEAN;
  rapid_duplicate_exists BOOLEAN;
  conflict_gap_required INT;
  -- Adjuster meetings resolve to ADJUSTER_MEETING_SCHEDULING_POLICY (rejectOnConflict:
  -- false) in lib/adjuster-meeting.ts — inside sales books them around an adjuster's
  -- availability, not the rep's, and gets a soft conflict_warning instead of a failure.
  -- They already set closer_user_id, so they already reach this trigger; padding their
  -- neighbours would start REJECTING meetings that migration 077 accepted. Buffers are
  -- therefore skipped when the adjuster meeting is the row BEING WRITTEN, so a meeting
  -- itself is never blocked by a neighbour's buffer.
  --
  -- Note this exemption is one-directional: apply_buffers is derived from NEW only, so a
  -- normal appointment written next to an EXISTING adjuster meeting still pads both sides
  -- and can now be rejected where 077 accepted it. That is intended (the rep cannot be in
  -- two places, and the app-layer check blocks it too), and is inert today because the
  -- adjuster-meeting insert path never sets buffer_after_minutes.
  apply_buffers BOOLEAN;
BEGIN
  IF NEW.status NOT IN ('scheduled', 'confirmed') THEN
    RETURN NEW;
  END IF;

  apply_buffers := COALESCE(NEW.appointment_type, '') <> 'adjuster_meeting';

  -- Short server-side throttle for rapid duplicate submits.
  -- Applies only to INSERT and only when lead_id is present.
  IF TG_OP = 'INSERT' AND NEW.lead_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM scheduled_appointments sa
      WHERE sa.lead_id = NEW.lead_id
        AND sa.scheduled_for = NEW.scheduled_for
        AND sa.status IN ('scheduled', 'confirmed')
        AND sa.created_at >= (NOW() - INTERVAL '3 seconds')
    )
    INTO rapid_duplicate_exists;

    IF rapid_duplicate_exists THEN
      RAISE EXCEPTION
        'Rapid duplicate submit blocked: matching appointment was just created'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  new_start := NEW.scheduled_for;
  new_end := NEW.scheduled_for
    + make_interval(mins => COALESCE(NEW.duration_minutes, 60))
    + make_interval(mins => CASE WHEN apply_buffers THEN COALESCE(NEW.buffer_after_minutes, 0) ELSE 0 END);

  SELECT
    TRUE,
    -- The gap is owed by whichever appointment comes first.
    CASE
      WHEN new_start >= sa.scheduled_for + make_interval(mins => COALESCE(sa.duration_minutes, 60))
        THEN COALESCE(sa.buffer_after_minutes, 0)
      ELSE COALESCE(NEW.buffer_after_minutes, 0)
    END
  INTO conflict_exists, conflict_gap_required
  FROM scheduled_appointments sa
  WHERE sa.closer_user_id = NEW.closer_user_id
    AND sa.id <> NEW.id
    AND sa.status IN ('scheduled', 'confirmed')
    AND tstzrange(
      sa.scheduled_for,
      sa.scheduled_for
        + make_interval(mins => COALESCE(sa.duration_minutes, 60))
        + make_interval(mins => CASE WHEN apply_buffers THEN COALESCE(sa.buffer_after_minutes, 0) ELSE 0 END),
      '[)'
    ) && tstzrange(new_start, new_end, '[)')
  LIMIT 1;

  -- Wording keeps the 'Scheduling conflict' / 'overlapping appointment' substrings that
  -- app/api/appointments/[id] and app/api/canvass/lead match on to return a 409.
  IF COALESCE(conflict_exists, FALSE) THEN
    IF COALESCE(conflict_gap_required, 0) > 0 THEN
      RAISE EXCEPTION
        'Scheduling conflict: closer already has an appointment within the required % minute gap',
        conflict_gap_required
        USING ERRCODE = '23P01';
    ELSE
      RAISE EXCEPTION
        'Scheduling conflict: closer already has an overlapping appointment'
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: production_job_partner_owner_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.production_job_partner_owner_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  BEGIN
    PERFORM write_partner_owner_role(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'write_partner_owner_role failed for job %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;


--
-- Name: production_jobs_job_type_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.production_jobs_job_type_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.job_type IS NULL
     OR NEW.job_type IN ('mixed', 'roofing', 'siding', 'windows', 'gutters')
     OR EXISTS (SELECT 1 FROM public.org_trades t WHERE t.org_id = NEW.org_id AND t.slug = NEW.job_type) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'production_jobs.job_type % is not a trade of this company', NEW.job_type
    USING ERRCODE = '23514';
END;
$$;


--
-- Name: project_is_mine_self(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.project_is_mine_self(p_project uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ select arx_private.project_mine(auth.uid(), p_project); $$;


--
-- Name: proposal_is_mine_self(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proposal_is_mine_self(p uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ select arx_private.proposal_mine(auth.uid(), p); $$;


--
-- Name: protect_audit_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_audit_log() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'The audit log is immutable and cannot be modified.';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: protect_management_overlay_assignment_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_management_overlay_assignment_history() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'management overlay assignments cannot be deleted';
  END IF;

  IF NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.comp_plan_id IS DISTINCT FROM OLD.comp_plan_id
    OR NEW.replaced_assignment_id IS DISTINCT FROM OLD.replaced_assignment_id
    OR NEW.lane IS DISTINCT FROM OLD.lane
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.change_reason IS DISTINCT FROM OLD.change_reason THEN
    RAISE EXCEPTION 'management overlay assignment identity and audit history are immutable';
  END IF;

  IF OLD.cancelled_at IS NULL
    AND NEW.cancelled_at IS NOT NULL
    AND NEW.cancelled_by_user_id IS NOT NULL
    AND length(btrim(COALESCE(NEW.cancellation_reason, ''))) > 0
    AND OLD.effective_from > v_today
    AND NEW.effective_to IS NOT DISTINCT FROM OLD.effective_to
    AND NEW.ended_at IS NOT DISTINCT FROM OLD.ended_at
    AND NEW.ended_by_user_id IS NOT DISTINCT FROM OLD.ended_by_user_id
    AND NEW.end_reason IS NOT DISTINCT FROM OLD.end_reason THEN
    RETURN NEW;
  END IF;

  IF NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
    AND NEW.cancelled_by_user_id IS NOT DISTINCT FROM OLD.cancelled_by_user_id
    AND NEW.cancellation_reason IS NOT DISTINCT FROM OLD.cancellation_reason
    AND OLD.ended_at IS NULL
    AND NEW.ended_at IS NOT NULL
    AND NEW.ended_by_user_id IS NOT NULL
    AND length(btrim(COALESCE(NEW.end_reason, ''))) > 0
    AND NEW.effective_to IS NOT NULL
    AND NEW.effective_to >= GREATEST(OLD.effective_from, v_today)
    AND (OLD.effective_to IS NULL OR NEW.effective_to <= OLD.effective_to) THEN
    RETURN NEW;
  END IF;

  -- Cancelling a future replacement reopens only the exact predecessor that the
  -- cancelled row had scheduled to end. The cancellation row retains the actor,
  -- time, and reason for this restoration.
  IF OLD.ended_at IS NOT NULL
    AND OLD.effective_to IS NOT NULL
    AND OLD.effective_to >= v_today
    AND NEW.effective_to IS NULL
    AND NEW.ended_at IS NULL
    AND NEW.ended_by_user_id IS NULL
    AND NEW.end_reason IS NULL
    AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
    AND NEW.cancelled_by_user_id IS NOT DISTINCT FROM OLD.cancelled_by_user_id
    AND NEW.cancellation_reason IS NOT DISTINCT FROM OLD.cancellation_reason
    AND EXISTS (
      SELECT 1
      FROM user_management_comp_overlay_assignments cancelled_child
      WHERE cancelled_child.org_id = OLD.org_id
        AND cancelled_child.user_id = OLD.user_id
        AND cancelled_child.lane = OLD.lane
        AND cancelled_child.replaced_assignment_id = OLD.id
        AND cancelled_child.effective_from = OLD.effective_to + 1
        AND cancelled_child.cancelled_at IS NOT NULL
        AND cancelled_child.cancelled_by_user_id IS NOT NULL
        AND length(btrim(COALESCE(cancelled_child.cancellation_reason, ''))) > 0
    ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'management overlay assignments may only be cancelled or end-dated through audited payroll operations';
END;
$$;


--
-- Name: record_org_derived_commission_rates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_org_derived_commission_rates() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF current_setting('app.skip_org_derived_rate_trigger', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.inspection_commission_rate IS DISTINCT FROM OLD.inspection_commission_rate
    OR NEW.manager_override_commission_rate IS DISTINCT FROM OLD.manager_override_commission_rate
    OR NEW.self_gen_commission_rate IS DISTINCT FROM OLD.self_gen_commission_rate THEN
    INSERT INTO org_derived_commission_rates (
      org_id,
      inspection_commission_rate,
      manager_override_commission_rate,
      self_gen_commission_rate,
      effective_from
    ) VALUES (
      NEW.id,
      COALESCE(NEW.inspection_commission_rate, 0),
      NEW.manager_override_commission_rate,
      NEW.self_gen_commission_rate,
      (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date + 1
    )
    ON CONFLICT (org_id, effective_from) DO UPDATE SET
      inspection_commission_rate = EXCLUDED.inspection_commission_rate,
      manager_override_commission_rate = EXCLUDED.manager_override_commission_rate,
      self_gen_commission_rate = EXCLUDED.self_gen_commission_rate,
      created_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: record_user_manager_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_user_manager_assignment() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.manager_user_id IS DISTINCT FROM OLD.manager_user_id THEN
    DELETE FROM user_manager_assignments
    WHERE user_id = NEW.id
      AND effective_from = (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date + 1;

    UPDATE user_manager_assignments
    SET effective_to = (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date
    WHERE user_id = NEW.id
      AND effective_to IS NULL
      AND effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;

    IF NEW.manager_user_id IS NOT NULL AND NEW.manager_user_id <> NEW.id THEN
      INSERT INTO user_manager_assignments (
        org_id, user_id, manager_user_id, effective_from
      ) VALUES (
        NEW.org_id, NEW.id, NEW.manager_user_id,
        (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date + 1
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: record_user_payroll_active_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_user_payroll_active_history() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  today_et DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO user_payroll_active_history (
      org_id, user_id, is_active, effective_from
    ) VALUES (
      NEW.org_id,
      NEW.id,
      NEW.active,
      today_et + 1
    )
    ON CONFLICT (user_id, effective_from) DO UPDATE SET
      is_active = EXCLUDED.is_active,
      created_at = NOW();

    IF NEW.active IS FALSE THEN
      UPDATE user_comp_plans
         SET effective_to = today_et
       WHERE user_id = NEW.id
         AND org_id = NEW.org_id
         AND effective_from <= today_et
         AND (effective_to IS NULL OR effective_to > today_et);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: referral_partner_log_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referral_partner_log_assignment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor UUID := NULLIF(current_setting('app.partner_actor', TRUE), '')::UUID;
  v_reason TEXT := NULLIF(current_setting('app.partner_reason', TRUE), '');
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO referral_partner_assignment_log
      (org_id, partner_id, from_user_id, to_user_id, from_status, to_status, changed_by, reason)
    VALUES (
      NEW.org_id, NEW.id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.assigned_user_id END,
      NEW.assigned_user_id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
      NEW.status,
      CASE WHEN TG_OP = 'INSERT' THEN COALESCE(v_actor, NEW.created_by) ELSE v_actor END,
      COALESCE(v_reason, CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'unspecified' END)
    );
  END IF;
  RETURN NEW;
END $$;


--
-- Name: referral_partner_normalize_phone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referral_partner_normalize_phone(p_phone text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT CASE
    WHEN d = '' OR length(d) > 15 THEN NULL
    WHEN length(d) = 11 AND left(d, 1) = '1' THEN substr(d, 2)
    ELSE d
  END
  FROM (SELECT regexp_replace(
          regexp_replace(coalesce(p_phone, ''), '\s*(x|ext\.?|extension)\s*\d+\s*$', '', 'i'),
          '\D', '', 'g') AS d) s
$_$;


--
-- Name: referral_partner_owner_as_of(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referral_partner_owner_as_of(p_partner uuid, p_at timestamp with time zone) RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT l.to_user_id FROM referral_partner_assignment_log l
  WHERE l.partner_id = p_partner AND l.created_at <= p_at
  ORDER BY l.created_at DESC, l.seq DESC LIMIT 1
$$;


--
-- Name: referral_partner_set_assignment(uuid, uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referral_partner_set_assignment(p_partner uuid, p_to_user uuid, p_status text, p_reason text, p_actor uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_rows INTEGER;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required';
  END IF;
  PERFORM set_config('app.partner_actor', COALESCE(p_actor::TEXT, ''), TRUE);
  PERFORM set_config('app.partner_reason', p_reason, TRUE);
  UPDATE referral_partners
     SET assigned_user_id = CASE WHEN p_status = 'assigned' THEN p_to_user END,
         status = p_status
   WHERE id = p_partner;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;


--
-- Name: referral_partner_touch_from_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referral_partner_touch_from_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.referral_partner_id IS NOT NULL AND NEW.type IN ('call', 'text', 'email', 'visit') THEN
    UPDATE referral_partners
       SET last_touched_at = GREATEST(last_touched_at, NEW.created_at), expiry_warned_at = NULL
     WHERE id = NEW.referral_partner_id;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: referral_partners_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referral_partners_before_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.phone_digits := referral_partner_normalize_phone(NEW.phone);
  IF NEW.status = 'assigned' THEN
    IF TG_OP = 'INSERT' OR NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id
       OR OLD.status IS DISTINCT FROM 'assigned' THEN
      NEW.assigned_at := NOW();
      -- A newly assigned rep gets a fresh inactivity window.
      NEW.last_touched_at := NOW();
      NEW.expiry_warned_at := NULL;
    END IF;
  ELSE
    NEW.assigned_at := NULL;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;


--
-- Name: referral_partners_release_for_deleted_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referral_partners_release_for_deleted_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM set_config('app.partner_actor', '', TRUE);
  PERFORM set_config('app.partner_reason', 'rep removed', TRUE);
  UPDATE referral_partners SET status = 'open', assigned_user_id = NULL
   WHERE assigned_user_id = OLD.id;
  RETURN OLD;
END $$;


--
-- Name: referral_partners_run_expiry(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referral_partners_run_expiry(p_now timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_released INTEGER := 0; v_warned INTEGER := 0; r RECORD;
BEGIN
  PERFORM set_config('app.partner_actor', '', TRUE);
  PERFORM set_config('app.partner_reason', 'inactivity', TRUE);

  -- A deactivated rep can't work a partner, so it opens now rather than after the window.
  PERFORM set_config('app.partner_reason', 'rep deactivated', TRUE);
  UPDATE referral_partners p SET status = 'open', assigned_user_id = NULL
    FROM users u
   WHERE u.id = p.assigned_user_id AND p.status = 'assigned' AND u.active IS NOT TRUE;
  PERFORM set_config('app.partner_reason', 'inactivity', TRUE);

  FOR r IN
    SELECT p.id, p.org_id, p.name, p.assigned_user_id
      FROM referral_partners p JOIN referral_partner_types t ON t.id = p.type_id
     WHERE p.status = 'assigned'
       AND p.last_touched_at + make_interval(days => t.inactivity_days) <= p_now
     FOR UPDATE OF p
  LOOP
    UPDATE referral_partners SET status = 'open', assigned_user_id = NULL WHERE id = r.id;
    INSERT INTO notifications (org_id, recipient_user_id, type, title, body, link_url)
    VALUES (r.org_id, r.assigned_user_id, 'referral_partner_released',
            r.name || ' is now open',
            'No touch was logged in time, so this partner is no longer Assigned To you.',
            '/referral-partners/' || r.id);
    v_released := v_released + 1;
  END LOOP;

  FOR r IN
    SELECT p.id, p.org_id, p.name, p.assigned_user_id,
           (p.last_touched_at + make_interval(days => t.inactivity_days) - p_now) AS remaining
      FROM referral_partners p JOIN referral_partner_types t ON t.id = p.type_id
     WHERE p.status = 'assigned' AND p.expiry_warned_at IS NULL
       AND p.last_touched_at + make_interval(days => t.inactivity_days) - p_now <= INTERVAL '7 days'
     FOR UPDATE OF p
  LOOP
    UPDATE referral_partners SET expiry_warned_at = p_now WHERE id = r.id;
    INSERT INTO notifications (org_id, recipient_user_id, type, title, body, link_url)
    VALUES (r.org_id, r.assigned_user_id, 'referral_partner_expiring',
            r.name || ' opens up in ' || GREATEST(1, CEIL(EXTRACT(EPOCH FROM r.remaining) / 86400))::INT || ' days',
            'Log a touch to keep this partner Assigned To you.',
            '/referral-partners/' || r.id || '?touch=1');
    v_warned := v_warned + 1;
  END LOOP;

  RETURN jsonb_build_object('released', v_released, 'warned', v_warned);
END $$;


--
-- Name: referrals_apply_link_side_effects(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referrals_apply_link_side_effects() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_customer_id UUID;
  v_org_id UUID;
  v_link_added BOOLEAN;
BEGIN
  IF NEW.referred_opportunity_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.referred_opportunity_id IS DISTINCT FROM OLD.referred_opportunity_id)
  THEN
    SELECT o.customer_id, o.org_id
      INTO v_customer_id, v_org_id
      FROM opportunities o
     WHERE o.id = NEW.referred_opportunity_id;

    -- A missing row is not an org violation: the FK rejects a bogus id with a clearer
    -- message than anything raised here, so only a real cross-org link is refused.
    IF FOUND AND v_org_id IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION
        'Cannot link opportunity % to a referral in a different org', NEW.referred_opportunity_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF FOUND THEN
      IF NEW.referred_customer_id IS NULL THEN
        NEW.referred_customer_id := v_customer_id;
      END IF;

      -- referred_lead_id stays underived: deleteCanvassLeadWithDependencies hard-deletes
      -- referrals by that column, so deriving it would let a deleted canvass pin take an
      -- unrelated referral's bonus record with it.

      IF NEW.referred_project_id IS NULL THEN
        SELECT p.id
          INTO NEW.referred_project_id
          FROM projects p
         WHERE p.opportunity_id = NEW.referred_opportunity_id
         ORDER BY p.created_at DESC
         LIMIT 1;
      END IF;
    END IF;
  END IF;

  -- Only advance on a link that was just added, so a manual status stays put.
  v_link_added := (
    TG_OP = 'INSERT' AND (
      NEW.referred_opportunity_id IS NOT NULL OR
      NEW.referred_lead_id IS NOT NULL OR
      NEW.referred_customer_id IS NOT NULL OR
      NEW.referred_project_id IS NOT NULL
    )
  ) OR (
    TG_OP = 'UPDATE' AND (
      (NEW.referred_opportunity_id IS NOT NULL AND OLD.referred_opportunity_id IS NULL) OR
      (NEW.referred_lead_id IS NOT NULL AND OLD.referred_lead_id IS NULL) OR
      (NEW.referred_customer_id IS NOT NULL AND OLD.referred_customer_id IS NULL) OR
      (NEW.referred_project_id IS NOT NULL AND OLD.referred_project_id IS NULL)
    )
  );

  IF v_link_added AND NEW.status = 'pending' THEN
    NEW.status := 'qualified';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: referrals_mark_installed_from_job(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.referrals_mark_installed_from_job() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_opportunity_id UUID;
  v_install_date DATE;
BEGIN
  IF NEW.status NOT IN ('complete', 'collected') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT p.opportunity_id, COALESCE(p.install_date, NEW.completed_at::date, CURRENT_DATE)
    INTO v_opportunity_id, v_install_date
    FROM projects p
   WHERE p.id = NEW.project_id;

  v_install_date := COALESCE(v_install_date, NEW.completed_at::date, CURRENT_DATE);

  -- Scoped to the job's own org, since SECURITY DEFINER no longer relies on RLS for it.
  UPDATE referrals r
     SET status = 'installed',
         install_date = COALESCE(r.install_date, v_install_date),
         referred_project_id = COALESCE(r.referred_project_id, NEW.project_id)
   WHERE r.org_id = NEW.org_id
     AND r.status IN ('pending', 'qualified')
     AND (
       r.referred_project_id = NEW.project_id
       OR (v_opportunity_id IS NOT NULL AND r.referred_opportunity_id = v_opportunity_id)
     );

  RETURN NEW;
END;
$$;


--
-- Name: reject_comp_plan_version_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_comp_plan_version_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'comp_plan_versions is append-only — amend the plan with a new effective-dated version instead';
END;
$$;


--
-- Name: reject_management_overlay_version_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_management_overlay_version_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'management compensation overlay versions are immutable; insert a new effective-dated version';
END;
$$;


--
-- Name: save_supplier(uuid, uuid, uuid, timestamp with time zone, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_supplier(p_org uuid, p_actor uuid, p_id uuid, p_expected_updated_at timestamp with time zone, p_input jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_old vendors;
  v_name text := btrim(COALESCE(p_input->>'name', ''));
  v_new jsonb;
  v_oldj jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_action text;
  v_id uuid;
  v_updated timestamptz;
  f record;
BEGIN
  IF v_name = '' THEN RAISE EXCEPTION 'supplier_name_required'; END IF;

  -- Lock order is ROW first, then the company-wide advisory lock — the same order a direct UPDATE's trigger
  -- takes them — so the function and a direct writer cannot deadlock.
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_old FROM vendors WHERE id = p_id AND org_id = p_org AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_not_found'; END IF;
    -- An update must say which version it was based on; without it a stale form could overwrite a newer save.
    IF p_expected_updated_at IS NULL OR v_old.updated_at <> p_expected_updated_at THEN
      RAISE EXCEPTION 'supplier_stale';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('supplier:' || p_org::text));

  IF EXISTS (SELECT 1 FROM vendors WHERE org_id = p_org AND deleted_at IS NULL AND lower(name) = lower(v_name) AND (p_id IS NULL OR id <> p_id)) THEN
    RAISE EXCEPTION 'supplier_name_taken';
  END IF;

  v_new := jsonb_build_object(
    'name', v_name,
    'active', CASE WHEN p_input->>'active' IN ('true','false') THEN (p_input->>'active')::boolean ELSE true END,
    'order_email', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'order_email', '')), '')),
    'order_cc_emails', CASE WHEN jsonb_typeof(p_input->'order_cc_emails') = 'array' THEN p_input->'order_cc_emails' ELSE '[]'::jsonb END,
    'account_number', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'account_number', '')), '')),
    'default_branch', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'default_branch', '')), '')),
    'default_delivery_notes', to_jsonb(NULLIF(btrim(COALESCE(p_input->>'default_delivery_notes', '')), '')),
    'default_for_trades', CASE WHEN jsonb_typeof(p_input->'default_for_trades') = 'array' THEN p_input->'default_for_trades' ELSE '[]'::jsonb END,
    'connection_type', CASE WHEN p_input->>'connection_type' = 'api' THEN 'api' ELSE 'email' END
  );

  IF v_old.id IS NOT NULL THEN
    v_oldj := jsonb_build_object(
      'name', v_old.name, 'active', v_old.active, 'order_email', to_jsonb(v_old.order_email),
      'order_cc_emails', to_jsonb(COALESCE(v_old.order_cc_emails, '{}'::text[])),
      'account_number', to_jsonb(v_old.account_number), 'default_branch', to_jsonb(v_old.default_branch),
      'default_delivery_notes', to_jsonb(v_old.default_delivery_notes),
      'default_for_trades', to_jsonb(COALESCE(v_old.default_for_trades, '{}'::text[])),
      'connection_type', to_jsonb(COALESCE(v_old.connection_type::text, 'email'))
    );
  END IF;

  FOR f IN SELECT * FROM (VALUES
      ('name', 'Name'), ('active', 'Active'), ('order_email', 'Order email'), ('order_cc_emails', 'CC emails'),
      ('account_number', 'Account number'), ('default_branch', 'Branch'), ('default_delivery_notes', 'Delivery notes'),
      ('default_for_trades', 'Default for trades'), ('connection_type', 'How orders are sent')
    ) AS t(k, label)
  LOOP
    IF v_oldj IS NULL THEN
      -- a new supplier: list what was set
      IF f.k IN ('name', 'active') OR COALESCE(v_new->f.k, 'null'::jsonb) NOT IN ('null'::jsonb, '[]'::jsonb) THEN
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', f.k, 'label', f.label, 'old', NULL, 'new', v_new->f.k));
      END IF;
    ELSIF COALESCE(v_oldj->f.k, 'null'::jsonb) IS DISTINCT FROM COALESCE(v_new->f.k, 'null'::jsonb) THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', f.k, 'label', f.label, 'old', v_oldj->f.k, 'new', v_new->f.k));
    END IF;
  END LOOP;

  IF v_old.id IS NOT NULL AND jsonb_array_length(v_changes) = 0 THEN
    RETURN jsonb_build_object('id', v_old.id, 'updated_at', v_old.updated_at, 'changes', '[]'::jsonb, 'unchanged', true);
  END IF;

  IF v_old.id IS NULL THEN
    INSERT INTO vendors (org_id, name, active, order_email, order_cc_emails, account_number, default_branch,
                         default_delivery_notes, default_for_trades, connection_type, created_by)
    VALUES (p_org, v_name, (v_new->>'active')::boolean, v_new->>'order_email',
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'order_cc_emails')), '{}'),
            v_new->>'account_number', v_new->>'default_branch', v_new->>'default_delivery_notes',
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'default_for_trades')), '{}'),
            (v_new->>'connection_type')::supplier_connection_type, p_actor)
    RETURNING id, updated_at INTO v_id, v_updated;
    v_action := 'created';
  ELSE
    UPDATE vendors SET
      name = v_name, active = (v_new->>'active')::boolean, order_email = v_new->>'order_email',
      order_cc_emails = COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'order_cc_emails')), '{}'),
      account_number = v_new->>'account_number', default_branch = v_new->>'default_branch',
      default_delivery_notes = v_new->>'default_delivery_notes',
      default_for_trades = COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_new->'default_for_trades')), '{}'),
      connection_type = (v_new->>'connection_type')::supplier_connection_type,
      updated_at = now()
    WHERE id = v_old.id
    RETURNING id, updated_at INTO v_id, v_updated;
    v_action := CASE
      WHEN v_old.active AND NOT (v_new->>'active')::boolean THEN 'deactivated'
      WHEN NOT v_old.active AND (v_new->>'active')::boolean THEN 'reactivated'
      ELSE 'updated' END;
  END IF;

  INSERT INTO supplier_audit_log (org_id, vendor_id, action, changed_by, changes)
  VALUES (p_org, v_id, v_action, p_actor, v_changes);

  RETURN jsonb_build_object('id', v_id, 'updated_at', v_updated, 'changes', v_changes, 'unchanged', false, 'action', v_action);
END;
$$;


--
-- Name: search_all(uuid, text, text[], uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_all(p_org uuid, p_q text, p_kinds text[], p_owner uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20) RETURNS TABLE(kind text, id uuid, title text, subtitle text, score real)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  WITH q AS (
    SELECT lower(btrim(p_q)) AS t,
           regexp_replace(p_q, '\D', '', 'g') AS digits,
           '%' || replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
  ),
  hits AS (
    -- customers
    SELECT 'customer'::text AS kind, c.id, c.name AS title,
           concat_ws(' · ', c.address_text, c.phone) AS subtitle,
           greatest(similarity(lower(c.name), q.t), word_similarity(q.t, lower(coalesce(c.address_text, ''))),
                    CASE WHEN length(q.digits) >= 4 AND regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') LIKE '%' || q.digits || '%' THEN 1 ELSE 0 END,
                    CASE WHEN lower(coalesce(c.email, '')) LIKE q.pat THEN 0.9 ELSE 0 END) AS score
    FROM customers c, q
    WHERE 'customer' = ANY (p_kinds) AND c.org_id = p_org
      AND (p_owner IS NULL OR c.id IN (SELECT pr.customer_id FROM projects pr WHERE pr.org_id = p_org AND pr.owner_user_id = p_owner AND pr.customer_id IS NOT NULL))
      AND (lower(c.name) LIKE q.pat OR lower(coalesce(c.address_text, '')) LIKE q.pat OR lower(coalesce(c.email, '')) LIKE q.pat
           OR (length(q.digits) >= 4 AND regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') LIKE '%' || q.digits || '%')
           OR (length(q.t) >= 3 AND word_similarity(q.t, lower(c.name)) >= 0.4) OR (length(q.t) >= 3 AND word_similarity(q.t, lower(coalesce(c.address_text, ''))) >= 0.4))
    UNION ALL
    -- jobs
    SELECT 'job', j.id, 'Job ' || j.job_number, concat_ws(' · ', j.address_text, j.status),
           greatest(similarity(lower(j.job_number), q.t), word_similarity(q.t, lower(coalesce(j.address_text, ''))),
                    CASE WHEN lower(j.job_number) LIKE q.pat THEN 0.95 ELSE 0 END)
    FROM production_jobs j, q
    WHERE 'job' = ANY (p_kinds) AND j.org_id = p_org AND j.status <> 'cancelled'
      AND (p_owner IS NULL OR j.salesperson_id = p_owner)
      AND (lower(j.job_number) LIKE q.pat OR lower(coalesce(j.address_text, '')) LIKE q.pat OR (length(q.t) >= 3 AND word_similarity(q.t, lower(coalesce(j.address_text, ''))) >= 0.4))
    UNION ALL
    -- proposals
    SELECT 'proposal', p.id, coalesce(p.customer_name, 'Proposal') || coalesce(' · #' || p.proposal_number::text, ''), concat_ws(' · ', p.customer_phone, p.status),
           greatest(similarity(lower(coalesce(p.customer_name, '')), q.t),
                    CASE WHEN lower(coalesce(p.proposal_number::text, '')) LIKE q.pat THEN 0.95 ELSE 0 END,
                    CASE WHEN length(q.digits) >= 4 AND regexp_replace(coalesce(p.customer_phone, ''), '\D', '', 'g') LIKE '%' || q.digits || '%' THEN 1 ELSE 0 END)
    FROM proposals p, q
    WHERE 'proposal' = ANY (p_kinds) AND p.org_id = p_org
      AND (p_owner IS NULL OR p.created_by = p_owner)
      AND (lower(coalesce(p.customer_name, '')) LIKE q.pat OR lower(coalesce(p.proposal_number::text, '')) LIKE q.pat
           OR (length(q.digits) >= 4 AND regexp_replace(coalesce(p.customer_phone, ''), '\D', '', 'g') LIKE '%' || q.digits || '%')
           OR (length(q.t) >= 3 AND word_similarity(q.t, lower(coalesce(p.customer_name, ''))) >= 0.4))
    UNION ALL
    -- opportunities (by address)
    SELECT 'opportunity', o.id, coalesce(o.address_text, 'Opportunity'), o.status::text,
           word_similarity(q.t, lower(coalesce(o.address_text, '')))
    FROM opportunities o, q
    WHERE 'opportunity' = ANY (p_kinds) AND o.org_id = p_org
      AND (p_owner IS NULL OR o.owner_user_id = p_owner OR o.setter_user_id = p_owner)
      AND (lower(coalesce(o.address_text, '')) LIKE q.pat OR (length(q.t) >= 3 AND word_similarity(q.t, lower(coalesce(o.address_text, ''))) >= 0.4))
  )
  SELECT kind, id, title, subtitle, score::real FROM hits ORDER BY score DESC, title LIMIT greatest(1, least(p_limit, 50));
$$;


--
-- Name: search_messages(uuid, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_messages(p_org uuid, p_viewer uuid, p_q text, p_limit integer DEFAULT 20) RETURNS TABLE(id uuid, opportunity_id uuid, lead_id uuid, customer_id uuid, body text, created_at timestamp with time zone, score real)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  WITH q AS (
    SELECT lower(btrim(p_q)) AS t,
           '%' || replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
  )
  SELECT a.id, a.opportunity_id, a.lead_id, a.customer_id, a.body, a.created_at,
         greatest(word_similarity(q.t, lower(a.body)), CASE WHEN lower(a.body) LIKE q.pat THEN 1 ELSE 0 END)::real AS score
  FROM activities a, q
  WHERE a.org_id = p_org
    AND a.deleted_at IS NULL
    AND a.referral_partner_id IS NULL
    AND a.audience IS NOT NULL
    AND a.opportunity_id IS NOT NULL
    AND coalesce(a.origin, 'human') = 'human'
    AND length(q.t) >= 2
    AND (lower(a.body) LIKE q.pat OR q.t <% lower(a.body))
    AND arx_private.message_visible_to(p_viewer, a.audience, a.restricted_pricing, a.org_id, a.opportunity_id)
  ORDER BY score DESC, a.created_at DESC
  LIMIT greatest(1, least(p_limit, 50));
$$;


--
-- Name: seed_default_org_trades(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_org_trades(p_org_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  INSERT INTO public.org_trades (org_id, slug, label, sort, active, match_keywords)
  VALUES
    (p_org_id, 'roofing', 'Roofing', 10, TRUE, NULL),
    (p_org_id, 'gutters', 'Gutters', 20, TRUE, ARRAY['gutter', 'downspout']),
    (p_org_id, 'siding',  'Siding',  30, TRUE, ARRAY['siding']),
    (p_org_id, 'windows', 'Windows', 40, TRUE, ARRAY['\bwindows?\b']),
    (p_org_id, 'other',   'Other',   50, TRUE, NULL)
  ON CONFLICT (org_id, slug) DO NOTHING;
$$;


--
-- Name: set_invoice_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_invoice_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := generate_invoice_number(NEW.job_id);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: set_work_order_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_work_order_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.work_order_number IS NULL OR NEW.work_order_number = '' THEN
    NEW.work_order_number := generate_work_order_number(NEW.org_id);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: sqft_to_squares(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sqft_to_squares(sqft numeric) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  RETURN ROUND(sqft / 100, 2);
END;
$$;


--
-- Name: supplier_api_events_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.supplier_api_events_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  RAISE EXCEPTION 'supplier_api_events is append-only';
END $$;


--
-- Name: sync_pending_prompt_closer_on_reassignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_pending_prompt_closer_on_reassignment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.closer_user_id IS NOT NULL
     AND NEW.closer_user_id IS DISTINCT FROM OLD.closer_user_id
  THEN
    UPDATE pending_status_prompts
    SET
      closer_user_id = NEW.closer_user_id,
      dismissed = false
    WHERE appointment_id = NEW.id
      AND completed = false;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: track_work_order_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.track_work_order_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO work_order_status_history (work_order_id, old_status, new_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: uncancel_production_job(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uncancel_production_job(p_org_id uuid, p_job_id uuid, p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_job production_jobs%ROWTYPE;
  v_opportunity_id UUID;
  v_contracts_restored INT := 0;
BEGIN
  SELECT * INTO v_job
  FROM production_jobs
  WHERE id = p_job_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status <> 'cancelled' THEN
    RAISE EXCEPTION 'This job is not cancelled';
  END IF;

  UPDATE production_jobs
  SET status = 'sold',
      cancelled_at = NULL,
      cancelled_by_user_id = NULL,
      cancellation_reason = NULL,
      cancellation_notes = NULL
  WHERE id = p_job_id AND org_id = p_org_id;

  IF v_job.project_id IS NOT NULL THEN
    UPDATE projects
    SET status = 'in_progress'
    WHERE id = v_job.project_id AND org_id = p_org_id
    RETURNING opportunity_id INTO v_opportunity_id;
  END IF;

  UPDATE order_form_contracts
  SET status = CASE WHEN customer_signed_at IS NOT NULL THEN 'completed' ELSE 'pending_customer' END::contract_signing_status
  WHERE org_id = p_org_id
    AND agreement_type IN ('installation', 'repair')
    AND status = 'voided'
    -- Only what THIS cancel voided: same transaction, so the updated_at trigger
    -- stamped exactly cancelled_at. Anything voided later (a contract replaced
    -- after the cancel — voiding replaced the old hard-delete on 2026-09-26) or by
    -- an earlier cancel was superseded, and restoring it would count a sale twice.
    AND updated_at = v_job.cancelled_at
    AND (
      (v_opportunity_id IS NOT NULL AND opportunity_id = v_opportunity_id)
      OR (v_job.accepted_proposal_id IS NOT NULL AND proposal_id = v_job.accepted_proposal_id)
    );
  GET DIAGNOSTICS v_contracts_restored = ROW_COUNT;

  INSERT INTO production_job_notes (job_id, user_id, note, is_internal)
  VALUES (
    p_job_id,
    p_user_id,
    'Cancellation undone (was: ' || COALESCE(v_job.cancellation_reason, 'no reason')
      || COALESCE(' — ' || v_job.cancellation_notes, '') || ')',
    true
  );

  RETURN jsonb_build_object('job_id', v_job.id, 'contracts_restored', v_contracts_restored);
END;
$$;


--
-- Name: update_campaign_lead_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_campaign_lead_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL THEN
    UPDATE campaigns 
    SET total_leads = (
      SELECT COUNT(*) FROM leads WHERE campaign_id = NEW.campaign_id
    )
    WHERE id = NEW.campaign_id;
  END IF;
  
  -- Also update old campaign if changed
  IF TG_OP = 'UPDATE' AND OLD.campaign_id IS NOT NULL AND OLD.campaign_id != NEW.campaign_id THEN
    UPDATE campaigns 
    SET total_leads = (
      SELECT COUNT(*) FROM leads WHERE campaign_id = OLD.campaign_id
    )
    WHERE id = OLD.campaign_id;
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: update_job_additional_scope_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_job_additional_scope_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_job_change_orders_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_job_change_orders_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_job_product_orders_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_job_product_orders_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_lead_source_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_lead_source_stats() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.lead_source_id IS NOT NULL THEN
    UPDATE lead_sources 
    SET 
      total_leads_received = total_leads_received + 1,
      last_lead_at = NOW()
    WHERE id = NEW.lead_source_id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_order_form_contracts_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_order_form_contracts_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_roofing_types_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_roofing_types_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: upsert_org_derived_commission_rates(uuid, numeric, numeric, numeric, date, uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_org_derived_commission_rates(p_org_id uuid, p_inspection numeric, p_manager_override numeric, p_self_gen numeric, p_effective_from date, p_created_by_user_id uuid, p_change_reason text, p_apply_to_later_rows boolean DEFAULT false) RETURNS TABLE(out_effective_from date, out_inspection_commission_rate numeric, out_manager_override_commission_rate numeric, out_self_gen_commission_rate numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date;
  v_current RECORD;
BEGIN
  IF length(btrim(COALESCE(p_change_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'change reason is required';
  END IF;

  PERFORM 1
  FROM users
  WHERE id = p_created_by_user_id
    AND org_id = p_org_id
    AND role IN ('admin', 'owner', 'operations')
    AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll administrator not found';
  END IF;

  IF p_inspection IS NULL OR p_manager_override IS NULL OR p_self_gen IS NULL THEN
    RAISE EXCEPTION 'all three rates are required';
  END IF;
  IF p_inspection < 0 OR p_inspection > 25
    OR p_manager_override < 0 OR p_manager_override > 25
    OR p_self_gen < 0 OR p_self_gen > 25 THEN
    RAISE EXCEPTION 'rates must be between 0 and 25';
  END IF;
  IF round(p_inspection, 2) <> p_inspection
    OR round(p_manager_override, 2) <> p_manager_override
    OR round(p_self_gen, 2) <> p_self_gen THEN
    RAISE EXCEPTION 'rates support at most 2 decimal places';
  END IF;

  INSERT INTO org_derived_commission_rates (
    org_id,
    inspection_commission_rate,
    manager_override_commission_rate,
    self_gen_commission_rate,
    effective_from,
    created_by_user_id,
    change_reason
  ) VALUES (
    p_org_id,
    p_inspection,
    p_manager_override,
    p_self_gen,
    p_effective_from,
    p_created_by_user_id,
    p_change_reason
  )
  ON CONFLICT (org_id, effective_from) DO UPDATE SET
    inspection_commission_rate = EXCLUDED.inspection_commission_rate,
    manager_override_commission_rate = EXCLUDED.manager_override_commission_rate,
    self_gen_commission_rate = EXCLUDED.self_gen_commission_rate,
    created_by_user_id = EXCLUDED.created_by_user_id,
    change_reason = EXCLUDED.change_reason;

  IF p_apply_to_later_rows THEN
    UPDATE org_derived_commission_rates
    SET inspection_commission_rate = p_inspection,
        manager_override_commission_rate = p_manager_override,
        self_gen_commission_rate = p_self_gen,
        created_by_user_id = p_created_by_user_id,
        change_reason = p_change_reason
    WHERE org_id = p_org_id
      AND effective_from > p_effective_from;
  END IF;

  SELECT *
  INTO v_current
  FROM org_derived_commission_rates
  WHERE org_id = p_org_id
    AND effective_from <= v_today
  ORDER BY effective_from DESC
  LIMIT 1;

  IF FOUND THEN
    PERFORM set_config('app.skip_org_derived_rate_trigger', 'true', true);
    UPDATE orgs
    SET inspection_commission_rate = v_current.inspection_commission_rate,
        manager_override_commission_rate = v_current.manager_override_commission_rate,
        self_gen_commission_rate = v_current.self_gen_commission_rate
    WHERE id = p_org_id;
  END IF;

  RETURN QUERY
  SELECT r.effective_from, r.inspection_commission_rate, r.manager_override_commission_rate,
         r.self_gen_commission_rate
  FROM org_derived_commission_rates r
  WHERE r.org_id = p_org_id
  ORDER BY r.effective_from ASC;
END;
$$;


--
-- Name: FUNCTION upsert_org_derived_commission_rates(p_org_id uuid, p_inspection numeric, p_manager_override numeric, p_self_gen numeric, p_effective_from date, p_created_by_user_id uuid, p_change_reason text, p_apply_to_later_rows boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.upsert_org_derived_commission_rates(p_org_id uuid, p_inspection numeric, p_manager_override numeric, p_self_gen numeric, p_effective_from date, p_created_by_user_id uuid, p_change_reason text, p_apply_to_later_rows boolean) IS 'Admin entry point for editing the three org-wide derived commission rates (inspection, manager override, self-gen) at an explicit effective date. Requires a non-empty change_reason and an active admin/owner/operations user. Keeps orgs.* in sync with whichever row is latest-in-effect and suppresses the orgs AFTER UPDATE trigger while doing so (app.skip_org_derived_rate_trigger) so the sync never creates a second, tomorrow-dated history row for the same change. p_apply_to_later_rows overwrites every existing row with a later effective_from to the same three rates — used when the caller has confirmed they want to close the gap where a later, already-scheduled row would otherwise shadow this one.';


--
-- Name: user_has_permission(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_has_permission(user_uuid uuid, permission_name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  user_record RECORD;
BEGIN
  -- Get user's role info
  SELECT role, custom_role_id, org_id INTO user_record
  FROM users WHERE id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- Legacy admin check - admins have all permissions
  IF user_record.role = 'admin' THEN
    RETURN TRUE;
  END IF;
  
  -- Check user-specific permission grants first (highest priority)
  IF EXISTS (
    SELECT 1 
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = user_uuid
    AND p.name = permission_name
    AND (up.expires_at IS NULL OR up.expires_at > NOW())
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Check custom role permissions
  IF user_record.custom_role_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = user_record.custom_role_id
      AND (p.name = permission_name OR p.name = 'admin:full')
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;
  
  -- Fallback to legacy role-based check
  RETURN CASE user_record.role
    WHEN 'regional_manager' THEN permission_name IN (
      'canvass:view', 'leads:view', 'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:edit', 'contracts:view', 'contracts:send',
      'projects:view', 'projects:edit', 'reports:view_own', 'reports:view_team',
      'reports:view_region', 'reports:export', 'teams:view', 'teams:create',
      'teams:edit', 'regions:view', 'regions:create', 'regions:edit',
      'users:view', 'users:manage_team', 'users:manage_region',
      'scheduling:view', 'scheduling:manage_team', 'scheduling:manage_region',
      'pricebook:view', 'admin:access'
    )
    WHEN 'sales_manager' THEN permission_name IN (
      'canvass:view', 'leads:view', 'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:edit', 'contracts:view', 'contracts:send',
      'projects:view', 'reports:view_own', 'reports:view_team', 'reports:export',
      'teams:view', 'teams:create', 'teams:edit', 'users:view', 'users:manage_team',
      'scheduling:view', 'scheduling:manage_team'
    )
    WHEN 'sales_rep' THEN permission_name IN (
      'canvass:view', 'leads:view', 'opportunities:view', 'opportunities:edit',
      'proposals:view', 'proposals:edit', 'contracts:view', 'contracts:send',
      'projects:view', 'reports:view_own', 'teams:view', 'users:view',
      'scheduling:view'
    )
    WHEN 'canvasser' THEN permission_name IN (
      'canvass:view', 'canvass:create', 'canvass:edit', 'leads:view',
      'leads:create', 'leads:edit', 'opportunities:view', 'reports:view_own',
      'teams:view', 'users:view', 'scheduling:view'
    )
    WHEN 'operations' THEN permission_name IN (
      'canvass:view', 'leads:view', 'opportunities:view', 'opportunities:edit',
      'proposals:view', 'contracts:view', 'projects:view', 'projects:edit',
      'reports:view_own', 'reports:view_all', 'reports:export', 'teams:view',
      'users:view', 'scheduling:view', 'pricebook:view'
    )
    ELSE FALSE
  END;
END;
$$;


--
-- Name: vendors_one_default_per_trade(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vendors_one_default_per_trade() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE clash text;
BEGIN
  IF NEW.deleted_at IS NULL AND COALESCE(NEW.active, true) AND COALESCE(array_length(NEW.default_for_trades, 1), 0) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('supplier:' || NEW.org_id::text));
    SELECT v.name INTO clash
    FROM vendors v
    WHERE v.org_id = NEW.org_id AND v.id <> NEW.id AND v.deleted_at IS NULL AND v.active
      AND ARRAY(SELECT lower(x) FROM unnest(v.default_for_trades) x) && ARRAY(SELECT lower(x) FROM unnest(NEW.default_for_trades) x)
    LIMIT 1;
    IF clash IS NOT NULL THEN
      RAISE EXCEPTION 'supplier_default_clash:%', clash USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: write_partner_owner_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.write_partner_owner_role(p_job_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  j RECORD;
  o RECORD;
  v_owner UUID;
  v_at TIMESTAMPTZ;
  v_partner_name TEXT;
BEGIN
  SELECT id, org_id, sale_date, salesperson_id, project_id, job_number
    INTO j FROM production_jobs WHERE id = p_job_id;
  IF NOT FOUND OR j.project_id IS NULL THEN RETURN 'no_job'; END IF;

  SELECT op.id, op.referral_partner_id, op.setter_user_id, op.owner_user_id, op.assigned_user_id,
         ld.closer_user_id AS lead_closer_user_id
    INTO o
    FROM projects p JOIN opportunities op ON op.id = p.opportunity_id
    LEFT JOIN leads ld ON ld.id = op.lead_id
   WHERE p.id = j.project_id;
  -- "Referred By" cleared after the sale: drop the unrated row. A row with a rate set is
  -- payroll's now and is never touched here.
  IF NOT FOUND OR o.referral_partner_id IS NULL THEN
    DELETE FROM deal_commission_roles
     WHERE job_id = j.id AND role = 'partner_owner'
       AND override_amount IS NULL AND override_percent IS NULL;
    RETURN 'no_partner';
  END IF;

  IF EXISTS (SELECT 1 FROM deal_commission_roles WHERE job_id = j.id AND role = 'partner_owner'
              AND (override_amount IS NOT NULL OR override_percent IS NOT NULL)) THEN
    RETURN 'exists';
  END IF;
  -- Unrated row from an earlier partner: replaced below by the current partner's owner.
  DELETE FROM deal_commission_roles WHERE job_id = j.id AND role = 'partner_owner';

  v_at := LEAST(
    ((COALESCE(j.sale_date, CURRENT_DATE) + 1)::TIMESTAMP AT TIME ZONE 'America/New_York'),
    NOW()
  );
  v_owner := referral_partner_owner_as_of(o.referral_partner_id, v_at);
  IF v_owner IS NULL THEN RETURN 'unowned'; END IF;

  IF v_owner IN (j.salesperson_id, o.setter_user_id, o.owner_user_id, o.assigned_user_id, o.lead_closer_user_id) THEN
    SELECT name INTO v_partner_name FROM referral_partners WHERE id = o.referral_partner_id;
    INSERT INTO notifications (org_id, recipient_user_id, type, title, body, link_url)
    SELECT j.org_id, u.id, 'partner_owner_conflict',
           'Partner owner also worked job ' || COALESCE(j.job_number, ''),
           COALESCE(v_partner_name, 'A referral partner') ||
             '''s owner is also on this deal. No partner pay row was written — decide whether they are paid twice.',
           '/ops/jobs/' || j.id
      FROM users u WHERE u.org_id = j.org_id AND u.role IN ('admin', 'owner');
    RETURN 'conflict';
  END IF;

  INSERT INTO deal_commission_roles (org_id, job_id, role, user_id)
  VALUES (j.org_id, j.id, 'partner_owner', v_owner)
  ON CONFLICT (job_id, role, user_id) DO NOTHING;
  RETURN 'written';
END $$;


--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    lead_id uuid,
    project_id uuid,
    user_id uuid,
    type public.activity_type NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    opportunity_id uuid,
    customer_id uuid,
    deleted_user_name text,
    spoke_with text,
    referral_partner_id uuid,
    contact_outcome text,
    audience text,
    origin text,
    restricted_pricing boolean,
    priority text,
    reply_to_id uuid,
    client_id uuid,
    source text,
    mentioned_user_ids uuid[],
    production_job_id uuid,
    work_order_id uuid,
    thread_id uuid,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    legacy_ref jsonb,
    pinned_at timestamp with time zone,
    pinned_by uuid,
    pin_scope text,
    pin_expires_at timestamp with time zone,
    CONSTRAINT activities_contact_outcome_check CHECK ((contact_outcome = ANY (ARRAY['reached'::text, 'voicemail'::text, 'no_answer'::text, 'sent'::text, 'replied'::text]))),
    CONSTRAINT activities_entity_check CHECK (((lead_id IS NOT NULL) OR (opportunity_id IS NOT NULL) OR (project_id IS NOT NULL) OR (customer_id IS NOT NULL) OR (referral_partner_id IS NOT NULL)))
);


--
-- Name: COLUMN activities.spoke_with; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activities.spoke_with IS 'Name of person inside sales spoke with (may differ from homeowner)';


--
-- Name: adder_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.adder_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    sort_order integer DEFAULT 0,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    context_type text,
    context_id uuid,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_message_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_message_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    message_index integer NOT NULL,
    rating text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_message_feedback_message_index_check CHECK ((message_index >= 0)),
    CONSTRAINT ai_message_feedback_rating_check CHECK ((rating = ANY (ARRAY['up'::text, 'down'::text])))
);


--
-- Name: ai_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_suggestions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    suggestion_type text NOT NULL,
    context_type text,
    context_id uuid,
    suggestion text NOT NULL,
    was_accepted boolean,
    feedback text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: announcement_dismissals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_dismissals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    announcement_id uuid NOT NULL,
    user_id uuid NOT NULL,
    dismissed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE announcement_dismissals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.announcement_dismissals IS 'Who closed which announcement banner (per user, so it stays closed on every device).';


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    body jsonb DEFAULT '{}'::jsonb NOT NULL,
    link_url text DEFAULT '/whats-new'::text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT announcements_check CHECK ((ends_at > starts_at))
);


--
-- Name: TABLE announcements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.announcements IS 'In-app "What''s new" banners: per-role short copy, shown between starts_at and ends_at while active. Service-role only.';


--
-- Name: appointment_closeouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_closeouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    actor_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reverted_at timestamp with time zone,
    reverted_by uuid
);


--
-- Name: appointment_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    duration_minutes integer DEFAULT 60 NOT NULL,
    color text DEFAULT '#3b82f6'::text,
    description text,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    category text DEFAULT 'inspection'::text NOT NULL,
    buffer_after_minutes integer DEFAULT 0 NOT NULL
);


--
-- Name: COLUMN appointment_types.buffer_after_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointment_types.buffer_after_minutes IS 'Default buffer after slot end for new appointments (scheduling gaps); not used for feedback prompt time.';


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    source_type public.lead_source_type DEFAULT 'other'::public.lead_source_type NOT NULL,
    channel public.lead_channel DEFAULT 'inbound'::public.lead_channel NOT NULL,
    budget numeric(12,2),
    spent numeric(12,2) DEFAULT 0,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    google_campaign_id text,
    facebook_campaign_id text,
    external_id text,
    is_active boolean DEFAULT true NOT NULL,
    start_date date,
    end_date date,
    total_leads integer DEFAULT 0 NOT NULL,
    total_appointments integer DEFAULT 0 NOT NULL,
    total_sales integer DEFAULT 0 NOT NULL,
    total_revenue numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    google_ads_campaign_id text
);


--
-- Name: TABLE campaigns; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.campaigns IS 'Marketing campaigns for tracking lead sources and ROI';


--
-- Name: canvass_knocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvass_knocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    user_id uuid NOT NULL,
    disposition text,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE canvass_knocks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.canvass_knocks IS 'Append-only door-knock event log. One row per knock (new pin or re-knock of an existing pin). Source of truth for the dashboard "doors knocked" stat, the sisu leaderboard, setter ramp gating, and Heat door-count badges — replaces counting leads.created_at, which missed every re-knock of a pre-existing pin.';


--
-- Name: COLUMN canvass_knocks.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.canvass_knocks.user_id IS 'Rep credited for this specific knock — the lead''s attribution (pin_attributed_user_id, falling back to owner_user_id) at the moment of this knock. No FK: must survive the rep leaving the company, same as leads.pin_attributed_user_id.';


--
-- Name: canvass_parcel_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvass_parcel_years (
    county text NOT NULL,
    pin text NOT NULL,
    year_built smallint NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: canvass_territories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvass_territories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#6366F1'::text NOT NULL,
    boundary_geojson jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: canvass_territory_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvass_territory_teams (
    territory_id uuid NOT NULL,
    team_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE canvass_territory_teams; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.canvass_territory_teams IS 'Team-level assignment to canvass territories; members get same polygon union as canvass_territory_users.';


--
-- Name: canvass_territory_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvass_territory_users (
    territory_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: close_appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.close_appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    scheduled_appointment_id uuid,
    scheduled_for timestamp with time zone NOT NULL,
    outcome text,
    notes text,
    submitted_by uuid,
    outcome_submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_inspection_appointment_id uuid
);


--
-- Name: COLUMN close_appointments.source_inspection_appointment_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.close_appointments.source_inspection_appointment_id IS 'Inspection appointment that preceded this close; scheduled_appointment_id remains the close slot.';


--
-- Name: coaching_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coaching_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    annual_income_goal numeric(12,2),
    avg_deal_value numeric(12,2),
    working_days_per_week integer DEFAULT 5,
    working_weeks_per_year integer DEFAULT 50,
    close_rate_override numeric(5,2),
    stick_rate_override numeric(5,2),
    commission_rate_override numeric(5,2),
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: commissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid,
    project_id uuid,
    opportunity_id uuid,
    comp_plan_id uuid,
    sale_amount numeric(12,2) NOT NULL,
    commission_rate numeric(5,2) NOT NULL,
    commission_amount numeric(10,2) NOT NULL,
    bonus_amount numeric(10,2) DEFAULT 0,
    total_amount numeric(10,2) NOT NULL,
    status public.commission_status DEFAULT 'pending'::public.commission_status NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    paid_at timestamp with time zone,
    commission_period text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    commissionable_amount numeric(12,2),
    deleted_user_name text,
    production_job_id uuid
);


--
-- Name: COLUMN commissions.commissionable_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commissions.commissionable_amount IS 'The portion of sale_amount that is commissionable (excludes non-commissionable adders)';


--
-- Name: COLUMN commissions.production_job_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.commissions.production_job_id IS 'Production job this commission row applies to (earnings or chargeback).';


--
-- Name: comp_plan_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comp_plan_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    comp_plan_id uuid NOT NULL,
    effective_from date NOT NULL,
    plan_type public.comp_plan_type NOT NULL,
    base_percentage numeric(5,2),
    flat_amount numeric(10,2),
    hourly_rate numeric(10,2),
    unit_rate numeric(10,2),
    unit_type character varying,
    hybrid_components jsonb,
    tiers jsonb,
    volume_bonuses jsonb,
    team_overrides jsonb,
    is_manager_plan boolean,
    personal_sales_enabled boolean,
    team_override_enabled boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid,
    change_reason text NOT NULL,
    CONSTRAINT comp_plan_versions_base_percentage_check CHECK (((base_percentage IS NULL) OR ((base_percentage >= (0)::numeric) AND (base_percentage <= (100)::numeric)))),
    CONSTRAINT comp_plan_versions_non_negative_check CHECK ((((flat_amount IS NULL) OR (flat_amount >= (0)::numeric)) AND ((hourly_rate IS NULL) OR (hourly_rate >= (0)::numeric)) AND ((unit_rate IS NULL) OR (unit_rate >= (0)::numeric)))),
    CONSTRAINT comp_plan_versions_reason_check CHECK ((length(btrim(change_reason)) > 0))
);


--
-- Name: TABLE comp_plan_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.comp_plan_versions IS 'Append-only effective-dated comp plan terms. Payroll resolves the body on a job''s sale date; comp_plans keeps identity only.';


--
-- Name: comp_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comp_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    plan_type public.comp_plan_type DEFAULT 'percentage'::public.comp_plan_type NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    flat_amount numeric(10,2),
    base_percentage numeric(5,2),
    tiers jsonb,
    bonuses jsonb,
    applicable_roles text[] DEFAULT ARRAY['sales_rep'::text, 'canvasser'::text],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    volume_bonuses jsonb,
    is_manager_plan boolean DEFAULT false,
    personal_sales_enabled boolean DEFAULT true,
    team_override_enabled boolean DEFAULT false,
    team_overrides jsonb,
    readme text,
    unit_rate numeric(10,2),
    unit_type character varying(50),
    hybrid_components jsonb,
    hourly_rate numeric(10,2),
    plan_purpose text DEFAULT 'primary'::text NOT NULL,
    CONSTRAINT comp_plans_plan_purpose_check CHECK ((plan_purpose = ANY (ARRAY['primary'::text, 'management_overlay'::text])))
);


--
-- Name: COLUMN comp_plans.flat_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.flat_amount IS 'Flat dollar amount per job for flat_rate plans';


--
-- Name: COLUMN comp_plans.volume_bonuses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.volume_bonuses IS 'Sliding scale volume bonuses. Array of: {min_volume: number, max_volume: number|null, bonus_type: "percentage"|"flat", bonus_value: number}';


--
-- Name: COLUMN comp_plans.is_manager_plan; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.is_manager_plan IS 'Whether this is a manager compensation plan with team overrides';


--
-- Name: COLUMN comp_plans.personal_sales_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.personal_sales_enabled IS 'Manager can earn commission on their own sales';


--
-- Name: COLUMN comp_plans.team_override_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.team_override_enabled IS 'Manager earns override on team sales';


--
-- Name: COLUMN comp_plans.team_overrides; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.team_overrides IS 'Sliding scale team overrides. Array of: {min_team_volume: number, max_team_volume: number|null, override_type: "percentage"|"flat", override_value: number}';


--
-- Name: COLUMN comp_plans.readme; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.readme IS 'Custom readme/explanation text shown to team members about their comp plan';


--
-- Name: COLUMN comp_plans.unit_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.unit_rate IS 'Rate per unit for unit-based compensation (per square, per kW, etc.)';


--
-- Name: COLUMN comp_plans.unit_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.unit_type IS 'Type of unit for unit-based plans: square, kw, linear_foot, panel, window, or custom label';


--
-- Name: COLUMN comp_plans.hybrid_components; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.hybrid_components IS 'Array of compensation components for hybrid plans: [{type, rate, unit_type?, description?}]';


--
-- Name: COLUMN comp_plans.hourly_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.hourly_rate IS 'Hourly rate for hourly compensation plans';


--
-- Name: COLUMN comp_plans.plan_purpose; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comp_plans.plan_purpose IS 'primary plans pay a user''s own production; management_overlay plans supply a separately assigned fixed manager override.';


--
-- Name: contract_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid,
    event_type text NOT NULL,
    payload jsonb,
    prev_event_hash text,
    event_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: contract_signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_signatures (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    role text NOT NULL,
    signed_name text,
    signed_title text,
    signed_email text,
    signature_type text,
    signature_data text,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_ip text,
    signed_user_agent text,
    signed_location_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contract_signatures_role_check CHECK ((role = ANY (ARRAY['rep'::text, 'customer'::text])))
);


--
-- Name: contract_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_templates (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    storage_path text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    project_id uuid NOT NULL,
    contract_pdf_path text NOT NULL,
    token uuid NOT NULL,
    status text DEFAULT 'sent'::text NOT NULL,
    signed_at timestamp with time zone,
    signed_name text,
    signed_email text,
    signed_ip text,
    signed_user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_location_text text,
    audit_pdf_path text,
    sent_to_email text,
    sent_at timestamp with time zone,
    contract_payload jsonb,
    rep_signed_at timestamp with time zone,
    customer_signed_at timestamp with time zone
);


--
-- Name: cost_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_cost_line_id uuid NOT NULL,
    document_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid
);


--
-- Name: TABLE cost_attachments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cost_attachments IS 'Join table linking cost lines to uploaded document records';


--
-- Name: crews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    crew_type text DEFAULT 'general'::text NOT NULL,
    foreman_user_id uuid,
    members uuid[] DEFAULT '{}'::uuid[],
    color text DEFAULT '#3B82F6'::text NOT NULL,
    phone text,
    daily_capacity integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crews_crew_type_check CHECK ((crew_type = ANY (ARRAY['roofing'::text, 'siding'::text, 'gutters'::text, 'windows'::text, 'general'::text])))
);


--
-- Name: custom_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_by uuid NOT NULL,
    name text NOT NULL,
    description text,
    report_type text DEFAULT 'bar_chart'::text NOT NULL,
    data_source text DEFAULT 'leads'::text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    is_dashboard_widget boolean DEFAULT false NOT NULL,
    dashboard_position integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: custom_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    display_name text NOT NULL,
    description text,
    hierarchy_level integer DEFAULT 0 NOT NULL,
    is_system_role boolean DEFAULT false NOT NULL,
    parent_role_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    name text,
    phone text,
    email text,
    address_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    qb_customer_id text,
    sync_status public.sync_status DEFAULT 'pending'::public.sync_status,
    synced_to_qb_at timestamp with time zone,
    phone_normalized text GENERATED ALWAYS AS (regexp_replace(phone, '[^0-9]'::text, ''::text, 'g'::text)) STORED,
    email_lower text GENERATED ALWAYS AS (lower(TRIM(BOTH FROM email))) STORED
);


--
-- Name: dashboard_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    region_id uuid,
    team_id uuid,
    user_id uuid,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: data_fix_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_fix_backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fix text NOT NULL,
    table_name text NOT NULL,
    row_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deal_commission_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_commission_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    role text NOT NULL,
    user_id uuid NOT NULL,
    override_amount numeric(14,2),
    override_percent numeric(5,2),
    premier_pricing_amount numeric(14,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deal_commission_roles_role_check CHECK ((role = ANY (ARRAY['setter'::text, 'closer'::text, 'inspector'::text, 'field_manager'::text, 'senior_manager'::text, 'self_gen'::text, 'setter_manager_override'::text, 'closer_manager_override'::text, 'partner_owner'::text, 'custom'::text])))
);


--
-- Name: TABLE deal_commission_roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.deal_commission_roles IS 'Per-job commission participants beyond legacy sales_rep/setter/owner; backfilled from collectParticipants() at period lock when missing.';


--
-- Name: COLUMN deal_commission_roles.override_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.deal_commission_roles.override_percent IS 'Percent of the job commission base paid to this participant. Counts INSIDE the sales commission pool cap — these lines scale down with everyone else when a job exceeds the cap. Takes effect only when override_amount is null (flat dollars win). Used for the inspection line and percentage-based manager overrides.';


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid,
    customer_id uuid,
    linked_record_type text,
    linked_record_id uuid,
    document_role text,
    storage_path text NOT NULL,
    filename text NOT NULL,
    file_size integer,
    mime_type text,
    category text NOT NULL,
    title text,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    is_protected boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    parent_document_id uuid,
    version_note text,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    deletion_reason text,
    CONSTRAINT documents_document_role_check CHECK ((document_role = ANY (ARRAY['draft'::text, 'signed_executed'::text, 'supporting_attachment'::text, 'customer_copy'::text, 'internal_copy'::text]))),
    CONSTRAINT documents_linked_record_type_check CHECK ((linked_record_type = ANY (ARRAY['contract'::text, 'change_order'::text]))),
    CONSTRAINT documents_linked_role_guard CHECK ((((linked_record_type IS NULL) AND (linked_record_id IS NULL) AND (document_role IS NULL)) OR ((linked_record_type = ANY (ARRAY['contract'::text, 'change_order'::text])) AND (linked_record_id IS NOT NULL)))),
    CONSTRAINT documents_signed_role_protected CHECK (((document_role IS DISTINCT FROM 'signed_executed'::text) OR (is_protected = true))),
    CONSTRAINT documents_status_check CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text, 'void'::text, 'archived'::text])))
);


--
-- Name: TABLE documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.documents IS 'Versioned document metadata for jobs/customers, including contract/change-order linked docs';


--
-- Name: COLUMN documents.document_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.documents.document_role IS 'Role for linked contract/change-order docs: draft, signed_executed, supporting_attachment, customer_copy, internal_copy';


--
-- Name: COLUMN documents.storage_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.documents.storage_path IS 'Immutable path in Supabase Storage. Replacements create new rows.';


--
-- Name: COLUMN documents.is_protected; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.documents.is_protected IS 'Protected documents cannot be hard deleted';


--
-- Name: COLUMN documents.parent_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.documents.parent_document_id IS 'Previous document version when a file is replaced';


--
-- Name: email_blast_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_blast_sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    blast_type text NOT NULL,
    send_date date NOT NULL,
    recipients_sent integer DEFAULT 0 NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone
);


--
-- Name: employee_comp_agreement_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_comp_agreement_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agreement_id uuid NOT NULL,
    org_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_user_id uuid,
    actor_name text,
    actor_email text,
    event_ip text,
    event_user_agent text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_comp_agreement_events_event_type_check CHECK ((event_type = ANY (ARRAY['manager_signed'::text, 'send_accepted'::text, 'delivery_failed'::text, 'resent'::text, 'viewed'::text, 'rep_signed'::text, 'declined'::text, 'voided'::text])))
);


--
-- Name: estimate_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estimate_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estimate_id uuid,
    opportunity_id uuid,
    org_id uuid NOT NULL,
    source text DEFAULT 'ai_draft'::text,
    category text,
    description text,
    quantity numeric,
    unit text,
    unit_price numeric,
    total_price numeric,
    pricebook_item_id uuid,
    sort_order integer DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: estimate_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estimate_lines (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    estimate_id uuid NOT NULL,
    pricebook_item_id uuid,
    category public.pricebook_category NOT NULL,
    name text NOT NULL,
    unit public.unit NOT NULL,
    qty numeric(10,2) NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    line_total numeric(10,2) GENERATED ALWAYS AS ((qty * unit_price)) STORED NOT NULL,
    is_labor boolean NOT NULL,
    is_taxable boolean NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    opportunity_id uuid,
    source text DEFAULT 'manual'::text,
    notes text
);


--
-- Name: estimates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estimates (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    project_id uuid NOT NULL,
    status text DEFAULT 'ai_draft'::text NOT NULL,
    steep_multiplier_pct numeric(5,2) DEFAULT 0 NOT NULL,
    high_multiplier_pct numeric(5,2) DEFAULT 0 NOT NULL,
    tax_rate numeric(5,4) DEFAULT 0.08 NOT NULL,
    discount_amount numeric(10,2) DEFAULT 0 NOT NULL,
    subtotal numeric(10,2) DEFAULT 0 NOT NULL,
    tax numeric(10,2) DEFAULT 0 NOT NULL,
    total numeric(10,2) DEFAULT 0 NOT NULL,
    scope_text text,
    proposal_pdf_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    opportunity_id uuid,
    overhead_pct numeric DEFAULT 15,
    overhead_amount numeric,
    waste_factor_pct numeric DEFAULT 12,
    roof_type text,
    ai_flags text[],
    scope_summary text
);


--
-- Name: files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.files (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    lead_id uuid,
    project_id uuid,
    user_id uuid NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    tag public.file_tag DEFAULT 'other'::public.file_tag NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    opportunity_id uuid,
    customer_id uuid,
    photo_tag text,
    share_with_sub boolean DEFAULT false NOT NULL,
    job_id uuid
);


--
-- Name: COLUMN files.photo_tag; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.files.photo_tag IS 'Category tag for photos: final_front, final_back, final_left, final_right, final_slope_1, final_slope_2, flashing_detail, pipe_boots, cleanup, before, progress, after';


--
-- Name: COLUMN files.share_with_sub; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.files.share_with_sub IS 'If true, file is visible to assigned subcontractors';


--
-- Name: COLUMN files.job_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.files.job_id IS 'Direct link to production job for job-specific files';


--
-- Name: financing_programs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financing_programs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    lender_name text NOT NULL,
    financing_rate numeric(6,3) DEFAULT 0 NOT NULL,
    term_months integer DEFAULT 60 NOT NULL,
    dealer_fee_percent numeric(6,3) DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE financing_programs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.financing_programs IS 'Lender financing options; dealer_fee_percent is admin-only in product surfaces.';


--
-- Name: COLUMN financing_programs.dealer_fee_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.financing_programs.dealer_fee_percent IS 'Percent of financed contract total taken as dealer fee (internal).';


--
-- Name: founder_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.founder_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_by uuid,
    kind text NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    company text,
    notes text,
    client_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    emailed_at timestamp with time zone,
    CONSTRAINT founder_contacts_client_id_check CHECK ((char_length(client_id) <= 64)),
    CONSTRAINT founder_contacts_company_check CHECK ((char_length(company) <= 120)),
    CONSTRAINT founder_contacts_email_check CHECK ((char_length(email) <= 200)),
    CONSTRAINT founder_contacts_kind_check CHECK ((kind = ANY (ARRAY['realtor'::text, 'recruit'::text, 'other'::text]))),
    CONSTRAINT founder_contacts_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120))),
    CONSTRAINT founder_contacts_notes_check CHECK ((char_length(notes) <= 2000)),
    CONSTRAINT founder_contacts_phone_check CHECK ((char_length(phone) <= 40))
);


--
-- Name: inbound_lead_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbound_lead_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    lead_source_id uuid,
    campaign_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    assigned_to uuid,
    assigned_at timestamp with time zone,
    claimed_at timestamp with time zone,
    sla_deadline timestamp with time zone,
    first_contact_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inbound_lead_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'assigned'::text, 'claimed'::text, 'expired'::text])))
);


--
-- Name: TABLE inbound_lead_queue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inbound_lead_queue IS 'Queue for managing and assigning inbound leads';


--
-- Name: incentive_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incentive_badges (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    icon_key text DEFAULT 'star'::text NOT NULL,
    color_hex text DEFAULT '#F59E0B'::text NOT NULL,
    criteria_type public.badge_criteria_type NOT NULL,
    criteria_value numeric,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text
);


--
-- Name: incentive_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incentive_cycles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    cadence public.incentive_cycle_cadence NOT NULL,
    label text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    locked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspection_briefings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_briefings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    body text,
    bullets jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inspection_briefings_bullets_is_array CHECK ((jsonb_typeof(bullets) = 'array'::text))
);


--
-- Name: TABLE inspection_briefings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inspection_briefings IS 'One briefing per inspection appointment; body is freeform, bullets holds optional list (e.g. AI or checklist).';


--
-- Name: COLUMN inspection_briefings.bullets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inspection_briefings.bullets IS 'JSON array of strings, e.g. ["Check drip edge", "Photo all elevations"].';


--
-- Name: inspection_report_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_report_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    report_id uuid NOT NULL,
    storage_path text NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspection_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    created_by_user_id uuid,
    doc jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    share_token text DEFAULT replace(((gen_random_uuid())::text || (gen_random_uuid())::text), '-'::text, ''::text) NOT NULL,
    pdf_storage_path text,
    pdf_size_bytes bigint,
    pdf_generated_at timestamp with time zone,
    last_sent_to text,
    last_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pdf_photo_count integer,
    doc_updated_at timestamp with time zone,
    CONSTRAINT inspection_reports_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'ready'::text, 'sent'::text])))
);


--
-- Name: TABLE inspection_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inspection_reports IS 'Customer-facing roof inspection report documents. doc jsonb holds cover/summary/sections/captions; photos in inspection_report_photos + storage. NOT auto-deleted (unlike inspection_result_photos) — these are customer/insurance deliverables.';


--
-- Name: inspection_result_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_result_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    result_id uuid NOT NULL,
    storage_path text NOT NULL,
    filename text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE inspection_result_photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inspection_result_photos IS 'One row per uploaded inspection photo. All rows deleted after 30 days by daily cron job regardless of outcome.';


--
-- Name: inspection_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    submitted_by_user_id uuid,
    submitted_at timestamp with time zone,
    outcome text NOT NULL,
    both_dms_present boolean,
    absent_dm_name text,
    damage_found text,
    roof_slopes text,
    homeowner_emotional_state text,
    consequence_questions_asked boolean,
    insurance_mentioned boolean,
    urgency_level text,
    notes text,
    close_appointment_id uuid,
    briefing_email_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inspection_results_outcome_check CHECK ((outcome = ANY (ARRAY['approved'::text, 'denied'::text, 'follow_up'::text, 'not_home'::text, 'cancelled'::text, 'other'::text]))),
    CONSTRAINT inspection_results_urgency_level_check CHECK (((urgency_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])) OR (urgency_level IS NULL)))
);


--
-- Name: TABLE inspection_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inspection_results IS 'One post-inspection result per opportunity; captures outcome, briefing details, linked close appointment, and email delivery status.';


--
-- Name: COLUMN inspection_results.submitted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inspection_results.submitted_at IS 'Set by the application when the user submits the form; NULL until submission (drafts).';


--
-- Name: inspection_status_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_status_updates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    opportunity_id uuid,
    lead_id uuid,
    closer_user_id uuid,
    setter_user_id uuid,
    outcome text NOT NULL,
    notes text,
    setter_feedback text,
    prompted_at timestamp with time zone,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_user_name text
);


--
-- Name: instant_estimate_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instant_estimate_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    address text,
    lat double precision,
    lng double precision,
    opportunity_id uuid,
    production_job_id uuid,
    lead_id uuid,
    estimate_version text NOT NULL,
    measure_source text,
    confidence text,
    flags text[],
    est_base_squares numeric,
    est_waste_percent numeric,
    est_squares_with_waste numeric,
    calibration_factor numeric,
    truth_source text,
    truth_base_squares numeric,
    truth_squares_with_waste numeric,
    ordered_squares numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE instant_estimate_checks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.instant_estimate_checks IS 'Instant Estimate (shadow run) vs trusted squares per property and estimate_version. Service-role only; written by the instant-estimate-accuracy cron.';


--
-- Name: instant_estimate_calibration; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.instant_estimate_calibration WITH (security_invoker='true') AS
 WITH latest AS (
         SELECT DISTINCT ON (c.org_id, COALESCE(c.opportunity_id, c.production_job_id, c.id)) c.org_id,
            c.measure_source,
            c.truth_base_squares,
            (c.est_base_squares / NULLIF(COALESCE(NULLIF(c.calibration_factor, (0)::numeric), (1)::numeric), (0)::numeric)) AS raw_est_base_squares
           FROM public.instant_estimate_checks c
          WHERE ((c.created_at >= (now() - '365 days'::interval)) AND (c.truth_source = ANY (ARRAY['carrier_report'::text, 'manual'::text, 'in_house_manual'::text, 'lidar_reviewed'::text])) AND (NOT ((c.truth_source = 'lidar_reviewed'::text) AND (c.measure_source = 'lidar'::text))) AND (c.truth_base_squares > (0)::numeric) AND (c.est_base_squares > (0)::numeric) AND (c.measure_source IS NOT NULL) AND (c.measure_source !~~ 'error:%'::text))
          ORDER BY c.org_id, COALESCE(c.opportunity_id, c.production_job_id, c.id), c.created_at DESC
        )
 SELECT org_id,
    measure_source,
    (count(*))::integer AS n,
    percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY (((truth_base_squares / raw_est_base_squares))::double precision)) AS median_ratio,
    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY (((abs((raw_est_base_squares - truth_base_squares)) / truth_base_squares))::double precision)) * (100)::double precision) AS median_abs_pct_error
   FROM latest
  WHERE (raw_est_base_squares > (0)::numeric)
  GROUP BY org_id, measure_source;


--
-- Name: integration_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    provider public.integration_provider NOT NULL,
    is_enabled boolean DEFAULT false,
    api_key text,
    api_secret text,
    client_id text,
    access_token text,
    refresh_token text,
    token_expires_at timestamp with time zone,
    settings jsonb DEFAULT '{}'::jsonb,
    webhook_url text,
    webhook_secret text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integration_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    provider text NOT NULL,
    event_type text NOT NULL,
    entity_table text NOT NULL,
    entity_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.outbox_status DEFAULT 'pending'::public.outbox_status NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone
);


--
-- Name: TABLE integration_outbox; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.integration_outbox IS 'Outbox pattern for reliable integration events to external systems like QuickBooks';


--
-- Name: COLUMN integration_outbox.idempotency_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.integration_outbox.idempotency_key IS 'Unique key to prevent duplicate event processing: org:table:id:event:version';


--
-- Name: invoice_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    job_payment_id uuid NOT NULL,
    applied_cents integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT invoice_payments_applied_cents_check CHECK ((applied_cents > 0))
);


--
-- Name: job_additional_scope; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_additional_scope (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    description text NOT NULL,
    quantity numeric(10,2) DEFAULT 1 NOT NULL,
    unit text DEFAULT 'each'::text NOT NULL,
    unit_price numeric(12,2) DEFAULT 0 NOT NULL,
    line_total numeric(12,2) DEFAULT 0 NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE job_additional_scope; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_additional_scope IS 'Additional scope items added to jobs outside of the original proposal';


--
-- Name: COLUMN job_additional_scope.description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_additional_scope.description IS 'Description of the additional work item';


--
-- Name: COLUMN job_additional_scope.unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_additional_scope.unit IS 'Unit of measure (squares, lf, each, etc.)';


--
-- Name: job_change_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_change_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    project_id uuid NOT NULL,
    job_id uuid,
    co_number text NOT NULL,
    original_amount numeric(12,2) DEFAULT 0 NOT NULL,
    updated_total numeric(12,2) DEFAULT 0 NOT NULL,
    updated_remaining numeric(12,2) DEFAULT 0 NOT NULL,
    description text NOT NULL,
    customer_print_name text NOT NULL,
    customer_signature_data text NOT NULL,
    rep_name text NOT NULL,
    rep_signature_data text NOT NULL,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    pdf_url text,
    pdf_storage_path text,
    original_contract_id uuid,
    original_contract_date date,
    payment_method text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    signing_token text,
    token_expires_at timestamp with time zone,
    customer_email text,
    sent_at timestamp with time zone,
    customer_signed_at timestamp with time zone,
    is_commissionable boolean DEFAULT true NOT NULL
);


--
-- Name: TABLE job_change_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_change_orders IS 'Change orders that modify the original Installation Agreement';


--
-- Name: COLUMN job_change_orders.co_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_change_orders.co_number IS 'Sequential change order number per project (CO-001, CO-002, etc.)';


--
-- Name: COLUMN job_change_orders.original_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_change_orders.original_amount IS 'Original contract amount before this change order';


--
-- Name: COLUMN job_change_orders.updated_total; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_change_orders.updated_total IS 'New total project cost after this change order';


--
-- Name: COLUMN job_change_orders.updated_remaining; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_change_orders.updated_remaining IS 'Remaining balance after this change order';


--
-- Name: COLUMN job_change_orders.is_commissionable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_change_orders.is_commissionable IS 'When true, CO amount counts toward commission base (weekly payroll).';


--
-- Name: job_checkups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_checkups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    production_job_id uuid NOT NULL,
    customer_id uuid,
    opportunity_id uuid,
    month_offset integer NOT NULL,
    kind text NOT NULL,
    due_on date NOT NULL,
    status text DEFAULT 'due'::text NOT NULL,
    booked_for date,
    result text,
    notes text,
    attempts integer DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    last_activity_id uuid,
    assigned_user_id uuid,
    done_at timestamp with time zone,
    done_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT job_checkups_kind_check CHECK ((kind = ANY (ARRAY['inspection'::text, 'touch'::text]))),
    CONSTRAINT job_checkups_month_offset_check CHECK (((month_offset >= 1) AND (month_offset <= 600))),
    CONSTRAINT job_checkups_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 2000))),
    CONSTRAINT job_checkups_result_check CHECK ((result = ANY (ARRAY['green'::text, 'yellow'::text, 'red'::text]))),
    CONSTRAINT job_checkups_result_shape CHECK ((((kind = 'touch'::text) AND (result IS NULL)) OR ((kind = 'inspection'::text) AND ((status <> 'done'::text) OR (result IS NOT NULL))))),
    CONSTRAINT job_checkups_status_check CHECK ((status = ANY (ARRAY['due'::text, 'booked'::text, 'done'::text, 'declined'::text, 'unreachable'::text])))
);


--
-- Name: job_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    paid_at date NOT NULL,
    amount_cents integer NOT NULL,
    payment_type text NOT NULL,
    method text NOT NULL,
    payer text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    qb_payment_id text,
    sync_status public.sync_status DEFAULT 'pending'::public.sync_status,
    synced_to_qb_at timestamp with time zone,
    funding_status text DEFAULT 'cleared'::text NOT NULL,
    idempotency_key text,
    CONSTRAINT job_payments_funding_status_check CHECK ((funding_status = ANY (ARRAY['pending'::text, 'cleared'::text]))),
    CONSTRAINT job_payments_method_check CHECK ((method = ANY (ARRAY['check'::text, 'cash'::text, 'ach'::text, 'card'::text, 'financing'::text, 'insurance'::text, 'other'::text]))),
    CONSTRAINT job_payments_payer_check CHECK ((payer = ANY (ARRAY['homeowner'::text, 'insurance'::text, 'financing'::text, 'other'::text]))),
    CONSTRAINT job_payments_payment_type_check CHECK ((payment_type = ANY (ARRAY['deposit'::text, 'insurance_acv'::text, 'insurance_supplement'::text, 'deductible'::text, 'final'::text, 'other'::text])))
);


--
-- Name: COLUMN job_payments.funding_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_payments.funding_status IS 'cleared = counts toward fully funded; pending = ACH/check not cleared yet.';


--
-- Name: COLUMN job_payments.idempotency_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_payments.idempotency_key IS 'When set, unique per job_id; prevents accidental double-post from retries (see lib/weekly-payroll/explicit-rules.ts).';


--
-- Name: production_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    project_id uuid NOT NULL,
    customer_id uuid,
    job_number text NOT NULL,
    status text DEFAULT 'sold'::text NOT NULL,
    job_type text DEFAULT 'roofing'::text NOT NULL,
    address_text text NOT NULL,
    lat double precision,
    lng double precision,
    sale_amount numeric(12,2),
    sale_date date,
    salesperson_id uuid,
    materials_status text DEFAULT 'not_ordered'::text NOT NULL,
    materials_ordered_at timestamp with time zone,
    materials_eta date,
    materials_notes text,
    scheduled_date date,
    scheduled_time_start time without time zone,
    scheduled_time_end time without time zone,
    estimated_duration_hours numeric(4,1),
    assigned_crew_id uuid,
    assigned_sub_id uuid,
    permit_required boolean DEFAULT false NOT NULL,
    permit_status text DEFAULT 'not_needed'::text NOT NULL,
    permit_number text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    completion_notes text,
    before_photos text[] DEFAULT '{}'::text[],
    progress_photos text[] DEFAULT '{}'::text[],
    after_photos text[] DEFAULT '{}'::text[],
    labor_cost numeric(12,2),
    material_cost numeric(12,2),
    priority text DEFAULT 'normal'::text NOT NULL,
    internal_notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completion_certificate_work_description text,
    install_days integer,
    install_google_event_id text,
    install_calendar_id text,
    install_sync_failed_at timestamp with time zone,
    install_sync_error text,
    cancelled_at timestamp with time zone,
    cancelled_by_user_id uuid,
    cancellation_reason text,
    cancellation_notes text,
    close_balance_by uuid,
    close_balance_at timestamp with time zone,
    payroll_settled_externally_at timestamp with time zone,
    settled_externally_reason text,
    owner_user_id uuid,
    allow_close_with_balance boolean DEFAULT false,
    close_balance_reason text,
    deposit_required_percent numeric(3,2) DEFAULT 0.50,
    accepted_proposal_id uuid,
    accepted_estimate_id uuid,
    job_packet_pdf_path text,
    job_packet_generated_at timestamp with time zone,
    special_instructions text,
    linked_proposal_id uuid,
    finance_submitted_at timestamp with time zone,
    financing_program_id uuid,
    dealer_fee_percent numeric(6,3),
    dealer_fee_amount numeric(12,2),
    commission_pre_tax_subtotal numeric(12,2),
    commission_comp_base numeric(12,2),
    job_source text DEFAULT 'retail'::text NOT NULL,
    insurance_stage text,
    acv_amount numeric(12,2),
    depreciation_amount numeric(12,2),
    supplement_amount numeric(12,2),
    claim_number text,
    insurance_company text,
    payroll_sent_at timestamp with time zone,
    ntp_date date,
    ntp_commission_percent numeric(5,2),
    commission_hold_status text,
    CONSTRAINT production_jobs_cancellation_reason_check CHECK (((cancellation_reason IS NULL) OR (cancellation_reason = ANY (ARRAY['credit_fail'::text, 'customer_backed_out'::text, 'insurance_denied'::text, 'other'::text])))),
    CONSTRAINT production_jobs_cancellation_recorded CHECK (((status <> 'cancelled'::text) OR ((cancelled_at IS NOT NULL) AND (cancellation_reason IS NOT NULL) AND ((cancellation_reason <> 'other'::text) OR (length(btrim(COALESCE(cancellation_notes, ''::text))) > 0))))),
    CONSTRAINT production_jobs_commission_hold_status_check CHECK ((commission_hold_status = ANY (ARRAY['held_till_install'::text, 'released'::text]))),
    CONSTRAINT production_jobs_insurance_stage_check CHECK ((insurance_stage = ANY (ARRAY['contingency_signed'::text, 'claim_filed'::text, 'claim_approved'::text, 'acv_received'::text, 'job_complete'::text, 'depreciation_filed'::text, 'depreciation_received'::text, 'supplements_filed'::text, 'fully_collected'::text]))),
    CONSTRAINT production_jobs_job_source_check CHECK ((job_source = ANY (ARRAY['retail'::text, 'insurance'::text]))),
    CONSTRAINT production_jobs_materials_status_check CHECK ((materials_status = ANY (ARRAY['not_ordered'::text, 'ordered'::text, 'partial'::text, 'received'::text]))),
    CONSTRAINT production_jobs_permit_status_check CHECK ((permit_status = ANY (ARRAY['not_needed'::text, 'pending'::text, 'approved'::text, 'denied'::text]))),
    CONSTRAINT production_jobs_priority_check CHECK ((priority = ANY (ARRAY['normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT production_jobs_status_check CHECK ((status = ANY (ARRAY['sold'::text, 'materials'::text, 'scheduled'::text, 'in_progress'::text, 'complete'::text, 'collected'::text, 'on_hold'::text, 'cancelled'::text])))
);


--
-- Name: COLUMN production_jobs.labor_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.labor_cost IS 'LEGACY — not read or written by the app since 2026-10-21. Labor is a job_cost_lines row (cost_type labor). Values were moved by supabase/data-fixes/2026-10-21_one_cost_ledger.sql where the job had no labor lines.';


--
-- Name: COLUMN production_jobs.material_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.material_cost IS 'LEGACY — not read or written by the app since 2026-10-21. Values were moved into job_cost_lines by supabase/data-fixes/2026-10-21_one_cost_ledger.sql where the job had no material lines.';


--
-- Name: COLUMN production_jobs.completion_certificate_work_description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.completion_certificate_work_description IS 'Optional override text for the "WORK TYPE" line and intro sentence on the Certificate of Completion PDF. Falls back to job_type when null. Does not affect job_type or any comp/materials logic.';


--
-- Name: COLUMN production_jobs.close_balance_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.close_balance_by IS 'Super admin who forced this job paid in full despite a balance over $0.05. Null = not forced (a legacy allow_close_with_balance without this does not count).';


--
-- Name: COLUMN production_jobs.close_balance_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.close_balance_at IS 'When the paid-in-full override was set.';


--
-- Name: COLUMN production_jobs.payroll_settled_externally_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.payroll_settled_externally_at IS 'Set when this job''s commission was settled outside the CRM (before cutover). Excluded from payroll eligibility and Needs you; still counted in sales/profit reports. Clear it to bring the job back into CRM payroll.';


--
-- Name: COLUMN production_jobs.owner_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.owner_user_id IS 'Explicit job owner (job catch-up). Null = nobody set one; never inferred into this column.';


--
-- Name: COLUMN production_jobs.deposit_required_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.deposit_required_percent IS 'Percentage of sale_amount required as deposit (0.50 = 50%)';


--
-- Name: COLUMN production_jobs.accepted_proposal_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.accepted_proposal_id IS 'Link to the accepted proposal showing what was sold';


--
-- Name: COLUMN production_jobs.accepted_estimate_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.accepted_estimate_id IS 'Link to the accepted estimate showing what was sold';


--
-- Name: COLUMN production_jobs.job_packet_pdf_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.job_packet_pdf_path IS 'Storage path to generated job packet PDF for subs';


--
-- Name: COLUMN production_jobs.special_instructions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.special_instructions IS 'Special instructions to include in job packet for crews/subs';


--
-- Name: COLUMN production_jobs.linked_proposal_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.linked_proposal_id IS 'Manually linked proposal when auto-detection fails';


--
-- Name: COLUMN production_jobs.finance_submitted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.finance_submitted_at IS 'Set when the rep clicks "Submit for Finance Payment". Persists the banner state across page reloads.';


--
-- Name: COLUMN production_jobs.dealer_fee_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.dealer_fee_percent IS 'Internal; omit from rep-facing surfaces.';


--
-- Name: COLUMN production_jobs.commission_pre_tax_subtotal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.commission_pre_tax_subtotal IS 'RETIRED 2026-10-21. Cleared by lib/job-commission-base.ts; the base is no longer a pre-tax proposal figure.';


--
-- Name: COLUMN production_jobs.commission_comp_base; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.commission_comp_base IS 'Commission base = signed contract total + signed commissionable change orders, minus sales tax and dealer fee (dollars). One writer: lib/job-commission-base.ts.';


--
-- Name: COLUMN production_jobs.job_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.job_source IS 'retail = cash/direct sale; insurance = insurance claim job';


--
-- Name: COLUMN production_jobs.insurance_stage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.insurance_stage IS 'Current stage in the insurance claim lifecycle';


--
-- Name: COLUMN production_jobs.acv_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.acv_amount IS 'Actual Cash Value — first insurance payment';


--
-- Name: COLUMN production_jobs.depreciation_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.depreciation_amount IS 'Recoverable depreciation — second payment after job completion';


--
-- Name: COLUMN production_jobs.supplement_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.supplement_amount IS 'Approved supplements — additional payment for extra work found';


--
-- Name: COLUMN production_jobs.payroll_sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.payroll_sent_at IS 'When set, job was marked sent to payroll from the ops board or job detail.';


--
-- Name: COLUMN production_jobs.ntp_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.ntp_date IS 'Notice-to-proceed date for partial commission release.';


--
-- Name: COLUMN production_jobs.ntp_commission_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.ntp_commission_percent IS 'Percent of deal commission released at NTP (remainder at install).';


--
-- Name: COLUMN production_jobs.commission_hold_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_jobs.commission_hold_status IS 'held_till_install until install completes; released when paid out.';


--
-- Name: job_collection_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.job_collection_status WITH (security_invoker='true') AS
 SELECT j.org_id,
    j.id AS job_id,
    j.job_number,
    'USD'::text AS currency,
    (round((COALESCE(j.sale_amount, (0)::numeric) * (100)::numeric)))::bigint AS sale_amount_cents,
    (round((COALESCE(j.commission_comp_base, (0)::numeric) * (100)::numeric)))::bigint AS commission_base_cents,
    COALESCE(p.collected_cents, (0)::bigint) AS collected_cents,
    ((round((COALESCE(j.sale_amount, (0)::numeric) * (100)::numeric)) - (COALESCE(p.collected_cents, (0)::bigint))::numeric))::bigint AS remaining_cents,
        CASE
            WHEN (COALESCE(j.sale_amount, (0)::numeric) <= (0)::numeric) THEN 'no_sale_amount'::text
            WHEN ((round((j.sale_amount * (100)::numeric)) - (COALESCE(p.collected_cents, (0)::bigint))::numeric) <= (5)::numeric) THEN 'paid_in_full'::text
            WHEN ((j.allow_close_with_balance IS TRUE) AND (j.close_balance_by IS NOT NULL)) THEN 'forced_paid_in_full'::text
            WHEN (COALESCE(p.collected_cents, (0)::bigint) > 0) THEN 'partially_paid'::text
            ELSE 'unpaid'::text
        END AS collection_status,
    j.close_balance_by AS forced_paid_by,
    j.close_balance_at AS forced_paid_at,
    p.last_payment_at
   FROM (public.production_jobs j
     LEFT JOIN ( SELECT job_payments.job_id,
            sum(job_payments.amount_cents) FILTER (WHERE (job_payments.funding_status IS DISTINCT FROM 'pending'::text)) AS collected_cents,
            max(job_payments.created_at) AS last_payment_at
           FROM public.job_payments
          GROUP BY job_payments.job_id) p ON ((p.job_id = j.id)));


--
-- Name: VIEW job_collection_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.job_collection_status IS 'One row per job: sale amount, payments and the paid-in-full answer (lib/job-collection.ts). Cents, USD.';


--
-- Name: job_cost_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_cost_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    vendor_id uuid,
    description text NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    cost_type text DEFAULT 'other'::text NOT NULL,
    incurred_on date,
    notes text,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    approved boolean DEFAULT true NOT NULL,
    deduct_from_commission_base boolean DEFAULT true NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    source_product_order_id uuid,
    source public.job_cost_line_source,
    CONSTRAINT job_cost_lines_cost_type_check CHECK ((cost_type = ANY (ARRAY['material'::text, 'labor'::text, 'permit'::text, 'subcontractor'::text, 'misc'::text, 'other'::text]))),
    CONSTRAINT job_cost_lines_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: TABLE job_cost_lines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_cost_lines IS 'Job cost entries used by the costs panel';


--
-- Name: COLUMN job_cost_lines.approved; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_cost_lines.approved IS 'When false, job may be blocked from payroll until approved (weekly worksheet). Legacy rows default true.';


--
-- Name: COLUMN job_cost_lines.deduct_from_commission_base; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_cost_lines.deduct_from_commission_base IS 'When true, counted in deductible costs for commission base.';


--
-- Name: COLUMN job_cost_lines.approved_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_cost_lines.approved_by IS 'Payroll admin (admin/owner/operations) who last approved this line for commission deduction. Null while pending review.';


--
-- Name: COLUMN job_cost_lines.approved_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_cost_lines.approved_at IS 'When the line was last approved. Null while pending review.';


--
-- Name: COLUMN job_cost_lines.source_product_order_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_cost_lines.source_product_order_id IS 'Legacy job_product_orders row this line was mirrored from (one-time migration). Null for lines entered in the ledger directly.';


--
-- Name: COLUMN job_cost_lines.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_cost_lines.source IS 'Where the line came from: manual | product_order_mirror | legacy_column_import | dealer_fee_sync. NULL = pre-2026-10-21, unclassified.';


--
-- Name: job_cost_order_migration_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_cost_order_migration_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    product_order_id uuid NOT NULL,
    cost_line_id uuid,
    action text NOT NULL,
    amount numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_cost_order_migration_log_action_check CHECK ((action = ANY (ARRAY['inserted'::text, 'linked_existing'::text])))
);


--
-- Name: job_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_files (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    file_type public.job_file_type NOT NULL,
    storage_key text NOT NULL,
    file_name text NOT NULL,
    file_size integer,
    mime_type text DEFAULT 'application/pdf'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_signed boolean DEFAULT false NOT NULL,
    signed_at timestamp with time zone,
    signed_by uuid,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    share_with_sub boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN job_files.share_with_sub; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_files.share_with_sub IS 'If true, file is visible to assigned subcontractors';


--
-- Name: job_invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_invoice_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    description text NOT NULL,
    qty numeric(10,2) DEFAULT 1 NOT NULL,
    unit_price_cents integer NOT NULL,
    line_total_cents integer NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: job_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    invoice_number text NOT NULL,
    status public.invoice_status DEFAULT 'draft'::public.invoice_status NOT NULL,
    issued_at date,
    due_at date,
    sent_at timestamp with time zone,
    sent_to_email text,
    subtotal_cents integer DEFAULT 0 NOT NULL,
    total_cents integer DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    voided_at timestamp with time zone,
    void_reason text,
    pdf_path text,
    qb_invoice_id text,
    sync_status public.sync_status DEFAULT 'pending'::public.sync_status,
    synced_to_qb_at timestamp with time zone,
    invoice_kind text DEFAULT 'standard'::text,
    public_note text,
    internal_note text,
    CONSTRAINT invoice_void_requires_reason CHECK (((status <> 'void'::public.invoice_status) OR (void_reason IS NOT NULL))),
    CONSTRAINT job_invoices_kind_check CHECK ((invoice_kind = ANY (ARRAY['deposit'::text, 'final'::text, 'standard'::text])))
);


--
-- Name: COLUMN job_invoices.pdf_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_invoices.pdf_path IS 'Storage path for generated invoice PDF';


--
-- Name: COLUMN job_invoices.invoice_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_invoices.invoice_kind IS 'Type of invoice: deposit (50% upfront), final (remaining balance), standard (full contract)';


--
-- Name: COLUMN job_invoices.public_note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_invoices.public_note IS 'Customer-facing note/terms that appears on the printed invoice PDF';


--
-- Name: COLUMN job_invoices.internal_note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_invoices.internal_note IS 'Internal staff note - never shown on customer-facing documents';


--
-- Name: job_material_order_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_material_order_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    item_key text NOT NULL,
    qty_text text,
    excluded boolean DEFAULT false NOT NULL,
    note text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_id uuid,
    material_source public.material_source
);


--
-- Name: TABLE job_material_order_overrides; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_material_order_overrides IS 'Ops overrides for computed materials order list rows (qty, exclude, note).';


--
-- Name: job_measure_elevations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_measure_elevations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    report_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    job_id uuid,
    elevation_name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    wall_width_ft numeric(10,2) DEFAULT 0 NOT NULL,
    wall_height_ft numeric(10,2) DEFAULT 0 NOT NULL,
    gable_width_ft numeric(10,2) DEFAULT 0 NOT NULL,
    gable_height_ft numeric(10,2) DEFAULT 0 NOT NULL,
    waste_percent numeric(6,2),
    soffit_depth_ft numeric(10,2) DEFAULT 0 NOT NULL,
    soffit_length_ft numeric(10,2) DEFAULT 0 NOT NULL,
    fascia_lf numeric(10,2) DEFAULT 0 NOT NULL,
    gutter_lf numeric(10,2) DEFAULT 0 NOT NULL,
    starter_strip_lf numeric(10,2) DEFAULT 0 NOT NULL,
    j_channel_lf numeric(10,2) DEFAULT 0 NOT NULL,
    inside_corners integer DEFAULT 0 NOT NULL,
    outside_corners integer DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE job_measure_elevations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_measure_elevations IS 'Manual elevation measurements and accessory linears.';


--
-- Name: job_measure_openings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_measure_openings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    report_id uuid NOT NULL,
    elevation_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    job_id uuid,
    opening_type text DEFAULT 'window'::text NOT NULL,
    label text,
    quantity integer DEFAULT 1 NOT NULL,
    width_ft numeric(10,2) DEFAULT 0 NOT NULL,
    height_ft numeric(10,2) DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_measure_openings_opening_type_check CHECK ((opening_type = ANY (ARRAY['window'::text, 'door'::text, 'garage_door'::text, 'other'::text])))
);


--
-- Name: TABLE job_measure_openings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_measure_openings IS 'Windows, doors, and other deductions tied to an elevation.';


--
-- Name: job_measure_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_measure_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    report_id uuid NOT NULL,
    elevation_id uuid,
    opening_id uuid,
    opportunity_id uuid NOT NULL,
    job_id uuid,
    storage_path text NOT NULL,
    filename text NOT NULL,
    file_size integer,
    mime_type text,
    caption text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE job_measure_photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_measure_photos IS 'Measure photos attached to opportunity reports, elevations, or openings.';


--
-- Name: job_measure_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_measure_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    job_id uuid,
    measure_kind text DEFAULT 'siding'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    report_title text DEFAULT 'ARX Exterior Measure Report'::text NOT NULL,
    waste_percent numeric(6,2) DEFAULT 10 NOT NULL,
    notes text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_measure_reports_measure_kind_check CHECK ((measure_kind = ANY (ARRAY['roof'::text, 'siding'::text, 'windows'::text, 'gutters_soffit_fascia'::text, 'full_exterior'::text]))),
    CONSTRAINT job_measure_reports_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'reviewed'::text, 'final'::text])))
);


--
-- Name: TABLE job_measure_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_measure_reports IS 'Opportunity-first ARX Exterior Measure reports with optional production job linkage.';


--
-- Name: job_payroll_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_payroll_state (
    job_id uuid NOT NULL,
    org_id uuid NOT NULL,
    install_completed_at timestamp with time zone,
    fully_funded_at timestamp with time zone,
    costs_ready_at timestamp with time zone,
    payroll_eligible_at timestamp with time zone,
    payroll_cutoff_at timestamp with time zone,
    scheduled_pay_date date,
    locked_at timestamp with time zone,
    paid_at timestamp with time zone,
    current_payroll_period_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ntp_completed_at timestamp with time zone
);


--
-- Name: COLUMN job_payroll_state.payroll_eligible_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_payroll_state.payroll_eligible_at IS 'max(install_completed_at, fully_funded_at, costs_ready_at) when all set.';


--
-- Name: COLUMN job_payroll_state.payroll_cutoff_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_payroll_state.payroll_cutoff_at IS 'Cutoff timestamp for the period this job was assigned to (or rolled).';


--
-- Name: COLUMN job_payroll_state.ntp_completed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_payroll_state.ntp_completed_at IS 'When NTP was recorded for payroll eligibility (NTP tranche).';


--
-- Name: job_product_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_product_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    description text NOT NULL,
    supplier text,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    status public.job_product_order_status DEFAULT 'ordered'::public.job_product_order_status NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE job_product_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_product_orders IS 'LEGACY — read-only history since 2026-10-21. Every row is mirrored into job_cost_lines (source_product_order_id); the app no longer reads or writes this table. Kept, not dropped (additive-only schema rule).';


--
-- Name: COLUMN job_product_orders.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_product_orders.status IS 'Order status: ordered, received, paid, returned';


--
-- Name: job_run_sheet_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_run_sheet_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    schedule_note text,
    scope_of_work text,
    materials_and_products text,
    tear_off_and_decking text,
    accessories text,
    add_ons_sold text,
    heads_up text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE job_run_sheet_overrides; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_run_sheet_overrides IS 'Ops edits to the printable job run sheet. NULL column = use the CRM-computed value.';


--
-- Name: job_trade_material_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_trade_material_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    trade text NOT NULL,
    material_source public.material_source,
    vendor_id uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    customer_id uuid,
    lead_id uuid,
    status public.job_status DEFAULT 'open'::public.job_status NOT NULL,
    job_type public.job_type DEFAULT 'roofing'::public.job_type NOT NULL,
    address_text text,
    lat numeric(10,8),
    lng numeric(11,8),
    roof_squares numeric(10,2),
    siding_squares numeric(10,2),
    vents_count integer DEFAULT 0 NOT NULL,
    layers integer DEFAULT 1 NOT NULL,
    total_windows integer DEFAULT 0 NOT NULL,
    windows_by_type jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_user_id uuid,
    contract_sent_at timestamp with time zone,
    contract_uploaded_at timestamp with time zone,
    scope_of_work text,
    permits_status text,
    product_summary text,
    install_date date,
    ops_notes text,
    contract_pdf_path text
);


--
-- Name: lead_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    source_type public.lead_source_type NOT NULL,
    webhook_token text DEFAULT encode(extensions.gen_random_bytes(32), 'hex'::text) NOT NULL,
    webhook_enabled boolean DEFAULT true NOT NULL,
    default_campaign_id uuid,
    field_mapping jsonb DEFAULT '{"name": "name", "email": "email", "phone": "phone", "address": "address", "message": "notes"}'::jsonb,
    auto_assign_user_id uuid,
    auto_assign_team_id uuid,
    round_robin_enabled boolean DEFAULT false NOT NULL,
    notify_on_new_lead boolean DEFAULT true NOT NULL,
    notification_emails text[],
    is_active boolean DEFAULT true NOT NULL,
    total_leads_received integer DEFAULT 0 NOT NULL,
    last_lead_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE lead_sources; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.lead_sources IS 'Webhook endpoints and configurations for receiving inbound leads';


--
-- Name: lidar_tiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lidar_tiles (
    id text NOT NULL,
    dataset text NOT NULL,
    tile_name text NOT NULL,
    source_url text NOT NULL,
    min_lng double precision NOT NULL,
    min_lat double precision NOT NULL,
    max_lng double precision NOT NULL,
    max_lat double precision NOT NULL,
    collected_end date,
    priority integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    storage_path text,
    total_points bigint,
    building_points integer,
    stored_bytes integer,
    error text,
    attempts integer DEFAULT 0 NOT NULL,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lidar_tiles_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: management_comp_overlay_plan_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.management_comp_overlay_plan_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    comp_plan_id uuid NOT NULL,
    lane text NOT NULL,
    override_percent numeric(5,2) NOT NULL,
    effective_from date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid NOT NULL,
    change_reason text NOT NULL,
    CONSTRAINT management_overlay_version_lane_check CHECK ((lane = ANY (ARRAY['setter'::text, 'closer'::text]))),
    CONSTRAINT management_overlay_version_rate_check CHECK (((override_percent >= (0)::numeric) AND (override_percent <= (100)::numeric))),
    CONSTRAINT management_overlay_version_reason_check CHECK ((length(btrim(change_reason)) > 0))
);


--
-- Name: TABLE management_comp_overlay_plan_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.management_comp_overlay_plan_versions IS 'Append-only fixed-rate management overlay terms by comp plan, lane, and effective date. No row for a sale date means no derived manager override.';


--
-- Name: material_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    supplier text NOT NULL,
    order_number text,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    ordered_at timestamp with time zone,
    expected_delivery date,
    delivered_at timestamp with time zone,
    total_cost numeric(12,2),
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT material_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ordered'::text, 'shipped'::text, 'delivered'::text])))
);


--
-- Name: measurement_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurement_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    measurement_id uuid,
    provider public.integration_provider NOT NULL,
    address_text text NOT NULL,
    lat numeric(10,7),
    lng numeric(10,7),
    external_order_id text,
    status public.measurement_status DEFAULT 'pending'::public.measurement_status NOT NULL,
    error_message text,
    callback_received_at timestamp with time zone,
    requested_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mobile_device_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_device_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    device_token text NOT NULL,
    platform text DEFAULT 'ios'::text NOT NULL,
    environment text DEFAULT 'production'::text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE mobile_device_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mobile_device_tokens IS 'APNs device tokens for ARX Sales iOS; upserted via /api/mobile/push-token';


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    recipient_user_id uuid NOT NULL,
    actor_user_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    link_url text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb,
    thread_id uuid,
    activity_id uuid,
    priority text,
    resolved_at timestamp with time zone,
    resolution text,
    snoozed_until timestamp with time zone
);


--
-- Name: opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    customer_id uuid,
    lead_id uuid,
    owner_user_id uuid,
    status public.opportunity_status DEFAULT 'open'::public.opportunity_status NOT NULL,
    project_type public.project_type DEFAULT 'roofing'::public.project_type NOT NULL,
    address_text text,
    lat numeric(10,8),
    lng numeric(11,8),
    roof_squares numeric(10,2),
    siding_squares numeric(10,2),
    vents_count integer DEFAULT 0 NOT NULL,
    layers integer DEFAULT 1 NOT NULL,
    total_windows integer DEFAULT 0 NOT NULL,
    windows_by_type jsonb,
    notes text,
    design_pdf_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    inspection_outcome text,
    inspection_outcome_at timestamp with time zone,
    inspection_notes text,
    job_source text DEFAULT 'retail'::text NOT NULL,
    insurance_stage text,
    follow_up_at timestamp with time zone,
    pipeline_stage text,
    assigned_user_id uuid,
    knockback_reason text,
    knockback_follow_up_months integer,
    handoff_context jsonb,
    is_self_generated boolean,
    self_generated_source text,
    referral_partner_id uuid,
    estimated_value numeric,
    setter_user_id uuid,
    CONSTRAINT opportunities_insurance_stage_check CHECK ((insurance_stage = ANY (ARRAY['contingency_signed'::text, 'claim_filed'::text, 'claim_approved'::text, 'acv_received'::text, 'job_complete'::text, 'depreciation_filed'::text, 'depreciation_received'::text, 'supplements_filed'::text, 'fully_collected'::text]))),
    CONSTRAINT opportunities_job_source_check CHECK ((job_source = ANY (ARRAY['retail'::text, 'insurance'::text]))),
    CONSTRAINT opportunities_knockback_follow_up_months_check CHECK (((knockback_follow_up_months = ANY (ARRAY[2, 4, 6])) OR (knockback_follow_up_months IS NULL))),
    CONSTRAINT opportunities_knockback_reason_check CHECK (((knockback_reason = ANY (ARRAY['credit_fail'::text, 'not_ready'::text, 'price_objection'::text])) OR (knockback_reason IS NULL))),
    CONSTRAINT opportunities_self_generated_source_check CHECK (((self_generated_source IS NULL) OR (self_generated_source = ANY (ARRAY['inferred_setter_equals_owner'::text, 'manual'::text]))))
);


--
-- Name: COLUMN opportunities.job_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.opportunities.job_source IS 'retail vs insurance captured before production job exists';


--
-- Name: COLUMN opportunities.insurance_stage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.opportunities.insurance_stage IS 'Insurance claim lifecycle stage while still in sales pipeline';


--
-- Name: COLUMN opportunities.knockback_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.opportunities.knockback_reason IS 'Reason closer marked lead as not-closed: credit_fail, not_ready, price_objection';


--
-- Name: COLUMN opportunities.knockback_follow_up_months; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.opportunities.knockback_follow_up_months IS 'Months until inside sales should follow up: 2, 4, or 6';


--
-- Name: COLUMN opportunities.is_self_generated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.opportunities.is_self_generated IS 'True when the closer sourced this deal themselves (no separate setter). Read by payroll for the self-gen commission line. NULL means never reviewed and is treated as not self-generated.';


--
-- Name: COLUMN opportunities.self_generated_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.opportunities.self_generated_source IS 'How is_self_generated got its value: ''inferred_setter_equals_owner'' = seeded by the backfill in migration 202608050003 from setter_user_id = owner_user_id; ''manual'' = set by a human. Keeps the derivation distinguishable from a confirmed value so a payroll admin can see which rows were guessed.';


--
-- Name: order_form_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_form_contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid,
    proposal_id uuid,
    customer_name text NOT NULL,
    customer_email text,
    customer_phone text,
    project_address text NOT NULL,
    project_cost numeric(12,2) DEFAULT 0 NOT NULL,
    total_squares numeric(10,2),
    roofing_material text,
    scope_roof_replacement boolean DEFAULT false,
    scope_roof_repair boolean DEFAULT false,
    scope_gutters boolean DEFAULT false,
    scope_siding boolean DEFAULT false,
    scope_other text,
    payment_method public.contract_payment_method DEFAULT 'cash'::public.contract_payment_method,
    finance_company text,
    deposit_amount numeric(12,2) DEFAULT 0,
    est_completion_date date,
    exclusions text,
    additional_products text,
    notes text,
    preferred_contact text,
    customer_print_name text,
    customer_initials_change_orders text,
    customer_initials_property_condition text,
    customer_initials_landscaping text,
    customer_initials_insurance text,
    rep_name text,
    rep_title text,
    rep_signature_data text,
    rep_signed_at timestamp with time zone,
    rep_ip text,
    customer_signature_data text,
    customer_signed_at timestamp with time zone,
    customer_ip text,
    signing_token uuid DEFAULT gen_random_uuid() NOT NULL,
    token_expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    status public.contract_signing_status DEFAULT 'draft'::public.contract_signing_status NOT NULL,
    pdf_url text,
    pdf_storage_path text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    agreement_type text DEFAULT 'installation'::text NOT NULL,
    roofing_color_style text,
    CONSTRAINT order_form_contracts_agreement_type_check CHECK ((agreement_type = ANY (ARRAY['installation'::text, 'contingency'::text, 'repair'::text]))),
    CONSTRAINT order_form_contracts_preferred_contact_check CHECK ((preferred_contact = ANY (ARRAY['phone'::text, 'email'::text])))
);


--
-- Name: TABLE order_form_contracts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.order_form_contracts IS 'Custom in-app contract signing system for ARX order forms';


--
-- Name: COLUMN order_form_contracts.rep_signature_data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_form_contracts.rep_signature_data IS 'Base64 encoded signature image from canvas';


--
-- Name: COLUMN order_form_contracts.customer_signature_data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_form_contracts.customer_signature_data IS 'Base64 encoded signature image from canvas';


--
-- Name: COLUMN order_form_contracts.signing_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_form_contracts.signing_token IS 'Unique token for customer signing link';


--
-- Name: COLUMN order_form_contracts.token_expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_form_contracts.token_expires_at IS 'Token expires 7 days after creation';


--
-- Name: COLUMN order_form_contracts.agreement_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_form_contracts.agreement_type IS 'installation = full install agreement; contingency = insurance claim authorization; repair = limited-scope repair/work authorization';


--
-- Name: org_default_comp_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_default_comp_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    role text NOT NULL,
    comp_plan_id uuid NOT NULL,
    effective_from date NOT NULL,
    change_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE org_default_comp_plans; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.org_default_comp_plans IS 'Per-role fallback pay plan, effective-dated. A later row for the same role supersedes an earlier one from its effective_from; nothing is ever edited in place.';


--
-- Name: org_derived_commission_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_derived_commission_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    inspection_commission_rate numeric(5,2) DEFAULT 0 NOT NULL,
    manager_override_commission_rate numeric(5,2) DEFAULT 0 NOT NULL,
    self_gen_commission_rate numeric(5,2) DEFAULT 0 NOT NULL,
    effective_from date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid,
    change_reason text,
    superseded_at timestamp with time zone
);


--
-- Name: TABLE org_derived_commission_rates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.org_derived_commission_rates IS 'Immutable-by-date derived commission rates. Payroll resolves the latest row on or before the job sale date so later rate changes never rewrite historical pay.';


--
-- Name: COLUMN org_derived_commission_rates.created_by_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.org_derived_commission_rates.created_by_user_id IS 'Payroll admin who saved this rate row via upsert_org_derived_commission_rates. NULL on rows created by the orgs-column AFTER UPDATE trigger or by the original migration 202608050002 backfill.';


--
-- Name: COLUMN org_derived_commission_rates.change_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.org_derived_commission_rates.change_reason IS 'Free-text reason required on every admin-initiated save. NULL on trigger/backfill rows.';


--
-- Name: COLUMN org_derived_commission_rates.superseded_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.org_derived_commission_rates.superseded_at IS 'Reserved for future use; not set by this migration.';


--
-- Name: org_monthly_goal_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_monthly_goal_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    goal_id uuid NOT NULL,
    org_id uuid NOT NULL,
    changed_by uuid,
    changes jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_monthly_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_monthly_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    month date NOT NULL,
    doors_target integer,
    sets_target integer,
    sits_target integer,
    sales_target integer,
    revenue_target numeric(12,2),
    notes text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_trade_material_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_trade_material_defaults (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    trade text NOT NULL,
    material_source public.material_source NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_trades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    match_keywords text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT org_trades_label_check CHECK (((char_length(btrim(label)) >= 1) AND (char_length(btrim(label)) <= 40))),
    CONSTRAINT org_trades_slug_check CHECK (((slug ~ '^[a-z][a-z0-9_]{0,39}$'::text) AND (slug <> 'mixed'::text)))
);


--
-- Name: orgs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orgs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb,
    phone text,
    email text,
    address text,
    timezone text DEFAULT 'America/New_York'::text,
    date_format text DEFAULT 'MM/DD/YYYY'::text,
    currency text DEFAULT 'USD'::text,
    logo_url text,
    inspection_feedback_buffer_minutes integer DEFAULT 0 NOT NULL,
    default_scheduling_gap_minutes integer DEFAULT 15 NOT NULL,
    program_444_week_bonus_amount numeric(10,2) DEFAULT 400,
    program_444_week_bonus_label text DEFAULT '$400'::text NOT NULL,
    starter_lf_per_bundle numeric,
    cap_lf_per_bundle numeric,
    underlayment_sq_per_roll numeric,
    ridge_vent_lf_per_piece numeric,
    ridge_vent_end_setback_ft numeric,
    ice_water_lf_per_roll numeric,
    setter_ramp_weekly_floor_amount numeric(10,2) DEFAULT 500 NOT NULL,
    setter_ramp_commission_rate numeric(5,2) DEFAULT 3 NOT NULL,
    setter_ramp_week3_avg_target numeric(6,2) DEFAULT 10 NOT NULL,
    setter_ramp_avg_window_weeks integer DEFAULT 4 NOT NULL,
    inspection_commission_rate numeric(5,2) DEFAULT 0 NOT NULL,
    manager_override_commission_rate numeric(5,2) DEFAULT 0 NOT NULL,
    self_gen_commission_rate numeric(5,2) DEFAULT 0 NOT NULL,
    inside_sales_sit_credit_enabled boolean DEFAULT false NOT NULL,
    inside_sales_sit_credit_effective_from date,
    install_scheduling_user_id uuid,
    install_scheduling_calendar_id text,
    supplier_api_ordering_enabled boolean DEFAULT false NOT NULL,
    supplier_api_second_approval_cents integer DEFAULT 1000000 NOT NULL
);


--
-- Name: COLUMN orgs.settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.settings IS 'Org JSON settings. Payroll: payroll_schedule, commission_release (NTP/install release model).';


--
-- Name: COLUMN orgs.phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.phone IS 'Organization primary phone number';


--
-- Name: COLUMN orgs.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.email IS 'Organization primary email address';


--
-- Name: COLUMN orgs.address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.address IS 'Organization physical address';


--
-- Name: COLUMN orgs.timezone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.timezone IS 'Organization timezone (e.g., America/New_York)';


--
-- Name: COLUMN orgs.date_format; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.date_format IS 'Preferred date format (e.g., MM/DD/YYYY)';


--
-- Name: COLUMN orgs.currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.currency IS 'Default currency code (e.g., USD)';


--
-- Name: COLUMN orgs.logo_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.logo_url IS 'URL to the organization logo image';


--
-- Name: COLUMN orgs.inspection_feedback_buffer_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.inspection_feedback_buffer_minutes IS 'Legacy: was added after slot end for prompt timing; app now prompts at appointment start. May be reused later.';


--
-- Name: COLUMN orgs.default_scheduling_gap_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.default_scheduling_gap_minutes IS 'Default gap between appointments when closer-specific buffers are not set (round-robin / DB conflict checks).';


--
-- Name: COLUMN orgs.setter_ramp_avg_window_weeks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.setter_ramp_avg_window_weeks IS 'Trailing rolling-average window (in weeks) used to evaluate the week 3+ "N appointments/week on average" gate. Confirm with ops before trusting week 3+ results — this was set to a reasonable default (4), not a confirmed business rule.';


--
-- Name: COLUMN orgs.inspection_commission_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.inspection_commission_rate IS 'Percent of a job''s commission base paid to the rep who inspected it, applied when no explicit deal_commission_roles inspector row exists for that job. 0 disables the derived inspection line entirely. Counts inside the sales commission pool cap.';


--
-- Name: COLUMN orgs.manager_override_commission_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.manager_override_commission_rate IS 'Legacy manager override setting retained for compatibility. Payroll manager overrides now resolve from effective-dated management overlay plan versions.';


--
-- Name: COLUMN orgs.self_gen_commission_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.self_gen_commission_rate IS 'Percent of a job''s commission base paid to the closer on a self-generated deal (opportunities.is_self_generated = true), on top of their normal close commission. Suppressed when the opportunity also carries a different setter — that combination is contradictory and would breach the 18 percent pool cap. Applied only when no explicit deal_commission_roles self_gen row exists for that job. 0 disables the derived line entirely. Counts inside the sales commission pool cap.';


--
-- Name: COLUMN orgs.inside_sales_sit_credit_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.inside_sales_sit_credit_enabled IS 'Master switch for the inside-sales booker sit credit. 0/false disables it entirely. Requires inside_sales_sit_credit_effective_from to also be set.';


--
-- Name: COLUMN orgs.inside_sales_sit_credit_effective_from; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.inside_sales_sit_credit_effective_from IS 'Earliest appointment date eligible for the inside-sales sit credit. NULL means no credit is paid even when inside_sales_sit_credit_enabled is true — this protects already-locked and already-paid payroll periods from a retroactive recompute.';


--
-- Name: COLUMN orgs.install_scheduling_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.install_scheduling_user_id IS 'Staff user whose connected Google account install events are written from and whose token reads subcontractor free/busy. Subcontractors share their calendar with this user''s email. NULL falls back to the acting user.';


--
-- Name: COLUMN orgs.install_scheduling_calendar_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.install_scheduling_calendar_id IS 'Google calendar ID install events are written to (e.g. c_xxx@group.calendar.google.com), owned by orgs.install_scheduling_user_id. NULL falls back to GOOGLE_INSTALL_CALENDAR_ID, then that account''s primary calendar.';


--
-- Name: COLUMN orgs.supplier_api_ordering_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.supplier_api_ordering_enabled IS 'Org kill switch for ordering through a supplier API. Default off.';


--
-- Name: COLUMN orgs.supplier_api_second_approval_cents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orgs.supplier_api_second_approval_cents IS 'API orders at/over this estimated total (cents), or with an unknown total, need a second person to approve.';


--
-- Name: payroll_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    payroll_period_id uuid NOT NULL,
    user_id uuid NOT NULL,
    job_id uuid,
    amount numeric(14,2) NOT NULL,
    reason text NOT NULL,
    kind text DEFAULT 'fix'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    source_period_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_at timestamp with time zone,
    CONSTRAINT payroll_adjustments_amount_check CHECK ((amount <> (0)::numeric)),
    CONSTRAINT payroll_adjustments_kind_check CHECK ((kind = ANY (ARRAY['fix'::text, 'balance'::text, 'chargeback'::text, 'resplit'::text, 'topup'::text]))),
    CONSTRAINT payroll_adjustments_reason_check CHECK ((char_length(btrim(reason)) > 0)),
    CONSTRAINT payroll_adjustments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'applied'::text, 'void'::text])))
);


--
-- Name: TABLE payroll_adjustments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payroll_adjustments IS 'Signed lines added to a payroll period (fixes after a paid week, carried-forward negative balances). Counted in the period total while status <> void.';


--
-- Name: payroll_bonus_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_bonus_lines (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    payroll_period_id uuid NOT NULL,
    user_id uuid NOT NULL,
    bonus_type text NOT NULL,
    amount numeric(14,2) NOT NULL,
    description text,
    source_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status public.bonus_status DEFAULT 'pending_approval'::public.bonus_status NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    CONSTRAINT payroll_bonus_lines_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payroll_bonus_lines_bonus_type_check CHECK ((bonus_type = ANY (ARRAY['444_week1'::text, '444_week2'::text, 'setter_weekly_floor'::text, 'manual'::text])))
);


--
-- Name: COLUMN payroll_bonus_lines.source_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payroll_bonus_lines.source_id IS 'Soft ref (no FK, kept flexible): program_444_enrollments.id for 444 bonuses, setter_ramp_weekly_status.id for setter_weekly_floor top-ups.';


--
-- Name: payroll_chargeback_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_chargeback_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chargeback_id uuid NOT NULL,
    payroll_period_id uuid NOT NULL,
    payout_line_id uuid NOT NULL,
    applied_amount numeric(14,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payroll_chargebacks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_chargebacks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    job_id uuid,
    original_amount numeric(14,2) NOT NULL,
    remaining_amount numeric(14,2) NOT NULL,
    reason text,
    status text DEFAULT 'open'::text NOT NULL,
    apply_period_id uuid,
    created_by uuid,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payroll_chargebacks_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
);


--
-- Name: payroll_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_disputes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    payroll_period_id uuid,
    job_id uuid,
    line_label text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    reply text,
    adjustment_id uuid,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payroll_disputes_message_check CHECK ((char_length(btrim(message)) > 0)),
    CONSTRAINT payroll_disputes_status_check CHECK ((status = ANY (ARRAY['open'::text, 'answered'::text, 'fixed'::text, 'rejected'::text])))
);


--
-- Name: payroll_job_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_job_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    payroll_period_snapshot_id uuid NOT NULL,
    payroll_period_id uuid NOT NULL,
    job_id uuid NOT NULL,
    contract_total numeric(14,2),
    signed_change_orders_total numeric(14,2),
    commissionable_change_orders_total numeric(14,2),
    dealer_fee numeric(14,2),
    deductible_costs_total numeric(14,2),
    commission_base numeric(14,2),
    chargebacks_applied numeric(14,2) DEFAULT 0 NOT NULL,
    comp_plan_version jsonb,
    participants jsonb DEFAULT '[]'::jsonb NOT NULL,
    gross_payout_total numeric(14,2),
    net_payout_total numeric(14,2),
    pay_date date,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payroll_override_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_override_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    override_type text NOT NULL,
    job_id uuid,
    payroll_period_id uuid,
    actor_user_id uuid NOT NULL,
    reason text NOT NULL,
    before_value jsonb,
    after_value jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payroll_override_audit_override_type_check CHECK ((override_type = ANY (ARRAY['include_after_cutoff'::text, 'off_cycle_payout'::text, 'waive_missing_cost'::text, 'manual_adjustment'::text, 'push_chargeback_next_period'::text, 'override_pay_date'::text, 'force_paid_in_full'::text, 'sale_credit_change'::text, 'settle_externally'::text, 'unsettle_externally'::text])))
);


--
-- Name: payroll_payout_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_payout_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    payroll_period_id uuid NOT NULL,
    payroll_job_snapshot_id uuid NOT NULL,
    job_id uuid NOT NULL,
    user_id uuid NOT NULL,
    participant_role text NOT NULL,
    gross_amount numeric(14,2) DEFAULT 0 NOT NULL,
    net_amount numeric(14,2) DEFAULT 0 NOT NULL,
    chargeback_applied_amount numeric(14,2) DEFAULT 0 NOT NULL,
    comp_plan_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    hourly_earnings numeric(14,2) DEFAULT 0 NOT NULL,
    total_earnings numeric(14,2) GENERATED ALWAYS AS ((COALESCE(hourly_earnings, (0)::numeric) + net_amount)) STORED
);


--
-- Name: COLUMN payroll_payout_lines.hourly_earnings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payroll_payout_lines.hourly_earnings IS 'Hourly pay for this period (not subject to 18% pool cap).';


--
-- Name: COLUMN payroll_payout_lines.total_earnings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payroll_payout_lines.total_earnings IS 'hourly_earnings + net_amount; COALESCE on hourly so historical rows stay non-null.';


--
-- Name: payroll_period_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_period_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    payroll_period_id uuid NOT NULL,
    locked_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_by uuid
);


--
-- Name: payroll_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    period_label text NOT NULL,
    cutoff_at timestamp with time zone NOT NULL,
    lock_at timestamp with time zone NOT NULL,
    scheduled_pay_date date NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    locked_at timestamp with time zone,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lock_claimed_at timestamp with time zone,
    lock_claim_token uuid,
    units_frozen_at timestamp with time zone,
    CONSTRAINT payroll_periods_status_check CHECK ((status = ANY (ARRAY['open'::text, 'locked'::text, 'paid'::text, 'cancelled'::text])))
);


--
-- Name: TABLE payroll_periods; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payroll_periods IS 'Weekly payroll windows; cutoff_at = end of eligibility for that run (Wed 11:59:59 PM ET).';


--
-- Name: COLUMN payroll_periods.lock_claimed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payroll_periods.lock_claimed_at IS 'Set while a lock is materializing this period (payroll_claim_period_lock). Older than 15 min = crashed, retakeable.';


--
-- Name: COLUMN payroll_periods.lock_claim_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payroll_periods.lock_claim_token IS 'Token of the request holding the lock claim; the final flip to locked must match it.';


--
-- Name: COLUMN payroll_periods.units_frozen_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payroll_periods.units_frozen_at IS 'Set by payroll_commit_week. NULL on a locked period = locked before per-unit pay was frozen (readers recompute, as they always did).';


--
-- Name: payroll_rep_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_rep_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    payroll_period_id uuid NOT NULL,
    user_id uuid NOT NULL,
    regular_hours numeric(7,2) DEFAULT 0 NOT NULL,
    overtime_hours numeric(7,2) DEFAULT 0 NOT NULL,
    hourly_rate_snapshot numeric(10,2),
    hourly_earnings numeric(14,2),
    notes text,
    locked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payroll_rep_hours_overtime_hours_check CHECK ((overtime_hours >= (0)::numeric)),
    CONSTRAINT payroll_rep_hours_regular_hours_check CHECK ((regular_hours >= (0)::numeric))
);


--
-- Name: TABLE payroll_rep_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payroll_rep_hours IS 'Admin-entered regular/OT hours and computed hourly pay per rep per payroll period.';


--
-- Name: payroll_rep_hours_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_rep_hours_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    rep_hours_id uuid NOT NULL,
    payroll_period_id uuid NOT NULL,
    user_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    field_changed text NOT NULL,
    old_value text,
    new_value text,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payroll_statement_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_statement_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    payroll_period_id uuid NOT NULL,
    user_id uuid NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id uuid NOT NULL,
    status text NOT NULL,
    error_message text,
    statement_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payroll_statement_deliveries_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])))
);


--
-- Name: payroll_unit_earnings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_unit_earnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    payroll_period_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount numeric(14,2) NOT NULL,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE payroll_unit_earnings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payroll_unit_earnings IS 'Per-unit pay frozen when a week is approved. Locked/paid weeks read this, never a recalculation.';


--
-- Name: pending_status_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_status_prompts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    closer_user_id uuid NOT NULL,
    prompt_at timestamp with time zone NOT NULL,
    dismissed boolean DEFAULT false NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    snooze_count integer DEFAULT 0 NOT NULL
);


--
-- Name: permission_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    actor_user_id uuid,
    target_user_id uuid NOT NULL,
    permission_name text NOT NULL,
    action text NOT NULL,
    before_state text,
    after_state text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT permission_audit_action_check CHECK ((action = ANY (ARRAY['grant'::text, 'deny'::text, 'default'::text])))
);


--
-- Name: permission_denials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_denials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    permission_name text NOT NULL,
    denied_by uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT permission_denials_permission_name_check CHECK ((permission_name = ANY (ARRAY['reports:financials'::text, 'money:record'::text])))
);


--
-- Name: permission_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    base_role text DEFAULT 'sales_rep'::text NOT NULL,
    icon text,
    color text DEFAULT 'gray'::text,
    is_system boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: TABLE permission_presets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.permission_presets IS 'Reusable permission templates for quick user setup';


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    display_name text NOT NULL,
    description text,
    category text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    storage_path text NOT NULL,
    filename text NOT NULL,
    file_size integer,
    mime_type text,
    photo_tag text,
    caption text,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    work_order_id uuid
);


--
-- Name: TABLE photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.photos IS 'Job-level photo records for operational gallery workflows';


--
-- Name: preset_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.preset_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    preset_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE preset_permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.preset_permissions IS 'Junction table linking presets to their permissions';


--
-- Name: pricebook_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricebook_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    pricebook_id uuid NOT NULL,
    category public.pricebook_category NOT NULL,
    item_type public.pricebook_item_type NOT NULL,
    name text NOT NULL,
    unit public.unit NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    is_labor boolean DEFAULT false NOT NULL,
    is_taxable boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    visibility text DEFAULT 'sales_reps'::text,
    show_to_customer boolean DEFAULT false,
    is_adder boolean DEFAULT false,
    adder_category text,
    cost_price numeric(10,2),
    price_type text DEFAULT 'fixed'::text,
    is_commissionable boolean DEFAULT false,
    commission_percent numeric(5,2),
    commission_cap numeric(10,2),
    material_cost numeric(10,2),
    labor_cost numeric(10,2),
    profit_margin_percent numeric(6,2),
    manager_spo_enabled boolean DEFAULT false NOT NULL,
    manager_spo_percent numeric(5,2),
    role_commission_rates jsonb,
    image_url text
);


--
-- Name: COLUMN pricebook_items.cost_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricebook_items.cost_price IS 'Cost/wholesale price for margin calculation';


--
-- Name: COLUMN pricebook_items.price_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricebook_items.price_type IS 'fixed = dollar amount, percentage = % of total price';


--
-- Name: COLUMN pricebook_items.is_commissionable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricebook_items.is_commissionable IS 'Whether this item counts toward commission calculations';


--
-- Name: COLUMN pricebook_items.commission_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricebook_items.commission_percent IS 'Percentage of the adder value that is commissionable (0-100). NULL means flows through regular comp plan.';


--
-- Name: COLUMN pricebook_items.commission_cap; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricebook_items.commission_cap IS 'Maximum dollar amount of this adder that counts toward commission per instance. NULL means no cap.';


--
-- Name: COLUMN pricebook_items.material_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricebook_items.material_cost IS 'Material cost per unit for margin calculation';


--
-- Name: COLUMN pricebook_items.labor_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricebook_items.labor_cost IS 'Labor cost per unit for margin calculation';


--
-- Name: COLUMN pricebook_items.profit_margin_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricebook_items.profit_margin_percent IS 'Profit markup percentage (0-1000%) added to costs to calculate selling price';


--
-- Name: COLUMN pricebook_items.manager_spo_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricebook_items.manager_spo_enabled IS 'When true, manager SPO % applies for roles defined in app (sales/regional/setter managers).';


--
-- Name: COLUMN pricebook_items.manager_spo_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricebook_items.manager_spo_percent IS '% of adder selling price for eligible manager roles when manager_spo_enabled.';


--
-- Name: COLUMN pricebook_items.role_commission_rates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pricebook_items.role_commission_rates IS 'Per-role commission multipliers, e.g. {"setter":0.5,"closer":1.0,"field_manager":0.25,"senior_manager":0.1}.';


--
-- Name: pricebooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricebooks (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: primary_comp_plan_assignment_cancellations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.primary_comp_plan_assignment_cancellations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    assignment_snapshot jsonb NOT NULL,
    cancelled_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_by_user_id uuid NOT NULL,
    cancellation_reason text NOT NULL,
    CONSTRAINT primary_comp_plan_assignment_cancella_cancellation_reason_check CHECK ((length(btrim(cancellation_reason)) > 0))
);


--
-- Name: production_job_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_job_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    user_id uuid NOT NULL,
    note text NOT NULL,
    is_internal boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    share_with_sub boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN production_job_notes.share_with_sub; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_job_notes.share_with_sub IS 'If true, this note is visible to assigned subcontractors';


--
-- Name: program_444_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_444_enrollments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    enrolled_by uuid,
    start_date date NOT NULL,
    week1_starts_at timestamp with time zone NOT NULL,
    week1_ends_at timestamp with time zone NOT NULL,
    week2_starts_at timestamp with time zone NOT NULL,
    week2_ends_at timestamp with time zone NOT NULL,
    week1_doors integer DEFAULT 0 NOT NULL,
    week1_inspections integer DEFAULT 0 NOT NULL,
    week1_qualified boolean DEFAULT false NOT NULL,
    week1_qualified_at timestamp with time zone,
    week1_payroll_period_id uuid,
    week2_doors integer DEFAULT 0 NOT NULL,
    week2_inspections integer DEFAULT 0 NOT NULL,
    week2_qualified boolean DEFAULT false NOT NULL,
    week2_qualified_at timestamp with time zone,
    week2_payroll_period_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT program_444_enrollments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    customer_id uuid,
    lead_id uuid,
    status public.project_status DEFAULT 'open'::public.project_status NOT NULL,
    project_type public.project_type DEFAULT 'roofing'::public.project_type NOT NULL,
    address_text text,
    lat numeric(10,8),
    lng numeric(11,8),
    roof_squares numeric(10,2),
    siding_squares numeric(10,2),
    vents_count integer DEFAULT 0 NOT NULL,
    layers integer DEFAULT 1 NOT NULL,
    total_windows integer DEFAULT 0 NOT NULL,
    windows_by_type jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_user_id uuid,
    contract_sent_at timestamp with time zone,
    contract_uploaded_at timestamp with time zone,
    scope_of_work text,
    permits_status text,
    product_summary text,
    install_date date,
    ops_notes text,
    contract_pdf_path text,
    project_review jsonb,
    opportunity_id uuid,
    sold_roof_squares numeric(10,2),
    payment_method text
);


--
-- Name: COLUMN projects.project_review; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.project_review IS 'Last submitted project review questionnaire (answers + metadata for pre-fill on re-open)';


--
-- Name: COLUMN projects.opportunity_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.opportunity_id IS 'When set, ties the project to the opportunity (inspection → close → sale).';


--
-- Name: COLUMN projects.sold_roof_squares; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.sold_roof_squares IS 'Sold roof squares including waste copied from accepted proposal';


--
-- Name: COLUMN projects.payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.payment_method IS 'Payment method for the job (cash, finance, insurance, other). Synced from ops financial source.';


--
-- Name: proposal_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proposal_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    proposal_id uuid NOT NULL,
    pricebook_item_id uuid,
    category text NOT NULL,
    name text NOT NULL,
    description text,
    unit text NOT NULL,
    quantity numeric(10,2) DEFAULT 1 NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    line_total numeric(12,2) NOT NULL,
    is_adder boolean DEFAULT false,
    show_on_pdf boolean DEFAULT false,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    show_to_customer boolean DEFAULT false
);


--
-- Name: proposal_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proposal_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    proposal_id uuid NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    caption text,
    photo_type text DEFAULT 'inspection'::text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: proposal_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proposal_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_default boolean DEFAULT false,
    accent_color text DEFAULT '#4f46e5'::text,
    secondary_color text DEFAULT '#6366f1'::text,
    font_family text DEFAULT 'Inter'::text,
    header_html text,
    footer_html text,
    cover_page_enabled boolean DEFAULT true,
    cover_image_url text,
    show_scope_of_work boolean DEFAULT true,
    show_materials boolean DEFAULT true,
    show_warranty boolean DEFAULT true,
    show_terms boolean DEFAULT true,
    show_financing boolean DEFAULT true,
    show_company_info boolean DEFAULT true,
    show_rep_info boolean DEFAULT true,
    default_scope_of_work text,
    default_warranty_info text,
    default_terms_conditions text,
    custom_css text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid,
    project_id uuid,
    created_by uuid NOT NULL,
    customer_name text NOT NULL,
    customer_email text,
    customer_phone text,
    customer_address text NOT NULL,
    proposal_number text NOT NULL,
    title text DEFAULT 'Roofing Proposal'::text,
    status text DEFAULT 'draft'::text NOT NULL,
    subtotal numeric(12,2) DEFAULT 0 NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0,
    discount_percent numeric(5,2) DEFAULT 0,
    tax_rate numeric(5,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    total numeric(12,2) DEFAULT 0 NOT NULL,
    financing_available boolean DEFAULT false,
    financing_term_months integer,
    financing_rate numeric(5,2),
    monthly_payment numeric(10,2),
    scope_of_work text,
    materials_description text,
    warranty_info text,
    terms_conditions text,
    custom_sections jsonb DEFAULT '[]'::jsonb,
    cover_image_url text,
    company_logo_url text,
    accent_color text DEFAULT '#4f46e5'::text,
    sent_at timestamp with time zone,
    viewed_at timestamp with time zone,
    accepted_at timestamp with time zone,
    declined_at timestamp with time zone,
    expires_at timestamp with time zone,
    signature_url text,
    signed_at timestamp with time zone,
    pdf_url text,
    pdf_generated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    roofing_type_id uuid,
    customer_signature_type text,
    customer_signature_data text,
    customer_signature_typed text,
    customer_signed_name text,
    customer_signed_at timestamp with time zone,
    rep_signature_type text,
    rep_signature_data text,
    rep_signature_typed text,
    rep_signed_name text,
    rep_signed_at timestamp with time zone,
    declined_reason text,
    inspection_notes jsonb DEFAULT '[]'::jsonb,
    financing_program_id uuid,
    financing_lender_name text,
    dealer_fee_percent numeric(6,3),
    dealer_fee_amount numeric(12,2),
    financed_contract_total numeric(12,2),
    measured_squares numeric(10,2),
    sold_waste_percent numeric(5,2),
    sold_squares numeric(10,2),
    recommended_order_squares numeric(10,2)
);


--
-- Name: COLUMN proposals.inspection_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.proposals.inspection_notes IS 'Array of inspection finding notes, shown in PDF Inspection Findings section';


--
-- Name: COLUMN proposals.dealer_fee_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.proposals.dealer_fee_percent IS 'Snapshot of program fee; omit from rep-facing API responses.';


--
-- Name: COLUMN proposals.financed_contract_total; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.proposals.financed_contract_total IS 'Total contract/financed amount after gross-up for dealer fee (same as Installation Agreement project cost when financing applies).';


--
-- Name: COLUMN proposals.measured_squares; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.proposals.measured_squares IS 'Measured roof squares before waste from proposal builder';


--
-- Name: COLUMN proposals.sold_waste_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.proposals.sold_waste_percent IS 'Waste percent applied to measured squares in proposal builder';


--
-- Name: COLUMN proposals.sold_squares; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.proposals.sold_squares IS 'Sold roof squares including waste from proposal builder';


--
-- Name: COLUMN proposals.recommended_order_squares; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.proposals.recommended_order_squares IS 'Rounded ordering recommendation derived from sold squares';


--
-- Name: public_estimate_previews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_estimate_previews (
    jti text NOT NULL,
    org_id uuid NOT NULL,
    address text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    squares_mid numeric NOT NULL,
    squares_low numeric NOT NULL,
    squares_high numeric NOT NULL,
    waste_percent numeric NOT NULL,
    facet_count integer NOT NULL,
    measure_source text NOT NULL,
    requires_manual_measure boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    base_squares numeric,
    confidence text,
    price_per_square numeric,
    flags text[],
    other_structures jsonb,
    imagery_date date,
    lidar_collected_end date,
    calibration_factor numeric,
    estimate_version text,
    CONSTRAINT public_estimate_previews_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'standard'::text, 'low'::text])))
);


--
-- Name: public_estimate_unlock_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_estimate_unlock_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    delivery_key text NOT NULL,
    state text DEFAULT 'claimed'::text NOT NULL,
    attempt_id uuid DEFAULT gen_random_uuid() NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    failed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT public_estimate_unlock_deliveries_state_check CHECK ((state = ANY (ARRAY['claimed'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: referral_partner_assignment_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_partner_assignment_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    partner_id uuid NOT NULL,
    from_user_id uuid,
    to_user_id uuid,
    from_status text,
    to_status text NOT NULL,
    changed_by uuid,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    seq bigint NOT NULL
);


--
-- Name: referral_partner_assignment_log_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.referral_partner_assignment_log_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: referral_partner_assignment_log_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.referral_partner_assignment_log_seq_seq OWNED BY public.referral_partner_assignment_log.seq;


--
-- Name: referral_partner_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_partner_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    inactivity_days integer DEFAULT 30 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_partner_types_inactivity_days_check CHECK (((inactivity_days >= 8) AND (inactivity_days <= 730)))
);


--
-- Name: referral_partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_partners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    type_id uuid NOT NULL,
    other_type_text text,
    name text NOT NULL,
    phone text,
    phone_digits text,
    email text,
    company text,
    notes text,
    assigned_user_id uuid,
    status text DEFAULT 'assigned'::text NOT NULL,
    assigned_at timestamp with time zone,
    last_touched_at timestamp with time zone DEFAULT now() NOT NULL,
    expiry_warned_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_partners_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT referral_partners_one_owner CHECK (((status = 'assigned'::text) = (assigned_user_id IS NOT NULL))),
    CONSTRAINT referral_partners_status_check CHECK ((status = ANY (ARRAY['assigned'::text, 'open'::text, 'company_relationship'::text])))
);


--
-- Name: referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    referrer_customer_id uuid NOT NULL,
    referrer_name text,
    referrer_email text,
    referrer_phone text,
    referred_name text NOT NULL,
    referred_email text,
    referred_phone text,
    referred_address text,
    referred_notes text,
    referred_customer_id uuid,
    referred_lead_id uuid,
    referred_project_id uuid,
    bonus_amount numeric(10,2) DEFAULT 0 NOT NULL,
    bonus_type text DEFAULT 'cash'::text,
    bonus_notes text,
    status public.referral_status DEFAULT 'pending'::public.referral_status NOT NULL,
    install_date date,
    install_verified_by uuid,
    install_verified_at timestamp with time zone,
    paid_at timestamp with time zone,
    paid_by uuid,
    payment_method text,
    payment_reference text,
    payout_reminder_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    referred_opportunity_id uuid
);


--
-- Name: TABLE referrals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.referrals IS 'Tracks customer referrals and their bonus payouts';


--
-- Name: COLUMN referrals.referred_opportunity_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.referrals.referred_opportunity_id IS 'The deal the referred person turned into. Primary link; referred_customer_id is derived from it.';


--
-- Name: regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_role_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_role_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    role text NOT NULL,
    custom_role_id uuid,
    can_view boolean DEFAULT true NOT NULL,
    can_edit boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    report_id uuid NOT NULL,
    created_by uuid NOT NULL,
    frequency text NOT NULL,
    day_of_week integer,
    day_of_month integer,
    time_of_day time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    recipients jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_sent_at timestamp with time zone,
    next_send_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    schedule_type text DEFAULT 'daily'::text NOT NULL,
    schedule_time time without time zone DEFAULT '08:00:00'::time without time zone,
    schedule_day integer,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: review_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    production_job_id uuid NOT NULL,
    customer_id uuid,
    salesperson_id uuid,
    token text NOT NULL,
    channel text DEFAULT 'manual'::text NOT NULL,
    sent_by uuid,
    sent_at timestamp with time zone,
    clicked_at timestamp with time zone,
    click_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE review_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.review_requests IS 'Post-job Google review requests: one per production job, tracked link + send/click audit. Attribution = salesperson_id; sent_by records who actually sent (rep or ops backstop).';


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roof_facets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roof_facets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    measurement_id uuid NOT NULL,
    facet_number integer NOT NULL,
    area_sqft numeric(10,2) NOT NULL,
    pitch text,
    pitch_degrees numeric(5,2),
    orientation text,
    polygon_coords jsonb,
    has_penetrations boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roof_measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roof_measurements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid,
    project_id uuid,
    proposal_id uuid,
    created_by uuid NOT NULL,
    address_text text NOT NULL,
    lat numeric(10,7),
    lng numeric(10,7),
    source text DEFAULT 'manual'::text NOT NULL,
    external_report_id text,
    external_report_url text,
    status text DEFAULT 'completed'::text NOT NULL,
    total_area_sqft numeric(10,2),
    total_squares numeric(10,2),
    ridges_lf numeric(10,2),
    hips_lf numeric(10,2),
    valleys_lf numeric(10,2),
    eaves_lf numeric(10,2),
    rakes_lf numeric(10,2),
    flashing_lf numeric(10,2),
    step_flashing_lf numeric(10,2),
    drip_edge_lf numeric(10,2),
    predominant_pitch text,
    pitch_count integer,
    stories integer DEFAULT 1,
    roof_material text,
    roof_age_years integer,
    facet_count integer,
    penetration_count integer,
    chimney_count integer,
    skylight_count integer,
    suggested_waste_percent numeric(5,2) DEFAULT 10,
    raw_data jsonb,
    satellite_image_url text,
    annotated_image_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roofing_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roofing_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    pricing_unit text DEFAULT 'square'::text NOT NULL,
    unit_price numeric(10,2) DEFAULT 350.00 NOT NULL,
    material_cost numeric(10,2),
    labor_cost numeric(10,2),
    profit_margin_percent numeric(6,2),
    labor_multiplier numeric(4,2) DEFAULT 1.00,
    default_warranty_years integer DEFAULT 10,
    default_warranty_text text,
    color text DEFAULT '#4f46e5'::text,
    icon text,
    sort_order integer DEFAULT 0,
    is_default boolean DEFAULT false,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: scheduled_appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    lead_id uuid,
    opportunity_id uuid,
    closer_user_id uuid,
    canvasser_user_id uuid,
    google_event_id text,
    scheduled_for timestamp with time zone NOT NULL,
    duration_minutes integer DEFAULT 60 NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    address_text text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    setter_feedback_read boolean DEFAULT false,
    deleted_user_name text,
    buffer_after_minutes integer,
    inside_sales_booked_by_user_id uuid,
    inside_sales_sit_credit_excluded boolean DEFAULT false NOT NULL,
    google_sync_failed_at timestamp with time zone,
    google_sync_error text,
    outcome_not_recorded_at timestamp with time zone,
    outcome_not_recorded_by uuid,
    outcome_not_recorded_batch uuid,
    appointment_type text DEFAULT 'inspection'::text
);


--
-- Name: COLUMN scheduled_appointments.buffer_after_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduled_appointments.buffer_after_minutes IS 'Minutes after slot end for scheduling / conflict checks; not used for feedback prompt time (prompt is at scheduled_for).';


--
-- Name: COLUMN scheduled_appointments.inside_sales_booked_by_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduled_appointments.inside_sales_booked_by_user_id IS 'Inside-sales rep who booked or re-booked this insurance appointment. Distinct from canvasser_user_id (the setter who booked the ORIGINAL inspection) and from closer_user_id (who runs it). Drives the inside-sales sit credit; never changes setter attribution or setter commission.';


--
-- Name: COLUMN scheduled_appointments.inside_sales_sit_credit_excluded; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduled_appointments.inside_sales_sit_credit_excluded IS 'When true, this appointment never produces an inside-sales sit credit, even though inside_sales_booked_by_user_id is set. Admin override for a bad or duplicate booking.';


--
-- Name: COLUMN scheduled_appointments.google_sync_failed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduled_appointments.google_sync_failed_at IS 'When the most recent Google Calendar push for this appointment failed. NULL once a push succeeds. Drives the "not on the calendar yet" warning and retry action in the inside-sales queue.';


--
-- Name: COLUMN scheduled_appointments.google_sync_error; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.scheduled_appointments.google_sync_error IS 'Human-readable reason the last Google Calendar push failed (e.g. the attending rep has not connected Google). Cleared on a successful push.';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    role public.user_role DEFAULT 'sales_rep'::public.user_role NOT NULL,
    full_name text,
    phone text,
    email text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    manager_user_id uuid,
    team_id uuid,
    region_id uuid,
    custom_role_id uuid,
    canvass_pin_visibility text DEFAULT 'org'::text NOT NULL,
    dashboard_view public.dashboard_view_type DEFAULT 'sales'::public.dashboard_view_type NOT NULL,
    is_super_admin boolean DEFAULT false,
    super_admin_granted_at timestamp with time zone,
    is_test_account boolean DEFAULT false,
    show_in_reports boolean DEFAULT true,
    can_receive_appointments boolean,
    ui_prefs jsonb,
    CONSTRAINT users_canvass_pin_visibility_check CHECK ((canvass_pin_visibility = ANY (ARRAY['own'::text, 'team'::text, 'region'::text, 'org'::text, 'territory'::text])))
);


--
-- Name: COLUMN users.canvass_pin_visibility; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.canvass_pin_visibility IS 'Canvass map: own | team | region | org | territory (assigned polygons only; see canvass_territory_users)';


--
-- Name: COLUMN users.dashboard_view; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.dashboard_view IS 'Controls which dashboard the user sees: sales or ops';


--
-- Name: COLUMN users.is_super_admin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.is_super_admin IS 'Owner flag. Only super admins may force a job paid in full with a balance or change sale credit after signing. See lib/super-admin.ts.';


--
-- Name: COLUMN users.super_admin_granted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.super_admin_granted_at IS 'When is_super_admin last became true (null when false). Set by trigger.';


--
-- Name: COLUMN users.is_test_account; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.is_test_account IS 'TRUE for internal test/demo accounts. Excluded from payroll, role defaults, leaderboards and reports.';


--
-- Name: rpt_appointments; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_appointments WITH (security_invoker='true') AS
 SELECT a.org_id,
    a.id AS appointment_id,
    a.scheduled_for,
    COALESCE(a.appointment_type, 'inspection'::text) AS appointment_type,
    a.status,
    a.closer_user_id,
    cl.full_name AS closer,
    a.canvasser_user_id AS setter_user_id,
    st.full_name AS setter,
    (a.status = 'completed'::text) AS was_completed,
    (a.status = 'cancelled'::text) AS was_cancelled,
    a.opportunity_id,
    a.lead_id,
    a.outcome_not_recorded_at
   FROM ((public.scheduled_appointments a
     LEFT JOIN public.users cl ON ((cl.id = a.closer_user_id)))
     LEFT JOIN public.users st ON ((st.id = a.canvasser_user_id)));


--
-- Name: rpt_canvass_doors; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_canvass_doors WITH (security_invoker='true') AS
 SELECT k.org_id,
    k.id AS knock_id,
    k.created_at AS knocked_at,
    k.user_id,
    u.full_name AS rep,
    k.disposition,
    k.source
   FROM (public.canvass_knocks k
     LEFT JOIN public.users u ON ((u.id = k.user_id)))
  WHERE public.canvass_knock_is_door_eligible(k.source, k.disposition);


--
-- Name: rpt_inspection_sets; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_inspection_sets WITH (security_invoker='true') AS
 SELECT a.org_id,
    a.id AS appointment_id,
    a.created_at AS set_at,
    a.scheduled_for,
    a.canvasser_user_id AS setter_user_id,
    st.full_name AS setter,
    a.closer_user_id,
    cl.full_name AS closer
   FROM ((public.scheduled_appointments a
     LEFT JOIN public.users st ON ((st.id = a.canvasser_user_id)))
     LEFT JOIN public.users cl ON ((cl.id = a.closer_user_id)))
  WHERE (((a.appointment_type IS NULL) OR (a.appointment_type = 'inspection'::text)) AND (COALESCE(a.status, 'scheduled'::text) <> 'cancelled'::text));


--
-- Name: rpt_instant_estimate_accuracy; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_instant_estimate_accuracy WITH (security_invoker='true') AS
 SELECT org_id,
    id AS check_id,
    address,
    created_at AS checked_at,
    estimate_version,
    measure_source,
    confidence,
    array_to_string(flags, ', '::text) AS flags,
    truth_source,
    est_base_squares,
    truth_base_squares,
    est_squares_with_waste,
    truth_squares_with_waste,
    ordered_squares,
    calibration_factor,
        CASE
            WHEN ((truth_base_squares > (0)::numeric) AND (est_base_squares > (0)::numeric)) THEN round((((est_base_squares - truth_base_squares) / truth_base_squares) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS error_pct,
        CASE
            WHEN ((truth_base_squares > (0)::numeric) AND (est_base_squares > (0)::numeric)) THEN round(((abs((est_base_squares - truth_base_squares)) / truth_base_squares) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS abs_error_pct,
        CASE
            WHEN ((truth_squares_with_waste > (0)::numeric) AND (est_squares_with_waste > (0)::numeric)) THEN round((((est_squares_with_waste - truth_squares_with_waste) / truth_squares_with_waste) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS sold_error_pct,
    opportunity_id,
    production_job_id
   FROM public.instant_estimate_checks c;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    contact_name text,
    phone text,
    email text,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    order_email text,
    order_cc_emails text[],
    account_number text,
    default_branch text,
    default_delivery_notes text,
    default_for_trades text[],
    connection_type public.supplier_connection_type DEFAULT 'email'::public.supplier_connection_type
);


--
-- Name: COLUMN vendors.order_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.order_email IS 'Where purchase orders are emailed. Blank = this supplier cannot be emailed from the CRM.';


--
-- Name: COLUMN vendors.default_for_trades; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.default_for_trades IS 'Trades this supplier is the company default for (job + line overrides win).';


--
-- Name: rpt_job_costs; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_job_costs WITH (security_invoker='true') AS
 SELECT l.org_id,
    l.id AS cost_line_id,
    l.job_id,
    j.job_number,
    l.description,
    l.cost_type,
    l.amount,
    l.incurred_on,
    l.approved,
    l.source,
    v.name AS vendor
   FROM ((public.job_cost_lines l
     JOIN public.production_jobs j ON ((j.id = l.job_id)))
     LEFT JOIN public.vendors v ON ((v.id = l.vendor_id)))
  WHERE ((l.status = 'active'::text) AND (l.deleted_at IS NULL));


--
-- Name: rpt_jobs; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_jobs WITH (security_invoker='true') AS
 SELECT j.org_id,
    j.id AS job_id,
    j.job_number,
    j.status,
    j.job_type,
    j.address_text AS address,
    j.job_source,
    j.sale_date,
    j.completed_at,
    j.cancelled_at,
    j.scheduled_date,
    j.materials_status,
    j.permit_status,
    j.salesperson_id,
    u.full_name AS salesperson,
        CASE
            WHEN (j.status = 'cancelled'::text) THEN (0)::numeric
            ELSE COALESCE(j.sale_amount, (0)::numeric)
        END AS sale_amount,
    COALESCE(j.dealer_fee_amount, (0)::numeric) AS dealer_fee,
    (COALESCE(c.cost, (0)::numeric) + COALESCE(j.dealer_fee_amount, (0)::numeric)) AS cost_total,
    COALESCE(p.collected, (0)::numeric) AS collected,
        CASE
            WHEN (j.status = 'cancelled'::text) THEN (0)::numeric
            ELSE ((COALESCE(j.sale_amount, (0)::numeric) - COALESCE(j.dealer_fee_amount, (0)::numeric)) - COALESCE(c.cost, (0)::numeric))
        END AS profit_before_commission,
        CASE
            WHEN (j.status = 'cancelled'::text) THEN (0)::numeric
            ELSE GREATEST((COALESCE(j.sale_amount, (0)::numeric) - COALESCE(p.collected, (0)::numeric)), (0)::numeric)
        END AS balance_due,
        CASE
            WHEN (j.sale_date IS NULL) THEN NULL::integer
            ELSE (CURRENT_DATE - j.sale_date)
        END AS days_since_sale,
        CASE
            WHEN (j.sale_date IS NULL) THEN 'no sale date'::text
            WHEN ((CURRENT_DATE - j.sale_date) <= 30) THEN '0-30 days'::text
            WHEN ((CURRENT_DATE - j.sale_date) <= 60) THEN '31-60 days'::text
            WHEN ((CURRENT_DATE - j.sale_date) <= 90) THEN '61-90 days'::text
            ELSE 'over 90 days'::text
        END AS aging_bucket
   FROM (((public.production_jobs j
     LEFT JOIN public.users u ON ((u.id = j.salesperson_id)))
     LEFT JOIN LATERAL ( SELECT sum(l.amount) AS cost
           FROM public.job_cost_lines l
          WHERE ((l.job_id = j.id) AND (l.status = 'active'::text) AND (l.deleted_at IS NULL) AND (l.description IS DISTINCT FROM 'Lender / dealer fee'::text))) c ON (true))
     LEFT JOIN LATERAL ( SELECT ((sum(pm.amount_cents))::numeric / 100.0) AS collected
           FROM public.job_payments pm
          WHERE ((pm.job_id = j.id) AND (pm.funding_status IS DISTINCT FROM 'pending'::text))) p ON (true));


--
-- Name: rpt_leads; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_leads WITH (security_invoker='true') AS
 SELECT l.org_id,
    l.id AS lead_id,
    l.created_at,
    l.status,
    l.source,
    l.canvass_disposition,
    l.owner_user_id,
    u.full_name AS owner
   FROM (public.leads l
     LEFT JOIN public.users u ON ((u.id = l.owner_user_id)))
  WHERE public.lead_in_pipeline(l.*);


--
-- Name: rpt_opportunities; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_opportunities WITH (security_invoker='true') AS
 SELECT o.org_id,
    o.id AS opportunity_id,
    o.created_at,
    o.status,
    o.pipeline_stage,
    o.inspection_outcome,
    o.inspection_outcome_at,
    o.job_source,
    o.owner_user_id AS closer_user_id,
    cl.full_name AS closer,
    o.setter_user_id,
    st.full_name AS setter,
    COALESCE(o.estimated_value, (0)::numeric) AS estimated_value,
    (EXISTS ( SELECT 1
           FROM public.order_form_contracts c
          WHERE ((c.opportunity_id = o.id) AND (c.status = 'completed'::public.contract_signing_status) AND (c.agreement_type = ANY (ARRAY['installation'::text, 'repair'::text]))))) AS is_sold
   FROM ((public.opportunities o
     LEFT JOIN public.users cl ON ((cl.id = o.owner_user_id)))
     LEFT JOIN public.users st ON ((st.id = o.setter_user_id)));


--
-- Name: rpt_payments; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_payments WITH (security_invoker='true') AS
 SELECT j.org_id,
    pm.id AS payment_id,
    pm.job_id,
    j.job_number,
    pm.paid_at,
    ((pm.amount_cents)::numeric / 100.0) AS amount,
    pm.payment_type,
    pm.method,
    pm.funding_status,
    j.sale_date
   FROM (public.job_payments pm
     JOIN public.production_jobs j ON ((j.id = pm.job_id)));


--
-- Name: rpt_payroll_lines; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_payroll_lines WITH (security_invoker='true') AS
 SELECT l.org_id,
    l.id AS payout_line_id,
    l.user_id,
    u.full_name AS person,
    l.participant_role,
    l.job_id,
    j.job_number,
    p.period_label,
    p.status AS period_status,
    p.scheduled_pay_date,
    l.gross_amount,
    l.net_amount
   FROM (((public.payroll_payout_lines l
     JOIN public.payroll_periods p ON ((p.id = l.payroll_period_id)))
     LEFT JOIN public.users u ON ((u.id = l.user_id)))
     LEFT JOIN public.production_jobs j ON ((j.id = l.job_id)));


--
-- Name: rpt_referral_partners; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_referral_partners WITH (security_invoker='true') AS
 SELECT r.org_id,
    r.id AS partner_id,
    r.name,
    r.company,
    r.status,
    r.assigned_user_id AS owner_user_id,
    u.full_name AS owner,
    r.assigned_at,
    r.last_touched_at,
    ( SELECT count(*) AS count
           FROM public.opportunities o
          WHERE (o.referral_partner_id = r.id)) AS referred_opportunities
   FROM (public.referral_partners r
     LEFT JOIN public.users u ON ((u.id = r.assigned_user_id)));


--
-- Name: rpt_sales; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_sales WITH (security_invoker='true') AS
 SELECT c.org_id,
    c.id AS contract_id,
    c.agreement_type,
    c.customer_signed_at AS signed_at,
    c.project_address AS address,
    COALESCE(c.project_cost, (0)::numeric) AS amount,
    c.payment_method,
    c.opportunity_id,
    o.owner_user_id AS closer_user_id,
    cl.full_name AS closer,
    o.setter_user_id,
    st.full_name AS setter,
    o.job_source,
    COALESCE(o.is_self_generated, false) AS is_self_generated
   FROM (((public.order_form_contracts c
     LEFT JOIN public.opportunities o ON ((o.id = c.opportunity_id)))
     LEFT JOIN public.users cl ON ((cl.id = o.owner_user_id)))
     LEFT JOIN public.users st ON ((st.id = o.setter_user_id)))
  WHERE ((c.status = 'completed'::public.contract_signing_status) AND (c.agreement_type = ANY (ARRAY['installation'::text, 'repair'::text])) AND (c.customer_signed_at IS NOT NULL));


--
-- Name: rpt_sits; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rpt_sits WITH (security_invoker='true') AS
 WITH sit_ids AS (
         SELECT o.id AS org_id,
            array_agg(DISTINCT lower(replace(TRIM(BOTH FROM (x.value ->> 'id'::text)), '-'::text, '_'::text))) AS ids
           FROM public.orgs o,
            LATERAL jsonb_array_elements(COALESCE(NULLIF((o.settings -> 'inspection_outcomes'::text), 'null'::jsonb), '[]'::jsonb)) x(value)
          WHERE (COALESCE(((x.value ->> 'active'::text))::boolean, true) AND (((x.value ->> 'counts_as_sit'::text))::boolean IS TRUE))
          GROUP BY o.id
        ), cand AS (
         SELECT o.org_id,
            o.id AS opportunity_id,
            o.setter_user_id,
            o.owner_user_id,
            c_1.outcome,
            c_1.at,
            row_number() OVER (PARTITION BY o.id ORDER BY c_1.at DESC NULLS LAST) AS rn
           FROM (public.opportunities o
             CROSS JOIN LATERAL ( SELECT s.outcome,
                    s.created_at AS at
                   FROM public.inspection_status_updates s
                  WHERE ((s.outcome IS NOT NULL) AND ((s.opportunity_id = o.id) OR ((o.lead_id IS NOT NULL) AND (s.lead_id = o.lead_id))))
                UNION ALL
                 SELECT o.inspection_outcome,
                    COALESCE(o.inspection_outcome_at, o.updated_at, o.created_at) AS "coalesce"
                  WHERE (o.inspection_outcome IS NOT NULL)) c_1)
        )
 SELECT c.org_id,
    c.opportunity_id,
    c.at AS sat_at,
    c.outcome,
    c.owner_user_id AS closer_user_id,
    cl.full_name AS closer,
    c.setter_user_id,
    st.full_name AS setter
   FROM (((cand c
     JOIN sit_ids si ON ((si.org_id = c.org_id)))
     LEFT JOIN public.users cl ON ((cl.id = c.owner_user_id)))
     LEFT JOIN public.users st ON ((st.id = c.setter_user_id)))
  WHERE ((c.rn = 1) AND (lower(replace(TRIM(BOTH FROM c.outcome), '-'::text, '_'::text)) = ANY (si.ids)));


--
-- Name: saved_report_filters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_report_filters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    report_id uuid NOT NULL,
    name text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: saved_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    spec jsonb NOT NULL,
    shared_roles text[] DEFAULT '{}'::text[] NOT NULL,
    schedule text,
    schedule_recipients text[] DEFAULT '{}'::text[] NOT NULL,
    dashboard_widget boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sent_at timestamp with time zone
);


--
-- Name: TABLE saved_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.saved_reports IS 'Saved/shared report definitions (spec jsonb) and optional email schedule. Service-role access only; the API enforces org + role sharing.';


--
-- Name: setter_ramp_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.setter_ramp_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    enrolled_by uuid,
    start_date date NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT setter_ramp_enrollments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])))
);


--
-- Name: setter_ramp_weekly_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.setter_ramp_weekly_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    enrollment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    week_number integer NOT NULL,
    week_starts_at timestamp with time zone NOT NULL,
    week_ends_at timestamp with time zone NOT NULL,
    doors_knocked integer DEFAULT 0 NOT NULL,
    appointments_set integer DEFAULT 0 NOT NULL,
    rolling_avg_appointments numeric(6,2),
    gate_passed boolean DEFAULT false NOT NULL,
    gate_passed_at timestamp with time zone,
    commission_total numeric(12,2),
    floor_amount numeric(10,2),
    payout_source text,
    payroll_period_id uuid,
    bonus_registered boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT setter_ramp_weekly_status_payout_source_check CHECK ((payout_source = ANY (ARRAY['floor'::text, 'commission'::text]))),
    CONSTRAINT setter_ramp_weekly_status_week_number_check CHECK ((week_number >= 1))
);


--
-- Name: solar_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solar_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    county text NOT NULL,
    pin text,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    owner_name text,
    mailing_address text,
    mailing_city text,
    mailing_state text,
    mailing_zip text,
    subdivision text,
    imagery_date date,
    meters_to_nearest_known_solar integer,
    source text DEFAULT 'google_solar_api'::text NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
    verified_has_solar boolean,
    verified_at timestamp with time zone,
    verified_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: solar_installers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solar_installers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name_key text NOT NULL,
    display_name text NOT NULL,
    status text DEFAULT 'unknown'::text NOT NULL,
    status_source text,
    status_detail text,
    status_checked_at timestamp with time zone,
    nc_sos_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    service_orphaned boolean DEFAULT false NOT NULL,
    status_confidence text,
    successor_company text,
    successor_services_systems boolean,
    evidence_summary text,
    source_urls text[],
    raw_variants text[],
    CONSTRAINT solar_installers_status_check CHECK ((status = ANY (ARRAY['active'::text, 'defunct'::text, 'acquired'::text, 'no_longer_servicing'::text, 'unknown'::text])))
);


--
-- Name: solar_installs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solar_installs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    county text NOT NULL,
    permit_number text,
    pin text,
    address text,
    lat double precision,
    lng double precision,
    permit_type text,
    issued_on date,
    installer_name_raw text,
    installer_id uuid,
    source text DEFAULT 'records_request'::text NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    permit_owner_name text,
    current_owner_name text,
    owner_refreshed_at timestamp with time zone,
    owner_is_original boolean,
    pv_class text,
    pv_evidence text,
    is_commercial boolean DEFAULT false NOT NULL,
    permit_numbers text[],
    years_since_install integer,
    geocoded_at timestamp with time zone,
    geocode_source text,
    property_key text,
    year_built integer,
    eff_year_built integer,
    year_built_source text,
    roof_age_at_install integer,
    roof_age_now integer,
    roof_age_refreshed_at timestamp with time zone,
    permit_description text
);


--
-- Name: spiff_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spiff_achievements (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    spiff_program_id uuid NOT NULL,
    user_id uuid NOT NULL,
    current_value numeric(14,2) DEFAULT 0 NOT NULL,
    qualified boolean DEFAULT false NOT NULL,
    qualified_at timestamp with time zone,
    payout_amount numeric(10,2),
    paid_at timestamp with time zone,
    payroll_period_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: spiff_programs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spiff_programs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    created_by uuid NOT NULL,
    name text NOT NULL,
    description text,
    trigger_metric public.spiff_trigger_metric NOT NULL,
    threshold numeric(14,2) NOT NULL,
    reward_type public.spiff_reward_type DEFAULT 'cash'::public.spiff_reward_type NOT NULL,
    reward_amount numeric(10,2),
    reward_note text,
    eligible_roles text[] DEFAULT '{}'::text[] NOT NULL,
    is_public boolean DEFAULT true NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    status public.spiff_status DEFAULT 'draft'::public.spiff_status NOT NULL,
    payroll_cycle_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: storm_opportunity_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storm_opportunity_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    event_date date NOT NULL,
    layer text NOT NULL,
    magnitude numeric,
    damage boolean DEFAULT false NOT NULL,
    storm_lat numeric(10,8),
    storm_lng numeric(11,8),
    distance_miles numeric(8,4),
    routed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    email_sent_at timestamp with time zone,
    match_source text,
    CONSTRAINT storm_opportunity_alerts_layer_check CHECK ((layer = ANY (ARRAY['hail'::text, 'wind'::text]))),
    CONSTRAINT storm_opportunity_alerts_match_source_check CHECK (((match_source IS NULL) OR (match_source = ANY (ARRAY['report'::text, 'swath'::text]))))
);


--
-- Name: TABLE storm_opportunity_alerts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.storm_opportunity_alerts IS 'Deduped storm-near-opportunity matches for Inside Sales cron alerts. Writes are service-role only.';


--
-- Name: sub_contractors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sub_contractors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    company_name text NOT NULL,
    contact_name text,
    phone text,
    email text,
    address text,
    city text,
    state text,
    zip text,
    license_number text,
    insurance_expiry date,
    w9_on_file boolean DEFAULT false,
    services text[],
    service_area text[],
    rating numeric(3,2),
    internal_notes text,
    portal_access_token uuid,
    portal_access_enabled boolean DEFAULT false,
    last_portal_access timestamp with time zone,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    scheduling_email text,
    scheduling_calendar_id text,
    calendar_share_verified_at timestamp with time zone,
    supplies_materials boolean
);


--
-- Name: COLUMN sub_contractors.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sub_contractors.user_id IS 'Links sub to a Supabase auth user for portal access';


--
-- Name: supplier_api_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_api_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    job_id uuid NOT NULL,
    supplier_order_id uuid NOT NULL,
    content_hash text NOT NULL,
    estimated_total_cents integer,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_by uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    used_at timestamp with time zone,
    CONSTRAINT supplier_api_approvals_check CHECK (((decided_by IS NULL) OR (decided_by <> requested_by))),
    CONSTRAINT supplier_api_approvals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'used'::text])))
);


--
-- Name: supplier_api_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_api_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    vendor_id uuid,
    job_id uuid,
    send_id uuid,
    actor_user_id uuid,
    event text NOT NULL,
    environment text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: supplier_api_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_api_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    provider text DEFAULT 'abc_supply'::text NOT NULL,
    environment text DEFAULT 'sandbox'::text NOT NULL,
    ordering_enabled boolean DEFAULT false NOT NULL,
    ship_to_number text,
    branch_number text,
    delivery_service text DEFAULT 'OTR'::text NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_api_settings_delivery_service_check CHECK ((delivery_service = ANY (ARRAY['COM'::text, 'CPU'::text, 'EXP'::text, 'OTR'::text, 'OTG'::text, 'OTW'::text, 'TPC'::text]))),
    CONSTRAINT supplier_api_settings_environment_check CHECK ((environment = ANY (ARRAY['sandbox'::text, 'production'::text]))),
    CONSTRAINT supplier_api_settings_provider_check CHECK ((provider = 'abc_supply'::text))
);


--
-- Name: supplier_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    action text NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    changes jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT supplier_audit_log_action_check CHECK ((action = ANY (ARRAY['created'::text, 'updated'::text, 'deactivated'::text, 'reactivated'::text])))
);


--
-- Name: TABLE supplier_audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.supplier_audit_log IS 'Change log for vendors/suppliers (order email, CC, account, default trades, active, connection). Service-role only.';


--
-- Name: supplier_item_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_item_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    line_key text NOT NULL,
    item_number text NOT NULL,
    uom text NOT NULL,
    qty_unit_word text NOT NULL,
    est_unit_price_cents integer,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_item_map_est_unit_price_cents_check CHECK (((est_unit_price_cents IS NULL) OR (est_unit_price_cents >= 0)))
);


--
-- Name: supplier_order_send_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_order_send_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    send_id uuid NOT NULL,
    supplier_order_id uuid NOT NULL,
    job_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    line_key text NOT NULL,
    trade text NOT NULL,
    label text NOT NULL,
    quantity_text text,
    note text,
    line_status public.order_line_status NOT NULL,
    material_source public.material_source DEFAULT 'supplier'::public.material_source NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: supplier_order_send_sourcing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_order_send_sourcing (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    send_id uuid NOT NULL,
    job_id uuid NOT NULL,
    trade text NOT NULL,
    material_source public.material_source NOT NULL,
    installer_sub_id uuid,
    installer_name text,
    installer_supplies_materials boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: supplier_order_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_order_sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    supplier_order_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    kind public.supplier_order_send_kind NOT NULL,
    po_label text NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    connection_type public.supplier_connection_type DEFAULT 'email'::public.supplier_connection_type NOT NULL,
    status public.supplier_order_send_status DEFAULT 'sending'::public.supplier_order_send_status NOT NULL,
    sent_by uuid,
    to_email text NOT NULL,
    cc_emails text[],
    subject text NOT NULL,
    note text,
    delivery_date date,
    delivery_address text,
    delivery_notes text,
    line_count integer,
    lines_hash text,
    content_hash text,
    pdf_sha256 text,
    pdf_storage_path text,
    message_id text,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    failed_at timestamp with time zone,
    completed_at timestamp with time zone,
    supplier_order_number text,
    supplier_status text,
    supplier_status_at timestamp with time zone
);


--
-- Name: supplier_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    po_letter text NOT NULL,
    po_number text NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    status public.supplier_order_status DEFAULT 'draft'::public.supplier_order_status NOT NULL,
    last_lines_hash text,
    last_content_hash text,
    last_send_id uuid,
    last_delivery_date date,
    last_delivery_address text,
    first_sent_at timestamp with time zone,
    last_sent_at timestamp with time zone,
    last_sent_by uuid,
    last_sent_to text,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    received_at timestamp with time zone,
    received_by uuid
);


--
-- Name: table_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    table_key text NOT NULL,
    name text NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT table_views_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60)))
);


--
-- Name: team_closer_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_closer_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    buffer_minutes integer DEFAULT 60 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    last_assigned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    buffer_before integer DEFAULT 0 NOT NULL,
    buffer_after integer DEFAULT 15 NOT NULL
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    region_id uuid,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    timezone text DEFAULT 'America/New_York'::text
);


--
-- Name: thread_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_members (
    thread_id uuid NOT NULL,
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    reason text,
    muted_until timestamp with time zone,
    last_read_at timestamp with time zone,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    kind text NOT NULL,
    opportunity_id uuid,
    lead_id uuid,
    customer_id uuid,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT threads_kind_check CHECK ((kind = ANY (ARRAY['deal'::text, 'prospect'::text])))
);


--
-- Name: user_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_badges (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    badge_id uuid NOT NULL,
    awarded_at timestamp with time zone DEFAULT now() NOT NULL,
    awarded_by uuid,
    note text
);


--
-- Name: user_comp_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_comp_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid,
    comp_plan_id uuid NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date,
    override_percentage numeric(5,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    hourly_rate_override numeric(10,2),
    created_by_user_id uuid,
    change_reason text,
    replaced_assignment_id uuid
);


--
-- Name: COLUMN user_comp_plans.hourly_rate_override; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_comp_plans.hourly_rate_override IS 'Per-user hourly rate override; takes precedence over comp_plans.hourly_rate.';


--
-- Name: user_google_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_google_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    token_type text DEFAULT 'Bearer'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    scope text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_incentive_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_incentive_goals (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    weekly_doors_target integer,
    weekly_inspections_target integer,
    weekly_sales_target integer,
    weekly_revenue_target numeric(12,2),
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date,
    set_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_incentive_goals_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_incentive_goals_history (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    weekly_doors_target integer,
    weekly_inspections_target integer,
    weekly_sales_target integer,
    weekly_revenue_target numeric(10,2),
    effective_from date NOT NULL,
    effective_to date,
    change_note text
);


--
-- Name: user_management_comp_overlay_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_management_comp_overlay_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    comp_plan_id uuid NOT NULL,
    replaced_assignment_id uuid,
    lane text NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid NOT NULL,
    change_reason text NOT NULL,
    ended_at timestamp with time zone,
    ended_by_user_id uuid,
    end_reason text,
    cancelled_at timestamp with time zone,
    cancelled_by_user_id uuid,
    cancellation_reason text,
    CONSTRAINT user_management_overlay_cancel_audit_check CHECK ((((cancelled_at IS NULL) AND (cancelled_by_user_id IS NULL) AND (cancellation_reason IS NULL)) OR ((cancelled_at IS NOT NULL) AND (cancelled_by_user_id IS NOT NULL) AND (length(btrim(cancellation_reason)) > 0)))),
    CONSTRAINT user_management_overlay_dates_check CHECK (((effective_to IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT user_management_overlay_end_audit_check CHECK ((((ended_at IS NULL) AND (ended_by_user_id IS NULL) AND (end_reason IS NULL)) OR ((ended_at IS NOT NULL) AND (ended_by_user_id IS NOT NULL) AND (length(btrim(end_reason)) > 0)))),
    CONSTRAINT user_management_overlay_lane_check CHECK ((lane = ANY (ARRAY['setter'::text, 'closer'::text]))),
    CONSTRAINT user_management_overlay_reason_check CHECK ((length(btrim(change_reason)) > 0))
);


--
-- Name: TABLE user_management_comp_overlay_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_management_comp_overlay_assignments IS 'Effective-dated management overlay assignments, separate from primary production comp-plan assignments. No historical row means no derived manager override.';


--
-- Name: user_manager_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_manager_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    manager_user_id uuid NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_manager_assignments_check CHECK ((user_id <> manager_user_id)),
    CONSTRAINT user_manager_assignments_check1 CHECK (((effective_to IS NULL) OR (effective_to >= effective_from)))
);


--
-- Name: TABLE user_manager_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_manager_assignments IS 'Effective-dated manager attribution used for sale-date payroll. No row means no verified assignment for that timeframe; current users.manager_user_id is never used to rewrite historical pay.';


--
-- Name: user_payroll_active_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_payroll_active_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    is_active boolean NOT NULL,
    effective_from date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_payroll_active_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_payroll_active_history IS 'Sale-date active status for manager override eligibility. Deactivation takes effect on the next Eastern business date and never rewrites earlier sales.';


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    notes text
);


--
-- Name: TABLE user_permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_permissions IS 'Individual permission grants for users beyond their role permissions';


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    notifications_enabled boolean DEFAULT true NOT NULL,
    email_notifications boolean DEFAULT true NOT NULL,
    push_notifications boolean DEFAULT true NOT NULL,
    notification_types jsonb DEFAULT '{"team_updates": true, "commission_update": true, "inspection_outcome": true, "appointment_reminder": true}'::jsonb,
    google_calendar_connected boolean DEFAULT false NOT NULL,
    default_appointment_duration integer DEFAULT 60,
    appointment_buffer_minutes integer DEFAULT 30,
    working_hours_start time without time zone DEFAULT '08:00:00'::time without time zone,
    working_hours_end time without time zone DEFAULT '18:00:00'::time without time zone,
    working_days integer[] DEFAULT ARRAY[1, 2, 3, 4, 5],
    ai_enabled boolean DEFAULT false NOT NULL,
    ai_suggestions_enabled boolean DEFAULT true NOT NULL,
    ai_auto_notes boolean DEFAULT false NOT NULL,
    theme text DEFAULT 'light'::text,
    dashboard_layout jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    appointment_buffer_before integer DEFAULT 0,
    appointment_buffer_after integer DEFAULT 15
);


--
-- Name: weather_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weather_cache (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid,
    layer text NOT NULL,
    kind text NOT NULL,
    event_date date,
    magnitude numeric,
    damage boolean DEFAULT false,
    geometry jsonb NOT NULL,
    footprint_bbox jsonb,
    source text NOT NULL,
    properties jsonb DEFAULT '{}'::jsonb,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT weather_cache_kind_check CHECK ((kind = ANY (ARRAY['report'::text, 'warning'::text]))),
    CONSTRAINT weather_cache_layer_check CHECK ((layer = ANY (ARRAY['hail'::text, 'wind'::text])))
);


--
-- Name: weather_refresh_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weather_refresh_runs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT weather_refresh_runs_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'partial'::text, 'failed'::text])))
);


--
-- Name: weather_swaths; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weather_swaths (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid,
    event_date date NOT NULL,
    layer text NOT NULL,
    magnitude numeric NOT NULL,
    geometry jsonb NOT NULL,
    source text DEFAULT 'mrms_mesh'::text NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT weather_swaths_layer_check CHECK ((layer = ANY (ARRAY['hail'::text, 'wind'::text])))
);


--
-- Name: work_order_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_order_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    work_order_id uuid NOT NULL,
    user_id uuid,
    sub_id uuid,
    comment text NOT NULL,
    is_internal boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: work_order_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_order_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    work_order_id uuid NOT NULL,
    photo_type text NOT NULL,
    storage_path text NOT NULL,
    file_name text,
    mime_type text DEFAULT 'image/jpeg'::text,
    uploaded_by_sub_id uuid,
    uploaded_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT work_order_photos_photo_type_check CHECK ((photo_type = ANY (ARRAY['work_done'::text, 'cleanup'::text])))
);


--
-- Name: TABLE work_order_photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.work_order_photos IS 'Photos uploaded by subs when completing work orders';


--
-- Name: COLUMN work_order_photos.photo_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.work_order_photos.photo_type IS 'Category: work_done or cleanup';


--
-- Name: work_order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_order_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    work_order_id uuid NOT NULL,
    old_status text,
    new_status text NOT NULL,
    changed_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: work_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    work_order_number text NOT NULL,
    project_id uuid,
    customer_id uuid,
    work_order_type text DEFAULT 'go_back'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    assigned_user_id uuid,
    assigned_sub_id uuid,
    address text,
    city text,
    state text,
    zip text,
    title text NOT NULL,
    description text,
    scope_of_work text,
    materials jsonb DEFAULT '[]'::jsonb,
    scheduled_date date,
    scheduled_time_start time without time zone,
    scheduled_time_end time without time zone,
    estimated_hours numeric(5,2),
    completed_at timestamp with time zone,
    completed_by uuid,
    completion_notes text,
    before_photos text[],
    after_photos text[],
    billable_to_customer boolean DEFAULT false,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sub_completion_notes text,
    completed_by_sub_id uuid,
    trade text,
    trade_source text,
    install_days numeric(3,1),
    install_google_event_id text,
    install_calendar_id text,
    install_sync_failed_at timestamp with time zone,
    install_sync_error text,
    crew_link_token text,
    job_id uuid,
    estimated_cost numeric,
    actual_cost numeric,
    CONSTRAINT work_order_single_assignee CHECK ((((assigned_user_id IS NULL) AND (assigned_sub_id IS NULL)) OR ((assigned_user_id IS NOT NULL) AND (assigned_sub_id IS NULL)) OR ((assigned_user_id IS NULL) AND (assigned_sub_id IS NOT NULL)))),
    CONSTRAINT work_orders_install_days_check CHECK (((install_days IS NULL) OR (install_days = ANY (ARRAY[0.5, (1)::numeric, 1.5, (2)::numeric])))),
    CONSTRAINT work_orders_trade_source_check CHECK (((trade_source IS NULL) OR (trade_source = ANY (ARRAY['auto'::text, 'manual'::text]))))
);


--
-- Name: COLUMN work_orders.project_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.work_orders.project_id IS 'Legacy/secondary - kept for backwards compatibility, prefer job_id';


--
-- Name: COLUMN work_orders.sub_completion_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.work_orders.sub_completion_notes IS 'Completion notes submitted by the sub contractor';


--
-- Name: COLUMN work_orders.completed_by_sub_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.work_orders.completed_by_sub_id IS 'Sub contractor who marked the work order complete';


--
-- Name: COLUMN work_orders.job_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.work_orders.job_id IS 'Primary parent - the production job this work order belongs to';


--
-- Name: referral_partner_assignment_log seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partner_assignment_log ALTER COLUMN seq SET DEFAULT nextval('public.referral_partner_assignment_log_seq_seq'::regclass);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: adder_categories adder_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adder_categories
    ADD CONSTRAINT adder_categories_pkey PRIMARY KEY (id);


--
-- Name: ai_conversations ai_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_pkey PRIMARY KEY (id);


--
-- Name: ai_message_feedback ai_message_feedback_conversation_id_message_index_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_message_feedback
    ADD CONSTRAINT ai_message_feedback_conversation_id_message_index_user_id_key UNIQUE (conversation_id, message_index, user_id);


--
-- Name: ai_message_feedback ai_message_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_message_feedback
    ADD CONSTRAINT ai_message_feedback_pkey PRIMARY KEY (id);


--
-- Name: ai_suggestions ai_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestions
    ADD CONSTRAINT ai_suggestions_pkey PRIMARY KEY (id);


--
-- Name: announcement_dismissals announcement_dismissals_announcement_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_dismissals
    ADD CONSTRAINT announcement_dismissals_announcement_id_user_id_key UNIQUE (announcement_id, user_id);


--
-- Name: announcement_dismissals announcement_dismissals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_dismissals
    ADD CONSTRAINT announcement_dismissals_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_org_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_org_id_slug_key UNIQUE (org_id, slug);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: appointment_closeouts appointment_closeouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_closeouts
    ADD CONSTRAINT appointment_closeouts_pkey PRIMARY KEY (id);


--
-- Name: appointment_types appointment_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_types
    ADD CONSTRAINT appointment_types_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_org_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_org_id_name_key UNIQUE (org_id, name);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: canvass_knocks canvass_knocks_lead_created_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_knocks
    ADD CONSTRAINT canvass_knocks_lead_created_unique UNIQUE (lead_id, user_id, created_at);


--
-- Name: canvass_knocks canvass_knocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_knocks
    ADD CONSTRAINT canvass_knocks_pkey PRIMARY KEY (id);


--
-- Name: canvass_parcel_years canvass_parcel_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_parcel_years
    ADD CONSTRAINT canvass_parcel_years_pkey PRIMARY KEY (county, pin);


--
-- Name: canvass_territories canvass_territories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_territories
    ADD CONSTRAINT canvass_territories_pkey PRIMARY KEY (id);


--
-- Name: canvass_territory_teams canvass_territory_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_territory_teams
    ADD CONSTRAINT canvass_territory_teams_pkey PRIMARY KEY (territory_id, team_id);


--
-- Name: canvass_territory_users canvass_territory_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_territory_users
    ADD CONSTRAINT canvass_territory_users_pkey PRIMARY KEY (territory_id, user_id);


--
-- Name: close_appointments close_appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.close_appointments
    ADD CONSTRAINT close_appointments_pkey PRIMARY KEY (id);


--
-- Name: coaching_goals coaching_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_goals
    ADD CONSTRAINT coaching_goals_pkey PRIMARY KEY (id);


--
-- Name: coaching_goals coaching_goals_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_goals
    ADD CONSTRAINT coaching_goals_user_id_key UNIQUE (user_id);


--
-- Name: commissions commissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commissions
    ADD CONSTRAINT commissions_pkey PRIMARY KEY (id);


--
-- Name: comp_plan_versions comp_plan_versions_effective_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comp_plan_versions
    ADD CONSTRAINT comp_plan_versions_effective_unique UNIQUE (org_id, comp_plan_id, effective_from);


--
-- Name: comp_plan_versions comp_plan_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comp_plan_versions
    ADD CONSTRAINT comp_plan_versions_pkey PRIMARY KEY (id);


--
-- Name: comp_plans comp_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comp_plans
    ADD CONSTRAINT comp_plans_pkey PRIMARY KEY (id);


--
-- Name: contract_events contract_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_events
    ADD CONSTRAINT contract_events_pkey PRIMARY KEY (id);


--
-- Name: contract_signatures contract_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_signatures
    ADD CONSTRAINT contract_signatures_pkey PRIMARY KEY (id);


--
-- Name: contract_templates contract_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_templates
    ADD CONSTRAINT contract_templates_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_token_key UNIQUE (token);


--
-- Name: cost_attachments cost_attachments_job_cost_line_id_document_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_attachments
    ADD CONSTRAINT cost_attachments_job_cost_line_id_document_id_key UNIQUE (job_cost_line_id, document_id);


--
-- Name: cost_attachments cost_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_attachments
    ADD CONSTRAINT cost_attachments_pkey PRIMARY KEY (id);


--
-- Name: crews crews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crews
    ADD CONSTRAINT crews_pkey PRIMARY KEY (id);


--
-- Name: custom_reports custom_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_reports
    ADD CONSTRAINT custom_reports_pkey PRIMARY KEY (id);


--
-- Name: custom_roles custom_roles_org_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_roles
    ADD CONSTRAINT custom_roles_org_id_name_key UNIQUE (org_id, name);


--
-- Name: custom_roles custom_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_roles
    ADD CONSTRAINT custom_roles_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: dashboard_settings dashboard_settings_org_id_region_id_team_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_settings
    ADD CONSTRAINT dashboard_settings_org_id_region_id_team_id_user_id_key UNIQUE (org_id, region_id, team_id, user_id);


--
-- Name: dashboard_settings dashboard_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_settings
    ADD CONSTRAINT dashboard_settings_pkey PRIMARY KEY (id);


--
-- Name: data_fix_backups data_fix_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_fix_backups
    ADD CONSTRAINT data_fix_backups_pkey PRIMARY KEY (id);


--
-- Name: deal_commission_roles deal_commission_roles_job_id_role_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_commission_roles
    ADD CONSTRAINT deal_commission_roles_job_id_role_user_id_key UNIQUE (job_id, role, user_id);


--
-- Name: deal_commission_roles deal_commission_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_commission_roles
    ADD CONSTRAINT deal_commission_roles_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: email_blast_sends email_blast_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_blast_sends
    ADD CONSTRAINT email_blast_sends_pkey PRIMARY KEY (id);


--
-- Name: employee_comp_agreement_events employee_comp_agreement_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_comp_agreement_events
    ADD CONSTRAINT employee_comp_agreement_events_pkey PRIMARY KEY (id);


--
-- Name: employee_comp_agreements employee_comp_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_comp_agreements
    ADD CONSTRAINT employee_comp_agreements_pkey PRIMARY KEY (id);


--
-- Name: estimate_line_items estimate_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_line_items
    ADD CONSTRAINT estimate_line_items_pkey PRIMARY KEY (id);


--
-- Name: estimate_lines estimate_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_lines
    ADD CONSTRAINT estimate_lines_pkey PRIMARY KEY (id);


--
-- Name: estimates estimates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates
    ADD CONSTRAINT estimates_pkey PRIMARY KEY (id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: financing_programs financing_programs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financing_programs
    ADD CONSTRAINT financing_programs_pkey PRIMARY KEY (id);


--
-- Name: founder_contacts founder_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.founder_contacts
    ADD CONSTRAINT founder_contacts_pkey PRIMARY KEY (id);


--
-- Name: inbound_lead_queue inbound_lead_queue_lead_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_lead_queue
    ADD CONSTRAINT inbound_lead_queue_lead_id_key UNIQUE (lead_id);


--
-- Name: inbound_lead_queue inbound_lead_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_lead_queue
    ADD CONSTRAINT inbound_lead_queue_pkey PRIMARY KEY (id);


--
-- Name: incentive_badges incentive_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incentive_badges
    ADD CONSTRAINT incentive_badges_pkey PRIMARY KEY (id);


--
-- Name: incentive_cycles incentive_cycles_org_id_cadence_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incentive_cycles
    ADD CONSTRAINT incentive_cycles_org_id_cadence_label_key UNIQUE (org_id, cadence, label);


--
-- Name: incentive_cycles incentive_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incentive_cycles
    ADD CONSTRAINT incentive_cycles_pkey PRIMARY KEY (id);


--
-- Name: inspection_briefings inspection_briefings_org_id_appointment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_briefings
    ADD CONSTRAINT inspection_briefings_org_id_appointment_id_key UNIQUE (org_id, appointment_id);


--
-- Name: inspection_briefings inspection_briefings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_briefings
    ADD CONSTRAINT inspection_briefings_pkey PRIMARY KEY (id);


--
-- Name: inspection_report_photos inspection_report_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_report_photos
    ADD CONSTRAINT inspection_report_photos_pkey PRIMARY KEY (id);


--
-- Name: inspection_reports inspection_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_reports
    ADD CONSTRAINT inspection_reports_pkey PRIMARY KEY (id);


--
-- Name: inspection_reports inspection_reports_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_reports
    ADD CONSTRAINT inspection_reports_share_token_key UNIQUE (share_token);


--
-- Name: inspection_result_photos inspection_result_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_result_photos
    ADD CONSTRAINT inspection_result_photos_pkey PRIMARY KEY (id);


--
-- Name: inspection_results inspection_results_opportunity_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_results
    ADD CONSTRAINT inspection_results_opportunity_id_unique UNIQUE (opportunity_id);


--
-- Name: inspection_results inspection_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_results
    ADD CONSTRAINT inspection_results_pkey PRIMARY KEY (id);


--
-- Name: inspection_status_updates inspection_status_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_status_updates
    ADD CONSTRAINT inspection_status_updates_pkey PRIMARY KEY (id);


--
-- Name: instant_estimate_checks instant_estimate_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instant_estimate_checks
    ADD CONSTRAINT instant_estimate_checks_pkey PRIMARY KEY (id);


--
-- Name: integration_configs integration_configs_org_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_configs
    ADD CONSTRAINT integration_configs_org_id_provider_key UNIQUE (org_id, provider);


--
-- Name: integration_configs integration_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_configs
    ADD CONSTRAINT integration_configs_pkey PRIMARY KEY (id);


--
-- Name: integration_outbox integration_outbox_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_outbox
    ADD CONSTRAINT integration_outbox_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: integration_outbox integration_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_outbox
    ADD CONSTRAINT integration_outbox_pkey PRIMARY KEY (id);


--
-- Name: invoice_payments invoice_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_pkey PRIMARY KEY (id);


--
-- Name: job_additional_scope job_additional_scope_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_additional_scope
    ADD CONSTRAINT job_additional_scope_pkey PRIMARY KEY (id);


--
-- Name: job_change_orders job_change_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_change_orders
    ADD CONSTRAINT job_change_orders_pkey PRIMARY KEY (id);


--
-- Name: job_checkups job_checkups_job_offset_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_checkups
    ADD CONSTRAINT job_checkups_job_offset_key UNIQUE (production_job_id, month_offset);


--
-- Name: job_checkups job_checkups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_checkups
    ADD CONSTRAINT job_checkups_pkey PRIMARY KEY (id);


--
-- Name: job_cost_lines job_cost_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_lines
    ADD CONSTRAINT job_cost_lines_pkey PRIMARY KEY (id);


--
-- Name: job_cost_order_migration_log job_cost_order_migration_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_order_migration_log
    ADD CONSTRAINT job_cost_order_migration_log_pkey PRIMARY KEY (id);


--
-- Name: job_cost_order_migration_log job_cost_order_migration_log_product_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_order_migration_log
    ADD CONSTRAINT job_cost_order_migration_log_product_order_id_key UNIQUE (product_order_id);


--
-- Name: job_files job_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_files
    ADD CONSTRAINT job_files_pkey PRIMARY KEY (id);


--
-- Name: job_invoice_items job_invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_invoice_items
    ADD CONSTRAINT job_invoice_items_pkey PRIMARY KEY (id);


--
-- Name: job_invoices job_invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_invoices
    ADD CONSTRAINT job_invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: job_invoices job_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_invoices
    ADD CONSTRAINT job_invoices_pkey PRIMARY KEY (id);


--
-- Name: job_material_order_overrides job_material_order_overrides_job_id_item_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_material_order_overrides
    ADD CONSTRAINT job_material_order_overrides_job_id_item_key_key UNIQUE (job_id, item_key);


--
-- Name: job_material_order_overrides job_material_order_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_material_order_overrides
    ADD CONSTRAINT job_material_order_overrides_pkey PRIMARY KEY (id);


--
-- Name: job_measure_elevations job_measure_elevations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_elevations
    ADD CONSTRAINT job_measure_elevations_pkey PRIMARY KEY (id);


--
-- Name: job_measure_openings job_measure_openings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_openings
    ADD CONSTRAINT job_measure_openings_pkey PRIMARY KEY (id);


--
-- Name: job_measure_photos job_measure_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_photos
    ADD CONSTRAINT job_measure_photos_pkey PRIMARY KEY (id);


--
-- Name: job_measure_reports job_measure_reports_opportunity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_reports
    ADD CONSTRAINT job_measure_reports_opportunity_id_key UNIQUE (opportunity_id);


--
-- Name: job_measure_reports job_measure_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_reports
    ADD CONSTRAINT job_measure_reports_pkey PRIMARY KEY (id);


--
-- Name: job_payments job_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_payments
    ADD CONSTRAINT job_payments_pkey PRIMARY KEY (id);


--
-- Name: job_payroll_state job_payroll_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_payroll_state
    ADD CONSTRAINT job_payroll_state_pkey PRIMARY KEY (job_id);


--
-- Name: job_product_orders job_product_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_product_orders
    ADD CONSTRAINT job_product_orders_pkey PRIMARY KEY (id);


--
-- Name: job_run_sheet_overrides job_run_sheet_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_run_sheet_overrides
    ADD CONSTRAINT job_run_sheet_overrides_pkey PRIMARY KEY (id);


--
-- Name: job_trade_material_sources job_trade_material_sources_job_id_trade_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_trade_material_sources
    ADD CONSTRAINT job_trade_material_sources_job_id_trade_key UNIQUE (job_id, trade);


--
-- Name: job_trade_material_sources job_trade_material_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_trade_material_sources
    ADD CONSTRAINT job_trade_material_sources_pkey PRIMARY KEY (id);


--
-- Name: projects jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey1 PRIMARY KEY (id);


--
-- Name: lead_sources lead_sources_org_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_sources
    ADD CONSTRAINT lead_sources_org_id_name_key UNIQUE (org_id, name);


--
-- Name: lead_sources lead_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_sources
    ADD CONSTRAINT lead_sources_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: lidar_tiles lidar_tiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lidar_tiles
    ADD CONSTRAINT lidar_tiles_pkey PRIMARY KEY (id);


--
-- Name: management_comp_overlay_plan_versions management_comp_overlay_plan_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.management_comp_overlay_plan_versions
    ADD CONSTRAINT management_comp_overlay_plan_versions_pkey PRIMARY KEY (id);


--
-- Name: management_comp_overlay_plan_versions management_overlay_version_effective_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.management_comp_overlay_plan_versions
    ADD CONSTRAINT management_overlay_version_effective_unique UNIQUE (org_id, comp_plan_id, lane, effective_from);


--
-- Name: material_orders material_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_orders
    ADD CONSTRAINT material_orders_pkey PRIMARY KEY (id);


--
-- Name: measurement_requests measurement_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_requests
    ADD CONSTRAINT measurement_requests_pkey PRIMARY KEY (id);


--
-- Name: mobile_device_tokens mobile_device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_device_tokens
    ADD CONSTRAINT mobile_device_tokens_pkey PRIMARY KEY (id);


--
-- Name: mobile_device_tokens mobile_device_tokens_user_id_device_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_device_tokens
    ADD CONSTRAINT mobile_device_tokens_user_id_device_token_key UNIQUE (user_id, device_token);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: opportunities opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_pkey PRIMARY KEY (id);


--
-- Name: order_form_contracts order_form_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_form_contracts
    ADD CONSTRAINT order_form_contracts_pkey PRIMARY KEY (id);


--
-- Name: order_form_contracts order_form_contracts_signing_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_form_contracts
    ADD CONSTRAINT order_form_contracts_signing_token_key UNIQUE (signing_token);


--
-- Name: org_default_comp_plans org_default_comp_plans_org_id_role_effective_from_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_default_comp_plans
    ADD CONSTRAINT org_default_comp_plans_org_id_role_effective_from_key UNIQUE (org_id, role, effective_from);


--
-- Name: org_default_comp_plans org_default_comp_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_default_comp_plans
    ADD CONSTRAINT org_default_comp_plans_pkey PRIMARY KEY (id);


--
-- Name: org_derived_commission_rates org_derived_commission_rates_org_id_effective_from_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_derived_commission_rates
    ADD CONSTRAINT org_derived_commission_rates_org_id_effective_from_key UNIQUE (org_id, effective_from);


--
-- Name: org_derived_commission_rates org_derived_commission_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_derived_commission_rates
    ADD CONSTRAINT org_derived_commission_rates_pkey PRIMARY KEY (id);


--
-- Name: org_monthly_goal_audit org_monthly_goal_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_monthly_goal_audit
    ADD CONSTRAINT org_monthly_goal_audit_pkey PRIMARY KEY (id);


--
-- Name: org_monthly_goals org_monthly_goals_org_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_monthly_goals
    ADD CONSTRAINT org_monthly_goals_org_id_month_key UNIQUE (org_id, month);


--
-- Name: org_monthly_goals org_monthly_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_monthly_goals
    ADD CONSTRAINT org_monthly_goals_pkey PRIMARY KEY (id);


--
-- Name: org_trade_material_defaults org_trade_material_defaults_org_id_trade_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_trade_material_defaults
    ADD CONSTRAINT org_trade_material_defaults_org_id_trade_key UNIQUE (org_id, trade);


--
-- Name: org_trade_material_defaults org_trade_material_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_trade_material_defaults
    ADD CONSTRAINT org_trade_material_defaults_pkey PRIMARY KEY (id);


--
-- Name: org_trades org_trades_org_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_trades
    ADD CONSTRAINT org_trades_org_slug_key UNIQUE (org_id, slug);


--
-- Name: org_trades org_trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_trades
    ADD CONSTRAINT org_trades_pkey PRIMARY KEY (id);


--
-- Name: orgs orgs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_pkey PRIMARY KEY (id);


--
-- Name: payroll_adjustments payroll_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_adjustments
    ADD CONSTRAINT payroll_adjustments_pkey PRIMARY KEY (id);


--
-- Name: payroll_bonus_lines payroll_bonus_lines_payroll_period_id_user_id_bonus_type_so_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_bonus_lines
    ADD CONSTRAINT payroll_bonus_lines_payroll_period_id_user_id_bonus_type_so_key UNIQUE (payroll_period_id, user_id, bonus_type, source_id);


--
-- Name: payroll_bonus_lines payroll_bonus_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_bonus_lines
    ADD CONSTRAINT payroll_bonus_lines_pkey PRIMARY KEY (id);


--
-- Name: payroll_chargeback_applications payroll_chargeback_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_chargeback_applications
    ADD CONSTRAINT payroll_chargeback_applications_pkey PRIMARY KEY (id);


--
-- Name: payroll_chargebacks payroll_chargebacks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_chargebacks
    ADD CONSTRAINT payroll_chargebacks_pkey PRIMARY KEY (id);


--
-- Name: payroll_disputes payroll_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_disputes
    ADD CONSTRAINT payroll_disputes_pkey PRIMARY KEY (id);


--
-- Name: payroll_job_snapshots payroll_job_snapshots_payroll_period_id_job_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_job_snapshots
    ADD CONSTRAINT payroll_job_snapshots_payroll_period_id_job_id_key UNIQUE (payroll_period_id, job_id);


--
-- Name: payroll_job_snapshots payroll_job_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_job_snapshots
    ADD CONSTRAINT payroll_job_snapshots_pkey PRIMARY KEY (id);


--
-- Name: payroll_override_audit payroll_override_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_override_audit
    ADD CONSTRAINT payroll_override_audit_pkey PRIMARY KEY (id);


--
-- Name: payroll_payout_lines payroll_payout_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payout_lines
    ADD CONSTRAINT payroll_payout_lines_pkey PRIMARY KEY (id);


--
-- Name: payroll_period_snapshots payroll_period_snapshots_payroll_period_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_period_snapshots
    ADD CONSTRAINT payroll_period_snapshots_payroll_period_id_key UNIQUE (payroll_period_id);


--
-- Name: payroll_period_snapshots payroll_period_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_period_snapshots
    ADD CONSTRAINT payroll_period_snapshots_pkey PRIMARY KEY (id);


--
-- Name: payroll_periods payroll_periods_org_id_period_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_periods
    ADD CONSTRAINT payroll_periods_org_id_period_label_key UNIQUE (org_id, period_label);


--
-- Name: payroll_periods payroll_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_periods
    ADD CONSTRAINT payroll_periods_pkey PRIMARY KEY (id);


--
-- Name: payroll_rep_hours_audit payroll_rep_hours_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_rep_hours_audit
    ADD CONSTRAINT payroll_rep_hours_audit_pkey PRIMARY KEY (id);


--
-- Name: payroll_rep_hours payroll_rep_hours_payroll_period_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_rep_hours
    ADD CONSTRAINT payroll_rep_hours_payroll_period_id_user_id_key UNIQUE (payroll_period_id, user_id);


--
-- Name: payroll_rep_hours payroll_rep_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_rep_hours
    ADD CONSTRAINT payroll_rep_hours_pkey PRIMARY KEY (id);


--
-- Name: payroll_statement_deliveries payroll_statement_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_statement_deliveries
    ADD CONSTRAINT payroll_statement_deliveries_pkey PRIMARY KEY (id);


--
-- Name: payroll_unit_earnings payroll_unit_earnings_payroll_period_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_unit_earnings
    ADD CONSTRAINT payroll_unit_earnings_payroll_period_id_user_id_key UNIQUE (payroll_period_id, user_id);


--
-- Name: payroll_unit_earnings payroll_unit_earnings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_unit_earnings
    ADD CONSTRAINT payroll_unit_earnings_pkey PRIMARY KEY (id);


--
-- Name: pending_status_prompts pending_status_prompts_appointment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_status_prompts
    ADD CONSTRAINT pending_status_prompts_appointment_id_key UNIQUE (appointment_id);


--
-- Name: pending_status_prompts pending_status_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_status_prompts
    ADD CONSTRAINT pending_status_prompts_pkey PRIMARY KEY (id);


--
-- Name: permission_audit permission_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_audit
    ADD CONSTRAINT permission_audit_pkey PRIMARY KEY (id);


--
-- Name: permission_denials permission_denials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_denials
    ADD CONSTRAINT permission_denials_pkey PRIMARY KEY (id);


--
-- Name: permission_denials permission_denials_user_id_permission_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_denials
    ADD CONSTRAINT permission_denials_user_id_permission_name_key UNIQUE (user_id, permission_name);


--
-- Name: permission_presets permission_presets_org_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_presets
    ADD CONSTRAINT permission_presets_org_id_name_key UNIQUE (org_id, name);


--
-- Name: permission_presets permission_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_presets
    ADD CONSTRAINT permission_presets_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_name_key UNIQUE (name);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: photos photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_pkey PRIMARY KEY (id);


--
-- Name: preset_permissions preset_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_permissions
    ADD CONSTRAINT preset_permissions_pkey PRIMARY KEY (id);


--
-- Name: preset_permissions preset_permissions_preset_id_permission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_permissions
    ADD CONSTRAINT preset_permissions_preset_id_permission_id_key UNIQUE (preset_id, permission_id);


--
-- Name: pricebook_items pricebook_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricebook_items
    ADD CONSTRAINT pricebook_items_pkey PRIMARY KEY (id);


--
-- Name: pricebooks pricebooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricebooks
    ADD CONSTRAINT pricebooks_pkey PRIMARY KEY (id);


--
-- Name: primary_comp_plan_assignment_cancellations primary_comp_plan_assignment_cancellations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.primary_comp_plan_assignment_cancellations
    ADD CONSTRAINT primary_comp_plan_assignment_cancellations_pkey PRIMARY KEY (id);


--
-- Name: production_job_notes production_job_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_job_notes
    ADD CONSTRAINT production_job_notes_pkey PRIMARY KEY (id);


--
-- Name: production_jobs production_jobs_org_id_job_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_org_id_job_number_key UNIQUE (org_id, job_number);


--
-- Name: production_jobs production_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_pkey PRIMARY KEY (id);


--
-- Name: program_444_enrollments program_444_enrollments_org_id_user_id_start_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_444_enrollments
    ADD CONSTRAINT program_444_enrollments_org_id_user_id_start_date_key UNIQUE (org_id, user_id, start_date);


--
-- Name: program_444_enrollments program_444_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_444_enrollments
    ADD CONSTRAINT program_444_enrollments_pkey PRIMARY KEY (id);


--
-- Name: proposal_line_items proposal_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_line_items
    ADD CONSTRAINT proposal_line_items_pkey PRIMARY KEY (id);


--
-- Name: proposal_photos proposal_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_photos
    ADD CONSTRAINT proposal_photos_pkey PRIMARY KEY (id);


--
-- Name: proposal_templates proposal_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_templates
    ADD CONSTRAINT proposal_templates_pkey PRIMARY KEY (id);


--
-- Name: proposals proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_pkey PRIMARY KEY (id);


--
-- Name: public_estimate_previews public_estimate_previews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_estimate_previews
    ADD CONSTRAINT public_estimate_previews_pkey PRIMARY KEY (jti);


--
-- Name: public_estimate_unlock_deliveries public_estimate_unlock_deliveries_lead_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_estimate_unlock_deliveries
    ADD CONSTRAINT public_estimate_unlock_deliveries_lead_key_unique UNIQUE (lead_id, delivery_key);


--
-- Name: public_estimate_unlock_deliveries public_estimate_unlock_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_estimate_unlock_deliveries
    ADD CONSTRAINT public_estimate_unlock_deliveries_pkey PRIMARY KEY (id);


--
-- Name: referral_partner_assignment_log referral_partner_assignment_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partner_assignment_log
    ADD CONSTRAINT referral_partner_assignment_log_pkey PRIMARY KEY (id);


--
-- Name: referral_partner_types referral_partner_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partner_types
    ADD CONSTRAINT referral_partner_types_pkey PRIMARY KEY (id);


--
-- Name: referral_partners referral_partners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partners
    ADD CONSTRAINT referral_partners_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (id);


--
-- Name: report_role_access report_role_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_role_access
    ADD CONSTRAINT report_role_access_pkey PRIMARY KEY (id);


--
-- Name: report_role_access report_role_access_report_id_custom_role_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_role_access
    ADD CONSTRAINT report_role_access_report_id_custom_role_id_key UNIQUE (report_id, custom_role_id);


--
-- Name: report_role_access report_role_access_report_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_role_access
    ADD CONSTRAINT report_role_access_report_id_role_key UNIQUE (report_id, role);


--
-- Name: report_schedules report_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_schedules
    ADD CONSTRAINT report_schedules_pkey PRIMARY KEY (id);


--
-- Name: review_requests review_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests
    ADD CONSTRAINT review_requests_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_id_permission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_permission_id_key UNIQUE (role_id, permission_id);


--
-- Name: roof_facets roof_facets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roof_facets
    ADD CONSTRAINT roof_facets_pkey PRIMARY KEY (id);


--
-- Name: roof_measurements roof_measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roof_measurements
    ADD CONSTRAINT roof_measurements_pkey PRIMARY KEY (id);


--
-- Name: roofing_types roofing_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roofing_types
    ADD CONSTRAINT roofing_types_pkey PRIMARY KEY (id);


--
-- Name: saved_report_filters saved_report_filters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_report_filters
    ADD CONSTRAINT saved_report_filters_pkey PRIMARY KEY (id);


--
-- Name: saved_report_filters saved_report_filters_user_id_report_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_report_filters
    ADD CONSTRAINT saved_report_filters_user_id_report_id_name_key UNIQUE (user_id, report_id, name);


--
-- Name: saved_reports saved_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports
    ADD CONSTRAINT saved_reports_pkey PRIMARY KEY (id);


--
-- Name: scheduled_appointments scheduled_appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_appointments
    ADD CONSTRAINT scheduled_appointments_pkey PRIMARY KEY (id);


--
-- Name: setter_ramp_enrollments setter_ramp_enrollments_org_id_user_id_start_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setter_ramp_enrollments
    ADD CONSTRAINT setter_ramp_enrollments_org_id_user_id_start_date_key UNIQUE (org_id, user_id, start_date);


--
-- Name: setter_ramp_enrollments setter_ramp_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setter_ramp_enrollments
    ADD CONSTRAINT setter_ramp_enrollments_pkey PRIMARY KEY (id);


--
-- Name: setter_ramp_weekly_status setter_ramp_weekly_status_enrollment_id_week_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setter_ramp_weekly_status
    ADD CONSTRAINT setter_ramp_weekly_status_enrollment_id_week_number_key UNIQUE (enrollment_id, week_number);


--
-- Name: setter_ramp_weekly_status setter_ramp_weekly_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setter_ramp_weekly_status
    ADD CONSTRAINT setter_ramp_weekly_status_pkey PRIMARY KEY (id);


--
-- Name: solar_candidates solar_candidates_county_pin_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solar_candidates
    ADD CONSTRAINT solar_candidates_county_pin_key UNIQUE (county, pin);


--
-- Name: solar_candidates solar_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solar_candidates
    ADD CONSTRAINT solar_candidates_pkey PRIMARY KEY (id);


--
-- Name: solar_installers solar_installers_name_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solar_installers
    ADD CONSTRAINT solar_installers_name_key_key UNIQUE (name_key);


--
-- Name: solar_installers solar_installers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solar_installers
    ADD CONSTRAINT solar_installers_pkey PRIMARY KEY (id);


--
-- Name: solar_installs solar_installs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solar_installs
    ADD CONSTRAINT solar_installs_pkey PRIMARY KEY (id);


--
-- Name: spiff_achievements spiff_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spiff_achievements
    ADD CONSTRAINT spiff_achievements_pkey PRIMARY KEY (id);


--
-- Name: spiff_achievements spiff_achievements_spiff_program_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spiff_achievements
    ADD CONSTRAINT spiff_achievements_spiff_program_id_user_id_key UNIQUE (spiff_program_id, user_id);


--
-- Name: spiff_programs spiff_programs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spiff_programs
    ADD CONSTRAINT spiff_programs_pkey PRIMARY KEY (id);


--
-- Name: storm_opportunity_alerts storm_opportunity_alerts_org_id_opportunity_id_event_date_l_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storm_opportunity_alerts
    ADD CONSTRAINT storm_opportunity_alerts_org_id_opportunity_id_event_date_l_key UNIQUE (org_id, opportunity_id, event_date, layer);


--
-- Name: storm_opportunity_alerts storm_opportunity_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storm_opportunity_alerts
    ADD CONSTRAINT storm_opportunity_alerts_pkey PRIMARY KEY (id);


--
-- Name: sub_contractors sub_contractors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_contractors
    ADD CONSTRAINT sub_contractors_pkey PRIMARY KEY (id);


--
-- Name: sub_contractors sub_contractors_portal_access_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_contractors
    ADD CONSTRAINT sub_contractors_portal_access_token_key UNIQUE (portal_access_token);


--
-- Name: supplier_api_approvals supplier_api_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_approvals
    ADD CONSTRAINT supplier_api_approvals_pkey PRIMARY KEY (id);


--
-- Name: supplier_api_events supplier_api_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_events
    ADD CONSTRAINT supplier_api_events_pkey PRIMARY KEY (id);


--
-- Name: supplier_api_settings supplier_api_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_settings
    ADD CONSTRAINT supplier_api_settings_pkey PRIMARY KEY (id);


--
-- Name: supplier_api_settings supplier_api_settings_vendor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_settings
    ADD CONSTRAINT supplier_api_settings_vendor_id_key UNIQUE (vendor_id);


--
-- Name: supplier_audit_log supplier_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_audit_log
    ADD CONSTRAINT supplier_audit_log_pkey PRIMARY KEY (id);


--
-- Name: supplier_item_map supplier_item_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_item_map
    ADD CONSTRAINT supplier_item_map_pkey PRIMARY KEY (id);


--
-- Name: supplier_item_map supplier_item_map_vendor_id_line_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_item_map
    ADD CONSTRAINT supplier_item_map_vendor_id_line_key_key UNIQUE (vendor_id, line_key);


--
-- Name: supplier_order_send_lines supplier_order_send_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_lines
    ADD CONSTRAINT supplier_order_send_lines_pkey PRIMARY KEY (id);


--
-- Name: supplier_order_send_lines supplier_order_send_lines_send_id_line_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_lines
    ADD CONSTRAINT supplier_order_send_lines_send_id_line_key_key UNIQUE (send_id, line_key);


--
-- Name: supplier_order_send_sourcing supplier_order_send_sourcing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_sourcing
    ADD CONSTRAINT supplier_order_send_sourcing_pkey PRIMARY KEY (id);


--
-- Name: supplier_order_send_sourcing supplier_order_send_sourcing_send_id_trade_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_sourcing
    ADD CONSTRAINT supplier_order_send_sourcing_send_id_trade_key UNIQUE (send_id, trade);


--
-- Name: supplier_order_sends supplier_order_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_sends
    ADD CONSTRAINT supplier_order_sends_pkey PRIMARY KEY (id);


--
-- Name: supplier_orders supplier_orders_job_id_po_letter_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_orders
    ADD CONSTRAINT supplier_orders_job_id_po_letter_key UNIQUE (job_id, po_letter);


--
-- Name: supplier_orders supplier_orders_job_id_vendor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_orders
    ADD CONSTRAINT supplier_orders_job_id_vendor_id_key UNIQUE (job_id, vendor_id);


--
-- Name: supplier_orders supplier_orders_org_id_po_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_orders
    ADD CONSTRAINT supplier_orders_org_id_po_number_key UNIQUE (org_id, po_number);


--
-- Name: supplier_orders supplier_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_orders
    ADD CONSTRAINT supplier_orders_pkey PRIMARY KEY (id);


--
-- Name: table_views table_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_views
    ADD CONSTRAINT table_views_pkey PRIMARY KEY (id);


--
-- Name: table_views table_views_user_id_table_key_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_views
    ADD CONSTRAINT table_views_user_id_table_key_name_key UNIQUE (user_id, table_key, name);


--
-- Name: team_closer_queue team_closer_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_closer_queue
    ADD CONSTRAINT team_closer_queue_pkey PRIMARY KEY (id);


--
-- Name: team_closer_queue team_closer_queue_team_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_closer_queue
    ADD CONSTRAINT team_closer_queue_team_id_user_id_key UNIQUE (team_id, user_id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: thread_members thread_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_members
    ADD CONSTRAINT thread_members_pkey PRIMARY KEY (thread_id, user_id);


--
-- Name: threads threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_pkey PRIMARY KEY (id);


--
-- Name: invoice_payments unique_payment_per_invoice; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT unique_payment_per_invoice UNIQUE (invoice_id, job_payment_id);


--
-- Name: user_badges user_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_pkey PRIMARY KEY (id);


--
-- Name: user_badges user_badges_user_id_badge_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_user_id_badge_id_key UNIQUE (user_id, badge_id);


--
-- Name: user_comp_plans user_comp_plans_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_comp_plans
    ADD CONSTRAINT user_comp_plans_no_overlap EXCLUDE USING gist (org_id WITH =, user_id WITH =, daterange(effective_from, effective_to, '[]'::text) WITH &&) WHERE ((user_id IS NOT NULL));


--
-- Name: user_comp_plans user_comp_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_comp_plans
    ADD CONSTRAINT user_comp_plans_pkey PRIMARY KEY (id);


--
-- Name: user_comp_plans user_comp_plans_user_id_comp_plan_id_effective_from_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_comp_plans
    ADD CONSTRAINT user_comp_plans_user_id_comp_plan_id_effective_from_key UNIQUE (user_id, comp_plan_id, effective_from);


--
-- Name: user_google_tokens user_google_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_google_tokens
    ADD CONSTRAINT user_google_tokens_pkey PRIMARY KEY (id);


--
-- Name: user_google_tokens user_google_tokens_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_google_tokens
    ADD CONSTRAINT user_google_tokens_user_id_key UNIQUE (user_id);


--
-- Name: user_incentive_goals_history user_incentive_goals_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_incentive_goals_history
    ADD CONSTRAINT user_incentive_goals_history_pkey PRIMARY KEY (id);


--
-- Name: user_incentive_goals user_incentive_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_incentive_goals
    ADD CONSTRAINT user_incentive_goals_pkey PRIMARY KEY (id);


--
-- Name: user_incentive_goals user_incentive_goals_user_id_effective_from_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_incentive_goals
    ADD CONSTRAINT user_incentive_goals_user_id_effective_from_key UNIQUE (user_id, effective_from);


--
-- Name: user_management_comp_overlay_assignments user_management_comp_overlay_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_management_comp_overlay_assignments
    ADD CONSTRAINT user_management_comp_overlay_assignments_pkey PRIMARY KEY (id);


--
-- Name: user_management_comp_overlay_assignments user_management_overlay_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_management_comp_overlay_assignments
    ADD CONSTRAINT user_management_overlay_no_overlap EXCLUDE USING gist (org_id WITH =, user_id WITH =, lane WITH =, daterange(effective_from, effective_to, '[]'::text) WITH &&) WHERE ((cancelled_at IS NULL));


--
-- Name: user_management_comp_overlay_assignments user_management_overlay_org_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_management_comp_overlay_assignments
    ADD CONSTRAINT user_management_overlay_org_id_id_unique UNIQUE (org_id, id);


--
-- Name: user_manager_assignments user_manager_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_manager_assignments
    ADD CONSTRAINT user_manager_assignments_pkey PRIMARY KEY (id);


--
-- Name: user_manager_assignments user_manager_assignments_user_id_effective_from_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_manager_assignments
    ADD CONSTRAINT user_manager_assignments_user_id_effective_from_key UNIQUE (user_id, effective_from);


--
-- Name: user_payroll_active_history user_payroll_active_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_payroll_active_history
    ADD CONSTRAINT user_payroll_active_history_pkey PRIMARY KEY (id);


--
-- Name: user_payroll_active_history user_payroll_active_history_user_id_effective_from_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_payroll_active_history
    ADD CONSTRAINT user_payroll_active_history_user_id_effective_from_key UNIQUE (user_id, effective_from);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_user_id_permission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_permission_id_key UNIQUE (user_id, permission_id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: weather_cache weather_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weather_cache
    ADD CONSTRAINT weather_cache_pkey PRIMARY KEY (id);


--
-- Name: weather_refresh_runs weather_refresh_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weather_refresh_runs
    ADD CONSTRAINT weather_refresh_runs_pkey PRIMARY KEY (id);


--
-- Name: weather_swaths weather_swaths_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weather_swaths
    ADD CONSTRAINT weather_swaths_pkey PRIMARY KEY (id);


--
-- Name: work_order_comments work_order_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_comments
    ADD CONSTRAINT work_order_comments_pkey PRIMARY KEY (id);


--
-- Name: work_order_photos work_order_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_photos
    ADD CONSTRAINT work_order_photos_pkey PRIMARY KEY (id);


--
-- Name: work_order_status_history work_order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_status_history
    ADD CONSTRAINT work_order_status_history_pkey PRIMARY KEY (id);


--
-- Name: work_orders work_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_pkey PRIMARY KEY (id);


--
-- Name: activities_body_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_body_trgm ON public.activities USING gin (body extensions.gin_trgm_ops);


--
-- Name: activities_client_id_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX activities_client_id_uq ON public.activities USING btree (client_id) WHERE (client_id IS NOT NULL);


--
-- Name: activities_customer_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_customer_created_idx ON public.activities USING btree (customer_id, created_at DESC);


--
-- Name: activities_opp_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_opp_created_idx ON public.activities USING btree (opportunity_id, created_at DESC);


--
-- Name: activities_thread_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_thread_created_idx ON public.activities USING btree (thread_id, created_at DESC);


--
-- Name: ai_conversations_user_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_conversations_user_updated_idx ON public.ai_conversations USING btree (user_id, updated_at DESC);


--
-- Name: ai_message_feedback_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_message_feedback_conversation_idx ON public.ai_message_feedback USING btree (conversation_id);


--
-- Name: email_blast_sends_org_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_blast_sends_org_date_idx ON public.email_blast_sends USING btree (org_id, send_date DESC);


--
-- Name: email_blast_sends_org_type_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX email_blast_sends_org_type_date_key ON public.email_blast_sends USING btree (org_id, blast_type, send_date);


--
-- Name: founder_contacts_creator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX founder_contacts_creator_idx ON public.founder_contacts USING btree (created_by, created_at DESC);


--
-- Name: founder_contacts_org_client_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX founder_contacts_org_client_id_key ON public.founder_contacts USING btree (org_id, client_id);


--
-- Name: founder_contacts_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX founder_contacts_org_created_idx ON public.founder_contacts USING btree (org_id, created_at DESC);


--
-- Name: founder_contacts_unemailed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX founder_contacts_unemailed_idx ON public.founder_contacts USING btree (created_at) WHERE (emailed_at IS NULL);


--
-- Name: idx_444_enrollments_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_444_enrollments_org ON public.program_444_enrollments USING btree (org_id, status);


--
-- Name: idx_444_enrollments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_444_enrollments_user ON public.program_444_enrollments USING btree (user_id, status);


--
-- Name: idx_444_enrollments_weeks; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_444_enrollments_weeks ON public.program_444_enrollments USING btree (week1_starts_at, week2_ends_at);


--
-- Name: idx_activities_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_customer_id ON public.activities USING btree (customer_id);


--
-- Name: idx_activities_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_lead_id ON public.activities USING btree (lead_id);


--
-- Name: idx_activities_opportunity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_opportunity_id ON public.activities USING btree (opportunity_id);


--
-- Name: idx_activities_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_org_id ON public.activities USING btree (org_id);


--
-- Name: idx_activities_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_project_id ON public.activities USING btree (project_id);


--
-- Name: idx_activities_referral_partner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_referral_partner ON public.activities USING btree (referral_partner_id, created_at DESC) WHERE (referral_partner_id IS NOT NULL);


--
-- Name: idx_adder_categories_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adder_categories_org ON public.adder_categories USING btree (org_id);


--
-- Name: idx_ai_conversations_context; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_conversations_context ON public.ai_conversations USING btree (context_type, context_id);


--
-- Name: idx_ai_conversations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_conversations_user ON public.ai_conversations USING btree (user_id);


--
-- Name: idx_ai_suggestions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_suggestions_user ON public.ai_suggestions USING btree (user_id);


--
-- Name: idx_announcement_dismissals_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcement_dismissals_user ON public.announcement_dismissals USING btree (user_id);


--
-- Name: idx_announcements_org_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_org_window ON public.announcements USING btree (org_id, starts_at DESC);


--
-- Name: idx_appointment_closeouts_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appointment_closeouts_batch ON public.appointment_closeouts USING btree (org_id, batch_id);


--
-- Name: idx_campaigns_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_channel ON public.campaigns USING btree (channel);


--
-- Name: idx_campaigns_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_is_active ON public.campaigns USING btree (is_active);


--
-- Name: idx_campaigns_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_org_id ON public.campaigns USING btree (org_id);


--
-- Name: idx_campaigns_source_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_source_type ON public.campaigns USING btree (source_type);


--
-- Name: idx_campaigns_utm_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_utm_campaign ON public.campaigns USING btree (utm_campaign);


--
-- Name: idx_campaigns_utm_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_utm_source ON public.campaigns USING btree (utm_source);


--
-- Name: idx_canvass_knocks_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvass_knocks_lead ON public.canvass_knocks USING btree (lead_id);


--
-- Name: idx_canvass_knocks_org_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvass_knocks_org_created ON public.canvass_knocks USING btree (org_id, created_at);


--
-- Name: idx_canvass_knocks_org_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvass_knocks_org_user_created ON public.canvass_knocks USING btree (org_id, user_id, created_at);


--
-- Name: idx_canvass_territories_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvass_territories_org_id ON public.canvass_territories USING btree (org_id);


--
-- Name: idx_canvass_territory_teams_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvass_territory_teams_team_id ON public.canvass_territory_teams USING btree (team_id);


--
-- Name: idx_canvass_territory_users_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvass_territory_users_user_id ON public.canvass_territory_users USING btree (user_id);


--
-- Name: idx_close_appointments_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_close_appointments_opportunity ON public.close_appointments USING btree (opportunity_id);


--
-- Name: idx_close_appointments_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_close_appointments_org ON public.close_appointments USING btree (org_id);


--
-- Name: idx_close_appointments_org_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_close_appointments_org_id_id ON public.close_appointments USING btree (org_id, id);


--
-- Name: idx_close_appointments_source_inspection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_close_appointments_source_inspection ON public.close_appointments USING btree (source_inspection_appointment_id);


--
-- Name: idx_coaching_goals_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_goals_org_id ON public.coaching_goals USING btree (org_id);


--
-- Name: idx_coaching_goals_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_goals_user_id ON public.coaching_goals USING btree (user_id);


--
-- Name: idx_commissions_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commissions_period ON public.commissions USING btree (user_id, commission_period);


--
-- Name: idx_commissions_production_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commissions_production_job ON public.commissions USING btree (production_job_id) WHERE (production_job_id IS NOT NULL);


--
-- Name: idx_commissions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commissions_status ON public.commissions USING btree (status);


--
-- Name: idx_commissions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commissions_user ON public.commissions USING btree (user_id);


--
-- Name: idx_comp_plan_versions_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comp_plan_versions_lookup ON public.comp_plan_versions USING btree (org_id, comp_plan_id, effective_from DESC);


--
-- Name: idx_comp_plans_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comp_plans_active ON public.comp_plans USING btree (org_id) WHERE (is_active = true);


--
-- Name: idx_comp_plans_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comp_plans_org ON public.comp_plans USING btree (org_id);


--
-- Name: idx_comp_plans_org_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_comp_plans_org_id_id ON public.comp_plans USING btree (org_id, id);


--
-- Name: idx_contract_signatures_contract_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_signatures_contract_id ON public.contract_signatures USING btree (contract_id);


--
-- Name: idx_contract_signatures_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_signatures_org_id ON public.contract_signatures USING btree (org_id);


--
-- Name: idx_contract_signatures_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_signatures_role ON public.contract_signatures USING btree (role);


--
-- Name: idx_contract_templates_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_templates_org_id ON public.contract_templates USING btree (org_id);


--
-- Name: idx_contracts_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_org_id ON public.contracts USING btree (org_id);


--
-- Name: idx_contracts_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_project_id ON public.contracts USING btree (project_id);


--
-- Name: idx_cost_attachments_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_attachments_document_id ON public.cost_attachments USING btree (document_id);


--
-- Name: idx_cost_attachments_job_cost_line_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_attachments_job_cost_line_id ON public.cost_attachments USING btree (job_cost_line_id);


--
-- Name: idx_cost_attachments_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_attachments_org_id ON public.cost_attachments USING btree (org_id);


--
-- Name: idx_crews_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crews_active ON public.crews USING btree (org_id, active);


--
-- Name: idx_crews_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crews_org_id ON public.crews USING btree (org_id);


--
-- Name: idx_custom_reports_creator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_reports_creator ON public.custom_reports USING btree (created_by);


--
-- Name: idx_custom_reports_dashboard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_reports_dashboard ON public.custom_reports USING btree (org_id) WHERE (is_dashboard_widget = true);


--
-- Name: idx_custom_reports_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_reports_org ON public.custom_reports USING btree (org_id);


--
-- Name: idx_custom_roles_hierarchy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_roles_hierarchy ON public.custom_roles USING btree (org_id, hierarchy_level DESC);


--
-- Name: idx_custom_roles_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_roles_org_id ON public.custom_roles USING btree (org_id);


--
-- Name: idx_customers_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_email_lower ON public.customers USING btree (org_id, email_lower) WHERE ((email_lower IS NOT NULL) AND (email_lower <> ''::text));


--
-- Name: idx_customers_name_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_name_search ON public.customers USING btree (org_id, lower(name));


--
-- Name: idx_customers_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_org_id ON public.customers USING btree (org_id);


--
-- Name: idx_customers_phone_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_phone_normalized ON public.customers USING btree (org_id, phone_normalized) WHERE ((phone_normalized IS NOT NULL) AND (phone_normalized <> ''::text));


--
-- Name: idx_customers_qb_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_qb_customer_id ON public.customers USING btree (qb_customer_id) WHERE (qb_customer_id IS NOT NULL);


--
-- Name: idx_customers_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_sync_status ON public.customers USING btree (sync_status) WHERE (sync_status = 'pending'::public.sync_status);


--
-- Name: idx_dashboard_settings_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_settings_org ON public.dashboard_settings USING btree (org_id);


--
-- Name: idx_dashboard_settings_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_settings_region ON public.dashboard_settings USING btree (region_id);


--
-- Name: idx_dashboard_settings_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_settings_team ON public.dashboard_settings USING btree (team_id);


--
-- Name: idx_dashboard_settings_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_settings_user ON public.dashboard_settings USING btree (user_id);


--
-- Name: idx_deal_commission_roles_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_commission_roles_job ON public.deal_commission_roles USING btree (job_id);


--
-- Name: idx_deal_commission_roles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_commission_roles_user ON public.deal_commission_roles USING btree (org_id, user_id);


--
-- Name: idx_documents_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_created_at ON public.documents USING btree (created_at DESC);


--
-- Name: idx_documents_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_customer_id ON public.documents USING btree (customer_id);


--
-- Name: idx_documents_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_job_id ON public.documents USING btree (job_id);


--
-- Name: idx_documents_linked_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_linked_record ON public.documents USING btree (linked_record_type, linked_record_id);


--
-- Name: idx_documents_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_org_id ON public.documents USING btree (org_id);


--
-- Name: idx_documents_parent_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_parent_document_id ON public.documents USING btree (parent_document_id);


--
-- Name: idx_documents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_status ON public.documents USING btree (org_id, status);


--
-- Name: idx_employee_comp_agreement_events; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_comp_agreement_events ON public.employee_comp_agreement_events USING btree (agreement_id, created_at);


--
-- Name: idx_employee_comp_agreements_receipt_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employee_comp_agreements_receipt_hash ON public.employee_comp_agreements USING btree (receipt_token_hash) WHERE (receipt_token_hash IS NOT NULL);


--
-- Name: idx_employee_comp_agreements_request_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employee_comp_agreements_request_key ON public.employee_comp_agreements USING btree (org_id, manager_user_id, request_key);


--
-- Name: idx_employee_comp_agreements_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_employee_comp_agreements_token_hash ON public.employee_comp_agreements USING btree (signing_token_hash) WHERE (signing_token_hash IS NOT NULL);


--
-- Name: idx_employee_comp_agreements_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_comp_agreements_user ON public.employee_comp_agreements USING btree (org_id, user_id, created_at DESC);


--
-- Name: idx_estimate_lines_estimate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimate_lines_estimate_id ON public.estimate_lines USING btree (estimate_id);


--
-- Name: idx_estimate_lines_opportunity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimate_lines_opportunity_id ON public.estimate_lines USING btree (opportunity_id);


--
-- Name: idx_estimate_lines_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimate_lines_org_id ON public.estimate_lines USING btree (org_id);


--
-- Name: idx_estimates_opportunity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimates_opportunity_id ON public.estimates USING btree (opportunity_id);


--
-- Name: idx_estimates_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimates_org_id ON public.estimates USING btree (org_id);


--
-- Name: idx_estimates_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estimates_project_id ON public.estimates USING btree (project_id);


--
-- Name: idx_files_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_customer_id ON public.files USING btree (customer_id);


--
-- Name: idx_files_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_job_id ON public.files USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: idx_files_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_lead_id ON public.files USING btree (lead_id);


--
-- Name: idx_files_opportunity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_opportunity_id ON public.files USING btree (opportunity_id);


--
-- Name: idx_files_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_org_id ON public.files USING btree (org_id);


--
-- Name: idx_files_photo_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_photo_tag ON public.files USING btree (photo_tag) WHERE (photo_tag IS NOT NULL);


--
-- Name: idx_files_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_project_id ON public.files USING btree (project_id);


--
-- Name: idx_financing_programs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financing_programs_active ON public.financing_programs USING btree (org_id, active);


--
-- Name: idx_financing_programs_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financing_programs_org ON public.financing_programs USING btree (org_id);


--
-- Name: idx_goal_history_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_history_org_id ON public.user_incentive_goals_history USING btree (org_id);


--
-- Name: idx_goal_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_history_user_id ON public.user_incentive_goals_history USING btree (user_id);


--
-- Name: idx_inbound_lead_queue_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbound_lead_queue_assigned_to ON public.inbound_lead_queue USING btree (assigned_to);


--
-- Name: idx_inbound_lead_queue_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbound_lead_queue_org_id ON public.inbound_lead_queue USING btree (org_id);


--
-- Name: idx_inbound_lead_queue_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbound_lead_queue_priority ON public.inbound_lead_queue USING btree (priority DESC);


--
-- Name: idx_inbound_lead_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbound_lead_queue_status ON public.inbound_lead_queue USING btree (status);


--
-- Name: idx_incentive_badges_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incentive_badges_org ON public.incentive_badges USING btree (org_id, is_active);


--
-- Name: idx_incentive_cycles_org_starts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incentive_cycles_org_starts ON public.incentive_cycles USING btree (org_id, starts_at DESC);


--
-- Name: idx_inspection_briefings_appointment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_briefings_appointment ON public.inspection_briefings USING btree (appointment_id);


--
-- Name: idx_inspection_briefings_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_briefings_org ON public.inspection_briefings USING btree (org_id);


--
-- Name: idx_inspection_report_photos_report; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_report_photos_report ON public.inspection_report_photos USING btree (report_id);


--
-- Name: idx_inspection_reports_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_reports_opportunity ON public.inspection_reports USING btree (opportunity_id);


--
-- Name: idx_inspection_reports_opportunity_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_inspection_reports_opportunity_unique ON public.inspection_reports USING btree (opportunity_id);


--
-- Name: idx_inspection_reports_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_reports_org ON public.inspection_reports USING btree (org_id);


--
-- Name: idx_inspection_reports_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_inspection_reports_org_id ON public.inspection_reports USING btree (org_id, id);


--
-- Name: idx_inspection_result_photos_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_result_photos_created_at ON public.inspection_result_photos USING btree (created_at);


--
-- Name: idx_inspection_result_photos_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_result_photos_result ON public.inspection_result_photos USING btree (result_id);


--
-- Name: idx_inspection_results_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_results_org ON public.inspection_results USING btree (org_id);


--
-- Name: idx_inspection_results_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_inspection_results_org_id ON public.inspection_results USING btree (org_id, id);


--
-- Name: idx_inspection_status_appointment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_status_appointment ON public.inspection_status_updates USING btree (appointment_id);


--
-- Name: idx_inspection_status_closer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_status_closer ON public.inspection_status_updates USING btree (closer_user_id);


--
-- Name: idx_inspection_status_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_status_completed ON public.inspection_status_updates USING btree (completed_at DESC);


--
-- Name: idx_inspection_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_status_created ON public.inspection_status_updates USING btree (created_at DESC);


--
-- Name: idx_inspection_status_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_status_opportunity ON public.inspection_status_updates USING btree (opportunity_id);


--
-- Name: idx_inspection_status_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_status_outcome ON public.inspection_status_updates USING btree (outcome);


--
-- Name: idx_inspection_status_setter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_status_setter ON public.inspection_status_updates USING btree (setter_user_id);


--
-- Name: idx_instant_estimate_checks_org_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instant_estimate_checks_org_created ON public.instant_estimate_checks USING btree (org_id, created_at DESC);


--
-- Name: idx_integration_configs_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_configs_org ON public.integration_configs USING btree (org_id);


--
-- Name: idx_invoice_payments_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_payments_invoice_id ON public.invoice_payments USING btree (invoice_id);


--
-- Name: idx_invoice_payments_job_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_payments_job_payment_id ON public.invoice_payments USING btree (job_payment_id);


--
-- Name: idx_job_additional_scope_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_additional_scope_job_id ON public.job_additional_scope USING btree (job_id);


--
-- Name: idx_job_additional_scope_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_additional_scope_org_id ON public.job_additional_scope USING btree (org_id);


--
-- Name: idx_job_change_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_change_orders_created_at ON public.job_change_orders USING btree (created_at DESC);


--
-- Name: idx_job_change_orders_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_change_orders_job_id ON public.job_change_orders USING btree (job_id);


--
-- Name: idx_job_change_orders_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_change_orders_org_id ON public.job_change_orders USING btree (org_id);


--
-- Name: idx_job_change_orders_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_change_orders_project_id ON public.job_change_orders USING btree (project_id);


--
-- Name: idx_job_change_orders_signing_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_job_change_orders_signing_token ON public.job_change_orders USING btree (signing_token) WHERE (signing_token IS NOT NULL);


--
-- Name: idx_job_change_orders_unique_co; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_job_change_orders_unique_co ON public.job_change_orders USING btree (project_id, co_number);


--
-- Name: idx_job_cost_lines_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_cost_lines_job_id ON public.job_cost_lines USING btree (job_id);


--
-- Name: idx_job_cost_lines_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_cost_lines_org_id ON public.job_cost_lines USING btree (org_id);


--
-- Name: idx_job_cost_lines_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_cost_lines_source ON public.job_cost_lines USING btree (org_id, source);


--
-- Name: idx_job_cost_lines_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_cost_lines_vendor_id ON public.job_cost_lines USING btree (vendor_id);


--
-- Name: idx_job_files_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_files_created_at ON public.job_files USING btree (created_at DESC);


--
-- Name: idx_job_files_file_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_files_file_type ON public.job_files USING btree (file_type);


--
-- Name: idx_job_files_job_file_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_files_job_file_type ON public.job_files USING btree (job_id, file_type);


--
-- Name: idx_job_files_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_files_job_id ON public.job_files USING btree (job_id);


--
-- Name: idx_job_files_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_files_org_id ON public.job_files USING btree (org_id);


--
-- Name: idx_job_files_share_with_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_files_share_with_sub ON public.job_files USING btree (job_id) WHERE (share_with_sub = true);


--
-- Name: idx_job_invoice_items_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_invoice_items_invoice_id ON public.job_invoice_items USING btree (invoice_id);


--
-- Name: idx_job_invoices_invoice_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_invoices_invoice_number ON public.job_invoices USING btree (invoice_number);


--
-- Name: idx_job_invoices_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_invoices_job_id ON public.job_invoices USING btree (job_id);


--
-- Name: idx_job_invoices_job_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_invoices_job_kind ON public.job_invoices USING btree (job_id, invoice_kind) WHERE (status <> 'void'::public.invoice_status);


--
-- Name: idx_job_invoices_qb_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_invoices_qb_invoice_id ON public.job_invoices USING btree (qb_invoice_id) WHERE (qb_invoice_id IS NOT NULL);


--
-- Name: idx_job_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_invoices_status ON public.job_invoices USING btree (status);


--
-- Name: idx_job_invoices_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_invoices_sync_status ON public.job_invoices USING btree (sync_status) WHERE (sync_status = 'pending'::public.sync_status);


--
-- Name: idx_job_material_order_overrides_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_material_order_overrides_job_id ON public.job_material_order_overrides USING btree (job_id);


--
-- Name: idx_job_material_order_overrides_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_material_order_overrides_org_id ON public.job_material_order_overrides USING btree (org_id);


--
-- Name: idx_job_measure_elevations_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_elevations_job_id ON public.job_measure_elevations USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: idx_job_measure_elevations_opportunity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_elevations_opportunity_id ON public.job_measure_elevations USING btree (opportunity_id);


--
-- Name: idx_job_measure_elevations_report_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_elevations_report_id ON public.job_measure_elevations USING btree (report_id);


--
-- Name: idx_job_measure_openings_elevation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_openings_elevation_id ON public.job_measure_openings USING btree (elevation_id);


--
-- Name: idx_job_measure_openings_opportunity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_openings_opportunity_id ON public.job_measure_openings USING btree (opportunity_id);


--
-- Name: idx_job_measure_openings_report_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_openings_report_id ON public.job_measure_openings USING btree (report_id);


--
-- Name: idx_job_measure_photos_elevation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_photos_elevation_id ON public.job_measure_photos USING btree (elevation_id);


--
-- Name: idx_job_measure_photos_opportunity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_photos_opportunity_id ON public.job_measure_photos USING btree (opportunity_id);


--
-- Name: idx_job_measure_photos_report_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_photos_report_id ON public.job_measure_photos USING btree (report_id);


--
-- Name: idx_job_measure_reports_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_reports_job_id ON public.job_measure_reports USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: idx_job_measure_reports_opportunity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_reports_opportunity_id ON public.job_measure_reports USING btree (opportunity_id);


--
-- Name: idx_job_measure_reports_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_measure_reports_org_id ON public.job_measure_reports USING btree (org_id);


--
-- Name: idx_job_payments_funding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_payments_funding ON public.job_payments USING btree (job_id, funding_status);


--
-- Name: idx_job_payments_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_payments_job_id ON public.job_payments USING btree (job_id);


--
-- Name: idx_job_payments_job_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_job_payments_job_idempotency ON public.job_payments USING btree (job_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_job_payments_paid_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_payments_paid_at ON public.job_payments USING btree (paid_at);


--
-- Name: idx_job_payments_qb_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_payments_qb_payment_id ON public.job_payments USING btree (qb_payment_id) WHERE (qb_payment_id IS NOT NULL);


--
-- Name: idx_job_payments_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_payments_sync_status ON public.job_payments USING btree (sync_status) WHERE (sync_status = 'pending'::public.sync_status);


--
-- Name: idx_job_payroll_state_eligible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_payroll_state_eligible ON public.job_payroll_state USING btree (org_id, payroll_eligible_at);


--
-- Name: idx_job_payroll_state_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_payroll_state_org ON public.job_payroll_state USING btree (org_id);


--
-- Name: idx_job_product_orders_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_product_orders_job_id ON public.job_product_orders USING btree (job_id);


--
-- Name: idx_job_product_orders_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_product_orders_org_id ON public.job_product_orders USING btree (org_id);


--
-- Name: idx_job_product_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_product_orders_status ON public.job_product_orders USING btree (status);


--
-- Name: idx_job_trade_material_sources_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_trade_material_sources_org ON public.job_trade_material_sources USING btree (org_id);


--
-- Name: idx_jobs_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_customer_id ON public.jobs USING btree (customer_id);


--
-- Name: idx_jobs_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_lead_id ON public.jobs USING btree (lead_id);


--
-- Name: idx_jobs_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_org_id ON public.jobs USING btree (org_id);


--
-- Name: idx_jobs_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_owner_user_id ON public.jobs USING btree (owner_user_id);


--
-- Name: idx_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_status ON public.jobs USING btree (status);


--
-- Name: idx_lead_sources_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_sources_org_id ON public.lead_sources USING btree (org_id);


--
-- Name: idx_lead_sources_source_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_sources_source_type ON public.lead_sources USING btree (source_type);


--
-- Name: idx_lead_sources_webhook_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_sources_webhook_token ON public.lead_sources USING btree (webhook_token);


--
-- Name: idx_leads_campaign_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_campaign_id ON public.leads USING btree (campaign_id);


--
-- Name: idx_leads_canvass_disposition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_canvass_disposition ON public.leads USING btree (canvass_disposition);


--
-- Name: idx_leads_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_channel ON public.leads USING btree (channel);


--
-- Name: idx_leads_client_lead_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_leads_client_lead_id_unique ON public.leads USING btree (org_id, owner_user_id, client_lead_id) WHERE (client_lead_id IS NOT NULL);


--
-- Name: idx_leads_closer_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_closer_user_id ON public.leads USING btree (closer_user_id);


--
-- Name: idx_leads_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_created_at ON public.leads USING btree (created_at DESC);


--
-- Name: idx_leads_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_customer_id ON public.leads USING btree (customer_id);


--
-- Name: idx_leads_external_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_external_lead_id ON public.leads USING btree (external_lead_id);


--
-- Name: idx_leads_installation_agreement_signed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_installation_agreement_signed_at ON public.leads USING btree (org_id, installation_agreement_signed_at) WHERE (installation_agreement_signed_at IS NOT NULL);


--
-- Name: idx_leads_lat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_lat ON public.leads USING btree (lat) WHERE (lat IS NOT NULL);


--
-- Name: idx_leads_lat_lng_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_lat_lng_org ON public.leads USING btree (org_id, lat, lng) WHERE ((lat IS NOT NULL) AND (lng IS NOT NULL));


--
-- Name: INDEX idx_leads_lat_lng_org; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_leads_lat_lng_org IS 'Primary index for viewport-based map loading. Supports bounding box queries with org scoping.';


--
-- Name: idx_leads_lead_source_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_lead_source_id ON public.leads USING btree (lead_source_id);


--
-- Name: idx_leads_lng; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_lng ON public.leads USING btree (lng) WHERE (lng IS NOT NULL);


--
-- Name: idx_leads_org_created_pin_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_org_created_pin_owner ON public.leads USING btree (org_id, created_at) WHERE ((lat IS NOT NULL) AND (lng IS NOT NULL));


--
-- Name: idx_leads_org_disposition_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_org_disposition_geo ON public.leads USING btree (org_id, canvass_disposition, lat, lng) WHERE ((lat IS NOT NULL) AND (lng IS NOT NULL));


--
-- Name: idx_leads_org_external_lead_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_leads_org_external_lead_id_unique ON public.leads USING btree (org_id, external_lead_id) WHERE (external_lead_id IS NOT NULL);


--
-- Name: idx_leads_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_org_id ON public.leads USING btree (org_id);


--
-- Name: idx_leads_org_status_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_org_status_geo ON public.leads USING btree (org_id, status, lat, lng) WHERE ((lat IS NOT NULL) AND (lng IS NOT NULL));


--
-- Name: idx_leads_owner_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_owner_created ON public.leads USING btree (owner_user_id, created_at);


--
-- Name: idx_leads_owner_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_owner_geo ON public.leads USING btree (owner_user_id, lat, lng) WHERE ((lat IS NOT NULL) AND (lng IS NOT NULL));


--
-- Name: idx_leads_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_owner_user_id ON public.leads USING btree (owner_user_id);


--
-- Name: idx_leads_rep_lat_lng; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_rep_lat_lng ON public.leads USING btree (rep_lat, rep_lng) WHERE (rep_lat IS NOT NULL);


--
-- Name: idx_leads_source_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_source_type ON public.leads USING btree (source_type);


--
-- Name: idx_leads_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_status ON public.leads USING btree (status);


--
-- Name: idx_management_overlay_versions_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_management_overlay_versions_lookup ON public.management_comp_overlay_plan_versions USING btree (org_id, comp_plan_id, lane, effective_from DESC);


--
-- Name: idx_material_orders_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_orders_job ON public.material_orders USING btree (job_id);


--
-- Name: idx_measurement_requests_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_measurement_requests_org ON public.measurement_requests USING btree (org_id);


--
-- Name: idx_measurement_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_measurement_requests_status ON public.measurement_requests USING btree (status);


--
-- Name: idx_mobile_device_tokens_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mobile_device_tokens_org_id ON public.mobile_device_tokens USING btree (org_id);


--
-- Name: idx_mobile_device_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mobile_device_tokens_user_id ON public.mobile_device_tokens USING btree (user_id);


--
-- Name: idx_notifications_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_org_id ON public.notifications USING btree (org_id);


--
-- Name: idx_notifications_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient ON public.notifications USING btree (recipient_user_id);


--
-- Name: idx_opportunities_assigned_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_assigned_user_id ON public.opportunities USING btree (assigned_user_id);


--
-- Name: idx_opportunities_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_customer_id ON public.opportunities USING btree (customer_id);


--
-- Name: idx_opportunities_follow_up_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_follow_up_at ON public.opportunities USING btree (follow_up_at);


--
-- Name: idx_opportunities_inspection_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_inspection_outcome ON public.opportunities USING btree (inspection_outcome);


--
-- Name: idx_opportunities_inspection_outcome_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_inspection_outcome_at ON public.opportunities USING btree (inspection_outcome_at) WHERE (inspection_outcome_at IS NOT NULL);


--
-- Name: idx_opportunities_insurance_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_insurance_stage ON public.opportunities USING btree (org_id, insurance_stage) WHERE (job_source = 'insurance'::text);


--
-- Name: idx_opportunities_job_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_job_source ON public.opportunities USING btree (org_id, job_source, status);


--
-- Name: idx_opportunities_knockback_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_knockback_reason ON public.opportunities USING btree (knockback_reason) WHERE (knockback_reason IS NOT NULL);


--
-- Name: idx_opportunities_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_lead_id ON public.opportunities USING btree (lead_id);


--
-- Name: idx_opportunities_no_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_no_customer ON public.opportunities USING btree (org_id, created_at DESC) WHERE (customer_id IS NULL);


--
-- Name: idx_opportunities_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_org_id ON public.opportunities USING btree (org_id);


--
-- Name: idx_opportunities_org_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_opportunities_org_id_id ON public.opportunities USING btree (org_id, id);


--
-- Name: idx_opportunities_org_inspection_outcome_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_org_inspection_outcome_at ON public.opportunities USING btree (org_id, inspection_outcome_at) WHERE ((inspection_outcome_at IS NOT NULL) AND (inspection_outcome IS NOT NULL));


--
-- Name: idx_opportunities_owner_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_owner_created ON public.opportunities USING btree (owner_user_id, created_at);


--
-- Name: idx_opportunities_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_owner_user_id ON public.opportunities USING btree (owner_user_id);


--
-- Name: idx_opportunities_pipeline_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_pipeline_stage ON public.opportunities USING btree (pipeline_stage);


--
-- Name: idx_opportunities_referral_partner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_referral_partner ON public.opportunities USING btree (referral_partner_id) WHERE (referral_partner_id IS NOT NULL);


--
-- Name: idx_opportunities_self_generated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_self_generated ON public.opportunities USING btree (org_id, is_self_generated) WHERE (is_self_generated IS TRUE);


--
-- Name: idx_opportunities_setter_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_setter_created ON public.opportunities USING btree (setter_user_id, created_at);


--
-- Name: idx_opportunities_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_status ON public.opportunities USING btree (status);


--
-- Name: idx_order_form_contracts_agreement_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_form_contracts_agreement_type ON public.order_form_contracts USING btree (org_id, opportunity_id, agreement_type, status);


--
-- Name: idx_order_form_contracts_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_form_contracts_created_by ON public.order_form_contracts USING btree (created_by);


--
-- Name: idx_order_form_contracts_opportunity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_form_contracts_opportunity_id ON public.order_form_contracts USING btree (opportunity_id);


--
-- Name: idx_order_form_contracts_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_form_contracts_org_id ON public.order_form_contracts USING btree (org_id);


--
-- Name: idx_order_form_contracts_org_signed_install; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_form_contracts_org_signed_install ON public.order_form_contracts USING btree (org_id, customer_signed_at) WHERE ((status = 'completed'::public.contract_signing_status) AND (agreement_type = 'installation'::text) AND (customer_signed_at IS NOT NULL));


--
-- Name: idx_order_form_contracts_proposal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_form_contracts_proposal_id ON public.order_form_contracts USING btree (proposal_id);


--
-- Name: idx_order_form_contracts_signing_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_form_contracts_signing_token ON public.order_form_contracts USING btree (signing_token);


--
-- Name: idx_order_form_contracts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_form_contracts_status ON public.order_form_contracts USING btree (status);


--
-- Name: idx_org_default_comp_plans_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_default_comp_plans_org ON public.org_default_comp_plans USING btree (org_id, role, effective_from DESC);


--
-- Name: idx_org_monthly_goal_audit_goal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_monthly_goal_audit_goal ON public.org_monthly_goal_audit USING btree (goal_id, created_at DESC);


--
-- Name: idx_org_monthly_goals_org_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_monthly_goals_org_month ON public.org_monthly_goals USING btree (org_id, month DESC);


--
-- Name: idx_orgs_settings; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orgs_settings ON public.orgs USING gin (settings);


--
-- Name: idx_outbox_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_entity ON public.integration_outbox USING btree (entity_table, entity_id);


--
-- Name: idx_outbox_org_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_org_provider ON public.integration_outbox USING btree (org_id, provider);


--
-- Name: idx_outbox_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_pending ON public.integration_outbox USING btree (provider, status, created_at) WHERE (status = ANY (ARRAY['pending'::public.outbox_status, 'failed'::public.outbox_status]));


--
-- Name: idx_payroll_adjustments_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_adjustments_period ON public.payroll_adjustments USING btree (payroll_period_id, user_id) WHERE (status <> 'void'::text);


--
-- Name: idx_payroll_adjustments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_adjustments_user ON public.payroll_adjustments USING btree (org_id, user_id, created_at DESC);


--
-- Name: idx_payroll_bonus_lines_manual_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payroll_bonus_lines_manual_unique ON public.payroll_bonus_lines USING btree (payroll_period_id, user_id, bonus_type) WHERE (source_id IS NULL);


--
-- Name: idx_payroll_bonus_lines_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_bonus_lines_org ON public.payroll_bonus_lines USING btree (org_id, user_id);


--
-- Name: idx_payroll_bonus_lines_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_bonus_lines_period ON public.payroll_bonus_lines USING btree (payroll_period_id, user_id);


--
-- Name: idx_payroll_bonus_lines_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_bonus_lines_status ON public.payroll_bonus_lines USING btree (status);


--
-- Name: idx_payroll_cb_app_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_cb_app_period ON public.payroll_chargeback_applications USING btree (payroll_period_id);


--
-- Name: idx_payroll_chargebacks_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_chargebacks_user ON public.payroll_chargebacks USING btree (org_id, user_id, status);


--
-- Name: idx_payroll_disputes_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_disputes_open ON public.payroll_disputes USING btree (org_id, status, created_at DESC);


--
-- Name: idx_payroll_disputes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_disputes_user ON public.payroll_disputes USING btree (org_id, user_id, created_at DESC);


--
-- Name: idx_payroll_job_snapshots_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_job_snapshots_job ON public.payroll_job_snapshots USING btree (job_id);


--
-- Name: idx_payroll_job_snapshots_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_job_snapshots_period ON public.payroll_job_snapshots USING btree (payroll_period_id);


--
-- Name: idx_payroll_override_audit_job_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_override_audit_job_type ON public.payroll_override_audit USING btree (job_id, override_type, created_at DESC);


--
-- Name: idx_payroll_override_audit_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_override_audit_org ON public.payroll_override_audit USING btree (org_id, created_at DESC);


--
-- Name: idx_payroll_payout_lines_period_job_user_role; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payroll_payout_lines_period_job_user_role ON public.payroll_payout_lines USING btree (payroll_period_id, job_id, user_id, participant_role);


--
-- Name: idx_payroll_payout_lines_period_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_payout_lines_period_user ON public.payroll_payout_lines USING btree (payroll_period_id, user_id);


--
-- Name: idx_payroll_periods_cutoff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_periods_cutoff ON public.payroll_periods USING btree (org_id, cutoff_at DESC);


--
-- Name: idx_payroll_periods_org_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_periods_org_status ON public.payroll_periods USING btree (org_id, status);


--
-- Name: idx_payroll_rep_hours_audit_rep; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_rep_hours_audit_rep ON public.payroll_rep_hours_audit USING btree (rep_hours_id, created_at DESC);


--
-- Name: idx_payroll_rep_hours_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_rep_hours_period ON public.payroll_rep_hours USING btree (payroll_period_id);


--
-- Name: idx_payroll_rep_hours_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_rep_hours_user ON public.payroll_rep_hours USING btree (org_id, user_id);


--
-- Name: idx_payroll_unit_earnings_org_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_unit_earnings_org_user ON public.payroll_unit_earnings USING btree (org_id, user_id);


--
-- Name: idx_pending_prompts_closer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_prompts_closer ON public.pending_status_prompts USING btree (closer_user_id) WHERE ((NOT completed) AND (NOT dismissed));


--
-- Name: idx_pending_prompts_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_prompts_time ON public.pending_status_prompts USING btree (prompt_at) WHERE ((NOT completed) AND (NOT dismissed));


--
-- Name: idx_pending_status_prompts_appointment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_status_prompts_appointment ON public.pending_status_prompts USING btree (appointment_id, completed) WHERE (completed = false);


--
-- Name: idx_permission_audit_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_audit_target ON public.permission_audit USING btree (target_user_id, created_at DESC);


--
-- Name: idx_permission_denials_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_denials_user ON public.permission_denials USING btree (user_id);


--
-- Name: idx_permission_presets_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_presets_org_id ON public.permission_presets USING btree (org_id);


--
-- Name: idx_photos_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photos_created_at ON public.photos USING btree (created_at DESC);


--
-- Name: idx_photos_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photos_job_id ON public.photos USING btree (job_id);


--
-- Name: idx_photos_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photos_org_id ON public.photos USING btree (org_id);


--
-- Name: idx_photos_work_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photos_work_order ON public.photos USING btree (work_order_id) WHERE (work_order_id IS NOT NULL);


--
-- Name: idx_preset_permissions_preset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_preset_permissions_preset_id ON public.preset_permissions USING btree (preset_id);


--
-- Name: idx_pricebook_items_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricebook_items_active ON public.pricebook_items USING btree (active);


--
-- Name: idx_pricebook_items_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricebook_items_category ON public.pricebook_items USING btree (category);


--
-- Name: idx_pricebook_items_category_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricebook_items_category_active ON public.pricebook_items USING btree (pricebook_id, category, active);


--
-- Name: idx_pricebook_items_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricebook_items_org_id ON public.pricebook_items USING btree (org_id);


--
-- Name: idx_pricebook_items_pricebook_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricebook_items_pricebook_id ON public.pricebook_items USING btree (pricebook_id);


--
-- Name: idx_pricebooks_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricebooks_org_id ON public.pricebooks USING btree (org_id);


--
-- Name: idx_production_job_notes_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_job_notes_job ON public.production_job_notes USING btree (job_id);


--
-- Name: idx_production_jobs_accepted_estimate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_accepted_estimate ON public.production_jobs USING btree (accepted_estimate_id) WHERE (accepted_estimate_id IS NOT NULL);


--
-- Name: idx_production_jobs_accepted_proposal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_accepted_proposal ON public.production_jobs USING btree (accepted_proposal_id) WHERE (accepted_proposal_id IS NOT NULL);


--
-- Name: idx_production_jobs_crew; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_crew ON public.production_jobs USING btree (assigned_crew_id);


--
-- Name: idx_production_jobs_linked_proposal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_linked_proposal ON public.production_jobs USING btree (linked_proposal_id);


--
-- Name: idx_production_jobs_no_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_no_customer ON public.production_jobs USING btree (org_id, created_at DESC) WHERE (customer_id IS NULL);


--
-- Name: idx_production_jobs_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_org_id ON public.production_jobs USING btree (org_id);


--
-- Name: idx_production_jobs_org_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_org_owner ON public.production_jobs USING btree (org_id, owner_user_id);


--
-- Name: idx_production_jobs_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_project ON public.production_jobs USING btree (project_id);


--
-- Name: idx_production_jobs_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_scheduled ON public.production_jobs USING btree (org_id, scheduled_date);


--
-- Name: idx_production_jobs_settled_externally; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_settled_externally ON public.production_jobs USING btree (org_id) WHERE (payroll_settled_externally_at IS NOT NULL);


--
-- Name: idx_production_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_status ON public.production_jobs USING btree (org_id, status);


--
-- Name: idx_production_jobs_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_jobs_sub ON public.production_jobs USING btree (assigned_sub_id);


--
-- Name: idx_projects_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_customer_id ON public.projects USING btree (customer_id);


--
-- Name: idx_projects_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_lead_id ON public.projects USING btree (lead_id);


--
-- Name: idx_projects_no_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_no_customer ON public.projects USING btree (org_id, created_at DESC) WHERE (customer_id IS NULL);


--
-- Name: idx_projects_opportunity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_opportunity_id ON public.projects USING btree (opportunity_id);


--
-- Name: idx_projects_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_org_id ON public.projects USING btree (org_id);


--
-- Name: idx_projects_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_owner_user_id ON public.projects USING btree (owner_user_id);


--
-- Name: idx_projects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_status ON public.projects USING btree (status);


--
-- Name: idx_proposal_items_proposal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposal_items_proposal ON public.proposal_line_items USING btree (proposal_id);


--
-- Name: idx_proposal_photos_proposal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposal_photos_proposal ON public.proposal_photos USING btree (proposal_id);


--
-- Name: idx_proposal_templates_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposal_templates_org ON public.proposal_templates USING btree (org_id);


--
-- Name: idx_proposals_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposals_created_by ON public.proposals USING btree (created_by);


--
-- Name: idx_proposals_customer_signed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposals_customer_signed ON public.proposals USING btree (customer_signed_at) WHERE (customer_signed_at IS NOT NULL);


--
-- Name: idx_proposals_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposals_opportunity ON public.proposals USING btree (opportunity_id);


--
-- Name: idx_proposals_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposals_org ON public.proposals USING btree (org_id);


--
-- Name: idx_proposals_rep_signed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposals_rep_signed ON public.proposals USING btree (rep_signed_at) WHERE (rep_signed_at IS NOT NULL);


--
-- Name: idx_proposals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposals_status ON public.proposals USING btree (status);


--
-- Name: idx_public_estimate_previews_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_public_estimate_previews_expires_at ON public.public_estimate_previews USING btree (expires_at);


--
-- Name: idx_public_estimate_unlock_deliveries_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_public_estimate_unlock_deliveries_pending ON public.public_estimate_unlock_deliveries USING btree (state, claimed_at) WHERE (state = 'claimed'::text);


--
-- Name: idx_referral_partners_company_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_partners_company_trgm ON public.referral_partners USING gin (lower(COALESCE(company, ''::text)) extensions.gin_trgm_ops);


--
-- Name: idx_referral_partners_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_partners_name_trgm ON public.referral_partners USING gin (lower(name) extensions.gin_trgm_ops);


--
-- Name: idx_referral_partners_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_partners_owner ON public.referral_partners USING btree (org_id, assigned_user_id);


--
-- Name: idx_referral_partners_phone_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_partners_phone_prefix ON public.referral_partners USING btree (phone_digits text_pattern_ops);


--
-- Name: idx_referral_partners_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_partners_status ON public.referral_partners USING btree (org_id, status);


--
-- Name: idx_referrals_open_by_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_open_by_project ON public.referrals USING btree (referred_project_id) WHERE (status = ANY (ARRAY['pending'::public.referral_status, 'qualified'::public.referral_status]));


--
-- Name: idx_referrals_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_org ON public.referrals USING btree (org_id);


--
-- Name: idx_referrals_referred_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_referred_customer ON public.referrals USING btree (referred_customer_id);


--
-- Name: idx_referrals_referred_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_referred_opportunity ON public.referrals USING btree (referred_opportunity_id);


--
-- Name: idx_referrals_referred_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_referred_project ON public.referrals USING btree (referred_project_id);


--
-- Name: idx_referrals_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_referrer ON public.referrals USING btree (referrer_customer_id);


--
-- Name: idx_referrals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_status ON public.referrals USING btree (status);


--
-- Name: idx_referrals_unpaid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_unpaid ON public.referrals USING btree (org_id, status) WHERE ((status = 'installed'::public.referral_status) AND (paid_at IS NULL));


--
-- Name: idx_regions_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_regions_org_id ON public.regions USING btree (org_id);


--
-- Name: idx_report_access_report; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_access_report ON public.report_role_access USING btree (report_id);


--
-- Name: idx_report_access_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_access_role ON public.report_role_access USING btree (role);


--
-- Name: idx_report_schedules_next; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_schedules_next ON public.report_schedules USING btree (next_send_at) WHERE (active = true);


--
-- Name: idx_report_schedules_report; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_schedules_report ON public.report_schedules USING btree (report_id);


--
-- Name: idx_review_requests_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_requests_org ON public.review_requests USING btree (org_id);


--
-- Name: idx_review_requests_salesperson; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_requests_salesperson ON public.review_requests USING btree (org_id, salesperson_id);


--
-- Name: idx_review_requests_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_requests_sent ON public.review_requests USING btree (org_id, sent_at);


--
-- Name: idx_role_permissions_permission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permissions_permission_id ON public.role_permissions USING btree (permission_id);


--
-- Name: idx_role_permissions_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permissions_role_id ON public.role_permissions USING btree (role_id);


--
-- Name: idx_roof_facets_measurement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roof_facets_measurement ON public.roof_facets USING btree (measurement_id);


--
-- Name: idx_roof_measurements_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roof_measurements_address ON public.roof_measurements USING btree (address_text);


--
-- Name: idx_roof_measurements_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roof_measurements_opportunity ON public.roof_measurements USING btree (opportunity_id);


--
-- Name: idx_roof_measurements_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roof_measurements_org ON public.roof_measurements USING btree (org_id);


--
-- Name: idx_roofing_types_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roofing_types_active ON public.roofing_types USING btree (org_id, active);


--
-- Name: idx_roofing_types_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roofing_types_org ON public.roofing_types USING btree (org_id);


--
-- Name: idx_rp_assignment_log_partner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rp_assignment_log_partner ON public.referral_partner_assignment_log USING btree (partner_id, created_at DESC);


--
-- Name: idx_saved_reports_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_reports_org ON public.saved_reports USING btree (org_id);


--
-- Name: idx_sched_appt_unique_active_lead_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sched_appt_unique_active_lead_slot ON public.scheduled_appointments USING btree (lead_id, scheduled_for) WHERE ((lead_id IS NOT NULL) AND (status = ANY (ARRAY['scheduled'::text, 'confirmed'::text])));


--
-- Name: idx_scheduled_appointments_canvasser_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_appointments_canvasser_created ON public.scheduled_appointments USING btree (canvasser_user_id, created_at);


--
-- Name: idx_scheduled_appointments_closeout_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_appointments_closeout_batch ON public.scheduled_appointments USING btree (outcome_not_recorded_batch) WHERE (outcome_not_recorded_batch IS NOT NULL);


--
-- Name: idx_scheduled_appointments_closer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_appointments_closer ON public.scheduled_appointments USING btree (closer_user_id, scheduled_for);


--
-- Name: idx_scheduled_appointments_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_appointments_lead ON public.scheduled_appointments USING btree (lead_id);


--
-- Name: idx_scheduled_appointments_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_appointments_opportunity ON public.scheduled_appointments USING btree (opportunity_id);


--
-- Name: idx_scheduled_appointments_org_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_scheduled_appointments_org_id_id ON public.scheduled_appointments USING btree (org_id, id);


--
-- Name: idx_search_customers_addr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_customers_addr ON public.customers USING gin (lower(address_text) extensions.gin_trgm_ops);


--
-- Name: idx_search_customers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_customers_name ON public.customers USING gin (lower(name) extensions.gin_trgm_ops);


--
-- Name: idx_search_jobs_addr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_jobs_addr ON public.production_jobs USING gin (lower(address_text) extensions.gin_trgm_ops);


--
-- Name: idx_search_jobs_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_jobs_number ON public.production_jobs USING gin (lower(job_number) extensions.gin_trgm_ops);


--
-- Name: idx_search_opps_addr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_opps_addr ON public.opportunities USING gin (lower(address_text) extensions.gin_trgm_ops);


--
-- Name: idx_search_proposals_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_proposals_name ON public.proposals USING gin (lower(customer_name) extensions.gin_trgm_ops);


--
-- Name: idx_setter_ramp_enrollments_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_setter_ramp_enrollments_one_active ON public.setter_ramp_enrollments USING btree (org_id, user_id) WHERE (status = 'active'::text);


--
-- Name: idx_setter_ramp_enrollments_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_setter_ramp_enrollments_org ON public.setter_ramp_enrollments USING btree (org_id, status);


--
-- Name: idx_setter_ramp_enrollments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_setter_ramp_enrollments_user ON public.setter_ramp_enrollments USING btree (user_id, status);


--
-- Name: idx_setter_ramp_weekly_status_enrollment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_setter_ramp_weekly_status_enrollment ON public.setter_ramp_weekly_status USING btree (enrollment_id, week_number);


--
-- Name: idx_setter_ramp_weekly_status_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_setter_ramp_weekly_status_org ON public.setter_ramp_weekly_status USING btree (org_id, user_id);


--
-- Name: idx_setter_ramp_weekly_status_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_setter_ramp_weekly_status_period ON public.setter_ramp_weekly_status USING btree (payroll_period_id);


--
-- Name: idx_spiff_achievements_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spiff_achievements_org ON public.spiff_achievements USING btree (org_id);


--
-- Name: idx_spiff_achievements_program; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spiff_achievements_program ON public.spiff_achievements USING btree (spiff_program_id, qualified);


--
-- Name: idx_spiff_achievements_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spiff_achievements_user ON public.spiff_achievements USING btree (user_id, qualified);


--
-- Name: idx_spiff_programs_org_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spiff_programs_org_dates ON public.spiff_programs USING btree (org_id, starts_at, ends_at);


--
-- Name: idx_spiff_programs_org_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spiff_programs_org_status ON public.spiff_programs USING btree (org_id, status);


--
-- Name: idx_storm_opportunity_alerts_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storm_opportunity_alerts_opportunity ON public.storm_opportunity_alerts USING btree (opportunity_id, event_date DESC);


--
-- Name: idx_storm_opportunity_alerts_org_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storm_opportunity_alerts_org_created ON public.storm_opportunity_alerts USING btree (org_id, created_at DESC);


--
-- Name: idx_sub_contractors_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_contractors_active ON public.sub_contractors USING btree (org_id, active);


--
-- Name: idx_sub_contractors_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_contractors_org ON public.sub_contractors USING btree (org_id);


--
-- Name: idx_sub_contractors_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_contractors_org_id ON public.sub_contractors USING btree (org_id);


--
-- Name: idx_sub_contractors_portal_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_contractors_portal_token ON public.sub_contractors USING btree (portal_access_token);


--
-- Name: idx_sub_contractors_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_contractors_token ON public.sub_contractors USING btree (portal_access_token) WHERE (portal_access_token IS NOT NULL);


--
-- Name: idx_sub_contractors_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sub_contractors_user_id ON public.sub_contractors USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_supplier_api_approvals_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_api_approvals_order ON public.supplier_api_approvals USING btree (supplier_order_id, content_hash);


--
-- Name: idx_supplier_api_events_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_api_events_job ON public.supplier_api_events USING btree (org_id, job_id, created_at DESC);


--
-- Name: idx_supplier_audit_log_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_audit_log_org ON public.supplier_audit_log USING btree (org_id, changed_at DESC);


--
-- Name: idx_supplier_audit_log_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_audit_log_vendor ON public.supplier_audit_log USING btree (vendor_id, changed_at DESC);


--
-- Name: idx_supplier_item_map_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_item_map_org ON public.supplier_item_map USING btree (org_id);


--
-- Name: idx_supplier_order_send_lines_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_order_send_lines_order ON public.supplier_order_send_lines USING btree (supplier_order_id);


--
-- Name: idx_supplier_order_send_lines_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_order_send_lines_org ON public.supplier_order_send_lines USING btree (org_id);


--
-- Name: idx_supplier_order_send_sourcing_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_order_send_sourcing_job ON public.supplier_order_send_sourcing USING btree (job_id);


--
-- Name: idx_supplier_order_sends_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_order_sends_job ON public.supplier_order_sends USING btree (job_id, created_at DESC);


--
-- Name: idx_supplier_order_sends_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_order_sends_order ON public.supplier_order_sends USING btree (supplier_order_id, created_at DESC);


--
-- Name: idx_supplier_orders_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_orders_job ON public.supplier_orders USING btree (job_id);


--
-- Name: idx_table_views_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_table_views_user ON public.table_views USING btree (user_id, table_key);


--
-- Name: idx_team_closer_queue_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_closer_queue_priority ON public.team_closer_queue USING btree (team_id, priority) WHERE (active = true);


--
-- Name: idx_team_closer_queue_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_closer_queue_team_id ON public.team_closer_queue USING btree (team_id);


--
-- Name: idx_team_closer_queue_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_closer_queue_user_id ON public.team_closer_queue USING btree (user_id);


--
-- Name: idx_teams_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_org_id ON public.teams USING btree (org_id);


--
-- Name: idx_teams_region_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_region_id ON public.teams USING btree (region_id);


--
-- Name: idx_user_badges_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_badges_org ON public.user_badges USING btree (org_id, awarded_at DESC);


--
-- Name: idx_user_badges_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_badges_user ON public.user_badges USING btree (user_id, awarded_at DESC);


--
-- Name: idx_user_comp_plans_org_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_comp_plans_org_id_id ON public.user_comp_plans USING btree (org_id, id);


--
-- Name: idx_user_comp_plans_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_comp_plans_user ON public.user_comp_plans USING btree (user_id);


--
-- Name: idx_user_google_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_google_tokens_user_id ON public.user_google_tokens USING btree (user_id);


--
-- Name: idx_user_incentive_goals_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_incentive_goals_user ON public.user_incentive_goals USING btree (user_id, effective_from DESC);


--
-- Name: idx_user_management_overlay_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_management_overlay_lookup ON public.user_management_comp_overlay_assignments USING btree (org_id, user_id, lane, effective_from, effective_to);


--
-- Name: idx_user_manager_assignments_manager; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_manager_assignments_manager ON public.user_manager_assignments USING btree (manager_user_id);


--
-- Name: idx_user_manager_assignments_org_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_manager_assignments_org_dates ON public.user_manager_assignments USING btree (org_id, user_id, effective_from, effective_to);


--
-- Name: idx_user_permissions_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_permissions_org_id ON public.user_permissions USING btree (org_id);


--
-- Name: idx_user_permissions_permission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_permissions_permission_id ON public.user_permissions USING btree (permission_id);


--
-- Name: idx_user_permissions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_permissions_user_id ON public.user_permissions USING btree (user_id);


--
-- Name: idx_user_settings_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_settings_user ON public.user_settings USING btree (user_id);


--
-- Name: idx_users_canvass_pin_visibility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_canvass_pin_visibility ON public.users USING btree (canvass_pin_visibility);


--
-- Name: idx_users_custom_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_custom_role_id ON public.users USING btree (custom_role_id);


--
-- Name: idx_users_dashboard_view; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_dashboard_view ON public.users USING btree (dashboard_view);


--
-- Name: idx_users_manager_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_manager_user_id ON public.users USING btree (manager_user_id);


--
-- Name: idx_users_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_org_id ON public.users USING btree (org_id);


--
-- Name: idx_users_org_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_org_id_id ON public.users USING btree (org_id, id);


--
-- Name: idx_users_region_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_region_id ON public.users USING btree (region_id);


--
-- Name: idx_users_team_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_team_active ON public.users USING btree (team_id, active) WHERE (active = true);


--
-- Name: idx_users_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_team_id ON public.users USING btree (team_id);


--
-- Name: idx_vendors_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_active ON public.vendors USING btree (org_id, active);


--
-- Name: idx_vendors_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_org_id ON public.vendors USING btree (org_id);


--
-- Name: idx_weather_cache_layer_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weather_cache_layer_date ON public.weather_cache USING btree (layer, event_date DESC);


--
-- Name: idx_weather_cache_source_refreshed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weather_cache_source_refreshed ON public.weather_cache USING btree (source, refreshed_at DESC);


--
-- Name: idx_weather_refresh_runs_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weather_refresh_runs_started ON public.weather_refresh_runs USING btree (started_at DESC);


--
-- Name: idx_weather_swaths_day_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weather_swaths_day_source ON public.weather_swaths USING btree (event_date, layer, source);


--
-- Name: idx_weather_swaths_layer_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weather_swaths_layer_date ON public.weather_swaths USING btree (layer, event_date DESC);


--
-- Name: idx_wo_status_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wo_status_history ON public.work_order_status_history USING btree (work_order_id);


--
-- Name: idx_work_order_comments_wo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_order_comments_wo ON public.work_order_comments USING btree (work_order_id);


--
-- Name: idx_work_order_photos_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_order_photos_org ON public.work_order_photos USING btree (org_id);


--
-- Name: idx_work_order_photos_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_order_photos_type ON public.work_order_photos USING btree (work_order_id, photo_type);


--
-- Name: idx_work_order_photos_work_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_order_photos_work_order ON public.work_order_photos USING btree (work_order_id);


--
-- Name: idx_work_order_status_history_wo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_order_status_history_wo ON public.work_order_status_history USING btree (work_order_id);


--
-- Name: idx_work_orders_assigned_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_assigned_sub ON public.work_orders USING btree (assigned_sub_id) WHERE (assigned_sub_id IS NOT NULL);


--
-- Name: idx_work_orders_assigned_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_assigned_user ON public.work_orders USING btree (assigned_user_id) WHERE (assigned_user_id IS NOT NULL);


--
-- Name: idx_work_orders_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_customer ON public.work_orders USING btree (customer_id);


--
-- Name: idx_work_orders_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_job ON public.work_orders USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: idx_work_orders_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_number ON public.work_orders USING btree (org_id, work_order_number);


--
-- Name: idx_work_orders_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_org ON public.work_orders USING btree (org_id);


--
-- Name: idx_work_orders_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_org_id ON public.work_orders USING btree (org_id);


--
-- Name: idx_work_orders_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_project ON public.work_orders USING btree (project_id);


--
-- Name: idx_work_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_status ON public.work_orders USING btree (org_id, status);


--
-- Name: idx_work_orders_trade_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_trade_schedule ON public.work_orders USING btree (org_id, scheduled_date) WHERE (trade IS NOT NULL);


--
-- Name: job_checkups_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_checkups_customer_idx ON public.job_checkups USING btree (customer_id);


--
-- Name: job_checkups_org_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_checkups_org_due_idx ON public.job_checkups USING btree (org_id, status, due_on);


--
-- Name: job_run_sheet_overrides_job_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX job_run_sheet_overrides_job_id_key ON public.job_run_sheet_overrides USING btree (job_id);


--
-- Name: job_run_sheet_overrides_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_run_sheet_overrides_org_id_idx ON public.job_run_sheet_overrides USING btree (org_id);


--
-- Name: lidar_tiles_bbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lidar_tiles_bbox_idx ON public.lidar_tiles USING btree (min_lat, max_lat, min_lng, max_lng);


--
-- Name: lidar_tiles_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lidar_tiles_queue_idx ON public.lidar_tiles USING btree (status, priority DESC);


--
-- Name: notifications_waiting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_waiting_idx ON public.notifications USING btree (recipient_user_id, resolved_at, priority);


--
-- Name: payroll_job_snapshots_one_period_per_job; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payroll_job_snapshots_one_period_per_job ON public.payroll_job_snapshots USING btree (org_id, job_id);


--
-- Name: payroll_payout_lines_one_period_per_job_user_role; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payroll_payout_lines_one_period_per_job_user_role ON public.payroll_payout_lines USING btree (job_id, user_id, participant_role);


--
-- Name: scheduled_appointments_adjuster_meeting_slot_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX scheduled_appointments_adjuster_meeting_slot_unique_idx ON public.scheduled_appointments USING btree (org_id, opportunity_id, scheduled_for) WHERE ((appointment_type = 'adjuster_meeting'::text) AND (status <> 'cancelled'::text));


--
-- Name: scheduled_appointments_google_sync_failed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduled_appointments_google_sync_failed_idx ON public.scheduled_appointments USING btree (org_id, google_sync_failed_at) WHERE (google_sync_failed_at IS NOT NULL);


--
-- Name: scheduled_appointments_inside_sales_booked_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduled_appointments_inside_sales_booked_by_idx ON public.scheduled_appointments USING btree (org_id, inside_sales_booked_by_user_id, scheduled_for) WHERE (inside_sales_booked_by_user_id IS NOT NULL);


--
-- Name: thread_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX thread_members_user_idx ON public.thread_members USING btree (user_id);


--
-- Name: threads_deal_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX threads_deal_uq ON public.threads USING btree (opportunity_id) WHERE (kind = 'deal'::text);


--
-- Name: threads_prospect_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX threads_prospect_uq ON public.threads USING btree (lead_id) WHERE (kind = 'prospect'::text);


--
-- Name: uq_instant_estimate_checks_job_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_instant_estimate_checks_job_version ON public.instant_estimate_checks USING btree (org_id, production_job_id, estimate_version) WHERE (production_job_id IS NOT NULL);


--
-- Name: uq_instant_estimate_checks_opp_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_instant_estimate_checks_opp_version ON public.instant_estimate_checks USING btree (org_id, opportunity_id, estimate_version) WHERE (opportunity_id IS NOT NULL);


--
-- Name: uq_job_cost_lines_source_product_order; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_job_cost_lines_source_product_order ON public.job_cost_lines USING btree (source_product_order_id) WHERE (source_product_order_id IS NOT NULL);


--
-- Name: uq_payroll_adjustments_one_balance; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payroll_adjustments_one_balance ON public.payroll_adjustments USING btree (source_period_id, user_id) WHERE ((kind = 'balance'::text) AND (status <> 'void'::text));


--
-- Name: uq_referral_partner_types_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_referral_partner_types_name ON public.referral_partner_types USING btree (org_id, lower(name));


--
-- Name: uq_referral_partners_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_referral_partners_phone ON public.referral_partners USING btree (org_id, phone_digits) WHERE (phone_digits IS NOT NULL);


--
-- Name: uq_review_requests_job; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_review_requests_job ON public.review_requests USING btree (production_job_id);


--
-- Name: uq_review_requests_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_review_requests_token ON public.review_requests USING btree (token);


--
-- Name: uq_supplier_api_approvals_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_supplier_api_approvals_open ON public.supplier_api_approvals USING btree (supplier_order_id, content_hash) WHERE (status = ANY (ARRAY['pending'::text, 'approved'::text]));


--
-- Name: uq_supplier_order_sends_in_flight; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_supplier_order_sends_in_flight ON public.supplier_order_sends USING btree (supplier_order_id) WHERE (status = 'sending'::public.supplier_order_send_status);


--
-- Name: uq_vendors_org_name_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vendors_org_name_ci ON public.vendors USING btree (org_id, lower(name)) WHERE (deleted_at IS NULL);


--
-- Name: uq_work_orders_crew_link_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_work_orders_crew_link_token ON public.work_orders USING btree (crew_link_token) WHERE (crew_link_token IS NOT NULL);


--
-- Name: uq_work_orders_job_auto_trade; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_work_orders_job_auto_trade ON public.work_orders USING btree (job_id, trade) WHERE (trade_source = 'auto'::text);


--
-- Name: weather_swaths_event_date_layer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX weather_swaths_event_date_layer_idx ON public.weather_swaths USING btree (event_date DESC, layer);


--
-- Name: comp_plan_versions comp_plan_versions_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER comp_plan_versions_append_only BEFORE DELETE OR UPDATE ON public.comp_plan_versions FOR EACH ROW EXECUTE FUNCTION public.reject_comp_plan_version_mutation();


--
-- Name: scheduled_appointments create_status_prompt_on_appointment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_status_prompt_on_appointment AFTER INSERT ON public.scheduled_appointments FOR EACH ROW EXECUTE FUNCTION public.create_inspection_status_prompt();


--
-- Name: employee_comp_agreements employee_agreement_content_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER employee_agreement_content_immutable BEFORE UPDATE ON public.employee_comp_agreements FOR EACH ROW EXECUTE FUNCTION public.prevent_employee_agreement_content_mutation();


--
-- Name: employee_comp_agreement_events employee_agreement_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER employee_agreement_events_append_only BEFORE DELETE OR UPDATE ON public.employee_comp_agreement_events FOR EACH ROW EXECUTE FUNCTION public.prevent_employee_agreement_event_mutation();


--
-- Name: employee_comp_agreements employee_agreement_lifecycle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER employee_agreement_lifecycle BEFORE UPDATE ON public.employee_comp_agreements FOR EACH ROW EXECUTE FUNCTION public.enforce_employee_agreement_lifecycle();


--
-- Name: leads leads_assignee_display_names; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER leads_assignee_display_names BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.leads_set_assignee_display_names();


--
-- Name: org_trades org_trades_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER org_trades_guard BEFORE UPDATE ON public.org_trades FOR EACH ROW EXECUTE FUNCTION public.org_trades_guard();


--
-- Name: orgs orgs_seed_trades; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orgs_seed_trades AFTER INSERT ON public.orgs FOR EACH ROW EXECUTE FUNCTION public.orgs_seed_trades();


--
-- Name: users preserve_user_name_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER preserve_user_name_trigger BEFORE DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION public.preserve_user_name_on_delete();


--
-- Name: production_jobs production_jobs_job_type_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER production_jobs_job_type_guard BEFORE INSERT OR UPDATE OF job_type, org_id ON public.production_jobs FOR EACH ROW EXECUTE FUNCTION public.production_jobs_job_type_guard();


--
-- Name: roofing_types roofing_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER roofing_types_updated_at BEFORE UPDATE ON public.roofing_types FOR EACH ROW EXECUTE FUNCTION public.update_roofing_types_updated_at();


--
-- Name: scheduled_appointments trg_clear_closeout_mark_on_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clear_closeout_mark_on_change BEFORE UPDATE OF scheduled_for, status ON public.scheduled_appointments FOR EACH ROW EXECUTE FUNCTION public.clear_closeout_mark_on_change();


--
-- Name: user_comp_plans trg_enforce_user_comp_plan_org_scope; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_user_comp_plan_org_scope BEFORE INSERT OR UPDATE ON public.user_comp_plans FOR EACH ROW EXECUTE FUNCTION public.enforce_user_comp_plan_org_scope();


--
-- Name: payroll_adjustments trg_guard_claimed_period; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_claimed_period BEFORE INSERT OR DELETE OR UPDATE ON public.payroll_adjustments FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_claimed_period();


--
-- Name: payroll_bonus_lines trg_guard_claimed_period; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_claimed_period BEFORE INSERT OR DELETE OR UPDATE ON public.payroll_bonus_lines FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_claimed_period();


--
-- Name: payroll_rep_hours trg_guard_claimed_period; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_claimed_period BEFORE INSERT OR DELETE OR UPDATE ON public.payroll_rep_hours FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_claimed_period();


--
-- Name: payroll_periods trg_guard_frozen_period_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_frozen_period_status BEFORE UPDATE OF status ON public.payroll_periods FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_frozen_period_status();


--
-- Name: users trg_guard_users_is_super_admin; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_users_is_super_admin BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.guard_users_is_super_admin();


--
-- Name: instant_estimate_checks trg_instant_estimate_checks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_instant_estimate_checks_updated_at BEFORE UPDATE ON public.instant_estimate_checks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: opportunities trg_opportunity_referral_partner_source; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_opportunity_referral_partner_source AFTER INSERT OR UPDATE OF referral_partner_id ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.opportunity_referral_partner_source();


--
-- Name: payroll_job_snapshots trg_payroll_job_snapshots_single_period_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payroll_job_snapshots_single_period_ins BEFORE INSERT ON public.payroll_job_snapshots FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_job_snapshot_single_period();


--
-- Name: payroll_job_snapshots trg_payroll_job_snapshots_single_period_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payroll_job_snapshots_single_period_upd BEFORE UPDATE OF job_id, payroll_period_id ON public.payroll_job_snapshots FOR EACH ROW WHEN (((old.job_id IS DISTINCT FROM new.job_id) OR (old.payroll_period_id IS DISTINCT FROM new.payroll_period_id))) EXECUTE FUNCTION public.payroll_guard_job_snapshot_single_period();


--
-- Name: payroll_payout_lines trg_payroll_payout_lines_single_period_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payroll_payout_lines_single_period_ins BEFORE INSERT ON public.payroll_payout_lines FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_payout_line_single_period();


--
-- Name: payroll_payout_lines trg_payroll_payout_lines_single_period_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payroll_payout_lines_single_period_upd BEFORE UPDATE OF job_id, user_id, participant_role, payroll_period_id ON public.payroll_payout_lines FOR EACH ROW WHEN (((old.job_id IS DISTINCT FROM new.job_id) OR (old.user_id IS DISTINCT FROM new.user_id) OR (old.participant_role IS DISTINCT FROM new.participant_role) OR (old.payroll_period_id IS DISTINCT FROM new.payroll_period_id))) EXECUTE FUNCTION public.payroll_guard_payout_line_single_period();


--
-- Name: scheduled_appointments trg_prevent_overlapping_scheduled_appointments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_overlapping_scheduled_appointments BEFORE INSERT OR UPDATE OF closer_user_id, scheduled_for, duration_minutes, buffer_after_minutes, status ON public.scheduled_appointments FOR EACH ROW EXECUTE FUNCTION public.prevent_overlapping_scheduled_appointments();


--
-- Name: production_jobs trg_production_job_partner_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_production_job_partner_owner AFTER INSERT ON public.production_jobs FOR EACH ROW EXECUTE FUNCTION public.production_job_partner_owner_trigger();


--
-- Name: user_management_comp_overlay_assignments trg_protect_management_overlay_assignment_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_management_overlay_assignment_history BEFORE DELETE OR UPDATE ON public.user_management_comp_overlay_assignments FOR EACH ROW EXECUTE FUNCTION public.protect_management_overlay_assignment_history();


--
-- Name: orgs trg_record_org_derived_commission_rates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_record_org_derived_commission_rates AFTER UPDATE OF inspection_commission_rate, manager_override_commission_rate, self_gen_commission_rate ON public.orgs FOR EACH ROW EXECUTE FUNCTION public.record_org_derived_commission_rates();


--
-- Name: users trg_record_user_manager_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_record_user_manager_assignment AFTER INSERT OR UPDATE OF manager_user_id ON public.users FOR EACH ROW EXECUTE FUNCTION public.record_user_manager_assignment();


--
-- Name: users trg_record_user_payroll_active_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_record_user_payroll_active_history AFTER UPDATE OF active ON public.users FOR EACH ROW EXECUTE FUNCTION public.record_user_payroll_active_history();


--
-- Name: referral_partners trg_referral_partner_log_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_referral_partner_log_assignment AFTER INSERT OR UPDATE ON public.referral_partners FOR EACH ROW EXECUTE FUNCTION public.referral_partner_log_assignment();


--
-- Name: activities trg_referral_partner_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_referral_partner_touch AFTER INSERT ON public.activities FOR EACH ROW EXECUTE FUNCTION public.referral_partner_touch_from_activity();


--
-- Name: referral_partners trg_referral_partners_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_referral_partners_before_write BEFORE INSERT OR UPDATE ON public.referral_partners FOR EACH ROW EXECUTE FUNCTION public.referral_partners_before_write();


--
-- Name: users trg_referral_partners_release_deleted_user; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_referral_partners_release_deleted_user BEFORE DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION public.referral_partners_release_for_deleted_user();


--
-- Name: referrals trg_referrals_apply_link_side_effects; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_referrals_apply_link_side_effects BEFORE INSERT OR UPDATE ON public.referrals FOR EACH ROW EXECUTE FUNCTION public.referrals_apply_link_side_effects();


--
-- Name: production_jobs trg_referrals_mark_installed_from_job; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_referrals_mark_installed_from_job AFTER INSERT OR UPDATE OF status ON public.production_jobs FOR EACH ROW EXECUTE FUNCTION public.referrals_mark_installed_from_job();


--
-- Name: management_comp_overlay_plan_versions trg_reject_management_overlay_version_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reject_management_overlay_version_update BEFORE DELETE OR UPDATE ON public.management_comp_overlay_plan_versions FOR EACH ROW EXECUTE FUNCTION public.reject_management_overlay_version_mutation();


--
-- Name: primary_comp_plan_assignment_cancellations trg_reject_primary_comp_plan_cancellation_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reject_primary_comp_plan_cancellation_mutation BEFORE DELETE OR UPDATE ON public.primary_comp_plan_assignment_cancellations FOR EACH ROW EXECUTE FUNCTION public.reject_management_overlay_version_mutation();


--
-- Name: supplier_api_events trg_supplier_api_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_supplier_api_events_append_only BEFORE DELETE OR UPDATE ON public.supplier_api_events FOR EACH ROW EXECUTE FUNCTION public.supplier_api_events_append_only();


--
-- Name: scheduled_appointments trg_sync_pending_prompt_closer_on_reassignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_pending_prompt_closer_on_reassignment AFTER UPDATE OF closer_user_id ON public.scheduled_appointments FOR EACH ROW EXECUTE FUNCTION public.sync_pending_prompt_closer_on_reassignment();


--
-- Name: vendors trg_vendors_one_default_per_trade; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_vendors_one_default_per_trade BEFORE INSERT OR UPDATE OF active, default_for_trades, deleted_at, org_id ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.vendors_one_default_per_trade();


--
-- Name: crews trigger_crews_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_crews_updated_at BEFORE UPDATE ON public.crews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: documents trigger_documents_signed_protection_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_documents_signed_protection_insert BEFORE INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.enforce_documents_mvp_rules();


--
-- Name: documents trigger_enforce_documents_mvp_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_enforce_documents_mvp_rules BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.enforce_documents_mvp_rules();


--
-- Name: photos trigger_enforce_photos_storage_path_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_enforce_photos_storage_path_immutable BEFORE UPDATE ON public.photos FOR EACH ROW EXECUTE FUNCTION public.enforce_photos_storage_path_immutable();


--
-- Name: production_jobs trigger_generate_job_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_generate_job_number BEFORE INSERT ON public.production_jobs FOR EACH ROW WHEN (((new.job_number IS NULL) OR (new.job_number = ''::text))) EXECUTE FUNCTION public.generate_job_number();


--
-- Name: work_orders trigger_generate_work_order_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_generate_work_order_number BEFORE INSERT ON public.work_orders FOR EACH ROW WHEN (((new.work_order_number IS NULL) OR (new.work_order_number = ''::text))) EXECUTE FUNCTION public.generate_work_order_number();


--
-- Name: job_additional_scope trigger_job_additional_scope_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_job_additional_scope_updated_at BEFORE UPDATE ON public.job_additional_scope FOR EACH ROW EXECUTE FUNCTION public.update_job_additional_scope_updated_at();


--
-- Name: job_change_orders trigger_job_change_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_job_change_orders_updated_at BEFORE UPDATE ON public.job_change_orders FOR EACH ROW EXECUTE FUNCTION public.update_job_change_orders_updated_at();


--
-- Name: job_cost_lines trigger_job_cost_lines_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_job_cost_lines_updated_at BEFORE UPDATE ON public.job_cost_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: job_material_order_overrides trigger_job_material_order_overrides_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_job_material_order_overrides_updated_at BEFORE UPDATE ON public.job_material_order_overrides FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: job_product_orders trigger_job_product_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_job_product_orders_updated_at BEFORE UPDATE ON public.job_product_orders FOR EACH ROW EXECUTE FUNCTION public.update_job_product_orders_updated_at();


--
-- Name: material_orders trigger_material_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_material_orders_updated_at BEFORE UPDATE ON public.material_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: order_form_contracts trigger_order_form_contracts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_order_form_contracts_updated_at BEFORE UPDATE ON public.order_form_contracts FOR EACH ROW EXECUTE FUNCTION public.update_order_form_contracts_updated_at();


--
-- Name: documents trigger_prevent_documents_hard_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_prevent_documents_hard_delete BEFORE DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.prevent_documents_hard_delete();


--
-- Name: production_jobs trigger_production_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_production_jobs_updated_at BEFORE UPDATE ON public.production_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: job_invoices trigger_set_invoice_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_set_invoice_number BEFORE INSERT ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.set_invoice_number();


--
-- Name: sub_contractors trigger_sub_contractors_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_sub_contractors_updated_at BEFORE UPDATE ON public.sub_contractors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: leads trigger_update_campaign_lead_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_campaign_lead_count AFTER INSERT OR UPDATE OF campaign_id ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_campaign_lead_count();


--
-- Name: leads trigger_update_lead_source_stats; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_lead_source_stats AFTER INSERT ON public.leads FOR EACH ROW WHEN ((new.lead_source_id IS NOT NULL)) EXECUTE FUNCTION public.update_lead_source_stats();


--
-- Name: vendors trigger_vendors_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_vendors_updated_at BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: work_orders trigger_work_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_work_orders_updated_at BEFORE UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: activities update_activities_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_activities_updated_at BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ai_conversations update_ai_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ai_conversations_updated_at BEFORE UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: campaigns update_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: close_appointments update_close_appointments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_close_appointments_updated_at BEFORE UPDATE ON public.close_appointments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: commissions update_commissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_commissions_updated_at BEFORE UPDATE ON public.commissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: comp_plans update_comp_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_comp_plans_updated_at BEFORE UPDATE ON public.comp_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: custom_reports update_custom_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_custom_reports_updated_at BEFORE UPDATE ON public.custom_reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: custom_roles update_custom_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_custom_roles_updated_at BEFORE UPDATE ON public.custom_roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: customers update_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: dashboard_settings update_dashboard_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_dashboard_settings_updated_at BEFORE UPDATE ON public.dashboard_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: deal_commission_roles update_deal_commission_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_deal_commission_roles_updated_at BEFORE UPDATE ON public.deal_commission_roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: estimate_lines update_estimate_lines_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_estimate_lines_updated_at BEFORE UPDATE ON public.estimate_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: estimates update_estimates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_estimates_updated_at BEFORE UPDATE ON public.estimates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: files update_files_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: inbound_lead_queue update_inbound_lead_queue_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_inbound_lead_queue_updated_at BEFORE UPDATE ON public.inbound_lead_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: incentive_badges update_incentive_badges_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_incentive_badges_updated_at BEFORE UPDATE ON public.incentive_badges FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: incentive_cycles update_incentive_cycles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_incentive_cycles_updated_at BEFORE UPDATE ON public.incentive_cycles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: inspection_briefings update_inspection_briefings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_inspection_briefings_updated_at BEFORE UPDATE ON public.inspection_briefings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: inspection_results update_inspection_results_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_inspection_results_updated_at BEFORE UPDATE ON public.inspection_results FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: inspection_status_updates update_inspection_status_updates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_inspection_status_updates_updated_at BEFORE UPDATE ON public.inspection_status_updates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: integration_configs update_integration_configs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_integration_configs_updated_at BEFORE UPDATE ON public.integration_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: job_files update_job_files_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_job_files_updated_at BEFORE UPDATE ON public.job_files FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: job_measure_elevations update_job_measure_elevations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_job_measure_elevations_updated_at BEFORE UPDATE ON public.job_measure_elevations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: job_measure_openings update_job_measure_openings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_job_measure_openings_updated_at BEFORE UPDATE ON public.job_measure_openings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: job_measure_reports update_job_measure_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_job_measure_reports_updated_at BEFORE UPDATE ON public.job_measure_reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: jobs update_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: projects update_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: lead_sources update_lead_sources_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_lead_sources_updated_at BEFORE UPDATE ON public.lead_sources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: leads update_leads_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: measurement_requests update_measurement_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_measurement_requests_updated_at BEFORE UPDATE ON public.measurement_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: org_monthly_goals update_org_monthly_goals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_org_monthly_goals_updated_at BEFORE UPDATE ON public.org_monthly_goals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: orgs update_orgs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_orgs_updated_at BEFORE UPDATE ON public.orgs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: payroll_rep_hours update_payroll_rep_hours_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_payroll_rep_hours_updated_at BEFORE UPDATE ON public.payroll_rep_hours FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: permission_presets update_permission_presets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_permission_presets_updated_at BEFORE UPDATE ON public.permission_presets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: pricebook_items update_pricebook_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_pricebook_items_updated_at BEFORE UPDATE ON public.pricebook_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: pricebooks update_pricebooks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_pricebooks_updated_at BEFORE UPDATE ON public.pricebooks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: program_444_enrollments update_program_444_enrollments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_program_444_enrollments_updated_at BEFORE UPDATE ON public.program_444_enrollments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: proposal_templates update_proposal_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_proposal_templates_updated_at BEFORE UPDATE ON public.proposal_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: proposals update_proposals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_proposals_updated_at BEFORE UPDATE ON public.proposals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: referrals update_referrals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_referrals_updated_at BEFORE UPDATE ON public.referrals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: regions update_regions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_regions_updated_at BEFORE UPDATE ON public.regions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: report_schedules update_report_schedules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_report_schedules_updated_at BEFORE UPDATE ON public.report_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: roof_measurements update_roof_measurements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_roof_measurements_updated_at BEFORE UPDATE ON public.roof_measurements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: scheduled_appointments update_scheduled_appointments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_scheduled_appointments_updated_at BEFORE UPDATE ON public.scheduled_appointments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: setter_ramp_enrollments update_setter_ramp_enrollments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_setter_ramp_enrollments_updated_at BEFORE UPDATE ON public.setter_ramp_enrollments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: setter_ramp_weekly_status update_setter_ramp_weekly_status_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_setter_ramp_weekly_status_updated_at BEFORE UPDATE ON public.setter_ramp_weekly_status FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: spiff_achievements update_spiff_achievements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_spiff_achievements_updated_at BEFORE UPDATE ON public.spiff_achievements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: spiff_programs update_spiff_programs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_spiff_programs_updated_at BEFORE UPDATE ON public.spiff_programs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: sub_contractors update_sub_contractors_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_sub_contractors_updated_at BEFORE UPDATE ON public.sub_contractors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: team_closer_queue update_team_closer_queue_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_team_closer_queue_updated_at BEFORE UPDATE ON public.team_closer_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: teams update_teams_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_google_tokens update_user_google_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_google_tokens_updated_at BEFORE UPDATE ON public.user_google_tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_incentive_goals update_user_incentive_goals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_incentive_goals_updated_at BEFORE UPDATE ON public.user_incentive_goals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_settings update_user_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: work_orders update_work_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_work_orders_updated_at BEFORE UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: work_orders work_order_number_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER work_order_number_trigger BEFORE INSERT ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.set_work_order_number();


--
-- Name: work_orders work_order_status_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER work_order_status_trigger AFTER UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.track_work_order_status();


--
-- Name: activities activities_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: activities activities_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_job_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: activities activities_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: activities activities_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: activities activities_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: activities activities_referral_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES public.referral_partners(id) ON DELETE CASCADE;


--
-- Name: activities activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: adder_categories adder_categories_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adder_categories
    ADD CONSTRAINT adder_categories_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: ai_conversations ai_conversations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: ai_conversations ai_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_message_feedback ai_message_feedback_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_message_feedback
    ADD CONSTRAINT ai_message_feedback_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.ai_conversations(id) ON DELETE CASCADE;


--
-- Name: ai_message_feedback ai_message_feedback_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_message_feedback
    ADD CONSTRAINT ai_message_feedback_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: ai_message_feedback ai_message_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_message_feedback
    ADD CONSTRAINT ai_message_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_suggestions ai_suggestions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestions
    ADD CONSTRAINT ai_suggestions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: ai_suggestions ai_suggestions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestions
    ADD CONSTRAINT ai_suggestions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: announcement_dismissals announcement_dismissals_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_dismissals
    ADD CONSTRAINT announcement_dismissals_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;


--
-- Name: announcement_dismissals announcement_dismissals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_dismissals
    ADD CONSTRAINT announcement_dismissals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: announcement_dismissals announcement_dismissals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_dismissals
    ADD CONSTRAINT announcement_dismissals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: announcements announcements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: announcements announcements_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: appointment_closeouts appointment_closeouts_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_closeouts
    ADD CONSTRAINT appointment_closeouts_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointment_closeouts appointment_closeouts_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_closeouts
    ADD CONSTRAINT appointment_closeouts_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.scheduled_appointments(id) ON DELETE CASCADE;


--
-- Name: appointment_closeouts appointment_closeouts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_closeouts
    ADD CONSTRAINT appointment_closeouts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: appointment_closeouts appointment_closeouts_reverted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_closeouts
    ADD CONSTRAINT appointment_closeouts_reverted_by_fkey FOREIGN KEY (reverted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: appointment_types appointment_types_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_types
    ADD CONSTRAINT appointment_types_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: campaigns campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: campaigns campaigns_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: canvass_knocks canvass_knocks_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_knocks
    ADD CONSTRAINT canvass_knocks_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: canvass_knocks canvass_knocks_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_knocks
    ADD CONSTRAINT canvass_knocks_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: canvass_territories canvass_territories_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_territories
    ADD CONSTRAINT canvass_territories_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: canvass_territory_teams canvass_territory_teams_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_territory_teams
    ADD CONSTRAINT canvass_territory_teams_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: canvass_territory_teams canvass_territory_teams_territory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_territory_teams
    ADD CONSTRAINT canvass_territory_teams_territory_id_fkey FOREIGN KEY (territory_id) REFERENCES public.canvass_territories(id) ON DELETE CASCADE;


--
-- Name: canvass_territory_users canvass_territory_users_territory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_territory_users
    ADD CONSTRAINT canvass_territory_users_territory_id_fkey FOREIGN KEY (territory_id) REFERENCES public.canvass_territories(id) ON DELETE CASCADE;


--
-- Name: canvass_territory_users canvass_territory_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvass_territory_users
    ADD CONSTRAINT canvass_territory_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: close_appointments close_appointments_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.close_appointments
    ADD CONSTRAINT close_appointments_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: close_appointments close_appointments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.close_appointments
    ADD CONSTRAINT close_appointments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: close_appointments close_appointments_scheduled_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.close_appointments
    ADD CONSTRAINT close_appointments_scheduled_appointment_id_fkey FOREIGN KEY (scheduled_appointment_id) REFERENCES public.scheduled_appointments(id) ON DELETE SET NULL;


--
-- Name: close_appointments close_appointments_source_inspection_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.close_appointments
    ADD CONSTRAINT close_appointments_source_inspection_appointment_id_fkey FOREIGN KEY (source_inspection_appointment_id) REFERENCES public.scheduled_appointments(id) ON DELETE SET NULL;


--
-- Name: close_appointments close_appointments_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.close_appointments
    ADD CONSTRAINT close_appointments_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: coaching_goals coaching_goals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_goals
    ADD CONSTRAINT coaching_goals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: coaching_goals coaching_goals_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_goals
    ADD CONSTRAINT coaching_goals_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: coaching_goals coaching_goals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_goals
    ADD CONSTRAINT coaching_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: commissions commissions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commissions
    ADD CONSTRAINT commissions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: commissions commissions_comp_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commissions
    ADD CONSTRAINT commissions_comp_plan_id_fkey FOREIGN KEY (comp_plan_id) REFERENCES public.comp_plans(id) ON DELETE SET NULL;


--
-- Name: commissions commissions_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commissions
    ADD CONSTRAINT commissions_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: commissions commissions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commissions
    ADD CONSTRAINT commissions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: commissions commissions_production_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commissions
    ADD CONSTRAINT commissions_production_job_id_fkey FOREIGN KEY (production_job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: commissions commissions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commissions
    ADD CONSTRAINT commissions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: commissions commissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commissions
    ADD CONSTRAINT commissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: comp_plan_versions comp_plan_versions_creator_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comp_plan_versions
    ADD CONSTRAINT comp_plan_versions_creator_org_fkey FOREIGN KEY (org_id, created_by_user_id) REFERENCES public.users(org_id, id) ON DELETE RESTRICT;


--
-- Name: comp_plan_versions comp_plan_versions_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comp_plan_versions
    ADD CONSTRAINT comp_plan_versions_org_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE RESTRICT;


--
-- Name: comp_plan_versions comp_plan_versions_plan_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comp_plan_versions
    ADD CONSTRAINT comp_plan_versions_plan_org_fkey FOREIGN KEY (org_id, comp_plan_id) REFERENCES public.comp_plans(org_id, id) ON DELETE RESTRICT;


--
-- Name: comp_plans comp_plans_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comp_plans
    ADD CONSTRAINT comp_plans_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: contract_events contract_events_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_events
    ADD CONSTRAINT contract_events_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_signatures contract_signatures_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_signatures
    ADD CONSTRAINT contract_signatures_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_signatures contract_signatures_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_signatures
    ADD CONSTRAINT contract_signatures_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: contract_templates contract_templates_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_templates
    ADD CONSTRAINT contract_templates_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_job_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: cost_attachments cost_attachments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_attachments
    ADD CONSTRAINT cost_attachments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cost_attachments cost_attachments_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_attachments
    ADD CONSTRAINT cost_attachments_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cost_attachments cost_attachments_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_attachments
    ADD CONSTRAINT cost_attachments_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE RESTRICT;


--
-- Name: cost_attachments cost_attachments_job_cost_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_attachments
    ADD CONSTRAINT cost_attachments_job_cost_line_id_fkey FOREIGN KEY (job_cost_line_id) REFERENCES public.job_cost_lines(id) ON DELETE CASCADE;


--
-- Name: cost_attachments cost_attachments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_attachments
    ADD CONSTRAINT cost_attachments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: crews crews_foreman_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crews
    ADD CONSTRAINT crews_foreman_user_id_fkey FOREIGN KEY (foreman_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crews crews_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crews
    ADD CONSTRAINT crews_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: custom_reports custom_reports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_reports
    ADD CONSTRAINT custom_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: custom_reports custom_reports_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_reports
    ADD CONSTRAINT custom_reports_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: custom_roles custom_roles_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_roles
    ADD CONSTRAINT custom_roles_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: custom_roles custom_roles_parent_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_roles
    ADD CONSTRAINT custom_roles_parent_role_id_fkey FOREIGN KEY (parent_role_id) REFERENCES public.custom_roles(id) ON DELETE SET NULL;


--
-- Name: customers customers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: dashboard_settings dashboard_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_settings
    ADD CONSTRAINT dashboard_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: dashboard_settings dashboard_settings_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_settings
    ADD CONSTRAINT dashboard_settings_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE CASCADE;


--
-- Name: dashboard_settings dashboard_settings_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_settings
    ADD CONSTRAINT dashboard_settings_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: dashboard_settings dashboard_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_settings
    ADD CONSTRAINT dashboard_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: deal_commission_roles deal_commission_roles_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_commission_roles
    ADD CONSTRAINT deal_commission_roles_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: deal_commission_roles deal_commission_roles_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_commission_roles
    ADD CONSTRAINT deal_commission_roles_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: deal_commission_roles deal_commission_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_commission_roles
    ADD CONSTRAINT deal_commission_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: documents documents_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: documents documents_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: documents documents_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: documents documents_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: documents documents_parent_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_parent_document_id_fkey FOREIGN KEY (parent_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: email_blast_sends email_blast_sends_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_blast_sends
    ADD CONSTRAINT email_blast_sends_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: employee_comp_agreement_events employee_comp_agreement_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_comp_agreement_events
    ADD CONSTRAINT employee_comp_agreement_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: employee_comp_agreement_events employee_comp_agreement_events_agreement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_comp_agreement_events
    ADD CONSTRAINT employee_comp_agreement_events_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES public.employee_comp_agreements(id) ON DELETE RESTRICT;


--
-- Name: employee_comp_agreement_events employee_comp_agreement_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_comp_agreement_events
    ADD CONSTRAINT employee_comp_agreement_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE RESTRICT;


--
-- Name: employee_comp_agreements employee_comp_agreements_manager_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_comp_agreements
    ADD CONSTRAINT employee_comp_agreements_manager_user_id_fkey FOREIGN KEY (manager_user_id) REFERENCES public.users(id);


--
-- Name: employee_comp_agreements employee_comp_agreements_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_comp_agreements
    ADD CONSTRAINT employee_comp_agreements_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE RESTRICT;


--
-- Name: employee_comp_agreements employee_comp_agreements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_comp_agreements
    ADD CONSTRAINT employee_comp_agreements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: estimate_line_items estimate_line_items_estimate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_line_items
    ADD CONSTRAINT estimate_line_items_estimate_id_fkey FOREIGN KEY (estimate_id) REFERENCES public.estimates(id) ON DELETE CASCADE;


--
-- Name: estimate_line_items estimate_line_items_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_line_items
    ADD CONSTRAINT estimate_line_items_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: estimate_lines estimate_lines_estimate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_lines
    ADD CONSTRAINT estimate_lines_estimate_id_fkey FOREIGN KEY (estimate_id) REFERENCES public.estimates(id) ON DELETE CASCADE;


--
-- Name: estimate_lines estimate_lines_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_lines
    ADD CONSTRAINT estimate_lines_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: estimate_lines estimate_lines_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_lines
    ADD CONSTRAINT estimate_lines_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: estimate_lines estimate_lines_pricebook_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimate_lines
    ADD CONSTRAINT estimate_lines_pricebook_item_id_fkey FOREIGN KEY (pricebook_item_id) REFERENCES public.pricebook_items(id) ON DELETE SET NULL;


--
-- Name: estimates estimates_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates
    ADD CONSTRAINT estimates_job_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: estimates estimates_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates
    ADD CONSTRAINT estimates_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: estimates estimates_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates
    ADD CONSTRAINT estimates_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: files files_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: files files_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_job_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: files files_job_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_job_id_fkey1 FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: files files_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: files files_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: files files_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: files files_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: financing_programs financing_programs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financing_programs
    ADD CONSTRAINT financing_programs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: founder_contacts founder_contacts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.founder_contacts
    ADD CONSTRAINT founder_contacts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: founder_contacts founder_contacts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.founder_contacts
    ADD CONSTRAINT founder_contacts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: inbound_lead_queue inbound_lead_queue_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_lead_queue
    ADD CONSTRAINT inbound_lead_queue_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inbound_lead_queue inbound_lead_queue_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_lead_queue
    ADD CONSTRAINT inbound_lead_queue_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: inbound_lead_queue inbound_lead_queue_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_lead_queue
    ADD CONSTRAINT inbound_lead_queue_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: inbound_lead_queue inbound_lead_queue_lead_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_lead_queue
    ADD CONSTRAINT inbound_lead_queue_lead_source_id_fkey FOREIGN KEY (lead_source_id) REFERENCES public.lead_sources(id) ON DELETE SET NULL;


--
-- Name: inbound_lead_queue inbound_lead_queue_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_lead_queue
    ADD CONSTRAINT inbound_lead_queue_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: incentive_badges incentive_badges_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incentive_badges
    ADD CONSTRAINT incentive_badges_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: incentive_cycles incentive_cycles_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incentive_cycles
    ADD CONSTRAINT incentive_cycles_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: inspection_briefings inspection_briefings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_briefings
    ADD CONSTRAINT inspection_briefings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inspection_briefings inspection_briefings_org_appointment_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_briefings
    ADD CONSTRAINT inspection_briefings_org_appointment_fk FOREIGN KEY (org_id, appointment_id) REFERENCES public.scheduled_appointments(org_id, id) ON DELETE CASCADE;


--
-- Name: inspection_briefings inspection_briefings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_briefings
    ADD CONSTRAINT inspection_briefings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: inspection_briefings inspection_briefings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_briefings
    ADD CONSTRAINT inspection_briefings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inspection_report_photos inspection_report_photos_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_report_photos
    ADD CONSTRAINT inspection_report_photos_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: inspection_report_photos inspection_report_photos_org_report_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_report_photos
    ADD CONSTRAINT inspection_report_photos_org_report_fk FOREIGN KEY (org_id, report_id) REFERENCES public.inspection_reports(org_id, id) ON DELETE CASCADE;


--
-- Name: inspection_reports inspection_reports_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_reports
    ADD CONSTRAINT inspection_reports_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inspection_reports inspection_reports_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_reports
    ADD CONSTRAINT inspection_reports_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: inspection_reports inspection_reports_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_reports
    ADD CONSTRAINT inspection_reports_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: inspection_result_photos inspection_result_photos_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_result_photos
    ADD CONSTRAINT inspection_result_photos_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: inspection_result_photos inspection_result_photos_org_result_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_result_photos
    ADD CONSTRAINT inspection_result_photos_org_result_fk FOREIGN KEY (org_id, result_id) REFERENCES public.inspection_results(org_id, id) ON DELETE CASCADE;


--
-- Name: inspection_results inspection_results_org_close_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_results
    ADD CONSTRAINT inspection_results_org_close_fk FOREIGN KEY (org_id, close_appointment_id) REFERENCES public.close_appointments(org_id, id) ON DELETE SET NULL;


--
-- Name: inspection_results inspection_results_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_results
    ADD CONSTRAINT inspection_results_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: inspection_results inspection_results_org_opportunity_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_results
    ADD CONSTRAINT inspection_results_org_opportunity_fk FOREIGN KEY (org_id, opportunity_id) REFERENCES public.opportunities(org_id, id) ON DELETE CASCADE;


--
-- Name: inspection_results inspection_results_submitted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_results
    ADD CONSTRAINT inspection_results_submitted_by_user_id_fkey FOREIGN KEY (submitted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inspection_status_updates inspection_status_updates_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_status_updates
    ADD CONSTRAINT inspection_status_updates_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.scheduled_appointments(id) ON DELETE CASCADE;


--
-- Name: inspection_status_updates inspection_status_updates_closer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_status_updates
    ADD CONSTRAINT inspection_status_updates_closer_user_id_fkey FOREIGN KEY (closer_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inspection_status_updates inspection_status_updates_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_status_updates
    ADD CONSTRAINT inspection_status_updates_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: inspection_status_updates inspection_status_updates_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_status_updates
    ADD CONSTRAINT inspection_status_updates_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: inspection_status_updates inspection_status_updates_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_status_updates
    ADD CONSTRAINT inspection_status_updates_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: inspection_status_updates inspection_status_updates_setter_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_status_updates
    ADD CONSTRAINT inspection_status_updates_setter_user_id_fkey FOREIGN KEY (setter_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: instant_estimate_checks instant_estimate_checks_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instant_estimate_checks
    ADD CONSTRAINT instant_estimate_checks_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: instant_estimate_checks instant_estimate_checks_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instant_estimate_checks
    ADD CONSTRAINT instant_estimate_checks_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: instant_estimate_checks instant_estimate_checks_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instant_estimate_checks
    ADD CONSTRAINT instant_estimate_checks_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: instant_estimate_checks instant_estimate_checks_production_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instant_estimate_checks
    ADD CONSTRAINT instant_estimate_checks_production_job_id_fkey FOREIGN KEY (production_job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: integration_configs integration_configs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_configs
    ADD CONSTRAINT integration_configs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: integration_outbox integration_outbox_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_outbox
    ADD CONSTRAINT integration_outbox_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: invoice_payments invoice_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: invoice_payments invoice_payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.job_invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_payments invoice_payments_job_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_job_payment_id_fkey FOREIGN KEY (job_payment_id) REFERENCES public.job_payments(id) ON DELETE RESTRICT;


--
-- Name: job_additional_scope job_additional_scope_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_additional_scope
    ADD CONSTRAINT job_additional_scope_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_additional_scope job_additional_scope_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_additional_scope
    ADD CONSTRAINT job_additional_scope_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: job_additional_scope job_additional_scope_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_additional_scope
    ADD CONSTRAINT job_additional_scope_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_change_orders job_change_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_change_orders
    ADD CONSTRAINT job_change_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_change_orders job_change_orders_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_change_orders
    ADD CONSTRAINT job_change_orders_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: job_change_orders job_change_orders_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_change_orders
    ADD CONSTRAINT job_change_orders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_change_orders job_change_orders_original_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_change_orders
    ADD CONSTRAINT job_change_orders_original_contract_id_fkey FOREIGN KEY (original_contract_id) REFERENCES public.order_form_contracts(id) ON DELETE SET NULL;


--
-- Name: job_change_orders job_change_orders_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_change_orders
    ADD CONSTRAINT job_change_orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: job_checkups job_checkups_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_checkups
    ADD CONSTRAINT job_checkups_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_checkups job_checkups_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_checkups
    ADD CONSTRAINT job_checkups_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: job_checkups job_checkups_done_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_checkups
    ADD CONSTRAINT job_checkups_done_by_fkey FOREIGN KEY (done_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_checkups job_checkups_last_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_checkups
    ADD CONSTRAINT job_checkups_last_activity_id_fkey FOREIGN KEY (last_activity_id) REFERENCES public.activities(id) ON DELETE SET NULL;


--
-- Name: job_checkups job_checkups_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_checkups
    ADD CONSTRAINT job_checkups_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: job_checkups job_checkups_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_checkups
    ADD CONSTRAINT job_checkups_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);


--
-- Name: job_checkups job_checkups_production_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_checkups
    ADD CONSTRAINT job_checkups_production_job_id_fkey FOREIGN KEY (production_job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: job_checkups job_checkups_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_checkups
    ADD CONSTRAINT job_checkups_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_cost_lines job_cost_lines_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_lines
    ADD CONSTRAINT job_cost_lines_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_cost_lines job_cost_lines_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_lines
    ADD CONSTRAINT job_cost_lines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_cost_lines job_cost_lines_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_lines
    ADD CONSTRAINT job_cost_lines_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_cost_lines job_cost_lines_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_lines
    ADD CONSTRAINT job_cost_lines_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: job_cost_lines job_cost_lines_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_lines
    ADD CONSTRAINT job_cost_lines_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_cost_lines job_cost_lines_source_product_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_lines
    ADD CONSTRAINT job_cost_lines_source_product_order_id_fkey FOREIGN KEY (source_product_order_id) REFERENCES public.job_product_orders(id) ON DELETE SET NULL;


--
-- Name: job_cost_lines job_cost_lines_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_lines
    ADD CONSTRAINT job_cost_lines_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: job_cost_order_migration_log job_cost_order_migration_log_cost_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_order_migration_log
    ADD CONSTRAINT job_cost_order_migration_log_cost_line_id_fkey FOREIGN KEY (cost_line_id) REFERENCES public.job_cost_lines(id) ON DELETE SET NULL;


--
-- Name: job_cost_order_migration_log job_cost_order_migration_log_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_order_migration_log
    ADD CONSTRAINT job_cost_order_migration_log_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: job_cost_order_migration_log job_cost_order_migration_log_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cost_order_migration_log
    ADD CONSTRAINT job_cost_order_migration_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_files job_files_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_files
    ADD CONSTRAINT job_files_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_files job_files_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_files
    ADD CONSTRAINT job_files_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


--
-- Name: job_files job_files_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_files
    ADD CONSTRAINT job_files_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_files job_files_signed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_files
    ADD CONSTRAINT job_files_signed_by_fkey FOREIGN KEY (signed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_invoice_items job_invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_invoice_items
    ADD CONSTRAINT job_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.job_invoices(id) ON DELETE CASCADE;


--
-- Name: job_invoices job_invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_invoices
    ADD CONSTRAINT job_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: job_invoices job_invoices_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_invoices
    ADD CONSTRAINT job_invoices_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: job_material_order_overrides job_material_order_overrides_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_material_order_overrides
    ADD CONSTRAINT job_material_order_overrides_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: job_material_order_overrides job_material_order_overrides_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_material_order_overrides
    ADD CONSTRAINT job_material_order_overrides_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_material_order_overrides job_material_order_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_material_order_overrides
    ADD CONSTRAINT job_material_order_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_material_order_overrides job_material_order_overrides_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_material_order_overrides
    ADD CONSTRAINT job_material_order_overrides_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: job_measure_elevations job_measure_elevations_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_elevations
    ADD CONSTRAINT job_measure_elevations_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: job_measure_elevations job_measure_elevations_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_elevations
    ADD CONSTRAINT job_measure_elevations_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: job_measure_elevations job_measure_elevations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_elevations
    ADD CONSTRAINT job_measure_elevations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_measure_elevations job_measure_elevations_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_elevations
    ADD CONSTRAINT job_measure_elevations_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.job_measure_reports(id) ON DELETE CASCADE;


--
-- Name: job_measure_openings job_measure_openings_elevation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_openings
    ADD CONSTRAINT job_measure_openings_elevation_id_fkey FOREIGN KEY (elevation_id) REFERENCES public.job_measure_elevations(id) ON DELETE CASCADE;


--
-- Name: job_measure_openings job_measure_openings_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_openings
    ADD CONSTRAINT job_measure_openings_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: job_measure_openings job_measure_openings_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_openings
    ADD CONSTRAINT job_measure_openings_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: job_measure_openings job_measure_openings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_openings
    ADD CONSTRAINT job_measure_openings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_measure_openings job_measure_openings_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_openings
    ADD CONSTRAINT job_measure_openings_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.job_measure_reports(id) ON DELETE CASCADE;


--
-- Name: job_measure_photos job_measure_photos_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_photos
    ADD CONSTRAINT job_measure_photos_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_measure_photos job_measure_photos_elevation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_photos
    ADD CONSTRAINT job_measure_photos_elevation_id_fkey FOREIGN KEY (elevation_id) REFERENCES public.job_measure_elevations(id) ON DELETE SET NULL;


--
-- Name: job_measure_photos job_measure_photos_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_photos
    ADD CONSTRAINT job_measure_photos_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: job_measure_photos job_measure_photos_opening_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_photos
    ADD CONSTRAINT job_measure_photos_opening_id_fkey FOREIGN KEY (opening_id) REFERENCES public.job_measure_openings(id) ON DELETE SET NULL;


--
-- Name: job_measure_photos job_measure_photos_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_photos
    ADD CONSTRAINT job_measure_photos_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: job_measure_photos job_measure_photos_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_photos
    ADD CONSTRAINT job_measure_photos_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_measure_photos job_measure_photos_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_photos
    ADD CONSTRAINT job_measure_photos_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.job_measure_reports(id) ON DELETE CASCADE;


--
-- Name: job_measure_reports job_measure_reports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_reports
    ADD CONSTRAINT job_measure_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_measure_reports job_measure_reports_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_reports
    ADD CONSTRAINT job_measure_reports_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: job_measure_reports job_measure_reports_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_reports
    ADD CONSTRAINT job_measure_reports_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: job_measure_reports job_measure_reports_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_reports
    ADD CONSTRAINT job_measure_reports_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_measure_reports job_measure_reports_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_measure_reports
    ADD CONSTRAINT job_measure_reports_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_payments job_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_payments
    ADD CONSTRAINT job_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: job_payments job_payments_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_payments
    ADD CONSTRAINT job_payments_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: job_payroll_state job_payroll_state_current_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_payroll_state
    ADD CONSTRAINT job_payroll_state_current_payroll_period_id_fkey FOREIGN KEY (current_payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE SET NULL;


--
-- Name: job_payroll_state job_payroll_state_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_payroll_state
    ADD CONSTRAINT job_payroll_state_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: job_payroll_state job_payroll_state_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_payroll_state
    ADD CONSTRAINT job_payroll_state_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_product_orders job_product_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_product_orders
    ADD CONSTRAINT job_product_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_product_orders job_product_orders_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_product_orders
    ADD CONSTRAINT job_product_orders_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: job_product_orders job_product_orders_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_product_orders
    ADD CONSTRAINT job_product_orders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_run_sheet_overrides job_run_sheet_overrides_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_run_sheet_overrides
    ADD CONSTRAINT job_run_sheet_overrides_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: job_run_sheet_overrides job_run_sheet_overrides_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_run_sheet_overrides
    ADD CONSTRAINT job_run_sheet_overrides_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_run_sheet_overrides job_run_sheet_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_run_sheet_overrides
    ADD CONSTRAINT job_run_sheet_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_trade_material_sources job_trade_material_sources_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_trade_material_sources
    ADD CONSTRAINT job_trade_material_sources_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: job_trade_material_sources job_trade_material_sources_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_trade_material_sources
    ADD CONSTRAINT job_trade_material_sources_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: job_trade_material_sources job_trade_material_sources_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_trade_material_sources
    ADD CONSTRAINT job_trade_material_sources_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_trade_material_sources job_trade_material_sources_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_trade_material_sources
    ADD CONSTRAINT job_trade_material_sources_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: projects jobs_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT jobs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: jobs jobs_customer_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_customer_id_fkey1 FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: projects jobs_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT jobs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: jobs jobs_lead_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_lead_id_fkey1 FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: projects jobs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: jobs jobs_org_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_org_id_fkey1 FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: projects jobs_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT jobs_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: jobs jobs_owner_user_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_owner_user_id_fkey1 FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lead_sources lead_sources_auto_assign_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_sources
    ADD CONSTRAINT lead_sources_auto_assign_team_id_fkey FOREIGN KEY (auto_assign_team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: lead_sources lead_sources_auto_assign_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_sources
    ADD CONSTRAINT lead_sources_auto_assign_user_id_fkey FOREIGN KEY (auto_assign_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lead_sources lead_sources_default_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_sources
    ADD CONSTRAINT lead_sources_default_campaign_id_fkey FOREIGN KEY (default_campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: lead_sources lead_sources_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_sources
    ADD CONSTRAINT lead_sources_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: leads leads_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: leads leads_closer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_closer_user_id_fkey FOREIGN KEY (closer_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: leads leads_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: leads leads_lead_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_lead_source_id_fkey FOREIGN KEY (lead_source_id) REFERENCES public.lead_sources(id) ON DELETE SET NULL;


--
-- Name: leads leads_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: leads leads_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: management_comp_overlay_plan_versions management_overlay_version_creator_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.management_comp_overlay_plan_versions
    ADD CONSTRAINT management_overlay_version_creator_org_fkey FOREIGN KEY (org_id, created_by_user_id) REFERENCES public.users(org_id, id) ON DELETE RESTRICT;


--
-- Name: management_comp_overlay_plan_versions management_overlay_version_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.management_comp_overlay_plan_versions
    ADD CONSTRAINT management_overlay_version_org_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE RESTRICT;


--
-- Name: management_comp_overlay_plan_versions management_overlay_version_plan_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.management_comp_overlay_plan_versions
    ADD CONSTRAINT management_overlay_version_plan_org_fkey FOREIGN KEY (org_id, comp_plan_id) REFERENCES public.comp_plans(org_id, id) ON DELETE RESTRICT;


--
-- Name: material_orders material_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_orders
    ADD CONSTRAINT material_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: material_orders material_orders_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_orders
    ADD CONSTRAINT material_orders_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: material_orders material_orders_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_orders
    ADD CONSTRAINT material_orders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: measurement_requests measurement_requests_measurement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_requests
    ADD CONSTRAINT measurement_requests_measurement_id_fkey FOREIGN KEY (measurement_id) REFERENCES public.roof_measurements(id) ON DELETE SET NULL;


--
-- Name: measurement_requests measurement_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_requests
    ADD CONSTRAINT measurement_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: measurement_requests measurement_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurement_requests
    ADD CONSTRAINT measurement_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: mobile_device_tokens mobile_device_tokens_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_device_tokens
    ADD CONSTRAINT mobile_device_tokens_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: mobile_device_tokens mobile_device_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_device_tokens
    ADD CONSTRAINT mobile_device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: opportunities opportunities_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: opportunities opportunities_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: opportunities opportunities_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: opportunities opportunities_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: opportunities opportunities_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: opportunities opportunities_referral_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES public.referral_partners(id) ON DELETE SET NULL;


--
-- Name: order_form_contracts order_form_contracts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_form_contracts
    ADD CONSTRAINT order_form_contracts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: order_form_contracts order_form_contracts_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_form_contracts
    ADD CONSTRAINT order_form_contracts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: order_form_contracts order_form_contracts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_form_contracts
    ADD CONSTRAINT order_form_contracts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: order_form_contracts order_form_contracts_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_form_contracts
    ADD CONSTRAINT order_form_contracts_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE SET NULL;


--
-- Name: org_default_comp_plans org_default_comp_plans_comp_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_default_comp_plans
    ADD CONSTRAINT org_default_comp_plans_comp_plan_id_fkey FOREIGN KEY (comp_plan_id) REFERENCES public.comp_plans(id) ON DELETE RESTRICT;


--
-- Name: org_default_comp_plans org_default_comp_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_default_comp_plans
    ADD CONSTRAINT org_default_comp_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: org_default_comp_plans org_default_comp_plans_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_default_comp_plans
    ADD CONSTRAINT org_default_comp_plans_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: org_derived_commission_rates org_derived_commission_rates_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_derived_commission_rates
    ADD CONSTRAINT org_derived_commission_rates_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: org_derived_commission_rates org_derived_commission_rates_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_derived_commission_rates
    ADD CONSTRAINT org_derived_commission_rates_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: org_monthly_goal_audit org_monthly_goal_audit_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_monthly_goal_audit
    ADD CONSTRAINT org_monthly_goal_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: org_monthly_goal_audit org_monthly_goal_audit_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_monthly_goal_audit
    ADD CONSTRAINT org_monthly_goal_audit_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.org_monthly_goals(id) ON DELETE CASCADE;


--
-- Name: org_monthly_goal_audit org_monthly_goal_audit_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_monthly_goal_audit
    ADD CONSTRAINT org_monthly_goal_audit_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: org_monthly_goals org_monthly_goals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_monthly_goals
    ADD CONSTRAINT org_monthly_goals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: org_monthly_goals org_monthly_goals_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_monthly_goals
    ADD CONSTRAINT org_monthly_goals_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: org_trade_material_defaults org_trade_material_defaults_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_trade_material_defaults
    ADD CONSTRAINT org_trade_material_defaults_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: org_trade_material_defaults org_trade_material_defaults_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_trade_material_defaults
    ADD CONSTRAINT org_trade_material_defaults_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: org_trades org_trades_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_trades
    ADD CONSTRAINT org_trades_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: org_trades org_trades_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_trades
    ADD CONSTRAINT org_trades_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: orgs orgs_install_scheduling_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_install_scheduling_user_id_fkey FOREIGN KEY (install_scheduling_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_adjustments payroll_adjustments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_adjustments
    ADD CONSTRAINT payroll_adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_adjustments payroll_adjustments_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_adjustments
    ADD CONSTRAINT payroll_adjustments_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: payroll_adjustments payroll_adjustments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_adjustments
    ADD CONSTRAINT payroll_adjustments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_adjustments payroll_adjustments_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_adjustments
    ADD CONSTRAINT payroll_adjustments_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE RESTRICT;


--
-- Name: payroll_adjustments payroll_adjustments_source_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_adjustments
    ADD CONSTRAINT payroll_adjustments_source_period_id_fkey FOREIGN KEY (source_period_id) REFERENCES public.payroll_periods(id) ON DELETE SET NULL;


--
-- Name: payroll_adjustments payroll_adjustments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_adjustments
    ADD CONSTRAINT payroll_adjustments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: payroll_bonus_lines payroll_bonus_lines_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_bonus_lines
    ADD CONSTRAINT payroll_bonus_lines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_bonus_lines payroll_bonus_lines_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_bonus_lines
    ADD CONSTRAINT payroll_bonus_lines_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_bonus_lines payroll_bonus_lines_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_bonus_lines
    ADD CONSTRAINT payroll_bonus_lines_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE CASCADE;


--
-- Name: payroll_bonus_lines payroll_bonus_lines_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_bonus_lines
    ADD CONSTRAINT payroll_bonus_lines_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_bonus_lines payroll_bonus_lines_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_bonus_lines
    ADD CONSTRAINT payroll_bonus_lines_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_chargeback_applications payroll_chargeback_applications_chargeback_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_chargeback_applications
    ADD CONSTRAINT payroll_chargeback_applications_chargeback_id_fkey FOREIGN KEY (chargeback_id) REFERENCES public.payroll_chargebacks(id) ON DELETE CASCADE;


--
-- Name: payroll_chargeback_applications payroll_chargeback_applications_payout_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_chargeback_applications
    ADD CONSTRAINT payroll_chargeback_applications_payout_line_id_fkey FOREIGN KEY (payout_line_id) REFERENCES public.payroll_payout_lines(id) ON DELETE CASCADE;


--
-- Name: payroll_chargeback_applications payroll_chargeback_applications_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_chargeback_applications
    ADD CONSTRAINT payroll_chargeback_applications_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE CASCADE;


--
-- Name: payroll_chargebacks payroll_chargebacks_apply_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_chargebacks
    ADD CONSTRAINT payroll_chargebacks_apply_period_id_fkey FOREIGN KEY (apply_period_id) REFERENCES public.payroll_periods(id) ON DELETE SET NULL;


--
-- Name: payroll_chargebacks payroll_chargebacks_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_chargebacks
    ADD CONSTRAINT payroll_chargebacks_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_chargebacks payroll_chargebacks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_chargebacks
    ADD CONSTRAINT payroll_chargebacks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_chargebacks payroll_chargebacks_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_chargebacks
    ADD CONSTRAINT payroll_chargebacks_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: payroll_chargebacks payroll_chargebacks_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_chargebacks
    ADD CONSTRAINT payroll_chargebacks_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_chargebacks payroll_chargebacks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_chargebacks
    ADD CONSTRAINT payroll_chargebacks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_disputes payroll_disputes_adjustment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_disputes
    ADD CONSTRAINT payroll_disputes_adjustment_id_fkey FOREIGN KEY (adjustment_id) REFERENCES public.payroll_adjustments(id) ON DELETE SET NULL;


--
-- Name: payroll_disputes payroll_disputes_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_disputes
    ADD CONSTRAINT payroll_disputes_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: payroll_disputes payroll_disputes_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_disputes
    ADD CONSTRAINT payroll_disputes_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_disputes payroll_disputes_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_disputes
    ADD CONSTRAINT payroll_disputes_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE SET NULL;


--
-- Name: payroll_disputes payroll_disputes_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_disputes
    ADD CONSTRAINT payroll_disputes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_disputes payroll_disputes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_disputes
    ADD CONSTRAINT payroll_disputes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_job_snapshots payroll_job_snapshots_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_job_snapshots
    ADD CONSTRAINT payroll_job_snapshots_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: payroll_job_snapshots payroll_job_snapshots_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_job_snapshots
    ADD CONSTRAINT payroll_job_snapshots_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_job_snapshots payroll_job_snapshots_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_job_snapshots
    ADD CONSTRAINT payroll_job_snapshots_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE CASCADE;


--
-- Name: payroll_job_snapshots payroll_job_snapshots_payroll_period_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_job_snapshots
    ADD CONSTRAINT payroll_job_snapshots_payroll_period_snapshot_id_fkey FOREIGN KEY (payroll_period_snapshot_id) REFERENCES public.payroll_period_snapshots(id) ON DELETE CASCADE;


--
-- Name: payroll_override_audit payroll_override_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_override_audit
    ADD CONSTRAINT payroll_override_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_override_audit payroll_override_audit_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_override_audit
    ADD CONSTRAINT payroll_override_audit_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: payroll_override_audit payroll_override_audit_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_override_audit
    ADD CONSTRAINT payroll_override_audit_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_override_audit payroll_override_audit_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_override_audit
    ADD CONSTRAINT payroll_override_audit_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE SET NULL;


--
-- Name: payroll_payout_lines payroll_payout_lines_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payout_lines
    ADD CONSTRAINT payroll_payout_lines_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: payroll_payout_lines payroll_payout_lines_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payout_lines
    ADD CONSTRAINT payroll_payout_lines_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_payout_lines payroll_payout_lines_payroll_job_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payout_lines
    ADD CONSTRAINT payroll_payout_lines_payroll_job_snapshot_id_fkey FOREIGN KEY (payroll_job_snapshot_id) REFERENCES public.payroll_job_snapshots(id) ON DELETE CASCADE;


--
-- Name: payroll_payout_lines payroll_payout_lines_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payout_lines
    ADD CONSTRAINT payroll_payout_lines_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE CASCADE;


--
-- Name: payroll_payout_lines payroll_payout_lines_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_payout_lines
    ADD CONSTRAINT payroll_payout_lines_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_period_snapshots payroll_period_snapshots_locked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_period_snapshots
    ADD CONSTRAINT payroll_period_snapshots_locked_by_fkey FOREIGN KEY (locked_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payroll_period_snapshots payroll_period_snapshots_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_period_snapshots
    ADD CONSTRAINT payroll_period_snapshots_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_period_snapshots payroll_period_snapshots_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_period_snapshots
    ADD CONSTRAINT payroll_period_snapshots_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE CASCADE;


--
-- Name: payroll_periods payroll_periods_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_periods
    ADD CONSTRAINT payroll_periods_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_rep_hours_audit payroll_rep_hours_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_rep_hours_audit
    ADD CONSTRAINT payroll_rep_hours_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_rep_hours_audit payroll_rep_hours_audit_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_rep_hours_audit
    ADD CONSTRAINT payroll_rep_hours_audit_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_rep_hours_audit payroll_rep_hours_audit_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_rep_hours_audit
    ADD CONSTRAINT payroll_rep_hours_audit_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE CASCADE;


--
-- Name: payroll_rep_hours_audit payroll_rep_hours_audit_rep_hours_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_rep_hours_audit
    ADD CONSTRAINT payroll_rep_hours_audit_rep_hours_id_fkey FOREIGN KEY (rep_hours_id) REFERENCES public.payroll_rep_hours(id) ON DELETE CASCADE;


--
-- Name: payroll_rep_hours_audit payroll_rep_hours_audit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_rep_hours_audit
    ADD CONSTRAINT payroll_rep_hours_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_rep_hours payroll_rep_hours_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_rep_hours
    ADD CONSTRAINT payroll_rep_hours_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_rep_hours payroll_rep_hours_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_rep_hours
    ADD CONSTRAINT payroll_rep_hours_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE CASCADE;


--
-- Name: payroll_rep_hours payroll_rep_hours_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_rep_hours
    ADD CONSTRAINT payroll_rep_hours_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_statement_deliveries payroll_statement_deliveries_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_statement_deliveries
    ADD CONSTRAINT payroll_statement_deliveries_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: payroll_statement_deliveries payroll_statement_deliveries_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_statement_deliveries
    ADD CONSTRAINT payroll_statement_deliveries_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_statement_deliveries payroll_statement_deliveries_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_statement_deliveries
    ADD CONSTRAINT payroll_statement_deliveries_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE CASCADE;


--
-- Name: payroll_statement_deliveries payroll_statement_deliveries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_statement_deliveries
    ADD CONSTRAINT payroll_statement_deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payroll_unit_earnings payroll_unit_earnings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_unit_earnings
    ADD CONSTRAINT payroll_unit_earnings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: payroll_unit_earnings payroll_unit_earnings_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_unit_earnings
    ADD CONSTRAINT payroll_unit_earnings_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE RESTRICT;


--
-- Name: payroll_unit_earnings payroll_unit_earnings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_unit_earnings
    ADD CONSTRAINT payroll_unit_earnings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: pending_status_prompts pending_status_prompts_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_status_prompts
    ADD CONSTRAINT pending_status_prompts_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.scheduled_appointments(id) ON DELETE CASCADE;


--
-- Name: pending_status_prompts pending_status_prompts_closer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_status_prompts
    ADD CONSTRAINT pending_status_prompts_closer_user_id_fkey FOREIGN KEY (closer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pending_status_prompts pending_status_prompts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_status_prompts
    ADD CONSTRAINT pending_status_prompts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: permission_audit permission_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_audit
    ADD CONSTRAINT permission_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: permission_audit permission_audit_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_audit
    ADD CONSTRAINT permission_audit_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: permission_audit permission_audit_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_audit
    ADD CONSTRAINT permission_audit_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: permission_denials permission_denials_denied_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_denials
    ADD CONSTRAINT permission_denials_denied_by_fkey FOREIGN KEY (denied_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: permission_denials permission_denials_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_denials
    ADD CONSTRAINT permission_denials_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: permission_denials permission_denials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_denials
    ADD CONSTRAINT permission_denials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: permission_presets permission_presets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_presets
    ADD CONSTRAINT permission_presets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: permission_presets permission_presets_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_presets
    ADD CONSTRAINT permission_presets_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: photos photos_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: photos photos_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: photos photos_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: photos photos_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: photos photos_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id) ON DELETE SET NULL;


--
-- Name: preset_permissions preset_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_permissions
    ADD CONSTRAINT preset_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: preset_permissions preset_permissions_preset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_permissions
    ADD CONSTRAINT preset_permissions_preset_id_fkey FOREIGN KEY (preset_id) REFERENCES public.permission_presets(id) ON DELETE CASCADE;


--
-- Name: pricebook_items pricebook_items_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricebook_items
    ADD CONSTRAINT pricebook_items_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: pricebook_items pricebook_items_pricebook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricebook_items
    ADD CONSTRAINT pricebook_items_pricebook_id_fkey FOREIGN KEY (pricebook_id) REFERENCES public.pricebooks(id) ON DELETE CASCADE;


--
-- Name: pricebooks pricebooks_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricebooks
    ADD CONSTRAINT pricebooks_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: primary_comp_plan_assignment_cancellations primary_comp_plan_assignment_c_org_id_cancelled_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.primary_comp_plan_assignment_cancellations
    ADD CONSTRAINT primary_comp_plan_assignment_c_org_id_cancelled_by_user_id_fkey FOREIGN KEY (org_id, cancelled_by_user_id) REFERENCES public.users(org_id, id) ON DELETE RESTRICT;


--
-- Name: primary_comp_plan_assignment_cancellations primary_comp_plan_assignment_cancellations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.primary_comp_plan_assignment_cancellations
    ADD CONSTRAINT primary_comp_plan_assignment_cancellations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE RESTRICT;


--
-- Name: production_job_notes production_job_notes_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_job_notes
    ADD CONSTRAINT production_job_notes_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: production_job_notes production_job_notes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_job_notes
    ADD CONSTRAINT production_job_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: production_jobs production_jobs_accepted_estimate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_accepted_estimate_id_fkey FOREIGN KEY (accepted_estimate_id) REFERENCES public.estimates(id) ON DELETE SET NULL;


--
-- Name: production_jobs production_jobs_accepted_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_accepted_proposal_id_fkey FOREIGN KEY (accepted_proposal_id) REFERENCES public.proposals(id) ON DELETE SET NULL;


--
-- Name: production_jobs production_jobs_assigned_crew_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_assigned_crew_id_fkey FOREIGN KEY (assigned_crew_id) REFERENCES public.crews(id) ON DELETE SET NULL;


--
-- Name: production_jobs production_jobs_assigned_sub_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_assigned_sub_id_fkey FOREIGN KEY (assigned_sub_id) REFERENCES public.sub_contractors(id) ON DELETE SET NULL;


--
-- Name: production_jobs production_jobs_cancelled_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_cancelled_by_user_id_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: production_jobs production_jobs_close_balance_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_close_balance_by_fkey FOREIGN KEY (close_balance_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: production_jobs production_jobs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: production_jobs production_jobs_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: production_jobs production_jobs_financing_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_financing_program_id_fkey FOREIGN KEY (financing_program_id) REFERENCES public.financing_programs(id) ON DELETE SET NULL;


--
-- Name: production_jobs production_jobs_linked_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_linked_proposal_id_fkey FOREIGN KEY (linked_proposal_id) REFERENCES public.proposals(id) ON DELETE SET NULL;


--
-- Name: production_jobs production_jobs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: production_jobs production_jobs_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: production_jobs production_jobs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: production_jobs production_jobs_salesperson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_salesperson_id_fkey FOREIGN KEY (salesperson_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: program_444_enrollments program_444_enrollments_enrolled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_444_enrollments
    ADD CONSTRAINT program_444_enrollments_enrolled_by_fkey FOREIGN KEY (enrolled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: program_444_enrollments program_444_enrollments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_444_enrollments
    ADD CONSTRAINT program_444_enrollments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: program_444_enrollments program_444_enrollments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_444_enrollments
    ADD CONSTRAINT program_444_enrollments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: program_444_enrollments program_444_enrollments_week1_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_444_enrollments
    ADD CONSTRAINT program_444_enrollments_week1_payroll_period_id_fkey FOREIGN KEY (week1_payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE SET NULL;


--
-- Name: program_444_enrollments program_444_enrollments_week2_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_444_enrollments
    ADD CONSTRAINT program_444_enrollments_week2_payroll_period_id_fkey FOREIGN KEY (week2_payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE SET NULL;


--
-- Name: projects projects_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: proposal_line_items proposal_line_items_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_line_items
    ADD CONSTRAINT proposal_line_items_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: proposal_line_items proposal_line_items_pricebook_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_line_items
    ADD CONSTRAINT proposal_line_items_pricebook_item_id_fkey FOREIGN KEY (pricebook_item_id) REFERENCES public.pricebook_items(id) ON DELETE SET NULL;


--
-- Name: proposal_line_items proposal_line_items_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_line_items
    ADD CONSTRAINT proposal_line_items_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE CASCADE;


--
-- Name: proposal_photos proposal_photos_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_photos
    ADD CONSTRAINT proposal_photos_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: proposal_photos proposal_photos_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_photos
    ADD CONSTRAINT proposal_photos_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE CASCADE;


--
-- Name: proposal_templates proposal_templates_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_templates
    ADD CONSTRAINT proposal_templates_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: proposals proposals_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: proposals proposals_financing_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_financing_program_id_fkey FOREIGN KEY (financing_program_id) REFERENCES public.financing_programs(id) ON DELETE SET NULL;


--
-- Name: proposals proposals_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: proposals proposals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: proposals proposals_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: proposals proposals_roofing_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_roofing_type_id_fkey FOREIGN KEY (roofing_type_id) REFERENCES public.roofing_types(id);


--
-- Name: public_estimate_previews public_estimate_previews_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_estimate_previews
    ADD CONSTRAINT public_estimate_previews_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: public_estimate_unlock_deliveries public_estimate_unlock_deliveries_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_estimate_unlock_deliveries
    ADD CONSTRAINT public_estimate_unlock_deliveries_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: public_estimate_unlock_deliveries public_estimate_unlock_deliveries_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_estimate_unlock_deliveries
    ADD CONSTRAINT public_estimate_unlock_deliveries_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: referral_partner_assignment_log referral_partner_assignment_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partner_assignment_log
    ADD CONSTRAINT referral_partner_assignment_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: referral_partner_assignment_log referral_partner_assignment_log_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partner_assignment_log
    ADD CONSTRAINT referral_partner_assignment_log_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: referral_partner_assignment_log referral_partner_assignment_log_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partner_assignment_log
    ADD CONSTRAINT referral_partner_assignment_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: referral_partner_assignment_log referral_partner_assignment_log_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partner_assignment_log
    ADD CONSTRAINT referral_partner_assignment_log_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.referral_partners(id) ON DELETE CASCADE;


--
-- Name: referral_partner_assignment_log referral_partner_assignment_log_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partner_assignment_log
    ADD CONSTRAINT referral_partner_assignment_log_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: referral_partner_types referral_partner_types_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partner_types
    ADD CONSTRAINT referral_partner_types_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: referral_partners referral_partners_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partners
    ADD CONSTRAINT referral_partners_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: referral_partners referral_partners_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partners
    ADD CONSTRAINT referral_partners_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: referral_partners referral_partners_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partners
    ADD CONSTRAINT referral_partners_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: referral_partners referral_partners_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_partners
    ADD CONSTRAINT referral_partners_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.referral_partner_types(id);


--
-- Name: referrals referrals_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: referrals referrals_install_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_install_verified_by_fkey FOREIGN KEY (install_verified_by) REFERENCES public.users(id);


--
-- Name: referrals referrals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: referrals referrals_paid_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES public.users(id);


--
-- Name: referrals referrals_referred_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_customer_id_fkey FOREIGN KEY (referred_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: referrals referrals_referred_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_lead_id_fkey FOREIGN KEY (referred_lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: referrals referrals_referred_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_opportunity_id_fkey FOREIGN KEY (referred_opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: referrals referrals_referred_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_project_id_fkey FOREIGN KEY (referred_project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: referrals referrals_referrer_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_customer_id_fkey FOREIGN KEY (referrer_customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: regions regions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: report_role_access report_role_access_custom_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_role_access
    ADD CONSTRAINT report_role_access_custom_role_id_fkey FOREIGN KEY (custom_role_id) REFERENCES public.custom_roles(id) ON DELETE CASCADE;


--
-- Name: report_role_access report_role_access_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_role_access
    ADD CONSTRAINT report_role_access_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.custom_reports(id) ON DELETE CASCADE;


--
-- Name: report_schedules report_schedules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_schedules
    ADD CONSTRAINT report_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: report_schedules report_schedules_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_schedules
    ADD CONSTRAINT report_schedules_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: report_schedules report_schedules_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_schedules
    ADD CONSTRAINT report_schedules_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.custom_reports(id) ON DELETE CASCADE;


--
-- Name: review_requests review_requests_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests
    ADD CONSTRAINT review_requests_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: review_requests review_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests
    ADD CONSTRAINT review_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: review_requests review_requests_production_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests
    ADD CONSTRAINT review_requests_production_job_id_fkey FOREIGN KEY (production_job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: review_requests review_requests_salesperson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests
    ADD CONSTRAINT review_requests_salesperson_id_fkey FOREIGN KEY (salesperson_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: review_requests review_requests_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests
    ADD CONSTRAINT review_requests_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.custom_roles(id) ON DELETE CASCADE;


--
-- Name: roof_facets roof_facets_measurement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roof_facets
    ADD CONSTRAINT roof_facets_measurement_id_fkey FOREIGN KEY (measurement_id) REFERENCES public.roof_measurements(id) ON DELETE CASCADE;


--
-- Name: roof_measurements roof_measurements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roof_measurements
    ADD CONSTRAINT roof_measurements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: roof_measurements roof_measurements_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roof_measurements
    ADD CONSTRAINT roof_measurements_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: roof_measurements roof_measurements_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roof_measurements
    ADD CONSTRAINT roof_measurements_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: roof_measurements roof_measurements_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roof_measurements
    ADD CONSTRAINT roof_measurements_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: roof_measurements roof_measurements_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roof_measurements
    ADD CONSTRAINT roof_measurements_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE SET NULL;


--
-- Name: roofing_types roofing_types_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roofing_types
    ADD CONSTRAINT roofing_types_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: saved_report_filters saved_report_filters_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_report_filters
    ADD CONSTRAINT saved_report_filters_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: saved_report_filters saved_report_filters_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_report_filters
    ADD CONSTRAINT saved_report_filters_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.custom_reports(id) ON DELETE CASCADE;


--
-- Name: saved_report_filters saved_report_filters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_report_filters
    ADD CONSTRAINT saved_report_filters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: saved_reports saved_reports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports
    ADD CONSTRAINT saved_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: saved_reports saved_reports_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports
    ADD CONSTRAINT saved_reports_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: scheduled_appointments scheduled_appointments_canvasser_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_appointments
    ADD CONSTRAINT scheduled_appointments_canvasser_user_id_fkey FOREIGN KEY (canvasser_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: scheduled_appointments scheduled_appointments_closer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_appointments
    ADD CONSTRAINT scheduled_appointments_closer_user_id_fkey FOREIGN KEY (closer_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: scheduled_appointments scheduled_appointments_inside_sales_booked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_appointments
    ADD CONSTRAINT scheduled_appointments_inside_sales_booked_by_user_id_fkey FOREIGN KEY (inside_sales_booked_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: scheduled_appointments scheduled_appointments_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_appointments
    ADD CONSTRAINT scheduled_appointments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: scheduled_appointments scheduled_appointments_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_appointments
    ADD CONSTRAINT scheduled_appointments_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: scheduled_appointments scheduled_appointments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_appointments
    ADD CONSTRAINT scheduled_appointments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: scheduled_appointments scheduled_appointments_outcome_not_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_appointments
    ADD CONSTRAINT scheduled_appointments_outcome_not_recorded_by_fkey FOREIGN KEY (outcome_not_recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: setter_ramp_enrollments setter_ramp_enrollments_enrolled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setter_ramp_enrollments
    ADD CONSTRAINT setter_ramp_enrollments_enrolled_by_fkey FOREIGN KEY (enrolled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: setter_ramp_enrollments setter_ramp_enrollments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setter_ramp_enrollments
    ADD CONSTRAINT setter_ramp_enrollments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: setter_ramp_enrollments setter_ramp_enrollments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setter_ramp_enrollments
    ADD CONSTRAINT setter_ramp_enrollments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: setter_ramp_weekly_status setter_ramp_weekly_status_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setter_ramp_weekly_status
    ADD CONSTRAINT setter_ramp_weekly_status_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.setter_ramp_enrollments(id) ON DELETE CASCADE;


--
-- Name: setter_ramp_weekly_status setter_ramp_weekly_status_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setter_ramp_weekly_status
    ADD CONSTRAINT setter_ramp_weekly_status_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: setter_ramp_weekly_status setter_ramp_weekly_status_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setter_ramp_weekly_status
    ADD CONSTRAINT setter_ramp_weekly_status_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE SET NULL;


--
-- Name: setter_ramp_weekly_status setter_ramp_weekly_status_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setter_ramp_weekly_status
    ADD CONSTRAINT setter_ramp_weekly_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: solar_installs solar_installs_installer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solar_installs
    ADD CONSTRAINT solar_installs_installer_id_fkey FOREIGN KEY (installer_id) REFERENCES public.solar_installers(id) ON DELETE SET NULL;


--
-- Name: spiff_achievements spiff_achievements_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spiff_achievements
    ADD CONSTRAINT spiff_achievements_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: spiff_achievements spiff_achievements_spiff_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spiff_achievements
    ADD CONSTRAINT spiff_achievements_spiff_program_id_fkey FOREIGN KEY (spiff_program_id) REFERENCES public.spiff_programs(id) ON DELETE CASCADE;


--
-- Name: spiff_achievements spiff_achievements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spiff_achievements
    ADD CONSTRAINT spiff_achievements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: spiff_programs spiff_programs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spiff_programs
    ADD CONSTRAINT spiff_programs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: spiff_programs spiff_programs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spiff_programs
    ADD CONSTRAINT spiff_programs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: spiff_programs spiff_programs_payroll_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spiff_programs
    ADD CONSTRAINT spiff_programs_payroll_cycle_id_fkey FOREIGN KEY (payroll_cycle_id) REFERENCES public.incentive_cycles(id) ON DELETE SET NULL;


--
-- Name: storm_opportunity_alerts storm_opportunity_alerts_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storm_opportunity_alerts
    ADD CONSTRAINT storm_opportunity_alerts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: storm_opportunity_alerts storm_opportunity_alerts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storm_opportunity_alerts
    ADD CONSTRAINT storm_opportunity_alerts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: sub_contractors sub_contractors_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_contractors
    ADD CONSTRAINT sub_contractors_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: sub_contractors sub_contractors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_contractors
    ADD CONSTRAINT sub_contractors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: supplier_api_approvals supplier_api_approvals_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_approvals
    ADD CONSTRAINT supplier_api_approvals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_api_approvals supplier_api_approvals_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_approvals
    ADD CONSTRAINT supplier_api_approvals_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: supplier_api_approvals supplier_api_approvals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_approvals
    ADD CONSTRAINT supplier_api_approvals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: supplier_api_approvals supplier_api_approvals_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_approvals
    ADD CONSTRAINT supplier_api_approvals_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: supplier_api_approvals supplier_api_approvals_supplier_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_approvals
    ADD CONSTRAINT supplier_api_approvals_supplier_order_id_fkey FOREIGN KEY (supplier_order_id) REFERENCES public.supplier_orders(id) ON DELETE CASCADE;


--
-- Name: supplier_api_approvals supplier_api_approvals_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_approvals
    ADD CONSTRAINT supplier_api_approvals_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: supplier_api_events supplier_api_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_events
    ADD CONSTRAINT supplier_api_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_api_events supplier_api_events_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_events
    ADD CONSTRAINT supplier_api_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: supplier_api_events supplier_api_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_events
    ADD CONSTRAINT supplier_api_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: supplier_api_events supplier_api_events_send_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_events
    ADD CONSTRAINT supplier_api_events_send_id_fkey FOREIGN KEY (send_id) REFERENCES public.supplier_order_sends(id) ON DELETE SET NULL;


--
-- Name: supplier_api_events supplier_api_events_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_events
    ADD CONSTRAINT supplier_api_events_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: supplier_api_settings supplier_api_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_settings
    ADD CONSTRAINT supplier_api_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: supplier_api_settings supplier_api_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_settings
    ADD CONSTRAINT supplier_api_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_api_settings supplier_api_settings_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_api_settings
    ADD CONSTRAINT supplier_api_settings_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: supplier_audit_log supplier_audit_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_audit_log
    ADD CONSTRAINT supplier_audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_audit_log supplier_audit_log_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_audit_log
    ADD CONSTRAINT supplier_audit_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: supplier_audit_log supplier_audit_log_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_audit_log
    ADD CONSTRAINT supplier_audit_log_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: supplier_item_map supplier_item_map_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_item_map
    ADD CONSTRAINT supplier_item_map_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: supplier_item_map supplier_item_map_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_item_map
    ADD CONSTRAINT supplier_item_map_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_item_map supplier_item_map_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_item_map
    ADD CONSTRAINT supplier_item_map_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: supplier_order_send_lines supplier_order_send_lines_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_lines
    ADD CONSTRAINT supplier_order_send_lines_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: supplier_order_send_lines supplier_order_send_lines_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_lines
    ADD CONSTRAINT supplier_order_send_lines_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: supplier_order_send_lines supplier_order_send_lines_send_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_lines
    ADD CONSTRAINT supplier_order_send_lines_send_id_fkey FOREIGN KEY (send_id) REFERENCES public.supplier_order_sends(id) ON DELETE CASCADE;


--
-- Name: supplier_order_send_lines supplier_order_send_lines_supplier_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_lines
    ADD CONSTRAINT supplier_order_send_lines_supplier_order_id_fkey FOREIGN KEY (supplier_order_id) REFERENCES public.supplier_orders(id) ON DELETE CASCADE;


--
-- Name: supplier_order_send_lines supplier_order_send_lines_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_lines
    ADD CONSTRAINT supplier_order_send_lines_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE RESTRICT;


--
-- Name: supplier_order_send_sourcing supplier_order_send_sourcing_installer_sub_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_sourcing
    ADD CONSTRAINT supplier_order_send_sourcing_installer_sub_id_fkey FOREIGN KEY (installer_sub_id) REFERENCES public.sub_contractors(id) ON DELETE SET NULL;


--
-- Name: supplier_order_send_sourcing supplier_order_send_sourcing_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_sourcing
    ADD CONSTRAINT supplier_order_send_sourcing_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: supplier_order_send_sourcing supplier_order_send_sourcing_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_sourcing
    ADD CONSTRAINT supplier_order_send_sourcing_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: supplier_order_send_sourcing supplier_order_send_sourcing_send_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_send_sourcing
    ADD CONSTRAINT supplier_order_send_sourcing_send_id_fkey FOREIGN KEY (send_id) REFERENCES public.supplier_order_sends(id) ON DELETE CASCADE;


--
-- Name: supplier_order_sends supplier_order_sends_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_sends
    ADD CONSTRAINT supplier_order_sends_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: supplier_order_sends supplier_order_sends_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_sends
    ADD CONSTRAINT supplier_order_sends_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: supplier_order_sends supplier_order_sends_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_sends
    ADD CONSTRAINT supplier_order_sends_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_order_sends supplier_order_sends_supplier_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_sends
    ADD CONSTRAINT supplier_order_sends_supplier_order_id_fkey FOREIGN KEY (supplier_order_id) REFERENCES public.supplier_orders(id) ON DELETE CASCADE;


--
-- Name: supplier_order_sends supplier_order_sends_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_order_sends
    ADD CONSTRAINT supplier_order_sends_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE RESTRICT;


--
-- Name: supplier_orders supplier_orders_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_orders
    ADD CONSTRAINT supplier_orders_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_orders supplier_orders_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_orders
    ADD CONSTRAINT supplier_orders_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE;


--
-- Name: supplier_orders supplier_orders_last_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_orders
    ADD CONSTRAINT supplier_orders_last_sent_by_fkey FOREIGN KEY (last_sent_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_orders supplier_orders_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_orders
    ADD CONSTRAINT supplier_orders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: supplier_orders supplier_orders_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_orders
    ADD CONSTRAINT supplier_orders_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: supplier_orders supplier_orders_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_orders
    ADD CONSTRAINT supplier_orders_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE RESTRICT;


--
-- Name: table_views table_views_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_views
    ADD CONSTRAINT table_views_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: table_views table_views_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_views
    ADD CONSTRAINT table_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: team_closer_queue team_closer_queue_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_closer_queue
    ADD CONSTRAINT team_closer_queue_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: team_closer_queue team_closer_queue_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_closer_queue
    ADD CONSTRAINT team_closer_queue_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_closer_queue team_closer_queue_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_closer_queue
    ADD CONSTRAINT team_closer_queue_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: teams teams_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: teams teams_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;


--
-- Name: thread_members thread_members_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_members
    ADD CONSTRAINT thread_members_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: thread_members thread_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_members
    ADD CONSTRAINT thread_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: threads threads_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: threads threads_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: threads threads_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: threads threads_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id);


--
-- Name: user_badges user_badges_awarded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_awarded_by_fkey FOREIGN KEY (awarded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_badges user_badges_badge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_badge_id_fkey FOREIGN KEY (badge_id) REFERENCES public.incentive_badges(id) ON DELETE CASCADE;


--
-- Name: user_badges user_badges_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: user_badges user_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_comp_plans user_comp_plans_comp_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_comp_plans
    ADD CONSTRAINT user_comp_plans_comp_plan_id_fkey FOREIGN KEY (comp_plan_id) REFERENCES public.comp_plans(id) ON DELETE CASCADE;


--
-- Name: user_comp_plans user_comp_plans_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_comp_plans
    ADD CONSTRAINT user_comp_plans_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: user_comp_plans user_comp_plans_replaced_assignment_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_comp_plans
    ADD CONSTRAINT user_comp_plans_replaced_assignment_fkey FOREIGN KEY (org_id, replaced_assignment_id) REFERENCES public.user_comp_plans(org_id, id) ON DELETE RESTRICT;


--
-- Name: user_comp_plans user_comp_plans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_comp_plans
    ADD CONSTRAINT user_comp_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_google_tokens user_google_tokens_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_google_tokens
    ADD CONSTRAINT user_google_tokens_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: user_google_tokens user_google_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_google_tokens
    ADD CONSTRAINT user_google_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_incentive_goals_history user_incentive_goals_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_incentive_goals_history
    ADD CONSTRAINT user_incentive_goals_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_incentive_goals_history user_incentive_goals_history_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_incentive_goals_history
    ADD CONSTRAINT user_incentive_goals_history_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: user_incentive_goals_history user_incentive_goals_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_incentive_goals_history
    ADD CONSTRAINT user_incentive_goals_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_incentive_goals user_incentive_goals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_incentive_goals
    ADD CONSTRAINT user_incentive_goals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: user_incentive_goals user_incentive_goals_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_incentive_goals
    ADD CONSTRAINT user_incentive_goals_set_by_fkey FOREIGN KEY (set_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_incentive_goals user_incentive_goals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_incentive_goals
    ADD CONSTRAINT user_incentive_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_management_comp_overlay_assignments user_management_overlay_cancelled_by_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_management_comp_overlay_assignments
    ADD CONSTRAINT user_management_overlay_cancelled_by_org_fkey FOREIGN KEY (org_id, cancelled_by_user_id) REFERENCES public.users(org_id, id) ON DELETE RESTRICT;


--
-- Name: user_management_comp_overlay_assignments user_management_overlay_creator_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_management_comp_overlay_assignments
    ADD CONSTRAINT user_management_overlay_creator_org_fkey FOREIGN KEY (org_id, created_by_user_id) REFERENCES public.users(org_id, id) ON DELETE RESTRICT;


--
-- Name: user_management_comp_overlay_assignments user_management_overlay_ended_by_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_management_comp_overlay_assignments
    ADD CONSTRAINT user_management_overlay_ended_by_org_fkey FOREIGN KEY (org_id, ended_by_user_id) REFERENCES public.users(org_id, id) ON DELETE RESTRICT;


--
-- Name: user_management_comp_overlay_assignments user_management_overlay_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_management_comp_overlay_assignments
    ADD CONSTRAINT user_management_overlay_org_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE RESTRICT;


--
-- Name: user_management_comp_overlay_assignments user_management_overlay_plan_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_management_comp_overlay_assignments
    ADD CONSTRAINT user_management_overlay_plan_org_fkey FOREIGN KEY (org_id, comp_plan_id) REFERENCES public.comp_plans(org_id, id) ON DELETE RESTRICT;


--
-- Name: user_management_comp_overlay_assignments user_management_overlay_replaced_assignment_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_management_comp_overlay_assignments
    ADD CONSTRAINT user_management_overlay_replaced_assignment_fkey FOREIGN KEY (org_id, replaced_assignment_id) REFERENCES public.user_management_comp_overlay_assignments(org_id, id) ON DELETE RESTRICT;


--
-- Name: user_management_comp_overlay_assignments user_management_overlay_user_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_management_comp_overlay_assignments
    ADD CONSTRAINT user_management_overlay_user_org_fkey FOREIGN KEY (org_id, user_id) REFERENCES public.users(org_id, id) ON DELETE RESTRICT;


--
-- Name: user_manager_assignments user_manager_assignments_manager_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_manager_assignments
    ADD CONSTRAINT user_manager_assignments_manager_user_id_fkey FOREIGN KEY (manager_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: user_manager_assignments user_manager_assignments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_manager_assignments
    ADD CONSTRAINT user_manager_assignments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: user_manager_assignments user_manager_assignments_org_id_manager_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_manager_assignments
    ADD CONSTRAINT user_manager_assignments_org_id_manager_user_id_fkey FOREIGN KEY (org_id, manager_user_id) REFERENCES public.users(org_id, id) ON DELETE RESTRICT;


--
-- Name: user_manager_assignments user_manager_assignments_org_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_manager_assignments
    ADD CONSTRAINT user_manager_assignments_org_id_user_id_fkey FOREIGN KEY (org_id, user_id) REFERENCES public.users(org_id, id) ON DELETE RESTRICT;


--
-- Name: user_manager_assignments user_manager_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_manager_assignments
    ADD CONSTRAINT user_manager_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: user_payroll_active_history user_payroll_active_history_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_payroll_active_history
    ADD CONSTRAINT user_payroll_active_history_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: user_payroll_active_history user_payroll_active_history_org_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_payroll_active_history
    ADD CONSTRAINT user_payroll_active_history_org_id_user_id_fkey FOREIGN KEY (org_id, user_id) REFERENCES public.users(org_id, id) ON DELETE RESTRICT;


--
-- Name: user_payroll_active_history user_payroll_active_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_payroll_active_history
    ADD CONSTRAINT user_payroll_active_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: user_permissions user_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_permissions user_permissions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_custom_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_custom_role_id_fkey FOREIGN KEY (custom_role_id) REFERENCES public.custom_roles(id) ON DELETE SET NULL;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: users users_manager_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_manager_user_id_fkey FOREIGN KEY (manager_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: users users_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: users users_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;


--
-- Name: users users_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: vendors vendors_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vendors vendors_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vendors vendors_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: weather_cache weather_cache_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weather_cache
    ADD CONSTRAINT weather_cache_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE SET NULL;


--
-- Name: weather_swaths weather_swaths_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weather_swaths
    ADD CONSTRAINT weather_swaths_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE SET NULL;


--
-- Name: work_order_comments work_order_comments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_comments
    ADD CONSTRAINT work_order_comments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: work_order_comments work_order_comments_sub_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_comments
    ADD CONSTRAINT work_order_comments_sub_id_fkey FOREIGN KEY (sub_id) REFERENCES public.sub_contractors(id) ON DELETE SET NULL;


--
-- Name: work_order_comments work_order_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_comments
    ADD CONSTRAINT work_order_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: work_order_comments work_order_comments_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_comments
    ADD CONSTRAINT work_order_comments_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id) ON DELETE CASCADE;


--
-- Name: work_order_photos work_order_photos_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_photos
    ADD CONSTRAINT work_order_photos_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: work_order_photos work_order_photos_uploaded_by_sub_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_photos
    ADD CONSTRAINT work_order_photos_uploaded_by_sub_id_fkey FOREIGN KEY (uploaded_by_sub_id) REFERENCES public.sub_contractors(id) ON DELETE SET NULL;


--
-- Name: work_order_photos work_order_photos_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_photos
    ADD CONSTRAINT work_order_photos_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: work_order_photos work_order_photos_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_photos
    ADD CONSTRAINT work_order_photos_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id) ON DELETE CASCADE;


--
-- Name: work_order_status_history work_order_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_status_history
    ADD CONSTRAINT work_order_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: work_order_status_history work_order_status_history_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_status_history
    ADD CONSTRAINT work_order_status_history_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id) ON DELETE CASCADE;


--
-- Name: work_orders work_orders_assigned_sub_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_assigned_sub_id_fkey FOREIGN KEY (assigned_sub_id) REFERENCES public.sub_contractors(id) ON DELETE SET NULL;


--
-- Name: work_orders work_orders_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: work_orders work_orders_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id);


--
-- Name: work_orders work_orders_completed_by_sub_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_completed_by_sub_id_fkey FOREIGN KEY (completed_by_sub_id) REFERENCES public.sub_contractors(id) ON DELETE SET NULL;


--
-- Name: work_orders work_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: work_orders work_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: work_orders work_orders_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL;


--
-- Name: work_orders work_orders_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: work_orders work_orders_org_trade_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_org_trade_fkey FOREIGN KEY (org_id, trade) REFERENCES public.org_trades(org_id, slug);


--
-- Name: work_orders work_orders_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: crews Admins and managers can manage crews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and managers can manage crews" ON public.crews USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = ANY (ARRAY['admin'::text, 'manager'::text]))))));


--
-- Name: dashboard_settings Admins and managers can manage dashboard settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and managers can manage dashboard settings" ON public.dashboard_settings USING (((org_id = public.get_user_org_id(auth.uid())) AND (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::public.user_role, 'regional_manager'::public.user_role, 'sales_manager'::public.user_role])))))));


--
-- Name: material_orders Admins and managers can manage material orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and managers can manage material orders" ON public.material_orders USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = ANY (ARRAY['admin'::text, 'manager'::text]))))));


--
-- Name: production_jobs Admins and managers can manage production jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and managers can manage production jobs" ON public.production_jobs USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = ANY (ARRAY['admin'::text, 'manager'::text]))))));


--
-- Name: regions Admins and managers can manage regions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and managers can manage regions" ON public.regions USING (((org_id = public.get_user_org_id(auth.uid())) AND (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::public.user_role, 'regional_manager'::public.user_role, 'sales_manager'::public.user_role])))))));


--
-- Name: sub_contractors Admins and managers can manage sub_contractors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and managers can manage sub_contractors" ON public.sub_contractors USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = ANY (ARRAY['admin'::text, 'manager'::text]))))));


--
-- Name: teams Admins and managers can manage teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and managers can manage teams" ON public.teams USING (((org_id = public.get_user_org_id(auth.uid())) AND (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::public.user_role, 'regional_manager'::public.user_role, 'sales_manager'::public.user_role])))))));


--
-- Name: job_files Admins can delete job files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete job files" ON public.job_files FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: job_payments Admins can delete job payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete job payments" ON public.job_payments FOR DELETE USING (((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_payments.job_id) AND (pj.org_id = public.get_user_org_id(auth.uid()))))) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: job_product_orders Admins can delete product orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete product orders" ON public.job_product_orders FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.org_id = job_product_orders.org_id) AND (u.role = 'admin'::public.user_role)))));


--
-- Name: adder_categories Admins can manage adder categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage adder categories" ON public.adder_categories USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old]))));


--
-- Name: campaigns Admins can manage campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage campaigns" ON public.campaigns USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old]))));


--
-- Name: commissions Admins can manage commissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage commissions" ON public.commissions USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old]))));


--
-- Name: financing_programs Admins can manage financing programs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage financing programs" ON public.financing_programs USING (((org_id = ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))) AND (( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())) = ANY (ARRAY['admin'::public.user_role, 'operations'::public.user_role, 'owner'::public.user_role])))) WITH CHECK (((org_id = ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))) AND (( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())) = ANY (ARRAY['admin'::public.user_role, 'operations'::public.user_role, 'owner'::public.user_role]))));


--
-- Name: inbound_lead_queue Admins can manage inbound queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage inbound queue" ON public.inbound_lead_queue USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old]))));


--
-- Name: integration_configs Admins can manage integration configs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage integration configs" ON public.integration_configs USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old]))));


--
-- Name: lead_sources Admins can manage lead sources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage lead sources" ON public.lead_sources USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old]))));


--
-- Name: org_monthly_goals Admins can manage monthly goals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage monthly goals" ON public.org_monthly_goals USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'owner'::public.user_role_old]))));


--
-- Name: permission_presets Admins can manage permission presets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage permission presets" ON public.permission_presets USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old]))));


--
-- Name: preset_permissions Admins can manage preset permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage preset permissions" ON public.preset_permissions USING (((EXISTS ( SELECT 1
   FROM public.permission_presets pp
  WHERE ((pp.id = preset_permissions.preset_id) AND (pp.org_id = public.get_user_org_id(auth.uid()))))) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old]))));


--
-- Name: proposal_templates Admins can manage proposal templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage proposal templates" ON public.proposal_templates USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old]))));


--
-- Name: referrals Admins can manage referrals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage referrals" ON public.referrals USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old, 'sales_manager'::public.user_role_old, 'operations'::public.user_role_old]))));


--
-- Name: role_permissions Admins can manage role permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage role permissions" ON public.role_permissions USING (((EXISTS ( SELECT 1
   FROM public.custom_roles cr
  WHERE ((cr.id = role_permissions.role_id) AND (cr.org_id = public.get_user_org_id(auth.uid()))))) AND (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role = 'admin'::public.user_role) OR (users.custom_role_id IN ( SELECT cr2.id
           FROM ((public.custom_roles cr2
             JOIN public.role_permissions rp ON ((rp.role_id = cr2.id)))
             JOIN public.permissions p ON ((p.id = rp.permission_id)))
          WHERE (p.name = 'admin:permissions'::text)))))))));


--
-- Name: custom_roles Admins can manage roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage roles" ON public.custom_roles USING (((org_id = public.get_user_org_id(auth.uid())) AND (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role = 'admin'::public.user_role) OR (users.custom_role_id IN ( SELECT cr.id
           FROM ((public.custom_roles cr
             JOIN public.role_permissions rp ON ((rp.role_id = cr.id)))
             JOIN public.permissions p ON ((p.id = rp.permission_id)))
          WHERE (p.name = 'admin:roles'::text)))))))));


--
-- Name: roofing_types Admins can manage roofing types; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage roofing types" ON public.roofing_types USING (((org_id = ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))) AND (( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())) = ANY (ARRAY['admin'::public.user_role, 'operations'::public.user_role]))));


--
-- Name: sub_contractors Admins can manage sub contractors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage sub contractors" ON public.sub_contractors USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old, 'operations'::public.user_role_old]))));


--
-- Name: user_permissions Admins can manage user permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage user permissions" ON public.user_permissions USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old]))));


--
-- Name: lead_sources Admins can view lead sources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view lead sources" ON public.lead_sources FOR SELECT USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old]))));


--
-- Name: org_monthly_goal_audit Admins can view monthly goal audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view monthly goal audit" ON public.org_monthly_goal_audit FOR SELECT USING (((org_id = public.get_user_org_id(auth.uid())) AND (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'owner'::public.user_role_old]))));


--
-- Name: customers Admins/managers can delete customers in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can delete customers in their org" ON public.customers FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: estimates Admins/managers can delete estimates in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can delete estimates in their org" ON public.estimates FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: jobs Admins/managers can delete jobs in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can delete jobs in their org" ON public.jobs FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: projects Admins/managers can delete jobs in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can delete jobs in their org" ON public.projects FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: leads Admins/managers can delete leads in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can delete leads in their org" ON public.leads FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: opportunities Admins/managers can delete opportunities in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can delete opportunities in their org" ON public.opportunities FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: pricebook_items Admins/managers can delete pricebook items in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can delete pricebook items in their org" ON public.pricebook_items FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: pricebooks Admins/managers can delete pricebooks in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can delete pricebooks in their org" ON public.pricebooks FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: pricebook_items Admins/managers can insert pricebook items in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can insert pricebook items in their org" ON public.pricebook_items FOR INSERT WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: pricebooks Admins/managers can insert pricebooks in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can insert pricebooks in their org" ON public.pricebooks FOR INSERT WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: users Admins/managers can insert users in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can insert users in their org" ON public.users FOR INSERT WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: pricebook_items Admins/managers can update pricebook items in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can update pricebook items in their org" ON public.pricebook_items FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: pricebooks Admins/managers can update pricebooks in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can update pricebooks in their org" ON public.pricebooks FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: users Admins/managers can update users in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins/managers can update users in their org" ON public.users FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: order_form_contracts Anon can read contracts by token; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anon can read contracts by token" ON public.order_form_contracts FOR SELECT USING (true);


--
-- Name: order_form_contracts Anon can update contracts by token; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anon can update contracts by token" ON public.order_form_contracts FOR UPDATE USING (true);


--
-- Name: permissions Authenticated users can view permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view permissions" ON public.permissions FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: inspection_status_updates Closers can create their own status updates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Closers can create their own status updates" ON public.inspection_status_updates FOR INSERT WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND (closer_user_id = auth.uid())));


--
-- Name: inspection_status_updates Closers can update their own status updates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Closers can update their own status updates" ON public.inspection_status_updates FOR UPDATE USING ((closer_user_id = auth.uid()));


--
-- Name: scheduled_appointments Managers and assigned users can update appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers and assigned users can update appointments" ON public.scheduled_appointments FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND ((closer_user_id = auth.uid()) OR (canvasser_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::public.user_role, 'regional_manager'::public.user_role, 'sales_manager'::public.user_role, 'operations'::public.user_role]))))))));


--
-- Name: contract_templates Managers can insert contract templates in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can insert contract templates in their org" ON public.contract_templates FOR INSERT WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: team_closer_queue Managers can manage closer queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can manage closer queue" ON public.team_closer_queue USING (((org_id = public.get_user_org_id(auth.uid())) AND (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::public.user_role, 'regional_manager'::public.user_role, 'sales_manager'::public.user_role])))))));


--
-- Name: contract_templates Managers can update contract templates in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update contract templates in their org" ON public.contract_templates FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: job_trade_material_sources Org can view job trade material sources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org can view job trade material sources" ON public.job_trade_material_sources FOR SELECT USING ((org_id = ( SELECT u.org_id
   FROM public.users u
  WHERE (u.id = auth.uid()))));


--
-- Name: supplier_order_send_lines Org can view supplier order send lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org can view supplier order send lines" ON public.supplier_order_send_lines FOR SELECT USING ((org_id = ( SELECT u.org_id
   FROM public.users u
  WHERE (u.id = auth.uid()))));


--
-- Name: supplier_order_send_sourcing Org can view supplier order send sourcing; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org can view supplier order send sourcing" ON public.supplier_order_send_sourcing FOR SELECT USING ((org_id = ( SELECT u.org_id
   FROM public.users u
  WHERE (u.id = auth.uid()))));


--
-- Name: supplier_order_sends Org can view supplier order sends; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org can view supplier order sends" ON public.supplier_order_sends FOR SELECT USING ((org_id = ( SELECT u.org_id
   FROM public.users u
  WHERE (u.id = auth.uid()))));


--
-- Name: supplier_orders Org can view supplier orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org can view supplier orders" ON public.supplier_orders FOR SELECT USING ((org_id = ( SELECT u.org_id
   FROM public.users u
  WHERE (u.id = auth.uid()))));


--
-- Name: org_trade_material_defaults Org can view trade material defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org can view trade material defaults" ON public.org_trade_material_defaults FOR SELECT USING ((org_id = ( SELECT u.org_id
   FROM public.users u
  WHERE (u.id = auth.uid()))));


--
-- Name: org_trades Org can view trades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org can view trades" ON public.org_trades FOR SELECT USING ((org_id = ( SELECT u.org_id
   FROM public.users u
  WHERE (u.id = auth.uid()))));


--
-- Name: org_monthly_goals Org members can view monthly goals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can view monthly goals" ON public.org_monthly_goals FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: report_role_access Report creators can manage access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Report creators can manage access" ON public.report_role_access USING ((EXISTS ( SELECT 1
   FROM public.custom_reports cr
  WHERE ((cr.id = report_role_access.report_id) AND (cr.created_by = auth.uid())))));


--
-- Name: referrals Sales reps can create referrals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Sales reps can create referrals" ON public.referrals FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: integration_outbox Service role can manage outbox; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage outbox" ON public.integration_outbox USING (true);


--
-- Name: work_order_photos Subs can insert photos for their work orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can insert photos for their work orders" ON public.work_order_photos FOR INSERT WITH CHECK ((work_order_id IN ( SELECT work_orders.id
   FROM public.work_orders
  WHERE (work_orders.assigned_sub_id = public.get_sub_id_for_user(auth.uid())))));


--
-- Name: work_orders Subs can update assigned work orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can update assigned work orders" ON public.work_orders FOR UPDATE USING (((assigned_sub_id = public.get_sub_id_for_user(auth.uid())) AND (trade IS NULL))) WITH CHECK (((assigned_sub_id = public.get_sub_id_for_user(auth.uid())) AND (trade IS NULL) AND (crew_link_token IS NULL)));


--
-- Name: proposals Subs can view accepted proposals for assigned jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can view accepted proposals for assigned jobs" ON public.proposals FOR SELECT USING (((accepted_at IS NOT NULL) AND (project_id IN ( SELECT production_jobs.project_id
   FROM public.production_jobs
  WHERE (production_jobs.assigned_sub_id = public.get_sub_id_for_user(auth.uid()))))));


--
-- Name: production_jobs Subs can view assigned jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can view assigned jobs" ON public.production_jobs FOR SELECT USING (((assigned_sub_id = public.get_sub_id_for_user(auth.uid())) AND (assigned_sub_id IS NOT NULL)));


--
-- Name: work_orders Subs can view assigned work orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can view assigned work orders" ON public.work_orders FOR SELECT USING ((assigned_sub_id = public.get_sub_id_for_user(auth.uid())));


--
-- Name: customers Subs can view customers for assigned jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can view customers for assigned jobs" ON public.customers FOR SELECT USING ((id IN ( SELECT production_jobs.customer_id
   FROM public.production_jobs
  WHERE ((production_jobs.assigned_sub_id = public.get_sub_id_for_user(auth.uid())) AND (production_jobs.customer_id IS NOT NULL)))));


--
-- Name: projects Subs can view projects for assigned jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can view projects for assigned jobs" ON public.projects FOR SELECT USING ((id IN ( SELECT production_jobs.project_id
   FROM public.production_jobs
  WHERE (production_jobs.assigned_sub_id = public.get_sub_id_for_user(auth.uid())))));


--
-- Name: proposal_line_items Subs can view proposal line items for assigned jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can view proposal line items for assigned jobs" ON public.proposal_line_items FOR SELECT USING ((proposal_id IN ( SELECT p.id
   FROM (public.proposals p
     JOIN public.production_jobs pj ON ((pj.project_id = p.project_id)))
  WHERE ((p.accepted_at IS NOT NULL) AND (pj.assigned_sub_id = public.get_sub_id_for_user(auth.uid()))))));


--
-- Name: files Subs can view shared files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can view shared files" ON public.files FOR SELECT USING ((((share_with_sub = true) OR (photo_tag ~~ 'final_%'::text)) AND ((job_id IN ( SELECT production_jobs.id
   FROM public.production_jobs
  WHERE (production_jobs.assigned_sub_id = public.get_sub_id_for_user(auth.uid())))) OR (project_id IN ( SELECT production_jobs.project_id
   FROM public.production_jobs
  WHERE (production_jobs.assigned_sub_id = public.get_sub_id_for_user(auth.uid())))))));


--
-- Name: job_files Subs can view shared job files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can view shared job files" ON public.job_files FOR SELECT USING (((share_with_sub = true) AND (job_id IN ( SELECT production_jobs.id
   FROM public.production_jobs
  WHERE (production_jobs.assigned_sub_id = public.get_sub_id_for_user(auth.uid()))))));


--
-- Name: production_job_notes Subs can view shared notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can view shared notes" ON public.production_job_notes FOR SELECT USING (((share_with_sub = true) AND (job_id IN ( SELECT production_jobs.id
   FROM public.production_jobs
  WHERE (production_jobs.assigned_sub_id = public.get_sub_id_for_user(auth.uid()))))));


--
-- Name: work_order_photos Subs can view their work order photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subs can view their work order photos" ON public.work_order_photos FOR SELECT USING ((work_order_id IN ( SELECT work_orders.id
   FROM public.work_orders
  WHERE (work_orders.assigned_sub_id = public.get_sub_id_for_user(auth.uid())))));


--
-- Name: notifications System can create notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System can create notifications" ON public.notifications FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: pending_status_prompts System can manage prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System can manage prompts" ON public.pending_status_prompts USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: work_order_comments Users can add work order comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can add work order comments" ON public.work_order_comments FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: work_order_comments Users can add work_order_comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can add work_order_comments" ON public.work_order_comments FOR INSERT WITH CHECK ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: work_order_status_history Users can add work_order_status_history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can add work_order_status_history" ON public.work_order_status_history FOR INSERT WITH CHECK ((work_order_id IN ( SELECT work_orders.id
   FROM public.work_orders
  WHERE (work_orders.org_id IN ( SELECT users.org_id
           FROM public.users
          WHERE (users.id = auth.uid()))))));


--
-- Name: scheduled_appointments Users can create appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create appointments" ON public.scheduled_appointments FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_files Users can create job files in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create job files in their org" ON public.job_files FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_elevations Users can create job measure elevations in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create job measure elevations in their org" ON public.job_measure_elevations FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_openings Users can create job measure openings in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create job measure openings in their org" ON public.job_measure_openings FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_photos Users can create job measure photos in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create job measure photos in their org" ON public.job_measure_photos FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_reports Users can create job measure reports in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create job measure reports in their org" ON public.job_measure_reports FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: measurement_requests Users can create measurement requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create measurement requests" ON public.measurement_requests FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_product_orders Users can create product orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create product orders" ON public.job_product_orders FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_product_orders.job_id) AND (pj.org_id = pj.org_id) AND (pj.org_id = ( SELECT u.org_id
           FROM public.users u
          WHERE (u.id = auth.uid())))))));


--
-- Name: proposals Users can create proposals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create proposals" ON public.proposals FOR INSERT WITH CHECK ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: custom_reports Users can create reports with permission; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create reports with permission" ON public.custom_reports FOR INSERT WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND (created_by = auth.uid())));


--
-- Name: roof_measurements Users can create roof measurements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create roof measurements" ON public.roof_measurements FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: work_orders Users can create work orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create work orders" ON public.work_orders FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: estimate_lines Users can delete estimate lines in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete estimate lines in their org" ON public.estimate_lines FOR DELETE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_report_photos Users can delete inspection_report_photos in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete inspection_report_photos in org" ON public.inspection_report_photos FOR DELETE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_reports Users can delete inspection_reports in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete inspection_reports in org" ON public.inspection_reports FOR DELETE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_result_photos Users can delete inspection_result_photos in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete inspection_result_photos in org" ON public.inspection_result_photos FOR DELETE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_invoice_items Users can delete invoice items for draft invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete invoice items for draft invoices" ON public.job_invoice_items FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.job_invoices ji
     JOIN public.production_jobs pj ON ((pj.id = ji.job_id)))
  WHERE ((ji.id = job_invoice_items.invoice_id) AND (ji.status = 'draft'::public.invoice_status) AND (pj.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: job_additional_scope Users can delete job additional scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete job additional scope" ON public.job_additional_scope FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_additional_scope.job_id) AND (pj.org_id = ( SELECT u.org_id
           FROM public.users u
          WHERE (u.id = auth.uid())))))));


--
-- Name: job_measure_elevations Users can delete job measure elevations in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete job measure elevations in their org" ON public.job_measure_elevations FOR DELETE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_openings Users can delete job measure openings in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete job measure openings in their org" ON public.job_measure_openings FOR DELETE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_photos Users can delete job measure photos in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete job measure photos in their org" ON public.job_measure_photos FOR DELETE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_reports Users can delete job measure reports in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete job measure reports in their org" ON public.job_measure_reports FOR DELETE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_run_sheet_overrides Users can delete job run sheet overrides in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete job run sheet overrides in their org" ON public.job_run_sheet_overrides FOR DELETE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: activities Users can delete own activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own activities" ON public.activities FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND (user_id = auth.uid()) AND (audience IS NULL)));


--
-- Name: work_orders Users can delete service work_orders in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete service work_orders in their org" ON public.work_orders FOR DELETE USING (((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))) AND (trade IS NULL)));


--
-- Name: activities Users can delete their own activities in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own activities in their org" ON public.activities FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND (user_id = auth.uid())));


--
-- Name: files Users can delete their own files in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own files in their org" ON public.files FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND (user_id = auth.uid())));


--
-- Name: custom_reports Users can delete their own reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own reports" ON public.custom_reports FOR DELETE USING ((created_by = auth.uid()));


--
-- Name: work_order_photos Users can delete work order photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete work order photos" ON public.work_order_photos FOR DELETE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: activities Users can insert activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert activities" ON public.activities FOR INSERT WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND (user_id = auth.uid()) AND (audience IS NULL) AND (restricted_pricing IS NULL) AND (priority IS NULL) AND (origin IS NULL) AND (pinned_at IS NULL) AND (deleted_at IS NULL) AND (mentioned_user_ids IS NULL) AND (legacy_ref IS NULL)));


--
-- Name: activities Users can insert activities in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert activities in their org" ON public.activities FOR INSERT WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND (user_id = auth.uid())));


--
-- Name: job_change_orders Users can insert change orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert change orders" ON public.job_change_orders FOR INSERT WITH CHECK ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: close_appointments Users can insert close_appointments in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert close_appointments in org" ON public.close_appointments FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: coaching_goals Users can insert coaching goals in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert coaching goals in their org" ON public.coaching_goals FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: contract_signatures Users can insert contract signatures in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert contract signatures in their org" ON public.contract_signatures FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: contracts Users can insert contracts in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert contracts in their org" ON public.contracts FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: cost_attachments Users can insert cost attachments in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert cost attachments in their org" ON public.cost_attachments FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: customers Users can insert customers in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert customers in their org" ON public.customers FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: documents Users can insert documents in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert documents in their org" ON public.documents FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: estimate_lines Users can insert estimate lines in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert estimate lines in their org" ON public.estimate_lines FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: estimates Users can insert estimates in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert estimates in their org" ON public.estimates FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: files Users can insert files in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert files in their org" ON public.files FOR INSERT WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND (user_id = auth.uid())));


--
-- Name: inspection_briefings Users can insert inspection_briefings in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert inspection_briefings in org" ON public.inspection_briefings FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_report_photos Users can insert inspection_report_photos in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert inspection_report_photos in org" ON public.inspection_report_photos FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_reports Users can insert inspection_reports in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert inspection_reports in org" ON public.inspection_reports FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_result_photos Users can insert inspection_result_photos in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert inspection_result_photos in org" ON public.inspection_result_photos FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_results Users can insert inspection_results in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert inspection_results in org" ON public.inspection_results FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_invoice_items Users can insert invoice items for draft invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert invoice items for draft invoices" ON public.job_invoice_items FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.job_invoices ji
     JOIN public.production_jobs pj ON ((pj.id = ji.job_id)))
  WHERE ((ji.id = job_invoice_items.invoice_id) AND (ji.status = 'draft'::public.invoice_status) AND (pj.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: invoice_payments Users can insert invoice payments for their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert invoice payments for their org" ON public.invoice_payments FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.job_invoices ji
     JOIN public.production_jobs pj ON ((pj.id = ji.job_id)))
  WHERE ((ji.id = invoice_payments.invoice_id) AND (pj.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: job_invoices Users can insert invoices for their org jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert invoices for their org jobs" ON public.job_invoices FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_invoices.job_id) AND (pj.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: job_additional_scope Users can insert job additional scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert job additional scope" ON public.job_additional_scope FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_additional_scope.job_id) AND (pj.org_id = pj.org_id) AND (pj.org_id = ( SELECT u.org_id
           FROM public.users u
          WHERE (u.id = auth.uid())))))));


--
-- Name: job_cost_lines Users can insert job cost lines in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert job cost lines in their org" ON public.job_cost_lines FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_material_order_overrides Users can insert job material order overrides in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert job material order overrides in their org" ON public.job_material_order_overrides FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_payments Users can insert job payments for their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert job payments for their org" ON public.job_payments FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_payments.job_id) AND (pj.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: job_run_sheet_overrides Users can insert job run sheet overrides in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert job run sheet overrides in their org" ON public.job_run_sheet_overrides FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: jobs Users can insert jobs in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert jobs in their org" ON public.jobs FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: projects Users can insert jobs in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert jobs in their org" ON public.projects FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: leads Users can insert leads in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert leads in their org" ON public.leads FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: notifications Users can insert notifications in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert notifications in their org" ON public.notifications FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: opportunities Users can insert opportunities in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert opportunities in their org" ON public.opportunities FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: order_form_contracts Users can insert order form contracts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert order form contracts" ON public.order_form_contracts FOR INSERT WITH CHECK ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: photos Users can insert photos in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert photos in their org" ON public.photos FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: work_orders Users can insert service work_orders in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert service work_orders in their org" ON public.work_orders FOR INSERT WITH CHECK (((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))) AND (trade IS NULL) AND (crew_link_token IS NULL)));


--
-- Name: work_order_photos Users can insert work order photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert work order photos" ON public.work_order_photos FOR INSERT WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: proposal_line_items Users can manage proposal line items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage proposal line items" ON public.proposal_line_items USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: proposal_photos Users can manage proposal photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage proposal photos" ON public.proposal_photos USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: review_requests Users can manage review_requests in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage review_requests in their org" ON public.review_requests USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid())))) WITH CHECK ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: roof_facets Users can manage roof facets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage roof facets" ON public.roof_facets USING ((EXISTS ( SELECT 1
   FROM public.roof_measurements rm
  WHERE ((rm.id = roof_facets.measurement_id) AND (rm.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: ai_suggestions Users can manage their AI suggestions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their AI suggestions" ON public.ai_suggestions USING ((user_id = auth.uid()));


--
-- Name: saved_report_filters Users can manage their own saved filters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their own saved filters" ON public.saved_report_filters USING ((user_id = auth.uid()));


--
-- Name: report_schedules Users can manage their own schedules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their own schedules" ON public.report_schedules USING ((created_by = auth.uid()));


--
-- Name: user_google_tokens Users can manage their own tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their own tokens" ON public.user_google_tokens USING ((user_id = auth.uid()));


--
-- Name: user_settings Users can manage their settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their settings" ON public.user_settings USING ((user_id = auth.uid()));


--
-- Name: activities Users can read activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read activities" ON public.activities FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND (referral_partner_id IS NULL) AND ((audience IS NULL) OR public.message_visible_to(( SELECT auth.uid() AS uid), audience, restricted_pricing, org_id, opportunity_id))));


--
-- Name: activities Users can read activities in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read activities in their org" ON public.activities FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_change_orders Users can read change orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read change orders" ON public.job_change_orders FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: coaching_goals Users can read coaching goals in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read coaching goals in their org" ON public.coaching_goals FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: contract_signatures Users can read contract signatures in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read contract signatures in their org" ON public.contract_signatures FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: contract_templates Users can read contract templates in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read contract templates in their org" ON public.contract_templates FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: contracts Users can read contracts in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read contracts in their org" ON public.contracts FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: customers Users can read customers in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read customers in their org" ON public.customers FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: estimate_lines Users can read estimate lines in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read estimate lines in their org" ON public.estimate_lines FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: estimates Users can read estimates in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read estimates in their org" ON public.estimates FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: files Users can read files in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read files in their org" ON public.files FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_invoice_items Users can read invoice items for their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read invoice items for their org" ON public.job_invoice_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.job_invoices ji
     JOIN public.production_jobs pj ON ((pj.id = ji.job_id)))
  WHERE ((ji.id = job_invoice_items.invoice_id) AND (pj.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: invoice_payments Users can read invoice payments for their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read invoice payments for their org" ON public.invoice_payments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.job_invoices ji
     JOIN public.production_jobs pj ON ((pj.id = ji.job_id)))
  WHERE ((ji.id = invoice_payments.invoice_id) AND (pj.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: job_invoices Users can read invoices for their org jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read invoices for their org jobs" ON public.job_invoices FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_invoices.job_id) AND (pj.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: job_additional_scope Users can read job additional scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read job additional scope" ON public.job_additional_scope FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_additional_scope.job_id) AND (pj.org_id = ( SELECT u.org_id
           FROM public.users u
          WHERE (u.id = auth.uid())))))));


--
-- Name: job_payments Users can read job payments for their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read job payments for their org" ON public.job_payments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_payments.job_id) AND (pj.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: jobs Users can read jobs in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read jobs in their org" ON public.jobs FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: projects Users can read jobs in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read jobs in their org" ON public.projects FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: leads Users can read leads in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read leads in their org" ON public.leads FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: notifications Users can read notifications in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read notifications in their org" ON public.notifications FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: opportunities Users can read opportunities in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read opportunities in their org" ON public.opportunities FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: order_form_contracts Users can read order form contracts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read order form contracts" ON public.order_form_contracts FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: integration_outbox Users can read outbox events for their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read outbox events for their org" ON public.integration_outbox FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: users Users can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own profile" ON public.users FOR SELECT USING ((id = auth.uid()));


--
-- Name: pricebook_items Users can read pricebook items in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read pricebook items in their org" ON public.pricebook_items FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: pricebooks Users can read pricebooks in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read pricebooks in their org" ON public.pricebooks FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: orgs Users can read their own org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read their own org" ON public.orgs FOR SELECT USING ((id = public.get_user_org_id(auth.uid())));


--
-- Name: users Users can read users in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read users in their org" ON public.users FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_change_orders Users can update change orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update change orders" ON public.job_change_orders FOR UPDATE USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: close_appointments Users can update close_appointments in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update close_appointments in org" ON public.close_appointments FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: coaching_goals Users can update coaching goals in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update coaching goals in their org" ON public.coaching_goals FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: contract_signatures Users can update contract signatures in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update contract signatures in their org" ON public.contract_signatures FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: contracts Users can update contracts in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update contracts in their org" ON public.contracts FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: cost_attachments Users can update cost attachments in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update cost attachments in their org" ON public.cost_attachments FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid()))) WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: customers Users can update customers in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update customers in their org" ON public.customers FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: documents Users can update documents in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update documents in their org" ON public.documents FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid()))) WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_invoices Users can update draft invoices for their org jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update draft invoices for their org jobs" ON public.job_invoices FOR UPDATE USING (((status = 'draft'::public.invoice_status) AND (EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_invoices.job_id) AND (pj.org_id = public.get_user_org_id(auth.uid())))))));


--
-- Name: estimate_lines Users can update estimate lines in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update estimate lines in their org" ON public.estimate_lines FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: estimates Users can update estimates in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update estimates in their org" ON public.estimates FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_briefings Users can update inspection_briefings in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update inspection_briefings in org" ON public.inspection_briefings FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_reports Users can update inspection_reports in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update inspection_reports in org" ON public.inspection_reports FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_results Users can update inspection_results in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update inspection_results in org" ON public.inspection_results FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_invoice_items Users can update invoice items for draft invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update invoice items for draft invoices" ON public.job_invoice_items FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.job_invoices ji
     JOIN public.production_jobs pj ON ((pj.id = ji.job_id)))
  WHERE ((ji.id = job_invoice_items.invoice_id) AND (ji.status = 'draft'::public.invoice_status) AND (pj.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: job_additional_scope Users can update job additional scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update job additional scope" ON public.job_additional_scope FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_additional_scope.job_id) AND (pj.org_id = ( SELECT u.org_id
           FROM public.users u
          WHERE (u.id = auth.uid())))))));


--
-- Name: job_cost_lines Users can update job cost lines in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update job cost lines in their org" ON public.job_cost_lines FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid()))) WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_files Users can update job files in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update job files in their org" ON public.job_files FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_material_order_overrides Users can update job material order overrides in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update job material order overrides in their org" ON public.job_material_order_overrides FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid()))) WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_elevations Users can update job measure elevations in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update job measure elevations in their org" ON public.job_measure_elevations FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid()))) WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_openings Users can update job measure openings in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update job measure openings in their org" ON public.job_measure_openings FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid()))) WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_photos Users can update job measure photos in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update job measure photos in their org" ON public.job_measure_photos FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid()))) WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_reports Users can update job measure reports in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update job measure reports in their org" ON public.job_measure_reports FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid()))) WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_run_sheet_overrides Users can update job run sheet overrides in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update job run sheet overrides in their org" ON public.job_run_sheet_overrides FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid()))) WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: jobs Users can update jobs in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update jobs in their org" ON public.jobs FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: projects Users can update jobs in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update jobs in their org" ON public.projects FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: leads Users can update leads in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update leads in their org" ON public.leads FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: opportunities Users can update opportunities in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update opportunities in their org" ON public.opportunities FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: order_form_contracts Users can update order form contracts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update order form contracts" ON public.order_form_contracts FOR UPDATE USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: activities Users can update own activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own activities" ON public.activities FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND (user_id = auth.uid()) AND (audience IS NULL))) WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND (user_id = auth.uid()) AND (audience IS NULL) AND (restricted_pricing IS NULL) AND (priority IS NULL) AND (origin IS NULL) AND (pinned_at IS NULL) AND (deleted_at IS NULL) AND (mentioned_user_ids IS NULL) AND (legacy_ref IS NULL)));


--
-- Name: photos Users can update photos in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update photos in their org" ON public.photos FOR UPDATE USING ((org_id = public.get_user_org_id(auth.uid()))) WITH CHECK ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_product_orders Users can update product orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update product orders" ON public.job_product_orders FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_product_orders.job_id) AND (pj.org_id = ( SELECT u.org_id
           FROM public.users u
          WHERE (u.id = auth.uid())))))));


--
-- Name: proposals Users can update proposals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update proposals" ON public.proposals FOR UPDATE USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: work_orders Users can update service work_orders in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update service work_orders in their org" ON public.work_orders FOR UPDATE USING (((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))) AND (trade IS NULL))) WITH CHECK (((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))) AND (trade IS NULL) AND (crew_link_token IS NULL)));


--
-- Name: inbound_lead_queue Users can update their assigned leads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their assigned leads" ON public.inbound_lead_queue FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND ((public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old])) OR public.user_has_permission(auth.uid(), 'leads:manage_inbound'::text) OR (assigned_to = auth.uid()))));


--
-- Name: roof_measurements Users can update their measurements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their measurements" ON public.roof_measurements FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND ((created_by = auth.uid()) OR (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old, 'sales_manager'::public.user_role_old])))));


--
-- Name: activities Users can update their own activities in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own activities in their org" ON public.activities FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND (user_id = auth.uid())));


--
-- Name: files Users can update their own files in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own files in their org" ON public.files FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND (user_id = auth.uid())));


--
-- Name: notifications Users can update their own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own notifications" ON public.notifications FOR UPDATE USING ((recipient_user_id = auth.uid()));


--
-- Name: proposals Users can update their proposals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their proposals" ON public.proposals FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND ((created_by = auth.uid()) OR (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old, 'sales_manager'::public.user_role_old])))));


--
-- Name: work_orders Users can update work orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update work orders" ON public.work_orders FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND ((created_by = auth.uid()) OR (assigned_user_id = auth.uid()) OR (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old, 'operations'::public.user_role_old, 'sales_manager'::public.user_role_old])))));


--
-- Name: adder_categories Users can view adder categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view adder categories" ON public.adder_categories FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: scheduled_appointments Users can view appointments in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view appointments in their org" ON public.scheduled_appointments FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: campaigns Users can view campaigns in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view campaigns in their org" ON public.campaigns FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: close_appointments Users can view close_appointments in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view close_appointments in org" ON public.close_appointments FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: team_closer_queue Users can view closer queue in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view closer queue in their org" ON public.team_closer_queue FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: comp_plans Users can view comp plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view comp plans" ON public.comp_plans FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: cost_attachments Users can view cost attachments in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view cost attachments in their org" ON public.cost_attachments FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: crews Users can view crews in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view crews in their org" ON public.crews FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: dashboard_settings Users can view dashboard settings in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view dashboard settings in their org" ON public.dashboard_settings FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: documents Users can view documents in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view documents in their org" ON public.documents FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: leads Users can view inbound leads with permission; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view inbound leads with permission" ON public.leads FOR SELECT USING (((org_id = public.get_user_org_id(auth.uid())) AND ((channel = 'outbound'::public.lead_channel) OR (channel IS NULL) OR ((channel = 'inbound'::public.lead_channel) AND ((public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old, 'operations'::public.user_role_old])) OR public.user_has_permission(auth.uid(), 'leads:view_inbound'::text) OR (owner_user_id = auth.uid()))) OR (owner_user_id = auth.uid()))));


--
-- Name: inbound_lead_queue Users can view inbound queue based on permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view inbound queue based on permissions" ON public.inbound_lead_queue FOR SELECT USING (((org_id = public.get_user_org_id(auth.uid())) AND ((public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old, 'operations'::public.user_role_old])) OR (assigned_to = auth.uid()))));


--
-- Name: inspection_briefings Users can view inspection_briefings in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view inspection_briefings in org" ON public.inspection_briefings FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_report_photos Users can view inspection_report_photos in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view inspection_report_photos in org" ON public.inspection_report_photos FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_reports Users can view inspection_reports in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view inspection_reports in org" ON public.inspection_reports FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_result_photos Users can view inspection_result_photos in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view inspection_result_photos in org" ON public.inspection_result_photos FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_results Users can view inspection_results in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view inspection_results in org" ON public.inspection_results FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_cost_lines Users can view job cost lines in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view job cost lines in their org" ON public.job_cost_lines FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_files Users can view job files in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view job files in their org" ON public.job_files FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_material_order_overrides Users can view job material order overrides in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view job material order overrides in their org" ON public.job_material_order_overrides FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_elevations Users can view job measure elevations in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view job measure elevations in their org" ON public.job_measure_elevations FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_openings Users can view job measure openings in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view job measure openings in their org" ON public.job_measure_openings FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_photos Users can view job measure photos in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view job measure photos in their org" ON public.job_measure_photos FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_measure_reports Users can view job measure reports in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view job measure reports in their org" ON public.job_measure_reports FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_run_sheet_overrides Users can view job run sheet overrides in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view job run sheet overrides in their org" ON public.job_run_sheet_overrides FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: material_orders Users can view material orders in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view material orders in their org" ON public.material_orders FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: measurement_requests Users can view measurement requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view measurement requests" ON public.measurement_requests FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: permission_presets Users can view permission presets in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view permission presets in their org" ON public.permission_presets FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: photos Users can view photos in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view photos in their org" ON public.photos FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: preset_permissions Users can view preset permissions in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view preset permissions in their org" ON public.preset_permissions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.permission_presets pp
  WHERE ((pp.id = preset_permissions.preset_id) AND (pp.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: job_product_orders Users can view product orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view product orders" ON public.job_product_orders FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.production_jobs pj
  WHERE ((pj.id = job_product_orders.job_id) AND (pj.org_id = ( SELECT u.org_id
           FROM public.users u
          WHERE (u.id = auth.uid())))))));


--
-- Name: production_jobs Users can view production jobs in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view production jobs in their org" ON public.production_jobs FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: proposal_templates Users can view proposal templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view proposal templates" ON public.proposal_templates FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: proposals Users can view proposals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view proposals" ON public.proposals FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: referrals Users can view referrals in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view referrals in their org" ON public.referrals FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: regions Users can view regions in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view regions in their org" ON public.regions FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: report_role_access Users can view report access for their reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view report access for their reports" ON public.report_role_access FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.custom_reports cr
  WHERE ((cr.id = report_role_access.report_id) AND (cr.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: review_requests Users can view review_requests in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view review_requests in their org" ON public.review_requests FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: role_permissions Users can view role permissions in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view role permissions in their org" ON public.role_permissions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.custom_roles cr
  WHERE ((cr.id = role_permissions.role_id) AND (cr.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: custom_roles Users can view roles in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view roles in their org" ON public.custom_roles FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: roof_measurements Users can view roof measurements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view roof measurements" ON public.roof_measurements FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: roofing_types Users can view roofing types for their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view roofing types for their org" ON public.roofing_types FOR SELECT USING ((org_id = ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: report_schedules Users can view schedules for accessible reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view schedules for accessible reports" ON public.report_schedules FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: work_order_status_history Users can view status history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view status history" ON public.work_order_status_history FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.work_orders wo
  WHERE ((wo.id = work_order_status_history.work_order_id) AND (wo.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: inspection_status_updates Users can view status updates in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view status updates in their org" ON public.inspection_status_updates FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: sub_contractors Users can view sub contractors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view sub contractors" ON public.sub_contractors FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: sub_contractors Users can view sub_contractors in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view sub_contractors in their org" ON public.sub_contractors FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: teams Users can view teams in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view teams in their org" ON public.teams FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: commissions Users can view their commissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their commissions" ON public.commissions FOR SELECT USING (((org_id = public.get_user_org_id(auth.uid())) AND ((user_id = auth.uid()) OR (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old, 'sales_manager'::public.user_role_old])))));


--
-- Name: user_comp_plans Users can view their comp plan assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their comp plan assignments" ON public.user_comp_plans FOR SELECT USING (((org_id = public.get_user_org_id(auth.uid())) AND ((user_id = auth.uid()) OR (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::public.user_role_old, 'regional_manager'::public.user_role_old, 'sales_manager'::public.user_role_old])))));


--
-- Name: user_comp_plans Users can view their own comp plan assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own comp plan assignments" ON public.user_comp_plans FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: user_permissions Users can view their own permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own permissions" ON public.user_permissions FOR SELECT USING (((user_id = auth.uid()) OR (org_id = public.get_user_org_id(auth.uid()))));


--
-- Name: pending_status_prompts Users can view their own prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own prompts" ON public.pending_status_prompts FOR SELECT USING ((closer_user_id = auth.uid()));


--
-- Name: vendors Users can view vendors in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view vendors in their org" ON public.vendors FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: work_order_comments Users can view work order comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view work order comments" ON public.work_order_comments FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: work_order_photos Users can view work order photos in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view work order photos in their org" ON public.work_order_photos FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: work_orders Users can view work orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view work orders" ON public.work_orders FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: work_order_comments Users can view work_order_comments in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view work_order_comments in their org" ON public.work_order_comments FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: work_order_status_history Users can view work_order_status_history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view work_order_status_history" ON public.work_order_status_history FOR SELECT USING ((work_order_id IN ( SELECT work_orders.id
   FROM public.work_orders
  WHERE (work_orders.org_id IN ( SELECT users.org_id
           FROM public.users
          WHERE (users.id = auth.uid()))))));


--
-- Name: work_orders Users can view work_orders in their org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view work_orders in their org" ON public.work_orders FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: ai_conversations Users delete own AI conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own AI conversations" ON public.ai_conversations FOR DELETE USING (((user_id = auth.uid()) AND (org_id = public.get_user_org_id(auth.uid()))));


--
-- Name: ai_message_feedback Users delete own AI message feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own AI message feedback" ON public.ai_message_feedback FOR DELETE USING (((user_id = auth.uid()) AND (org_id = public.get_user_org_id(auth.uid()))));


--
-- Name: ai_conversations Users insert own AI conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own AI conversations" ON public.ai_conversations FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (org_id = public.get_user_org_id(auth.uid()))));


--
-- Name: ai_message_feedback Users insert own AI message feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own AI message feedback" ON public.ai_message_feedback FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (org_id = public.get_user_org_id(auth.uid()))));


--
-- Name: ai_conversations Users read own AI conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own AI conversations" ON public.ai_conversations FOR SELECT USING (((user_id = auth.uid()) AND (org_id = public.get_user_org_id(auth.uid()))));


--
-- Name: ai_message_feedback Users read own AI message feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own AI message feedback" ON public.ai_message_feedback FOR SELECT USING (((user_id = auth.uid()) AND (org_id = public.get_user_org_id(auth.uid()))));


--
-- Name: ai_conversations Users update own AI conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own AI conversations" ON public.ai_conversations FOR UPDATE USING (((user_id = auth.uid()) AND (org_id = public.get_user_org_id(auth.uid())))) WITH CHECK (((user_id = auth.uid()) AND (org_id = public.get_user_org_id(auth.uid()))));


--
-- Name: ai_message_feedback Users update own AI message feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own AI message feedback" ON public.ai_message_feedback FOR UPDATE USING (((user_id = auth.uid()) AND (org_id = public.get_user_org_id(auth.uid())))) WITH CHECK (((user_id = auth.uid()) AND (org_id = public.get_user_org_id(auth.uid()))));


--
-- Name: activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: adder_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.adder_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_message_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_message_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_suggestions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_suggestions ENABLE ROW LEVEL SECURITY;

--
-- Name: announcement_dismissals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcement_dismissals ENABLE ROW LEVEL SECURITY;

--
-- Name: announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: appointment_closeouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointment_closeouts ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: canvass_knocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canvass_knocks ENABLE ROW LEVEL SECURITY;

--
-- Name: canvass_territories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canvass_territories ENABLE ROW LEVEL SECURITY;

--
-- Name: canvass_territories canvass_territories_select_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canvass_territories_select_org ON public.canvass_territories FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: canvass_territory_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canvass_territory_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: canvass_territory_teams canvass_territory_teams_select_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canvass_territory_teams_select_org ON public.canvass_territory_teams FOR SELECT USING ((territory_id IN ( SELECT canvass_territories.id
   FROM public.canvass_territories
  WHERE (canvass_territories.org_id IN ( SELECT users.org_id
           FROM public.users
          WHERE (users.id = auth.uid()))))));


--
-- Name: canvass_territory_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canvass_territory_users ENABLE ROW LEVEL SECURITY;

--
-- Name: canvass_territory_users canvass_territory_users_select_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY canvass_territory_users_select_org ON public.canvass_territory_users FOR SELECT USING ((territory_id IN ( SELECT canvass_territories.id
   FROM public.canvass_territories
  WHERE (canvass_territories.org_id IN ( SELECT users.org_id
           FROM public.users
          WHERE (users.id = auth.uid()))))));


--
-- Name: close_appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.close_appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: job_additional_scope closer_own_deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY closer_own_deals ON public.job_additional_scope AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_closer_self() AS is_closer_self)) OR (created_by = ( SELECT auth.uid() AS uid)) OR public.job_is_mine_self(job_id)));


--
-- Name: job_change_orders closer_own_deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY closer_own_deals ON public.job_change_orders AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_closer_self() AS is_closer_self)) OR (created_by = ( SELECT auth.uid() AS uid)) OR public.job_is_mine_self(job_id)));


--
-- Name: job_invoice_items closer_own_deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY closer_own_deals ON public.job_invoice_items AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_closer_self() AS is_closer_self)) OR public.invoice_is_mine_self(invoice_id)));


--
-- Name: job_invoices closer_own_deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY closer_own_deals ON public.job_invoices AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_closer_self() AS is_closer_self)) OR (created_by = ( SELECT auth.uid() AS uid)) OR public.job_is_mine_self(job_id)));


--
-- Name: job_payments closer_own_deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY closer_own_deals ON public.job_payments AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_closer_self() AS is_closer_self)) OR (created_by = ( SELECT auth.uid() AS uid)) OR public.job_is_mine_self(job_id)));


--
-- Name: order_form_contracts closer_own_deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY closer_own_deals ON public.order_form_contracts AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_closer_self() AS is_closer_self)) OR (created_by = ( SELECT auth.uid() AS uid)) OR public.opp_is_mine_self(opportunity_id) OR public.proposal_is_mine_self(proposal_id)));


--
-- Name: production_jobs closer_own_deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY closer_own_deals ON public.production_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_closer_self() AS is_closer_self)) OR (created_by = ( SELECT auth.uid() AS uid)) OR public.project_is_mine_self(project_id) OR public.proposal_is_mine_self(accepted_proposal_id) OR public.proposal_is_mine_self(linked_proposal_id)));


--
-- Name: proposal_line_items closer_own_deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY closer_own_deals ON public.proposal_line_items AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_closer_self() AS is_closer_self)) OR public.proposal_is_mine_self(proposal_id)));


--
-- Name: proposals closer_own_deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY closer_own_deals ON public.proposals AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_closer_self() AS is_closer_self)) OR (created_by = ( SELECT auth.uid() AS uid)) OR public.opp_is_mine_self(opportunity_id) OR public.project_is_mine_self(project_id)));


--
-- Name: coaching_goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coaching_goals ENABLE ROW LEVEL SECURITY;

--
-- Name: commissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

--
-- Name: comp_plan_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comp_plan_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: comp_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comp_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_signatures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contract_signatures ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: cost_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cost_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: crews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crews ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_commission_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_commission_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_commission_roles deal_commission_roles_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deal_commission_roles_org_select ON public.deal_commission_roles FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: deal_commission_roles deal_commission_roles_own_or_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deal_commission_roles_own_or_admin_select ON public.deal_commission_roles FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND ((user_id = auth.uid()) OR public.is_payroll_admin())));


--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: email_blast_sends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_blast_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_comp_agreement_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_comp_agreement_events ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_comp_agreements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_comp_agreements ENABLE ROW LEVEL SECURITY;

--
-- Name: estimate_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estimate_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: estimates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;

--
-- Name: estimate_lines field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.estimate_lines AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: estimates field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.estimates AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: job_additional_scope field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.job_additional_scope AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: job_change_orders field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.job_change_orders AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: job_invoice_items field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.job_invoice_items AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: job_invoices field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.job_invoices AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: job_payments field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.job_payments AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: job_trade_material_sources field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.job_trade_material_sources AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: order_form_contracts field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.order_form_contracts AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: org_trade_material_defaults field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.org_trade_material_defaults AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: pricebook_items field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.pricebook_items AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: production_jobs field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.production_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: proposal_line_items field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.proposal_line_items AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: proposals field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.proposals AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: roofing_types field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.roofing_types AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: supplier_order_send_lines field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.supplier_order_send_lines AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: supplier_order_send_sourcing field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.supplier_order_send_sourcing AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: supplier_orders field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.supplier_orders AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: work_orders field_role_money_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_role_money_deny ON public.work_orders AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT public.is_field_role_self()));


--
-- Name: files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

--
-- Name: financing_programs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financing_programs ENABLE ROW LEVEL SECURITY;

--
-- Name: founder_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.founder_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: inbound_lead_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inbound_lead_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: incentive_badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incentive_badges ENABLE ROW LEVEL SECURITY;

--
-- Name: incentive_badges incentive_badges_admin_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incentive_badges_admin_manage ON public.incentive_badges USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: incentive_badges incentive_badges_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incentive_badges_org_select ON public.incentive_badges FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: incentive_cycles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incentive_cycles ENABLE ROW LEVEL SECURITY;

--
-- Name: incentive_cycles incentive_cycles_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incentive_cycles_admin_delete ON public.incentive_cycles FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: incentive_cycles incentive_cycles_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incentive_cycles_admin_insert ON public.incentive_cycles FOR INSERT WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: incentive_cycles incentive_cycles_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incentive_cycles_admin_update ON public.incentive_cycles FOR UPDATE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: incentive_cycles incentive_cycles_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incentive_cycles_org_select ON public.incentive_cycles FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: inspection_briefings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_briefings ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_report_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_report_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_result_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_result_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_results ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_status_updates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_status_updates ENABLE ROW LEVEL SECURITY;

--
-- Name: instant_estimate_checks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.instant_estimate_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: job_additional_scope; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_additional_scope ENABLE ROW LEVEL SECURITY;

--
-- Name: job_change_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_change_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: job_checkups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_checkups ENABLE ROW LEVEL SECURITY;

--
-- Name: cost_attachments job_cost_board_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_cost_board_only ON public.cost_attachments AS RESTRICTIVE FOR SELECT TO authenticated USING (public.can_view_job_board_self());


--
-- Name: job_cost_lines job_cost_board_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_cost_board_only ON public.job_cost_lines AS RESTRICTIVE FOR SELECT TO authenticated USING (public.can_view_job_board_self());


--
-- Name: job_product_orders job_cost_board_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_cost_board_only ON public.job_product_orders AS RESTRICTIVE FOR SELECT TO authenticated USING (public.can_view_job_board_self());


--
-- Name: material_orders job_cost_board_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_cost_board_only ON public.material_orders AS RESTRICTIVE FOR SELECT TO authenticated USING (public.can_view_job_board_self());


--
-- Name: job_cost_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_cost_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: job_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_files ENABLE ROW LEVEL SECURITY;

--
-- Name: job_invoice_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_invoice_items ENABLE ROW LEVEL SECURITY;

--
-- Name: job_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: job_material_order_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_material_order_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: job_measure_elevations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_measure_elevations ENABLE ROW LEVEL SECURITY;

--
-- Name: job_measure_openings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_measure_openings ENABLE ROW LEVEL SECURITY;

--
-- Name: job_measure_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_measure_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: job_measure_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_measure_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: job_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: job_payroll_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_payroll_state ENABLE ROW LEVEL SECURITY;

--
-- Name: job_payroll_state job_payroll_state_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_payroll_state_admin_select ON public.job_payroll_state FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: job_payroll_state job_payroll_state_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_payroll_state_org_select ON public.job_payroll_state FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: job_product_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_product_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: job_run_sheet_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_run_sheet_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: job_trade_material_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_trade_material_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: lead_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

--
-- Name: lidar_tiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lidar_tiles ENABLE ROW LEVEL SECURITY;

--
-- Name: management_comp_overlay_plan_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.management_comp_overlay_plan_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: material_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.material_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: measurement_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.measurement_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_device_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_device_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_device_tokens mobile_device_tokens_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mobile_device_tokens_delete_own ON public.mobile_device_tokens FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: mobile_device_tokens mobile_device_tokens_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mobile_device_tokens_insert_own ON public.mobile_device_tokens FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid())))));


--
-- Name: mobile_device_tokens mobile_device_tokens_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mobile_device_tokens_select_own ON public.mobile_device_tokens FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: mobile_device_tokens mobile_device_tokens_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mobile_device_tokens_update_own ON public.mobile_device_tokens FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_recipient_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_recipient_select ON public.notifications FOR SELECT TO authenticated USING ((recipient_user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: notifications notifications_recipient_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_recipient_update ON public.notifications FOR UPDATE TO authenticated USING ((recipient_user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((recipient_user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: order_form_contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_form_contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: org_default_comp_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_default_comp_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: org_derived_commission_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_derived_commission_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: org_monthly_goal_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_monthly_goal_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: org_monthly_goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_monthly_goals ENABLE ROW LEVEL SECURITY;

--
-- Name: org_trade_material_defaults; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_trade_material_defaults ENABLE ROW LEVEL SECURITY;

--
-- Name: org_trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_trades ENABLE ROW LEVEL SECURITY;

--
-- Name: orgs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;

--
-- Name: comp_plans own_plans_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_plans_only ON public.comp_plans AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT public.is_payroll_admin() AS is_payroll_admin) OR public.comp_plan_is_mine_self(id)));


--
-- Name: user_comp_plans own_plans_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_plans_only ON public.user_comp_plans AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT public.is_payroll_admin() AS is_payroll_admin) OR (user_id = ( SELECT auth.uid() AS uid))));


--
-- Name: payroll_adjustments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_bonus_lines payroll_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_delete ON public.payroll_bonus_lines FOR DELETE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: program_444_enrollments payroll_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_delete ON public.program_444_enrollments FOR DELETE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: setter_ramp_enrollments payroll_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_delete ON public.setter_ramp_enrollments FOR DELETE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: setter_ramp_weekly_status payroll_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_delete ON public.setter_ramp_weekly_status FOR DELETE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: spiff_achievements payroll_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_delete ON public.spiff_achievements FOR DELETE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: spiff_programs payroll_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_delete ON public.spiff_programs FOR DELETE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: payroll_bonus_lines payroll_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_insert ON public.payroll_bonus_lines FOR INSERT TO authenticated WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: program_444_enrollments payroll_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_insert ON public.program_444_enrollments FOR INSERT TO authenticated WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: setter_ramp_enrollments payroll_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_insert ON public.setter_ramp_enrollments FOR INSERT TO authenticated WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: setter_ramp_weekly_status payroll_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_insert ON public.setter_ramp_weekly_status FOR INSERT TO authenticated WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: spiff_achievements payroll_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_insert ON public.spiff_achievements FOR INSERT TO authenticated WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: spiff_programs payroll_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_insert ON public.spiff_programs FOR INSERT TO authenticated WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: payroll_bonus_lines payroll_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_update ON public.payroll_bonus_lines FOR UPDATE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin())) WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: program_444_enrollments payroll_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_update ON public.program_444_enrollments FOR UPDATE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin())) WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: setter_ramp_enrollments payroll_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_update ON public.setter_ramp_enrollments FOR UPDATE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin())) WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: setter_ramp_weekly_status payroll_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_update ON public.setter_ramp_weekly_status FOR UPDATE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin())) WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: spiff_achievements payroll_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_update ON public.spiff_achievements FOR UPDATE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin())) WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: spiff_programs payroll_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_admin_update ON public.spiff_programs FOR UPDATE TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin())) WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: payroll_bonus_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_bonus_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_bonus_lines payroll_bonus_lines_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_bonus_lines_select ON public.payroll_bonus_lines FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND ((user_id = auth.uid()) OR public.is_payroll_admin())));


--
-- Name: payroll_chargeback_applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_chargeback_applications ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_chargeback_applications payroll_chargeback_applications_own_or_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_chargeback_applications_own_or_admin_select ON public.payroll_chargeback_applications FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.payroll_chargebacks pc
  WHERE ((pc.id = payroll_chargeback_applications.chargeback_id) AND (pc.org_id = public.get_user_org_id(auth.uid())) AND ((pc.user_id = auth.uid()) OR public.is_payroll_admin())))));


--
-- Name: payroll_chargeback_applications payroll_chargeback_applications_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_chargeback_applications_select ON public.payroll_chargeback_applications FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.payroll_chargebacks pc
  WHERE ((pc.id = payroll_chargeback_applications.chargeback_id) AND (pc.org_id = public.get_user_org_id(auth.uid()))))));


--
-- Name: payroll_chargebacks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_chargebacks ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_chargebacks payroll_chargebacks_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_chargebacks_org_select ON public.payroll_chargebacks FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: payroll_chargebacks payroll_chargebacks_own_or_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_chargebacks_own_or_admin_select ON public.payroll_chargebacks FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND ((user_id = auth.uid()) OR public.is_payroll_admin())));


--
-- Name: payroll_disputes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_disputes ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_job_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_job_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_job_snapshots payroll_job_snapshots_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_job_snapshots_admin_select ON public.payroll_job_snapshots FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: payroll_job_snapshots payroll_job_snapshots_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_job_snapshots_org_select ON public.payroll_job_snapshots FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: payroll_override_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_override_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_override_audit payroll_override_audit_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_override_audit_admin_select ON public.payroll_override_audit FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: payroll_override_audit payroll_override_audit_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_override_audit_org_select ON public.payroll_override_audit FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: payroll_payout_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_payout_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_payout_lines payroll_payout_lines_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_payout_lines_org_select ON public.payroll_payout_lines FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: payroll_payout_lines payroll_payout_lines_own_or_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_payout_lines_own_or_admin_select ON public.payroll_payout_lines FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND ((user_id = auth.uid()) OR public.is_payroll_admin())));


--
-- Name: payroll_period_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_period_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_period_snapshots payroll_period_snapshots_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_period_snapshots_admin_select ON public.payroll_period_snapshots FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_payroll_admin()));


--
-- Name: payroll_period_snapshots payroll_period_snapshots_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_period_snapshots_org_select ON public.payroll_period_snapshots FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: payroll_periods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_periods payroll_periods_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_periods_org_select ON public.payroll_periods FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: payroll_rep_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_rep_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_rep_hours_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_rep_hours_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_rep_hours_audit payroll_rep_hours_audit_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_rep_hours_audit_org_select ON public.payroll_rep_hours_audit FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: payroll_rep_hours_audit payroll_rep_hours_audit_own_or_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_rep_hours_audit_own_or_admin_select ON public.payroll_rep_hours_audit FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND ((user_id = auth.uid()) OR public.is_payroll_admin())));


--
-- Name: payroll_rep_hours payroll_rep_hours_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_rep_hours_org_select ON public.payroll_rep_hours FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: payroll_rep_hours payroll_rep_hours_own_or_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_rep_hours_own_or_admin_select ON public.payroll_rep_hours FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND ((user_id = auth.uid()) OR public.is_payroll_admin())));


--
-- Name: payroll_statement_deliveries payroll_statement_deliveries_own_or_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_statement_deliveries_own_or_admin_select ON public.payroll_statement_deliveries FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id(auth.uid())) AND ((user_id = auth.uid()) OR public.is_payroll_admin())));


--
-- Name: payroll_unit_earnings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_unit_earnings ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_status_prompts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_status_prompts ENABLE ROW LEVEL SECURITY;

--
-- Name: permission_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permission_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: permission_denials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permission_denials ENABLE ROW LEVEL SECURITY;

--
-- Name: permission_presets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permission_presets ENABLE ROW LEVEL SECURITY;

--
-- Name: permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

--
-- Name: preset_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.preset_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: pricebook_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricebook_items ENABLE ROW LEVEL SECURITY;

--
-- Name: pricebooks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricebooks ENABLE ROW LEVEL SECURITY;

--
-- Name: primary_comp_plan_assignment_cancellations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.primary_comp_plan_assignment_cancellations ENABLE ROW LEVEL SECURITY;

--
-- Name: production_job_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.production_job_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: production_job_notes production_job_notes_job_board_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY production_job_notes_job_board_insert ON public.production_job_notes FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND public.can_view_job_board(( SELECT auth.uid() AS uid)) AND (job_id IN ( SELECT pj.id
   FROM public.production_jobs pj
  WHERE (pj.org_id = public.get_user_org_id(( SELECT auth.uid() AS uid)))))));


--
-- Name: production_job_notes production_job_notes_job_board_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY production_job_notes_job_board_select ON public.production_job_notes FOR SELECT TO authenticated USING ((public.can_view_job_board(( SELECT auth.uid() AS uid)) AND (job_id IN ( SELECT pj.id
   FROM public.production_jobs pj
  WHERE (pj.org_id = public.get_user_org_id(( SELECT auth.uid() AS uid)))))));


--
-- Name: production_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.production_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: program_444_enrollments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.program_444_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: program_444_enrollments program_444_enrollments_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY program_444_enrollments_org_select ON public.program_444_enrollments FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: proposal_line_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proposal_line_items ENABLE ROW LEVEL SECURITY;

--
-- Name: proposal_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proposal_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: proposal_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proposal_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: proposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

--
-- Name: public_estimate_previews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.public_estimate_previews ENABLE ROW LEVEL SECURITY;

--
-- Name: public_estimate_unlock_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.public_estimate_unlock_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: setter_ramp_weekly_status ramp_pay_own_or_manager; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ramp_pay_own_or_manager ON public.setter_ramp_weekly_status AS RESTRICTIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin_or_manager(auth.uid()) OR public.is_payroll_admin()));


--
-- Name: referral_partner_assignment_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.referral_partner_assignment_log ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_partner_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.referral_partner_types ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_partner_types referral_partner_types_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY referral_partner_types_org_select ON public.referral_partner_types FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: referral_partners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.referral_partners ENABLE ROW LEVEL SECURITY;

--
-- Name: referrals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

--
-- Name: regions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

--
-- Name: report_role_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_role_access ENABLE ROW LEVEL SECURITY;

--
-- Name: report_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: review_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: role_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: roof_facets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roof_facets ENABLE ROW LEVEL SECURITY;

--
-- Name: roof_measurements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roof_measurements ENABLE ROW LEVEL SECURITY;

--
-- Name: roofing_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roofing_types ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_report_filters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_report_filters ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: scheduled_appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scheduled_appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: customers setter_own_work; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY setter_own_work ON public.customers AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_setter_canvasser_self() AS is_setter_canvasser_self)) OR (EXISTS ( SELECT 1
   FROM public.opportunities o
  WHERE (o.customer_id = customers.id))) OR (EXISTS ( SELECT 1
   FROM public.leads l
  WHERE (l.customer_id = customers.id)))));


--
-- Name: leads setter_own_work; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY setter_own_work ON public.leads AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_setter_canvasser_self() AS is_setter_canvasser_self)) OR (owner_user_id = ( SELECT auth.uid() AS uid)) OR (pin_attributed_user_id = ( SELECT auth.uid() AS uid)) OR (closer_user_id = ( SELECT auth.uid() AS uid)) OR public.lead_is_mine_self(id)));


--
-- Name: opportunities setter_own_work; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY setter_own_work ON public.opportunities AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_setter_canvasser_self() AS is_setter_canvasser_self)) OR (setter_user_id = ( SELECT auth.uid() AS uid)) OR (owner_user_id = ( SELECT auth.uid() AS uid)) OR (assigned_user_id = ( SELECT auth.uid() AS uid)) OR public.lead_is_mine_self(lead_id)));


--
-- Name: scheduled_appointments setter_own_work; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY setter_own_work ON public.scheduled_appointments AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT ( SELECT public.is_setter_canvasser_self() AS is_setter_canvasser_self)) OR (canvasser_user_id = ( SELECT auth.uid() AS uid)) OR (closer_user_id = ( SELECT auth.uid() AS uid)) OR (inside_sales_booked_by_user_id = ( SELECT auth.uid() AS uid)) OR public.lead_is_mine_self(lead_id)));


--
-- Name: setter_ramp_enrollments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.setter_ramp_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: setter_ramp_enrollments setter_ramp_enrollments_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY setter_ramp_enrollments_org_select ON public.setter_ramp_enrollments FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: setter_ramp_weekly_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.setter_ramp_weekly_status ENABLE ROW LEVEL SECURITY;

--
-- Name: setter_ramp_weekly_status setter_ramp_weekly_status_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY setter_ramp_weekly_status_org_select ON public.setter_ramp_weekly_status FOR SELECT USING ((org_id IN ( SELECT users.org_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- Name: spiff_achievements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spiff_achievements ENABLE ROW LEVEL SECURITY;

--
-- Name: spiff_achievements spiff_achievements_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY spiff_achievements_select ON public.spiff_achievements FOR SELECT USING (((org_id = public.get_user_org_id(auth.uid())) AND ((user_id = auth.uid()) OR public.is_admin_or_manager(auth.uid()))));


--
-- Name: spiff_programs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spiff_programs ENABLE ROW LEVEL SECURITY;

--
-- Name: spiff_programs spiff_programs_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY spiff_programs_org_select ON public.spiff_programs FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: storm_opportunity_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.storm_opportunity_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: storm_opportunity_alerts storm_opportunity_alerts_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY storm_opportunity_alerts_org_select ON public.storm_opportunity_alerts FOR SELECT TO authenticated USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: sub_contractors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sub_contractors ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_api_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_api_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_api_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_api_events ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_api_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_api_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_item_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_item_map ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_order_send_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_order_send_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_order_send_sourcing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_order_send_sourcing ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_order_sends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_order_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: table_views; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.table_views ENABLE ROW LEVEL SECURITY;

--
-- Name: team_closer_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_closer_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: thread_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.thread_members ENABLE ROW LEVEL SECURITY;

--
-- Name: threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;

--
-- Name: user_badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

--
-- Name: user_badges user_badges_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_badges_admin_delete ON public.user_badges FOR DELETE USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: user_badges user_badges_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_badges_admin_insert ON public.user_badges FOR INSERT WITH CHECK (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: user_badges user_badges_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_badges_select ON public.user_badges FOR SELECT USING ((org_id = public.get_user_org_id(auth.uid())));


--
-- Name: user_comp_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_comp_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: user_google_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_google_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: user_incentive_goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_incentive_goals ENABLE ROW LEVEL SECURITY;

--
-- Name: user_incentive_goals user_incentive_goals_admin_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_incentive_goals_admin_manage ON public.user_incentive_goals USING (((org_id = public.get_user_org_id(auth.uid())) AND public.is_admin_or_manager(auth.uid())));


--
-- Name: user_incentive_goals_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_incentive_goals_history ENABLE ROW LEVEL SECURITY;

--
-- Name: user_incentive_goals user_incentive_goals_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_incentive_goals_select ON public.user_incentive_goals FOR SELECT USING (((org_id = public.get_user_org_id(auth.uid())) AND ((user_id = auth.uid()) OR public.is_admin_or_manager(auth.uid()))));


--
-- Name: user_management_comp_overlay_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_management_comp_overlay_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: user_manager_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_manager_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: user_payroll_active_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_payroll_active_history ENABLE ROW LEVEL SECURITY;

--
-- Name: user_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: vendors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

--
-- Name: weather_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weather_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: weather_cache weather_cache_authenticated_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weather_cache_authenticated_select ON public.weather_cache FOR SELECT TO authenticated USING (true);


--
-- Name: weather_refresh_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weather_refresh_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: weather_refresh_runs weather_refresh_runs_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weather_refresh_runs_admin_select ON public.weather_refresh_runs FOR SELECT TO authenticated USING ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())) = ANY (ARRAY['admin'::public.user_role, 'owner'::public.user_role, 'operations'::public.user_role])));


--
-- Name: weather_swaths; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weather_swaths ENABLE ROW LEVEL SECURITY;

--
-- Name: weather_swaths weather_swaths_authenticated_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weather_swaths_authenticated_select ON public.weather_swaths FOR SELECT TO authenticated USING (true);


--
-- Name: work_order_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_order_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: work_order_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_order_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: work_order_status_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_order_status_history ENABLE ROW LEVEL SECURITY;

--
-- Name: work_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict xiEwH0JOe0nrBLSaUbYW2N05BK9AbPldyIb5YNzfRwjO2l1JO4Bs6QdMqBiImBI

