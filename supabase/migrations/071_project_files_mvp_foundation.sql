-- Migration: 071_project_files_mvp_foundation.sql
-- Purpose: MVP foundation for job-level photos, documents, costs, and attachments

-- ============================================================
-- PART 1: Vendors
-- ============================================================
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vendors_org_id ON vendors(org_id);
CREATE INDEX IF NOT EXISTS idx_vendors_active ON vendors(org_id, active);

-- ============================================================
-- PART 2: Documents (versioned, protected, no hard deletes)
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  linked_record_type TEXT CHECK (linked_record_type IN ('contract', 'change_order')),
  linked_record_id UUID,
  document_role TEXT CHECK (
    document_role IN ('draft', 'signed_executed', 'supporting_attachment', 'customer_copy', 'internal_copy')
  ),

  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  category TEXT NOT NULL,
  title TEXT,
  description TEXT,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'void', 'archived')),
  is_protected BOOLEAN NOT NULL DEFAULT false,

  version INTEGER NOT NULL DEFAULT 1,
  parent_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  version_note TEXT,

  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deletion_reason TEXT,

  CONSTRAINT documents_linked_role_guard CHECK (
    (linked_record_type IS NULL AND linked_record_id IS NULL AND document_role IS NULL)
    OR
    (linked_record_type IN ('contract', 'change_order') AND linked_record_id IS NOT NULL)
  ),
  CONSTRAINT documents_signed_role_protected CHECK (
    document_role IS DISTINCT FROM 'signed_executed' OR is_protected = true
  )
);

CREATE INDEX IF NOT EXISTS idx_documents_org_id ON documents(org_id);
CREATE INDEX IF NOT EXISTS idx_documents_job_id ON documents(job_id);
CREATE INDEX IF NOT EXISTS idx_documents_customer_id ON documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_documents_linked_record ON documents(linked_record_type, linked_record_id);
CREATE INDEX IF NOT EXISTS idx_documents_parent_document_id ON documents(parent_document_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(org_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);

-- ============================================================
-- PART 3: Photos
-- ============================================================
CREATE TABLE IF NOT EXISTS photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  photo_tag TEXT,
  caption TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_org_id ON photos(org_id);
CREATE INDEX IF NOT EXISTS idx_photos_job_id ON photos(job_id);
CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at DESC);

-- ============================================================
-- PART 4: Job Cost Lines + Cost Attachments
-- ============================================================
CREATE TABLE IF NOT EXISTS job_cost_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cost_type TEXT NOT NULL DEFAULT 'other' CHECK (cost_type IN ('material', 'labor', 'permit', 'subcontractor', 'misc', 'other')),
  incurred_on DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_job_cost_lines_org_id ON job_cost_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_job_cost_lines_job_id ON job_cost_lines(job_id);
CREATE INDEX IF NOT EXISTS idx_job_cost_lines_vendor_id ON job_cost_lines(vendor_id);

CREATE TABLE IF NOT EXISTS cost_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_cost_line_id UUID NOT NULL REFERENCES job_cost_lines(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(job_cost_line_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_cost_attachments_org_id ON cost_attachments(org_id);
CREATE INDEX IF NOT EXISTS idx_cost_attachments_job_cost_line_id ON cost_attachments(job_cost_line_id);
CREATE INDEX IF NOT EXISTS idx_cost_attachments_document_id ON cost_attachments(document_id);

-- ============================================================
-- PART 4B: Storage bucket + policies
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-files', 'project-files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can read project-files in their org" ON storage.objects;
CREATE POLICY "Users can read project-files in their org"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'project-files'
    AND (storage.foldername(name))[1] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can upload project-files in their org" ON storage.objects;
CREATE POLICY "Users can upload project-files in their org"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'project-files'
    AND (storage.foldername(name))[1] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can update project-files in their org" ON storage.objects;
CREATE POLICY "Users can update project-files in their org"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'project-files'
    AND (storage.foldername(name))[1] = get_user_org_id(auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'project-files'
    AND (storage.foldername(name))[1] = get_user_org_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "Admins can delete project-files in their org" ON storage.objects;
CREATE POLICY "Admins can delete project-files in their org"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'project-files'
    AND (storage.foldername(name))[1] = get_user_org_id(auth.uid())::text
    AND is_admin_or_manager(auth.uid())
  );

-- ============================================================
-- PART 5: RLS
-- ============================================================
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_cost_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view vendors in their org" ON vendors;
CREATE POLICY "Users can view vendors in their org"
  ON vendors FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert vendors in their org" ON vendors;
CREATE POLICY "Users can insert vendors in their org"
  ON vendors FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update vendors in their org" ON vendors;
CREATE POLICY "Users can update vendors in their org"
  ON vendors FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view documents in their org" ON documents;
CREATE POLICY "Users can view documents in their org"
  ON documents FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert documents in their org" ON documents;
CREATE POLICY "Users can insert documents in their org"
  ON documents FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update documents in their org" ON documents;
CREATE POLICY "Users can update documents in their org"
  ON documents FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view photos in their org" ON photos;
CREATE POLICY "Users can view photos in their org"
  ON photos FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert photos in their org" ON photos;
CREATE POLICY "Users can insert photos in their org"
  ON photos FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update photos in their org" ON photos;
CREATE POLICY "Users can update photos in their org"
  ON photos FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view job cost lines in their org" ON job_cost_lines;
CREATE POLICY "Users can view job cost lines in their org"
  ON job_cost_lines FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert job cost lines in their org" ON job_cost_lines;
CREATE POLICY "Users can insert job cost lines in their org"
  ON job_cost_lines FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update job cost lines in their org" ON job_cost_lines;
CREATE POLICY "Users can update job cost lines in their org"
  ON job_cost_lines FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view cost attachments in their org" ON cost_attachments;
CREATE POLICY "Users can view cost attachments in their org"
  ON cost_attachments FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert cost attachments in their org" ON cost_attachments;
CREATE POLICY "Users can insert cost attachments in their org"
  ON cost_attachments FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update cost attachments in their org" ON cost_attachments;
CREATE POLICY "Users can update cost attachments in their org"
  ON cost_attachments FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

-- ============================================================
-- PART 6: Triggers / guards
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_documents_mvp_rules()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_documents_mvp_rules ON documents;
CREATE TRIGGER trigger_enforce_documents_mvp_rules
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION enforce_documents_mvp_rules();

DROP TRIGGER IF EXISTS trigger_documents_signed_protection_insert ON documents;
CREATE TRIGGER trigger_documents_signed_protection_insert
  BEFORE INSERT ON documents
  FOR EACH ROW
  EXECUTE FUNCTION enforce_documents_mvp_rules();

CREATE OR REPLACE FUNCTION prevent_documents_hard_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Hard delete is not allowed on documents; use archive/soft-delete fields';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_documents_hard_delete ON documents;
CREATE TRIGGER trigger_prevent_documents_hard_delete
  BEFORE DELETE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION prevent_documents_hard_delete();

CREATE OR REPLACE FUNCTION enforce_photos_storage_path_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    RAISE EXCEPTION 'photos.storage_path is immutable';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_photos_storage_path_immutable ON photos;
CREATE TRIGGER trigger_enforce_photos_storage_path_immutable
  BEFORE UPDATE ON photos
  FOR EACH ROW
  EXECUTE FUNCTION enforce_photos_storage_path_immutable();

DROP TRIGGER IF EXISTS trigger_vendors_updated_at ON vendors;
CREATE TRIGGER trigger_vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_job_cost_lines_updated_at ON job_cost_lines;
CREATE TRIGGER trigger_job_cost_lines_updated_at
  BEFORE UPDATE ON job_cost_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- PART 7: Comments
-- ============================================================
COMMENT ON TABLE documents IS 'Versioned document metadata for jobs/customers, including contract/change-order linked docs';
COMMENT ON COLUMN documents.storage_path IS 'Immutable path in Supabase Storage. Replacements create new rows.';
COMMENT ON COLUMN documents.parent_document_id IS 'Previous document version when a file is replaced';
COMMENT ON COLUMN documents.document_role IS 'Role for linked contract/change-order docs: draft, signed_executed, supporting_attachment, customer_copy, internal_copy';
COMMENT ON COLUMN documents.is_protected IS 'Protected documents cannot be hard deleted';

COMMENT ON TABLE photos IS 'Job-level photo records for operational gallery workflows';
COMMENT ON TABLE job_cost_lines IS 'Job cost entries used by the costs panel';
COMMENT ON TABLE cost_attachments IS 'Join table linking cost lines to uploaded document records';
