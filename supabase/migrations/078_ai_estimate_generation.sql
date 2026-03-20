-- AI estimate generation support aligned to existing estimate system.
-- IMPORTANT: keep using existing `estimates` + `estimate_lines` tables.

-- Add AI metadata to existing estimates table
alter table if exists estimates
  add column if not exists opportunity_id uuid references opportunities(id) on delete cascade,
  add column if not exists overhead_pct numeric default 15,
  add column if not exists overhead_amount numeric,
  add column if not exists waste_factor_pct numeric default 12,
  add column if not exists roof_type text,
  add column if not exists ai_flags text[];

-- Add AI metadata to existing estimate_lines table
alter table if exists estimate_lines
  add column if not exists opportunity_id uuid references opportunities(id) on delete cascade,
  add column if not exists source text default 'manual',
  add column if not exists notes text;

create index if not exists idx_estimates_opportunity_id on estimates(opportunity_id);
create index if not exists idx_estimate_lines_estimate_id on estimate_lines(estimate_id);
create index if not exists idx_estimate_lines_opportunity_id on estimate_lines(opportunity_id);
