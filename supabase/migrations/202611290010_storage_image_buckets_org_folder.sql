-- Storage policies on buckets badge-images and pricebook-item-images checked only is_admin_or_manager(auth.uid()),
-- so a manager of company A could upload to / remove objects in company B's folder (objects are named <org_id>/<id>.<ext>;
-- see app/api/admin/pricing/items/[id]/image and app/api/admin/incentives/badges/[id]/image).
-- This adds the company-folder check: the first folder of the object name must be the caller's own org id
-- (public.get_user_org_id(auth.uid())). Policies are altered in place (no policy is removed). Reads stay public (public buckets).
-- The app itself writes through the service role (bypasses these policies), so nothing in the app changes.
--
-- Rollback: ALTER POLICY each of the four below back to ONLY the previous expression:
--   (bucket_id = '<bucket>'::text) AND is_admin_or_manager(auth.uid())
-- (read definitions from this file's git history / pg_policies before applying).

ALTER POLICY badge_images_admin_upload ON storage.objects
  WITH CHECK (
    bucket_id = 'badge-images'::text
    AND is_admin_or_manager(auth.uid())
    AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
  );

ALTER POLICY badge_images_admin_delete ON storage.objects
  USING (
    bucket_id = 'badge-images'::text
    AND is_admin_or_manager(auth.uid())
    AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
  );

ALTER POLICY pricebook_item_images_admin_upload ON storage.objects
  WITH CHECK (
    bucket_id = 'pricebook-item-images'::text
    AND is_admin_or_manager(auth.uid())
    AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
  );

ALTER POLICY pricebook_item_images_admin_delete ON storage.objects
  USING (
    bucket_id = 'pricebook-item-images'::text
    AND is_admin_or_manager(auth.uid())
    AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text
  );
