-- Objects production has that NO repo migration creates (read from prod's catalogs, metadata only, 2026-11-11). Idempotent.
CREATE TABLE IF NOT EXISTS public.appointment_types (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, name text NOT NULL, duration_minutes integer NOT NULL DEFAULT 60, color text DEFAULT '#3b82f6', description text, active boolean NOT NULL DEFAULT true, sort_order integer DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), category text NOT NULL DEFAULT 'inspection', buffer_after_minutes integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS public.canvass_parcel_years (county text NOT NULL, pin text NOT NULL, year_built smallint NOT NULL, refreshed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (county, pin));
CREATE TABLE IF NOT EXISTS public.contract_events (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, contract_id uuid REFERENCES contracts(id) ON DELETE CASCADE, event_type text NOT NULL, payload jsonb, prev_event_hash text, event_hash text NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.data_fix_backups (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, fix text NOT NULL, table_name text NOT NULL, row_data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.estimate_line_items (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, estimate_id uuid REFERENCES estimates(id) ON DELETE CASCADE, opportunity_id uuid REFERENCES opportunities(id) ON DELETE CASCADE, org_id uuid NOT NULL, source text DEFAULT 'ai_draft', category text, description text, quantity numeric, unit text, unit_price numeric, total_price numeric, pricebook_item_id uuid, sort_order integer DEFAULT 0, notes text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.job_cost_order_migration_log (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, job_id uuid NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE, product_order_id uuid NOT NULL UNIQUE, cost_line_id uuid REFERENCES job_cost_lines(id) ON DELETE SET NULL, action text NOT NULL CHECK (action IN ('inserted','linked_existing')), amount numeric(12,2) NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='bonus_status') THEN CREATE TYPE bonus_status AS ENUM ('pending_approval','approved','rejected','paid'); END IF; END $$;
CREATE TABLE IF NOT EXISTS public.payroll_bonus_lines (id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, bonus_type text NOT NULL CHECK (bonus_type IN ('444_week1','444_week2','setter_weekly_floor','manual')), amount numeric(14,2) NOT NULL CHECK (amount >= 0), description text, source_id uuid, created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), status bonus_status NOT NULL DEFAULT 'pending_approval', reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL, reviewed_at timestamptz, review_note text, UNIQUE (payroll_period_id, user_id, bonus_type, source_id));
CREATE TABLE IF NOT EXISTS public.payroll_statement_deliveries (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, sent_at timestamptz NOT NULL DEFAULT now(), actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, status text NOT NULL CHECK (status IN ('sent','failed')), error_message text, statement_hash text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.threads (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, org_id uuid NOT NULL REFERENCES orgs(id), kind text NOT NULL CHECK (kind IN ('deal','prospect')), opportunity_id uuid REFERENCES opportunities(id) ON DELETE CASCADE, lead_id uuid REFERENCES leads(id) ON DELETE CASCADE, customer_id uuid REFERENCES customers(id) ON DELETE SET NULL, last_message_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.thread_members (thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, org_id uuid NOT NULL, reason text, muted_until timestamptz, last_read_at timestamptz, joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (thread_id, user_id));

CREATE TABLE IF NOT EXISTS public.solar_candidates (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, county text NOT NULL, pin text, lat double precision NOT NULL, lng double precision NOT NULL, owner_name text, mailing_address text, mailing_city text, mailing_state text, mailing_zip text, subdivision text, imagery_date date, meters_to_nearest_known_solar integer, source text NOT NULL DEFAULT 'google_solar_api', detected_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT (now() + '30 days'::interval), verified_has_solar boolean, verified_at timestamptz, verified_by uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (county, pin));
CREATE TABLE IF NOT EXISTS public.solar_installers (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, name_key text NOT NULL UNIQUE, display_name text NOT NULL, status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('active','defunct','acquired','no_longer_servicing','unknown')), status_source text, status_detail text, status_checked_at timestamptz, nc_sos_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), service_orphaned boolean NOT NULL DEFAULT false, status_confidence text, successor_company text, successor_services_systems boolean, evidence_summary text, source_urls text[], raw_variants text[]);
CREATE TABLE IF NOT EXISTS public.solar_installs (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, county text NOT NULL, permit_number text, pin text, address text, lat double precision, lng double precision, permit_type text, issued_on date, installer_name_raw text, installer_id uuid REFERENCES solar_installers(id) ON DELETE SET NULL, source text NOT NULL DEFAULT 'records_request', refreshed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), permit_owner_name text, current_owner_name text, owner_refreshed_at timestamptz, owner_is_original boolean, pv_class text, pv_evidence text, is_commercial boolean NOT NULL DEFAULT false, permit_numbers text[], years_since_install integer, geocoded_at timestamptz, geocode_source text, property_key text, year_built integer, eff_year_built integer, year_built_source text, roof_age_at_install integer, roof_age_now integer, roof_age_refreshed_at timestamptz, permit_description text);

-- Columns prod has that no migration adds (or with another type). Added if missing; otherwise the type is aligned to prod's.
CREATE OR REPLACE FUNCTION pg_temp.drift(t text, c text, ty text, dflt text DEFAULT NULL, nn boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE cur text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO cur FROM pg_attribute WHERE attrelid = ('public.'||t)::regclass AND attname = c AND NOT attisdropped;
  IF cur IS NULL THEN
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I %s%s%s', t, c, ty, CASE WHEN dflt IS NOT NULL THEN ' DEFAULT '||dflt ELSE '' END, CASE WHEN nn THEN ' NOT NULL' ELSE '' END);
  ELSIF cur <> ty THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP DEFAULT', t, c);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE %s USING %I::text::%s', t, c, ty, c, ty);
    IF dflt IS NOT NULL THEN EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT %s', t, c, dflt); END IF;
  END IF;
END $f$;
SELECT pg_temp.drift('activities','audience','text'), pg_temp.drift('activities','origin','text'), pg_temp.drift('activities','restricted_pricing','boolean'), pg_temp.drift('activities','priority','text'),
 pg_temp.drift('activities','reply_to_id','uuid'), pg_temp.drift('activities','client_id','uuid'), pg_temp.drift('activities','source','text'), pg_temp.drift('activities','mentioned_user_ids','uuid[]'),
 pg_temp.drift('activities','production_job_id','uuid'), pg_temp.drift('activities','work_order_id','uuid'), pg_temp.drift('activities','thread_id','uuid'), pg_temp.drift('activities','edited_at','timestamp with time zone'),
 pg_temp.drift('activities','deleted_at','timestamp with time zone'), pg_temp.drift('activities','deleted_by','uuid'), pg_temp.drift('activities','legacy_ref','jsonb'), pg_temp.drift('activities','pinned_at','timestamp with time zone'),
 pg_temp.drift('activities','pinned_by','uuid'), pg_temp.drift('activities','pin_scope','text'), pg_temp.drift('activities','pin_expires_at','timestamp with time zone'),
 pg_temp.drift('adder_categories','updated_at','timestamp with time zone','now()',true), pg_temp.drift('commissions','commission_period','text'),
 pg_temp.drift('custom_reports','report_type','text','''bar_chart''',true), pg_temp.drift('custom_reports','data_source','text','''leads''',true),
 pg_temp.drift('estimates','status','text','''ai_draft''',true), pg_temp.drift('estimates','scope_summary','text'),
 pg_temp.drift('notifications','thread_id','uuid'), pg_temp.drift('notifications','activity_id','uuid'), pg_temp.drift('notifications','priority','text'), pg_temp.drift('notifications','resolved_at','timestamp with time zone'), pg_temp.drift('notifications','resolution','text'), pg_temp.drift('notifications','snoozed_until','timestamp with time zone'),
 pg_temp.drift('opportunities','estimated_value','numeric'), pg_temp.drift('opportunities','setter_user_id','uuid'), pg_temp.drift('order_form_contracts','roofing_color_style','text'),
 pg_temp.drift('pending_status_prompts','snooze_count','integer','0',true), pg_temp.drift('pricebook_items','visibility','text','''sales_reps'''),
 pg_temp.drift('proposal_line_items','show_to_customer','boolean','false'), pg_temp.drift('proposals','customer_phone','text'), pg_temp.drift('proposals','status','text','''draft''',true),
 pg_temp.drift('report_schedules','schedule_type','text','''daily''',true), pg_temp.drift('report_schedules','schedule_time','time without time zone','''08:00:00'''), pg_temp.drift('report_schedules','schedule_day','integer'), pg_temp.drift('report_schedules','is_active','boolean','true',true),
 pg_temp.drift('roof_measurements','status','text','''completed''',true), pg_temp.drift('roof_measurements','roof_material','text'), pg_temp.drift('scheduled_appointments','appointment_type','text','''inspection'''),
 pg_temp.drift('sub_contractors','portal_access_token','uuid'), pg_temp.drift('team_closer_queue','buffer_before','integer','0',true), pg_temp.drift('team_closer_queue','buffer_after','integer','15',true),
 pg_temp.drift('teams','timezone','text','''America/New_York'''), pg_temp.drift('user_settings','appointment_buffer_before','integer','0'), pg_temp.drift('user_settings','appointment_buffer_after','integer','15'),
 pg_temp.drift('users','show_in_reports','boolean','true'), pg_temp.drift('users','can_receive_appointments','boolean'), pg_temp.drift('users','ui_prefs','jsonb'),
 pg_temp.drift('work_order_status_history','old_status','text'), pg_temp.drift('work_order_status_history','new_status','text',NULL,true),
 pg_temp.drift('work_orders','work_order_type','text','''go_back''',true), pg_temp.drift('work_orders','status','text','''pending''',true), pg_temp.drift('work_orders','priority','text','''normal''',true), pg_temp.drift('work_orders','estimated_cost','numeric'), pg_temp.drift('work_orders','actual_cost','numeric');
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'regional_setter_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'setter_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'setter';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'custom';

-- users.role: prod's column is user_role; the migration chain leaves user_role_old behind. Policies that read it are rebuilt on the new type.
DO $$
DECLARE r record; stmts text[] := '{}'; s text;
BEGIN
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid='public.users'::regclass AND attname='role') = 'user_role' THEN RETURN; END IF;
  FOR r IN SELECT DISTINCT p.schemaname, p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
           FROM pg_policy pp JOIN pg_depend d ON d.classid='pg_policy'::regclass AND d.objid=pp.oid AND d.refobjid='public.users'::regclass
           JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid AND a.attname='role'
           JOIN pg_policies p ON p.policyname=pp.polname AND p.tablename=(SELECT relname FROM pg_class WHERE oid=pp.polrelid)
  LOOP
    stmts := stmts || format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s %s %s', r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd,
      array_to_string(r.roles, ','), CASE WHEN r.qual IS NOT NULL THEN 'USING ('||replace(r.qual,'user_role_old','user_role')||')' ELSE '' END,
      CASE WHEN r.with_check IS NOT NULL THEN 'WITH CHECK ('||replace(r.with_check,'user_role_old','user_role')||')' ELSE '' END);
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
  ALTER TABLE public.users ALTER COLUMN role DROP DEFAULT;
  ALTER TABLE public.users ALTER COLUMN role TYPE user_role USING role::text::user_role;
  ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'sales_rep'::user_role;
  FOREACH s IN ARRAY stmts LOOP EXECUTE s; END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.protect_audit_log() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'The audit log is immutable and cannot be modified.';
  END IF;
  RETURN NEW;
END;
$function$;
