-- Add image_url to pricebook_items so proposal builder can show a product photo per line item
ALTER TABLE pricebook_items ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

-- Public storage bucket for pricebook item images (org-scoped paths: {org_id}/{item_id}.{ext})
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pricebook-item-images',
  'pricebook-item-images',
  true,
  5242880, -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Admins/managers in the org can upload and delete pricebook item images
CREATE POLICY "pricebook_item_images_admin_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'pricebook-item-images'
    AND is_admin_or_manager(auth.uid())
  );

CREATE POLICY "pricebook_item_images_admin_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'pricebook-item-images'
    AND is_admin_or_manager(auth.uid())
  );

-- Anyone authenticated can read pricebook item images (they are public URLs anyway)
CREATE POLICY "pricebook_item_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'pricebook-item-images');
