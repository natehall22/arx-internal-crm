-- `files` bucket: drop EVERY storage.objects policy that grants access to it, whatever its name.
--
-- APPLY ORDER: code first. Apply after the files-bucket phase-2 prep is deployed (already on main: every CRM read/write of
-- `files` uses the service client or a server-issued signed URL/upload token, none of which use these policies). It can
-- run before or after 202611020020 (it covers every name that one drops, so it is idempotent with it) and before or after
-- 202611020010 (bucket private). Safe while the bucket is still public: /object/public/ URLs ignore RLS.
--
-- Why a second migration: 202611020020 drops 8 policies by name, but this database has been set up from several scripts
-- with different names. It misses at least:
--   "Public read access to proposal images"  (045) — lets ANYONE with the public anon key read and LIST every company's
--                                                  proposals/<org>/... objects through the storage API, even once the
--                                                  bucket is private;
--   "Public read access to org logos"        (045) — anonymous read of org/*/logo.*; the logo is served by /api/org-logo now;
--   "Users can read|update|delete files in their org storage" (FULL_COMBINED_ALL_MIGRATIONS.sql).
-- Any one left behind keeps the bypass of /api/files/object's field-role rules (CLAUDE.md Known Redundancy #19) open.
--
-- Traced 2026-11-10 (branch fix/invoice-org-scope): no code reads, lists, writes or deletes `files` with a user-scoped or
-- anon client. Browser storage calls are only uploadToSignedUrl into `project-files` / report buckets (server-signed tokens),
-- the iOS app does not call storage, and `files` is touched only through createServiceClient() (admin/logo, org-logo,
-- files/object, contracts/sign + audit, change-orders/*, estimates pdf, proposals image, opportunities contract/design-pdf,
-- projects files, job packets, subs work-order complete). Note FILES_BUCKET in lib/files/storage.ts is `project-files`,
-- a different bucket that this migration does not touch.
--
-- After this, only the service role (which bypasses RLS) can reach `files`; users go through /api/files/object.
--
-- Rollback: re-create the dropped policies from the NOTICE lines this migration prints (each prints its full definition).

do $$
declare
  p record;
begin
  for p in
    select policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (coalesce(qual, '') ~ 'bucket_id\s*=\s*''files''' or coalesce(with_check, '') ~ 'bucket_id\s*=\s*''files''')
  loop
    raise notice 'dropping storage policy % (% to %) using (%) with check (%)', p.policyname, p.cmd, p.roles, p.qual, p.with_check;
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;

  -- A policy naming 'files' in some other shape (e.g. bucket_id IN (...)) is not dropped: report it for a manual look.
  for p in
    select policyname, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (coalesce(qual, '') ~ '''files''' or coalesce(with_check, '') ~ '''files''')
  loop
    raise warning 'storage policy % still mentions ''files'' — review by hand: using (%) with check (%)', p.policyname, p.qual, p.with_check;
  end loop;
end $$;
