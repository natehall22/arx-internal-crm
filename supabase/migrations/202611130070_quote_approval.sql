-- Quotes with optional items + online approval + deposit (feature switch `quoteApproval`, default OFF). CLAUDE.md "Quote approval".
-- ONE quote system: the existing `proposals` / `proposal_line_items`. This adds (1) an "optional" flag on a line, (2) a per-quote
-- deposit override, (3) the customer's quote link (hashed token, expiring, revocable) and (4) the approval record (typed name,
-- time, address, what was ticked, the totals and terms the customer saw). The approval is turned into an ordinary signed
-- `order_form_contracts` row by the existing signing code, so the deal is won, the job is made and the commission base is
-- written by the one writer (lib/job-commission-base.ts) exactly as for any other signed sale.
--
-- ORDER: after 202611120020 (online payments; the deposit is paid through its pay page) and 202611110040 (sales tax).
-- Additive/nullable only. NULL everywhere = today's behaviour (roofing proposals untouched).
--   proposal_line_items.is_optional      NULL/false = part of the price; true = the customer chooses it
--   proposal_line_items.optional_default_on  only meaningful when is_optional: true = ticked when the page opens
--   proposals.deposit_mode / deposit_value   NULL = the company's default deposit (Settings → Quotes)
--   order_form_contracts.quote_approval_id   set only on a contract made from an approval (no contract PDF, no roofing terms)
--
-- New tables are service-role only (RLS on, no policies, no grants to anon/authenticated).
--
-- Down (manual): drop table quote_approvals, quote_links cascade; alter table order_form_contracts drop column quote_approval_id;
--   alter table proposals drop column deposit_mode, drop column deposit_value;
--   alter table proposal_line_items drop column is_optional, drop column optional_default_on;
--   drop functions quote_links_same_company, quote_approvals_guard.

begin;
set local lock_timeout = '5s';

alter table public.proposal_line_items
  add column if not exists is_optional boolean,
  add column if not exists optional_default_on boolean;

alter table public.proposals
  add column if not exists deposit_mode text,
  add column if not exists deposit_value numeric(12, 2);

do $$ begin
  alter table public.proposals
    add constraint proposals_deposit_mode_check check (deposit_mode is null or deposit_mode in ('none', 'percent', 'fixed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.proposals
    add constraint proposals_deposit_value_check check (deposit_value is null or (deposit_value >= 0 and deposit_value <= 10000000));
exception when duplicate_object then null; end $$;

-- ---- The customer's quote link -------------------------------------------------------------------------------------------
-- Only the SHA-256 of the 256-bit token is stored. One live link per proposal (the sender revokes the older ones).
create table if not exists public.quote_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  first_opened_at timestamptz null,
  last_opened_at timestamptz null,
  sent_to text null,
  sent_at timestamptz null
);
create index if not exists quote_links_proposal_idx on public.quote_links (proposal_id, created_at desc);

-- ---- The approval: what the customer agreed to, kept as it was shown -----------------------------------------------------
-- ONE per proposal, ever (a changed price is a new proposal). `snapshot` holds every line (ticked or not), the tax rows, the
-- deposit and the terms text, so a declined option is still on record after the proposal is rewritten to what was sold.
create table if not exists public.quote_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  proposal_id uuid not null references public.proposals(id) on delete restrict,
  opportunity_id uuid null references public.opportunities(id) on delete set null,
  link_id uuid null references public.quote_links(id) on delete set null,
  typed_name text not null check (length(btrim(typed_name)) between 2 and 120),
  approved_at timestamptz not null default now(),
  approved_ip text null,
  approved_user_agent text null,
  selected_item_ids jsonb not null default '[]'::jsonb,
  snapshot jsonb not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null check (total_cents > 0),
  deposit_cents integer not null default 0 check (deposit_cents >= 0 and deposit_cents <= total_cents),
  -- what happened after the approval (steps are repeatable: a half-finished approval is finished, never duplicated)
  contract_id uuid null references public.order_form_contracts(id) on delete set null,
  job_id uuid null references public.production_jobs(id) on delete set null,
  deposit_invoice_id uuid null references public.job_invoices(id) on delete set null,
  proposal_rewritten_at timestamptz null,
  finalize_claimed_at timestamptz null,
  finalized_at timestamptz null,
  finalize_error text null,
  confirmation_sent_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint quote_approvals_one_per_proposal unique (proposal_id)
);
create index if not exists quote_approvals_org_idx on public.quote_approvals (org_id, created_at desc);

alter table public.order_form_contracts add column if not exists quote_approval_id uuid null;
do $$ begin
  alter table public.order_form_contracts
    add constraint order_form_contracts_quote_approval_fk foreign key (quote_approval_id) references public.quote_approvals(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---- Guards ---------------------------------------------------------------------------------------------------------------
-- A link / approval names the same company as its proposal (a service-role writer cannot cross companies by mistake).
create or replace function public.quote_links_same_company()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.proposals p where p.id = new.proposal_id and p.org_id = new.org_id) then
    raise exception 'quote link / approval and its proposal must belong to the same company' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists quote_links_same_company on public.quote_links;
create trigger quote_links_same_company before insert or update of org_id, proposal_id on public.quote_links
  for each row execute function public.quote_links_same_company();
drop trigger if exists quote_approvals_same_company on public.quote_approvals;
create trigger quote_approvals_same_company before insert or update of org_id, proposal_id on public.quote_approvals
  for each row execute function public.quote_links_same_company();

-- The evidence never changes: only the follow-up columns may be written after the insert, and a delete is refused.
create or replace function public.quote_approvals_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a quote approval is a record and cannot be deleted' using errcode = '23514';
  end if;
  if new.org_id is distinct from old.org_id or new.proposal_id is distinct from old.proposal_id
     or new.typed_name is distinct from old.typed_name or new.approved_at is distinct from old.approved_at
     or new.approved_ip is distinct from old.approved_ip or new.selected_item_ids is distinct from old.selected_item_ids
     or new.snapshot is distinct from old.snapshot or new.subtotal_cents is distinct from old.subtotal_cents
     or new.discount_cents is distinct from old.discount_cents or new.tax_cents is distinct from old.tax_cents
     or new.total_cents is distinct from old.total_cents or new.deposit_cents is distinct from old.deposit_cents then
    raise exception 'a quote approval cannot be changed' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists quote_approvals_guard on public.quote_approvals;
create trigger quote_approvals_guard before update or delete on public.quote_approvals
  for each row execute function public.quote_approvals_guard();

do $$
declare t text;
begin
  foreach t in array array['quote_links', 'quote_approvals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

commit;
