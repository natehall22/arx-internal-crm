-- Customer portal for job-based (roofing) customers. Additive / nullable only. NOT applied by the builder.
-- Apply AFTER 202611120060_customer_portal.sql. The portal code reads these columns softly (a missing column shows
-- nothing extra; it never breaks the page), and the staff switches below say "turns on once the update is applied".
--
-- 1. customers.portal_invited_at: staff tapped "Invite to portal". In an invite-only company (roofing default) only
--    invited customers can get a sign-in link or keep a session. NULL = not invited.
-- 2. photos.shared_with_customer: staff marked this one job photo "Show to customer". Default false.
-- 3. production_jobs.portal_show_crew_photos: one tap per job, "Show crew photos to customer" - the crew's four
--    walk-around shots (front / back / left / right) on that job's trades. Default false.
--
-- Down (manual): drop trigger trg_guard_customers_portal_invited on customers (and the three others named below), drop function guard_portal_sharing_columns; alter table public.customers drop column portal_invited_at;
--   alter table public.photos drop column shared_with_customer;
--   alter table public.production_jobs drop column portal_show_crew_photos;

begin;
set local lock_timeout = '5s';

alter table public.customers add column if not exists portal_invited_at timestamptz null;
alter table public.photos add column if not exists shared_with_customer boolean not null default false;
alter table public.production_jobs add column if not exists portal_show_crew_photos boolean not null default false;

-- 4. Who may change them. RLS lets any org member update these rows (a setter can edit a customer, a job, a photo), so
--    without a guard anyone could invite a customer to the portal or show a photo / document / crew set straight through
--    the API. Only the server (service role) or a direct database session may change these four columns - the same
--    pattern as users.is_super_admin (guard_users_is_super_admin). Staff switches go through /api/portal-sharing and
--    /api/customers/[id]/portal-invite, which check the role first and then write with the service client.
create or replace function public.guard_portal_sharing_columns()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
                          '');
  v_col text := tg_argv[0];
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  if v_role in ('service_role', '') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- A new row may only start in the default state (not shared / not invited).
    if v_new -> v_col is not null and v_new ->> v_col not in ('false') then
      raise exception '% can only be set by the server', v_col using errcode = '42501';
    end if;
  elsif (v_new -> v_col) is distinct from (v_old -> v_col) then
    raise exception '% can only be changed by the server', v_col using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_customers_portal_invited on public.customers;
create trigger trg_guard_customers_portal_invited before update on public.customers
  for each row execute function public.guard_portal_sharing_columns('portal_invited_at');
drop trigger if exists trg_guard_photos_shared on public.photos;
create trigger trg_guard_photos_shared before insert or update on public.photos
  for each row execute function public.guard_portal_sharing_columns('shared_with_customer');
drop trigger if exists trg_guard_jobs_portal_crew_photos on public.production_jobs;
create trigger trg_guard_jobs_portal_crew_photos before update on public.production_jobs
  for each row execute function public.guard_portal_sharing_columns('portal_show_crew_photos');
-- documents.shared_with_customer is added by 202611120060 (applied before this file).
drop trigger if exists trg_guard_documents_shared on public.documents;
create trigger trg_guard_documents_shared before insert or update on public.documents
  for each row execute function public.guard_portal_sharing_columns('shared_with_customer');

commit;
