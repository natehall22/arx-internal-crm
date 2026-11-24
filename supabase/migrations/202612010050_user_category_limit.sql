-- Limit a person to certain work categories (owner decision 2026-11-24: "hide other categories everywhere").
--
--   * users.category_limit: nullable text[]. NULL = no limit (sees everything — every person today). Otherwise category slugs from
--     the company's list (orgs.settings.categories.items) and/or the special value '__none' (= records with no category).
--     Owner / admin / super admin are never limited: the app ignores the column for them. No backfill, no default.
--   * Written only by the server (PUT /api/admin/users, owners / admins). The trigger below refuses a change from a browser
--     session (anon / authenticated JWT), the same pattern as is_super_admin. Server = service_role or no JWT (migrations, SQL editor).
--     It is a NEW trigger: guard_users_is_super_admin is not replaced.
--
-- Deploy: apply BEFORE the code (the code tolerates the column missing: nobody is limited until it exists).
-- Rollback: drop trigger trg_guard_users_category_limit; drop function guard_users_category_limit(); alter table users drop column category_limit.

alter table public.users add column if not exists category_limit text[] null;

comment on column public.users.category_limit is 'Work category slugs this person may see (company list; ''__none'' = records with no category). NULL = no limit. Ignored for owners / admins. Server-written only.';

create or replace function public.guard_users_category_limit()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
                          '');
  v_server boolean := v_role in ('service_role', '');
begin
  if v_server then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.category_limit is not null then
      raise exception 'category_limit can only be set by the server' using errcode = '42501';
    end if;
  elsif new.category_limit is distinct from old.category_limit then
    raise exception 'category_limit can only be changed by the server' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_users_category_limit on public.users;
create trigger trg_guard_users_category_limit
  before insert or update on public.users
  for each row execute function public.guard_users_category_limit();
