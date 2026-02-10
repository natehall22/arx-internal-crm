-- Job Files: Structured storage for contracts, change orders, proposals
-- Storage path: orgs/{orgId}/jobs/{jobId}/{type}.pdf

-- File type enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_file_type') THEN
    CREATE TYPE job_file_type AS ENUM (
      'contract',
      'change_order',
      'proposal',
      'invoice',
      'permit',
      'inspection_report',
      'warranty',
      'other'
    );
  END IF;
END $$;

-- Job files metadata table
CREATE TABLE IF NOT EXISTS job_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_type job_file_type NOT NULL,
  storage_key TEXT NOT NULL, -- Full path: orgs/{orgId}/jobs/{jobId}/contract.pdf
  file_name TEXT NOT NULL, -- Display name: "Contract - Smith Residence.pdf"
  file_size INTEGER, -- Size in bytes
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  version INTEGER NOT NULL DEFAULT 1, -- For tracking revisions
  is_signed BOOLEAN NOT NULL DEFAULT false,
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_job_files_org_id ON job_files(org_id);
CREATE INDEX IF NOT EXISTS idx_job_files_job_id ON job_files(job_id);
CREATE INDEX IF NOT EXISTS idx_job_files_file_type ON job_files(file_type);
CREATE INDEX IF NOT EXISTS idx_job_files_created_at ON job_files(created_at DESC);

-- Unique constraint: one active file per type per job (latest version)
-- We allow multiple versions but track which is current
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_files_unique_current 
  ON job_files(job_id, file_type, version) 
  WHERE version = (SELECT MAX(version) FROM job_files jf2 WHERE jf2.job_id = job_files.job_id AND jf2.file_type = job_files.file_type);

-- RLS Policies
ALTER TABLE job_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view job files in their org" ON job_files;
CREATE POLICY "Users can view job files in their org"
  ON job_files FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can create job files in their org" ON job_files;
CREATE POLICY "Users can create job files in their org"
  ON job_files FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update job files in their org" ON job_files;
CREATE POLICY "Users can update job files in their org"
  ON job_files FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete job files" ON job_files;
CREATE POLICY "Admins can delete job files"
  ON job_files FOR DELETE
  USING (
    org_id = get_user_org_id(auth.uid()) AND
    is_admin_or_manager(auth.uid())
  );

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_job_files_updated_at ON job_files;
CREATE TRIGGER update_job_files_updated_at 
  BEFORE UPDATE ON job_files 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to get the latest version number for a job file type
CREATE OR REPLACE FUNCTION get_next_job_file_version(p_job_id UUID, p_file_type job_file_type)
RETURNS INTEGER AS $$
  SELECT COALESCE(MAX(version), 0) + 1
  FROM job_files
  WHERE job_id = p_job_id AND file_type = p_file_type;
$$ LANGUAGE sql;

-- Function to generate storage key
CREATE OR REPLACE FUNCTION generate_job_file_storage_key(
  p_org_id UUID,
  p_job_id UUID,
  p_file_type job_file_type,
  p_version INTEGER DEFAULT 1
)
RETURNS TEXT AS $$
BEGIN
  IF p_version = 1 THEN
    RETURN 'orgs/' || p_org_id::text || '/jobs/' || p_job_id::text || '/' || p_file_type::text || '.pdf';
  ELSE
    RETURN 'orgs/' || p_org_id::text || '/jobs/' || p_job_id::text || '/' || p_file_type::text || '_v' || p_version::text || '.pdf';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create job-files storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-files', 
  'job-files', 
  false,
  52428800, -- 50MB limit
  ARRAY['application/pdf', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf', 'image/png', 'image/jpeg'];

-- Storage policies for job-files bucket
DROP POLICY IF EXISTS "Users can read job files in their org" ON storage.objects;
CREATE POLICY "Users can read job files in their org"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'job-files' AND
    (storage.foldername(name))[1] = 'orgs' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can upload job files to their org" ON storage.objects;
CREATE POLICY "Users can upload job files to their org"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'job-files' AND
    (storage.foldername(name))[1] = 'orgs' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can update job files in their org" ON storage.objects;
CREATE POLICY "Users can update job files in their org"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'job-files' AND
    (storage.foldername(name))[1] = 'orgs' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Admins can delete job files in storage" ON storage.objects;
CREATE POLICY "Admins can delete job files in storage"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'job-files' AND
    (storage.foldername(name))[1] = 'orgs' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text AND
    is_admin_or_manager(auth.uid())
  );
