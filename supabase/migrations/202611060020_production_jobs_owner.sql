-- Job catch-up: an explicit job owner (Nathan, 2026-11-06). Who has the ball on a production job.
--
-- Nullable and additive. No backfill: existing jobs stay unowned and the catch-up box shows a guess (marked as one)
-- until someone with jobs:edit picks an owner. Written only by PUT /api/ops/jobs/[id]/owner (lib/job-owner.ts).
-- The app works before this is applied (the column is treated as null).
--
-- NOT APPLIED. Apply after the code is merged.

alter table public.production_jobs
  add column if not exists owner_user_id uuid references public.users(id) on delete set null;

create index if not exists idx_production_jobs_org_owner on public.production_jobs (org_id, owner_user_id);

comment on column public.production_jobs.owner_user_id is
  'Explicit job owner (job catch-up). Null = nobody set one; never inferred into this column.';
