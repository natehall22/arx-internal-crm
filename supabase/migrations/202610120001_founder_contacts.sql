-- Founder contacts: realtors, recruits and other people logged from the founder calendar (/foundercalendar).
-- Written only by /api/founder-week/contacts (service role); emailed nightly by
-- /api/cron/founder-contacts-digest, which stamps emailed_at. New table only — additive.
create table if not exists public.founder_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- Who added it. Their contacts are theirs: GET returns them, the nightly email goes to them.
  created_by uuid references public.users(id) on delete set null,
  kind text not null check (kind in ('realtor', 'recruit', 'other')),
  name text not null check (char_length(name) between 1 and 120),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 200),
  company text check (char_length(company) <= 120),
  notes text check (char_length(notes) <= 2000),
  -- Set by the page per submission so an offline retry can't create a duplicate.
  client_id text check (char_length(client_id) <= 64),
  created_at timestamptz not null default now(),
  emailed_at timestamptz
);

create unique index if not exists founder_contacts_org_client_id_key
  on public.founder_contacts (org_id, client_id);

create index if not exists founder_contacts_org_created_idx
  on public.founder_contacts (org_id, created_at desc);

create index if not exists founder_contacts_creator_idx
  on public.founder_contacts (created_by, created_at desc);

create index if not exists founder_contacts_unemailed_idx
  on public.founder_contacts (created_at) where emailed_at is null;

-- Service-role only. RLS on with no policies denies anon/authenticated outright.
alter table public.founder_contacts enable row level security;
