-- Lead category (Residential / Commercial / ...): the work category a lead is for, set when the lead is created (typed in by
-- hand, or from the website form / a lead source's default) so lead routing can hand commercial leads to the commercial team.
-- Same slug format as customers.category (migration 202611240020; the company's list is orgs.settings.categories.items).
--
-- Additive only, safe before the code:
--   * leads.category: nullable text, slug format checked (NOT VALID, so no table scan or lock on the big leads table).
--     NO backfill: blank = not set (it is not "Residential" and not zero).
--   * lead_sources.default_category: nullable; a website lead from that source gets this category when the form sends none.
--   * partial index for the Leads list filter / routing reads.
-- The category is copied to the customer (customers.category) by application code when a deal / customer is created from the
-- lead, and only when the customer has none.
--
-- Rollback: drop index if exists leads_org_category_idx; the two columns can stay (nullable, unread).

set local lock_timeout = '5s';  -- never queue behind a long query and block the live tables

alter table public.leads add column if not exists category text;
alter table public.lead_sources add column if not exists default_category text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_category_slug_chk') then
    alter table public.leads add constraint leads_category_slug_chk check (category is null or category ~ '^[a-z][a-z0-9_]{0,39}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_sources_default_category_slug_chk') then
    alter table public.lead_sources add constraint lead_sources_default_category_slug_chk check (default_category is null or default_category ~ '^[a-z][a-z0-9_]{0,39}$') not valid;
  end if;
end $$;

create index if not exists leads_org_category_idx on public.leads (org_id, category) where category is not null;

comment on column public.leads.category is 'Work category slug (company list in orgs.settings.categories.items). NULL = not set. Copied to customers.category at deal creation when the customer has none.';
comment on column public.lead_sources.default_category is 'Work category given to a website lead from this source when the form sends none. NULL = none.';
