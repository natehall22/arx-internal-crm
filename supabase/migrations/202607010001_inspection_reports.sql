-- Customer-facing roof inspection reports (photo documentation PDFs).
-- Ported from the standalone ARX Roof Report Builder into the CRM, tied to opportunities.
-- Additive only — no changes to existing tables.

-- Storage bucket: report photos + finished PDFs (private; org-scoped paths; signed URLs only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-reports',
  'inspection-reports',
  false,
  36700160, -- 35MB: photos are ~300KB after client compression; finished PDFs can approach the 25MB Gmail cap
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Org members can upload inspection report files" ON storage.objects;
DROP POLICY IF EXISTS "Org members can read inspection report files" ON storage.objects;
DROP POLICY IF EXISTS "Org members can delete inspection report files" ON storage.objects;

CREATE POLICY "Org members can upload inspection report files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'inspection-reports'
    AND (storage.foldername(name))[1] = get_user_org_id(auth.uid())::text
  );

CREATE POLICY "Org members can read inspection report files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspection-reports'
    AND (storage.foldername(name))[1] = get_user_org_id(auth.uid())::text
  );

CREATE POLICY "Org members can delete inspection report files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'inspection-reports'
    AND (storage.foldername(name))[1] = get_user_org_id(auth.uid())::text
  );

-- One report document. Layout/copy/photo ordering live in `doc` (jsonb) — same shape the
-- standalone builder serialized, minus the photo bytes (those live in storage + photo rows).
CREATE TABLE IF NOT EXISTS inspection_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opportunity_id      UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  created_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  doc                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'sent')),
  -- Unguessable public link token (64 hex chars) for the customer/insurance share page
  share_token         TEXT NOT NULL UNIQUE
                        DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  pdf_storage_path    TEXT,
  pdf_size_bytes      BIGINT,
  pdf_generated_at    TIMESTAMPTZ,
  last_sent_to        TEXT,
  last_sent_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspection_reports_opportunity ON inspection_reports(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_inspection_reports_org ON inspection_reports(org_id);

-- Composite unique index so photo rows can FK on (org_id, id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspection_reports_org_id ON inspection_reports(org_id, id);

CREATE TABLE IF NOT EXISTS inspection_report_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  report_id    UUID NOT NULL,
  storage_path TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT inspection_report_photos_org_report_fk
    FOREIGN KEY (org_id, report_id)
    REFERENCES inspection_reports(org_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inspection_report_photos_report ON inspection_report_photos(report_id);

COMMENT ON TABLE inspection_reports IS
  'Customer-facing roof inspection report documents. doc jsonb holds cover/summary/sections/captions; photos in inspection_report_photos + storage. NOT auto-deleted (unlike inspection_result_photos) — these are customer/insurance deliverables.';

ALTER TABLE inspection_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_report_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view inspection_reports in org" ON inspection_reports;
DROP POLICY IF EXISTS "Users can insert inspection_reports in org" ON inspection_reports;
DROP POLICY IF EXISTS "Users can update inspection_reports in org" ON inspection_reports;
DROP POLICY IF EXISTS "Users can delete inspection_reports in org" ON inspection_reports;

CREATE POLICY "Users can view inspection_reports in org"
  ON inspection_reports FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can insert inspection_reports in org"
  ON inspection_reports FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can update inspection_reports in org"
  ON inspection_reports FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can delete inspection_reports in org"
  ON inspection_reports FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view inspection_report_photos in org" ON inspection_report_photos;
DROP POLICY IF EXISTS "Users can insert inspection_report_photos in org" ON inspection_report_photos;
DROP POLICY IF EXISTS "Users can delete inspection_report_photos in org" ON inspection_report_photos;

CREATE POLICY "Users can view inspection_report_photos in org"
  ON inspection_report_photos FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can insert inspection_report_photos in org"
  ON inspection_report_photos FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can delete inspection_report_photos in org"
  ON inspection_report_photos FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()));
