-- Add image_url to incentive_badges for custom badge photos
ALTER TABLE incentive_badges ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

-- Public storage bucket for badge images (org-scoped paths: {org_id}/{badge_id}.{ext})
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'badge-images',
  'badge-images',
  true,
  2097152, -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Admins/managers in the org can upload and delete badge images
CREATE POLICY "badge_images_admin_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'badge-images'
    AND is_admin_or_manager(auth.uid())
  );

CREATE POLICY "badge_images_admin_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'badge-images'
    AND is_admin_or_manager(auth.uid())
  );

-- Anyone authenticated can read badge images (they are public URLs anyway)
CREATE POLICY "badge_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'badge-images');
