-- A supplier order can be marked RECEIVED (the materials arrived). Draft / Sent / Received per supplier; the job's materials
-- status is derived from these (lib/job-materials-state.ts) with production_jobs.materials_status only as the fallback.
-- Additive, nullable.
alter table public.supplier_orders add column if not exists received_at timestamptz;
alter table public.supplier_orders add column if not exists received_by uuid references public.users(id) on delete set null;
-- ROLLBACK: alter table public.supplier_orders drop column received_at, drop column received_by;
