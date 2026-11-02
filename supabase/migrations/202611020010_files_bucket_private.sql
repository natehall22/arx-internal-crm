-- Make the `files` storage bucket private.
--
-- DO NOT APPLY until BOTH are true:
--   1. The files-bucket phase-2 prep (branch fix/files-bucket-phase2-prep) is deployed to production: writers store storage
--      paths, every in-app read goes through /api/files/object, /api/files/signed/<kind>/<token> or /api/org-logo/<orgId>
--      (short-lived signed URLs), and no page falls back to a public URL.
--   2. Supabase storage logs show no '/object/public/files/' requests coming from the CRM for several days of normal use
--      (Logs → Storage, filter on the path). Remaining hits should only be old customer emails, which the owner accepted to break.
--
-- Rows written before phase 2 still hold full public URLs (order_form_contracts.pdf_url, job_change_orders.pdf_url,
-- proposals.cover_image_url, orgs.logo_url / orgs.settings.logo_url). They keep working: lib/files/files-object.ts parses
-- them back to a storage path. No data change is needed.
--
-- Rollback: UPDATE storage.buckets SET public = true WHERE id = 'files';
-- Reverses supabase/migrations/045_make_files_bucket_public.sql.

UPDATE storage.buckets
SET public = false
WHERE id = 'files';
