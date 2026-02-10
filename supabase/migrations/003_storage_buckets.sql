-- Create storage bucket for files
INSERT INTO storage.buckets (id, name, public)
VALUES ('files', 'files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: Users can read files in their org
CREATE POLICY "Users can read files in their org"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'files' AND
    (storage.foldername(name))[1] = 'org' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

-- Storage policy: Users can upload files to their org
CREATE POLICY "Users can upload files to their org"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'files' AND
    (storage.foldername(name))[1] = 'org' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

-- Storage policy: Users can update files in their org
CREATE POLICY "Users can update files in their org"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'files' AND
    (storage.foldername(name))[1] = 'org' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );

-- Storage policy: Users can delete files in their org
CREATE POLICY "Users can delete files in their org"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'files' AND
    (storage.foldername(name))[1] = 'org' AND
    (storage.foldername(name))[2] = get_user_org_id(auth.uid())::text
  );
