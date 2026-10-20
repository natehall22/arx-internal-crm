-- Referral Partners: a networking tracker where each partner (real-estate agent,
-- builder, property manager, ...) is Assigned To exactly one rep, and that rep is paid
-- on jobs the partner sends. See docs/referral-partners-plan.md.
--
-- Everything here is additive. NOT touched: `referrals` (homeowner referral bonuses),
-- `founder_contacts`, `_backup_roof_measurements_*`.
--
-- Writes go through API routes on the service client (ownership / admin checked there).
-- RLS gives org members SELECT only; there are deliberately no INSERT/UPDATE/DELETE
-- policies, so a direct browser-client write is denied.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Types (admin-extensible, per-type inactivity window)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_partner_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  inactivity_days INTEGER NOT NULL DEFAULT 30 CHECK (inactivity_days BETWEEN 8 AND 730),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_partner_types_name
  ON referral_partner_types (org_id, lower(name));

-- ---------------------------------------------------------------------------
-- Partners
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  type_id UUID NOT NULL REFERENCES referral_partner_types(id),
  other_type_text TEXT,
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  phone TEXT,
  phone_digits TEXT,
  email TEXT,
  company TEXT,
  notes TEXT,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'open', 'company_relationship')),
  assigned_at TIMESTAMPTZ,
  last_touched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expiry_warned_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exactly one Assigned To while assigned; nobody otherwise. Enforced here, not in the UI.
  CONSTRAINT referral_partners_one_owner CHECK ((status = 'assigned') = (assigned_user_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_partners_phone
  ON referral_partners (org_id, phone_digits) WHERE phone_digits IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referral_partners_owner ON referral_partners (org_id, assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_partners_status ON referral_partners (org_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_partners_name_trgm
  ON referral_partners USING gin (lower(name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_referral_partners_company_trgm
  ON referral_partners USING gin (lower(coalesce(company, '')) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_referral_partners_phone_prefix
  ON referral_partners (phone_digits text_pattern_ops);

-- Digits only; a leading US country code is dropped so "+1 (704)…" and "704…" collide.
CREATE OR REPLACE FUNCTION referral_partner_normalize_phone(p_phone TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d = '' OR length(d) > 15 THEN NULL
    WHEN length(d) = 11 AND left(d, 1) = '1' THEN substr(d, 2)
    ELSE d
  END
  FROM (SELECT regexp_replace(
          regexp_replace(coalesce(p_phone, ''), '\s*(x|ext\.?|extension)\s*\d+\s*$', '', 'i'),
          '\D', '', 'g') AS d) s
$$;

CREATE OR REPLACE FUNCTION referral_partners_before_write() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS trg_referral_partners_before_write ON referral_partners;
CREATE TRIGGER trg_referral_partners_before_write
  BEFORE INSERT OR UPDATE ON referral_partners
  FOR EACH ROW EXECUTE FUNCTION referral_partners_before_write();

-- ---------------------------------------------------------------------------
-- Audit log: every assignment / status change (who, when, why). A trigger writes it so
-- no code path can skip it. Reason + actor travel in transaction-local settings that the
-- reassign RPC and the nightly job set before they update.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_partner_assignment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seq BIGSERIAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rp_assignment_log_partner
  ON referral_partner_assignment_log (partner_id, created_at DESC);

CREATE OR REPLACE FUNCTION referral_partner_log_assignment() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

DROP TRIGGER IF EXISTS trg_referral_partner_log_assignment ON referral_partners;
CREATE TRIGGER trg_referral_partner_log_assignment
  AFTER INSERT OR UPDATE ON referral_partners
  FOR EACH ROW EXECUTE FUNCTION referral_partner_log_assignment();

-- Removing a user must not fail on the one-owner CHECK: the FK's SET NULL would null
-- assigned_user_id while status is still 'assigned'. Open their partners first (logged).
CREATE OR REPLACE FUNCTION referral_partners_release_for_deleted_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.partner_actor', '', TRUE);
  PERFORM set_config('app.partner_reason', 'rep removed', TRUE);
  UPDATE referral_partners SET status = 'open', assigned_user_id = NULL
   WHERE assigned_user_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_referral_partners_release_deleted_user ON users;
CREATE TRIGGER trg_referral_partners_release_deleted_user
  BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION referral_partners_release_for_deleted_user();

-- Who was Assigned To at a moment in time (NULL = open / Company Relationship / unknown).
CREATE OR REPLACE FUNCTION referral_partner_owner_as_of(p_partner UUID, p_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT l.to_user_id FROM referral_partner_assignment_log l
  WHERE l.partner_id = p_partner AND l.created_at <= p_at
  ORDER BY l.created_at DESC, l.seq DESC LIMIT 1
$$;

-- Admin reassign / Company Relationship / make open. One atomic statement so the audit
-- trigger sees the reason and actor.
CREATE OR REPLACE FUNCTION referral_partner_set_assignment(
  p_partner UUID, p_to_user UUID, p_status TEXT, p_reason TEXT, p_actor UUID
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
REVOKE ALL ON FUNCTION referral_partner_set_assignment FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Touches ride on activities (one feed, one table)
-- ---------------------------------------------------------------------------
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS referral_partner_id UUID REFERENCES referral_partners(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_activities_referral_partner
  ON activities (referral_partner_id, created_at DESC) WHERE referral_partner_id IS NOT NULL;

-- A partner-only activity has no lead/opportunity/project/customer.
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_entity_check;
ALTER TABLE activities ADD CONSTRAINT activities_entity_check CHECK (
  lead_id IS NOT NULL OR opportunity_id IS NOT NULL OR project_id IS NOT NULL
  OR customer_id IS NOT NULL OR referral_partner_id IS NOT NULL
);

-- Only a call / text / email / visit counts as a touch; notes and status changes don't.
CREATE OR REPLACE FUNCTION referral_partner_touch_from_activity() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.referral_partner_id IS NOT NULL AND NEW.type IN ('call', 'text', 'email', 'visit') THEN
    UPDATE referral_partners
       SET last_touched_at = GREATEST(last_touched_at, NEW.created_at), expiry_warned_at = NULL
     WHERE id = NEW.referral_partner_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_referral_partner_touch ON activities;
CREATE TRIGGER trg_referral_partner_touch
  AFTER INSERT ON activities
  FOR EACH ROW EXECUTE FUNCTION referral_partner_touch_from_activity();

-- ---------------------------------------------------------------------------
-- Opportunities: Referred By. Setting it makes the lead's source `partner`.
-- ---------------------------------------------------------------------------
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS referral_partner_id UUID REFERENCES referral_partners(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_referral_partner
  ON opportunities (referral_partner_id) WHERE referral_partner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION opportunity_referral_partner_source() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.referral_partner_id IS NOT NULL AND NEW.lead_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.referral_partner_id IS DISTINCT FROM OLD.referral_partner_id) THEN
    UPDATE leads SET source_type = 'partner'
     WHERE id = NEW.lead_id AND source_type IS DISTINCT FROM 'partner';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_opportunity_referral_partner_source ON opportunities;
CREATE TRIGGER trg_opportunity_referral_partner_source
  AFTER INSERT OR UPDATE OF referral_partner_id ON opportunities
  FOR EACH ROW EXECUTE FUNCTION opportunity_referral_partner_source();

-- ---------------------------------------------------------------------------
-- Commission: `partner_owner` on deal_commission_roles.
-- The live CHECK already allows the two manager_override roles (older migration files are
-- stale), so this keeps every live value and adds one.
-- ---------------------------------------------------------------------------
ALTER TABLE deal_commission_roles DROP CONSTRAINT IF EXISTS deal_commission_roles_role_check;
ALTER TABLE deal_commission_roles ADD CONSTRAINT deal_commission_roles_role_check CHECK (role IN (
  'setter', 'closer', 'inspector', 'field_manager', 'senior_manager', 'self_gen',
  'setter_manager_override', 'closer_manager_override', 'partner_owner', 'custom'
));

-- Writes the partner owner AS OF THE SALE DATE for a job. No pay rate is set: payroll
-- pays an additive role only when override_amount / override_percent is present, so this
-- row pays $0 until a rate is decided. Later reassignment can't change it (history comes
-- from the audit log). If the owner also worked the deal, nothing is written and admins
-- are told, rather than guessing whether they're paid twice.
CREATE OR REPLACE FUNCTION write_partner_owner_role(p_job_id UUID) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
REVOKE ALL ON FUNCTION write_partner_owner_role FROM PUBLIC, anon, authenticated;

-- One implementation for every job-creation path (contracts/sign has two copies; ops can
-- also create jobs). Never blocks job creation.
CREATE OR REPLACE FUNCTION production_job_partner_owner_trigger() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM write_partner_owner_role(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'write_partner_owner_role failed for job %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_production_job_partner_owner ON production_jobs;
CREATE TRIGGER trg_production_job_partner_owner
  AFTER INSERT ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION production_job_partner_owner_trigger();

-- ---------------------------------------------------------------------------
-- Nightly: release untouched partners, warn 7 days before. Company Relationship never
-- expires. Called by /api/cron/referral-partners.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION referral_partners_run_expiry(p_now TIMESTAMPTZ DEFAULT NOW())
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
REVOKE ALL ON FUNCTION referral_partners_run_expiry FROM PUBLIC, anon, authenticated;

-- Duplicate warning: similar name or company, even when spelled differently.
CREATE OR REPLACE FUNCTION find_similar_referral_partners(p_org UUID, p_name TEXT, p_company TEXT DEFAULT NULL)
RETURNS TABLE (id UUID, name TEXT, company TEXT, status TEXT, assigned_user_id UUID, score REAL)
LANGUAGE sql STABLE SET search_path = public, extensions AS $$
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
REVOKE ALL ON FUNCTION find_similar_referral_partners FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: contact details (phone, email, notes, touch history) are private to the assigned rep
-- and admins, so partners and the audit log have NO direct-read policy: the browser/anon key
-- sees nothing. The API (service role) returns the public part — that a partner exists and
-- who it is Assigned To — to every org member, and redacts the rest.
-- ---------------------------------------------------------------------------
ALTER TABLE referral_partner_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_partner_assignment_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referral_partner_types_org_select ON referral_partner_types;
CREATE POLICY referral_partner_types_org_select ON referral_partner_types
  FOR SELECT USING (org_id = get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS referral_partners_org_select ON referral_partners;
DROP POLICY IF EXISTS referral_partner_log_org_select ON referral_partner_assignment_log;

-- Touch notes live in activities, whose read policy is org-wide: keep partner touches out of it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.activities'::regclass
              AND polname = 'Users can read activities') THEN
    DROP POLICY "Users can read activities" ON activities;
    CREATE POLICY "Users can read activities" ON activities
      FOR SELECT USING (org_id = get_user_org_id(auth.uid()) AND referral_partner_id IS NULL);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Permissions (existing system): everyone may view/add; admins manage.
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, display_name, description, category) VALUES
  ('referral_partners:view', 'View Referral Partners',
   'See, add, and log touches on your own Referral Partners', 'Referral Partners'),
  ('referral_partners:manage', 'Manage Referral Partners',
   'Reassign partners, set Company Relationship, bulk import, edit partner types', 'Referral Partners')
ON CONFLICT (name) DO NOTHING;

-- Custom roles only get what is granted to them, so give them View (the built-in role
-- matrix in lib/permissions.ts covers legacy roles).
DO $$
BEGIN
  IF to_regclass('public.custom_roles') IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT cr.id, p.id FROM custom_roles cr
      CROSS JOIN permissions p
     WHERE p.name = 'referral_partners:view'
       AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = cr.id AND rp.permission_id = p.id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Seed: default types for every org (no user data), and Heather Littrell Group as a
-- Company Relationship in the ARX org.
-- ---------------------------------------------------------------------------
INSERT INTO referral_partner_types (org_id, name, sort_order, inactivity_days)
SELECT o.id, t.name, t.ord, t.days
  FROM orgs o
  CROSS JOIN (VALUES
    ('Real Estate Agent', 1, 30), ('Insurance Agent', 2, 30), ('Builder', 3, 90),
    ('Property Manager', 4, 30), ('Home Inspector', 5, 30), ('Lender', 6, 30),
    ('Contractor', 7, 30), ('Other', 8, 30)
  ) AS t(name, ord, days)
ON CONFLICT (org_id, lower(name)) DO NOTHING;

INSERT INTO referral_partners (org_id, type_id, name, company, status, notes)
SELECT '9089d4ad-f46c-405b-9798-6751d45a7051', t.id, 'Heather Littrell', 'Heather Littrell Group (Concord)',
       'company_relationship', 'Company Relationship. Phone not yet known.'
  FROM referral_partner_types t
 WHERE t.org_id = '9089d4ad-f46c-405b-9798-6751d45a7051' AND lower(t.name) = 'real estate agent'
   AND NOT EXISTS (SELECT 1 FROM referral_partners p
                    WHERE p.org_id = t.org_id AND lower(p.company) LIKE 'heather littrell group%');

SELECT pg_notify('pgrst', 'reload schema');
