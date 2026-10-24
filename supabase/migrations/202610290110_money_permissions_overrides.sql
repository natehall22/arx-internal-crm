-- Money permissions, per person.
--   money:record         - the job's books (record payments, invoices, job costs; see balance owed). Ops and admins by default.
--   reports:financials   - company financials (already added in 202610290100).
-- An owner can switch either one OFF for one person even over full access (permission_denials) or grant it to one person
-- (user_permissions, existing). Every change is written to permission_audit. Service role only; additive.

insert into public.permissions (name, display_name, description, category)
select 'money:record', 'Record Job Money', 'Record payments, invoices and job costs on a job, and see the balance owed', 'Operations'
where not exists (select 1 from public.permissions where name = 'money:record');

create table if not exists public.permission_denials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  permission_name text not null check (permission_name in ('reports:financials', 'money:record')),
  denied_by uuid references public.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  unique (user_id, permission_name)
);
create index if not exists idx_permission_denials_user on public.permission_denials(user_id);
alter table public.permission_denials enable row level security;  -- no policies: service role only

create table if not exists public.permission_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  target_user_id uuid not null references public.users(id) on delete cascade,
  permission_name text not null,
  action text not null check (action in ('grant', 'deny', 'default')),
  before_state text,
  after_state text,
  created_at timestamptz not null default now()
);
create index if not exists idx_permission_audit_target on public.permission_audit(target_user_id, created_at desc);
alter table public.permission_audit enable row level security;  -- no policies: service role only

-- ROLLBACK: drop table public.permission_audit; drop table public.permission_denials; delete from public.permissions where name = 'money:record';
