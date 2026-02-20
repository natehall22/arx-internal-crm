-- Make the files bucket public so logos and other public assets can be accessed
UPDATE storage.buckets 
SET public = true 
WHERE id = 'files';

-- Add policy for public read access to org logos
-- This allows anyone to view logo files without authentication
CREATE POLICY "Public read access to org logos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'files' AND
    (storage.foldername(name))[1] = 'org' AND
    name LIKE '%/logo.%'
  );

-- Add policy for public read access to proposal property images
CREATE POLICY "Public read access to proposal images"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'files' AND
    (storage.foldername(name))[1] = 'proposals'
  );
