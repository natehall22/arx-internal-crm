-- Storage lockdown for job-files, project-files, inspection-photos, inspection-reports (security sweep 2026-11-13, #8).
-- NOT applied. Same treatment `files` got in 202611100050: drop EVERY storage.objects policy that grants access to one of
-- these buckets, whatever its name. After it only the service role (which skips RLS) reaches them.
--
-- WHY: the policies let any signed-in member of a company (setters and canvassers included) list / download every object in
-- their company's folder straight from the storage API with their own JWT — breaking "field roles never see production" —
-- and let any member DELETE every inspection photo / report file of the company.
--
-- TRACED 2026-11-13 (branch fix/rls-lockdown): the app never touches these buckets with a user or anon client.
--   * Browser: only supabase.storage.from(bucket).uploadToSignedUrl(path, token) with a server-issued signed upload token
--     (JobFileWorkspaceCard, useJobPhotoQueue, ReportBuilder, customer-document-upload, crew pages, MoveSignedDocuments).
--     A signed upload token is checked by the storage server itself and needs no RLS policy.
--   * Server: inspection-reports (app/api/inspection-reports/**, cron cleanup-report-photos), inspection-photos
--     (app/api/opportunities/[id]/inspection-photos/**, inspection-result, cron cleanup-inspection-photos), project-files
--     (FILES_BUCKET: app/api/ops/jobs/[id]/**, customers/[id]/documents, ops/visits photos, ai/extract-exterior-measure) all
--     use createServiceClient() / ctx.admin.
--   * job-files (3 objects, last written 2026-03; job_files has 0 rows): only app/api/jobs/[id]/files[/fileId], which used
--     the user client. Those routes now use the service client and refuse any key outside `orgs/<caller org>/`
--     (jobFilesKeyInOrg). The list/upload route also needs the table `jobs`, which does not exist, so it answers 404 before
--     touching storage — this migration is safe before or after that code.
--   * The iPhone app does not call storage.
-- Public buckets (badge-images, pricebook-item-images, email-assets) and `files` are not touched.
--
-- ROLLBACK (exact prod definitions captured 2026-11-13; all roles {public}; the migration also prints each as a NOTICE):
--   "Users can read job files storage"   SELECT USING ((bucket_id = 'job-files') AND ((storage.foldername(name))[1] = 'orgs') AND ((storage.foldername(name))[2] = (get_user_org_id(auth.uid()))::text))
--   "Users can upload job files storage" INSERT WITH CHECK (same as read)
--   "Users can update job files storage" UPDATE USING (same as read)
--   "Admins can delete job files storage" DELETE USING ((bucket_id = 'job-files') AND ((storage.foldername(name))[1] = 'orgs') AND ((storage.foldername(name))[2] = (get_user_org_id(auth.uid()))::text) AND is_admin_or_manager(auth.uid()))
--   "Users can read project-files in their org"   SELECT USING ((bucket_id = 'project-files') AND ((storage.foldername(name))[1] = (get_user_org_id(auth.uid()))::text))
--   "Users can upload project-files in their org" INSERT WITH CHECK (same as read)
--   "Users can update project-files in their org" UPDATE USING (same as read) WITH CHECK (same as read)
--   "Admins can delete project-files in their org" DELETE USING ((bucket_id = 'project-files') AND ((storage.foldername(name))[1] = (get_user_org_id(auth.uid()))::text) AND is_admin_or_manager(auth.uid()))
--   "Org members can read inspection photos"   SELECT USING ((bucket_id = 'inspection-photos') AND ((storage.foldername(name))[1] = (get_user_org_id(auth.uid()))::text))
--   "Org members can upload inspection photos" INSERT WITH CHECK (same as read)
--   "Org members can delete inspection photos" DELETE USING (same as read)
--   "Org members can read inspection report files"   SELECT USING ((bucket_id = 'inspection-reports') AND ((storage.foldername(name))[1] = (get_user_org_id(auth.uid()))::text))
--   "Org members can upload inspection report files" INSERT WITH CHECK (same as read)
--   "Org members can delete inspection report files" DELETE USING (same as read)

do $$
declare
  p record;
  buckets constant text := '(job-files|project-files|inspection-photos|inspection-reports)';
begin
  for p in
    select policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') ~ ('bucket_id\s*=\s*''' || buckets || '''')
        or coalesce(with_check, '') ~ ('bucket_id\s*=\s*''' || buckets || ''''))
  loop
    raise notice 'dropping storage policy % (% to %) using (%) with check (%)', p.policyname, p.cmd, p.roles, p.qual, p.with_check;
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;

  -- A policy naming one of these buckets in another shape (e.g. bucket_id IN (...)) is not dropped: report it.
  for p in
    select policyname, qual, with_check
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') ~ ('''' || buckets || '''') or coalesce(with_check, '') ~ ('''' || buckets || ''''))
  loop
    raise warning 'storage policy % still mentions one of the locked buckets — review by hand: using (%) with check (%)', p.policyname, p.qual, p.with_check;
  end loop;
end $$;
