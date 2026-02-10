-- Opportunities + projects migration

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'opportunity_status') THEN
    CREATE TYPE opportunity_status AS ENUM ('open', 'in_progress', 'won', 'lost');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
    ALTER TYPE job_status RENAME TO project_status;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_type') THEN
    ALTER TYPE job_type RENAME TO project_type;
  END IF;
END $$;

ALTER TYPE file_tag ADD VALUE IF NOT EXISTS 'contract';

DO $$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL THEN
    ALTER TABLE jobs RENAME TO projects;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'job_type'
  ) THEN
    ALTER TABLE projects RENAME COLUMN job_type TO project_type;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status opportunity_status NOT NULL DEFAULT 'open',
  project_type project_type NOT NULL DEFAULT 'roofing',
  address_text TEXT,
  lat NUMERIC(10, 8),
  lng NUMERIC(11, 8),
  roof_squares NUMERIC(10, 2),
  siding_squares NUMERIC(10, 2),
  vents_count INTEGER NOT NULL DEFAULT 0,
  layers INTEGER NOT NULL DEFAULT 1,
  total_windows INTEGER NOT NULL DEFAULT 0,
  windows_by_type JSONB,
  notes TEXT,
  design_pdf_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'estimates' AND column_name = 'job_id'
  ) THEN
    ALTER TABLE estimates RENAME COLUMN job_id TO project_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'files' AND column_name = 'job_id'
  ) THEN
    ALTER TABLE files RENAME COLUMN job_id TO project_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'activities' AND column_name = 'job_id'
  ) THEN
    ALTER TABLE activities RENAME COLUMN job_id TO project_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'contracts' AND column_name = 'job_id'
  ) THEN
    ALTER TABLE contracts RENAME COLUMN job_id TO project_id;
  END IF;
END $$;

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE CASCADE;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'activities'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%lead_id%'
    AND (pg_get_constraintdef(oid) LIKE '%job_id%' OR pg_get_constraintdef(oid) LIKE '%project_id%');

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE activities DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE activities
  ADD CONSTRAINT activities_entity_check
  CHECK (
    lead_id IS NOT NULL
    OR opportunity_id IS NOT NULL
    OR project_id IS NOT NULL
    OR customer_id IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_opportunities_org_id ON opportunities(org_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_customer_id ON opportunities(customer_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_lead_id ON opportunities(lead_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_owner_user_id ON opportunities(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);

CREATE INDEX IF NOT EXISTS idx_files_opportunity_id ON files(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_files_customer_id ON files(customer_id);
CREATE INDEX IF NOT EXISTS idx_activities_opportunity_id ON activities(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_activities_customer_id ON activities(customer_id);

ALTER INDEX IF EXISTS idx_jobs_org_id RENAME TO idx_projects_org_id;
ALTER INDEX IF EXISTS idx_jobs_customer_id RENAME TO idx_projects_customer_id;
ALTER INDEX IF EXISTS idx_jobs_lead_id RENAME TO idx_projects_lead_id;
ALTER INDEX IF EXISTS idx_jobs_status RENAME TO idx_projects_status;
ALTER INDEX IF EXISTS idx_jobs_owner_user_id RENAME TO idx_projects_owner_user_id;

ALTER INDEX IF EXISTS idx_estimates_job_id RENAME TO idx_estimates_project_id;
ALTER INDEX IF EXISTS idx_files_job_id RENAME TO idx_files_project_id;
ALTER INDEX IF EXISTS idx_activities_job_id RENAME TO idx_activities_project_id;
ALTER INDEX IF EXISTS idx_contracts_job_id RENAME TO idx_contracts_project_id;

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read opportunities in their org"
  ON opportunities FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can insert opportunities in their org"
  ON opportunities FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update opportunities in their org"
  ON opportunities FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins/managers can delete opportunities in their org"
  ON opportunities FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
