-- Move signed documents (Settings → Move signed documents): bring DocuSign / Dropbox Sign / PandaDoc exports over as
-- signed, protected customer documents. Additive / loosening only. NOT applied by the builder — apply by hand, BEFORE the
-- code that reads it.
--
-- APPLY ORDER — REQUIRED: after 202611120040 (Jobber import: creates import_runs / import_run_files / import_run_items and
-- import_undo_row, which this feature reuses) and 202611110010 (properties: documents.property_id). Number checked unused in
-- supabase/migrations on integration/multi-company and every /home/claude/wt/* branch (2026-11-11).
--
-- 1. documents.sha256 — SHA-256 of the stored bytes (lowercase hex). Duplicates are refused by a unique index per company
--    (live rows only, so "Undo this import" and a later re-import do not collide).
-- 2. documents.import_source ('docusign' | 'dropbox_sign' | 'pandadoc' | 'other') — set only on a document brought over;
--    documents.import_envelope_id — the tool's own envelope / request id (or 'pair:<hash>' when the files gave none), shared
--    by a signed agreement and its certificate, which is how a certificate stays attached to its document;
--    documents.import_meta — what the files said (subject, who signed, dates), kept so a document waiting for a customer
--    can be matched again later. Once set, none of the four can change (trigger below): an imported document is read-only.
-- 3. documents_linked_role_guard loosened: a document brought over is `signed_executed` (agreement) or
--    `supporting_attachment` (certificate) with NO contract / change-order record behind it — it was signed outside this
--    system. Every other row keeps the old rule.
-- 4. import_runs.source accepts 'signed_docs'; the one-open-import-per-company index becomes one per company AND source,
--    so a signed-documents import does not block (or get mistaken for) a Jobber import. lib/jobber-import/db.ts filters
--    by source.
--
-- A document waiting for a customer is a `documents` row with customer_id NULL (import_source set). Nothing else lists it.
--
-- Rollback: drop trigger documents_import_fields_guard + function; drop the three indexes; restore documents_linked_role_guard
-- from 071_project_files_mvp_foundation.sql (after removing imported rows or giving them a role of NULL); drop the four
-- columns; restore import_runs_source_check ('jobber') and the old import_runs_one_open (org_id) index.

begin;
set local lock_timeout = '5s';

-- ---- 1 + 2. columns ---------------------------------------------------------------------------------------------------
alter table public.documents
  add column if not exists sha256 text null,
  add column if not exists import_source text null,
  add column if not exists import_envelope_id text null,
  add column if not exists import_meta jsonb null;

do $$ begin
  alter table public.documents add constraint documents_sha256_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.documents add constraint documents_import_source_check check (
    (import_source is null and import_envelope_id is null and import_meta is null)
    or (import_source in ('docusign', 'dropbox_sign', 'pandadoc', 'other')
        and sha256 is not null
        and (import_envelope_id is null or char_length(import_envelope_id) between 1 and 200)
        and (import_meta is null or jsonb_typeof(import_meta) = 'object'))
  );
exception when duplicate_object then null; end $$;

create unique index if not exists documents_org_sha256_key
  on public.documents (org_id, sha256) where sha256 is not null and deleted_at is null;
create index if not exists documents_import_envelope_idx
  on public.documents (org_id, import_envelope_id) where import_envelope_id is not null;
-- "Waiting for a customer" list.
create index if not exists documents_import_held_idx
  on public.documents (org_id, created_at desc) where import_source is not null and customer_id is null and deleted_at is null;

-- Read-only once brought over: the fingerprint, where it came from and what it said never change, and an ordinary
-- document cannot be turned into an "imported" one after the fact.
create or replace function public.documents_import_fields_guard() returns trigger
language plpgsql as $$
begin
  if (new.sha256 is distinct from old.sha256 and (old.import_source is not null or new.import_source is not null))
     or new.import_source is distinct from old.import_source
     or new.import_envelope_id is distinct from old.import_envelope_id
     or new.import_meta is distinct from old.import_meta then
    raise exception 'documents: an imported document''s fingerprint and origin cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists documents_import_fields_guard on public.documents;
create trigger documents_import_fields_guard before update on public.documents
  for each row execute function public.documents_import_fields_guard();

-- ---- 3. a signed document with no contract record behind it -----------------------------------------------------------
alter table public.documents drop constraint if exists documents_linked_role_guard;
alter table public.documents add constraint documents_linked_role_guard check (
  (linked_record_type is null and linked_record_id is null and (document_role is null or import_source is not null))
  or (linked_record_type in ('contract', 'change_order') and linked_record_id is not null)
);

-- ---- 4. runs of another kind ------------------------------------------------------------------------------------------
alter table public.import_runs drop constraint if exists import_runs_source_check;
alter table public.import_runs add constraint import_runs_source_check check (source in ('jobber', 'signed_docs'));
drop index if exists public.import_runs_one_open;
create unique index if not exists import_runs_one_open on public.import_runs (org_id, source) where status in ('draft', 'importing', 'undoing');

commit;
