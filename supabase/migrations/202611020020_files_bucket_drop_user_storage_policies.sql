-- Drop the user-level storage policies on the `files` bucket.
--
-- APPLY ONLY AFTER the files-bucket phase-2 prep change (projects/[id]/files uses the
-- service client for storage) is deployed. Apply BEFORE 202611020010_files_bucket_private.sql.
--
-- Why: these 8 policies (4 operations x 2 duplicate names) let ANY signed-in member of an
-- org read, upload, overwrite or delete any object under org/<org>/ in `files` straight
-- from the storage API with their own session token, bypassing the CRM's role rules
-- (field roles never see money/production docs) and the "never hard-delete a contract"
-- rule. Since 2026-11-02 every CRM read/write of `files` goes through the service client
-- (server routes) or a server-issued signed upload URL, which do not use these policies.
--
-- Rollback: recreate the policies (definitions below, one name per operation is enough).
--   create policy "Users can read files in their org" on storage.objects for select
--     using (bucket_id = 'files' and (storage.foldername(name))[1] = 'org'
--            and (storage.foldername(name))[2] = (public.get_user_org_id(auth.uid()))::text);
--   (same expression for delete/update USING and insert WITH CHECK)

drop policy if exists "Users can read files in their org" on storage.objects;
drop policy if exists "Users can read files storage" on storage.objects;
drop policy if exists "Users can upload files to their org" on storage.objects;
drop policy if exists "Users can upload files storage" on storage.objects;
drop policy if exists "Users can update files in their org" on storage.objects;
drop policy if exists "Users can update files storage" on storage.objects;
drop policy if exists "Users can delete files in their org" on storage.objects;
drop policy if exists "Users can delete files storage" on storage.objects;
