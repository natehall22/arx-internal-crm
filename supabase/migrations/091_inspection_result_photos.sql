-- Inspection result photos: per-photo rows tied to an inspection_results record.
-- All photos auto-delete after 30 days via daily cron job (app/api/cron/cleanup-inspection-photos).

-- Create the storage bucket for inspection photos (private, org-scoped paths)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-photos',
  'inspection-photos',
  false,
  10485760, -- 10MB per file (pre-compression target is ~800KB; 10MB gives headroom)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users can read/write within their org's folder
DROP POLICY IF EXISTS "Org members can upload inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "Org members can read inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "Org members can delete inspection photos" ON storage.objects;

CREATE POLICY "Org members can upload inspection photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'inspection-photos'
    AND (storage.foldername(name))[1] = get_user_org_id(auth.uid())::text
  );

CREATE POLICY "Org members can read inspection photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspection-photos'
    AND (storage.foldername(name))[1] = get_user_org_id(auth.uid())::text
  );

CREATE POLICY "Org members can delete inspection photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'inspection-photos'
    AND (storage.foldername(name))[1] = get_user_org_id(auth.uid())::text
  );

-- Unique index on inspection_results for composite FK (org_id, id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspection_results_org_id ON inspection_results(org_id, id);

-- Photo metadata table
CREATE TABLE IF NOT EXISTS inspection_result_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  result_id    UUID NOT NULL,
  storage_path TEXT NOT NULL,
  filename     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT inspection_result_photos_org_result_fk
    FOREIGN KEY (org_id, result_id)
    REFERENCES inspection_results(org_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inspection_result_photos_result ON inspection_result_photos(result_id);
CREATE INDEX IF NOT EXISTS idx_inspection_result_photos_created_at ON inspection_result_photos(created_at);

COMMENT ON TABLE inspection_result_photos IS
  'One row per uploaded inspection photo. All rows deleted after 30 days by daily cron job regardless of outcome.';

ALTER TABLE inspection_result_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view inspection_result_photos in org" ON inspection_result_photos;
DROP POLICY IF EXISTS "Users can insert inspection_result_photos in org" ON inspection_result_photos;
DROP POLICY IF EXISTS "Users can delete inspection_result_photos in org" ON inspection_result_photos;

CREATE POLICY "Users can view inspection_result_photos in org"
  ON inspection_result_photos FOR SELECT
  USING (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can insert inspection_result_photos in org"
  ON inspection_result_photos FOR INSERT
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

CREATE POLICY "Users can delete inspection_result_photos in org"
  ON inspection_result_photos FOR DELETE
  USING (org_id = get_user_org_id(auth.uid()));

-- photos_confirmed was a placeholder boolean; actual upload count is the source of truth now
ALTER TABLE inspection_results DROP COLUMN IF EXISTS photos_confirmed;
